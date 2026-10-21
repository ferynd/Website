import { describe, expect, it } from 'vitest';
import {
  calculateRecipeNutrition,
  computeBaseContributions,
  linkExclusionReason,
  MAX_INGREDIENT_GRAMS,
  quantityExclusionReason,
} from '../lib/nutritionCalc';
import { confirmNutritionLink, candidateLink, noMatchLink } from '../lib/nutritionLink';
import { parseRecipeJson } from '../lib/schema';
import { TRACKER_NUTRIENT_KEYS, type FoodsState, type TrackerFood } from '../lib/trackerFoods';
import { UNLINKED_NUTRITION, type Recipe, type RecipeIngredient } from '../lib/types';
import { validRecipeJson, validV2RecipeJson } from './fixtures';

const food = (
  id: string,
  name: string,
  overrides: Partial<Record<(typeof TRACKER_NUTRIENT_KEYS)[number], number | null>> = {},
): TrackerFood => ({
  id,
  name,
  quantity: 1,
  nutrients: Object.fromEntries(TRACKER_NUTRIENT_KEYS.map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : 0,
  ])) as TrackerFood['nutrients'],
  lastUpdated: '2026-01-01T00:00:00.000Z',
});

const FLOUR = food('flour', 'Flour', { calories: 364, protein: 10, carbs: 76, fat: 1 });
const BUTTER = food('butter', 'Butter', { calories: 717, protein: 1, carbs: 0, fat: 81 });
const EGG = food('egg', 'Egg', { calories: 70, protein: 6, carbs: 0, fat: 5 });
const ready = (items: TrackerFood[]): FoodsState => ({ status: 'ready', items, error: '' });
const NO_SCALE = { factor: 1 } as const;

const confirmed = (item: TrackerFood, gramsPerUnit: number) => (
  confirmNutritionLink(item, gramsPerUnit, 0, UNLINKED_NUTRITION)
);

const ingredient = (
  id: string,
  quantityG: number | null,
  nutritionLink = { ...UNLINKED_NUTRITION },
  extra: Partial<RecipeIngredient> = {},
): RecipeIngredient => ({
  id,
  displayName: id,
  quantityG,
  equivalent: '',
  prepNote: '',
  sectionIds: [],
  primarySectionId: '',
  groceryCategory: '',
  optional: false,
  substitutionNotes: '',
  conversionNotes: '',
  nutritionLink,
  ...extra,
});

const recipeOf = (
  ingredients: RecipeIngredient[],
  servings: Recipe['servings'] = {
    baselineServings: 4,
    currentServings: null,
    portionCount: 8,
    portionSizeG: null,
  },
  yieldData: Recipe['yield'] = { estimatedFinalWeightG: 1000, actualFinalWeightG: null, yieldNotes: '' },
): Recipe => {
  const parsed = parseRecipeJson(JSON.stringify(validRecipeJson()));
  if (!parsed.ok) throw new Error('recipe fixture must parse');
  return { ...parsed.recipe, schemaVersion: 2, ingredients, servings, yield: yieldData };
};

const baseRecipe = (): Recipe => recipeOf([
  ingredient('flour-row', 300, confirmed(FLOUR, 100), { displayName: 'Flour' }),
  ingredient('butter-row', 225, confirmed(BUTTER, 100), { displayName: 'Butter' }),
  ingredient('egg-row', 100, confirmed(EGG, 50), { displayName: 'Egg' }),
]);

const calculate = (recipe: Recipe, foods: FoodsState = ready([FLOUR, BUTTER, EGG]), factor = 1) => (
  calculateRecipeNutrition({ recipe, foods, scale: { factor } })
);

