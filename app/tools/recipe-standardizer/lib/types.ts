/* ------------------------------------------------------------ */
/* CONFIGURATION: recipe schema version                          */
/* ------------------------------------------------------------ */
export const RECIPE_SCHEMA_VERSION = 2;

/**
 * Recipe Standardizer data model.
 *
 * Grams (`quantityG`) are the source of truth for every quantity; the
 * `equivalent` string is display-only secondary text ("2 cups", "3 cloves").
 * Steps reference ingredients by id (`ingredientRefs`) so ingredient edits
 * (rename, substitution) flow through every *structured* display — section
 * ingredient lists, step chips, shopping modes. Step `text` is free prose:
 * a rename triggers a review of affected steps (lib/stepTextUpdate.ts)
 * rather than a silent rewrite.
 *
 * Schema v2 adds the named-intermediate workflow model: prep groups (named
 * staged inputs with a destination, schedule, holding note, and exact first
 * use), named step results ("crust mixture") consumed by later steps, and a
 * structured timeline (prep/execution/wait/serve entries with active vs
 * passive time, overlap, and alternatives). Every cross-entity reference is
 * typed — the parser and validators always know what an id refers to.
 * Saved v1 recipes parse through an explicit compatibility path with all new
 * fields defaulted; lib/workflow.ts derives a conservative view model so old
 * recipes render through the same components.
 *
 * Nutrition integration: each ingredient carries a `nutritionLink` that can
 * point at a CalorieTracker saved food item
 * (`artifacts/default-app-id/users/{uid}/foodItems/{foodItemId}`). Only the
 * link is recorded (matched/likely/unlinked); computing recipe nutrition from
 * linked items is a documented follow-up.
 */

export type SectionType = 'prep' | 'execution' | 'combined';

export interface RecipeSection {
  id: string;
  name: string;
  type: SectionType;
  purpose: string;
  order: number;
  /** Section ids that must be completed before this one. */
  dependsOn: string[];
  equipment: string[];
  notes: string;
}

export type NutritionLinkStatus = 'linked' | 'likely' | 'unlinked';

export interface NutritionLink {
  status: NutritionLinkStatus;
  /** CalorieTracker foodItems doc id when linked/likely. */
  foodItemId: string | null;
  matchedName: string | null;
  /** 0..1 similarity score from the matcher. */
  matchConfidence: number | null;
  needsUserReview: boolean;
}

export const UNLINKED_NUTRITION: NutritionLink = {
  status: 'unlinked',
  foodItemId: null,
  matchedName: null,
  matchConfidence: null,
  needsUserReview: true,
};

export interface RecipeIngredient {
  id: string;
  displayName: string;
  /** Grams — source of truth for scaling. Null = unknown weight. */
  quantityG: number | null;
  /** Secondary human-friendly measure, e.g. "2 cups" or "1 large egg". */
  equivalent: string;
  prepNote: string;
  /** Every section this ingredient appears in. */
  sectionIds: string[];
  primarySectionId: string;
  groceryCategory: string;
  optional: boolean;
  substitutionNotes: string;
  conversionNotes: string;
  nutritionLink: NutritionLink;
}

/**
 * When a prep group should be prepared. A discriminated union so every
 * reference is unambiguous: `waitEntryId` → a `TimelineEntry` of kind
 * 'wait', `sectionId` → a section, `beforeStepId` → the step the
 * just-in-time prep must immediately precede.
 */
export type PrepTiming =
  | { when: 'start'; note: string }
  | { when: 'during-wait'; waitEntryId: string; note: string }
  | { when: 'after-section'; sectionId: string; note: string }
  | { when: 'just-in-time'; beforeStepId: string; note: string };

/**
 * A named staged input that exists before an execution step and can safely
 * wait until its first use — e.g. "crust ingredients in mixer bowl".
 * Ingredient references stay id-based for scaling/editing; the group name is
 * what execution steps display.
 */
