// Parses + normalizes a Gemini direct-transcription window response into
// TranscriptSegment[]. Pure — no fetch — so it's fully unit-testable. Used
// by app/api/transcriber/gemini/window/route.ts.
//
// Relative imports here deliberately (see note at top of ../../settings.ts)
// — this module is imported directly by vitest.

import {
  EXACT_NAME_CONFIDENCE,
  POSITIONAL_CONFIDENCE,
} from '../constants';
import { normalizeSegments } from '../formatTranscript';
import { anonymousLabelIdentity, knownNameIdentity, unresolvedDisplayName } from '../mapSpeakerLabels';
import type { SegmentProvenance, TranscriptSegment } from '../types';

export interface ParseGeminiTranscriptionOptions {
  /** Absolute seconds from the start of the recording — the window this call actually covered. */
  windowStart: number;
  windowEnd: number;
  speakerNames: string[];
}

/* ------------------------------------------------------------ */
/* CONFIGURATION: offset-heuristic slack + clamp padding (seconds) */
/* ------------------------------------------------------------ */

/** Slack added to the window span when deciding whether returned timestamps look window-relative rather than absolute. */
const OFFSET_HEURISTIC_SLACK_SECONDS = 60;
/** A window-relative response's earliest start must be under this to look plausible (an absolute response deep into a late window would not be). */
const OFFSET_HEURISTIC_MIN_START_CEILING_SECONDS = 60;
/** Segments are kept if they intersect [windowStart - CLAMP_BEFORE, windowEnd + CLAMP_AFTER] at all. */
const CLAMP_BEFORE_SECONDS = 30;
const CLAMP_AFTER_SECONDS = 60;

/* ------------------------------------------------------------ */
/* Timestamp parsing                                             */
/* ------------------------------------------------------------ */

const NUMERIC_COMPONENT_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Parses a Gemini-returned timestamp value into seconds. Accepts a raw
 * number (already seconds), or a string in "SS", "SS.mmm", "MM:SS", or
 * "H:MM:SS(.mmm)" form. Returns null for anything unparseable or negative —
 * callers drop the segment rather than guessing.
 */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const parts = trimmed.split(':').map((p) => p.trim());
  if (parts.length > 3 || parts.some((p) => !NUMERIC_COMPONENT_PATTERN.test(p))) return null;

  const nums = parts.map(Number);
  let seconds: number;
  if (nums.length === 1) {
    [seconds] = nums;
  } else if (nums.length === 2) {
    seconds = nums[0] * 60 + nums[1];
  } else {
    seconds = nums[0] * 3600 + nums[1] * 60 + nums[2];
  }

  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/* ------------------------------------------------------------ */
/* Speaker normalization                                         */
/* ------------------------------------------------------------ */

/** "SPEAKER_00", "SPEAKER_01", ... — underscore/hyphen form, zero-indexed (pyannote/diarization-tool convention). */
const SPEAKER_UNDERSCORE_NUMBER_PATTERN = /^speaker[_-](\d+)$/i;
/** "Speaker 1", "Speaker 2", ... — spaced form, one-indexed (the more common "human-friendly" convention). */
const SPEAKER_SPACED_NUMBER_PATTERN = /^speaker\s+(\d+)$/i;
/** "Speaker A", "Speaker B", ... — letter position, zero-indexed. */
const SPEAKER_LETTER_PATTERN = /^speaker\s+([a-z])$/i;
/** "S1", "S2", ... — short form, one-indexed. */
const SHORT_SPEAKER_NUMBER_PATTERN = /^s(\d+)$/i;

/** Extracts a zero-based speaker position from a generic diarization-style label, or null if the label doesn't match a known pattern. */
function positionalIndexFromLabel(label: string): number | null {
  let match = SPEAKER_UNDERSCORE_NUMBER_PATTERN.exec(label);
  if (match) return Number(match[1]);

  match = SPEAKER_SPACED_NUMBER_PATTERN.exec(label);
  if (match) return Number(match[1]) - 1;

  match = SPEAKER_LETTER_PATTERN.exec(label);
  if (match) return match[1].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0);

  match = SHORT_SPEAKER_NUMBER_PATTERN.exec(label);
  if (match) return Number(match[1]) - 1;

  return null;
}

