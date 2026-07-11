// Pure debug-log accumulator for the Transcriber pipeline. A run's debug log
// lives in a ref inside useTranscriberPipeline.ts and is only ever
// serialized into visible state on failure or when settings.debugMode is
// 'always' — see the plan's "debug JSON" section. Every event here carries
// COUNTS AND LABELS ONLY: transcript text, audio, prompts, and keys must
// never appear in a debug event. Sanitized upstream error bodies (already
// redacted of secrets by sanitizeUpstreamError) are the only "free text"
// ever stored, and those come from provider error responses, never from
// transcript content.

import type { TranscriptionProviderId } from './providers/types';
import type { SpeakerReconcileReport } from './reconcileSpeakers';
import type { SpeakerQualityReport } from './speakerQuality';
import type { SuppressionSensitivity } from './suppressArtifacts';
import type { ArgumentTag, StageUsage } from './types';

export interface DebugFileMeta {
  name: string;
  sizeBytes: number;
  mimeType: string;
  durationSec?: number;
}

/**
 * Per-speaker outcome for one OpenAI diarized run's known-speaker
 * references (Phase 4) — 'attached' means this run's request included that
 * speaker's clip; `validationStatus` mirrors lib/clipAnalysis.ts's
 * ClipValidationStatus but is kept as a plain string here (not imported)
 * since debug events must stay JSON-serializable labels/counts only.
 */
export interface SpeakerReferenceEntry {
  name: string;
  attached: boolean;
  validationStatus: string;
}

/**
 * What informed speaker identity for this run: 'prompt-inferred' (Gemini,
 * no acoustic reference support), 'prompt-inferred+reference-clips
 * (experimental)' (Gemini with settings.geminiReferenceClips clips
 * attached), or one entry per configured speaker profile describing whether
 * that speaker's clip was attached (OpenAI diarized + settings.speakerClipsEnabled).
 */
export type SpeakerReferenceStatus =
  | 'prompt-inferred'
  | 'prompt-inferred+reference-clips (experimental)'
  | SpeakerReferenceEntry[];

export type DebugEvent =
  | { kind: 'provider-attempt'; at: number; provider: TranscriptionProviderId; model: string }
  | { kind: 'raw-captured'; at: number; segmentCount: number }
  | {
      kind: 'suppression';
      at: number;
      sensitivity: SuppressionSensitivity;
      groupsRemoved: number;
      segmentsRemoved: number;
    }
  | { kind: 'cleanup-warning'; at: number; failedChunks: number; totalChunks: number }
  | { kind: 'speaker-reference'; at: number; status: SpeakerReferenceStatus }
  | { kind: 'argument-tagging'; at: number; tagSummary: Record<ArgumentTag, number> }
  | {
      /** Recorded once per run that went through OpenAI's client-side
       * long-recording preprocessing/chunking path (lib/preprocessOpenAiAudio.ts)
       * — counts and durations only, mirroring TranscriptionAttempt's
       * `preprocessReport` field (lib/providers/types.ts). */
      kind: 'preprocess';
      at: number;
      originalDurationSec: number;
      keptDurationSec: number;
      silenceRemovedSec: number;
      speedFactor: number;
      finalDurationSec: number;
      chunkCount: number;
    }
  | {
      /** A retry/resume reused work saved from an earlier failed run:
       * previously transcribed chunks ('transcribe-chunks'), an entire
       * cached transcription ('transcription', reported as 1 of 1), or
       * previously corrected cleanup chunks ('cleanup-chunks'). Counts
       * only — never transcript text. */
      kind: 'resume';
      at: number;
      stage: 'transcribe-chunks' | 'transcription' | 'cleanup-chunks';
      reusedChunks: number;
      totalChunks: number;
    }
  | {
      /** The correct route's divergence guardrail (lib/correctionGuards.ts)
       * kept the original text for this many segments in one cleanup chunk
       * because the model's rewrite drifted too far in length to be a
       * plausible preservation-first correction. */
      kind: 'correction-guardrail';
      at: number;
      chunkIndex: number;
      revertedSegments: number;
    }
  | {
      /** The deterministic global reconciliation stage ran — counts only (lib/reconcileSpeakers.ts). */
      kind: 'reconciliation';
      at: number;
      report: SpeakerReconcileReport;
    }
  | {
      /** The speaker quality gate ran — counts/durations only (lib/speakerQuality.ts). */
      kind: 'quality';
      at: number;
      report: SpeakerQualityReport;
    }
  | {
      /** One targeted speaker-repair pass completed (lib/speakerRepair.ts) — sparse patch counts only. */
      kind: 'speaker-repair';
      at: number;
      model: string;
      batches: number;
      failedBatches: number;
      targets: number;
      applied: number;
      rejected: number;
      belowConfidence: number;
      escalation: boolean;
    }
  | {
      /** The argument-classification stage completed (lib/argumentClassify.ts) — id/tag counts only. */
      kind: 'classification';
      at: number;
      model: string;
      windows: number;
      failedWindows: number;
      blocks: number;
      missingBlocks: number;
      tagSummary: Record<ArgumentTag, number>;
    }
  | {
      /** Provider-reported token usage for one stage request — never invented; absent fields were not reported. */
      kind: 'usage';
      at: number;
      stage: 'transcribe' | 'speaker-repair' | 'correct' | 'classify';
      usage: StageUsage;
    }
  | {
      kind: 'error';
      at: number;
      category: string;
      stage: string;
      provider: TranscriptionProviderId | null;
      upstreamStatus: number | null;
      /** Already sanitized+truncated (lib/sanitizeUpstreamError.ts) — never a raw upstream body. */
      upstreamBody: string;
    };

