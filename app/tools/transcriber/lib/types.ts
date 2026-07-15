// Shared types for the Transcriber pipeline: transcript segments, speaker
// config, pipeline status, and the API request/response shapes.

import type { TranscriptionProviderId } from './providers/types';

/**
 * How a segment's current speaker assignment was decided — recorded per
 * segment so every later stage (reconciliation, repair, merging, exports)
 * can distinguish a genuinely verified identity from an unverified guess:
 * - 'acoustic': the provider's raw label exactly matched a supplied known
 *   name AND the request carried ACCEPTED acoustic reference clips for that
 *   name — a real acoustic anchor. The only chunk-local mapping outcome
 *   that resolves a segment immediately (`resolvedSpeaker` set).
 * - 'provider-exact': the raw label case-insensitively matched a supplied
 *   known name, but with NO accepted acoustic reference (no clips
 *   attached/accepted for OpenAI, or any Gemini match — Gemini has no
 *   acoustic verification at all). This is the model's own inference, not
 *   a verified identity: it never resolves a segment by itself
 *   (`candidateSpeaker` only) — only independent corroboration (an
 *   overlap/continuity link to an acoustic anchor, a user confirmation, or
 *   the repair stage) can turn it into a resolved assignment.
 * - 'positional': an anonymous provider label (A/B/…) was mapped to a
 *   supplied name by first-appearance order — a guess, never an anchor, and
 *   never resolves a segment alone (`candidateSpeaker` only), regardless of
 *   which chunk it came from.
 * - 'unresolved': the label was preserved as a chunk-local identity with no
 *   known-name assignment (or, for Whisper, no identity at all).
 * - 'reconciliation': assigned by the deterministic global reconciliation
 *   stage (lib/reconcileSpeakers.ts) once corroborating evidence clears the
 *   auto-assign threshold.
 * - 'repair': assigned by the targeted language-model speaker-repair stage.
 * - 'user': manually confirmed by the user — never overwritten by any
 *   automatic stage.
 */
export type SpeakerMappingSource =
  | 'acoustic'
  | 'provider-exact'
  | 'positional'
  | 'unresolved'
  | 'reconciliation'
  | 'repair'
  | 'user';

/**
 * Optional per-segment speaker provenance (additive — every field is
 * optional so pre-existing segments, caches, and API payloads without them
 * keep working). Stable IDs never depend on corrected text or corrected
 * speaker names: `id` is derived from (chunkIndex, position-in-chunk) only.
 */
export interface SegmentProvenance {
  /** Stable segment id, `s<chunkIndex>-<indexInChunk>` — assigned client-side once per transcription, before any correction. */
  id?: string;
  /** Which transcription chunk/window this segment came from. */
  chunkIndex?: number;
  /** The provider's original speaker label for this segment, before any mapping ('' when the provider sent none). */
  providerLabel?: string;
  /** Stable chunk-local speaker identity: `name:<lower>` for exact known-name matches (global by construction), `c<chunk>:label:<key>` for anonymous/malformed labels. Absent for Whisper (no speaker concept at all). */
  localSpeakerId?: string;
  /** Resolved global speaker (one of the supplied known names) when assignment confidence cleared the auto-assign threshold. */
  resolvedSpeaker?: string;
  /** Best candidate known name when confidence is in the candidate band (kept for repair context) — the segment still displays unresolved. */
  candidateSpeaker?: string;
  /** 0..1 confidence in the current assignment/candidate. */
  speakerConfidence?: number;
  mappingSource?: SpeakerMappingSource;
  /** True when reconciliation found directly conflicting evidence for this segment's identity — left unresolved and recorded. */
  mappingConflict?: boolean;
  /** True when the user manually confirmed this segment's speaker — protected from every automatic stage. */
  userConfirmed?: boolean;
  /** Display speaker this segment had before a repair patch overwrote it — preserves the prior assignment alongside the new one. */
  repairedFrom?: string;
}

