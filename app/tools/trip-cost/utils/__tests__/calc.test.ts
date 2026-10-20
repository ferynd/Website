import { describe, expect, it } from 'vitest';
import { calculateBalances, applySpendCaps, calculateSettlements } from '../calc';
import type { Expense, Payment, Person, SpendCap } from '../../pageTypes';

const people: Person[] = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
  { id: 'c', name: 'Carol' },
];

const evenExpense = (id: string, total: number, paidBy: string, splitAmong: string[]): Expense => ({
  id,
  category: 'food',
  description: id,
  totalAmount: total,
  paidBy: { [paidBy]: total },
  splitType: 'even',
  splitParticipants: splitAmong,
  manualSplit: {},
  createdBy: paidBy,
});

describe('calculateBalances', () => {
  it('conserves the total: paid equals owed across all participants', () => {
    const expenses = [evenExpense('e1', 90, 'a', ['a', 'b', 'c'])];
    const balances = calculateBalances(people, expenses, []);
    const totalPaid = balances.reduce((s, b) => s + b.totalPaid, 0);
    const totalOwed = balances.reduce((s, b) => s + b.shouldHavePaid, 0);
    expect(totalPaid).toBeCloseTo(totalOwed, 5);
    expect(balances.reduce((s, b) => s + b.balance, 0)).toBeCloseTo(0, 5);
  });

  it('folds payments into totalPaid/shouldHavePaid without breaking conservation', () => {
    const expenses = [evenExpense('e1', 90, 'a', ['a', 'b', 'c'])];
    const payments: Payment[] = [
      { id: 'p1', payerId: 'b', payeeId: 'a', date: '2026-01-01', description: '', amount: 30 },
    ];
    const balances = calculateBalances(people, expenses, payments);
    expect(balances.reduce((s, b) => s + b.balance, 0)).toBeCloseTo(0, 5);
  });
});

describe('applySpendCaps — F-087 conservation', () => {
  it('reports zero unallocatedOverage when no caps are set', () => {
    const balances = calculateBalances(people, [evenExpense('e1', 90, 'a', ['a', 'b', 'c'])], []);
    const capped = applySpendCaps(balances, []);
    expect(capped.every((b) => b.unallocatedOverage === 0)).toBe(true);
  });

  it('redistributes overage to eligible participants and conserves the total', () => {
    const balances = calculateBalances(people, [evenExpense('e1', 90, 'a', ['a', 'b', 'c'])], []);
    const caps: SpendCap[] = [{ participantId: 'b', maxAmount: 10 }];
    const capped = applySpendCaps(balances, caps);
    expect(capped.reduce((s, b) => s + b.shouldHavePaid, 0)).toBeCloseTo(90, 2);
    expect(capped.every((b) => b.unallocatedOverage === 0)).toBe(true);
  });

  it('flags unallocatedOverage instead of silently discarding it when every other participant is also capped', () => {
    // Everyone is capped below their raw share — no eligible recipient can
    // ever absorb the last person's overage.
    const balances = calculateBalances(people, [evenExpense('e1', 300, 'a', ['a', 'b', 'c'])], []);
    const caps: SpendCap[] = [
      { participantId: 'a', maxAmount: 10 },
      { participantId: 'b', maxAmount: 10 },
      { participantId: 'c', maxAmount: 10 },
    ];
    const capped = applySpendCaps(balances, caps);
    const totalUnallocated = capped[0].unallocatedOverage;
    expect(totalUnallocated).toBeGreaterThan(0);
    // shouldHavePaid no longer conserves the trip total — that's exactly
    // what unallocatedOverage exists to surface rather than hide.
    const totalOwed = capped.reduce((s, b) => s + b.shouldHavePaid, 0);
    expect(Math.abs(totalOwed - 300)).toBeCloseTo(totalUnallocated, 2);
  });
});

describe('calculateSettlements — F-087 sign/conservation safety', () => {
  it('produces settlements that only move money from negative to positive balances', () => {
    const balances = calculateBalances(people, [evenExpense('e1', 90, 'a', ['a', 'b', 'c'])], []);
    const settlements = calculateSettlements(balances);
    expect(settlements.length).toBeGreaterThan(0);
    for (const s of settlements) {
      expect(s.amount).toBeGreaterThan(0);
    }
    // Alice paid the full 90, owes 30 -> balance +60 (creditor); Bob/Carol owe 30 each, paid 0 -> -30 (debtors).
    expect(settlements.every((s) => s.to === 'Alice')).toBe(true);
  });

  it('refuses to generate settlements when balances do not conserve (e.g. infeasible caps)', () => {
    const nonConserving = [
      { personId: 'a', name: 'Alice', totalPaid: 0, shouldHavePaid: 0, balance: 50 },
      { personId: 'b', name: 'Bob', totalPaid: 0, shouldHavePaid: 0, balance: 20 },
    ];
    // Both positive — nothing sums to zero, so no valid debtor exists.
    expect(calculateSettlements(nonConserving)).toEqual([]);
  });

  it('never treats a positive balance as a debtor', () => {
    // Constructed so every balance is >= 0 except rounding noise; the old
    // implementation trusted sort position and could still emit a
    // creditor-pays-creditor settlement here.
    const allNonNegative = [
      { personId: 'a', name: 'Alice', totalPaid: 0, shouldHavePaid: 0, balance: 0 },
      { personId: 'b', name: 'Bob', totalPaid: 0, shouldHavePaid: 0, balance: 0 },
      { personId: 'c', name: 'Carol', totalPaid: 0, shouldHavePaid: 0, balance: 0 },
    ];
    expect(calculateSettlements(allNonNegative)).toEqual([]);
  });

  it('refuses settlements for any flagged cap shortfall, even one below the rounding tolerance', () => {
    // $30.02 split three ways with everyone capped at $10 leaves $0.02 that
    // no one can absorb: total imbalance is under the per-participant
    // tolerance, but the advice would still leave two cents unsettled.
    const balances = calculateBalances(people, [evenExpense('e1', 30.02, 'a', ['a', 'b', 'c'])], []);
    const caps: SpendCap[] = [
      { participantId: 'a', maxAmount: 10 },
      { participantId: 'b', maxAmount: 10 },
      { participantId: 'c', maxAmount: 10 },
    ];
    const capped = applySpendCaps(balances, caps);
    expect(capped[0].unallocatedOverage).toBeGreaterThan(0);
    expect(calculateSettlements(capped)).toEqual([]);
  });
});
