// Chunk-local speaker mapping for one OpenAI diarized response. Pure and
// deterministic — every decision here is recorded in the segment's
// provenance fields so the global reconciliation stage
// (lib/reconcileSpeakers.ts) and the targeted repair stage can build on it.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import {
  EXACT_NAME_CONFIDENCE,
  EXACT_NAME_CONFIDENCE_WITH_CLIPS,
  POSITIONAL_CONFIDENCE,
} from './constants';
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

export interface MapDiarizedOptions {
  /** True when known-speaker reference clips were attached to AND ACCEPTED
   * by the provider request (never true after a successful known-speaker-
   * rejection retry that dropped them) — an exact-name label is then
   * acoustically anchored (mappingSource 'acoustic', resolved immediately).
   * False (including "clips were supplied but rejected") means an exact
   * match is the model's own unverified inference (mappingSource
   * 'provider-exact') — a candidate only; see lib/reconcileSpeakers.ts. */
  clipsAttached?: boolean;
}

/** Chunk-local identity key for an exact known-name match — global by
 * construction (the same name is the same person in every chunk). */
export function knownNameIdentity(name: string): string {
  return `name:${name.toLowerCase()}`;
}

/** Chunk-local identity key for an anonymous/malformed provider label —
 * NOT yet chunk-qualified; lib/segmentProvenance.ts prefixes it with the
 * chunk index client-side (`c<chunk>:label:<key>`), because the same "A" in
 * two different chunks is two different local identities. */
export function anonymousLabelIdentity(rawLabel: string): string {
  const key = rawLabel.trim().toLowerCase() || 'blank';
  return `label:${key}`;
}

/** Stable display name for an unresolved local identity: a short
 * alphanumeric provider label keeps its letter ("Speaker A"); anything
 * malformed/long gets a sequential number by first appearance ("Speaker 1").
 * Never the generic "Unknown" — distinct local identities stay visibly
 * distinct so they can be reviewed, repaired, and merged safely. */
export function unresolvedDisplayName(rawLabel: string, weirdLabelSequence: number): string {
  const trimmed = rawLabel.trim();
  if (/^[a-z0-9]{1,3}$/i.test(trimmed)) return `Speaker ${trimmed.toUpperCase()}`;
  return `Speaker ${weirdLabelSequence}`;
}

/**
 * Maps one diarized response's raw speaker labels to known names +
 * chunk-local identities:
 *
 * - A raw label that case-insensitively matches a provided name is kept as
 *   that canonical name. When `options.clipsAttached` is true (accepted
 *   acoustic reference clips), this is a real acoustic anchor
 *   (mappingSource 'acoustic') and resolves the segment immediately
 *   (`resolvedSpeaker` set). Otherwise it's the model's own unverified
 *   inference (mappingSource 'provider-exact') — a candidate only
 *   (`candidateSpeaker`); only independent corroboration in
 *   lib/reconcileSpeakers.ts (an overlap/continuity link to an acoustic
 *   anchor, a user confirmation, or the repair stage) can resolve it.
 * - Anonymous labels (A/B/C…) map to the still-unclaimed provided names in
 *   first-appearance order (mappingSource 'positional') — a claimed name is
 *   never handed out twice positionally, and this NEVER resolves a segment
 *   by itself either (`candidateSpeaker` only) — a first-appearance guess
 *   alone is never corroborating evidence, regardless of which chunk it
 *   came from.
 * - Every anonymous label beyond the available names stays a DISTINCT
 *   unresolved local identity with a stable display name ("Speaker C"),
 *   never a shared generic "Unknown". In particular, a response mixing exact
 *   names with anonymous labels (e.g. Kait, A, James) keeps "A" as its own
 *   identity instead of discarding it just because every known name was
 *   claimed — several provider labels may legitimately be the same real
 *   person, and that resolution belongs to reconciliation/repair, not here.
 * - Missing/blank labels share one stable 'blank' local identity.
 *
 * Segment ids/chunk indices are NOT assigned here — this runs server-side
 * per request, which doesn't know the chunk index; see
 * lib/segmentProvenance.ts's attachChunkProvenance.
 */
