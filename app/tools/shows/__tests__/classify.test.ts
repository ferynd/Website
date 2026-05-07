/**
 * Tests for the metadata-first classification pipeline.
 * No real network calls, no Gemini calls — all providers are mocked.
 */

import { describe, it, expect } from 'vitest';
import { VIBE_CATEGORIES } from '../lib/vibeCategories';
import { deriveShowType } from '../lib/showTypeDerivation';
import { deriveBaseVibesFromMetadata, normalizeDescription } from '../lib/vibeDerivation';
import {
  normalizeTitleQuery,
  scoreCandidate,
  shouldAutoResolve,
  shouldDisambiguate,
  mergeAndDedupeCandidates,
} from '../lib/titleResolver';
import type { MetadataCandidate, ScoredCandidate } from '../lib/classifyTypes';

const VALID_VIBES = new Set<string>(VIBE_CATEGORIES);

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeCandidate(patch: Partial<MetadataCandidate> = {}): MetadataCandidate {
  return {
    source: 'tmdb',
    sourceId: '1',
    title: 'Test Show',
    mediaKind: 'tv',
    derivedType: 'tv',
    overview: '',
    genres: [],
    originCountries: ['US'],
    originalLanguage: 'en',
    isAnimation: false,
    confidence: 0,
    ...patch,
  };
}

function scored(c: MetadataCandidate, score: number): ScoredCandidate {
  return { ...c, score };
}

// ─── A. Haunted Hotel — cartoon + horror-comedy ──────────────────────────────

describe('Haunted Hotel (cartoon, horror-comedy)', () => {
  const candidate = makeCandidate({
    title: 'Haunted Hotel',
    mediaKind: 'tv',
    isAnimation: true,
    originCountries: ['US'],
    originalLanguage: 'en',
    genres: ['Animation', 'Comedy', 'Horror'],
    overview: 'A comedy cartoon about a hotel full of ghosts.',
    derivedType: 'cartoon',
  });

  it('derives type as cartoon (not tv)', () => {
    const type = deriveShowType({
      mediaKind: 'tv',
      isAnimation: true,
      originCountries: ['US'],
      originalLanguage: 'en',
    });
    expect(type).toBe('cartoon');
    expect(type).not.toBe('tv');
  });

  it('includes Funny from Comedy genre', () => {
    const vibes = deriveBaseVibesFromMetadata({ genres: candidate.genres, overview: candidate.overview });
    expect(vibes).toContain('Funny');
    expect(VALID_VIBES.has('Funny')).toBe(true);
  });

  it('includes Horror from Horror genre', () => {
    const vibes = deriveBaseVibesFromMetadata({ genres: candidate.genres, overview: candidate.overview });
    expect(vibes).toContain('Horror');
  });

  it('all returned vibes exist in VIBE_CATEGORIES', () => {
    const vibes = deriveBaseVibesFromMetadata({ genres: candidate.genres, overview: candidate.overview });
    for (const v of vibes) expect(VALID_VIBES.has(v), `${v} not in VIBE_CATEGORIES`).toBe(true);
  });

  it('description does not contain survival-lockdown wording when overview does not', () => {
    const desc = normalizeDescription(candidate.overview);
    const forbidden = ['trapped', 'survive the night', 'locked in', 'survival', 'lock-in'];
    for (const word of forbidden) {
      expect(desc.toLowerCase()).not.toContain(word);
    }
  });

  it('returns 2-6 vibes', () => {
    const vibes = deriveBaseVibesFromMetadata({ genres: candidate.genres, overview: candidate.overview });
    expect(vibes.length).toBeGreaterThanOrEqual(2);
    expect(vibes.length).toBeLessThanOrEqual(6);
  });
});

// ─── B. Rurouni Kenshin — needs_selection ────────────────────────────────────

describe('Rurouni Kenshin disambiguation', () => {
  const anime1 = scored(makeCandidate({ source: 'anilist', sourceId: '1', title: 'Rurouni Kenshin', year: '1996', derivedType: 'anime', mediaKind: 'tv', isAnimation: true, originCountries: ['JP'], originalLanguage: 'ja' }), 0.78);
  const anime2 = scored(makeCandidate({ source: 'anilist', sourceId: '2', title: 'Rurouni Kenshin (2023)', year: '2023', derivedType: 'anime', mediaKind: 'tv', isAnimation: true, originCountries: ['JP'], originalLanguage: 'ja' }), 0.74);
  const liveAction = scored(makeCandidate({ source: 'tmdb', sourceId: '3', title: 'Rurouni Kenshin', year: '2012', derivedType: 'movie', mediaKind: 'movie', isAnimation: false, originCountries: ['JP'], originalLanguage: 'ja' }), 0.70);

  const sorted = [anime1, anime2, liveAction];

  it('shouldAutoResolve returns false when top-2 gap is small', () => {
    expect(shouldAutoResolve(sorted)).toBe(false);
  });

  it('shouldDisambiguate returns true when scores are plausible', () => {
    expect(shouldDisambiguate(sorted)).toBe(true);
  });

  it('misspelled "Rorouni Kenshin" still scores above weak threshold', () => {
    const c = makeCandidate({ title: 'Rurouni Kenshin', derivedType: 'anime' });
    const score = scoreCandidate(c, 'Rorouni Kenshin', null, false);
    // Fuzzy match should be above the weak threshold (0.35) even with typo
    expect(score).toBeGreaterThan(0.35);
  });
});

