/**
 * Title resolver pipeline.
 *
 * 1. Normalize + build query variants
 * 2. Search providers in parallel (TMDb, AniList, Jikan, TVMaze)
 * 3. Score and merge candidates
 * 4. Auto-resolve if clear winner, else disambiguate or expand with Gemini
 * 5. Gemini title expansion if needed (once, capped)
 */

import {
  searchTmdbCandidates,
  searchAnilistCandidates,
  searchJikanCandidates,
  searchTvMazeCandidates,
  searchAnilistByCharacter,
  fetchTmdbDetails,
} from './mediaMetadata';
import { deriveBaseVibesFromMetadata, normalizeDescription } from './vibeDerivation';
import type {
  MetadataCandidate,
  ScoredCandidate,
  ClassifyResponse,
  ResolvedClassification,
  DisambiguationOption,
  GeminiExpansionResult,
  MetadataSource,
  MediaKind,
} from './classifyTypes';
import type { ShowType } from '../types';
import type { VibeCategory } from './vibeCategories';
import { VIBE_CATEGORIES } from './vibeCategories';
import { callGemini, CLASSIFY_TEMPERATURE } from '../../../lib/aiConfig';

// ─── config (edit here) ───────────────────────────────────────────────────────

export const MAX_DISAMBIGUATION_OPTIONS = 5;
export const MAX_GEMINI_TITLE_CANDIDATES = 5;
export const ENABLE_GEMINI_TITLE_EXPANSION = true;
export const ENABLE_GEMINI_METADATA_REFINEMENT = false;

// Score thresholds
const AUTO_RESOLVE_MIN_SCORE = 0.72;
const AUTO_RESOLVE_GAP = 0.18; // top must lead #2 by at least this much
const WEAK_SCORE_THRESHOLD = 0.35;

// ─── normalisation ────────────────────────────────────────────────────────────

