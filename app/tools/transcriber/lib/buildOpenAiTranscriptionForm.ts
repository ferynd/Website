// Pure builder for the OpenAI /v1/audio/transcriptions multipart form
// fields — everything except the file itself (the caller attaches that
// separately with its own filename/blob) — extracted out of
// app/api/transcriber/transcribe/route.ts so the request shape is
// unit-testable without a live upload.
//
// Relative imports here deliberately (see note at top of ../settings.ts) —
// this module is imported directly by vitest.

/* ------------------------------------------------------------ */
/* CONFIGURATION: extension -> canonical upload MIME             */
/* ------------------------------------------------------------ */

/** Canonical multipart content types for the audio extensions OpenAI's
 * transcription endpoint documents as supported. Superset of
 * ACCEPTED_FILE_EXTENSIONS in ./constants.ts (OpenAI also takes flac/mp4/
 * mpga/oga, which other upload paths may hand this route). */
const OPENAI_EXTENSION_MIME_MAP: Record<string, string> = {
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'audio/mp4',
  '.mpeg': 'audio/mpeg',
  '.mpga': 'audio/mpeg',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};

/**
 * Resolves the multipart content type to send OpenAI for an uploaded audio
 * file. The file extension always wins over the browser-reported MIME for
 * known audio extensions: OS/browser MIME registries misreport real files
 * (observed: a valid .m4a reported as "audio/mpeg"), and forwarding that
 * mismatched type makes OpenAI 400 the upload as "corrupted or unsupported"
 * even though .m4a itself is supported. For unknown extensions the browser
 * MIME is kept as-is (generic/empty falls back to application/octet-stream).
 */
export function resolveOpenAiUploadMime(fileName: string, browserMime: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
  const canonical = OPENAI_EXTENSION_MIME_MAP[ext];
  if (canonical) return canonical;
  return browserMime && browserMime !== 'application/octet-stream' ? browserMime : 'application/octet-stream';
}

export interface OpenAiClipReference {
  name: string;
  /** Base64 data-URL string, e.g. "data:audio/wav;base64,...." — the shape OpenAI's known_speaker_references[] field expects. */
  dataUrl: string;
}

export interface BuildOpenAiTranscriptionEntriesInput {
  model: string;
  /** Whether `model` supports diarization (see app/lib/transcribeModels.ts) — both response_format and the known-speaker fields depend on this. */
  diarizes: boolean;
  /** Known-speaker reference clips — attached ONLY when `diarizes` is true AND this is non-empty. Whisper (diarizes: false) never gets these fields, regardless of what's passed here. */
  clips?: OpenAiClipReference[];
}

/**
 * Builds the ordered list of string form-field entries (model,
 * response_format/chunking or verbose-json fields, and optional parallel
 * known_speaker_names[]/known_speaker_references[] entries) for one OpenAI
 * transcription request. Returns a plain array of `[key, value]` tuples
 * (rather than a FormData instance) so it's trivially assertable in tests —
 * the caller is responsible for actually appending these to a FormData
 * alongside the file itself.
 */
export function buildOpenAiTranscriptionEntries(input: BuildOpenAiTranscriptionEntriesInput): [string, string][] {
  const { model, diarizes, clips = [] } = input;

  const entries: [string, string][] = [['model', model]];

  if (diarizes) {
    entries.push(['response_format', 'diarized_json'], ['chunking_strategy', 'auto']);
  } else {
    entries.push(['response_format', 'verbose_json'], ['timestamp_granularities[]', 'segment']);
  }

  if (diarizes && clips.length > 0) {
    for (const clip of clips) {
      entries.push(['known_speaker_names[]', clip.name]);
    }
    for (const clip of clips) {
      entries.push(['known_speaker_references[]', clip.dataUrl]);
    }
  }

  return entries;
}
