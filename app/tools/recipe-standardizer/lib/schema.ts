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
 *
 * Schema versions:
 * - v1 (saved recipes from before the workflow model) parses silently
 *   through an explicit compatibility path — every v2 field defaults, no
 *   per-load warning, and nothing is written back to Firestore just because
 *   it was loaded. A v1 recipe becomes a saved v2 recipe only when the user
 *   explicitly saves an edit or a new copy.
 * - v2 parses strictly, including the structural workflow validation in
 *   lib/workflowValidate.ts.
 * - Unknown future versions are not silently treated as compatible: they
 *   parse best-effort and, when the required fields validate, return an
 *   actionable warning; otherwise the normal exact-path errors surface.
 */

import { findUnknownTechniqueIds } from './techniques';
import {
  RECIPE_SCHEMA_VERSION,
  UNLINKED_NUTRITION,
  type NutritionLink,
  type PrepGroup,
  type PrepTiming,
  type Recipe,
  type RecipeIngredient,
  type RecipeSection,
  type RecipeStep,
  type SectionType,
  type StepResult,
  type TechniqueOverride,
  type TimelineAlternative,
  type TimelineEntry,
  type TimelineKind,
  type WorkflowReference,
} from './types';
import { validateWorkflow } from './workflowValidate';

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

const TIMELINE_KINDS: TimelineKind[] = ['prep', 'execution', 'wait', 'serve'];
const REFERENCE_KINDS = ['section', 'step', 'prepGroup'] as const;

const readPrepTiming = (
  v: unknown,
  path: string,
  errors: string[],
  warnings: string[],
): PrepTiming => {
  const fallback: PrepTiming = { when: 'start', note: '' };
  if (v === undefined || v === null) return fallback;
  if (!isObject(v)) {
    errors.push(`${path} must be an object with a "when" field.`);
    return fallback;
  }
  const note = asString(v.note);
  const when = asString(v.when);
  if (when === 'start') return { when: 'start', note };
  if (when === 'during-wait') {
    const waitEntryId = asString(v.waitEntryId);
    if (!waitEntryId) {
      errors.push(`${path}.waitEntryId is missing — during-wait prep must name the wait timeline entry.`);
      return fallback;
    }
    return { when: 'during-wait', waitEntryId, note };
  }
  if (when === 'after-section') {
    const sectionId = asString(v.sectionId);
    if (!sectionId) {
      errors.push(`${path}.sectionId is missing — after-section prep must name the section.`);
      return fallback;
    }
    return { when: 'after-section', sectionId, note };
  }
  if (when === 'just-in-time') {
    const beforeStepId = asString(v.beforeStepId);
    if (!beforeStepId) {
      errors.push(`${path}.beforeStepId is missing — just-in-time prep must identify the step it precedes.`);
      return fallback;
    }
    return { when: 'just-in-time', beforeStepId, note };
  }
  warnings.push(`${path}.when "${when || '(empty)'}" is not start/during-wait/after-section/just-in-time — treated as "start".`);
  return { when: 'start', note };
};

const readPrepGroups = (
  raw: unknown,
  errors: string[],
  warnings: string[],
): PrepGroup[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push('prepGroups must be an array.');
    return [];
  }
  const groups: PrepGroup[] = [];
  raw.forEach((entry, i) => {
    const path = `prepGroups[${i}]`;
    if (!isObject(entry)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    const id = asString(entry.id);
    if (!id) {
      errors.push(`${path}.id is missing — every prep group needs a unique string id.`);
      return;
    }
    const name = asString(entry.name);
    if (!name) errors.push(`${path}.name is missing.`);
    groups.push({
      id,
      name,
      ingredientIds: asStringArray(entry.ingredientIds),
      destination: asString(entry.destination),
      instruction: asString(entry.instruction),
      timing: readPrepTiming(entry.timing, `${path}.timing`, errors, warnings),
      firstUseStepId: asString(entry.firstUseStepId),
      holdNote: asString(entry.holdNote),
      details: asString(entry.details),
      techniqueIds: asStringArray(entry.techniqueIds),
    });
  });
  return groups;
};

const readStepResult = (v: unknown, path: string, errors: string[]): StepResult | null => {
  if (v === undefined || v === null) return null;
  if (!isObject(v)) {
    errors.push(`${path} must be an object with id and name, or null.`);
    return null;
  }
  const id = asString(v.id);
  const name = asString(v.name);
  if (!id || !name) {
    errors.push(`${path} needs both a stable id and a name (e.g. "crust mixture").`);
    return null;
  }
  return { id, name };
};

const readWorkflowReferences = (
  raw: unknown,
  path: string,
  errors: string[],
): WorkflowReference[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push(`${path} must be an array.`);
    return [];
  }
  const refs: WorkflowReference[] = [];
  raw.forEach((entry, i) => {
    const refPath = `${path}[${i}]`;
    if (!isObject(entry)) {
      errors.push(`${refPath} must be an object with kind and id.`);
      return;
    }
    const kind = asString(entry.kind) as WorkflowReference['kind'];
    const id = asString(entry.id);
    if (!REFERENCE_KINDS.includes(kind)) {
      errors.push(`${refPath}.kind must be section/step/prepGroup (got ${JSON.stringify(entry.kind)}).`);
      return;
    }
    if (!id) {
      errors.push(`${refPath}.id is missing.`);
      return;
    }
    refs.push({ kind, id });
  });
  return refs;
};

