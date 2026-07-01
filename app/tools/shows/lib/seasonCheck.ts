import type { Show } from '../types';

/** Max shows accepted per /api/seasons call — keeps provider fan-out bounded. Shared by the route and the modal that calls it. */
export const MAX_SEASON_CHECK_BATCH = 40;

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

export type SeasonCheckOutcomeCategory = 'new_season' | 'up_to_date' | 'indeterminate';

/**
 * Classifies a /api/seasons result for display. A show only counts as verified
 * "up to date" when it was actually matched to a provider AND has a known
 * recorded season count to compare against — otherwise the check was inconclusive
 * and must not be presented as confirmed current.
 */
export function classifySeasonOutcome(result: {
  matched: boolean;
  recordedSeasons?: number | null;
  hasNewSeason?: boolean;
}): SeasonCheckOutcomeCategory {
  if (!result.matched || result.recordedSeasons == null) return 'indeterminate';
  return result.hasNewSeason ? 'new_season' : 'up_to_date';
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
