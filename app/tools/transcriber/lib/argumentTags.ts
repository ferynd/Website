// Pure helpers for the argument-relevant export: a zero-filled tag summary
// for the debug log/UI, and RANGE-BASED argument-range construction — every
// conflict/repair/support block anchors a range extended ~90s before and
// after, every intervening block is included regardless of tag (a logistics
// aside inside an argument stays in context), overlapping/adjacent ranges
// merge, and isolated unrelated stretches outside every range are excluded.
// This replaces the old "sandwich" filter, which dropped context unless it
// sat between two core blocks and skipped lead-in/wind-down entirely.
//
// Relative imports here deliberately (see the note at the top of
// ./settings.ts) — this file needs to stay runnable under `npm test` without
// a path-alias resolver.

import { ARGUMENT_EXPAND_SECONDS_DEFAULT } from './constants';
import { formatCleanTranscript } from './formatCleanTranscript';
import type { ArgumentTag, TurnBlock } from './types';

/** Tags that anchor an argument range on their own — 'unrelated' and
 * 'logistics_or_normal' never anchor one, but DO get included when they fall
 * inside another anchor's expanded range. */
const CORE_ARGUMENT_TAGS = new Set<ArgumentTag>(['argument_conflict', 'repair_attempt', 'emotional_support']);

/** Every ArgumentTag value, for zero-filling buildTagSummary's result — kept
 * in sync with the enum in lib/types.ts. */
const ALL_ARGUMENT_TAGS: ArgumentTag[] = [
  'argument_conflict',
  'repair_attempt',
  'emotional_support',
  'logistics_or_normal',
  'unrelated',
  'unclear',
];

/**
 * Counts how many items carry each ArgumentTag value. Zero-filled: every tag
 * value is present in the result even if it never occurred, so the UI
 * summary line and debug JSON always show the full set. Untagged items are
 * not counted toward any bucket. Works on anything tagged — turn blocks
 * (the classification unit) or legacy tagged segments.
 */
export function buildTagSummary<T extends { tag?: ArgumentTag }>(items: T[]): Record<ArgumentTag, number> {
  const summary = Object.fromEntries(ALL_ARGUMENT_TAGS.map((tag) => [tag, 0])) as Record<ArgumentTag, number>;
  for (const item of items) {
    if (item.tag) summary[item.tag] += 1;
  }
  return summary;
}

function isCoreArgumentBlock(block: TurnBlock): boolean {
  return block.tag !== undefined && CORE_ARGUMENT_TAGS.has(block.tag);
}

export interface ArgumentRangeOptions {
  /** How far each core block's range extends before its start and after its end, in seconds. */
  expandSeconds?: number;
}

/** One merged argument range: expanded time bounds plus every intervening
 * block's ids (any tag) and their constituent segment ids, chronological. */
export interface ArgumentRange {
  start: number;
  end: number;
  blockIds: string[];
  segmentIds: string[];
}

/**
 * Builds the argument ranges for a classified transcript:
 * 1. Every conflict / repair / emotional-support block anchors a range.
 * 2. Each range extends `expandSeconds` before the block's start and after its end.
 * 3. Overlapping or adjacent ranges merge into one.
 * 4. Every block intersecting a merged range is included, regardless of tag.
 * Ranges and their block ids stay in chronological order; blocks outside
 * every range (isolated unrelated/neutral stretches) are excluded. Returns
 * [] when nothing anchors a range.
 */
export function buildArgumentRanges(blocks: TurnBlock[], options: ArgumentRangeOptions = {}): ArgumentRange[] {
  const expandSeconds = Math.max(0, options.expandSeconds ?? ARGUMENT_EXPAND_SECONDS_DEFAULT);
  const sorted = [...blocks].sort((a, b) => a.start - b.start);

  const cores = sorted.filter(isCoreArgumentBlock);
  if (cores.length === 0) return [];

  // Expand + merge (cores are sorted, so a single pass merges).
  const merged: { start: number; end: number }[] = [];
  for (const core of cores) {
    const start = Math.max(0, core.start - expandSeconds);
    const end = core.end + expandSeconds;
    const last = merged[merged.length - 1];
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
    } else {
      merged.push({ start, end });
    }
  }

  const idByBlock = new Map<TurnBlock, string>(sorted.map((block, i) => [block, block.id ?? `b${i}`]));
  return merged.map((range) => {
    const inRange = sorted.filter((block) => block.start < range.end && block.end > range.start);
    return {
      start: range.start,
      end: range.end,
      blockIds: inRange.map((block) => idByBlock.get(block)!),
      segmentIds: inRange.flatMap((block) => block.segmentIds ?? []),
    };
  });
}

/**
 * Filters turn blocks down to the ones inside any argument range — every
 * core block plus everything (any tag) within the expanded/merged ranges, in
 * chronological order. Blocks outside every range are excluded.
 */
export function filterArgumentRelevant(blocks: TurnBlock[], options: ArgumentRangeOptions = {}): TurnBlock[] {
  const ranges = buildArgumentRanges(blocks, options);
  if (ranges.length === 0) return [];
  return [...blocks]
    .sort((a, b) => a.start - b.start)
    .filter((block) => ranges.some((range) => block.start < range.end && block.end > range.start));
}

/**
 * Builds the downloadable/copyable "argument-relevant" transcript text:
 * filters `blocks` down via filterArgumentRelevant, then formats exactly
 * like the full cleaned transcript (formatCleanTranscript) so the two
 * exports stay visually consistent.
 */
export function formatArgumentRelevantTranscript(blocks: TurnBlock[], options: ArgumentRangeOptions = {}): string {
  return formatCleanTranscript(filterArgumentRelevant(blocks, options));
}
