/* --- CONFIGURATION: scaling.test contract --- */
/** Regression coverage for scaling.test. Fixtures remain local and do not access production data. */

import { describe, expect, it } from 'vitest';
import { parseRecipeJson } from '../lib/schema';
import { confirmNutritionLink } from '../lib/nutritionLink';
import { TRACKER_NUTRIENT_KEYS, type TrackerFood } from '../lib/trackerFoods';
import {
  applyScaleToRecipe,
  classifyEquivalentText,
  findUnscalableEquivalents,
  nextEquivalentBakeFactor,
  FACTOR_ONE_EPSILON,
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
    expect(scaled.ingredients[0].equivalentBakeFactor).toBe(3);
  });

  it('preserves a confirmed nutrition link and gram basis unchanged', () => {
    const base = recipe();
    const trackerFood: TrackerFood = {
      id: 'food-flour',
      name: 'Flour',
      quantity: 1,
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

const proseRecipe = () => {
  const base = recipe();
  base.ingredients[0].equivalent = 'a generous handful';
  return base;
};

describe('classifyEquivalentText', () => {
  it.each([
    ['', 3, 'blank'],
    ['2 cups', 1, 'unchanged'],
    ['2 cups', 3, 'scaled'],
    ['3 large eggs', 1.5, 'scaled'],
    ['1-2 cloves', 3, 'range'],
    ['1 to 2 tbsp', 3, 'range'],
    ['a generous handful', 3, 'unparseable'],
    ['to taste', 3, 'unparseable'],
  ] as const)('%j at %d× is %s', (text, factor, expected) => {
    expect(classifyEquivalentText(text, factor)).toBe(expected);
  });
});

describe('findUnscalableEquivalents', () => {
  it('lists prose and range equivalents with grams before and after', () => {
    const base = proseRecipe();
    base.ingredients[1].equivalent = '1-2 cloves';
    const issues = findUnscalableEquivalents(base, 3);
    expect(issues.map((issue) => issue.reason)).toEqual(['unparseable', 'range']);
    expect(issues[0]).toMatchObject({ gramsBefore: 200, gramsAfter: 600 });
  });
  it('skips blank, parseable, and count-based equivalents', () => {
    const base = recipe();
    base.ingredients[0].equivalent = '';
    base.ingredients[1].equivalent = '2 cups';
    base.ingredients[2].equivalent = '3 large eggs';
    expect(findUnscalableEquivalents(base, 3)).toEqual([]);
  });
  it('lists an already-annotated equivalent as already-stale', () => {
    const base = recipe();
    base.ingredients[0].equivalentBakeFactor = 3;
    expect(findUnscalableEquivalents(base, 2)[0].reason).toBe('already-stale');
  });
  it('returns nothing for a factor-1 portion-only bake', () => {
    expect(findUnscalableEquivalents(proseRecipe(), 1)).toEqual([]);
  });
});

describe('applyScaleToRecipe baked equivalents', () => {
  it('annotates an unscalable equivalent with the bake factor by default', () => {
    expect(applyScaleToRecipe(proseRecipe(), 3).ingredients[0].equivalentBakeFactor).toBe(3);
  });
  it('clears an unscalable equivalent when the user chooses clear', () => {
    const base = proseRecipe();
    expect(applyScaleToRecipe(base, 3, undefined, { [base.ingredients[0].id]: 'clear' }).ingredients[0])
      .toMatchObject({ equivalent: '', equivalentBakeFactor: null });
  });
  it('never annotates a blank equivalent', () => {
    const base = recipe();
    base.ingredients[0].equivalent = '';
    expect(applyScaleToRecipe(base, 3).ingredients[0].equivalentBakeFactor).toBeNull();
  });
  it('rescaled equivalents carry no annotation', () => {
    const scaled = applyScaleToRecipe(recipe(), 3).ingredients[0];
    expect(scaled.equivalent).toBe('3 3/4 cups chopped');
    expect(scaled.equivalentBakeFactor).toBeNull();
  });
  it('a second bake multiplies an existing annotation and never rescales its text', () => {
    const base = recipe();
    base.ingredients[0].equivalentBakeFactor = 3;
    const scaled = applyScaleToRecipe(base, 2).ingredients[0];
    expect(scaled.equivalent).toBe(base.ingredients[0].equivalent);
    expect(scaled.equivalentBakeFactor).toBe(6);
  });
  it('a bake that returns the cumulative factor to 1× clears the annotation', () => {
    const base = applyScaleToRecipe(proseRecipe(), 3);
    expect(applyScaleToRecipe(base, 1 / 3).ingredients[0].equivalentBakeFactor).toBeNull();
  });
  it('a factor-1 portion-only bake leaves annotations untouched', () => {
    const base = applyScaleToRecipe(proseRecipe(), 3);
    expect(applyScaleToRecipe(base, 1, { count: 4, sizeG: 50 }).ingredients).toEqual(base.ingredients);
  });
});

describe('nextEquivalentBakeFactor', () => {
  it.each([
    {
      label: 'text changed',
      text: 'new measure',
      marked: false,
      expected: null,
    },
    {
      label: 'blank',
      text: '',
      marked: false,
      expected: null,
    },
    {
      label: 'marked correct',
      text: 'a generous handful',
      marked: true,
      expected: null,
    },
    {
      label: 'unchanged and unconfirmed',
      text: 'a generous handful',
      marked: false,
      expected: 3,
    },
  ])('$label', ({ text, marked, expected }) => {
    const previous = applyScaleToRecipe(proseRecipe(), 3).ingredients[0];
    expect(nextEquivalentBakeFactor(previous, text, marked, previous.quantityG)).toBe(expected);
  });

  it('multiplies the stored factor by new grams over old grams', () => {
    const previous = applyScaleToRecipe(proseRecipe(), 3).ingredients[0];
    expect(previous.quantityG).toBe(600);
    expect(nextEquivalentBakeFactor(previous, previous.equivalent, false, 1200)).toBe(6);
  });

  it('clears the factor when the rescaled value is 1 within tolerance', () => {
    const previous = applyScaleToRecipe(proseRecipe(), 3).ingredients[0];
    expect(nextEquivalentBakeFactor(previous, previous.equivalent, false, 200)).toBeNull();
    const nearOne = 200 * (1 + FACTOR_ONE_EPSILON / 2);
    expect(nextEquivalentBakeFactor(previous, previous.equivalent, false, nearOne)).toBeNull();
  });

  it('keeps a rescaled factor that stays outside the 1× tolerance', () => {
    const previous = applyScaleToRecipe(proseRecipe(), 3).ingredients[0];
    const grams = 200 * (1 + FACTOR_ONE_EPSILON * 2);
    const factor = nextEquivalentBakeFactor(previous, previous.equivalent, false, grams);
    expect(factor).not.toBeNull();
    expect(factor).toBeGreaterThan(1);
  });

  it.each([
    { label: 'unknown grams', grams: null },
    { label: 'zero grams', grams: 0 },
    { label: 'negative grams', grams: -1 },
  ])('keeps the stale-after-bake factor for $label', ({ grams }) => {
    const previous = applyScaleToRecipe(proseRecipe(), 3).ingredients[0];
    expect(nextEquivalentBakeFactor(previous, previous.equivalent, false, grams)).toBe(
      previous.equivalentBakeFactor,
    );
  });

  it('leaves an unannotated ingredient clear when grams change', () => {
    const previous = proseRecipe().ingredients[0];
    expect(nextEquivalentBakeFactor(previous, previous.equivalent, false, 50)).toBeNull();
  });

  it('clears the annotation when the equivalent text changes along with grams', () => {
    const previous = applyScaleToRecipe(proseRecipe(), 3).ingredients[0];
    expect(nextEquivalentBakeFactor(previous, '2 cups', false, 1200)).toBeNull();
  });
});
