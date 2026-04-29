// ─── Central AI configuration ──────────────────────────────────────────────
// Change GEMINI_MODEL here once to update every AI route on the site.
//
// Find the exact model ID for your tier at:
//   https://ai.google.dev/models/gemini
//
// Common free-tier IDs:
//   gemini-2.0-flash-lite   ← default (fast, free, good quality)
//   gemini-2.0-flash        ← slightly better quality, still free tier
//
// Paid / higher quota:
//   gemini-1.5-pro
//   gemini-2.5-pro-preview-* (check docs for the exact versioned ID)
//
// The model name must match the API exactly — copy it from the docs, not the
// marketing name.  e.g. "Gemini 2.0 Flash Lite" → "gemini-2.0-flash-lite"

export const GEMINI_MODEL = 'gemini-2.0-flash-lite';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export function geminiEndpoint(apiKey: string): string {
  return `${API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
}
