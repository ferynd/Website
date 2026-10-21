/* --- CONFIGURATION: recipe nutrition export values --- */
/** Decimal places stored in exported tracker foods. */
export const EXPORT_DECIMAL_PLACES = 2;
/** Tracker quantity represents one complete export unit. */
export const TRACKER_EXPORT_QUANTITY = 1;
/** Suffixes make the tracker's quantity-one meaning explicit. */
export const EXPORT_NAME_SUFFIX: Record<NutritionExportBasisKey, string> = {
  perPortion: ' (per portion)',
  per100gCooked: ' (per 100 g cooked)',
};
const SCALE_ONE = { factor: 1, label: 'baseline' } as const;
const TRACKER_NAME_TRUNCATION = '…';
const REQUEST_ERROR_COPY = {
  partial: 'Confirm the partial nutrition warning before exporting.',
  blocked: 'This export cannot be updated until its target can be checked.',
  invalidId: 'This name maps to an invalid Nutrition Tracker ID.',
  missingTarget: 'The exported tracker food is not available.',
  overwrite: 'Confirm replacing tracker edits before updating.',
  selfReference: 'self-reference: an export cannot replace one of its ingredient foods.',
  fingerprint: 'The built tracker food did not match the reviewed nutrition snapshot.',
} as const;

/**
 * Pure recipe-to-tracker export calculations, status derivation, collision checks, and request creation.
 * Export values always describe the saved recipe at 1× and use the tracker document contract.
 */

import { formatCoveragePercent } from './nutritionFormat';
import { calculateRecipeNutrition, type RecipeNutritionResult } from './nutritionCalc';
import { normalizeIngredientName } from './shoppingList';
import {
  buildTrackerFoodDoc,
  fingerprintTrackerFood,
  isValidFirestoreDocId,
  linkTargetChanged,
  parseTrackerFood,
  trackerFoodId,
  TRACKER_FOOD_NAME_MAX,
  TRACKER_NUTRIENT_KEYS,
  TRACKER_NUTRIENT_MAX_BOUNDS,
  validateTrackerFoodName,
  type FoodsState,
  type LinkTarget,
  type TrackerFood,
  type TrackerFoodDoc,
  type TrackerNutrientKey,
} from './trackerFoods';
import { exportLinkTarget, exportOwnership } from './nutritionExportRef';
import {
  NUTRITION_EXPORT_BASIS_KEYS,
  type NutritionExportBasisKey,
  type Recipe,
  type RecipeNutritionExport,
} from './types';

/** Why a basis cannot be exported right now. */
export type ExportBlockReason =
  | 'foods-unavailable'
  | 'no-coverage'
  | 'no-portion-data'
  | 'no-final-weight'
  | 'estimated-final-weight'
  | 'over-tracker-cap'
  | 'non-finite';

/** Exportable per-unit nutrients and evidence shown during review. */
export interface ExportPayload {
  basis: NutritionExportBasisKey;
  nutrients: Record<TrackerNutrientKey, number>;
  fingerprint: string;
  coverage: 'complete' | 'partial';
  includedCount: number;
  totalCount: number;
  coveragePercent: string | null;
  lowerBoundKeys: TrackerNutrientKey[];
  zeroFilledKeys: TrackerNutrientKey[];
  excludedNames: string[];
  portionCount: number | null;
  portionSizeG: number | null;
  finalWeightG: number | null;
}

/** Result of trying to build a payload. */
export type ExportPayloadResult =
  | { ok: true; payload: ExportPayload }
  | { ok: false; reason: ExportBlockReason; overCapKeys: TrackerNutrientKey[] };

/** Payload availability for both supported bases and the recommended selection. */
export interface ExportBasisChoice {
  preferred: NutritionExportBasisKey | null;
  options: Record<NutritionExportBasisKey, ExportPayloadResult>;
}

/** Derived export state for one basis; no status is persisted. */
export interface ExportStatus {
  basis: NutritionExportBasisKey;
  ref: RecipeNutritionExport | null;
  ownership: 'none' | 'own' | 'foreign';
  recipe: 'current' | 'changed' | 'unavailable' | 'unknown';
  target: 'unchanged' | 'modified' | 'missing' | 'unknown';
  targetFood: TrackerFood | null;
  stale: boolean;
}

