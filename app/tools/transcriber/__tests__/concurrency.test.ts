import { describe, expect, it } from 'vitest';
import { mapWithConcurrency, type SettledItem } from '../lib/concurrency';

/** A manually-resolvable gate so tests can control exactly when each worker finishes. */
function createGate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function values<R>(results: SettledItem<R>[]): (R | undefined)[] {
  return results.map((r) => (r.status === 'fulfilled' ? r.value : undefined));
}

describe('mapWithConcurrency', () => {
  it('returns results in input order regardless of completion order', async () => {
    const gates = [createGate(), createGate(), createGate()];
    const running = mapWithConcurrency([0, 1, 2], 3, async (item) => {
      await gates[item].promise;
      return item * 10;
    });
    // Finish in reverse order.
    gates[2].open();
    gates[1].open();
    gates[0].open();
    const results = await running;
    expect(values(results)).toEqual([0, 10, 20]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return item;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(results).toHaveLength(10);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('captures rejections per item without failing the others', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error('boom');
      return item;
    });
    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 });
    expect(results[1].status).toBe('rejected');
    expect((results[1] as { reason: Error }).reason.message).toBe('boom');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 });
  });

  it('stopOnError skips items that have not started yet', async () => {
    const attempted: number[] = [];
    const results = await mapWithConcurrency(
      [0, 1, 2, 3, 4],
      1,
      async (item) => {
        attempted.push(item);
        if (item === 1) throw new Error('halt');
        return item;
      },
      { stopOnError: true },
    );
    expect(attempted).toEqual([0, 1]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(results[2].status).toBe('skipped');
    expect(results[3].status).toBe('skipped');
    expect(results[4].status).toBe('skipped');
  });

  it('without stopOnError every item is attempted even after failures', async () => {
    const attempted: number[] = [];
    const results = await mapWithConcurrency([0, 1, 2, 3], 2, async (item) => {
      attempted.push(item);
      throw new Error(`fail-${item}`);
    });
    expect(attempted.sort()).toEqual([0, 1, 2, 3]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('handles an empty input and a limit larger than the input', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    const results = await mapWithConcurrency([7], 99, async (item) => item);
    expect(values(results)).toEqual([7]);
  });
});