/**
 * Text-free stage manifest for one run — set once (setDebugManifest) when
 * the run finishes (success or failure) and serialized at the top of the
 * debug JSON. Everything here is versions, counts, hashes, and safe settings
 * — NEVER transcript text, audio bytes, prompts, keys, or personal content.
 */
export interface StageManifest {
  pipelineSchemaVersion: number;
  mappingAlgorithmVersion: string;
  /** Build commit when the deployment exposes one (NEXT_PUBLIC_GIT_COMMIT); null otherwise. */
  gitCommit: string | null;
  /** Model used per stage; null when a stage didn't run. */
  models: {
    transcribe: { provider: TranscriptionProviderId; model: string } | null;
    speakerRepair: string | null;
    correction: string | null;
    classification: string | null;
  };
  /** Safe snapshot of the run's settings — booleans/numbers/model ids only. */
  settings: Record<string, boolean | number | string>;
  /** Expected/completed work per chunked stage; null when a stage didn't run. */
  chunks: {
    transcription: { expected: number; completed: number } | null;
    cleanup: { expected: number; completed: number } | null;
    classification: { expected: number; completed: number } | null;
  };
  /** Reference-clip attachment status: per-speaker attached flag + SHA-256 content hash. */
  referenceClips: { name: string; attached: boolean; sha256: string | null }[];
  quality: SpeakerQualityReport | null;
  /** Sparse patch counts per stage. */
  patches: {
    speakerRepairApplied: number;
    speakerRepairRejected: number;
    textPatchesApplied: number;
    textPatchesReverted: number;
    classificationsApplied: number;
  };
  /** Provider-reported usage entries, in stage order (never invented). */
  usage: { stage: string; usage: StageUsage }[];
  /** Providers attempted, in order (auto-fallback path). */
  fallbackPath: TranscriptionProviderId[];
  /** Symbolic warning codes for this run — never free text. */
  warningCodes: string[];
}

export interface DebugLog {
  createdAt: number;
  file: DebugFileMeta;
  events: DebugEvent[];
  manifest?: StageManifest;
}

/**
 * Plain `Omit<DebugEvent, 'at'>` does NOT distribute over the DebugEvent
 * union the way you'd want here — `keyof DebugEvent` collapses to only the
 * keys common to every variant (`kind`/`at`), so a naive Omit would erase
 * each variant's own fields (provider, model, category, ...). This
 * conditional-type form distributes the Omit across each union member
 * individually instead, preserving them.
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Value used when a run never appended a 'speaker-reference' event at all — e.g. Whisper (no speaker/diarization concept, so no reference status applies) or a run that failed before reaching the provider call. */
export const SPEAKER_REFERENCE_NOT_CONFIGURED = 'not-configured';

/** Starts a new, empty debug log for one pipeline run. */
export function createDebugLog(file: DebugFileMeta): DebugLog {
  return { createdAt: Date.now(), file: { ...file }, events: [] };
}

