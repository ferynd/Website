/* ------------------------------------------------------------ */
/* CONFIGURATION: nutrition calculation bounds                    */
/* ------------------------------------------------------------ */
/** Largest accepted ingredient weight (1 tonne); above this the quantity is treated as invalid. */
export const MAX_INGREDIENT_GRAMS = 1_000_000;

/**
 * Pure nutrition calculation with no Firebase or React dependencies. Only confirmed, current links count.
 * Totals are computed at 1× and then scaled; missing nutrients are unknown, not zero. Values come from
 * raw ingredient data.
 */

import {
  assessNutritionLink,
  isValidGramsPerUnit,
  type LinkAssessment,
} from './nutritionLink';
import {
  referenceWeightG,
  referenceWeightSource,
  type PortionOverride,
  type ScaleResult,
} from './scaling';
import {
  TRACKER_NUTRIENT_KEYS,
  type FoodsState,
  type TrackerFood,
  type TrackerNutrientKey,
} from './trackerFoods';
import type { NutritionLink, Recipe, RecipeIngredient } from './types';

/** A recipe's ingredient-row coverage state. */
export type NutritionCoverageStatus = 'complete' | 'partial' | 'none';

/** Why a recipe ingredient's Nutrition Tracker link cannot be counted. */
export type LinkExclusionReason =
  | 'unlinked'
  | 'no-match'
  | 'candidate'
  | 'candidate-missing'
  | 'stale-missing'
  | 'stale-renamed'
  | 'stale-revised'
  | 'unverifiable-target'
  | 'invalid-basis'
  | 'foods-unavailable';

/** Why an ingredient's gram quantity cannot be used. */
export type QuantityExclusionReason = 'missing-quantity' | 'zero-quantity' | 'invalid-quantity';

/** Every supported reason an ingredient can be excluded from nutrition totals. */
export type NutritionExclusionReason = LinkExclusionReason | QuantityExclusionReason | 'duplicate-id';

/** Reasons in stable display order. */
export const NUTRITION_EXCLUSION_REASONS: readonly NutritionExclusionReason[] = [
  'stale-missing',
  'stale-renamed',
  'stale-revised',
  'unverifiable-target',
  'invalid-basis',
  'candidate',
  'candidate-missing',
  'unlinked',
  'no-match',
  'foods-unavailable',
  'missing-quantity',
  'zero-quantity',
  'invalid-quantity',
  'duplicate-id',
];

/** One nutrient amount, with null representing no known contribution. */
export interface NutrientAmount {
  /** Null means no counted ingredient provides this nutrient. */
  value: number | null;
  /** Whether the displayed value omits an ingredient or nutrient value. */
  isLowerBound: boolean;
  /** Ingredient ids whose food has no usable value for this nutrient. */
  missingFromIngredientIds: string[];
}

/** Nutrient amounts in canonical tracker key order. */
export type NutrientAmounts = Record<TrackerNutrientKey, NutrientAmount>;

/** A recipe ingredient included in the baseline calculation. */
export interface IncludedIngredient {
  ingredientId: string;
  index: number;
  displayName: string;
  optional: boolean;
  scaledGrams: number;
  foodId: string;
  foodName: string;
  gramsPerUnit: number;
  /** Nutrient contributions before applying the current scale factor. */
  baseContributions: Record<TrackerNutrientKey, number | null>;
}

/** A recipe ingredient excluded from the calculation, in source order. */
export interface ExcludedIngredient {
  ingredientId: string;
  index: number;
  displayName: string;
  optional: boolean;
  scaledGrams: number | null;
  equivalent: string;
  /** Reasons are non-empty and preserve link-before-quantity ordering. */
  reasons: NutritionExclusionReason[];
  matchedName: string | null;
  currentName: string | null;
  canEditLink: boolean;
  canEditQuantity: boolean;
}

/** Ingredient and gram coverage plus nutrient data gaps. */
export interface NutritionCoverage {
  status: NutritionCoverageStatus;
  includedCount: number;
  totalCount: number;
  coveredGrams: number;
  /** Includes valid duplicate rows even though later duplicate rows are excluded. */
  knownGrams: number;
  unknownWeightCount: number;
  optionalIncludedCount: number;
  nutrientGaps: TrackerNutrientKey[];
}

/** A selectable recipe nutrition basis. */
export type NutritionBasisKey = 'total' | 'perServing' | 'perPortion' | 'per100gCooked';

