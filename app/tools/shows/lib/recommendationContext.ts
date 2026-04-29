import type { Show, ShowList } from '../types';
import { memberComposite } from './compositeScore';

export interface MoodEntry {
  name: string;
  mood: string;
}

export interface HistoryEntry {
  name: string;
  highScoringShows: Array<{
    title: string;
    vibes: string[];
    composite: number;
    description: string;
    notes: string;
  }>;
}

export function buildHistory(
  shows: Show[],
  members: ShowList['members'],
): Record<string, HistoryEntry> {
  const history: Record<string, HistoryEntry> = {};
  for (const member of members) {
    const highScoringShows = shows
      .flatMap((show) => {
        const rating = show.ratings[member.uid];
        if (!rating) return [];
        const composite = memberComposite(rating);
        if (composite === null || composite < 7) return [];
        return [{
          title: show.title,
          vibes: show.vibeTags,
          composite,
          description: show.description ?? '',
          notes: show.notes ?? '',
        }];
      });
    history[member.uid] = { name: member.displayName, highScoringShows };
  }
  return history;
}

export function candidateShows(shows: Show[]): Show[] {
  return shows.filter((s) =>
    s.status === 'watching' || s.status === 'planned' || s.status === 'on_hold',
  );
}
