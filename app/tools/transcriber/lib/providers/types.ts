// Provider identifiers and attempt/result shapes for the Transcriber
// pipeline's transcription backends.
//
// Relative imports here deliberately (see note at top of ../settings.ts) —
// this file (and everything that re-exports its types) needs to stay
// runnable under `npm test` without a path-alias resolver.

import type { ClassifiedError } from '../classifyError';
import type { ClipValidationStatus } from '../clipAnalysis';
import type { TranscriptionMode, TranscriptSegment } from '../types';

export type TranscriptionProviderId = 'openai-diarized' | 'openai-whisper' | 'gemini';

/**
 * A resolved speaker reference clip ready to attach to a transcription
 * request — produced by useSpeakerProfiles.ts's `getRunClips()` at submit
 * time (Phase 4), from either IndexedDB or the per-run in-memory fallback
 * store (when IndexedDB is unavailable). Consumed by both provider modules:
 * openaiProvider.ts attaches these as known-speaker references when the
 * diarized model + settings.speakerClipsEnabled are both active;
 * geminiProvider.ts base64-encodes and attaches them as experimental
 * inlineData parts when settings.geminiReferenceClips is on.
 */
export interface SpeakerReferenceClip {
  name: string;
  blob: Blob;
  mimeType: string;
  validationStatus: ClipValidationStatus;
}

/** A single successful transcription-provider run. */
export interface TranscriptionAttempt {
  provider: TranscriptionProviderId;
  model: string;
  mode: TranscriptionMode;
  segments: TranscriptSegment[];
  /** Non-fatal notices (e.g. "diarized model unavailable, used Whisper"). Always present, possibly empty. */
  warnings: string[];
}

/**
 * Thrown (as a plain object, not an `Error` instance — callers check for the
 * `classified` field) by provider modules on failure, so the pipeline hook
 * never has to re-derive a `ClassifiedError` from a generic exception.
 */
export interface TranscriptionAttemptError {
  classified: ClassifiedError;
  httpStatus: number | null;
  /** Sanitized + truncated (see ../sanitizeUpstreamError.ts) — never a raw upstream body. */
  upstreamBody: string;
  provider: TranscriptionProviderId;
  model: string;
}