/** The supported nutrition display bases in selector order. */
export const NUTRITION_BASIS_KEYS: readonly NutritionBasisKey[] = [
  'total',
  'perServing',
  'perPortion',
  'per100gCooked',
];

/** Why a requested basis has no amount values. */
export type BasisUnavailableReason = 'no-coverage' | 'no-servings' | 'no-portion-data' | 'no-final-weight';

/** Which recipe data supplied the per-portion calculation. */
export type PortionMode = 'override' | 'count' | 'size';

/** Values and context for one nutrition basis. */
export interface NutritionBasis {
  key: NutritionBasisKey;
  available: boolean;
  unavailableReason: BasisUnavailableReason | null;
  estimated: boolean;
  servings: number | null;
  portionMode: PortionMode | null;
  portionCount: number | null;
  portionSizeG: number | null;
  finalWeightG: number | null;
  weightSource: 'actual' | 'estimated' | null;
  amounts: NutrientAmounts | null;
}

/** Full derived nutrition result for a recipe at the selected scale. */
export interface RecipeNutritionResult {
  foodsStatus: FoodsState['status'];
  factor: number;
  coverage: NutritionCoverage;
  bases: Record<NutritionBasisKey, NutritionBasis>;
  included: IncludedIngredient[];
  excluded: ExcludedIngredient[];
}

/** Recipe, current tracker foods, and working scale used by the pure calculator. */
export interface NutritionInput {
  recipe: Recipe;
  foods: FoodsState;
  scale: Pick<ScaleResult, 'factor' | 'portionOverride'>;
}

const positiveFinite = (value: number | null | undefined): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value > 0
);

/** Return the exclusion reason for a missing, zero, or invalid gram amount. */
export const quantityExclusionReason = (value: unknown): QuantityExclusionReason | null => {
  if (value === null || value === undefined) return 'missing-quantity';
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_INGREDIENT_GRAMS) {
    return 'invalid-quantity';
  }
  if (value === 0) return 'zero-quantity';
  return null;
};

/** Map the assessed link state and basis validity to an explicit exclusion reason. */
export const linkExclusionReason = (
  link: NutritionLink,
  assessment: LinkAssessment,
): LinkExclusionReason | null => {
  switch (assessment.state) {
    case 'unlinked':
    case 'no-match':
    case 'candidate':
    case 'candidate-missing':
    case 'stale-missing':
    case 'stale-renamed':
    case 'stale-revised':
      return assessment.state;
    case 'confirmed-unverified':
      return 'foods-unavailable';
    case 'confirmed':
      if (link.targetFingerprint === null) return 'unverifiable-target';
      if (!isValidGramsPerUnit(link.gramsPerUnit)) return 'invalid-basis';
      if (assessment.food === null) return 'stale-missing';
      return null;
    default: {
      const exhaustive: never = assessment.state;
      return exhaustive;
    }
  }
};

/** Calculate each per-nutrient baseline contribution, returning null on numeric overflow. */
export const computeBaseContributions = (
  grams: number,
  food: TrackerFood,
  gramsPerUnit: number,
): Record<TrackerNutrientKey, number | null> | null => {
  const contributions = {} as Record<TrackerNutrientKey, number | null>;
  for (const key of TRACKER_NUTRIENT_KEYS) {
    const value = food.nutrients[key];
    if (value === null || !Number.isFinite(value) || value < 0) {
      contributions[key] = null;
      continue;
    }
    const contribution = (grams * value) / gramsPerUnit;
    if (!Number.isFinite(contribution)) return null;
    contributions[key] = contribution;
  }
  return contributions;
};

const emptyBasis = (
  key: NutritionBasisKey,
  reason: BasisUnavailableReason,
): NutritionBasis => ({
  key,
  available: false,
  unavailableReason: reason,
  estimated: false,
  servings: null,
  portionMode: null,
  portionCount: null,
  portionSizeG: null,
  finalWeightG: null,
  weightSource: null,
  amounts: null,
});

const mapAmounts = (
  amounts: NutrientAmounts,
  transform: (value: number) => number,
): NutrientAmounts => {
  const output = {} as NutrientAmounts;
  for (const key of TRACKER_NUTRIENT_KEYS) {
    const amount = amounts[key];
    const value = amount.value === null ? null : transform(amount.value);
    output[key] = {
      value: value !== null && Number.isFinite(value) ? value : null,
      isLowerBound: amount.isLowerBound,
      missingFromIngredientIds: [...amount.missingFromIngredientIds],
    };
  }
  return output;
};

