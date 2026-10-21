/* ------------------------------------------------------------ */
/* CONFIGURATION: nutrition labels, groups, and display copy      */
/* ------------------------------------------------------------ */
/** Headline nutrients mirror CalorieTracker's macro group. */
export const HEADLINE_NUTRIENT_KEYS = ['calories', 'protein', 'carbs', 'fat'] as const;
/** Display groups mirror CalorieTracker's nutrient groups. */
export const NUTRIENT_DISPLAY_GROUPS = [
  { key: 'macros', title: 'Macronutrients', nutrients: ['calories', 'protein', 'carbs', 'fat'] },
  { key: 'dailyFloors', title: 'Fiber, electrolytes & choline', nutrients: ['fiber', 'potassium', 'magnesium', 'sodium', 'calcium', 'choline'] },
  { key: 'dailyVitamins', title: 'Water-soluble vitamins', nutrients: ['vitaminB12', 'folate', 'vitaminC', 'vitaminB6'] },
  { key: 'avgVitamins', title: 'Fat-soluble vitamins', nutrients: ['vitaminA', 'vitaminD', 'vitaminE', 'vitaminK'] },
  { key: 'avgMinerals', title: 'Minerals', nutrients: ['selenium', 'iodine', 'phosphorus', 'iron', 'zinc'] },
  { key: 'optional', title: 'Other', nutrients: ['omega3'] },
] as const;
/** Prefix shown when a nutrient amount is a lower bound. */
export const LOWER_BOUND_PREFIX = '≥ ';
/** Placeholder for unavailable nutrient data. */
export const EMPTY_VALUE = '—';
/** Chip copy for a final weight supplied as an estimate. */
export const ESTIMATED_FINAL_WEIGHT_LABEL = 'Estimated final weight';
/** Chip copy for a measured final weight projected by the current scale. */
export const PROJECTED_FINAL_WEIGHT_LABEL = 'Projected final weight';
/** Human-readable labels for selectable nutrition bases. */
export const BASIS_LABELS = {
  total: 'Total',
  perServing: 'Per serving',
  perPortion: 'Per portion',
  per100gCooked: 'Per 100 g cooked',
} as const;
/** Raw ingredient and cooking-loss assumption shown in the panel. */
export const NUTRITION_ASSUMPTION_NOTE = 'Calculated from the raw, as-linked Nutrition Tracker values for each counted ingredient. Cooking losses, water loss or gain, and absorbed or drained fat are not modeled; "per 100 g cooked" divides by the final weight.';
/** Explanation of the lower-bound marker. */
export const LOWER_BOUND_NOTE = '≥ means "at least": some ingredients or nutrient values are not counted.';

/**
 * Pure display helpers for nutrition amounts and explanatory copy. Rounding is presentation-only; the
 * calculation module keeps full precision for all intermediate values.
 */

import { NUTRIENT_INTAKE_SPEC } from './nutritionIntake';
import { TRACKER_NUTRIENT_KEYS, type TrackerNutrientKey } from './trackerFoods';
import {
  type BasisUnavailableReason,
  type NutritionBasis,
  type NutritionBasisKey,
  type NutritionCoverage,
  type NutritionExclusionReason,
  type RecipeNutritionResult,
} from './nutritionCalc';

const roundTo = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places;

/** Format one nutrient number using the unit-specific display precision. */
export const formatNutrientNumber = (value: number | null, unit: string): string => {
  if (value === null || !Number.isFinite(value)) return EMPTY_VALUE;
  if (Object.is(value, -0) || value === 0) return `0 ${unit}`;
  const absolute = Math.abs(value);
  let places = 0;
  if (unit === 'g') {
    if (absolute >= 100) places = 0;
    else if (absolute >= 1) places = 1;
    else places = 2;
  } else if (unit === 'mg' || unit === 'mcg') {
    if (absolute >= 100) places = 0;
    else if (absolute >= 10) places = 1;
    else places = 2;
  }
  const rounded = roundTo(value, places);
  if (rounded === 0) return unit === 'kcal' ? '<1 kcal' : `<0.01 ${unit}`;
  return `${String(rounded)} ${unit}`;
};

/** Format an amount using its canonical nutrient unit and lower-bound marker. */
export const formatNutrientAmount = (
  key: TrackerNutrientKey,
  amount: { value: number | null; isLowerBound: boolean },
): string => {
  const formatted = formatNutrientNumber(amount.value, NUTRIENT_INTAKE_SPEC[key].unit);
  if (formatted === EMPTY_VALUE) return EMPTY_VALUE;
  return `${amount.isLowerBound ? LOWER_BOUND_PREFIX : ''}${formatted}`;
};

