/* --- CONFIGURATION: scaling display precision --- */
/** Pure scaling math; grams are authoritative and baked equivalents retain cumulative provenance. */

const FINE_GRAM_THRESHOLD = 10;
const DISPLAY_ROUNDING_FACTOR = 100;
const FINE_GRAM_ROUNDING_FACTOR = 10;
const KITCHEN_FRACTION_EPSILON = 0.02;
const SCALE_COPY = {
  batch: (factor: string) => `batch ${factor}`,
  servings: (count: number, factor: string) => `${count} servings (${factor})`,
  weight: (grams: number, factor: string) => `${grams} g final weight (${factor})`,
  portions: (count: number, grams: number, factor: string) => `${count} × ${grams} g portions (${factor})`,
  factor: (value: number) => `${value}×`,
  grams: (value: number) => `${value} g`,
  unknownGrams: '— g',
} as const;
/** Treat scale calculations sufficiently close to one as an exact 1× scale. */
export const FACTOR_ONE_EPSILON = 1e-9;
/** Largest supported scale factor. */
export const MAX_SCALE_FACTOR = 1000;
/** Smallest supported scale factor. */
export const MIN_SCALE_FACTOR = 0.001;

/**
 * Pure scaling math for the Recipe Standardizer.
 *
 * Grams are the source of truth. Every scaling mode (servings, multiplier,
 * target final weight, portion count x portion size) reduces to a single
 * multiplier applied to baseline gram quantities. Scaling is applied to a
 * working copy at render time — the baseline recipe is never mutated unless
 * the user explicitly bakes the scale in (which then goes through the
 * update / save-as-new / cancel flow).
 */

import type { Recipe, RecipeIngredient } from './types';

/** Available ways to derive a working-copy scale factor. */
export type ScaleMode = 'multiplier' | 'servings' | 'targetWeight' | 'portions';

/** The portion count and size requested in Portions-mode scaling. */
export interface PortionOverride {
  count: number;
  sizeG: number;
}

/** The derived scale factor and its explanatory label. */
export interface ScaleResult {
  factor: number;
  /** Human description of how the factor was derived, e.g. "18 servings (1.5x)". */
  label: string;
  /** Set only by portions-mode scaling. */
  portionOverride?: PortionOverride;
}

/** Whether the working copy has an active scale, including portion-only overrides. */
export const isScaleActive = (scale: ScaleResult): boolean => (
  scale.factor !== 1 || scale.portionOverride !== undefined
);

const isPositive = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

const snapFactor = (factor: number): number => (
  Math.abs(factor - 1) < FACTOR_ONE_EPSILON ? 1 : factor
);

const isSupportedFactor = (factor: number): boolean => (
  Number.isFinite(factor) && factor >= MIN_SCALE_FACTOR && factor <= MAX_SCALE_FACTOR
);

/** Format a scale factor to at most two decimal places. */
export const formatFactor = (factor: number): string => {
  const rounded = Math.round(factor * DISPLAY_ROUNDING_FACTOR) / DISPLAY_ROUNDING_FACTOR;
  return SCALE_COPY.factor(rounded);
};

/** Derive a scale result from a positive multiplier. */
export const factorFromMultiplier = (multiplier: number): ScaleResult | null => {
  if (!isPositive(multiplier)) return null;
  const factor = snapFactor(multiplier);
  if (!isSupportedFactor(factor)) return null;
  return { factor, label: SCALE_COPY.batch(formatFactor(factor)) };
};

/** Derive a scale result from requested servings and baseline servings. */
export const factorFromServings = (
  targetServings: number,
  baselineServings: number | null,
): ScaleResult | null => {
  if (!isPositive(targetServings) || !isPositive(baselineServings)) return null;
  const factor = snapFactor(targetServings / baselineServings);
  if (!isSupportedFactor(factor)) return null;
  return { factor, label: SCALE_COPY.servings(targetServings, formatFactor(factor)) };
};

