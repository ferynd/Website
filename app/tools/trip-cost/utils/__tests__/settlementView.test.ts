import { describe, expect, it } from 'vitest';
import type { Expense, Payment, TripParticipant, UserProfile } from '../../pageTypes';
import { buildLedger } from '../ledger';
import { balanceChips } from '../ledgerView';
import { UNKNOWN_TRAVELER } from '../ledgerLabels';
import { validatePayment } from '../payment';
import { fromCents } from '../money';
import { balanceBreakdownRows, paymentDraft, paymentHistoryRows, paymentOverpayWarnings, paymentPermission } from '../settlementView';

const participants: TripParticipant[] = [
  { id: 'kait', name: 'Kait', userId: 'user', isRegistered: true, addedBy: 'admin' },
  { id: 'james', name: 'James', userId: 'admin', isRegistered: true, addedBy: 'admin' },
  { id: 'bob', name: 'Bob', isRegistered: false, addedBy: 'admin' },
];
const user: UserProfile = { uid: 'user', email: '', displayName: 'Kait', firstName: 'Kait', lastInitial: '', isAdmin: false };
const admin: UserProfile = { ...user, uid: 'admin', isAdmin: true };
const expense: Expense = {
  id: 'e', category: 'Food', description: 'Dinner', totalAmount: 600,
  paidBy: { james: 600 }, splitType: 'even', splitParticipants: ['kait', 'james', 'bob'], manualSplit: {}, createdBy: 'admin',
};
const ledger = buildLedger({ participants, expenses: [expense], payments: [] });
const payment = (id: string, date: string): Payment => ({
  id, date, payerId: 'kait', payeeId: 'james', amount: 200, description: 'Venmo', createdBy: 'user',
});

describe('settlement balance breakdown', () => {
  it('uses ledger order and separate responsibility, purchases, and reimbursements', () => {
    const rows = balanceBreakdownRows(ledger);
    expect(rows.map((row) => row.label)).toEqual([
      'Final responsibility', 'Paid for purchases', 'Reimbursements sent', 'Reimbursements received', 'Remaining',
    ]);
    expect(rows[0].cells.map((cell) => cell.travelerId)).toEqual(ledger.travelerIds);
    expect(rows[0].cells.map((cell) => cell.label)).toEqual(['$200.00', '$200.00', '$200.00']);
    expect(rows[1].cells.map((cell) => cell.label)).toEqual(['$0.00', '$600.00', '$0.00']);
    expect(rows[4].cells.map((cell) => cell.label)).toEqual(['Owes $200.00', 'Is owed $400.00', 'Owes $200.00']);
  });

  it('matches header status copy for Owes, Is owed, and Settled', () => {
    const after = buildLedger({ participants, expenses: [expense], payments: [payment('p', '2026-10-21')] });
    const remaining = balanceBreakdownRows(after)[4].cells;
    expect(remaining.map((cell) => cell.label)).toEqual(['Settled', 'Is owed $200.00', 'Owes $200.00']);
    expect(balanceChips(after, participants).map((chip) => chip.label)).toEqual(
      participants.map((person, index) => `${person.name} · ${remaining[index].label}`),
    );
  });
});

describe('D4 payment permission', () => {
  it('allows an admin to record any pair, including without a linked traveler', () => {
    expect(paymentPermission({ ...admin, uid: 'unlinked' }, participants, { payerId: 'kait', payeeId: 'bob' }).allowed).toBe(true);
  });

  it.each([
    { payerId: 'kait', payeeId: 'james' },
    { payerId: 'james', payeeId: 'kait' },
  ])('allows the uniquely linked payer or payee: %j', (pair) => {
    expect(paymentPermission(user, participants, pair)).toEqual({ allowed: true, reason: '' });
  });

  it('blocks another pair with an explanation, while allowing the general entry point', () => {
    expect(paymentPermission(user, participants).allowed).toBe(true);
    expect(paymentPermission(user, participants, { payerId: 'bob', payeeId: 'james' })).toEqual({
      allowed: false, reason: 'You can record payments you sent or received.',
    });
  });

  it('blocks an unlinked member even if they added a traveler, and blocks duplicate links', () => {
    expect(paymentPermission({ ...user, uid: 'unlinked' }, participants).allowed).toBe(false);
    expect(paymentPermission(user, [...participants, { ...participants[0], id: 'duplicate' }]).allowed).toBe(false);
    expect(paymentPermission(null, participants).allowed).toBe(false);
  });
});

