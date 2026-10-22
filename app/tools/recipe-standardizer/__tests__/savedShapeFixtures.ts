/* --- CONFIGURATION: saved recipe compatibility cases --- */
/** Plain stored maps covering v1 through P5, without mutating the shared input builders. */

import { validRecipeJson, validV2RecipeJson } from './fixtures';
import { exportedRef } from './exportFixtures';
import type { NutritionLinkStatus } from '../lib/types';

/** One stored recipe shape as Firestore would return it. */
export interface SavedShapeCase {
  /** Human label used in table titles. */
  label: string;
  /** Stored recipe map. */
  raw: Record<string, unknown>;
  /** Expected parsed statuses by ingredient ID. */
  expectedStatuses: Record<string, NutritionLinkStatus>;
  /** Exact parser warning count. */
  expectedWarnings: number;
}

const legacy = {
  status: 'linked',
  foodItemId: 'dark-chocolate',
  matchedName: 'Dark chocolate',
  matchConfidence: 1,
  needsUserReview: false,
};
const confirmed = {
  ...legacy,
  status: 'confirmed',
  gramsPerUnit: 100,
  confirmedAtMs: 1,
  targetRevision: '2025-01-01T00:00:00.000Z',
  targetFingerprint: 'fingerprint',
};

const shape = (
  label: string,
  v2 = false,
  edit: (raw: Record<string, unknown>, ingredients: Record<string, unknown>[]) => void = () => { },
  firstStatus: NutritionLinkStatus = 'unlinked',
  expectedWarnings = 0,
): SavedShapeCase => {
  const raw = structuredClone(v2 ? validV2RecipeJson() : validRecipeJson());
  const ingredients = raw.ingredients as Record<string, unknown>[];
  edit(raw, ingredients);
  return {
    label,
    raw,
    expectedStatuses: Object.fromEntries(ingredients.map((ingredient, index) => [
      String(ingredient.id), index === 0 ? firstStatus : 'unlinked',
    ])),
    expectedWarnings,
  };
};

/** Every supported historical and current saved shape. */
export const SAVED_SHAPES: readonly SavedShapeCase[] = [
  shape('v1 unlinked (pre-P1)'),
  shape('v1 legacy linked', false, (_raw, ingredients) => {
    ingredients[0].nutritionLink = { ...legacy };
  }, 'candidate'),
  shape('v1 legacy likely', false, (_raw, ingredients) => {
    ingredients[0].nutritionLink = { ...legacy, status: 'likely' };
  }, 'candidate'),
  shape('v1 missing nutritionLink', false, (_raw, ingredients) => {
    delete ingredients[0].nutritionLink;
  }),
  shape('v2 pre-P1 (no gram basis fields)', true),
  shape('v2 P1 confirmed with gram basis', true, (_raw, ingredients) => {
    ingredients[0].nutritionLink = { ...confirmed };
  }, 'confirmed'),
  shape('v2 P1 confirmed missing gramsPerUnit', true, (_raw, ingredients) => {
    const link: Record<string, unknown> = { ...confirmed };
    delete link.gramsPerUnit;
    ingredients[0].nutritionLink = link;
  }, 'candidate', 1),
  shape('v2 no-match with stray foodItemId', true, (_raw, ingredients) => {
    ingredients[0].nutritionLink = { ...legacy, status: 'no-match' };
  }, 'no-match'),
  shape('v2 P4 with both export refs', true, (raw) => {
    raw.nutritionExports = {
      perPortion: exportedRef(),
      per100gCooked: exportedRef({ basis: 'per100gCooked' }),
    };
  }),
  shape('v2 P4 with a foreign export ref', true, (raw) => {
    raw.nutritionExports = { perPortion: exportedRef({ recipeId: 'other-recipe' }) };
  }),
  shape('v2 P5 baked equivalent annotation', true, (_raw, ingredients) => {
    ingredients[0].equivalent = 'a generous handful';
    ingredients[0].equivalentBakeFactor = 3;
  }),
];

/** Legacy document for revision migration coverage. */
export const STORED_DOC_WITHOUT_REVISION = {
  name: validRecipeJson().name,
  recipe: validRecipeJson(),
  createdAt: null,
  updatedAt: null,
};
