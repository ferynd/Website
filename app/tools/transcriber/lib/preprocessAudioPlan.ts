// Pure math for OpenAI long-recording preprocessing: silence detection,
// building a "kept" (silence-removed) timeline, planning chunk boundaries in
// the final (post-speed-up) time domain, mapping a chunk-local time back to
// the ORIGINAL recording's time, and combining per-chunk transcription
// responses into one stitched result. No Web Audio/browser APIs here — see
// lib/preprocessOpenAiAudio.ts for the browser-side orchestrator that calls
// into this (decode, slice, speed-up, encode) and lib/providers/geminiProvider.ts
// for the analogous (unrelated) windowing this preprocessing path mirrors on
// the OpenAI side.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import type { TranscriptionMode, TranscriptSegment } from './types';
import {
  MIN_REMOVABLE_SILENCE_SECONDS,
  SILENCE_DBFS_THRESHOLD,
  SILENCE_EDGE_PAD_SECONDS,
  SILENCE_FRAME_SECONDS,
} from './constants';
import { resolveOverlapDuplicates, type OverlapLink } from './reconcileSpeakers';

/* ------------------------------------------------------------ */
/* CONFIGURATION: local floors/minimums                          */
/* ------------------------------------------------------------ */

/** Floor applied to true silence (RMS 0, whose real dB is -Infinity) so
 * downstream math always sees a finite number — mirrors clipAnalysis.ts's
 * SILENCE_FLOOR_DB (not imported: that constant is private to that module). */
const SILENCE_FLOOR_DB = -120;

/** A removable silence run is only actually removed if what's left after
 * shrinking both edges by SILENCE_EDGE_PAD_SECONDS is still at least this
 * long — otherwise the pad alone would consume the whole run. */
const MIN_SHRUNK_REMOVAL_SECONDS = 0.5;

/** A candidate chunk-boundary cut is only preferred over a hard cut-at-cap
 * when it leaves a "meaningfully sized" chunk — defined as at least this
 * fraction of the effective per-chunk cap, so a boundary that lands right at
 * the start of a chunk never produces a near-zero-length chunk. */
const MIN_MEANINGFUL_CHUNK_FRACTION = 0.1;

/** Tiny epsilon for floating-point-safe boundary/loop comparisons. */
const EPSILON = 1e-9;

/** Seam tolerance for mapProcessedToOriginal's bias handling: a chunk
 * boundary in FINAL time is `offsets[k] / speedFactor`, and the mapper
 * multiplies back by speedFactor, so the float round-trip can land within
 * ~1e-12 of the exact seam. Anything this close counts as ON the seam —
 * well below segment-timestamp resolution (~10 ms), so it can never
 * misclassify a genuinely interior time. */
const SEAM_EPSILON = 1e-6;

export interface KeptInterval {
  /** ORIGINAL-recording-time seconds. */
  start: number;
  end: number;
}

function computeRms(samples: Float32Array, start: number, end: number): number {
  const count = end - start;
  if (count <= 0) return 0;
  let sumSquares = 0;
  for (let i = start; i < end; i++) {
    const s = samples[i];
    sumSquares += s * s;
  }
  return Math.sqrt(sumSquares / count);
}

function rmsToDb(rms: number): number {
  if (rms <= 0) return SILENCE_FLOOR_DB;
  return Math.max(SILENCE_FLOOR_DB, 20 * Math.log10(rms));
}

export interface DetectKeptIntervalsOptions {
  frameSeconds?: number;
  dbfsThreshold?: number;
  minRemovableSeconds?: number;
  edgePadSeconds?: number;
}

/**
 * Detects the intervals of `samples` worth KEEPING (i.e. everything that
 * ISN'T a long enough, loud-enough silence to remove) and returns them in
 * ORIGINAL-time seconds, in order, never overlapping.
 *
 * A "removable" silence run is a stretch of consecutive frames (each
 * SILENCE_FRAME_SECONDS long) whose RMS loudness is below
 * SILENCE_DBFS_THRESHOLD, lasting at least MIN_REMOVABLE_SILENCE_SECONDS.
 * Each removable run is shrunk by SILENCE_EDGE_PAD_SECONDS on both edges
 * (the padding stays with the surrounding speech, never removed) and only
 * actually removed if what remains is at least 0.5s — otherwise the whole
 * run is left in place (padding alone would have consumed it).
 *
 * Fail-safes: an empty buffer returns []; if silence detection would remove
 * the entire recording, the whole buffer is returned as one kept interval
 * instead — the caller should never receive an empty keep-list for
 * non-empty audio.
 */
