import type { Show } from '../types';
import { VIBE_CATEGORIES } from './vibeCategories';
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

// All tags here must exist in VIBE_CATEGORIES; the filter at the end enforces this at runtime.
const VIBE_KEYWORD_MAP: Array<{ keywords: string[]; tags: string[] }> = [
  {
    keywords: ['funny', 'comedy', 'humor', 'laugh', 'hilarious', 'comedic', 'lighthearted'],
    tags: ['Funny', 'Lighthearted'],
  },
  {
    keywords: ['exciting', 'action', 'thriller', 'thrilling', 'adventure', 'hype', 'hyped', 'adrenaline'],
    tags: ['Action-Packed', 'Adventurous', 'Fast-Paced', 'Intense', 'Suspenseful'],
  },
  {
    keywords: ['chill', 'cozy', 'comfort', 'relax', 'calm', 'mellow', 'easy watch'],
    tags: ['Chill', 'Cozy', 'Comfort Watch', 'Low-Stakes'],
  },
  {
    keywords: ['slice of life'],
    tags: ['Slice of Life', 'Chill', 'Cozy'],
  },
  {
    keywords: ['romantic', 'romance', 'sweet', 'love story'],
    tags: ['Romantic', 'Wholesome'],
  },
  {
    keywords: ['drama', 'emotional', 'touching', 'moving', 'deep'],
    tags: ['Emotional', 'Thoughtful'],
  },
  {
    keywords: ['mystery', 'suspense', 'crime', 'detective', 'noir', 'whodunit'],
    tags: ['Mysterious', 'Suspenseful', 'Mind-Bending'],
  },
  {
    keywords: ['mind bending', 'mind-bending', 'trippy', 'psychological', 'twist'],
    tags: ['Mind-Bending', 'Thoughtful'],
  },
  {
    keywords: ['musical', 'music', 'singing'],
    tags: ['Musical'],
  },
  {
    keywords: ['fantasy', 'magic', 'epic', 'world-building'],
    tags: ['Epic', 'Adventurous'],
  },
  {
    keywords: ['horror', 'scary', 'creepy'],
    tags: ['Horror', 'Dark', 'Suspenseful', 'Intense'],
  },
  {
    keywords: ['dark', 'gritty'],
    tags: ['Dark', 'Intense'],
  },
  {
    keywords: ['chaotic', 'wild', 'crazy'],
    tags: ['Chaotic', 'Fast-Paced'],
  },
  {
    keywords: ['family', 'friendship', 'heartwarming', 'wholesome', 'feel good'],
    tags: ['Found Family', 'Wholesome'],
  },
  {
    keywords: ['slow burn', 'slow-burn'],
    tags: ['Slow Burn', 'Thoughtful'],
  },
];

const VALID_VIBE_TAGS = new Set<string>(VIBE_CATEGORIES);

/** Infers focus level from free-form mood text. */
export function inferFocusLevel(text: string): 'low' | 'normal' | 'high' {
  const normalized = text.toLowerCase();
  if (LOW_FOCUS_PHRASES.some((p) => normalized.includes(p))) return 'low';
  if (HIGH_FOCUS_PHRASES.some((p) => normalized.includes(p))) return 'high';
  return 'normal';
}

/**
 * Infers focus level for a single viewer.
 * Uses their individual mood text first. When that is neutral and sharedMood is provided,
 * it looks for clauses in sharedMood that contain the viewer's name and infers focus from those.
 * This prevents one viewer's low-focus state from being attributed to another viewer.
 */
export function inferViewerFocusLevel(
  individualMood: string,
  viewerName: string,
  sharedMood?: string,
): 'low' | 'normal' | 'high' {
  const focus = inferFocusLevel(individualMood);
  if (focus !== 'normal') return focus;

  if (sharedMood?.trim() && viewerName) {
    const name = viewerName.toLowerCase();
    const clauses = sharedMood.split(/[.!?,;]+/);
    const relevant = clauses.filter((c) => c.toLowerCase().includes(name));
    if (relevant.length > 0) return inferFocusLevel(relevant.join(' '));
  }

  return 'normal';
}

/**
 * Infers desired vibe tags from free-form mood text.
 * All returned values are guaranteed to exist in VIBE_CATEGORIES.
 */
export function inferVibeKeywords(text: string): string[] {
  const normalized = text.toLowerCase();
  const matched: string[] = [];
  for (const { keywords, tags } of VIBE_KEYWORD_MAP) {
    if (keywords.some((k) => normalized.includes(k))) {
      matched.push(...tags);
    }
  }
  // Deduplicate and guard against any accidental non-canonical tag
  return [...new Set(matched)].filter((t) => VALID_VIBE_TAGS.has(t));
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

/**
 * Computes an aggregate brain power match score across all present viewers.
 * Each viewer's focus level is compared against their own per-person brain power estimate
 * (falling back to the legacy show-level brainPower when the viewer has not set their own).
 * A tired viewer's constraint only applies to that viewer's estimate, not to other viewers'.
 */
function scoreBrainPowerForViewers(
  show: Show,
  viewerFocusLevels: Record<string, 'low' | 'normal' | 'high'>,
  presentUids: string[],
): number {
  if (presentUids.length === 0) {
    // No present viewers — fall back to legacy show-level value with neutral focus
    return scoreBrainPower(show.brainPower, 'normal');
  }

  const scores = presentUids.map((uid) => {
    const focus = viewerFocusLevels[uid] ?? 'normal';
    // Prefer the viewer's own per-person estimate; fall back to legacy show.brainPower
    const bp = show.ratings[uid]?.brainPower ?? show.brainPower ?? null;
    return scoreBrainPower(bp, focus);
  });

  return scores.reduce((a, b) => a + b, 0) / scores.length;
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
 * Brain power is evaluated per viewer — a tired viewer's constraint applies only to their
 * own brain power estimate for this show, not to other viewers'.
 * Brain power match weighted highest because it's the clearest "wrong night" signal.
 */
export function computeCandidatePreScore(
  show: Show,
  viewerFocusLevels: Record<string, 'low' | 'normal' | 'high'>,
  vibeKeywords: string[],
  presentUids: string[],
): CandidatePreScore {
  const brainPowerMatch = scoreBrainPowerForViewers(show, viewerFocusLevels, presentUids);
  const vibeFit = scoreVibeFit(show.vibeTags, vibeKeywords);
  const viewerRatingFit = scoreViewerRatingFit(show, presentUids);

  const overallPreScore =
    brainPowerMatch * 0.4 + vibeFit * 0.35 + viewerRatingFit * 0.25;

  return { showId: show.id, title: show.title, brainPowerMatch, vibeFit, viewerRatingFit, overallPreScore };
}
