import { describe, expect, it } from 'vitest';
import { isReviewComplete, needsReview, showsNeedingReview } from '../lib/reviewCompleteness';
import type { Show, MemberRating } from '../types';
import { Timestamp } from 'firebase/firestore';

function ts(): Timestamp {
  return { seconds: 0, nanoseconds: 0, toDate: () => new Date(0) } as unknown as Timestamp;
}

function makeShow(patch: Partial<Show> = {}): Show {
  return {
    id: 'show1',
    listId: 'list1',
    title: 'Test Show',
    type: 'anime',
    status: 'completed',
    currentSeason: null,
    currentEpisode: null,
    totalSeasons: null,
    service: null,
    watchers: [],
    description: '',
    notes: '',
    memberNotes: {},
    vibeTags: [],
    brainPower: null,
    ratings: {},
    createdAt: ts(),
    updatedAt: ts(),
    createdBy: 'u1',
    lastEditedBy: 'u1',
    ...patch,
  };
}

function makeRating(patch: Partial<MemberRating> = {}): MemberRating {
  return { story: 7, characters: 7, vibes: 7, wouldRewatch: 'yes', brainPower: null, ratedAt: null, ...patch };
}

describe('isReviewComplete', () => {
  it('is false for undefined rating', () => {
    expect(isReviewComplete(undefined)).toBe(false);
  });

  it('is true when story/characters/vibes/wouldRewatch are all set', () => {
    expect(isReviewComplete(makeRating())).toBe(true);
  });

  it('is false when any required field is null', () => {
    expect(isReviewComplete(makeRating({ story: null }))).toBe(false);
    expect(isReviewComplete(makeRating({ characters: null }))).toBe(false);
    expect(isReviewComplete(makeRating({ vibes: null }))).toBe(false);
    expect(isReviewComplete(makeRating({ wouldRewatch: null }))).toBe(false);
  });

  it('ignores brainPower — it is context-only and never required', () => {
    expect(isReviewComplete(makeRating({ brainPower: null }))).toBe(true);
  });
});

describe('needsReview', () => {
  it('is false for non-ratable statuses (watching/planned)', () => {
    expect(needsReview(makeShow({ status: 'watching' }), 'u1')).toBe(false);
    expect(needsReview(makeShow({ status: 'planned' }), 'u1')).toBe(false);
  });

  it('is true for a ratable show with no rating from this member', () => {
    expect(needsReview(makeShow({ status: 'completed', ratings: {} }), 'u1')).toBe(true);
  });

  it('is false once the member has a complete rating', () => {
    const show = makeShow({ status: 'completed', ratings: { u1: makeRating() } });
    expect(needsReview(show, 'u1')).toBe(false);
  });

  it('is true when the member has a partial rating', () => {
    const show = makeShow({ status: 'on_hold', ratings: { u1: makeRating({ wouldRewatch: null }) } });
    expect(needsReview(show, 'u1')).toBe(true);
  });

  it('is true for dropped shows missing a review', () => {
    expect(needsReview(makeShow({ status: 'dropped' }), 'u1')).toBe(true);
  });

  it('does not flag a member who is not a watcher and has not started rating', () => {
    const show = makeShow({ status: 'completed', watchers: ['u2'], ratings: {} });
    expect(needsReview(show, 'u1')).toBe(false);
  });

  it('flags a non-watcher who already started a partial rating (they clearly watched it)', () => {
    const show = makeShow({
      status: 'completed',
      watchers: ['u2'],
      ratings: { u1: makeRating({ vibes: null }) },
    });
    expect(needsReview(show, 'u1')).toBe(true);
  });

  it('treats an empty watchers array as "everyone" (legacy shows)', () => {
    const show = makeShow({ status: 'completed', watchers: [], ratings: {} });
    expect(needsReview(show, 'u1')).toBe(true);
  });
});

describe('showsNeedingReview', () => {
  it('filters to only shows needing review from the given member', () => {
    const complete = makeShow({ id: 'a', status: 'completed', ratings: { u1: makeRating() } });
    const incomplete = makeShow({ id: 'b', status: 'completed', ratings: {} });
    const notRatable = makeShow({ id: 'c', status: 'watching' });
    const result = showsNeedingReview([complete, incomplete, notRatable], 'u1');
    expect(result.map((s) => s.id)).toEqual(['b']);
  });
});
