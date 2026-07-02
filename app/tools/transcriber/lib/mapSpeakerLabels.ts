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
 * ("A", "B", "C", ...) in order of first appearance when no known-speaker
 * reference audio clips are supplied. But when known_speaker_names[]/
 * known_speaker_references[] ARE supplied, OpenAI may return `segment.speaker`
 * already set to one of those names directly (in any order — whichever
 * profile speaks first). Any raw label that case-insensitively matches a
 * provided speaker name is kept as that canonical name unchanged; only labels
 * that don't match any provided name (the anonymous A/B/C style) get the
 * first-appearance positional mapping, which itself skips any name already
 * claimed by an exact match so it can never steal a name from — or get
 * reassigned onto — a different speaker. Any raw speaker beyond the
 * available names is labeled 'Unknown' rather than guessed.
 */
export function mapDiarizedSegments(
  raw: RawDiarizedSegment[],
  speakerNames: string[],
): TranscriptSegment[] {
  const nameByLower = new Map(speakerNames.map((name) => [name.toLowerCase(), name]));

  // Pre-scan so positional assignment never hands out a name a later (or
  // earlier) segment already claimed via an exact match.
  const claimedNames = new Set<string>();
  for (const seg of raw) {
    const exact = nameByLower.get((seg.speaker || '').toLowerCase());
    if (exact) claimedNames.add(exact);
  }

  const labelToName = new Map<string, string>();
  let nextNameIndex = 0;
  const nextAvailableName = (): string => {
    while (nextNameIndex < speakerNames.length) {
      const candidate = speakerNames[nextNameIndex];
      nextNameIndex += 1;
      if (!claimedNames.has(candidate)) return candidate;
    }
    return 'Unknown';
  };

  return raw.map((seg) => {
    const rawLabel = seg.speaker || 'Unknown';
    const exact = nameByLower.get(rawLabel.toLowerCase());
    if (exact) {
      return { start: seg.start, end: seg.end, speaker: exact, text: seg.text };
    }
    let name = labelToName.get(rawLabel);
    if (!name) {
      name = nextAvailableName();
      labelToName.set(rawLabel, name);
    }
    return { start: seg.start, end: seg.end, speaker: name, text: seg.text };
  });
}

/** whisper-1 has no speaker concept at all — every segment starts Unknown
 * until the correction pass infers speakers from context. */
export function mapFallbackSegments(raw: RawFallbackSegment[]): TranscriptSegment[] {
  return raw.map((seg) => ({ start: seg.start, end: seg.end, speaker: 'Unknown', text: seg.text }));
}
