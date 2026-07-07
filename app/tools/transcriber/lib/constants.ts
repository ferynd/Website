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

/* ------------------------------------------------------------ */
/* CONFIGURATION: OpenAI long-recording preprocessing/chunking   */
/* ------------------------------------------------------------ */

/** gpt-4o-transcribe-diarize's hard duration cap, in seconds — documentation
 * constant only (nothing here sends a single request anywhere near this;
 * see OPENAI_SINGLE_REQUEST_MAX_SECONDS/OPENAI_CHUNK_MAX_SECONDS below,
 * which both stay comfortably under it). */
export const OPENAI_MAX_AUDIO_SECONDS = 1500;

/** Above this probed duration, an OpenAI run goes through client-side
 * preprocessing/chunking (see lib/preprocessOpenAiAudio.ts) instead of a
 * single upload — 20 minutes leaves margin under OPENAI_MAX_AUDIO_SECONDS. */
export const OPENAI_SINGLE_REQUEST_MAX_SECONDS = 1200; // 20 minutes

/** Per-chunk duration cap, in the FINAL (post-silence-removal,
 * post-speed-up) time domain — see lib/preprocessAudioPlan.ts's planChunks. */
export const OPENAI_CHUNK_MAX_SECONDS = 1200; // 20 minutes

/** Per-chunk encoded-size cap, in bytes — with 16 kHz mono PCM16 WAV
 * (WAV_PCM16_MONO_16K_BYTES_PER_SECOND below) this is the binding cap in
 * practice: ~655s of final audio per chunk, well under
 * OPENAI_CHUNK_MAX_SECONDS. */
export const OPENAI_CHUNK_MAX_BYTES = 20 * 1024 * 1024;

/** Bytes/second of 16 kHz mono 16-bit PCM (encodeWavPcm16's output format) —
 * 16000 samples/sec * 2 bytes/sample. */
export const WAV_PCM16_MONO_16K_BYTES_PER_SECOND = 32000;

/** Browser-memory-bound cap on the ORIGINAL file when OpenAI preprocessing
 * is enabled — deliberately the same value as MAX_GEMINI_UPLOAD_BYTES, since
 * the original file is decoded fully into memory client-side either way and
 * never itself uploaded to our server in the chunked path (only the
 * resulting per-chunk WAVs are). */
export const MAX_OPENAI_PREPROCESSED_UPLOAD_BYTES = MAX_GEMINI_UPLOAD_BYTES;

/** Playback-rate speed-up applied to the whole (silence-trimmed) buffer
 * before chunking, shrinking both duration and per-chunk byte size at the
 * cost of a pitch shift (accepted and documented) — default/min/max for
 * settings.openaiSpeedFactor. */
export const OPENAI_SPEED_FACTOR_DEFAULT = 1.2;
export const OPENAI_SPEED_FACTOR_MIN = 1.0;
export const OPENAI_SPEED_FACTOR_MAX = 1.5;

/** Frame size used to measure per-frame loudness when detecting removable
 * silence (lib/preprocessAudioPlan.ts's detectKeptIntervals). */
export const SILENCE_FRAME_SECONDS = 0.02;
/** Below this mean loudness (dBFS), a frame is classified as silent. */
export const SILENCE_DBFS_THRESHOLD = -45;
/** A run of consecutive silent frames must span at least this long before
 * it's considered for removal at all — short pauses are always kept
 * untouched. */
export const MIN_REMOVABLE_SILENCE_SECONDS = 1.0;
/** Each removable silence run is shrunk by this much on both edges before
 * removal — the padding stays attached to the surrounding speech so a word
 * is never clipped right at a cut. */
export const SILENCE_EDGE_PAD_SECONDS = 0.25;

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
