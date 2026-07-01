import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../lib/concurrency';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('mapWithConcurrency', () => {
  it('processes every item and preserves output order', async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await mapWithConcurrency(items, 2, async (n) => n * 10);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it('never runs more than `limit` tasks concurrently', async () => {
    const items = Array.from({ length: 6 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;
    const gates = items.map(() => deferred<void>());

    const run = mapWithConcurrency(items, 2, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gates[i].promise;
      inFlight--;
      return i;
    });

    // Let the first wave start.
    await new Promise((r) => setTimeout(r, 0));
    expect(inFlight).toBe(2);

    // Release tasks one at a time so a third can only start once one finishes.
    for (const gate of gates) {
      gate.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }

    await run;
    expect(maxInFlight).toBe(2);
  });

  it('handles an empty input without hanging', async () => {
    const result = await mapWithConcurrency([], 5, async () => 1);
    expect(result).toEqual([]);
  });

  it('clamps a non-positive limit to at least one worker', async () => {
    const result = await mapWithConcurrency([1, 2, 3], 0, async (n) => n);
    expect(result).toEqual([1, 2, 3]);
  });

  it('uses fewer workers than limit when there are fewer items', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    await mapWithConcurrency([1, 2], 10, async (n) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await Promise.resolve();
      concurrent--;
      return n;
    });
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});
