export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { callGemini } from '@/app/lib/aiConfig';
import { AuthError, requireAdminUser } from '@/app/lib/verifyFirebaseAuth';
import { buildCorrectionPrompt } from '@/app/tools/transcriber/lib/buildCorrectionPrompt';
import { CORRECTION_GEMINI_MODEL, CORRECTION_TEMPERATURE } from '@/app/tools/transcriber/lib/constants';
import { normalizeSegments } from '@/app/tools/transcriber/lib/formatTranscript';
import { parseCorrectionResponse } from '@/app/tools/transcriber/lib/parseCorrectionResponse';
import type { CorrectApiRequestBody, TranscriptSegment } from '@/app/tools/transcriber/lib/types';

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

  const prompt = buildCorrectionPrompt({
    segments: indexed,
    speakerNames: Array.isArray(body.speakerNames) ? body.speakerNames.filter((s) => typeof s === 'string') : [],
    contextNotes: typeof body.contextNotes === 'string' ? body.contextNotes : '',
    mode: body.mode === 'fallback' ? 'fallback' : 'diarized',
  });

  let raw: string;
  try {
    // NOTE: never log `prompt` or `raw` — both contain transcript contents.
    raw = await callGemini(prompt, key, {
      modelId: CORRECTION_GEMINI_MODEL,
      temperature: CORRECTION_TEMPERATURE,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Correction pass failed.';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  let corrections;
  try {
    corrections = parseCorrectionResponse(
      raw,
      indexed.map((s) => s.index),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Correction model returned an unexpected response.';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const byIndex = new Map(corrections.map((c) => [c.index, c]));
  const segments: TranscriptSegment[] = indexed.map((seg) => {
    const fix = byIndex.get(seg.index);
    return {
      start: seg.start,
      end: seg.end,
      speaker: fix?.speaker?.trim() || seg.speaker,
      text: fix?.text?.trim() || seg.text,
    };
  });

  return NextResponse.json({ segments });
}
