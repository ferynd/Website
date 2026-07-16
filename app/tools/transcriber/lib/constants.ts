import type { GeminiModelId } from '@/app/lib/aiModels';

/* ------------------------------------------------------------ */
/* CONFIGURATION: Transcriber pipeline tuning constants          */
/* ------------------------------------------------------------ */

/** Version of the pipeline's data shapes + stage semantics — participates in
 * every stage cache key and the debug manifest so results produced by an
 * older pipeline are never reused by a newer one. Bump on any change to
 * segment provenance, stage ordering, or patch semantics. */
export const PIPELINE_SCHEMA_VERSION = 2;

/** Version of the deterministic speaker mapping + reconciliation algorithm
 * (lib/mapSpeakerLabels.ts + lib/reconcileSpeakers.ts) — recorded in the
 * debug manifest and folded into speaker-stage cache keys. */
export const MAPPING_ALGORITHM_VERSION = 'map-v2/reconcile-v1';

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

/** DEFAULT for settings.cleanupParallelChunks — how many cleanup-pass chunk
 * requests run in flight at once (lib/concurrency.ts's mapWithConcurrency in
 * useTranscriberPipeline.ts). 6 assumes a paid-tier Gemini key (whose RPM
 * limits are far above what 6 slow correction calls can generate); drop it
 * in Settings if a free-tier key starts returning 429s. */
export const CLEANUP_PARALLEL_CHUNK_REQUESTS = 6;

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

/** DEFAULT for settings.openaiParallelChunks — how many preprocessed-chunk
 * transcription requests run in flight at once
 * (lib/providers/openaiProvider.ts's chunked path). Bounded mainly by the
 * upload side: chunks are ~20 MB each and share one uplink, so past a few
 * concurrent requests the extra parallelism just splits the same bandwidth
 * rather than finishing sooner. */
export const OPENAI_PARALLEL_CHUNK_REQUESTS = 4;

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
 * cost of a pitch shift — default/min/max for settings.openaiSpeedFactor.
 * Default is 1.0 (no speed-up): the pitch shift measurably hurts diarization
 * and word accuracy on long recordings, so speed-up is now opt-in. A user's
 * previously saved value (including an explicit 1.2) is preserved by the
 * settings store — only the default for fresh settings changed. */
export const OPENAI_SPEED_FACTOR_DEFAULT = 1.0;
export const OPENAI_SPEED_FACTOR_MIN = 1.0;
export const OPENAI_SPEED_FACTOR_MAX = 1.5;

/** Audio overlap carried into the START of every OpenAI chunk after the
 * first, in FINAL-time seconds (post-silence-removal, post-speed-up). The
 * overlap region is transcribed by BOTH neighboring chunks: the earlier
 * chunk's core owns the text; the later chunk's duplicate transcription of
 * the same speech is matched against it to link chunk-local speaker
 * identities across the boundary (lib/reconcileSpeakers.ts's overlap
 * evidence), then deterministically dropped so no duplicate text survives
 * (lib/preprocessAudioPlan.ts's combineChunkResponses). ~10s sits in the
 * task's 8-12s target band while costing <1% extra audio per 20-minute chunk. */
export const OPENAI_CHUNK_OVERLAP_SECONDS = 10;

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

/* ------------------------------------------------------------ */
/* CONFIGURATION: speaker confidence policy (centralized)        */
/* ------------------------------------------------------------ */

/** At or above this confidence a speaker assignment applies automatically. */
export const SPEAKER_ASSIGN_MIN_CONFIDENCE = 0.9;
/** In [candidate, assign) the best known-name candidate is retained (and
 * offered to the repair stage) but the segment displays unresolved. */
export const SPEAKER_CANDIDATE_MIN_CONFIDENCE = 0.7;

/** Confidence of a provider label that exactly matched a known name.
 * EXACT_NAME_CONFIDENCE_WITH_CLIPS applies only when acoustic reference
 * clips were ACCEPTED for the request (mappingSource 'acoustic') — a real
 * acoustic anchor that resolves a segment immediately on its own.
 * EXACT_NAME_CONFIDENCE applies to every other exact match (no accepted
 * clips for OpenAI, or any Gemini match — Gemini has no acoustic
 * verification at all): the model's own labeling, not a verified identity
 * (mappingSource 'provider-exact'). Never resolves a segment by itself —
 * see lib/reconcileSpeakers.ts, which only lets ANCHOR-tier evidence
 * (acoustic, repair, user, or a prior reconciliation) cross the auto-assign
 * threshold; a 'provider-exact' candidate needs independent corroboration
 * (an overlap/continuity link to an acoustic anchor, a user confirmation,
 * or the repair stage) to actually resolve. */
export const EXACT_NAME_CONFIDENCE_WITH_CLIPS = 0.98;
export const EXACT_NAME_CONFIDENCE = 0.95;
/** Confidence of a first-appearance positional mapping (anonymous label ->
 * supplied name) — a guess, never an anchor, regardless of which chunk it
 * came from. Same PRIOR-tier treatment as EXACT_NAME_CONFIDENCE without
 * clips in lib/reconcileSpeakers.ts: never resolves a segment alone. */
