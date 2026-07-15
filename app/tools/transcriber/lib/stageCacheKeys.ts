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

/* ------------------------------------------------------------ */
/* Canonical, deterministic content fingerprinting                */
/* ------------------------------------------------------------ */

/**
 * Deterministic, platform-compatible (synchronous, no WebCrypto) string hash
 * for cache-key fingerprints — FNV-1a, 32-bit, hex-encoded. This is a cache
 * key, not a security boundary: collision-resistance only needs to be "good
 * enough to distinguish different stage inputs" (it's also combined with
 * the rest of the key, e.g. the attempt key and settings), so a fast
 * non-cryptographic hash is the right tool — it avoids making every cache
 * key computation async the way lib/contentHash.ts's SHA-256 (used for
 * reference-clip identity, where the async cost is paid once per run) would.
 */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Canonical JSON serialization: object keys sorted recursively, so two
 * logically-equal inputs built in a different key order still fingerprint
 * identically. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Deterministic fingerprint of an arbitrary JSON-serializable value. */
export function fingerprint(value: unknown): string {
  return fnv1aHex(canonicalize(value));
}

/** One item's cache-relevant content: its stable id (position-based
 * fallback when absent), current display speaker, and current text — the
 * exact fields a downstream stage's OUTPUT can depend on. Used for both
 * segments (cleanup) and turn blocks (classification): the shape is
 * identical, so one fingerprint function covers both. */
export interface FingerprintableItem {
  id?: string;
  speaker: string;
  text: string;
}

/**
 * Fingerprints the ACTUAL content feeding a downstream stage — ids,
 * speakers, and text, in order — so two runs whose upstream stage (e.g.
 * speaker repair) produced a different result never share a cache entry
 * merely because they applied the same NUMBER of patches. This is the
 * "canonical serialization and a deterministic hash" the cleanup/
 * classification cache keys are built from instead of a bare patch count.
 */
export function fingerprintContent(items: FingerprintableItem[]): string {
  return fingerprint(items.map((item, i) => [item.id ?? `#${i}`, item.speaker, item.text]));
}

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
  /** Fingerprint (fingerprintContent) of the ACTUAL post-repair segments
   * feeding cleanup — ids, speakers, text. NOT a mere applied-patch count:
   * two repair outcomes with the same patch count but different
   * assignments/text must never collide on this key. */
  segmentsFingerprint: string;
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
    `repair:${settings.speakerRepairEnabled ? 1 : 0}:${params.segmentsFingerprint}`,
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
  /** Fingerprint (fingerprintContent) of the ACTUAL cleaned turn blocks
   * feeding classification — ids, speakers, text. NOT a mere applied-patch
   * count — see CleanupKeyParams.segmentsFingerprint for why. */
  blocksFingerprint: string;
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
    `content:${params.blocksFingerprint}`,
    `merge:${settings.mergeTurnsEnabled ? settings.mergeGapSeconds : 'off'}`,
    `ctx:${params.contextNotes}`,
  ].join('||');
}

/** The classification stage's full cache key: base + classifier model + prompt version. */
export function buildClassifyKey(base: string, classifierModel: string): string {
  return [base, classifierModel, `v${CLASSIFY_PROMPT_VERSION}`].join('||');
}
