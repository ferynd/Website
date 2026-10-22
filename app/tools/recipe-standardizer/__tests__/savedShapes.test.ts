/* --- CONFIGURATION: saved-shape compatibility expectations --- */
/** Pin defaulting, link migrations, and the persisted equivalent annotation contract. */

import { describe, expect, it } from 'vitest';
import { parseRecipeJson } from '../lib/schema';
import { FACTOR_ONE_EPSILON } from '../lib/scaling';
import { MAX_GRAMS_PER_UNIT } from '../lib/types';
import { SAVED_SHAPES } from './savedShapeFixtures';

const parsed = (raw: unknown) => {
  const result = parseRecipeJson(JSON.stringify(raw));
  if (!result.ok) throw new Error(result.errors.join(' '));
  return result;
};
const annotated = () => structuredClone(SAVED_SHAPES[SAVED_SHAPES.length - 1].raw);
const first = (raw: Record<string, unknown>) => (raw.ingredients as Record<string, unknown>[])[0];
const hasUndefined = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (value && typeof value === 'object') return Object.values(value).some(hasUndefined);
  return false;
};

describe('saved shapes', () => {
  it.each(SAVED_SHAPES)('$label parses with the expected link statuses and warning count', (test) => {
    const result = parsed(test.raw);
    expect(Object.fromEntries(result.recipe.ingredients.map((ingredient) => [
      ingredient.id, ingredient.nutritionLink.status,
    ]))).toEqual(test.expectedStatuses);
    expect(result.warnings).toHaveLength(test.expectedWarnings);
  });
  it.each(SAVED_SHAPES)('$label: parse → stringify → parse is idempotent', ({ raw }) => {
    const result = parsed(raw);
    expect(parsed(result.recipe).recipe).toEqual(result.recipe);
  });
  it.each(SAVED_SHAPES)('$label: parsing never mutates the stored input', ({ raw }) => {
    const before = structuredClone(raw);
    parsed(raw);
    expect(raw).toEqual(before);
  });
  it.each(SAVED_SHAPES)('$label: parsed recipe contains no undefined values', ({ raw }) => {
    expect(hasUndefined(parsed(raw).recipe)).toBe(false);
  });
  it.each(SAVED_SHAPES)(
    '$label: parsed recipe is schemaVersion 2 with every additive field defaulted',
    ({ raw }) => {
      const { recipe } = parsed(raw);
      expect(recipe.schemaVersion).toBe(2);
      expect(recipe.nutritionExports).toBeDefined();
      for (const ingredient of recipe.ingredients) {
        expect(ingredient.equivalentBakeFactor).not.toBeUndefined();
        expect(ingredient.nutritionLink.gramsPerUnit).not.toBeUndefined();
        expect(ingredient.nutritionLink.targetFingerprint).not.toBeUndefined();
      }
    },
  );
  it('legacy linked link parses as a candidate that needs review with a null gram basis', () => {
    expect(parsed(SAVED_SHAPES[1].raw).recipe.ingredients[0].nutritionLink).toMatchObject({
      status: 'candidate',
      needsUserReview: true,
      gramsPerUnit: null,
    });
  });
  it('confirmed link with gramsPerUnit above MAX_GRAMS_PER_UNIT downgrades to candidate with one warning', () => {
    const raw = structuredClone(SAVED_SHAPES[5].raw);
    (first(raw).nutritionLink as Record<string, unknown>).gramsPerUnit = MAX_GRAMS_PER_UNIT + 1;
    const result = parsed(raw);
    expect(result.recipe.ingredients[0].nutritionLink.status).toBe('candidate');
    expect(result.warnings).toHaveLength(1);
  });
  it('no-match link drops a stray foodItemId', () => {
    expect(parsed(SAVED_SHAPES[7].raw).recipe.ingredients[0].nutritionLink.foodItemId).toBeNull();
  });
  it('foreign export ref is kept on parse (ownership is derived, not parsed)', () => {
    expect(parsed(SAVED_SHAPES[9].raw).recipe.nutritionExports.perPortion?.recipeId).toBe('other-recipe');
  });
  it('equivalentBakeFactor round-trips through parse → stringify → parse', () => {
    expect(parsed(parsed(annotated()).recipe).recipe.ingredients[0].equivalentBakeFactor).toBe(3);
  });
  it.each([[0], [-1], ['3'], [Number.POSITIVE_INFINITY]])(
    'invalid equivalentBakeFactor %s is dropped with one warning',
    (value) => {
      const raw = annotated();
      first(raw).equivalentBakeFactor = value;
      // Infinity cannot survive JSON; feed it as an overflowing JSON number instead.
      const json = JSON.stringify(raw).replace('"equivalentBakeFactor":null', '"equivalentBakeFactor":1e999');
      const result = parseRecipeJson(json);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.recipe.ingredients[0].equivalentBakeFactor).toBeNull();
      expect(result.warnings).toHaveLength(1);
    },
  );
  it('equivalentBakeFactor on a blank equivalent normalizes to null without a warning', () => {
    const raw = annotated();
    first(raw).equivalent = '';
    expect(parsed(raw).recipe.ingredients[0].equivalentBakeFactor).toBeNull();
    expect(parsed(raw).warnings).toHaveLength(0);
  });
  it('equivalentBakeFactor within FACTOR_ONE_EPSILON of 1 normalizes to null', () => {
    const raw = annotated();
    first(raw).equivalentBakeFactor = 1 + FACTOR_ONE_EPSILON / 2;
    expect(parsed(raw).recipe.ingredients[0].equivalentBakeFactor).toBeNull();
  });
});
