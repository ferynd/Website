// Shared cache-hit/miss + replay logic for the client-side resume caches
// (speaker-repair batches, cleanup windows, classification windows in
// useTranscriberPipeline.ts). Each of those caches stores more than the
// functional result: also the provider-reported usage and whether the
// response carried an invalid-response warning, so a resumed run that
// serves an item from cache still reports the SAME usage totals and
// warning codes the original run did — never silently dropping them, and
// never estimating usage that wasn't actually reported.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import type { StageUsage } from './types';

/** One cached stage item: the functional result plus everything needed to
 * replay its usage/warning contribution on a later cache hit exactly as
 * the original (fresh) request did. */
export interface CachedStageResult<T> {
  result: T;
  usage?: StageUsage;
  /** True when the original response carried the server's `warning` field
   * (invalid/unknown/duplicate items after retry). */
  hadWarning: boolean;
}

/**
 * Resolves one cached stage item: on a cache hit, replays its usage
 * (`onUsage`) and warning (`onInvalidWarning`) contribution exactly as the
 * original fetch did, then returns the cached functional result — no
 * network call. On a miss, awaits `fetch`, replays that fresh response's
 * usage/warning the same way, stores the enriched entry in `cache` under
 * `key`, and returns its functional result. Each key is resolved through
 * exactly one branch per call — never both — so this never double-counts
 * usage or warnings within a single run.
 */
export async function withStageResultCache<K, T>(
  cache: Map<K, CachedStageResult<T>>,
  key: K,
  fetchFresh: () => Promise<CachedStageResult<T>>,
  onUsage: (usage: StageUsage) => void,
  onInvalidWarning: () => void,
): Promise<T> {
  const cached = cache.get(key);
  if (cached) {
    if (cached.usage) onUsage(cached.usage);
    if (cached.hadWarning) onInvalidWarning();
    return cached.result;
  }
  const fresh = await fetchFresh();
  if (fresh.usage) onUsage(fresh.usage);
  if (fresh.hadWarning) onInvalidWarning();
  cache.set(key, fresh);
  return fresh.result;
}
