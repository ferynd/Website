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

/** Default Gemini model for direct (Phase 3) transcription. Deliberately a
 * separate constant from CORRECTION_GEMINI_MODEL (cleanup pass) even though
 * they currently share a value — the two are tuned independently. Must be a
 * member of GEMINI_TRANSCRIBE_MODELS (app/lib/aiModels.ts). */
export const DEFAULT_GEMINI_TRANSCRIBE_MODEL: GeminiModelId = 'gemini-2.5-flash';

/** Correction chunk window size and overlap, in seconds. */
export const CORRECTION_CHUNK_SECONDS = 15 * 60; // 15 minutes
export const CORRECTION_OVERLAP_SECONDS = 90; // 1.5 minutes

/** Recordings at or under this duration go through Gemini direct
 * transcription as a single generateContent call — above it, the client
 * windows the file (see GEMINI_WINDOW_SECONDS) the same way the correction
 * pass chunks a long transcript. 20 minutes keeps a single call comfortably
 * inside Gemini's ~65k output-token ceiling and Edge wall-clock limits. */
export const GEMINI_SINGLE_CALL_MAX_SECONDS = 1200; // 20 minutes
/** Gemini direct-transcription window size and overlap, in seconds — mirrors
 * CORRECTION_CHUNK_SECONDS/CORRECTION_OVERLAP_SECONDS but tuned separately
 * since a transcription call and a correction call have different
 * output-token budgets per second of audio. */
export const GEMINI_WINDOW_SECONDS = 600; // 10 minutes
export const GEMINI_WINDOW_OVERLAP_SECONDS = 15;

/** Gemini Files API activation poll cadence/timeout — see
 * app/api/transcriber/gemini/file/route.ts and lib/providers/geminiProvider.ts. */
export const GEMINI_FILE_POLL_INTERVAL_MS = 2000;
export const GEMINI_FILE_POLL_TIMEOUT_MS = 120_000;

/** Gemini's larger per-request size budget (vs. OpenAI's 25 MB) — kept under
 * Cloudflare Pages' 100 MB request-body limit for this deployment. */
export const MAX_GEMINI_UPLOAD_BYTES = 95 * 1024 * 1024;

export const DEFAULT_SPEAKER_NAMES = ['Kait', 'James'];

/** Per-clip and per-run caps for OpenAI known-speaker reference clips
 * (Phase 4) — re-validated server-side in the transcribe route regardless of
 * client-side checks. Generous headroom, not a target size: a clip that has
 * gone through lib/processReferenceClip.ts (mono, 16 kHz, ~8s, PCM16 WAV) is
 * only ~256 KB. */
export const MAX_SPEAKER_CLIP_BYTES = 5 * 1024 * 1024;
export const MAX_SPEAKER_CLIPS = 4;

/** Caps for Gemini's experimental inline voice-reference clips (Phase 4,
 * settings.geminiReferenceClips — default OFF) — re-validated server-side in
 * the gemini/window route. */
export const MAX_GEMINI_REFERENCE_CLIPS = 4;
export const MAX_GEMINI_REFERENCE_TOTAL_BYTES = 5 * 1024 * 1024;
export const DEFAULT_CONTEXT_NOTES =
  'There are two speakers. Kait is female and speaks more slowly. James is male and speaks more quickly. Kait is the first person speaking.';

/** Accepted upload extensions, widened beyond .m4a for coherence with the
 * "convert to MP3/WAV/AAC" error-recovery guidance (see lib/classifyError.ts). */
export const ACCEPTED_FILE_EXTENSIONS = ['.m4a', '.mp3', '.wav', '.aac', '.ogg', '.webm'];

/** @deprecated Superseded by ACCEPTED_FILE_EXTENSIONS above (widened upload
 * support) — kept only in case anything still imports the singular form. */
export const ACCEPTED_FILE_EXTENSION = '.m4a';

/**
 * @deprecated Superseded by the versioned settings store (`lib/settings.ts`,
 * key `transcriber_settings_v1`). Kept only so `readTranscriberSettings()`
 * can migrate a returning browser's saved model choices into the v1 object
 * the first time it runs — do not read/write these directly in new code.
 */
export const TRANSCRIBER_TRANSCRIBE_MODEL_STORAGE_KEY = 'transcriber_transcribe_model';
/** @deprecated See TRANSCRIBER_TRANSCRIBE_MODEL_STORAGE_KEY above. */
export const TRANSCRIBER_CORRECTION_MODEL_STORAGE_KEY = 'transcriber_correction_model';
