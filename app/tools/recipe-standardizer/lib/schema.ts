/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

/**
 * Strict JSON import validation for the Recipe Standardizer.
 *
 * `parseRecipeJson` is pure and never throws. It returns either a normalized
 * `Recipe` (plus non-fatal warnings) or a list of actionable errors, each
 * naming the exact JSON path that failed (e.g. `ingredients[2].id`).
 *
 * Design choices:
 * - Strict JSON only (per product spec) — no markdown/loose-text parsing.
 * - A pasted `shoppingList` array is accepted but ignored: the tool always
 *   derives the shopping list from ingredients (see shoppingList.ts) so it
 *   can never drift out of sync after edits or scaling.
 * - Missing optional string fields normalize to '' and missing arrays to []
 *   so the rest of the app never null-checks decoration fields.
 */

import {
  RECIPE_SCHEMA_VERSION,
  UNLINKED_NUTRITION,
  type NutritionLink,
  type Recipe,
  type RecipeIngredient,
  type RecipeSection,
  type RecipeStep,
  type SectionType,
} from './types';

export interface ParseSuccess {
  ok: true;
  recipe: Recipe;
  warnings: string[];
}

export interface ParseFailure {
  ok: false;
  errors: string[];
}

export type ParseResult = ParseSuccess | ParseFailure;

const SECTION_TYPES: SectionType[] = ['prep', 'execution', 'combined'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((s) => s.trim()) : [];

/** Accepts a finite number or null/undefined; anything else is invalid. */
const readNullableNumber = (
  v: unknown,
  path: string,
  errors: string[],
  opts: { min?: number } = {},
): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errors.push(`${path} must be a number or null (got ${JSON.stringify(v)}).`);
    return null;
  }
  if (opts.min !== undefined && v < opts.min) {
    errors.push(`${path} must be >= ${opts.min} (got ${v}).`);
    return null;
  }
  return v;
};

const readNutritionLink = (v: unknown): NutritionLink => {
  if (!isObject(v)) return { ...UNLINKED_NUTRITION };
  const status = v.status === 'linked' || v.status === 'likely' ? v.status : 'unlinked';
  const confidence =
    typeof v.matchConfidence === 'number' && Number.isFinite(v.matchConfidence)
      ? Math.min(1, Math.max(0, v.matchConfidence))
      : null;
  return {
    status,
    foodItemId: typeof v.foodItemId === 'string' && v.foodItemId ? v.foodItemId : null,
    matchedName: typeof v.matchedName === 'string' && v.matchedName ? v.matchedName : null,
    matchConfidence: confidence,
    needsUserReview: typeof v.needsUserReview === 'boolean' ? v.needsUserReview : status !== 'linked',
  };
};

