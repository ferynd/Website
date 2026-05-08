/**
 * Provider search + direct-by-ID functions for TMDb, AniList, Jikan, TVMaze.
 * Each function returns MetadataCandidate[].
 * All errors are swallowed so Promise.allSettled callers see partial results.
 *
 * TMDb requires a TmdbConfig (bearer token preferred, api_key fallback, or none).
 * AniList, Jikan, and TVMaze require no credentials.
 */

import { deriveShowType } from './showTypeDerivation';
import { buildTmdbRequest, hasTmdbCredentials } from './tmdbConfig';
import type { TmdbConfig } from './tmdbConfig';
import type { MetadataCandidate, MediaKind } from './classifyTypes';

// ─── config ──────────────────────────────────────────────────────────────────

export const PROVIDER_TIMEOUT_MS = 5_000;

// ─── fetch helper ─────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function yearFromDate(dateStr?: string): string | undefined {
  if (!dateStr) return undefined;
  return dateStr.slice(0, 4);
}

// ─── TMDb ─────────────────────────────────────────────────────────────────────

interface TmdbSearchResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  origin_country?: string[];
  original_language?: string;
  popularity?: number;
  media_type?: string;
}

const TMDB_ANIMATION_GENRE_ID = 16;

export async function searchTmdbCandidates(
  query: string,
  config: TmdbConfig,
): Promise<MetadataCandidate[]> {
  if (!hasTmdbCredentials(config)) return [];

  const path = `/search/multi?query=${encodeURIComponent(query)}&page=1&include_adult=false`;
  const { url, init } = buildTmdbRequest(path, config);

  let data: { results?: TmdbSearchResult[] };
  try {
    const res = await fetchWithTimeout(url, init);
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    // Intentionally not logging the URL to avoid exposing credentials
    return [];
  }

  const results = Array.isArray(data.results) ? data.results : [];
  return results
    .filter((r) => r.media_type === 'tv' || r.media_type === 'movie')
    .slice(0, 6)
    .map((r): MetadataCandidate => {
      const mediaKind: MediaKind = r.media_type === 'movie' ? 'movie' : 'tv';
      const isAnimation = (r.genre_ids ?? []).includes(TMDB_ANIMATION_GENRE_ID);
      const originCountries: string[] = r.origin_country ?? [];
      const originalLanguage = r.original_language;
      const derivedType = deriveShowType({ mediaKind, isAnimation, originCountries, originalLanguage });
      return {
        source: 'tmdb',
        sourceId: String(r.id),
        title: (r.title ?? r.name ?? '').trim(),
        originalTitle: (r.original_title ?? r.original_name ?? '').trim() || undefined,
        year: yearFromDate(r.release_date ?? r.first_air_date),
        mediaKind,
        derivedType,
        overview: (r.overview ?? '').trim(),
        genres: [],
        popularity: r.popularity,
        originCountries,
        originalLanguage,
        isAnimation,
        confidence: 0,
        matchedBy: 'title',
      };
    })
    .filter((c) => c.title.length > 0);
}

/** Fetch full TMDb details (with genres) for a specific ID. */
export async function fetchTmdbDetails(
  id: string,
  mediaKind: MediaKind,
  config: TmdbConfig,
): Promise<Partial<MetadataCandidate>> {
  if (!hasTmdbCredentials(config)) return {};

  const endpoint = mediaKind === 'movie' ? 'movie' : 'tv';
  const { url, init } = buildTmdbRequest(`/${endpoint}/${id}`, config);

  try {
    const res = await fetchWithTimeout(url, init);
    if (!res.ok) return {};
    const d = await res.json();
    const genres: string[] = Array.isArray(d.genres)
      ? d.genres.map((g: { name: string }) => g.name)
      : [];
    const originCountries: string[] =
      d.origin_country ??
      (d.production_countries ?? []).map((c: { iso_3166_1: string }) => c.iso_3166_1);
    const originalLanguage: string | undefined = d.original_language;
    const isAnimation = genres.some((g) => g.toLowerCase() === 'animation');
    const derivedType = deriveShowType({ mediaKind, isAnimation, originCountries, originalLanguage });
    return {
      genres,
      originCountries,
      originalLanguage,
      isAnimation,
      derivedType,
      overview: (d.overview ?? '').trim(),
      title: (d.title ?? d.name ?? '').trim(),
      originalTitle: (d.original_title ?? d.original_name ?? '').trim() || undefined,
      year: yearFromDate(d.release_date ?? d.first_air_date),
    };
  } catch {
    return {};
  }
}

