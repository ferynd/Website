import {
  DEFAULT_RECOMMEND_GEMINI_MODEL,
  isGemini25Model,
  isGemini3Model,
  resolveGeminiModelId,
  type GeminiModelId,
} from './aiModels';

export * from './aiModels';

// Lower temperature for deterministic tasks (classification, title lookup) on 2.5 models.
export const CLASSIFY_TEMPERATURE = 0.2;
// Moderate temperature for creative/recommendation tasks on 2.5 models.
export const RECOMMEND_TEMPERATURE = 0.7;

export type GeminiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface GeminiRequestOptions {
  modelId?: GeminiModelId;
  temperature?: number;
  thinkingLevel?: GeminiThinkingLevel;
  /** Optional structured-output schema (Gemini's `responseSchema`), applied
   * alongside the JSON response mime type — constrains the model to the
   * given shape instead of relying on prompt instructions alone. */
  responseSchema?: unknown;
}

export const geminiEndpoint = (
  apiKey: string,
  modelId: GeminiModelId = DEFAULT_RECOMMEND_GEMINI_MODEL,
) => {
  const resolvedModelId = resolveGeminiModelId(modelId, DEFAULT_RECOMMEND_GEMINI_MODEL);
  return `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModelId}:generateContent?key=${apiKey}`;
};

// Shared Gemini JSON request builder. The app sends plain user text and expects JSON;
// no Gemini tools, grounding, URL context, code execution, file search, or function calling are configured here.
export function buildGeminiRequest(prompt: string, options: GeminiRequestOptions = {}) {
  const modelId = resolveGeminiModelId(options.modelId, DEFAULT_RECOMMEND_GEMINI_MODEL);
  const generationConfig: Record<string, unknown> = {
    responseMimeType: 'application/json',
  };

  if (isGemini25Model(modelId)) {
    generationConfig.temperature = options.temperature ?? RECOMMEND_TEMPERATURE;
  }

  if (isGemini3Model(modelId) && options.thinkingLevel) {
    generationConfig.thinkingConfig = { thinkingLevel: options.thinkingLevel };
  }

  if (options.responseSchema !== undefined) {
    generationConfig.responseSchema = options.responseSchema;
  }

  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig,
  };
}

/** Token usage reported by one Gemini call — fields only present when the
 * API's usageMetadata actually reported them; nothing is ever invented. */
export interface GeminiUsage {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
}

export interface GeminiCallResult {
  text: string;
  usage: GeminiUsage | null;
}

// Extracts the text response (plus usage metadata, when reported) from a
// Gemini API result. Throws with the actual error body if Gemini returned an
// error, so the calling route can surface it instead of a generic 502.
export async function callGeminiWithUsage(
  prompt: string,
  apiKey: string,
  options: GeminiRequestOptions = {},
): Promise<GeminiCallResult> {
  const modelId = resolveGeminiModelId(options.modelId, DEFAULT_RECOMMEND_GEMINI_MODEL);
  const res = await fetch(geminiEndpoint(apiKey, modelId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildGeminiRequest(prompt, { ...options, modelId })),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errorText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`Gemini returned no text. Full response: ${JSON.stringify(data)}`);
  }

  const meta = data?.usageMetadata;
  let usage: GeminiUsage | null = null;
  if (meta && typeof meta === 'object') {
    usage = { model: modelId };
    if (typeof meta.promptTokenCount === 'number') usage.inputTokens = meta.promptTokenCount;
    if (typeof meta.candidatesTokenCount === 'number') usage.outputTokens = meta.candidatesTokenCount;
    if (typeof meta.cachedContentTokenCount === 'number') usage.cachedTokens = meta.cachedContentTokenCount;
  }

  return { text, usage };
}

// Text-only wrapper kept for the existing call sites that don't need usage.
export async function callGemini(
  prompt: string,
  apiKey: string,
  options: GeminiRequestOptions = {},
): Promise<string> {
  const result = await callGeminiWithUsage(prompt, apiKey, options);
  return result.text;
}
