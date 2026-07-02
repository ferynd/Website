// Merges consecutive same-speaker segments into speaker-turn blocks for the
// "cleaned" one-block-per-turn transcript. Merging is a display/export
// transform only — `cleanedSegments` in pipeline state stay segment-granular;
// this is applied on top of them when building the formatted output.

import type { ArgumentTag, TaggedTranscriptSegment, TurnBlock } from './types';

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

/** A block still being accumulated — tracks per-tag counts (in first-seen
 * order, for tie-breaking) alongside the usual merged fields, so the final
 * majority tag can be computed once the block is done growing. */
interface WorkingBlock {
  start: number;
  end: number;
  speaker: string;
  text: string;
  segmentCount: number;
  tagCounts: Map<ArgumentTag, number>;
  tagOrder: ArgumentTag[];
}

function addTag(block: WorkingBlock, tag: ArgumentTag | undefined): void {
  if (!tag) return;
  if (!block.tagCounts.has(tag)) {
    block.tagCounts.set(tag, 0);
    block.tagOrder.push(tag);
  }
  block.tagCounts.set(tag, block.tagCounts.get(tag)! + 1);
}

/**
 * Majority tag among a block's constituent segments (Phase 5) — ties resolve
 * to whichever tag was seen first (insertion order), per the "tag
 * differences never block merging" rule: merging never depends on tags
 * matching, so the winner among a tie is just a deterministic pick, not a
 * meaningful signal. Undefined when no constituent segment carried a tag
 * (tagging was off, or every segment in the block was untagged).
 */
function majorityTag(block: WorkingBlock): ArgumentTag | undefined {
  let best: ArgumentTag | undefined;
  let bestCount = 0;
  for (const tag of block.tagOrder) {
    const count = block.tagCounts.get(tag)!;
    if (count > bestCount) {
      best = tag;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Merges `segments` (sorted defensively by start time) into turn blocks: the
 * next segment joins the current block iff (a) same speaker, (b) the gap
 * from the current block's end to the next segment's start is strictly less
 * than `maxGapSeconds`, and (c) no suppression boundary time falls strictly
 * between them. Text is joined with a single space; the block's end is the
 * max end time seen so far (segments are expected non-decreasing in end
 * time, but this guards against a stray out-of-order end). Tag differences
 * between segments NEVER block a merge — each resulting block carries the
 * majority tag among its constituent segments (see majorityTag above),
 * omitted entirely when no segment carried one.
 */
export function mergeTurns(segments: TaggedTranscriptSegment[], options: MergeTurnsOptions): TurnBlock[] {
  const { maxGapSeconds } = options;
  const boundaryTimes = options.boundaryTimes ?? [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);

  const working: WorkingBlock[] = [];

  for (const segment of sorted) {
    const last = working[working.length - 1];
    const canMerge =
      last !== undefined &&
      last.speaker === segment.speaker &&
      segment.start - last.end < maxGapSeconds &&
      !hasBoundaryBetween(last.end, segment.start, boundaryTimes);

    if (canMerge) {
      last.end = Math.max(last.end, segment.end);
      last.text = `${last.text} ${segment.text}`.trim();
      last.segmentCount += 1;
      addTag(last, segment.tag);
    } else {
      const block: WorkingBlock = {
        start: segment.start,
        end: segment.end,
        speaker: segment.speaker,
        text: segment.text,
        segmentCount: 1,
        tagCounts: new Map(),
        tagOrder: [],
      };
      addTag(block, segment.tag);
      working.push(block);
    }
  }

  return working.map((block) => {
    const tag = majorityTag(block);
    const result: TurnBlock = {
      start: block.start,
      end: block.end,
      speaker: block.speaker,
      text: block.text,
      segmentCount: block.segmentCount,
    };
    if (tag) result.tag = tag;
    return result;
  });
}
