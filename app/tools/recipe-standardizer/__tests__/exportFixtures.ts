/* --- CONFIGURATION: nutrition export test data --- */
const EXPORT_TIMESTAMP = '2025-01-01T00:00:00.000Z';

/**
 * Shared recipe and tracker-food builders for export unit tests.
 * Food links use the same fingerprints as persisted confirmed recipe links.
 */

import { parseRecipeJson } from '../lib/schema';
import {
  fingerprintTrackerFood,
  TRACKER_NUTRIENT_KEYS,
  type FoodsState,
  type TrackerFood,
  type TrackerNutrientKey,
} from '../lib/trackerFoods';
import type { Recipe, RecipeNutritionExport } from '../lib/types';

const zeroNutrients = (): Record<TrackerNutrientKey, number> => {
  const nutrients = {} as Record<TrackerNutrientKey, number>;
  for (const key of TRACKER_NUTRIENT_KEYS) nutrients[key] = 0;
  return nutrients;
};

const sourceFoods: TrackerFood[] = [
  {
    id: 'flour',
    name: 'Flour',
    quantity: 100,
    nutrients: { ...zeroNutrients(), calories: 360, protein: 10, carbs: 75, fat: 1 },
    lastUpdated: EXPORT_TIMESTAMP,
  },
  {
    id: 'butter',
    name: 'Butter',
    quantity: 100,
    nutrients: { ...zeroNutrients(), calories: 720, protein: 1, fat: 80, sodium: 10 },
    lastUpdated: EXPORT_TIMESTAMP,
  },
  {
    id: 'sugar',
    name: 'Sugar',
    quantity: 100,
    nutrients: { ...zeroNutrients(), calories: 400, carbs: 100 },
    lastUpdated: EXPORT_TIMESTAMP,
  },
];

const recipeBase = (): Record<string, unknown> => ({
  schemaVersion: 2,
  name: 'Butter cookies',
  source: { type: '', url: '', notes: '' },
  servings: { baselineServings: 4, currentServings: null, portionCount: 4, portionSizeG: null },
  yield: { estimatedFinalWeightG: 380, actualFinalWeightG: 320, yieldNotes: '' },
  sections: [
    {
      id: 'section',
      name: 'Mix',
      type: 'execution',
      purpose: '',
      order: 1,
      dependsOn: [],
      equipment: [],
      notes: '',
    },
  ],
  ingredients: [
    {
      id: 'ing-flour',
      displayName: 'flour',
      quantityG: 200,
      equivalent: '',
      prepNote: '',
      sectionIds: ['section'],
      primarySectionId: 'section',
      groceryCategory: 'Pantry',
      optional: false,
      substitutionNotes: '',
      conversionNotes: '',
    },
    {
      id: 'ing-butter',
      displayName: 'butter',
      quantityG: 100,
      equivalent: '',
      prepNote: '',
      sectionIds: ['section'],
      primarySectionId: 'section',
      groceryCategory: 'Dairy',
      optional: false,
      substitutionNotes: '',
      conversionNotes: '',
    },
    {
      id: 'ing-sugar',
      displayName: 'sugar',
      quantityG: 80,
      equivalent: '',
      prepNote: '',
      sectionIds: ['section'],
      primarySectionId: 'section',
      groceryCategory: 'Pantry',
      optional: false,
      substitutionNotes: '',
      conversionNotes: '',
    },
  ],
  prepSteps: [],
  activeSteps: [
    {
      id: 'step',
      sectionId: 'section',
      text: 'Mix the ingredients.',
      ingredientRefs: ['ing-flour', 'ing-butter', 'ing-sugar'],
      equipment: [],
      timing: '',
      temperature: '',
      visualCue: '',
      dependencyNote: '',
      order: 1,
    },
  ],
  prepGroups: [],
  timeline: [
    {
      id: 'timeline',
      kind: 'execution',
      phaseLabel: '',
      references: [{ kind: 'step', id: 'step' }],
      titleOverride: '',
      activeTime: '',
      passiveTime: '',
      duringEntryId: '',
      alternatives: [],
      order: 1,
    },
  ],
  techniqueOverrides: [],
  notes: [],
});

/** Return a ready food state containing the supplied tracker foods. */
export const foodsReady = (...foods: TrackerFood[]): FoodsState => ({
  status: 'ready',
  items: foods,
  error: '',
});

