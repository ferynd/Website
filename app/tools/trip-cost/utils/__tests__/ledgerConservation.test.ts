import { describe, expect, it } from 'vitest';
import { applyBudgetCaps, buildLedger, calculateSettlements } from '../ledger';
import type { Expense, SpendCap, TripParticipant } from '../../pageTypes';

// Ported from calc.test.ts: retain every conservation and settlement guard
// scenario against the canonical cents ledger (positive remaining = owes).
const participants: TripParticipant[] = ['a', 'b', 'c'].map((id) => ({
  id, name: id, isRegistered: false, addedBy: 'user',
}));
const ids = participants.map((person) => person.id);
const sum = (values: Record<string, number>) => Object.values(values).reduce((total, value) => total + value, 0);
const expense = (amount: number): Expense => ({
  id: 'e', category: 'food', description: 'Dinner', totalAmount: amount,
  paidBy: { a: amount }, splitType: 'even', splitParticipants: ids, manualSplit: {}, createdBy: 'user',
});
const ledgerFor = (amount = 90, spendCaps: SpendCap[] = []) => buildLedger({
  participants, expenses: [expense(amount)], payments: [], spendCaps,
});

describe('ported balance conservation scenarios', () => {
  it('paid purchases equal responsibility and remaining nets to zero', () => {
    const ledger = ledgerFor();
    expect(sum(ledger.paid)).toBe(9000);
    expect(sum(ledger.final)).toBe(9000);
    expect(sum(ledger.remaining)).toBe(0);
  });

  it('reimbursements conserve without becoming purchase spending or responsibility', () => {
    const before = ledgerFor();
    const after = buildLedger({ participants, expenses: [expense(90)], payments: [
      { id: 'p', payerId: 'b', payeeId: 'a', amount: 30, date: '2026-01-01', description: '' },
    ] });
    expect(after.totalSpendingCents).toBe(before.totalSpendingCents);
    expect(after.paid).toEqual(before.paid);
    expect(after.final).toEqual(before.final);
    expect(after.caps).toEqual(before.caps);
    expect(after.remaining).toEqual({ a: -3000, b: 0, c: 3000 });
    expect(sum(after.remaining)).toBe(0);
  });
});

describe('ported F-087 cap conservation scenarios', () => {
  it('has no unallocated costs without caps', () => {
    expect(ledgerFor().caps.unallocatedCents).toBe(0);
  });

  it('redistributes to eligible travelers and conserves every cent', () => {
    const result = applyBudgetCaps(ledgerFor().subtotals, [{ participantId: 'b', maxAmount: 10 }], undefined, ids);
    expect(result.final).toEqual({ a: 4000, b: 1000, c: 4000 });
    expect(sum(result.final)).toBe(9000);
    expect(result.unallocatedCents).toBe(0);
  });

  it('reports the exact shortfall when everyone is capped', () => {
    const ledger = ledgerFor(300, ids.map((participantId) => ({ participantId, maxAmount: 10 })));
    expect(ledger.final).toEqual({ a: 1000, b: 1000, c: 1000 });
    expect(ledger.caps.unallocatedCents).toBe(27000);
    expect(sum(ledger.final) + ledger.unallocatedCents).toBe(30000);
  });
});

describe('ported F-087 settlement safety scenarios', () => {
  it('suggests positive reimbursements only from debtors to creditors, by id', () => {
    const ledger = ledgerFor();
    const result = calculateSettlements(ledger.remaining);
    expect(result.paused).toBeNull();
    expect(result.settlements).toHaveLength(2);
    for (const suggestion of result.settlements) {
      expect(suggestion.cents).toBe(3000);
      expect(ledger.remaining[suggestion.from]).toBeGreaterThan(0);
      expect(ledger.remaining[suggestion.to]).toBeLessThan(0);
      expect(suggestion.to).toBe('a');
    }
  });

  it('refuses non-conserving balances', () => {
    expect(calculateSettlements({ a: -5000, b: -2000 })).toEqual({ settlements: [], paused: 'non-conserving' });
  });

  it('never suggests that a creditor pay another creditor, including all-zero balances', () => {
    expect(calculateSettlements({ a: 0, b: 0, c: 0 })).toEqual({ settlements: [], paused: null });
  });

  it('refuses even a two-cent cap shortfall after exact rounding', () => {
    const ledger = ledgerFor(30.02, ids.map((participantId) => ({ participantId, maxAmount: 10 })));
    expect(ledger.subtotals).toEqual({ a: 1001, b: 1001, c: 1000 });
    expect(ledger.caps.unallocatedCents).toBe(2);
    expect(ledger.settlement).toEqual({ settlements: [], paused: 'unallocated' });
  });
});
