'use client';

import { useCallback, useRef, useState } from 'react';
import { auth } from './lib/firebase';
import { probeAudioDuration } from './lib/audioDuration';
import { buildTagSummary, formatArgumentRelevantTranscript } from './lib/argumentTags';
import { createChunkWindows, segmentsInWindow, type ChunkWindowBounds } from './lib/chunkTranscript';
import type { ClassifiedError } from './lib/classifyError';
import { classifyTranscriptionError } from './lib/classifyError';
import { ACCEPTED_FILE_EXTENSIONS, FALLBACK_TRANSCRIBE_MODEL, MAX_GEMINI_UPLOAD_BYTES, MAX_OPENAI_UPLOAD_BYTES } from './lib/constants';
import { buildCorrectionWarning } from './lib/correctionSummary';
import { buildManualCleanupPrompt } from './lib/buildManualCleanupPrompt';
import { formatCleanTranscript } from './lib/formatCleanTranscript';
import { buildTranscriptText, normalizeSegments } from './lib/formatTranscript';
import { mergeTurns } from './lib/mergeTurns';
import { transcribeWithGemini } from './lib/providers/geminiProvider';
import { transcribeWithOpenAi } from './lib/providers/openaiProvider';
import type {
  SpeakerReferenceClip,
  TranscriptionAttempt,
  TranscriptionAttemptError,
  TranscriptionProviderId,
} from './lib/providers/types';
import { appendDebugEvent, buildDebugJson, createDebugLog, type DebugLog, type SpeakerReferenceEntry } from './lib/runDebug';
import { sanitizeUpstreamError } from './lib/sanitizeUpstreamError';
import { readTranscriberSettings } from './lib/settings';
import { stitchChunkResults, type ChunkResult } from './lib/stitchTranscript';
import { suppressArtifacts } from './lib/suppressArtifacts';
import type {
  ArgumentTag,
  CorrectApiResponse,
  PipelineStatus,
  SuppressionReport,
  TaggedTranscriptSegment,
  TranscriptionMode,
  TranscriptSegment,
  TurnBlock,
} from './lib/types';

export interface TranscriberRunOptions {
  file: File;
  speakerNames: string[];
  /** Parallel to speakerNames — optional per-speaker voice/speaking-style note from the speaker profile (Phase 4). Passed to Gemini as prompt context; OpenAI has no equivalent field. */
  speakerNotes?: string[];
  contextNotes: string;
  /** When true, abort the whole cleanup pass (rather than falling back to uncorrected text) on the first chunk failure. */
  strictMode?: boolean;
  /** When true, skip the Gemini cleanup pass entirely and return the raw transcript
   * with a manual cleanup prompt prepended, for pasting into a browser AI chat. */
  skipCleanup?: boolean;
  /**
   * Resolves this run's speaker reference clips on demand (see
   * useSpeakerProfiles.ts's getRunClips() — IndexedDB, or the in-memory
   * per-run fallback when IndexedDB is unavailable). Only called when the
   * active provider/settings combination actually needs clips
   * (openai-diarized + settings.speakerClipsEnabled, or gemini +
   * settings.geminiReferenceClips) — never for a plain Whisper attempt. A
   * rejection (e.g. a private-browsing IndexedDB failure) degrades
   * gracefully: the run continues without clips, with a warning and a
   * debug event, rather than failing the whole transcription.
   */
  getSpeakerClips?: () => Promise<SpeakerReferenceClip[]>;
}

/** Human-readable warnings surfaced in TranscriberState.warning alongside any cleanup warning — see resolveSpeakerClips/the speaker-reference debug event below. */
const SPEAKER_CLIPS_LOAD_FAILED_WARNING =
  'Could not load speaker reference clips from local storage — transcribed without them.';
const SPEAKER_REFERENCES_REJECTED_WARNING =
  'OpenAI rejected the attached speaker reference clips for this run — transcribed without them.';

/** Classified error + enough file/provider diagnostics for the ErrorRecoveryPanel's table, without ever holding transcript text. */
export interface RecoveryInfo {
  classified: ClassifiedError;
  fileName: string;
  fileSizeBytes: number;
  browserMime: string;
  provider: TranscriptionProviderId | null;
  model: string | null;
  upstreamStatus: number | null;
  /** Already sanitized + truncated — see lib/sanitizeUpstreamError.ts. */
  upstreamBody: string;
}