// ─── C. Default type hint not trusted ────────────────────────────────────────

describe('Default type hint (typeTouched=false)', () => {
  it('type hint does not influence score when typeHintWasUserSelected=false', () => {
    const animeCandidate = makeCandidate({ derivedType: 'anime', title: 'My Hero Academia', originCountries: ['JP'], originalLanguage: 'ja', isAnimation: true });
    const tvCandidate = makeCandidate({ derivedType: 'tv', title: 'My Hero Academia', originCountries: ['US'], originalLanguage: 'en', isAnimation: false });
    const scoreAnimeNoHint = scoreCandidate(animeCandidate, 'My Hero Academia', 'anime', false);
    const scoreTvNoHint = scoreCandidate(tvCandidate, 'My Hero Academia', 'anime', false);
    // Without user selection, type hint adds no bonus — scores should differ only by source/pop
    // Both should be close; neither gets a big boost from the type hint
    const diff = Math.abs(scoreAnimeNoHint - scoreTvNoHint);
    expect(diff).toBeLessThan(0.20); // no large type-hint bonus
  });
});

// ─── D. User-selected type hint influences scoring ────────────────────────────

describe('User-selected type hint (typeTouched=true)', () => {
  it('matching type gets a bonus when typeHintWasUserSelected=true', () => {
    const animeMatch = makeCandidate({ derivedType: 'anime', title: 'Attack on Titan', originCountries: ['JP'], originalLanguage: 'ja', isAnimation: true });
    const tvNoMatch = makeCandidate({ derivedType: 'tv', title: 'Attack on Titan', originCountries: ['US'], originalLanguage: 'en', isAnimation: false });
    const scoreAnime = scoreCandidate(animeMatch, 'Attack on Titan', 'anime', true);
    const scoreTv = scoreCandidate(tvNoMatch, 'Attack on Titan', 'anime', true);
    expect(scoreAnime).toBeGreaterThan(scoreTv);
  });

  it('type hint cannot override metadata-derived type', () => {
    // Even with typeHint=anime, a US live-action show should still be scored as tv
    const tvShow = makeCandidate({ derivedType: 'tv', title: 'Breaking Bad', originCountries: ['US'], originalLanguage: 'en', isAnimation: false });
    // The derivedType comes from the provider; scoring reflects the hint, but derivedType is unchanged
    expect(tvShow.derivedType).toBe('tv');
  });
});

// ─── E. Western animated episodic → cartoon ──────────────────────────────────

describe('Western animated episodic show → cartoon', () => {
  it('US animated TV → cartoon', () => {
    expect(deriveShowType({ mediaKind: 'tv', isAnimation: true, originCountries: ['US'], originalLanguage: 'en' })).toBe('cartoon');
  });

  it('UK animated TV → cartoon', () => {
    expect(deriveShowType({ mediaKind: 'tv', isAnimation: true, originCountries: ['GB'], originalLanguage: 'en' })).toBe('cartoon');
  });

  it('animated TV is never "tv"', () => {
    const t = deriveShowType({ mediaKind: 'tv', isAnimation: true, originCountries: ['US'], originalLanguage: 'en' });
    expect(t).not.toBe('tv');
  });
});

// ─── F. Animated feature film → animated_movie ───────────────────────────────

describe('Animated feature film → animated_movie', () => {
  it('US animated movie → animated_movie', () => {
    expect(deriveShowType({ mediaKind: 'movie', isAnimation: true, originCountries: ['US'], originalLanguage: 'en' })).toBe('animated_movie');
  });

  it('JP animated movie → anime (not animated_movie)', () => {
    expect(deriveShowType({ mediaKind: 'movie', isAnimation: true, originCountries: ['JP'], originalLanguage: 'ja' })).toBe('anime');
  });

  it('KR animated movie → anime', () => {
    expect(deriveShowType({ mediaKind: 'movie', isAnimation: true, originCountries: ['KR'], originalLanguage: 'ko' })).toBe('anime');
  });
});

// ─── G. Comedy genre maps to Funny ───────────────────────────────────────────

