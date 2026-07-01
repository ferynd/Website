export const AVAILABLE_GEMINI_MODELS = [
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    cost: '$1.50 input / $9.00 output per 1M tokens',
    note: 'Highest quality Flash option; best for difficult or nuanced runs.',
  },
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    cost: '$2.00 input / $12.00 output per 1M tokens',
    note: 'Most expensive reasoning option; use for testing or edge cases.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash-Lite',
    cost: '$0.25 input / $1.50 output per 1M tokens',
    note: 'Default for classification; fast and cost-effective for lightweight JSON tasks.',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    cost: '$1.25 input / $10.00 output per 1M tokens',
    note: 'Strong reasoning option; useful for comparison runs.',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    cost: '$0.30 input / $2.50 output per 1M tokens',
    note: 'Default for recommendations; best price-performance for this app.',
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    cost: '$0.10 input / $0.40 output per 1M tokens',
    note: 'Cheapest option; best for high-volume lightweight work.',
  },
] as const;

export type GeminiModelId = (typeof AVAILABLE_GEMINI_MODELS)[number]['id'];

export const DEFAULT_CLASSIFY_GEMINI_MODEL: GeminiModelId = 'gemini-3.1-flash-lite';
export const DEFAULT_RECOMMEND_GEMINI_MODEL: GeminiModelId = 'gemini-2.5-flash';

export const SHOWS_CLASSIFY_MODEL_STORAGE_KEY = 'shows_classify_model';
export const SHOWS_RECOMMEND_MODEL_STORAGE_KEY = 'shows_recommend_model';

const GEMINI_MODEL_IDS = new Set<string>(AVAILABLE_GEMINI_MODELS.map((model) => model.id));

export function isGeminiModelId(value: unknown): value is GeminiModelId {
  return typeof value === 'string' && GEMINI_MODEL_IDS.has(value);
}

export function resolveGeminiModelId(value: unknown, fallback: GeminiModelId): GeminiModelId {
  return isGeminiModelId(value) ? value : fallback;
}

export function geminiModelOptionLabel(model: (typeof AVAILABLE_GEMINI_MODELS)[number]): string {
  return `${model.name} — ${model.cost}`;
}

export function getGeminiModelName(modelId: GeminiModelId): string {
  return AVAILABLE_GEMINI_MODELS.find((model) => model.id === modelId)?.name ?? modelId;
}

export function readStoredGeminiModel(
  storageKey: string,
  fallback: GeminiModelId,
): GeminiModelId {
  if (typeof window === 'undefined') return fallback;

  try {
    return resolveGeminiModelId(window.localStorage.getItem(storageKey), fallback);
  } catch {
    return fallback;
  }
}

export function saveStoredGeminiModel(storageKey: string, modelId: GeminiModelId): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(storageKey, modelId);
  } catch {
    // Local model preferences are optional device settings.
  }
}

export function isGemini25Model(modelId: GeminiModelId): boolean {
  return modelId.startsWith('gemini-2.5-');
}

export function isGemini3Model(modelId: GeminiModelId): boolean {
  return modelId.startsWith('gemini-3.');
}

/**
 * Flash-family subset of AVAILABLE_GEMINI_MODELS usable for direct audio
 * transcription (Transcriber Phase 3) — Pro/reasoning models are excluded
 * since they're tuned for text reasoning, not tuned/priced for long-audio
 * ingestion. Listed ids are cross-checked against the catalog below (rather
 * than hand-duplicating labels/costs) so callers that want display copy look
 * it up via `AVAILABLE_GEMINI_MODELS`/`geminiModelOptionLabel`, which stay
 * the single source of truth. Order here is the one shown in the provider
 * picker (cheapest → most capable), not the catalog's declaration order.
 */
export const GEMINI_TRANSCRIBE_MODELS: GeminiModelId[] = (
  ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'] as const
).filter(isGeminiModelId);

const GEMINI_TRANSCRIBE_MODEL_IDS = new Set<GeminiModelId>(GEMINI_TRANSCRIBE_MODELS);

export function isGeminiTranscribeModel(value: unknown): value is GeminiModelId {
  return typeof value === 'string' && GEMINI_TRANSCRIBE_MODEL_IDS.has(value as GeminiModelId);
}
