import { describe, expect, it } from 'vitest';
import { buildLedger } from '../ledger';
import { balanceChips, buildLedgerRows, capBadge, explicitZeroLabel, payerSummary, splitMethodLabel } from '../ledgerView';
import type { Expense, TripParticipant } from '../../pageTypes';
import { OHIO, traveler } from './fixtures/ohio';

const participants: TripParticipant[] = [
  traveler('a', 'Avery'),
  traveler('b', 'Blair'),
  traveler('c', 'Casey'),
];

const evenExpense = (
  id: string,
  totalAmount: number,
  paidBy: Record<string, number>,
  splitParticipants = participants.map((person) => person.id),
): Expense => ({
  id,
  category: 'Food',
  description: id,
  totalAmount,
  paidBy,
  splitType: 'even',
  splitParticipants,
  manualSplit: {},
  createdBy: 'admin',
});

describe('ledger view model balance labels', () => {
  it('labels a positive remaining balance as Owes', () => {
    const ledger = buildLedger({
      participants,
      expenses: [evenExpense('shared', 90, { a: 90 })],
      payments: [],
    });

    expect(balanceChips(ledger, participants).find((chip) => chip.travelerId === 'b')?.label)
      .toBe('Blair · Owes $30.00');
  });

  it('labels a negative remaining balance as Is owed', () => {
    const ledger = buildLedger({
      participants,
      expenses: [evenExpense('shared', 90, { a: 90 })],
      payments: [],
    });

    expect(balanceChips(ledger, participants).find((chip) => chip.travelerId === 'a')?.label)
      .toBe('Avery · Is owed $60.00');
  });

  it('shows Settled for an active traveler at zero beside people who owe and are owed', () => {
    const ledger = buildLedger({
      participants,
      expenses: [evenExpense('shared', 90, { a: 30, b: 60 })],
      payments: [],
    });
    const chips = balanceChips(ledger, participants);

    expect(chips.find((chip) => chip.travelerId === 'a')?.label).toBe('Avery · Settled');
    expect(chips.find((chip) => chip.travelerId === 'b')?.label).toBe('Blair · Is owed $30.00');
    expect(chips.find((chip) => chip.travelerId === 'c')?.label).toBe('Casey · Owes $30.00');
  });
});

describe('ledger view model expense cells and payers', () => {
  it('renders excluded cells as a dash and explicit zero as $0.00', () => {
    expect(explicitZeroLabel(null)).toBe('—');
    expect(explicitZeroLabel(0)).toBe('$0.00');
  });

  it('summarizes one payer by name', () => {
    expect(payerSummary({ a: 25 }, participants)).toBe('Paid by Avery');
  });

  it('summarizes several payers with the remaining payer count', () => {
    expect(payerSummary({ a: 25, b: 25, c: 50 }, participants)).toBe('Paid by Avery + 2');
  });

  it('reports when no payer is recorded', () => {
    expect(payerSummary({}, participants)).toBe('No payer recorded');
  });

  it('names a removed payer as an unknown traveler', () => {
    expect(payerSummary({ removed: 50 }, participants)).toBe('Paid by Unknown traveler');
  });

  it('labels mixed legacy dollar and percentage splits', () => {
    expect(splitMethodLabel({ splitType: 'manual', manualSplit: { a: { type: 'amount', value: 1 }, b: { type: 'percent', value: 50 } } }))
      .toBe('Mixed custom split ($ and %)');
    expect(splitMethodLabel({ splitType: 'manual', manualSplit: { a: { type: 'amount', value: 1 } } })).toBe('Custom dollar split');
    expect(splitMethodLabel({ splitType: 'manual', manualSplit: { a: { type: 'percent', value: 100 } } })).toBe('Custom percentage split');
    expect(splitMethodLabel({ splitType: 'even', manualSplit: {} })).toBe('Equal split');
  });
});