describe('nutrition link exclusions', () => {
  it.each([
    ['unlinked', 'unlinked'],
    ['no-match', 'no-match'],
    ['candidate', 'candidate'],
    ['candidate-missing', 'candidate-missing'],
    ['stale-missing', 'stale-missing'],
    ['stale-renamed', 'stale-renamed'],
    ['stale-revised', 'stale-revised'],
    ['confirmed-unverified', 'foods-unavailable'],
    ['confirmed', null],
  ] as const)('maps %s to %s', (state, expected) => {
    const link = state === 'confirmed' ? confirmed(FLOUR, 100) : { ...UNLINKED_NUTRITION };
    const assessment = state === 'confirmed'
      ? { state, food: FLOUR, currentName: FLOUR.name } as const
      : { state, food: null, currentName: null } as const;
    expect(linkExclusionReason(link, assessment)).toBe(expected);
  });

  it('excludes confirmed links without a target fingerprint as unverifiable', () => {
    const link = { ...confirmed(FLOUR, 100), targetFingerprint: null };
    expect(linkExclusionReason(link, { state: 'confirmed', food: FLOUR, currentName: FLOUR.name })).toBe('unverifiable-target');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, 10001])(
    'excludes an invalid confirmed gram basis %s',
    (gramsPerUnit) => {
      const link = { ...confirmed(FLOUR, 100), gramsPerUnit };
      expect(linkExclusionReason(link, { state: 'confirmed', food: FLOUR, currentName: FLOUR.name })).toBe('invalid-basis');
    },
  );
});

describe('quantity exclusions', () => {
  it.each([null, undefined])('returns missing-quantity for %s', (value) => {
    expect(quantityExclusionReason(value)).toBe('missing-quantity');
  });

  it('returns zero-quantity for zero grams', () => {
    expect(quantityExclusionReason(0)).toBe('zero-quantity');
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '10', MAX_INGREDIENT_GRAMS + 1])(
    'returns invalid-quantity for %s',
    (value) => expect(quantityExclusionReason(value)).toBe('invalid-quantity'),
  );

  it('accepts small fractional and maximum supported ingredient weights', () => {
    expect(quantityExclusionReason(0.01)).toBeNull();
    expect(quantityExclusionReason(MAX_INGREDIENT_GRAMS)).toBeNull();
  });
});

describe('complete recipe coverage', () => {
  it('computes quantityG times nutrient divided by gramsPerUnit for each ingredient', () => {
    const result = calculate(baseRecipe());
    expect(result.included[0].baseContributions.calories).toBe(1092);
    expect(result.included[1].baseContributions.calories).toBe(1613.25);
    expect(result.included[2].baseContributions.calories).toBe(140);
  });

  it('returns all nutrients in tracker order for every available basis', () => {
    const result = calculate(baseRecipe());
    for (const basis of Object.values(result.bases)) {
      if (basis.amounts !== null) expect(Object.keys(basis.amounts)).toEqual(TRACKER_NUTRIENT_KEYS);
    }
  });

  it('sums the integer-friendly fixture exactly', () => {
    const result = calculate(baseRecipe());
    expect(result.bases.total.amounts?.calories.value).toBe(2845.25);
    expect(result.bases.total.amounts?.fat.value).toBe(195.25);
    expect(result.coverage.knownGrams).toBe(625);
  });

  it('reports complete coverage with equal counted and known grams', () => {
    expect(calculate(baseRecipe()).coverage).toMatchObject({
      status: 'complete', includedCount: 3, totalCount: 3, coveredGrams: 625, knownGrams: 625,
    });
  });

  it('does not mark complete totals as lower bounds when nutrients are present', () => {
    const result = calculate(baseRecipe());
    expect(TRACKER_NUTRIENT_KEYS.every((key) => !result.bases.total.amounts?.[key].isLowerBound)).toBe(true);
  });

  it('uses non-100 gram food bases and ignores the tracker quantity field', () => {
    const item = { ...FLOUR, quantity: 999 };
    const result = calculate(recipeOf([ingredient('flour', 50, confirmed(item, 25))]), ready([item]));
    expect(result.bases.total.amounts?.calories.value).toBe(728);
  });

  it('keeps same-name foods with different gram bases independent', () => {
    const smallUnit = food('small', 'Flour', { calories: 100 });
    const largeUnit = food('large', 'Flour', { calories: 200 });
    const result = calculate(recipeOf([
      ingredient('a', 50, confirmed(smallUnit, 50)),
      ingredient('b', 100, confirmed(largeUnit, 100)),
    ]), ready([smallUnit, largeUnit]));
    expect(result.bases.total.amounts?.calories.value).toBe(300);
  });

  it('counts optional ingredients and reports their included count', () => {
    const recipe = recipeOf([ingredient('optional', 10, confirmed(FLOUR, 100), { optional: true })]);
    expect(calculate(recipe).coverage.optionalIncludedCount).toBe(1);
  });
});

