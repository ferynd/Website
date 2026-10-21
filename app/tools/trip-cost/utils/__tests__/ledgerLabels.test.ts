import { describe, expect, it } from 'vitest';
import { applyBudgetCaps, buildLedger } from '../ledger';
import {
  balanceStatus,
  capAdjustmentLabel,
  capAdjustmentRows,
  describeProblem,
  makeNameOf,
  settlementPausedMessage,
} from '../ledgerLabels';
import type { TripParticipant } from '../../pageTypes';

const people: TripParticipant[] = ['Kait', 'James', 'Bob', 'Zoe'].map((name) => ({
  id: name.toLowerCase(),
  name,
  isRegistered: false,
  addedBy: 'admin',
}));
const nameOf = makeNameOf(people);
const order = people.map((p) => p.id);

describe('capAdjustmentLabel', () => {
  it('names a single absorber without repeating the amount', () => {
    expect(capAdjustmentLabel({ name: 'Kait', capCents: 20000, absorbers: [{ name: 'James', cents: 10000 }] })).toBe(
      "Kait's cap ($200): $100 covered by James",
    );
  });

  it('lists several absorbers with their amounts', () => {
    expect(
      capAdjustmentLabel({
        name: 'Kait',
        capCents: 20000,
        absorbers: [
          { name: 'James', cents: 5000 },
          { name: 'Bob', cents: 5000 },
        ],
      }),
    ).toBe("Kait's cap ($200): $100 covered by James $50, Bob $50");
  });

  it('calls out the part nobody covers', () => {
    expect(
      capAdjustmentLabel({ name: 'Kait', capCents: 20000, absorbers: [{ name: 'James', cents: 8050 }], uncoveredCents: 1950 }),
    ).toBe("Kait's cap ($200): $80.50 covered by James; $19.50 not covered by anyone");
    expect(capAdjustmentLabel({ name: 'Kait', capCents: 20000, absorbers: [], uncoveredCents: 10000 })).toBe(
      "Kait's cap ($200): $100 not covered by anyone",
    );
  });
});

describe('capAdjustmentRows', () => {
  it('builds one labelled row per reduced traveler with signed cells (C1 example)', () => {
    const caps = applyBudgetCaps({ kait: 30000, james: 30000, bob: 30000 }, [{ participantId: 'kait', maxAmount: 200 }], undefined, [
      'kait',
      'james',
      'bob',
    ]);
    expect(capAdjustmentRows(caps, nameOf)).toEqual([
      {
        travelerId: 'kait',
        label: "Kait's cap ($200): $100 covered by James $50, Bob $50",
        deltas: { kait: -10000, james: 5000, bob: 5000 },
        uncoveredCents: 0,
      },
    ]);
  });

  it('labels cascading caps without showing a pass-through absorber as reduced', () => {
    // Kait over by $300 → James, Bob, Zoe +$100; James (cap $350) is pushed $50 over → Bob, Zoe +$25.
    const caps = applyBudgetCaps(
      { kait: 60000, james: 30000, bob: 10000, zoe: 10000 },
      [
        { participantId: 'kait', maxAmount: 300 },
        { participantId: 'james', maxAmount: 350 },
      ],
      { type: 'even' },
      order,
    );
    const rows = capAdjustmentRows(caps, nameOf);
    expect(rows.map((r) => r.label)).toEqual(["Kait's cap ($300): $300 covered by James $50, Bob $125, Zoe $125"]);
    for (const row of rows) {
      expect(Object.values(row.deltas).reduce((s, n) => s + n, 0) + row.uncoveredCents).toBe(0);
    }
  });

  it('labels infeasible caps with the uncovered remainder', () => {
    const caps = applyBudgetCaps(
      { kait: 30000, james: 30000 },
      [
        { participantId: 'kait', maxAmount: 200 },
        { participantId: 'james', maxAmount: 300 },
      ],
      undefined,
      ['kait', 'james'],
    );
    expect(capAdjustmentRows(caps, nameOf).map((r) => r.label)).toEqual(["Kait's cap ($200): $100 not covered by anyone"]);
  });
});

describe('balanceStatus', () => {
  it('uses Owes / Is owed / Settled copy, never only a sign', () => {
    expect(balanceStatus(20000)).toEqual({ kind: 'owes', label: 'Owes $200.00' });
    expect(balanceStatus(-35000)).toEqual({ kind: 'is-owed', label: 'Is owed $350.00' });
    expect(balanceStatus(0)).toEqual({ kind: 'settled', label: 'Settled' });
  });
});

describe('describeProblem / settlementPausedMessage', () => {
  it('describes data problems in plain language with names and amounts', () => {
    const ledger = buildLedger({
      participants: people.slice(0, 2),
      expenses: [
        {
          id: 'e1',
          category: 'Food',
          description: 'Dinner',
          totalAmount: 90,
          paidBy: { kait: 90 },
          splitType: 'even',
          splitParticipants: ['kait', 'james', 'gone'],
          manualSplit: {},
          createdBy: 'admin',
        },
      ],
      payments: [],
    });
    expect(ledger.problems.map((p) => describeProblem(p, ledger, nameOf))).toEqual([
      '"Dinner": $30.00 is assigned to someone who is no longer on the trip.',
    ]);
    expect(settlementPausedMessage('unallocated', ledger.unallocatedCents)).toBe(
      '$30.00 of costs is not assigned to anyone. Settlement suggestions are paused until the problems above are fixed.',
    );
  });

  it('falls back to a placeholder for unknown travelers', () => {
    expect(nameOf('ghost')).toBe('Unknown traveler');
  });
});