const readTimeline = (
  raw: unknown,
  errors: string[],
  warnings: string[],
): TimelineEntry[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push('timeline must be an array.');
    return [];
  }
  const entries: TimelineEntry[] = [];
  raw.forEach((entry, i) => {
    const path = `timeline[${i}]`;
    if (!isObject(entry)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    const id = asString(entry.id);
    if (!id) {
      errors.push(`${path}.id is missing — every timeline entry needs a unique string id.`);
      return;
    }
    let kind = asString(entry.kind) as TimelineKind;
    if (!TIMELINE_KINDS.includes(kind)) {
      warnings.push(`${path}.kind "${asString(entry.kind) || '(empty)'}" is not prep/execution/wait/serve — treated as "execution".`);
      kind = 'execution';
    }
    const alternatives: TimelineAlternative[] = [];
    if (Array.isArray(entry.alternatives)) {
      entry.alternatives.forEach((alt, j) => {
        if (!isObject(alt)) {
          errors.push(`${path}.alternatives[${j}] must be an object.`);
          return;
        }
        alternatives.push({
          label: asString(alt.label),
          activeTime: asString(alt.activeTime),
          passiveTime: asString(alt.passiveTime),
          note: asString(alt.note),
        });
      });
    }
    let order = readNullableNumber(entry.order, `${path}.order`, errors);
    if (order === null) order = i + 1;
    entries.push({
      id,
      kind,
      phaseLabel: asString(entry.phaseLabel),
      references: readWorkflowReferences(entry.references, `${path}.references`, errors),
      titleOverride: asString(entry.titleOverride),
      activeTime: asString(entry.activeTime),
      passiveTime: asString(entry.passiveTime),
      duringEntryId: asString(entry.duringEntryId),
      alternatives,
      order,
    });
  });
  return entries;
};

const readTechniqueOverrides = (
  raw: unknown,
  errors: string[],
): TechniqueOverride[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push('techniqueOverrides must be an array.');
    return [];
  }
  const overrides: TechniqueOverride[] = [];
  raw.forEach((entry, i) => {
    const path = `techniqueOverrides[${i}]`;
    if (!isObject(entry)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    const id = asString(entry.id);
    const name = asString(entry.name);
    const help = asString(entry.help);
    if (!id || !name || !help) {
      errors.push(`${path} needs id, name, and help.`);
      return;
    }
    overrides.push({ id, name, help });
  });
  return overrides;
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
    // A valid primary section missing from sectionIds would make the workflow
    // grouping and the section cards contradict each other — normalize it in.
    if (primarySectionId && !sectionRefs.includes(primarySectionId)) {
      sectionRefs.push(primarySectionId);
      warnings.push(`${path}.primarySectionId "${primarySectionId}" was not listed in sectionIds — added it.`);
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
  const seenIds = new Set<string>();
  raw.forEach((entry, i) => {
    const path = `${field}[${i}]`;
    if (!isObject(entry)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    // Step ids must be unique within the list: the rename review flow and
    // React keys address steps by (list, id), so duplicates would collide.
    const id = asString(entry.id) || `${field}-${i + 1}`;
    if (seenIds.has(id)) {
      errors.push(`${path}.id "${id}" is a duplicate ${field} id — every step needs a unique id.`);
      return;
    }
    seenIds.add(id);
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
      id,
      sectionId,
      text,
      ingredientRefs,
      equipment: asStringArray(entry.equipment),
      timing: asString(entry.timing),
      temperature: asString(entry.temperature),
      visualCue: asString(entry.visualCue),
      dependencyNote: asString(entry.dependencyNote),
      order,
      usesPrepGroupIds: asStringArray(entry.usesPrepGroupIds),
      usesResultIds: asStringArray(entry.usesResultIds),
      result: readStepResult(entry.result, `${path}.result`, errors),
      techniqueIds: asStringArray(entry.techniqueIds),
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

  // v1 is the known compatibility path and loads silently; the current
  // version (or an omitted version) is normal. Anything else is a future or
  // unknown schema — parse best-effort but say so, because unrecognized
  // fields will be ignored rather than round-tripped.
  const version = parsed.schemaVersion;
  if (version !== undefined && version !== 1 && version !== RECIPE_SCHEMA_VERSION) {
    warnings.push(
      `schemaVersion ${JSON.stringify(version)} is newer than this tool supports (${RECIPE_SCHEMA_VERSION}) — imported best-effort; unrecognized data may be ignored.`,
    );
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

  const prepGroups = readPrepGroups(parsed.prepGroups, errors, warnings);
  const timeline = readTimeline(parsed.timeline, errors, warnings);
  const techniqueOverrides = readTechniqueOverrides(parsed.techniqueOverrides, errors);

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
    prepGroups,
    timeline: [...timeline].sort((a, b) => a.order - b.order),
    techniqueOverrides,
    notes: asStringArray(parsed.notes),
  };

  // Structural workflow validation (references, chronology, cycles) runs on
  // the assembled recipe; a v1 recipe has no workflow data so it passes
  // trivially. Unknown technique ids warn — rendering skips them safely.
  const workflowCheck = validateWorkflow(recipe);
  if (workflowCheck.errors.length > 0) {
    return { ok: false, errors: workflowCheck.errors };
  }
  warnings.push(...workflowCheck.warnings);

  const allTechniqueIds = [
    ...recipe.prepGroups.flatMap((g) => g.techniqueIds),
    ...recipe.prepSteps.flatMap((s) => s.techniqueIds),
    ...recipe.activeSteps.flatMap((s) => s.techniqueIds),
  ];
  const unknownTechniques = [...new Set(findUnknownTechniqueIds(allTechniqueIds, recipe.techniqueOverrides))];
  if (unknownTechniques.length > 0) {
    warnings.push(
      `Unknown technique id(s) ${unknownTechniques.map((id) => `"${id}"`).join(', ')} — not in the site glossary or this recipe's overrides; their help will not display.`,
    );
  }

  return { ok: true, recipe, warnings };
};