describe('partial and empty coverage', () => {
  it('marks partial totals as lower bounds when one ingredient is unlinked', () => {
    const recipe = recipeOf([
      ingredient('linked', 100, confirmed(FLOUR, 100)),
      ingredient('missing', 50),
    ]);
    const result = calculate(recipe);
    expect(result.coverage.status).toBe('partial');
    expect(result.bases.total.amounts?.calories.isLowerBound).toBe(true);
  });

  it('reports counted and known grams for partial coverage', () => {
    const recipe = recipeOf([ingredient('linked', 100, confirmed(FLOUR, 100)), ingredient('missing', 50)]);
    expect(calculate(recipe).coverage).toMatchObject({ coveredGrams: 100, knownGrams: 150 });
  });

  it('reports null totals when nothing can be counted', () => {
    const result = calculate(recipeOf([ingredient('missing', 50)]));
    expect(result.coverage.status).toBe('none');
    expect(result.bases.total.amounts).toBeNull();
  });

  it('reports none with zero rows for a recipe without ingredients', () => {
    const result = calculate(recipeOf([]));
    expect(result.coverage).toMatchObject({ status: 'none', totalCount: 0 });
  });

  it('never counts automatic candidates even when the name matches exactly', () => {
    const recipe = recipeOf([ingredient('candidate', 100, candidateLink(FLOUR, 1), { displayName: 'Flour' })]);
    expect(calculate(recipe).coverage.includedCount).toBe(0);
  });

  it('excludes no-match ingredients', () => {
    expect(calculate(recipeOf([ingredient('none', 20, noMatchLink())])).excluded[0].reasons).toContain('no-match');
  });

  it('excludes candidates whose suggested food was deleted', () => {
    const link = candidateLink(FLOUR, 1);
    const result = calculate(recipeOf([ingredient('gone', 20, link)]), ready([]));
    expect(result.excluded[0].reasons).toContain('candidate-missing');
  });
});

describe('stale and unverifiable links', () => {
  it('excludes a deleted confirmed target', () => {
    expect(calculate(recipeOf([ingredient('gone', 50, confirmed(FLOUR, 100))]), ready([])).excluded[0].reasons).toContain('stale-missing');
  });

  it('excludes a renamed target and exposes its current name', () => {
    const renamed = food('flour', 'Bread Flour');
    const result = calculate(recipeOf([ingredient('row', 50, confirmed(FLOUR, 100))]), ready([renamed]));
    expect(result.excluded[0]).toMatchObject({ currentName: 'Bread Flour', reasons: ['stale-renamed'] });
  });

  it('excludes a revised target', () => {
    const revised = food('flour', 'Flour', { calories: 400 });
    expect(calculate(recipeOf([ingredient('row', 50, confirmed(FLOUR, 100))]), ready([revised])).excluded[0].reasons).toContain('stale-revised');
  });

  it('treats tracker quantity changes as revised targets', () => {
    const revised = { ...FLOUR, quantity: 2 };
    expect(calculate(recipeOf([ingredient('row', 50, confirmed(FLOUR, 100))]), ready([revised])).excluded[0].reasons).toContain('stale-revised');
  });

  it.each(['idle', 'loading', 'error'] as const)('excludes confirmed rows while foods are %s', (status) => {
    const foods: FoodsState = { status, items: [], error: '' };
    expect(calculate(recipeOf([ingredient('row', 50, confirmed(FLOUR, 100))]), foods).excluded[0].reasons).toContain('foods-unavailable');
  });

  it('treats a loaded empty food list as deleted targets', () => {
    expect(calculate(recipeOf([ingredient('row', 50, confirmed(FLOUR, 100))]), ready([])).excluded[0].reasons).toContain('stale-missing');
  });

  it('keeps stale-only totals null instead of treating stale data as zero', () => {
    expect(calculate(recipeOf([ingredient('row', 50, confirmed(FLOUR, 100))]), ready([])).bases.total.amounts).toBeNull();
  });

  it('excludes overflowing contributions as invalid-basis', () => {
    const huge = food('huge', 'Huge', { calories: 900 });
    const link = { ...confirmed(huge, 1e-300) };
    const result = calculate(recipeOf([ingredient('row', 1e6, link)]), ready([huge]));
    expect(result.excluded[0].reasons).toContain('invalid-basis');
  });
});

