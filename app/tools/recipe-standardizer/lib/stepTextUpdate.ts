/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

/**
 * Keeping human-readable step text honest after ingredient renames.
 *
 * Structured displays (section ingredient lists, step chips, shopping modes)
 * update automatically because they render from ingredient data — but step
 * `text` is free prose, so renaming "butter" to "oil" would otherwise leave
 * contradictions like "Cream butter" next to an "oil" chip.
 *
 * V1 approach: when a rename happens, find every step that references the
 * ingredient (by id) or mentions the old name, propose a safe word-boundary
 * text replacement where the old name clearly appears, and let the user
 * review/adjust each affected step before it is applied. Nothing is rewritten
 * silently.
 */

import type { Recipe } from './types';

export type StepListKey = 'prepSteps' | 'activeSteps';

export interface AffectedStep {
  list: StepListKey;
  stepId: string;
  sectionId: string;
  originalText: string;
  /** Auto-replaced text when the old name clearly appears; null = manual only. */
  suggestedText: string | null;
}

export interface StepTextUpdate {
  list: StepListKey;
  stepId: string;
  text: string;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace clear, word-bounded occurrences of `oldName` (case-insensitive)
 * with `newName`, preserving a leading capital per occurrence. Returns null
 * when the old name does not appear, so callers can distinguish "nothing to
 * suggest" from "replaced".
 */
export const replaceIngredientName = (
  text: string,
  oldName: string,
  newName: string,
): string | null => {
  const trimmedOld = oldName.trim();
  const trimmedNew = newName.trim();
  if (!trimmedOld || !trimmedNew) return null;
  // Captured prefix instead of a lookbehind (older Safari lacks lookbehind).
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])(${escapeRegExp(trimmedOld)})(?![\\p{L}\\p{N}])`,
    'giu',
  );
  if (!pattern.test(text)) return null;
  pattern.lastIndex = 0;
  return text.replace(pattern, (_full, prefix: string, match: string) => {
    const firstChar = match.charAt(0);
    const replacement =
      firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()
        ? trimmedNew.charAt(0).toUpperCase() + trimmedNew.slice(1)
        : trimmedNew;
    return `${prefix}${replacement}`;
  });
};

/**
 * Every step that might contradict a rename: steps referencing the
 * ingredient id, plus steps whose prose mentions the old name even without
 * a structured reference.
 */
export const findAffectedSteps = (
  recipe: Recipe,
  ingredientId: string,
  oldName: string,
  newName: string,
): AffectedStep[] => {
  const affected: AffectedStep[] = [];
  (['prepSteps', 'activeSteps'] as const).forEach((list) => {
    recipe[list].forEach((step) => {
      const suggestedText = replaceIngredientName(step.text, oldName, newName);
      if (!step.ingredientRefs.includes(ingredientId) && suggestedText === null) return;
      affected.push({
        list,
        stepId: step.id,
        sectionId: step.sectionId,
        originalText: step.text,
        suggestedText,
      });
    });
  });
  return affected;
};

/** Apply reviewed step-text updates; unknown ids are ignored. */
export const applyStepTextUpdates = (recipe: Recipe, updates: StepTextUpdate[]): Recipe => {
  if (updates.length === 0) return recipe;
  const byList: Record<StepListKey, Map<string, string>> = {
    prepSteps: new Map(),
    activeSteps: new Map(),
  };
  updates.forEach((update) => {
    const text = update.text.trim();
    if (text) byList[update.list].set(update.stepId, text);
  });
  return {
    ...recipe,
    prepSteps: recipe.prepSteps.map((step) =>
      byList.prepSteps.has(step.id) ? { ...step, text: byList.prepSteps.get(step.id)! } : step,
    ),
    activeSteps: recipe.activeSteps.map((step) =>
      byList.activeSteps.has(step.id) ? { ...step, text: byList.activeSteps.get(step.id)! } : step,
    ),
  };
};
