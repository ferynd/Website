// Accumulates provider-reported token usage across multiple attempts of the
// SAME logical request (e.g. a retry after a successful-but-locally-invalid
// response) — every successful provider response contributes its real
// tokens; a failed call that reported no usage contributes nothing (never
// estimated/invented). Shared by the correct, speaker-repair, and classify
// routes, whose retry loops can each call the model more than once per
// request.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import type { GeminiUsage } from '@/app/lib/aiConfig';
import type { StageUsage } from './types';

function sumOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

/**
 * Folds one more successful provider response's usage into a running
 * StageUsage total. `requests` is the caller's own count of upstream
 * requests made so far (success or failure) — this function only ever
 * accumulates the TOKEN fields, never invents a request count.
 */
export function accumulateStageUsage(prev: StageUsage | undefined, usage: GeminiUsage, requests: number): StageUsage {
  const inputTokens = sumOptional(prev?.inputTokens, usage.inputTokens);
  const outputTokens = sumOptional(prev?.outputTokens, usage.outputTokens);
  const cachedTokens = sumOptional(prev?.cachedTokens, usage.cachedTokens);
  return {
    model: usage.model,
    requests,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
  };
}
