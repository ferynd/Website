// Conservative hallucinated-filler suppression for the "cleaned" output.
// Whisper/GPT-4o-transcribe-style ASR models sometimes hallucinate a short
// stock phrase ("Hold on.", "Thank you.") repeatedly across long silences or
// noise. This only removes a group of short, near-identical segments when
// count, time span, AND regularity of repetition ALL indicate a mechanical
// artifact rather than a real, if repetitive, conversation — the conjunction
// is what protects genuine short replies (e.g. scattered "yeah"s) from being
// dropped. Raw output is always built from the un-suppressed segments
// upstream of this pass (see useTranscriberPipeline.ts), so nothing is ever
// silently lost from the raw transcript.

import type { SuppressionReport, TranscriptSegment } from './types';

export type SuppressionSensitivity = 'conservative' | 'aggressive';

export interface SuppressArtifactsResult {
  segments: TranscriptSegment[];
  report: SuppressionReport;
}

/* ------------------------------------------------------------ */
/* CONFIGURATION: suppression thresholds                         */
/* ------------------------------------------------------------ */

/** Only segments whose normalized text has fewer words than this are ever considered filler candidates. */
const MAX_WORDS_FOR_FILLER_CANDIDATE = 4;
/** Minimum repeat count for a group to be eligible for removal. */
const CONSERVATIVE_MIN_REPEATS = 5;
const AGGRESSIVE_MIN_REPEATS = 4;
/** Minimum time span (seconds) the group's occurrences must cover — rules out a tight burst of real repetition. */
const MIN_SPAN_SECONDS = 90;
/** Maximum coefficient of variation (stddev / mean) of successive-start gaps — rules out irregular, conversational spacing. */
const CONSERVATIVE_MAX_CV = 0.4;
const AGGRESSIVE_MAX_CV = 0.7;

/** Lowercase, strip punctuation, collapse whitespace — the key used to group repeated short segments. */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(normalized: string): number {
  return normalized.length === 0 ? 0 : normalized.split(' ').length;
}

/**
 * Coefficient-of-variation regularity check. A group with fewer than 2 gaps
 * can't produce a meaningful variation figure (division by ~nothing), so in
 * that edge case regularity is treated as satisfied only when the span gate
 * already passed — it never removes a group on regularity grounds alone.
 */
function isRegular(gaps: number[], maxCv: number, spanOk: boolean): boolean {
  if (gaps.length < 2) return spanOk;

  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  if (mean <= 0) return false; // simultaneous/overlapping starts aren't "regular repetition" over time

  const variance = gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length;
  const coefficientOfVariation = Math.sqrt(variance) / mean;
  return coefficientOfVariation <= maxCv;
}

/**
 * Removes clusters of hallucinated short filler phrases from `segments`.
 * A group of segments sharing the same normalized (<4-word) text is removed
 * only if it meets ALL three gates: count, time span, and gap regularity.
 * Everything else — including all segments with >=4 normalized words — is
 * always preserved.
 */
export function suppressArtifacts(
  segments: TranscriptSegment[],
  sensitivity: SuppressionSensitivity,
): SuppressArtifactsResult {
  const minRepeats = sensitivity === 'aggressive' ? AGGRESSIVE_MIN_REPEATS : CONSERVATIVE_MIN_REPEATS;
  const maxCv = sensitivity === 'aggressive' ? AGGRESSIVE_MAX_CV : CONSERVATIVE_MAX_CV;

  // Group short-text segments by normalized phrase, preserving original index for removal/lookup.
  const groups = new Map<string, { segment: TranscriptSegment; index: number }[]>();
  segments.forEach((segment, index) => {
    const normalized = normalizeText(segment.text);
    if (normalized.length === 0) return;
    if (wordCount(normalized) >= MAX_WORDS_FOR_FILLER_CANDIDATE) return;

    const list = groups.get(normalized);
    if (list) {
      list.push({ segment, index });
    } else {
      groups.set(normalized, [{ segment, index }]);
    }
  });

  const removeIndices = new Set<number>();
  const removed: SuppressionReport['removed'] = [];
  const boundaryTimes: number[] = [];

  for (const [phrase, members] of groups) {
    if (members.length < minRepeats) continue;

    const sorted = [...members].sort((a, b) => a.segment.start - b.segment.start);
    const first = sorted[0].segment;
    const last = sorted[sorted.length - 1].segment;
    const span = last.start - first.start;
    const spanOk = span >= MIN_SPAN_SECONDS;
    if (!spanOk) continue;

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(sorted[i].segment.start - sorted[i - 1].segment.start);
    }
    if (!isRegular(gaps, maxCv, spanOk)) continue;

    for (const { index, segment } of sorted) {
      removeIndices.add(index);
      boundaryTimes.push(segment.start);
    }
    removed.push({ phrase, count: sorted.length, timeRange: [first.start, last.start] });
  }

  const keptSegments = segments.filter((_, index) => !removeIndices.has(index));
  boundaryTimes.sort((a, b) => a - b);

  return {
    segments: keptSegments,
    report: { removed, boundaryTimes },
  };
}
