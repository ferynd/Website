import { describe, expect, it } from 'vitest';
import { applyNutritionMatches } from '../lib/nutritionMatch';
import { parseRecipeJson } from '../lib/schema';
import { applyScaleToRecipe } from '../lib/scaling';
import { applyStepTextUpdates, findAffectedSteps } from '../lib/stepTextUpdate';
import type { Recipe } from '../lib/types';
import {
  groupAnchor,
  groupIngredientsForDisplay,
  normalizeRecipeWorkflow,
  stepAnchor,
} from '../lib/workflow';
import { validRecipeJson, validV2RecipeJson } from './fixtures';

const parseFixture = (fixture: unknown): Recipe => {
  const result = parseRecipeJson(JSON.stringify(fixture));
  if (!result.ok) throw new Error(`fixture must parse: ${result.errors.join(' ')}`);
  return result.recipe;
};

describe('normalizeRecipeWorkflow — v1 derivation', () => {
  const recipe = parseFixture(validRecipeJson());
  const workflow = normalizeRecipeWorkflow(recipe);

  it('derives prep groups from sections with prep steps, keeping their steps', () => {
    expect(workflow.nativeGroups).toBe(false);
    expect(workflow.prepGroups.map((g) => g.name)).toEqual(['Prep Mix-Ins', 'Prep Dry Bowl']);
    const mixIns = workflow.prepGroups[0];
    expect(mixIns.ingredients.map((i) => i.id)).toEqual(['ing-chocolate']);
    expect(mixIns.steps.map((s) => s.id)).toEqual(['prep-1']);
    expect(mixIns.timing).toEqual({ when: 'start', note: '' });
  });

  it('points a derived group at the first active step using its ingredients', () => {
    // act-1 references chocolate and flour — both derived groups first-use there.
    expect(workflow.prepGroups[0].firstUseStepId).toBe('act-1');
    expect(workflow.prepGroups[1].firstUseStepId).toBe('act-1');
    expect(workflow.prepGroups[0].firstUseLabel).toBe('Build Dough');
  });

  it('derives a fallback timeline from section order without inventing results', () => {
    expect(workflow.nativeTimeline).toBe(false);
    expect(workflow.timeline.map((t) => t.title)).toEqual(['Prep Mix-Ins', 'Prep Dry Bowl', 'Build Dough']);
    expect(workflow.timeline.map((t) => t.entry.kind)).toEqual(['prep', 'prep', 'execution']);
    // The execution entry surfaces its section dependencies.
    expect(workflow.timeline[2].afterNames).toEqual(['Prep Mix-Ins', 'Prep Dry Bowl']);
  });

  it('normalizes execution steps with no named inputs and verify data from ingredientRefs', () => {
    expect(workflow.executionSections).toHaveLength(1);
    const step = workflow.executionSections[0].steps[0];
    expect(step.inputs).toEqual([]);
    expect(step.resultName).toBeNull();
    expect(step.verifyIngredients.map((i) => i.id)).toEqual(['ing-butter', 'ing-flour', 'ing-chocolate']);
  });
});

describe('normalizeRecipeWorkflow — v2 tart regression', () => {
  const recipe = parseFixture(validV2RecipeJson());
  const workflow = normalizeRecipeWorkflow(recipe);

  it('keeps the crust staging as one mixer-bowl group used at the start', () => {
    expect(workflow.nativeGroups).toBe(true);
    const crust = workflow.prepGroups[0];
    expect(crust.id).toBe('g-crust');
    expect(crust.ingredients).toHaveLength(7);
    expect(crust.destination).toBe('mixer bowl');
    expect(crust.timingLabel).toBe('At the start');
    expect(crust.firstUseLabel).toBe('crust mixture');
  });

  it('keeps execution behavior out of prep — the mixer text lives on the execution step', () => {
    const prepTexts = workflow.prepGroups.flatMap((g) => [g.instruction, g.details, ...g.steps.map((s) => s.text)]);
    expect(prepTexts.some((t) => /breaks? down/i.test(t))).toBe(false);
    const mix = workflow.executionSections[0].steps.find((s) => s.step.id === 'step-mix')!;
    expect(mix.step.text).toMatch(/breaks? down/);
  });

  it('schedules white chocolate just-in-time and dairy late, with holding visible', () => {
    const choc = workflow.prepGroups.find((g) => g.id === 'g-white-choc')!;
    expect(choc.timing.when).toBe('just-in-time');
    expect(choc.holdNote).toBe('Melt just before brushing.');
    const dairy = workflow.prepGroups.find((g) => g.id === 'g-whipped-dairy')!;
    expect(dairy.timing).toEqual({ when: 'just-in-time', beforeStepId: 'step-fold', note: '' });
    expect(dairy.holdNote).toContain('Keep refrigerated');
  });

  it('orders prep groups by first use (crust first, mascarpone staging last)', () => {
    expect(workflow.prepGroups.map((g) => g.id)).toEqual([
      'g-crust', 'g-white-choc', 'g-infusion', 'g-tea-base', 'g-gelatin-filling',
      'g-whipped-dairy', 'g-gelatin-curd', 'g-mascarpone-cold',
    ]);
  });

  it('labels during-wait prep with the wait it overlaps', () => {
    const infusion = workflow.prepGroups.find((g) => g.id === 'g-infusion')!;
    expect(infusion.timingLabel).toBe('During: Crust sets in the freezer');
  });

  it('chains named results through execution without re-enumerating ingredients', () => {
    const crustSteps = workflow.executionSections[0].steps;
    const press = crustSteps.find((s) => s.step.id === 'step-press')!;
    expect(press.inputs).toEqual([{ kind: 'result', id: 'res-crust-mixture', name: 'crust mixture' }]);
    expect(press.step.text).not.toMatch(/almond|cornflake|sugar/i);
    const brush = crustSteps.find((s) => s.step.id === 'step-brush')!;
    expect(brush.inputs.map((i) => i.name)).toEqual(['melted white chocolate', 'pressed crust']);
    expect(brush.resultName).toBe('sealed crust');
  });

  it('nests the mascarpone work under the thaw and keeps the room-temp alternative', () => {
    const topIds = workflow.timeline.map((t) => t.entry.id);
    expect(topIds).not.toContain('tl-mascarpone');
    const thaw = workflow.timeline.find((t) => t.entry.id === 'tl-thaw')!;
    expect(thaw.title).toBe('Thaw in the refrigerator');
    expect(thaw.nested.map((n) => n.entry.id)).toEqual(['tl-mascarpone']);
    expect(thaw.entry.alternatives[0].label).toBe('Room-temperature thaw');
    expect(thaw.entry.passiveTime).toBe('4–5 hours');
  });

  it('separates active from passive time on the overnight freeze', () => {
    const freeze = workflow.timeline.find((t) => t.entry.id === 'tl-freeze-tart')!;
    expect(freeze.entry.passiveTime).toBe('overnight');
    expect(freeze.entry.activeTime).toBe('');
  });

  it('anchors technique help at the first occurrence only', () => {
    expect(workflow.techniqueAnchors.get(groupAnchor('g-gelatin-filling'))).toEqual(['bloom-powdered-gelatin']);
    expect(workflow.techniqueAnchors.get(groupAnchor('g-gelatin-curd'))).toBeUndefined();
    expect(workflow.techniqueAnchors.get(groupAnchor('g-whipped-dairy'))).toEqual(['medium-soft-peaks']);
    expect(workflow.techniqueAnchors.get(stepAnchor('step-fold'))).toEqual(['fold']);
  });

  it('groups ingredients by prep group for the Ingredients view', () => {
    const groups = groupIngredientsForDisplay(recipe, workflow);
    expect(groups[0].title).toBe('crust ingredients in mixer bowl');
    expect(groups[0].ingredients).toHaveLength(7);
    const dairy = groups.find((g) => g.key === 'g-whipped-dairy')!;
    expect(dairy.holdNote).toContain('Keep refrigerated');
    // Lemon juice belongs to no group — it falls back to its section.
    const fallback = groups.find((g) => g.key === 'section-sec-mascarpone')!;
    expect(fallback.ingredients.map((i) => i.id)).toEqual(['ing-lemon-juice']);
  });
});