/** Action offered for the current export status. */
export type ExportAction = 'create' | 'update' | 'update-overwrite-tracker-edits' | 'recreate' | 'blocked';

/** One nutrient or quantity difference shown before an update. */
export interface NutrientChange {
  key: TrackerNutrientKey;
  before: number | null;
  after: number;
}

/** Request accepted by the transaction adapter. */
export interface ExportCommitRequest {
  recipeId: string;
  basis: NutritionExportBasisKey;
  mode: 'create' | 'update';
  foodId: string;
  doc: TrackerFoodDoc;
  /** Update only: the tracker doc must still match this identity at commit. */
  expectedTarget: LinkTarget | null;
  /** Concurrency baseline for recipe.nutritionExports[basis]. */
  previousRef: RecipeNutritionExport | null;
  nextRef: RecipeNutritionExport;
  /** Every included ingredient food must be unchanged at commit. */
  sourceTargets: LinkTarget[];
}

/** User choices captured by the review modal before the export is revalidated. */
export interface ExportCommitInput {
  basis: NutritionExportBasisKey;
  reviewedFingerprint: string;
  reviewedAction: ExportAction;
  /** Tracker target identity visible when the review was opened. */
  reviewedTarget: LinkTarget | null;
  chosenName: string;
  partialConfirmed: boolean;
  overwriteTrackerEdits: boolean;
}

/** Error raised when the reviewed export request violates an invariant. */
export class ExportRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportRequestError';
  }
}

/** Result of a completed export attempt. */
export type ExportCommitOutcome =
  | { status: 'done'; mode: 'create' | 'update'; foodName: string }
  | { status: 'collision'; foodId: string }
  | { status: 'review-changed'; message: string }
  | { status: 'error'; message: string };

/** Round an exported nutrient to two decimal places; non-finite inputs return null. */
export const roundExportValue = (value: number): number | null => {
  if (!Number.isFinite(value)) return null;
  const multiplier = 10 ** EXPORT_DECIMAL_PLACES;
  return Math.round(value * multiplier) / multiplier;
};

/** Calculate nutrition for export at 1×, independent of the active working scale. */
export const calculateExportNutrition = (recipe: Recipe, foods: FoodsState): RecipeNutritionResult =>
  calculateRecipeNutrition({ recipe, foods, scale: SCALE_ONE });

const blocked = (reason: ExportBlockReason): ExportPayloadResult => ({
  ok: false,
  reason,
  overCapKeys: [],
});

/** Build one export payload while enforcing measured-weight, coverage, and tracker bounds. */
export const buildExportPayload = (
  _recipe: Recipe,
  result: RecipeNutritionResult,
  basis: NutritionExportBasisKey,
): ExportPayloadResult => {
  if (result.foodsStatus !== 'ready') return blocked('foods-unavailable');
  if (result.coverage.status === 'none') return blocked('no-coverage');
  const selected = result.bases[basis];
  if (!selected.available || selected.amounts === null) {
    if (selected.unavailableReason === 'no-portion-data') return blocked('no-portion-data');
    if (selected.unavailableReason === 'no-final-weight') return blocked('no-final-weight');
    return blocked('no-coverage');
  }
  if (basis === 'per100gCooked' && selected.weightSource !== 'actual') {
    return blocked(selected.weightSource === 'estimated' ? 'estimated-final-weight' : 'no-final-weight');
  }
  if (basis === 'perPortion') {
    if (selected.portionMode === 'size' && selected.weightSource !== 'actual') {
      return blocked(selected.weightSource === 'estimated' ? 'estimated-final-weight' : 'no-final-weight');
    }
    if (selected.portionMode === 'override') return blocked('non-finite');
  }

  const nutrients = {} as Record<TrackerNutrientKey, number>;
  const lowerBoundKeys: TrackerNutrientKey[] = [];
  const zeroFilledKeys: TrackerNutrientKey[] = [];
  const overCapKeys: TrackerNutrientKey[] = [];
  for (const key of TRACKER_NUTRIENT_KEYS) {
    const amount = selected.amounts[key];
    if (amount.value === null) {
      nutrients[key] = 0;
      zeroFilledKeys.push(key);
      continue;
    }
    const rounded = roundExportValue(amount.value);
    if (rounded === null || rounded < 0) return blocked('non-finite');
    nutrients[key] = rounded;
    if (amount.isLowerBound) lowerBoundKeys.push(key);
    if (rounded > TRACKER_NUTRIENT_MAX_BOUNDS[key]) overCapKeys.push(key);
  }
  if (overCapKeys.length > 0) return { ok: false, reason: 'over-tracker-cap', overCapKeys };
  const fingerprint = fingerprintTrackerFood({ quantity: TRACKER_EXPORT_QUANTITY, nutrients });
  // Ingredient-row coverage can be complete while a linked food omits a nutrient.
  // Those values are lower bounds or zero-filled, so the export still needs confirmation.
  const coverage =
    result.coverage.status !== 'complete' || lowerBoundKeys.length > 0 || zeroFilledKeys.length > 0
      ? 'partial'
      : 'complete';
  return {
    ok: true,
    payload: {
      basis,
      nutrients,
      fingerprint,
      coverage,
      includedCount: result.coverage.includedCount,
      totalCount: result.coverage.totalCount,
      coveragePercent:
        formatCoveragePercent(result.coverage),
      lowerBoundKeys,
      zeroFilledKeys,
      excludedNames: result.excluded.map((row) => row.displayName),
      portionCount: selected.portionCount,
      portionSizeG: selected.weightSource === 'actual' ? selected.portionSizeG : null,
      finalWeightG: selected.weightSource === 'actual' ? selected.finalWeightG : null,
    },
  };
};

