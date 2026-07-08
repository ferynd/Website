import { describe, expect, it } from 'vitest';
import { parseRecipeJson } from '../lib/schema';
import {
  applyScaleToRecipe,
  factorFromMultiplier,
  factorFromPortions,
  factorFromServings,
  factorFromTargetWeight,
  referenceWeightG,
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
    expect(factorFromTargetWeight(500, null)).toBeNull();
    expect(factorFromPortions(12, 90, 1080)?.factor).toBe(1);
    expect(factorFromPortions(12, 90, null)).toBeNull();
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
});
