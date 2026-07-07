import { describe, expect, it } from 'vitest';
import {
  buildKeptTimeline,
  combineChunkResponses,
  createChunkTimeMapper,
  detectKeptIntervals,
  planChunks,
  MIXED_CHUNK_MODE_WARNING,
  type KeptInterval,
} from '../lib/preprocessAudioPlan';

const SAMPLE_RATE = 1000; // keeps arrays small while still exercising real frame math

function constantSamples(durationSec: number, amplitude: number): Float32Array {
  const n = Math.round(durationSec * SAMPLE_RATE);
  return new Float32Array(n).fill(amplitude);
}

function concat(...arrays: Float32Array[]): Float32Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

const SPEECH_AMPLITUDE = 0.5; // ~-6 dBFS, well above the -45 dBFS threshold
const SILENCE_AMPLITUDE = 0; // -Infinity -> floored, well below the threshold

describe('detectKeptIntervals', () => {
  it('removes a long middle silence but keeps the edge pads with the surrounding speech', () => {
    const samples = concat(
      constantSamples(2, SPEECH_AMPLITUDE),
      constantSamples(3, SILENCE_AMPLITUDE),
      constantSamples(2, SPEECH_AMPLITUDE),
    );
    const kept = detectKeptIntervals(samples, SAMPLE_RATE);
    expect(kept).toEqual([
      { start: 0, end: 2.25 },
      { start: 4.75, end: 7 },
    ]);
  });

  it('ignores a silence run shorter than MIN_REMOVABLE_SILENCE_SECONDS', () => {
    const samples = concat(
      constantSamples(2, SPEECH_AMPLITUDE),
      constantSamples(0.5, SILENCE_AMPLITUDE),
      constantSamples(2, SPEECH_AMPLITUDE),
    );
    const kept = detectKeptIntervals(samples, SAMPLE_RATE);
    expect(kept).toEqual([{ start: 0, end: 4.5 }]);
  });

  it('falls back to the whole buffer when everything would be removed (all silence)', () => {
    const samples = constantSamples(3, SILENCE_AMPLITUDE);
    const kept = detectKeptIntervals(samples, SAMPLE_RATE);
    expect(kept).toEqual([{ start: 0, end: 3 }]);
  });

  it('returns [] for empty input', () => {
    expect(detectKeptIntervals(new Float32Array(0), SAMPLE_RATE)).toEqual([]);
  });
});

describe('buildKeptTimeline', () => {
  const intervals: KeptInterval[] = [
    { start: 0, end: 2 },
    { start: 5, end: 7 },
    { start: 10, end: 10.5 },
  ];

  it('sums interval lengths into processedDurationSec', () => {
    const timeline = buildKeptTimeline(intervals);
    expect(timeline.processedDurationSec).toBeCloseTo(4.5, 10);
    expect(timeline.offsets).toEqual([0, 2, 4]);
  });

  it('mapProcessedToOriginal round-trips within the first interval', () => {
    const timeline = buildKeptTimeline(intervals);
    expect(timeline.mapProcessedToOriginal(1)).toBeCloseTo(1, 10);
  });

  it('mapProcessedToOriginal round-trips across a removed gap into the second interval', () => {
    const timeline = buildKeptTimeline(intervals);
    // processed second 3 -> 1s into interval 1 (offset 2) -> original 5 + 1 = 6
    expect(timeline.mapProcessedToOriginal(3)).toBeCloseTo(6, 10);
  });

  it('mapProcessedToOriginal clamps to the timeline bounds', () => {
    const timeline = buildKeptTimeline(intervals);
    expect(timeline.mapProcessedToOriginal(-5)).toBeCloseTo(0, 10);
    expect(timeline.mapProcessedToOriginal(100)).toBeCloseTo(10.5, 10);
    expect(timeline.mapProcessedToOriginal(timeline.processedDurationSec)).toBeCloseTo(10.5, 10);
  });

  it('handles a single interval (no gaps)', () => {
    const timeline = buildKeptTimeline([{ start: 2, end: 6 }]);
    expect(timeline.processedDurationSec).toBeCloseTo(4, 10);
    expect(timeline.mapProcessedToOriginal(1.5)).toBeCloseTo(3.5, 10);
  });

  it('resolves a seam-exact time by bias: start -> after the removed gap, end -> before it', () => {
    const timeline = buildKeptTimeline(intervals);
    // Processed second 2 is exactly the seam between interval 0 (orig end 2)
    // and interval 1 (orig start 5) — 3 removed seconds apart in original time.
    expect(timeline.mapProcessedToOriginal(2, 'start')).toBeCloseTo(5, 10);
    expect(timeline.mapProcessedToOriginal(2, 'end')).toBeCloseTo(2, 10);
    // Default bias is 'start'.
    expect(timeline.mapProcessedToOriginal(2)).toBeCloseTo(5, 10);
    // A seam-exact time that arrived through a speed-factor round-trip
    // (divide then multiply) still counts as on the seam.
    const speedFactor = 1.2;
    expect(timeline.mapProcessedToOriginal((2 / speedFactor) * speedFactor, 'start')).toBeCloseTo(5, 10);
  });

  it('never applies start bias at the very end of the timeline (no next interval)', () => {
    const timeline = buildKeptTimeline(intervals);
    expect(timeline.mapProcessedToOriginal(timeline.processedDurationSec, 'start')).toBeCloseTo(10.5, 10);
  });
});