export function detectKeptIntervals(
  samples: Float32Array,
  sampleRate: number,
  opts: DetectKeptIntervalsOptions = {},
): KeptInterval[] {
  const total = samples.length;
  if (total === 0 || sampleRate <= 0) return [];

  const duration = total / sampleRate;
  const frameSeconds = opts.frameSeconds ?? SILENCE_FRAME_SECONDS;
  const dbfsThreshold = opts.dbfsThreshold ?? SILENCE_DBFS_THRESHOLD;
  const minRemovableSeconds = opts.minRemovableSeconds ?? MIN_REMOVABLE_SILENCE_SECONDS;
  const edgePadSeconds = opts.edgePadSeconds ?? SILENCE_EDGE_PAD_SECONDS;

  const frameSize = Math.max(1, Math.round(frameSeconds * sampleRate));
  const frameCount = Math.ceil(total / frameSize);

  // Fail-safe pre-check: if literally nothing in the recording clears the
  // silence threshold, this is a wholly-silent (or near-empty) buffer, not a
  // real recording with removable pauses in it — treat the whole thing as
  // one kept interval rather than letting the edge-pad shrink below leave
  // two tiny, useless slivers at the very start/end.
  let anyLoudFrame = false;
  for (let f = 0; f < frameCount; f++) {
    const s = f * frameSize;
    const e = Math.min(total, s + frameSize);
    if (rmsToDb(computeRms(samples, s, e)) >= dbfsThreshold) {
      anyLoudFrame = true;
      break;
    }
  }
  if (!anyLoudFrame) return [{ start: 0, end: duration }];

  const removed: KeptInterval[] = [];
  let i = 0;
  while (i < frameCount) {
    const frameStart = i * frameSize;
    const frameEnd = Math.min(total, frameStart + frameSize);
    const db = rmsToDb(computeRms(samples, frameStart, frameEnd));

    if (db >= dbfsThreshold) {
      i++;
      continue;
    }

    // Walk forward through consecutive silent frames.
    let j = i;
    let runEndSample = frameEnd;
    while (j < frameCount) {
      const s = j * frameSize;
      const e = Math.min(total, s + frameSize);
      const frameDb = rmsToDb(computeRms(samples, s, e));
      if (frameDb >= dbfsThreshold) break;
      runEndSample = e;
      j++;
    }

    const runStartSec = frameStart / sampleRate;
    const runEndSec = Math.min(duration, runEndSample / sampleRate);
    const runLengthSec = runEndSec - runStartSec;

    if (runLengthSec >= minRemovableSeconds) {
      const shrunkStart = runStartSec + edgePadSeconds;
      const shrunkEnd = runEndSec - edgePadSeconds;
      if (shrunkEnd - shrunkStart >= MIN_SHRUNK_REMOVAL_SECONDS) {
        removed.push({ start: shrunkStart, end: shrunkEnd });
      }
    }

    i = j;
  }

  if (removed.length === 0) return [{ start: 0, end: duration }];

  const kept: KeptInterval[] = [];
  let cursor = 0;
  for (const r of removed) {
    if (r.start > cursor) kept.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < duration) kept.push({ start: cursor, end: duration });

  return kept.length > 0 ? kept : [{ start: 0, end: duration }];
}

/**
 * Which side of a removed-silence seam an ambiguous timestamp belongs to. A
 * processed time landing exactly on the seam between two kept intervals is
 * both the earlier interval's end and the later one's start — two ORIGINAL
 * times that differ by the removed silence. A segment START on the seam
 * belongs to the speech AFTER the gap ('start'); a segment END on the seam
 * belongs to the speech BEFORE it ('end'). This matters in practice because
 * planChunks deliberately cuts at these seams, so a later chunk's first
 * segment (chunk-local start 0) lands exactly on one.
 */
export type TimeBias = 'start' | 'end';

