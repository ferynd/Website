// Browser-side Gemini direct-transcription provider: client-orchestrated
// upload → poll-until-active → one-or-more transcription window calls →
// best-effort file cleanup. Mirrors openaiProvider.ts's shape (a single
// async entry point that returns a TranscriptionAttempt or throws a
// TranscriptionAttemptError, already classified) so useTranscriberPipeline.ts
// can treat both providers uniformly.
//
// A long recording can't go through one generateContent call (~65k
// output-token ceiling, Edge wall-clock limits) — above
// GEMINI_SINGLE_CALL_MAX_SECONDS this windows the recording the same way the
// correction pass chunks a long transcript (createChunkWindows +
// stitchChunkResults), just against a different endpoint. Unlike the
// correction pass (which chunks already-transcribed text), each window here
// is REAL sliced audio: the file is decoded once client-side
// (decodeAudioMono16k.ts), each window's samples are cut out and re-encoded
// as its own small WAV, and that slice — not the original full file — is
// what gets uploaded to Gemini and transcribed for that window. This keeps
// each window call's input (and billing) proportional to that window's
// duration, instead of resending/reprocessing the entire recording once per
// window with a "please only look at this part" prompt instruction.

import { blobToBase64 } from '../base64Audio';
import { classifyTranscriptionError } from '../classifyError';
import { encodeWavPcm16 } from '../clipAnalysis';
import {
  GEMINI_FILE_POLL_INTERVAL_MS,
  GEMINI_FILE_POLL_TIMEOUT_MS,
  GEMINI_SINGLE_CALL_MAX_SECONDS,
  GEMINI_WINDOW_OVERLAP_SECONDS,
  GEMINI_WINDOW_SECONDS,
} from '../constants';
import { createChunkWindows, type ChunkWindowBounds } from '../chunkTranscript';
import { decodeToMono16k, sliceMonoSamples, type DecodedMonoAudio } from '../decodeAudioMono16k';
import { normalizeSegments } from '../formatTranscript';
import { collectWindowOverlapLinks, type OverlapLink } from '../reconcileSpeakers';
import { sanitizeUpstreamError } from '../sanitizeUpstreamError';
import { attachChunkProvenance } from '../segmentProvenance';
import { stitchChunkResults, type ChunkResult } from '../stitchTranscript';
import type { TranscribeErrorInfo, TranscriptSegment } from '../types';
import type { SpeakerReferenceClip, TranscriptionAttempt, TranscriptionAttemptError } from './types';

