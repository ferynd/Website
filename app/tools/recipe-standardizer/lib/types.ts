/* ------------------------------------------------------------ */
/* CONFIGURATION: recipe schema version                          */
/* ------------------------------------------------------------ */
export const RECIPE_SCHEMA_VERSION = 1;

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
 * Nutrition integration: each ingredient carries a `nutritionLink` that can
 * point at a CalorieTracker saved food item
 * (`artifacts/default-app-id/users/{uid}/foodItems/{foodItemId}`). v1 only
 * records the link (matched/likely/unlinked); computing recipe nutrition from
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
