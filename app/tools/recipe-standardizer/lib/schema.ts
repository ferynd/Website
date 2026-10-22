/* --- CONFIGURATION: none --- */
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
 * - Baked-equivalent annotations are additive; missing values normalize to null.
 * - Nutrition export back-references are additive; missing values normalize to an empty map and unreadable refs warn.
 * - Nutrition links are additive: old linked/likely values become candidates;
 *   confirmation fields default to null and nothing is written on load.
 * - v2 parses strictly, including the structural workflow validation in
 *   lib/workflowValidate.ts.
 * - Unknown future versions are not silently treated as compatible: they
 *   parse best-effort and, when the required fields validate, return an
 *   actionable warning; otherwise the normal exact-path errors surface.
 */

const MESSAGE_COPY = {
  isInvalidTheEquivalentMayNot: (value0: unknown) =>
    `${value0} is invalid — the equivalent may not match the current grams; ` +
    `check it.`,
  mustBeANumberOrNull: (value0: unknown, value1: unknown) =>
    `${value0} must be a number or null (got ${value1}).`,
  mustBeGot: (value0: unknown, value1: unknown, value2: unknown) =>
    `${value0} must be >= ${value1} (got ${value2}).`,
  mustBeAnObjectWithA: (value0: unknown) => `${value0} must be an object with a "when" field.`,
  waitentryidIsMissingDuringWaitPrep: (value0: unknown) =>
    `${value0}.waitEntryId is missing — during-wait prep must name the ` +
    `wait timeline entry.`,
  sectionidIsMissingAfterSectionPrep: (value0: unknown) =>
    `${value0}.sectionId is missing — after-section prep must name the ` +
    `section.`,
  beforestepidIsMissingJustInTime: (value0: unknown) =>
    `${value0}.beforeStepId is missing — just-in-time prep must identify ` +
    `the step it precedes.`,
  whenIsNotStartDuringWait: (value0: unknown, value1: unknown) =>
    `${value0}.when "${value1}" is not start/during-wait/after-section/just-in-time ` +
    `— treated as "start".`,
  prepgroupsMustBeAnArray: 'prepGroups must be an array.',
  mustBeAnObject: (value0: unknown) => `${value0} must be an object.`,
  idIsMissingEveryPrepGroup: (value0: unknown) =>
    `${value0}.id is missing — every prep group needs a unique string id.`,
  nameIsMissing: (value0: unknown) => `${value0}.name is missing.`,
  mustBeAnObjectWithId: (value0: unknown) => `${value0} must be an object with id and name, or null.`,
  needsBothAStableIdAnd: (value0: unknown) =>
    `${value0} needs both a stable id and a name (e.g. "crust mixture").`,
  mustBeAnArray: (value0: unknown) => `${value0} must be an array.`,
  mustBeAnObjectWithKind: (value0: unknown) => `${value0} must be an object with kind and id.`,
  kindMustBeSectionStepPrepgroup: (value0: unknown, value1: unknown) =>
    `${value0}.kind must be section/step/prepGroup (got ${value1}).`,
  idIsMissing: (value0: unknown) => `${value0}.id is missing.`,
  timelineMustBeAnArray: 'timeline must be an array.',
  idIsMissingEveryTimelineEntry: (value0: unknown) =>
    `${value0}.id is missing — every timeline entry needs a unique string ` +
    `id.`,
  kindIsNotPrepExecutionWait: (value0: unknown, value1: unknown) =>
    `${value0}.kind "${value1}" is not prep/execution/wait/serve — treated ` +
    `as "execution".`,
  alternativesMustBeAnObject: (value0: unknown, value1: unknown) =>
    `${value0}.alternatives[${value1}] must be an object.`,
  techniqueoverridesMustBeAnArray: 'techniqueOverrides must be an array.',
  needsIdNameAndHelp: (value0: unknown) => `${value0} needs id, name, and help.`,
  sectionsIsRequiredAndMustBe: 'sections is required and must be a non-empty array.',
  sectionsMustContainAtLeastOne: 'sections must contain at least one workflow section.',
  idIsMissingEverySectionNeeds: (value0: unknown) =>
    `${value0}.id is missing — every section needs a unique string id.`,
  idIsADuplicateSectionId: (value0: unknown, value1: unknown) =>
    `${value0}.id "${value1}" is a duplicate section id.`,
  typeIsNotPrepExecutionCombined: (value0: unknown, value1: unknown) =>
    `${value0}.type "${value1}" is not prep/execution/combined — treated ` +
    `as "combined".`,
  ingredientsIsRequiredAndMustBe: 'ingredients is required and must be a non-empty array.',
  ingredientsMustContainAtLeastOne: 'ingredients must contain at least one ingredient.',
  idIsMissingEveryIngredientNeeds: (value0: unknown) =>
    `${value0}.id is missing — every ingredient needs a unique string id.`,
  idIsADuplicateIngredientId: (value0: unknown, value1: unknown) =>
    `${value0}.id "${value1}" is a duplicate ingredient id.`,
  displaynameIsMissing: (value0: unknown) => `${value0}.displayName is missing.`,
  hasNoGramWeightItWill: (value0: unknown, value1: unknown) =>
    `${value0} ("${value1}") has no gram weight — it will display without ` +
    `a quantity and be excluded from weight-based scaling math.`,
  sectionidsReferencesWhichDoesNotMatch: (value0: unknown, value1: unknown) =>
    `${value0}.sectionIds references "${value1}" which does not match any ` +
    `sections[].id.`,
  primarysectionidDoesNotMatchAnySections: (value0: unknown, value1: unknown) =>
    `${value0}.primarySectionId "${value1}" does not match any sections[].id.`,
  primarysectionidWasNotListedInSectionids: (value0: unknown, value1: unknown) =>
    `${value0}.primarySectionId "${value1}" was not listed in sectionIds ` +
    `— added it.`,
  isMissingTreatedAsAnEmpty: (value0: unknown) => `${value0} is missing — treated as an empty list.`,
  idIsADuplicateIdEvery: (value0: unknown, value1: unknown, value2: unknown) =>
    `${value0}.id "${value1}" is a duplicate ${value2} id — every step ` +
    `needs a unique id.`,
  textIsMissing: (value0: unknown) => `${value0}.text is missing.`,
  sectionidIsMissingEveryStepMust: (value0: unknown) =>
    `${value0}.sectionId is missing — every step must belong to a section.`,
  sectionidDoesNotMatchAnySections: (value0: unknown, value1: unknown) =>
    `${value0}.sectionId "${value1}" does not match any sections[].id.`,
  ingredientrefsReferencesWhichDoesNotMatch: (value0: unknown, value1: unknown) =>
    `${value0}.ingredientRefs references "${value1}" which does not match ` +
    `any ingredients[].id.`,
  schemaversionIsNewerThanThisTool: (value0: unknown, value1: unknown) =>
    `schemaVersion ${value0} is newer than this tool supports (${value1}) ` +
    `— imported best-effort; unrecognized data may be ignored.`,
  nameIsMissingTheRecipeNeeds: 'name is missing — the recipe needs a name.',
  sectionsDependsonReferencesWhichDoesNot: (value0: unknown, value1: unknown) =>
    `sections[${value0}].dependsOn references "${value1}" which does not ` +
    `match any sections[].id.`,
  unknownTechniqueIdSNotIn: (value0: unknown) =>
    `Unknown technique id(s) ${value0} — not in the site glossary or this ` +
    `recipe's overrides; their help will not display.`,
} as const;

