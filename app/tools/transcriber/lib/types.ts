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
 * assigned per-segment by the same Gemini call that corrects wording (see
 * buildCorrectionPrompt.ts's `argumentTagging` option), never a separate AI
 * pass. Chosen to map cleanly onto the future conflict-tracker
 * `Conflict`/`ReflectionInput` draft models:
 * - 'argument_conflict': conflict/escalation between the speakers.
 * - 'repair_attempt': an attempt to repair or de-escalate the conflict.
 * - 'emotional_support': comfort/support, especially after conflict.
 * - 'logistics_or_normal': ordinary logistics or neutral conversation.
 * - 'unrelated': clearly unrelated chatter — excluded from the
 *   argument-relevant export (lib/argumentTags.ts) except as sandwiched
 *   lead-up context is never granted to this tag.
 * - 'unclear': the safe fallback for a missing/invalid model response so a
 *   bad tag never rejects a whole correction chunk (see
 *   parseCorrectionResponse.ts) — also eligible as sandwiched lead-up/context
 *   between two argument-relevant blocks.
 */
export type ArgumentTag =
  | 'argument_conflict'
  | 'repair_attempt'
  | 'emotional_support'
  | 'logistics_or_normal'
  | 'unrelated'
  | 'unclear';

/** A transcript segment carrying its optional argument-relevance tag — set
 * when settings.argumentTagging is on (Phase 5). */
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
  /** When true, the correction prompt additionally asks for a per-segment ArgumentTag (Phase 5) — no separate AI pass. */
  argumentTagging?: boolean;
  /** Overrides CORRECTION_TEMPERATURE for this request; server-clamped to [0, 1]. */
  temperature?: number;
}

export interface CorrectApiResponse {
  /** Carries `tag` per segment only when the request had `argumentTagging: true`. */
  segments: TaggedTranscriptSegment[];
  /** How many segments the route's divergence guardrail reverted to their
   * original text because the model's rewrite drifted too far in length to
   * be a plausible preservation-first correction (lib/correctionGuards.ts).
   * Present (possibly 0) on success. */
  revertedSegments?: number;
  error?: string;
}
