// Browser-side OpenAI transcription provider: owns the XHR-with-upload-
// progress request to /api/transcriber/transcribe (moved out of
// useTranscriberPipeline.ts so the pipeline hook stays a slim state
// machine) and turns any failure into a TranscriptionAttemptError, already
// classified via classifyTranscriptionError, so the hook never has to
// re-derive that from a generic exception.

import { classifyTranscriptionError } from '../classifyError';
import { FALLBACK_TRANSCRIBE_MODEL } from '../constants';
import { normalizeSegments } from '../formatTranscript';
import { sanitizeUpstreamError } from '../sanitizeUpstreamError';
import type { TranscribeApiResponse, TranscribeErrorInfo } from '../types';
import type { TranscriptionAttempt, TranscriptionAttemptError, TranscriptionProviderId } from './types';

export interface TranscribeWithOpenAiOptions {
  file: File;
  speakerNames: string[];
  /** OpenAI transcription model id — 'gpt-4o-transcribe-diarize' or 'whisper-1'. */
  model: string;
  /** When false, the route must NOT silently retry whisper-1 on a primary-model failure — see the transcribe route. */
  allowWhisperFallback: boolean;
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

/**
 * Runs one OpenAI transcription attempt (diarized or whisper, depending on
 * `model`) and returns a normalized TranscriptionAttempt. On any failure —
 * network, platform, or a structured route failure — throws a
 * TranscriptionAttemptError (a plain object, not an Error instance; callers
 * check for its `classified` field) instead of a generic exception.
 */
export async function transcribeWithOpenAi(options: TranscribeWithOpenAiOptions): Promise<TranscriptionAttempt> {
  const { file, speakerNames, model, allowWhisperFallback, idToken, onUploadProgress } = options;
  const providerGuess = guessProviderId(model);

  let status: number;
  let rawText: string;
  try {
    const result = await postFormWithProgress(file, speakerNames, model, allowWhisperFallback, idToken, onUploadProgress);
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
  };
}
