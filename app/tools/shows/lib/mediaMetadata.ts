/**
 * Provider search functions for TMDb, AniList, Jikan, TVMaze.
 * Each function returns MetadataCandidate[].
 * All errors are swallowed so Promise.allSettled callers see partial results.
 */

import { deriveShowType } from './showTypeDerivation';
import type { MetadataCandidate, MediaKind } from './classifyTypes';

// ─── config ──────────────────────────────────────────────────────────────────

export const PROVIDER_TIMEOUT_MS = 5_000;

// ─── helpers ─────────────────────────────────────────────────────────────────

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

// ─── TMDb ────────────────────────────────────────────────────────────────────

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

// Animation genre IDs on TMDb
const TMDB_ANIMATION_GENRE_ID = 16;

export async function searchTmdbCandidates(
  query: string,
  apiKey: string,
): Promise<MetadataCandidate[]> {
  const url =
    `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}` +
    `&query=${encodeURIComponent(query)}&page=1&include_adult=false`;

  let data: { results?: TmdbSearchResult[] };
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    data = await res.json();
  } catch {
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
      const derivedType = deriveShowType({
        mediaKind,
        isAnimation,
        originCountries,
        originalLanguage,
      });
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
      };
    })
    .filter((c) => c.title.length > 0);
}

/** Fetch full TMDb details (genres etc.) for a specific id. */
export async function fetchTmdbDetails(
  id: string,
  mediaKind: MediaKind,
  apiKey: string,
): Promise<Partial<MetadataCandidate>> {
  const endpoint = mediaKind === 'movie' ? 'movie' : 'tv';
  const url = `https://api.themoviedb.org/3/${endpoint}/${id}?api_key=${apiKey}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return {};
    const d = await res.json();
    const genres: string[] = Array.isArray(d.genres)
      ? d.genres.map((g: { name: string }) => g.name)
      : [];
    const originCountries: string[] =
      d.origin_country ?? (d.production_countries ?? []).map((c: { iso_3166_1: string }) => c.iso_3166_1);
    const originalLanguage: string | undefined = d.original_language;
    const isAnimation = genres.some((g) => g.toLowerCase() === 'animation');
    const derivedType = deriveShowType({
      mediaKind,
      isAnimation,
      originCountries,
      originalLanguage,
    });
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

// ─── AniList ─────────────────────────────────────────────────────────────────

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

type AniListFormat =
  | 'TV' | 'TV_SHORT' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC' | string;

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

function anilistToCandidate(m: AniListMedia): MetadataCandidate | null {
  const title = m.title.english ?? m.title.romaji ?? '';
  if (!title) return null;
  const format = m.format ?? 'TV';
  const mediaKind: MediaKind = format === 'MOVIE' ? 'movie' : 'tv';
  const country = m.countryOfOrigin ?? 'JP';
  const derivedType = deriveShowType({
    mediaKind,
    isAnimation: true,
    originCountries: [country],
    originalLanguage: country === 'JP' ? 'ja' : country === 'KR' ? 'ko' : 'zh',
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
    originalLanguage: country === 'JP' ? 'ja' : country === 'KR' ? 'ko' : 'zh',
    isAnimation: true,
    confidence: 0,
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
    return media.map(anilistToCandidate).filter((c): c is MetadataCandidate => c !== null);
  } catch {
    return [];
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
    return nodes.map(anilistToCandidate).filter((c): c is MetadataCandidate => c !== null);
  } catch {
    return [];
  }
}

// ─── Jikan (MyAnimeList) ─────────────────────────────────────────────────────

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

export async function searchJikanCandidates(query: string): Promise<MetadataCandidate[]> {
  const url = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=5&sfw=true`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = await res.json() as { data?: JikanAnime[] };
    const list = data.data ?? [];
    return list.map((a): MetadataCandidate => {
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
      };
    }).filter((c) => c.title.length > 0);
  } catch {
    return [];
  }
}

// ─── TVMaze ──────────────────────────────────────────────────────────────────

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

export async function searchTvMazeCandidates(query: string): Promise<MetadataCandidate[]> {
  const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = await res.json() as TvMazeSearchResult[];
    return data.slice(0, 5).map(({ show: s }): MetadataCandidate => {
      const country =
        s.network?.country?.code ?? s.webChannel?.country?.code ?? 'US';
      const isAnimation =
        (s.genres ?? []).some((g) => g.toLowerCase() === 'animation') ||
        s.type?.toLowerCase() === 'animation';
      const derivedType = deriveShowType({
        mediaKind: 'tv',
        isAnimation,
        originCountries: [country],
        originalLanguage: s.language?.toLowerCase().slice(0, 2) ?? 'en',
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
        originalLanguage: s.language?.toLowerCase().slice(0, 2) ?? 'en',
        isAnimation,
        confidence: 0,
      };
    }).filter((c) => c.title.length > 0);
  } catch {
    return [];
  }
}
