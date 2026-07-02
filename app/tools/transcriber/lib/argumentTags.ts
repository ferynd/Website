// Pure helpers for the argument-tagging feature (Phase 5): a zero-filled tag
// summary for the debug log/UI, and the "argument-relevant" filtered export
// that keeps only turn blocks plausibly relevant to reviewing a couple's
// argument, plus a small window of surrounding context.
//
// Relative imports here deliberately (see the note at the top of
// ./settings.ts) — this file needs to stay runnable under `npm test` without
// a path-alias resolver.

import { formatCleanTranscript } from './formatCleanTranscript';
import type { ArgumentTag, TaggedTranscriptSegment, TurnBlock } from './types';

/* ------------------------------------------------------------ */
/* CONFIGURATION: argument-relevant export tuning                */
/* ------------------------------------------------------------ */

/**
 * Maximum gap (seconds) between an `unclear`/untagged turn block and each of
 * its nearest argument-relevant (core-tagged) neighbors for it to be kept as
 * lead-up/context. A block further than this from either neighbor is
 * excluded rather than dragging in unrelated stretches of the recording.
 */
export const ARGUMENT_RELEVANT_GAP_SECONDS = 120;

/** Tags that always count as argument-relevant on their own — see
 * filterArgumentRelevant below. 'unrelated' and 'logistics_or_normal' are
 * deliberately excluded (logistics/normal chatter is common and not itself
 * argument-relevant; unrelated is explicitly out of scope even as context). */
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
 * Counts how many segments carry each ArgumentTag value. Zero-filled: every
 * tag value is present in the result even if it never occurred, so the UI
 * summary line and debug JSON always show the full set. Untagged segments
 * (tagging was off, or a segment somehow has no tag) are not counted toward
 * any bucket.
 */
export function buildTagSummary(segments: TaggedTranscriptSegment[]): Record<ArgumentTag, number> {
  const summary = Object.fromEntries(ALL_ARGUMENT_TAGS.map((tag) => [tag, 0])) as Record<ArgumentTag, number>;
  for (const segment of segments) {
    if (segment.tag) summary[segment.tag] += 1;
  }
  return summary;
}

function isCoreArgumentBlock(block: TurnBlock): boolean {
  return block.tag !== undefined && CORE_ARGUMENT_TAGS.has(block.tag);
}

/**
 * Filters turn blocks down to the ones worth reviewing for an argument
 * export: every `argument_conflict` / `repair_attempt` / `emotional_support`
 * block, PLUS any `unclear`/untagged block that sits close enough (within
 * ARGUMENT_RELEVANT_GAP_SECONDS of BOTH its nearest core-tagged neighbor
 * before and after it) to read as lead-up/context for one. `unrelated` and
 * `logistics_or_normal` blocks are excluded even when they'd otherwise be
 * "sandwiched" — only an ambiguous/untagged block can count as context.
 * Order is preserved (blocks are expected already sorted by start time, as
 * mergeTurns/TurnBlock output is).
 */
export function filterArgumentRelevant(blocks: TurnBlock[]): TurnBlock[] {
  const keep = blocks.map(isCoreArgumentBlock);

  for (let i = 0; i < blocks.length; i++) {
    if (keep[i]) continue;

    const tag = blocks[i].tag;
    const isSandwichCandidate = tag === undefined || tag === 'unclear';
    if (!isSandwichCandidate) continue; // 'unrelated' / 'logistics_or_normal' never included as context

    let prevCore: TurnBlock | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (isCoreArgumentBlock(blocks[j])) {
        prevCore = blocks[j];
        break;
      }
    }

    let nextCore: TurnBlock | null = null;
    for (let j = i + 1; j < blocks.length; j++) {
      if (isCoreArgumentBlock(blocks[j])) {
        nextCore = blocks[j];
        break;
      }
    }

    if (
      prevCore &&
      nextCore &&
      blocks[i].start - prevCore.end < ARGUMENT_RELEVANT_GAP_SECONDS &&
      nextCore.start - blocks[i].end < ARGUMENT_RELEVANT_GAP_SECONDS
    ) {
      keep[i] = true;
    }
  }

  return blocks.filter((_, i) => keep[i]);
}

/**
 * Builds the downloadable/copyable "argument-relevant" transcript text:
 * filters `blocks` down via filterArgumentRelevant, then formats exactly
 * like the full cleaned transcript (formatCleanTranscript) so the two
 * exports stay visually consistent.
 */
export function formatArgumentRelevantTranscript(blocks: TurnBlock[]): string {
  return formatCleanTranscript(filterArgumentRelevant(blocks));
}