export interface TranscriberState {
  status: PipelineStatus;
  error: string | null;
  mode: TranscriptionMode | null;
  /** The provider currently being attempted — set before mode is known (mode only reflects the last SUCCESSFUL attempt), so PipelineStatusView can show provider-aware step labels (e.g. Gemini's Uploading → Processing → Transcribing) while a run is still in progress. */
  currentProvider: TranscriptionProviderId | null;
  /** Set when the diarized model was unavailable and the run silently used Whisper instead. */
  primaryError: string | null;
  /** Captured immediately after the first successful provider response, before suppression — always the complete transcript. */
  rawSegments: TranscriptSegment[];
  rawText: string;
  /** Segments after suppression + cleanup (pre-merge) — stays segment-granular for future export/tagging use. Carries a `tag` per segment only when this run had settings.argumentTagging on. */
  cleanedSegments: TaggedTranscriptSegment[];
  /** Null when cleanup hasn't produced output yet (still running, skipped, or failed and completed raw-only). */
  cleanedText: string | null;
  turnBlocks: TurnBlock[];
  suppressionReport: SuppressionReport | null;
  /** Zero-filled per-ArgumentTag counts (lib/argumentTags.ts's buildTagSummary) — null unless this run had settings.argumentTagging on AND cleanup actually produced output (no separate AI pass; tags come from the same cleanup call). */
  tagSummary: Record<ArgumentTag, number> | null;
  /** The argument-relevant filtered transcript (lib/argumentTags.ts's formatArgumentRelevantTranscript) — same null conditions as tagSummary. */
  argumentRelevantText: string | null;
  recovery: RecoveryInfo | null;
  /** Serialized only on failure, or always when settings.debugMode is 'always'. Never contains transcript text. */
  debugJson: string | null;
  uploadProgress: number | null; // 0..1, only meaningful during 'uploading'
  chunkProgress: { current: number; total: number } | null; // only meaningful during 'correcting'
  elapsedMs: number;
  /** Set when 1+ cleanup chunks failed and fell back to uncorrected segments. Null if the run completed clean. */
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
  currentProvider: null,
  primaryError: null,
  rawSegments: [],
  rawText: '',
  cleanedSegments: [],
  cleanedText: null,
  turnBlocks: [],
  suppressionReport: null,
  tagSummary: null,
  argumentRelevantText: null,
  recovery: null,
  debugJson: null,
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

async function postJson(url: string, body: unknown, idToken: string): Promise<{ status: number; json: JsonRecord }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // A platform-level failure (e.g. an edge/gateway 502 or 413) can return an
  // HTML body instead of JSON. Parse defensively so that case still reaches
  // the caller's non-2xx handling instead of throwing and aborting the run.
  let json: JsonRecord;
  try {
    json = await res.json();
  } catch {
    json = { error: `Server returned a non-JSON response (HTTP ${res.status}).` };
  }
  return { status: res.status, json };
}

/** Constructed (not thrown as a real Error) when a Gemini attempt can't even
 * start because the browser couldn't determine the file's duration (see
 * lib/audioDuration.ts) — Gemini direct transcription needs duration up
 * front to decide single-call vs. windowed transcription, unlike the OpenAI
 * providers. Shaped exactly like a TranscriptionAttemptError so it flows
 * through the same catch-and-maybe-auto-fallback handling below as any other
 * provider failure. */
function buildDurationUnknownError(file: File, model: string): TranscriptionAttemptError {
  return {
    classified: {
      category: 'unknown',
      likelyCause: "This browser could not determine the recording's duration, which Gemini direct transcription needs before it can run.",
      recommendedAction: 'Try an OpenAI provider instead — it does not need the duration up front.',
      retryProviders: ['openai-diarized', 'openai-whisper'],
      suggestsConversion: false,
    },
    httpStatus: null,
    upstreamBody: '',
    provider: 'gemini',
    model,
  };
}

