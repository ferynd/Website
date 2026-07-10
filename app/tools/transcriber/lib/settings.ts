// Versioned Transcriber settings store — a single localStorage object that
// replaces the two ad-hoc per-model keys with one forward-compatible shape.
// `parseStoredSettings` is pure (never throws, per-field fallback to
// defaults) so it's fully unit-testable without touching localStorage; the
// `read/saveTranscriberSettings` wrappers below are the only browser-facing
// (SSR-safe) surface, following the try/catch pattern of
// `readStoredGeminiModel`/`saveStoredGeminiModel` in app/lib/aiModels.ts.
//
// Speaker profile metadata (name/notes) intentionally lives in a separate
// `transcriber_speaker_profiles_v1` key (added in a later phase) so that
// resetting these settings to defaults never deletes a user's profiles.

// Relative (not `@/`) imports here deliberately — vitest has no path-alias
// resolver configured in this repo, and this module needs to be runnable
// under `npm test`. See app/tools/shows/lib/titleResolver.ts for the same
// convention elsewhere in the codebase.
import { resolveGeminiModelId, type GeminiModelId } from '../../../lib/aiModels';
import { resolveTranscribeModelId, type TranscribeModelId } from '../../../lib/transcribeModels';
import {
  CLEANUP_PARALLEL_CHUNK_REQUESTS,
  CORRECTION_CHUNK_SECONDS,
  CORRECTION_GEMINI_MODEL,
  CORRECTION_OVERLAP_SECONDS,
  CORRECTION_TEMPERATURE,
  DEFAULT_GEMINI_TRANSCRIBE_MODEL,
  OPENAI_PARALLEL_CHUNK_REQUESTS,
  OPENAI_SPEED_FACTOR_DEFAULT,
  OPENAI_SPEED_FACTOR_MAX,
  OPENAI_SPEED_FACTOR_MIN,
  PRIMARY_TRANSCRIBE_MODEL,
  TRANSCRIBER_CORRECTION_MODEL_STORAGE_KEY,
  TRANSCRIBER_TRANSCRIBE_MODEL_STORAGE_KEY,
} from './constants';
import type { TranscriptionProviderId } from './providers/types';

/* ------------------------------------------------------------ */
/* CONFIGURATION: Settings store storage key + numeric clamp bounds */
/* ------------------------------------------------------------ */

/** localStorage key for the versioned settings object below. Bumping the
 * shape in a breaking way should bump this key (e.g. `_v2`) rather than
 * mutate v1's meaning in place. */
export const TRANSCRIBER_SETTINGS_STORAGE_KEY = 'transcriber_settings_v1';

/** Speaker-turn merge gap clamp (seconds) — how long a pause can be while
 * still merging consecutive same-speaker segments into one turn block. */
export const MERGE_GAP_SECONDS_MIN = 0.5;
export const MERGE_GAP_SECONDS_MAX = 10;

/** Cleanup-pass chunk window clamp (seconds). */
export const CLEANUP_CHUNK_SECONDS_MIN = 300;
export const CLEANUP_CHUNK_SECONDS_MAX = 1800;

/** Cleanup-pass chunk overlap clamp (seconds). */
export const CLEANUP_OVERLAP_SECONDS_MIN = 0;
export const CLEANUP_OVERLAP_SECONDS_MAX = 300;

/** Cleanup-pass model temperature clamp. */
export const CLEANUP_TEMPERATURE_MIN = 0;
export const CLEANUP_TEMPERATURE_MAX = 1;

/** Parallel-request clamps: how many OpenAI transcription chunks / cleanup
 * chunk requests may run in flight at once. 1 = fully sequential. The OpenAI
 * ceiling is lower because each in-flight chunk is a ~20 MB upload held in
 * memory and sharing one uplink; cleanup requests are small JSON bodies
 * whose ceiling is really the model provider's per-minute rate limit. */
export const OPENAI_PARALLEL_CHUNKS_MIN = 1;
export const OPENAI_PARALLEL_CHUNKS_MAX = 8;
export const CLEANUP_PARALLEL_CHUNKS_MIN = 1;
export const CLEANUP_PARALLEL_CHUNKS_MAX = 12;

const TRANSCRIPTION_PROVIDER_IDS = new Set<TranscriptionProviderId>([
  'openai-diarized',
  'openai-whisper',
  'gemini',
]);

function isTranscriptionProviderId(value: unknown): value is TranscriptionProviderId {
  return typeof value === 'string' && TRANSCRIPTION_PROVIDER_IDS.has(value as TranscriptionProviderId);
}

