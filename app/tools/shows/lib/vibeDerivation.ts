import { VIBE_CATEGORIES } from './vibeCategories';
import type { VibeCategory } from './vibeCategories';

const VALID_VIBES = new Set<string>(VIBE_CATEGORIES);

// ─── genre / keyword → vibe mapping ────────────────────────────────────────

// Each entry: [pattern (lowercased substring), vibes to add]
// Order matters: more specific patterns before broad ones.
const GENRE_VIBE_MAP: Array<[string, VibeCategory[]]> = [
  // horror-comedy must come before plain comedy and plain horror
  ['horror-comedy',         ['Horror', 'Funny', 'Dark']],
  ['comedy horror',         ['Horror', 'Funny', 'Dark']],

  // pure horror
  ['horror',                ['Horror', 'Dark', 'Suspenseful']],

  // comedy variants → Funny (never "Comedy" which isn't in VIBE_CATEGORIES)
  ['comedy',                ['Funny', 'Lighthearted']],
  ['humor',                 ['Funny', 'Lighthearted']],
  ['sitcom',                ['Funny', 'Lighthearted']],
  ['parody',                ['Funny', 'Lighthearted']],
  ['satire',                ['Funny', 'Dark']],           // dark satire keeps Dark
  ['slapstick',             ['Funny', 'Chaotic']],

  // romance
  ['romance',               ['Romantic', 'Emotional']],
  ['romantic',              ['Romantic', 'Emotional']],

  // action / adventure
  ['action',                ['Action-Packed', 'Fast-Paced', 'Intense']],
  ['adventure',             ['Adventurous', 'Epic']],
  ['superhero',             ['Action-Packed', 'Epic']],

  // thriller / mystery / crime
  ['thriller',              ['Suspenseful', 'Intense', 'Mysterious']],
  ['mystery',               ['Mysterious', 'Suspenseful']],
  ['crime',                 ['Mysterious', 'Intense']],
  ['detective',             ['Mysterious', 'Suspenseful']],

  // sci-fi / fantasy / speculative
  ['sci-fi',                ['Mind-Bending', 'Epic']],
  ['science fiction',       ['Mind-Bending', 'Epic']],
  ['fantasy',               ['Epic', 'Adventurous']],
  ['psychological',         ['Mind-Bending', 'Thoughtful', 'Intense']],

  // drama / emotional
  ['drama',                 ['Emotional', 'Thoughtful']],
  ['melodrama',             ['Emotional', 'Slow Burn']],
  ['tragedy',               ['Emotional', 'Dark']],

  // slice of life / cozy
  ['slice of life',         ['Slice of Life', 'Chill', 'Cozy']],
  ['slice-of-life',         ['Slice of Life', 'Chill', 'Cozy']],
  ['iyashikei',             ['Chill', 'Cozy', 'Comfort Watch']],
  ['cozy',                  ['Cozy', 'Comfort Watch', 'Low-Stakes']],
  ['wholesome',             ['Wholesome', 'Lighthearted', 'Comfort Watch']],
  ['kids',                  ['Wholesome', 'Lighthearted']],
  ['family',                ['Wholesome', 'Found Family']],
  ['children',              ['Wholesome', 'Lighthearted']],

  // music / arts
  ['music',                 ['Musical']],
  ['musical',               ['Musical']],

  // sport / competition
  ['sport',                 ['Action-Packed', 'Intense']],
  ['sports',                ['Action-Packed', 'Intense']],
  ['martial arts',          ['Action-Packed', 'Intense']],

  // supernatural / occult
  ['supernatural',          ['Mysterious', 'Dark']],
  ['occult',                ['Dark', 'Mysterious']],

  // war / historical
  ['war',                   ['Intense', 'Dark', 'Epic']],
  ['historical',            ['Thoughtful', 'Slow Burn']],
  ['period',                ['Slow Burn', 'Thoughtful']],

  // found-family / friendship
  ['found family',          ['Found Family', 'Wholesome']],
  ['friendship',            ['Found Family', 'Wholesome']],
  ['ensemble',              ['Found Family', 'Chaotic']],

  // adult animation catch-all
  ['adult animation',       ['Funny', 'Dark', 'Chaotic']],
  ['adult animated',        ['Funny', 'Dark', 'Chaotic']],
];

// Filter to only vibes that exist in VIBE_CATEGORIES (guards against stale map entries)
function safeVibes(vibes: VibeCategory[]): VibeCategory[] {
  return vibes.filter((v) => VALID_VIBES.has(v));
}

/**
 * Derive vibe tags deterministically from genre strings and an optional overview.
 * Always returns 2–6 tags that exist in VIBE_CATEGORIES.
 */
export function deriveBaseVibesFromMetadata(opts: {
  genres: string[];
  overview: string;
  derivedType?: string;
}): VibeCategory[] {
  const { genres, overview, derivedType } = opts;

  // Build a single lowercased search string from genres + overview snippet
  const haystack = [
    ...genres.map((g) => g.toLowerCase()),
    overview.toLowerCase().slice(0, 400),
  ].join(' ');

  const collected = new Set<VibeCategory>();

  for (const [pattern, vibes] of GENRE_VIBE_MAP) {
    if (haystack.includes(pattern)) {
      for (const v of safeVibes(vibes)) collected.add(v);
    }
  }

  // Type-based fallback additions
  if (derivedType === 'animated_movie' || derivedType === 'cartoon') {
    if (collected.size === 0) {
      collected.add('Lighthearted');
      collected.add('Wholesome');
    }
  }

  const result = Array.from(collected).slice(0, 6);

  // Ensure minimum 2 vibes with safe fallbacks
  if (result.length === 0) {
    return ['Thoughtful', 'Slow Burn'];
  }
  if (result.length === 1) {
    const fallback: VibeCategory =
      result[0] === 'Thoughtful' ? 'Emotional' : 'Thoughtful';
    return [result[0], fallback];
  }
  return result;
}

/** Trim overview to 200 chars at a sentence boundary when possible. */
export function normalizeDescription(overview: string): string {
  const trimmed = overview.trim();
  if (trimmed.length <= 200) return trimmed;
  // Try to break at a sentence end within 199 chars (leaving room for nothing extra)
  const cut = trimmed.slice(0, 199);
  const lastDot = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
  if (lastDot > 100) return cut.slice(0, lastDot + 1);
  // Hard truncate at 197 and add ellipsis (197 + 1 = 198 ≤ 200)
  return cut.slice(0, 197).trimEnd() + '…';
}
