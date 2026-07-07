// Browser-side OpenAI transcription provider: owns the XHR-with-upload-
// progress request to /api/transcriber/transcribe (moved out of
// useTranscriberPipeline.ts so the pipeline hook stays a slim state
// machine) and turns any failure into a TranscriptionAttemptError, already
// classified via classifyTranscriptionError, so the hook never has to
// re-derive that from a generic exception.
//
// Long/large recordings: gpt-4o-transcribe-diarize caps audio at
// OPENAI_MAX_AUDIO_SECONDS and OpenAI caps a single upload at
// MAX_OPENAI_UPLOAD_BYTES. When `preprocess.enabled` is on and the file
// exceeds either threshold, this decodes the file once client-side (never
// uploading the original to our server), removes real silence, optionally
// speeds up the whole buffer, splits it into chunks that each fit under
// both caps (lib/preprocessOpenAiAudio.ts), transcribes each chunk through
// the SAME /api/transcriber/transcribe route as a normal small file, and
// stitches the results back together with every segment's timestamp
// remapped to ORIGINAL-recording time (lib/preprocessAudioPlan.ts's
// combineChunkResponses). A small file (or preprocessing disabled) takes
// exactly the pre-existing single-request path — no decoding, no behavior
// change.

import { classifyTranscriptionError } from '../classifyError';
import { FALLBACK_TRANSCRIBE_MODEL, MAX_OPENAI_UPLOAD_BYTES, OPENAI_SINGLE_REQUEST_MAX_SECONDS } from '../constants';
import { normalizeSegments } from '../formatTranscript';
import { applySpeedFactorToClip, preprocessForOpenAi, type PreprocessReport } from '../preprocessOpenAiAudio';
import { combineChunkResponses, type ChunkTranscriptionResult } from '../preprocessAudioPlan';
import { sanitizeUpstreamError } from '../sanitizeUpstreamError';
import type { TranscribeApiResponse, TranscribeErrorInfo, TranscriptionMode } from '../types';
import type { SpeakerReferenceClip, TranscriptionAttempt, TranscriptionAttemptError, TranscriptionProviderId } from './types';

export interface TranscribeWithOpenAiOptions {
  file: File;
  speakerNames: string[];
  /** OpenAI transcription model id — 'gpt-4o-transcribe-diarize' or 'whisper-1'. */
  model: string;
  /** When false, the route must NOT silently retry whisper-1 on a primary-model failure — see the transcribe route. */
  allowWhisperFallback: boolean;
  /** Known-speaker reference clips (Phase 4) — the caller (useTranscriberPipeline.ts) is responsible for only passing these when settings.speakerClipsEnabled AND the diarized model is in use; the server independently re-checks both and re-validates size/count. */
  clips?: SpeakerReferenceClip[];
  /** Probed client-side via lib/audioDuration.ts before this provider runs (only when preprocessing is enabled) — null means unknown, and this run falls back to deciding chunking on file size alone. */
  durationSec: number | null;
  /** Long-recording preprocessing/chunking controls — see useTranscriberPipeline.ts's settings.openaiPreprocessing/openaiSilenceRemoval/openaiSpeedFactor. */
  preprocess: { enabled: boolean; silenceRemoval: boolean; speedFactor: number };
  /** Fired once per chunk, 1-indexed, only on the chunked path. */
  onChunkProgress?: (current: number, total: number) => void;
  /** Fired once, before preprocessing starts, only on the chunked path — lets the caller show a "preparing/optimizing audio" status. */
  onPreparing?: () => void;
  idToken: string;
  onUploadProgress: (fraction: number) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRecord = Record<string, any>;

/** POSTs the transcribe request with real upload-progress events via XHR (fetch has no upload progress API).
 * Never rejects on a non-2xx or non-JSON response — those are the caller's
 * job to classify — only a genuine network-level failure rejects. */
function postFormWithProgress(
  file: File,
  speakerNames: string[],
  model: string,
  allowWhisperFallback: boolean,
  clips: SpeakerReferenceClip[],
  idToken: string,
  onUploadProgress: (fraction: number) => void,
): Promise<{ status: number; rawText: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/transcriber/transcribe');
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploadProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve({ status: xhr.status, rawText: xhr.responseText });
    xhr.onerror = () => reject(new Error('Network error while uploading.'));

    const form = new FormData();
    form.set('file', file, file.name);
    form.set('speakerNames', JSON.stringify(speakerNames));
    form.set('model', model);
    form.set('allowWhisperFallback', String(allowWhisperFallback));
    if (clips.length > 0) {
      // NEVER log clip contents — only the (already non-sensitive) names go
      // through JSON.stringify here; the audio bytes are appended as files.
      form.set('speakerClipNames', JSON.stringify(clips.map((clip) => clip.name)));
      clips.forEach((clip, i) => {
        const extension = clip.mimeType.includes('wav') ? 'wav' : 'audio';
        form.append('speakerClips[]', clip.blob, `speaker-clip-${i}.${extension}`);
      });
    }
    xhr.send(form);
  });
}