export interface KeptTimeline {
  /** The kept intervals, in ORIGINAL-time seconds, as passed in. */
  intervals: KeptInterval[];
  /** Cumulative processed-time (silence-removed, pre-speed-up) start offset of each interval — parallel to `intervals`. */
  offsets: number[];
  /** Total duration of the concatenated kept audio, in processed-time seconds. */
  processedDurationSec: number;
  /** Maps a processed-time (post-silence-removal, pre-speed-up) second back to the ORIGINAL recording's time, clamped to bounds. `bias` (default 'start') resolves times landing exactly on a seam between kept intervals — see TimeBias. */
  mapProcessedToOriginal(pSec: number, bias?: TimeBias): number;
}

/**
 * Builds a piecewise-linear timeline from kept intervals: each interval's
 * cumulative processed-time start offset, the total processed duration, and
 * a mapProcessedToOriginal function that inverts "which original second does
 * this point in the concatenated, silence-removed buffer correspond to".
 */
export function buildKeptTimeline(intervals: KeptInterval[]): KeptTimeline {
  const offsets: number[] = [];
  let cursor = 0;
  for (const iv of intervals) {
    offsets.push(cursor);
    cursor += Math.max(0, iv.end - iv.start);
  }
  const processedDurationSec = cursor;

  function mapProcessedToOriginal(pSec: number, bias: TimeBias = 'start'): number {
    if (intervals.length === 0) return 0;
    const clamped = Math.max(0, Math.min(processedDurationSec, pSec));

    for (let idx = 0; idx < intervals.length; idx++) {
      const start = offsets[idx];
      const length = Math.max(0, intervals[idx].end - intervals[idx].start);
      const end = start + length;
      const isLast = idx === intervals.length - 1;
      // Exactly on the seam with the next interval: with 'start' bias the
      // time belongs to the speech AFTER the removed gap, so fall through to
      // the next interval instead of returning this one's end (see TimeBias).
      if (bias === 'start' && !isLast && Math.abs(clamped - end) <= SEAM_EPSILON) continue;
      if (clamped <= end + EPSILON || isLast) {
        const within = Math.max(0, Math.min(length, clamped - start));
        return intervals[idx].start + within;
      }
    }

    return intervals[intervals.length - 1].end;
  }

  return { intervals, offsets, processedDurationSec, mapProcessedToOriginal };
}

export interface PlanChunksOptions {
  /** Speed-up factor applied to the whole (silence-trimmed) buffer before chunking — final time = processed time / speedFactor. */
  speedFactor: number;
  maxChunkSeconds: number;
  maxChunkBytes: number;
  bytesPerSecond: number;
  /** Audio overlap carried into the START of every chunk after the first,
   * in FINAL-time seconds — each chunk's encoded audio begins `overlapSeconds`
   * before its core so the seam speech is transcribed by both neighbors
   * (identity linking + safe deduplication downstream). Default 0. */
  overlapSeconds?: number;
}

export interface PlannedChunk {
  /** FINAL-time (post-silence-removal, post-speed-up) CORE bounds, seconds —
   * cores exactly tile [0, finalDuration] with no gaps or overlap. */
  finalStart: number;
  finalEnd: number;
  /** Where this chunk's ENCODED audio begins: `finalStart` minus the overlap
   * (clamped to 0). Equal to finalStart for the first chunk / zero overlap. */
  encodeStart: number;
}

/**
 * Plans chunk boundaries in the FINAL (post-silence-removal, post-speed-up)
 * time domain, so each chunk's encoded size stays under both the duration
 * and byte caps. Greedy left-to-right: from the current cut point, prefers
 * the furthest available kept-interval boundary (a natural pause in the
 * original recording) that is within the effective per-chunk cap and still
 * leaves a meaningfully-sized chunk; falls back to a hard cut exactly at the
 * cap when no such boundary exists (i.e. continuous speech longer than the
 * cap). Chunks always exactly tile [0, finalDuration] with no gaps or
 * overlap; the last chunk always ends at finalDuration exactly, however
 * short.
 */