/** Select the existing own basis, then per portion, then per 100 g cooked. */
export const selectExportBasis = (
  recipe: Recipe,
  result: RecipeNutritionResult,
  recipeId: string | null,
): ExportBasisChoice => {
  const options: Record<NutritionExportBasisKey, ExportPayloadResult> = {
    perPortion: buildExportPayload(recipe, result, 'perPortion'),
    per100gCooked: buildExportPayload(recipe, result, 'per100gCooked'),
  };
  for (const basis of NUTRITION_EXPORT_BASIS_KEYS) {
    const ref = recipe.nutritionExports[basis];
    if (ref && exportOwnership(ref, recipeId) === 'own' && options[basis].ok) {
      return { preferred: basis, options };
    }
  }
  if (options.perPortion.ok) return { preferred: 'perPortion', options };
  if (options.per100gCooked.ok) return { preferred: 'per100gCooked', options };
  return { preferred: null, options };
};

/** Choose the first exportable basis without an own reference for the primary export button. */
export const selectMissingExportBasis = (
  statuses: ExportStatus[],
  choice: ExportBasisChoice,
): NutritionExportBasisKey | null =>
  NUTRITION_EXPORT_BASIS_KEYS.find(
    (basis) => statuses.find((status) => status.basis === basis)?.ownership !== 'own' && choice.options[basis].ok,
  ) ?? null;

/** Create a capped, capitalized default tracker food name with its basis suffix intact. */
export const defaultExportFoodName = (recipeName: string, basis: NutritionExportBasisKey): string => {
  const suffix = EXPORT_NAME_SUFFIX[basis];
  const available = TRACKER_FOOD_NAME_MAX - suffix.length;
  const trimmed = recipeName.trim();
  const capitalized =
    trimmed.length > 0 ? `${trimmed.charAt(0).toLocaleUpperCase()}${trimmed.slice(1)}` : 'Recipe';
  if (capitalized.length <= available) return `${capitalized}${suffix}`;
  const base = `${capitalized.slice(0, available - TRACKER_NAME_TRUNCATION.length).trimEnd()}${TRACKER_NAME_TRUNCATION}`;
  return `${base}${suffix}`;
};

