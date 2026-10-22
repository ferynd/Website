import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Expense, TripParticipant } from '../../pageTypes';
import { buildLedger } from '../ledger';

const { useTrip } = vi.hoisted(() => ({ useTrip: vi.fn() }));
vi.mock('../../TripContext', () => ({ useTrip }));

import LedgerTable from '../../components/TripDetail/LedgerTable';

const participant: TripParticipant = {
  id: 'traveler',
  name: 'Traveler',
  isRegistered: false,
  addedBy: 'admin',
};
const expense: Expense = {
  id: 'expense',
  category: 'Food',
  description: 'Dinner',
  totalAmount: 1095.75,
  paidBy: { traveler: 1095.75 },
  splitType: 'even',
  splitParticipants: ['traveler'],
  manualSplit: {},
  createdBy: 'admin',
};

describe('ledger table mobile layout', () => {
  it('keeps sticky cells opaque, gives totals room, and has no overlay gradient', () => {
    const participants = [participant];
    const expenses = [expense];
    useTrip.mockReturnValue({
      participants,
      expenses,
      ledger: buildLedger({ participants, expenses, payments: [] }),
    });

    const html = renderToStaticMarkup(
      <LedgerTable onExpense={vi.fn()} onTraveler={vi.fn()} />,
    );

    expect(html).toMatch(/sticky left-0[^\"]*border-r border-border[^\"]*bg-surface-1/);
    expect(html).toContain('sticky left-0 z-10 w-[9.5rem] min-w-[9.5rem] border-r border-border bg-surface-2');
    expect(html).toContain('min-w-[7rem] whitespace-nowrap bg-surface-1 px-3 py-3 text-right');
    expect(html).toContain('min-w-[7rem] whitespace-nowrap px-3 py-2 text-right');
    expect(html).not.toContain('bg-gradient-to-l');
  });
});
