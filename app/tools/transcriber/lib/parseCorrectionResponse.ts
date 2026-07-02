import type { ArgumentTag } from './types';

const VALID_ARGUMENT_TAGS = new Set<ArgumentTag>([
  'argument_conflict',
  'repair_attempt',
  'emotional_support',
  'logistics_or_normal',
  'unrelated',
  'unclear',
]);

export interface CorrectionResultItem {
  index: number;
  speaker: string;
  text: string;
  /** Only ever set when the caller passed `argumentTagging: true` — see parseCorrectionResponse's third parameter. */
  tag?: ArgumentTag;
}

/**
 * Parses and validates the correction model's JSON-array response. Items
 * missing required fields, with the wrong types, or referencing an index
 * outside the chunk that was sent are silently dropped. Callers should pair
 * this with `findMissingIndices` and reject the whole chunk (rather than
 * quietly filling gaps with uncorrected text) so a partial/malformed
 * response is treated as a correction failure — see the correct API route.
 *
 * `argumentTagging` (Phase 5, default false) controls the optional per-item
 * `tag` field: when true, a valid ArgumentTag value passes through as-is and
 * a missing/invalid one falls back to `'unclear'` — a bad tag NEVER causes
 * the item itself to be dropped/rejected, unlike a missing/malformed
 * index/speaker/text above. When false, any `tag` present in the raw
 * response is ignored/stripped — the returned item never carries one.
 */
export function parseCorrectionResponse(
  raw: string,
  expectedIndices: number[],
  argumentTagging = false,
): CorrectionResultItem[] {
  const cleaned = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Correction model returned invalid JSON.');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Correction model did not return a JSON array.');
  }

  const expected = new Set(expectedIndices);
  const results: CorrectionResultItem[] = [];

  for (const item of parsed) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).index === 'number' &&
      typeof (item as Record<string, unknown>).speaker === 'string' &&
      typeof (item as Record<string, unknown>).text === 'string' &&
      expected.has((item as { index: number }).index)
    ) {
      const record = item as { index: number; speaker: string; text: string };
      const result: CorrectionResultItem = { index: record.index, speaker: record.speaker, text: record.text };
      if (argumentTagging) {
        const rawTag = (item as Record<string, unknown>).tag;
        result.tag =
          typeof rawTag === 'string' && VALID_ARGUMENT_TAGS.has(rawTag as ArgumentTag)
            ? (rawTag as ArgumentTag)
            : 'unclear';
      }
      results.push(result);
    }
  }

  return results;
}

/**
 * Returns which of `expectedIndices` have no corresponding correction.
 * A non-empty result means the correction response was incomplete (the
 * model dropped a line, or `parseCorrectionResponse` rejected a malformed
 * item) and the whole chunk should be treated as failed rather than
 * silently patched with uncorrected text for just the missing lines.
 */
export function findMissingIndices(expectedIndices: number[], corrections: CorrectionResultItem[]): number[] {
  const covered = new Set(corrections.map((c) => c.index));
  return expectedIndices.filter((index) => !covered.has(index));
}
