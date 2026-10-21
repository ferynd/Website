/* --- CONFIGURATION: nutrition export test matrix --- */
const ROUNDING_CASES = [
  [71.875, 71.88],
  [25.625, 25.63],
  [6.5625, 6.56],
  [0.004, 0],
] as const;

/**
 * Covers export payload values, stale status, collisions, requests, and tracker quantity semantics.
 */

import { describe, expect, it } from 'vitest';
import { allNutrients, NUTRIENT_MAX_BOUNDS } from '../../../../public/tools/CalorieTracker/constants.js';
import { parseQty } from '../../../../public/tools/CalorieTracker/state/store.js';
import { calculateRecipeNutrition } from '../lib/nutritionCalc';
import {
  foodsReady,
  butterCookiesRecipe,
  estimatedOnly,
  exportedRef as makeRef,
  gapFoodsReady,
  gapRecipe,
  hugeRecipe,
  partialRecipe,
  sizeModeRecipe,
  sourceFoodsReady,
  trackerFood,
} from './exportFixtures';
import {
  buildExportCommitRequest,
  buildExportPayload,
  calculateExportNutrition,
  collectExportSourceTargets,
  defaultExportFoodName,
  deriveExportStatus,
  diffExportNutrients,
  exportAction,
  exportTargetChangedSinceReview,
  findExportCollision,
  primaryExportTarget,
  roundExportValue,
  selectExportBasis,
  selectMissingExportBasis,
  trackerFoodLinkTarget,
  ExportRequestError,
  TRACKER_EXPORT_QUANTITY,
} from '../lib/nutritionExport';
import {
  buildTrackerFoodDoc,
  fingerprintTrackerFood,
  parseTrackerFood,
  TRACKER_NUTRIENT_KEYS,
  trackerFoodId,
} from '../lib/trackerFoods';
import type { ExportPayload, ExportStatus } from '../lib/nutritionExport';
import type { NutritionExportBasisKey, Recipe } from '../lib/types';

/** All ingredients stay linked; only butter is missing fiber. */
const recipeWithOneNutrientGap = () => {
  const foods = sourceFoodsReady();
  const items = foods.items.map((food) => ({ ...food, nutrients: { ...food.nutrients } }));
  const butter = items.find((food) => food.id === 'butter');
  if (!butter) throw new Error('Expected butter fixture.');
  butter.nutrients.fiber = null;
  const ready = { ...foods, items };
  const recipe = butterCookiesRecipe();
  return {
    foods: ready,
    recipe: {
      ...recipe,
      ingredients: recipe.ingredients.map((ingredient) => {
        const food = items.find((item) => item.id === ingredient.nutritionLink.foodItemId);
        return food === undefined
          ? ingredient
          : {
              ...ingredient,
              nutritionLink: {
                ...ingredient.nutritionLink,
                targetFingerprint: fingerprintTrackerFood(food),
              },
            };
      }),
    },
  };
};

const payloadFor = (
  recipe: Recipe,
  basis: NutritionExportBasisKey = 'perPortion',
  foods = sourceFoodsReady(),
): ExportPayload => {
  const result = buildExportPayload(recipe, calculateExportNutrition(recipe, foods), basis);
  if (!result.ok) throw new Error(`Expected exportable payload, got ${result.reason}.`);
  return result.payload;
};

const statusFor = (
  recipe: Recipe,
  basis: NutritionExportBasisKey,
  payload: ExportPayload,
  foods = sourceFoodsReady(),
  ref = recipe.nutritionExports[basis],
): ExportStatus =>
  deriveExportStatus({
    basis,
    ref,
    recipeId: 'recipe-1',
    payload: { ok: true, payload },
    foods,
  });

const ownExport = (
  recipe: Recipe,
  payload: ExportPayload,
  basis: NutritionExportBasisKey = payload.basis,
) => {
  const foodId = 'butter_cookies_per_portion';
  const foodName = 'Butter cookies (per portion)';
  const doc = buildTrackerFoodDoc(foodName, payload.nutrients, '2025-01-01T00:00:00.000Z');
  const food = parseTrackerFood(foodId, doc);
  if (food === null) throw new Error('Expected fixture tracker food.');
  const ref = makeRef({
    basis,
    foodId,
    foodName,
    foodLastUpdated: doc.lastUpdated,
    nutritionFingerprint: payload.fingerprint,
    portionCount: payload.portionCount,
    portionSizeG: payload.portionSizeG,
    finalWeightG: payload.finalWeightG,
  });
  const withRef = { ...recipe, nutritionExports: { ...recipe.nutritionExports, [basis]: ref } };
  return { recipe: withRef, ref, food };
};