/**
 * Appends one event to the log (append-only — nothing is ever removed or
 * rewritten) and returns the same log object, so callers holding a ref can
 * chain calls without reassigning it.
 */
export function appendDebugEvent(log: DebugLog, event: DistributiveOmit<DebugEvent, 'at'>): DebugLog {
  log.events.push({ ...event, at: Date.now() } as DebugEvent);
  return log;
}

function isKind<K extends DebugEvent['kind']>(kind: K) {
  return (event: DebugEvent): event is Extract<DebugEvent, { kind: K }> => event.kind === kind;
}

/** Attaches the run's stage manifest (see StageManifest) — call once when the run finishes. */
export function setDebugManifest(log: DebugLog, manifest: StageManifest): DebugLog {
  log.manifest = manifest;
  return log;
}

/**
 * Serializes the accumulated log into the debug JSON shape: file metadata,
 * selected provider/model, the fallback path actually attempted, the raw
 * provider segment count, suppression/cleanup warnings, a speaker-reference
 * status placeholder, and sanitized errors — plus the raw ordered event
 * trail for full detail.
 */
export function buildDebugJson(log: DebugLog): string {
  const providerAttempts = log.events.filter(isKind('provider-attempt'));
  const rawCaptured = log.events.filter(isKind('raw-captured'));
  const suppression = log.events.filter(isKind('suppression'));
  const cleanupWarnings = log.events.filter(isKind('cleanup-warning'));
  const speakerReferenceEvents = log.events.filter(isKind('speaker-reference'));
  const argumentTaggingEvents = log.events.filter(isKind('argument-tagging'));
  const preprocessEvents = log.events.filter(isKind('preprocess'));
  const errors = log.events.filter(isKind('error'));

  const lastProviderAttempt = providerAttempts[providerAttempts.length - 1] ?? null;
  const lastRawCaptured = rawCaptured[rawCaptured.length - 1] ?? null;
  const lastSpeakerReference = speakerReferenceEvents[speakerReferenceEvents.length - 1] ?? null;
  const lastArgumentTagging = argumentTaggingEvents[argumentTaggingEvents.length - 1] ?? null;
  const lastPreprocess = preprocessEvents[preprocessEvents.length - 1] ?? null;

  const summary = {
    file: log.file,
    /** Text-free stage manifest (versions, models, counts, hashes) — null when the run never reached completion handling. */
    manifest: log.manifest ?? null,
    provider: {
      selected: lastProviderAttempt?.provider ?? null,
      model: lastProviderAttempt?.model ?? null,
      fallbackPath: providerAttempts.map((event) => event.provider),
    },
    rawSegmentCount: lastRawCaptured?.segmentCount ?? null,
    suppressionWarnings: suppression.map(({ sensitivity, groupsRemoved, segmentsRemoved }) => ({
      sensitivity,
      groupsRemoved,
      segmentsRemoved,
    })),
    cleanupWarnings: cleanupWarnings.map(({ failedChunks, totalChunks }) => ({ failedChunks, totalChunks })),
    speakerReferenceStatus: lastSpeakerReference?.status ?? SPEAKER_REFERENCE_NOT_CONFIGURED,
    /** Null when this run never tagged (settings.argumentTagging was off, cleanup didn't run, or cleanup produced no output) — see useTranscriberPipeline.ts's finalizeComplete. */
    argumentTagSummary: lastArgumentTagging?.tagSummary ?? null,
    /** Null unless this run's OpenAI attempt went through the client-side long-recording preprocessing/chunking path. */
    preprocess: lastPreprocess
      ? {
          originalDurationSec: lastPreprocess.originalDurationSec,
          keptDurationSec: lastPreprocess.keptDurationSec,
          silenceRemovedSec: lastPreprocess.silenceRemovedSec,
          speedFactor: lastPreprocess.speedFactor,
          finalDurationSec: lastPreprocess.finalDurationSec,
          chunkCount: lastPreprocess.chunkCount,
        }
      : null,
    errors: errors.map(({ category, stage, provider, upstreamStatus, upstreamBody }) => ({
      category,
      stage,
      provider,
      upstreamStatus,
      upstreamBody,
    })),
    events: log.events,
  };

  return JSON.stringify(summary, null, 2);
}