/** Display speaker + provenance for one Gemini-returned label — see mapGeminiSpeaker. */
export interface MappedGeminiSpeaker {
  speaker: string;
  provenance: SegmentProvenance;
}

/**
 * Maps one Gemini-returned speaker label against the known `speakerNames`
 * list, with full provenance: an exact (case-insensitive, trimmed) match
 * returns the canonical name (mappingSource 'provider-exact'); a generic
 * diarization-style label ("Speaker 1", "Speaker A", "S1", "SPEAKER_00",
 * ...) maps positionally into `speakerNames` (mappingSource 'positional');
 * any other label — including a position beyond the supplied names — is
 * preserved as a distinct unresolved local identity with a stable display
 * name, never a shared generic "Unknown". A blank label has no identity to
 * anchor, so it alone stays "Unknown" with the shared 'blank' identity.
 *
 * `weirdLabelSequence` mirrors mapSpeakerLabels.ts's numbering for labels
 * that don't keep their own letter — pass the per-window count of such
 * labels seen so far.
 */
export function mapGeminiSpeaker(
  name: string,
  speakerNames: string[],
  weirdLabelSequence = 1,
): MappedGeminiSpeaker {
  const trimmed = (name ?? '').toString().trim();

  const exact = trimmed.length > 0 ? speakerNames.find((n) => n.trim().toLowerCase() === trimmed.toLowerCase()) : undefined;
  if (exact) {
    return {
      speaker: exact,
      provenance: {
        providerLabel: trimmed,
        localSpeakerId: knownNameIdentity(exact),
        resolvedSpeaker: exact,
        speakerConfidence: EXACT_NAME_CONFIDENCE,
        mappingSource: 'provider-exact',
      },
    };
  }

  const index = trimmed.length > 0 ? positionalIndexFromLabel(trimmed) : null;
  if (index !== null && index >= 0 && index < speakerNames.length) {
    const positional = speakerNames[index];
    return {
      speaker: positional,
      provenance: {
        providerLabel: trimmed,
        localSpeakerId: anonymousLabelIdentity(trimmed),
        resolvedSpeaker: positional,
        speakerConfidence: POSITIONAL_CONFIDENCE,
        mappingSource: 'positional',
      },
    };
  }

  if (trimmed.length === 0) {
    return {
      speaker: 'Unknown',
      provenance: {
        providerLabel: '',
        localSpeakerId: anonymousLabelIdentity(''),
        speakerConfidence: 0,
        mappingSource: 'unresolved',
      },
    };
  }

  return {
    speaker: unresolvedDisplayName(trimmed, weirdLabelSequence),
    provenance: {
      providerLabel: trimmed,
      localSpeakerId: anonymousLabelIdentity(trimmed),
      speakerConfidence: 0,
      mappingSource: 'unresolved',
    },
  };
}

/**
 * Display-name-only wrapper around mapGeminiSpeaker, kept for callers that
 * only need the label resolution (an out-of-scope/unknown label reports
 * "Unknown" here — the full mapper preserves it as a local identity instead).
 */
export function normalizeGeminiSpeaker(name: string, speakerNames: string[]): string {
  const mapped = mapGeminiSpeaker(name, speakerNames);
  return mapped.provenance.mappingSource === 'unresolved' ? 'Unknown' : mapped.speaker;
}

/* ------------------------------------------------------------ */
/* Response parsing                                               */
/* ------------------------------------------------------------ */

/** Strips markdown code fences a model sometimes wraps JSON output in — same approach as parseCorrectionResponse.ts. */
function stripFences(raw: string): string {
  return raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
}

/** Accepts `{segments: [...]}` (the documented responseSchema shape) or a bare array (defensive — some models occasionally drop the wrapper object). */
function extractRawItems(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).segments)) {
    return (parsed as Record<string, unknown>).segments as unknown[];
  }
  return [];
}

