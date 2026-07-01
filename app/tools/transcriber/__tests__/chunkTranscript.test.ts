import { describe, expect, it } from 'vitest';
import { createChunkWindows, segmentsInWindow } from '../lib/chunkTranscript';

describe('createChunkWindows', () => {
  it('returns a single window when the recording is shorter than one chunk', () => {
    const windows = createChunkWindows(300, { chunkSeconds: 900, overlapSeconds: 90 });
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ index: 0, coreStart: 0, coreEnd: 300, windowStart: 0, windowEnd: 300 });
  });

  it('splits a long recording into contiguous, non-overlapping core windows', () => {
    const windows = createChunkWindows(2000, { chunkSeconds: 900, overlapSeconds: 90 });
    expect(windows).toHaveLength(3);
    expect(windows[0].coreStart).toBe(0);
    expect(windows[0].coreEnd).toBe(900);
    expect(windows[1].coreStart).toBe(900);
    expect(windows[1].coreEnd).toBe(1800);
    expect(windows[2].coreStart).toBe(1800);
    expect(windows[2].coreEnd).toBe(2000);
  });

  it('pads window bounds with overlap on both sides, clamped to recording bounds', () => {
    const windows = createChunkWindows(2000, { chunkSeconds: 900, overlapSeconds: 90 });
    expect(windows[0].windowStart).toBe(0); // clamped — no overlap before the start
    expect(windows[0].windowEnd).toBe(990); // 900 + 90
    expect(windows[1].windowStart).toBe(810); // 900 - 90
    expect(windows[1].windowEnd).toBe(1890); // 1800 + 90
    expect(windows[2].windowEnd).toBe(2000); // clamped — no overlap past the end
  });

  it('returns an empty array for a zero or negative duration', () => {
    expect(createChunkWindows(0)).toEqual([]);
    expect(createChunkWindows(-10)).toEqual([]);
  });
});

describe('segmentsInWindow', () => {
  const segments = [
    { start: 0, end: 10 },
    { start: 895, end: 905 }, // straddles the 900s boundary
    { start: 1800, end: 1810 },
  ];

  it('includes segments that intersect the (overlap-padded) window range', () => {
    const [window] = createChunkWindows(2000, { chunkSeconds: 900, overlapSeconds: 90 });
    const inWindow = segmentsInWindow(segments, window);
    expect(inWindow).toEqual([segments[0], segments[1]]);
  });

  it('excludes segments entirely outside the window range', () => {
    const windows = createChunkWindows(2000, { chunkSeconds: 900, overlapSeconds: 90 });
    const inFirstWindow = segmentsInWindow(segments, windows[0]);
    expect(inFirstWindow).not.toContainEqual(segments[2]);
  });
});
