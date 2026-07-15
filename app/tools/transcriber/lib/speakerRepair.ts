// Targeted speaker repair: pure builders/validators for the sparse
// speaker-repair stage. Only unresolved/low-confidence segments are sent
// (plus a few resolved neighbors as context); the model returns ONLY
// {"patches": [{segmentId, speaker, confidence}]} — no transcript text ever
// comes back. Application is confidence-gated, id/name-validated, and never
// touches a user-confirmed assignment; a previous assignment is preserved in
// `repairedFrom` provenance.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import {
  SPEAKER_REPAIR_CONTEXT_SEGMENTS,
  SPEAKER_REPAIR_MAX_TARGETS_PER_REQUEST,
} from './constants';
import { isResolvedSegment } from './segmentProvenance';
import { formatTimestamp } from './formatTranscript';
import type { SpeakerRepairPatch, SpeakerRepairRequestSegment, TranscriptSegment } from './types';

/** True for a segment the repair stage may reassign: unresolved (no
 * resolved global speaker) and not user-confirmed. */
export function isRepairTarget(seg: TranscriptSegment): boolean {
  return !isResolvedSegment(seg) && seg.text.trim().length > 0;
}

export interface RepairBatch {
  /** Window of segments to send, in order — targets plus nearby resolved context. */
  segments: SpeakerRepairRequestSegment[];
  /** Stable ids of the target segments in this batch. */
  targetIds: string[];
}

export interface BuildRepairBatchesOptions {
  maxTargetsPerBatch?: number;
  contextSegments?: number;
}

/**
 * Splits a sorted list of target indices into maximal CONTIGUOUS runs —
 * indices that are directly adjacent in the full segment list (no resolved
 * segment in between). This is what keeps distant unresolved passages from
 * ever sharing a batch merely because both fit under the target-count cap.
 */