describe('ledger view model caps and summary rows', () => {
  it('shows cap amount and non-zero room left against final responsibility', () => {
    const ledger = buildLedger(OHIO);

    expect(capBadge(ledger, 'kaitlyn')).toBe('cap $500 · $172.20 left');
  });

  it('returns no cap badge when that traveler has no cap', () => {
    const ledger = buildLedger({
      participants,
      expenses: [evenExpense('shared', 90, { a: 90 })],
      payments: [],
    });

    expect(capBadge(ledger, 'a')).toBeNull();
  });

  it('labels multiple cap absorbers and keeps signed cells and total net at zero', () => {
    const cappedParticipants = participants;
    const cappedExpense: Expense = {
      ...evenExpense('shared', 100, { a: 100 }),
      splitType: 'manual',
      manualSplit: {
        a: { type: 'amount', value: 50 },
        b: { type: 'amount', value: 25 },
        c: { type: 'amount', value: 25 },
      },
    };
    const ledger = buildLedger({
      participants: cappedParticipants,
      expenses: [cappedExpense],
      payments: [],
      spendCaps: [{ participantId: 'a', maxAmount: 0 }],
    });
    const adjustment = buildLedgerRows(ledger, cappedParticipants)
      .find((row) => row.type === 'adjustment');

    expect(adjustment).toMatchObject({
      label: "Avery's cap ($0): $50 covered by Blair $25, Casey $25",
      totalCents: 0,
      cells: { a: -5000, b: 2500, c: 2500 },
    });
    if (adjustment?.type === 'adjustment') {
      expect(Object.values(adjustment.cells).reduce((sum, cents) => sum + cents, 0)).toBe(0);
    }
  });

  it('adds uncovered row only for infeasible caps with total amount and null traveler cells', () => {
    const single = [traveler('a', 'Avery')];
    const expenseRow = evenExpense('shared', 100, { a: 100 }, ['a']);
    const infeasibleLedger = buildLedger({
      participants: single,
      expenses: [expenseRow],
      payments: [],
      spendCaps: [{ participantId: 'a', maxAmount: 10 }],
    });
    const infeasibleRows = buildLedgerRows(infeasibleLedger, single);
    const uncovered = infeasibleRows.find((row) => row.type === 'uncovered');

    expect(uncovered).toMatchObject({
      label: 'Not covered by anyone',
      totalCents: 9000,
      cells: { a: null },
    });

    const feasibleLedger = buildLedger({ participants: single, expenses: [expenseRow], payments: [] });
    expect(buildLedgerRows(feasibleLedger, single).some((row) => row.type === 'uncovered')).toBe(false);
  });

  it('shows unassigned data problems independently from cap uncovered costs', () => {
    const single = [traveler('a', 'Avery')];
    const emptySplit = evenExpense('empty', 100, { a: 100 }, []);
    const ledger = buildLedger({ participants: single, expenses: [emptySplit], payments: [] });
    const rows = buildLedgerRows(ledger, single);
    expect(rows.find((row) => row.type === 'unassigned')).toMatchObject({
      label: 'Unassigned (data problem)', totalCents: 10000, cells: { a: null },
    });
    expect(rows.some((row) => row.type === 'uncovered')).toBe(false);
  });

  it('sets final row cells to ledger.final and total to spending minus unallocated cost', () => {
    const ledger = buildLedger(OHIO);
    const final = buildLedgerRows(ledger, OHIO.participants)
      .find((row) => row.type === 'final');

    expect(final?.cells).toEqual(ledger.final);
    expect(final?.totalCents).toBe(Object.values(ledger.final).reduce((sum, cents) => sum + cents, 0));
  });

  it('preserves the Ohio Ren Faire final figures and category order', () => {
    const ledger = buildLedger(OHIO);
    const rows = buildLedgerRows(ledger, OHIO.participants);
    const final = rows.find((row) => row.type === 'final');

    expect(final?.cells).toMatchObject({
      kaitlyn: 32780,
      loretta: 49978,
      jackie: 49978,
      claudia: 49978,
      jimi: 59977,
    });
    expect(rows.filter((row) => row.type === 'category').map((row) => row.category)).toEqual([
      'Accommodation',
      'Transportation',
      'Activities',
      'Food',
    ]);
  });

  it('uses positive recorded payer ids even when the payer is no longer a traveler', () => {
    const expense = evenExpense('legacy', 50, { removed: 50 });
    const ledger = buildLedger({ participants, expenses: [expense], payments: [] });
    const row = buildLedgerRows(ledger, participants, [expense]).find((item) => item.type === 'expense');
    expect(row?.type === 'expense' && row.payers).toBe('Paid by Unknown traveler');
  });
});
