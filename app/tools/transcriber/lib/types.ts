// Shared types for the Transcriber pipeline: transcript segments, speaker
// config, pipeline status, and the API request/response shapes.

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

export type TranscriptionMode = 'diarized' | 'fallback';

export type PipelineStatus =
  | 'idle'
  | 'validating'
  | 'uploading'
  | 'transcribing'
  | 'correcting'
  | 'building'
  | 'complete'
  | 'failed';

export interface TranscribeApiResponse {
  mode: TranscriptionMode;
  segments: TranscriptSegment[];
  /** Sanitized reason the primary (diarized) model failed, only set when mode is 'fallback'. */
  primaryError: string | null;
  error?: string;
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
