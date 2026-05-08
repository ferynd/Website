import type { Show, ShowList, WouldRewatch } from '../types';
import { memberComposite } from './compositeScore';

export interface MoodEntry {
  name: string;
  mood: string;
}

/** A single show entry in a viewer's rated history. */
export interface RatedShowEntry {
  title: string;
  composite: number;
  story: number | null;
  characters: number | null;
  vibes: number | null;
  wouldRewatch: WouldRewatch | null;
  vibeTags: string[];
  brainPower: number | null;
  note: string;
  description: string;
}

/** A show with notes but no composite rating. */
export interface NotedUnratedEntry {
  title: string;
  note: string;
  vibeTags: string[];
}

/**
 * Rich per-viewer preference profile built from all rated/noted shows.
 *
 * Rating bands:
 *   8–10  → stronglyLiked        (clear positive signal)
 *   6–7.9 → conditionallyLiked   (can still be great if tonight's mood matches)
 *   4–5.9 → weaklyLiked          (use cautiously)
 *   <4    → disliked             (negative signal unless notes explain otherwise)
 *   unrated with note → notedButUnrated
 */
export interface ViewerPreferenceProfile {
  uid: string;
  name: string;
  stronglyLiked: RatedShowEntry[];
  conditionallyLiked: RatedShowEntry[];
  weaklyLiked: RatedShowEntry[];
  disliked: RatedShowEntry[];
  notedButUnrated: NotedUnratedEntry[];
}

function toRatedEntry(show: Show, uid: string, composite: number): RatedShowEntry {
  const r = show.ratings[uid];
  return {
    title: show.title,
    composite,
    story: r?.story ?? null,
    characters: r?.characters ?? null,
    vibes: r?.vibes ?? null,
    wouldRewatch: r?.wouldRewatch ?? null,
    vibeTags: show.vibeTags,
    // Use the viewer's own per-person estimate; fall back to legacy show-level brainPower
    brainPower: r?.brainPower ?? show.brainPower ?? null,
    note: show.memberNotes?.[uid] ?? show.notes ?? '',
    description: show.description ?? '',
  };
}

/**
 * Builds a rich preference profile for each present viewer using ALL rated
 * and noted shows — not just high-scoring ones.
 */
export function buildViewerProfiles(
  shows: Show[],
  members: ShowList['members'],
): Record<string, ViewerPreferenceProfile> {
  const profiles: Record<string, ViewerPreferenceProfile> = {};

  for (const member of members) {
    const profile: ViewerPreferenceProfile = {
      uid: member.uid,
      name: member.displayName,
      stronglyLiked: [],
      conditionallyLiked: [],
      weaklyLiked: [],
      disliked: [],
      notedButUnrated: [],
    };

    for (const show of shows) {
      const rating = show.ratings[member.uid];
      const composite = rating ? memberComposite(rating) : null;
      const note = show.memberNotes?.[member.uid] ?? show.notes ?? '';

      if (composite !== null) {
        const entry = toRatedEntry(show, member.uid, composite);
        if (composite >= 8) {
          profile.stronglyLiked.push(entry);
        } else if (composite >= 6) {
          profile.conditionallyLiked.push(entry);
        } else if (composite >= 4) {
          profile.weaklyLiked.push(entry);
        } else {
          profile.disliked.push(entry);
        }
      } else if (note.trim()) {
        profile.notedButUnrated.push({ title: show.title, note, vibeTags: show.vibeTags });
      }
    }

    profiles[member.uid] = profile;
  }

  return profiles;
}

/**
 * Returns shows eligible for recommendation (watching / planned / on_hold).
 *
 * Tiered preference when presentUids is provided:
 *   Tier 1 — empty-watcher shows (legacy) + shows where ALL present viewers are watchers
 *   Tier 2 — shows where ANY present viewer is a watcher
 *   Tier 3 — all eligible (fallback, ensures the picker is never empty)
 */
export function candidateShows(shows: Show[], presentUids?: string[]): Show[] {
  const eligible = shows.filter(
    (s) => s.status === 'watching' || s.status === 'planned' || s.status === 'on_hold',
  );

  if (!presentUids || presentUids.length === 0) return eligible;

  const present = new Set(presentUids);

  // Tier 1: legacy shows (no watcher data) + shows every present viewer is watching
  const tier1 = eligible.filter(
    (s) => s.watchers.length === 0 || presentUids.every((uid) => s.watchers.includes(uid)),
  );
  if (tier1.length > 0) return tier1;

  // Tier 2: at least one present viewer is a watcher
  const tier2 = eligible.filter((s) => s.watchers.some((uid) => present.has(uid)));
  if (tier2.length > 0) return tier2;

  // Tier 3: fallback — all eligible
  return eligible;
}
