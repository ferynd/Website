import { describe, expect, it } from 'vitest';
import { assessNutritionLink, confirmNutritionLink, type LinkAssessment, type LinkReviewState } from '../lib/nutritionLink';
import {
  applyIntakeLinks, buildIntakeCommitPlan, canCommitIntake, defaultFoodName, evaluateIntakeRows,
  findPlanCollisions, initialIntakeRows, reassignRow, resolveTarget, selectIntakeGroups,
  type IntakeRow,
} from '../lib/nutritionIntakeReview';
import type { IntakeGroup } from '../lib/nutritionIntake';
import { TRACKER_NUTRIENT_KEYS, type TrackerFood } from '../lib/trackerFoods';
import { UNLINKED_NUTRITION, type NutritionLink, type Recipe } from '../lib/types';
import type { ParsedNutritionItem } from '../lib/nutritionIntake';

const link = (status: NutritionLink['status'] = 'unlinked', foodItemId: string | null = null): NutritionLink => ({ ...UNLINKED_NUTRITION, status, foodItemId });
const ingredient = (id: string, displayName: string, status: NutritionLink['status'] = 'unlinked', foodItemId: string | null = null, extra: Record<string, unknown> = {}) => ({
  id, displayName, quantityG: 10, equivalent: '', prepNote: '', sectionIds: [], primarySectionId: '', groceryCategory: '', optional: false,
  substitutionNotes: '', conversionNotes: '', nutritionLink: link(status, foodItemId), ...extra,
});
const makeRecipe = (...ingredients: ReturnType<typeof ingredient>[]): Recipe => ({ name: 'Recipe', schemaVersion: 2, sections: [], ingredients, prepGroups: [], steps: [], notes: [] } as unknown as Recipe);
const food = (id: string, name: string): TrackerFood => ({ id, name, quantity: 1, nutrients: Object.fromEntries(TRACKER_NUTRIENT_KEYS.map((key) => [key, key === 'calories' ? 100 : 0])) as TrackerFood['nutrients'], lastUpdated: '2025-01-01T00:00:00.000Z' });
const parsedItem = (index: number, ingredientId: string | null = 'a', name = 'Butter', errors: string[] = []): ParsedNutritionItem => ({
  index, path: `items[${index}]`, ingredientId, name, assumptions: '', nutrients: Object.fromEntries(TRACKER_NUTRIENT_KEYS.map((key) => [key, 0])) as ParsedNutritionItem['nutrients'], errors, warnings: [],
});
const row = (item: ParsedNutritionItem, targetKey: string | null, overrides: Partial<IntakeRow> = {}): IntakeRow => ({
  rowId: String(item.index), item, targetKey, matchedBy: targetKey ? 'id' : null, decision: 'create', foodName: 'Butter (per 100 g)', nameEdited: false, linkGrams: '', ...overrides,
});
const assessments = (entries: [string, LinkReviewState][]) => new Map(entries.map(([id, state]) => [id, { state, food: null, currentName: null } as LinkAssessment]));

describe('nutrition intake review eligibility and grouping', () => {
  it('includes exactly the three states without a usable target', () => {
    const states: LinkReviewState[] = ['unlinked', 'candidate-missing', 'stale-missing', 'candidate', 'confirmed', 'confirmed-unverified', 'stale-renamed', 'stale-revised', 'no-match'];
    const recipe = makeRecipe(...states.map((_, index) => ingredient(`i${index}`, `Food ${index}`)));
    const included = selectIntakeGroups(recipe, assessments(states.map((state, index) => [`i${index}`, state])));
    expect(included.map((group) => group.key)).toEqual(['i0', 'i1', 'i2']);
  });

  it('groups Butter and butter, uses first ingredient as key, preserves order, and builds notes', () => {
    const recipe = makeRecipe(
      ingredient('first', 'Butter', 'unlinked', null, { equivalent: '1 cup', prepNote: 'melted' }),
      ingredient('other', 'Flour'),
      ingredient('second', 'butter', 'unlinked', null, { equivalent: '', prepNote: 'softened' }),
    );
    const groups = selectIntakeGroups(recipe, assessments([['first', 'unlinked'], ['other', 'unlinked'], ['second', 'stale-missing']]));
    expect(groups.map((group) => group.displayName)).toEqual(['Butter', 'Flour']);
    expect(groups[0]).toMatchObject({ key: 'first', ingredientIds: ['first', 'second'], note: '1 cup; melted' });
    expect(defaultFoodName('Butter')).toBe('Butter (per 100 g)');
  });
});

