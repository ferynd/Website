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
import type { SuppressionSensitivity } from './suppressArtifacts';

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

export interface DebugLog {
  createdAt: number;
  file: DebugFileMeta;
  events: DebugEvent[];
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
  const errors = log.events.filter(isKind('error'));

  const lastProviderAttempt = providerAttempts[providerAttempts.length - 1] ?? null;
  const lastRawCaptured = rawCaptured[rawCaptured.length - 1] ?? null;
  const lastSpeakerReference = speakerReferenceEvents[speakerReferenceEvents.length - 1] ?? null;

  const summary = {
    file: log.file,
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