/** Derive recipe and tracker target status for one stored reference. */
export const deriveExportStatus = (input: {
  basis: NutritionExportBasisKey;
  ref: RecipeNutritionExport | undefined;
  recipeId: string | null;
  payload: ExportPayloadResult;
  foods: FoodsState;
}): ExportStatus => {
  const { basis, ref, recipeId, payload, foods } = input;
  if (!ref)
    return {
      basis,
      ref: null,
      ownership: 'none',
      recipe: 'unknown',
      target: 'unknown',
      targetFood: null,
      stale: false,
    };
  if (exportOwnership(ref, recipeId) === 'foreign') {
    return {
      basis,
      ref,
      ownership: 'foreign',
      recipe: 'unknown',
      target: 'unknown',
      targetFood: null,
      stale: false,
    };
  }
  if (foods.status !== 'ready') {
    return {
      basis,
      ref,
      ownership: 'own',
      recipe: 'unknown',
      target: 'unknown',
      targetFood: null,
      stale: false,
    };
  }
  const targetFood = foods.items.find((food) => food.id === ref.foodId) ?? null;
  const target =
    targetFood === null
      ? 'missing'
      : linkTargetChanged(targetFood, exportLinkTarget(ref))
        ? 'modified'
        : 'unchanged';
  let recipeStatus: ExportStatus['recipe'] = 'current';
  if (!payload.ok) recipeStatus = 'unavailable';
  else if (
    payload.payload.fingerprint !== ref.nutritionFingerprint ||
    payload.payload.coverage !== ref.coverage ||
    payload.payload.includedCount !== ref.includedCount ||
    payload.payload.totalCount !== ref.totalCount
  ) {
    recipeStatus = 'changed';
  }
  const stale =
    recipeStatus === 'changed' ||
    recipeStatus === 'unavailable' ||
    target === 'modified' ||
    target === 'missing';
  return { basis, ref, ownership: 'own', recipe: recipeStatus, target, targetFood, stale };
};

/** Derive both export statuses in canonical basis order. */
export const deriveExportStatuses = (
  recipe: Recipe,
  recipeId: string | null,
  result: RecipeNutritionResult,
  foods: FoodsState,
): ExportStatus[] =>
  NUTRITION_EXPORT_BASIS_KEYS.map((basis) =>
    deriveExportStatus({
      basis,
      ref: recipe.nutritionExports[basis],
      recipeId,
      payload: buildExportPayload(recipe, result, basis),
      foods,
    }),
  );

/** Determine the action shown for a basis status. */
export const exportAction = (status: ExportStatus, payload: ExportPayloadResult): ExportAction => {
  if (!payload.ok) return 'blocked';
  if (status.ownership === 'none' || status.ownership === 'foreign') return 'create';
  if (status.target === 'missing') return 'recreate';
  if (status.target === 'modified') return 'update-overwrite-tracker-edits';
  if (status.target === 'unchanged') return 'update';
  return 'blocked';
};

/** Find a same-id tracker food that is not this basis's own update target. */
export const findExportCollision = (
  foodId: string,
  foods: TrackerFood[],
  status: ExportStatus,
): TrackerFood | null => {
  const occupying = foods.find((food) => food.id === foodId) ?? null;
  if (occupying === null) return null;
  if (status.ownership === 'own' && status.ref?.foodId === foodId) return null;
  return occupying;
};

/** Compare the target's quantity and nutrient values with a proposed payload. */
export const diffExportNutrients = (
  before: TrackerFood | null,
  payload: ExportPayload,
): { quantityChanged: boolean; changes: NutrientChange[] } => {
  if (before === null) return { quantityChanged: false, changes: [] };
  const changes = TRACKER_NUTRIENT_KEYS.flatMap((key) =>
    before.nutrients[key] === payload.nutrients[key]
      ? []
      : [{ key, before: before.nutrients[key], after: payload.nutrients[key] }],
  );
  return { quantityChanged: before.quantity !== TRACKER_EXPORT_QUANTITY, changes };
};

/** Collect unique source-food revision identities for ingredients included in the calculation. */
export const collectExportSourceTargets = (
  result: RecipeNutritionResult,
  foods: TrackerFood[],
): LinkTarget[] => {
  const byId = new Map(foods.map((food) => [food.id, food]));
  const targets = new Map<string, LinkTarget>();
  for (const ingredient of result.included) {
    const food = byId.get(ingredient.foodId);
    if (food === undefined || targets.has(food.id)) continue;
    targets.set(food.id, {
      id: food.id,
      fingerprint: fingerprintTrackerFood(food),
      normalizedName: normalizeIngredientName(food.name),
      lastUpdated: food.lastUpdated,
    });
  }
  return [...targets.values()];
};