export const POSITIONAL_CONFIDENCE = 0.9;
/** Reconciliation further discounts a LATER chunk's positional guess versus
 * the first chunk's — first-appearance order in a later chunk is exactly
 * the signal that swaps speakers at chunk boundaries, so it contributes
 * even weaker prior evidence than a first-chunk guess. */
export const POSITIONAL_LATER_CHUNK_CONFIDENCE = 0.75;

/** Cross-chunk continuity evidence scores (candidate band by design — never
 * enough for an automatic assignment on their own). */
export const OVERLAP_MATCH_CONFIDENCE = 0.95;
export const ADJACENT_CONTINUITY_CONFIDENCE = 0.75;
export const SHORT_GAP_CONTINUITY_CONFIDENCE = 0.7;
/** Gap thresholds (ORIGINAL-time seconds) for the two continuity signals. */
export const ADJACENT_CONTINUITY_MAX_GAP_SECONDS = 2;
export const SHORT_GAP_CONTINUITY_MAX_GAP_SECONDS = 10;
/** Two candidates both at/above the candidate threshold and closer than
 * this margin are conflicting evidence — the identity stays unresolved. */
export const SPEAKER_CONFLICT_MARGIN = 0.2;

/* ------------------------------------------------------------ */
/* CONFIGURATION: speaker quality gate + targeted repair         */
/* ------------------------------------------------------------ */

/** Quality-gate windows (lib/speakerQuality.ts) are this long. */
export const QUALITY_WINDOW_SECONDS = 300;
/** Repair triggers: overall unresolved words %, any single window's
 * unresolved %, any contiguous unresolved run's duration. */
export const REPAIR_TRIGGER_OVERALL_UNRESOLVED_PERCENT = 2;
export const REPAIR_TRIGGER_WINDOW_UNRESOLVED_PERCENT = 10;
export const REPAIR_TRIGGER_UNRESOLVED_RUN_SECONDS = 30;

/** Default Gemini model for the targeted speaker-repair stage — the cheapest
 * registered Flash-Lite model; escalation for still-unresolved segments uses
 * SPEAKER_REPAIR_ESCALATION_MODEL. Both must be members of
 * AVAILABLE_GEMINI_MODELS (app/lib/aiModels.ts). */
export const SPEAKER_REPAIR_GEMINI_MODEL: GeminiModelId = 'gemini-2.5-flash-lite';
export const SPEAKER_REPAIR_ESCALATION_MODEL: GeminiModelId = 'gemini-2.5-flash';
/** Repair patches below this confidence are not applied. */
export const SPEAKER_REPAIR_APPLY_MIN_CONFIDENCE = 0.9;
/** Caps for one repair request: how many target segments, and how many
 * resolved context segments are included on each side of a target run. */
export const SPEAKER_REPAIR_MAX_TARGETS_PER_REQUEST = 80;
export const SPEAKER_REPAIR_CONTEXT_SEGMENTS = 3;
/** Version of the repair prompt/response schema — folds into its cache key. */
export const SPEAKER_REPAIR_PROMPT_VERSION = 1;

/* ------------------------------------------------------------ */
/* CONFIGURATION: argument classification + range export         */
/* ------------------------------------------------------------ */

/** Default Gemini model for the argument-classification stage — the cheapest
 * registered Flash-Lite model. Must be a member of AVAILABLE_GEMINI_MODELS. */
export const ARGUMENT_CLASSIFIER_GEMINI_MODEL: GeminiModelId = 'gemini-2.5-flash-lite';
/** Classification windows: blocks per request window and how many trailing
 * blocks repeat at the start of the next window as shared context. */
export const CLASSIFY_BLOCKS_PER_WINDOW = 40;
export const CLASSIFY_WINDOW_OVERLAP_BLOCKS = 6;
/** An exceptionally long turn is split into parts of at most this many
 * characters for classification input only — the tag still applies to the
 * whole block (parts share the block id and aggregate deterministically). */
export const CLASSIFY_MAX_BLOCK_CHARS = 1500;
/** A core tag (argument_conflict / repair_attempt / emotional_support) on
 * any PART of a split long turn at or above this confidence makes the whole
 * parent block conflict-relevant — a neutral part at even higher confidence
 * must never erase it (lib/argumentClassify.ts's conflict-sensitive parent
 * aggregation). */
export const CLASSIFY_CORE_TAG_MIN_CONFIDENCE = 0.6;
/** Version of the classification prompt/response schema — folds into its cache key. */
export const CLASSIFY_PROMPT_VERSION = 1;

/** How far an argument range extends before/after each core-tagged block,
 * in seconds — default for settings.argumentExpandSeconds. */
export const ARGUMENT_EXPAND_SECONDS_DEFAULT = 90;

/** Version of the sparse text-correction prompt/response schema — folds into
 * the cleanup cache key. */
export const CORRECTION_PROMPT_VERSION = 2;

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