const availableBasis = (
  key: NutritionBasisKey,
  amounts: NutrientAmounts,
  values: Partial<NutritionBasis> = {},
): NutritionBasis => ({
  ...emptyBasis(key, 'no-coverage'),
  ...values,
  available: true,
  unavailableReason: null,
  amounts,
});

const rowFor = (
  ingredient: RecipeIngredient,
  index: number,
  scaledGrams: number | null,
  reasons: NutritionExclusionReason[],
  assessment: LinkAssessment,
): ExcludedIngredient => {
  const linkReasons = reasons.filter((reason) => !['missing-quantity', 'zero-quantity', 'invalid-quantity'].includes(reason));
  const quantityReasons = reasons.filter((reason) => ['missing-quantity', 'zero-quantity', 'invalid-quantity'].includes(reason));
  return {
    ingredientId: ingredient.id,
    index,
    displayName: ingredient.displayName,
    optional: ingredient.optional,
    scaledGrams,
    equivalent: ingredient.equivalent,
    reasons: [...linkReasons, ...quantityReasons],
    matchedName: ingredient.nutritionLink.matchedName,
    currentName: assessment.currentName,
    canEditLink: linkReasons.some((reason) => reason !== 'foods-unavailable'),
    canEditQuantity: quantityReasons.length > 0,
  };
};