export interface TranscriptSegment extends SegmentProvenance {
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
 * Argument-relevance tag assigned per conversational turn block by the
 * dedicated classification stage (lib/argumentClassify.ts +
 * app/api/transcriber/classify/route.ts) — separate from, and independent
 * of, the text-correction pass. Chosen to map cleanly onto the future
 * conflict-tracker `Conflict`/`ReflectionInput` draft models:
 * - 'argument_conflict': conflict/escalation between the speakers.
 * - 'repair_attempt': an attempt to repair or de-escalate the conflict.
 * - 'emotional_support': comfort/support, especially after conflict.
 * - 'logistics_or_normal': ordinary logistics or neutral conversation.
 * - 'unrelated': clearly unrelated chatter — excluded from the
 *   argument-relevant export unless it falls inside an expanded argument
 *   range (lib/argumentTags.ts).
 * - 'unclear': the safe fallback for a block the classifier missed or
 *   returned an invalid tag for — a bad tag never invalidates the cleaned
 *   transcript.
 */
export type ArgumentTag =
  | 'argument_conflict'
  | 'repair_attempt'
  | 'emotional_support'
  | 'logistics_or_normal'
  | 'unrelated'
  | 'unclear';

/** A transcript segment carrying an optional argument-relevance tag. Kept
 * for backward compatibility with older stored/cached shapes — tags are now
 * assigned per turn block by the classification stage, not per segment. */
export interface TaggedTranscriptSegment extends TranscriptSegment {
  tag?: ArgumentTag;
}

/** A merged run of consecutive same-speaker segments — see lib/mergeTurns.ts. */
export interface TurnBlock {
  /** Stable block id — the first constituent segment's stable id when available. */
  id?: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
  segmentCount: number;
  /** Stable ids of every constituent segment, in order (present when the segments carried ids). */
  segmentIds?: string[];
  /** Argument-relevance tag from the classification stage — assigned per block, after merging. */
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
  | 'repairing' // targeted speaker repair (only when the quality gate triggers)
  | 'correcting'
  | 'building'
  | 'classifying' // argument classification (only when argumentTagging is on)
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
  /** True when reference clips were attached to this request at all (OpenAI diarized only). */
  clipsSupplied?: boolean;
  /** True when OpenAI actually accepted the attached clips — false after a successful known-speaker-rejection retry that dropped them. An exact-name match is only acoustically anchored when this is true. */
  clipsAccepted?: boolean;
  /** Provider token usage for this request, only when the provider reported it. */
  usage?: StageUsage;
  /** Present alongside `error` on failure responses — see classifyTranscriptionError. */
  errorInfo?: TranscribeErrorInfo;
}

/**
 * Provider token-usage metadata for one model request, captured only when
 * the provider actually reported it — fields are never invented, an absent
 * field means the provider didn't report that number.
 */
export interface StageUsage {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  /** How many upstream model requests this response consumed (retries included). */
  requests: number;
}

/** One segment as sent to the sparse text-correction route — stable id plus
 * the current speaker/text; timestamps are context only. */
export interface CorrectionRequestSegment {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface CorrectApiRequestBody {
  segments: CorrectionRequestSegment[];
  speakerNames: string[];
  contextNotes: string;
  mode: TranscriptionMode;
  /** Gemini model id chosen in Settings; falls back to CORRECTION_GEMINI_MODEL server-side if missing/invalid. */
  model?: string;
  /** Overrides CORRECTION_TEMPERATURE for this request; server-clamped to [0, 1]. */
  temperature?: number;
}

/** One sparse text-correction patch — only segments whose text actually
 * changed come back; everything omitted is unchanged by definition. */
export interface CorrectionPatch {
  segmentId: string;
  text: string;
}

export interface CorrectApiResponse {
  /** Sparse: one entry per segment the model changed. An empty array is a
   * valid "nothing needed fixing" response. IDs are validated server-side
   * against the request — unknown IDs never come back. */
  patches: CorrectionPatch[];
  /** How many model patches the route's divergence guardrail rejected
   * (dropped, keeping the original text) because the rewrite drifted too far
   * in length to be a plausible preservation-first correction
   * (lib/correctionGuards.ts). Present (possibly 0) on success. */
  revertedPatches?: number;
  usage?: StageUsage;
  /** Set when the model attempted output that included invalid/unknown/duplicate items on at least one attempt — distinct from a genuinely empty {patches: []} response. The valid subset is still applied; this is a diagnostic signal only. */
  warning?: string;
  error?: string;
}

/** One segment as sent to the speaker-repair route. `target: true` marks the
 * unresolved/low-confidence segments the model is asked to resolve; the rest
 * are nearby context only and must not be patched. */
export interface SpeakerRepairRequestSegment {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
  target: boolean;
  /** Best reconciliation candidate (candidate band) for this target, if any. */
  candidateSpeaker?: string;
  candidateConfidence?: number;
}

export interface SpeakerRepairApiRequestBody {
  segments: SpeakerRepairRequestSegment[];
  knownNames: string[];
  /** Parallel to knownNames — optional per-speaker voice/speaking-style notes. */
  speakerNotes?: string[];
  contextNotes: string;
  /** Gemini model id; server-validated against the registered catalog. */
  model?: string;
}

export interface SpeakerRepairPatch {
  segmentId: string;
  speaker: string;
  confidence: number;
}

export interface SpeakerRepairApiResponse {
  /** Sparse: only targets the model could attribute confidently. No
   * transcript text is ever echoed back. IDs and speaker names are validated
   * server-side against the request. */
  patches: SpeakerRepairPatch[];
  usage?: StageUsage;
  /** Set when the model attempted output that included invalid/unknown/duplicate items on at least one attempt — distinct from a genuinely empty {patches: []} response. */
  warning?: string;
  error?: string;
}

/** One conversational block as sent to the argument-classification route. */
export interface ClassifyRequestBlock {
  id: string;
  speaker: string;
  text: string;
}

export interface ClassifyApiRequestBody {
  blocks: ClassifyRequestBlock[];
  contextNotes?: string;
  /** Gemini model id; server-validated against the registered catalog. */
  model?: string;
}

export interface BlockClassification {
  blockId: string;
  tag: ArgumentTag;
  confidence: number;
}

export interface ClassifyApiResponse {
  /** One entry per request block the model classified — IDs and tags are
   * validated server-side; no block text is ever echoed back. */
  classifications: BlockClassification[];
  usage?: StageUsage;
  /** Set when the model attempted output that included invalid/unknown/duplicate items on at least one attempt — distinct from a genuinely empty {classifications: []} response. */
  warning?: string;
  error?: string;
}
