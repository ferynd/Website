export interface CorrectionResultItem {
  index: number;
  speaker: string;
  text: string;
}

/**
 * Parses and validates the correction model's JSON-array response. Items
 * missing required fields, with the wrong types, or referencing an index
 * outside the chunk that was sent are silently dropped. Callers should pair
 * this with `findMissingIndices` and reject the whole chunk (rather than
 * quietly filling gaps with uncorrected text) so a partial/malformed
 * response is treated as a correction failure — see the correct API route.
 */
export function parseCorrectionResponse(raw: string, expectedIndices: number[]): CorrectionResultItem[] {
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
      results.push({ index: record.index, speaker: record.speaker, text: record.text });
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