function findContiguousRuns(targetIndices: number[]): number[][] {
  const runs: number[][] = [];
  let current: number[] = [];
  for (const idx of targetIndices) {
    if (current.length > 0 && idx === current[current.length - 1] + 1) {
      current.push(idx);
    } else {
      if (current.length > 0) runs.push(current);
      current = [idx];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * Groups the transcript's repair targets into request batches: only
 * CONTIGUOUS runs of target segments (physically adjacent in the
 * transcript, no resolved segment between them) are ever batched together —
 * two unresolved passages minutes apart always land in separate requests,
 * regardless of the per-batch target cap. A run larger than the cap is
 * split into consecutive sub-batches of at most `maxTargetsPerBatch`. Each
 * (sub-)batch carries up to `contextSegments` RESOLVED neighbors on each
 * side — an unresolved neighbor (whether this run's own overflow into an
 * adjacent sub-batch, or a different run entirely) is never included as
 * context, since the prompt tells the model every non-target segment is
 * reliable. Only targets and their limited context are ever sent — never
 * the whole transcript. Segments without a stable id can't be patched and
 * are skipped.
 */
export function buildRepairBatches(
  segments: TranscriptSegment[],
  options: BuildRepairBatchesOptions = {},
): RepairBatch[] {
  const maxTargets = options.maxTargetsPerBatch ?? SPEAKER_REPAIR_MAX_TARGETS_PER_REQUEST;
  const contextRadius = options.contextSegments ?? SPEAKER_REPAIR_CONTEXT_SEGMENTS;

  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end);
  const targetIndices = sorted
    .map((seg, i) => ({ seg, i }))
    .filter(({ seg }) => isRepairTarget(seg) && typeof seg.id === 'string')
    .map(({ i }) => i);
  if (targetIndices.length === 0) return [];

  // Split each contiguous run into batches of at most maxTargets — runs
  // never combine with each other regardless of size.
  const batchesOfIndices: number[][] = [];
  for (const run of findContiguousRuns(targetIndices)) {
    for (let i = 0; i < run.length; i += maxTargets) {
      batchesOfIndices.push(run.slice(i, i + maxTargets));
    }
  }

  // Every target anywhere in the transcript (not just this batch) — used
  // below so a neighbor that is itself unresolved (whether this batch's own
  // spillover, another sub-batch's split of the SAME oversized run, or an
  // entirely different run) is never pulled in as context. The prompt tells
  // the model every non-"target" segment is reliable context — an unresolved
  // neighbor would violate that.
  const allTargetIndices = new Set(targetIndices);

  return batchesOfIndices.map((indices) => {
    const include = new Set<number>();
    const targetSet = new Set(indices);
    for (const idx of indices) {
      include.add(idx);
      // Nearby RESOLVED context on each side of every target — an
      // unresolved neighbor (this batch's own overflow into the next
      // sub-batch, or any other target) is skipped rather than included.
      for (let d = 1; d <= contextRadius; d++) {
        const before = idx - d;
        if (before >= 0 && !allTargetIndices.has(before)) include.add(before);
        const after = idx + d;
        if (after < sorted.length && !allTargetIndices.has(after)) include.add(after);
      }
    }

    const ordered = [...include].sort((a, b) => a - b);
    const requestSegments: SpeakerRepairRequestSegment[] = ordered
      .filter((i) => typeof sorted[i].id === 'string')
      .map((i) => {
        const seg = sorted[i];
        const isTarget = targetSet.has(i);
        return {
          id: seg.id!,
          start: seg.start,
          end: seg.end,
          speaker: seg.speaker,
          text: seg.text,
          target: isTarget,
          ...(isTarget && seg.candidateSpeaker
            ? {
                candidateSpeaker: seg.candidateSpeaker,
                ...(seg.speakerConfidence !== undefined ? { candidateConfidence: seg.speakerConfidence } : {}),
              }
            : {}),
        };
      });

    return {
      segments: requestSegments,
      targetIds: indices.map((i) => sorted[i].id!),
    };
  });
}

export interface SpeakerRepairPromptInput {
  segments: SpeakerRepairRequestSegment[];
  knownNames: string[];
  /** Parallel to knownNames — optional per-speaker voice/speaking-style notes. */
  speakerNotes?: string[];
  contextNotes: string;
}

/**
 * Builds the strict-JSON-out speaker-repair prompt. The model sees each
 * segment's stable id, current label, and text, with targets marked; it
 * returns ONLY sparse id->name patches — never text.
 */
export function buildSpeakerRepairPrompt(input: SpeakerRepairPromptInput): string {
  const { segments, knownNames, speakerNotes = [], contextNotes } = input;

  const notesLines = knownNames
    .map((name, i) => {
      const note = (speakerNotes[i] ?? '').trim();
      return note ? `- ${name}: ${note}` : null;
    })
    .filter((line): line is string => line !== null);

  const lines = segments.map((seg) => ({
    id: seg.id,
    start: formatTimestamp(seg.start),
    speaker: seg.speaker,
    text: seg.text,
    ...(seg.target ? { target: true } : {}),
    ...(seg.candidateSpeaker ? { candidate: seg.candidateSpeaker } : {}),
  }));

  const rules = [
    'You are identifying WHO IS SPEAKING in parts of a two-person conversation transcript where the speaker could not be determined automatically. Follow these rules exactly:',
    `- The only possible speakers are: ${knownNames.join(', ')}.`,
    '- Segments marked "target": true are the ones to identify. Segments without it are reliable context — never patch those.',
    '- Use turn-taking, conversational context, speaking style, and any candidate hint provided.',
    '- Assign a name ONLY when you are genuinely confident. If you cannot tell who is speaking, OMIT that segment from your response entirely — do not guess.',
    '- Report your confidence for each patch as a number between 0 and 1.',
    '- Never change or return transcript text.',
  ];
  if (notesLines.length > 0) {
    rules.push('Speaker notes:', ...notesLines);
  }
  if (contextNotes.trim()) {
    rules.push(`Additional context from the user: ${contextNotes.trim()}`);
  }

  const instructions = [
    '',
    'Respond with ONLY a strict JSON object (no prose, no markdown code fences) of exactly this shape:',
    '{"patches": [{"segmentId": string, "speaker": string, "confidence": number}]}',
    `"speaker" must be exactly one of: ${knownNames.join(', ')}. Include patches only for target segments you are confident about; an empty patches array is a valid response.`,
    '',
    `Segments (JSON): ${JSON.stringify(lines)}`,
  ];

  return [...rules, ...instructions].join('\n');
}

/** Gemini structured-output schema for the sparse speaker-repair response —
 * `speaker` is an enum of the known names so an unapproved name can't come
 * back at all (parse still re-validates defensively). */
export function buildSpeakerRepairResponseSchema(knownNames: string[]) {
  return {
    type: 'OBJECT',
    properties: {
      patches: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            segmentId: { type: 'STRING' },
            speaker: { type: 'STRING', enum: [...knownNames] },
            confidence: { type: 'NUMBER' },
          },
          required: ['segmentId', 'speaker', 'confidence'],
        },
      },
    },
    required: ['patches'],
  };
}

/** Strips markdown code fences a model sometimes wraps JSON output in. */
function stripFences(raw: string): string {
  return raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
}

