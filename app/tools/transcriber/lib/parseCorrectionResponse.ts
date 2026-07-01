export interface CorrectionResultItem {
  index: number;
  speaker: string;
  text: string;
}

/**
 * Parses and validates the correction model's JSON-array response. Items
 * missing required fields, with the wrong types, or referencing an index
 * outside the chunk that was sent are silently dropped — the caller falls
 * back to the original (uncorrected) segment for anything that's missing.
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