describe('planChunks', () => {
  it('respects min(duration cap, byte cap) — the byte cap binds when it is smaller', () => {
    const timeline = buildKeptTimeline([{ start: 0, end: 12 }]);
    const chunks = planChunks(timeline, {
      speedFactor: 1,
      maxChunkSeconds: 1000, // would never bind on its own
      maxChunkBytes: 54, // (54 - 44) / 2 = 5s effective cap
      bytesPerSecond: 2,
    });
    expect(chunks).toEqual([
      { finalStart: 0, finalEnd: 5 },
      { finalStart: 5, finalEnd: 10 },
      { finalStart: 10, finalEnd: 12 },
    ]);
  });

  it('prefers a kept-interval boundary within range over cutting all the way to the cap', () => {
    // Two kept intervals of length 4 and 6 (processed), speedFactor 1, so
    // there is exactly one interior boundary at final-time 4 — well inside
    // the 6s cap, so the greedy planner should stop there instead of at 6.
    const timeline = buildKeptTimeline([
      { start: 0, end: 4 },
      { start: 9, end: 15 },
    ]);
    const chunks = planChunks(timeline, {
      speedFactor: 1,
      maxChunkSeconds: 6,
      maxChunkBytes: 0,
      bytesPerSecond: 0, // byte cap disabled -> duration cap only
    });
    expect(chunks).toEqual([
      { finalStart: 0, finalEnd: 4 },
      { finalStart: 4, finalEnd: 10 },
    ]);
  });

  it('hard-cuts continuous speech longer than the cap when no boundary is available', () => {
    const timeline = buildKeptTimeline([{ start: 0, end: 20 }]); // one single kept interval -> zero interior boundaries
    const chunks = planChunks(timeline, {
      speedFactor: 1,
      maxChunkSeconds: 6,
      maxChunkBytes: 0,
      bytesPerSecond: 0,
    });
    expect(chunks).toEqual([
      { finalStart: 0, finalEnd: 6 },
      { finalStart: 6, finalEnd: 12 },
      { finalStart: 12, finalEnd: 18 },
      { finalStart: 18, finalEnd: 20 },
    ]);

    // Exact tiling: no gaps/overlaps, and the last chunk ends at finalDuration exactly.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].finalStart).toBe(chunks[i - 1].finalEnd);
    }
    expect(chunks[chunks.length - 1].finalEnd).toBe(20);
  });

  it('returns a single chunk covering the whole recording when it fits under the cap', () => {
    const timeline = buildKeptTimeline([{ start: 0, end: 3 }]);
    const chunks = planChunks(timeline, {
      speedFactor: 1,
      maxChunkSeconds: 10,
      maxChunkBytes: 0,
      bytesPerSecond: 0,
    });
    expect(chunks).toEqual([{ finalStart: 0, finalEnd: 3 }]);
  });

  it('returns [] when the timeline has no kept audio', () => {
    const timeline = buildKeptTimeline([]);
    expect(planChunks(timeline, { speedFactor: 1, maxChunkSeconds: 10, maxChunkBytes: 0, bytesPerSecond: 0 })).toEqual([]);
  });
});

