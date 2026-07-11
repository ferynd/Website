export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { callGeminiWithUsage } from '@/app/lib/aiConfig';
import { resolveGeminiModelId } from '@/app/lib/aiModels';
import { AuthError, requireAdminUser } from '@/app/lib/verifyFirebaseAuth';
import {
  buildCorrectionPrompt,
  buildCorrectionResponseSchema,
} from '@/app/tools/transcriber/lib/buildCorrectionPrompt';
import { CORRECTION_GEMINI_MODEL, CORRECTION_TEMPERATURE } from '@/app/tools/transcriber/lib/constants';
import { shouldRevertCorrection } from '@/app/tools/transcriber/lib/correctionGuards';
import { parseCorrectionPatches } from '@/app/tools/transcriber/lib/parseCorrectionResponse';
import { CLEANUP_TEMPERATURE_MAX, CLEANUP_TEMPERATURE_MIN } from '@/app/tools/transcriber/lib/settings';
import type {
  CorrectApiRequestBody,
  CorrectionPatch,
  CorrectionRequestSegment,
  StageUsage,
} from '@/app/tools/transcriber/lib/types';

/** How many times the Gemini call is attempted per request — 2 means one
 * automatic re-ask when the first response fails or is invalid JSON. A
 * second sample at low temperature usually completes cleanly. (A sparse
 * response can't be "incomplete" — an omitted segment means "unchanged" by
 * definition, and an empty patches array is a valid answer.) */
const CORRECTION_MODEL_ATTEMPTS = 2;

/** Hard cap on segments per request — a correction window should never come
 * close; anything past this is a malformed/abusive request, not a real window. */
const MAX_SEGMENTS_PER_REQUEST = 2000;

function parseRequestSegments(value: unknown): CorrectionRequestSegment[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SEGMENTS_PER_REQUEST) return null;
  const segments: CorrectionRequestSegment[] = [];
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

  let body: CorrectApiRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const segments = parseRequestSegments(body.segments);
  if (!segments) {
    return NextResponse.json({ error: 'segments is required: a non-empty array of {id, start, end, speaker, text}.' }, { status: 400 });
  }

  const temperature =
    typeof body.temperature === 'number' && Number.isFinite(body.temperature)
      ? Math.min(CLEANUP_TEMPERATURE_MAX, Math.max(CLEANUP_TEMPERATURE_MIN, body.temperature))
      : CORRECTION_TEMPERATURE;

  const prompt = buildCorrectionPrompt({
    segments,
    speakerNames: Array.isArray(body.speakerNames) ? body.speakerNames.filter((s) => typeof s === 'string') : [],
    contextNotes: typeof body.contextNotes === 'string' ? body.contextNotes : '',
    mode: body.mode === 'fallback' ? 'fallback' : 'diarized',
  });

  // Model choice comes from the Settings pop-up (saved client-side); falls back to the
  // site default if missing/unrecognized.
  const modelId = resolveGeminiModelId(body.model, CORRECTION_GEMINI_MODEL);

  // Structured output: constrain the response to the sparse patch shape so
  // fences/prose/malformed items can't come back at all.
  const responseSchema = buildCorrectionResponseSchema();
  const allowedIds = segments.map((s) => s.id);

  let patches: CorrectionPatch[] | null = null;
  let usage: StageUsage | undefined;
  let requests = 0;
  let lastError = 'Correction pass failed.';
  for (let attempt = 0; attempt < CORRECTION_MODEL_ATTEMPTS && patches === null; attempt++) {
    let raw: string;
    try {
      // NOTE: never log `prompt` or `raw` — both contain transcript contents.
      requests += 1;
      const result = await callGeminiWithUsage(prompt, key, {
        modelId,
        temperature,
        responseSchema,
      });
      raw = result.text;
      if (result.usage) {
        usage = {
          model: result.usage.model,
          requests,
          ...(result.usage.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
          ...(result.usage.outputTokens !== undefined ? { outputTokens: result.usage.outputTokens } : {}),
          ...(result.usage.cachedTokens !== undefined ? { cachedTokens: result.usage.cachedTokens } : {}),
        };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Correction pass failed.';
      continue;
    }

    try {
      patches = parseCorrectionPatches(raw, allowedIds);
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Correction model returned an unexpected response.';
      continue;
    }
  }

  if (patches === null) {
    return NextResponse.json({ error: lastError }, { status: 502 });
  }

  // Divergence guardrail (lib/correctionGuards.ts): a corrected text whose
  // length drifts far outside the original's can't be a preservation-first
  // fix — drop that patch (the original text stands) and report how many
  // were rejected so the client can log it. No-op patches (text identical to
  // the original) are dropped silently to keep the response truly sparse.
  const originalById = new Map(segments.map((s) => [s.id, s]));
  let revertedPatches = 0;
  const applied: CorrectionPatch[] = [];
  for (const patch of patches) {
    const original = originalById.get(patch.segmentId)!;
    const correctedText = patch.text.trim();
    if (correctedText === original.text.trim()) continue;
    if (shouldRevertCorrection(original.text, correctedText)) {
      revertedPatches += 1;
      continue;
    }
    applied.push({ segmentId: patch.segmentId, text: correctedText });
  }

  return NextResponse.json({ patches: applied, revertedPatches, ...(usage ? { usage } : {}) });
}
