import { describe, expect, it } from 'vitest';
import { parseRecipeJson } from '../lib/schema';
import {
  applyStepTextUpdates,
  findAffectedSteps,
  replaceIngredientName,
} from '../lib/stepTextUpdate';
import type { Recipe } from '../lib/types';
import { validRecipeJson } from './fixtures';

const recipe = (): Recipe => {
  const parsed = parseRecipeJson(JSON.stringify(validRecipeJson()));
  if (!parsed.ok) throw new Error('fixture must be valid');
  return parsed.recipe;
};

describe('replaceIngredientName', () => {
  it('replaces case-insensitively and preserves a leading capital', () => {
    expect(replaceIngredientName('Cream butter until fluffy.', 'butter', 'oil')).toBe('Cream oil until fluffy.');
    expect(replaceIngredientName('Butter the pan.', 'butter', 'coconut oil')).toBe('Coconut oil the pan.');
  });

  it('only matches whole words, not substrings', () => {
    expect(replaceIngredientName('Add the buttermilk.', 'butter', 'oil')).toBeNull();
  });

  it('replaces multi-word names', () => {
    expect(replaceIngredientName('Whisk the all-purpose flour in.', 'all-purpose flour', 'bread flour')).toBe(
      'Whisk the bread flour in.',
    );
  });

  it('returns null when the old name does not appear', () => {
    expect(replaceIngredientName('Preheat the oven.', 'butter', 'oil')).toBeNull();
    expect(replaceIngredientName('anything', '', 'oil')).toBeNull();
  });
});

describe('findAffectedSteps', () => {
  it('finds steps that reference the ingredient id, with suggestions when the name appears', () => {
    const base = recipe();
    // fixture: prep-1 references ing-chocolate and mentions "chocolate";
    // act-1 references it too and mentions "chocolate".
    const affected = findAffectedSteps(base, 'ing-chocolate', 'dark chocolate', 'milk chocolate');
    expect(affected.map((a) => a.stepId).sort()).toEqual(['act-1', 'prep-1']);
    // Neither step says "dark chocolate" verbatim, so no auto-suggestion.
    expect(affected.every((a) => a.suggestedText === null)).toBe(true);
  });

  it('suggests replaced text when the old name clearly appears', () => {
    const base = recipe();
    base.activeSteps[0].text = 'Cream unsalted butter with the sugars.';
    const affected = findAffectedSteps(base, 'ing-butter', 'unsalted butter', 'coconut oil');
    const active = affected.find((a) => a.stepId === 'act-1');
    expect(active?.suggestedText).toBe('Cream coconut oil with the sugars.');
  });

  it('finds prose-only mentions even without a structured reference', () => {
    const base = recipe();
    base.prepSteps[1].text = 'Sift the all-purpose flour twice.';
    base.prepSteps[1].ingredientRefs = [];
    const affected = findAffectedSteps(base, 'ing-flour', 'all-purpose flour', 'cake flour');
    expect(affected.some((a) => a.stepId === 'prep-2' && a.suggestedText === 'Sift the cake flour twice.')).toBe(true);
  });

  it('returns nothing for an unreferenced, unmentioned ingredient', () => {
    const base = recipe();
    base.prepSteps.forEach((s) => { s.ingredientRefs = []; });
    base.activeSteps.forEach((s) => { s.ingredientRefs = []; });
    expect(findAffectedSteps(base, 'ing-butter', 'zzz-not-mentioned', 'oil')).toEqual([]);
  });
});

describe('applyStepTextUpdates', () => {
  it('applies updates to the right list and step', () => {
    const updated = applyStepTextUpdates(recipe(), [
      { list: 'activeSteps', stepId: 'act-1', text: 'Cream oil, add dry mix, fold in chocolate.' },
    ]);
    expect(updated.activeSteps[0].text).toBe('Cream oil, add dry mix, fold in chocolate.');
    expect(updated.prepSteps[0].text).toBe(recipe().prepSteps[0].text);
  });

  it('ignores unknown step ids and blank texts', () => {
    const base = recipe();
    const updated = applyStepTextUpdates(base, [
      { list: 'prepSteps', stepId: 'nope', text: 'x' },
      { list: 'prepSteps', stepId: 'prep-1', text: '   ' },
    ]);
    expect(updated.prepSteps).toEqual(base.prepSteps);
  });
});
