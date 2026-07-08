/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

/**
 * Shared display formatting for scaled ingredient amounts.
 * Grams are primary; the equivalent is secondary. When the free-text
 * equivalent can't be numerically scaled, it is shown with an explicit
 * "at 1×" marker instead of a silently wrong number.
 */

import { formatGrams, scaleEquivalentText, scaleQuantityG } from './scaling';
import type { RecipeIngredient } from './types';

export interface AmountDisplay {
  /** e.g. "340 g" or "— g" when the ingredient has no weight. */
  grams: string;
  /** e.g. "2 cups" — null when the ingredient has no equivalent text. */
  equivalent: string | null;
  /** True when the equivalent could not be scaled and shows the 1× text. */
  equivalentUnscaled: boolean;
}

export const formatAmount = (ingredient: RecipeIngredient, factor: number): AmountDisplay => {
  const grams = formatGrams(scaleQuantityG(ingredient.quantityG, factor));
  if (!ingredient.equivalent) {
    return { grams, equivalent: null, equivalentUnscaled: false };
  }
  const scaled = scaleEquivalentText(ingredient.equivalent, factor);
  if (scaled !== null) {
    return { grams, equivalent: scaled, equivalentUnscaled: false };
  }
  return { grams, equivalent: ingredient.equivalent, equivalentUnscaled: factor !== 1 };
};

export const formatUpdatedAt = (ms: number | null): string => {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};