export interface ParsedSpeakerRepairPatches {
  patches: SpeakerRepairPatch[];
  /** Items present in the raw response that were dropped: unknown/non-target
   * id, unapproved speaker name, missing/invalid confidence, or a duplicate
   * of an id already seen. A non-zero count means the model ATTEMPTED
   * output that wasn't fully valid — distinct from a genuinely empty/clean
   * response. */
  invalidCount: number;
}

/**
 * Parses + validates the repair model's response: ids must be in
 * `targetIds` (context/unknown ids are rejected), the speaker must
 * case-insensitively match a known name (canonicalized), confidence must be
 * a finite number (clamped to [0, 1]); duplicates keep the first
 * occurrence. Throws on invalid JSON or a shape that isn't {patches: [...]}.
 */
export function parseSpeakerRepairPatches(
  raw: string,
  targetIds: string[],
  knownNames: string[],
): ParsedSpeakerRepairPatches {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    throw new Error('Speaker-repair model returned invalid JSON.');
  }

  let items: unknown[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).patches)) {
    items = (parsed as Record<string, unknown>).patches as unknown[];
  } else {
    throw new Error('Speaker-repair model did not return a {patches: [...]} object.');
  }

  const allowed = new Set(targetIds);
  const nameByLower = new Map(knownNames.map((name) => [name.toLowerCase(), name]));
  const seen = new Set<string>();
  const patches: SpeakerRepairPatch[] = [];
  let invalidCount = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      invalidCount += 1;
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = typeof record.segmentId === 'string' ? record.segmentId : typeof record.id === 'string' ? record.id : null;
    if (id === null || !allowed.has(id) || seen.has(id)) {
      invalidCount += 1;
      continue;
    }
    const name = typeof record.speaker === 'string' ? nameByLower.get(record.speaker.trim().toLowerCase()) : undefined;
    if (!name) {
      invalidCount += 1;
      continue;
    }
    const confidenceRaw = record.confidence;
    if (typeof confidenceRaw !== 'number' || !Number.isFinite(confidenceRaw)) {
      invalidCount += 1;
      continue;
    }
    seen.add(id);
    patches.push({ segmentId: id, speaker: name, confidence: Math.min(1, Math.max(0, confidenceRaw)) });
  }

  return { patches, invalidCount };
}

export interface ApplyRepairPatchesOptions {
  knownNames: string[];
  /** Patches below this confidence are not applied. */
  minConfidence: number;
}

export interface ApplyRepairPatchesResult<T extends TranscriptSegment> {
  segments: T[];
  applied: number;
  /** Patches rejected by validation (unknown id, unapproved name, user-confirmed target, non-target). */
  rejected: number;
  /** Patches skipped for insufficient confidence (still a valid model answer). */
  belowConfidence: number;
}

/**
 * Applies sparse speaker-repair patches immutably. A patch applies only when
 * its id maps to a repair-eligible segment (unresolved, not user-confirmed),
 * its speaker is an approved known name, and its confidence clears
 * `minConfidence`. The previous display speaker is preserved in
 * `repairedFrom`, and the mapping source becomes 'repair'. A failed or empty
 * patch set never invalidates the transcript — the input segments are
 * returned unchanged in that case.
 */
export function applySpeakerRepairPatches<T extends TranscriptSegment>(
  segments: T[],
  patches: SpeakerRepairPatch[],
  options: ApplyRepairPatchesOptions,
): ApplyRepairPatchesResult<T> {
  const knownNameSet = new Set(options.knownNames);
  const byId = new Map<string, SpeakerRepairPatch>();
  let rejected = 0;
  for (const patch of patches) {
    if (byId.has(patch.segmentId)) {
      rejected += 1;
      continue;
    }
    byId.set(patch.segmentId, patch);
  }

  let applied = 0;
  let belowConfidence = 0;
  const out = segments.map((seg) => {
    if (!seg.id) return seg;
    const patch = byId.get(seg.id);
    if (!patch) return seg;
    byId.delete(seg.id);

    if (seg.userConfirmed || !isRepairTarget(seg) || !knownNameSet.has(patch.speaker)) {
      rejected += 1;
      return seg;
    }
    if (patch.confidence < options.minConfidence) {
      belowConfidence += 1;
      return seg;
    }

    applied += 1;
    const next: T = {
      ...seg,
      speaker: patch.speaker,
      resolvedSpeaker: patch.speaker,
      speakerConfidence: patch.confidence,
      mappingSource: 'repair',
      repairedFrom: seg.speaker,
    };
    delete next.mappingConflict;
    return next;
  });

  // Anything left in byId referenced an id that isn't in the transcript.
  rejected += byId.size;

  return { segments: out, applied, rejected, belowConfidence };
}
