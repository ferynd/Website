export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdminUser } from '@/app/lib/verifyFirebaseAuth';
import { modelSupportsDiarization, resolveTranscribeModelId } from '@/app/lib/transcribeModels';
import {
  FALLBACK_TRANSCRIBE_MODEL,
  MAX_OPENAI_UPLOAD_BYTES,
  PRIMARY_TRANSCRIBE_MODEL,
} from '@/app/tools/transcriber/lib/constants';
import { mapDiarizedSegments, mapFallbackSegments } from '@/app/tools/transcriber/lib/mapSpeakerLabels';
import { sanitizeUpstreamError } from '@/app/tools/transcriber/lib/sanitizeUpstreamError';
import type { TranscribeErrorInfo, TranscriptionMode } from '@/app/tools/transcriber/lib/types';
import type { TranscriptionProviderId } from '@/app/tools/transcriber/lib/providers/types';

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

export async function POST(req: NextRequest) {
  // SECURITY: this is the only gate on this route. Every request must carry
  // a valid Firebase ID token whose email matches the site owner exactly.
  try {
    await requireAdminUser(req);
  } catch (err) {
    const message = err instanceof AuthError ? err.message : 'Authentication failed.';
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const apiKey = process.env.GPT_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GPT_API_KEY not configured.' }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No audio file provided.' }, { status: 400 });
  }

  // Re-validate the 25 MB OpenAI limit server-side — never trust client-side checks alone.
  if (file.size > MAX_OPENAI_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB, which exceeds OpenAI's 25 MB upload limit. Compress or split the audio first.`,
      },
      { status: 413 },
    );
  }

  let speakerNames: string[] = [];
  const speakerNamesRaw = form.get('speakerNames');
  if (typeof speakerNamesRaw === 'string') {
    try {
      const parsed = JSON.parse(speakerNamesRaw);
      if (Array.isArray(parsed)) speakerNames = parsed.filter((s) => typeof s === 'string');
    } catch {
      speakerNames = [];
    }
  }

  // Model choice comes from the Settings pop-up (saved client-side); fall back to the
  // site default if missing/unrecognized. Only models that return segment-level
  // timestamps are ever accepted here — see app/lib/transcribeModels.ts for why.
  const transcribeModelId = resolveTranscribeModelId(form.get('model'), PRIMARY_TRANSCRIBE_MODEL);
  const diarizes = modelSupportsDiarization(transcribeModelId);
  const providerId: TranscriptionProviderId = diarizes ? 'openai-diarized' : 'openai-whisper';

  // Backward-compat default ('true'): the pre-Phase-2 behavior (silently
  // retrying whisper-1 when the selected/diarized model call fails) is
  // preserved unless the caller explicitly opts out — driven by the
  // auto-fallback setting client-side.
  const allowWhisperFallbackRaw = form.get('allowWhisperFallback');
  const allowWhisperFallback = typeof allowWhisperFallbackRaw === 'string' ? allowWhisperFallbackRaw !== 'false' : true;

  const primaryForm = new FormData();
  primaryForm.set('file', file, file.name);
  primaryForm.set('model', transcribeModelId);
  if (diarizes) {
    primaryForm.set('response_format', 'diarized_json');
    primaryForm.set('chunking_strategy', 'auto');
  } else {
    primaryForm.set('response_format', 'verbose_json');
    primaryForm.set('timestamp_granularities[]', 'segment');
  }

  let mode: TranscriptionMode = diarizes ? 'diarized' : 'fallback';
  let primaryError: string | null = null;
  let primaryErrorInfo: TranscribeErrorInfo | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = null;

  const primaryRes = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: primaryForm,
  });

  if (primaryRes.ok) {
    data = await primaryRes.json();
  } else {
    // Selected model/endpoint unavailable for this account/audio.
    const errText = await primaryRes.text().catch(() => '');
    const sanitizedBody = sanitizeUpstreamError(errText);
    primaryError = sanitizedBody || `OpenAI transcription failed (${primaryRes.status}).`;
    mode = 'fallback';
    primaryErrorInfo = {
      provider: providerId,
      model: transcribeModelId,
      stage: 'transcribe',
      upstreamStatus: primaryRes.status,
      upstreamBody: sanitizedBody,
    };
  }

  // Nothing left to retry with if the selected model already was the fallback
  // model itself, or the caller opted out of the silent whisper retry (auto-fallback
  // setting off — the client's recovery panel handles retry choices instead).
  if (!data && (transcribeModelId === FALLBACK_TRANSCRIBE_MODEL || !allowWhisperFallback)) {
    return NextResponse.json(
      { error: `Transcription failed: ${primaryError}`, errorInfo: primaryErrorInfo },
      { status: primaryRes.status },
    );
  }

  if (!data) {
    const fallbackForm = new FormData();
    fallbackForm.set('file', file, file.name);
    fallbackForm.set('model', FALLBACK_TRANSCRIBE_MODEL);
    fallbackForm.set('response_format', 'verbose_json');
    fallbackForm.set('timestamp_granularities[]', 'segment');

    const fallbackRes = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fallbackForm,
    });

    if (!fallbackRes.ok) {
      const fallbackErrText = await fallbackRes.text().catch(() => '');
      const sanitizedFallbackBody = sanitizeUpstreamError(fallbackErrText);
      return NextResponse.json(
        {
          error: `Transcription failed on both the selected and fallback models. Selected (${transcribeModelId}): ${primaryError} Fallback (${FALLBACK_TRANSCRIBE_MODEL}): ${sanitizedFallbackBody}`,
          errorInfo: {
            provider: 'openai-whisper',
            model: FALLBACK_TRANSCRIBE_MODEL,
            stage: 'transcribe',
            upstreamStatus: fallbackRes.status,
            upstreamBody: sanitizedFallbackBody,
          },
        },
        { status: 502 },
      );
    }
    data = await fallbackRes.json();
  }

  const segments =
    mode === 'diarized'
      ? mapDiarizedSegments(data.segments ?? [], speakerNames)
      : mapFallbackSegments(data.segments ?? []);

  return NextResponse.json({
    mode,
    segments,
    primaryError: mode === 'fallback' ? primaryError : null,
    warnings: [],
  });
}