import { FACTOR_ONE_EPSILON } from './scaling';
import { findUnknownTechniqueIds } from './techniques';
import { parseNutritionLink } from './nutritionLink';
import { parseNutritionExports } from './nutritionExportRef';
import {
  RECIPE_SCHEMA_VERSION,
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

/** Parse success contract. */
export interface ParseSuccess {
  ok: true;
  recipe: Recipe;
  warnings: string[];
}

/** Parse failure contract. */
export interface ParseFailure {
  ok: false;
  errors: string[];
}

/** Parse result contract. */
export type ParseResult = ParseSuccess | ParseFailure;

const SECTION_TYPES: SectionType[] = ['prep', 'execution', 'combined'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((s) => s.trim()) : [];

/** Default additive bake provenance; invalid annotations warn instead of blocking a legacy load. */
const readEquivalentBakeFactor = (
  value: unknown,
  equivalent: string,
  path: string,
  warnings: string[],
): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    warnings.push(MESSAGE_COPY.isInvalidTheEquivalentMayNot(path));
    return null;
  }
  if (equivalent === '' || Math.abs(value - 1) < FACTOR_ONE_EPSILON) return null;
  return value;
};

/** Accept a finite number or null/undefined; reject invalid values with an exact-path error. */
const readNullableNumber = (
  v: unknown,
  path: string,
  errors: string[],
  opts: {
    min?: number;
  } = {},
): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errors.push(MESSAGE_COPY.mustBeANumberOrNull(path, JSON.stringify(v)));
    return null;
  }
  if (opts.min !== undefined && v < opts.min) {
    errors.push(MESSAGE_COPY.mustBeGot(path, opts.min, v));
    return null;
  }
  return v;
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
    errors.push(MESSAGE_COPY.mustBeAnObjectWithA(path));
    return fallback;
  }
  const note = asString(v.note);
  const when = asString(v.when);
  if (when === 'start') return { when: 'start', note };
  if (when === 'during-wait') {
    const waitEntryId = asString(v.waitEntryId);
    if (!waitEntryId) {
      errors.push(MESSAGE_COPY.waitentryidIsMissingDuringWaitPrep(path));
      return fallback;
    }
    return {
      when: 'during-wait',
      waitEntryId,
      note,
    };
  }
  if (when === 'after-section') {
    const sectionId = asString(v.sectionId);
    if (!sectionId) {
      errors.push(MESSAGE_COPY.sectionidIsMissingAfterSectionPrep(path));
      return fallback;
    }
    return {
      when: 'after-section',
      sectionId,
      note,
    };
  }
  if (when === 'just-in-time') {
    const beforeStepId = asString(v.beforeStepId);
    if (!beforeStepId) {
      errors.push(MESSAGE_COPY.beforestepidIsMissingJustInTime(path));
      return fallback;
    }
    return {
      when: 'just-in-time',
      beforeStepId,
      note,
    };
  }
  warnings.push(MESSAGE_COPY.whenIsNotStartDuringWait(path, when || '(empty)'));
  return { when: 'start', note };
};

