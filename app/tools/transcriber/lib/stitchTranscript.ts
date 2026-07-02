import type { ChunkWindowBounds } from './chunkTranscript';
import type { TaggedTranscriptSegment } from './types';

export interface ChunkResult {
  window: ChunkWindowBounds;
  /** TaggedTranscriptSegment (not plain TranscriptSegment) so an optional
   * ArgumentTag (Phase 5, from the correct route when argumentTagging is on)
   * survives stitching untouched — see useTranscriberPipeline.ts. */
  segments: TaggedTranscriptSegment[];
}

/**
 * Combines per-chunk corrected segments into one ordered transcript.
 *
 * Each chunk was sent to the correction model with overlap context on both
 * sides, but only its non-overlapping "core" region is kept here — segments
 * outside a window's [coreStart, coreEnd) range are discarded, since they
 * belong to a neighboring chunk's core instead. This prevents the overlap
 * regions from producing duplicated lines by construction. A belt-and-braces
 * de-dup on (start, speaker, text) guards against exact-boundary edge cases.
 */
export function stitchChunkResults(results: ChunkResult[]): TaggedTranscriptSegment[] {
  const lastIndex = results.reduce((max, r) => Math.max(max, r.window.index), 0);
  const seen = new Set<string>();
  const stitched: TaggedTranscriptSegment[] = [];

  for (const { window, segments } of results) {
    const isLastWindow = window.index === lastIndex;
    for (const seg of segments) {
      const inCore = seg.start >= window.coreStart && (isLastWindow || seg.start < window.coreEnd);
      if (!inCore) continue;

      const key = `${seg.start.toFixed(2)}|${seg.speaker}|${seg.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stitched.push(seg);
    }
  }

  return stitched.sort((a, b) => a.start - b.start);
}
