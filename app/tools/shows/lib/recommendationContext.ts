import type { Show, ShowList } from '../types';
import { memberComposite } from './compositeScore';

export interface MoodEntry {
  name: string;
  mood: string;
}

export interface HistoryShow {
  title: string;
  vibes: string[];
  composite: number;
  description: string;
  /** Member's personal note for this show (memberNotes[uid] ?? legacy notes). */
  note: string;
}

export interface HistoryEntry {
  name: string;
  highScoringShows: HistoryShow[];
}

export function buildHistory(
  shows: Show[],
  members: ShowList['members'],
): Record<string, HistoryEntry> {
  const history: Record<string, HistoryEntry> = {};
  for (const member of members) {
    const highScoringShows = shows.flatMap((show) => {
      const rating = show.ratings[member.uid];
      if (!rating) return [];
      const composite = memberComposite(rating);
      if (composite === null || composite < 7) return [];
      // Prefer per-person note, fall back to legacy shared notes
      const note = show.memberNotes?.[member.uid] ?? show.notes ?? '';
      return [{
        title: show.title,
        vibes: show.vibeTags,
        composite,
        description: show.description ?? '',
        note,
      }];
    });
    history[member.uid] = { name: member.displayName, highScoringShows };
  }
  return history;
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
