'use client';

import { useCallback, useRef, useState } from 'react';
import { auth } from './lib/firebase';
import { createChunkWindows, segmentsInWindow, type ChunkWindowBounds } from './lib/chunkTranscript';
import { CORRECTION_CHUNK_SECONDS, CORRECTION_OVERLAP_SECONDS, MAX_OPENAI_UPLOAD_BYTES } from './lib/constants';
import { buildCorrectionWarning } from './lib/correctionSummary';
import { buildManualCleanupPrompt } from './lib/buildManualCleanupPrompt';
import { buildTranscriptText, formatTimestamp, normalizeSegments } from './lib/formatTranscript';
import { readTranscriberSettings } from './lib/settings';
import { stitchChunkResults, type ChunkResult } from './lib/stitchTranscript';
import type {
  CorrectApiResponse,
  PipelineStatus,
  TranscribeApiResponse,
  TranscriptionMode,
  TranscriptSegment,
} from './lib/types';

export interface TranscriberRunOptions {
  file: File;
  speakerNames: string[];
  contextNotes: string;
  /** When true, abort the whole run instead of falling back to an uncorrected chunk. */
  strictMode?: boolean;
  /** When true, skip the Gemini cleanup pass entirely and return the raw transcript
   * with a manual cleanup prompt prepended, for pasting into a browser AI chat. */
  skipCleanup?: boolean;
}

export interface TranscriberState {
  status: PipelineStatus;
  error: string | null;
  mode: TranscriptionMode | null;
  primaryError: string | null;
  transcriptText: string;
  uploadProgress: number | null; // 0..1, only meaningful during 'uploading'
  chunkProgress: { current: number; total: number } | null; // only meaningful during 'correcting'
  elapsedMs: number;
  /** Set when 1+ correction chunks failed and fell back to uncorrected segments. Null if the run completed clean. */
  warning: string | null;
  correctionFailedChunks: number;
  correctionTotalChunks: number;
  /** True when this run skipped the Gemini cleanup pass (see skipCleanup on TranscriberRunOptions). */
  cleanupSkipped: boolean;
}

const initialState: TranscriberState = {
  status: 'idle',
  error: null,
  mode: null,
  primaryError: null,
  transcriptText: '',
  uploadProgress: null,
  chunkProgress: null,
  elapsedMs: 0,
  warning: null,
  correctionFailedChunks: 0,
  correctionTotalChunks: 0,
  cleanupSkipped: false,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRecord = Record<string, any>;

/** POSTs a FormData body with real upload-progress events via XHR (fetch has no upload progress API). */
function postFormWithProgress(
  url: string,
  form: FormData,
  idToken: string,
  onUploadProgress: (fraction: number) => void,
): Promise<{ status: number; json: JsonRecord }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploadProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      try {
        resolve({ status: xhr.status, json: JSON.parse(xhr.responseText) });
      } catch {
        reject(new Error('Server returned an invalid response.'));
      }
    };
    xhr.onerror = () => reject(new Error('Network error while uploading.'));
    xhr.send(form);
  });
}

async function postJson(url: string, body: unknown, idToken: string): Promise<{ status: number; json: JsonRecord }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // A platform-level failure (e.g. an edge/gateway 502 or 413) can return an
  // HTML body instead of JSON. Parse defensively so that case still reaches
  // the caller's non-2xx handling (chunk failure + warning/strict-mode)
  // instead of throwing and aborting the whole run.
  let json: JsonRecord;
  try {
    json = await res.json();
  } catch {
    json = { error: `Server returned a non-JSON response (HTTP ${res.status}).` };
  }
  return { status: res.status, json };
}