// ─── AniList ──────────────────────────────────────────────────────────────────

const ANILIST_URL = 'https://graphql.anilist.co';

const ANILIST_SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 6) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      title { romaji english native }
      format
      description(asHtml: false)
      startDate { year }
      genres
      countryOfOrigin
      popularity
    }
  }
}`;

const ANILIST_BY_ID_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    format
    description(asHtml: false)
    startDate { year }
    genres
    countryOfOrigin
    popularity
  }
}`;

const ANILIST_CHARACTER_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 3) {
    characters(search: $search, sort: SEARCH_MATCH) {
      media(page: 1, perPage: 3) {
        nodes {
          id
          title { romaji english native }
          format
          description(asHtml: false)
          startDate { year }
          genres
          countryOfOrigin
          popularity
        }
      }
    }
  }
}`;

type AniListFormat = 'TV' | 'TV_SHORT' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC' | string;

interface AniListMedia {
  id: number;
  title: { romaji?: string; english?: string; native?: string };
  format?: AniListFormat;
  description?: string;
  startDate?: { year?: number };
  genres?: string[];
  countryOfOrigin?: string;
  popularity?: number;
}

function anilistToCandidate(
  m: AniListMedia,
  matchedBy: MetadataCandidate['matchedBy'] = 'title',
): MetadataCandidate | null {
  const title = m.title.english ?? m.title.romaji ?? '';
  if (!title) return null;
  const format = m.format ?? 'TV';
  const mediaKind: MediaKind = format === 'MOVIE' ? 'movie' : 'tv';
  const country = m.countryOfOrigin ?? 'JP';
  const lang = country === 'JP' ? 'ja' : country === 'KR' ? 'ko' : 'zh';
  const derivedType = deriveShowType({
    mediaKind,
    isAnimation: true,
    originCountries: [country],
    originalLanguage: lang,
  });
  return {
    source: 'anilist',
    sourceId: String(m.id),
    title,
    originalTitle: m.title.native ?? m.title.romaji ?? undefined,
    year: m.startDate?.year ? String(m.startDate.year) : undefined,
    mediaKind,
    derivedType,
    overview: stripHtml(m.description ?? '').slice(0, 400),
    genres: m.genres ?? [],
    popularity: m.popularity,
    originCountries: [country],
    originalLanguage: lang,
    isAnimation: true,
    confidence: 0,
    matchedBy,
  };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
}

async function anilistGraphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const res = await fetchWithTimeout(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function searchAnilistCandidates(query: string): Promise<MetadataCandidate[]> {
  try {
    const data = await anilistGraphql(ANILIST_SEARCH_QUERY, { search: query }) as {
      data?: { Page?: { media?: AniListMedia[] } };
    } | null;
    const media = data?.data?.Page?.media ?? [];
    return media.map((m) => anilistToCandidate(m, 'title')).filter((c): c is MetadataCandidate => c !== null);
  } catch {
    return [];
  }
}

/** Direct lookup by AniList numeric ID. */
export async function fetchAnilistById(id: string): Promise<MetadataCandidate | null> {
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return null;
  try {
    const data = await anilistGraphql(ANILIST_BY_ID_QUERY, { id: numId }) as {
      data?: { Media?: AniListMedia };
    } | null;
    const media = data?.data?.Media;
    if (!media) return null;
    return anilistToCandidate(media, 'title');
  } catch {
    return null;
  }
}

/** Character lookup — returns shows the character appears in. */
export async function searchAnilistByCharacter(query: string): Promise<MetadataCandidate[]> {
  try {
    const data = await anilistGraphql(ANILIST_CHARACTER_QUERY, { search: query }) as {
      data?: { Page?: { characters?: Array<{ media?: { nodes?: AniListMedia[] } }> } };
    } | null;
    const chars = data?.data?.Page?.characters ?? [];
    const nodes: AniListMedia[] = chars.flatMap((c) => c.media?.nodes ?? []);
    return nodes
      .map((m) => anilistToCandidate(m, 'character'))
      .filter((c): c is MetadataCandidate => c !== null);
  } catch {
    return [];
  }
}

// ─── Jikan (MyAnimeList) ──────────────────────────────────────────────────────

interface JikanAnime {
  mal_id: number;
  title: string;
  title_english?: string;
  synopsis?: string;
  year?: number;
  aired?: { from?: string };
  genres?: Array<{ name: string }>;
  type?: string;
  score?: number;
  members?: number;
}

function jikanToCandidate(a: JikanAnime): MetadataCandidate {
  const type = a.type ?? 'TV';
  const mediaKind: MediaKind = type === 'Movie' ? 'movie' : 'tv';
  const derivedType = deriveShowType({
    mediaKind,
    isAnimation: true,
    originCountries: ['JP'],
    originalLanguage: 'ja',
  });
  return {
    source: 'jikan',
    sourceId: String(a.mal_id),
    title: a.title_english ?? a.title,
    originalTitle: a.title,
    year: a.year ? String(a.year) : yearFromDate(a.aired?.from),
    mediaKind,
    derivedType,
    overview: (a.synopsis ?? '').replace(/\[Written by MAL Rewrite\]/gi, '').trim(),
    genres: (a.genres ?? []).map((g) => g.name),
    popularity: a.members,
    originCountries: ['JP'],
    originalLanguage: 'ja',
    isAnimation: true,
    confidence: 0,
    matchedBy: 'title',
  };
}

export async function searchJikanCandidates(query: string): Promise<MetadataCandidate[]> {
  const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=5&sfw=true`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = await res.json() as { data?: JikanAnime[] };
    return (data.data ?? []).map(jikanToCandidate).filter((c) => c.title.length > 0);
  } catch {
    return [];
  }
}