describe('workflow data preservation', () => {
  const recipe = parseFixture(validV2RecipeJson());

  it('survives scaling untouched (only ingredient amounts change)', () => {
    const scaled = applyScaleToRecipe(recipe, 2);
    expect(scaled.prepGroups).toEqual(recipe.prepGroups);
    expect(scaled.timeline).toEqual(recipe.timeline);
    expect(scaled.techniqueOverrides).toEqual(recipe.techniqueOverrides);
    expect(scaled.activeSteps.map((s) => s.result)).toEqual(recipe.activeSteps.map((s) => s.result));
    expect(scaled.activeSteps.map((s) => s.usesPrepGroupIds)).toEqual(recipe.activeSteps.map((s) => s.usesPrepGroupIds));
    expect(scaled.ingredients[0].quantityG).toBe(170);
  });

  it('survives step-text updates untouched', () => {
    const updated = applyStepTextUpdates(recipe, [
      { list: 'activeSteps', stepId: 'step-mix', text: 'Mix everything thoroughly.' },
    ]);
    expect(updated.activeSteps[0].text).toBe('Mix everything thoroughly.');
    expect(updated.activeSteps[0].result).toEqual({ id: 'res-crust-mixture', name: 'crust mixture' });
    expect(updated.prepGroups).toEqual(recipe.prepGroups);
  });

  it('keeps prep-group and result ids stable through an ingredient rename', () => {
    const renamed = {
      ...recipe,
      ingredients: recipe.ingredients.map((ing) =>
        ing.id === 'ing-almonds' ? { ...ing, displayName: 'toasted almonds' } : ing,
      ),
    };
    const affected = findAffectedSteps(renamed, 'ing-almonds', 'roasted almonds', 'toasted almonds');
    const applied = applyStepTextUpdates(
      renamed,
      affected.filter((a) => a.suggestedText !== null).map((a) => ({ list: a.list, stepId: a.stepId, text: a.suggestedText! })),
    );
    expect(applied.prepGroups.map((g) => g.id)).toEqual(recipe.prepGroups.map((g) => g.id));
    expect(applied.prepGroups[0].ingredientIds).toContain('ing-almonds');
    expect(applied.activeSteps.map((s) => s.result?.id ?? null)).toEqual(
      recipe.activeSteps.map((s) => s.result?.id ?? null),
    );
  });

  it('round-trips through JSON serialize + re-parse (save/load, copy JSON)', () => {
    const result = parseRecipeJson(JSON.stringify(recipe));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe).toEqual(recipe);
    expect(result.warnings).toEqual([]);
  });

  it('leaves workflow data alone during nutrition matching and links by exact name', () => {
    const { recipe: matched, summary } = applyNutritionMatches(recipe, [
      { id: 'food-cream', name: 'heavy cream' },
    ]);
    expect(matched.prepGroups).toEqual(recipe.prepGroups);
    expect(matched.timeline).toEqual(recipe.timeline);
    const cream = matched.ingredients.find((i) => i.id === 'ing-cream')!;
    expect(cream.nutritionLink.status).toBe('linked');
    expect(summary.linked).toBe(1);
  });
});