/** Reference weight for weight-based scaling: actual weight wins over estimate. */
export const referenceWeightG = (recipe: Recipe): number | null => {
  if (isPositive(recipe.yield.actualFinalWeightG)) return recipe.yield.actualFinalWeightG;
  if (isPositive(recipe.yield.estimatedFinalWeightG)) return recipe.yield.estimatedFinalWeightG;
  return null;
};

/** Identify which final weight is used as the reference. */
export const referenceWeightSource = (recipe: Recipe): 'actual' | 'estimated' | null => {
  if (isPositive(recipe.yield.actualFinalWeightG)) return 'actual';
  if (isPositive(recipe.yield.estimatedFinalWeightG)) return 'estimated';
  return null;
};

/** Derive a scale result from a target final weight and reference weight. */
export const factorFromTargetWeight = (
  targetWeightG: number,
  refWeightG: number | null,
): ScaleResult | null => {
  if (!isPositive(targetWeightG) || !isPositive(refWeightG)) return null;
  const factor = snapFactor(targetWeightG / refWeightG);
  if (!isSupportedFactor(factor)) return null;
  return { factor, label: SCALE_COPY.weight(Math.round(targetWeightG), formatFactor(factor)) };
};

/** Derive a scale result from a requested count and size of portions. */
export const factorFromPortions = (
  portionCount: number,
  portionSizeG: number,
  refWeightG: number | null,
): ScaleResult | null => {
  if (!isPositive(portionCount) || !isPositive(portionSizeG) || !isPositive(refWeightG)) return null;
  const targetWeightG = portionCount * portionSizeG;
  const factor = snapFactor(targetWeightG / refWeightG);
  if (!isSupportedFactor(factor)) return null;
  return {
    factor,
    label: SCALE_COPY.portions(portionCount, Math.round(portionSizeG), formatFactor(factor)),
    portionOverride: { count: portionCount, sizeG: portionSizeG },
  };
};

/** Scale and kitchen-round a known gram quantity. */
export const scaleQuantityG = (quantityG: number | null, factor: number): number | null => {
  if (quantityG === null || !Number.isFinite(quantityG)) return null;
  const scaled = quantityG * factor;
  if (scaled < FINE_GRAM_THRESHOLD) return Math.round(scaled * FINE_GRAM_ROUNDING_FACTOR) / FINE_GRAM_ROUNDING_FACTOR;
  return Math.round(scaled);
};

/** Format a gram amount, showing a dash for unknown quantity. */
export const formatGrams = (quantityG: number | null): string =>
  quantityG === null ? SCALE_COPY.unknownGrams : SCALE_COPY.grams(quantityG);

/* ------------------------------------------------------------ */
/* Equivalent-text scaling                                       */
/* ------------------------------------------------------------ */

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

// Leading amount: "1 1/2", "3/4", "1½", "½", "2.5", "2".
// Fraction forms must come before the plain-number alternative or "3/4"
// would match as just "3".
const LEADING_AMOUNT = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\s?[¼½¾⅓⅔⅛⅜⅝⅞]|\d+(?:\.\d+)?)\s*(.*)$/;

const parseLeadingAmount = (token: string): number | null => {
  const t = token.trim();
  const unicodeMatch = t.match(/^(\d*)\s?([¼½¾⅓⅔⅛⅜⅝⅞])$/);
  if (unicodeMatch) {
    const whole = unicodeMatch[1] ? parseInt(unicodeMatch[1], 10) : 0;
    return whole + UNICODE_FRACTIONS[unicodeMatch[2]];
  }
  const mixed = t.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?$/);
  if (mixed) {
    const whole = parseFloat(mixed[1]);
    if (mixed[2] && mixed[3]) {
      const den = parseInt(mixed[3], 10);
      if (den === 0) return null;
      return whole + parseInt(mixed[2], 10) / den;
    }
    return whole;
  }
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const den = parseInt(frac[2], 10);
    if (den === 0) return null;
    return parseInt(frac[1], 10) / den;
  }
  return null;
};