/** Direct lookup by MAL/Jikan numeric ID. */
export async function fetchJikanById(id: string): Promise<MetadataCandidate | null> {
  const url = `https://api.jikan.moe/v4/anime/${encodeURIComponent(id)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = await res.json() as { data?: JikanAnime };
    if (!data.data) return null;
    const c = jikanToCandidate(data.data);
    return c.title ? c : null;
  } catch {
    return null;
  }
}

// ─── TVMaze ───────────────────────────────────────────────────────────────────

interface TvMazeShow {
  id: number;
  name: string;
  type?: string;
  language?: string;
  genres?: string[];
  status?: string;
  premiered?: string;
  summary?: string;
  network?: { country?: { code?: string } };
  webChannel?: { country?: { code?: string } };
  rating?: { average?: number };
  weight?: number;
}

interface TvMazeSearchResult {
  score: number;
  show: TvMazeShow;
}

function tvmazeToCandidate(s: TvMazeShow): MetadataCandidate {
  const country = s.network?.country?.code ?? s.webChannel?.country?.code ?? 'US';
  const isAnimation =
    (s.genres ?? []).some((g) => g.toLowerCase() === 'animation') ||
    s.type?.toLowerCase() === 'animation';
  const originalLanguage = s.language?.toLowerCase().slice(0, 2) ?? 'en';
  const derivedType = deriveShowType({
    mediaKind: 'tv',
    isAnimation,
    originCountries: [country],
    originalLanguage,
  });
  return {
    source: 'tvmaze',
    sourceId: String(s.id),
    title: s.name,
    year: yearFromDate(s.premiered),
    mediaKind: 'tv',
    derivedType,
    overview: stripHtml(s.summary ?? ''),
    genres: s.genres ?? [],
    popularity: s.weight,
    originCountries: [country],
    originalLanguage,
    isAnimation,
    confidence: 0,
    matchedBy: 'title',
  };
}

export async function searchTvMazeCandidates(query: string): Promise<MetadataCandidate[]> {
  const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = await res.json() as TvMazeSearchResult[];
    return data.slice(0, 5).map(({ show }) => tvmazeToCandidate(show)).filter((c) => c.title.length > 0);
  } catch {
    return [];
  }
}

/** Direct lookup by TVMaze show ID. */
export async function fetchTvMazeById(id: string): Promise<MetadataCandidate | null> {
  const url = `https://api.tvmaze.com/shows/${encodeURIComponent(id)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = await res.json() as TvMazeShow;
    if (!data?.name) return null;
    return tvmazeToCandidate(data);
  } catch {
    return null;
  }
}

// Re-export for convenience
export type { TmdbConfig } from './tmdbConfig';
export { sanitizeTmdbUrl } from './tmdbConfig';