const SUPPRESSION_SENSITIVITIES = new Set(['conservative', 'aggressive']);
const DEBUG_MODES = new Set(['on-failure', 'always']);

export interface TranscriberSettings {
  version: 1;
  /** Which provider a new run starts with. */
  provider: TranscriptionProviderId; // 'openai-diarized' (default) | 'openai-whisper' | 'gemini'
  openaiModel: TranscribeModelId; // 'gpt-4o-transcribe-diarize'
  geminiTranscribeModel: GeminiModelId; // 'gemini-2.5-flash'
  autoFallback: boolean; // false
  fallbackOrder: TranscriptionProviderId[]; // ['gemini', 'openai-whisper']
  speakerClipsEnabled: boolean; // true (OpenAI path)
  geminiReferenceClips: boolean; // false (experimental)
  showRawOutput: boolean; // true
  showCleanedOutput: boolean; // true
  suppressionEnabled: boolean; // true
  suppressionSensitivity: 'conservative' | 'aggressive'; // 'conservative'
  mergeTurnsEnabled: boolean; // true
  mergeGapSeconds: number; // 2.5
  cleanupEnabled: boolean; // true
  strictCorrection: boolean; // false
  cleanupModel: GeminiModelId; // 'gemini-2.5-flash'
  cleanupTemperature: number; // 0.1
  cleanupChunkSeconds: number; // 900
  cleanupOverlapSeconds: number; // 90
  argumentTagging: boolean; // false
  debugMode: 'on-failure' | 'always'; // 'on-failure'
  /** Auto-optimize & chunk long/large OpenAI recordings client-side (silence removal + optional speed-up + chunking under both OpenAI caps) instead of the plain single-request upload. Gemini is unaffected. */
  openaiPreprocessing: boolean; // true
  /** Remove real silence from the recording before chunking (only meaningful when openaiPreprocessing is on). */
  openaiSilenceRemoval: boolean; // true
  /** Playback-rate speed-up applied to the whole recording before chunking — raises pitch slightly; set to 1.0 if accuracy suffers. */
  openaiSpeedFactor: number; // 1.2
  /** How many preprocessed-chunk transcription requests run in flight at once on the OpenAI chunked path (integer; 1 = sequential). */
  openaiParallelChunks: number; // 4
  /** How many cleanup-pass chunk requests run in flight at once (integer; 1 = sequential). Lower it if a free-tier Gemini key starts returning 429s. */
  cleanupParallelChunks: number; // 6
}

export const DEFAULT_TRANSCRIBER_SETTINGS: TranscriberSettings = {
  version: 1,
  provider: 'openai-diarized',
  openaiModel: PRIMARY_TRANSCRIBE_MODEL,
  geminiTranscribeModel: DEFAULT_GEMINI_TRANSCRIBE_MODEL,
  autoFallback: false,
  fallbackOrder: ['gemini', 'openai-whisper'],
  speakerClipsEnabled: true,
  geminiReferenceClips: false,
  showRawOutput: true,
  showCleanedOutput: true,
  suppressionEnabled: true,
  suppressionSensitivity: 'conservative',
  mergeTurnsEnabled: true,
  mergeGapSeconds: 2.5,
  cleanupEnabled: true,
  strictCorrection: false,
  cleanupModel: CORRECTION_GEMINI_MODEL,
  cleanupTemperature: CORRECTION_TEMPERATURE,
  cleanupChunkSeconds: CORRECTION_CHUNK_SECONDS,
  cleanupOverlapSeconds: CORRECTION_OVERLAP_SECONDS,
  argumentTagging: false,
  debugMode: 'on-failure',
  openaiPreprocessing: true,
  openaiSilenceRemoval: true,
  openaiSpeedFactor: OPENAI_SPEED_FACTOR_DEFAULT,
  openaiParallelChunks: OPENAI_PARALLEL_CHUNK_REQUESTS,
  cleanupParallelChunks: CLEANUP_PARALLEL_CHUNK_REQUESTS,
};

/** Fresh copy of the defaults — callers get their own `fallbackOrder` array
 * instead of a reference into the shared default object. */
