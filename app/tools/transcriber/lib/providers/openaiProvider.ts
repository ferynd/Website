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
// both caps (lib/preprocessOpenAiAudio.ts), transcribes the chunks through
// the SAME /api/transcriber/transcribe route as a normal small file — up
// to `parallelChunkRequests` (settings.openaiParallelChunks, default
// OPENAI_PARALLEL_CHUNK_REQUESTS) in flight at once — and stitches the
// results back together with every segment's timestamp remapped to
// ORIGINAL-recording time (lib/preprocessAudioPlan.ts's
// combineChunkResponses). Every chunk is always attempted even when one
// fails, and each success is stored in the caller-supplied chunk cache
// (see TranscribeChunkCache) BEFORE any failure is surfaced, so a retry
// re-runs only the chunks that actually failed. A small file (or
// preprocessing disabled) takes exactly the pre-existing single-request
// path — no decoding, no behavior change.

import { classifyTranscriptionError } from '../classifyError';
import { mapWithConcurrency } from '../concurrency';
import {
  FALLBACK_TRANSCRIBE_MODEL,
  MAX_OPENAI_UPLOAD_BYTES,
  OPENAI_PARALLEL_CHUNK_REQUESTS,
  OPENAI_SINGLE_REQUEST_MAX_SECONDS,
} from '../constants';
import { normalizeSegments } from '../formatTranscript';
import { applySpeedFactorToClip, preprocessForOpenAi, type PreprocessReport } from '../preprocessOpenAiAudio';
import { combineChunkResponses, type ChunkTranscriptionResult } from '../preprocessAudioPlan';
import { sanitizeUpstreamError } from '../sanitizeUpstreamError';
import { attachChunkProvenance } from '../segmentProvenance';
import type { StageUsage, TranscribeApiResponse, TranscribeErrorInfo, TranscriptionMode } from '../types';
import type { SpeakerReferenceClip, TranscriptionAttempt, TranscriptionAttemptError, TranscriptionProviderId } from './types';

/**
 * Caller-supplied per-chunk result store for the chunked path, so completed
 * chunks survive a failed run and an explicit retry re-transcribes only the
 * chunks that failed. The implementation (useTranscriberPipeline.ts) owns
 * keying/invalidation: results are only valid for an identical chunk plan,
 * so `chunkCount` is passed on every call and a mismatch with the stored
 * plan must discard the stored results.
 */
export interface TranscribeChunkCache {
  get(chunkCount: number, index: number): OneRequestResult | undefined;
  set(chunkCount: number, index: number, result: OneRequestResult): void;
}

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
  /** Per-chunk result store for the chunked path only — see TranscribeChunkCache. Absent means no caching (every chunk always transcribed fresh). */
  chunkCache?: TranscribeChunkCache;
  /** How many chunk requests run in flight at once on the chunked path — settings.openaiParallelChunks (already clamped by the settings store); defaults to OPENAI_PARALLEL_CHUNK_REQUESTS when absent. */
  parallelChunkRequests?: number;
  /** Fired each time a chunk COMPLETES on the chunked path — `completed` of `total` chunks done (chunks run in parallel, so there is no single "current" chunk). */
  onChunkProgress?: (completed: number, total: number) => void;
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

/** Surfaced when a multi-chunk diarized run had no speaker reference clips
 * attached — per-chunk anonymous-label mapping can swap speaker names across
 * chunk boundaries without an acoustic anchor (see the note at the combine
 * step below). */
export const CHUNKED_DIARIZATION_NO_CLIPS_WARNING =
  'This recording was transcribed in multiple chunks without speaker reference clips — speaker names may swap between chunks. Add reference clips in Speaker Profiles to anchor speaker identity, and double-check labels around long pauses.';

/** Prefixes an already-classified attempt error's diagnostic body with a
 * `Chunk i/n:` marker, without re-classifying it (the underlying
 * category/likelyCause/recommendedAction/retryProviders are unaffected —
 * only the displayed diagnostic text changes). */
function prefixChunkError(err: TranscriptionAttemptError, current: number, total: number): TranscriptionAttemptError {
  return { ...err, upstreamBody: `Chunk ${current}/${total}: ${err.upstreamBody}` };
}

export interface OneRequestResult {
  mode: TranscriptionMode;
  segments: ChunkTranscriptionResult['segments'];
  primaryError: string | null;
  warnings: string[];
  /** Token usage for this request, only when OpenAI reported it. */
  usage?: StageUsage;
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
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

/** Builds the final TranscriptionAttempt from a single combined/parsed result — shared by both the single-request and chunked paths so the "used Whisper" provider/model/warning derivation stays identical. */
function finalizeAttempt(
  result: OneRequestResult & { overlapLinks?: TranscriptionAttempt['overlapLinks'] },
  model: string,
  preprocessReport?: PreprocessReport,
  usage?: StageUsage[],
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
    ...(result.overlapLinks && result.overlapLinks.length > 0 ? { overlapLinks: result.overlapLinks } : {}),
    ...(usage && usage.length > 0 ? { usage } : {}),
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
    chunkCache,
    parallelChunkRequests = OPENAI_PARALLEL_CHUNK_REQUESTS,
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
    const withProvenance = { ...result, segments: attachChunkProvenance(result.segments, 0) };
    return finalizeAttempt(withProvenance, model, undefined, result.usage ? [result.usage] : undefined);
  }

