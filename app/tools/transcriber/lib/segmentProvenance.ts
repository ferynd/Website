// Client-side segment provenance: stable ids + chunk-qualified local speaker
// identities. Runs once per transcription chunk/window, immediately after
// the provider response is parsed — BEFORE reconciliation, suppression,
// correction, or merging, so every later stage can rely on the ids.
//
// Stable ids are derived from (chunkIndex, position-in-chunk) only — never
// from text or speaker names — so corrections and repairs can't shift them.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import type { TranscriptSegment } from './types';

/** Builds the stable segment id for position `indexInChunk` of chunk `chunkIndex`. */
export function buildSegmentId(chunkIndex: number, indexInChunk: number): string {
  return `s${chunkIndex}-${indexInChunk}`;
}

/** Chunk-qualifies an anonymous local speaker identity ("label:a" ->
 * "c3:label:a"). Known-name identities ("name:kait") stay global — the same
 * name is the same person in every chunk by definition. */
export function qualifyLocalSpeakerId(localSpeakerId: string, chunkIndex: number): string {
  return localSpeakerId.startsWith('name:') ? localSpeakerId : `c${chunkIndex}:${localSpeakerId}`;
}

/**
 * Attaches stable ids, the source chunk index, and chunk-qualified local
 * speaker identities to one chunk's segments. Idempotent inputs are not
 * expected — call exactly once per provider response. Existing provenance
 * from the server-side mapper (providerLabel, mappingSource, confidence)
 * passes through untouched.
 */
export function attachChunkProvenance<T extends TranscriptSegment>(segments: T[], chunkIndex: number): T[] {
  return segments.map((seg, i) => ({
    ...seg,
    id: buildSegmentId(chunkIndex, i),
    chunkIndex,
    ...(seg.localSpeakerId ? { localSpeakerId: qualifyLocalSpeakerId(seg.localSpeakerId, chunkIndex) } : {}),
  }));
}

/**
 * Guarantees every segment carries a stable id — position-based fallback
 * (`x-<index>`) for anything a provider path failed to id (belt-and-braces;
 * both provider modules attach real ids). Position never depends on
 * corrected text or speakers, so the fallback is still stable.
 */
export function ensureSegmentIds<T extends TranscriptSegment>(segments: T[]): T[] {
  if (segments.every((seg) => typeof seg.id === 'string' && seg.id.length > 0)) return segments;
  return segments.map((seg, i) => (seg.id ? seg : { ...seg, id: `x-${i}` }));
}

/** True when this segment has a resolved global speaker (auto-assigned or
 * user-confirmed) — the complement of "unresolved" everywhere in the
 * quality gate and repair selection. */
export function isResolvedSegment(seg: TranscriptSegment): boolean {
  return seg.userConfirmed === true || typeof seg.resolvedSpeaker === 'string';
}

/** Word count used consistently by the quality gate and eval tooling. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}
