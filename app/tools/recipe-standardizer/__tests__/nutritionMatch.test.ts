import { describe, expect, it } from 'vitest';
import { applyNutritionMatches, matchIngredientName, nameSimilarity } from '../lib/nutritionMatch';
import { parseRecipeJson } from '../lib/schema';
import type { FoodItemRef, Recipe } from '../lib/types';
import { validRecipeJson } from './fixtures';

const recipe = (): Recipe => {
  const parsed = parseRecipeJson(JSON.stringify(validRecipeJson()));
  if (!parsed.ok) throw new Error('fixture must be valid');
  return parsed.recipe;
};

const foods: FoodItemRef[] = [
  { id: 'food-butter', name: 'Butter' },
  { id: 'food-flour', name: 'All Purpose Flour' },
  { id: 'food-chicken', name: 'Chicken Breast' },
];

describe('nameSimilarity', () => {
  it('is 1 for normalized-equal names', () => {
    expect(nameSimilarity('All-Purpose Flour', 'all purpose flour')).toBe(1);
  });

  it('scores descriptor-only differences high ("unsalted butter" vs "Butter")', () => {
    expect(nameSimilarity('unsalted butter', 'Butter')).toBeGreaterThanOrEqual(0.6);
  });

  it('scores unrelated names at 0', () => {
    expect(nameSimilarity('dark chocolate', 'Chicken Breast')).toBe(0);
  });
});

describe('matchIngredientName', () => {
  it('links exact matches without review', () => {
    const link = matchIngredientName('all purpose flour', foods);
    expect(link.status).toBe('linked');
    expect(link.foodItemId).toBe('food-flour');
    expect(link.needsUserReview).toBe(false);
  });

  it('marks close matches as likely and flags them for review', () => {
    const link = matchIngredientName('unsalted butter', foods);
    expect(link.status).toBe('likely');
    expect(link.foodItemId).toBe('food-butter');
    expect(link.needsUserReview).toBe(true);
  });

  it('leaves unmatched ingredients unlinked', () => {
    const link = matchIngredientName('dark chocolate', foods);
    expect(link.status).toBe('unlinked');
    expect(link.foodItemId).toBeNull();
  });
});

describe('applyNutritionMatches', () => {
  it('matches every ingredient and reports a summary', () => {
    const { recipe: matched, summary } = applyNutritionMatches(recipe(), foods);
    expect(summary.linked + summary.likely + summary.unlinked).toBe(3);
    expect(matched.ingredients.find((i) => i.id === 'ing-flour')?.nutritionLink.status).toBe('linked');
    expect(matched.ingredients.find((i) => i.id === 'ing-chocolate')?.nutritionLink.status).toBe('unlinked');
  });

  it('never downgrades an already-confirmed linked ingredient', () => {
    const base = recipe();
    base.ingredients[0].nutritionLink = {
      status: 'linked', foodItemId: 'food-custom', matchedName: 'My Chocolate', matchConfidence: 1, needsUserReview: false,
    };
    const { recipe: matched } = applyNutritionMatches(base, []);
    expect(matched.ingredients[0].nutritionLink.foodItemId).toBe('food-custom');
  });
});