describe('ingredient quantities and exclusion actions', () => {
  it('preserves missing equivalent text on the excluded row', () => {
    const result = calculate(recipeOf([ingredient('row', null, confirmed(FLOUR, 100), { equivalent: '2 cloves' })]));
    expect(result.excluded[0]).toMatchObject({ equivalent: '2 cloves', reasons: ['missing-quantity'] });
  });

  it('excludes zero gram quantities', () => {
    expect(calculate(recipeOf([ingredient('row', 0, confirmed(FLOUR, 100))])).excluded[0].reasons).toContain('zero-quantity');
  });

  it.each([-2, Number.NaN, Number.POSITIVE_INFINITY])('excludes invalid quantity %s', (quantityG) => {
    expect(calculate(recipeOf([ingredient('row', quantityG, confirmed(FLOUR, 100))])).excluded[0].reasons).toContain('invalid-quantity');
  });

  it('lists the link reason before a quantity reason', () => {
    expect(calculate(recipeOf([ingredient('row', null)])).excluded[0].reasons).toEqual(['unlinked', 'missing-quantity']);
  });

  it('sets edit actions from the applicable exclusion reasons', () => {
    expect(calculate(recipeOf([ingredient('row', null)])).excluded[0]).toMatchObject({ canEditLink: true, canEditQuantity: true });
  });

  it('does not offer link editing for foods-unavailable rows', () => {
    const foods: FoodsState = { status: 'idle', items: [], error: '' };
    const result = calculate(recipeOf([ingredient('row', 20, confirmed(FLOUR, 100))]), foods);
    expect(result.excluded[0].canEditLink).toBe(false);
  });

  it('counts unknown-weight rows separately from known grams', () => {
    expect(calculate(recipeOf([ingredient('unknown', null), ingredient('known', 20)])).coverage).toMatchObject({ unknownWeightCount: 1, knownGrams: 20 });
  });

  it('stays partial at full known-gram coverage when an unknown-weight row exists', () => {
    const recipe = recipeOf([ingredient('linked', 20, confirmed(FLOUR, 100)), ingredient('unknown', null)]);
    expect(calculate(recipe).coverage).toMatchObject({ status: 'partial', coveredGrams: 20, knownGrams: 20 });
  });
});

describe('missing nutrient data', () => {
  it('treats null nutrient values as unknown and lowers only that nutrient', () => {
    const incomplete = food('incomplete', 'Incomplete', { calories: null, protein: 10 });
    const result = calculate(recipeOf([ingredient('row', 100, confirmed(incomplete, 100))]), ready([incomplete]));
    expect(result.bases.total.amounts?.calories).toMatchObject({ value: null, isLowerBound: true, missingFromIngredientIds: ['row'] });
    expect(result.bases.total.amounts?.protein.isLowerBound).toBe(false);
  });

  it('treats negative nutrient values as unknown', () => {
    const incomplete = food('incomplete', 'Incomplete', { calories: -1 });
    expect(computeBaseContributions(100, incomplete, 100)?.calories).toBeNull();
  });

  it('returns null where no counted food provides a nutrient', () => {
    const incomplete = food('incomplete', 'Incomplete', { calories: null });
    expect(calculate(recipeOf([ingredient('row', 100, confirmed(incomplete, 100))]), ready([incomplete])).bases.total.amounts?.calories.value).toBeNull();
  });

  it('keeps row coverage complete while reporting nutrient gaps', () => {
    const incomplete = food('incomplete', 'Incomplete', { calories: null });
    const result = calculate(recipeOf([ingredient('row', 100, confirmed(incomplete, 100))]), ready([incomplete]));
    expect(result.coverage.status).toBe('complete');
    expect(result.coverage.nutrientGaps).toContain('calories');
  });

  it('reports a nutrient gap when finite contributions overflow while summing', () => {
    const huge = food('huge', 'Huge', { calories: 1e308 });
    const result = calculate(recipeOf([
      ingredient('first', 1, confirmed(huge, 1)),
      ingredient('second', 1, confirmed(huge, 1)),
    ]), ready([huge]));

    expect(result.coverage.nutrientGaps).toContain('calories');
    expect(result.bases.total.amounts?.calories).toMatchObject({
      value: null,
      isLowerBound: true,
      missingFromIngredientIds: [],
    });
  });
});