describe('payment dialog prefill and overpay advice', () => {
  it('prefills a suggestion by id with exact cents and a blank note', () => {
    expect(paymentDraft(participants, user, { from: 'bob', to: 'james', cents: 12345 })).toEqual({
      payerId: 'bob', payeeId: 'james', amount: '123.45', note: '',
    });
  });

  it('defaults From only to a unique account link; To and amount remain empty', () => {
    expect(paymentDraft(participants, user)).toEqual({ payerId: 'kait', payeeId: '', amount: '', note: '' });
    expect(paymentDraft(participants, { ...admin, uid: 'unlinked' }).payerId).toBe('');
    expect(paymentDraft([...participants, { ...participants[0], id: 'duplicate' }], user).payerId).toBe('');
  });

  it('warns above either side of the balance, using cents without blocking validation', () => {
    expect(paymentOverpayWarnings('kait', 'james', 25000, ledger.remaining, participants)).toEqual([
      'Kait owes $200.00; this records $250.00.',
    ]);
    expect(validatePayment({ payerId: 'kait', payeeId: 'james', amount: '250' }, ledger.travelerIds).errors).toEqual([]);
    expect(paymentOverpayWarnings('bob', 'james', 15001, { bob: 20000, james: -15000 }, participants)).toEqual([
      'James is owed $150.00; this records $150.01.',
    ]);
  });

  it('does not warn at or below balances, but warns when paying in the opposite direction', () => {
    expect(paymentOverpayWarnings('kait', 'james', 20000, ledger.remaining, participants)).toEqual([]);
    expect(paymentOverpayWarnings('james', 'kait', 1, ledger.remaining, participants)).toEqual([
      'James owes $0.00; this records $0.01.',
      'Kait is owed $0.00; this records $0.01.',
    ]);
  });

  it('recording a validated suggestion changes only reimbursement totals and remaining', () => {
    const spendCaps = [{ participantId: 'kait', maxAmount: 100 }];
    const before = buildLedger({ participants, expenses: [expense], payments: [], spendCaps });
    expect(before.caps.transfers.length).toBeGreaterThan(0);
    const initial = paymentDraft(participants, user, before.settlement.settlements[0]);
    const result = validatePayment(initial, before.travelerIds);
    expect(result.cents).not.toBeNull();
    const after = buildLedger({ participants, expenses: [expense], spendCaps, payments: [{
      ...payment('p', '2026-10-22'), payerId: initial.payerId, payeeId: initial.payeeId, amount: fromCents(result.cents!),
    }] });
    expect(after.totalSpendingCents).toBe(before.totalSpendingCents);
    expect(after.subtotals).toEqual(before.subtotals);
    expect(after.final).toEqual(before.final);
    expect(after.caps).toEqual(before.caps);
    expect(after.paid).toEqual(before.paid);
    expect(after.reimbursementsSent[initial.payerId]).toBe(result.cents);
    expect(after.reimbursementsReceived[initial.payeeId]).toBe(result.cents);
    expect(after.remaining[initial.payerId]).toBe(0);
  });
});

describe('payment history', () => {
  it.each([
    { amount: -1 },
    { amount: 0 },
    { amount: NaN },
    { payerId: 'removed' },
    { payeeId: 'removed' },
    { payeeId: 'kait' },
  ])('marks payments ignored by the ledger as not counted: %j', (invalid) => {
    const stored = { ...payment('invalid', '2026-10-22'), ...invalid };
    const after = buildLedger({ participants, expenses: [expense], payments: [stored] });
    expect(after.remaining).toEqual(ledger.remaining);
    expect(paymentHistoryRows([stored], participants, user.uid, after.travelerIds)[0].status).toBe('Not counted (invalid)');
  });

  it('uses the supplied ledger traveler ids and leaves counted payments unmarked', () => {
    const stored = payment('valid', '2026-10-22');
    expect(paymentHistoryRows([stored], participants, user.uid, ledger.travelerIds)[0].status).toBeNull();
    expect(paymentHistoryRows([stored], participants, user.uid, ['kait'])[0].status).toBe('Not counted (invalid)');
  });

  it('sorts newest first without mutating stored order; equal dates stay stable', () => {
    const payments = [payment('old', '2026-10-20T12:00:00Z'), payment('new', '2026-10-22T01:00:00Z'), payment('tie', '2026-10-22T01:00:00Z')];
    expect(paymentHistoryRows(payments, participants).map((row) => row.id)).toEqual(['new', 'tie', 'old']);
    expect(payments.map((row) => row.id)).toEqual(['old', 'new', 'tie']);
  });

  it('keeps unknown participants, notes, and recorder information visible', () => {
    const rows = paymentHistoryRows([{ ...payment('p', 'bad-date'), payerId: 'removed', createdBy: 'former-account' }], participants);
    expect(rows[0]).toMatchObject({ from: UNKNOWN_TRAVELER, to: 'James', amount: '$200.00', note: 'Venmo', recordedBy: null, date: 'Unknown date' });
    expect(paymentHistoryRows([payment('p', '2026-10-22')], participants)[0].recordedBy).toBe('Kait');
    expect(paymentHistoryRows([{ ...payment('p', '2026-10-22'), createdBy: undefined }], participants)[0].recordedBy).toBeNull();
    expect(paymentHistoryRows([{ ...payment('p', '2026-10-22'), createdBy: 'admin-uid' }], participants, 'admin-uid')[0].recordedBy).toBe('you');
  });
});
