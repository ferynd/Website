/* --- CONFIGURATION: export labels and explanatory copy --- */
/** User-facing labels for export bases. */
export const EXPORT_BASIS_LABELS: Record<NutritionExportBasisKey, string> = {
  perPortion: 'Per portion',
  per100gCooked: 'Per 100 g cooked',
};
const STALE_SUFFIX = ' · tracker food out of date';
const UNSAVED_REASON = 'Save the recipe to export it — exports use the saved recipe at 1×.';
const DIRTY_REASON = 'Save your changes first — the tracker food must match the saved recipe.';
const FOODS_REASON = 'Load Nutrition Tracker foods to export.';
const EXPORT_COPY = {
  noCoverage: 'Count at least one ingredient before exporting nutrition.',
  noPortionData: 'Add a portion count or portion size in Overview to export per portion.',
  noFinalWeightCooked:
    'Per 100 g cooked needs a measured cooked weight — weigh the finished dish and enter it in Overview.',
  noFinalWeightPortion:
    'A measured cooked weight is needed to calculate this portion size — enter it in Overview.',
  estimatedWeight: 'Enter the measured cooked weight in Overview before exporting this basis.',
  nonFinite: 'The nutrition values could not be represented safely. Review the recipe data.',
  foreign: 'Exported from another copy of this recipe — exporting creates a new food',
  none: 'Not exported',
  current: 'Up to date',
  changed: 'Out of date — recipe nutrition changed since export',
  unavailable: "Out of date — can't recompute this basis now",
  modified: 'Edited in the Nutrition Tracker since export',
  missing: 'Deleted from the Nutrition Tracker',
  unknown: "Can't check — Nutrition Tracker foods aren't loaded",
  cookedHint:
    'In the Nutrition Tracker, quantity 1 = 100 g of the cooked dish. Weigh your serving and log grams ÷ 100 (250 g → 2.5).',
  onePortion: 'one portion',
  halfPortionHint: 'Log 0.5 for half a portion.',
  partialLead: 'Partial nutrition:',
  counted: 'ingredients are counted',
  notCounted: 'Not counted:',
  lowerBound: 'Lower-bound nutrients:',
  partialTail: "The tracker food will under-count, and the Nutrition Tracker can't show “at least” values.",
  zeroFilledLead: 'Saved as 0 because no counted ingredient has data:',
  createdQuantityMeaning: 'Log it there with quantity 1 = one portion / 100 g.',
  created: 'Created',
  updated: 'Updated',
  collision: 'A Nutrition Tracker food already uses this name. Choose another name.',
} as const;

/**
 * Pure export labels, status descriptions, hints, and outcome copy.
 * Display strings stay centralized so UI and tests share the same wording.
 */

import type { FoodsState, TrackerNutrientKey } from './trackerFoods';
import { nutrientLabel } from './nutritionFormat';
import type {
  ExportBasisChoice,
  ExportBlockReason,
  ExportCommitOutcome,
  ExportPayload,
  ExportStatus,
} from './nutritionExport';
import { TRACKER_NUTRIENT_KEYS } from './trackerFoods';
import type { NutritionExportBasisKey } from './types';
import { NUTRITION_EXPORT_BASIS_KEYS } from './types';

/** Build blocked copy by basis so each row and description keeps its own reason. */
export const describeExportBlocks = (
  options: ExportBasisChoice['options'],
): Record<NutritionExportBasisKey, string | null> => {
  const reasons: Record<NutritionExportBasisKey, string | null> = {
    perPortion: null,
    per100gCooked: null,
  };
  for (const basis of NUTRITION_EXPORT_BASIS_KEYS) {
    const option = options[basis];
    if (!option.ok) reasons[basis] = describeExportBlock(option.reason, basis, option.overCapKeys);
  }
  return reasons;
};

