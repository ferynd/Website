/* --- CONFIGURATION: equivalent display suffixes --- */
/** Shared ingredient formatting. Annotated equivalents are never live-scaled. */

const EQUIVALENT_UNSCALED_SUFFIX = ' at 1×';
const equivalentStaleSuffix = (factor: number): string =>
  ` — not rescaled after ${formatFactor(factor)} bake`;

/**
 * Shared display formatting for scaled ingredient amounts.
 * Grams are primary; the equivalent is secondary. When the free-text
 * equivalent can't be numerically scaled, it is shown with an explicit
 * "at 1×" marker instead of a silently wrong number.
 */

import {
  formatFactor,
  formatGrams,
  scaleEquivalentText,
  scaleQuantityG,
} from './scaling';
import type { RecipeIngredient } from './types';

/** Caveat that accompanies an equivalent measure. */
export type EquivalentNote =
  | {
    kind: 'none';
  }
  | {
    kind: 'unscaled';
  }
  | {
    kind: 'stale-after-bake';
    bakeFactor: number;
  };

/** Describe an equivalent without ever live-scaling an annotated old-batch measure. */
export const describeEquivalent = (
  ingredient: Pick<RecipeIngredient, 'equivalent' | 'equivalentBakeFactor'>,
  factor: number,
): {
  text: string | null;
  note: EquivalentNote;
} => {
  if (ingredient.equivalent.trim() === '') return { text: null, note: { kind: 'none' } };
  if (ingredient.equivalentBakeFactor !== null) {
    return {
      text: ingredient.equivalent,
      note: { kind: 'stale-after-bake', bakeFactor: ingredient.equivalentBakeFactor },
    };
  }
  const scaled = scaleEquivalentText(ingredient.equivalent, factor);
  return {
    text: scaled ?? ingredient.equivalent,
    note: { kind: scaled === null && factor !== 1 ? 'unscaled' : 'none' },
  };
};

/** Shared suffix in every ingredient display. */
export const equivalentSuffix = (note: EquivalentNote): string => {
  switch (note.kind) {
    case 'none':
      return '';
    case 'unscaled':
      return EQUIVALENT_UNSCALED_SUFFIX;
    case 'stale-after-bake':
      return equivalentStaleSuffix(note.bakeFactor);
    default: {
      const exhaustive: never = note;
      return exhaustive;
    }
  }
};

/** Grams and an optional equivalent with its display caveat. */
export interface AmountDisplay {
  grams: string;
  equivalent: string | null;
  equivalentNote: EquivalentNote;
}

/** Format authoritative grams and secondary equivalent text together. */
export const formatAmount = (ingredient: RecipeIngredient, factor: number): AmountDisplay => {
  const equivalent = describeEquivalent(ingredient, factor);
  return {
    grams: formatGrams(scaleQuantityG(ingredient.quantityG, factor)),
    equivalent: equivalent.text,
    equivalentNote: equivalent.note,
  };
};

/** Format a library timestamp in the user's locale. */
export const formatUpdatedAt = (ms: number | null): string => {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};
