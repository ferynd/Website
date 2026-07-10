export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { callGemini } from '@/app/lib/aiConfig';
import { resolveGeminiModelId } from '@/app/lib/aiModels';
import { AuthError, requireAdminUser } from '@/app/lib/verifyFirebaseAuth';
import {
  buildCorrectionPrompt,
  buildCorrectionResponseSchema,
} from '@/app/tools/transcriber/lib/buildCorrectionPrompt';
import { CORRECTION_GEMINI_MODEL, CORRECTION_TEMPERATURE } from '@/app/tools/transcriber/lib/constants';
import { shouldRevertCorrection } from '@/app/tools/transcriber/lib/correctionGuards';
import { normalizeSegments } from '@/app/tools/transcriber/lib/formatTranscript';
import {
  findMissingIndices,
  parseCorrectionResponse,
  type CorrectionResultItem,
} from '@/app/tools/transcriber/lib/parseCorrectionResponse';
import { CLEANUP_TEMPERATURE_MAX, CLEANUP_TEMPERATURE_MIN } from '@/app/tools/transcriber/lib/settings';
import type { CorrectApiRequestBody, TaggedTranscriptSegment } from '@/app/tools/transcriber/lib/types';

/** How many times the Gemini call is attempted per request — 2 means one
 * automatic re-ask when the first response fails, is invalid JSON, or drops
 * segments. A second sample at low temperature usually completes cleanly,
 * which turns most would-be "chunk failed, left uncorrected" outcomes into
 * successes without any client round trip. */
const CORRECTION_MODEL_ATTEMPTS = 2;

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

  if (!Array.isArray(body.segments) || body.segments.length === 0) {
    return NextResponse.json({ error: 'segments is required.' }, { status: 400 });
  }

  const normalized = normalizeSegments(body.segments);
  const indexed = normalized.map((seg, index) => ({ ...seg, index }));

  // Phase 5: argument tagging folds into this same pass — no separate AI
  // call. Both fields are optional/client-driven, so clamp/validate
  // server-side rather than trusting the request body outright.
  const argumentTagging = body.argumentTagging === true;
  const temperature =
    typeof body.temperature === 'number' && Number.isFinite(body.temperature)
      ? Math.min(CLEANUP_TEMPERATURE_MAX, Math.max(CLEANUP_TEMPERATURE_MIN, body.temperature))
      : CORRECTION_TEMPERATURE;

  const prompt = buildCorrectionPrompt({
    segments: indexed,
    speakerNames: Array.isArray(body.speakerNames) ? body.speakerNames.filter((s) => typeof s === 'string') : [],
    contextNotes: typeof body.contextNotes === 'string' ? body.contextNotes : '',
    mode: body.mode === 'fallback' ? 'fallback' : 'diarized',
    argumentTagging,
  });

  // Model choice comes from the Settings pop-up (saved client-side); falls back to the
  // site default if missing/unrecognized.
  const modelId = resolveGeminiModelId(body.model, CORRECTION_GEMINI_MODEL);

  // Structured output: constrain the response to the prompt's exact shape
  // (index/speaker/text, plus a required tag enum when argument tagging is
  // on) so fences/prose/malformed items can't come back at all.
  const responseSchema = buildCorrectionResponseSchema(argumentTagging);
  const expectedIndices = indexed.map((s) => s.index);

  // One model call, retried once (CORRECTION_MODEL_ATTEMPTS) on upstream
  // failure, invalid JSON, or an incomplete response. A syntactically valid
  // but incomplete response (model dropped a line, or parseCorrectionResponse
  // rejected a malformed item) must NOT be silently patched with uncorrected
  // text for just the missing lines — that would hide a real failure from
  // both the warning banner and strict mode. If the re-ask also fails, the
  // whole chunk is rejected so the client's failure handling (fallback to
  // original segments, count towards the warning, strict-mode abort) applies
  // consistently.
  let corrections: CorrectionResultItem[] | null = null;
  let lastError = 'Correction pass failed.';
  for (let attempt = 0; attempt < CORRECTION_MODEL_ATTEMPTS && corrections === null; attempt++) {
    let raw: string;
    try {
      // NOTE: never log `prompt` or `raw` — both contain transcript contents.
      raw = await callGemini(prompt, key, {
        modelId,
        temperature,
        responseSchema,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Correction pass failed.';
      continue;
    }

    let parsed: CorrectionResultItem[];
    try {
      parsed = parseCorrectionResponse(raw, expectedIndices, argumentTagging);
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Correction model returned an unexpected response.';
      continue;
    }

    const missingIndices = findMissingIndices(expectedIndices, parsed);
    if (missingIndices.length > 0) {
      lastError = `Correction response was incomplete: missing ${missingIndices.length} of ${indexed.length} segments.`;
      continue;
    }

    corrections = parsed;
  }

  if (corrections === null) {
    return NextResponse.json({ error: lastError }, { status: 502 });
  }

  // Divergence guardrail (lib/correctionGuards.ts): a corrected text whose
  // length drifts far outside the original's can't be a preservation-first
  // fix — keep the original text for that segment (speaker fixes still
  // apply) and report how many reverted so the client can log it.
  const byIndex = new Map(corrections.map((c) => [c.index, c]));
  let revertedSegments = 0;
  const segments: TaggedTranscriptSegment[] = indexed.map((seg) => {
    const fix = byIndex.get(seg.index)!;
    const correctedText = fix.text.trim();
    const revert = shouldRevertCorrection(seg.text, correctedText);
    if (revert) revertedSegments += 1;
    const result: TaggedTranscriptSegment = {
      start: seg.start,
      end: seg.end,
      speaker: fix.speaker.trim() || seg.speaker,
      text: revert ? seg.text : correctedText,
    };
    if (argumentTagging && fix.tag) result.tag = fix.tag;
    return result;
  });

  return NextResponse.json({ segments, revertedSegments });
}
