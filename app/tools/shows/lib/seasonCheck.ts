import type { Show } from '../types';

/**
 * "Check for new seasons" only supports TMDb-backed western TV (tv/cartoon), and only
 * for shows that have wound down (completed/on_hold) — those are the ones worth
 * revisiting. TMDb is the only source here with a reliable per-series season count;
 * AniList/Jikan model each cour/season of an anime as a separate entry, so there is
 * no single "season count" to compare against for anime titles.
 */
export function isSeasonCheckEligible(show: Show): boolean {
  if (show.status !== 'completed' && show.status !== 'on_hold') return false;
  return show.type === 'tv' || show.type === 'cartoon';
}

/** The season count the user has recorded for comparison — prefer the total they logged, fall back to their current position. */
export function recordedSeasonCount(show: Show): number | null {
  return show.totalSeasons ?? show.currentSeason ?? null;
}

export type SeasonAiringStatus = 'airing' | 'fully_released' | 'unknown';

export interface SeasonCheckResult {
  showId: string;
  recordedSeasons: number | null;
  latestSeasons: number;
  hasNewSeason: boolean;
  airingStatus: SeasonAiringStatus;
  nextAirDate: string | null;
  lastAirDate: string | null;
}

export function evaluateSeasonResult(opts: {
  showId: string;
  recordedSeasons: number | null;
  latestSeasons: number;
  tmdbStatus: string | null;
  nextAirDate: string | null;
  lastAirDate: string | null;
}): SeasonCheckResult {
  const { showId, recordedSeasons, latestSeasons, tmdbStatus, nextAirDate, lastAirDate } = opts;

  const hasNewSeason = recordedSeasons !== null && latestSeasons > recordedSeasons;

  let airingStatus: SeasonAiringStatus = 'unknown';
  if (tmdbStatus === 'Returning Series' && nextAirDate) {
    airingStatus = 'airing';
  } else if (lastAirDate) {
    airingStatus = 'fully_released';
  }

  return { showId, recordedSeasons, latestSeasons, hasNewSeason, airingStatus, nextAirDate, lastAirDate };
}
