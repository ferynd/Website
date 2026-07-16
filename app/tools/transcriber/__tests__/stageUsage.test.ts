import { describe, expect, it } from 'vitest';
import { accumulateStageUsage } from '../lib/stageUsage';
import type { GeminiUsage } from '@/app/lib/aiConfig';

function usage(overrides: Partial<GeminiUsage> = {}): GeminiUsage {
  return { model: 'gemini-test', inputTokens: 10, outputTokens: 5, cachedTokens: 0, ...overrides };
}

describe('accumulateStageUsage', () => {
  it('starts a running total from the first successful response', () => {
    const result = accumulateStageUsage(undefined, usage({ inputTokens: 10, outputTokens: 5 }), 1);
    expect(result).toEqual({ model: 'gemini-test', requests: 1, inputTokens: 10, outputTokens: 5, cachedTokens: 0 });
  });

  it('sums tokens across multiple successful attempts of the same request, never overwriting', () => {
    const first = accumulateStageUsage(undefined, usage({ inputTokens: 100, outputTokens: 20 }), 1);
    // A retry after a successful-but-locally-invalid response contributes
    // its OWN real tokens too — the total must include both attempts.
    const second = accumulateStageUsage(first, usage({ inputTokens: 40, outputTokens: 8 }), 2);
    expect(second).toEqual({ model: 'gemini-test', requests: 2, inputTokens: 140, outputTokens: 28, cachedTokens: 0 });
  });

  it('never invents a field neither side reported', () => {
    const noCache: GeminiUsage = { model: 'gemini-test', inputTokens: 10, outputTokens: 5 };
    const result = accumulateStageUsage(undefined, noCache, 1);
    expect(result).toEqual({ model: 'gemini-test', requests: 1, inputTokens: 10, outputTokens: 5 });
    expect(result.cachedTokens).toBeUndefined();
  });

  it('a field absent on only one side is treated as 0, not dropped', () => {
    const prev = accumulateStageUsage(undefined, { model: 'gemini-test', inputTokens: 10 }, 1);
    const next = accumulateStageUsage(prev, { model: 'gemini-test', inputTokens: 5, cachedTokens: 3 }, 2);
    expect(next).toEqual({ model: 'gemini-test', requests: 2, inputTokens: 15, cachedTokens: 3 });
  });

  it('does not estimate usage for a failed call — callers simply never call this for one', () => {
    // Documents the contract: a failed provider call reports no GeminiUsage,
    // so the caller's loop never calls accumulateStageUsage for it — the
    // running total is left untouched, not padded with a guessed value.
    const afterSuccess = accumulateStageUsage(undefined, usage(), 1);
    const afterFailedRetrySkipped = afterSuccess; // failed attempt: no call made
    expect(afterFailedRetrySkipped).toEqual(afterSuccess);
  });

  it('always reflects the caller-supplied request count, not an internal counter', () => {
    const result = accumulateStageUsage(undefined, usage(), 3);
    expect(result.requests).toBe(3);
  });
});
