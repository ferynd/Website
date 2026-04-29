// Switch the model here. This affects every AI route in the app.
//
// Current free tier model IDs (as of April 2026):
//   gemini-2.5-flash-lite       Stable. 15 RPM, 1000 RPD. Recommended for this app.
//   gemini-2.5-flash            Stable. 10 RPM, 250 RPD. Better quality.
//   gemini-2.5-pro              Stable. 5 RPM, 100 RPD. Best reasoning.
//   gemini-3.1-flash-lite-preview   Preview. Stricter limits, may change.
//   gemini-3-flash-preview          Preview. Stricter limits, may change.
//
// Deprecated (do not use): gemini-2.0-flash, gemini-2.0-flash-lite (shut down June 1, 2026)
// Verify current model IDs at: https://ai.google.dev/gemini-api/docs/models

export const GEMINI_MODEL = 'gemini-2.5-flash-lite';

export const geminiEndpoint = (apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

// Standard request body shape for Gemini text generation.
// Includes role: "user" (required by 2.5+ models, was the cause of the 502 errors)
// and responseMimeType: "application/json" so Gemini returns clean JSON we can parse directly.
export function buildGeminiRequest(prompt: string) {
  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7,
    },
  };
}

// Extracts the text response from a Gemini API result.
// Throws with the actual error body if Gemini returned an error,
// so the calling route can surface it instead of a generic 502.
export async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch(geminiEndpoint(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildGeminiRequest(prompt)),
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
  return text;
}
