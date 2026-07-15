import { describe, expect, it, vi } from 'vitest';
import { withStageResultCache, type CachedStageResult } from '../lib/stageResultCache';
import type { StageUsage } from '../lib/types';

function usage(overrides: Partial<StageUsage> = {}): StageUsage {
  return { model: 'gemini-test', requests: 1, inputTokens: 10, outputTokens: 5, ...overrides };
}

describe('withStageResultCache', () => {
  it('fetches fresh on a miss, replays usage/warning, and stores the enriched entry', async () => {
    const cache = new Map<string, CachedStageResult<string>>();
    const onUsage = vi.fn();
    const onInvalidWarning = vi.fn();
    const fetchFresh = vi.fn(async (): Promise<CachedStageResult<string>> => ({
      result: 'patches-A',
      usage: usage({ inputTokens: 100 }),
      hadWarning: true,
    }));

    const result = await withStageResultCache(cache, 'k1', fetchFresh, onUsage, onInvalidWarning);

    expect(result).toBe('patches-A');
    expect(fetchFresh).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(usage({ inputTokens: 100 }));
    expect(onInvalidWarning).toHaveBeenCalledTimes(1);
    expect(cache.get('k1')).toEqual({ result: 'patches-A', usage: usage({ inputTokens: 100 }), hadWarning: true });
  });

  it('a resumed cache hit replays the IDENTICAL usage and warning contribution as the original fetch, without calling fetch again', async () => {
    const cache = new Map<string, CachedStageResult<string>>();
    const originalUsage = usage({ inputTokens: 250, outputTokens: 40 });

    // Simulates the original run.
    const originalOnUsage = vi.fn();
    const originalOnInvalidWarning = vi.fn();
    await withStageResultCache(
      cache,
      'k1',
      async () => ({ result: 'patches-A', usage: originalUsage, hadWarning: true }),
      originalOnUsage,
      originalOnInvalidWarning,
    );

    // Simulates a resumed run reusing the same cache object (explicit retry).
    const resumeFetch = vi.fn();
    const resumeOnUsage = vi.fn();
    const resumeOnInvalidWarning = vi.fn();
    const resumedResult = await withStageResultCache(cache, 'k1', resumeFetch, resumeOnUsage, resumeOnInvalidWarning);

    expect(resumedResult).toBe('patches-A');
    expect(resumeFetch).not.toHaveBeenCalled();
    // Same usage totals as the original request.
    expect(resumeOnUsage).toHaveBeenCalledTimes(1);
    expect(resumeOnUsage).toHaveBeenCalledWith(originalUsage);
    expect(resumeOnUsage.mock.calls[0]).toEqual(originalOnUsage.mock.calls[0]);
    // Same warning contribution as the original request.
    expect(resumeOnInvalidWarning).toHaveBeenCalledTimes(1);
  });

  it('never calls onUsage when the cached/fresh entry has no usage (never estimates)', async () => {
    const cache = new Map<string, CachedStageResult<string>>();
    const onUsage = vi.fn();
    const onInvalidWarning = vi.fn();

    await withStageResultCache(cache, 'k1', async () => ({ result: 'ok', hadWarning: false }), onUsage, onInvalidWarning);
    expect(onUsage).not.toHaveBeenCalled();
    expect(onInvalidWarning).not.toHaveBeenCalled();

    // Cache hit for the same key also never invents usage.
    const onUsage2 = vi.fn();
    const onInvalidWarning2 = vi.fn();
    await withStageResultCache(cache, 'k1', vi.fn(), onUsage2, onInvalidWarning2);
    expect(onUsage2).not.toHaveBeenCalled();
    expect(onInvalidWarning2).not.toHaveBeenCalled();
  });

  it('does not double-count within a single run: each key is resolved through exactly one branch', async () => {
    const cache = new Map<string, CachedStageResult<string>>();
    const onUsage = vi.fn();
    const onInvalidWarning = vi.fn();
    const fetchFresh = vi.fn(async (): Promise<CachedStageResult<string>> => ({
      result: 'patches-A',
      usage: usage(),
      hadWarning: true,
    }));

    // Two DIFFERENT keys processed within the same run — each should
    // contribute its own usage/warning exactly once, never combined or
    // duplicated across keys.
    await withStageResultCache(cache, 'k1', fetchFresh, onUsage, onInvalidWarning);
    await withStageResultCache(cache, 'k2', fetchFresh, onUsage, onInvalidWarning);

    expect(fetchFresh).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onInvalidWarning).toHaveBeenCalledTimes(2);
  });

  it('propagates a fetch failure without caching anything (a failed call is never cached)', async () => {
    const cache = new Map<string, CachedStageResult<string>>();
    const onUsage = vi.fn();
    const onInvalidWarning = vi.fn();

    await expect(
      withStageResultCache(
        cache,
        'k1',
        async () => {
          throw new Error('network error');
        },
        onUsage,
        onInvalidWarning,
      ),
    ).rejects.toThrow('network error');

    expect(cache.has('k1')).toBe(false);
    expect(onUsage).not.toHaveBeenCalled();
    expect(onInvalidWarning).not.toHaveBeenCalled();
  });

  it('a clean (no-warning) cached entry never contributes to the warning tally on a hit', async () => {
    const cache = new Map<string, CachedStageResult<string>>();
    await withStageResultCache(cache, 'k1', async () => ({ result: 'ok', usage: usage(), hadWarning: false }), vi.fn(), vi.fn());

    const onInvalidWarning = vi.fn();
    await withStageResultCache(cache, 'k1', vi.fn(), vi.fn(), onInvalidWarning);
    expect(onInvalidWarning).not.toHaveBeenCalled();
  });
});
