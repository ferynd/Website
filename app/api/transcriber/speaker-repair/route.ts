export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { callGeminiWithUsage } from '@/app/lib/aiConfig';
import { resolveGeminiModelId } from '@/app/lib/aiModels';
import { AuthError, requireAdminUser } from '@/app/lib/verifyFirebaseAuth';
import {
  CORRECTION_TEMPERATURE,
  SPEAKER_REPAIR_GEMINI_MODEL,
} from '@/app/tools/transcriber/lib/constants';
import {
  buildSpeakerRepairPrompt,
  buildSpeakerRepairResponseSchema,
  parseSpeakerRepairPatches,
} from '@/app/tools/transcriber/lib/speakerRepair';
import { accumulateStageUsage } from '@/app/tools/transcriber/lib/stageUsage';
import type {
  SpeakerRepairApiRequestBody,
  SpeakerRepairPatch,
  SpeakerRepairRequestSegment,
  StageUsage,
} from '@/app/tools/transcriber/lib/types';

/** One automatic re-ask on upstream failure / invalid JSON — same policy as the correct route. */
const REPAIR_MODEL_ATTEMPTS = 2;

/** Hard cap on segments per request — a repair batch (targets + context) should never come close. */
const MAX_SEGMENTS_PER_REQUEST = 1000;
/** Hard cap on known names — this tool is for two-person conversations plus margin. */
const MAX_KNOWN_NAMES = 8;

function parseRequestSegments(value: unknown): SpeakerRepairRequestSegment[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SEGMENTS_PER_REQUEST) return null;
  const segments: SpeakerRepairRequestSegment[] = [];
  const seenIds = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      record.id.length === 0 ||
      typeof record.text !== 'string' ||
      typeof record.speaker !== 'string' ||
      typeof record.start !== 'number' ||
      typeof record.end !== 'number' ||
      typeof record.target !== 'boolean' ||
      seenIds.has(record.id)
    ) {
      return null;
    }
    seenIds.add(record.id);
    segments.push({
      id: record.id,
      start: record.start,
      end: record.end,
      speaker: record.speaker,
      text: record.text,
      target: record.target,
      ...(typeof record.candidateSpeaker === 'string' ? { candidateSpeaker: record.candidateSpeaker } : {}),
      ...(typeof record.candidateConfidence === 'number' && Number.isFinite(record.candidateConfidence)
        ? { candidateConfidence: record.candidateConfidence }
        : {}),
    });
  }
  return segments;
}

export async function POST(req: NextRequest) {
  // SECURITY: this is the only gate on this route. Every request must carry
  // a valid Firebase ID token whose email matches the site owner exactly.
  try {
    await requireAdminUser(req);
  } catch (err) {
    const message = err instanceof AuthError ? err.message : 'Authentication failed.';
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });
  }

  let body: SpeakerRepairApiRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const segments = parseRequestSegments(body.segments);
  if (!segments) {
    return NextResponse.json(
      { error: 'segments is required: a non-empty array of {id, start, end, speaker, text, target}.' },
      { status: 400 },
    );
  }

  const knownNames = Array.isArray(body.knownNames)
    ? body.knownNames.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, MAX_KNOWN_NAMES)
    : [];
  if (knownNames.length === 0) {
    return NextResponse.json({ error: 'knownNames is required.' }, { status: 400 });
  }

  const targetIds = segments.filter((s) => s.target).map((s) => s.id);
  if (targetIds.length === 0) {
    return NextResponse.json({ error: 'At least one segment must be marked target: true.' }, { status: 400 });
  }

  const speakerNotes = Array.isArray(body.speakerNotes)
    ? body.speakerNotes.map((s) => (typeof s === 'string' ? s : ''))
    : undefined;

  const prompt = buildSpeakerRepairPrompt({
    segments,
    knownNames,
    speakerNotes,
    contextNotes: typeof body.contextNotes === 'string' ? body.contextNotes : '',
  });

  const modelId = resolveGeminiModelId(body.model, SPEAKER_REPAIR_GEMINI_MODEL);
  const responseSchema = buildSpeakerRepairResponseSchema(knownNames);

  let patches: SpeakerRepairPatch[] | null = null;
  let invalidCount = 0;
  let usage: StageUsage | undefined;
  let requests = 0;
  let lastError = 'Speaker repair failed.';
  for (let attempt = 0; attempt < REPAIR_MODEL_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      // NOTE: never log `prompt` or `raw` — the prompt contains transcript contents.
      requests += 1;
      const result = await callGeminiWithUsage(prompt, key, {
        modelId,
        temperature: CORRECTION_TEMPERATURE,
        responseSchema,
      });
      raw = result.text;
      // Accumulate tokens from every successful provider response — even one
      // whose output later fails local validation below and triggers a
      // retry — never just the final winning attempt's tokens.
      if (result.usage) usage = accumulateStageUsage(usage, result.usage, requests);
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Speaker repair failed.';
      continue;
    }

    let parsed;
    try {
      // Server-side validation: unknown ids, context (non-target) ids, and
      // unapproved speaker names never reach the client.
      parsed = parseSpeakerRepairPatches(raw, targetIds, knownNames);
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Speaker-repair model returned an unexpected response.';
      continue;
    }

    if (parsed.invalidCount > 0) {
      // The model attempted output but some of it didn't validate — distinct
      // from a genuinely empty response. Keep the valid subset as a
      // fallback and retry once for a cleaner sample; if this was the last
      // attempt, the valid subset ships with a warning rather than silently
      // looking like a clean no-op.
      patches = parsed.patches;
      invalidCount = parsed.invalidCount;
      lastError = `Speaker-repair model returned ${parsed.invalidCount} invalid patch item(s).`;
      continue;
    }

    patches = parsed.patches;
    invalidCount = 0;
    break;
  }

  if (patches === null) {
    return NextResponse.json({ error: lastError }, { status: 502 });
  }

  return NextResponse.json({
    patches,
    ...(invalidCount > 0
      ? {
          warning: `Speaker-repair model returned ${invalidCount} invalid patch item(s) after ${requests} attempt(s); applying the valid subset.`,
        }
      : {}),
    ...(usage ? { usage } : {}),
  });
}