/** A voice-reference clip already base64-encoded, ready to embed in the window route's JSON body — see encodeReferences below. */
interface EncodedReference {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export type GeminiProgressEvent =
  | { phase: 'upload'; fraction: number }
  | { phase: 'processing' }
  | { phase: 'transcribing'; current: number; total: number };

/**
 * Caller-supplied per-window result store for the windowed path, so windows
 * already transcribed before a failure survive it and an explicit retry
 * skips them (upload and all). Same contract as openaiProvider.ts's
 * TranscribeChunkCache: results are only valid for an identical window
 * plan, so `windowCount` is passed on every call and a mismatch with the
 * stored plan must discard the stored results.
 */
export interface GeminiWindowCache {
  get(windowCount: number, index: number): TranscriptSegment[] | undefined;
  set(windowCount: number, index: number, segments: TranscriptSegment[]): void;
}

export interface TranscribeWithGeminiOptions {
  file: File;
  /** Probed client-side via lib/audioDuration.ts before this provider runs — required to decide single-call vs. windowed transcription. */
  durationSec: number;
  speakerNames: string[];
  /** Parallel to speakerNames — optional per-speaker voice/speaking-style note. */
  speakerNotes?: string[];
  contextNotes: string;
  /** Gemini model id — restricted server-side to GEMINI_TRANSCRIBE_MODELS regardless of what's sent here. */
  model: string;
  /** Experimental voice-reference clips (settings.geminiReferenceClips, default OFF) — the caller is responsible for only passing these when that setting is on; base64-encoded once here and reused for every window call. */
  references?: SpeakerReferenceClip[];
  /** Per-window result store for the windowed path only — see GeminiWindowCache. Absent means no caching. The single-call path (short recordings) never uses it. */
  windowCache?: GeminiWindowCache;
  idToken: string;
  onProgress: (event: GeminiProgressEvent) => void;
}

/** Base64-encodes each reference clip's Blob exactly once (not per-window) — reused across every transcribeWindow() call in a windowed run. Returns undefined for an empty/absent list so the request body omits the field entirely rather than sending `references: []`. */
async function encodeReferences(references: SpeakerReferenceClip[] | undefined): Promise<EncodedReference[] | undefined> {
  if (!references || references.length === 0) return undefined;
  return Promise.all(
    references.map(async (ref) => ({ name: ref.name, mimeType: ref.mimeType, dataBase64: await blobToBase64(ref.blob) })),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRecord = Record<string, any>;

interface UploadResult {
  fileName: string;
  fileUri: string;
  mimeType: string;
}

function buildAttemptError(params: {
  httpStatus: number | null;
  bodyText: string;
  stage: TranscribeErrorInfo['stage'];
  model: string;
  file: File;
}): TranscriptionAttemptError {
  const { httpStatus, bodyText, stage, model, file } = params;
  const classified = classifyTranscriptionError({
    httpStatus,
    bodyText,
    provider: 'gemini',
    stage,
    fileName: file.name,
    fileSizeBytes: file.size,
    browserMime: file.type,
  });
  return { classified, httpStatus, upstreamBody: bodyText, provider: 'gemini', model };
}

/** Extracts the sanitized error body from a route's structured `{error, errorInfo}` failure shape, falling back to the plain `error` string. */
function extractErrorBody(json: JsonRecord, rawText: string): { httpStatus: number | null; bodyText: string } {
  const errorInfo = json?.errorInfo as TranscribeErrorInfo | undefined;
  if (errorInfo) {
    return { httpStatus: errorInfo.upstreamStatus, bodyText: errorInfo.upstreamBody };
  }
  const bodyText = sanitizeUpstreamError(typeof json?.error === 'string' ? json.error : rawText);
  return { httpStatus: null, bodyText };
}

/** POSTs the upload request with real upload-progress events via XHR (fetch has no upload progress API) — same pattern as openaiProvider.ts's postFormWithProgress. */
function postUploadWithProgress(
  file: File,
  idToken: string,
  onUploadProgress: (fraction: number) => void,
): Promise<{ status: number; rawText: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/transcriber/gemini/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploadProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve({ status: xhr.status, rawText: xhr.responseText });
    xhr.onerror = () => reject(new Error('Network error while uploading.'));

    const form = new FormData();
    form.set('file', file, file.name);
    xhr.send(form);
  });
}

async function uploadFile(
  file: File,
  idToken: string,
  model: string,
  onUploadProgress: (fraction: number) => void,
): Promise<UploadResult> {
  let status: number;
  let rawText: string;
  try {
    const result = await postUploadWithProgress(file, idToken, onUploadProgress);
    status = result.status;
    rawText = result.rawText;
  } catch (err) {
    throw buildAttemptError({
      httpStatus: null,
      bodyText: err instanceof Error ? err.message : 'Network error while uploading.',
      stage: 'upload',
      model,
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
    const { httpStatus, bodyText } = extractErrorBody(json, rawText);
    throw buildAttemptError({ httpStatus: httpStatus ?? status, bodyText, stage: 'upload', model, file });
  }

  if (typeof json.fileName !== 'string' || typeof json.fileUri !== 'string') {
    throw buildAttemptError({
      httpStatus: status,
      bodyText: 'Gemini upload response was missing the expected file fields.',
      stage: 'upload',
      model,
      file,
    });
  }

  return { fileName: json.fileName, fileUri: json.fileUri, mimeType: json.mimeType || file.type || 'application/octet-stream' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls the Gemini file-status route until `state` is 'ACTIVE'. A 'FAILED' state or a timeout both throw a classified stage-'poll' error. */
async function pollUntilActive(fileName: string, idToken: string, file: File, model: string): Promise<void> {
  const deadline = Date.now() + GEMINI_FILE_POLL_TIMEOUT_MS;

  for (;;) {
    let status: number;
    let json: JsonRecord;
    try {
      const res = await fetch(`/api/transcriber/gemini/file?name=${encodeURIComponent(fileName)}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      status = res.status;
      json = await res.json().catch(() => ({}));
    } catch (err) {
      throw buildAttemptError({
        httpStatus: null,
        bodyText: err instanceof Error ? err.message : 'Network error while checking file status.',
        stage: 'poll',
        model,
        file,
      });
    }

    if (status >= 200 && status < 300 && json.state === 'ACTIVE') return;

    if (json.state === 'FAILED' || (status < 200 || status >= 300)) {
      const bodyText = sanitizeUpstreamError(typeof json.error === 'string' ? json.error : `File state: ${json.state ?? 'unknown'}.`);
      throw buildAttemptError({ httpStatus: status, bodyText, stage: 'poll', model, file });
    }

    if (Date.now() >= deadline) {
      throw buildAttemptError({
        httpStatus: null,
        bodyText: `Timed out waiting for the uploaded file to become active (last state: ${json.state ?? 'unknown'}).`,
        stage: 'poll',
        model,
        file,
      });
    }

    await sleep(GEMINI_FILE_POLL_INTERVAL_MS);
  }
}

interface WindowCallParams {
  fileUri: string;
  mimeType: string;
  windowStart: number;
  windowEnd: number;
  isFullFile: boolean;
  speakerNames: string[];
  speakerNotes?: string[];
  contextNotes: string;
  model: string;
  references?: EncodedReference[];
  idToken: string;
  file: File;
}

async function transcribeWindow(params: WindowCallParams): Promise<TranscriptSegment[]> {
  const {
    fileUri,
    mimeType,
    windowStart,
    windowEnd,
    isFullFile,
    speakerNames,
    speakerNotes,
    contextNotes,
    model,
    references,
    idToken,
    file,
  } = params;

  let status: number;
  let json: JsonRecord;
  try {
    const res = await fetch('/api/transcriber/gemini/window', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileUri,
        mimeType,
        windowStart,
        windowEnd,
        isFullFile,
        speakerNames,
        speakerNotes,
        contextNotes,
        model,
        references,
      }),
    });
    status = res.status;
    json = await res.json().catch(() => ({ error: `Server returned a non-JSON response (HTTP ${res.status}).` }));
  } catch (err) {
    throw buildAttemptError({
      httpStatus: null,
      bodyText: err instanceof Error ? err.message : 'Network error while transcribing.',
      stage: 'transcribe',
      model,
      file,
    });
  }

  if (status < 200 || status >= 300) {
    const { httpStatus, bodyText } = extractErrorBody(json, '');
    throw buildAttemptError({ httpStatus: httpStatus ?? status, bodyText, stage: 'transcribe', model, file });
  }

  return Array.isArray(json.segments) ? (json.segments as TranscriptSegment[]) : [];
}

/** Best-effort delete — a failure here is a warning, never a thrown error; the transcription result is already final by the time this runs. */
async function deleteFileBestEffort(fileName: string, idToken: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/transcriber/gemini/file?name=${encodeURIComponent(fileName)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const json: JsonRecord = await res.json().catch(() => ({ deleted: false }));
    if (json.deleted) return null;
    return `Could not delete the temporary Gemini file after transcription (it will expire automatically): ${json.detail ?? 'unknown reason'}.`;
  } catch {
    return 'Could not delete the temporary Gemini file after transcription (it will expire automatically).';
  }
}

/** Encodes a slice of decoded mono samples as a small WAV File ready to upload for one window's transcription call. */
function encodeWindowFile(sourceFileName: string, samples: Float32Array<ArrayBuffer>, sampleRate: number, index: number): File {
  const wavBuffer = encodeWavPcm16(samples, sampleRate);
  return new File([wavBuffer], `${sourceFileName}.window-${index + 1}.wav`, { type: 'audio/wav' });
}

/**
 * Runs one Gemini direct-transcription attempt end to end. A recording at or
 * under GEMINI_SINGLE_CALL_MAX_SECONDS uploads the original file once and
 * makes a single transcription call against it. A longer recording is never
 * uploaded whole to Gemini: it's decoded once client-side, cut into
 * overlapping windows, and each window's audio is re-encoded as its own WAV
 * and uploaded/transcribed/deleted independently — so a window call's input
 * is exactly that window's audio, never the full file. Returns a normalized
 * TranscriptionAttempt, or throws a TranscriptionAttemptError (a plain
 * object, not an Error instance) on any failure.
 */
export async function transcribeWithGemini(options: TranscribeWithGeminiOptions): Promise<TranscriptionAttempt> {
  const { file, durationSec, speakerNames, speakerNotes, contextNotes, model, references, windowCache, idToken, onProgress } =
    options;

  const warnings: string[] = [];
  let segments: TranscriptSegment[];
  let overlapLinks: OverlapLink[] = [];

  // Base64-encode reference clips (if any) once, up front — reused for every
  // window call below rather than re-encoded per window.
  const encodedReferences = await encodeReferences(references);

  if (durationSec <= GEMINI_SINGLE_CALL_MAX_SECONDS) {
    const uploaded = await uploadFile(file, idToken, model, (fraction) => onProgress({ phase: 'upload', fraction }));

    // Everything past this point works against a file that now exists on
    // Google's Files API — wrap it in try/finally so the best-effort delete
    // below always runs, even if polling/transcribing throws, rather than
    // only on the success path. Otherwise a failure here leaks the upload
    // until its 48h expiry.
    try {
      onProgress({ phase: 'processing' });
      await pollUntilActive(uploaded.fileName, idToken, file, model);

      onProgress({ phase: 'transcribing', current: 1, total: 1 });
      const windowSegments = await transcribeWindow({
        fileUri: uploaded.fileUri,
        mimeType: uploaded.mimeType,
        windowStart: 0,
        windowEnd: durationSec,
        isFullFile: true,
        speakerNames,
        speakerNotes,
        contextNotes,
        model,
        references: encodedReferences,
        idToken,
        file,
      });
      segments = attachChunkProvenance(windowSegments, 0);
    } finally {
      const deleteWarning = await deleteFileBestEffort(uploaded.fileName, idToken);
      if (deleteWarning) warnings.push(deleteWarning);
    }
  } else {
    // Decode the whole recording into mono 16 kHz samples exactly once —
    // every window below slices out of this same buffer rather than
    // re-decoding (or re-uploading the original file) per window.
    let decoded: DecodedMonoAudio;
    try {
      onProgress({ phase: 'processing' });
      decoded = await decodeToMono16k(file);
    } catch (err) {
      throw buildAttemptError({
        httpStatus: null,
        bodyText: err instanceof Error ? err.message : 'Failed to decode the audio file for windowed transcription.',
        stage: 'upload',
        model,
        file,
      });
    }

    const windows: ChunkWindowBounds[] = createChunkWindows(durationSec, {
      chunkSeconds: GEMINI_WINDOW_SECONDS,
      overlapSeconds: GEMINI_WINDOW_OVERLAP_SECONDS,
    });

    const chunkResults: ChunkResult[] = [];
    let deleteFailureCount = 0;

    for (let i = 0; i < windows.length; i++) {
      const window = windows[i];

      // A window transcribed by an earlier (failed) run skips everything —
      // slicing, upload, polling, the transcription call — outright. Windows
      // stay sequential here (each has its own upload+activation round trip,
      // and a failure is usually systemic), but a mid-run failure no longer
      // costs the windows already done: they're in the cache for the retry.
      const cachedSegments = windowCache?.get(windows.length, i);
      if (cachedSegments) {
        chunkResults.push({ window, segments: cachedSegments });
        onProgress({ phase: 'transcribing', current: i + 1, total: windows.length });
        continue;
      }

      const windowFile = encodeWindowFile(
        file.name,
        sliceMonoSamples(decoded.samples, decoded.sampleRate, window.windowStart, window.windowEnd),
        decoded.sampleRate,
        i,
      );

      const uploadedWindow = await uploadFile(windowFile, idToken, model, (fraction) => onProgress({ phase: 'upload', fraction }));

      try {
        onProgress({ phase: 'processing' });
        await pollUntilActive(uploadedWindow.fileName, idToken, windowFile, model);

        onProgress({ phase: 'transcribing', current: i + 1, total: windows.length });
        const windowSegments = await transcribeWindow({
          fileUri: uploadedWindow.fileUri,
          mimeType: uploadedWindow.mimeType,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          isFullFile: false,
          speakerNames,
          speakerNotes,
          contextNotes,
          model,
          references: encodedReferences,
          idToken,
          file: windowFile,
        });
        // Stable ids + window-qualified local identities attach here, BEFORE
        // caching, so cached and fresh windows carry identical provenance.
        const withProvenance = attachChunkProvenance(windowSegments, i);
        chunkResults.push({ window, segments: withProvenance });
        windowCache?.set(windows.length, i, withProvenance);
      } finally {
        const deleteWarning = await deleteFileBestEffort(uploadedWindow.fileName, idToken);
        if (deleteWarning) deleteFailureCount += 1;
      }
    }

    if (deleteFailureCount > 0) {
      warnings.push(
        `Could not delete ${deleteFailureCount} temporary Gemini window file(s) after transcription (they will expire automatically).`,
      );
    }

    // Overlap identity links must be recovered BEFORE stitching discards the
    // overlap segments (stitchChunkResults keeps each window's core only).
    overlapLinks = collectWindowOverlapLinks(chunkResults);
    segments = stitchChunkResults(chunkResults);
  }

  return {
    provider: 'gemini',
    model,
    mode: 'gemini',
    segments: normalizeSegments(segments),
    warnings,
    ...(overlapLinks.length > 0 ? { overlapLinks } : {}),
  };
}
