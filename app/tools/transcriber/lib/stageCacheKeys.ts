// Pure stage-cache key builders — the single place that decides which
// settings/inputs invalidate which stage's cached work. The invariants:
//
//   - Every key chains the upstream identity (attempt key), so any upstream
//     change invalidates all downstream caches.
//   - A DOWNSTREAM setting never appears in an UPSTREAM key: changing the
//     argument classifier/expansion must not invalidate corrected text or
//     transcription; changing the cleanup model must not invalidate the
//     transcription or repair caches.
//   - Prompt/schema versions and the pipeline schema version participate, so
//     results produced by an older pipeline are never reused by a newer one.
//
// Relative imports here deliberately (see note at top of ./settings.ts) —
// this module is imported directly by vitest.

import {
  CLASSIFY_PROMPT_VERSION,
  CORRECTION_PROMPT_VERSION,
  MAPPING_ALGORITHM_VERSION,
  PIPELINE_SCHEMA_VERSION,
  SPEAKER_REPAIR_PROMPT_VERSION,
} from './constants';
import type { TranscriberSettings } from './settings';

export interface AttemptKeyParams {
  fileKey: string;
  providerId: string;
  model: string;
  settings: Pick<TranscriberSettings, 'openaiPreprocessing' | 'openaiSilenceRemoval' | 'openaiSpeedFactor'>;
  speakerNames: string[];
  speakerNotes: string[];
  /** SHA-256 content fingerprint of the attached reference clips ('off' when none). */
  clipsFingerprint: string;
  /** Context notes only key Gemini attempts (they enter its transcription prompt). */
  contextNotes: string;
}

/** Cache key for one transcription attempt — everything that can change its result participates. */
export function buildAttemptKey(params: AttemptKeyParams): string {
  const { settings } = params;
  return [
    params.fileKey,
    `schema:${PIPELINE_SCHEMA_VERSION}`,
    params.providerId,
    params.model,
    `pre:${settings.openaiPreprocessing ? 1 : 0}${settings.openaiSilenceRemoval ? 1 : 0}:${settings.openaiSpeedFactor}`,
    `names:${params.speakerNames.join(',')}`,
    `notes:${params.speakerNotes.join('|')}`,
    `clips:${params.clipsFingerprint}`,
    params.providerId === 'gemini' ? `ctx:${params.contextNotes}` : '',
  ].join('||');
}

export interface RepairKeyParams {
  attemptKey: string;
  contextNotes: string;
}

/** Base key for the targeted speaker-repair stage (the model + pass suffix are appended per pass). */
export function buildRepairKeyBase(params: RepairKeyParams): string {
  return [params.attemptKey, `repair:v${SPEAKER_REPAIR_PROMPT_VERSION}`, MAPPING_ALGORITHM_VERSION, `ctx:${params.contextNotes}`].join(
    '||',
  );
}

export interface CleanupKeyParams {
  attemptKey: string;
  settings: Pick<
    TranscriberSettings,
    | 'suppressionEnabled'
    | 'suppressionSensitivity'
    | 'cleanupModel'
    | 'cleanupTemperature'
    | 'cleanupChunkSeconds'
    | 'cleanupOverlapSeconds'
    | 'speakerRepairEnabled'
  >;
  /** Applied repair-patch count — repairs change the segments being corrected. */
  repairsApplied: number;
  contextNotes: string;
}

/** Cache key for the sparse text-correction stage. Argument-classification
 * settings deliberately do NOT participate — changing them never invalidates
 * corrected text. */
export function buildCleanupKey(params: CleanupKeyParams): string {
  const { settings } = params;
  return [
    params.attemptKey,
    `v:${PIPELINE_SCHEMA_VERSION}:${CORRECTION_PROMPT_VERSION}`,
    `sup:${settings.suppressionEnabled ? settings.suppressionSensitivity : 'off'}`,
    `clean:${settings.cleanupModel}:${settings.cleanupTemperature}:${settings.cleanupChunkSeconds}:${settings.cleanupOverlapSeconds}`,
    `repair:${settings.speakerRepairEnabled ? 1 : 0}:${params.repairsApplied}`,
    `ctx:${params.contextNotes}`,
  ].join('||');
}

export interface ClassifyKeyParams {
  attemptKey: string;
  settings: Pick<
    TranscriberSettings,
    | 'suppressionEnabled'
    | 'suppressionSensitivity'
    | 'cleanupEnabled'
    | 'cleanupModel'
    | 'cleanupChunkSeconds'
    | 'mergeTurnsEnabled'
    | 'mergeGapSeconds'
  >;
  repairsApplied: number;
  contextNotes: string;
}

/** Base key for the classification stage: chains everything that shaped the
 * turn blocks. The range-expansion setting deliberately does NOT participate
 * — changing it only reruns the pure range construction, never the model.
 * (The classifier model is appended by the caller per stage run.) */
export function buildClassifyKeyBase(params: ClassifyKeyParams): string {
  const { settings } = params;
  return [
    params.attemptKey,
    `v:${PIPELINE_SCHEMA_VERSION}`,
    `sup:${settings.suppressionEnabled ? settings.suppressionSensitivity : 'off'}`,
    `clean:${settings.cleanupEnabled ? `${settings.cleanupModel}:${settings.cleanupChunkSeconds}` : 'off'}`,
    `repair:${params.repairsApplied}`,
    `merge:${settings.mergeTurnsEnabled ? settings.mergeGapSeconds : 'off'}`,
    `ctx:${params.contextNotes}`,
  ].join('||');
}

/** The classification stage's full cache key: base + classifier model + prompt version. */
export function buildClassifyKey(base: string, classifierModel: string): string {
  return [base, classifierModel, `v${CLASSIFY_PROMPT_VERSION}`].join('||');
}
