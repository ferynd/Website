import type { Show } from '../types';
import { memberComposite } from './compositeScore';

const LOW_FOCUS_PHRASES = [
  'brain dead',
  'braindead',
  'brain-dead',
  'tired',
  'exhausted',
  'drained',
  'wiped',
  'low focus',
  'low energy',
  'low-energy',
  'low-focus',
  'multitask',
  'multitasking',
  'multi-task',
  'background',
  'mindless',
  'no brain',
];

const HIGH_FOCUS_PHRASES = [
  'ready to focus',
  'ready to think',
  'thinking mood',
  'analytical',
  'want to think',
  'can focus',
  'full attention',
];

const VIBE_KEYWORD_MAP: Array<{ keywords: string[]; tags: string[] }> = [
  {
    keywords: ['funny', 'comedy', 'humor', 'laugh', 'hilarious', 'comedic', 'lighthearted'],
    tags: ['Comedy', 'Funny', 'Humor', 'Lighthearted'],
  },
  {
    keywords: ['exciting', 'action', 'thriller', 'thrilling', 'adventure', 'intense', 'hype', 'hyped', 'adrenaline'],
    tags: ['Action', 'Exciting', 'Thrilling', 'Adventure'],
  },
  {
    keywords: ['chill', 'cozy', 'comfort', 'relax', 'calm', 'mellow', 'slice of life'],
    tags: ['Chill', 'Cozy', 'Relaxing', 'Comfort', 'Slice of life'],
  },
  {
    keywords: ['romantic', 'romance', 'sweet', 'love story'],
    tags: ['Romantic', 'Romance'],
  },
  {
    keywords: ['drama', 'emotional', 'touching', 'moving', 'deep'],
    tags: ['Drama', 'Emotional'],
  },
  {
    keywords: ['mystery', 'suspense', 'crime', 'detective', 'noir', 'whodunit'],
    tags: ['Mystery', 'Thriller', 'Suspense', 'Crime'],
  },
  {
    keywords: ['musical', 'music', 'singing'],
    tags: ['Musical'],
  },
  {
    keywords: ['fantasy', 'magic', 'epic', 'world-building'],
    tags: ['Fantasy', 'Epic'],
  },
  {
    keywords: ['sci-fi', 'scifi', 'futuristic', 'space'],
    tags: ['Sci-Fi'],
  },
];

/** Infers focus level from free-form mood text. */
export function inferFocusLevel(text: string): 'low' | 'normal' | 'high' {
  const normalized = text.toLowerCase();
  if (LOW_FOCUS_PHRASES.some((p) => normalized.includes(p))) return 'low';
  if (HIGH_FOCUS_PHRASES.some((p) => normalized.includes(p))) return 'high';
  return 'normal';
}

/** Infers desired vibe tags from free-form mood text. */
export function inferVibeKeywords(text: string): string[] {
  const normalized = text.toLowerCase();
  const matched: string[] = [];
  for (const { keywords, tags } of VIBE_KEYWORD_MAP) {
    if (keywords.some((k) => normalized.includes(k))) {
      matched.push(...tags);
    }
  }
  return [...new Set(matched)];
}

/**
 * Scores how well a show's brain power requirement matches the inferred focus level.
 * Returns 0–10. Higher = better fit.
 */
export function scoreBrainPower(
  brainPower: number | null | undefined,
  focusLevel: 'low' | 'normal' | 'high',
): number {
  if (brainPower == null) return 5; // unknown → neutral

  if (focusLevel === 'low') {
    if (brainPower <= 2) return 10;
    if (brainPower === 3) return 4;
    return 0; // bp 4–5 is bad when tired/multitasking
  }

  if (focusLevel === 'high') {
    if (brainPower >= 4) return 10;
    if (brainPower === 3) return 7;
    return 4; // bp 1–2 is fine but slightly under-stimulating
  }

  // Normal focus: mild preference for 2–3
  if (brainPower === 2 || brainPower === 3) return 8;
  if (brainPower === 1 || brainPower === 4) return 6;
  return 4; // bp=5 slightly heavy for casual viewing
}

/**
 * Scores how well a show's vibe tags match the inferred vibe keywords.
 * Returns 0–10. Higher = better fit.
 */
export function scoreVibeFit(vibeTags: string[], vibeKeywords: string[]): number {
  if (vibeKeywords.length === 0) return 5; // no vibe preference → neutral
  const tagSet = new Set(vibeTags.map((t) => t.toLowerCase()));
  const kwSet = new Set(vibeKeywords.map((k) => k.toLowerCase()));
  const matches = [...tagSet].filter((t) => kwSet.has(t)).length;
  if (matches === 0) return 2;
  if (matches === 1) return 6;
  if (matches === 2) return 8;
  return 10;
}

/**
 * Scores how well present viewers have historically rated this show.
 * Returns 0–10. Unrated shows return 5 (neutral).
 */
export function scoreViewerRatingFit(show: Show, presentUids: string[]): number {
  const composites: number[] = [];
  for (const uid of presentUids) {
    const rating = show.ratings[uid];
    if (!rating) continue;
    const c = memberComposite(rating);
    if (c !== null) composites.push(c);
  }
  if (composites.length === 0) return 5;
  const avg = composites.reduce((a, b) => a + b, 0) / composites.length;
  // Slight penalty below 6 to de-prioritize disliked shows without ignoring them
  if (avg >= 6) return avg;
  if (avg >= 4) return avg - 1;
  return Math.max(0, avg - 2);
}

export interface CandidatePreScore {
  showId: string;
  title: string;
  brainPowerMatch: number;
  vibeFit: number;
  viewerRatingFit: number;
  overallPreScore: number;
}

/**
 * Computes a lightweight deterministic pre-score for a candidate show.
 * Brain power match weighted highest because it's the clearest "wrong night" signal.
 */
export function computeCandidatePreScore(
  show: Show,
  focusLevel: 'low' | 'normal' | 'high',
  vibeKeywords: string[],
  presentUids: string[],
): CandidatePreScore {
  const brainPowerMatch = scoreBrainPower(show.brainPower, focusLevel);
  const vibeFit = scoreVibeFit(show.vibeTags, vibeKeywords);
  const viewerRatingFit = scoreViewerRatingFit(show, presentUids);

  const overallPreScore =
    brainPowerMatch * 0.4 + vibeFit * 0.35 + viewerRatingFit * 0.25;

  return { showId: show.id, title: show.title, brainPowerMatch, vibeFit, viewerRatingFit, overallPreScore };
}
