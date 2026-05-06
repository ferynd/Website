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
 * When presentUids is provided, prefers shows whose watchers overlap with the
 * present viewers. Falls back to all eligible shows if no match to preserve
 * legacy behavior for older shows with missing watcher data.
 */
export function candidateShows(shows: Show[], presentUids?: string[]): Show[] {
  const eligible = shows.filter(
    (s) => s.status === 'watching' || s.status === 'planned' || s.status === 'on_hold',
  );

  if (!presentUids || presentUids.length === 0) return eligible;

  const present = new Set(presentUids);
  const matched = eligible.filter(
    // Shows with no watcher data (legacy) are included; otherwise require overlap
    (s) => s.watchers.length === 0 || s.watchers.some((uid) => present.has(uid)),
  );

  // If nothing matches (all shows have explicit watchers for different people),
  // fall back to all eligible so the user always gets a pick.
  return matched.length > 0 ? matched : eligible;
}