/**
 * Lightweight shape check the window route uses to distinguish "Gemini's
 * response doesn't even parse as the documented schema" (a genuine failure —
 * surfaced as a 502 with stage 'transcribe') from "valid JSON with zero
 * segments" (a legitimate empty window, e.g. a stretch of pure silence).
 * `parseGeminiTranscription` alone can't distinguish these cases, since it
 * intentionally never throws and returns [] for both.
 */
export function isParseableGeminiTranscriptionResponse(rawModelText: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(rawModelText));
  } catch {
    return false;
  }
  return Array.isArray(parsed) || (!!parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).segments));
}

interface ParsedTimedItem {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

function parseRawItems(rawItems: unknown[]): ParsedTimedItem[] {
  const items: ParsedTimedItem[] = [];
  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;

    const start = parseTimestamp(record.start);
    const end = parseTimestamp(record.end);
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    if (start === null || end === null || text.length === 0) continue;

    const speaker = typeof record.speaker === 'string' ? record.speaker : '';
    items.push({ start, end, speaker, text });
  }
  return items;
}

/**
 * Some windows return timestamps relative to the window's own start instead
 * of absolute from the recording's start, despite the prompt's instruction —
 * this heuristic detects that shape (only possible when the window doesn't
 * start at 0) and offsets every timestamp back to absolute. Deliberately
 * conservative: both the max end time (must fit within the window's span,
 * plus slack) and the min start time (must be small — an absolute response
 * deep into a late window wouldn't start near zero) have to indicate
 * relative timestamps before this ever applies.
 */
function looksWindowRelative(items: ParsedTimedItem[], windowStart: number, windowEnd: number): boolean {
  if (windowStart <= 0 || items.length === 0) return false;
  const maxEnd = Math.max(...items.map((it) => it.end));
  const minStart = Math.min(...items.map((it) => it.start));
  const windowSpan = windowEnd - windowStart;
  return maxEnd <= windowSpan + OFFSET_HEURISTIC_SLACK_SECONDS && minStart < OFFSET_HEURISTIC_MIN_START_CEILING_SECONDS;
}

/**
 * Parses one Gemini direct-transcription window's raw model text into
 * normalized, absolute-seconds TranscriptSegment[]. Never throws — any
 * malformed/unparseable input (bad JSON, wrong shape, garbage) returns an
 * empty array so the caller (the window route) can decide how to report
 * that as a failure.
 */
export function parseGeminiTranscription(
  rawModelText: string,
  options: ParseGeminiTranscriptionOptions,
): TranscriptSegment[] {
  const { windowStart, windowEnd, speakerNames } = options;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(rawModelText));
  } catch {
    return [];
  }

  const items = parseRawItems(extractRawItems(parsed));
  if (items.length === 0) return [];

  const offsetItems = looksWindowRelative(items, windowStart, windowEnd)
    ? items.map((it) => ({ ...it, start: it.start + windowStart, end: it.end + windowStart }))
    : items;

  const clampMin = windowStart - CLAMP_BEFORE_SECONDS;
  const clampMax = windowEnd + CLAMP_AFTER_SECONDS;
  const clamped = offsetItems
    .filter((it) => it.end >= clampMin && it.start <= clampMax)
    .map((it) => ({ ...it, end: Math.max(it.start, it.end) }))
    .sort((a, b) => a.start - b.start);

  // Stable per-window numbering for labels that need a sequential display
  // name — mirrors mapDiarizedSegments' weird-label counter.
  const weirdLabelSequenceByLabel = new Map<string, number>();
  const segments: TranscriptSegment[] = clamped.map((it) => {
    const labelKey = it.speaker.trim();
    let sequence = weirdLabelSequenceByLabel.get(labelKey);
    if (sequence === undefined) {
      sequence = weirdLabelSequenceByLabel.size + 1;
      weirdLabelSequenceByLabel.set(labelKey, sequence);
    }
    const mapped = mapGeminiSpeaker(it.speaker, speakerNames, sequence);
    return {
      start: it.start,
      end: it.end,
      speaker: mapped.speaker,
      text: it.text,
      ...mapped.provenance,
    };
  });

  return normalizeSegments(segments);
}
