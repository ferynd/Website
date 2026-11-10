export { PASTE_HEADER, parseIngredientPaste, renderIngredientPaste } from './pasteFormat.js';
export { createImportDraft, applyLineCorrection, effectiveLine } from './importDraft.js';
export { fromLegacyPaste, fromRecipeStandardizerRecipe, fromSavedMeal, fromSavedRecipe } from './inputAdapters.js';
export { confirmMatch, proposeConfirmedAlias, reconcileImport } from './reconcile.js';
export { ASSISTANT_INSTRUCTIONS, INSTRUCTIONS_VERSION, copyAssistantInstructions } from './assistantInstructions.js';
export { IMPORT_LIMITS, IMPORT_SCHEMA_VERSION, INGREDIENT_LIST_KIND, MODEL_CALLS, compoundGroups, fitTargets, isFreeQuantity, publicIngredientList, researchEvidence, resolveLineQuantity, validateIngredientList } from './ingredientList.js';
import { createImportDraft } from './importDraft.js';
import { parseIngredientPaste } from './pasteFormat.js';
import { validateIngredientList } from './ingredientList.js';

/** Accept one ingredient-list JSON document, one fenced JSON block, or one paste list. */
export function importIngredientList(input, source = {}) {
    if (typeof input === 'string' && /^\s*NUTRITION-INGREDIENTS\b/.test(input)) {
        const parsed = parseIngredientPaste(input);
        if (!parsed.ok) return parsed;
        return createImportDraft(parsed.list, { kind: 'paste', ...source, modelCalls: 0 });
    }
    const validated = validateIngredientList(input);
    if (!validated.ok) return validated;
    return createImportDraft(validated.list, { kind: 'ingredient_list', ...source, modelCalls: 0 });
}