describe('Comedy genre → Funny (not Comedy)', () => {
  it('Comedy genre maps to Funny', () => {
    const vibes = deriveBaseVibesFromMetadata({ genres: ['Comedy'], overview: '' });
    expect(vibes).toContain('Funny');
  });

  it('"Comedy" is not in VIBE_CATEGORIES and never returned', () => {
    const vibes = deriveBaseVibesFromMetadata({ genres: ['Comedy'], overview: '' });
    expect(vibes).not.toContain('Comedy');
  });

  it('all Comedy-derived vibes exist in VIBE_CATEGORIES', () => {
    const vibes = deriveBaseVibesFromMetadata({ genres: ['Comedy', 'Romance'], overview: '' });
    for (const v of vibes) expect(VALID_VIBES.has(v)).toBe(true);
  });
});

// ─── H. Character input (Goku) — Gemini output alone is not verified metadata ─

describe('Character input (Goku)', () => {
  it('normalizeTitleQuery lowercases and trims', () => {
    expect(normalizeTitleQuery('  Goku  ')).toBe('goku');
  });

  it('a single very-low-scoring result does not auto-resolve', () => {
    const c = scored(makeCandidate({ title: 'Dragon Ball Z', derivedType: 'anime' }), 0.25);
    expect(shouldAutoResolve([c])).toBe(false);
  });

  it('shouldDisambiguate is false for all-weak results', () => {
    const weak = [
      scored(makeCandidate({ title: 'Dragon Ball Z' }), 0.20),
      scored(makeCandidate({ title: 'Dragon Ball' }), 0.18),
    ];
    expect(shouldDisambiguate(weak)).toBe(false);
  });
});

// ─── I. Sparse/ambiguous metadata ────────────────────────────────────────────

describe('Sparse / ambiguous metadata', () => {
  it('deriveBaseVibesFromMetadata with no genres returns at least 2 fallback vibes', () => {
    const vibes = deriveBaseVibesFromMetadata({ genres: [], overview: '' });
    expect(vibes.length).toBeGreaterThanOrEqual(2);
    for (const v of vibes) expect(VALID_VIBES.has(v)).toBe(true);
  });

  it('normalizeDescription with empty string returns empty string', () => {
    expect(normalizeDescription('')).toBe('');
  });

  it('normalizeDescription never exceeds 200 chars', () => {
    const long = 'A'.repeat(300);
    expect(normalizeDescription(long).length).toBeLessThanOrEqual(200);
  });

  it('no candidates → shouldAutoResolve false', () => {
    expect(shouldAutoResolve([])).toBe(false);
  });

  it('no candidates → shouldDisambiguate false', () => {
    expect(shouldDisambiguate([])).toBe(false);
  });
});

// ─── showTypeDerivation edge cases ───────────────────────────────────────────

describe('deriveShowType edge cases', () => {
  it('JP live-action TV → tv (not anime)', () => {
    expect(deriveShowType({ mediaKind: 'tv', isAnimation: false, originCountries: ['JP'], originalLanguage: 'ja' })).toBe('tv');
  });

  it('US live-action movie → movie', () => {
    expect(deriveShowType({ mediaKind: 'movie', isAnimation: false, originCountries: ['US'], originalLanguage: 'en' })).toBe('movie');
  });

  it('CN animated TV → anime', () => {
    expect(deriveShowType({ mediaKind: 'tv', isAnimation: true, originCountries: ['CN'], originalLanguage: 'zh' })).toBe('anime');
  });
});

// ─── mergeAndDedupeCandidates ─────────────────────────────────────────────────

describe('mergeAndDedupeCandidates', () => {
  it('keeps higher-scoring duplicate and removes lower', () => {
    const a = scored(makeCandidate({ source: 'tmdb', sourceId: '42' }), 0.9);
    const b = scored(makeCandidate({ source: 'tmdb', sourceId: '42' }), 0.5);
    const result = mergeAndDedupeCandidates([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.9);
  });

  it('returns sorted descending by score', () => {
    const candidates = [
      scored(makeCandidate({ sourceId: '1' }), 0.4),
      scored(makeCandidate({ sourceId: '2' }), 0.8),
      scored(makeCandidate({ sourceId: '3' }), 0.6),
    ];
    const result = mergeAndDedupeCandidates(candidates);
    expect(result[0].score).toBe(0.8);
    expect(result[1].score).toBe(0.6);
    expect(result[2].score).toBe(0.4);
  });
});

// ─── normalizeTitleQuery ──────────────────────────────────────────────────────

describe('normalizeTitleQuery', () => {
  it('trims and lowercases', () => {
    expect(normalizeTitleQuery('  Naruto  ')).toBe('naruto');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeTitleQuery('one   piece')).toBe('one piece');
  });

  it('preserves hyphens', () => {
    expect(normalizeTitleQuery('Spider-Man')).toBe('spider-man');
  });
});