/** Capture the revision identity of the tracker food shown in the review. */
export const trackerFoodLinkTarget = (food: TrackerFood): LinkTarget => ({
  id: food.id,
  fingerprint: fingerprintTrackerFood(food),
  normalizedName: normalizeIngredientName(food.name),
  lastUpdated: food.lastUpdated,
});

/** Check whether an overwrite target differs from the identity captured during review. */
export const exportTargetChangedSinceReview = (
  status: ExportStatus,
  reviewedTarget: LinkTarget | null,
): boolean =>
  status.targetFood === null ||
  reviewedTarget === null ||
  linkTargetChanged(status.targetFood, reviewedTarget);

/** Assemble the verified create/update request or throw when review invariants fail. */
export const buildExportCommitRequest = (input: {
  recipe: Recipe;
  recipeId: string;
  basis: NutritionExportBasisKey;
  status: ExportStatus;
  payload: ExportPayload;
  sourceTargets: LinkTarget[];
  chosenName: string;
  overwriteTrackerEdits: boolean;
  reviewedTarget: LinkTarget | null;
  partialConfirmed: boolean;
  nowIso: string;
  nowMs: number;
}): ExportCommitRequest => {
  const { recipe, recipeId, basis, status, payload, sourceTargets } = input;
  if (payload.coverage === 'partial' && !input.partialConfirmed) {
    throw new ExportRequestError(REQUEST_ERROR_COPY.partial);
  }
  const action = exportAction(status, { ok: true, payload });
  const createMode = action === 'create' || action === 'recreate';
  if (!createMode && action !== 'update' && action !== 'update-overwrite-tracker-edits') {
    throw new ExportRequestError(REQUEST_ERROR_COPY.blocked);
  }
  let name = input.chosenName;
  let foodId = '';
  let expectedTarget: LinkTarget | null = null;
  let mode: ExportCommitRequest['mode'] = 'create';
  if (createMode) {
    const nameError = validateTrackerFoodName(name);
    if (nameError !== null) throw new ExportRequestError(nameError);
    foodId = trackerFoodId(name);
    if (!isValidFirestoreDocId(foodId)) throw new ExportRequestError(REQUEST_ERROR_COPY.invalidId);
  } else {
    const ref = status.ref;
    const targetFood = status.targetFood;
    if (ref === null || targetFood === null) throw new ExportRequestError(REQUEST_ERROR_COPY.missingTarget);
    foodId = ref.foodId;
    name = targetFood.name;
    mode = 'update';
    if (action === 'update') {
      expectedTarget = exportLinkTarget(ref);
    } else {
      if (!input.overwriteTrackerEdits) throw new ExportRequestError(REQUEST_ERROR_COPY.overwrite);
      expectedTarget = input.reviewedTarget;
      if (expectedTarget === null) throw new ExportRequestError(REQUEST_ERROR_COPY.missingTarget);
    }
  }
  if (sourceTargets.some((target) => target.id === foodId)) {
    throw new ExportRequestError(REQUEST_ERROR_COPY.selfReference);
  }
  const doc = buildTrackerFoodDoc(name, payload.nutrients, input.nowIso);
  const parsed = parseTrackerFood(foodId, doc);
  if (parsed === null || fingerprintTrackerFood(parsed) !== payload.fingerprint) {
    throw new ExportRequestError(REQUEST_ERROR_COPY.fingerprint);
  }
  const previousRef = recipe.nutritionExports[basis] ?? null;
  const nextRef: RecipeNutritionExport = {
    basis,
    recipeId,
    foodId,
    foodName: doc.name,
    foodLastUpdated: doc.lastUpdated,
    nutritionFingerprint: payload.fingerprint,
    exportedAtMs: input.nowMs,
    coverage: payload.coverage,
    includedCount: payload.includedCount,
    totalCount: payload.totalCount,
    portionCount: payload.portionCount,
    portionSizeG: payload.portionSizeG,
    finalWeightG: payload.finalWeightG,
  };
  return { recipeId, basis, mode, foodId, doc, expectedTarget, previousRef, nextRef, sourceTargets };
};