export function useTranscriberPipeline() {
  const [state, setState] = useState<TranscriberState>(initialState);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);
  /** The most recent run's options, so retryWith() can re-run the same file without re-prompting for it. */
  const lastRunOptionsRef = useRef<TranscriberRunOptions | null>(null);
  const debugLogRef = useRef<DebugLog | null>(null);

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

  const performRun = useCallback(
    async function runPipeline(opts: TranscriberRunOptions, forcedProvider?: TranscriptionProviderId): Promise<void> {
      lastRunOptionsRef.current = opts;
      const { file, speakerNames, speakerNotes, contextNotes, strictMode = false, skipCleanup = false, getSpeakerClips } = opts;

      setState({ ...initialState, status: 'validating' });
      startTimer();

      const debugLog = createDebugLog({
        name: file.name,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
      });
      debugLogRef.current = debugLog;
      const settings = readTranscriberSettings();

      const finalizeFailed = (recovery: RecoveryInfo, errorMessage: string) => {
        appendDebugEvent(debugLog, {
          kind: 'error',
          category: recovery.classified.category,
          stage: 'transcribe',
          provider: recovery.provider,
          upstreamStatus: recovery.upstreamStatus,
          upstreamBody: recovery.upstreamBody,
        });
        setState((s) => ({ ...s, status: 'failed', error: errorMessage, recovery, debugJson: buildDebugJson(debugLog) }));
      };

      try {
        const lowerName = file.name.toLowerCase();
        if (!ACCEPTED_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
          throw new Error(`Please choose a supported audio file (${ACCEPTED_FILE_EXTENSIONS.join(', ')}).`);
        }

        let providerId: TranscriptionProviderId = forcedProvider ?? settings.provider;
        const isExplicitRetry = forcedProvider !== undefined;

        // Provider-aware size cap: Gemini's Files API accepts much larger
        // uploads than OpenAI's direct multipart endpoint (see
        // MAX_GEMINI_UPLOAD_BYTES / MAX_OPENAI_UPLOAD_BYTES in
        // lib/constants.ts). Checked against the provider this run starts
        // with — an auto-fallback hop later in the loop below doesn't
        // re-check this, matching the equivalent pre-run check UploadPanel
        // already shows.
        const maxUploadBytes = providerId === 'gemini' ? MAX_GEMINI_UPLOAD_BYTES : MAX_OPENAI_UPLOAD_BYTES;
        if (file.size > maxUploadBytes) {
          const providerLabel = providerId === 'gemini' ? "Gemini's" : "OpenAI's";
          throw new Error(
            `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB, which is over ${providerLabel} ${(maxUploadBytes / 1024 / 1024).toFixed(0)} MB upload limit. Compress the audio (lower bitrate) or split it into smaller parts before uploading.`,
          );
        }

        const user = auth.currentUser;
        if (!user) throw new Error('You must be signed in.');

        // --- Provider attempt: the chosen provider, plus (when auto-fallback
        // is on and this isn't already an explicit retry) at most one hop to
        // a different provider drawn from settings.fallbackOrder — Gemini is
        // a full candidate here, not just the two OpenAI providers. ---
        const attemptedProviders: TranscriptionProviderId[] = [];
        let attempt: TranscriptionAttempt | null = null;
        // Warnings that aren't tied to a single cleanup chunk (e.g. a
        // rejected or unloadable set of speaker reference clips) —
        // accumulated across the provider-attempt loop below and merged into
        // the final `warning` state alongside any cleanup warning.
        const runWarnings: string[] = [];

        while (!attempt) {
          attemptedProviders.push(providerId);
          const model =
            providerId === 'gemini'
              ? settings.geminiTranscribeModel
              : providerId === 'openai-whisper'
                ? FALLBACK_TRANSCRIBE_MODEL
                : settings.openaiModel;
          appendDebugEvent(debugLog, { kind: 'provider-attempt', provider: providerId, model });
          setState((s) => ({ ...s, currentProvider: providerId, status: 'uploading', uploadProgress: 0 }));

          const idToken = await user.getIdToken();

          // Resolve this attempt's speaker reference clips (IndexedDB or the
          // per-run fallback — see useSpeakerProfiles.ts's getRunClips(),
          // threaded through from page.tsx as opts.getSpeakerClips) — only
          // for the provider/settings combinations that can actually use
          // them. A load failure degrades gracefully: the attempt continues
          // with no clips, a warning, and (below) a debug event instead of
          // failing the run.
          const wantsOpenAiClips = providerId === 'openai-diarized' && settings.speakerClipsEnabled;
          const wantsGeminiReferences = providerId === 'gemini' && settings.geminiReferenceClips;
          let speakerClips: SpeakerReferenceClip[] = [];
          let clipsLoadFailed = false;
          if ((wantsOpenAiClips || wantsGeminiReferences) && getSpeakerClips) {
            try {
              speakerClips = await getSpeakerClips();
            } catch {
              clipsLoadFailed = true;
              if (!runWarnings.includes(SPEAKER_CLIPS_LOAD_FAILED_WARNING)) {
                runWarnings.push(SPEAKER_CLIPS_LOAD_FAILED_WARNING);
              }
            }
          }

          try {
            if (providerId === 'gemini') {
              // Gemini needs the recording's duration up front to decide
              // single-call vs. windowed transcription — OpenAI needs no
              // such probe. A probe failure is shaped like any other
              // provider failure so it flows through the same
              // catch-and-maybe-auto-fallback handling below.
              const durationSec = await probeAudioDuration(file);
              if (durationSec === null) {
                throw buildDurationUnknownError(file, model);
              }

              const geminiReferences = wantsGeminiReferences && speakerClips.length > 0 ? speakerClips : undefined;

              attempt = await transcribeWithGemini({
                file,
                durationSec,
                speakerNames,
                speakerNotes,
                contextNotes,
                model,
                references: geminiReferences,
                idToken,
                onProgress: (event) => {
                  if (event.phase === 'upload') {
                    setState((s) => ({ ...s, uploadProgress: event.fraction, status: 'uploading' }));
                  } else if (event.phase === 'processing') {
                    setState((s) => ({ ...s, status: 'processing', uploadProgress: null }));
                  } else {
                    setState((s) => ({
                      ...s,
                      status: 'transcribing',
                      chunkProgress: { current: event.current, total: event.total },
                    }));
                  }
                },
              });
              // Gemini has no acoustic speaker-reference support — speaker
              // identity for this run came entirely from the prompt (names,
              // notes, context), plus the experimental reference clips above
              // when attached. Surfaced in the debug JSON so a quality
              // review can see why.
              appendDebugEvent(debugLog, {
                kind: 'speaker-reference',
                status: geminiReferences ? 'prompt-inferred+reference-clips (experimental)' : 'prompt-inferred',
              });
            } else {
              attempt = await transcribeWithOpenAi({
                file,
                speakerNames,
                model,
                // The server-side silent whisper retry (backward-compat
                // default) is only allowed for a fresh run when auto-fallback
                // is on — this is the "default OFF -> failures surface in the
                // recovery panel instead of silently degrading" behavior. An
                // explicit provider retry never allows it either, since that's
                // already a deliberate single-provider choice.
                allowWhisperFallback: !isExplicitRetry && settings.autoFallback,
                clips: wantsOpenAiClips ? speakerClips : undefined,
                idToken,
                onUploadProgress: (fraction) =>
                  setState((s) => ({ ...s, uploadProgress: fraction, status: fraction >= 1 ? 'transcribing' : 'uploading' })),
              });

              if (wantsOpenAiClips) {
                const entries: SpeakerReferenceEntry[] = speakerNames.map((name) => {
                  const clip = speakerClips.find((c) => c.name === name);
                  return clip
                    ? { name, attached: true, validationStatus: clip.validationStatus }
                    : { name, attached: false, validationStatus: clipsLoadFailed ? 'unavailable' : 'missing' };
                });
                appendDebugEvent(debugLog, { kind: 'speaker-reference', status: entries });
              }

              if (attempt.warnings.includes('speaker-references-rejected') && !runWarnings.includes(SPEAKER_REFERENCES_REJECTED_WARNING)) {
                runWarnings.push(SPEAKER_REFERENCES_REJECTED_WARNING);
              }
            }
          } catch (err) {
            const attemptError = err as TranscriptionAttemptError;
            appendDebugEvent(debugLog, {
              kind: 'error',
              category: attemptError.classified.category,
              stage: 'transcribe',
              provider: attemptError.provider,
              upstreamStatus: attemptError.httpStatus,
              upstreamBody: attemptError.upstreamBody,
            });

            const nextProvider =
              !isExplicitRetry && settings.autoFallback && attemptedProviders.length < 2
                ? settings.fallbackOrder.find(
                    (p) => !attemptedProviders.includes(p) && attemptError.classified.retryProviders.includes(p),
                  )
                : undefined;

            if (nextProvider) {
              providerId = nextProvider;
              continue;
            }

            finalizeFailed(
              {
                classified: attemptError.classified,
                fileName: file.name,
                fileSizeBytes: file.size,
                browserMime: file.type || 'unknown',
                provider: attemptError.provider,
                model: attemptError.model,
                upstreamStatus: attemptError.httpStatus,
                upstreamBody: attemptError.upstreamBody,
              },
              attemptError.classified.likelyCause,
            );
            return;
          }
        }
        if (!attempt) return; // unreachable — the loop only exits once attempt is set

        // --- Capture raw (before suppression) — free, no model call. ---
        const rawSegments = normalizeSegments(attempt.segments);
        if (rawSegments.length === 0) {
          throw new Error('Transcription returned no speech segments.');
        }
        const rawText = buildTranscriptText(rawSegments);
        appendDebugEvent(debugLog, { kind: 'raw-captured', segmentCount: rawSegments.length });

        const fallbackNotice = attempt.warnings.find((w) => w.startsWith('Diarized model unavailable')) ?? null;
        setState((s) => ({ ...s, mode: attempt!.mode, primaryError: fallbackNotice, rawSegments, rawText }));

        if (skipCleanup) {
          // --- Skip the Gemini cleanup pass: return the raw transcript with a
          // manual cleanup prompt prepended, for pasting into a browser AI chat. ---
          setState((s) => ({ ...s, status: 'building', cleanupSkipped: true }));
          const promptHeader = buildManualCleanupPrompt({
            speakerNames,
            contextNotes,
            mode: attempt.mode,
            argumentTagging: settings.argumentTagging,
          });
          const rawTextWithPrompt = `${promptHeader}\n${rawText}`;

          setState((s) => ({
            ...s,
            status: 'complete',
            rawText: rawTextWithPrompt,
            cleanedText: null,
            warning: runWarnings.length > 0 ? runWarnings.join(' ') : null,
            correctionFailedChunks: 0,
            correctionTotalChunks: 0,
            cleanupSkipped: true,
            debugJson: settings.debugMode === 'always' ? buildDebugJson(debugLog) : null,
          }));
          return;
        }

        // --- Suppress hallucinated filler (if enabled); raw above already captured everything. ---
        setState((s) => ({ ...s, status: 'correcting' }));
        let segmentsForCleanup = rawSegments;
        let boundaryTimes: number[] = [];

        if (settings.suppressionEnabled) {
          const suppressed = suppressArtifacts(rawSegments, settings.suppressionSensitivity);
          segmentsForCleanup = suppressed.segments;
          boundaryTimes = suppressed.report.boundaryTimes;
          if (suppressed.report.removed.length > 0) {
            appendDebugEvent(debugLog, {
              kind: 'suppression',
              sensitivity: settings.suppressionSensitivity,
              groupsRemoved: suppressed.report.removed.length,
              segmentsRemoved: suppressed.report.removed.reduce((sum, r) => sum + r.count, 0),
            });
          }
          setState((s) => ({ ...s, suppressionReport: suppressed.report }));
        }

        // `tagged` is true only for the call after a real cleanup pass that
        // actually had settings.argumentTagging on — the two early-exit
        // calls below (nothing to clean up / cleanup disabled) never ran the
        // Gemini pass at all, so tagSummary/argumentRelevantText stay null
        // for them regardless of the setting (no separate AI pass, per the
        // "no extra AI pass" rule — there's nothing to derive tags from).
        const finalizeComplete = (
          cleanedSegments: TaggedTranscriptSegment[],
          warning: string | null,
          failedChunks: number,
          totalChunks: number,
          tagged: boolean,
        ) => {
          setState((s) => ({ ...s, status: 'building' }));
          let turnBlocks: TurnBlock[];
          let cleanedText: string;
          if (settings.mergeTurnsEnabled) {
            turnBlocks = mergeTurns(cleanedSegments, { maxGapSeconds: settings.mergeGapSeconds, boundaryTimes });
            cleanedText = formatCleanTranscript(turnBlocks);
          } else {
            // Merging is a display/export transform only — with it disabled,
            // still shape a 1:1 TurnBlock per segment so the cleaned view stays uniform.
            turnBlocks = cleanedSegments.map((seg) => ({
              start: seg.start,
              end: seg.end,
              speaker: seg.speaker,
              text: seg.text,
              segmentCount: 1,
              ...(seg.tag ? { tag: seg.tag } : {}),
            }));
            cleanedText = buildTranscriptText(cleanedSegments);
          }

          const tagSummary = tagged ? buildTagSummary(cleanedSegments) : null;
          const argumentRelevantText = tagged ? formatArgumentRelevantTranscript(turnBlocks) : null;
          if (tagged && tagSummary) {
            appendDebugEvent(debugLog, { kind: 'argument-tagging', tagSummary });
          }

          // Merge the provider-attempt-level warnings (rejected/unloadable
          // speaker reference clips) with this run's cleanup warning, if any
          // — both are surfaced through the same TranscriberState.warning.
          const combinedWarning = [...runWarnings, warning].filter((w): w is string => !!w).join(' ') || null;

          setState((s) => ({
            ...s,
            status: 'complete',
            cleanedSegments,
            turnBlocks,
            cleanedText,
            tagSummary,
            argumentRelevantText,
            warning: combinedWarning,
            correctionFailedChunks: failedChunks,
            correctionTotalChunks: totalChunks,
            debugJson: settings.debugMode === 'always' ? buildDebugJson(debugLog) : null,
          }));
        };

        if (segmentsForCleanup.length === 0) {
          // Suppression removed everything (pathological/tiny input) — nothing left to clean up.
          finalizeComplete([], null, 0, 0, false);
          return;
        }

        if (!settings.cleanupEnabled) {
          finalizeComplete(segmentsForCleanup, null, 0, 0, false);
          return;
        }

        // --- Cleanup (chunked, overlapping Gemini pass), parameterized by settings ---
        const totalDuration = Math.max(...segmentsForCleanup.map((s) => s.end));
        const windows = createChunkWindows(totalDuration, {
          chunkSeconds: settings.cleanupChunkSeconds,
          overlapSeconds: settings.cleanupOverlapSeconds,
        });

        const chunkResults: ChunkResult[] = [];
        let correctionFailedChunks = 0;
        let lastChunkFailure: { status: number; json: JsonRecord } | null = null;

        for (let i = 0; i < windows.length; i++) {
          const window: ChunkWindowBounds = windows[i];
          setState((s) => ({ ...s, chunkProgress: { current: i + 1, total: windows.length } }));

          const windowSegments = segmentsInWindow(segmentsForCleanup, window);
          if (windowSegments.length === 0) {
            chunkResults.push({ window, segments: [] });
            continue;
          }

          const idToken = await user.getIdToken();
          const { status: correctStatus, json: correctData } = await postJson(
            '/api/transcriber/correct',
            {
              segments: windowSegments,
              speakerNames,
              contextNotes,
              mode: attempt.mode,
              model: settings.cleanupModel,
              // When argument tagging is off, nothing extra is sent to the
              // route at all — it keeps using its own CORRECTION_TEMPERATURE
              // default, unchanged from pre-Phase-5 behavior.
              ...(settings.argumentTagging ? { argumentTagging: true, temperature: settings.cleanupTemperature } : {}),
            },
            idToken,
          );
          const correctResult = correctData as CorrectApiResponse;

          if (correctStatus < 200 || correctStatus >= 300) {
            correctionFailedChunks += 1;
            lastChunkFailure = { status: correctStatus, json: correctData };

            if (strictMode) break; // strict mode: the first chunk failure ends the cleanup pass entirely (see cleanupEntirelyFailed below)

            // Don't lose the chunk — keep the uncorrected segments and surface a warning at the end.
            chunkResults.push({ window, segments: windowSegments });
            continue;
          }
          chunkResults.push({ window, segments: correctResult.segments });
        }

        const cleanupEntirelyFailed =
          windows.length > 0 && (correctionFailedChunks === windows.length || (strictMode && correctionFailedChunks > 0));

        if (cleanupEntirelyFailed) {
          // Cleanup failed outright (or strict mode aborted on the first
          // failure) — raw is already captured above and stays downloadable;
          // the ErrorRecoveryPanel offers completeWithRawOnly() from here.
          const bodyText = sanitizeUpstreamError(lastChunkFailure?.json?.error ?? 'Cleanup pass failed.');
          const httpStatus = lastChunkFailure?.status ?? null;
          const classified = classifyTranscriptionError({
            httpStatus,
            bodyText,
            provider: null,
            stage: 'cleanup',
            fileName: file.name,
            fileSizeBytes: file.size,
            browserMime: file.type,
          });
          appendDebugEvent(debugLog, {
            kind: 'error',
            category: classified.category,
            stage: 'cleanup',
            provider: null,
            upstreamStatus: httpStatus,
            upstreamBody: bodyText,
          });
          setState((s) => ({
            ...s,
            status: 'failed',
            error: 'The cleanup pass failed. Your raw transcript is still available below.',
            recovery: {
              classified,
              fileName: file.name,
              fileSizeBytes: file.size,
              browserMime: file.type || 'unknown',
              provider: null,
              model: settings.cleanupModel,
              upstreamStatus: httpStatus,
              upstreamBody: bodyText,
            },
            debugJson: buildDebugJson(debugLog),
          }));
          return;
        }

        const cleanedSegments = stitchChunkResults(chunkResults);
        const warning = buildCorrectionWarning({ failedChunks: correctionFailedChunks, totalChunks: windows.length });
        if (warning) {
          appendDebugEvent(debugLog, {
            kind: 'cleanup-warning',
            failedChunks: correctionFailedChunks,
            totalChunks: windows.length,
          });
        }

        finalizeComplete(cleanedSegments, warning, correctionFailedChunks, windows.length, settings.argumentTagging);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong.';
        setState((s) => ({
          ...s,
          status: 'failed',
          error: message,
          recovery: {
            classified: {
              category: 'unknown',
              likelyCause: message,
              recommendedAction: 'Fix the issue above and try again.',
              retryProviders: [],
              suggestsConversion: false,
            },
            fileName: file.name,
            fileSizeBytes: file.size,
            browserMime: file.type || 'unknown',
            provider: null,
            model: null,
            upstreamStatus: null,
            upstreamBody: '',
          },
          // Every failure serializes the debug log — see runDebug.ts's file
          // header; debugMode === 'always' only affects the SUCCESS paths above.
          debugJson: buildDebugJson(debugLog),
        }));
      } finally {
        stopTimer();
      }
    },
    [startTimer, stopTimer],
  );

  const run = useCallback((opts: TranscriberRunOptions) => performRun(opts), [performRun]);

  /** Re-runs the last submitted file with a specific provider (all three —
   * both OpenAI providers and Gemini — are real, runnable choices). An
   * explicit retry never allows the server-side silent whisper fallback and
   * never triggers the auto-fallback queue itself — it's already a
   * deliberate single-provider choice from the ErrorRecoveryPanel/settings. */
  const retryWith = useCallback(
    (providerId: TranscriptionProviderId) => {
      const lastOptions = lastRunOptionsRef.current;
      if (!lastOptions) return;
      void performRun(lastOptions, providerId);
    },
    [performRun],
  );

  /** Moves a run that has a raw transcript (but no cleaned output — cleanup failed or was never run) to 'complete'. */
  const completeWithRawOnly = useCallback(() => {
    setState((s) => (s.rawText ? { ...s, status: 'complete', cleanedText: null, recovery: null, error: null } : s));
  }, []);

  const reset = useCallback(() => {
    stopTimer();
    lastRunOptionsRef.current = null;
    debugLogRef.current = null;
    setState(initialState);
  }, [stopTimer]);

  return { state, run, retryWith, completeWithRawOnly, reset };
}