/** Calculate recipe nutrition, coverage, exclusions, and available serving bases. */
export const calculateRecipeNutrition = ({ recipe, foods, scale }: NutritionInput): RecipeNutritionResult => {
  const factor = positiveFinite(scale.factor) ? scale.factor : 1;
  const foodsById = foods.status === 'ready'
    ? new Map(foods.items.map((food) => [food.id, food]))
    : null;
  const included: IncludedIngredient[] = [];
  const excluded: ExcludedIngredient[] = [];
  const seenIds = new Set<string>();
  let knownBase = 0;
  let coveredBase = 0;
  let unknownWeightCount = 0;
  let optionalIncludedCount = 0;

  recipe.ingredients.forEach((ingredient, index) => {
    const quantityReason = quantityExclusionReason(ingredient.quantityG);
    const grams = quantityReason === null && typeof ingredient.quantityG === 'number'
      ? ingredient.quantityG
      : null;
    if (grams === null) {
      unknownWeightCount += 1;
    } else {
      knownBase += grams;
    }
    const assessment = assessNutritionLink(ingredient.nutritionLink, foodsById);
    if (seenIds.has(ingredient.id)) {
      excluded.push(rowFor(ingredient, index, grams === null ? null : grams * factor, ['duplicate-id'], assessment));
      return;
    }
    seenIds.add(ingredient.id);

    const reasons: NutritionExclusionReason[] = [];
    const linkReason = linkExclusionReason(ingredient.nutritionLink, assessment);
    if (linkReason !== null) reasons.push(linkReason);
    if (quantityReason !== null) reasons.push(quantityReason);
    let contributions: Record<TrackerNutrientKey, number | null> | null = null;
    if (reasons.length === 0 && grams !== null && assessment.food !== null) {
      const gramsPerUnit = ingredient.nutritionLink.gramsPerUnit;
      if (!isValidGramsPerUnit(gramsPerUnit)) {
        reasons.push('invalid-basis');
      } else {
        contributions = computeBaseContributions(grams, assessment.food, gramsPerUnit);
        if (contributions === null) reasons.push('invalid-basis');
      }
    }
    const gramsPerUnit = ingredient.nutritionLink.gramsPerUnit;
    if (reasons.length > 0 || contributions === null || assessment.food === null || grams === null || !isValidGramsPerUnit(gramsPerUnit)) {
      excluded.push(rowFor(ingredient, index, grams === null ? null : grams * factor, reasons, assessment));
      return;
    }
    included.push({
      ingredientId: ingredient.id,
      index,
      displayName: ingredient.displayName,
      optional: ingredient.optional,
      scaledGrams: grams * factor,
      foodId: assessment.food.id,
      foodName: assessment.food.name,
      gramsPerUnit,
      baseContributions: contributions,
    });
    coveredBase += grams;
    if (ingredient.optional) optionalIncludedCount += 1;
  });

  const status: NutritionCoverageStatus = included.length === 0
    ? 'none'
    : included.length === recipe.ingredients.length
      ? 'complete'
      : 'partial';
  const baseAmounts = {} as NutrientAmounts;
  const nutrientGaps: TrackerNutrientKey[] = [];
  for (const key of TRACKER_NUTRIENT_KEYS) {
    let sum = 0;
    let hasValue = false;
    const missingFromIngredientIds: string[] = [];
    for (const row of included) {
      const contribution = row.baseContributions[key];
      if (contribution === null) {
        missingFromIngredientIds.push(row.ingredientId);
      } else {
        sum += contribution;
        hasValue = true;
      }
    }
    const safeSum = Number.isFinite(sum) ? sum : null;
    if (missingFromIngredientIds.length > 0) nutrientGaps.push(key);
    baseAmounts[key] = {
      value: hasValue ? safeSum : null,
      isLowerBound: status !== 'complete' || missingFromIngredientIds.length > 0,
      missingFromIngredientIds,
    };
  }

  const coverage: NutritionCoverage = {
    status,
    includedCount: included.length,
    totalCount: recipe.ingredients.length,
    coveredGrams: coveredBase * factor,
    knownGrams: knownBase * factor,
    unknownWeightCount,
    optionalIncludedCount,
    nutrientGaps,
  };
  const noCoverageBases = (): Record<NutritionBasisKey, NutritionBasis> => ({
    total: emptyBasis('total', 'no-coverage'),
    perServing: emptyBasis('perServing', 'no-coverage'),
    perPortion: emptyBasis('perPortion', 'no-coverage'),
    per100gCooked: emptyBasis('per100gCooked', 'no-coverage'),
  });
  if (status === 'none') {
    return { foodsStatus: foods.status, factor, coverage, bases: noCoverageBases(), included, excluded };
  }

  const servings = recipe.servings.baselineServings;
  const referenceWeight = referenceWeightG(recipe);
  const weightSource = referenceWeightSource(recipe);
  const portionCount = recipe.servings.portionCount;
  const portionSizeG = recipe.servings.portionSizeG;
  const bases: Record<NutritionBasisKey, NutritionBasis> = {
    total: availableBasis('total', mapAmounts(baseAmounts, (value) => value * factor)),
    perServing: positiveFinite(servings)
      ? availableBasis('perServing', mapAmounts(baseAmounts, (value) => value / servings), {
        servings: servings * factor,
      })
      : emptyBasis('perServing', 'no-servings'),
    perPortion: emptyBasis('perPortion', 'no-portion-data'),
    per100gCooked: referenceWeight !== null
      ? availableBasis('per100gCooked', mapAmounts(baseAmounts, (value) => (value * 100) / referenceWeight), {
        finalWeightG: referenceWeight * factor,
        weightSource,
        estimated: weightSource === 'estimated' || (weightSource === 'actual' && factor !== 1),
      })
      : emptyBasis('per100gCooked', 'no-final-weight'),
  };

  const override: PortionOverride | undefined = scale.portionOverride;
  if (override !== undefined && positiveFinite(override.count) && positiveFinite(override.sizeG)) {
    bases.perPortion = availableBasis(
      'perPortion',
      mapAmounts(baseAmounts, (value) => (value * factor) / override.count),
      {
        portionMode: 'override',
        portionCount: override.count,
        portionSizeG: override.sizeG,
        finalWeightG: referenceWeight === null ? null : referenceWeight * factor,
        weightSource,
        estimated: weightSource === 'estimated' || (weightSource === 'actual' && factor !== 1),
      },
    );
  } else if (positiveFinite(portionCount)) {
    bases.perPortion = availableBasis(
      'perPortion',
      mapAmounts(baseAmounts, (value) => value / portionCount),
      {
        portionMode: 'count',
        portionCount: portionCount * factor,
        portionSizeG: referenceWeight === null ? null : referenceWeight / portionCount,
        finalWeightG: referenceWeight === null ? null : referenceWeight * factor,
        weightSource: referenceWeight === null ? null : weightSource,
        estimated: referenceWeight !== null && (
          weightSource === 'estimated' || (weightSource === 'actual' && factor !== 1)
        ),
      },
    );
  } else if (positiveFinite(portionSizeG) && referenceWeight !== null) {
    bases.perPortion = availableBasis(
      'perPortion',
      mapAmounts(baseAmounts, (value) => (value * portionSizeG) / referenceWeight),
      {
        portionMode: 'size',
        portionSizeG,
        finalWeightG: referenceWeight * factor,
        weightSource,
        estimated: weightSource === 'estimated' || (weightSource === 'actual' && factor !== 1),
      },
    );
  } else if (positiveFinite(portionSizeG)) {
    bases.perPortion = emptyBasis('perPortion', 'no-final-weight');
  }

  return { foodsStatus: foods.status, factor, coverage, bases, included, excluded };
};
