import { describe, expect, it } from 'vitest';
import { buildViewerProfiles, candidateShows } from '../lib/recommendationContext';
import { buildPrompt } from '../lib/buildRecommendPrompt';
import type { Show, ShowList, MemberRating } from '../types';
import type { MoodEntry, ViewerPreferenceProfile } from '../lib/recommendationContext';
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

function makeProfile(name: string): ViewerPreferenceProfile {
  return {
    uid: 'u1',
    name,
    stronglyLiked: [],
    conditionallyLiked: [],
    weaklyLiked: [],
    disliked: [],
    notedButUnrated: [],
  };
}

/* ------------------------------------------------------------ */
/* buildViewerProfiles                                          */
/* ------------------------------------------------------------ */

describe('buildViewerProfiles', () => {
  it('puts 8+ shows in stronglyLiked', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({ id: 's1', ratings: { u1: makeRating(8) }, vibeTags: ['Epic'] });
    const profiles = buildViewerProfiles([show], [member]);
    expect(profiles.u1.stronglyLiked).toHaveLength(1);
    expect(profiles.u1.stronglyLiked[0].title).toBe('Test Show');
    expect(profiles.u1.conditionallyLiked).toHaveLength(0);
  });

  it('puts 6-7.9 shows in conditionallyLiked, not excluded', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({ id: 's1', ratings: { u1: makeRating(6) } });
    const profiles = buildViewerProfiles([show], [member]);
    expect(profiles.u1.conditionallyLiked).toHaveLength(1);
    expect(profiles.u1.conditionallyLiked[0].composite).toBeCloseTo(6);
    expect(profiles.u1.stronglyLiked).toHaveLength(0);
  });

  it('puts 4-5.9 shows in weaklyLiked', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({ id: 's1', ratings: { u1: makeRating(5) } });
    const profiles = buildViewerProfiles([show], [member]);
    expect(profiles.u1.weaklyLiked).toHaveLength(1);
    expect(profiles.u1.conditionallyLiked).toHaveLength(0);
  });

  it('puts <4 shows in disliked', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({ id: 's1', ratings: { u1: makeRating(3) } });
    const profiles = buildViewerProfiles([show], [member]);
    expect(profiles.u1.disliked).toHaveLength(1);
    expect(profiles.u1.weaklyLiked).toHaveLength(0);
  });

  it('puts unrated shows with notes in notedButUnrated', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({
      id: 's1',
      ratings: {},
      memberNotes: { u1: 'really want to try this' },
    });
    const profiles = buildViewerProfiles([show], [member]);
    expect(profiles.u1.notedButUnrated).toHaveLength(1);
    expect(profiles.u1.notedButUnrated[0].note).toBe('really want to try this');
  });

  it('uses memberNotes[uid] over legacy notes field', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({
      id: 's1',
      ratings: { u1: makeRating(9) },
      notes: 'legacy note',
      memberNotes: { u1: 'personal note' },
    });
    const profiles = buildViewerProfiles([show], [member]);
    expect(profiles.u1.stronglyLiked[0].note).toBe('personal note');
  });

  it('falls back to legacy notes when memberNotes is absent', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({
      id: 's1',
      ratings: { u1: makeRating(9) },
      notes: 'old legacy note',
      memberNotes: undefined,
    });
    const profiles = buildViewerProfiles([show], [member]);
    expect(profiles.u1.stronglyLiked[0].note).toBe('old legacy note');
  });

  it('handles member with no ratings gracefully', () => {
    const member = makeMember('u2', 'Bob');
    const show = makeShow({ id: 's1', ratings: {} });
    const profiles = buildViewerProfiles([show], [member]);
    expect(profiles.u2.stronglyLiked).toHaveLength(0);
    expect(profiles.u2.conditionallyLiked).toHaveLength(0);
    expect(profiles.u2.notedButUnrated).toHaveLength(0);
  });

  it('produces an entry for each member', () => {
    const members = [makeMember('u1', 'Alice'), makeMember('u2', 'Bob')];
    const profiles = buildViewerProfiles([], members);
    expect(Object.keys(profiles)).toEqual(['u1', 'u2']);
    expect(profiles.u1.name).toBe('Alice');
    expect(profiles.u2.name).toBe('Bob');
  });

  it('includes wouldRewatch in rated entries', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({
      id: 's1',
      ratings: { u1: { story: 8, characters: 8, vibes: 8, wouldRewatch: 'yes', brainPower: null, ratedAt: null } },
    });
    const profiles = buildViewerProfiles([show], [member]);
    expect(profiles.u1.stronglyLiked[0].wouldRewatch).toBe('yes');
  });

  it('uses per-person brainPower from rating (not legacy show.brainPower)', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({
      id: 's1',
      ratings: { u1: { story: 8, characters: 8, vibes: 8, wouldRewatch: null, brainPower: 3, ratedAt: null } },
      brainPower: 5, // legacy fallback — should NOT be used when per-person is set
    });
    const profiles = buildViewerProfiles([show], [member]);
    expect(profiles.u1.stronglyLiked[0].brainPower).toBe(3);
  });

  it('falls back to legacy show.brainPower when per-person brainPower is null', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({
      id: 's1',
      ratings: { u1: { story: 8, characters: 8, vibes: 8, wouldRewatch: null, brainPower: null, ratedAt: null } },
      brainPower: 2,
    });
    const profiles = buildViewerProfiles([show], [member]);
    expect(profiles.u1.stronglyLiked[0].brainPower).toBe(2);
  });

  it('brainPower in rated entry is null when neither per-person nor legacy is set', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({
      id: 's1',
      ratings: { u1: makeRating(9) },
      brainPower: null,
    });
    const profiles = buildViewerProfiles([show], [member]);
    expect(profiles.u1.stronglyLiked[0].brainPower).toBeNull();
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
/* candidateShows — tiered filtering                           */
/* ------------------------------------------------------------ */

describe('candidateShows tiered filtering', () => {
  it('tier 1: prefers shows where all present viewers are watchers', () => {
    const allPresent = makeShow({ id: 'all', status: 'planned', watchers: ['u1', 'u2'] });
    const onePresent = makeShow({ id: 'one', status: 'planned', watchers: ['u1'] });
    const result = candidateShows([allPresent, onePresent], ['u1', 'u2']);
    expect(result.map((s) => s.id)).toEqual(['all']);
  });

  it('tier 1 includes legacy (empty-watcher) shows before tier 2 overlap shows', () => {
    const legacy = makeShow({ id: 'legacy', status: 'planned', watchers: [] });
    const partial = makeShow({ id: 'partial', status: 'planned', watchers: ['u1'] });
    const result = candidateShows([legacy, partial], ['u1', 'u2']);
    expect(result.map((s) => s.id)).toContain('legacy');
    expect(result.map((s) => s.id)).not.toContain('partial');
  });

  it('tier 2: falls back to any-overlap when no all-present matches', () => {
    const u1only = makeShow({ id: 'u1only', status: 'watching', watchers: ['u1'] });
    const u2only = makeShow({ id: 'u2only', status: 'watching', watchers: ['u2'] });
    const result = candidateShows([u1only, u2only], ['u1', 'u2']);
    expect(result.map((s) => s.id)).toContain('u1only');
    expect(result.map((s) => s.id)).toContain('u2only');
  });

  it('tier 3: falls back to all eligible when no viewer overlap', () => {
    const u3show = makeShow({ id: 'u3', status: 'planned', watchers: ['u3'] });
    const result = candidateShows([u3show], ['u1', 'u2']);
    expect(result.map((s) => s.id)).toContain('u3');
  });
});

/* ------------------------------------------------------------ */
/* candidate payload structure                                  */
/* ------------------------------------------------------------ */

describe('recommendation payload structure', () => {
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

/* ------------------------------------------------------------ */
/* buildPrompt                                                  */
/* ------------------------------------------------------------ */

function makeMood(name: string, mood = ''): MoodEntry {
  return { name, mood };
}

describe('buildPrompt', () => {
  it('includes candidate show ID in the prompt', () => {
    const candidates = [makeShow({ id: 'show-xyz', status: 'watching' })];
    const moods = { u1: makeMood('Alice', 'tired') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    expect(prompt).toContain('id:show-xyz');
  });

  it('includes mood display names in the mood section', () => {
    const candidates = [makeShow({ status: 'watching' })];
    const moods = { u1: makeMood('Alice', 'chill'), u2: makeMood('Bob', 'hyped') };
    const profiles = { u1: makeProfile('Alice'), u2: makeProfile('Bob') };
    const prompt = buildPrompt(moods, candidates, profiles);
    expect(prompt).toContain('Alice: chill');
    expect(prompt).toContain('Bob: hyped');
  });

  it('includes sharedMood prominently in the prompt', () => {
    const candidates = [makeShow({ status: 'watching' })];
    const moods = { u1: makeMood('Alice') };
    const profiles = { u1: makeProfile('Alice') };
    const shared = 'Jimi is brain dead after work. Kait wants something exciting.';
    const prompt = buildPrompt(moods, candidates, profiles, shared);
    expect(prompt).toContain(shared);
    expect(prompt).toContain("TONIGHT'S VIBE");
  });

  it('sharedMood section instructs parsing named viewers', () => {
    const candidates = [makeShow({ status: 'watching' })];
    const moods = { u1: makeMood('Alice') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles, 'Jimi is tired');
    expect(prompt).toContain('parse');
    expect(prompt).toContain('named');
  });

  it('does not include sharedMood section when absent', () => {
    const candidates = [makeShow({ status: 'watching' })];
    const moods = { u1: makeMood('Alice', 'tired') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    // Section header only appears when sharedMood is provided
    expect(prompt).not.toContain("TONIGHT'S VIBE (highest priority");
  });

  it('decision rules mention brain dead and multitasking as low brain-power signals', () => {
    const candidates = [makeShow({ status: 'watching' })];
    const moods = { u1: makeMood('Alice') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles, 'Jimi is brain dead');
    expect(prompt).toContain('brain dead');
    expect(prompt).toContain('multitasking');
  });

  it('decision rules instruct per-viewer brain power evaluation', () => {
    const candidates = [makeShow({ status: 'watching' })];
    const moods = { u1: makeMood('Alice') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    expect(prompt).toContain('per viewer');
  });

  it('includes all rating bands in viewer profiles, not only high scores', () => {
    const member = makeMember('u1', 'Alice');
    const highShow = makeShow({ id: 's1', ratings: { u1: makeRating(9) }, vibeTags: ['Epic'] });
    const midShow = makeShow({ id: 's2', title: 'Mid Show', ratings: { u1: makeRating(6.5) }, vibeTags: ['Chill'] });
    const lowShow = makeShow({ id: 's3', title: 'Low Show', ratings: { u1: makeRating(3) }, vibeTags: ['Dark'] });
    const profiles = buildViewerProfiles([highShow, midShow, lowShow], [member]);
    const moods = { u1: makeMood('Alice', 'tired') };
    const prompt = buildPrompt(moods, [], profiles);
    expect(prompt).toContain('Loved (8–10)');
    expect(prompt).toContain('Liked conditionally (6–7.9');
    expect(prompt).toContain('Disliked (<4)');
  });

  it('a 6-rated show appears in conditionallyLiked in the prompt', () => {
    const member = makeMember('u1', 'Alice');
    const show = makeShow({ id: 's1', title: 'Mid Show', ratings: { u1: makeRating(6) } });
    const profiles = buildViewerProfiles([show], [member]);
    const moods = { u1: makeMood('Alice') };
    const prompt = buildPrompt(moods, [], profiles);
    expect(prompt).toContain('Liked conditionally');
    expect(prompt).toContain('Mid Show');
  });

  it('includes per-viewer composite rating in candidate section', () => {
    const uid = 'u1';
    const candidates = [makeShow({
      id: 'c1',
      status: 'watching',
      ratings: { [uid]: makeRating(7.5) },
    })];
    const moods = { [uid]: makeMood('Alice', 'chill') };
    const profiles = { [uid]: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    expect(prompt).toContain('7.5/10');
  });

  it('includes story, characters, and vibes component scores in candidate per-viewer section', () => {
    const uid = 'u1';
    const candidates = [makeShow({
      id: 'c1',
      status: 'watching',
      ratings: { [uid]: { story: 6, characters: 8, vibes: 9, wouldRewatch: null, brainPower: null, ratedAt: null } },
    })];
    const moods = { [uid]: makeMood('Alice', 'chill') };
    const profiles = { [uid]: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    expect(prompt).toContain('story:6');
    expect(prompt).toContain('chars:8');
    expect(prompt).toContain('vibes:9');
  });

  it('includes per-viewer brainPower in candidate viewer signal', () => {
    const uid = 'u1';
    const candidates = [makeShow({
      id: 'c1',
      status: 'watching',
      ratings: { [uid]: { story: 8, characters: 8, vibes: 8, wouldRewatch: null, brainPower: 2, ratedAt: null } },
    })];
    const moods = { [uid]: makeMood('Alice', 'tired') };
    const profiles = { [uid]: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    expect(prompt).toContain('brain:2/5');
  });

  it('falls back to legacy show.brainPower in viewer signal when per-person brainPower is null', () => {
    const candidates = [makeShow({ status: 'watching', brainPower: 1 })];
    const moods = { u1: makeMood('Alice') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    // Legacy brainPower=1 appears in viewer signal (unrated viewer with legacy fallback)
    expect(prompt).toContain('brain:1/5');
  });

  it('no brain in viewer signal when both per-person and legacy brainPower are null', () => {
    const candidates = [makeShow({ status: 'watching', brainPower: null })];
    const moods = { u1: makeMood('Alice') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    // Old global format must be gone
    expect(prompt).not.toContain('brain: unknown');
    // No brain:N/5 should appear in any viewer signal (the digit distinguishes from rules text)
    expect(prompt).not.toMatch(/Alice:.*brain:\d/);
  });

  it('does not show a global brain power header line in the candidate section', () => {
    const candidates = [makeShow({ status: 'watching', brainPower: 3 })];
    const moods = { u1: makeMood('Alice') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    // Old format "brain: X/5 (label)" should be gone from the candidate header
    expect(prompt).not.toContain('| brain: 3/5');
  });

  it('includes wouldRewatch in candidate per-viewer section', () => {
    const uid = 'u1';
    const candidates = [makeShow({
      id: 'c1',
      status: 'watching',
      ratings: { [uid]: { story: 8, characters: 8, vibes: 8, wouldRewatch: 'yes', brainPower: null, ratedAt: null } },
    })];
    const moods = { [uid]: makeMood('Alice', 'chill') };
    const profiles = { [uid]: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    expect(prompt).toContain('wr:yes');
  });

  it('labels per-person notes with display name, not raw UID', () => {
    const uid = 'u1';
    const candidates = [makeShow({
      id: 'ns1',
      status: 'watching',
      memberNotes: { [uid]: 'love this series' },
    })];
    const moods = { [uid]: makeMood('Alice', 'chill') };
    const profiles = { [uid]: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    expect(prompt).toContain('Alice');
    expect(prompt).toContain('love this series');
    expect(prompt).not.toContain(`[${uid}]`);
  });

  it('falls back to UID label for notes from absent viewers', () => {
    const candidates = [makeShow({
      id: 'ns2',
      status: 'watching',
      memberNotes: { absentUid: 'a note from someone not watching tonight' },
    })];
    const moods = { u1: makeMood('Alice', 'chill') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    expect(prompt).toContain('[absentUid]');
  });

  it('includes service when present', () => {
    const candidates = [makeShow({ status: 'watching', service: 'Crunchyroll' })];
    const moods = { u1: makeMood('Alice') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    expect(prompt).toContain('service: Crunchyroll');
  });

  it('uses legacy notes field when memberNotes is absent', () => {
    const candidates = [makeShow({
      status: 'watching',
      notes: 'old shared note',
      memberNotes: undefined,
    })];
    const moods = { u1: makeMood('Alice') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    expect(prompt).toContain('old shared note');
  });

  it('includes the VIEWER PREFERENCE PROFILES section header', () => {
    const moods = { u1: makeMood('Alice') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, [], profiles);
    expect(prompt).toContain('VIEWER PREFERENCE PROFILES');
    expect(prompt).toContain('Alice');
  });

  it('rules instruct not to simply pick the highest-rated show', () => {
    const moods = { u1: makeMood('Alice') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, [], profiles);
    expect(prompt).toContain('DO NOT simply pick the highest-rated show');
  });

  it('includes pre-score for each candidate', () => {
    const candidates = [makeShow({ id: 'c1', status: 'watching', brainPower: 1, vibeTags: ['Funny', 'Lighthearted'] })];
    const moods = { u1: makeMood('Alice', 'brain dead and want something funny') };
    const profiles = { u1: makeProfile('Alice') };
    const prompt = buildPrompt(moods, candidates, profiles);
    expect(prompt).toContain('preScore:');
    expect(prompt).toContain('overall=');
  });

  it('per-viewer brainPower differs between viewers in the same candidate line', () => {
    // Jimi thinks the show is easy (bp=2), Kait thinks it is dense (bp=4)
    const candidates = [makeShow({
      id: 'c1',
      status: 'watching',
      ratings: {
        jimi: { story: 8, characters: 8, vibes: 8, wouldRewatch: null, brainPower: 2, ratedAt: null },
        kait: { story: 7, characters: 7, vibes: 7, wouldRewatch: null, brainPower: 4, ratedAt: null },
      },
    })];
    const moods = { jimi: makeMood('Jimi', 'brain dead'), kait: makeMood('Kait', 'up for anything') };
    const profiles = { jimi: makeProfile('Jimi'), kait: makeProfile('Kait') };
    const prompt = buildPrompt(moods, candidates, profiles);
    expect(prompt).toContain('brain:2/5');
    expect(prompt).toContain('brain:4/5');
  });
});
