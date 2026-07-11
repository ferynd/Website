// Parses + validates the sparse text-correction response: a JSON object of
// shape {"patches": [{"id", "text"}]}. Only ids that belong to the request
// survive; duplicates keep the FIRST occurrence; anything malformed is
// dropped. An empty patches array is a valid "nothing needed fixing"
// response — sparseness means a missing segment is by definition unchanged,
// never an error.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import type { CorrectionPatch } from './types';

/** Strips markdown code fences a model sometimes wraps JSON output in. */
function stripFences(raw: string): string {
  return raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
}

/**
 * Parses the correction model's sparse-patch response. Throws on
 * invalid JSON or a shape that isn't `{patches: [...]}` (a bare array is
 * accepted defensively); silently drops patch items that are malformed,
 * reference an id outside `allowedIds`, or repeat an id already seen.
 */
export function parseCorrectionPatches(raw: string, allowedIds: string[]): CorrectionPatch[] {
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

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    // Accept both the documented `id` key and a defensive `segmentId`.
    const id = typeof record.id === 'string' ? record.id : typeof record.segmentId === 'string' ? record.segmentId : null;
    if (id === null || typeof record.text !== 'string') continue;
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    patches.push({ segmentId: id, text: record.text });
  }

  return patches;
}
