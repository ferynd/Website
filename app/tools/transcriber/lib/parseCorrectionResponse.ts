// Parses + validates the sparse text-correction response: a JSON object of
// shape {"patches": [{"id", "text"}]}. Only ids that belong to the request
// survive; duplicates keep the FIRST occurrence; anything else malformed
// (wrong shape, unknown id) is dropped but COUNTED as an invalid item — the
// caller uses that count to distinguish a genuinely empty {patches: []}
// response from one where the model attempted output that just didn't
// validate.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import type { CorrectionPatch } from './types';

export interface ParsedCorrectionPatches {
  patches: CorrectionPatch[];
  /** Items present in the raw response that were dropped: wrong shape,
   * unknown id, or a duplicate of an id already seen. A non-zero count
   * (even alongside valid patches) means the model ATTEMPTED output that
   * wasn't fully valid — distinct from a genuinely empty/clean response. */
  invalidCount: number;
}

/** Strips markdown code fences a model sometimes wraps JSON output in. */
function stripFences(raw: string): string {
  return raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
}

/**
 * Parses the correction model's sparse-patch response. Throws on invalid
 * JSON or a shape that isn't `{patches: [...]}` (a bare array is accepted
 * defensively) — those are unparseable, not merely invalid. Otherwise
 * returns every valid patch plus a count of items dropped for being
 * malformed, referencing an id outside `allowedIds`, or repeating an id
 * already seen.
 */
export function parseCorrectionPatches(raw: string, allowedIds: string[]): ParsedCorrectionPatches {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error('Correction model returned invalid JSON.');
  }

  let items: unknown[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).patches)) {
    items = (parsed as Record<string, unknown>).patches as unknown[];
  } else {
    throw new Error('Correction model did not return a {patches: [...]} object.');
  }

  const allowed = new Set(allowedIds);
  const seen = new Set<string>();
  const patches: CorrectionPatch[] = [];
  let invalidCount = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      invalidCount += 1;
      continue;
    }
    const record = item as Record<string, unknown>;
    // Accept both the documented `id` key and a defensive `segmentId`.
    const id = typeof record.id === 'string' ? record.id : typeof record.segmentId === 'string' ? record.segmentId : null;
    if (id === null || typeof record.text !== 'string') {
      invalidCount += 1;
      continue;
    }
    if (!allowed.has(id) || seen.has(id)) {
      invalidCount += 1;
      continue;
    }
    seen.add(id);
    patches.push({ segmentId: id, text: record.text });
  }

  return { patches, invalidCount };
}
