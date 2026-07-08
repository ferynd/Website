/* ------------------------------------------------------------ */
/* CONFIGURATION: match confidence thresholds                    */
/* ------------------------------------------------------------ */
/** Token-similarity score at or above which a match is "likely". */
const LIKELY_THRESHOLD = 0.6;

/**
 * Name matching between recipe ingredients and CalorieTracker saved food
 * items (`artifacts/default-app-id/users/{uid}/foodItems`).
 *
 * v1 links by name only — it records which food item an ingredient maps to
 * so a future version can compute recipe nutrition from the linked items.
 * Matching never blocks saving: unmatched ingredients simply stay
 * `unlinked` with `needsUserReview: true`.
 */

import { normalizeIngredientName } from './shoppingList';
import type { FoodItemRef, NutritionLink, Recipe } from './types';

/** Descriptor words that carry no identity ("fresh", "chopped", sizes, etc.). */
const NOISE_TOKENS = new Set([
  'fresh', 'freshly', 'large', 'small', 'medium', 'chopped', 'diced', 'minced',
  'sliced', 'grated', 'shredded', 'ground', 'whole', 'raw', 'cooked', 'dried',
  'granulated', 'packed', 'softened', 'melted', 'cold', 'warm', 'room', 'temperature',
  'unsalted', 'salted', 'of', 'the', 'a', 'an',
]);

const tokenize = (name: string): Set<string> => {
  const tokens = normalizeIngredientName(name)
    .split(' ')
    .filter((t) => t.length > 1 && !NOISE_TOKENS.has(t))
    // Naive singularization so "eggs" matches "egg".
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
  return new Set(tokens);
};

/** Jaccard-style similarity weighted toward full containment. */
export const nameSimilarity = (a: string, b: string): number => {
  const normA = normalizeIngredientName(a);
  const normB = normalizeIngredientName(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  tokensA.forEach((t) => {
    if (tokensB.has(t)) shared += 1;
  });
  if (shared === 0) return 0;
  // Containment (all of the smaller set matched) scores higher than plain Jaccard
  // so "butter" ↔ "unsalted butter" reads as a strong match. Token-based scores
  // are capped below 1 — only exact normalized names auto-link without review.
  const containment = shared / Math.min(tokensA.size, tokensB.size);
  const jaccard = shared / (tokensA.size + tokensB.size - shared);
  const score = Math.round((0.6 * containment + 0.4 * jaccard) * 100) / 100;
  return Math.min(score, 0.95);
};

export const matchIngredientName = (
  ingredientName: string,
  foods: FoodItemRef[],
): NutritionLink => {
  let best: { food: FoodItemRef; score: number } | null = null;
  foods.forEach((food) => {
    const score = nameSimilarity(ingredientName, food.name);
    if (score > 0 && (!best || score > best.score)) {
      best = { food, score };
    }
  });

  if (best !== null) {
    const { food, score } = best as { food: FoodItemRef; score: number };
    if (score === 1) {
      return {
        status: 'linked',
        foodItemId: food.id,
        matchedName: food.name,
        matchConfidence: 1,
        needsUserReview: false,
      };
    }
    if (score >= LIKELY_THRESHOLD) {
      return {
        status: 'likely',
        foodItemId: food.id,
        matchedName: food.name,
        matchConfidence: score,
        needsUserReview: true,
      };
    }
  }

  return {
    status: 'unlinked',
    foodItemId: null,
    matchedName: null,
    matchConfidence: null,
    needsUserReview: true,
  };
};

export interface MatchSummary {
  linked: number;
  likely: number;
  unlinked: number;
}

/** Re-match every ingredient; already-confirmed `linked` entries are kept as-is. */
export const applyNutritionMatches = (
  recipe: Recipe,
  foods: FoodItemRef[],
): { recipe: Recipe; summary: MatchSummary } => {
  const summary: MatchSummary = { linked: 0, likely: 0, unlinked: 0 };
  const ingredients = recipe.ingredients.map((ing) => {
    const link = ing.nutritionLink.status === 'linked'
      ? ing.nutritionLink
      : matchIngredientName(ing.displayName, foods);
    summary[link.status] += 1;
    return { ...ing, nutritionLink: link };
  });
  return { recipe: { ...recipe, ingredients }, summary };
};