/** Return the canonical display label for a nutrient. */
export const nutrientLabel = (key: TrackerNutrientKey): string => NUTRIENT_INTAKE_SPEC[key].label;

/** Format a finite gram amount as a whole-gram display value. */
export const formatWholeGrams = (grams: number): string => (
  Number.isFinite(grams) ? `${Math.round(grams)} g` : EMPTY_VALUE
);

/** Format a finite count to at most two decimal places. */
export const formatCount = (value: number): string => (
  Number.isFinite(value) ? String(roundTo(value, 2)) : EMPTY_VALUE
);

/** Return a coverage percentage, flooring partial values and suppressing zero-known-gram ratios. */
export const formatCoveragePercent = (coverage: NutritionCoverage): string | null => {
  if (!Number.isFinite(coverage.coveredGrams) || !Number.isFinite(coverage.knownGrams)) return null;
  if (coverage.knownGrams <= 0) return null;
  if (coverage.status === 'complete') return '100%';
  const ratio = coverage.coveredGrams / coverage.knownGrams;
  if (!Number.isFinite(ratio)) return null;
  const percent = ratio * 100;
  if (!Number.isFinite(percent)) return null;
  return `${Math.floor(percent)}%`;
};

/** Describe a link or quantity exclusion in user-facing language. */
export const describeExclusionReason = (
  reason: NutritionExclusionReason,
  row: { equivalent?: string; matchedName?: string | null; currentName?: string | null },
): string => {
  const name = row.matchedName ?? 'the linked food';
  const current = row.currentName ?? 'an unknown name';
  switch (reason) {
    case 'unlinked': return 'Not linked to a Nutrition Tracker food.';
    case 'no-match': return 'Marked as having no Nutrition Tracker match.';
    case 'candidate': return `Suggested match "${name}" isn't confirmed — confirm it with a gram basis to count it.`;
    case 'candidate-missing': return `The suggested food "${name}" no longer exists in the Nutrition Tracker.`;
    case 'stale-missing': return `Needs review: the confirmed food "${name}" was deleted from the Nutrition Tracker.`;
    case 'stale-renamed': return `Needs review: the confirmed food was renamed from "${name}" to "${current}".`;
    case 'stale-revised': return `Needs review: "${name}" changed in the Nutrition Tracker since you confirmed it.`;
    case 'unverifiable-target': return 'Confirmed without change tracking — re-confirm the link to count it.';
    case 'invalid-basis': return 'The grams in one Nutrition Tracker unit are missing or invalid — re-confirm the link.';
    case 'foods-unavailable': return "Confirmed, but Nutrition Tracker foods aren't loaded, so the link can't be checked.";
    case 'missing-quantity':
      return row.equivalent
        ? `No gram weight (listed as "${row.equivalent}") — add grams to count it.`
        : 'No gram weight — add grams to count it.';
    case 'zero-quantity': return 'Weight is 0 g — enter the real gram weight to count it.';
    case 'invalid-quantity': return "The gram weight isn't a valid amount — edit the ingredient.";
    case 'duplicate-id': return 'Duplicate ingredient entry (same id as an earlier row) — not counted.';
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
};

/** Explain why a nutrition basis is unavailable. */
export const describeBasisUnavailable = (reason: BasisUnavailableReason, key: NutritionBasisKey): string => {
  switch (reason) {
    case 'no-coverage': return 'No ingredients are counted yet.';
    case 'no-servings': return "This recipe doesn't list servings.";
    case 'no-portion-data': return 'This recipe has no portion count or portion size.';
    case 'no-final-weight':
      return key === 'perPortion'
        ? "The portion size is known, but there's no final cooked weight to divide by — add the actual cooked weight in Overview."
        : 'Add the actual cooked weight in Overview to see per 100 g cooked.';
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
};

/** Describe the selected basis, including scaling and estimated-weight context. */
export const describeBasisCaption = (basis: NutritionBasis, factor: number): string => {
  switch (basis.key) {
    case 'total': return factor === 1 ? 'Whole recipe' : `Whole recipe at ${formatCount(factor)}×`;
    case 'perServing': return `1 of ${formatCount(basis.servings ?? 0)} servings`;
    case 'perPortion':
      if (basis.portionMode === 'override') {
        return `1 of ${formatCount(basis.portionCount ?? 0)} portions of ~${formatWholeGrams(basis.portionSizeG ?? 0)}`;
      }
      if (basis.portionMode === 'count') {
        const size = basis.portionSizeG === null ? '' : ` · ~${formatWholeGrams(basis.portionSizeG)} each`;
        return `1 of ${formatCount(basis.portionCount ?? 0)} portions${size}`;
      }
      if (basis.portionMode === 'size') {
        return `One ${formatWholeGrams(basis.portionSizeG ?? 0)} portion of a ${formatWholeGrams(basis.finalWeightG ?? 0)} batch`;
      }
      return 'Per portion';
    case 'per100gCooked':
      if (basis.weightSource === 'actual' && factor !== 1) {
        return `Final weight ${formatWholeGrams(basis.finalWeightG ?? 0)} (scaled from measured)`;
      }
      return `Final weight ${formatWholeGrams(basis.finalWeightG ?? 0)} (${basis.estimated ? 'estimated' : 'measured'})`;
    default: {
      const exhaustive: never = basis.key;
      return exhaustive;
    }
  }
};

/** Build a compact coverage headline for the current foods and recipe state. */
export const coverageHeadline = (result: RecipeNutritionResult): string => {
  if (result.foodsStatus === 'loading') return 'Loading Nutrition Tracker foods…';
  if (result.foodsStatus === 'error') return "Couldn't load Nutrition Tracker foods — nutrition can't be checked.";
  if (result.foodsStatus === 'idle') return "Nutrition Tracker foods aren't loaded yet.";
  if (result.coverage.totalCount === 0) return 'This recipe has no ingredients.';
  if (result.coverage.status === 'complete') return `Complete — all ${result.coverage.totalCount} ingredients counted.`;
  if (result.coverage.status === 'partial') {
    return `Partial — ${result.coverage.includedCount} of ${result.coverage.totalCount} ingredients counted. Totals are at least these amounts.`;
  }
  return `Not calculated yet — none of the ${result.coverage.totalCount} ingredients can be counted.`;
};

/** Build the gram coverage detail line with optional unknown-weight and optional-row details. */
export const coverageDetail = (result: RecipeNutritionResult): string => {
  const coverage = result.coverage;
  const percent = formatCoveragePercent(coverage);
  let detail = `Counted weight: ${formatWholeGrams(coverage.coveredGrams)} of ${formatWholeGrams(coverage.knownGrams)} known (${percent ?? '—'})`;
  if (coverage.unknownWeightCount > 0) detail += ` · ${coverage.unknownWeightCount} ingredient(s) with no gram weight`;
  if (coverage.optionalIncludedCount > 0) detail += ` · includes ${coverage.optionalIncludedCount} optional ingredient(s)`;
  return detail;
};

/** List nutrients with gaps in canonical nutrient order. */
export const nutrientGapNote = (coverage: NutritionCoverage): string => {
  const gaps = TRACKER_NUTRIENT_KEYS.filter((key) => coverage.nutrientGaps.includes(key));
  if (gaps.length === 0) return '';
  const labels = gaps.map(nutrientLabel).join(', ');
  return `Some linked foods have no value for ${labels} — those totals are marked ≥.`;
};

/** Return the compact subtitle used by the Nutrition accordion. */
export const nutritionPanelSubtitle = (result: RecipeNutritionResult): string => {
  if (result.foodsStatus === 'loading') return 'Checking Nutrition Tracker foods…';
  if (result.foodsStatus === 'error') return "Nutrition Tracker foods couldn't be loaded";
  if (result.foodsStatus === 'idle') return 'Nutrition Tracker foods not loaded';
  if (result.coverage.totalCount === 0) return 'No ingredients';
  if (result.coverage.status === 'complete') return `Complete — ${result.coverage.includedCount} of ${result.coverage.totalCount} ingredients counted`;
  if (result.coverage.status === 'partial') return `Partial — ${result.coverage.includedCount} of ${result.coverage.totalCount} ingredients counted`;
  return 'None counted yet — confirm links to see nutrition';
};

/** Choose the first available basis in the plan's preferred order. */
export const defaultBasis = (result: RecipeNutritionResult): NutritionBasisKey => {
  for (const key of ['perServing', 'perPortion', 'total'] as const) {
    if (result.bases[key].available) return key;
  }
  return 'total';
};

/** Return the severity tone used for an excluded ingredient row. */
export const exclusionTone = (row: { reasons: NutritionExclusionReason[] }): 'error' | 'warning' | 'muted' => {
  if (row.reasons.some((reason) => [
    'stale-missing', 'stale-renamed', 'stale-revised', 'unverifiable-target', 'invalid-basis',
  ].includes(reason))) return 'error';
  if (row.reasons.some((reason) => reason === 'candidate' || reason === 'candidate-missing')) return 'warning';
  return 'muted';
};