describe('createChunkTimeMapper', () => {
  it('maps a time in a later chunk back to the correct original second, accounting for speed-up and a removed gap', () => {
    // Kept intervals: [0,4] and [9,15] -> processedDurationSec = 10, offsets = [0, 4].
    const timeline = buildKeptTimeline([
      { start: 0, end: 4 },
      { start: 9, end: 15 },
    ]);
    const speedFactor = 1.2;
    // finalDuration = 10 / 1.2 = 8.3333...
    const chunks = [
      { finalStart: 0, finalEnd: 3 },
      { finalStart: 3, finalEnd: timeline.processedDurationSec / speedFactor },
    ];
    const mapTime = createChunkTimeMapper(chunks, timeline, speedFactor);

    // 1s into chunk 1 (index 1): finalTime = 3 + 1 = 4 -> processedTime = 4.8
    // -> falls 0.8s into the second kept interval (offset 4) -> original 9 + 0.8 = 9.8
    expect(mapTime(1, 1)).toBeCloseTo(9.8, 10);
  });

  it('clamps an out-of-range chunk index to the nearest valid chunk', () => {
    const timeline = buildKeptTimeline([{ start: 0, end: 5 }]);
    const chunks = [{ finalStart: 0, finalEnd: 5 }];
    const mapTime = createChunkTimeMapper(chunks, timeline, 1);
    expect(mapTime(5, 0)).toBe(mapTime(0, 0));
    expect(mapTime(-1, 0)).toBe(mapTime(0, 0));
  });

  it('clamps a negative tSec to 0', () => {
    const timeline = buildKeptTimeline([{ start: 0, end: 5 }]);
    const chunks = [{ finalStart: 0, finalEnd: 5 }];
    const mapTime = createChunkTimeMapper(chunks, timeline, 1);
    expect(mapTime(0, -10)).toBeCloseTo(0, 10);
  });

  it('maps a later chunk cut at a silence seam so its first segment starts AFTER the removed gap', () => {
    // Kept intervals [0,4] and [9,15]: planChunks prefers the interior
    // boundary (processed second 4), so chunk 1 starts exactly on the seam.
    const timeline = buildKeptTimeline([
      { start: 0, end: 4 },
      { start: 9, end: 15 },
    ]);
    const speedFactor = 1.2;
    const chunks = planChunks(timeline, {
      speedFactor,
      maxChunkSeconds: 5,
      maxChunkBytes: 0,
      bytesPerSecond: 0,
    });
    expect(chunks[1].finalStart).toBeCloseTo(4 / speedFactor, 10);

    const mapTime = createChunkTimeMapper(chunks, timeline, speedFactor);
    // Chunk 1's first segment (chunk-local start 0) begins the speech AFTER
    // the removed silence: original 9, not the pre-gap 4.
    expect(mapTime(1, 0, 'start')).toBeCloseTo(9, 6);
    // Chunk 0's last segment END on the same seam belongs to the speech
    // BEFORE the gap: original 4.
    expect(mapTime(0, chunks[0].finalEnd - chunks[0].finalStart, 'end')).toBeCloseTo(4, 6);
  });
});

describe('combineChunkResponses', () => {
  it('remaps every segment through mapTime and sorts the combined result by start', () => {
    const perChunk = [
      { mode: 'diarized' as const, segments: [{ start: 5, end: 6, speaker: 'A', text: 'hi' }], primaryError: null, warnings: [] },
      { mode: 'diarized' as const, segments: [{ start: 1, end: 2, speaker: 'B', text: 'yo' }], primaryError: null, warnings: [] },
    ];
    const mapTime = (chunkIndex: number, sec: number) => chunkIndex * 100 + sec;

    const combined = combineChunkResponses(perChunk, mapTime);

    expect(combined.mode).toBe('diarized');
    expect(combined.segments).toEqual([
      { start: 5, end: 6, speaker: 'A', text: 'hi' },
      { start: 101, end: 102, speaker: 'B', text: 'yo' },
    ]);
  });

  it('falls back to fallback mode and warns when chunks are a mix of diarized and non-diarized', () => {
    const perChunk = [
      { mode: 'diarized' as const, segments: [], primaryError: null, warnings: ['w1'] },
      { mode: 'fallback' as const, segments: [], primaryError: 'boom', warnings: ['w1', 'w2'] },
    ];
    const combined = combineChunkResponses(perChunk, (_, sec) => sec);

    expect(combined.mode).toBe('fallback');
    expect(combined.warnings).toEqual(['w1', 'w2', MIXED_CHUNK_MODE_WARNING]);
    expect(combined.primaryError).toBe('boom');
  });

  it('stays diarized (no mixed warning) when every chunk is diarized', () => {
    const perChunk = [
      { mode: 'diarized' as const, segments: [], primaryError: null, warnings: [] },
      { mode: 'diarized' as const, segments: [], primaryError: null, warnings: [] },
    ];
    const combined = combineChunkResponses(perChunk, (_, sec) => sec);
    expect(combined.mode).toBe('diarized');
    expect(combined.warnings).not.toContain(MIXED_CHUNK_MODE_WARNING);
  });

  it('de-duplicates warnings across chunks', () => {
    const perChunk = [
      { mode: 'diarized' as const, segments: [], primaryError: null, warnings: ['dup', 'a'] },
      { mode: 'diarized' as const, segments: [], primaryError: null, warnings: ['dup', 'b'] },
    ];
    const combined = combineChunkResponses(perChunk, (_, sec) => sec);
    expect(combined.warnings).toEqual(['dup', 'a', 'b']);
  });

  it('selects the first non-null primaryError', () => {
    const perChunk = [
      { mode: 'fallback' as const, segments: [], primaryError: null, warnings: [] },
      { mode: 'fallback' as const, segments: [], primaryError: 'first', warnings: [] },
      { mode: 'fallback' as const, segments: [], primaryError: 'second', warnings: [] },
    ];
    const combined = combineChunkResponses(perChunk, (_, sec) => sec);
    expect(combined.primaryError).toBe('first');
  });

  it('clamps a remapped segment end to never fall before its remapped start', () => {
    const perChunk = [
      { mode: 'diarized' as const, segments: [{ start: 5, end: 3, speaker: 'A', text: 'x' }], primaryError: null, warnings: [] },
    ];
    const combined = combineChunkResponses(perChunk, (_, sec) => sec);
    expect(combined.segments[0].start).toBe(5);
    expect(combined.segments[0].end).toBe(5);
  });
});
