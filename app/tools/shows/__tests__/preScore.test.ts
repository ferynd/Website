import { describe, expect, it } from 'vitest';
import {
  inferFocusLevel,
  inferVibeKeywords,
  scoreBrainPower,
  scoreVibeFit,
  scoreViewerRatingFit,
  computeCandidatePreScore,
} from '../lib/preScore';
import { VIBE_CATEGORIES } from '../lib/vibeCategories';
import type { Show } from '../types';
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

function makeRating(composite: number) {
  return {
    story: composite,
    characters: composite,
    vibes: composite,
    wouldRewatch: null as null,
    ratedAt: null as null,
  };
}

const VALID_TAGS = new Set<string>(VIBE_CATEGORIES);

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
    const result = computeCandidatePreScore(show, 'low', [], []);
    expect(result.showId).toBe('abc');
    expect(result.title).toBe('My Show');
  });

  it('brain-dead show with bp=1 and real funny tags gets high overall score for low focus', () => {
    const show = makeShow({ id: 's1', brainPower: 1, vibeTags: ['Funny', 'Lighthearted'] });
    const kw = inferVibeKeywords('brain dead and wants something funny');
    const result = computeCandidatePreScore(show, 'low', kw, []);
    expect(result.brainPowerMatch).toBe(10);
    expect(result.overallPreScore).toBeGreaterThan(7);
  });

  it('dense show (bp=5) gets low overall score for low focus', () => {
    const show = makeShow({ id: 's1', brainPower: 5, vibeTags: ['Emotional', 'Thoughtful'] });
    const kw = inferVibeKeywords('brain dead wants something funny');
    const result = computeCandidatePreScore(show, 'low', kw, []);
    expect(result.brainPowerMatch).toBe(0);
    expect(result.overallPreScore).toBeLessThan(5);
  });

  it('overall score accounts for viewer ratings', () => {
    const showHigh = makeShow({ id: 's1', brainPower: 1, ratings: { u1: makeRating(9) } });
    const showLow = makeShow({ id: 's2', brainPower: 1, ratings: { u1: makeRating(2) } });
    const scoreHigh = computeCandidatePreScore(showHigh, 'low', [], ['u1']).overallPreScore;
    const scoreLow = computeCandidatePreScore(showLow, 'low', [], ['u1']).overallPreScore;
    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });

  it('overallPreScore is between 0 and 10', () => {
    const show = makeShow({ id: 's1', brainPower: 3, vibeTags: ['Chill'] });
    const result = computeCandidatePreScore(show, 'normal', ['Chill'], ['u1']);
    expect(result.overallPreScore).toBeGreaterThanOrEqual(0);
    expect(result.overallPreScore).toBeLessThanOrEqual(10);
  });
});