const readSections = (
  raw: unknown,
  errors: string[],
  warnings: string[],
): RecipeSection[] => {
  if (!Array.isArray(raw)) {
    errors.push('sections is required and must be a non-empty array.');
    return [];
  }
  if (raw.length === 0) {
    errors.push('sections must contain at least one workflow section.');
    return [];
  }
  const seenIds = new Set<string>();
  const sections: RecipeSection[] = [];
  raw.forEach((entry, i) => {
    const path = `sections[${i}]`;
    if (!isObject(entry)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    const id = asString(entry.id);
    if (!id) {
      errors.push(`${path}.id is missing — every section needs a unique string id.`);
      return;
    }
    if (seenIds.has(id)) {
      errors.push(`${path}.id "${id}" is a duplicate section id.`);
      return;
    }
    seenIds.add(id);
    const name = asString(entry.name);
    if (!name) errors.push(`${path}.name is missing.`);
    let type = asString(entry.type) as SectionType;
    if (!SECTION_TYPES.includes(type)) {
      warnings.push(`${path}.type "${asString(entry.type) || '(empty)'}" is not prep/execution/combined — treated as "combined".`);
      type = 'combined';
    }
    let order = readNullableNumber(entry.order, `${path}.order`, errors);
    if (order === null) {
      order = i + 1;
    }
    sections.push({
      id,
      name,
      type,
      purpose: asString(entry.purpose),
      order,
      dependsOn: asStringArray(entry.dependsOn),
      equipment: asStringArray(entry.equipment),
      notes: asString(entry.notes),
    });
  });
  return sections;
};

const readIngredients = (
  raw: unknown,
  sectionIds: Set<string>,
  errors: string[],
  warnings: string[],
): RecipeIngredient[] => {
  if (!Array.isArray(raw)) {
    errors.push('ingredients is required and must be a non-empty array.');
    return [];
  }
  if (raw.length === 0) {
    errors.push('ingredients must contain at least one ingredient.');
    return [];
  }
  const seenIds = new Set<string>();
  const ingredients: RecipeIngredient[] = [];
  raw.forEach((entry, i) => {
    const path = `ingredients[${i}]`;
    if (!isObject(entry)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    const id = asString(entry.id);
    if (!id) {
      errors.push(`${path}.id is missing — every ingredient needs a unique string id.`);
      return;
    }
    if (seenIds.has(id)) {
      errors.push(`${path}.id "${id}" is a duplicate ingredient id.`);
      return;
    }
    seenIds.add(id);
    const displayName = asString(entry.displayName);
    if (!displayName) errors.push(`${path}.displayName is missing.`);

    const quantityG = readNullableNumber(entry.quantityG, `${path}.quantityG`, errors, { min: 0 });
    if (quantityG === null && (entry.quantityG === null || entry.quantityG === undefined)) {
      warnings.push(`${path} ("${displayName || id}") has no gram weight — it will display without a quantity and be excluded from weight-based scaling math.`);
    }

    const sectionRefs = asStringArray(entry.sectionIds);
    sectionRefs.forEach((ref) => {
      if (!sectionIds.has(ref)) {
        errors.push(`${path}.sectionIds references "${ref}" which does not match any sections[].id.`);
      }
    });

    let primarySectionId = asString(entry.primarySectionId);
    if (primarySectionId && !sectionIds.has(primarySectionId)) {
      errors.push(`${path}.primarySectionId "${primarySectionId}" does not match any sections[].id.`);
      primarySectionId = '';
    }
    if (!primarySectionId && sectionRefs.length > 0) {
      primarySectionId = sectionRefs[0];
    }

    ingredients.push({
      id,
      displayName,
      quantityG,
      equivalent: asString(entry.equivalent),
      prepNote: asString(entry.prepNote),
      sectionIds: sectionRefs,
      primarySectionId,
      groceryCategory: asString(entry.groceryCategory),
      optional: entry.optional === true,
      substitutionNotes: asString(entry.substitutionNotes),
      conversionNotes: asString(entry.conversionNotes),
      nutritionLink: readNutritionLink(entry.nutritionLink),
    });
  });
  return ingredients;
};

const readSteps = (
  raw: unknown,
  field: 'prepSteps' | 'activeSteps',
  sectionIds: Set<string>,
  ingredientIds: Set<string>,
  errors: string[],
  warnings: string[],
): RecipeStep[] => {
  if (raw === undefined || raw === null) {
    warnings.push(`${field} is missing — treated as an empty list.`);
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push(`${field} must be an array.`);
    return [];
  }
  const steps: RecipeStep[] = [];
  raw.forEach((entry, i) => {
    const path = `${field}[${i}]`;
    if (!isObject(entry)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    const text = asString(entry.text);
    if (!text) errors.push(`${path}.text is missing.`);
    const sectionId = asString(entry.sectionId);
    if (!sectionId) {
      errors.push(`${path}.sectionId is missing — every step must belong to a section.`);
    } else if (!sectionIds.has(sectionId)) {
      errors.push(`${path}.sectionId "${sectionId}" does not match any sections[].id.`);
    }
    const ingredientRefs = asStringArray(entry.ingredientRefs);
    ingredientRefs.forEach((ref) => {
      if (!ingredientIds.has(ref)) {
        errors.push(`${path}.ingredientRefs references "${ref}" which does not match any ingredients[].id.`);
      }
    });
    let order = readNullableNumber(entry.order, `${path}.order`, errors);
    if (order === null) order = i + 1;
    steps.push({
      id: asString(entry.id) || `${field}-${i + 1}`,
      sectionId,
      text,
      ingredientRefs,
      equipment: asStringArray(entry.equipment),
      timing: asString(entry.timing),
      temperature: asString(entry.temperature),
      visualCue: asString(entry.visualCue),
      dependencyNote: asString(entry.dependencyNote),
      order,
    });
  });
  return steps;
};

/** Validate + normalize pasted recipe JSON. Pure; never throws. */
export const parseRecipeJson = (rawText: string): ParseResult => {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { ok: false, errors: ['Paste the JSON output from the ChatGPT conversion prompt first.'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [
        `Invalid JSON: ${message}.`,
        'Make sure you pasted the complete JSON object only — no markdown fences, commentary, or trailing text.',
      ],
    };
  }

  if (!isObject(parsed)) {
    return { ok: false, errors: ['The pasted JSON must be a single object (starting with "{").'] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== RECIPE_SCHEMA_VERSION) {
    warnings.push(`schemaVersion ${JSON.stringify(parsed.schemaVersion)} is not ${RECIPE_SCHEMA_VERSION} — imported as version ${RECIPE_SCHEMA_VERSION} anyway.`);
  }

  const name = asString(parsed.name);
  if (!name) errors.push('name is missing — the recipe needs a name.');

  const sections = readSections(parsed.sections, errors, warnings);
  const sectionIds = new Set(sections.map((s) => s.id));

  sections.forEach((section, i) => {
    section.dependsOn.forEach((dep) => {
      if (!sectionIds.has(dep)) {
        errors.push(`sections[${i}].dependsOn references "${dep}" which does not match any sections[].id.`);
      }
    });
  });

  const ingredients = readIngredients(parsed.ingredients, sectionIds, errors, warnings);
  const ingredientIds = new Set(ingredients.map((ing) => ing.id));

  const prepSteps = readSteps(parsed.prepSteps, 'prepSteps', sectionIds, ingredientIds, errors, warnings);
  const activeSteps = readSteps(parsed.activeSteps, 'activeSteps', sectionIds, ingredientIds, errors, warnings);

  const source = isObject(parsed.source) ? parsed.source : {};
  const servingsRaw = isObject(parsed.servings) ? parsed.servings : {};
  const yieldRaw = isObject(parsed.yield) ? parsed.yield : {};

  const servings = {
    baselineServings: readNullableNumber(servingsRaw.baselineServings, 'servings.baselineServings', errors, { min: 0 }),
    currentServings: readNullableNumber(servingsRaw.currentServings, 'servings.currentServings', errors, { min: 0 }),
    portionCount: readNullableNumber(servingsRaw.portionCount, 'servings.portionCount', errors, { min: 0 }),
    portionSizeG: readNullableNumber(servingsRaw.portionSizeG, 'servings.portionSizeG', errors, { min: 0 }),
  };

  const recipeYield = {
    estimatedFinalWeightG: readNullableNumber(yieldRaw.estimatedFinalWeightG, 'yield.estimatedFinalWeightG', errors, { min: 0 }),
    actualFinalWeightG: readNullableNumber(yieldRaw.actualFinalWeightG, 'yield.actualFinalWeightG', errors, { min: 0 }),
    yieldNotes: asString(yieldRaw.yieldNotes),
  };

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const recipe: Recipe = {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    name,
    source: {
      type: asString(source.type),
      url: asString(source.url),
      notes: asString(source.notes),
    },
    servings,
    yield: recipeYield,
    sections: [...sections].sort((a, b) => a.order - b.order),
    ingredients,
    prepSteps: [...prepSteps].sort((a, b) => a.order - b.order),
    activeSteps: [...activeSteps].sort((a, b) => a.order - b.order),
    notes: asStringArray(parsed.notes),
  };

  return { ok: true, recipe, warnings };
};
