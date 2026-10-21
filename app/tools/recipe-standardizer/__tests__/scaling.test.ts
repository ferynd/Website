import { describe, expect, it } from 'vitest';
import { parseRecipeJson } from '../lib/schema';
import { confirmNutritionLink } from '../lib/nutritionLink';
import { TRACKER_NUTRIENT_KEYS, type TrackerFood } from '../lib/trackerFoods';
import {
  applyScaleToRecipe,
  factorFromMultiplier,
  factorFromPortions,
  factorFromServings,
  factorFromTargetWeight,
  isScaleActive,
  referenceWeightG,
  referenceWeightSource,
  scaleEquivalentText,
  scaleQuantityG,
} from '../lib/scaling';
import type { Recipe } from '../lib/types';
import { validRecipeJson } from './fixtures';

const recipe = (): Recipe => {
  const parsed = parseRecipeJson(JSON.stringify(validRecipeJson()));
  if (!parsed.ok) throw new Error('fixture must be valid');
  return parsed.recipe;
};

describe('scale factor derivation', () => {
  it('derives factor from multiplier', () => {
    expect(factorFromMultiplier(1.5)?.factor).toBe(1.5);
    expect(factorFromMultiplier(0)).toBeNull();
    expect(factorFromMultiplier(-2)).toBeNull();
    expect(factorFromMultiplier(1e308)).toBeNull();
    expect(factorFromMultiplier(1000)?.factor).toBe(1000);
    expect(factorFromMultiplier(0.0001)).toBeNull();
  });

  it('derives factor from servings against the baseline', () => {
    expect(factorFromServings(36, 24)?.factor).toBe(1.5);
    expect(factorFromServings(12, null)).toBeNull();
  });

  it('prefers actual final weight over estimated as the reference', () => {
    const base = recipe();
    expect(referenceWeightG(base)).toBe(1080);
    const withActual: Recipe = { ...base, yield: { ...base.yield, actualFinalWeightG: 1000 } };
    expect(referenceWeightG(withActual)).toBe(1000);
  });

  it('derives factor from target weight and from portions', () => {
    expect(factorFromTargetWeight(2160, 1080)?.factor).toBe(2);
    expect(factorFromTargetWeight(999.9999999999, 1000)?.factor).toBe(1);
    expect(factorFromTargetWeight(500, null)).toBeNull();
    expect(factorFromPortions(12, 90, 1080)?.factor).toBe(1);
    expect(factorFromPortions(12, 90, null)).toBeNull();
  });

  it('snaps a near-one fractional portion factor to exactly one', () => {
    expect(factorFromPortions(3, 150.7, 452.1)?.factor).toBe(1);
  });

  it('records the requested portion count and size as a portion override', () => {
    expect(factorFromPortions(10, 150, 1000)?.portionOverride).toEqual({ count: 10, sizeG: 150 });
  });

  it('treats a factor-one portion override as an active scale', () => {
    expect(isScaleActive({ factor: 1, label: 'baseline' })).toBe(false);
    expect(isScaleActive(factorFromPortions(12, 90, 1080)!)).toBe(true);
    expect(isScaleActive({ factor: 2, label: 'batch 2×' })).toBe(true);
  });

  it.each([
    ['multiplier', factorFromMultiplier(2)],
    ['servings', factorFromServings(8, 4)],
    ['target-weight', factorFromTargetWeight(500, 250)],
  ])('does not set a portion override for %s scaling', (_mode, result) => {
    expect(result?.portionOverride).toBeUndefined();
  });

  it('reports whether the reference weight is actual, estimated, or missing', () => {
    const base = recipe();
    expect(referenceWeightSource(base)).toBe('estimated');
    expect(referenceWeightSource({ ...base, yield: { ...base.yield, actualFinalWeightG: 900 } })).toBe('actual');
    expect(referenceWeightSource({ ...base, yield: { ...base.yield, actualFinalWeightG: 0 } })).toBe('estimated');
    expect(referenceWeightSource({ ...base, yield: { ...base.yield, estimatedFinalWeightG: 0 } })).toBeNull();
  });
});

describe('scaleQuantityG', () => {
  it('rounds to whole grams above 10 g and one decimal below', () => {
    expect(scaleQuantityG(300, 1.5)).toBe(450);
    expect(scaleQuantityG(3, 1.5)).toBe(4.5);
    expect(scaleQuantityG(null, 2)).toBeNull();
  });
});