export function mapDiarizedSegments(
  raw: RawDiarizedSegment[],
  speakerNames: string[],
  options: MapDiarizedOptions = {},
): TranscriptSegment[] {
  const nameByLower = new Map(speakerNames.map((name) => [name.toLowerCase(), name]));
  const acousticallyAnchored = options.clipsAttached === true;

  // Pre-scan so positional assignment never hands out a name a later (or
  // earlier) segment already claimed via an exact match.
  const claimedNames = new Set<string>();
  for (const seg of raw) {
    const exact = nameByLower.get((seg.speaker || '').toLowerCase());
    if (exact) claimedNames.add(exact);
  }

  const positionalNameByLabel = new Map<string, string>();
  let nextNameIndex = 0;
  const nextAvailableName = (): string | null => {
    while (nextNameIndex < speakerNames.length) {
      const candidate = speakerNames[nextNameIndex];
      nextNameIndex += 1;
      if (!claimedNames.has(candidate)) return candidate;
    }
    return null;
  };

  const unresolvedDisplayByLabel = new Map<string, string>();
  let weirdLabelCount = 0;

  return raw.map((seg) => {
    const rawLabel = seg.speaker || '';
    const exact = nameByLower.get(rawLabel.toLowerCase());
    if (exact) {
      if (acousticallyAnchored) {
        return {
          start: seg.start,
          end: seg.end,
          speaker: exact,
          text: seg.text,
          providerLabel: rawLabel,
          localSpeakerId: knownNameIdentity(exact),
          resolvedSpeaker: exact,
          speakerConfidence: EXACT_NAME_CONFIDENCE_WITH_CLIPS,
          mappingSource: 'acoustic' as const,
        };
      }
      return {
        start: seg.start,
        end: seg.end,
        speaker: exact,
        text: seg.text,
        providerLabel: rawLabel,
        localSpeakerId: knownNameIdentity(exact),
        candidateSpeaker: exact,
        speakerConfidence: EXACT_NAME_CONFIDENCE,
        mappingSource: 'provider-exact' as const,
      };
    }

    // Anonymous label: first appearance claims the next unclaimed name (if
    // any); repeats reuse the same decision.
    let positionalName = positionalNameByLabel.get(rawLabel);
    if (positionalName === undefined && !unresolvedDisplayByLabel.has(rawLabel)) {
      const name = nextAvailableName();
      if (name !== null) {
        positionalName = name;
        positionalNameByLabel.set(rawLabel, name);
      } else {
        const trimmed = rawLabel.trim();
        if (!/^[a-z0-9]{1,3}$/i.test(trimmed)) weirdLabelCount += 1;
        unresolvedDisplayByLabel.set(rawLabel, unresolvedDisplayName(rawLabel, weirdLabelCount));
      }
    }

    if (positionalName !== undefined) {
      return {
        start: seg.start,
        end: seg.end,
        // Display the positional guess (better than a bare local-identity
        // label), but it stays a CANDIDATE — never resolvedSpeaker — until
        // reconciliation/repair corroborates it.
        speaker: positionalName,
        text: seg.text,
        providerLabel: rawLabel,
        localSpeakerId: anonymousLabelIdentity(rawLabel),
        candidateSpeaker: positionalName,
        speakerConfidence: POSITIONAL_CONFIDENCE,
        mappingSource: 'positional' as const,
      };
    }

    return {
      start: seg.start,
      end: seg.end,
      speaker: unresolvedDisplayByLabel.get(rawLabel)!,
      text: seg.text,
      providerLabel: rawLabel,
      localSpeakerId: anonymousLabelIdentity(rawLabel),
      speakerConfidence: 0,
      mappingSource: 'unresolved' as const,
    };
  });
}

/** whisper-1 has no speaker concept at all — every segment starts Unknown,
 * with no local identity (there is genuinely nothing to anchor one to). The
 * targeted speaker-repair stage infers speakers from context afterwards. */
export function mapFallbackSegments(raw: RawFallbackSegment[]): TranscriptSegment[] {
  return raw.map((seg) => ({
    start: seg.start,
    end: seg.end,
    speaker: 'Unknown',
    text: seg.text,
    providerLabel: '',
    speakerConfidence: 0,
    mappingSource: 'unresolved' as const,
  }));
}
