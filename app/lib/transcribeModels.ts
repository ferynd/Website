// OpenAI audio-transcription models available to the Transcriber tool.
//
// Only models that return segment-level timestamps are listed here — the
// pipeline chunks/stitches a long recording using each segment's start/end
// time, so a model that can't report those isn't usable regardless of other
// qualities. That currently rules out gpt-4o-transcribe/gpt-4o-mini-transcribe,
// which only support `json`/`text` response formats (no verbose_json, no
// timestamp_granularities).

export const AVAILABLE_TRANSCRIBE_MODELS = [
  {
    id: 'gpt-4o-transcribe-diarize',
    name: 'GPT-4o Transcribe (Diarize)',
    cost: '$0.006 / min — same price as Whisper-1',
    pros: 'Labels distinct speakers directly from the audio, so you don’t have to specify speaking order up front.',
    cons: 'Newer model; if it’s momentarily unavailable for a request, this tool automatically retries with Whisper-1 for that run.',
  },
  {
    id: 'whisper-1',
    name: 'Whisper-1',
    cost: '$0.006 / min',
    pros: 'Extremely well-established and reliable. Also used automatically as the fallback for the option above.',
    cons: 'No diarization — every segment starts labeled "Unknown"; the Gemini correction pass has to infer who’s speaking from your speaker names and context notes instead of real diarization.',
  },
] as const;

export type TranscribeModelId = (typeof AVAILABLE_TRANSCRIBE_MODELS)[number]['id'];

const TRANSCRIBE_MODEL_IDS = new Set<string>(AVAILABLE_TRANSCRIBE_MODELS.map((model) => model.id));

export function isTranscribeModelId(value: unknown): value is TranscribeModelId {
  return typeof value === 'string' && TRANSCRIBE_MODEL_IDS.has(value);
}

export function resolveTranscribeModelId(value: unknown, fallback: TranscribeModelId): TranscribeModelId {
  return isTranscribeModelId(value) ? value : fallback;
}

export function getTranscribeModelInfo(modelId: TranscribeModelId): (typeof AVAILABLE_TRANSCRIBE_MODELS)[number] {
  return AVAILABLE_TRANSCRIBE_MODELS.find((model) => model.id === modelId) ?? AVAILABLE_TRANSCRIBE_MODELS[0];
}

/** True when this model returns real per-speaker diarization (as opposed to a single "Unknown" speaker). */
export function modelSupportsDiarization(modelId: TranscribeModelId): boolean {
  return getTranscribeModelInfo(modelId).id === 'gpt-4o-transcribe-diarize';
}

export function readStoredTranscribeModel(
  storageKey: string,
  fallback: TranscribeModelId,
): TranscribeModelId {
  if (typeof window === 'undefined') return fallback;

  try {
    return resolveTranscribeModelId(window.localStorage.getItem(storageKey), fallback);
  } catch {
    return fallback;
  }
}

export function saveStoredTranscribeModel(storageKey: string, modelId: TranscribeModelId): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(storageKey, modelId);
  } catch {
    // Local model preferences are optional device settings.
  }
}
