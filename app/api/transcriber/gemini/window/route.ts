export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { isGeminiTranscribeModel, resolveGeminiModelId } from '@/app/lib/aiModels';
import { AuthError, requireAdminUser } from '@/app/lib/verifyFirebaseAuth';
import {
  DEFAULT_GEMINI_TRANSCRIBE_MODEL,
  MAX_GEMINI_REFERENCE_CLIPS,
  MAX_GEMINI_REFERENCE_TOTAL_BYTES,
} from '@/app/tools/transcriber/lib/constants';
import {
  buildGeminiTranscriptionRequest,
  type GeminiVoiceReference,
} from '@/app/tools/transcriber/lib/gemini/buildGeminiTranscriptionRequest';
import {
  isParseableGeminiTranscriptionResponse,
  parseGeminiTranscription,
} from '@/app/tools/transcriber/lib/gemini/parseGeminiTranscription';
import { sanitizeUpstreamError } from '@/app/tools/transcriber/lib/sanitizeUpstreamError';
import type { TranscribeErrorInfo } from '@/app/tools/transcriber/lib/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRecord = Record<string, any>;

/** Clamps an arbitrary request value into a sane non-negative window bound — never trust client-supplied numbers directly. */
function clampWindowBound(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function windowErrorResponse(params: {
  error: string;
  model: string;
  stage: TranscribeErrorInfo['stage'];
  upstreamStatus: number | null;
  /** Sanitized upstream response text, when there was an actual upstream response to sanitize. Falls back to `error` when omitted/empty — the client (geminiProvider.ts) prefers errorInfo.upstreamBody over the plain `error` string, so this must never be silently blanked out for a failure that has no real upstream body (e.g. an unparseable-but-200 response). */
  upstreamBody?: string;
  httpStatus: number;
}) {
  const { error, model, stage, upstreamStatus, upstreamBody, httpStatus } = params;
  return NextResponse.json(
    {
      error,
      errorInfo: {
        provider: 'gemini',
        model,
        stage,
        upstreamStatus,
        upstreamBody: upstreamBody || error,
      } satisfies TranscribeErrorInfo,
    },
    { status: httpStatus },
  );
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

  let body: JsonRecord;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const fileUri = typeof body.fileUri === 'string' ? body.fileUri : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
  if (!fileUri || !mimeType) {
    return NextResponse.json({ error: 'fileUri and mimeType are required.' }, { status: 400 });
  }

  const windowStart = clampWindowBound(body.windowStart);
  const windowEnd = Math.max(windowStart, clampWindowBound(body.windowEnd));
  const speakerNames = Array.isArray(body.speakerNames)
    ? body.speakerNames.filter((s: unknown): s is string => typeof s === 'string')
    : [];
  const speakerNotes = Array.isArray(body.speakerNotes)
    ? body.speakerNotes.map((s: unknown) => (typeof s === 'string' ? s : ''))
    : undefined;
  const contextNotes = typeof body.contextNotes === 'string' ? body.contextNotes : '';
  const isFullFile = body.isFullFile === true;

  // Experimental voice-reference clips (settings.geminiReferenceClips,
  // default OFF) — re-validated server-side regardless of what the client
  // already checked. Malformed individual entries are dropped rather than
  // rejecting the whole request; the count/size caps below DO reject the
  // request, since silently truncating could attach the wrong subset of
  // speakers to a run. NEVER log `references` — it's audio content.
  const referencesRaw = Array.isArray(body.references) ? body.references : [];
  const references: GeminiVoiceReference[] = [];
  let totalBase64Length = 0;
  for (const entry of referencesRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const refMimeType = typeof entry.mimeType === 'string' ? entry.mimeType : '';
    const dataBase64 = typeof entry.dataBase64 === 'string' ? entry.dataBase64 : '';
    if (!name || !refMimeType || !dataBase64) continue;
    references.push({ name, mimeType: refMimeType, dataBase64 });
    totalBase64Length += dataBase64.length;
  }

  if (references.length > MAX_GEMINI_REFERENCE_CLIPS) {
    return NextResponse.json(
      { error: `At most ${MAX_GEMINI_REFERENCE_CLIPS} voice reference clips are supported per run.` },
      { status: 400 },
    );
  }
  // Base64 is ~4/3 the size of the raw bytes it encodes — estimate the real byte total from the encoded string length.
  const estimatedReferenceBytes = Math.ceil((totalBase64Length * 3) / 4);
  if (estimatedReferenceBytes > MAX_GEMINI_REFERENCE_TOTAL_BYTES) {
    return NextResponse.json(
      {
        error: `Voice reference clips exceed the ${(MAX_GEMINI_REFERENCE_TOTAL_BYTES / 1024 / 1024).toFixed(0)} MB combined limit.`,
      },
      { status: 400 },
    );
  }

  // Model choice comes from the client's settings store; restricted to the
  // Flash-family transcription subset (GEMINI_TRANSCRIBE_MODELS) regardless
  // of what a caller sends — a valid-but-non-transcription Gemini model
  // (e.g. a Pro reasoning model) is never accepted here.
  const requestedModel = resolveGeminiModelId(body.model, DEFAULT_GEMINI_TRANSCRIBE_MODEL);
  const modelId = isGeminiTranscribeModel(requestedModel) ? requestedModel : DEFAULT_GEMINI_TRANSCRIBE_MODEL;

  const requestBody = buildGeminiTranscriptionRequest({
    fileUri,
    mimeType,
    windowStart,
    windowEnd,
    speakerNames,
    speakerNotes,
    contextNotes,
    isFullFile,
    references: references.length > 0 ? references : undefined,
  });

  let res: Response;
  try {
    // NEVER log `requestBody` or the response — both are/contain transcript content.
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    return windowErrorResponse({
      error: 'Network error calling Gemini for transcription.',
      model: modelId,
      stage: 'transcribe',
      upstreamStatus: null,
      upstreamBody: sanitizeUpstreamError(err instanceof Error ? err.message : ''),
      httpStatus: 502,
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return windowErrorResponse({
      error: `Gemini transcription failed (${res.status}).`,
      model: modelId,
      stage: 'transcribe',
      upstreamStatus: res.status,
      upstreamBody: sanitizeUpstreamError(errText),
      httpStatus: 502,
    });
  }

  let data: JsonRecord;
  try {
    data = await res.json();
  } catch {
    return windowErrorResponse({
      error: 'Gemini returned an unparseable transcription response.',
      model: modelId,
      stage: 'transcribe',
      upstreamStatus: res.status,
      httpStatus: 502,
    });
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || !isParseableGeminiTranscriptionResponse(text)) {
    return windowErrorResponse({
      error: 'Gemini returned an unparseable transcription response.',
      model: modelId,
      stage: 'transcribe',
      upstreamStatus: res.status,
      httpStatus: 502,
    });
  }

  const segments = parseGeminiTranscription(text, { windowStart, windowEnd, speakerNames });
  return NextResponse.json({ segments });
}