const readPrepGroups = (
  raw: unknown,
  errors: string[],
  warnings: string[],
): PrepGroup[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push(MESSAGE_COPY.prepgroupsMustBeAnArray);
    return [];
  }
  const groups: PrepGroup[] = [];
  raw.forEach((entry, i) => {
    const path = `prepGroups[${i}]`;
    if (!isObject(entry)) {
      errors.push(MESSAGE_COPY.mustBeAnObject(path));
      return;
    }
    const id = asString(entry.id);
    if (!id) {
      errors.push(MESSAGE_COPY.idIsMissingEveryPrepGroup(path));
      return;
    }
    const name = asString(entry.name);
    if (!name) errors.push(MESSAGE_COPY.nameIsMissing(path));
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
    errors.push(MESSAGE_COPY.mustBeAnObjectWithId(path));
    return null;
  }
  const id = asString(v.id);
  const name = asString(v.name);
  if (!id || !name) {
    errors.push(MESSAGE_COPY.needsBothAStableIdAnd(path));
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
    errors.push(MESSAGE_COPY.mustBeAnArray(path));
    return [];
  }
  const refs: WorkflowReference[] = [];
  raw.forEach((entry, i) => {
    const refPath = `${path}[${i}]`;
    if (!isObject(entry)) {
      errors.push(MESSAGE_COPY.mustBeAnObjectWithKind(refPath));
      return;
    }
    const kind = asString(entry.kind) as WorkflowReference['kind'];
    const id = asString(entry.id);
    if (!REFERENCE_KINDS.includes(kind)) {
      errors.push(MESSAGE_COPY.kindMustBeSectionStepPrepgroup(refPath, JSON.stringify(entry.kind)));
      return;
    }
    if (!id) {
      errors.push(MESSAGE_COPY.idIsMissing(refPath));
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
    errors.push(MESSAGE_COPY.timelineMustBeAnArray);
    return [];
  }
  const entries: TimelineEntry[] = [];
  raw.forEach((entry, i) => {
    const path = `timeline[${i}]`;
    if (!isObject(entry)) {
      errors.push(MESSAGE_COPY.mustBeAnObject(path));
      return;
    }
    const id = asString(entry.id);
    if (!id) {
      errors.push(MESSAGE_COPY.idIsMissingEveryTimelineEntry(path));
      return;
    }
    let kind = asString(entry.kind) as TimelineKind;
    if (!TIMELINE_KINDS.includes(kind)) {
      warnings.push(MESSAGE_COPY.kindIsNotPrepExecutionWait(path, asString(entry.kind) || '(empty)'));
      kind = 'execution';
    }
    const alternatives: TimelineAlternative[] = [];
    if (Array.isArray(entry.alternatives)) {
      entry.alternatives.forEach((alt, j) => {
        if (!isObject(alt)) {
          errors.push(MESSAGE_COPY.alternativesMustBeAnObject(path, j));
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
    errors.push(MESSAGE_COPY.techniqueoverridesMustBeAnArray);
    return [];
  }
  const overrides: TechniqueOverride[] = [];
  raw.forEach((entry, i) => {
    const path = `techniqueOverrides[${i}]`;
    if (!isObject(entry)) {
      errors.push(MESSAGE_COPY.mustBeAnObject(path));
      return;
    }
    const id = asString(entry.id);
    const name = asString(entry.name);
    const help = asString(entry.help);
    if (!id || !name || !help) {
      errors.push(MESSAGE_COPY.needsIdNameAndHelp(path));
      return;
    }
    overrides.push({
      id,
      name,
      help,
    });
  });
  return overrides;
};

const readSections = (
  raw: unknown,
  errors: string[],
  warnings: string[],
): RecipeSection[] => {
  if (!Array.isArray(raw)) {
    errors.push(MESSAGE_COPY.sectionsIsRequiredAndMustBe);
    return [];
  }
  if (raw.length === 0) {
    errors.push(MESSAGE_COPY.sectionsMustContainAtLeastOne);
    return [];
  }
  const seenIds = new Set<string>();
  const sections: RecipeSection[] = [];
  raw.forEach((entry, i) => {
    const path = `sections[${i}]`;
    if (!isObject(entry)) {
      errors.push(MESSAGE_COPY.mustBeAnObject(path));
      return;
    }
    const id = asString(entry.id);
    if (!id) {
      errors.push(MESSAGE_COPY.idIsMissingEverySectionNeeds(path));
      return;
    }
    if (seenIds.has(id)) {
      errors.push(MESSAGE_COPY.idIsADuplicateSectionId(path, id));
      return;
    }
    seenIds.add(id);
    const name = asString(entry.name);
    if (!name) errors.push(MESSAGE_COPY.nameIsMissing(path));
    let type = asString(entry.type) as SectionType;
    if (!SECTION_TYPES.includes(type)) {
      warnings.push(MESSAGE_COPY.typeIsNotPrepExecutionCombined(path, asString(entry.type) || '(empty)'));
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
    errors.push(MESSAGE_COPY.ingredientsIsRequiredAndMustBe);
    return [];
  }
  if (raw.length === 0) {
    errors.push(MESSAGE_COPY.ingredientsMustContainAtLeastOne);
    return [];
  }
  const seenIds = new Set<string>();
  const ingredients: RecipeIngredient[] = [];
  raw.forEach((entry, i) => {
    const path = `ingredients[${i}]`;
    if (!isObject(entry)) {
      errors.push(MESSAGE_COPY.mustBeAnObject(path));
      return;
    }
    const id = asString(entry.id);
    if (!id) {
      errors.push(MESSAGE_COPY.idIsMissingEveryIngredientNeeds(path));
      return;
    }
    if (seenIds.has(id)) {
      errors.push(MESSAGE_COPY.idIsADuplicateIngredientId(path, id));
      return;
    }
    seenIds.add(id);
    const displayName = asString(entry.displayName);
    if (!displayName) errors.push(MESSAGE_COPY.displaynameIsMissing(path));

    const quantityG = readNullableNumber(entry.quantityG, `${path}.quantityG`, errors, { min: 0 });
    if (quantityG === null && (entry.quantityG === null || entry.quantityG === undefined)) {
      warnings.push(MESSAGE_COPY.hasNoGramWeightItWill(path, displayName || id));
    }

    const sectionRefs = asStringArray(entry.sectionIds);
    sectionRefs.forEach((ref) => {
      if (!sectionIds.has(ref)) {
        errors.push(MESSAGE_COPY.sectionidsReferencesWhichDoesNotMatch(path, ref));
      }
    });

    let primarySectionId = asString(entry.primarySectionId);
    if (primarySectionId && !sectionIds.has(primarySectionId)) {
      errors.push(MESSAGE_COPY.primarysectionidDoesNotMatchAnySections(path, primarySectionId));
      primarySectionId = '';
    }
    if (!primarySectionId && sectionRefs.length > 0) {
      primarySectionId = sectionRefs[0];
    }
    // A valid primary section missing from sectionIds would make the workflow
    // grouping and the section cards contradict each other — normalize it in.
    if (primarySectionId && !sectionRefs.includes(primarySectionId)) {
      sectionRefs.push(primarySectionId);
      warnings.push(MESSAGE_COPY.primarysectionidWasNotListedInSectionids(path, primarySectionId));
    }

    ingredients.push({
      id,
      displayName,
      quantityG,
      equivalent: asString(entry.equivalent),
      equivalentBakeFactor: readEquivalentBakeFactor(
        entry.equivalentBakeFactor,
        asString(entry.equivalent),
        `${path}.equivalentBakeFactor`,
        warnings,
      ),
      prepNote: asString(entry.prepNote),
      sectionIds: sectionRefs,
      primarySectionId,
      groceryCategory: asString(entry.groceryCategory),
      optional: entry.optional === true,
      substitutionNotes: asString(entry.substitutionNotes),
      conversionNotes: asString(entry.conversionNotes),
      nutritionLink: parseNutritionLink(entry.nutritionLink, `${path}.nutritionLink`, warnings),
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
    warnings.push(MESSAGE_COPY.isMissingTreatedAsAnEmpty(field));
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push(MESSAGE_COPY.mustBeAnArray(field));
    return [];
  }
  const steps: RecipeStep[] = [];
  const seenIds = new Set<string>();
  raw.forEach((entry, i) => {
    const path = `${field}[${i}]`;
    if (!isObject(entry)) {
      errors.push(MESSAGE_COPY.mustBeAnObject(path));
      return;
    }
    // Step ids must be unique within the list: the rename review flow and
    // React keys address steps by (list, id), so duplicates would collide.
    const id = asString(entry.id) || `${field}-${i + 1}`;
    if (seenIds.has(id)) {
      errors.push(MESSAGE_COPY.idIsADuplicateIdEvery(path, id, field));
      return;
    }
    seenIds.add(id);
    const text = asString(entry.text);
    if (!text) errors.push(MESSAGE_COPY.textIsMissing(path));
    const sectionId = asString(entry.sectionId);
    if (!sectionId) {
      errors.push(MESSAGE_COPY.sectionidIsMissingEveryStepMust(path));
    } else if (!sectionIds.has(sectionId)) {
      errors.push(MESSAGE_COPY.sectionidDoesNotMatchAnySections(path, sectionId));
    }
    const ingredientRefs = asStringArray(entry.ingredientRefs);
    ingredientRefs.forEach((ref) => {
      if (!ingredientIds.has(ref)) {
        errors.push(MESSAGE_COPY.ingredientrefsReferencesWhichDoesNotMatch(path, ref));
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
      MESSAGE_COPY.schemaversionIsNewerThanThisTool(JSON.stringify(version), RECIPE_SCHEMA_VERSION),
    );
  }

  const name = asString(parsed.name);
  if (!name) errors.push(MESSAGE_COPY.nameIsMissingTheRecipeNeeds);

  const sections = readSections(parsed.sections, errors, warnings);
  const sectionIds = new Set(sections.map((s) => s.id));

  sections.forEach((section, i) => {
    section.dependsOn.forEach((dep) => {
      if (!sectionIds.has(dep)) {
        errors.push(MESSAGE_COPY.sectionsDependsonReferencesWhichDoesNot(i, dep));
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
    nutritionExports: parseNutritionExports(parsed.nutritionExports, warnings),
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
      MESSAGE_COPY.unknownTechniqueIdSNotIn(unknownTechniques.map((id) => `"${id}"`).join(', ')),
    );
  }

  return {
    ok: true,
    recipe,
    warnings,
  };
};
