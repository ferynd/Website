import { describe, expect, it } from 'vitest';
import { allocateExpense, applyBudgetCaps, buildLedger, calculateSettlements, type Ledger, type LedgerInput } from '../ledger';
import { applySpendCaps, calculateBalances } from '../calc';
import type { Expense, Payment, SpendCap } from '../../pageTypes';
import { OHIO, expense, traveler } from './fixtures/ohio';

const payment = (id: string, payerId: string, payeeId: string, amount: number): Payment => ({
  id,
  payerId,
  payeeId,
  amount,
  date: '2026-10-21',
  description: '',
});

const sum = (record: Record<string, number>) => Object.values(record).reduce((s, n) => s + n, 0);

describe('buildLedger — Ohio Ren Faire golden figures', () => {
  const ledger = buildLedger(OHIO);

  it('totals spending as the sum of expense totals', () => {
    expect(ledger.totalSpendingCents).toBe(242691);
  });

  it('groups categories by total, largest first, with per-traveler subtotals', () => {
    expect(ledger.categories.map((c) => [c.category, c.totalCents])).toEqual([
      ['Accommodation', 69575],
      ['Transportation', 68792],
      ['Activities', 65800],
      ['Food', 38524],
    ]);
    expect(ledger.categories[1].subtotals).toEqual({ kaitlyn: 0, loretta: 17198, jackie: 17198, claudia: 17198, jimi: 17198 });
    expect(ledger.categories[3].subtotals).toEqual({ kaitlyn: 5705, loretta: 5705, jackie: 5705, claudia: 5705, jimi: 15704 });
    for (const category of ledger.categories) expect(sum(category.subtotals)).toBe(category.totalCents);
  });

  it('marks travelers left out of an expense as excluded, not $0', () => {
    const car = ledger.expenses.find((e) => e.expenseId === 'car')!;
    expect(car.excluded).toEqual(['kaitlyn']);
    expect('kaitlyn' in car.shares).toBe(false);
  });

  it('matches the displayed responsibilities to the cent, with no cap binding', () => {
    const expected = { kaitlyn: 32780, loretta: 49978, jackie: 49978, claudia: 49978, jimi: 59977 };
    expect(ledger.subtotals).toEqual(expected);
    expect(ledger.final).toEqual(expected);
    expect(ledger.caps.transfers).toEqual([]);
    expect(ledger.caps.cappedIds).toEqual([]);
    expect(ledger.caps.capCents).toEqual({ kaitlyn: 50000, loretta: 50000, jackie: 50000, claudia: 50000 });
  });

  it('matches the displayed paid and remaining balances', () => {
    expect(ledger.paid).toEqual({ kaitlyn: 0, loretta: 0, jackie: 65800, claudia: 0, jimi: 176891 });
    expect(ledger.remaining).toEqual({ kaitlyn: 32780, loretta: 49978, jackie: -15822, claudia: 49978, jimi: -116914 });
  });

  it('suggests the same settlements as today, keyed by id', () => {
    expect(ledger.settlement).toEqual({
      paused: null,
      settlements: [
        { from: 'loretta', to: 'jimi', cents: 49978 },
        { from: 'claudia', to: 'jimi', cents: 49978 },
        { from: 'kaitlyn', to: 'jimi', cents: 16958 },
        { from: 'kaitlyn', to: 'jackie', cents: 15822 },
      ],
    });
  });

  it('reports no problems or unallocated costs', () => {
    expect(ledger.problems).toEqual([]);
    expect(ledger.unallocatedCents).toBe(0);
    expect(ledger.unpaidCents).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  C1: reimbursements are not costs                                   */
/* ------------------------------------------------------------------ */

const C1: LedgerInput = {
  participants: [traveler('kait', 'Kait'), traveler('james', 'James'), traveler('bob', 'Bob')],
  expenses: [expense({ id: 'lodging', totalAmount: 900, paidBy: { james: 900 }, splitParticipants: ['kait', 'james', 'bob'] })],
  payments: [payment('p1', 'kait', 'james', 200)],
  spendCaps: [
    { participantId: 'kait', maxAmount: 200 },
    { participantId: 'james', maxAmount: 350 },
  ],
  overageSplit: { type: 'even' },
};

describe('C1 regression — reimbursements never consume caps', () => {
  it('Bob owes $350, James is owed $350, Kait is settled', () => {
    const ledger = buildLedger(C1);
    expect(ledger.final).toEqual({ kait: 20000, james: 35000, bob: 35000 });
    expect(ledger.remaining).toEqual({ kait: 0, james: -35000, bob: 35000 });
    expect(ledger.settlement.settlements).toEqual([{ from: 'bob', to: 'james', cents: 35000 }]);
  });

  it('documents the old calc.ts result this replaces (Bob told to pay $550)', () => {
    const people = C1.participants.map(({ id, name }) => ({ id, name }));
    const old = applySpendCaps(calculateBalances(people, C1.expenses, C1.payments), C1.spendCaps!);
    expect(old.find((b) => b.personId === 'bob')!.balance).toBeCloseTo(-550, 2);
  });

  it('payments never change total spending, subtotals, final responsibility, or transfers', () => {
    const without = buildLedger({ ...C1, payments: [] });
    const withMany = buildLedger({
      ...C1,
      payments: [payment('p1', 'kait', 'james', 200), payment('p2', 'bob', 'james', 1000), payment('p3', 'james', 'kait', 75.5)],
    });
    for (const ledger of [withMany, buildLedger(C1)]) {
      expect(ledger.totalSpendingCents).toBe(without.totalSpendingCents);
      expect(ledger.subtotals).toEqual(without.subtotals);
      expect(ledger.final).toEqual(without.final);
      expect(ledger.caps).toEqual(without.caps);
    }
    expect(withMany.reimbursementsSent).toEqual({ kait: 20000, james: 7550, bob: 100000 });
    expect(withMany.reimbursementsReceived).toEqual({ kait: 7550, james: 120000, bob: 0 });
    expect(sum(withMany.remaining)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Budget caps                                                        */
/* ------------------------------------------------------------------ */

describe('applyBudgetCaps', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('leaves subtotals unchanged without caps', () => {
    const result = applyBudgetCaps({ a: 100, b: 200, c: 0, d: 5 }, [], undefined, order);
    expect(result.final).toEqual({ a: 100, b: 200, c: 0, d: 5 });
    expect(result.transfers).toEqual([]);
    expect(result.unallocatedCents).toBe(0);
  });

  it('cascades: absorbing can push another capped traveler over', () => {
    // a over by 300 → b, c, d each +100; b goes 400 → over its 350 cap by 50 → c, d +25.
    const result = applyBudgetCaps(
      { a: 600, b: 300, c: 100, d: 100 },
      [
        { participantId: 'a', maxAmount: 3 },
        { participantId: 'b', maxAmount: 3.5 },
      ],
      { type: 'even' },
      order,
    );
    expect(result.final).toEqual({ a: 300, b: 350, c: 225, d: 225 });
    expect(result.cappedIds).toEqual(['a', 'b']);
    expect(result.adjustments).toEqual({ a: -300, b: 50, c: 125, d: 125 });
    // b is a net absorber (+50), so it absorbs part of a's reduction; it never shows as reduced.
    expect(result.transfers).toEqual([
      { from: 'a', to: 'b', cents: 50 },
      { from: 'a', to: 'c', cents: 125 },
      { from: 'a', to: 'd', cents: 125 },
    ]);
  });

  it('treats a traveler with a $0 share as eligible to absorb (D1)', () => {
    const result = applyBudgetCaps({ a: 300, b: 0 }, [{ participantId: 'a', maxAmount: 2 }], { type: 'even' }, ['a', 'b']);
    expect(result.final).toEqual({ a: 200, b: 100 });
  });

  it('reports costs nobody can absorb when every traveler is capped', () => {
    const result = applyBudgetCaps(
      { a: 10000, b: 10000, c: 10002 },
      ['a', 'b', 'c'].map((participantId) => ({ participantId, maxAmount: 100 })),
      { type: 'even' },
      ['a', 'b', 'c'],
    );
    expect(result.final).toEqual({ a: 10000, b: 10000, c: 10000 });
    expect(result.unallocatedCents).toBe(2);
    expect(result.uncovered).toEqual([{ from: 'c', cents: 2 }]);
    expect(result.transfers).toEqual([]);
  });

  it('splits infeasible reductions between absorbers and "not covered"', () => {
    // a over by 100, b over by 300; c (cap 250) absorbs to its cap then locks.
    const result = applyBudgetCaps(
      { a: 300, b: 500, c: 200 },
      [
        { participantId: 'a', maxAmount: 2 },
        { participantId: 'b', maxAmount: 2 },
        { participantId: 'c', maxAmount: 2.5 },
      ],
      { type: 'even' },
      ['a', 'b', 'c'],
    );
    expect(result.final).toEqual({ a: 200, b: 200, c: 250 });
    expect(result.unallocatedCents).toBe(350);
    expect(result.transfers).toEqual([
      { from: 'a', to: 'c', cents: 13 },
      { from: 'b', to: 'c', cents: 37 },
    ]);
    expect(result.uncovered).toEqual([
      { from: 'a', cents: 87 },
      { from: 'b', cents: 263 },
    ]);
  });

  it('uses manual overage shares among eligible travelers', () => {
    const result = applyBudgetCaps(
      { a: 400, b: 0, c: 0, d: 0 },
      [{ participantId: 'a', maxAmount: 1 }],
      { type: 'manual', shares: { a: 50, b: 50, c: 25, d: 25 } },
      order,
    );
    expect(result.final).toEqual({ a: 100, b: 150, c: 75, d: 75 });
    expect(result.fallbackUsed).toBe(false);
  });

  it('flags the even fallback when manual shares cover nobody eligible', () => {
    const result = applyBudgetCaps(
      { a: 400, b: 0, c: 0, d: 0 },
      [{ participantId: 'a', maxAmount: 1 }],
      { type: 'manual', shares: { a: 100 } },
      order,
    );
    expect(result.final).toEqual({ a: 100, b: 100, c: 100, d: 100 });
    expect(result.fallbackUsed).toBe(true);
  });

  it('ignores caps for unknown travelers and invalid cap values', () => {
    const result = applyBudgetCaps(
      { a: 300, b: 300 },
      [
        { participantId: 'ghost', maxAmount: 1 },
        { participantId: 'a', maxAmount: NaN },
        { participantId: 'b', maxAmount: -5 },
      ],
      undefined,
      ['a', 'b'],
    );
    expect(result.final).toEqual({ a: 300, b: 300 });
    expect(result.capCents).toEqual({});
  });
});

/* ------------------------------------------------------------------ */
/*  Data problems                                                      */
/* ------------------------------------------------------------------ */

describe('allocateExpense — explicit problems', () => {
  const ids = ['a', 'b', 'c'];

  it('splits evenly to the cent, extra cents by split order', () => {
    const result = allocateExpense(expense({ id: 'e', totalAmount: 100, paidBy: { a: 100 }, splitParticipants: ['c', 'a', 'b'] }), ids);
    expect(result.shares).toEqual({ c: 3334, a: 3333, b: 3333 });
    expect(result.problems).toEqual([]);
  });

  it('assigns an unknown traveler share to nobody and reports it', () => {
    const result = allocateExpense(expense({ id: 'e', totalAmount: 90, paidBy: { a: 90 }, splitParticipants: ['a', 'b', 'gone'] }), ids);
    expect(result.shares).toEqual({ a: 3000, b: 3000 });
    expect(result.unassignedCents).toBe(3000);
    expect(result.problems).toEqual([{ kind: 'unknown-traveler', severity: 'error', expenseId: 'e', travelerId: 'gone', cents: 3000 }]);
  });

  it('reports an empty split instead of dividing by zero', () => {
    const result = allocateExpense(expense({ id: 'e', totalAmount: 50, paidBy: { a: 50 }, splitParticipants: [] }), ids);
    expect(result.shares).toEqual({});
    expect(result.unassignedCents).toBe(5000);
    expect(result.problems.map((p) => p.kind)).toEqual(['empty-split']);
  });

  it('reports a missing payer and an unknown payer', () => {
    const none = allocateExpense(expense({ id: 'e', totalAmount: 50, paidBy: {}, splitParticipants: ['a'] }), ids);
    expect(none.problems.map((p) => p.kind)).toEqual(['no-payer']);
    expect(none.unpaidCents).toBe(5000);
    const ghost = allocateExpense(expense({ id: 'e', totalAmount: 50, paidBy: { a: 20, gone: 30 }, splitParticipants: ['a'] }), ids);
    expect(ghost.payers).toEqual({ a: 2000 });
    expect(ghost.problems).toEqual([{ kind: 'unknown-payer', severity: 'error', expenseId: 'e', travelerId: 'gone', cents: 3000 }]);
  });

  it('spreads a payer residual within $0.01 and flags anything larger', () => {
    const close = allocateExpense(expense({ id: 'e', totalAmount: 100, paidBy: { a: 49.99, b: 50 }, splitParticipants: ['a'] }), ids);
    // 4999 : 5000 scaled to $100.00 → 4999.50 / 5000.50; the larger remainder takes the cent.
    expect(close.payers).toEqual({ a: 4999, b: 5001 });
    expect(close.problems).toEqual([]);
    const off = allocateExpense(expense({ id: 'e', totalAmount: 100, paidBy: { a: 40, b: 50 }, splitParticipants: ['a'] }), ids);
    expect(off.payers).toEqual({ a: 4000, b: 5000 });
    expect(off.problems).toEqual([{ kind: 'payer-mismatch', severity: 'error', expenseId: 'e', cents: -1000 }]);
  });

  it('spreads a legacy 99.99% split over the full total (within tolerance)', () => {
    const result = allocateExpense(
      expense({
        id: 'e',
        totalAmount: 10000,
        paidBy: { a: 10000 },
        splitParticipants: ['a', 'b', 'c'],
        splitType: 'manual',
        manualSplit: { a: { type: 'percent', value: 33.33 }, b: { type: 'percent', value: 33.33 }, c: { type: 'percent', value: 33.33 } },
      }),
      ids,
    );
    expect(result.shares).toEqual({ a: 333334, b: 333333, c: 333333 });
    expect(result.unassignedCents).toBe(0);
    expect(result.problems).toEqual([]);
  });

  it('spreads a legacy $0.01 amount residual by largest remainder', () => {
    const result = allocateExpense(
      expense({
        id: 'e',
        totalAmount: 100,
        paidBy: { a: 100 },
        splitParticipants: ['a', 'b', 'c'],
        splitType: 'manual',
        manualSplit: { a: { type: 'amount', value: 33.33 }, b: { type: 'amount', value: 33.33 }, c: { type: 'amount', value: 33.33 } },
      }),
      ids,
    );
    expect(result.shares).toEqual({ a: 3334, b: 3333, c: 3333 });
  });

  it('flags a percent shortfall beyond tolerance and leaves the gap unassigned', () => {
    const result = allocateExpense(
      expense({
        id: 'e',
        totalAmount: 100,
        paidBy: { a: 100 },
        splitParticipants: ['a', 'b'],
        splitType: 'manual',
        manualSplit: { a: { type: 'percent', value: 50 }, b: { type: 'percent', value: 40 } },
      }),
      ids,
    );
    expect(result.shares).toEqual({ a: 5000, b: 4000 });
    expect(result.unassignedCents).toBe(1000);
    expect(result.problems).toEqual([{ kind: 'split-mismatch', severity: 'error', expenseId: 'e', direction: 'under', cents: 1000 }]);
  });

  it('flags an over-allocated split and scales it to the total', () => {
    const result = allocateExpense(
      expense({
        id: 'e',
        totalAmount: 100,
        paidBy: { a: 100 },
        splitParticipants: ['a', 'b'],
        splitType: 'manual',
        manualSplit: { a: { type: 'amount', value: 100 }, b: { type: 'amount', value: 25 } },
      }),
      ids,
    );
    expect(result.shares).toEqual({ a: 8000, b: 2000 });
    expect(result.problems).toEqual([{ kind: 'split-mismatch', severity: 'error', expenseId: 'e', direction: 'over', cents: 2500 }]);
  });

  it('keeps explicit zero shares distinct from excluded travelers', () => {
    const result = allocateExpense(
      expense({
        id: 'e',
        totalAmount: 30,
        paidBy: { a: 30 },
        splitParticipants: ['a', 'b'],
        splitType: 'manual',
        manualSplit: { a: { type: 'amount', value: 30 }, b: { type: 'amount', value: 0 } },
      }),
      ids,
    );
    expect(result.shares).toEqual({ a: 3000, b: 0 });
    expect(result.excluded).toEqual(['c']);
  });

  it('flags invalid totals and shares instead of propagating NaN', () => {
    const badTotal = allocateExpense(expense({ id: 'e', totalAmount: NaN, paidBy: {}, splitParticipants: ['a'] }), ids);
    expect(badTotal.totalCents).toBe(0);
    expect(badTotal.problems.map((p) => p.kind)).toEqual(['invalid-total']);
    const badShare = allocateExpense(
      expense({
        id: 'e',
        totalAmount: 10,
        paidBy: { a: 10 },
        splitParticipants: ['a', 'b'],
        splitType: 'manual',
        manualSplit: { a: { type: 'amount', value: 10 }, b: { type: 'amount', value: -4 } },
      }),
      ids,
    );
    expect(badShare.shares).toEqual({ a: 1000, b: 0 });
    expect(badShare.problems.map((p) => p.kind)).toEqual(['invalid-share']);
  });
});

describe('buildLedger — problems pause settlements', () => {
  const base: LedgerInput = {
    participants: [traveler('a'), traveler('b')],
    expenses: [expense({ id: 'e', totalAmount: 90, paidBy: { a: 90 }, splitParticipants: ['a', 'b', 'gone'] })],
    payments: [],
  };

  it('pauses on unassigned costs and reports them', () => {
    const ledger = buildLedger(base);
    expect(ledger.unassignedCents).toBe(3000);
    expect(ledger.unallocatedCents).toBe(3000);
    expect(ledger.settlement).toEqual({ settlements: [], paused: 'unallocated' });
  });

  it('pauses on infeasible caps', () => {
    const ledger = buildLedger({
      participants: [traveler('a'), traveler('b')],
      expenses: [expense({ id: 'e', totalAmount: 300, paidBy: { a: 300 }, splitParticipants: ['a', 'b'] })],
      payments: [],
      spendCaps: [
        { participantId: 'a', maxAmount: 100 },
        { participantId: 'b', maxAmount: 100 },
      ],
    });
    expect(ledger.unallocatedCents).toBe(10000);
    expect(ledger.problems).toContainEqual({ kind: 'caps-infeasible', severity: 'error', cents: 10000 });
    expect(ledger.settlement.paused).toBe('unallocated');
  });

  it('pauses when payers do not cover spending (non-conserving)', () => {
    const ledger = buildLedger({ ...base, expenses: [expense({ id: 'e', totalAmount: 90, paidBy: {}, splitParticipants: ['a', 'b'] })] });
    expect(ledger.unallocatedCents).toBe(0);
    expect(ledger.unpaidCents).toBe(9000);
    expect(ledger.settlement.paused).toBe('non-conserving');
  });

  it('ignores and reports invalid or orphaned payments', () => {
    const ledger = buildLedger({
      participants: [traveler('a'), traveler('b')],
      expenses: [],
      payments: [payment('neg', 'a', 'b', -5), payment('self', 'a', 'a', 5), payment('ghost', 'a', 'gone', 5)],
    });
    expect(ledger.reimbursementsSent).toEqual({ a: 0, b: 0 });
    expect(ledger.problems.map((p) => [p.kind, p.paymentId])).toEqual([
      ['invalid-payment', 'neg'],
      ['invalid-payment', 'self'],
      ['unknown-payment-traveler', 'ghost'],
    ]);
  });

  it('flags the manual overage fallback', () => {
    const ledger = buildLedger({
      participants: [traveler('a'), traveler('b')],
      expenses: [expense({ id: 'e', totalAmount: 300, paidBy: { a: 300 }, splitParticipants: ['a'] })],
      payments: [],
      spendCaps: [{ participantId: 'a', maxAmount: 100 }],
      overageSplit: { type: 'manual', shares: { a: 100 } },
    });
    expect(ledger.final).toEqual({ a: 10000, b: 20000 });
    expect(ledger.problems).toEqual([{ kind: 'overage-fallback', severity: 'warning' }]);
  });
});

describe('buildLedger — adding a traveler', () => {
  it('a new zero-share traveler changes no expense row; only cap adjustments move', () => {
    const before = buildLedger(C1);
    const after = buildLedger({ ...C1, participants: [...C1.participants, traveler('zoe', 'Zoe')] });
    for (const [i, row] of before.expenses.entries()) {
      expect(after.expenses[i].shares).toEqual(row.shares);
      expect(after.expenses[i].totalCents).toBe(row.totalCents);
    }
    expect(after.subtotals).toEqual({ ...before.subtotals, zoe: 0 });
    expect(after.totalSpendingCents).toBe(before.totalSpendingCents);
    // Kait's $100 over-cap cost is now spread over James, Bob and Zoe.
    expect(after.caps.adjustments).toEqual({ kait: -10000, james: 3334, bob: 3333, zoe: 3333 });
    expect(after.expenses[0].excluded).toEqual(['zoe']);
  });
});

describe('calculateSettlements', () => {
  it('only moves money from people who owe to people who are owed', () => {
    const result = calculateSettlements({ a: 5000, b: -3000, c: -2000, d: 0 });
    expect(result).toEqual({
      paused: null,
      settlements: [
        { from: 'a', to: 'b', cents: 3000 },
        { from: 'a', to: 'c', cents: 2000 },
      ],
    });
  });

  it('refuses non-conserving or non-integer balances', () => {
    expect(calculateSettlements({ a: 5000, b: 2000 }).paused).toBe('non-conserving');
    expect(calculateSettlements({ a: 0.5, b: -0.5 }).paused).toBe('non-conserving');
  });

  it('refuses any unallocated amount, even one cent', () => {
    expect(calculateSettlements({ a: 1, b: -1 }, { unallocatedCents: 1 })).toEqual({ settlements: [], paused: 'unallocated' });
  });

  it('returns nothing when everyone is settled', () => {
    expect(calculateSettlements({ a: 0, b: 0 })).toEqual({ settlements: [], paused: null });
  });
});

/* ------------------------------------------------------------------ */
/*  Seeded property loop                                               */
/* ------------------------------------------------------------------ */

/** mulberry32: small deterministic PRNG so failures reproduce from the seed. */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randomTrip(seed: number): LedgerInput {
  const rand = rng(seed);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const pick = <T,>(items: T[]) => items[int(0, items.length - 1)];
  const messy = rand() < 0.3;
  const ids = Array.from({ length: int(1, 7) }, (_, i) => `t${i}`);
  const pool = messy ? [...ids, 'ghost'] : ids;

  const expenses: Expense[] = Array.from({ length: int(0, 10) }, (_, i) => {
    const totalCents = int(1, 200000);
    const total = totalCents / 100;
    const split = pool.filter(() => rand() < 0.7);
    if (!split.length && !(messy && rand() < 0.3)) split.push(pick(ids));
    const payer = messy && rand() < 0.1 ? 'ghost' : pick(ids);
    const paidBy: Record<string, number> = messy && rand() < 0.1 ? {} : { [payer]: total };
    if (rand() < 0.2 && ids.length > 1 && paidBy[payer]) {
      const second = ids.find((id) => id !== payer)!;
      const part = int(0, totalCents);
      paidBy[payer] = (totalCents - part) / 100;
      paidBy[second] = part / 100;
    }
    if (rand() < 0.5 || !split.length) {
      return expense({ id: `e${i}`, category: pick(['Food', 'Lodging', 'Fun']), totalAmount: total, paidBy, splitParticipants: split });
    }
    const type = rand() < 0.5 ? 'percent' : 'amount';
    const weights = split.map(() => int(0, 100));
    if (!weights.some((w) => w > 0)) weights[0] = 1;
    const weightSum = weights.reduce((s, w) => s + w, 0);
    // Clean shares sum exactly (the last traveler takes the remainder).
    const unit = type === 'percent' ? 10000 : totalCents;
    const parts = weights.map((w) => Math.floor((w / weightSum) * unit));
    parts[parts.length - 1] = unit - parts.slice(0, -1).reduce((s, n) => s + n, 0);
    const manualSplit: Expense['manualSplit'] = {};
    split.forEach((id, k) => {
      const value = parts[k] / 100;
      // Messy trips sometimes record shares that miss the total.
      manualSplit[id] = { type, value: messy && rand() < 0.2 ? value * (0.5 + rand()) : value };
    });
    return expense({ id: `e${i}`, totalAmount: total, paidBy, splitParticipants: split, splitType: 'manual', manualSplit });
  });

  const spendCaps: SpendCap[] = ids.filter(() => rand() < 0.4).map((participantId) => ({ participantId, maxAmount: int(0, 150000) / 100 }));
  const payments: Payment[] = Array.from({ length: int(0, 4) }, (_, i) => {
    const payerId = pick(ids);
    const payeeId = pick(ids);
    return payment(`p${i}`, payerId, payeeId, int(1, 50000) / 100);
  });

  return {
    participants: ids.map((id) => traveler(id)),
    expenses,
    payments,
    spendCaps,
    overageSplit: rand() < 0.5 ? { type: 'even' } : { type: 'manual', shares: Object.fromEntries(ids.map((id) => [id, int(0, 3) * 25])) },
  };
}

function assertInvariants(trip: LedgerInput, ledger: Ledger) {
  const integerRecords = [
    ledger.subtotals,
    ledger.final,
    ledger.paid,
    ledger.reimbursementsSent,
    ledger.reimbursementsReceived,
    ledger.remaining,
    ledger.caps.adjustments,
  ];
  for (const record of integerRecords) {
    expect(Object.keys(record)).toEqual(ledger.travelerIds);
    for (const cents of Object.values(record)) expect(Number.isSafeInteger(cents)).toBe(true);
  }
  for (const e of ledger.expenses) {
    for (const cents of [...Object.values(e.shares), ...Object.values(e.payers), e.totalCents, e.unassignedCents]) {
      expect(Number.isSafeInteger(cents)).toBe(true);
    }
    expect(e.unassignedCents).toBeGreaterThanOrEqual(0);
  }

  // Spending is the sum of expense totals and is conserved through caps.
  expect(ledger.totalSpendingCents).toBe(ledger.expenses.reduce((s, e) => s + e.totalCents, 0));
  expect(sum(ledger.subtotals) + ledger.unassignedCents).toBe(ledger.totalSpendingCents);
  expect(sum(ledger.final) + ledger.unallocatedCents).toBe(ledger.totalSpendingCents);
  expect(sum(ledger.paid) + ledger.unpaidCents).toBe(ledger.totalSpendingCents);
  expect(sum(ledger.remaining)).toBe(ledger.unpaidCents - ledger.unallocatedCents);
  if (ledger.unallocatedCents === 0 && ledger.unpaidCents === 0) {
    expect(sum(ledger.remaining)).toBe(0);
    expect(ledger.settlement.paused).toBeNull();
  } else {
    expect(ledger.settlement.paused).not.toBeNull();
  }

  // Nobody with a cap ends above it.
  for (const [id, cap] of Object.entries(ledger.caps.capCents)) {
    if (ledger.caps.cappedIds.includes(id)) expect(ledger.final[id]).toBe(cap);
    else expect(ledger.final[id]).toBeLessThanOrEqual(cap);
  }

  // Transfers are positive, net to zero per row, and reconcile to each net adjustment.
  const net = Object.fromEntries(ledger.travelerIds.map((id) => [id, 0]));
  for (const t of ledger.caps.transfers) {
    expect(t.cents).toBeGreaterThan(0);
    expect(t.from).not.toBe(t.to);
    net[t.from] -= t.cents;
    net[t.to] += t.cents;
  }
  for (const u of ledger.caps.uncovered) {
    expect(u.cents).toBeGreaterThan(0);
    net[u.from] -= u.cents;
  }
  expect(net).toEqual(ledger.caps.adjustments);
  expect(ledger.caps.uncovered.reduce((s, u) => s + u.cents, 0)).toBe(ledger.caps.unallocatedCents);

  // Settlements only flow from debtors to creditors and clear every balance.
  if (!ledger.settlement.paused) {
    const left = { ...ledger.remaining };
    for (const s of ledger.settlement.settlements) {
      expect(ledger.remaining[s.from]).toBeGreaterThan(0);
      expect(ledger.remaining[s.to]).toBeLessThan(0);
      left[s.from] -= s.cents;
      left[s.to] += s.cents;
    }
    expect(Object.values(left).every((c) => c === 0)).toBe(true);
  }

  // Reimbursements never change spending, allocations, or caps.
  const withoutPayments = buildLedger({ ...trip, payments: [] });
  expect(withoutPayments.totalSpendingCents).toBe(ledger.totalSpendingCents);
  expect(withoutPayments.final).toEqual(ledger.final);
  expect(withoutPayments.caps).toEqual(ledger.caps);
}

describe('buildLedger — seeded property loop', () => {
  it('conserves every cent across 500 random trips', () => {
    let pausedCount = 0;
    let cappedCount = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const trip = randomTrip(seed);
      const ledger = buildLedger(trip);
      try {
        assertInvariants(trip, ledger);
      } catch (error) {
        throw new Error(`seed ${seed}: ${(error as Error).message}`);
      }
      if (ledger.settlement.paused) pausedCount++;
      if (ledger.caps.cappedIds.length) cappedCount++;
    }
    // Guard against a generator that never reaches the interesting paths.
    expect(pausedCount).toBeGreaterThan(20);
    expect(pausedCount).toBeLessThan(400);
    expect(cappedCount).toBeGreaterThan(50);
  });
});
