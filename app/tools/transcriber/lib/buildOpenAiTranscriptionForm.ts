// Pure builder for the OpenAI /v1/audio/transcriptions multipart form
// fields — everything except the file itself (the caller attaches that
// separately with its own filename/blob) — extracted out of
// app/api/transcriber/transcribe/route.ts so the request shape is
// unit-testable without a live upload.
//
// Relative imports here deliberately (see note at top of ../settings.ts) —
// this module is imported directly by vitest.

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
