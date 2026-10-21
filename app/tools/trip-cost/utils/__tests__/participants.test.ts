import { describe, expect, it } from 'vitest';
import { linkParticipantAccount, participantForAccount, participantIdsFor } from '../participants';
import type { TripParticipant } from '../../pageTypes';

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
