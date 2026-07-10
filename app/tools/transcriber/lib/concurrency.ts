// Bounded-parallelism helper for the Transcriber's per-chunk API calls
// (OpenAI chunked transcription in lib/providers/openaiProvider.ts, the
// Gemini cleanup pass in useTranscriberPipeline.ts). Pure — no browser
// APIs — so it's directly unit-testable under vitest.
//
// Deliberately NOT the shows tool's same-named helper
// (app/tools/shows/lib/concurrency.ts): that one is fail-fast (first
// rejection rejects the whole map), while chunk processing here needs
// allSettled semantics — every chunk is attempted, failures are captured
// per item so completed chunks can be cached for resume — plus an optional
// stop-on-error mode for the strict cleanup setting.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

/** One item's outcome from mapWithConcurrency — allSettled-style, plus
 * 'skipped' for items never started because `stopOnError` tripped first. */
export type SettledItem<R> =
  | { status: 'fulfilled'; value: R }
  | { status: 'rejected'; reason: unknown }
  | { status: 'skipped' };

export interface MapWithConcurrencyOptions {
  /** When true, a rejection stops NEW items from starting (items already
   * in flight still run to completion and report their own outcome);
   * never-started items come back as {status: 'skipped'}. Default false —
   * every item is always attempted. */
  stopOnError?: boolean;
}

/**
 * Runs `worker` over every item with at most `limit` calls in flight at
 * once. The returned array is parallel to `items` (order preserved, one
 * SettledItem per input) regardless of completion order. Rejections are
 * captured per item, never thrown — the caller decides what a failure
 * means (fall back, retry, abort the run, ...).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  options: MapWithConcurrencyOptions = {},
): Promise<SettledItem<R>[]> {
  const results: SettledItem<R>[] = items.map(() => ({ status: 'skipped' }));
  if (items.length === 0) return results;

  const effectiveLimit = Math.max(1, Math.min(items.length, Math.floor(limit)));
  let nextIndex = 0;
  let stopped = false;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length && !stopped) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        const value = await worker(items[index], index);
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
        if (options.stopOnError) stopped = true;
      }
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => runNext()));
  return results;
}
