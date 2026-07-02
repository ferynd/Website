export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireAdminUser } from '@/app/lib/verifyFirebaseAuth';
import { modelSupportsDiarization, resolveTranscribeModelId } from '@/app/lib/transcribeModels';
import { blobToDataUrl } from '@/app/tools/transcriber/lib/base64Audio';
import { buildOpenAiTranscriptionEntries, type OpenAiClipReference } from '@/app/tools/transcriber/lib/buildOpenAiTranscriptionForm';
import {
  FALLBACK_TRANSCRIBE_MODEL,
  MAX_OPENAI_UPLOAD_BYTES,
  MAX_SPEAKER_CLIP_BYTES,
  MAX_SPEAKER_CLIPS,
  PRIMARY_TRANSCRIBE_MODEL,
} from '@/app/tools/transcriber/lib/constants';
import { mapDiarizedSegments, mapFallbackSegments } from '@/app/tools/transcriber/lib/mapSpeakerLabels';
import { sanitizeUpstreamError } from '@/app/tools/transcriber/lib/sanitizeUpstreamError';
import type { TranscribeErrorInfo, TranscriptionMode } from '@/app/tools/transcriber/lib/types';
import type { TranscriptionProviderId } from '@/app/tools/transcriber/lib/providers/types';

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

/** Builds a multipart FormData for one OpenAI transcription attempt from a
 * pure entries list (see buildOpenAiTranscriptionEntries) — `.append` (not
 * `.set`) since known_speaker_names[]/known_speaker_references[] repeat one
 * entry per clip. */
function buildTranscriptionForm(file: File, entries: [string, string][]): FormData {
  const form = new FormData();
  form.set('file', file, file.name);
  for (const [key, value] of entries) form.append(key, value);
  return form;
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

  // Optional known-speaker reference clips (Phase 4) — trimmed WAV/audio
  // Files from lib/speakerClips.ts (IndexedDB) or the per-run fallback,
  // parallel to speakerClipNames. Re-validated here regardless of what the
  // client already checked. NEVER log a clip's bytes, its data URL, or its
  // name alongside audio content.
  const clipFiles = form.getAll('speakerClips[]').filter((entry): entry is File => entry instanceof File);

  let clipNames: string[] = [];
  const clipNamesRaw = form.get('speakerClipNames');
  if (typeof clipNamesRaw === 'string') {
    try {
      const parsed = JSON.parse(clipNamesRaw);
      if (Array.isArray(parsed)) clipNames = parsed.filter((s) => typeof s === 'string');
    } catch {
      clipNames = [];
    }
  }

  if (clipFiles.length > 0) {
    if (clipFiles.length > MAX_SPEAKER_CLIPS) {
      return NextResponse.json(
        { error: `At most ${MAX_SPEAKER_CLIPS} speaker reference clips are supported per run.` },
        { status: 400 },
      );
    }
    if (clipNames.length !== clipFiles.length) {
      return NextResponse.json({ error: 'speakerClipNames must have exactly one name per speaker clip.' }, { status: 400 });
    }
    for (const clipFile of clipFiles) {
      if (clipFile.size > MAX_SPEAKER_CLIP_BYTES) {
        return NextResponse.json(
          {
            error: `Each speaker reference clip must be under ${(MAX_SPEAKER_CLIP_BYTES / 1024 / 1024).toFixed(0)} MB.`,
          },
          { status: 400 },
        );
      }
      if (!clipFile.type.startsWith('audio/')) {
        return NextResponse.json({ error: 'Speaker reference clips must be audio files.' }, { status: 400 });
      }
    }
  }

  // Model choice comes from the Settings pop-up (saved client-side); fall back to the
  // site default if missing/unrecognized. Only models that return segment-level
  // timestamps are ever accepted here — see app/lib/transcribeModels.ts for why.
  const transcribeModelId = resolveTranscribeModelId(form.get('model'), PRIMARY_TRANSCRIBE_MODEL);
  const diarizes = modelSupportsDiarization(transcribeModelId);
  const providerId: TranscriptionProviderId = diarizes ? 'openai-diarized' : 'openai-whisper';

  // Known-speaker fields are only ever meaningful for the diarize model —
  // buildOpenAiTranscriptionEntries also enforces this, but converting to
  // data URLs is real work, so skip it entirely for whisper.
  let clipReferences: OpenAiClipReference[] = [];
  if (diarizes && clipFiles.length > 0) {
    clipReferences = await Promise.all(
      clipFiles.map(async (clipFile, i) => ({
        name: clipNames[i],
        dataUrl: await blobToDataUrl(clipFile, clipFile.type),
      })),
    );
  }

  // Backward-compat default ('true'): the pre-Phase-2 behavior (silently
  // retrying whisper-1 when the selected/diarized model call fails) is
  // preserved unless the caller explicitly opts out — driven by the
  // auto-fallback setting client-side.
  const allowWhisperFallbackRaw = form.get('allowWhisperFallback');
  const allowWhisperFallback = typeof allowWhisperFallbackRaw === 'string' ? allowWhisperFallbackRaw !== 'false' : true;

  const primaryForm = buildTranscriptionForm(
    file,
    buildOpenAiTranscriptionEntries({
      model: transcribeModelId,
      diarizes,
      clips: clipReferences.length > 0 ? clipReferences : undefined,
    }),
  );

  let mode: TranscriptionMode = diarizes ? 'diarized' : 'fallback';
  let primaryError: string | null = null;
  let primaryErrorInfo: TranscribeErrorInfo | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any = null;
  const warnings: string[] = [];

  let primaryRes = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
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

    // OpenAI occasionally rejects the known_speaker_* fields themselves
    // (e.g. a malformed reference) rather than the transcription request as
    // a whole — when that's the specific failure, retry ONCE on the same
    // (diarized) model without the clips before giving up on it entirely.
    const isKnownSpeakerRejection =
      diarizes && clipReferences.length > 0 && primaryRes.status === 400 && /known_speaker/i.test(errText);

    if (isKnownSpeakerRejection) {
      const retryForm = buildTranscriptionForm(
        file,
        buildOpenAiTranscriptionEntries({ model: transcribeModelId, diarizes }),
      );
      const retryRes = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: retryForm,
      });

      if (retryRes.ok) {
        data = await retryRes.json();
        warnings.push('speaker-references-rejected');
      } else {
        const retryErrText = await retryRes.text().catch(() => '');
        const sanitizedRetryBody = sanitizeUpstreamError(retryErrText);
        primaryError = sanitizedRetryBody || `OpenAI transcription failed (${retryRes.status}).`;
        mode = 'fallback';
        primaryErrorInfo = {
          provider: providerId,
          model: transcribeModelId,
          stage: 'transcribe',
          upstreamStatus: retryRes.status,
          upstreamBody: sanitizedRetryBody,
        };
        primaryRes = retryRes;
      }
    } else {
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
    warnings,
  });
}
