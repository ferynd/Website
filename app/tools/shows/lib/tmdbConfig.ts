/**
 * Server-only TMDb credential helper.
 *
 * Credentials are stored as Cloudflare Secrets (accessed via process.env on
 * the deployed edge runtime). Never import this in client-side code.
 *
 * Priority:
 *   1. TMDB_READ_ACCESS_TOKEN  → bearer auth (token in Authorization header, not URL)
 *   2. TMDB_API_KEY            → api_key query-param auth (legacy v3 style)
 *   3. neither present         → mode: 'none', TMDb searches are skipped
 */

export type TmdbConfig =
  | { mode: 'bearer'; token: string }
  | { mode: 'api_key'; apiKey: string }
  | { mode: 'none' };

const TMDB_BASE = 'https://api.themoviedb.org/3';

/** Read TMDb credentials from the runtime environment (Cloudflare Secrets). */
export function getTmdbConfig(): TmdbConfig {
  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  if (token) return { mode: 'bearer', token };
  const key = process.env.TMDB_API_KEY;
  if (key) return { mode: 'api_key', apiKey: key };
  return { mode: 'none' };
}

export function hasTmdbCredentials(config: TmdbConfig): boolean {
  return config.mode !== 'none';
}

/**
 * Build a fetch URL + RequestInit for a TMDb API path.
 *
 * - bearer mode:   token goes in `Authorization: Bearer …` header; path is used as-is
 * - api_key mode:  key is appended to the URL query string
 * - none mode:     returns a URL that will receive no auth (callers should guard with hasTmdbCredentials)
 */
export function buildTmdbRequest(
  path: string,
  config: TmdbConfig,
): { url: string; init: RequestInit } {
  if (config.mode === 'bearer') {
    return {
      url: `${TMDB_BASE}${path}`,
      init: {
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/json',
        },
      },
    };
  }
  if (config.mode === 'api_key') {
    const sep = path.includes('?') ? '&' : '?';
    return {
      url: `${TMDB_BASE}${path}${sep}api_key=${config.apiKey}`,
      init: {},
    };
  }
  // mode: 'none' — no credentials; callers should avoid calling this
  return { url: `${TMDB_BASE}${path}`, init: {} };
}

/**
 * Sanitize a TMDb URL for safe inclusion in logs or error messages.
 * Replaces the api_key value with *** so the key is never exposed.
 */
export function sanitizeTmdbUrl(url: string): string {
  return url.replace(/(api_key=)[^&\s]*/gi, '$1***');
}
