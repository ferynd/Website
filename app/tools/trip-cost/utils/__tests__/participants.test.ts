import { describe, expect, it } from 'vitest';
import {
  linkParticipantAccount,
  participantForAccount,
  participantIdsFor,
  participantRemovalBlockers,
  participantRemovalMessage,
} from '../participants';
import type { Expense, Payment, TripParticipant } from '../../pageTypes';

const traveler = (id: string, userId?: string): TripParticipant => ({
  id,
  name: `Name ${id}`,
  isRegistered: !!userId,
  addedBy: 'admin',
  ...(userId && { userId }),
});

describe('participantIdsFor', () => {
  it('uses the linked uid, or the participant id when unlinked, in trip order', () => {
    expect(participantIdsFor([traveler('p1', 'uid-1'), traveler('p2'), traveler('p3', 'uid-3')])).toEqual([
      'uid-1',
      'p2',
      'uid-3',
    ]);
  });

  it('drops duplicates', () => {
    expect(participantIdsFor([traveler('p1', 'uid-1'), traveler('p2', 'uid-1')])).toEqual(['uid-1']);
  });
});

describe('participantForAccount', () => {
  it('finds the traveler linked to a uid', () => {
    const people = [traveler('p1'), traveler('p2', 'uid-2')];
    expect(participantForAccount(people, 'uid-2')?.id).toBe('p2');
    expect(participantForAccount(people, 'uid-9')).toBeUndefined();
    expect(participantForAccount(people, undefined)).toBeUndefined();
  });
});

describe('linkParticipantAccount (D3)', () => {
  const people = [traveler('kait'), traveler('james', 'uid-james'), traveler('bob')];

  it('keeps the participant id and name and creates no duplicate', () => {
    const result = linkParticipantAccount(people, 'kait', 'uid-kait');
    if (!result.ok) throw new Error(result.message);
    expect(result.participants).toHaveLength(3);
    expect(result.participants[0]).toEqual({
      id: 'kait',
      name: 'Name kait',
      isRegistered: true,
      addedBy: 'admin',
      userId: 'uid-kait',
    });
    expect(result.participants.map((p) => p.id)).toEqual(['kait', 'james', 'bob']);
    // The input is not mutated.
    expect(people[0].userId).toBeUndefined();
  });

  it('recomputes participantIds so the account gains member access', () => {
    const result = linkParticipantAccount(people, 'kait', 'uid-kait');
    if (!result.ok) throw new Error(result.message);
    expect(result.participantIds).toEqual(['uid-kait', 'uid-james', 'bob']);
  });

  it('refuses a uid already linked to another traveler on the trip', () => {
    const result = linkParticipantAccount(people, 'kait', 'uid-james');
    expect(result).toMatchObject({ ok: false, code: 'uid-linked-elsewhere' });
  });

  it('refuses to re-link a traveler already linked to a different account', () => {
    expect(linkParticipantAccount(people, 'james', 'uid-other')).toMatchObject({ ok: false, code: 'already-linked' });
  });

  it('is a no-op when the traveler is already linked to that account', () => {
    const result = linkParticipantAccount(people, 'james', 'uid-james');
    if (!result.ok) throw new Error(result.message);
    expect(result.participants).toEqual(people);
  });

  it('rejects an unknown traveler or a blank uid', () => {
    expect(linkParticipantAccount(people, 'ghost', 'uid-x')).toMatchObject({ ok: false, code: 'participant-unknown' });
    expect(linkParticipantAccount(people, 'kait', '')).toMatchObject({ ok: false, code: 'uid-required' });
  });
});

const expense = (fields: Partial<Expense> & Pick<Expense, 'id'>): Expense => ({
  category: 'Food',
  description: fields.id,
  totalAmount: 0,
  paidBy: {},
  splitType: 'even',
  splitParticipants: [],
  manualSplit: {},
  createdBy: 'admin',
  ...fields,
});

const payment = (fields: Partial<Payment> & Pick<Payment, 'id' | 'payerId' | 'payeeId'>): Payment => ({
  amount: 1,
  date: '2026-10-22',
  description: '',
  ...fields,
});

describe('participant removal blockers', () => {
  const participants = [traveler('a'), traveler('b')];

  it('lists expense descriptions and payment pairs, including zero amounts', () => {
    const blockers = participantRemovalBlockers({
      participants,
      expenses: [
        expense({ id: 'dinner', description: 'Dinner', paidBy: { a: 0 } }),
        expense({ id: 'park', description: 'Park', splitParticipants: ['b'] }),
        expense({ id: 'tip', description: 'Tip', manualSplit: { a: { type: 'amount', value: 0 } } }),
      ],
      payments: [payment({ id: 'p1', payerId: 'b', payeeId: 'a', description: 'Venmo' })],
    }, 'a');
    expect(blockers).toEqual([
      'Expense: Dinner',
      'Expense: Tip',
      'Payment: Name b to Name a (Venmo)',
    ]);
    expect(participantRemovalMessage(blockers)).toBe(
      'Remove or reassign these records first: Expense: Dinner; Expense: Tip; Payment: Name b to Name a (Venmo).',
    );
  });

  it('truncates long labels and stops the message after five records', () => {
    const description = 'A'.repeat(120);
    const expenses = [0, 1, 2, 3, 4, 5].map((index) =>
      expense({ id: `e${index}`, description: index === 0 ? description : `Item ${index}`, paidBy: { a: 1 } }),
    );
    const blockers = participantRemovalBlockers({ participants, expenses, payments: [] }, 'a');
    expect(blockers[0]).toBe(`Expense: ${'A'.repeat(97)}…`);
    expect(participantRemovalMessage(blockers)).toBe(
      `Remove or reassign these records first: ${blockers.slice(0, 5).join('; ')}; and 1 more records.`,
    );
  });
  it('tolerates legacy expenses that omit paidBy, splitParticipants, or manualSplit', () => {
    const legacy = {
      ...expense({ id: 'legacy', description: 'Old dinner' }),
      paidBy: undefined,
      splitParticipants: undefined,
      manualSplit: undefined,
    } as unknown as Expense;
    const referencing = {
      ...expense({ id: 'ref', description: 'Taxi' }),
      paidBy: undefined,
      manualSplit: undefined,
      splitParticipants: ['a'],
    } as unknown as Expense;
    expect(() => participantRemovalBlockers({ participants, expenses: [legacy], payments: [] }, 'a')).not.toThrow();
    expect(participantRemovalBlockers({ participants, expenses: [legacy, referencing], payments: [] }, 'a')).toEqual([
      'Expense: Taxi',
    ]);
  });
});