describe('nutritionExport', () => {
  it.each(ROUNDING_CASES)(
    'roundExportValue rounds to 2 decimals and returns null for NaN/Infinity',
    (value, expected) => {
      expect(roundExportValue(value)).toBe(expected);
      expect(roundExportValue(Number.NaN)).toBeNull();
      expect(roundExportValue(Number.POSITIVE_INFINITY)).toBeNull();
    },
  );

  it('per-portion payload divides the 1× total by portionCount', () => {
    const payload = payloadFor(butterCookiesRecipe());
    expect(payload.nutrients).toMatchObject({ calories: 440, protein: 5.25, carbs: 57.5, fat: 20.5 });
  });

  it('per-100g payload uses the measured final weight', () => {
    const payload = payloadFor(butterCookiesRecipe(), 'per100gCooked');
    expect(payload.nutrients).toMatchObject({ calories: 550, protein: 6.56, carbs: 71.88, fat: 25.63 });
  });

  it('payload is independent of the working scale', () => {
    const recipe = butterCookiesRecipe();
    const foods = sourceFoodsReady();
    const unscaledResult = calculateExportNutrition(recipe, foods);
    const workingCopy = calculateRecipeNutrition({
      recipe,
      foods,
      scale: { factor: 2, portionOverride: undefined },
    });
    expect(workingCopy.factor).toBe(2);
    expect(workingCopy.bases.total.amounts?.calories.value).not.toBe(
      unscaledResult.bases.total.amounts?.calories.value,
    );
    const exportResult = buildExportPayload(recipe, calculateExportNutrition(recipe, foods), 'perPortion');
    expect(exportResult.ok && exportResult.payload.nutrients.calories).toBe(440);
    expect(unscaledResult.bases.total.amounts?.calories.value).toBe(1760);
  });

  it('count-mode per portion does not store estimated weight as measured export context', () => {
    const recipe = estimatedOnly();
    const payload = payloadFor(recipe);
    expect(payload.portionCount).toBe(4);
    expect(payload.portionSizeG).toBeNull();
    expect(payload.finalWeightG).toBeNull();
  });

  it('per-100g is blocked as estimated-final-weight when only an estimate exists', () => {
    const recipe = estimatedOnly();
    const result = buildExportPayload(
      recipe,
      calculateExportNutrition(recipe, sourceFoodsReady()),
      'per100gCooked',
    );
    expect(result).toEqual({ ok: false, reason: 'estimated-final-weight', overCapKeys: [] });
  });

  it('size-mode per portion is blocked as estimated-final-weight without a measured weight', () => {
    const recipe = {
      ...estimatedOnly(),
      servings: { ...estimatedOnly().servings, portionCount: null, portionSizeG: 80 },
    };
    const result = buildExportPayload(
      recipe,
      calculateExportNutrition(recipe, sourceFoodsReady()),
      'perPortion',
    );
    expect(result).toEqual({ ok: false, reason: 'estimated-final-weight', overCapKeys: [] });
  });

  it('size-mode per portion with a measured weight uses portionSizeG / finalWeight', () => {
    const payload = payloadFor(sizeModeRecipe());
    expect(payload.nutrients.calories).toBe(440);
  });

  it('count-mode per portion is exportable with no final weight at all', () => {
    const recipe = butterCookiesRecipe();
    recipe.yield.actualFinalWeightG = null;
    recipe.yield.estimatedFinalWeightG = null;
    expect(
      buildExportPayload(recipe, calculateExportNutrition(recipe, sourceFoodsReady()), 'perPortion').ok,
    ).toBe(true);
  });

  it('no portion data blocks perPortion with no-portion-data', () => {
    const recipe = {
      ...butterCookiesRecipe(),
      servings: { ...butterCookiesRecipe().servings, portionCount: null, portionSizeG: null },
    };
    const result = buildExportPayload(
      recipe,
      calculateExportNutrition(recipe, sourceFoodsReady()),
      'perPortion',
    );
    expect(result).toMatchObject({ ok: false, reason: 'no-portion-data' });
  });

  it('foods not ready blocks both bases with foods-unavailable', () => {
    const recipe = butterCookiesRecipe();
    const result = calculateExportNutrition(recipe, { status: 'loading', items: [], error: '' });
    expect(buildExportPayload(recipe, result, 'perPortion')).toMatchObject({
      ok: false,
      reason: 'foods-unavailable',
    });
    expect(buildExportPayload(recipe, result, 'per100gCooked')).toMatchObject({
      ok: false,
      reason: 'foods-unavailable',
    });
  });

  it('no coverage blocks both bases with no-coverage', () => {
    const recipe = partialRecipe();
    const none = {
      ...recipe,
      ingredients: recipe.ingredients.map((ingredient) => ({
        ...ingredient,
        nutritionLink: {
          ...ingredient.nutritionLink,
          status: 'unlinked' as const,
          foodItemId: null,
          matchedName: null,
          gramsPerUnit: null,
          targetFingerprint: null,
          targetRevision: null,
          confirmedAtMs: null,
        },
      })),
    };
    const result = calculateExportNutrition(none, sourceFoodsReady());
    expect(buildExportPayload(none, result, 'perPortion')).toMatchObject({
      ok: false,
      reason: 'no-coverage',
    });
    expect(buildExportPayload(none, result, 'per100gCooked')).toMatchObject({
      ok: false,
      reason: 'no-coverage',
    });
  });

  it('values above tracker caps block with over-tracker-cap and list the keys', () => {
    const recipe = hugeRecipe();
    const result = buildExportPayload(
      recipe,
      calculateExportNutrition(recipe, sourceFoodsReady()),
      'perPortion',
    );
    expect(result).toMatchObject({
      ok: false,
      reason: 'over-tracker-cap',
      overCapKeys: ['calories', 'protein', 'carbs'],
    });
  });

  it('null nutrient amounts export as 0 and are listed in zeroFilledKeys', () => {
    const recipe = gapRecipe();
    const result = buildExportPayload(
      recipe,
      calculateExportNutrition(recipe, gapFoodsReady()),
      'perPortion',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.nutrients.vitaminD).toBe(0);
      expect(result.payload.zeroFilledKeys).toContain('vitaminD');
      expect(result.payload.includedCount).toBe(result.payload.totalCount);
      expect(result.payload.coverage).toBe('partial');
    }
  });

  it('lower-bound amounts are listed in lowerBoundKeys', () => {
    const gap = buildExportPayload(
      gapRecipe(),
      calculateExportNutrition(gapRecipe(), gapFoodsReady()),
      'perPortion',
    );
    const partial = buildExportPayload(
      partialRecipe(),
      calculateExportNutrition(partialRecipe(), sourceFoodsReady()),
      'perPortion',
    );
    expect(gap.ok && gap.payload.lowerBoundKeys).toContain('fiber');
    expect(partial.ok && partial.payload.lowerBoundKeys).toEqual([...TRACKER_NUTRIENT_KEYS]);
  });

  it('classifies a fully linked recipe as partial when one food lacks a nutrient', () => {
    const { recipe, foods } = recipeWithOneNutrientGap();
    const nutrition = calculateExportNutrition(recipe, foods);
    expect(nutrition.coverage.status).toBe('complete');
    const result = buildExportPayload(recipe, nutrition, 'perPortion');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.includedCount).toBe(result.payload.totalCount);
    expect(result.payload.excludedNames).toEqual([]);
    expect(result.payload.lowerBoundKeys).toContain('fiber');
    expect(result.payload.zeroFilledKeys).not.toContain('fiber');
    expect(result.payload.coverage).toBe('partial');

    const stored = ownExport(recipe, result.payload);
    const tracked = foodsReady(stored.food);
    expect(result.payload.fingerprint).toBe(stored.ref.nutritionFingerprint);
    expect(
      deriveExportStatus({
        basis: 'perPortion',
        ref: stored.ref,
        recipeId: 'recipe-1',
        payload: { ok: true, payload: result.payload },
        foods: tracked,
      }),
    ).toMatchObject({ recipe: 'changed', target: 'unchanged', stale: true });
    expect(
      deriveExportStatus({
        basis: 'perPortion',
        ref: { ...stored.ref, coverage: 'partial' },
        recipeId: 'recipe-1',
        payload: { ok: true, payload: result.payload },
        foods: tracked,
      }),
    ).toMatchObject({ recipe: 'current', stale: false });

    const status = statusFor(stored.recipe, 'perPortion', result.payload, tracked, stored.ref);
    const commitInput = {
      recipe: stored.recipe,
      recipeId: 'recipe-1',
      basis: 'perPortion' as const,
      status,
      payload: result.payload,
      sourceTargets: [],
      chosenName: 'ignored',
      overwriteTrackerEdits: false,
      reviewedTarget: null,
      nowIso: '2025-01-01T00:00:00.000Z',
      nowMs: 99,
    };
    expect(() => buildExportCommitRequest({ ...commitInput, partialConfirmed: false })).toThrow(
      ExportRequestError,
    );
    expect(buildExportCommitRequest({ ...commitInput, partialConfirmed: true }).nextRef.coverage).toBe(
      'partial',
    );
  });

  it('classifies a fully counted recipe with complete nutrient data as complete', () => {
    const recipe = butterCookiesRecipe();
    const nutrition = calculateExportNutrition(recipe, sourceFoodsReady());
    expect(nutrition.coverage.status).toBe('complete');
    const payload = payloadFor(recipe);
    expect(payload.coverage).toBe('complete');
    expect(payload.lowerBoundKeys).toEqual([]);
    expect(payload.zeroFilledKeys).toEqual([]);
    expect(payload.includedCount).toBe(payload.totalCount);
  });

  it('partial coverage payload records coverage, counts, percent and excluded names', () => {
    const recipe = partialRecipe();
    const result = buildExportPayload(
      recipe,
      calculateExportNutrition(recipe, sourceFoodsReady()),
      'perPortion',
    );
    expect(result).toMatchObject({
      ok: true,
      payload: {
        coverage: 'partial',
        includedCount: 2,
        totalCount: 3,
        coveragePercent: '78%',
        excludedNames: ['sugar'],
      },
    });
  });

  it('payload fingerprint equals fingerprintTrackerFood of the built tracker doc', () => {
    const payload = payloadFor(butterCookiesRecipe());
    const doc = buildTrackerFoodDoc('Butter cookies (per portion)', payload.nutrients, 'now');
    expect(fingerprintTrackerFood(parseTrackerFood('food', doc)!)).toBe(payload.fingerprint);
  });

  it('payload fingerprint is identical across repeated calculations', () => {
    const recipe = butterCookiesRecipe();
    expect(payloadFor(recipe).fingerprint).toBe(payloadFor(recipe).fingerprint);
  });

  it('selectExportBasis prefers perPortion when both are exportable', () => {
    const recipe = butterCookiesRecipe();
    const choice = selectExportBasis(
      recipe,
      calculateExportNutrition(recipe, sourceFoodsReady()),
      'recipe-1',
    );
    expect(choice.preferred).toBe('perPortion');
  });

  it('primary export selection prefers the exportable basis without an own reference', () => {
    const recipe = butterCookiesRecipe();
    const portionPayload = payloadFor(recipe, 'perPortion');
    const own = ownExport(recipe, portionPayload, 'perPortion');
    const cookedPayload = payloadFor(recipe, 'per100gCooked');
    const statuses = [
      statusFor(own.recipe, 'perPortion', portionPayload, foodsReady(own.food), own.ref),
      statusFor(own.recipe, 'per100gCooked', cookedPayload, foodsReady(own.food), undefined),
    ];
    const choice = selectExportBasis(
      own.recipe,
      calculateExportNutrition(own.recipe, sourceFoodsReady()),
      'recipe-1',
    );
    expect(selectMissingExportBasis(statuses, choice)).toBe('per100gCooked');
    expect(primaryExportTarget(statuses, choice)).toBe('per100gCooked');
  });

  it('primaryExportTarget opens the chooser when neither basis is already own', () => {
    const recipe = butterCookiesRecipe();
    const foods = sourceFoodsReady();
    const result = calculateExportNutrition(recipe, foods);
    const choice = selectExportBasis(recipe, result, 'recipe-1');
    const statuses = [
      statusFor(recipe, 'perPortion', payloadFor(recipe, 'perPortion')),
      statusFor(recipe, 'per100gCooked', payloadFor(recipe, 'per100gCooked')),
    ];
    expect(choice.options.perPortion.ok).toBe(true);
    expect(choice.options.per100gCooked.ok).toBe(true);
    expect(statuses.every((status) => status.ownership !== 'own')).toBe(true);
    expect(primaryExportTarget(statuses, choice)).toBe('choose');
  });

  it('selectExportBasis falls back to per100gCooked when portion data is missing', () => {
    const recipe = {
      ...butterCookiesRecipe(),
      servings: { ...butterCookiesRecipe().servings, portionCount: null, portionSizeG: null },
    };
    expect(
      selectExportBasis(recipe, calculateExportNutrition(recipe, sourceFoodsReady()), 'recipe-1').preferred,
    ).toBe('per100gCooked');
  });

  it('selectExportBasis preselects the basis that already has an own ref', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe, 'per100gCooked');
    const ref = makeRef({ basis: 'per100gCooked', nutritionFingerprint: payload.fingerprint });
    const withRef = { ...recipe, nutritionExports: { per100gCooked: ref } };
    expect(
      selectExportBasis(withRef, calculateExportNutrition(withRef, sourceFoodsReady()), 'recipe-1').preferred,
    ).toBe('per100gCooked');
  });

  it('selectExportBasis returns preferred=null with both reasons when neither is exportable', () => {
    const recipe = {
      ...butterCookiesRecipe(),
      servings: { ...butterCookiesRecipe().servings, portionCount: null, portionSizeG: null },
      yield: { ...butterCookiesRecipe().yield, actualFinalWeightG: null, estimatedFinalWeightG: null },
    };
    const choice = selectExportBasis(
      recipe,
      calculateExportNutrition(recipe, sourceFoodsReady()),
      'recipe-1',
    );
    expect(choice.preferred).toBeNull();
    expect(choice.options.perPortion).toMatchObject({ ok: false, reason: 'no-portion-data' });
    expect(choice.options.per100gCooked).toMatchObject({ ok: false, reason: 'no-final-weight' });
  });

  it.each([
    ['perPortion', 'Butter cookies (per portion)'],
    ['per100gCooked', 'Butter cookies (per 100 g cooked)'],
  ] as const)('defaultExportFoodName appends the basis suffix and capitalizes', (basis, name) => {
    expect(defaultExportFoodName('butter cookies', basis)).toBe(name);
  });

  it('defaultExportFoodName truncates long names to 80 chars keeping the suffix', () => {
    const name = defaultExportFoodName('a'.repeat(120), 'per100gCooked');
    expect(name).toHaveLength(80);
    expect(name.endsWith(' (per 100 g cooked)')).toBe(true);
  });

  it('no ref → ownership none, not stale', () => {
    const recipe = butterCookiesRecipe();
    const status = deriveExportStatus({
      basis: 'perPortion',
      ref: undefined,
      recipeId: 'recipe-1',
      payload: { ok: true, payload: payloadFor(recipe) },
      foods: sourceFoodsReady(),
    });
    expect(status).toMatchObject({ ownership: 'none', stale: false });
  });

  it('ref from another recipe id → foreign, not stale, action create', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const ref = makeRef({ nutritionFingerprint: payload.fingerprint, recipeId: 'other' });
    const status = statusFor(recipe, 'perPortion', payload, sourceFoodsReady(), ref);
    expect(status).toMatchObject({ ownership: 'foreign', stale: false });
    expect(exportAction(status, { ok: true, payload })).toBe('create');
  });

  it('own ref with matching fingerprint and unchanged target → current, not stale, action update', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const own = ownExport(recipe, payload);
    const status = deriveExportStatus({
      basis: 'perPortion',
      ref: own.ref,
      recipeId: 'recipe-1',
      payload: { ok: true, payload },
      foods: foodsReady(own.food),
    });
    expect(status).toMatchObject({ recipe: 'current', target: 'unchanged', stale: false });
    expect(exportAction(status, { ok: true, payload })).toBe('update');
  });

  it('changing an ingredient quantity after export marks recipe changed and stale', () => {
    const original = butterCookiesRecipe();
    const payload = payloadFor(original);
    const own = ownExport(original, payload);
    const changed = {
      ...own.recipe,
      ingredients: own.recipe.ingredients.map((ingredient) =>
        ingredient.id === 'ing-flour' ? { ...ingredient, quantityG: 250 } : ingredient,
      ),
    };
    const changedPayload = buildExportPayload(
      changed,
      calculateExportNutrition(changed, sourceFoodsReady()),
      'perPortion',
    );
    const status = deriveExportStatus({
      basis: 'perPortion',
      ref: own.ref,
      recipeId: 'recipe-1',
      payload: changedPayload,
      foods: foodsReady(own.food),
    });
    expect(status).toMatchObject({ recipe: 'changed', stale: true });
  });

  it('changing portionCount after export marks recipe changed for perPortion only', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const own = ownExport(recipe, payload);
    const changed = { ...own.recipe, servings: { ...own.recipe.servings, portionCount: 5 } };
    const result = calculateExportNutrition(changed, sourceFoodsReady());
    expect(buildExportPayload(changed, result, 'perPortion')).toMatchObject({
      ok: true,
      payload: { fingerprint: expect.not.stringMatching(payload.fingerprint) },
    });
    expect(buildExportPayload(changed, result, 'per100gCooked')).toMatchObject({
      ok: true,
      payload: { fingerprint: payloadFor(recipe, 'per100gCooked').fingerprint },
    });
  });

  it('revising a linked ingredient food in the tracker marks recipe changed', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const own = ownExport(recipe, payload);
    const revised = sourceFoodsReady();
    const flour = revised.items.find((food) => food.id === 'flour');
    if (flour) flour.nutrients.calories = 361;
    const newPayload = buildExportPayload(recipe, calculateExportNutrition(recipe, revised), 'perPortion');
    const status = deriveExportStatus({
      basis: 'perPortion',
      ref: own.ref,
      recipeId: 'recipe-1',
      payload: newPayload,
      foods: foodsReady(own.food),
    });
    expect(status.recipe).toBe('changed');
  });

  it('removing the measured weight marks per100g unavailable and stale', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe, 'per100gCooked');
    const own = ownExport(recipe, payload, 'per100gCooked');
    const missingWeight = {
      ...own.recipe,
      yield: { ...own.recipe.yield, actualFinalWeightG: null, estimatedFinalWeightG: null },
    };
    const next = buildExportPayload(
      missingWeight,
      calculateExportNutrition(missingWeight, sourceFoodsReady()),
      'per100gCooked',
    );
    const status = deriveExportStatus({
      basis: 'per100gCooked',
      ref: own.ref,
      recipeId: 'recipe-1',
      payload: next,
      foods: foodsReady(own.food),
    });
    expect(status).toMatchObject({ recipe: 'unavailable', stale: true });
  });

  it('editing a non-nutrition field (step text, recipe name) keeps the export current', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const own = ownExport(recipe, payload);
    const edited = {
      ...own.recipe,
      name: 'New name',
      activeSteps: own.recipe.activeSteps.map((step) => ({ ...step, text: 'Bake until done.' })),
    };
    const editedPayload = buildExportPayload(
      edited,
      calculateExportNutrition(edited, sourceFoodsReady()),
      'perPortion',
    );
    const status = deriveExportStatus({
      basis: 'perPortion',
      ref: own.ref,
      recipeId: 'recipe-1',
      payload: editedPayload,
      foods: foodsReady(own.food),
    });
    expect(status).toMatchObject({ recipe: 'current', stale: false });
    expect(edited.name).toBe('New name');
  });

  it('coverage and included counts mark an otherwise identical nutrition snapshot changed', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const own = ownExport(recipe, payload);
    const ref = { ...own.ref, coverage: 'partial' as const, includedCount: 2, totalCount: 3 };
    const status = deriveExportStatus({
      basis: 'perPortion',
      ref,
      recipeId: 'recipe-1',
      payload: { ok: true, payload },
      foods: foodsReady(own.food),
    });
    expect(payload.fingerprint).toBe(ref.nutritionFingerprint);
    expect(status).toMatchObject({ recipe: 'changed', stale: true });
  });

  it.each([
    [
      'nutrient',
      (food: ReturnType<typeof trackerFood>) => ({
        ...food,
        nutrients: { ...food.nutrients, calories: 999 },
      }),
    ],
    ['quantity', (food: ReturnType<typeof trackerFood>) => ({ ...food, quantity: 2 })],
    ['name', (food: ReturnType<typeof trackerFood>) => ({ ...food, name: 'Renamed' })],
    [
      'lastUpdated',
      (food: ReturnType<typeof trackerFood>) => ({ ...food, lastUpdated: '2025-02-01T00:00:00.000Z' }),
    ],
  ] as const)(
    'exported food edited in the tracker (nutrient, quantity, name, or lastUpdated) → target modified',
    (_field, edit) => {
      const recipe = butterCookiesRecipe();
      const payload = payloadFor(recipe);
      const own = ownExport(recipe, payload);
      const status = deriveExportStatus({
        basis: 'perPortion',
        ref: own.ref,
        recipeId: 'recipe-1',
        payload: { ok: true, payload },
        foods: foodsReady(edit(own.food)),
      });
      expect(status.target).toBe('modified');
    },
  );

  it('exported food deleted → target missing, action recreate', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const own = ownExport(recipe, payload);
    const status = deriveExportStatus({
      basis: 'perPortion',
      ref: own.ref,
      recipeId: 'recipe-1',
      payload: { ok: true, payload },
      foods: foodsReady(),
    });
    expect(status.target).toBe('missing');
    expect(exportAction(status, { ok: true, payload })).toBe('recreate');
  });

  it('foods not loaded → recipe/target unknown, not stale, action blocked', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const own = ownExport(recipe, payload);
    const status = deriveExportStatus({
      basis: 'perPortion',
      ref: own.ref,
      recipeId: 'recipe-1',
      payload: { ok: true, payload },
      foods: { status: 'loading', items: [], error: '' },
    });
    expect(status).toMatchObject({ recipe: 'unknown', target: 'unknown', stale: false });
    expect(exportAction(status, { ok: true, payload })).toBe('blocked');
  });

  it('findExportCollision returns the occupying food for a new name', () => {
    const food = trackerFood('other', 'Other food');
    expect(
      findExportCollision('other', [food], {
        ...statusFor(butterCookiesRecipe(), 'perPortion', payloadFor(butterCookiesRecipe())),
        ownership: 'none',
      }),
    ).toEqual(food);
  });

  it("findExportCollision ignores the basis's own exported target", () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const own = ownExport(recipe, payload);
    const status = statusFor(own.recipe, 'perPortion', payload, foodsReady(own.food), own.ref);
    expect(findExportCollision(own.food.id, [own.food], status)).toBeNull();
  });

  it("findExportCollision flags the other basis's exported food as a collision", () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const otherBasisRef = makeRef({
      basis: 'per100gCooked',
      foodId: 'another-id',
      nutritionFingerprint: payload.fingerprint,
    });
    const status = statusFor(recipe, 'perPortion', payload, foodsReady(), otherBasisRef);
    expect(findExportCollision('same', [trackerFood('same', 'Existing')], status)).not.toBeNull();
  });

  it('diffExportNutrients lists changed nutrients and quantity, empty when identical', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const same = trackerFood('id', 'Name', payload.nutrients);
    expect(diffExportNutrients(same, payload)).toMatchObject({ quantityChanged: false, changes: [] });
    expect(
      diffExportNutrients({ ...same, quantity: 2, nutrients: { ...same.nutrients, calories: 1 } }, payload),
    ).toMatchObject({ quantityChanged: true, changes: [{ key: 'calories', before: 1, after: 440 }] });
  });

  it('collectExportSourceTargets dedupes repeated food ids and uses the fingerprints of the foods used', () => {
    const recipe = butterCookiesRecipe();
    const foods = sourceFoodsReady();
    const result = calculateExportNutrition(recipe, foods);
    const targets = collectExportSourceTargets(result, foods.items);
    expect(targets).toHaveLength(3);
    expect(targets[0].fingerprint).toBe(fingerprintTrackerFood(foods.items[0]));
  });

  it('create request uses trackerFoodId(name), expectedTarget null, previousRef from the recipe', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const request = buildExportCommitRequest({
      recipe,
      recipeId: 'recipe-1',
      basis: 'perPortion',
      status: statusFor(recipe, 'perPortion', payload),
      payload,
      sourceTargets: [],
      chosenName: 'Butter cookies (per portion)',
      overwriteTrackerEdits: false,
      reviewedTarget: null,
      partialConfirmed: false,
      nowIso: '2025-01-01T00:00:00.000Z',
      nowMs: 7,
    });
    expect(request).toMatchObject({
      mode: 'create',
      foodId: trackerFoodId('Butter cookies (per portion)'),
      expectedTarget: null,
      previousRef: null,
    });
  });

  it("update request keeps ref.foodId and the tracker's current name, expectedTarget = stored target", () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const own = ownExport(recipe, payload);
    const status = statusFor(own.recipe, 'perPortion', payload, foodsReady(own.food), own.ref);
    const request = buildExportCommitRequest({
      recipe: own.recipe,
      recipeId: 'recipe-1',
      basis: 'perPortion',
      status,
      payload,
      sourceTargets: [],
      chosenName: 'ignored',
      overwriteTrackerEdits: false,
      reviewedTarget: null,
      partialConfirmed: false,
      nowIso: '2025-01-02T00:00:00.000Z',
      nowMs: 8,
    });
    expect(request).toMatchObject({
      mode: 'update',
      foodId: own.ref.foodId,
      doc: { name: own.food.name },
      expectedTarget: { fingerprint: own.ref.nutritionFingerprint, lastUpdated: own.ref.foodLastUpdated },
    });
  });

  it('overwrite request requires the flag and uses the observed target', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const own = ownExport(recipe, payload);
    const edited = { ...own.food, nutrients: { ...own.food.nutrients, calories: 1 } };
    const status = statusFor(own.recipe, 'perPortion', payload, foodsReady(edited), own.ref);
    const input = {
      recipe: own.recipe,
      recipeId: 'recipe-1',
      basis: 'perPortion' as const,
      status,
      payload,
      sourceTargets: [],
      chosenName: '',
      overwriteTrackerEdits: false,
      reviewedTarget: trackerFoodLinkTarget(own.food),
      partialConfirmed: false,
      nowIso: '2025-01-02T00:00:00.000Z',
      nowMs: 8,
    };
    expect(() => buildExportCommitRequest(input)).toThrow(ExportRequestError);
    const request = buildExportCommitRequest({ ...input, overwriteTrackerEdits: true });
    expect(request.expectedTarget?.fingerprint).toBe(fingerprintTrackerFood(own.food));
  });

  it('overwrite target must still match the identity captured during review', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const own = ownExport(recipe, payload);
    const reviewedTarget = trackerFoodLinkTarget(own.food);
    const editedAfterReview = {
      ...own.food,
      nutrients: { ...own.food.nutrients, calories: (own.food.nutrients.calories ?? 0) + 1 },
    };
    const status = statusFor(own.recipe, 'perPortion', payload, foodsReady(editedAfterReview), own.ref);
    expect(status.target).toBe('modified');
    expect(exportTargetChangedSinceReview(status, reviewedTarget)).toBe(true);
    expect(exportTargetChangedSinceReview(status, trackerFoodLinkTarget(editedAfterReview))).toBe(false);
  });

  it('overwrite treats a reviewed target with a different food id as a missing target', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const own = ownExport(recipe, payload);
    const edited = { ...own.food, nutrients: { ...own.food.nutrients, calories: 1 } };
    const status = statusFor(own.recipe, 'perPortion', payload, foodsReady(edited), own.ref);
    const reviewedTarget = { ...trackerFoodLinkTarget(edited), id: 'different-food' };
    const input = {
      recipe: own.recipe,
      recipeId: 'recipe-1',
      basis: 'perPortion' as const,
      status,
      payload,
      sourceTargets: [],
      chosenName: '',
      overwriteTrackerEdits: true,
      reviewedTarget,
      partialConfirmed: false,
      nowIso: '2025-01-02T00:00:00.000Z',
      nowMs: 8,
    };
    expect(reviewedTarget.id).not.toBe(status.targetFood?.id);
    expect(exportTargetChangedSinceReview(status, reviewedTarget)).toBe(true);
    expect(() => buildExportCommitRequest(input)).toThrow('The exported tracker food is not available.');
  });

  it('partial payload without partialConfirmed throws ExportRequestError', () => {
    const recipe = partialRecipe();
    const payload = payloadFor(recipe);
    expect(() =>
      buildExportCommitRequest({
        recipe,
        recipeId: 'recipe-1',
        basis: 'perPortion',
        status: statusFor(recipe, 'perPortion', payload),
        payload,
        sourceTargets: [],
        chosenName: 'Butter cookies (per portion)',
        overwriteTrackerEdits: false,
        reviewedTarget: null,
        partialConfirmed: false,
        nowIso: 'now',
        nowMs: 1,
      }),
    ).toThrow(ExportRequestError);
  });

  it('invalid or reserved names throw ExportRequestError', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    expect(() =>
      buildExportCommitRequest({
        recipe,
        recipeId: 'recipe-1',
        basis: 'perPortion',
        status: statusFor(recipe, 'perPortion', payload),
        payload,
        sourceTargets: [],
        chosenName: '東京',
        overwriteTrackerEdits: false,
        reviewedTarget: null,
        partialConfirmed: false,
        nowIso: 'now',
        nowMs: 1,
      }),
    ).toThrow(ExportRequestError);
  });

  it("exporting into an ingredient's own source food throws ExportRequestError (self-reference)", () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    expect(() =>
      buildExportCommitRequest({
        recipe,
        recipeId: 'recipe-1',
        basis: 'perPortion',
        status: statusFor(recipe, 'perPortion', payload),
        payload,
        sourceTargets: [
          {
            id: trackerFoodId('Butter cookies (per portion)'),
            fingerprint: '',
            normalizedName: '',
            lastUpdated: null,
          },
        ],
        chosenName: 'Butter cookies (per portion)',
        overwriteTrackerEdits: false,
        reviewedTarget: null,
        partialConfirmed: false,
        nowIso: 'now',
        nowMs: 1,
      }),
    ).toThrow(/self-reference/);
  });

  it('request doc has the exact tracker shape and no recipe metadata', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const request = buildExportCommitRequest({
      recipe,
      recipeId: 'recipe-1',
      basis: 'perPortion',
      status: statusFor(recipe, 'perPortion', payload),
      payload,
      sourceTargets: [],
      chosenName: 'Butter cookies (per portion)',
      overwriteTrackerEdits: false,
      reviewedTarget: null,
      partialConfirmed: false,
      nowIso: 'now',
      nowMs: 1,
    });
    expect(Object.keys(request.doc)).toEqual(['name', 'quantity', ...allNutrients, 'lastUpdated']);
    expect(request.doc.quantity).toBe(1);
    expect(request.doc).not.toHaveProperty('recipeId');
  });

  it('nextRef records basis, recipeId, foodId, name, lastUpdated, fingerprint, coverage, counts', () => {
    const recipe = butterCookiesRecipe();
    const payload = payloadFor(recipe);
    const request = buildExportCommitRequest({
      recipe,
      recipeId: 'recipe-1',
      basis: 'perPortion',
      status: statusFor(recipe, 'perPortion', payload),
      payload,
      sourceTargets: [],
      chosenName: 'Butter cookies (per portion)',
      overwriteTrackerEdits: false,
      reviewedTarget: null,
      partialConfirmed: false,
      nowIso: '2025-01-01T00:00:00.000Z',
      nowMs: 99,
    });
    expect(request.nextRef).toEqual({
      basis: 'perPortion',
      recipeId: 'recipe-1',
      foodId: request.foodId,
      foodName: request.doc.name,
      foodLastUpdated: request.doc.lastUpdated,
      nutritionFingerprint: payload.fingerprint,
      exportedAtMs: 99,
      coverage: 'complete',
      includedCount: 3,
      totalCount: 3,
      portionCount: 4,
      portionSizeG: 80,
      finalWeightG: 320,
    });
  });

  it('logging the per-portion food at quantity 1.5 equals 1.5 portions of the recipe', () => {
    const payload = payloadFor(butterCookiesRecipe());
    const quantity = parseQty('1.5');
    // CalorieTracker applies qty × nutrient in staging/parser.js:134 and services/data.js.
    const loggedCalories = quantity * payload.nutrients.calories;
    expect(Math.abs(loggedCalories - (1760 * 1.5) / 4)).toBeLessThan(0.01 * quantity);
  });

  it('logging the per-100g food at quantity 2.5 equals 250 g of the cooked dish', () => {
    const payload = payloadFor(butterCookiesRecipe(), 'per100gCooked');
    const quantity = parseQty('2.5');
    // CalorieTracker applies qty × nutrient in staging/parser.js:134 and services/data.js.
    const loggedCalories = quantity * payload.nutrients.calories;
    expect(loggedCalories).toBe(1375);
    expect(loggedCalories).toBe((1760 * 250) / 320);
  });

  it("the tracker's default quantity prefill (food.quantity) logs exactly one unit", () => {
    const payload = payloadFor(butterCookiesRecipe());
    const doc = buildTrackerFoodDoc('Name', payload.nutrients, 'now');
    const quantity = parseQty(String(doc.quantity));
    expect(quantity).toBe(TRACKER_EXPORT_QUANTITY);
    expect(quantity * doc.calories).toBe(doc.calories);
  });

  it('every exported value is within tracker clamp bounds so logging never clamps', () => {
    const payload = payloadFor(butterCookiesRecipe());
    for (const key of TRACKER_NUTRIENT_KEYS) {
      expect(payload.nutrients[key]).toBeLessThanOrEqual(NUTRIENT_MAX_BOUNDS[key]);
    }
  });
});