function cloneDefaults(): TranscriberSettings {
  return { ...DEFAULT_TRANSCRIBER_SETTINGS, fallbackOrder: [...DEFAULT_TRANSCRIBER_SETTINGS.fallbackOrder] };
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** clampNumber for integer-valued settings (parallel request counts) — a fractional stored value rounds to the nearest whole number before clamping. */
function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function resolveProviderId(value: unknown, fallback: TranscriptionProviderId): TranscriptionProviderId {
  return isTranscriptionProviderId(value) ? value : fallback;
}

function resolveSuppressionSensitivity(value: unknown): TranscriberSettings['suppressionSensitivity'] {
  return typeof value === 'string' && SUPPRESSION_SENSITIVITIES.has(value)
    ? (value as TranscriberSettings['suppressionSensitivity'])
    : DEFAULT_TRANSCRIBER_SETTINGS.suppressionSensitivity;
}

function resolveDebugMode(value: unknown): TranscriberSettings['debugMode'] {
  return typeof value === 'string' && DEBUG_MODES.has(value)
    ? (value as TranscriberSettings['debugMode'])
    : DEFAULT_TRANSCRIBER_SETTINGS.debugMode;
}

/** Validates a fallbackOrder array: invalid/unknown entries are dropped; an
 * empty (or entirely invalid) result falls back to the default order. */
function resolveFallbackOrder(value: unknown): TranscriptionProviderId[] {
  if (!Array.isArray(value)) return [...DEFAULT_TRANSCRIBER_SETTINGS.fallbackOrder];
  const filtered = value.filter(isTranscriptionProviderId);
  return filtered.length > 0 ? filtered : [...DEFAULT_TRANSCRIBER_SETTINGS.fallbackOrder];
}

/**
 * Parses a raw localStorage string into a full, valid TranscriberSettings
 * object. Pure and never throws: unparseable/non-object input, missing
 * fields, wrong types, and out-of-range numbers all fall back to the
 * documented default for that field alone (other valid fields are kept).
 *
 * When `raw` is null/unparseable (i.e. no v1 settings object exists yet)
 * and `legacy` values are supplied, `openaiModel`/`cleanupModel` are seeded
 * from the pre-v1 per-model localStorage keys instead of the hard defaults —
 * a one-time, non-destructive migration path.
 */
export function parseStoredSettings(
  raw: string | null,
  legacy?: { transcribeModel?: string | null; correctionModel?: string | null },
): TranscriberSettings {
  let parsed: Record<string, unknown> | null = null;
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }
  }

  // Legacy migration only applies when there's no v1 object at all — a
  // partially-corrupt v1 object should fall back to hard defaults per
  // field, not resurrect the old keys.
  const openaiModelDefault = parsed
    ? DEFAULT_TRANSCRIBER_SETTINGS.openaiModel
    : resolveTranscribeModelId(legacy?.transcribeModel, DEFAULT_TRANSCRIBER_SETTINGS.openaiModel);
  const cleanupModelDefault = parsed
    ? DEFAULT_TRANSCRIBER_SETTINGS.cleanupModel
    : resolveGeminiModelId(legacy?.correctionModel, DEFAULT_TRANSCRIBER_SETTINGS.cleanupModel);

  const base = parsed ?? {};

  return {
    version: 1,
    provider: resolveProviderId(base.provider, DEFAULT_TRANSCRIBER_SETTINGS.provider),
    openaiModel: resolveTranscribeModelId(base.openaiModel, openaiModelDefault),
    geminiTranscribeModel: resolveGeminiModelId(
      base.geminiTranscribeModel,
      DEFAULT_TRANSCRIBER_SETTINGS.geminiTranscribeModel,
    ),
    autoFallback: parseBoolean(base.autoFallback, DEFAULT_TRANSCRIBER_SETTINGS.autoFallback),
    fallbackOrder: resolveFallbackOrder(base.fallbackOrder),
    speakerClipsEnabled: parseBoolean(base.speakerClipsEnabled, DEFAULT_TRANSCRIBER_SETTINGS.speakerClipsEnabled),
    geminiReferenceClips: parseBoolean(
      base.geminiReferenceClips,
      DEFAULT_TRANSCRIBER_SETTINGS.geminiReferenceClips,
    ),
    showRawOutput: parseBoolean(base.showRawOutput, DEFAULT_TRANSCRIBER_SETTINGS.showRawOutput),
    showCleanedOutput: parseBoolean(base.showCleanedOutput, DEFAULT_TRANSCRIBER_SETTINGS.showCleanedOutput),
    suppressionEnabled: parseBoolean(base.suppressionEnabled, DEFAULT_TRANSCRIBER_SETTINGS.suppressionEnabled),
    suppressionSensitivity: resolveSuppressionSensitivity(base.suppressionSensitivity),
    mergeTurnsEnabled: parseBoolean(base.mergeTurnsEnabled, DEFAULT_TRANSCRIBER_SETTINGS.mergeTurnsEnabled),
    mergeGapSeconds: clampNumber(
      base.mergeGapSeconds,
      MERGE_GAP_SECONDS_MIN,
      MERGE_GAP_SECONDS_MAX,
      DEFAULT_TRANSCRIBER_SETTINGS.mergeGapSeconds,
    ),
    cleanupEnabled: parseBoolean(base.cleanupEnabled, DEFAULT_TRANSCRIBER_SETTINGS.cleanupEnabled),
    strictCorrection: parseBoolean(base.strictCorrection, DEFAULT_TRANSCRIBER_SETTINGS.strictCorrection),
    cleanupModel: resolveGeminiModelId(base.cleanupModel, cleanupModelDefault),
    cleanupTemperature: clampNumber(
      base.cleanupTemperature,
      CLEANUP_TEMPERATURE_MIN,
      CLEANUP_TEMPERATURE_MAX,
      DEFAULT_TRANSCRIBER_SETTINGS.cleanupTemperature,
    ),
    cleanupChunkSeconds: clampNumber(
      base.cleanupChunkSeconds,
      CLEANUP_CHUNK_SECONDS_MIN,
      CLEANUP_CHUNK_SECONDS_MAX,
      DEFAULT_TRANSCRIBER_SETTINGS.cleanupChunkSeconds,
    ),
    cleanupOverlapSeconds: clampNumber(
      base.cleanupOverlapSeconds,
      CLEANUP_OVERLAP_SECONDS_MIN,
      CLEANUP_OVERLAP_SECONDS_MAX,
      DEFAULT_TRANSCRIBER_SETTINGS.cleanupOverlapSeconds,
    ),
    argumentTagging: parseBoolean(base.argumentTagging, DEFAULT_TRANSCRIBER_SETTINGS.argumentTagging),
    debugMode: resolveDebugMode(base.debugMode),
    openaiPreprocessing: parseBoolean(base.openaiPreprocessing, DEFAULT_TRANSCRIBER_SETTINGS.openaiPreprocessing),
    openaiSilenceRemoval: parseBoolean(base.openaiSilenceRemoval, DEFAULT_TRANSCRIBER_SETTINGS.openaiSilenceRemoval),
    openaiSpeedFactor: clampNumber(
      base.openaiSpeedFactor,
      OPENAI_SPEED_FACTOR_MIN,
      OPENAI_SPEED_FACTOR_MAX,
      DEFAULT_TRANSCRIBER_SETTINGS.openaiSpeedFactor,
    ),
    openaiParallelChunks: clampInteger(
      base.openaiParallelChunks,
      OPENAI_PARALLEL_CHUNKS_MIN,
      OPENAI_PARALLEL_CHUNKS_MAX,
      DEFAULT_TRANSCRIBER_SETTINGS.openaiParallelChunks,
    ),
    cleanupParallelChunks: clampInteger(
      base.cleanupParallelChunks,
      CLEANUP_PARALLEL_CHUNKS_MIN,
      CLEANUP_PARALLEL_CHUNKS_MAX,
      DEFAULT_TRANSCRIBER_SETTINGS.cleanupParallelChunks,
    ),
  };
}