export function normalizeTitleQuery(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/["""]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s'\-:.!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a few simple variants to widen provider search coverage. */
export function buildQueryVariants(normalized: string): string[] {
  const variants = new Set<string>([normalized]);
  // remove common suffixes that users add
  const noSuffix = normalized.replace(/\s+(anime|manga|movie|film|series|show|tv)$/i, '').trim();
  if (noSuffix && noSuffix !== normalized) variants.add(noSuffix);
  // remove year in parens e.g. "dune (2021)"
  const noYear = normalized.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  if (noYear && noYear !== normalized) variants.add(noYear);
  return Array.from(variants);
}

// ─── scoring ──────────────────────────────────────────────────────────────────

function normalizedStr(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** Levenshtein distance (capped for performance). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length > 60 || b.length > 60) return Math.abs(a.length - b.length) + 1;
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function titleSimilarity(query: string, candidate: string): number {
  const q = normalizedStr(query);
  const c = normalizedStr(candidate);
  if (q === c) return 1.0;
  if (c.startsWith(q) || q.startsWith(c)) return 0.92;
  if (c.includes(q) || q.includes(c)) return 0.80;
  const dist = levenshtein(q, c);
  const maxLen = Math.max(q.length, c.length);
  if (maxLen === 0) return 1.0;
  return Math.max(0, 1 - dist / maxLen);
}

// Provider quality weights (0–1, relative)
const SOURCE_WEIGHTS: Record<MetadataSource, number> = {
  tmdb: 0.95,
  anilist: 0.95,
  jikan: 0.80,
  tvmaze: 0.75,
};

export function scoreCandidate(
  candidate: MetadataCandidate,
  query: string,
  typeHint: ShowType | null,
  typeHintWasUserSelected: boolean,
): number {
  const q = normalizeTitleQuery(query);

  // Title match against all available title fields
  const titles = [
    candidate.title,
    candidate.originalTitle ?? '',
  ].filter(Boolean);
  const bestTitleSim = Math.max(...titles.map((t) => titleSimilarity(q, t)));

  let score = bestTitleSim * 0.60; // title match is the dominant signal

  // Source quality bonus
  score += SOURCE_WEIGHTS[candidate.source] * 0.10;

  // Popularity bonus (log-normalised, capped)
  if (candidate.popularity && candidate.popularity > 0) {
    const popBonus = Math.min(Math.log10(candidate.popularity + 1) / 7, 1) * 0.08;
    score += popBonus;
  }

  // Type hint (only when user explicitly selected it)
  if (typeHint && typeHintWasUserSelected) {
    if (candidate.derivedType === typeHint) score += 0.12;
    else if (candidate.derivedType !== typeHint) score -= 0.05;
  }

  // Penalise Gemini-expanded candidates slightly
  if (candidate.fromGeminiExpansion) score -= 0.05;

  return Math.min(Math.max(score, 0), 1);
}

// ─── dedup ────────────────────────────────────────────────────────────────────

/** Prefer higher-confidence, same source+id collapses. Keep best per (source, sourceId). */
export function mergeAndDedupeCandidates(
  candidates: ScoredCandidate[],
): ScoredCandidate[] {
  const map = new Map<string, ScoredCandidate>();
  for (const c of candidates) {
    const key = `${c.source}:${c.sourceId}`;
    const existing = map.get(key);
    if (!existing || c.score > existing.score) map.set(key, c);
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score);
}

// ─── auto-resolve / disambiguation logic ─────────────────────────────────────

export function shouldAutoResolve(sorted: ScoredCandidate[]): boolean {
  if (sorted.length === 0) return false;
  const top = sorted[0];
  if (top.score < AUTO_RESOLVE_MIN_SCORE) return false;
  if (sorted.length === 1) return true;
  const gap = top.score - sorted[1].score;
  return gap >= AUTO_RESOLVE_GAP;
}

export function shouldDisambiguate(sorted: ScoredCandidate[]): boolean {
  if (sorted.length === 0) return false;
  return sorted[0].score >= WEAK_SCORE_THRESHOLD;
}

// ─── Gemini expansion ─────────────────────────────────────────────────────────

export async function expandTitleWithGemini(
  userQuery: string,
  geminiKey: string,
): Promise<GeminiExpansionResult> {
  const prompt =
    `A user typed this into a watchlist app: "${userQuery}"\n\n` +
    `They might have misspelled, used an alternate title, or entered a character name.\n` +
    `Return up to ${MAX_GEMINI_TITLE_CANDIDATES} likely search queries as JSON.\n\n` +
    `Format:\n` +
    `{"candidates":[{"title":"...","reason":"...","mediaKindHint":"tv"|"movie","preferredSources":["tmdb","anilist","jikan","tvmaze"]}]}\n\n` +
    `Rules:\n` +
    `- Only return real titles you are confident about.\n` +
    `- Do NOT invent plot details or descriptions.\n` +
    `- Return JSON only, no prose.`;

  try {
    const raw = await callGemini(prompt, geminiKey, CLASSIFY_TEMPERATURE);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { candidates: [] };
    const parsed = JSON.parse(match[0]) as GeminiExpansionResult;
    if (!Array.isArray(parsed.candidates)) return { candidates: [] };
    return { candidates: parsed.candidates.slice(0, MAX_GEMINI_TITLE_CANDIDATES) };
  } catch {
    return { candidates: [] };
  }
}

// ─── build final resolved output ─────────────────────────────────────────────

const VALID_VIBES = new Set<string>(VIBE_CATEGORIES);

function toDisambiguationOption(c: ScoredCandidate): DisambiguationOption {
  return {
    source: c.source,
    sourceId: c.sourceId,
    title: c.title,
    originalTitle: c.originalTitle,
    year: c.year,
    mediaKind: c.mediaKind,
    derivedType: c.derivedType,
    overview: c.overview,
    confidence: c.score,
  };
}

export async function buildResolvedClassification(
  candidate: MetadataCandidate,
  tmdbApiKey?: string,
): Promise<ResolvedClassification> {
  // Try to enrich with full details (genres, etc.) if we have a TMDb key
  let enriched: Partial<MetadataCandidate> = {};
  if (candidate.source === 'tmdb' && tmdbApiKey) {
    enriched = await fetchTmdbDetails(candidate.sourceId, candidate.mediaKind as MediaKind, tmdbApiKey);
  }

  const merged: MetadataCandidate = { ...candidate, ...enriched };

  const vibesRaw = deriveBaseVibesFromMetadata({
    genres: merged.genres,
    overview: merged.overview,
    derivedType: merged.derivedType,
  });
  const vibes = vibesRaw.filter((v): v is VibeCategory => VALID_VIBES.has(v));

  return {
    status: 'resolved',
    canonicalTitle: merged.title,
    type: merged.derivedType,
    vibes,
    description: normalizeDescription(merged.overview),
    source: merged.source,
    sourceId: merged.sourceId,
    confidence: merged.confidence,
  };
}

// ─── main pipeline ────────────────────────────────────────────────────────────

export interface ResolveOptions {
  title: string;
  typeHint?: ShowType | null;
  typeHintWasUserSelected?: boolean;
  tmdbApiKey?: string;
  geminiApiKey?: string;
}

export async function resolveTitle(opts: ResolveOptions): Promise<ClassifyResponse> {
  const {
    title,
    typeHint = null,
    typeHintWasUserSelected = false,
    tmdbApiKey,
    geminiApiKey,
  } = opts;

  const normalized = normalizeTitleQuery(title);
  const variants = buildQueryVariants(normalized);
  const primaryQuery = variants[0];

  // ── Step 1: parallel provider search ──────────────────────────────────────
  const candidates = await searchMetadataCandidates(
    primaryQuery,
    typeHint,
    typeHintWasUserSelected,
    tmdbApiKey,
  );

  // ── Step 2: score and sort ─────────────────────────────────────────────────
  let sorted = scoreAndSort(candidates, primaryQuery, typeHint, typeHintWasUserSelected);

  // ── Step 3: auto-resolve if clear winner ──────────────────────────────────
  if (shouldAutoResolve(sorted)) {
    const best = { ...sorted[0], confidence: sorted[0].score };
    return buildResolvedClassification(best, tmdbApiKey);
  }

  // ── Step 4: Gemini expansion if no good candidates ────────────────────────
  if (!shouldDisambiguate(sorted) && ENABLE_GEMINI_TITLE_EXPANSION && geminiApiKey) {
    const expansion = await expandTitleWithGemini(title, geminiApiKey);
    if (expansion.candidates.length > 0) {
      const expandedCandidates = await searchMetadataCandidatesFromExpansion(
        expansion.candidates,
        typeHint,
        typeHintWasUserSelected,
        tmdbApiKey,
      );
      const combined = mergeAndDedupeCandidates([
        ...sorted,
        ...expandedCandidates,
      ]);
      sorted = combined;

      if (shouldAutoResolve(sorted)) {
        const best = { ...sorted[0], confidence: sorted[0].score };
        return buildResolvedClassification(best, tmdbApiKey);
      }
    }
  }

  // ── Step 5: disambiguation list or not-found ───────────────────────────────
  if (shouldDisambiguate(sorted)) {
    const options = sorted
      .slice(0, MAX_DISAMBIGUATION_OPTIONS)
      .map(toDisambiguationOption);
    return {
      status: 'needs_selection',
      message: "I found a few possible matches. Which one did you mean?",
      options,
    };
  }

  return {
    status: 'not_found',
    message: "I couldn't confidently find that title. Try adding a year or a few more words.",
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function searchMetadataCandidates(
  query: string,
  typeHint: ShowType | null,
  typeHintWasUserSelected: boolean,
  tmdbApiKey?: string,
): Promise<MetadataCandidate[]> {
  const searches: Promise<MetadataCandidate[]>[] = [
    searchAnilistCandidates(query),
    searchAnilistByCharacter(query),
    searchJikanCandidates(query),
    searchTvMazeCandidates(query),
  ];
  if (tmdbApiKey) searches.push(searchTmdbCandidates(query, tmdbApiKey));

  const results = await Promise.allSettled(searches);
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

async function searchMetadataCandidatesFromExpansion(
  geminiCandidates: GeminiExpansionResult['candidates'],
  typeHint: ShowType | null,
  typeHintWasUserSelected: boolean,
  tmdbApiKey?: string,
): Promise<ScoredCandidate[]> {
  const allCandidates: MetadataCandidate[] = [];

  await Promise.allSettled(
    geminiCandidates.map(async (gc) => {
      const q = normalizeTitleQuery(gc.title);
      const raw = await searchMetadataCandidates(q, typeHint, typeHintWasUserSelected, tmdbApiKey);
      const tagged = raw.map((c) => ({ ...c, fromGeminiExpansion: true as const }));
      allCandidates.push(...tagged);
    }),
  );

  return scoreAndSort(allCandidates, geminiCandidates[0]?.title ?? '', typeHint, typeHintWasUserSelected);
}

function scoreAndSort(
  candidates: MetadataCandidate[],
  query: string,
  typeHint: ShowType | null,
  typeHintWasUserSelected: boolean,
): ScoredCandidate[] {
  const scored: ScoredCandidate[] = candidates.map((c) => ({
    ...c,
    score: scoreCandidate(c, query, typeHint, typeHintWasUserSelected),
  }));
  return mergeAndDedupeCandidates(scored);
}

// ─── direct resolve by source+id ─────────────────────────────────────────────

export async function resolveBySourceId(
  source: MetadataSource,
  sourceId: string,
  mediaKind: MediaKind,
  tmdbApiKey?: string,
): Promise<ResolvedClassification | null> {
  if (source === 'tmdb' && tmdbApiKey) {
    const details = await fetchTmdbDetails(sourceId, mediaKind, tmdbApiKey);
    if (!details.title) return null;
    const candidate: MetadataCandidate = {
      source: 'tmdb',
      sourceId,
      title: details.title ?? '',
      originalTitle: details.originalTitle,
      year: details.year,
      mediaKind,
      derivedType: details.derivedType ?? (mediaKind === 'movie' ? 'movie' : 'tv'),
      overview: details.overview ?? '',
      genres: details.genres ?? [],
      originCountries: details.originCountries ?? [],
      originalLanguage: details.originalLanguage,
      isAnimation: details.isAnimation ?? false,
      confidence: 1.0,
    };
    return buildResolvedClassification(candidate, tmdbApiKey);
  }
  return null;
}
