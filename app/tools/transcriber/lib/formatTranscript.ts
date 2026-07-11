import type { TranscriptSegment } from './types';

/** Formats seconds as zero-padded HH:MM:SS (hours are not capped at 24). */
export function formatTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatSegmentLine(segment: TranscriptSegment): string {
  return `[${formatTimestamp(segment.start)}] ${segment.speaker}: ${segment.text}`;
}

/** Builds the final downloadable .txt transcript, sorted by start time. */
export function buildTranscriptText(segments: TranscriptSegment[]): string {
  return segments
    .slice()
    .sort((a, b) => a.start - b.start)
    .map(formatSegmentLine)
    .join('\n');
}

/**
 * Cleans up raw segments coming from either OpenAI or a correction pass:
 * clamps negative/NaN times, ensures end >= start, defaults a missing/blank
 * speaker to 'Unknown', trims text, and drops empty lines. Provenance fields
 * (id, chunkIndex, localSpeakerId, ...) pass through untouched.
 */
export function normalizeSegments<T extends TranscriptSegment>(segments: T[]): T[] {
  return segments
    .map((seg) => {
      const start = Number.isFinite(seg.start) ? Math.max(0, seg.start) : 0;
      const endRaw = Number.isFinite(seg.end) ? seg.end : start;
      const end = Math.max(start, endRaw);
      const speaker = (seg.speaker ?? '').toString().trim() || 'Unknown';
      const text = (seg.text ?? '').toString().trim();
      return { ...seg, start, end, speaker, text };
    })
    .filter((seg) => seg.text.length > 0);
}