export function planChunks(timeline: KeptTimeline, opts: PlanChunksOptions): PlannedChunk[] {
  const { speedFactor, maxChunkSeconds, maxChunkBytes, bytesPerSecond } = opts;
  const overlapSeconds = Math.max(0, opts.overlapSeconds ?? 0);
  const finalDuration = timeline.processedDurationSec / speedFactor;
  if (!(finalDuration > 0)) return [];

  const byteCapSeconds = bytesPerSecond > 0 ? Math.floor((maxChunkBytes - 44) / bytesPerSecond) : maxChunkSeconds;
  // The caps bound each chunk's ENCODED audio (core + leading overlap), so
  // the per-chunk core budget shrinks by the overlap. Conservative for the
  // first chunk (which has no leading overlap) — one overlap's worth of
  // slack on a ~10-minute chunk is negligible and keeps the plan simple.
  const effectiveCap = Math.max(1, Math.min(maxChunkSeconds, byteCapSeconds) - overlapSeconds);
  const minMeaningful = effectiveCap * MIN_MEANINGFUL_CHUNK_FRACTION;

  // Interior kept-interval boundaries (the seams between originally
  // non-adjacent speech, i.e. natural pause points), converted from
  // processed time into final time.
  const interiorBoundaries = timeline.offsets.slice(1).map((o) => o / speedFactor);

  const cores: { finalStart: number; finalEnd: number }[] = [];
  let cur = 0;

  while (cur < finalDuration - EPSILON) {
    const capEnd = cur + effectiveCap;

    if (capEnd >= finalDuration - EPSILON) {
      cores.push({ finalStart: cur, finalEnd: finalDuration });
      break;
    }

    let bestBoundary: number | null = null;
    for (const b of interiorBoundaries) {
      if (b > cur + EPSILON && b <= capEnd + EPSILON) {
        if (bestBoundary === null || b > bestBoundary) bestBoundary = b;
      }
    }

    if (bestBoundary !== null && bestBoundary - cur >= minMeaningful) {
      cores.push({ finalStart: cur, finalEnd: bestBoundary });
      cur = bestBoundary;
    } else {
      cores.push({ finalStart: cur, finalEnd: capEnd });
      cur = capEnd;
    }
  }

  return cores.map((core, i) => ({
    ...core,
    encodeStart: i === 0 ? core.finalStart : Math.max(0, core.finalStart - overlapSeconds),
  }));
}

/**
 * Builds a `(chunkIndex, tSec) => originalSec` mapper from a chunk plan: a
 * time `tSec` seconds into chunk `chunkIndex`'s ENCODED audio (which begins
 * at `encodeStart`, i.e. overlap included) maps to
 * `timeline.mapProcessedToOriginal((chunks[chunkIndex].encodeStart + tSec) * speedFactor)`
 * — undoing the speed-up first (back to processed time), then the
 * silence-removal concatenation (back to original time). Both inputs are
 * clamped: an out-of-range chunkIndex clamps to the nearest valid chunk, a
 * negative tSec clamps to 0 (the upper bound is left to
 * mapProcessedToOriginal's own clamping). `bias` (default 'start') resolves
 * times landing exactly on a removed-silence seam — see TimeBias; pass 'end'
 * when mapping a segment's end time.
 */
export function createChunkTimeMapper(
  chunks: PlannedChunk[],
  timeline: KeptTimeline,
  speedFactor: number,
): (chunkIndex: number, tSec: number, bias?: TimeBias) => number {
  return (chunkIndex: number, tSec: number, bias: TimeBias = 'start') => {
    if (chunks.length === 0) return 0;
    const idx = Math.max(0, Math.min(chunks.length - 1, Math.trunc(chunkIndex)));
    const chunk = chunks[idx];
    const t = Math.max(0, tSec);
    return timeline.mapProcessedToOriginal((chunk.encodeStart + t) * speedFactor, bias);
  };
}

export interface ChunkTranscriptionResult {
  mode: TranscriptionMode;
  segments: TranscriptSegment[];
  primaryError: string | null;
  warnings: string[];
}

export interface CombinedTranscriptionResult {
  mode: TranscriptionMode;
  segments: TranscriptSegment[];
  primaryError: string | null;
  warnings: string[];
  /** Chunk-local speaker-identity links recovered from overlap regions —
   * fed into the deterministic reconciliation stage (lib/reconcileSpeakers.ts). */
  overlapLinks: OverlapLink[];
}

/** Warning appended when some chunks came back diarized and others fell back to Whisper — see combineChunkResponses. */
export const MIXED_CHUNK_MODE_WARNING =
  'Some chunks fell back to Whisper (no diarization) — speaker labels may be inconsistent across the recording.';

/** Warning appended when an overlap-region segment couldn't be confidently
 * matched to its neighboring chunk's version AND genuinely overlapped it in
 * time — retained rather than dropped (see combineChunkResponses), but
 * worth flagging since it may read as a duplicate line. */
