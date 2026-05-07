import type { ShowType } from '../types';
import type { MediaKind } from './classifyTypes';

// Languages/countries considered "East Asian animation" → anime
const ANIME_LANGUAGES = new Set(['ja', 'ko', 'zh', 'zh-TW', 'zh-HK', 'zh-CN']);
const ANIME_COUNTRIES = new Set(['JP', 'KR', 'CN', 'TW', 'HK']);

/**
 * Deterministically derive ShowType from provider metadata.
 *
 * Rules (ordered, first match wins):
 *   TV  + animation + JP/KR/CN origin  → anime
 *   TV  + animation + other origin     → cartoon
 *   TV  + not animation                → tv
 *   Movie + animation + JP/KR/CN       → anime   (treat as anime film)
 *   Movie + animation + other          → animated_movie
 *   Movie + not animation              → movie
 */
export function deriveShowType(opts: {
  mediaKind: MediaKind;
  isAnimation: boolean;
  originCountries: string[];
  originalLanguage?: string;
}): ShowType {
  const { mediaKind, isAnimation, originCountries, originalLanguage } = opts;

  const isEastAsian =
    (originalLanguage && ANIME_LANGUAGES.has(originalLanguage)) ||
    originCountries.some((c) => ANIME_COUNTRIES.has(c));

  if (mediaKind === 'tv') {
    if (isAnimation) return isEastAsian ? 'anime' : 'cartoon';
    return 'tv';
  }

  // movie
  if (isAnimation) return isEastAsian ? 'anime' : 'animated_movie';
  return 'movie';
}

/** Is the type episodic (has seasons/episodes)? */
export function isEpisodicType(type: ShowType): boolean {
  return type === 'anime' || type === 'tv' || type === 'cartoon';
}