describe('workflow rows and duplicate identifiers', () => {
  it('counts only recipe.ingredients and ignores prep groups and step results', () => {
    const parsed = parseRecipeJson(JSON.stringify(validV2RecipeJson()));
    if (!parsed.ok) throw new Error('v2 fixture must parse');
    const recipe = parsed.recipe;
    const result = calculateRecipeNutrition({ recipe, foods: ready([]), scale: NO_SCALE });
    expect(result.coverage.totalCount).toBe(recipe.ingredients.length);
    const withReferences = {
      ...recipe,
      prepGroups: [...recipe.prepGroups, { ...recipe.prepGroups[0], id: 'added-group', ingredientIds: recipe.ingredients.map((row) => row.id) }],
      activeSteps: recipe.activeSteps.map((step) => ({ ...step, result: { id: 'extra-result', name: 'extra' } })),
    };
    expect(calculateRecipeNutrition({ recipe: withReferences, foods: ready([]), scale: NO_SCALE }).coverage).toEqual(result.coverage);
  });

  it('counts the first duplicate id and excludes later rows', () => {
    const result = calculate(recipeOf([
      ingredient('duplicate', 10, confirmed(FLOUR, 100)),
      ingredient('duplicate', 30, confirmed(BUTTER, 100)),
    ]));
    expect(result.coverage.includedCount).toBe(1);
    expect(result.included[0]).toMatchObject({ index: 0, ingredientId: 'duplicate' });
    expect(result.excluded[0]).toMatchObject({
      index: 1,
      ingredientId: 'duplicate',
      reasons: ['duplicate-id'],
      canEditLink: false,
      canEditQuantity: false,
    });
    expect(result.coverage.knownGrams).toBe(40);
    expect(result.bases.total.amounts?.calories.value).toBe(36.4);
    expect(result.coverage.status).toBe('partial');
  });

  it('preserves included and excluded rows with their recipe indexes', () => {
    const result = calculate(recipeOf([
      ingredient('one', 10, confirmed(FLOUR, 100)),
      ingredient('two', 20),
      ingredient('three', 30, confirmed(EGG, 50)),
    ]));
    expect(result.included.map((row) => row.index)).toEqual([0, 2]);
    expect(result.excluded.map((row) => row.index)).toEqual([1]);
  });
});