export const POSSIBLE_OVERLAP_DUPLICATE_WARNING =
  'A chunk-boundary segment could not be confidently matched to its neighboring chunk — it was kept rather than discarded, so a line may appear duplicated near a chunk boundary.';

export interface CombineChunkOptions {
  /** Per-chunk core offset in the chunk's OWN encoded audio, in final-time
   * seconds: `finalStart - encodeStart` (0 for the first chunk / no
   * overlap). A segment starting before its chunk's core offset is an
   * overlap duplicate — the previous chunk owns that region — and is
   * deterministically dropped, after being matched against the owner's
   * segments to recover a cross-chunk speaker-identity link. */
  coreOffsets?: number[];
}

/**
 * Combines per-chunk transcription responses into one stitched result:
 * every segment's start/end is remapped from chunk-local final time back to
 * ORIGINAL-recording time via `mapTime`, all segments are concatenated and
 * sorted by (remapped) start. Overlap regions (see CombineChunkOptions) are
 * resolved by core ownership — a segment belongs to the chunk whose core
 * contains its start, mirroring lib/stitchTranscript.ts's rule — but a
 * duplicate is only ever DROPPED when it reliably matches the owning
 * chunk's version of the same speech (lib/reconcileSpeakers.ts's
 * resolveOverlapDuplicates); an unmatched duplicate is RETAINED instead of
 * silently lost, and whichever of a matched pair is more complete survives.
 * Matched duplicates also contribute speaker-identity links; an unmatched
 * one that genuinely overlapped an owned segment in time appends
 * POSSIBLE_OVERLAP_DUPLICATE_WARNING. `mode` is 'diarized' only if every
 * chunk came back diarized; otherwise 'fallback' — and if the chunks were a
 * genuine mix (at least one diarized, at least one not),
 * MIXED_CHUNK_MODE_WARNING is appended. `primaryError` is the first
 * non-null one seen; `warnings` is the de-duplicated union of every
 * chunk's warnings plus the notices above.
 */
export function combineChunkResponses(
  perChunk: ChunkTranscriptionResult[],
  mapTime: (chunkIndex: number, sec: number, bias?: TimeBias) => number,
  options: CombineChunkOptions = {},
): CombinedTranscriptionResult {
  const coreOffsets = options.coreOffsets ?? [];
  const owned: TranscriptSegment[] = [];
  const overlapDuplicates: TranscriptSegment[] = [];
  const warnings: string[] = [];
  let primaryError: string | null = null;
  let sawDiarized = false;
  let sawNonDiarized = false;

  perChunk.forEach((chunk, i) => {
    if (chunk.mode === 'diarized') sawDiarized = true;
    else sawNonDiarized = true;

    if (primaryError === null && chunk.primaryError) primaryError = chunk.primaryError;

    for (const w of chunk.warnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }

    const coreOffset = coreOffsets[i] ?? 0;
    for (const seg of chunk.segments) {
      // Explicit biases so a timestamp landing exactly on a removed-silence
      // seam (a chunk's first segment start, a chunk's last segment end)
      // resolves to the correct side of the gap in original time.
      const start = mapTime(i, seg.start, 'start');
      const end = Math.max(start, mapTime(i, seg.end, 'end'));
      const remapped = { ...seg, start, end };
      if (seg.start >= coreOffset - EPSILON) {
        owned.push(remapped);
      } else {
        overlapDuplicates.push(remapped);
      }
    }
  });

  const { owned: resolvedOwned, retainedDuplicates, links, hasPossibleDuplicate } = resolveOverlapDuplicates(
    owned,
    overlapDuplicates,
  );
  const segments = [...resolvedOwned, ...retainedDuplicates].sort((a, b) => a.start - b.start);

  const mode: TranscriptionMode = perChunk.length > 0 && sawDiarized && !sawNonDiarized ? 'diarized' : 'fallback';

  if (sawDiarized && sawNonDiarized && !warnings.includes(MIXED_CHUNK_MODE_WARNING)) {
    warnings.push(MIXED_CHUNK_MODE_WARNING);
  }
  if (hasPossibleDuplicate && !warnings.includes(POSSIBLE_OVERLAP_DUPLICATE_WARNING)) {
    warnings.push(POSSIBLE_OVERLAP_DUPLICATE_WARNING);
  }

  return { mode, segments, primaryError, warnings, overlapLinks: links };
}