const formatAmount = (value: number): string => {
  const rounded = Math.round(value * DISPLAY_ROUNDING_FACTOR) / DISPLAY_ROUNDING_FACTOR;
  // Prefer common kitchen fractions when they match closely.
  const whole = Math.floor(rounded);
  const remainder = rounded - whole;
  const fractions: Array<[number, string]> = [
    [0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [2 / 3, '2/3'], [0.75, '3/4'],
  ];
  for (const [v, label] of fractions) {
    if (Math.abs(remainder - v) < KITCHEN_FRACTION_EPSILON) {
      return whole > 0 ? `${whole} ${label}` : label;
    }
  }
  if (Math.abs(remainder) < KITCHEN_FRACTION_EPSILON) return String(whole);
  return String(rounded);
};

// A range continues right after the leading amount: "1-2 cloves", "1 to 2 tbsp",
// "1 or 2 eggs". Scaling only the first number would corrupt the instruction.
const RANGE_CONTINUATION = /^(?:[-–—]|to\b|or\b)\s*[\d¼½¾⅓⅔⅛⅜⅝⅞]/i;

/** How equivalent text behaves under a scale factor. */
export type EquivalentScaling = 'blank' | 'unchanged' | 'scaled' | 'range' | 'unparseable';

/** Classify text without scaling ranges or prose. */
export const classifyEquivalentText = (equivalent: string, factor: number): EquivalentScaling => {
  const trimmed = equivalent.trim();
  if (trimmed === '') return 'blank';
  if (factor === 1) return 'unchanged';
  const match = trimmed.match(LEADING_AMOUNT);
  if (!match || parseLeadingAmount(match[1]) === null) return 'unparseable';
  if (RANGE_CONTINUATION.test((match[2] ?? '').trim())) return 'range';
  return 'scaled';
};

/** Why an equivalent needs review before baking. */
export type BakeIssueReason = 'range' | 'unparseable' | 'already-stale';

/** One equivalent a bake cannot transform. */
export interface BakeEquivalentIssue {
  ingredientId: string;
  displayName: string;
  equivalent: string;
  gramsBefore: number | null;
  /** Rounded gram amount after applying the bake factor. */
  gramsAfter: number | null;
  reason: BakeIssueReason;
}

/** Explicit review decision for one equivalent. */
export type EquivalentBakeChoice = 'annotate' | 'clear';

/** List non-blank measures that need review; portion-only bakes leave measures alone. */
export const findUnscalableEquivalents = (recipe: Recipe, factor: number): BakeEquivalentIssue[] => {
  if (factor === 1) return [];
  return recipe.ingredients.flatMap((ingredient) => {
    if (ingredient.equivalent.trim() === '') return [];
    const classification = classifyEquivalentText(ingredient.equivalent, factor);
    const reason = ingredient.equivalentBakeFactor !== null ? 'already-stale' : classification;
    if (reason !== 'already-stale' && reason !== 'range' && reason !== 'unparseable') return [];
    return [{
      ingredientId: ingredient.id,
      displayName: ingredient.displayName,
      equivalent: ingredient.equivalent,
      gramsBefore: ingredient.quantityG,
      gramsAfter: scaleQuantityG(ingredient.quantityG, factor),
      reason,
    }];
  });
};

const bakeEquivalent = (
  ingredient: RecipeIngredient,
  factor: number,
  choice: EquivalentBakeChoice,
): Pick<RecipeIngredient, 'equivalent' | 'equivalentBakeFactor'> => {
  const equivalent = ingredient.equivalent;
  if (equivalent.trim() === '') return { equivalent: '', equivalentBakeFactor: null };
  const classification = classifyEquivalentText(equivalent, factor);
  const issue = ingredient.equivalentBakeFactor !== null ||
    classification === 'range' || classification === 'unparseable';
  if (issue && choice === 'clear') return { equivalent: '', equivalentBakeFactor: null };
  if (ingredient.equivalentBakeFactor !== null) {
    const cumulative = snapFactor(ingredient.equivalentBakeFactor * factor);
    return { equivalent, equivalentBakeFactor: cumulative === 1 ? null : cumulative };
  }
  const scaled = scaleEquivalentText(equivalent, factor);
  return scaled === null
    ? { equivalent, equivalentBakeFactor: factor }
    : { equivalent: scaled, equivalentBakeFactor: null };
};

/**
 * Keep, clear, or rescale a baked-equivalent annotation after an edit.
 * Text edits, a blank equivalent, and an explicit confirmation clear it.
 * A gram edit multiplies the stored factor by newG/oldG and clears it when
 * the result is within FACTOR_ONE_EPSILON of 1.
 */
export const nextEquivalentBakeFactor = (
  previous: RecipeIngredient,
  nextEquivalent: string,
  markedCorrect: boolean,
  nextQuantityG: number | null,
): number | null => {
  if (markedCorrect || nextEquivalent.trim() === '' || nextEquivalent !== previous.equivalent) {
    return null;
  }
  const factor = previous.equivalentBakeFactor;
  if (factor === null) return null;
  if (nextQuantityG === previous.quantityG) return factor;
  const oldQuantityG = previous.quantityG;
  if (
    oldQuantityG === null
    || nextQuantityG === null
    || oldQuantityG <= 0
    || nextQuantityG <= 0
  ) {
    // Without a usable gram ratio the equivalent is still unverified after the
    // bake, so keep the stale marker rather than presenting it as accurate.
    return factor;
  }
  const scaled = snapFactor(factor * (nextQuantityG / oldQuantityG));
  if (!Number.isFinite(scaled) || scaled <= 0) return null;
  return scaled === 1 ? null : scaled;
};

/**
 * Best-effort scaling of a free-text equivalent like "2 cups" or "1 1/2 tbsp".
 * Returns the scaled string when the text starts with a parseable amount,
 * otherwise null — callers should then show the baseline text labeled as
 * unscaled rather than displaying a wrong number. Ranges ("1-2 cloves") are
 * deliberately not scaled.
 */
export const scaleEquivalentText = (equivalent: string, factor: number): string | null => {
  const classification = classifyEquivalentText(equivalent, factor);
  if (classification === 'blank' || classification === 'range' || classification === 'unparseable') {
    return null;
  }
  const trimmed = equivalent.trim();
  if (classification === 'unchanged') return trimmed;
  const match = trimmed.match(LEADING_AMOUNT);
  if (!match) return null;
  const amount = parseLeadingAmount(match[1]);
  if (amount === null) return null;
  const rest = (match[2] ?? '').trim();
  return `${formatAmount(amount * factor)}${rest ? ` ${rest}` : ''}`;
};

/** Bake a scale factor into a recipe, producing a new baseline. */
export const applyScaleToRecipe = (
  recipe: Recipe,
  factor: number,
  portionOverride?: PortionOverride,
  equivalentChoices: Readonly<Record<string, EquivalentBakeChoice>> = {},
): Recipe => {
  if (factor === 1 && portionOverride !== undefined) {
    return {
      ...recipe,
      servings: {
        ...recipe.servings,
        portionCount: portionOverride.count,
        portionSizeG: portionOverride.sizeG,
      },
    };
  }

  return {
    ...recipe,
    servings: {
      ...recipe.servings,
      baselineServings:
        recipe.servings.baselineServings === null
          ? null
          : Math.round(recipe.servings.baselineServings * factor * DISPLAY_ROUNDING_FACTOR) / DISPLAY_ROUNDING_FACTOR,
      currentServings: null,
      portionCount:
        portionOverride !== undefined
          ? portionOverride.count
          : recipe.servings.portionCount === null
            ? null
            : Math.round(recipe.servings.portionCount * factor * DISPLAY_ROUNDING_FACTOR) / DISPLAY_ROUNDING_FACTOR,
      portionSizeG: portionOverride?.sizeG ?? recipe.servings.portionSizeG,
    },
    yield: {
      ...recipe.yield,
      estimatedFinalWeightG: scaleQuantityG(
        referenceWeightG(recipe) ?? recipe.yield.estimatedFinalWeightG,
        factor,
      ),
      actualFinalWeightG: null,
      yieldNotes: recipe.yield.yieldNotes,
    },
    ingredients: recipe.ingredients.map((ing) => ({
      ...ing,
      quantityG: scaleQuantityG(ing.quantityG, factor),
      ...bakeEquivalent(ing, factor, equivalentChoices[ing.id] ?? 'annotate'),
    })),
  };
};
