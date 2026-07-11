// Argument classification: pure builders/validators for the standalone
// block-classification stage. Conversational TURN BLOCKS (not tiny ASR
// fragments) are classified in contextual windows; the model returns ONLY
// {blockId, tag, confidence} — no text ever comes back. Windows overlap for
// context; every window's votes are aggregated deterministically and
// deduplicated by stable block id, with explicit coverage validation.
// Classification failures never invalidate the cleaned transcript — the
// caller degrades to untagged output.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import {
  CLASSIFY_BLOCKS_PER_WINDOW,
  CLASSIFY_MAX_BLOCK_CHARS,
  CLASSIFY_WINDOW_OVERLAP_BLOCKS,
} from './constants';
import type { ArgumentTag, BlockClassification, ClassifyRequestBlock, TurnBlock } from './types';

/** The six valid ArgumentTag values (lib/types.ts), in guidance order. */
export const ARGUMENT_TAG_VALUES: readonly ArgumentTag[] = [
  'argument_conflict',
  'repair_attempt',
  'emotional_support',
  'logistics_or_normal',
  'unrelated',
  'unclear',
] as const;

const VALID_TAGS = new Set<ArgumentTag>(ARGUMENT_TAG_VALUES);

/** One line of guidance per ArgumentTag value — oriented to a couple's
 * argument recording. Update together with the enum in lib/types.ts. */
const ARGUMENT_TAG_GUIDANCE = [
  '- "argument_conflict": the block shows conflict or escalation between the speakers — disagreement, accusation, raised tension.',
  '- "repair_attempt": the block is an attempt to repair or de-escalate the conflict — apologizing, softening, seeking common ground.',
  '- "emotional_support": the block offers comfort, reassurance, or emotional support, especially in the aftermath of conflict.',
  '- "logistics_or_normal": the block is ordinary logistics or neutral, non-conflict conversation.',
  '- "unrelated": the block is clearly unrelated chatter — not part of the couple\'s exchange at all.',
  '- "unclear": you cannot confidently classify the block into any of the above.',
];

/* ------------------------------------------------------------ */
/* Units: blocks, with exceptionally long turns split safely     */
/* ------------------------------------------------------------ */

/** One classification input unit: usually a whole turn block; an
 * exceptionally long turn is split into parts that SHARE the block id, so
 * their votes aggregate back onto the one block. */
export interface ClassifyUnit {
  /** Wire id sent to the model — `blockId` or `blockId~partIndex`. */
  unitId: string;
  blockId: string;
  speaker: string;
  text: string;
}

/** Splits `text` into parts of at most `maxChars`, preferring sentence-ish
 * boundaries, never splitting inside a word. */
function splitLongText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const slice = rest.slice(0, maxChars);
    // Prefer the last sentence end in the slice; fall back to the last space.
    const sentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
    const cut = sentenceEnd >= maxChars * 0.4 ? sentenceEnd + 1 : Math.max(slice.lastIndexOf(' '), Math.floor(maxChars * 0.8));
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

/** Stable fallback id for a block that carries none (legacy shapes). */
export function fallbackBlockId(index: number): string {
  return `b${index}`;
}

/** Builds classification units from turn blocks, splitting exceptionally
 * long turns (over `maxChars`) into parts that share the block id. */
export function buildClassifyUnits(blocks: TurnBlock[], maxChars = CLASSIFY_MAX_BLOCK_CHARS): ClassifyUnit[] {
  const units: ClassifyUnit[] = [];
  blocks.forEach((block, index) => {
    const blockId = block.id ?? fallbackBlockId(index);
    const parts = splitLongText(block.text, maxChars);
    parts.forEach((part, p) => {
      units.push({
        unitId: parts.length === 1 ? blockId : `${blockId}~${p}`,
        blockId,
        speaker: block.speaker,
        text: part,
      });
    });
  });
  return units;
}

/* ------------------------------------------------------------ */
/* Windows                                                       */
/* ------------------------------------------------------------ */

export interface ClassifyWindow {
  index: number;
  units: ClassifyUnit[];
}

/**
 * Slices units into overlapping request windows: `blocksPerWindow` units per
 * window, the last `overlapBlocks` repeating at the start of the next window
 * as shared context. Every unit appears in at least one window; deterministic.
 */
export function buildClassifyWindows(
  units: ClassifyUnit[],
  options: { blocksPerWindow?: number; overlapBlocks?: number } = {},
): ClassifyWindow[] {
  const size = Math.max(1, options.blocksPerWindow ?? CLASSIFY_BLOCKS_PER_WINDOW);
  const overlap = Math.min(Math.max(0, options.overlapBlocks ?? CLASSIFY_WINDOW_OVERLAP_BLOCKS), size - 1);
  if (units.length === 0) return [];

  const step = size - overlap;
  const windows: ClassifyWindow[] = [];
  for (let start = 0, index = 0; ; start += step, index += 1) {
    const slice = units.slice(start, start + size);
    windows.push({ index, units: slice });
    if (start + size >= units.length) break;
  }
  return windows;
}

/** The request-body blocks for one window — wire ids are unit ids. */
export function windowToRequestBlocks(window: ClassifyWindow): ClassifyRequestBlock[] {
  return window.units.map((unit) => ({ id: unit.unitId, speaker: unit.speaker, text: unit.text }));
}

/* ------------------------------------------------------------ */
/* Prompt + schema + response validation                         */
/* ------------------------------------------------------------ */

