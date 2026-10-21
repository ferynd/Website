/* --- CONFIGURATION: nutrition export reference parsing --- */
const INVALID_REF_COPY =
  'is unreadable — the next export of this basis will create a new food instead of updating.';

/**
 * Defensive parsing and ownership helpers for recipe-side tracker export references.
 * Invalid references are dropped so they can never authorize an update.
 */

import { normalizeIngredientName } from './shoppingList';
import { isValidFirestoreDocId, type LinkTarget } from './trackerFoods';
import {
  NUTRITION_EXPORT_BASIS_KEYS,
  type NutritionExportBasisKey,
  type Recipe,
  type RecipeNutritionExport,
  type RecipeNutritionExports,
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isPositiveOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0);

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;

/** Defensive read of a stored ref. Invalid values produce a warning and never throw. */
export const parseNutritionExport = (
  value: unknown,
  basis: NutritionExportBasisKey,
  path: string,
  warnings: string[],
): RecipeNutritionExport | null => {
  if (!isRecord(value)) {
    warnings.push(`${path} ${INVALID_REF_COPY}`);
    return null;
  }
  const valid =
    value.basis === basis &&
    isNonEmptyString(value.recipeId) &&
    isNonEmptyString(value.foodId) &&
    isValidFirestoreDocId(typeof value.foodId === 'string' ? value.foodId : '') &&
    isNonEmptyString(value.foodName) &&
    isNonEmptyString(value.foodLastUpdated) &&
    isNonEmptyString(value.nutritionFingerprint) &&
    typeof value.exportedAtMs === 'number' &&
    Number.isFinite(value.exportedAtMs) &&
    value.exportedAtMs >= 0 &&
    (value.coverage === 'complete' || value.coverage === 'partial') &&
    isCount(value.includedCount) &&
    isCount(value.totalCount) &&
    isPositiveOrNull(value.portionCount) &&
    isPositiveOrNull(value.portionSizeG) &&
    isPositiveOrNull(value.finalWeightG);
  if (!valid) {
    warnings.push(`${path} ${INVALID_REF_COPY}`);
    return null;
  }
  return {
    basis,
    recipeId: value.recipeId as string,
    foodId: value.foodId as string,
    foodName: value.foodName as string,
    foodLastUpdated: value.foodLastUpdated as string,
    nutritionFingerprint: value.nutritionFingerprint as string,
    exportedAtMs: value.exportedAtMs as number,
    coverage: value.coverage as RecipeNutritionExport['coverage'],
    includedCount: value.includedCount as number,
    totalCount: value.totalCount as number,
    portionCount: value.portionCount as number | null,
    portionSizeG: value.portionSizeG as number | null,
    finalWeightG: value.finalWeightG as number | null,
  };
};

/** Parse a back-reference map; missing/non-object maps are silently empty. */
export const parseNutritionExports = (value: unknown, warnings: string[]): RecipeNutritionExports => {
  if (!isRecord(value)) return {};
  const parsed: RecipeNutritionExports = {};
  for (const key of Object.keys(value)) {
    if (!NUTRITION_EXPORT_BASIS_KEYS.includes(key as NutritionExportBasisKey)) {
      warnings.push(`nutritionExports.${key} is an unknown export basis and was ignored.`);
    }
  }
  for (const basis of NUTRITION_EXPORT_BASIS_KEYS) {
    if (value[basis] === undefined) continue;
    const ref = parseNutritionExport(value[basis], basis, `nutritionExports.${basis}`, warnings);
    if (ref !== null) parsed[basis] = ref;
  }
  return parsed;
};

/** Compare every stored field for the transaction concurrency check. */
export const sameNutritionExport = (
  a: RecipeNutritionExport | null,
  b: RecipeNutritionExport | null,
): boolean => {
  if (a === null || b === null) return a === b;
  return (
    a.basis === b.basis &&
    a.recipeId === b.recipeId &&
    a.foodId === b.foodId &&
    a.foodName === b.foodName &&
    a.foodLastUpdated === b.foodLastUpdated &&
    a.nutritionFingerprint === b.nutritionFingerprint &&
    a.exportedAtMs === b.exportedAtMs &&
    a.coverage === b.coverage &&
    a.includedCount === b.includedCount &&
    a.totalCount === b.totalCount &&
    a.portionCount === b.portionCount &&
    a.portionSizeG === b.portionSizeG &&
    a.finalWeightG === b.finalWeightG
  );
};

/** Remove recipe export refs before import or save-as-new, reporting whether any existed. */
export const withoutNutritionExports = (recipe: Recipe): { recipe: Recipe; removed: boolean } => {
  const removed = Object.keys(recipe.nutritionExports).length > 0;
  return { recipe: { ...recipe, nutritionExports: {} }, removed };
};

/** Return whether a reference belongs to the open saved recipe. */
export const exportOwnership = (ref: RecipeNutritionExport, recipeId: string | null): 'own' | 'foreign' =>
  recipeId !== null && ref.recipeId === recipeId ? 'own' : 'foreign';

/** Rebuild the P2 target identity used to verify the exported food in a transaction. */
export const exportLinkTarget = (ref: RecipeNutritionExport): LinkTarget => ({
  id: ref.foodId,
  fingerprint: ref.nutritionFingerprint,
  normalizedName: normalizeIngredientName(ref.foodName),
  lastUpdated: ref.foodLastUpdated,
});
