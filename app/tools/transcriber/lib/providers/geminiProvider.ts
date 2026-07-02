// Browser-side Gemini direct-transcription provider: client-orchestrated
// upload → poll-until-active → one-or-more transcription window calls →
// best-effort file cleanup. Mirrors openaiProvider.ts's shape (a single
// async entry point that returns a TranscriptionAttempt or throws a
// TranscriptionAttemptError, already classified) so useTranscriberPipeline.ts
// can treat both providers uniformly.
//
// A long recording can't go through one generateContent call (~65k
// output-token ceiling, Edge wall-clock limits) — above
// GEMINI_SINGLE_CALL_MAX_SECONDS this windows the file the same way the
// correction pass chunks a long transcript (createChunkWindows +
// stitchChunkResults), just against a different endpoint.

import { blobToBase64 } from '../base64Audio';
import { classifyTranscriptionError } from '../classifyError';
import {
  GEMINI_FILE_POLL_INTERVAL_MS,
  GEMINI_FILE_POLL_TIMEOUT_MS,
  GEMINI_SINGLE_CALL_MAX_SECONDS,
  GEMINI_WINDOW_OVERLAP_SECONDS,
  GEMINI_WINDOW_SECONDS,
} from '../constants';
import { createChunkWindows, type ChunkWindowBounds } from '../chunkTranscript';
import { normalizeSegments } from '../formatTranscript';
import { sanitizeUpstreamError } from '../sanitizeUpstreamError';
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

/**
 * Runs one Gemini direct-transcription attempt end to end: upload, poll for
 * activation, transcribe (single call or windowed depending on duration),
 * then best-effort delete the uploaded file. Returns a normalized
 * TranscriptionAttempt, or throws a TranscriptionAttemptError (a plain
 * object, not an Error instance) on any failure.
 */
export async function transcribeWithGemini(options: TranscribeWithGeminiOptions): Promise<TranscriptionAttempt> {
  const { file, durationSec, speakerNames, speakerNotes, contextNotes, model, references, idToken, onProgress } = options;

  const uploaded = await uploadFile(file, idToken, model, (fraction) => onProgress({ phase: 'upload', fraction }));

  const warnings: string[] = [];
  let segments: TranscriptSegment[];

  // Everything past this point works against a file that now exists on
  // Google's Files API — wrap it in try/finally so the best-effort delete
  // below always runs, even if polling/encoding/transcribing throws, rather
  // than only on the success path. Otherwise a failure here leaks the
  // upload until its 48h expiry.
  try {
    onProgress({ phase: 'processing' });
    await pollUntilActive(uploaded.fileName, idToken, file, model);

    // Base64-encode reference clips (if any) once, up front — reused for
    // every window call below rather than re-encoded per window.
    const encodedReferences = await encodeReferences(references);

    if (durationSec <= GEMINI_SINGLE_CALL_MAX_SECONDS) {
      onProgress({ phase: 'transcribing', current: 1, total: 1 });
      segments = await transcribeWindow({
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
    } else {
      const windows: ChunkWindowBounds[] = createChunkWindows(durationSec, {
        chunkSeconds: GEMINI_WINDOW_SECONDS,
        overlapSeconds: GEMINI_WINDOW_OVERLAP_SECONDS,
      });

      const chunkResults: ChunkResult[] = [];
      for (let i = 0; i < windows.length; i++) {
        const window = windows[i];
        onProgress({ phase: 'transcribing', current: i + 1, total: windows.length });
        const windowSegments = await transcribeWindow({
          fileUri: uploaded.fileUri,
          mimeType: uploaded.mimeType,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          isFullFile: false,
          speakerNames,
          speakerNotes,
          contextNotes,
          model,
          references: encodedReferences,
          idToken,
          file,
        });
        chunkResults.push({ window, segments: windowSegments });
      }

      segments = stitchChunkResults(chunkResults);
    }
  } finally {
    // On the success path (no throw above), a delete failure is surfaced as
    // a warning below. On a failure path, this still fires — a best-effort
    // cleanup attempt whose outcome doesn't matter, since the thrown error
    // is what propagates from this function either way.
    const deleteWarning = await deleteFileBestEffort(uploaded.fileName, idToken);
    if (deleteWarning) warnings.push(deleteWarning);
  }

  return {
    provider: 'gemini',
    model,
    mode: 'gemini',
    segments: normalizeSegments(segments),
    warnings,
  };
}