/**
 * Reads the versioned settings object from localStorage. SSR-safe (returns
 * defaults when `window` is undefined) and never throws.
 *
 * If the v1 key is absent, this checks the two legacy per-model keys
 * (`transcriber_transcribe_model` / `transcriber_correction_model`), seeds a
 * v1 object from them via `parseStoredSettings`, and writes it back — the
 * legacy keys themselves are left in place (non-destructive; nothing else
 * reads them once migrated, but there's no reason to delete them).
 */
export function readTranscriberSettings(): TranscriberSettings {
  if (typeof window === 'undefined') return cloneDefaults();

  try {
    const raw = window.localStorage.getItem(TRANSCRIBER_SETTINGS_STORAGE_KEY);
    if (raw !== null) {
      return parseStoredSettings(raw);
    }

    const legacy = {
      transcribeModel: window.localStorage.getItem(TRANSCRIBER_TRANSCRIBE_MODEL_STORAGE_KEY),
      correctionModel: window.localStorage.getItem(TRANSCRIBER_CORRECTION_MODEL_STORAGE_KEY),
    };
    const settings = parseStoredSettings(null, legacy);
    saveTranscriberSettings(settings);
    return settings;
  } catch {
    return cloneDefaults();
  }
}

export function saveTranscriberSettings(settings: TranscriberSettings): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(TRANSCRIBER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Local settings are optional device preferences.
  }
}