function guessProviderId(model: string): TranscriptionProviderId {
  return model === FALLBACK_TRANSCRIBE_MODEL ? 'openai-whisper' : 'openai-diarized';
}

function buildAttemptError(params: {
  httpStatus: number | null;
  bodyText: string;
  provider: TranscriptionProviderId;
  model: string;
  stage: TranscribeErrorInfo['stage'];
  file: File;
}): TranscriptionAttemptError {
  const { httpStatus, bodyText, provider, model, stage, file } = params;
  const classified = classifyTranscriptionError({
    httpStatus,
    bodyText,
    provider,
    stage,
    fileName: file.name,
    fileSizeBytes: file.size,
    browserMime: file.type,
  });
  return { classified, httpStatus, upstreamBody: bodyText, provider, model };
}

/** Prefixes an already-classified attempt error's diagnostic body with a
 * `Chunk i/n:` marker, without re-classifying it (the underlying
 * category/likelyCause/recommendedAction/retryProviders are unaffected —
 * only the displayed diagnostic text changes). */
function prefixChunkError(err: TranscriptionAttemptError, current: number, total: number): TranscriptionAttemptError {
  return { ...err, upstreamBody: `Chunk ${current}/${total}: ${err.upstreamBody}` };
}

interface OneRequestResult {
  mode: TranscriptionMode;
  segments: ChunkTranscriptionResult['segments'];
  primaryError: string | null;
  warnings: string[];
}

/**
 * Runs exactly one POST to /api/transcriber/transcribe (single-shot or one
 * chunk of a chunked run) and returns its parsed, un-normalized result.
 * Throws a TranscriptionAttemptError (unprefixed) on any failure — the
 * caller decides whether to wrap it further (see prefixChunkError above).
 */
async function transcribeOneRequest(
  file: File,
  speakerNames: string[],
  model: string,
  allowWhisperFallback: boolean,
  clips: SpeakerReferenceClip[],
  idToken: string,
  onUploadProgress: (fraction: number) => void,
): Promise<OneRequestResult> {
  const providerGuess = guessProviderId(model);

  let status: number;
  let rawText: string;
  try {
    const result = await postFormWithProgress(file, speakerNames, model, allowWhisperFallback, clips, idToken, onUploadProgress);
    status = result.status;
    rawText = result.rawText;
  } catch (err) {
    throw buildAttemptError({
      httpStatus: null,
      bodyText: err instanceof Error ? err.message : 'Network error while uploading.',
      provider: providerGuess,
      model,
      stage: 'upload',
      file,
    });
  }

  let json: JsonRecord = {};
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    json = {};
  }

  if (status < 200 || status >= 300) {
    const errorInfo = json.errorInfo as TranscribeErrorInfo | undefined;
    const bodyText = errorInfo?.upstreamBody ?? sanitizeUpstreamError(typeof json.error === 'string' ? json.error : rawText);
    throw buildAttemptError({
      httpStatus: errorInfo?.upstreamStatus ?? status,
      bodyText,
      provider: errorInfo?.provider ?? providerGuess,
      model,
      stage: errorInfo?.stage ?? 'transcribe',
      file,
    });
  }

  const result = json as TranscribeApiResponse;
  return {
    mode: result.mode,
    segments: result.segments ?? [],
    primaryError: result.primaryError ?? null,
    warnings: result.warnings ?? [],
  };
}

/** Builds the final TranscriptionAttempt from a single combined/parsed result — shared by both the single-request and chunked paths so the "used Whisper" provider/model/warning derivation stays identical. */
function finalizeAttempt(
  result: OneRequestResult,
  model: string,
  preprocessReport?: PreprocessReport,
): TranscriptionAttempt {
  const usedWhisperFallback = result.mode === 'fallback';
  const fallbackWarning =
    usedWhisperFallback && result.primaryError
      ? `Diarized model unavailable — used Whisper (no diarization). ${result.primaryError}`
      : null;

  return {
    provider: usedWhisperFallback ? 'openai-whisper' : 'openai-diarized',
    model: usedWhisperFallback ? FALLBACK_TRANSCRIBE_MODEL : model,
    mode: result.mode,
    segments: normalizeSegments(result.segments ?? []),
    warnings: [...(fallbackWarning ? [fallbackWarning] : []), ...(result.warnings ?? [])],
    ...(preprocessReport ? { preprocessReport } : {}),
  };
}

