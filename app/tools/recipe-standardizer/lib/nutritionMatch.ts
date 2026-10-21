/* CONFIGURATION: match confidence thresholds */
/** Token-similarity score at or above which a match is a candidate. */
const LIKELY_THRESHOLD = 0.6;

import { normalizeIngredientName } from './shoppingList';
import { candidateLink } from './nutritionLink';
import type { FoodItemRef, NutritionLink, Recipe } from './types';

/** Automatic name matches are candidates only; LinkEditor confirmation is explicit. */
const NOISE_TOKENS = new Set([
  'fresh', 'freshly', 'large', 'small', 'medium', 'chopped', 'diced', 'minced',
  'sliced', 'grated', 'shredded', 'ground', 'whole', 'raw', 'cooked', 'dried',
  'granulated', 'packed', 'softened', 'melted', 'cold', 'warm', 'room', 'temperature',
  'unsalted', 'salted', 'of', 'the', 'a', 'an',
]);

const tokenize = (name: string): Set<string> => new Set(
  normalizeIngredientName(name).split(' ').filter((token) => token.length > 1 && !NOISE_TOKENS.has(token))
    .map((token) => token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token),
);

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
  tokensA.forEach((token) => { if (tokensB.has(token)) shared += 1; });
  if (shared === 0) return 0;
  const containment = shared / Math.min(tokensA.size, tokensB.size);
  const jaccard = shared / (tokensA.size + tokensB.size - shared);
  return Math.min(Math.round((0.6 * containment + 0.4 * jaccard) * 100) / 100, 0.95);
};

export const matchIngredientName = (ingredientName: string, foods: FoodItemRef[]): NutritionLink => {
  let best: { food: FoodItemRef; score: number } | null = null;
  foods.forEach((food) => {
    const score = nameSimilarity(ingredientName, food.name);
    if (score > 0 && (!best || score > best.score)) best = { food, score };
  });
  if (best !== null) {
    const { food, score } = best as { food: FoodItemRef; score: number };
    if (score >= LIKELY_THRESHOLD) return candidateLink(food, score);
  }
  return {
    status: 'unlinked', foodItemId: null, matchedName: null, matchConfidence: null,
    needsUserReview: true, gramsPerUnit: null, confirmedAtMs: null,
    targetRevision: null, targetFingerprint: null,
  };
};

export interface MatchSummary { confirmed: number; candidates: number; unlinked: number; noMatch: number; }

/** Re-match candidates and unlinked entries; confirmed/no-match links are retained. */
export const applyNutritionMatches = (recipe: Recipe, foods: FoodItemRef[]): { recipe: Recipe; summary: MatchSummary } => {
  const summary: MatchSummary = { confirmed: 0, candidates: 0, unlinked: 0, noMatch: 0 };
  const ingredients = recipe.ingredients.map((ingredient) => {
    const link = ingredient.nutritionLink.status === 'confirmed' || ingredient.nutritionLink.status === 'no-match'
      ? ingredient.nutritionLink
      : matchIngredientName(ingredient.displayName, foods);
    if (link.status === 'confirmed') summary.confirmed += 1;
    else if (link.status === 'candidate') summary.candidates += 1;
    else if (link.status === 'no-match') summary.noMatch += 1;
    else summary.unlinked += 1;
    return { ...ingredient, nutritionLink: link };
  });
  return { recipe: { ...recipe, ingredients }, summary };
};

export const rankFoodsForQuery = <T extends FoodItemRef>(query: string, foods: T[], limit = 50): T[] => {
  const trimmed = query.trim();
  if (!trimmed) return [...foods]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .slice(0, limit);
  const normalizedQuery = normalizeIngredientName(trimmed);
  return foods
    .map((food) => ({
      food,
      score: Math.max(nameSimilarity(trimmed, food.name), normalizeIngredientName(food.name).includes(normalizedQuery) ? 0.5 : 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name, undefined, { sensitivity: 'base' }))
    .slice(0, limit)
    .map(({ food }) => food);
};
