import type { TranscriptSegment } from './types';

export interface RawDiarizedSegment {
  start: number;
  end: number;
  text: string;
  speaker: string;
}

export interface RawFallbackSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * OpenAI's diarized_json response labels distinct speakers sequentially
 * ("A", "B", "C", ...) in order of first appearance, unless known-speaker
 * reference audio clips are supplied — this UI doesn't collect voice
 * samples, so we always get sequential labels. This maps those raw labels
 * onto the user-provided speaker names in the same first-appearance order
 * (matching the UI's "first person speaking" convention). Any raw speaker
 * beyond the provided names list is labeled 'Unknown' rather than guessed.
 */
export function mapDiarizedSegments(
  raw: RawDiarizedSegment[],
  speakerNames: string[],
): TranscriptSegment[] {
  const labelToName = new Map<string, string>();
  let nextNameIndex = 0;

  return raw.map((seg) => {
    const rawLabel = seg.speaker || 'Unknown';
    let name = labelToName.get(rawLabel);
    if (!name) {
      name = speakerNames[nextNameIndex] ?? 'Unknown';
      labelToName.set(rawLabel, name);
      nextNameIndex += 1;
    }
    return { start: seg.start, end: seg.end, speaker: name, text: seg.text };
  });
}

/** whisper-1 has no speaker concept at all — every segment starts Unknown
 * until the correction pass infers speakers from context. */
export function mapFallbackSegments(raw: RawFallbackSegment[]): TranscriptSegment[] {
  return raw.map((seg) => ({ start: seg.start, end: seg.end, speaker: 'Unknown', text: seg.text }));
}
