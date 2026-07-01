// Shared types for the Transcriber pipeline: transcript segments, speaker
// config, pipeline status, and the API request/response shapes.

import type { TranscriptionProviderId } from './providers/types';

export interface TranscriptSegment {
  start: number; // seconds
  end: number; // seconds
  speaker: string;
  text: string;
}

/** A segment tagged with its position in a correction-chunk request, so the
 * correction model can echo back an index instead of timestamps. */
export interface IndexedTranscriptSegment extends TranscriptSegment {
  index: number;
}

/**
 * Optional argument-relevance tag folded into the cleanup pass (Phase 5) —
 * types only for now, unused until the prompt/parse/UI wiring lands. Chosen
 * to map cleanly onto the future conflict-tracker `Conflict`/`ReflectionInput`
 * draft models: 'lead-up' / 'conflict' / 'repair' / 'support' are the
 * argument-relevant categories that later filter into a draft export;
 * 'unrelated' is explicitly excluded from that export; 'unclear' is the safe
 * fallback for a missing/invalid model response so a bad tag never rejects a
 * whole correction chunk.
 */
export type ArgumentTag = 'lead-up' | 'conflict' | 'repair' | 'support' | 'unrelated' | 'unclear';

/** A transcript segment carrying its optional argument-relevance tag. Unused
 * until Phase 5 wires tagging through the cleanup prompt/parse/UI. */
export interface TaggedTranscriptSegment extends TranscriptSegment {
  tag?: ArgumentTag;
}

/** A merged run of consecutive same-speaker segments — see lib/mergeTurns.ts. */
export interface TurnBlock {
  start: number;
  end: number;
  speaker: string;
  text: string;
  segmentCount: number;
  /** Majority tag among the merged segments (Phase 5) — tag differences never block merging. */
  tag?: ArgumentTag;
}

/** Output of lib/suppressArtifacts.ts: what got removed and where, for the
 * UI's suppression warning and for mergeTurns' boundary handling. */
export interface SuppressionReport {
  removed: { phrase: string; count: number; timeRange: [number, number] }[];
  /** Start times of every removed segment — mergeTurns treats these as hard turn-block boundaries. */
  boundaryTimes: number[];
}

export type TranscriptionMode = 'diarized' | 'fallback' | 'gemini';

export type PipelineStatus =
  | 'idle'
  | 'validating'
  | 'uploading'
  | 'transcribing'
  | 'processing' // Gemini file activation / window progress (Phase 3)
  | 'correcting'
  | 'building'
  | 'complete'
  | 'failed';

/**
 * Structured failure detail a route can return alongside a plain `error`
 * string so the client can classify it (see lib/classifyError.ts) instead of
 * only showing raw text. `upstreamBody` is always sanitized + truncated
 * (lib/sanitizeUpstreamError.ts) before it reaches a response — never the
 * raw upstream body.
 */
export interface TranscribeErrorInfo {
  provider: TranscriptionProviderId;
  model: string;
  stage: 'upload' | 'transcribe' | 'poll' | 'cleanup' | 'auth';
  upstreamStatus: number | null;
  upstreamBody: string;
}

export interface TranscribeApiResponse {
  mode: TranscriptionMode;
  segments: TranscriptSegment[];
  /** Sanitized reason the primary (diarized) model failed, only set when mode is 'fallback'. */
  primaryError: string | null;
  error?: string;
  /** Non-fatal notices from this run (e.g. a rejected speaker reference in Phase 4). Present (possibly empty) on success. */
  warnings?: string[];
  /** Present alongside `error` on failure responses — see classifyTranscriptionError. */
  errorInfo?: TranscribeErrorInfo;
}

export interface CorrectApiRequestBody {
  segments: TranscriptSegment[];
  speakerNames: string[];
  contextNotes: string;
  mode: TranscriptionMode;
  /** Gemini model id chosen in Settings; falls back to CORRECTION_GEMINI_MODEL server-side if missing/invalid. */
  model?: string;
}

export interface CorrectApiResponse {
  segments: TranscriptSegment[];
  error?: string;
}
