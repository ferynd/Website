import { describe, expect, it } from 'vitest';
import { uniqueLinkedParticipant } from '../payer';
import type { TripParticipant } from '../../pageTypes';

const participant = (id: string, userId?: string): TripParticipant => ({
  id, userId, name: id, isRegistered: !!userId, addedBy: 'caller',
});

describe('blank payer fallback (shared by add and edit expense)', () => {
  it('requires explicit selection with zero matching links', () => {
    expect(uniqueLinkedParticipant([participant('manual'), participant('other', 'other')], 'caller')).toBeUndefined();
  });
  it('selects the single linked record, ignoring manually added participants', () => {
    const linked = participant('linked', 'caller');
    expect(uniqueLinkedParticipant([participant('manual'), linked], 'caller')).toBe(linked);
  });
  it('requires explicit selection with multiple matching links, in either order', () => {
    const duplicates = [participant('one', 'caller'), participant('two', 'caller')];
    expect(uniqueLinkedParticipant(duplicates, 'caller')).toBeUndefined();
    expect(uniqueLinkedParticipant(duplicates.reverse(), 'caller')).toBeUndefined();
  });
  it('never mistakes unlinked records for a missing authenticated UID', () => {
    expect(uniqueLinkedParticipant([participant('manual')], undefined)).toBeUndefined();
  });
});