describe('nutrition intake row matching and defaults', () => {
  const groups: IntakeGroup[] = [
    { key: 'a', displayName: 'Butter', normalizedName: 'butter', ingredientIds: ['a', 'a2'], note: '' },
    { key: 'b', displayName: 'Olive Oil', normalizedName: 'olive oil', ingredientIds: ['b'], note: '' },
  ];

  it('matches representative and member IDs, then normalized names, and rejects unknown targets', () => {
    expect(resolveTarget(parsedItem(0, 'a'), groups)).toMatchObject({ targetKey: 'a', matchedBy: 'id' });
    expect(resolveTarget(parsedItem(0, 'a2'), groups)).toMatchObject({ targetKey: 'a', matchedBy: 'id' });
    expect(resolveTarget(parsedItem(0, 'missing', ' butter '), groups)).toMatchObject({ targetKey: 'a', matchedBy: 'name' });
    expect(resolveTarget(parsedItem(0, 'missing', 'Unknown'), groups)).toMatchObject({ targetKey: null, matchedBy: null });
  });

  it('warns when an ID now belongs to an ineligible ingredient', () => {
    const recipe = makeRecipe(ingredient('confirmed', 'Butter', 'confirmed', 'food-id'));
    const result = resolveTarget(parsedItem(0, 'confirmed', 'Unmatched'), groups, recipe);
    expect(result.targetKey).toBeNull();
    expect(result.warning).toContain('is no longer unlinked in this recipe');
    const rows = initialIntakeRows([parsedItem(0, 'confirmed', 'Unmatched')], groups, [], new Set(), recipe);
    expect(rows[0].item.warnings.join(' ')).toContain('is no longer unlinked');
  });

  it('defaults duplicate target rows to skip and lets the next row create when the first is skipped', () => {
    const recipe = makeRecipe(ingredient('a', 'Butter'));
    const first = row(parsedItem(0, 'a'), 'a');
    const second = row(parsedItem(1, 'a'), 'a', { foodName: 'Butter 2 (per 100 g)' });
    const duplicateEval = evaluateIntakeRows([first, second], groups, [], new Set());
    expect(duplicateEval[1].baseBlockers.join(' ')).toContain('Row 1 already fills');
    const defaults = initialIntakeRows([parsedItem(0, 'a'), parsedItem(1, 'a')], groups, [], new Set(), recipe);
    expect(defaults.map((entry) => entry.decision)).toEqual(['create', 'skip']);
    const skipped = [{ ...first, decision: 'skip' as const }, second];
    expect(evaluateIntakeRows(skipped, groups, [], new Set())[1].canCreate).toBe(true);
  });

  it('defaults an invalid parsed row to skip', () => {
    const invalid = parsedItem(0, 'a', 'Butter', ['items[0].nutrients.fat is invalid']);
    expect(initialIntakeRows([invalid], groups, [], new Set())[0].decision).toBe('skip');
  });
});

