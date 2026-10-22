import type { Expense, TripParticipant } from '../../../pageTypes';
import type { LedgerInput } from '../../ledger';

/** Build a participant used in the Ohio Ren Faire golden record. */
const traveler = (id: string, name = id): TripParticipant => ({
  id,
  name,
  isRegistered: false,
  addedBy: 'admin',
});

/** Build an expense with defaults for the shared Ohio golden record. */
const expense = (
  fields: Partial<Expense> & Pick<Expense, 'id' | 'totalAmount' | 'paidBy' | 'splitParticipants'>,
): Expense => ({
  category: 'Other',
  description: fields.id,
  splitType: 'even',
  manualSplit: {},
  createdBy: 'admin',
  ...fields,
});

/* ------------------------------------------------------------------ */
/*  Golden: 2026 - Ohio Ren Faire                                      */
/* ------------------------------------------------------------------ */

/**
 * Reconstructed from the Oct 21, 2026 baseline screenshots (desktop-02/03/05/06/07):
 * 4 expenses, 0 payments, $500 caps on everyone but Jimi, overage split evenly.
 * The source trip document is not in the repo; ids are placeholders and the
 * participant order matches the screenshots. No cap binds (Loretta, Jackie and
 * Claudia are $0.22 under), and every split divides evenly to the cent, so the
 * cents-exact ledger reproduces the currently displayed figures with no 1¢ drift.
 */
/** Shared exact Ohio Ren Faire ledger fixture from the calculation tests. */
const OHIO: LedgerInput = {
  participants: [
    traveler('kaitlyn', 'Kaitlyn K'),
    traveler('loretta', 'Loretta I'),
    traveler('jackie', 'Jackie N'),
    traveler('claudia', 'Claudia V'),
    traveler('jimi', 'Jimi'),
  ],
  expenses: [
    expense({
      id: 'airbnb',
      category: 'Accommodation',
      description: 'Airbnb',
      totalAmount: 695.75,
      paidBy: { jimi: 695.75 },
      splitParticipants: ['kaitlyn', 'loretta', 'jackie', 'claudia', 'jimi'],
    }),
    expense({
      id: 'car',
      category: 'Transportation',
      description: 'Car rental',
      totalAmount: 687.92,
      paidBy: { jimi: 687.92 },
      splitParticipants: ['loretta', 'jackie', 'claudia', 'jimi'],
    }),
    expense({
      id: 'tickets',
      category: 'Activities',
      description: 'Event and activity tickets',
      totalAmount: 658,
      paidBy: { jackie: 658 },
      splitParticipants: ['kaitlyn', 'loretta', 'jackie', 'claudia', 'jimi'],
    }),
    expense({
      id: 'food',
      category: 'Food',
      description: 'Food and drinks (Jimi covering extra 100 of booze bottles)',
      totalAmount: 385.24,
      paidBy: { jimi: 385.24 },
      splitType: 'manual',
      splitParticipants: ['kaitlyn', 'loretta', 'jackie', 'claudia', 'jimi'],
      manualSplit: {
        kaitlyn: { type: 'amount', value: 57.05 },
        loretta: { type: 'amount', value: 57.05 },
        jackie: { type: 'amount', value: 57.05 },
        claudia: { type: 'amount', value: 57.05 },
        jimi: { type: 'amount', value: 157.04 },
      },
    }),
  ],
  payments: [],
  spendCaps: ['kaitlyn', 'loretta', 'jackie', 'claudia'].map((participantId) => ({ participantId, maxAmount: 500 })),
  overageSplit: { type: 'even' },
};

export { OHIO, expense, traveler };
