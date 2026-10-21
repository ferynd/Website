import { describe, expect, it } from 'vitest';
import { applyNutritionMatches, matchIngredientName, nameSimilarity, rankFoodsForQuery } from '../lib/nutritionMatch';
import { candidateLink, confirmNutritionLink, noMatchLink } from '../lib/nutritionLink';
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
  it('exact matches are candidates that still need confirmation', () => {
    const link = matchIngredientName('all purpose flour', foods);
    expect(link.status).toBe('candidate');
    expect(link.foodItemId).toBe('food-flour');
    expect(link.matchConfidence).toBe(1);
    expect(link.needsUserReview).toBe(true);
    expect(link.gramsPerUnit).toBeNull();
  });

  it('marks close matches as candidates and flags them for review', () => {
    const link = matchIngredientName('unsalted butter', foods);
    expect(link.status).toBe('candidate');
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
    expect(summary.candidates + summary.unlinked + summary.confirmed + summary.noMatch).toBe(3);
    expect(matched.ingredients.find((i) => i.id === 'ing-flour')?.nutritionLink.status).toBe('candidate');
    expect(matched.ingredients.find((i) => i.id === 'ing-chocolate')?.nutritionLink.status).toBe('unlinked');
  });

  it('keeps confirmed and no-match links and re-matches candidates', () => {
    const base = recipe();
    const food = { id: 'food-custom', name: 'My Chocolate', quantity: 1, nutrients: Object.fromEntries(
      ['calories','protein','carbs','fat','fiber','potassium','magnesium','sodium','calcium','choline','vitaminB12','folate','vitaminC','vitaminB6','vitaminA','vitaminD','vitaminE','vitaminK','selenium','iodine','phosphorus','iron','zinc','omega3'].map((key) => [key, 1]),
    ) as never, lastUpdated: 'now' };
    const confirmed = confirmNutritionLink(food, 50, 1, base.ingredients[0].nutritionLink);
    base.ingredients[0].nutritionLink = confirmed;
    base.ingredients[1].nutritionLink = noMatchLink();
    base.ingredients[2].nutritionLink = candidateLink({ id: 'old-butter', name: 'Old Butter' }, 0.7);
    const { recipe: matched } = applyNutritionMatches(base, [
      { id: 'food-chocolate', name: 'dark chocolate' },
      { id: 'food-flour', name: 'all-purpose flour' },
      { id: 'food-butter', name: 'Butter' },
    ]);
    expect(matched.ingredients[0].nutritionLink).toEqual(confirmed);
    expect(matched.ingredients[1].nutritionLink.status).toBe('no-match');
    expect(matched.ingredients[2].nutritionLink).toMatchObject({ status: 'candidate', foodItemId: 'food-butter' });
  });
});

describe('rankFoodsForQuery', () => {
  it('sorts empty queries alphabetically and applies the limit', () => {
    expect(rankFoodsForQuery('', foods, 2).map((food) => food.name)).toEqual(['All Purpose Flour', 'Butter']);
  });
  it('includes substring hits, excludes unrelated foods, and sorts by score', () => {
    expect(rankFoodsForQuery('flour', foods).map((food) => food.name)).toEqual(['All Purpose Flour']);
    expect(rankFoodsForQuery('butter', foods)[0].name).toBe('Butter');
  });
});
