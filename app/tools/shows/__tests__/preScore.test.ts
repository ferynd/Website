import { describe, expect, it } from 'vitest';
import {
  inferFocusLevel,
  inferVibeKeywords,
  scoreBrainPower,
  scoreVibeFit,
  scoreViewerRatingFit,
  computeCandidatePreScore,
} from '../lib/preScore';
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
/* inferVibeKeywords                                            */
/* ------------------------------------------------------------ */

describe('inferVibeKeywords', () => {
  it('detects funny → comedy tags', () => {
    const kw = inferVibeKeywords('wants something funny');
    expect(kw).toContain('Comedy');
    expect(kw).toContain('Funny');
  });

  it('detects exciting → action tags', () => {
    const kw = inferVibeKeywords('wants something exciting');
    expect(kw).toContain('Action');
    expect(kw).toContain('Exciting');
  });

  it('detects chill → cozy tags', () => {
    const kw = inferVibeKeywords('wants something chill');
    expect(kw).toContain('Chill');
    expect(kw).toContain('Cozy');
  });

  it('returns empty for unrecognized text', () => {
    const kw = inferVibeKeywords('something completely different');
    expect(kw).toHaveLength(0);
  });

  it('detects multiple vibes', () => {
    const kw = inferVibeKeywords('funny and exciting tonight');
    expect(kw).toContain('Comedy');
    expect(kw).toContain('Action');
  });

  it('deduplicates tags', () => {
    const kw = inferVibeKeywords('funny humor comedy');
    const uniqueKw = new Set(kw);
    expect(uniqueKw.size).toBe(kw.length);
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
/* scoreVibeFit                                                 */
/* ------------------------------------------------------------ */

describe('scoreVibeFit', () => {
  it('returns 5 (neutral) when no vibe keywords', () => {
    expect(scoreVibeFit(['Comedy', 'Funny'], [])).toBe(5);
  });

  it('returns higher score for matching tags', () => {
    const score = scoreVibeFit(['Comedy', 'Funny'], ['Comedy', 'Funny']);
    expect(score).toBeGreaterThan(5);
  });

  it('returns low score when no tags match keywords', () => {
    const score = scoreVibeFit(['Drama', 'Emotional'], ['Comedy', 'Funny']);
    expect(score).toBeLessThan(5);
  });

  it('score increases with more matching tags', () => {
    const oneMatch = scoreVibeFit(['Comedy'], ['Comedy', 'Funny']);
    const twoMatch = scoreVibeFit(['Comedy', 'Funny'], ['Comedy', 'Funny']);
    expect(twoMatch).toBeGreaterThan(oneMatch);
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

  it('brain-dead show with bp=1 gets high overall score for low focus', () => {
    const show = makeShow({ id: 's1', brainPower: 1, vibeTags: ['Comedy'] });
    const result = computeCandidatePreScore(show, 'low', ['Comedy', 'Funny'], []);
    expect(result.brainPowerMatch).toBe(10);
    expect(result.overallPreScore).toBeGreaterThan(7);
  });

  it('dense show (bp=5) gets low overall score for low focus', () => {
    const show = makeShow({ id: 's1', brainPower: 5, vibeTags: ['Drama'] });
    const result = computeCandidatePreScore(show, 'low', ['Comedy'], []);
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