  onPreparing?.();

  let preprocessed: Awaited<ReturnType<typeof preprocessForOpenAi>>;
  try {
    preprocessed = await preprocessForOpenAi(file, {
      silenceRemoval: preprocess.silenceRemoval,
      speedFactor: preprocess.speedFactor,
    });
  } catch (err) {
    // NOT routed through classifyTranscriptionError: a null-httpStatus
    // failure classifies as a network interruption ("check your connection"),
    // which is wrong for a local decode failure and would bury the real
    // recovery options. Built directly instead — same pattern as
    // useTranscriberPipeline.ts's buildDurationUnknownError.
    const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
    const attemptError: TranscriptionAttemptError = {
      classified: {
        category: 'unknown',
        likelyCause: `This browser could not decode and prepare the audio for chunked transcription${detail}.`,
        recommendedAction:
          'Try Gemini instead (recordings up to 20 minutes upload directly with no browser decoding), or re-export the audio (e.g. to WAV or MP3) and retry.',
        retryProviders: ['gemini'],
        suggestsConversion: false,
      },
      httpStatus: null,
      upstreamBody: err instanceof Error ? err.message : '',
      provider: guessProviderId(model),
      model,
    };
    throw attemptError;
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

  // Chunks run in parallel (bounded by parallelChunkRequests), so
  // progress is reported as an aggregate: upload progress is the mean of
  // every chunk's own upload fraction, and it stops being reported once the
  // first chunk COMPLETES — from there the run presents as "N of M chunks
  // done" via onChunkProgress (the pipeline's upload handler would otherwise
  // flip the status back to 'uploading' on every later chunk's upload event).
  const uploadFractions = new Array<number>(total).fill(0);
  let completedChunks = 0;
  const reportUploadProgress = () => {
    if (completedChunks === 0) {
      onUploadProgress(uploadFractions.reduce((sum, f) => sum + f, 0) / total);
    }
  };
  const reportChunkDone = () => {
    completedChunks += 1;
    onChunkProgress?.(completedChunks, total);
  };

  const settled = await mapWithConcurrency(
    preprocessed.chunkFiles,
    parallelChunkRequests,
    async (chunkFile, i): Promise<ChunkTranscriptionResult> => {
      const cached = chunkCache?.get(total, i);
      if (cached) {
        uploadFractions[i] = 1;
        reportUploadProgress();
        reportChunkDone();
        return cached;
      }
      try {
        const chunkResult = await transcribeOneRequest(
          chunkFile,
          speakerNames,
          model,
          allowWhisperFallback,
          effectiveClips,
          idToken,
          (fraction) => {
            uploadFractions[i] = fraction;
            reportUploadProgress();
          },
        );
        // Stable ids + chunk-qualified local identities attach here, BEFORE
        // caching, so cached and fresh chunks carry identical provenance.
        const withProvenance = { ...chunkResult, segments: attachChunkProvenance(chunkResult.segments, i) };
        chunkCache?.set(total, i, withProvenance);
        reportChunkDone();
        return withProvenance;
      } catch (err) {
        throw prefixChunkError(err as TranscriptionAttemptError, i + 1, total);
      }
    },
  );

  // Every chunk was attempted and every success is already in the cache —
  // only now surface a failure, so a retry resumes from the failed chunks
  // instead of starting over.
  const failures = settled.filter((r): r is { status: 'rejected'; reason: unknown } => r.status === 'rejected');
  if (failures.length > 0) {
    const firstError = failures[0].reason as TranscriptionAttemptError;
    if (failures.length === 1) throw firstError;
    throw {
      ...firstError,
      upstreamBody: `${failures.length} of ${total} chunks failed (${total - failures.length} succeeded and are saved for retry). First failure — ${firstError.upstreamBody}`,
    } satisfies TranscriptionAttemptError;
  }

  const perChunk = settled.map((r) => (r as { status: 'fulfilled'; value: OneRequestResult }).value);

  const combined = combineChunkResponses(perChunk, preprocessed.mapTime, { coreOffsets: preprocessed.coreOffsets });
  // Diarized chunks are mapped to speaker names independently per request
  // (lib/mapSpeakerLabels.ts): with reference clips attached, OpenAI returns
  // the actual known-speaker names, anchoring identity acoustically across
  // chunks — but without clips, the anonymous A/B labels get first-appearance
  // positional mapping per chunk, so a later chunk that opens with the other
  // speaker can swap names at the boundary. The deterministic reconciliation
  // stage (lib/reconcileSpeakers.ts) demotes those later-chunk guesses and
  // re-links identities via the audio-overlap matches captured above; what
  // it can't resolve goes to the targeted repair stage. Keep the warning for
  // clip-less multi-chunk runs — clips remain the strongest anchor.
  if (combined.mode === 'diarized' && total > 1 && effectiveClips.length === 0) {
    combined.warnings.push(CHUNKED_DIARIZATION_NO_CLIPS_WARNING);
  }
  const usage = perChunk
    .map((chunk) => chunk.usage)
    .filter((entry): entry is StageUsage => entry !== undefined);
  return finalizeAttempt(combined, model, preprocessed.report, usage);
}