/** Explain why a basis is blocked. */
export const describeExportBlock = (
  reason: ExportBlockReason,
  basis: NutritionExportBasisKey,
  overCapKeys: TrackerNutrientKey[],
): string => {
  switch (reason) {
    case 'foods-unavailable':
      return FOODS_REASON;
    case 'no-coverage':
      return EXPORT_COPY.noCoverage;
    case 'no-portion-data':
      return EXPORT_COPY.noPortionData;
    case 'no-final-weight':
      return basis === 'per100gCooked' ? EXPORT_COPY.noFinalWeightCooked : EXPORT_COPY.noFinalWeightPortion;
    case 'estimated-final-weight':
      return EXPORT_COPY.estimatedWeight;
    case 'over-tracker-cap':
      return `These values exceed Nutrition Tracker limits: ${overCapKeys.map(nutrientLabel).join(', ')}.`;
    case 'non-finite':
      return EXPORT_COPY.nonFinite;
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
};

/** Describe the derived state of an export reference. */
export const describeExportStatus = (
  status: ExportStatus,
): { label: string; tone: 'success' | 'warning' | 'error' | 'muted' } => {
  if (status.ownership === 'foreign') {
    return {
      label: EXPORT_COPY.foreign,
      tone: 'muted',
    };
  }
  if (status.ownership === 'none') return { label: EXPORT_COPY.none, tone: 'muted' };
  if (status.recipe === 'changed') return { label: EXPORT_COPY.changed, tone: 'warning' };
  if (status.recipe === 'unavailable') return { label: EXPORT_COPY.unavailable, tone: 'warning' };
  if (status.target === 'modified') return { label: EXPORT_COPY.modified, tone: 'warning' };
  if (status.target === 'missing') return { label: EXPORT_COPY.missing, tone: 'error' };
  if (status.target === 'unknown') return { label: EXPORT_COPY.unknown, tone: 'muted' };
  return { label: EXPORT_COPY.current, tone: 'success' };
};

/** Explain how tracker quantity maps to one exported unit. */
export const exportQuantityHint = (payload: ExportPayload): string => {
  if (payload.basis === 'per100gCooked') {
    return EXPORT_COPY.cookedHint;
  }
  const count = payload.portionCount;
  const grams = payload.portionSizeG;
  const portion = count === null ? EXPORT_COPY.onePortion : `one portion (1 of ${count})`;
  const size = grams === null ? '' : `, ~${Math.round(grams)} g`;
  return `In the Nutrition Tracker, quantity 1 = ${portion}${size}. ${EXPORT_COPY.halfPortionHint}`;
};

/** Explain partial ingredient coverage and the excluded rows. */
export const partialExportWarning = (payload: ExportPayload): string => {
  const percent = payload.coveragePercent === null ? '' : ` (${payload.coveragePercent} of known weight)`;
  const excluded =
    payload.excludedNames.length === 0
      ? ''
      : ` ${EXPORT_COPY.notCounted} ${payload.excludedNames.join(', ')}.`;
  const lowerBounds = TRACKER_NUTRIENT_KEYS.filter((key) => payload.lowerBoundKeys.includes(key)).map(
    nutrientLabel,
  );
  const lowerBoundCopy =
    lowerBounds.length === 0 ? '' : ` ${EXPORT_COPY.lowerBound} ${lowerBounds.join(', ')}.`;
  return `${EXPORT_COPY.partialLead} ${payload.includedCount} of ${payload.totalCount} ${EXPORT_COPY.counted}${percent}.${excluded}${lowerBoundCopy} ${EXPORT_COPY.partialTail}`;
};

/** Describe nutrients saved as zero because no counted ingredient provides a value. */
export const zeroFilledNote = (payload: ExportPayload): string => {
  if (payload.zeroFilledKeys.length === 0) return '';
  const labels = TRACKER_NUTRIENT_KEYS.filter((key) => payload.zeroFilledKeys.includes(key)).map(
    nutrientLabel,
  );
  return `${EXPORT_COPY.zeroFilledLead} ${labels.join(', ')}.`;
};

/** Return the accordion suffix when an own export is stale. */
export const exportSubtitleSuffix = (statuses: ExportStatus[]): string =>
  statuses.some((status) => status.ownership === 'own' && status.stale) ? STALE_SUFFIX : '';

/** Explain why export is disabled, prioritizing saved and clean recipe state. */
export const exportDisabledReason = (input: {
  saved: boolean;
  dirty: boolean;
  foodsStatus: FoodsState['status'];
}): string | null => {
  if (!input.saved) return UNSAVED_REASON;
  if (input.dirty) return DIRTY_REASON;
  if (input.foodsStatus !== 'ready') return FOODS_REASON;
  return null;
};

/** Describe the outcome shown after an export attempt. */
export const describeExportOutcome = (outcome: ExportCommitOutcome): string => {
  switch (outcome.status) {
    case 'done':
      return outcome.mode === 'create'
        ? `${EXPORT_COPY.created} “${outcome.foodName}” in the Nutrition Tracker. ${EXPORT_COPY.createdQuantityMeaning}`
        : `${EXPORT_COPY.updated} “${outcome.foodName}”.`;
    case 'collision':
      return EXPORT_COPY.collision;
    case 'review-changed':
      return outcome.message;
    case 'error':
      return outcome.message;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
};
