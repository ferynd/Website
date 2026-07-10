// Post-response sanity guard for the cleanup pass (the "audit" review step
// in app/api/transcriber/correct/route.ts): the correction prompt is
// preservation-first — fix obvious ASR errors, punctuation, and speaker
// flips only — so a legitimate correction never changes a line's length
// much. A corrected text that shrinks or grows far beyond the original is a
// paraphrase, a summary, or a hallucinated rewrite, and the original text
// wins (the speaker fix, if any, is kept — only the text reverts).
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

/* ------------------------------------------------------------ */
/* CONFIGURATION: divergence thresholds                          */
/* ------------------------------------------------------------ */

/** Originals shorter than this are exempt from the ratio check — a short
 * line legitimately changes a lot ("uh huh" → "Uh-huh.", a fixed
 * one-word mishearing), and tiny denominators make ratios meaningless. */
export const GUARD_MIN_ORIGINAL_CHARS = 20;

/** Corrected text under this fraction of the original's length looks like a
 * summary/truncation, not a preservation-first correction. */
export const GUARD_MIN_LENGTH_RATIO = 0.5;

/** Corrected text over this multiple of the original's length looks like
 * invented/expanded content, not a preservation-first correction. */
export const GUARD_MAX_LENGTH_RATIO = 2.0;

/**
 * True when the model's corrected text for one segment should be discarded
 * in favor of the original: empty output always reverts; for originals of
 * at least GUARD_MIN_ORIGINAL_CHARS, so does a corrected length outside
 * [GUARD_MIN_LENGTH_RATIO, GUARD_MAX_LENGTH_RATIO] × the original's length.
 * Deliberately conservative — ASR-word fixes, punctuation, and casing all
 * pass untouched; only wild divergence reverts.
 */
export function shouldRevertCorrection(originalText: string, correctedText: string): boolean {
  const original = originalText.trim();
  const corrected = correctedText.trim();
  if (corrected.length === 0) return true;
  if (original.length < GUARD_MIN_ORIGINAL_CHARS) return false;
  const ratio = corrected.length / original.length;
  return ratio < GUARD_MIN_LENGTH_RATIO || ratio > GUARD_MAX_LENGTH_RATIO;
}