/**
 * Runs one OpenAI transcription attempt (diarized or whisper, depending on
 * `model`) and returns a normalized TranscriptionAttempt. On any failure —
 * network, platform, or a structured route failure — throws a
 * TranscriptionAttemptError (a plain object, not an Error instance; callers
 * check for its `classified` field) instead of a generic exception.
 *
 * A file that doesn't need chunking (preprocessing disabled, or under both
 * the size and probed-duration thresholds) takes exactly the pre-existing
 * single-request path — the audio is never decoded. Otherwise the file is
 * preprocessed and split into chunks (see lib/preprocessOpenAiAudio.ts),
 * each chunk goes through this same route independently, and the combined
 * result carries every segment's timestamp remapped back to
 * ORIGINAL-recording time.
 */
export async function transcribeWithOpenAi(options: TranscribeWithOpenAiOptions): Promise<TranscriptionAttempt> {
  const {
    file,
    speakerNames,
    model,
    allowWhisperFallback,
    clips = [],
    durationSec,
    preprocess,
    onChunkProgress,
    onPreparing,
    idToken,
    onUploadProgress,
  } = options;

  const needsChunking =
    preprocess.enabled &&
    (file.size > MAX_OPENAI_UPLOAD_BYTES || (durationSec !== null && durationSec > OPENAI_SINGLE_REQUEST_MAX_SECONDS));

  if (!needsChunking) {
    const result = await transcribeOneRequest(file, speakerNames, model, allowWhisperFallback, clips, idToken, onUploadProgress);
    return finalizeAttempt(result, model);
  }

  onPreparing?.();

  let preprocessed: Awaited<ReturnType<typeof preprocessForOpenAi>>;
  try {
    preprocessed = await preprocessForOpenAi(file, {
      silenceRemoval: preprocess.silenceRemoval,
      speedFactor: preprocess.speedFactor,
    });
  } catch (err) {
    throw buildAttemptError({
      httpStatus: null,
      bodyText:
        err instanceof Error
          ? `This browser could not decode/prepare the audio for chunked transcription: ${err.message}`
          : 'This browser could not decode/prepare the audio for chunked transcription.',
      provider: guessProviderId(model),
      model,
      stage: 'upload',
      file,
    });
  }

  // Speed up speaker reference clips by the same factor so pitch-shifted
  // chunk audio still matches the reference voices — a failure to speed up
  // a given clip falls back to that clip's original (unsped) audio rather
  // than dropping the reference or failing the run.
  let effectiveClips = clips;
  if (preprocess.speedFactor > 1 && clips.length > 0) {
    effectiveClips = await Promise.all(
      clips.map(async (clip) => {
        try {
          const sped = await applySpeedFactorToClip(clip.blob, preprocess.speedFactor);
          return { ...clip, blob: sped, mimeType: 'audio/wav' };
        } catch {
          return clip;
        }
      }),
    );
  }

  const total = preprocessed.chunkFiles.length;
  const perChunk: ChunkTranscriptionResult[] = [];

  for (let i = 0; i < total; i++) {
    onChunkProgress?.(i + 1, total);
    try {
      const chunkResult = await transcribeOneRequest(
        preprocessed.chunkFiles[i],
        speakerNames,
        model,
        allowWhisperFallback,
        effectiveClips,
        idToken,
        (fraction) => {
          onUploadProgress((i + fraction) / total);
          // The pipeline's upload handler flips status back to 'uploading'
          // whenever the overall fraction is under 1 — re-assert this
          // chunk's "transcribing" state once ITS upload completes, so the
          // status doesn't read 'uploading' while waiting on the response.
          if (fraction >= 1) onChunkProgress?.(i + 1, total);
        },
      );
      perChunk.push(chunkResult);
    } catch (err) {
      throw prefixChunkError(err as TranscriptionAttemptError, i + 1, total);
    }
  }

  const combined = combineChunkResponses(perChunk, preprocessed.mapTime);
  return finalizeAttempt(combined, model, preprocessed.report);
}
