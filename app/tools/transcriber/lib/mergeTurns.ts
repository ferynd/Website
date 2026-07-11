// Merges consecutive same-speaker segments into speaker-turn blocks for the
// "cleaned" one-block-per-turn transcript. Merging is a display/export
// transform only — `cleanedSegments` in pipeline state stay segment-granular;
// this is applied on top of them when building the formatted output.
//
// Merge safety is identity-aware: two segments merge only when their speaker
// IDENTITY provably matches, not merely their display string —
//   - both resolved to the same global speaker (or user-confirmed to it), or
//   - both unresolved AND sharing the same stable chunk-local identity, or
//   - neither carrying any identity metadata at all (legacy/Whisper
//     segments), where the display speaker string is all there is.
// Never merged: different unresolved local identities, a resolved segment
// with an unresolved one, or different user-confirmed speakers — even when
// their display strings happen to coincide.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import type { ArgumentTag, TaggedTranscriptSegment, TranscriptSegment, TurnBlock } from './types';

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
 * The comparable identity of one segment for merge purposes — see the merge
 * safety rules in the module header. Different kinds never merge with each
 * other.
 */
export function mergeIdentityKey(seg: TranscriptSegment): string {
  if (seg.userConfirmed) return `resolved:${seg.speaker}`;
  if (seg.resolvedSpeaker !== undefined) return `resolved:${seg.resolvedSpeaker}`;
  if (seg.localSpeakerId !== undefined) return `local:${seg.localSpeakerId}`;
  return `legacy:${seg.speaker}`;
}

/** A block still being accumulated — tracks per-tag counts (in first-seen
 * order, for tie-breaking) alongside the usual merged fields, so the final
 * majority tag can be computed once the block is done growing. */
interface WorkingBlock {
  identityKey: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
  segmentCount: number;
  segmentIds: string[];
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
 * Majority tag among a block's constituent segments — ties resolve to
 * whichever tag was seen first (insertion order). Tags come from the
 * block-level classification stage now, so most segments won't carry one —
 * this remains only for backward compatibility with tagged segments.
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

function finishBlock(block: WorkingBlock): TurnBlock {
  const tag = majorityTag(block);
  const result: TurnBlock = {
    start: block.start,
    end: block.end,
    speaker: block.speaker,
    text: block.text,
    segmentCount: block.segmentCount,
  };
  if (block.segmentIds.length > 0) {
    result.id = block.segmentIds[0];
    result.segmentIds = block.segmentIds;
  }
  if (tag) result.tag = tag;
  return result;
}

/**
 * Merges `segments` (sorted defensively by start time) into turn blocks: the
 * next segment joins the current block iff (a) its merge identity matches
 * (see mergeIdentityKey — provable same speaker, never display-string
 * coincidence), (b) the gap from the current block's end to the next
 * segment's start is strictly less than `maxGapSeconds`, and (c) no
 * suppression boundary time falls strictly between them. Text is joined with
 * a single space; the block's end is the max end time seen so far. Each
 * block retains its constituent segments' stable ids (`segmentIds`) and
 * takes the first constituent's id as its own stable id.
 */
export function mergeTurns(segments: TaggedTranscriptSegment[], options: MergeTurnsOptions): TurnBlock[] {
  const { maxGapSeconds } = options;
  const boundaryTimes = options.boundaryTimes ?? [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);

  const working: WorkingBlock[] = [];

  for (const segment of sorted) {
    const identityKey = mergeIdentityKey(segment);
    const last = working[working.length - 1];
    const canMerge =
      last !== undefined &&
      last.identityKey === identityKey &&
      segment.start - last.end < maxGapSeconds &&
      !hasBoundaryBetween(last.end, segment.start, boundaryTimes);

    if (canMerge) {
      last.end = Math.max(last.end, segment.end);
      last.text = `${last.text} ${segment.text}`.trim();
      last.segmentCount += 1;
      if (segment.id) last.segmentIds.push(segment.id);
      addTag(last, segment.tag);
    } else {
      const block: WorkingBlock = {
        identityKey,
        start: segment.start,
        end: segment.end,
        speaker: segment.speaker,
        text: segment.text,
        segmentCount: 1,
        segmentIds: segment.id ? [segment.id] : [],
        tagCounts: new Map(),
        tagOrder: [],
      };
      addTag(block, segment.tag);
      working.push(block);
    }
  }

  return working.map(finishBlock);
}
