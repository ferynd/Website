import { CORRECTION_CHUNK_SECONDS, CORRECTION_OVERLAP_SECONDS } from './constants';

export interface ChunkWindowBounds {
  index: number;
  /** Non-overlapping region owned by this window — used by stitching to avoid duplicates. */
  coreStart: number;
  coreEnd: number;
  /** Core region plus overlap on both sides, for correction-model context. */
  windowStart: number;
  windowEnd: number;
}

export interface ChunkConfig {
  chunkSeconds?: number;
  overlapSeconds?: number;
}

/**
 * Splits [0, totalDurationSeconds] into contiguous, non-overlapping "core"
 * windows of `chunkSeconds`, each padded with `overlapSeconds` of context on
 * both sides (clamped to the recording's bounds). The overlap gives the
 * correction model context across chunk boundaries so speaker continuity
 * carries over; stitchTranscript later keeps only each window's core region.
 */
export function createChunkWindows(
  totalDurationSeconds: number,
  config: ChunkConfig = {},
): ChunkWindowBounds[] {
  const chunkSeconds = config.chunkSeconds ?? CORRECTION_CHUNK_SECONDS;
  const overlapSeconds = config.overlapSeconds ?? CORRECTION_OVERLAP_SECONDS;

  if (!(totalDurationSeconds > 0) || !(chunkSeconds > 0)) return [];

  const windowCount = Math.max(1, Math.ceil(totalDurationSeconds / chunkSeconds));
  const windows: ChunkWindowBounds[] = [];

  for (let index = 0; index < windowCount; index++) {
    const coreStart = index * chunkSeconds;
    const coreEnd = index === windowCount - 1 ? totalDurationSeconds : (index + 1) * chunkSeconds;
    const windowStart = Math.max(0, coreStart - overlapSeconds);
    const windowEnd = Math.min(totalDurationSeconds, coreEnd + overlapSeconds);
    windows.push({ index, coreStart, coreEnd, windowStart, windowEnd });
  }

  return windows;
}

/** Returns segments that intersect a window's (overlap-padded) time range. */
export function segmentsInWindow<T extends { start: number; end: number }>(
  segments: T[],
  window: ChunkWindowBounds,
): T[] {
  return segments.filter((seg) => seg.start < window.windowEnd && seg.end > window.windowStart);
}