export function buildClassifyPrompt(blocks: ClassifyRequestBlock[], contextNotes: string): string {
  const rules = [
    "You are classifying turns of a couple's recorded conversation by their role in the couple's argument/relationship discussion. Classify every block below with exactly one tag from:",
    ...ARGUMENT_TAG_GUIDANCE,
    'Judge each block in the context of the surrounding blocks. Report your confidence for each classification as a number between 0 and 1.',
  ];
  if (contextNotes.trim()) {
    rules.push(`Additional context from the user: ${contextNotes.trim()}`);
  }

  const lines = blocks.map((block) => ({ id: block.id, speaker: block.speaker, text: block.text }));

  const instructions = [
    '',
    'Respond with ONLY a strict JSON object (no prose, no markdown code fences) of exactly this shape:',
    '{"classifications": [{"blockId": string, "tag": string, "confidence": number}]}',
    'Return exactly one classification per input block, reusing each block\'s exact "id" as "blockId". Never return text.',
    '',
    `Input blocks (JSON): ${JSON.stringify(lines)}`,
  ];

  return [...rules, ...instructions].join('\n');
}

/** Gemini structured-output schema for the classification response. */
export function buildClassifyResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      classifications: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            blockId: { type: 'STRING' },
            tag: { type: 'STRING', enum: [...ARGUMENT_TAG_VALUES] },
            confidence: { type: 'NUMBER' },
          },
          required: ['blockId', 'tag', 'confidence'],
        },
      },
    },
    required: ['classifications'],
  };
}

/** Strips markdown code fences a model sometimes wraps JSON output in. */
function stripFences(raw: string): string {
  return raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
}

/**
 * Parses + validates one window's classification response: ids must belong
 * to the request, tags must be valid, confidence must be a finite number
 * (clamped to [0, 1]); duplicates keep the first occurrence. Throws on
 * invalid JSON or a shape that isn't {classifications: [...]}.
 */
export function parseClassifyResponse(raw: string, allowedIds: string[]): BlockClassification[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error('Classifier returned invalid JSON.');
  }

  let items: unknown[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as Record<string, unknown>).classifications)
  ) {
    items = (parsed as Record<string, unknown>).classifications as unknown[];
  } else {
    throw new Error('Classifier did not return a {classifications: [...]} object.');
  }

  const allowed = new Set(allowedIds);
  const seen = new Set<string>();
  const out: BlockClassification[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id =
      typeof record.blockId === 'string' ? record.blockId : typeof record.id === 'string' ? record.id : null;
    if (id === null || !allowed.has(id) || seen.has(id)) continue;
    if (typeof record.tag !== 'string' || !VALID_TAGS.has(record.tag as ArgumentTag)) continue;
    if (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence)) continue;
    seen.add(id);
    out.push({
      blockId: id,
      tag: record.tag as ArgumentTag,
      confidence: Math.min(1, Math.max(0, record.confidence)),
    });
  }
  return out;
}

/* ------------------------------------------------------------ */
/* Aggregation                                                   */
/* ------------------------------------------------------------ */

/** Tie-break priority when two votes have equal confidence: conflict-ish
 * tags win so an argument block is never demoted by a tied neutral vote. */
const TAG_PRIORITY: Record<ArgumentTag, number> = {
  argument_conflict: 0,
  repair_attempt: 1,
  emotional_support: 2,
  logistics_or_normal: 3,
  unrelated: 4,
  unclear: 5,
};

export interface AggregatedClassifications {
  /** Winning tag + confidence per block id. */
  byBlockId: Map<string, { tag: ArgumentTag; confidence: number }>;
  /** Expected block ids that received no vote from any window — coverage gap. */
  missingBlockIds: string[];
}

/**
 * Aggregates every window's votes deterministically: votes are mapped from
 * wire unit ids back to block ids (long-turn parts collapse onto their
 * block), deduplicated, and resolved per block by highest confidence, then
 * tag priority, then earliest vote. EVERY window contributes — never only
 * the final one. Blocks with no vote are reported as coverage gaps.
 */
export function aggregateClassifications(
  units: ClassifyUnit[],
  votesPerWindow: BlockClassification[][],
): AggregatedClassifications {
  const blockIdByUnitId = new Map(units.map((u) => [u.unitId, u.blockId]));
  const expectedBlockIds = [...new Set(units.map((u) => u.blockId))];

  const byBlockId = new Map<string, { tag: ArgumentTag; confidence: number }>();
  for (const votes of votesPerWindow) {
    for (const vote of votes) {
      const blockId = blockIdByUnitId.get(vote.blockId);
      if (!blockId) continue;
      const current = byBlockId.get(blockId);
      const wins =
        !current ||
        vote.confidence > current.confidence ||
        (vote.confidence === current.confidence && TAG_PRIORITY[vote.tag] < TAG_PRIORITY[current.tag]);
      if (wins) byBlockId.set(blockId, { tag: vote.tag, confidence: vote.confidence });
    }
  }

  const missingBlockIds = expectedBlockIds.filter((id) => !byBlockId.has(id));
  return { byBlockId, missingBlockIds };
}

/**
 * Applies aggregated classifications to turn blocks immutably. Blocks with
 * no vote fall back to 'unclear' — a coverage gap never invalidates the
 * transcript; the caller surfaces `missingBlockIds` as a warning instead.
 */
export function applyBlockClassifications(
  blocks: TurnBlock[],
  aggregated: AggregatedClassifications,
): TurnBlock[] {
  return blocks.map((block, index) => {
    const blockId = block.id ?? fallbackBlockId(index);
    const winner = aggregated.byBlockId.get(blockId);
    return { ...block, tag: winner ? winner.tag : 'unclear' };
  });
}
