import { describe, expect, it } from 'vitest';
import {
  inferFocusLevel,
  inferViewerFocusLevel,
  inferVibeKeywords,
  scoreBrainPower,
  scoreVibeFit,
  scoreViewerRatingFit,
  computeCandidatePreScore,
} from '../lib/preScore';
import { memberComposite } from '../lib/compositeScore';
import { VIBE_CATEGORIES } from '../lib/vibeCategories';
import type { Show, MemberRating } from '../types';
import { Timestamp } from 'firebase/firestore';

/* ------------------------------------------------------------ */
/* Fixtures                                                     */
/* ------------------------------------------------------------ */

function ts(): Timestamp {
  return { seconds: 0, nanoseconds: 0, toDate: () => new Date(0) } as unknown as Timestamp;
}

function makeShow(patch: Partial<Show> = {}): Show {
  return {
    id: 'show1',
    listId: 'list1',
    title: 'Test Show',
    type: 'anime',
    status: 'watching',
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

function makeRating(composite: number): MemberRating {
  return {
    story: composite,
    characters: composite,
    vibes: composite,
    wouldRewatch: null,
    brainPower: null,
    ratedAt: null,
  };
}

const VALID_TAGS = new Set<string>(VIBE_CATEGORIES);

/* ------------------------------------------------------------ */
/* memberComposite ignores brainPower                           */
/* ------------------------------------------------------------ */

describe('memberComposite', () => {
  it('ignores brainPower when computing composite score', () => {
    const base: MemberRating = {
      story: 8, characters: 8, vibes: 8, wouldRewatch: null, brainPower: 1, ratedAt: null,
    };
    const high: MemberRating = { ...base, brainPower: 5 };
    expect(memberComposite(base)).toBe(memberComposite(high));
    expect(memberComposite(base)).toBeCloseTo(8);
  });

  it('ignores null brainPower', () => {
    const base: MemberRating = {
      story: 7, characters: 9, vibes: 8, wouldRewatch: null, brainPower: null, ratedAt: null,
    };
    expect(memberComposite(base)).toBeCloseTo(8);
  });
});

/* ------------------------------------------------------------ */
/* inferFocusLevel                                              */
/* ------------------------------------------------------------ */

describe('inferFocusLevel', () => {
  it('detects "brain dead" as low focus', () => {
    expect(inferFocusLevel('Jimi is brain dead after work')).toBe('low');
  });

  it('detects "braindead" (no space) as low focus', () => {
    expect(inferFocusLevel('totally braindead tonight')).toBe('low');
  });

  it('detects "tired" as low focus', () => {
    expect(inferFocusLevel('so tired, just want to relax')).toBe('low');
  });

  it('detects "multitasking" as low focus', () => {
    expect(inferFocusLevel('will be multitasking on the laptop')).toBe('low');
  });

  it('detects "low focus" phrase as low focus', () => {
    expect(inferFocusLevel('in a low focus mood tonight')).toBe('low');
  });

  it('detects "low energy" as low focus', () => {
    expect(inferFocusLevel('low energy kind of night')).toBe('low');
  });

  it('detects "background" as low focus', () => {
    expect(inferFocusLevel('want something for background')).toBe('low');
  });

  it('detects "exhausted" as low focus', () => {
    expect(inferFocusLevel('absolutely exhausted')).toBe('low');
  });

  it('returns normal for neutral text', () => {
    expect(inferFocusLevel('want to watch something fun tonight')).toBe('normal');
  });

  it('detects high focus signals', () => {
    expect(inferFocusLevel('ready to focus on something complex')).toBe('high');
  });

  it('returns normal for empty string', () => {
    expect(inferFocusLevel('')).toBe('normal');
  });
});

/* ------------------------------------------------------------ */
/* inferViewerFocusLevel                                        */
/* ------------------------------------------------------------ */

describe('inferViewerFocusLevel', () => {
  it('uses individual mood when provided and it is non-neutral', () => {
    expect(inferViewerFocusLevel('tired', 'Alice')).toBe('low');
  });

  it('returns normal for empty individual mood with no sharedMood', () => {
    expect(inferViewerFocusLevel('', 'Alice')).toBe('normal');
  });

  it('extracts focus from sharedMood when individual mood is empty and name matches', () => {
    expect(inferViewerFocusLevel('', 'Jimi', 'Jimi is brain dead after work')).toBe('low');
  });

  it('does not apply another viewer\'s focus from sharedMood', () => {
    // Only Jimi is brain dead; Kait's clause has no low-focus phrases
    expect(
      inferViewerFocusLevel('', 'Kait', 'Jimi is brain dead after work, Kait is up for anything'),
    ).toBe('normal');
  });

  it('individual mood overrides sharedMood when individual mood is non-neutral', () => {
    // Individual says high focus, shared says brain dead — individual wins
    expect(inferViewerFocusLevel('ready to focus', 'Alice', 'Alice is brain dead')).toBe('high');
  });

  it('returns normal when name is not mentioned in sharedMood', () => {
    expect(inferViewerFocusLevel('', 'Bob', 'Alice is tired tonight')).toBe('normal');
  });

  it('handles high focus from sharedMood name mention', () => {
    expect(
      inferViewerFocusLevel('', 'Kait', 'Jimi is tired. Kait is ready to focus.'),
    ).toBe('high');
  });

  it('splits on "but" so Kait is not low-focus when only Jimi is tired', () => {
    expect(
      inferViewerFocusLevel('', 'Kait', 'Jimi is tired from work but Kait is up for whatever'),
    ).toBe('normal');
  });

  it('identifies Jimi as low-focus when split by "but"', () => {
    expect(
      inferViewerFocusLevel('', 'Jimi', 'Jimi is tired from work but Kait is up for whatever'),
    ).toBe('low');
  });

  it('splits on "while" as a contrastive conjunction', () => {
    expect(
      inferViewerFocusLevel('', 'Kait', 'Jimi is exhausted while Kait is energized'),
    ).toBe('normal');
  });

  it('splits on "whereas" as a contrastive conjunction', () => {
    expect(
      inferViewerFocusLevel('', 'Alice', 'Bob is brain dead whereas Alice is ready to focus'),
    ).toBe('high');
  });
});

/* ------------------------------------------------------------ */
/* inferVibeKeywords — real VIBE_CATEGORIES tags only           */
/* ------------------------------------------------------------ */

describe('inferVibeKeywords', () => {
  it('every returned tag exists in VIBE_CATEGORIES', () => {
    const inputs = [
      'wants something funny and exciting',
      'brain dead, just wants chill background tv',
      'romantic and wholesome night',
      'mystery thriller noir',
      'musical singing night',
      'horror and dark',
      'chaotic and wild',
      'family and friendship heartwarming',
      'slow burn psychological',
      'fantasy epic world-building',
    ];
    for (const text of inputs) {
      const tags = inferVibeKeywords(text);
      for (const tag of tags) {
        expect(VALID_TAGS.has(tag), `"${tag}" is not in VIBE_CATEGORIES`).toBe(true);
      }
    }
  });

  it('"funny" maps to Funny and Lighthearted', () => {
    const kw = inferVibeKeywords('wants something funny');
    expect(kw).toContain('Funny');
    expect(kw).toContain('Lighthearted');
    // Must NOT contain non-existent tags
    expect(kw).not.toContain('Comedy');
    expect(kw).not.toContain('Humor');
  });

  it('"exciting" maps to Action-Packed, Adventurous, Fast-Paced, Intense, Suspenseful', () => {
    const kw = inferVibeKeywords('wants something exciting');
    expect(kw).toContain('Action-Packed');
    expect(kw).toContain('Adventurous');
    expect(kw).toContain('Fast-Paced');
    // Must NOT contain non-existent tags
    expect(kw).not.toContain('Action');
    expect(kw).not.toContain('Exciting');
    expect(kw).not.toContain('Thrilling');
  });

  it('"mystery" maps to Mysterious, Suspenseful, Mind-Bending', () => {
    const kw = inferVibeKeywords('wants a mystery');
    expect(kw).toContain('Mysterious');
    expect(kw).toContain('Suspenseful');
    expect(kw).toContain('Mind-Bending');
    // Must NOT contain non-existent tags
    expect(kw).not.toContain('Mystery');
    expect(kw).not.toContain('Thriller');
    expect(kw).not.toContain('Crime');
  });

  it('"chill" maps to Chill, Cozy, Comfort Watch, Low-Stakes', () => {
    const kw = inferVibeKeywords('wants something chill');
    expect(kw).toContain('Chill');
    expect(kw).toContain('Cozy');
    expect(kw).toContain('Comfort Watch');
    // Must NOT contain non-existent tags
    expect(kw).not.toContain('Relaxing');
    expect(kw).not.toContain('Comfort');
  });

  it('"romantic" maps to Romantic and Wholesome', () => {
    const kw = inferVibeKeywords('romantic night');
    expect(kw).toContain('Romantic');
    expect(kw).toContain('Wholesome');
    expect(kw).not.toContain('Romance');
  });

  it('"emotional" maps to Emotional and Thoughtful', () => {
    const kw = inferVibeKeywords('something emotional and deep');
    expect(kw).toContain('Emotional');
    expect(kw).toContain('Thoughtful');
    expect(kw).not.toContain('Drama');
  });

  it('"epic" maps to Epic and Adventurous', () => {
    const kw = inferVibeKeywords('fantasy epic world-building');
    expect(kw).toContain('Epic');
    expect(kw).toContain('Adventurous');
    expect(kw).not.toContain('Fantasy');
  });

  it('"chaotic" maps to Chaotic and Fast-Paced', () => {
    const kw = inferVibeKeywords('something chaotic and wild');
    expect(kw).toContain('Chaotic');
    expect(kw).toContain('Fast-Paced');
  });

  it('"family" maps to Found Family and Wholesome', () => {
    const kw = inferVibeKeywords('family friendship heartwarming');
    expect(kw).toContain('Found Family');
    expect(kw).toContain('Wholesome');
  });

  it('returns empty array for completely unrecognized text', () => {
    const kw = inferVibeKeywords('something completely different blah');
    expect(kw).toHaveLength(0);
  });

  it('detects multiple vibes from combined text', () => {
    const kw = inferVibeKeywords('funny and exciting tonight');
    expect(kw).toContain('Funny');
    expect(kw).toContain('Action-Packed');
  });

  it('deduplicates tags', () => {
    const kw = inferVibeKeywords('funny humor comedy');
    const uniqueKw = new Set(kw);
    expect(uniqueKw.size).toBe(kw.length);
  });
});

/* ------------------------------------------------------------ */
/* scoreVibeFit — with real VIBE_CATEGORIES tags                */
/* ------------------------------------------------------------ */

describe('scoreVibeFit', () => {
  it('returns 5 (neutral) when no vibe keywords', () => {
    expect(scoreVibeFit(['Funny', 'Lighthearted'], [])).toBe(5);
  });

  it('returns higher score for matching real tags', () => {
    const score = scoreVibeFit(['Action-Packed', 'Adventurous'], ['Action-Packed', 'Adventurous', 'Fast-Paced', 'Intense', 'Suspenseful']);
    expect(score).toBeGreaterThan(5);
  });

  it('returns low score when no tags match', () => {
    const score = scoreVibeFit(['Emotional', 'Thoughtful'], ['Funny', 'Lighthearted']);
    expect(score).toBeLessThan(5);
  });

  it('score increases with more matching tags', () => {
    const oneMatch = scoreVibeFit(['Action-Packed'], ['Action-Packed', 'Adventurous']);
    const twoMatch = scoreVibeFit(['Action-Packed', 'Adventurous'], ['Action-Packed', 'Adventurous']);
    expect(twoMatch).toBeGreaterThan(oneMatch);
  });

  it('Action-Packed show scores well against "exciting" inferred keywords', () => {
    // inferred from "exciting" input
    const excitingKeywords = ['Action-Packed', 'Adventurous', 'Fast-Paced', 'Intense', 'Suspenseful'];
    const score = scoreVibeFit(['Action-Packed', 'Fast-Paced'], excitingKeywords);
    expect(score).toBeGreaterThan(5);
  });
});

/* ------------------------------------------------------------ */
/* scoreBrainPower                                              */
/* ------------------------------------------------------------ */

describe('scoreBrainPower', () => {
  it('scores brainPower=1 high when focus is low', () => {
    expect(scoreBrainPower(1, 'low')).toBe(10);
  });

  it('scores brainPower=2 high when focus is low', () => {
    expect(scoreBrainPower(2, 'low')).toBe(10);
  });

  it('scores brainPower=5 as 0 when focus is low', () => {
    expect(scoreBrainPower(5, 'low')).toBe(0);
  });

  it('scores brainPower=4 as 0 when focus is low', () => {
    expect(scoreBrainPower(4, 'low')).toBe(0);
  });

  it('scores brainPower=3 in the middle when focus is low', () => {
    expect(scoreBrainPower(3, 'low')).toBeLessThan(10);
    expect(scoreBrainPower(3, 'low')).toBeGreaterThan(0);
  });

  it('scores brainPower=5 high when focus is high', () => {
    expect(scoreBrainPower(5, 'high')).toBe(10);
  });

  it('scores brainPower=1 lower when focus is high', () => {
    expect(scoreBrainPower(1, 'high')).toBeLessThan(scoreBrainPower(5, 'high'));
  });

  it('returns 5 for null brainPower (neutral)', () => {
    expect(scoreBrainPower(null, 'low')).toBe(5);
    expect(scoreBrainPower(null, 'normal')).toBe(5);
    expect(scoreBrainPower(null, 'high')).toBe(5);
  });
});

/* ------------------------------------------------------------ */
/* scoreViewerRatingFit                                         */
/* ------------------------------------------------------------ */

describe('scoreViewerRatingFit', () => {
  it('returns 5 (neutral) when no present viewers have rated the show', () => {
    const show = makeShow({ id: 's1', ratings: {} });
    expect(scoreViewerRatingFit(show, ['u1', 'u2'])).toBe(5);
  });

  it('returns high score for highly-rated shows', () => {
    const show = makeShow({ id: 's1', ratings: { u1: makeRating(9) } });
    expect(scoreViewerRatingFit(show, ['u1'])).toBeGreaterThan(7);
  });

  it('returns mid score for 6-7 rated shows', () => {
    const show = makeShow({ id: 's1', ratings: { u1: makeRating(6.5) } });
    const score = scoreViewerRatingFit(show, ['u1']);
    expect(score).toBeGreaterThan(4);
    expect(score).toBeLessThan(8);
  });

  it('returns lower score for poorly-rated shows', () => {
    const show = makeShow({ id: 's1', ratings: { u1: makeRating(2) } });
    const score = scoreViewerRatingFit(show, ['u1']);
    expect(score).toBeLessThan(5);
  });

  it('averages across multiple present viewers', () => {
    const show = makeShow({
      id: 's1',
      ratings: { u1: makeRating(10), u2: makeRating(4) },
    });
    const scoreU1Only = scoreViewerRatingFit(show, ['u1']);
    const scoreBoth = scoreViewerRatingFit(show, ['u1', 'u2']);
    expect(scoreBoth).toBeLessThan(scoreU1Only);
  });
});

/* ------------------------------------------------------------ */
/* computeCandidatePreScore                                     */
/* ------------------------------------------------------------ */

describe('computeCandidatePreScore', () => {
  it('returns correct showId and title', () => {
    const show = makeShow({ id: 'abc', title: 'My Show', brainPower: 1 });
    const result = computeCandidatePreScore(show, {}, [], []);
    expect(result.showId).toBe('abc');
    expect(result.title).toBe('My Show');
  });

  it('brain-dead show with bp=1 and real funny tags gets high overall score for low-focus viewer', () => {
    const show = makeShow({ id: 's1', brainPower: 1, vibeTags: ['Funny', 'Lighthearted'] });
    const kw = inferVibeKeywords('brain dead and wants something funny');
    const result = computeCandidatePreScore(show, { u1: 'low' }, kw, ['u1']);
    expect(result.brainPowerMatch).toBe(10);
    expect(result.overallPreScore).toBeGreaterThan(7);
  });

  it('dense show (bp=5) gets low overall score for low-focus viewer', () => {
    const show = makeShow({ id: 's1', brainPower: 5, vibeTags: ['Emotional', 'Thoughtful'] });
    const kw = inferVibeKeywords('brain dead wants something funny');
    const result = computeCandidatePreScore(show, { u1: 'low' }, kw, ['u1']);
    expect(result.brainPowerMatch).toBe(0);
    expect(result.overallPreScore).toBeLessThan(5);
  });

  it('overall score accounts for viewer ratings', () => {
    const showHigh = makeShow({ id: 's1', brainPower: 1, ratings: { u1: makeRating(9) } });
    const showLow = makeShow({ id: 's2', brainPower: 1, ratings: { u1: makeRating(2) } });
    const scoreHigh = computeCandidatePreScore(showHigh, { u1: 'low' }, [], ['u1']).overallPreScore;
    const scoreLow = computeCandidatePreScore(showLow, { u1: 'low' }, [], ['u1']).overallPreScore;
    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });

  it('overallPreScore is between 0 and 10', () => {
    const show = makeShow({ id: 's1', brainPower: 3, vibeTags: ['Chill'] });
    const result = computeCandidatePreScore(show, { u1: 'normal' }, ['Chill'], ['u1']);
    expect(result.overallPreScore).toBeGreaterThanOrEqual(0);
    expect(result.overallPreScore).toBeLessThanOrEqual(10);
  });

  it('uses per-person brainPower from rating when available, ignoring show-level', () => {
    // Viewer has their own brain estimate of 2 (easy), but show-level says 5 (dense)
    const show = makeShow({
      id: 's1',
      brainPower: 5,
      ratings: { u1: { ...makeRating(7), brainPower: 2 } },
    });
    // Low-focus viewer with their own bp=2 → should score well
    const result = computeCandidatePreScore(show, { u1: 'low' }, [], ['u1']);
    expect(result.brainPowerMatch).toBe(10); // scoreBrainPower(2, 'low') = 10
  });

  it('falls back to show-level brainPower when viewer has not set their own', () => {
    // No per-person rating, show-level bp=1
    const show = makeShow({ id: 's1', brainPower: 1 });
    const result = computeCandidatePreScore(show, { u1: 'low' }, [], ['u1']);
    expect(result.brainPowerMatch).toBe(10); // scoreBrainPower(1, 'low') = 10
  });

  it('returns neutral (5) for no-viewer scenario when show brainPower is null', () => {
    const show = makeShow({ id: 's1', brainPower: null });
    const result = computeCandidatePreScore(show, {}, [], []);
    expect(result.brainPowerMatch).toBe(5);
  });
});

/* ------------------------------------------------------------ */
/* Per-viewer brainpower scenarios                              */
/* ------------------------------------------------------------ */

describe('per-viewer brainpower scoring scenarios', () => {
  it('Jimi low-focus brain:2, Kait normal brain:5 → excellent brainpower fit (low-focus viewer drives score)', () => {
    // Jimi thinks the show is easy (bp=2), Kait thinks it is dense (bp=5)
    // Only the low-focus viewer (Jimi) drives the brain-power score
    const show = makeShow({
      id: 's1',
      ratings: {
        jimi: { ...makeRating(7), brainPower: 2 },
        kait: { ...makeRating(8), brainPower: 5 },
      },
    });
    // only low-focus viewer (jimi) scored: scoreBrainPower(2, 'low') = 10
    const result = computeCandidatePreScore(show, { jimi: 'low', kait: 'normal' }, [], ['jimi', 'kait']);
    expect(result.brainPowerMatch).toBe(10);
  });

  it('Jimi low-focus brain:5, Kait normal brain:1 → poor brainpower fit (low-focus viewer drives score)', () => {
    // Jimi is tired and thinks the show is dense — bad for Jimi
    // Kait's easy-brain estimate is irrelevant because she is not the constraint
    const show = makeShow({
      id: 's1',
      ratings: {
        jimi: { ...makeRating(7), brainPower: 5 },
        kait: { ...makeRating(8), brainPower: 1 },
      },
    });
    // only low-focus viewer (jimi) scored: scoreBrainPower(5, 'low') = 0
    const result = computeCandidatePreScore(show, { jimi: 'low', kait: 'normal' }, [], ['jimi', 'kait']);
    expect(result.brainPowerMatch).toBe(0);
  });

  it('both viewers low-focus with bp=1 → excellent brainpower fit', () => {
    const show = makeShow({
      id: 's1',
      ratings: {
        u1: { ...makeRating(8), brainPower: 1 },
        u2: { ...makeRating(7), brainPower: 2 },
      },
    });
    // u1 (low, bp=1) → 10; u2 (low, bp=2) → 10; avg = 10
    const result = computeCandidatePreScore(show, { u1: 'low', u2: 'low' }, [], ['u1', 'u2']);
    expect(result.brainPowerMatch).toBe(10);
  });

  it('Kait\'s low-focus does not penalize because she rated it easy', () => {
    // Kait is tired, but she rated the show as easy (bp=1) — should still score well
    const show = makeShow({
      id: 's1',
      ratings: { kait: { ...makeRating(8), brainPower: 1 } },
    });
    const result = computeCandidatePreScore(show, { kait: 'low' }, [], ['kait']);
    expect(result.brainPowerMatch).toBe(10);
  });
});
