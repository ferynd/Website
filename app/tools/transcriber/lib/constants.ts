import type { GeminiModelId } from '@/app/lib/aiModels';

/* ------------------------------------------------------------ */
/* CONFIGURATION: Transcriber pipeline tuning constants          */
/* ------------------------------------------------------------ */

/** OpenAI's hard limit for direct multipart uploads to /v1/audio/transcriptions. */
export const MAX_OPENAI_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Primary transcription model — supports diarization (speaker labels). */
export const PRIMARY_TRANSCRIBE_MODEL = 'gpt-4o-transcribe-diarize';
/** Fallback model used when the primary model/endpoint is unavailable. No diarization. */
export const FALLBACK_TRANSCRIBE_MODEL = 'whisper-1';

/** Gemini model used for the speaker-correction / cleanup pass. */
export const CORRECTION_GEMINI_MODEL: GeminiModelId = 'gemini-2.5-flash';
/** Low temperature — correction is a precision task, not a creative one. */
export const CORRECTION_TEMPERATURE = 0.1;

/** Correction chunk window size and overlap, in seconds. */
export const CORRECTION_CHUNK_SECONDS = 15 * 60; // 15 minutes
export const CORRECTION_OVERLAP_SECONDS = 90; // 1.5 minutes

export const DEFAULT_SPEAKER_NAMES = ['Kait', 'James'];
export const DEFAULT_CONTEXT_NOTES =
  'There are two speakers. Kait is female and speaks more slowly. James is male and speaks more quickly. Kait is the first person speaking.';

export const ACCEPTED_FILE_EXTENSION = '.m4a';
