/* ------------------------------------------------------------ */
/* CONFIGURATION: scaling display precision                      */
/* ------------------------------------------------------------ */
/** Below this many grams, scaled quantities show one decimal place. */
const FINE_GRAM_THRESHOLD = 10;

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

import type { Recipe } from './types';

export type ScaleMode = 'multiplier' | 'servings' | 'targetWeight' | 'portions';

export interface ScaleResult {
  factor: number;
  /** Human description of how the factor was derived, e.g. "18 servings (1.5x)". */
  label: string;
}

const isPositive = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

export const formatFactor = (factor: number): string => {
  const rounded = Math.round(factor * 100) / 100;
  return `${rounded}×`;
};

export const factorFromMultiplier = (multiplier: number): ScaleResult | null => {
  if (!isPositive(multiplier)) return null;
  return { factor: multiplier, label: `batch ${formatFactor(multiplier)}` };
};

export const factorFromServings = (
  targetServings: number,
  baselineServings: number | null,
): ScaleResult | null => {
  if (!isPositive(targetServings) || !isPositive(baselineServings)) return null;
  const factor = targetServings / baselineServings;
  return { factor, label: `${targetServings} servings (${formatFactor(factor)})` };
};

/** Reference weight for weight-based scaling: actual weight wins over estimate. */
export const referenceWeightG = (recipe: Recipe): number | null => {
  if (isPositive(recipe.yield.actualFinalWeightG)) return recipe.yield.actualFinalWeightG;
  if (isPositive(recipe.yield.estimatedFinalWeightG)) return recipe.yield.estimatedFinalWeightG;
  return null;
};

export const factorFromTargetWeight = (
  targetWeightG: number,
  refWeightG: number | null,
): ScaleResult | null => {
  if (!isPositive(targetWeightG) || !isPositive(refWeightG)) return null;
  const factor = targetWeightG / refWeightG;
  return { factor, label: `${Math.round(targetWeightG)} g final weight (${formatFactor(factor)})` };
};

export const factorFromPortions = (
  portionCount: number,
  portionSizeG: number,
  refWeightG: number | null,
): ScaleResult | null => {
  if (!isPositive(portionCount) || !isPositive(portionSizeG) || !isPositive(refWeightG)) return null;
  const targetWeightG = portionCount * portionSizeG;
  const factor = targetWeightG / refWeightG;
  return {
    factor,
    label: `${portionCount} × ${Math.round(portionSizeG)} g portions (${formatFactor(factor)})`,
  };
};

/** Scale a gram quantity and round to a kitchen-sensible precision. */
export const scaleQuantityG = (quantityG: number | null, factor: number): number | null => {
  if (quantityG === null || !Number.isFinite(quantityG)) return null;
  const scaled = quantityG * factor;
  if (scaled < FINE_GRAM_THRESHOLD) return Math.round(scaled * 10) / 10;
  return Math.round(scaled);
};

export const formatGrams = (quantityG: number | null): string =>
  quantityG === null ? '— g' : `${quantityG} g`;

/* ------------------------------------------------------------ */
/* Equivalent-text scaling                                       */
/* ------------------------------------------------------------ */

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
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
  const rounded = Math.round(value * 100) / 100;
  // Prefer common kitchen fractions when they match closely.
  const whole = Math.floor(rounded);
  const remainder = rounded - whole;
  const fractions: Array<[number, string]> = [
    [0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [2 / 3, '2/3'], [0.75, '3/4'],
  ];
  for (const [v, label] of fractions) {
    if (Math.abs(remainder - v) < 0.02) {
      return whole > 0 ? `${whole} ${label}` : label;
    }
  }
  if (Math.abs(remainder) < 0.02) return String(whole);
  return String(rounded);
};

// A range continues right after the leading amount: "1-2 cloves", "1 to 2 tbsp",
// "1 or 2 eggs". Scaling only the first number would corrupt the instruction.
const RANGE_CONTINUATION = /^(?:[-–—]|to\b|or\b)\s*[\d¼½¾⅓⅔⅛⅜⅝⅞]/i;

/**
 * Best-effort scaling of a free-text equivalent like "2 cups" or "1 1/2 tbsp".
 * Returns the scaled string when the text starts with a parseable amount,
 * otherwise null — callers should then show the baseline text labeled as
 * unscaled rather than displaying a wrong number. Ranges ("1-2 cloves") are
 * deliberately not scaled.
 */
export const scaleEquivalentText = (equivalent: string, factor: number): string | null => {
  const trimmed = equivalent.trim();
  if (!trimmed) return null;
  if (factor === 1) return trimmed;
  const match = trimmed.match(LEADING_AMOUNT);
  if (!match) return null;
  const amount = parseLeadingAmount(match[1]);
  if (amount === null) return null;
  const rest = (match[2] ?? '').trim();
  if (RANGE_CONTINUATION.test(rest)) return null;
  return `${formatAmount(amount * factor)}${rest ? ` ${rest}` : ''}`;
};

/** Bake a scale factor into a recipe, producing a new baseline. */
export const applyScaleToRecipe = (recipe: Recipe, factor: number): Recipe => ({
  ...recipe,
  servings: {
    ...recipe.servings,
    baselineServings:
      recipe.servings.baselineServings === null
        ? null
        : Math.round(recipe.servings.baselineServings * factor * 100) / 100,
    currentServings: null,
  },
  yield: {
    ...recipe.yield,
    // The best-known weight (actual beats estimated) scales into the new
    // baseline's *estimate*; the measured actual weight belonged to the old
    // batch size and is cleared.
    estimatedFinalWeightG: scaleQuantityG(referenceWeightG(recipe) ?? recipe.yield.estimatedFinalWeightG, factor),
    actualFinalWeightG: null,
    yieldNotes: recipe.yield.yieldNotes,
  },
  ingredients: recipe.ingredients.map((ing) => ({
    ...ing,
    quantityG: scaleQuantityG(ing.quantityG, factor),
    equivalent: scaleEquivalentText(ing.equivalent, factor) ?? ing.equivalent,
  })),
});
