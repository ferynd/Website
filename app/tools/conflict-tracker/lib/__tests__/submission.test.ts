import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { bothSubmitted, selfHealPatch } from '../submission';

const T = new Timestamp(1_700_000_000, 123_456_789);
const own = (over: Record<string, unknown> = {}) => ({
  id: 'personA', person: 'personA', conflictId: 'c1', authorUid: 'a-uid', submittedAt: T, ...over,
});

describe('selfHealPatch (historical submission mirror repair)', () => {
  it('returns the exact own-side mirror and draft flag when the mirror is missing or null', () => {
    for (const conflict of [{}, { personASubmittedAt: null }]) {
      const patch = selfHealPatch('personA', 'a-uid', 'c1', conflict, own());
      expect(patch).toEqual({ personASubmittedAt: T, hasReflectionA: true });
      expect((patch!.personASubmittedAt as Timestamp).isEqual(T)).toBe(true);
    }
    expect(selfHealPatch('personB', 'b-uid', 'c1', {},
      own({ id: 'personB', person: 'personB', authorUid: 'b-uid' }))).toEqual({ personBSubmittedAt: T, hasReflectionB: true });
  });
  it('never touches the partner side or carries content', () => {
    const patch = selfHealPatch('personA', 'a-uid', 'c1', {}, own({ whatHappened: 'private' }))!;
    expect(Object.keys(patch).sort()).toEqual(['hasReflectionA', 'personASubmittedAt']);
  });
  it('is idempotent: no patch once the mirror is set (even to a different value)', () => {
    expect(selfHealPatch('personA', 'a-uid', 'c1', { personASubmittedAt: T }, own())).toBeNull();
    expect(selfHealPatch('personA', 'a-uid', 'c1', { personASubmittedAt: Timestamp.fromMillis(1) }, own())).toBeNull();
  });
  it('declines drafts, invalid timestamps, identity mismatches and missing data', () => {
    expect(selfHealPatch('personA', 'a-uid', 'c1', {}, own({ submittedAt: null }))).toBeNull();
    expect(selfHealPatch('personA', 'a-uid', 'c1', {}, own({ submittedAt: '2026-01-01' }))).toBeNull();
    expect(selfHealPatch('personA', 'a-uid', 'c1', {}, own({ submittedAt: { seconds: 1, nanoseconds: 0 } }))).toBeNull();
    expect(selfHealPatch('personA', 'b-uid', 'c1', {}, own())).toBeNull();
    expect(selfHealPatch('personA', 'a-uid', 'c1', {}, own({ person: 'personB' }))).toBeNull();
    expect(selfHealPatch('personA', 'a-uid', 'c1', {}, own({ id: 'personB' }))).toBeNull();
    expect(selfHealPatch('personA', 'a-uid', 'other', {}, own())).toBeNull();
    expect(selfHealPatch('personA', 'a-uid', 'c1', undefined, own())).toBeNull();
    expect(selfHealPatch('personA', 'a-uid', 'c1', {}, undefined)).toBeNull();
    expect(selfHealPatch('personA', '', 'c1', {}, own())).toBeNull();
  });
});

describe('bothSubmitted', () => {
  it('requires two real timestamps', () => {
    expect(bothSubmitted({ personASubmittedAt: T, personBSubmittedAt: T })).toBe(true);
    expect(bothSubmitted({ personASubmittedAt: T, personBSubmittedAt: null })).toBe(false);
    expect(bothSubmitted({ personASubmittedAt: T, personBSubmittedAt: true })).toBe(false);
  });
});

describe('isLockedSubmission / reflectionIdsToDelete', () => {
  it('treats any submittedAt as locked; drafts and missing docs as editable', async () => {
    const { isLockedSubmission } = await import('../submission');
    expect(isLockedSubmission({ submittedAt: T })).toBe(true);
    expect(isLockedSubmission({ submittedAt: null })).toBe(false);
    expect(isLockedSubmission({})).toBe(false);
    expect(isLockedSubmission(undefined)).toBe(false);
  });
  it('always includes canonical IDs and every enumerated stray ID once', async () => {
    const { reflectionIdsToDelete } = await import('../submission');
    expect(reflectionIdsToDelete(null)).toEqual(['personA', 'personB']);
    expect(reflectionIdsToDelete([])).toEqual(['personA', 'personB']);
    expect(reflectionIdsToDelete(['personB', 'foo', 'bar'])).toEqual(['personA', 'personB', 'foo', 'bar']);
  });
});