export interface PrepGroup {
  id: string;
  name: string;
  ingredientIds: string[];
  /** Where staged ingredients go ("mixer bowl"); '' when not relevant. */
  destination: string;
  /** Concise prep instruction (measure/chop/steep/strain…). */
  instruction: string;
  timing: PrepTiming;
  /** The exact first execution step that consumes this group. */
  firstUseStepId: string;
  /** Holding/storage until use ("keep refrigerated until…"); '' when none. */
  holdNote: string;
  /** Optional compact extra detail, collapsed by default in the UI. */
  details: string;
  techniqueIds: string[];
}

/** A step's named output; result ids are distinct from step ids. */
export interface StepResult {
  id: string;
  name: string;
}

export interface RecipeStep {
  id: string;
  sectionId: string;
  text: string;
  ingredientRefs: string[];
  equipment: string[];
  timing: string;
  temperature: string;
  visualCue: string;
  dependencyNote: string;
  order: number;
  /** Prep groups this step consumes (PrepGroup.id). */
  usesPrepGroupIds: string[];
  /** Named results of prior steps this step consumes (StepResult.id). */
  usesResultIds: string[];
  /** This step's named result when a later step refers to it; null if none. */
  result: StepResult | null;
  techniqueIds: string[];
}

/** A typed pointer from a timeline entry to the entity it schedules. */
export type WorkflowReference =
  | { kind: 'section'; id: string }
  | { kind: 'step'; id: string }
  | { kind: 'prepGroup'; id: string };

/** An alternative timing path (e.g. room-temp thaw vs refrigerator thaw). */
export interface TimelineAlternative {
  label: string;
  activeTime: string;
  passiveTime: string;
  note: string;
}

export type TimelineKind = 'prep' | 'execution' | 'wait' | 'serve';

/**
 * One entry in the recommended workflow timeline. This is a navigation and
 * scheduling view — titles derive from the referenced prep group, section,
 * or step (`titleOverride` only when genuinely needed), so the timeline can
 * never drift into a second copy of the instructions.
 */
export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  /** Relative phase label ("Day before", "While the tart thaws"); '' ok. */
  phaseLabel: string;
  references: WorkflowReference[];
  /** '' normally — the UI derives the title from `references`. */
  titleOverride: string;
  /** Hands-on time ("15 min active"); '' when none. */
  activeTime: string;
  /** Waiting/elapsed time ("overnight", "4+ hours"); '' when none. */
  passiveTime: string;
  /** TimelineEntry.id of the wait this work overlaps; '' when none. */
  duringEntryId: string;
  alternatives: TimelineAlternative[];
  order: number;
}

/**
 * A compact recipe-specific technique override. Normal recipes only emit
 * technique ids from the site glossary (lib/techniques.ts); an override is
 * for genuinely unusual source-mandated handling.
 */
export interface TechniqueOverride {
  id: string;
  name: string;
  help: string;
}

export interface RecipeServings {
  baselineServings: number | null;
  currentServings: number | null;
  portionCount: number | null;
  portionSizeG: number | null;
}

export interface RecipeYield {
  estimatedFinalWeightG: number | null;
  actualFinalWeightG: number | null;
  yieldNotes: string;
}

export interface Recipe {
  schemaVersion: number;
  name: string;
  source: { type: string; url: string; notes: string };
  servings: RecipeServings;
  yield: RecipeYield;
  sections: RecipeSection[];
  ingredients: RecipeIngredient[];
  prepSteps: RecipeStep[];
  activeSteps: RecipeStep[];
  prepGroups: PrepGroup[];
  timeline: TimelineEntry[];
  techniqueOverrides: TechniqueOverride[];
  notes: string[];
}

/** A recipe as stored in / loaded from Firestore. */
export interface SavedRecipeMeta {
  id: string;
  name: string;
  updatedAtMs: number | null;
  sectionCount: number;
  ingredientCount: number;
}

/** Minimal shape of a CalorieTracker saved food item used for matching. */
export interface FoodItemRef {
  id: string;
  name: string;
}
