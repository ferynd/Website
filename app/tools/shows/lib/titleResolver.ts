/**
 * Title resolver pipeline.
 *
 * 1. Normalize + build all query variants
 * 2. Search providers in parallel for every variant (TMDb, AniList, Jikan, TVMaze)
 * 3. Score candidates — each against the query variant that found them
 * 4. Auto-resolve if clear winner, else disambiguate or expand with Gemini
 * 5. Gemini title expansion (at most once per classify click, capped)
 * 6. Gemini expansion results are re-scored against their originating query
 */

import {
  searchTmdbCandidates,
  searchAnilistCandidates,
  searchJikanCandidates,
  searchTvMazeCandidates,
  searchAnilistByCharacter,
  fetchTmdbDetails,
} from './mediaMetadata';
import type { TmdbConfig } from './tmdbConfig';
import { hasTmdbCredentials } from './tmdbConfig';
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

// ─── config ───────────────────────────────────────────────────────────────────

export const MAX_DISAMBIGUATION_OPTIONS = 5;
export const MAX_GEMINI_TITLE_CANDIDATES = 5;
export const ENABLE_GEMINI_TITLE_EXPANSION = true;
export const ENABLE_GEMINI_METADATA_REFINEMENT = false;
export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Score thresholds
const AUTO_RESOLVE_MIN_SCORE = 0.72;
const AUTO_RESOLVE_GAP = 0.18;
const WEAK_SCORE_THRESHOLD = 0.35;
const CHARACTER_MATCH_BONUS = 0.22; // applied when matchedBy === 'character' and title sim is low

// ─── TTL cache ────────────────────────────────────────────────────────────────

interface CacheEntry<T> { value: T; expires: number }

class TtlCache<V> {
  private map = new Map<string, CacheEntry<V>>();

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) { this.map.delete(key); return undefined; }
    return entry.value;
  }

  set(key: string, value: V, ttl = CACHE_TTL_MS): void {
    this.map.set(key, { value, expires: Date.now() + ttl });
  }
}

// Module-level caches (per worker instance; gracefully reset on cold start)
const queryCache = new TtlCache<MetadataCandidate[]>();
const geminiCache = new TtlCache<GeminiExpansionResult>();

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

export function buildQueryVariants(normalized: string): string[] {
  const variants = new Set<string>([normalized]);
  const noSuffix = normalized.replace(/\s+(anime|manga|movie|film|series|show|tv)$/i, '').trim();
  if (noSuffix && noSuffix !== normalized) variants.add(noSuffix);
  const noYear = normalized.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  if (noYear && noYear !== normalized) variants.add(noYear);
  return Array.from(variants);
}

// ─── scoring ──────────────────────────────────────────────────────────────────

function normalizedStr(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

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
  const titles = [candidate.title, candidate.originalTitle ?? ''].filter(Boolean);
  const bestTitleSim = Math.max(...titles.map((t) => titleSimilarity(q, t)));

  let score = bestTitleSim * 0.60;
  score += SOURCE_WEIGHTS[candidate.source] * 0.10;

  if (candidate.popularity && candidate.popularity > 0) {
    const popBonus = Math.min(Math.log10(candidate.popularity + 1) / 7, 1) * 0.08;
    score += popBonus;
  }

  // Character match bonus: the user typed a character name, not the show title.
  // Boost the score so it clears the disambiguation threshold.
  if (candidate.matchedBy === 'character' && bestTitleSim < 0.30) {
    score += CHARACTER_MATCH_BONUS;
  }

  // Type hint — only applied when the user explicitly chose it.
  if (typeHint && typeHintWasUserSelected) {
    if (candidate.derivedType === typeHint) score += 0.12;
    else score -= 0.05;
  }

  // Gemini-expanded candidates get a small penalty (indirect signal).
  if (candidate.matchedBy === 'gemini_expansion') score -= 0.05;

  return Math.min(Math.max(score, 0), 1);
}

// ─── dedup ────────────────────────────────────────────────────────────────────

export function mergeAndDedupeCandidates(candidates: ScoredCandidate[]): ScoredCandidate[] {
  const map = new Map<string, ScoredCandidate>();
  for (const c of candidates) {
    const key = `${c.source}:${c.sourceId}`;
    const existing = map.get(key);
    if (!existing || c.score > existing.score) map.set(key, c);
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score);
}

// ─── auto-resolve / disambiguation ────────────────────────────────────────────

export function shouldAutoResolve(sorted: ScoredCandidate[]): boolean {
  if (sorted.length === 0) return false;
  const top = sorted[0];
  if (top.score < AUTO_RESOLVE_MIN_SCORE) return false;
  if (sorted.length === 1) return true;
  return (top.score - sorted[1].score) >= AUTO_RESOLVE_GAP;
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
  const cacheKey = `gemini:${normalizeTitleQuery(userQuery)}`;
  const cached = geminiCache.get(cacheKey);
  if (cached) return cached;

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
    if (!match) { geminiCache.set(cacheKey, { candidates: [] }); return { candidates: [] }; }
    const parsed = JSON.parse(match[0]) as GeminiExpansionResult;
    if (!Array.isArray(parsed.candidates)) { geminiCache.set(cacheKey, { candidates: [] }); return { candidates: [] }; }
    const result = { candidates: parsed.candidates.slice(0, MAX_GEMINI_TITLE_CANDIDATES) };
    geminiCache.set(cacheKey, result);
    return result;
  } catch {
    return { candidates: [] };
  }
}

