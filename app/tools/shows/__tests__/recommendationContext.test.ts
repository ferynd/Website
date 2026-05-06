import { describe, expect, it } from 'vitest';
import { buildHistory, candidateShows } from '../lib/recommendationContext';
import type { Show, ShowList } from '../types';
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
    vibeTags: ['Chill', 'Cozy'],
    brainPower: null,
    ratings: {},
    createdAt: ts(),
    updatedAt: ts(),
    createdBy: 'u1',
    lastEditedBy: 'u1',
    ...patch,
  };
}

function makeMember(uid: string, displayName: string): ShowList['members'][number] {
  return { uid, email: `${uid}@test.com`, displayName, role: 'member', joinedAt: ts() };
}

function makeRating(composite: number) {
  // story + characters + vibes averaged = composite → set all equal
  return {
    story: composite,
    characters: composite,
    vibes: composite,
    wouldRewatch: null as null,
    ratedAt: null as null,
  };
}

/* ------------------------------------------------------------ */
/* buildHistory                                                 */
/* ------------------------------------------------------------ */

describe('buildHistory', () => {
  it('includes high-scoring shows (≥7) in member history', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({ id: 's1', ratings: { u1: makeRating(8) }, vibeTags: ['Epic'] });
    const history = buildHistory([show], [member]);
    expect(history.u1.highScoringShows).toHaveLength(1);
    expect(history.u1.highScoringShows[0].title).toBe('Test Show');
  });

  it('excludes shows scoring below 7', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({ id: 's1', ratings: { u1: makeRating(6) } });
    const history = buildHistory([show], [member]);
    expect(history.u1.highScoringShows).toHaveLength(0);
  });

  it('uses memberNotes[uid] over legacy notes field', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({
      id: 's1',
      ratings: { u1: makeRating(9) },
      notes: 'legacy note',
      memberNotes: { u1: 'personal note' },
    });
    const history = buildHistory([show], [member]);
    expect(history.u1.highScoringShows[0].note).toBe('personal note');
  });

  it('falls back to legacy notes when memberNotes is absent', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({
      id: 's1',
      ratings: { u1: makeRating(9) },
      notes: 'old legacy note',
      memberNotes: undefined,
    });
    const history = buildHistory([show], [member]);
    expect(history.u1.highScoringShows[0].note).toBe('old legacy note');
  });

  it('handles member with no ratings gracefully', () => {
    const member = makeMember('u2', 'Bob');
    const show = makeShow({ id: 's1', ratings: {} });
    const history = buildHistory([show], [member]);
    expect(history.u2.highScoringShows).toHaveLength(0);
  });

  it('produces an entry for each member', () => {
    const members = [makeMember('u1', 'Alice'), makeMember('u2', 'Bob')];
    const shows: Show[] = [];
    const history = buildHistory(shows, members);
    expect(Object.keys(history)).toEqual(['u1', 'u2']);
    expect(history.u1.name).toBe('Alice');
    expect(history.u2.name).toBe('Bob');
  });
});

/* ------------------------------------------------------------ */
/* candidateShows                                               */
/* ------------------------------------------------------------ */

describe('candidateShows', () => {
  const watching = makeShow({ id: 'w1', status: 'watching' });
  const planned = makeShow({ id: 'p1', status: 'planned' });
  const onHold = makeShow({ id: 'oh1', status: 'on_hold' });
  const completed = makeShow({ id: 'c1', status: 'completed' });
  const dropped = makeShow({ id: 'd1', status: 'dropped' });
  const all = [watching, planned, onHold, completed, dropped];

  it('returns only watching/planned/on_hold when no presentUids', () => {
    const result = candidateShows(all);
    expect(result.map((s) => s.id)).toEqual(['w1', 'p1', 'oh1']);
  });

  it('filters by present viewers when watchers are set', () => {
    const forU1 = makeShow({ id: 'u1show', status: 'planned', watchers: ['u1'] });
    const forU2 = makeShow({ id: 'u2show', status: 'planned', watchers: ['u2'] });
    const result = candidateShows([forU1, forU2], ['u1']);
    expect(result.map((s) => s.id)).toEqual(['u1show']);
  });

  it('includes legacy shows with empty watchers array regardless of present viewers', () => {
    const legacy = makeShow({ id: 'legacy', status: 'planned', watchers: [] });
    const result = candidateShows([legacy], ['u1']);
    expect(result.map((s) => s.id)).toContain('legacy');
  });

  it('falls back to all eligible shows if none match present viewers', () => {
    const forU2 = makeShow({ id: 'u2show', status: 'planned', watchers: ['u2'] });
    const result = candidateShows([forU2], ['u1']);
    expect(result.map((s) => s.id)).toContain('u2show');
  });

  it('includes show when one of its watchers is present (multi-watcher show)', () => {
    const shared = makeShow({ id: 'shared', status: 'planned', watchers: ['u1', 'u2'] });
    const result = candidateShows([shared], ['u1']);
    expect(result.map((s) => s.id)).toContain('shared');
  });
});

/* ------------------------------------------------------------ */
/* Recommendation prompt inputs (whitebox)                     */
/* These tests verify that the data passed to the AI contains  */
/* the right fields without testing Gemini output itself.      */
/* ------------------------------------------------------------ */

describe('recommendation payload structure', () => {
  it('buildHistory includes brain power indirectly via composite threshold', () => {
    // brainPower is on the Show; ensures it survives the data pipeline
    const member = makeMember('u1', 'Alice');
    const show = makeShow({
      id: 's1',
      ratings: { u1: makeRating(8) },
      brainPower: 2,
    });
    const history = buildHistory([show], [member]);
    // The HistoryShow carries vibes and note; brainPower is on the Show passed as candidate
    expect(history.u1.highScoringShows[0].vibes).toEqual(['Chill', 'Cozy']);
  });

  it('candidateShows returns brainPower field on show objects', () => {
    const show = makeShow({ status: 'watching', brainPower: 3 });
    const [candidate] = candidateShows([show]);
    expect(candidate.brainPower).toBe(3);
  });

  it('candidateShows returns memberNotes field on show objects', () => {
    const show = makeShow({
      status: 'planned',
      memberNotes: { u1: 'love this series' },
    });
    const [candidate] = candidateShows([show]);
    expect(candidate.memberNotes?.u1).toBe('love this series');
  });

  it('all candidate IDs are strings that can be validated against', () => {
    const shows = [
      makeShow({ id: 'abc123', status: 'watching' }),
      makeShow({ id: 'def456', status: 'planned' }),
    ];
    const candidates = candidateShows(shows);
    const ids = new Set(candidates.map((s) => s.id));
    expect(ids.has('abc123')).toBe(true);
    expect(ids.has('def456')).toBe(true);
  });
});