describe('nutrition intake collisions and link-existing validation', () => {
  const group: IntakeGroup = { key: 'a', displayName: 'Olive Oil', normalizedName: 'olive oil', ingredientIds: ['a'], note: '' };
  const groups = [group];

  it('detects an existing ID collision and offers link-existing while defaulting to skip', () => {
    const row0 = row(parsedItem(0, 'a', 'Olive Oil'), 'a', { foodName: 'olive_oil' });
    const evals = evaluateIntakeRows([row0], groups, [food('olive_oil', 'Existing')], new Set());
    expect(evals[0]).toMatchObject({ collision: { foodId: 'olive_oil' }, linkAvailable: true, canCreate: false });
    expect(initialIntakeRows([parsedItem(0, 'a')], groups, [food('olive_oil__per_100_g_', 'Olive Oil (per 100 g)')], new Set())[0].decision).toBe('skip');
  });

  it('detects a collision by the existing food name slug', () => {
    const row0 = row(parsedItem(0, 'a'), 'a', { foodName: 'olive-oil' });
    expect(evaluateIntakeRows([row0], groups, [food('legacy-id', 'Olive Oil')], new Set())[0].collision).toMatchObject({ foodId: 'legacy-id', food: { id: 'legacy-id' } });
  });

  it('marks unreadable ID collisions without offering link-existing', () => {
    const row0 = row(parsedItem(0, 'a'), 'a', { foodName: 'Olive Oil' });
    expect(evaluateIntakeRows([row0], groups, [], new Set(['olive_oil']))[0]).toMatchObject({ collision: { foodId: 'olive_oil', food: null }, linkAvailable: false });
  });

  it('allows a free rename and catches within-batch slug collisions', () => {
    const renamed = row(parsedItem(0, 'a'), 'a', { foodName: 'Fresh Olive Oil' });
    expect(evaluateIntakeRows([renamed], groups, [], new Set())[0].canCreate).toBe(true);
    const first = row(parsedItem(0, 'a'), 'a', { foodName: 'Olive Oil' });
    const second = row(parsedItem(1, 'a'), 'a', { foodName: 'olive-oil' });
    expect(evaluateIntakeRows([first, second], groups, [], new Set())[1].batchConflictRow).toBe(0);
  });

  it('requires a valid grams-per-unit value for linking an existing food', () => {
    for (const grams of ['', '0', '10001']) {
      const current = row(parsedItem(0, 'a'), 'a', { foodName: 'Olive Oil', linkGrams: grams });
      expect(evaluateIntakeRows([current], groups, [food('olive_oil', 'Olive Oil')], new Set())[0].canLinkExisting).toBe(false);
    }
    const valid = row(parsedItem(0, 'a'), 'a', { foodName: 'Olive Oil', linkGrams: '100' });
    expect(evaluateIntakeRows([valid], groups, [food('olive_oil', 'Olive Oil')], new Set())[0].canLinkExisting).toBe(true);
  });

  it('resets the default name on reassignment unless the name was edited', () => {
    const current = row(parsedItem(0, 'a'), 'a');
    expect(reassignRow(current, 'b', [group, { ...group, key: 'b', displayName: 'Bread', ingredientIds: ['b'] }]).foodName).toBe('Bread (per 100 g)');
    expect(reassignRow({ ...current, nameEdited: true, foodName: 'My custom food' }, 'b', [group, { ...group, key: 'b', displayName: 'Bread', ingredientIds: ['b'] }]).foodName).toBe('My custom food');
  });
});

describe('nutrition intake commit plan', () => {
  const groups: IntakeGroup[] = [{ key: 'a', displayName: 'Butter', normalizedName: 'butter', ingredientIds: ['a', 'a2'], note: '' }];

  it('blocks committing when all rows are skipped or any create row is blocked', () => {
    const skipped = row(parsedItem(0, 'a'), 'a', { decision: 'skip' });
    const evalSkipped = evaluateIntakeRows([skipped], groups, [], new Set());
    expect(canCommitIntake([skipped], evalSkipped)).toBe(false);
    const create = row(parsedItem(0, 'a'), 'a', { foodName: '' });
    const blocked = evaluateIntakeRows([create], groups, [], new Set());
    expect(canCommitIntake([create], blocked)).toBe(false);
  });

  it('carries every grouped member current link status into the plan', () => {
    const recipe = makeRecipe(ingredient('a', 'Butter', 'unlinked'), ingredient('a2', 'butter', 'candidate', 'old-food'));
    const current = row(parsedItem(0, 'a'), 'a');
    const evals = evaluateIntakeRows([current], groups, [], new Set());
    const plan = buildIntakeCommitPlan([current], evals, groups, recipe);
    expect(plan.creates[0].ingredients).toEqual([
      { ingredientId: 'a', status: 'unlinked', foodItemId: null },
      { ingredientId: 'a2', status: 'candidate', foodItemId: 'old-food' },
    ]);
  });

  it('finds a target food added after review', () => {
    const current = row(parsedItem(0, 'a'), 'a');
    const plan = buildIntakeCommitPlan([current], evaluateIntakeRows([current], groups, [], new Set()), groups, makeRecipe(ingredient('a', 'Butter'), ingredient('a2', 'butter')));
    expect(findPlanCollisions(plan, [food('butter__per_100_g_', 'Butter (per 100 g)')])).toEqual(['butter__per_100_g_']);
  });
});