/** Create the shared complete Butter cookies fixture with confirmed food links. */
export const butterCookiesRecipe = (): Recipe => {
  const raw = recipeBase();
  const ingredients = raw.ingredients as Record<string, unknown>[];
  ingredients.forEach((ingredient, index) => {
    const food = sourceFoods[index];
    ingredient.nutritionLink = {
      status: 'confirmed',
      foodItemId: food.id,
      matchedName: food.name,
      matchConfidence: null,
      needsUserReview: false,
      gramsPerUnit: 100,
      confirmedAtMs: 1,
      targetRevision: food.lastUpdated,
      targetFingerprint: fingerprintTrackerFood(food),
    };
  });
  const parsed = parseRecipeJson(JSON.stringify(raw));
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  return parsed.recipe;
};

/** Build a stored-reference fixture with stable defaults. */
export const exportedRef = (overrides: Partial<RecipeNutritionExport> = {}): RecipeNutritionExport => ({
  basis: 'perPortion',
  recipeId: 'recipe-1',
  foodId: 'butter_cookies__per_portion_',
  foodName: 'Butter cookies (per portion)',
  foodLastUpdated: EXPORT_TIMESTAMP,
  nutritionFingerprint: 'snapshot',
  exportedAtMs: 1,
  coverage: 'complete',
  includedCount: 3,
  totalCount: 3,
  portionCount: 4,
  portionSizeG: 80,
  finalWeightG: 320,
  ...overrides,
});

/** Build a tracker food with a complete 24-nutrient map. */
export const trackerFood = (
  id: string,
  name: string,
  nutrients: Partial<Record<TrackerNutrientKey, number | null>> = {},
  lastUpdated: string | null = EXPORT_TIMESTAMP,
): TrackerFood => ({
  id,
  name,
  quantity: 1,
  nutrients: { ...zeroNutrients(), ...nutrients },
  lastUpdated,
});

/** Return a recipe with its sugar row unlinked. */
export const partialRecipe = (): Recipe => {
  const recipe = butterCookiesRecipe();
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ingredient) =>
      ingredient.id === 'ing-sugar'
        ? {
            ...ingredient,
            nutritionLink: {
              ...ingredient.nutritionLink,
              status: 'unlinked',
              foodItemId: null,
              matchedName: null,
              gramsPerUnit: null,
              targetFingerprint: null,
              targetRevision: null,
              confirmedAtMs: null,
            },
          }
        : ingredient,
    ),
  };
};

/** Return a recipe with an unknown fiber/vitamin D nutrient contribution. */
export const gapFoodsReady = (): FoodsState => {
  const foods = sourceFoodsReady();
  const items = foods.items.map((food) => ({ ...food, nutrients: { ...food.nutrients } }));
  const butter = items.find((food) => food.id === 'butter');
  if (butter) butter.nutrients.fiber = null;
  for (const food of items) food.nutrients.vitaminD = null;
  return { ...foods, items };
};

/** Return a recipe whose linked butter has an unknown fiber value and whose foods lack vitamin D. */
export const gapRecipe = (): Recipe => {
  const recipe = butterCookiesRecipe();
  const foods = gapFoodsReady();
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ingredient) => {
      const food = foods.items.find((item) => item.id === ingredient.nutritionLink.foodItemId);
      return food === undefined
        ? ingredient
        : {
            ...ingredient,
            nutritionLink: { ...ingredient.nutritionLink, targetFingerprint: fingerprintTrackerFood(food) },
          };
    }),
  };
};

/** Return a recipe whose portion is a fixed size within measured final weight. */
export const sizeModeRecipe = (): Recipe => {
  const recipe = butterCookiesRecipe();
  return { ...recipe, servings: { ...recipe.servings, portionCount: null, portionSizeG: 80 } };
};

/** Return a recipe with estimated weight only. */
export const estimatedOnly = (): Recipe => {
  const recipe = butterCookiesRecipe();
  return { ...recipe, yield: { ...recipe.yield, actualFinalWeightG: null } };
};

/** Return a recipe with an export that exceeds tracker calorie bounds. */
export const hugeRecipe = (): Recipe => {
  const recipe = butterCookiesRecipe();
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ingredient) =>
      ingredient.id === 'ing-flour' ? { ...ingredient, quantityG: 20000 } : ingredient,
    ),
    servings: { ...recipe.servings, portionCount: 1 },
  };
};

/** Return a cloned copy of the baseline source tracker foods. */
export const sourceFoodsReady = (): FoodsState =>
  foodsReady(...sourceFoods.map((food) => ({ ...food, nutrients: { ...food.nutrients } })));