describe('scale behavior', () => {
  it('multiplies totals and gram coverage by the scale factor', () => {
    const result = calculate(baseRecipe(), ready([FLOUR, BUTTER, EGG]), 2);
    expect(result.bases.total.amounts?.calories.value).toBe(5690.5);
    expect(result.coverage).toMatchObject({ coveredGrams: 1250, knownGrams: 1250 });
  });

  it('produces exactly factor-scaled totals', () => {
    const base = calculate(baseRecipe()).bases.total.amounts?.calories.value;
    expect(calculate(baseRecipe(), ready([FLOUR, BUTTER, EGG]), 2).bases.total.amounts?.calories.value).toBe((base ?? 0) * 2);
  });

  it.each([0.5, 1.5, 3])('keeps normalized bases unchanged at scale %s', (factor) => {
    const recipe = baseRecipe();
    const result = calculate(recipe, ready([FLOUR, BUTTER, EGG]), factor);
    expect(result.bases.perServing.amounts?.calories.value).toBe(2845.25 / 4);
    expect(result.bases.perPortion.amounts?.calories.value).toBe(2845.25 / 8);
    expect(result.bases.per100gCooked.amounts?.calories.value).toBe(2845.25 * 100 / 1000);
  });

  it('uses exact scaled ingredient grams instead of kitchen-rounded display grams', () => {
    const result = calculate(recipeOf([ingredient('flour', 3, confirmed(FLOUR, 100))]), ready([FLOUR]), 1.37);
    expect(result.included[0].scaledGrams).toBe(4.11);
    expect(result.bases.total.amounts?.calories.value).toBeCloseTo(14.9604, 12);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('falls back to factor 1 for scale %s', (factor) => {
    expect(calculate(baseRecipe(), ready([FLOUR, BUTTER, EGG]), factor).factor).toBe(1);
  });

  it('keeps missing quantities excluded at every scale', () => {
    const result = calculate(recipeOf([ingredient('unknown', null, confirmed(FLOUR, 100))]), ready([FLOUR]), 3);
    expect(result.excluded[0].reasons).toContain('missing-quantity');
  });

  it('uses a portions-mode override count for per-portion nutrition while scaled', () => {
    const result = calculateRecipeNutrition({
      recipe: baseRecipe(),
      foods: ready([FLOUR, BUTTER, EGG]),
      scale: { factor: 2, portionOverride: { count: 10, sizeG: 150 } },
    });
    expect(result.bases.perPortion.portionCount).toBe(10);
    expect(result.bases.perPortion.amounts?.calories.value).toBe(2845.25 / 5);
  });
});

describe('nutrition bases', () => {
  it('divides baseline totals by baseline servings and reports current scaled servings', () => {
    const result = calculate(baseRecipe(), ready([FLOUR, BUTTER, EGG]), 2);
    expect(result.bases.perServing.amounts?.calories.value).toBe(2845.25 / 4);
    expect(result.bases.perServing.servings).toBe(8);
  });

  it.each([null, 0])('marks per-serving unavailable without positive baseline servings (%s)', (servings) => {
    const recipe = recipeOf(baseRecipe().ingredients, { baselineServings: servings, currentServings: null, portionCount: null, portionSizeG: null });
    expect(calculate(recipe).bases.perServing.unavailableReason).toBe('no-servings');
  });

  it('derives portion size from final weight and count', () => {
    const recipe = recipeOf(baseRecipe().ingredients, { baselineServings: 4, currentServings: null, portionCount: 8, portionSizeG: 75 });
    expect(calculate(recipe).bases.perPortion).toMatchObject({ portionMode: 'count', portionCount: 8, portionSizeG: 125, finalWeightG: 1000 });
  });

  it('ignores an inconsistent stored size in count mode', () => {
    const recipe = recipeOf(baseRecipe().ingredients, { baselineServings: 4, currentServings: null, portionCount: 8, portionSizeG: 75 });
    expect(calculate(recipe).bases.perPortion.portionSizeG).not.toBe(75);
  });

  it('leaves count-mode portion size null without final weight', () => {
    const recipe = recipeOf(baseRecipe().ingredients, { baselineServings: 4, currentServings: null, portionCount: 8, portionSizeG: 75 }, { estimatedFinalWeightG: null, actualFinalWeightG: null, yieldNotes: '' });
    expect(calculate(recipe).bases.perPortion).toMatchObject({ portionMode: 'count', portionSizeG: null, finalWeightG: null, weightSource: null, estimated: false });
  });

  it('marks count-mode size as estimated when using estimated final weight', () => {
    expect(calculate(baseRecipe()).bases.perPortion).toMatchObject({ portionMode: 'count', portionSizeG: 125, finalWeightG: 1000, weightSource: 'estimated', estimated: true });
  });

  it('does not mark count-mode nutrition estimated when measured weight is scaled', () => {
    const recipe = recipeOf(
      baseRecipe().ingredients,
      undefined,
      { estimatedFinalWeightG: 1000, actualFinalWeightG: 900, yieldNotes: '' },
    );
    expect(calculate(recipe, ready([FLOUR, BUTTER, EGG]), 2).bases.perPortion).toMatchObject({
      portionMode: 'count',
      finalWeightG: 1800,
      weightSource: 'actual',
      estimated: false,
    });
  });

  it('marks a portion override estimated when the reference weight is estimated', () => {
    const result = calculateRecipeNutrition({
      recipe: baseRecipe(),
      foods: ready([FLOUR, BUTTER, EGG]),
      scale: { factor: 1.5, portionOverride: { count: 10, sizeG: 150 } },
    });
    expect(result.bases.perPortion).toMatchObject({ portionMode: 'override', estimated: true });
  });

  it('falls back to count mode when the portion override count is invalid', () => {
    const result = calculateRecipeNutrition({
      recipe: baseRecipe(),
      foods: ready([FLOUR, BUTTER, EGG]),
      scale: { factor: 1, portionOverride: { count: 0, sizeG: 150 } },
    });
    expect(result.bases.perPortion).toMatchObject({ portionMode: 'count', portionCount: 8 });
  });

  it('uses a portion override at exactly 1×', () => {
    const result = calculateRecipeNutrition({
      recipe: baseRecipe(),
      foods: ready([FLOUR, BUTTER, EGG]),
      scale: { factor: 1, portionOverride: { count: 10, sizeG: 150 } },
    });
    expect(result.bases.perPortion).toMatchObject({
      portionMode: 'override',
      portionCount: 10,
      portionSizeG: 150,
    });
    expect(result.bases.perPortion.amounts?.calories.value).toBe(284.525);
  });

  it('falls back to portion size over final weight and flags an estimated weight', () => {
    const recipe = recipeOf(baseRecipe().ingredients, { baselineServings: 4, currentServings: null, portionCount: null, portionSizeG: 100 });
    expect(calculate(recipe).bases.perPortion).toMatchObject({ portionMode: 'size', estimated: true });
  });

  it('requires a final weight for size-based portions', () => {
    const recipe = recipeOf(baseRecipe().ingredients, { baselineServings: 4, currentServings: null, portionCount: null, portionSizeG: 100 }, { estimatedFinalWeightG: null, actualFinalWeightG: null, yieldNotes: '' });
    expect(calculate(recipe).bases.perPortion.unavailableReason).toBe('no-final-weight');
  });

  it('reports missing portion data when neither count nor size exists', () => {
    const recipe = recipeOf(baseRecipe().ingredients, { baselineServings: 4, currentServings: null, portionCount: null, portionSizeG: null });
    expect(calculate(recipe).bases.perPortion.unavailableReason).toBe('no-portion-data');
  });

  it('uses actual final weight without an estimated flag at 1×', () => {
    const recipe = recipeOf(baseRecipe().ingredients, undefined, { estimatedFinalWeightG: 1000, actualFinalWeightG: 900, yieldNotes: '' });
    expect(calculate(recipe).bases.per100gCooked).toMatchObject({ estimated: false, weightSource: 'actual', finalWeightG: 900 });
  });

  it('marks actual final weight as projected when scaled', () => {
    const recipe = recipeOf(baseRecipe().ingredients, undefined, { estimatedFinalWeightG: 1000, actualFinalWeightG: 900, yieldNotes: '' });
    expect(calculate(recipe, ready([FLOUR, BUTTER, EGG]), 2).bases.per100gCooked).toMatchObject({
      estimated: true,
      weightSource: 'actual',
      finalWeightG: 1800,
    });
  });

  it('uses estimated final weight when actual weight is unavailable', () => {
    expect(calculate(baseRecipe()).bases.per100gCooked.estimated).toBe(true);
  });

  it('ignores an actual final weight of zero and uses the estimate', () => {
    const recipe = recipeOf(baseRecipe().ingredients, undefined, { estimatedFinalWeightG: 1000, actualFinalWeightG: 0, yieldNotes: '' });
    expect(calculate(recipe).bases.per100gCooked.weightSource).toBe('estimated');
  });

  it('marks cooked-weight basis unavailable when no weight exists', () => {
    const recipe = recipeOf(baseRecipe().ingredients, undefined, { estimatedFinalWeightG: null, actualFinalWeightG: null, yieldNotes: '' });
    expect(calculate(recipe).bases.per100gCooked.unavailableReason).toBe('no-final-weight');
  });

  it('propagates lower-bound flags to every available basis when coverage is partial', () => {
    const recipe = recipeOf([ingredient('linked', 20, confirmed(FLOUR, 100)), ingredient('missed', 10)]);
    const result = calculate(recipe);
    expect(Object.values(result.bases).filter((basis) => basis.amounts !== null).every((basis) => basis.amounts?.calories.isLowerBound)).toBe(true);
  });

  it('marks each basis no-coverage with no amounts when coverage is none', () => {
    const result = calculate(recipeOf([ingredient('unlinked', 10)]));
    expect(Object.values(result.bases).every((basis) => basis.unavailableReason === 'no-coverage' && basis.amounts === null)).toBe(true);
  });
});

describe('calculator determinism and safety', () => {
  it('returns deeply equal results for repeated calls', () => {
    expect(calculate(baseRecipe())).toEqual(calculate(baseRecipe()));
  });

  it('does not mutate recipe or foods', () => {
    const recipe = baseRecipe();
    const foods = ready([FLOUR, BUTTER, EGG]);
    const before = structuredClone({ recipe, foods });
    const freeze = (value: unknown): void => {
      if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    };
    freeze(recipe);
    freeze(foods);
    calculate(recipe, foods, 1.5);
    expect({ recipe, foods }).toEqual(before);
  });

  it('never returns NaN or Infinity in calculated results', () => {
    const finite = (value: unknown): boolean => {
      if (typeof value === 'number') return Number.isFinite(value);
      if (Array.isArray(value)) return value.every(finite);
      if (typeof value === 'object' && value !== null) return Object.values(value).every(finite);
      return true;
    };
    expect(finite(calculate(baseRecipe()))).toBe(true);
    expect(finite(calculate(recipeOf([ingredient('bad', Number.NaN)])))).toBe(true);
  });
});