describe('scaleEquivalentText', () => {
  it('scales integers, decimals, fractions, and mixed numbers', () => {
    expect(scaleEquivalentText('2 cups', 1.5)).toBe('3 cups');
    expect(scaleEquivalentText('1.5 tsp', 2)).toBe('3 tsp');
    expect(scaleEquivalentText('3/4 cup', 2)).toBe('1 1/2 cup');
    expect(scaleEquivalentText('1 1/2 tbsp', 2)).toBe('3 tbsp');
  });

  it('handles unicode fractions', () => {
    expect(scaleEquivalentText('½ cup', 2)).toBe('1 cup');
    expect(scaleEquivalentText('1½ cups', 2)).toBe('3 cups');
  });

  it('returns the input unchanged at factor 1', () => {
    expect(scaleEquivalentText('a pinch', 1)).toBe('a pinch');
  });

  it('returns null for unparseable text at a non-1 factor', () => {
    expect(scaleEquivalentText('a pinch', 2)).toBeNull();
    expect(scaleEquivalentText('', 2)).toBeNull();
  });

  it('refuses to scale ranges instead of corrupting them', () => {
    expect(scaleEquivalentText('1-2 cloves', 2)).toBeNull();
    expect(scaleEquivalentText('1–2 cloves', 2)).toBeNull();
    expect(scaleEquivalentText('1 to 2 tbsp', 2)).toBeNull();
    expect(scaleEquivalentText('1 or 2 eggs', 2)).toBeNull();
    expect(scaleEquivalentText('1/2-1 cup', 2)).toBeNull();
    // "or"/"to" inside a following word is not a range.
    expect(scaleEquivalentText('2 oranges', 2)).toBe('4 oranges');
  });
});

describe('applyScaleToRecipe', () => {
  it('bakes the factor into grams, servings, and estimated weight', () => {
    const scaled = applyScaleToRecipe(recipe(), 2);
    expect(scaled.ingredients.find((i) => i.id === 'ing-flour')?.quantityG).toBe(600);
    expect(scaled.servings.baselineServings).toBe(48);
    expect(scaled.yield.estimatedFinalWeightG).toBe(2160);
  });

  it('clears actual final weight and folds it into the new estimate', () => {
    const base = recipe();
    base.yield.actualFinalWeightG = 1000;
    const scaled = applyScaleToRecipe(base, 2);
    expect(scaled.yield.actualFinalWeightG).toBeNull();
    // The measured weight was the best reference, so it becomes the scaled estimate.
    expect(scaled.yield.estimatedFinalWeightG).toBe(2000);
  });

  it('keeps unparseable equivalents unchanged instead of corrupting them', () => {
    const base = recipe();
    base.ingredients[0].equivalent = 'a generous handful';
    const scaled = applyScaleToRecipe(base, 3);
    expect(scaled.ingredients[0].equivalent).toBe('a generous handful');
  });

  it('preserves a confirmed nutrition link and gram basis unchanged', () => {
    const base = recipe();
    const trackerFood: TrackerFood = {
      id: 'food-flour', name: 'Flour', quantity: 1,
      nutrients: Object.fromEntries(TRACKER_NUTRIENT_KEYS.map((key) => [key, 1])) as TrackerFood['nutrients'],
      lastUpdated: 'rev',
    };
    const link = confirmNutritionLink(trackerFood, 100, 123, base.ingredients[0].nutritionLink);
    base.ingredients[0].nutritionLink = link;
    expect(applyScaleToRecipe(base, 2).ingredients[0].nutritionLink).toEqual(link);
  });

  it('scales portion count and keeps portion size when baking', () => {
    const base = recipe();
    const scaled = applyScaleToRecipe(base, 2);
    expect(scaled.servings.portionCount).toBe(48);
    expect(scaled.servings.portionSizeG).toBe(45);
  });

  it('keeps a null portion count null when baking', () => {
    const base = recipe();
    base.servings.portionCount = null;
    expect(applyScaleToRecipe(base, 2).servings.portionCount).toBeNull();
  });

  it('applies the portions-mode count and size when baking', () => {
    const scaled = applyScaleToRecipe(recipe(), 1.5, { count: 10, sizeG: 150 });
    expect(scaled.servings.portionCount).toBe(10);
    expect(scaled.servings.portionSizeG).toBe(150);
  });

  it('bakes a 1× portion override without scaling any other recipe values', () => {
    const base = recipe();
    base.yield.actualFinalWeightG = 1000;
    const original = structuredClone(base);
    const scale = factorFromPortions(10, 100, 1000)!;
    const scaled = applyScaleToRecipe(base, scale.factor, scale.portionOverride);

    expect(scaled).not.toBe(base);
    expect(scaled.ingredients).toEqual(original.ingredients);
    expect(scaled.yield).toEqual(original.yield);
    expect(scaled.servings).toEqual({
      ...original.servings,
      portionCount: 10,
      portionSizeG: 100,
    });
    expect(base).toEqual(original);
  });

  it('bakes near-1× portions by changing only portion fields', () => {
    const base = recipe();
    base.yield.actualFinalWeightG = 452.1;
    const original = structuredClone(base);
    const scale = factorFromPortions(3, 150.7, 452.1)!;
    const scaled = applyScaleToRecipe(base, scale.factor, scale.portionOverride);

    expect(scale.factor).toBe(1);
    expect(scaled.ingredients).toEqual(original.ingredients);
    expect(scaled.yield).toEqual(original.yield);
    expect(scaled.servings).toEqual({
      ...original.servings,
      portionCount: 3,
      portionSizeG: 150.7,
    });
  });
});
