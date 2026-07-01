// Merges consecutive same-speaker segments into speaker-turn blocks for the
// "cleaned" one-block-per-turn transcript. Merging is a display/export
// transform only — `cleanedSegments` in pipeline state stay segment-granular;
// this is applied on top of them when building the formatted output.

import type { TranscriptSegment, TurnBlock } from './types';

export interface MergeTurnsOptions {
  /** Segments merge into the current block only while the gap to the previous segment's end is strictly under this. */
  maxGapSeconds: number;
  /** Start times (from lib/suppressArtifacts.ts) that are hard turn-block boundaries — never merge across one. */
  boundaryTimes?: number[];
}

/** True if any boundary time falls strictly inside (prevEnd, nextStart). */
function hasBoundaryBetween(prevEnd: number, nextStart: number, boundaryTimes: number[]): boolean {
  return boundaryTimes.some((t) => t > prevEnd && t < nextStart);
}

/**
 * Merges `segments` (sorted defensively by start time) into turn blocks: the
 * next segment joins the current block iff (a) same speaker, (b) the gap
 * from the current block's end to the next segment's start is strictly less
 * than `maxGapSeconds`, and (c) no suppression boundary time falls strictly
 * between them. Text is joined with a single space; the block's end is the
 * max end time seen so far (segments are expected non-decreasing in end
 * time, but this guards against a stray out-of-order end).
 */
export function mergeTurns(segments: TranscriptSegment[], options: MergeTurnsOptions): TurnBlock[] {
  const { maxGapSeconds } = options;
  const boundaryTimes = options.boundaryTimes ?? [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);

  const blocks: TurnBlock[] = [];

  for (const segment of sorted) {
    const last = blocks[blocks.length - 1];
    const canMerge =
      last !== undefined &&
      last.speaker === segment.speaker &&
      segment.start - last.end < maxGapSeconds &&
      !hasBoundaryBetween(last.end, segment.start, boundaryTimes);

    if (canMerge) {
      blocks[blocks.length - 1] = {
        ...last,
        end: Math.max(last.end, segment.end),
        text: `${last.text} ${segment.text}`.trim(),
        segmentCount: last.segmentCount + 1,
      };
    } else {
      blocks.push({
        start: segment.start,
        end: segment.end,
        speaker: segment.speaker,
        text: segment.text,
        segmentCount: 1,
      });
    }
  }

  return blocks;
}
