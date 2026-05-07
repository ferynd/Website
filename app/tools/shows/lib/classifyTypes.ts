import type { ShowType } from '../types';
import type { VibeCategory } from './vibeCategories';

// ─── provider / source types ────────────────────────────────────────────────

export type MetadataSource = 'tmdb' | 'anilist' | 'jikan' | 'tvmaze';

export type MediaKind = 'tv' | 'movie';

// ─── raw candidate from any provider ────────────────────────────────────────

export interface MetadataCandidate {
  source: MetadataSource;
  sourceId: string;
  title: string;
  originalTitle?: string;
  year?: string;
  mediaKind: MediaKind;
  derivedType: ShowType;
  overview: string;
  /** genres as returned by the provider */
  genres: string[];
  /** provider-supplied popularity or vote count (used in scoring) */
  popularity?: number;
  /** ISO 3166-1 alpha-2 origin country codes e.g. ["JP","US"] */
  originCountries: string[];
  /** BCP 47 primary original language e.g. "ja", "en" */
  originalLanguage?: string;
  /** whether the provider tagged this as animation */
  isAnimation: boolean;
  confidence: number;
  /** true when this candidate came from a Gemini-expanded query, not the user's direct input */
  fromGeminiExpansion?: boolean;
}

// ─── scored candidate (after scoring pipeline) ──────────────────────────────

export interface ScoredCandidate extends MetadataCandidate {
  score: number;
}

// ─── disambiguation option surfaced to the UI ───────────────────────────────

export interface DisambiguationOption {
  source: MetadataSource;
  sourceId: string;
  title: string;
  originalTitle?: string;
  year?: string;
  mediaKind: MediaKind;
  derivedType: ShowType;
  overview: string;
  confidence: number;
}

// ─── classify API response shapes ───────────────────────────────────────────

export interface ResolvedClassification {
  status: 'resolved';
  canonicalTitle: string;
  type: ShowType;
  vibes: VibeCategory[];
  description: string;
  source: MetadataSource;
  sourceId: string;
  confidence: number;
}

export interface NeedsSelectionResponse {
  status: 'needs_selection';
  message: string;
  options: DisambiguationOption[];
}

export interface NotFoundResponse {
  status: 'not_found';
  message: string;
}

export type ClassifyResponse =
  | ResolvedClassification
  | NeedsSelectionResponse
  | NotFoundResponse;

// ─── request body shapes ─────────────────────────────────────────────────────

export interface ClassifyRequestBody {
  title: string;
  typeHint?: ShowType | null;
  typeHintWasUserSelected?: boolean;
}

export interface ResolveRequestBody {
  source: MetadataSource;
  sourceId: string;
}

// ─── Gemini expansion output ─────────────────────────────────────────────────

export interface GeminiTitleCandidate {
  title: string;
  reason?: string;
  mediaKindHint?: MediaKind;
  preferredSources?: MetadataSource[];
}

export interface GeminiExpansionResult {
  candidates: GeminiTitleCandidate[];
}
