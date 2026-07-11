'use client';

import { useCallback, useRef, useState } from 'react';
import { auth } from './lib/firebase';
import { probeAudioDuration } from './lib/audioDuration';
import {
  aggregateClassifications,
  applyBlockClassifications,
  buildClassifyUnits,
  buildClassifyWindows,
  windowToRequestBlocks,
} from './lib/argumentClassify';
import { buildTagSummary, formatArgumentRelevantTranscript } from './lib/argumentTags';
import { createChunkWindows, segmentsInWindow, type ChunkWindowBounds } from './lib/chunkTranscript';
import type { ClassifiedError } from './lib/classifyError';
import { classifyTranscriptionError } from './lib/classifyError';
import { mapWithConcurrency } from './lib/concurrency';
import {
  ACCEPTED_FILE_EXTENSIONS,
  FALLBACK_TRANSCRIBE_MODEL,
  MAPPING_ALGORITHM_VERSION,
  MAX_GEMINI_UPLOAD_BYTES,
  MAX_OPENAI_PREPROCESSED_UPLOAD_BYTES,
  MAX_OPENAI_UPLOAD_BYTES,
  PIPELINE_SCHEMA_VERSION,
  SPEAKER_REPAIR_APPLY_MIN_CONFIDENCE,
  SPEAKER_REPAIR_ESCALATION_MODEL,
} from './lib/constants';
import { sha256HexOfBlob } from './lib/contentHash';
import { buildCorrectionWarning } from './lib/correctionSummary';
import { buildManualCleanupPrompt } from './lib/buildManualCleanupPrompt';
import { formatCleanTranscript } from './lib/formatCleanTranscript';
import { buildTranscriptText, normalizeSegments } from './lib/formatTranscript';
import { mergeTurns } from './lib/mergeTurns';
import { transcribeWithGemini, type GeminiWindowCache } from './lib/providers/geminiProvider';
import {
  transcribeWithOpenAi,
  type OneRequestResult,
  type TranscribeChunkCache,
} from './lib/providers/openaiProvider';
import type {
  SpeakerReferenceClip,
  TranscriptionAttempt,
  TranscriptionAttemptError,
  TranscriptionProviderId,
} from './lib/providers/types';
import { reconcileSpeakers } from './lib/reconcileSpeakers';
import { ensureSegmentIds } from './lib/segmentProvenance';
import {
  buildAttemptKey,
  buildClassifyKey,
  buildClassifyKeyBase,
  buildCleanupKey,
  buildRepairKeyBase,
} from './lib/stageCacheKeys';
import {
  appendDebugEvent,
  buildDebugJson,
  createDebugLog,
  setDebugManifest,
  type DebugLog,
  type SpeakerReferenceEntry,
  type StageManifest,
} from './lib/runDebug';
import { sanitizeUpstreamError } from './lib/sanitizeUpstreamError';
import { readTranscriberSettings, type TranscriberSettings } from './lib/settings';
import { analyzeSpeakerQuality, buildQualityWarning, type SpeakerQualityReport } from './lib/speakerQuality';
import { applySpeakerRepairPatches, buildRepairBatches } from './lib/speakerRepair';
import { stitchChunkResults, type ChunkResult } from './lib/stitchTranscript';
import { suppressArtifacts } from './lib/suppressArtifacts';
import type {
  ArgumentTag,
  BlockClassification,
  ClassifyApiResponse,
  CorrectApiResponse,
  PipelineStatus,
  SpeakerRepairApiResponse,
  SpeakerRepairPatch,
  StageUsage,
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

/** What a Resume (re-running the same file with the same provider and
 * parameters) can skip: work saved from the failed run in the per-run
 * caches. `stage: 'transcribe'` means completed transcription chunks are
 * saved; `stage: 'cleanup'` means the ENTIRE transcription is saved (a
 * resume skips it outright) plus `completedChunks` corrected cleanup
 * chunks. */
export interface ResumeInfo {
  stage: 'transcribe' | 'cleanup';
  completedChunks: number;
  totalChunks: number;
}

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
  /** Set when part of this run's work is already saved and a Resume would reuse it — see ResumeInfo. */
  resume?: ResumeInfo | null;
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
  /** Zero-filled per-ArgumentTag counts over turn blocks (lib/argumentTags.ts's buildTagSummary) — null unless this run's separate classification stage ran and succeeded. */
  tagSummary: Record<ArgumentTag, number> | null;
  /** The argument-relevant filtered transcript (lib/argumentTags.ts's formatArgumentRelevantTranscript) — same null conditions as tagSummary. */
  argumentRelevantText: string | null;
  /** Text-free speaker-quality metrics for this run (lib/speakerQuality.ts) — null until the quality gate has run. */
  qualityReport: SpeakerQualityReport | null;
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
  qualityReport: null,
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

/** Thrown by a cleanup-chunk worker so the settled-results aggregation can
 * fall back to that window's uncorrected segments. `status: null` means the
 * request itself failed (network), not that the route returned an error. */
interface CleanupChunkFailure {
  status: number | null;
  json: JsonRecord;
}

/** Settings snapshot for the debug manifest — every field is a boolean,
 * number, or model/provider id (fallbackOrder joins to one string). Nothing
 * personal: notes and context text never live in settings. */
function buildSafeSettingsSnapshot(settings: TranscriberSettings): Record<string, boolean | number | string> {
  const { fallbackOrder, ...rest } = settings;
  return { ...rest, fallbackOrder: fallbackOrder.join(',') };
}

/* ------------------------------------------------------------ */
/* Resume caches: per-run saved work reused by an explicit retry */
/* ------------------------------------------------------------ */

/** File identity for cache keys — name + size + lastModified is enough to
 * tell "the same recording the user just submitted" apart from a different
 * file without hashing its contents. */
function buildFileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/** Completed transcription chunks from a failed OpenAI chunked run — only
 * valid for an identical chunk plan, hence the stored `chunkCount` (see
 * lib/providers/openaiProvider.ts's TranscribeChunkCache contract). */
interface TranscribeChunkCacheState {
  key: string;
  chunkCount: number | null;
  results: Map<number, OneRequestResult>;
}

/** Completed transcription windows from a failed Gemini windowed run —
 * the Gemini-side counterpart of TranscribeChunkCacheState (see
 * lib/providers/geminiProvider.ts's GeminiWindowCache contract). */
interface GeminiWindowCacheState {
  key: string;
  windowCount: number | null;
  results: Map<number, TranscriptSegment[]>;
}

/** A fully successful transcription (any provider) kept so a retry after a
 * cleanup failure never re-transcribes the audio at all. */
interface AttemptCacheState {
  key: string;
  attempt: TranscriptionAttempt;
}

/** Successful cleanup-chunk TEXT PATCHES (segment id -> corrected text),
 * keyed by window index. Deliberately NOT whole segments: speakers can
 * legitimately differ between runs with the same cleanup key (the repair
 * stage is a model call), so a cache hit re-applies the text patches to the
 * CURRENT run's freshly-computed window segments — cached text, never
 * cached speakers. */
interface CleanupChunkCacheState {
  key: string;
  windowCount: number;
  results: Map<number, Map<string, string>>;
}

/** Successful speaker-repair batch responses. One cache object per upstream
 * identity (repair key base); entries are keyed
 * `<model>:<pass>:<batchCount>#<batchIndex>`, so the base and escalation
 * passes coexist instead of evicting each other on a retry. Independent of
 * the cleanup and classification caches: repairing speakers never
 * invalidates corrected text or classifications, and vice versa. */
interface SpeakerRepairCacheState {
  key: string;
  results: Map<string, SpeakerRepairPatch[]>;
}

/** Successful classification-window responses, keyed by window index.
 * Deliberately EXCLUDES the range-expansion setting from its key — changing
 * the expansion only reruns the pure range construction, never the model. */
interface ClassifyCacheState {
  key: string;
  windowCount: number;
  results: Map<number, BlockClassification[]>;
}

/** What the last completed run's classification stage needs to rerun on its
 * own (reclassify()) without touching transcription or cleanup: the
 * UNTAGGED turn blocks, that run's context notes, and the cache key base
 * that identifies the upstream state those blocks came from. */
interface ClassificationInput {
  blocks: TurnBlock[];
  contextNotes: string;
  cacheKeyBase: string;
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
  /** The provider the most recent run last attempted — resume() re-runs it so the caches below stay applicable. */
  const lastProviderRef = useRef<TranscriptionProviderId | null>(null);
  // Resume caches (see the cache-state interfaces above). Writes happen on
  // every run; READS only happen on an explicit retry/resume — a fresh run
  // always starts clean so re-submitting a file never silently serves stale
  // results. reset() clears all of them.
  const transcribeChunkCacheRef = useRef<TranscribeChunkCacheState | null>(null);
  const geminiWindowCacheRef = useRef<GeminiWindowCacheState | null>(null);
  const attemptCacheRef = useRef<AttemptCacheState | null>(null);
  const cleanupCacheRef = useRef<CleanupChunkCacheState | null>(null);
  const speakerRepairCacheRef = useRef<SpeakerRepairCacheState | null>(null);
  const classifyCacheRef = useRef<ClassifyCacheState | null>(null);
  /** The last completed run's untagged blocks — reclassify() reruns ONLY the
   * classification stage from these (never transcription or cleanup). */
  const classificationInputRef = useRef<ClassificationInput | null>(null);

  const startTimer = useCallback(() => {
    startRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setState((s) => ({ ...s, elapsedMs: Date.now() - startRef.current }));
    }, 1000);
  }, []);

  /**
   * Runs the standalone argument-classification stage over turn blocks:
   * contextual overlapping windows, id/tag/confidence responses only,
   * per-window caching, deterministic aggregation + coverage validation.
   * Returns null when classification failed entirely (every window failed)
   * — the caller degrades to untagged output; the cleaned transcript is
   * never invalidated. Shared by performRun and reclassify().
   */
  const runClassificationStage = useCallback(
    async (params: {
      blocks: TurnBlock[];
      contextNotes: string;
      settings: TranscriberSettings;
      cacheKeyBase: string;
      allowCacheRead: boolean;
      onUsage?: (usage: StageUsage) => void;
    }): Promise<{
      blocks: TurnBlock[];
      tagSummary: Record<ArgumentTag, number>;
      expectedWindows: number;
      completedWindows: number;
      missingBlocks: number;
      classifiedBlocks: number;
    } | null> => {
      const user = auth.currentUser;
      if (!user) return null;

      const units = buildClassifyUnits(params.blocks);
      const windows = buildClassifyWindows(units);
      if (windows.length === 0) return null;

      const cacheKey = buildClassifyKey(params.cacheKeyBase, params.settings.argumentClassifierModel);
      if (
        !params.allowCacheRead ||
        classifyCacheRef.current?.key !== cacheKey ||
        classifyCacheRef.current?.windowCount !== windows.length
      ) {
        classifyCacheRef.current = { key: cacheKey, windowCount: windows.length, results: new Map() };
      }
      const cache = classifyCacheRef.current;

      const settled = await mapWithConcurrency(windows, 3, async (window): Promise<BlockClassification[]> => {
        const cached = cache.results.get(window.index);
        if (cached) return cached;
        const idToken = await user.getIdToken();
        const response = await postJson(
          '/api/transcriber/classify',
          {
            blocks: windowToRequestBlocks(window),
            contextNotes: params.contextNotes,
            model: params.settings.argumentClassifierModel,
          },
          idToken,
        );
        if (response.status < 200 || response.status >= 300) {
          throw new Error(typeof response.json.error === 'string' ? response.json.error : 'Classification failed.');
        }
        const result = response.json as ClassifyApiResponse;
        if (result.usage) params.onUsage?.(result.usage);
        const votes = Array.isArray(result.classifications) ? result.classifications : [];
        cache.results.set(window.index, votes);
        return votes;
      });

      const votesPerWindow: BlockClassification[][] = [];
      let completedWindows = 0;
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          votesPerWindow.push(result.value);
          completedWindows += 1;
        }
      }
      if (completedWindows === 0) return null;

      const aggregated = aggregateClassifications(units, votesPerWindow);
      const tagged = applyBlockClassifications(params.blocks, aggregated);
      return {
        blocks: tagged,
        tagSummary: buildTagSummary(tagged),
        expectedWindows: windows.length,
        completedWindows,
        missingBlocks: aggregated.missingBlockIds.length,
        classifiedBlocks: aggregated.byBlockId.size,
      };
    },
    [],
  );

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

      // Provider-reported token usage per stage (never invented — see
      // StageUsage) and sparse patch counts, accumulated for the debug
      // manifest.
      const usageEntries: { stage: string; usage: StageUsage }[] = [];
      const recordUsage = (stage: 'transcribe' | 'speaker-repair' | 'correct' | 'classify', usage?: StageUsage) => {
        if (!usage) return;
        usageEntries.push({ stage, usage });
        appendDebugEvent(debugLog, { kind: 'usage', stage, usage });
      };
      const patchCounts = {
        speakerRepairApplied: 0,
        speakerRepairRejected: 0,
        textPatchesApplied: 0,
        textPatchesReverted: 0,
        classificationsApplied: 0,
      };

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

        // A fresh submission (anything that isn't an explicit retry/resume)
        // starts from a clean slate: the resume caches only ever hold work
        // from the run the user is actively retrying — never an older run's
        // results that a later mid-run failure could otherwise make
        // reachable again through the next Retry click.
        if (!isExplicitRetry) {
          transcribeChunkCacheRef.current = null;
          geminiWindowCacheRef.current = null;
          attemptCacheRef.current = null;
          cleanupCacheRef.current = null;
          speakerRepairCacheRef.current = null;
          classifyCacheRef.current = null;
        }

        // Provider-aware size cap: Gemini's Files API accepts much larger
        // uploads than OpenAI's direct multipart endpoint (see
        // MAX_GEMINI_UPLOAD_BYTES / MAX_OPENAI_UPLOAD_BYTES in
        // lib/constants.ts). Checked against the provider this run starts
        // with — an auto-fallback hop later in the loop below doesn't
        // re-check this, matching the equivalent pre-run check UploadPanel
        // already shows. When settings.openaiPreprocessing is on, an OpenAI
        // run's cap widens to MAX_OPENAI_PREPROCESSED_UPLOAD_BYTES — the
        // ORIGINAL file is decoded/chunked entirely client-side and never
        // itself uploaded to our server in that path (see
        // lib/providers/openaiProvider.ts).
        const maxUploadBytes =
          providerId === 'gemini'
            ? MAX_GEMINI_UPLOAD_BYTES
            : settings.openaiPreprocessing
              ? MAX_OPENAI_PREPROCESSED_UPLOAD_BYTES
              : MAX_OPENAI_UPLOAD_BYTES;
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
        /** Cache key of the most recent attempt — everything that can change its transcription result participates (file identity, provider, model, preprocessing parameters, speaker names/notes, attached reference-clip fingerprint; context notes only affect the Gemini transcription prompt, so they only key Gemini attempts). */
        let currentAttemptKey: string | null = null;
        // Warnings that aren't tied to a single cleanup chunk (e.g. a
        // rejected or unloadable set of speaker reference clips) —
        // accumulated across the provider-attempt loop below and merged into
        // the final `warning` state alongside any cleanup warning.
        const runWarnings: string[] = [];
        // Symbolic (text-free) warning codes for the debug manifest.
        const warningCodes: string[] = [];
        const addWarningCode = (code: string) => {
          if (!warningCodes.includes(code)) warningCodes.push(code);
        };
        // SHA-256 content hashes of the reference clips attached to the
        // FINAL attempt — recorded in the debug manifest.
        let referenceClipHashes: { name: string; sha256: string }[] = [];

        /** Assembles the text-free stage manifest (lib/runDebug.ts's
         * StageManifest) from everything this run accumulated — versions,
         * models, counts, hashes, and a safe settings snapshot. Never
         * transcript text, prompts, audio, or personal notes. */
        const buildManifest = (params: {
          attempt: TranscriptionAttempt | null;
          quality: SpeakerQualityReport | null;
          repairModel: string | null;
          correctionRan: boolean;
          classificationModel: string | null;
          cleanupChunks: { expected: number; completed: number } | null;
          classificationChunks: { expected: number; completed: number } | null;
        }): StageManifest => ({
          pipelineSchemaVersion: PIPELINE_SCHEMA_VERSION,
          mappingAlgorithmVersion: MAPPING_ALGORITHM_VERSION,
          gitCommit: process.env.NEXT_PUBLIC_GIT_COMMIT ?? null,
          models: {
            transcribe: params.attempt ? { provider: params.attempt.provider, model: params.attempt.model } : null,
            speakerRepair: params.repairModel,
            correction: params.correctionRan ? settings.cleanupModel : null,
            classification: params.classificationModel,
          },
          settings: buildSafeSettingsSnapshot(settings),
          chunks: {
            transcription: params.attempt?.preprocessReport
              ? {
                  expected: params.attempt.preprocessReport.chunkCount,
                  completed: params.attempt.preprocessReport.chunkCount,
                }
              : null,
            cleanup: params.cleanupChunks,
            classification: params.classificationChunks,
          },
          referenceClips: speakerNames.map((name) => {
            const hit = referenceClipHashes.find((c) => c.name === name);
            return { name, attached: hit !== undefined, sha256: hit?.sha256 ?? null };
          }),
          quality: params.quality,
          patches: { ...patchCounts },
          usage: [...usageEntries],
          fallbackPath: [...attemptedProviders],
          warningCodes: [...warningCodes],
        });

        while (!attempt) {
          attemptedProviders.push(providerId);
          const model =
            providerId === 'gemini'
              ? settings.geminiTranscribeModel
              : providerId === 'openai-whisper'
                ? FALLBACK_TRANSCRIBE_MODEL
                : settings.openaiModel;
          // Resolve this attempt's speaker reference clips (IndexedDB or the
          // per-run fallback — see useSpeakerProfiles.ts's getRunClips(),
          // threaded through from page.tsx as opts.getSpeakerClips) — only
          // for the provider/settings combinations that can actually use
          // them. Resolved BEFORE the cache key below because clips are a
          // provider input: adding/replacing one must invalidate saved
          // chunks rather than let a retry reuse no-clips results. A load
          // failure degrades gracefully: the attempt continues with no
          // clips, a warning, and (below) a debug event instead of failing
          // the run.
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

          // The server-side silent whisper retry (backward-compat default)
          // is only allowed for a fresh run when auto-fallback is on — this
          // is the "default OFF -> failures surface in the recovery panel
          // instead of silently degrading" behavior. An explicit provider
          // retry never allows it either, since that's already a deliberate
          // single-provider choice. Also gates cached-result reuse below: a
          // chunk/attempt that silently degraded to Whisper must not be
          // resurrected by a retry that promises no silent fallback.
          const allowWhisperFallback = !isExplicitRetry && settings.autoFallback;

          // SHA-256 content hash per attached clip — changes whenever a
          // clip's AUDIO changes (re-recorded, re-trimmed), which the old
          // name+size fingerprint could miss. Clips are ~256 KB, so hashing
          // is effectively free; also recorded in the debug manifest.
          const clipHashes: { name: string; sha256: string }[] =
            wantsOpenAiClips || wantsGeminiReferences
              ? await Promise.all(
                  speakerClips.map(async (clip) => ({ name: clip.name, sha256: await sha256HexOfBlob(clip.blob) })),
                )
              : [];
          referenceClipHashes = clipHashes;
          const clipsFingerprint = clipHashes.length > 0 ? clipHashes.map((c) => `${c.name}:${c.sha256}`).join(',') : 'off';

          const attemptKey = buildAttemptKey({
            fileKey: buildFileKey(file),
            providerId,
            model,
            settings,
            speakerNames,
            speakerNotes: speakerNotes ?? [],
            clipsFingerprint,
            contextNotes,
          });
          currentAttemptKey = attemptKey;
          lastProviderRef.current = providerId;
          appendDebugEvent(debugLog, { kind: 'provider-attempt', provider: providerId, model });

          // On an explicit retry/resume with an identical key, the failed
          // run's fully successful transcription is reused outright — the
          // run skips straight past the provider call to the cleanup pass.
          // Exception: a diarized retry never reuses an attempt that
          // silently fell back to Whisper (mode 'fallback') — the retry's
          // whole point is a real diarized transcription.
          if (
            isExplicitRetry &&
            attemptCacheRef.current?.key === attemptKey &&
            !(attemptCacheRef.current.attempt.mode === 'fallback' && providerId === 'openai-diarized')
          ) {
            attempt = attemptCacheRef.current.attempt;
            appendDebugEvent(debugLog, { kind: 'resume', stage: 'transcription', reusedChunks: 1, totalChunks: 1 });
            setState((s) => ({ ...s, currentProvider: providerId }));
            continue;
          }

          setState((s) => ({ ...s, currentProvider: providerId, status: 'uploading', uploadProgress: 0 }));

          const idToken = await user.getIdToken();

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

              // Per-window resume cache for the windowed path — the Gemini
              // counterpart of the OpenAI chunk cache below: reused only on
              // an explicit retry with an identical key; hits counted for
              // the debug log.
              if (!isExplicitRetry || geminiWindowCacheRef.current?.key !== attemptKey) {
                geminiWindowCacheRef.current = { key: attemptKey, windowCount: null, results: new Map() };
              }
              const windowCacheState = geminiWindowCacheRef.current;
              let reusedGeminiWindows = 0;
              const windowCache: GeminiWindowCache = {
                get(windowCount, index) {
                  if (windowCacheState.windowCount !== windowCount) return undefined;
                  const cached = windowCacheState.results.get(index);
                  if (cached) reusedGeminiWindows += 1;
                  return cached;
                },
                set(windowCount, index, segments) {
                  if (windowCacheState.windowCount !== windowCount) {
                    windowCacheState.windowCount = windowCount;
                    windowCacheState.results.clear();
                  }
                  windowCacheState.results.set(index, segments);
                },
              };

              attempt = await transcribeWithGemini({
                file,
                durationSec,
                speakerNames,
                speakerNotes,
                contextNotes,
                model,
                references: geminiReferences,
                windowCache,
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
              if (reusedGeminiWindows > 0 && windowCacheState.windowCount) {
                appendDebugEvent(debugLog, {
                  kind: 'resume',
                  stage: 'transcribe-chunks',
                  reusedChunks: reusedGeminiWindows,
                  totalChunks: windowCacheState.windowCount,
                });
              }

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
              // Duration is only probed when preprocessing is enabled — it's
              // one more input (alongside file size) to decide whether this
              // run needs client-side chunking; a probe failure (null) just
              // means chunking falls back to deciding on size alone, unlike
              // Gemini where an unknown duration is fatal to the attempt.
              const openAiDurationSec = settings.openaiPreprocessing ? await probeAudioDuration(file) : null;

              // Per-chunk resume cache for the chunked path — reused only on
              // an explicit retry with an identical key; a fresh run (or a
              // key change) starts a new, empty cache. Hits are counted for
              // the debug log.
              if (!isExplicitRetry || transcribeChunkCacheRef.current?.key !== attemptKey) {
                transcribeChunkCacheRef.current = { key: attemptKey, chunkCount: null, results: new Map() };
              }
              const chunkCacheState = transcribeChunkCacheRef.current;
              let reusedTranscribeChunks = 0;
              const chunkCache: TranscribeChunkCache = {
                get(chunkCount, index) {
                  if (chunkCacheState.chunkCount !== chunkCount) return undefined;
                  const cached = chunkCacheState.results.get(index);
                  // A diarized-run chunk that silently degraded to Whisper is
                  // only reusable by a run that would allow that fallback
                  // itself — a no-fallback retry re-transcribes it diarized
                  // instead of resurrecting the degraded result. (An explicit
                  // openai-whisper run's chunks are 'fallback' by definition
                  // and stay reusable.)
                  if (cached && cached.mode === 'fallback' && providerId === 'openai-diarized' && !allowWhisperFallback) {
                    return undefined;
                  }
                  if (cached) reusedTranscribeChunks += 1;
                  return cached;
                },
                set(chunkCount, index, result) {
                  if (chunkCacheState.chunkCount !== chunkCount) {
                    chunkCacheState.chunkCount = chunkCount;
                    chunkCacheState.results.clear();
                  }
                  chunkCacheState.results.set(index, result);
                },
              };

              attempt = await transcribeWithOpenAi({
                file,
                speakerNames,
                model,
                // Computed above (with the clip fingerprint) — see the
                // comment there for why an explicit retry never allows the
                // server-side silent whisper retry.
                allowWhisperFallback,
                clips: wantsOpenAiClips ? speakerClips : undefined,
                durationSec: openAiDurationSec,
                preprocess: {
                  enabled: settings.openaiPreprocessing,
                  silenceRemoval: settings.openaiSilenceRemoval,
                  speedFactor: settings.openaiSpeedFactor,
                },
                chunkCache,
                parallelChunkRequests: settings.openaiParallelChunks,
                onPreparing: () => setState((s) => ({ ...s, status: 'processing', uploadProgress: null })),
                // Chunks run in parallel, so `current` is "chunks completed
                // so far", not a single in-flight chunk's position.
                onChunkProgress: (current, total) =>
                  setState((s) => ({ ...s, status: 'transcribing', chunkProgress: { current, total } })),
                idToken,
                onUploadProgress: (fraction) =>
                  setState((s) => ({ ...s, uploadProgress: fraction, status: fraction >= 1 ? 'transcribing' : 'uploading' })),
              });

              if (reusedTranscribeChunks > 0 && chunkCacheState.chunkCount) {
                appendDebugEvent(debugLog, {
                  kind: 'resume',
                  stage: 'transcribe-chunks',
                  reusedChunks: reusedTranscribeChunks,
                  totalChunks: chunkCacheState.chunkCount,
                });
              }

              if (attempt.preprocessReport) {
                appendDebugEvent(debugLog, {
                  kind: 'preprocess',
                  ...attempt.preprocessReport,
                });
              }

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

            // Chunks/windows that completed before this failure are saved in
            // their cache — surface that so the recovery panel can offer a
            // Resume that only redoes what failed. Only offered when the
            // cache belongs to THIS attempt's key (an auto-fallback hop to a
            // different provider starts a fresh cache).
            const failedChunkCache = transcribeChunkCacheRef.current;
            const failedWindowCache = geminiWindowCacheRef.current;
            let resume: ResumeInfo | null = null;
            if (
              failedChunkCache &&
              failedChunkCache.key === attemptKey &&
              failedChunkCache.chunkCount !== null &&
              failedChunkCache.results.size > 0
            ) {
              resume = {
                stage: 'transcribe',
                completedChunks: failedChunkCache.results.size,
                totalChunks: failedChunkCache.chunkCount,
              };
            } else if (
              failedWindowCache &&
              failedWindowCache.key === attemptKey &&
              failedWindowCache.windowCount !== null &&
              failedWindowCache.results.size > 0
            ) {
              resume = {
                stage: 'transcribe',
                completedChunks: failedWindowCache.results.size,
                totalChunks: failedWindowCache.windowCount,
              };
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
                resume,
              },
              attemptError.classified.likelyCause,
            );
            return;
          }
        }
        if (!attempt) return; // unreachable — the loop only exits once attempt is set

        // --- Capture raw (before suppression) — free, no model call. The raw
        // transcript preserves the provider's per-chunk mapping output as-is;
        // reconciliation/repair only ever affect the cleaned path. ---
        const rawSegments = ensureSegmentIds(normalizeSegments(attempt.segments));
        if (rawSegments.length === 0) {
          throw new Error('Transcription returned no speech segments.');
        }
        const rawText = buildTranscriptText(rawSegments);
        appendDebugEvent(debugLog, { kind: 'raw-captured', segmentCount: rawSegments.length });
        for (const usage of attempt.usage ?? []) recordUsage('transcribe', usage);

        // Transcription succeeded — save the whole attempt so a later
        // failure (e.g. in the cleanup pass) never forces re-transcribing
        // this file on retry, and drop the now-redundant per-chunk caches.
        if (currentAttemptKey) {
          attemptCacheRef.current = { key: currentAttemptKey, attempt };
          transcribeChunkCacheRef.current = null;
          geminiWindowCacheRef.current = null;
        }

        const fallbackNotice = attempt.warnings.find((w) => w.startsWith('Diarized model unavailable')) ?? null;
        setState((s) => ({ ...s, mode: attempt!.mode, primaryError: fallbackNotice, rawSegments, rawText }));

        // --- Deterministic global speaker reconciliation (pure, no model
        // call) — links chunk-local identities via overlap/continuity
        // evidence, demotes later-chunk positional guesses, and records
        // conflicts, BEFORE any language-model stage. ---
        const reconcileResult = reconcileSpeakers(rawSegments, {
          knownNames: speakerNames,
          overlapLinks: attempt.overlapLinks,
          speakerNotes,
        });
        appendDebugEvent(debugLog, { kind: 'reconciliation', report: reconcileResult.report });
        let workingSegments: TranscriptSegment[] = reconcileResult.segments;

        // --- Speaker quality gate (pure). ---
        let quality = analyzeSpeakerQuality(workingSegments, { knownNames: speakerNames });
        appendDebugEvent(debugLog, { kind: 'quality', report: quality });
        setState((s) => ({ ...s, qualityReport: quality }));

        if (skipCleanup) {
          // --- Skip every language-model pass: return the raw transcript
          // with a manual cleanup prompt prepended, for pasting into a
          // browser AI chat. ---
          setState((s) => ({ ...s, status: 'building', cleanupSkipped: true }));
          const promptHeader = buildManualCleanupPrompt({
            speakerNames,
            contextNotes,
            mode: attempt.mode,
            argumentTagging: settings.argumentTagging,
          });
          const rawTextWithPrompt = `${promptHeader}\n${rawText}`;

          setDebugManifest(
            debugLog,
            buildManifest({
              attempt,
              quality,
              repairModel: null,
              correctionRan: false,
              classificationModel: null,
              cleanupChunks: null,
              classificationChunks: null,
            }),
          );
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

        // --- Targeted speaker repair: only when the quality gate triggers,
        // only the unresolved/low-confidence segments (plus limited
        // context), sparse id->name patches back. Best-effort: any failure
        // leaves the transcript exactly as reconciliation produced it. ---
        let repairsApplied = 0;
        let repairModelUsed: string | null = null;
        if (settings.speakerRepairEnabled && quality.needsRepair) {
          setState((s) => ({ ...s, status: 'repairing' }));
          const repairKeyBase = buildRepairKeyBase({
            attemptKey: currentAttemptKey ?? buildFileKey(file),
            contextNotes,
          });
          // One cache object for BOTH passes — entries are pass-qualified, so
          // an explicit retry reuses the base and escalation batches alike.
          if (!isExplicitRetry || speakerRepairCacheRef.current?.key !== repairKeyBase) {
            speakerRepairCacheRef.current = { key: repairKeyBase, results: new Map() };
          }
          const repairCache = speakerRepairCacheRef.current;

          const runRepairPass = async (model: string, escalation: boolean): Promise<void> => {
            const batches = buildRepairBatches(workingSegments);
            if (batches.length === 0) return;
            const passKey = `${model}:${escalation ? 'esc' : 'base'}:${batches.length}`;

            const settledBatches = await mapWithConcurrency(batches, 2, async (batch, i): Promise<SpeakerRepairPatch[]> => {
              const cached = repairCache.results.get(`${passKey}#${i}`);
              if (cached) return cached;
              const idToken = await user.getIdToken();
              const response = await postJson(
                '/api/transcriber/speaker-repair',
                {
                  segments: batch.segments,
                  knownNames: speakerNames,
                  speakerNotes,
                  contextNotes,
                  model,
                },
                idToken,
              );
              if (response.status < 200 || response.status >= 300) {
                throw new Error(
                  typeof response.json.error === 'string' ? response.json.error : 'Speaker repair failed.',
                );
              }
              const result = response.json as SpeakerRepairApiResponse;
              recordUsage('speaker-repair', result.usage);
              const patches = Array.isArray(result.patches) ? result.patches : [];
              repairCache.results.set(`${passKey}#${i}`, patches);
              return patches;
            });

            let failedBatches = 0;
            const allPatches: SpeakerRepairPatch[] = [];
            for (const result of settledBatches) {
              if (result.status === 'fulfilled') allPatches.push(...result.value);
              else failedBatches += 1;
            }

            const targets = batches.reduce((sum, b) => sum + b.targetIds.length, 0);
            const applyResult = applySpeakerRepairPatches(workingSegments, allPatches, {
              knownNames: speakerNames,
              minConfidence: SPEAKER_REPAIR_APPLY_MIN_CONFIDENCE,
            });
            workingSegments = applyResult.segments;
            repairsApplied += applyResult.applied;
            patchCounts.speakerRepairApplied += applyResult.applied;
            patchCounts.speakerRepairRejected += applyResult.rejected;
            repairModelUsed = model;
            appendDebugEvent(debugLog, {
              kind: 'speaker-repair',
              model,
              batches: batches.length,
              failedBatches,
              targets,
              applied: applyResult.applied,
              rejected: applyResult.rejected,
              belowConfidence: applyResult.belowConfidence,
              escalation,
            });
            if (failedBatches > 0) addWarningCode('speaker-repair-batch-failed');
          };

          try {
            await runRepairPass(settings.speakerRepairModel, false);
            quality = analyzeSpeakerQuality(workingSegments, { knownNames: speakerNames, repairsApplied });
            // Escalate ONLY the still-unresolved segments to the stronger
            // Flash model, once, when the cheap pass wasn't enough.
            if (quality.needsRepair && SPEAKER_REPAIR_ESCALATION_MODEL !== settings.speakerRepairModel) {
              await runRepairPass(SPEAKER_REPAIR_ESCALATION_MODEL, true);
              quality = analyzeSpeakerQuality(workingSegments, { knownNames: speakerNames, repairsApplied });
            }
          } catch {
            // Repair is best-effort — a failure never invalidates the transcript.
            addWarningCode('speaker-repair-failed');
          }
          appendDebugEvent(debugLog, { kind: 'quality', report: quality });
          setState((s) => ({ ...s, qualityReport: quality }));
        }

        const qualityWarning = buildQualityWarning(quality);
        if (qualityWarning) {
          runWarnings.push(qualityWarning);
          addWarningCode('speaker-quality-low');
        }

        // --- Suppress hallucinated filler (if enabled); raw above already captured everything. ---
        setState((s) => ({ ...s, status: 'correcting' }));
        let segmentsForCleanup = workingSegments;
        let boundaryTimes: number[] = [];

        if (settings.suppressionEnabled) {
          const suppressed = suppressArtifacts(workingSegments, settings.suppressionSensitivity);
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

        // Builds turn blocks, runs the separate argument-classification
        // stage when enabled (id/tag responses only — a failure degrades to
        // untagged output, never invalidates the cleaned transcript),
        // attaches the stage manifest, and completes the run.
        const finalizeComplete = async (
          cleanedSegments: TaggedTranscriptSegment[],
          warning: string | null,
          failedChunks: number,
          totalChunks: number,
          correctionRan: boolean,
        ): Promise<void> => {
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
              ...(seg.id ? { id: seg.id, segmentIds: [seg.id] } : {}),
              start: seg.start,
              end: seg.end,
              speaker: seg.speaker,
              text: seg.text,
              segmentCount: 1,
              ...(seg.tag ? { tag: seg.tag } : {}),
            }));
            cleanedText = buildTranscriptText(cleanedSegments);
          }

          // Classification-stage cache key: chains the upstream identity
          // (attempt + suppression + cleanup + repair + merge parameters) so
          // any upstream change invalidates it, while argument-only settings
          // (expansion) stay OUT of it — changing those never reruns
          // transcription, cleanup, or classification. See lib/stageCacheKeys.ts.
          const classifyKeyBase = buildClassifyKeyBase({
            attemptKey: currentAttemptKey ?? buildFileKey(file),
            settings,
            repairsApplied,
            contextNotes,
          });
          classificationInputRef.current = { blocks: turnBlocks, contextNotes, cacheKeyBase: classifyKeyBase };

          let finalBlocks = turnBlocks;
          let tagSummary: Record<ArgumentTag, number> | null = null;
          let argumentRelevantText: string | null = null;
          let classificationModelUsed: string | null = null;
          let classificationChunks: { expected: number; completed: number } | null = null;

          if (settings.argumentTagging && turnBlocks.length > 0) {
            setState((s) => ({ ...s, status: 'classifying' }));
            const classified = await runClassificationStage({
              blocks: turnBlocks,
              contextNotes,
              settings,
              cacheKeyBase: classifyKeyBase,
              allowCacheRead: isExplicitRetry,
              onUsage: (usage) => recordUsage('classify', usage),
            });
            if (classified) {
              finalBlocks = classified.blocks;
              tagSummary = classified.tagSummary;
              argumentRelevantText = formatArgumentRelevantTranscript(finalBlocks, {
                expandSeconds: settings.argumentExpandSeconds,
              });
              classificationModelUsed = settings.argumentClassifierModel;
              classificationChunks = { expected: classified.expectedWindows, completed: classified.completedWindows };
              patchCounts.classificationsApplied += classified.classifiedBlocks;
              appendDebugEvent(debugLog, {
                kind: 'classification',
                model: settings.argumentClassifierModel,
                windows: classified.expectedWindows,
                failedWindows: classified.expectedWindows - classified.completedWindows,
                blocks: turnBlocks.length,
                missingBlocks: classified.missingBlocks,
                tagSummary,
              });
              if (classified.missingBlocks > 0) {
                runWarnings.push(
                  `Argument tagging covered ${turnBlocks.length - classified.missingBlocks} of ${turnBlocks.length} turns — uncovered turns default to "unclear".`,
                );
                addWarningCode('classification-coverage-gap');
              }
            } else {
              runWarnings.push('Argument classification failed — the cleaned transcript is unaffected, but tags are unavailable.');
              addWarningCode('classification-failed');
            }
          }

          // Merge the provider-attempt-level warnings (rejected/unloadable
          // speaker reference clips, quality gate) with this run's cleanup
          // warning, if any — both surface through TranscriberState.warning.
          const combinedWarning = [...runWarnings, warning].filter((w): w is string => !!w).join(' ') || null;

          setDebugManifest(
            debugLog,
            buildManifest({
              attempt,
              quality,
              repairModel: repairModelUsed,
              correctionRan,
              classificationModel: classificationModelUsed,
              cleanupChunks: correctionRan ? { expected: totalChunks, completed: totalChunks - failedChunks } : null,
              classificationChunks,
            }),
          );

          setState((s) => ({
            ...s,
            status: 'complete',
            cleanedSegments,
            turnBlocks: finalBlocks,
            cleanedText,
            tagSummary,
            argumentRelevantText,
            qualityReport: quality,
            warning: combinedWarning,
            correctionFailedChunks: failedChunks,
            correctionTotalChunks: totalChunks,
            debugJson: settings.debugMode === 'always' ? buildDebugJson(debugLog) : null,
          }));
        };

        if (segmentsForCleanup.length === 0) {
          // Suppression removed everything (pathological/tiny input) — nothing left to clean up.
          await finalizeComplete([], null, 0, 0, false);
          return;
        }

        if (!settings.cleanupEnabled) {
          await finalizeComplete(segmentsForCleanup, null, 0, 0, false);
          return;
        }

        // --- Cleanup (chunked, overlapping Gemini pass), parameterized by settings ---
        const totalDuration = Math.max(...segmentsForCleanup.map((s) => s.end));
        const windows = createChunkWindows(totalDuration, {
          chunkSeconds: settings.cleanupChunkSeconds,
          overlapSeconds: settings.cleanupOverlapSeconds,
        });

        // Successfully corrected chunks are cached (and reused on an
        // explicit retry with identical parameters) the same way completed
        // transcription chunks are — a cleanup failure never costs the
        // chunks that already corrected cleanly.
        // Argument-classification settings deliberately do NOT participate —
        // changing them must never invalidate corrected text. Repair output
        // (applied-patch count) does, since it changes the segments being
        // corrected. See lib/stageCacheKeys.ts for the invariants.
        const cleanupKey = buildCleanupKey({
          attemptKey: currentAttemptKey ?? buildFileKey(file),
          settings,
          repairsApplied,
          contextNotes,
        });
        if (
          !isExplicitRetry ||
          cleanupCacheRef.current?.key !== cleanupKey ||
          cleanupCacheRef.current?.windowCount !== windows.length
        ) {
          cleanupCacheRef.current = { key: cleanupKey, windowCount: windows.length, results: new Map() };
        }
        const cleanupCache = cleanupCacheRef.current;

        // `attempt` is a `let` the closure below can't narrow — snapshot the
        // mode (already known non-null here) for the per-window requests.
        const attemptMode = attempt.mode;
        let completedWindows = 0;
        let reusedCleanupChunks = 0;
        setState((s) => ({ ...s, chunkProgress: { current: 0, total: windows.length } }));

        // Windows run in parallel (bounded by settings.cleanupParallelChunks,
        // already clamped by the settings store). Strict mode stops NEW
        // windows from starting after the first failure; windows already in
        // flight finish (and cache their result), so even an aborted pass
        // saves completed work for a resume.
        /** Applies cached/fresh text patches to this run's CURRENT window
         * segments — cached text never resurrects a prior run's speakers. */
        const applyTextPatches = (
          windowSegments: TaggedTranscriptSegment[],
          patchTextById: Map<string, string>,
        ): TaggedTranscriptSegment[] =>
          windowSegments.map((seg) => {
            const text = seg.id !== undefined ? patchTextById.get(seg.id) : undefined;
            return text !== undefined ? { ...seg, text } : seg;
          });

        const settledWindows = await mapWithConcurrency(
          windows,
          settings.cleanupParallelChunks,
          async (window: ChunkWindowBounds): Promise<ChunkResult> => {
            try {
              const windowSegments = segmentsInWindow(segmentsForCleanup, window);
              if (windowSegments.length === 0) {
                return { window, segments: [] };
              }

              const cached = cleanupCache.results.get(window.index);
              if (cached) {
                reusedCleanupChunks += 1;
                return { window, segments: applyTextPatches(windowSegments, cached) };
              }

              let correctStatus: number;
              let correctData: JsonRecord;
              try {
                const idToken = await user.getIdToken();
                const response = await postJson(
                  '/api/transcriber/correct',
                  {
                    // Sparse-correction request: stable id + current
                    // speaker/text per segment; no more transcript context
                    // than this window (core + overlap) is ever sent.
                    segments: windowSegments.map((seg) => ({
                      id: seg.id!,
                      start: seg.start,
                      end: seg.end,
                      speaker: seg.speaker,
                      text: seg.text,
                    })),
                    speakerNames,
                    contextNotes,
                    mode: attemptMode,
                    model: settings.cleanupModel,
                    temperature: settings.cleanupTemperature,
                  },
                  idToken,
                );
                correctStatus = response.status;
                correctData = response.json;
              } catch (err) {
                const failure: CleanupChunkFailure = {
                  status: null,
                  json: { error: err instanceof Error ? err.message : 'Network error during the cleanup pass.' },
                };
                throw failure;
              }

              if (correctStatus < 200 || correctStatus >= 300) {
                const failure: CleanupChunkFailure = { status: correctStatus, json: correctData };
                throw failure;
              }

              const correctResult = correctData as CorrectApiResponse;
              recordUsage('correct', correctResult.usage);
              if (typeof correctResult.revertedPatches === 'number' && correctResult.revertedPatches > 0) {
                patchCounts.textPatchesReverted += correctResult.revertedPatches;
                appendDebugEvent(debugLog, {
                  kind: 'correction-guardrail',
                  chunkIndex: window.index,
                  revertedSegments: correctResult.revertedPatches,
                });
              }
              // Apply the sparse text patches locally — omitted segments are
              // unchanged by definition, and every provenance field survives
              // untouched. Only this window's segments can match (ids are
              // validated server-side against the request). The cache stores
              // the PATCHES, not the patched segments — see
              // CleanupChunkCacheState.
              const patchTextById = new Map((correctResult.patches ?? []).map((p) => [p.segmentId, p.text]));
              patchCounts.textPatchesApplied += patchTextById.size;
              cleanupCache.results.set(window.index, patchTextById);
              return { window, segments: applyTextPatches(windowSegments, patchTextById) };
            } finally {
              completedWindows += 1;
              const done = completedWindows;
              setState((s) => ({ ...s, chunkProgress: { current: done, total: windows.length } }));
            }
          },
          { stopOnError: strictMode },
        );

        if (reusedCleanupChunks > 0) {
          appendDebugEvent(debugLog, {
            kind: 'resume',
            stage: 'cleanup-chunks',
            reusedChunks: reusedCleanupChunks,
            totalChunks: windows.length,
          });
        }

        const chunkFailures = settledWindows
          .filter((result) => result.status === 'rejected')
          .map((result) => (result as { status: 'rejected'; reason: unknown }).reason as CleanupChunkFailure);
        const correctionFailedChunks = chunkFailures.length;
        const lastChunkFailure = chunkFailures.length > 0 ? chunkFailures[chunkFailures.length - 1] : null;

        const chunkResults: ChunkResult[] = settledWindows.map((result, i) =>
          result.status === 'fulfilled'
            ? result.value
            : // A failed window falls back to its uncorrected segments (the
              // pre-existing "don't lose the chunk" behavior); a skipped one
              // (strict mode stopped the pass) is treated the same way — in
              // strict mode the run fails below either way and raw stays
              // available.
              { window: windows[i], segments: segmentsInWindow(segmentsForCleanup, windows[i]) },
        );

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
          setDebugManifest(
            debugLog,
            buildManifest({
              attempt,
              quality,
              repairModel: repairModelUsed,
              correctionRan: true,
              classificationModel: null,
              cleanupChunks: { expected: windows.length, completed: cleanupCache.results.size },
              classificationChunks: null,
            }),
          );
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
              // The transcription itself is cached (see attemptCacheRef), so
              // a Resume skips straight to the cleanup pass and reuses any
              // chunks that corrected cleanly before the failure.
              resume: {
                stage: 'cleanup',
                completedChunks: cleanupCache.results.size,
                totalChunks: windows.length,
              },
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

        await finalizeComplete(cleanedSegments, warning, correctionFailedChunks, windows.length, true);
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
    [runClassificationStage, startTimer, stopTimer],
  );

  const run = useCallback((opts: TranscriberRunOptions) => performRun(opts), [performRun]);

  /** Re-runs the last submitted file with a specific provider (all three —
   * both OpenAI providers and Gemini — are real, runnable choices). An
   * explicit retry never allows the server-side silent whisper fallback and
   * never triggers the auto-fallback queue itself — it's already a
   * deliberate single-provider choice from the ErrorRecoveryPanel/settings.
   * When the chosen provider (and every other cache-key parameter) matches
   * the failed run, saved work — completed transcription chunks, the whole
   * transcription, corrected cleanup chunks — is reused automatically. */
  const retryWith = useCallback(
    (providerId: TranscriptionProviderId) => {
      const lastOptions = lastRunOptionsRef.current;
      if (!lastOptions) return;
      void performRun(lastOptions, providerId);
    },
    [performRun],
  );

  /** Re-runs the last submitted file with the SAME provider the failed run
   * last attempted, so every resume cache stays applicable — only the work
   * that actually failed is redone (see RecoveryInfo.resume). */
  const resume = useCallback(() => {
    const lastOptions = lastRunOptionsRef.current;
    const providerId = lastProviderRef.current;
    if (!lastOptions || !providerId) return;
    void performRun(lastOptions, providerId);
  }, [performRun]);

  /** Moves a run that has a raw transcript (but no cleaned output — cleanup failed or was never run) to 'complete'. */
  const completeWithRawOnly = useCallback(() => {
    setState((s) => (s.rawText ? { ...s, status: 'complete', cleanedText: null, recovery: null, error: null } : s));
  }, []);

  /**
   * Reruns ONLY the argument-classification stage (plus the pure range
   * construction) over the last completed run's turn blocks, with the
   * CURRENT settings — after changing the classifier model or range
   * expansion in Settings. Never re-transcribes or re-corrects anything:
   * an unchanged classifier model reuses the cached window classifications
   * outright, so an expansion-only change costs zero model calls.
   */
  const reclassify = useCallback(async () => {
    const input = classificationInputRef.current;
    if (!input || input.blocks.length === 0) return;
    const settings = readTranscriberSettings();

    setState((s) => ({ ...s, status: 'classifying' }));
    const classified = await runClassificationStage({
      blocks: input.blocks,
      contextNotes: input.contextNotes,
      settings,
      cacheKeyBase: input.cacheKeyBase,
      allowCacheRead: true,
    });

    if (!classified) {
      setState((s) => ({
        ...s,
        status: 'complete',
        warning: 'Argument classification failed — the cleaned transcript is unaffected, but tags are unavailable.',
      }));
      return;
    }

    const argumentRelevantText = formatArgumentRelevantTranscript(classified.blocks, {
      expandSeconds: settings.argumentExpandSeconds,
    });
    setState((s) => ({
      ...s,
      status: 'complete',
      turnBlocks: classified.blocks,
      tagSummary: classified.tagSummary,
      argumentRelevantText,
    }));
  }, [runClassificationStage]);

  const reset = useCallback(() => {
    stopTimer();
    lastRunOptionsRef.current = null;
    debugLogRef.current = null;
    lastProviderRef.current = null;
    transcribeChunkCacheRef.current = null;
    geminiWindowCacheRef.current = null;
    attemptCacheRef.current = null;
    cleanupCacheRef.current = null;
    speakerRepairCacheRef.current = null;
    classifyCacheRef.current = null;
    classificationInputRef.current = null;
    setState(initialState);
  }, [stopTimer]);

  return { state, run, retryWith, resume, completeWithRawOnly, reclassify, reset };
}