describe('apply intake links to the recipe draft', () => {
  it('confirms every group member at 100 g and assesses both as confirmed', () => {
    const recipe = makeRecipe(ingredient('a', 'Butter'), ingredient('a2', 'butter'));
    const created = food('butter__per_100_g_', 'Butter (per 100 g)');
    const newLink = confirmNutritionLink(created, 100, 1234, UNLINKED_NUTRITION);
    const expected = ['a', 'a2'].map((ingredientId) => ({ ingredientId, status: 'unlinked' as const, foodItemId: null }));
    const result = applyIntakeLinks(recipe, expected.map((entry) => ({ expected: entry, link: newLink })));
    expect(result.applied).toEqual(['a', 'a2']);
    expect(result.skipped).toEqual([]);
    for (const updated of result.recipe.ingredients) {
      expect(updated.nutritionLink).toMatchObject({ status: 'confirmed', foodItemId: created.id, gramsPerUnit: 100, targetRevision: created.lastUpdated });
      expect(assessNutritionLink(updated.nutritionLink, new Map([[created.id, created]])).state).toBe('confirmed');
    }
  });

  it('skips links changed since review and missing ingredients', () => {
    const recipe = makeRecipe(ingredient('changed', 'Butter', 'candidate', 'other'), ingredient('unchanged', 'Bread'));
    const target = food('new-food', 'New food');
    const linkToApply = confirmNutritionLink(target, 100, 10, UNLINKED_NUTRITION);
    const result = applyIntakeLinks(recipe, [
      { expected: { ingredientId: 'changed', status: 'unlinked', foodItemId: null }, link: linkToApply },
      { expected: { ingredientId: 'missing', status: 'unlinked', foodItemId: null }, link: linkToApply },
    ]);
    expect(result.skipped).toEqual(['changed', 'missing']);
    expect(result.recipe.ingredients[0].nutritionLink).toMatchObject({ status: 'candidate', foodItemId: 'other' });
    expect(result.recipe.ingredients[1].nutritionLink).toEqual(recipe.ingredients[1].nutritionLink);
  });

  it('skips an ingredient whose linked food ID changed while its status stayed the same', () => {
    const recipe = makeRecipe(ingredient('changed-id', 'Butter', 'candidate', 'newer-candidate'));
    const target = food('new-food', 'New food');
    const result = applyIntakeLinks(recipe, [{
      expected: { ingredientId: 'changed-id', status: 'candidate', foodItemId: 'older-candidate' },
      link: confirmNutritionLink(target, 100, 10, UNLINKED_NUTRITION),
    }]);
    expect(result.skipped).toEqual(['changed-id']);
    expect(result.applied).toEqual([]);
    expect(result.recipe.ingredients[0].nutritionLink.foodItemId).toBe('newer-candidate');
  });

  it('leaves other ingredients untouched and does not mutate the input recipe', () => {
    const recipe = makeRecipe(ingredient('target', 'Butter'), ingredient('other', 'Bread'));
    const before = structuredClone(recipe);
    const target = food('new-food', 'New food');
    const result = applyIntakeLinks(recipe, [{ expected: { ingredientId: 'target', status: 'unlinked', foodItemId: null }, link: confirmNutritionLink(target, 100, 20, UNLINKED_NUTRITION) }]);
    expect(result.recipe.ingredients[1]).toEqual(recipe.ingredients[1]);
    expect(recipe).toEqual(before);
    expect(result.recipe).not.toBe(recipe);
  });
});