export function useTranscriberPipeline() {
  const [state, setState] = useState<TranscriberState>(initialState);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);

  const startTimer = useCallback(() => {
    startRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setState((s) => ({ ...s, elapsedMs: Date.now() - startRef.current }));
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const run = useCallback(
    async ({ file, speakerNames, contextNotes, strictMode = false, skipCleanup = false }: TranscriberRunOptions) => {
      setState({ ...initialState, status: 'validating' });
      startTimer();

      try {
        if (!file.name.toLowerCase().endsWith('.m4a')) {
          throw new Error('Please choose an .m4a audio file.');
        }
        if (file.size > MAX_OPENAI_UPLOAD_BYTES) {
          throw new Error(
            `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB, which is over OpenAI's 25 MB upload limit. Compress the audio (lower bitrate) or split it into smaller parts before uploading.`,
          );
        }
        const user = auth.currentUser;
        if (!user) throw new Error('You must be signed in.');

        // Model choices come from the Settings pop-up (saved to this browser's
        // localStorage via the versioned settings store).
        const settings = readTranscriberSettings();
        const transcribeModelId = settings.openaiModel;
        const correctionModelId = settings.cleanupModel;

        // --- Transcribe (upload + primary/fallback model) ---
        setState((s) => ({ ...s, status: 'uploading', uploadProgress: 0 }));

        const uploadForm = new FormData();
        uploadForm.set('file', file, file.name);
        uploadForm.set('speakerNames', JSON.stringify(speakerNames));
        uploadForm.set('model', transcribeModelId);

        const idTokenForUpload = await user.getIdToken();
        const { status: transcribeStatus, json: transcribeData } = await postFormWithProgress(
          '/api/transcriber/transcribe',
          uploadForm,
          idTokenForUpload,
          (fraction) => {
            setState((s) => ({
              ...s,
              uploadProgress: fraction,
              status: fraction >= 1 ? 'transcribing' : 'uploading',
            }));
          },
        );

        const transcribeResult = transcribeData as TranscribeApiResponse;
        if (transcribeStatus < 200 || transcribeStatus >= 300) {
          throw new Error(transcribeResult.error || 'Transcription failed.');
        }

        const mode = transcribeResult.mode;
        const rawSegments = normalizeSegments(transcribeResult.segments);
        setState((s) => ({ ...s, mode, primaryError: transcribeResult.primaryError ?? null }));

        if (rawSegments.length === 0) {
          throw new Error('Transcription returned no speech segments.');
        }

        if (skipCleanup) {
          // --- Skip the Gemini cleanup pass: return the raw transcript with a
          // manual cleanup prompt prepended, for pasting into a browser AI chat. ---
          setState((s) => ({ ...s, status: 'building', cleanupSkipped: true }));
          const promptHeader = buildManualCleanupPrompt({ speakerNames, contextNotes, mode });
          const transcriptText = `${promptHeader}\n${buildTranscriptText(rawSegments)}`;

          setState((s) => ({
            ...s,
            status: 'complete',
            transcriptText,
            warning: null,
            correctionFailedChunks: 0,
            correctionTotalChunks: 0,
            cleanupSkipped: true,
          }));
          return;
        }

        // --- Correct (chunked, overlapping Gemini pass) ---
        setState((s) => ({ ...s, status: 'correcting' }));

        const totalDuration = Math.max(...rawSegments.map((s) => s.end));
        const windows = createChunkWindows(totalDuration, {
          chunkSeconds: CORRECTION_CHUNK_SECONDS,
          overlapSeconds: CORRECTION_OVERLAP_SECONDS,
        });

        const chunkResults: ChunkResult[] = [];
        let correctionFailedChunks = 0;

        for (let i = 0; i < windows.length; i++) {
          const window: ChunkWindowBounds = windows[i];
          setState((s) => ({ ...s, chunkProgress: { current: i + 1, total: windows.length } }));

          const windowSegments = segmentsInWindow(rawSegments, window);
          if (windowSegments.length === 0) {
            chunkResults.push({ window, segments: [] });
            continue;
          }

          const idToken = await user.getIdToken();
          const { status: correctStatus, json: correctData } = await postJson(
            '/api/transcriber/correct',
            { segments: windowSegments, speakerNames, contextNotes, mode, model: correctionModelId },
            idToken,
          );
          const correctResult = correctData as CorrectApiResponse;

          if (correctStatus < 200 || correctStatus >= 300) {
            correctionFailedChunks += 1;

            if (strictMode) {
              const rangeLabel = `${formatTimestamp(window.coreStart)}–${formatTimestamp(window.coreEnd)}`;
              const reason = correctResult.error || `HTTP ${correctStatus}`;
              throw new Error(
                `Correction failed for chunk ${i + 1} of ${windows.length} (${rangeLabel}): ${reason}. Strict mode is enabled, so the run was aborted instead of using an uncorrected chunk.`,
              );
            }

            // Don't lose the chunk — keep the uncorrected segments and surface a warning at the end.
            chunkResults.push({ window, segments: windowSegments });
            continue;
          }
          chunkResults.push({ window, segments: correctResult.segments as TranscriptSegment[] });
        }

        // --- Build final transcript ---
        setState((s) => ({ ...s, status: 'building' }));
        const finalSegments = stitchChunkResults(chunkResults);
        const transcriptText = buildTranscriptText(finalSegments);
        const warning = buildCorrectionWarning({
          failedChunks: correctionFailedChunks,
          totalChunks: windows.length,
        });

        setState((s) => ({
          ...s,
          status: 'complete',
          transcriptText,
          warning,
          correctionFailedChunks,
          correctionTotalChunks: windows.length,
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Something went wrong.',
        }));
      } finally {
        stopTimer();
      }
    },
    [startTimer, stopTimer],
  );

  const reset = useCallback(() => {
    stopTimer();
    setState(initialState);
  }, [stopTimer]);

  return { state, run, reset };
}
