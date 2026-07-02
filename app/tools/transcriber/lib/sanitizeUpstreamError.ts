// Shared server-safe sanitizer for upstream (OpenAI/Gemini) error bodies
// before they're echoed back in an API response or shown in the client's
// error-recovery panel. Pure and side-effect-free so it's usable from both
// Edge routes and browser-side provider modules.

/* ------------------------------------------------------------ */
/* CONFIGURATION: redaction patterns + max length                */
/* ------------------------------------------------------------ */

/** OpenAI-style secret keys, e.g. `sk-abc123...`. */
const OPENAI_KEY_PATTERN = /sk-[A-Za-z0-9]{10,}/g;
/** Google/Gemini-style API keys, e.g. `AIzaSyAbc123...`. */
const GOOGLE_KEY_PATTERN = /AIza[0-9A-Za-z_-]{10,}/g;
/** `?key=...` / `&key=...` query-param values (Gemini's REST auth style). */
const KEY_QUERY_PARAM_PATTERN = /([?&]key=)[^&\s"'<>]+/gi;

/** Never let an upstream error body balloon the response — 500 chars is plenty for diagnostics. */
const MAX_SANITIZED_LENGTH = 500;

/**
 * Redacts known secret shapes from an upstream error body and truncates it.
 * Never throws; a null/undefined/non-string input returns an empty string.
 */
export function sanitizeUpstreamError(text: unknown): string {
  if (typeof text !== 'string' || text.length === 0) return '';

  return text
    .replace(OPENAI_KEY_PATTERN, 'sk-***')
    .replace(GOOGLE_KEY_PATTERN, 'AIza***')
    .replace(KEY_QUERY_PARAM_PATTERN, '$1***')
    .slice(0, MAX_SANITIZED_LENGTH);
}