// ─── resolved output builder ──────────────────────────────────────────────────

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
  tmdbConfig?: TmdbConfig,
): Promise<ResolvedClassification> {
  let enriched: Partial<MetadataCandidate> = {};
  if (candidate.source === 'tmdb' && tmdbConfig && hasTmdbCredentials(tmdbConfig)) {
    enriched = await fetchTmdbDetails(candidate.sourceId, candidate.mediaKind as MediaKind, tmdbConfig);
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
  tmdbConfig?: TmdbConfig;
  geminiApiKey?: string;
}

export async function resolveTitle(opts: ResolveOptions): Promise<ClassifyResponse> {
  const {
    title,
    typeHint = null,
    typeHintWasUserSelected = false,
    tmdbConfig,
    geminiApiKey,
  } = opts;

  const normalized = normalizeTitleQuery(title);
  const variants = buildQueryVariants(normalized);

  // ── Step 1: search all variants in parallel ──────────────────────────────
  const allCandidates = await searchAllVariants(variants, typeHint, typeHintWasUserSelected, tmdbConfig);

  // ── Step 2: score against each variant's originating query ───────────────
  // Already scored in searchAllVariants — just merge
  let sorted = mergeAndDedupeCandidates(allCandidates);

  // ── Step 3: auto-resolve if clear winner ────────────────────────────────
  if (shouldAutoResolve(sorted)) {
    const best = { ...sorted[0], confidence: sorted[0].score };
    return buildResolvedClassification(best, tmdbConfig);
  }

  // ── Step 4: Gemini expansion if no good candidates ───────────────────────
  if (!shouldDisambiguate(sorted) && ENABLE_GEMINI_TITLE_EXPANSION && geminiApiKey) {
    const expansion = await expandTitleWithGemini(title, geminiApiKey);
    if (expansion.candidates.length > 0) {
      const expandedScored = await searchAllGeminiExpansions(
        expansion.candidates,
        typeHint,
        typeHintWasUserSelected,
        tmdbConfig,
      );
      sorted = mergeAndDedupeCandidates([...sorted, ...expandedScored]);

      if (shouldAutoResolve(sorted)) {
        const best = { ...sorted[0], confidence: sorted[0].score };
        return buildResolvedClassification(best, tmdbConfig);
      }
    }
  }

  // ── Step 5: disambiguation or not-found ─────────────────────────────────
  if (shouldDisambiguate(sorted)) {
    return {
      status: 'needs_selection',
      message: 'I found a few possible matches. Which one did you mean?',
      options: sorted.slice(0, MAX_DISAMBIGUATION_OPTIONS).map(toDisambiguationOption),
    };
  }

  return {
    status: 'not_found',
    message: "I couldn't confidently find that title. Try adding a year or a few more words.",
  };
}

// ─── internal helpers ─────────────────────────────────────────────────────────

/**
 * Search all query variants and score each batch against its own variant query.
 * Returns a flat scored list (not yet deduped).
 */
async function searchAllVariants(
  variants: string[],
  typeHint: ShowType | null,
  typeHintWasUserSelected: boolean,
  tmdbConfig?: TmdbConfig,
): Promise<ScoredCandidate[]> {
  const batches = await Promise.allSettled(
    variants.map((v) => searchOneQuery(v, tmdbConfig)),
  );
  const scored: ScoredCandidate[] = [];
  variants.forEach((v, i) => {
    const result = batches[i];
    if (result.status !== 'fulfilled') return;
    for (const c of result.value) {
      scored.push({ ...c, score: scoreCandidate(c, v, typeHint, typeHintWasUserSelected) });
    }
  });
  return scored;
}

/** Run all providers for a single query string. Results are cached by query. */
async function searchOneQuery(
  query: string,
  tmdbConfig?: TmdbConfig,
): Promise<MetadataCandidate[]> {
  // Include credential mode so bearer, api_key, and none results don't cross-contaminate.
  const tmdbMode = tmdbConfig?.mode ?? 'none';
  const cacheKey = `q:${tmdbMode}:${query}`;
  const cached = queryCache.get(cacheKey);
  if (cached) return cached;

  const searches: Promise<MetadataCandidate[]>[] = [
    searchAnilistCandidates(query),
    searchAnilistByCharacter(query),
    searchJikanCandidates(query),
    searchTvMazeCandidates(query),
  ];
  if (tmdbConfig && hasTmdbCredentials(tmdbConfig)) {
    searches.push(searchTmdbCandidates(query, tmdbConfig));
  }

  const results = await Promise.allSettled(searches);
  const candidates = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  queryCache.set(cacheKey, candidates);
  return candidates;
}

/**
 * For each Gemini-expanded title candidate, run provider searches and score
 * each result against the Gemini candidate's title (its originating query).
 * This ensures relevance scoring is correct, not biased toward the first candidate.
 */
async function searchAllGeminiExpansions(
  geminiCandidates: GeminiExpansionResult['candidates'],
  typeHint: ShowType | null,
  typeHintWasUserSelected: boolean,
  tmdbConfig?: TmdbConfig,
): Promise<ScoredCandidate[]> {
  const allScored: ScoredCandidate[] = [];

  await Promise.allSettled(
    geminiCandidates.map(async (gc) => {
      const q = normalizeTitleQuery(gc.title);
      const raw = await searchOneQuery(q, tmdbConfig);
      // Tag as gemini_expansion and score against the originating Gemini query
      const scored: ScoredCandidate[] = raw.map((c) => ({
        ...c,
        matchedBy: 'gemini_expansion' as const,
        score: scoreCandidate(
          { ...c, matchedBy: 'gemini_expansion' },
          gc.title, // score against Gemini candidate title, not user's raw input
          typeHint,
          typeHintWasUserSelected,
        ),
      }));
      allScored.push(...scored);
    }),
  );

  return allScored;
}
