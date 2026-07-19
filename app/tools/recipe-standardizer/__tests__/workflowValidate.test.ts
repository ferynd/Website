import { describe, expect, it } from 'vitest';
import { parseRecipeJson } from '../lib/schema';
import { validateWorkflow } from '../lib/workflowValidate';
import type { Recipe } from '../lib/types';
import { validV2RecipeJson } from './fixtures';

/** Parse the v2 fixture and hand back a mutable deep copy. */
const parsedTart = (): Recipe => {
  const result = parseRecipeJson(JSON.stringify(validV2RecipeJson()));
  if (!result.ok) throw new Error(`fixture must parse: ${result.errors.join(' ')}`);
  return structuredClone(result.recipe);
};

describe('validateWorkflow', () => {
  it('passes the tart fixture with no errors or warnings', () => {
    const { errors, warnings } = validateWorkflow(parsedTart());
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('errors on a duplicate prep group id', () => {
    const recipe = parsedTart();
    recipe.prepGroups[1].id = recipe.prepGroups[0].id;
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('duplicate prep group id'))).toBe(true);
  });

  it('errors on a prep group referencing a missing ingredient', () => {
    const recipe = parsedTart();
    recipe.prepGroups[0].ingredientIds.push('ing-ghost');
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('ing-ghost'))).toBe(true);
  });

  it('errors on duplicate step ids across prep and active lists', () => {
    const recipe = parsedTart();
    recipe.prepSteps.push(structuredClone(recipe.activeSteps[0]));
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('duplicate step id'))).toBe(true);
  });

  it('errors on duplicate result ids (a result must have exactly one producer)', () => {
    const recipe = parsedTart();
    recipe.activeSteps[1].result = { id: 'res-crust-mixture', name: 'dupe' };
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('duplicate') && e.includes('res-crust-mixture'))).toBe(true);
  });

  it('errors when a step consumes a result no step produces', () => {
    const recipe = parsedTart();
    recipe.activeSteps[0].usesResultIds = ['res-nope'];
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('res-nope') && e.includes('no step produces'))).toBe(true);
  });

  it('errors when a consumer is ordered before its producer, and reports the result cycle', () => {
    const recipe = parsedTart();
    // step-mix (first) consuming the sealed crust (produced third) also
    // closes a loop through the existing crust chain.
    recipe.activeSteps[0].usesResultIds = ['res-sealed-crust'];
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('before its producing step'))).toBe(true);
    expect(errors.some((e) => e.includes('cycle'))).toBe(true);
  });

  it('errors when a step uses an unknown prep group', () => {
    const recipe = parsedTart();
    recipe.activeSteps[0].usesPrepGroupIds.push('g-ghost');
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('g-ghost'))).toBe(true);
  });

  it('errors when firstUseStepId references a missing step', () => {
    const recipe = parsedTart();
    recipe.prepGroups[0].firstUseStepId = 'step-nope';
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('firstUseStepId') && e.includes('step-nope'))).toBe(true);
  });

  it('warns (not errors) when firstUseStepId is not the earliest consumer', () => {
    const recipe = parsedTart();
    recipe.prepGroups[0].firstUseStepId = 'step-press';
    const { errors, warnings } = validateWorkflow(recipe);
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes('earliest consumer'))).toBe(true);
  });

  it('warns on an unused prep group', () => {
    const recipe = parsedTart();
    recipe.prepGroups.push({
      id: 'g-unused',
      name: 'never used',
      ingredientIds: [],
      destination: '',
      instruction: '',
      timing: { when: 'start', note: '' },
      firstUseStepId: '',
      holdNote: '',
      details: '',
      techniqueIds: [],
    });
    const { errors, warnings } = validateWorkflow(recipe);
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes('never used'))).toBe(true);
  });

  it('errors when during-wait timing points at a non-wait timeline entry', () => {
    const recipe = parsedTart();
    const infusion = recipe.prepGroups.find((g) => g.id === 'g-infusion')!;
    infusion.timing = { when: 'during-wait', waitEntryId: 'tl-crust', note: '' };
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('during-wait prep must reference a wait'))).toBe(true);
  });

  it('errors when during-wait timing points at a missing timeline entry', () => {
    const recipe = parsedTart();
    const infusion = recipe.prepGroups.find((g) => g.id === 'g-infusion')!;
    infusion.timing = { when: 'during-wait', waitEntryId: 'tl-nope', note: '' };
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('tl-nope'))).toBe(true);
  });

  it('errors when during-wait prep is scheduled after its first use', () => {
    const recipe = parsedTart();
    const crust = recipe.prepGroups.find((g) => g.id === 'g-crust')!;
    crust.timing = { when: 'during-wait', waitEntryId: 'tl-thaw', note: '' };
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('after its first use'))).toBe(true);
  });

  it('errors when just-in-time timing names a missing step', () => {
    const recipe = parsedTart();
    const choc = recipe.prepGroups.find((g) => g.id === 'g-white-choc')!;
    choc.timing = { when: 'just-in-time', beforeStepId: 'step-nope', note: '' };
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('just-in-time') && e.includes('step-nope'))).toBe(true);
  });

  it('errors when just-in-time timing does not name the first consumer', () => {
    const recipe = parsedTart();
    const choc = recipe.prepGroups.find((g) => g.id === 'g-white-choc')!;
    recipe.activeSteps[3].usesPrepGroupIds.push('g-white-choc');
    choc.timing = { when: 'just-in-time', beforeStepId: recipe.activeSteps[3].id, note: '' };
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('must be the prep group'))).toBe(true);
  });

  it('errors when a step uses a just-in-time group before it is prepared', () => {
    const recipe = parsedTart();
    const choc = recipe.prepGroups.find((g) => g.id === 'g-white-choc')!;
    // Prepared just before the freeze — but consumed by the earlier brush step.
    choc.timing = { when: 'just-in-time', beforeStepId: 'step-freeze-crust', note: '' };
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('before it is prepared'))).toBe(true);
  });

  it('errors when an after-section group is consumed in an earlier section', () => {
    const recipe = parsedTart();
    const cold = recipe.prepGroups.find((g) => g.id === 'g-mascarpone-cold')!;
    cold.timing = { when: 'after-section', sectionId: 'sec-serve', note: '' };
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('scheduled after section'))).toBe(true);
  });

  it('errors when an after-section group is consumed in the same section', () => {
    const recipe = parsedTart();
    const cold = recipe.prepGroups.find((g) => g.id === 'g-infusion')!;
    cold.timing = { when: 'after-section', sectionId: 'sec-filling', note: '' };
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('scheduled after section'))).toBe(true);
  });

  it('errors on a timeline reference to a missing entity', () => {
    const recipe = parsedTart();
    recipe.timeline[0].references = [{ kind: 'section', id: 'sec-nope' }];
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('sec-nope'))).toBe(true);
  });

  it('errors when duringEntryId points at a non-wait entry', () => {
    const recipe = parsedTart();
    const mascarpone = recipe.timeline.find((t) => t.id === 'tl-mascarpone')!;
    mascarpone.duringEntryId = 'tl-crust';
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('overlapped work must reference a wait'))).toBe(true);
  });

  it('errors when duringEntryId points at itself', () => {
    const recipe = parsedTart();
    const thaw = recipe.timeline.find((t) => t.id === 'tl-thaw')!;
    thaw.duringEntryId = 'tl-thaw';
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('points at itself'))).toBe(true);
  });

  it('errors on multi-entry duringEntryId cycles', () => {
    const recipe = parsedTart();
    const thaw = recipe.timeline.find((t) => t.id === 'tl-thaw')!;
    const wait = structuredClone(thaw);
    wait.id = 'tl-other-wait';
    wait.order = thaw.order + 1;
    thaw.duringEntryId = wait.id;
    wait.duringEntryId = thaw.id;
    recipe.timeline.push(wait);
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('duringEntryId contains a cycle'))).toBe(true);
  });

  it('errors when timeline order contradicts section dependencies', () => {
    const recipe = parsedTart();
    const filling = recipe.timeline.find((t) => t.id === 'tl-filling')!;
    filling.order = 0; // before the crust it depends on
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('before its dependency'))).toBe(true);
  });

  it('errors when timeline order contradicts a result dependency', () => {
    const recipe = parsedTart();
    // The freeze step (timeline order 2) consumes the sealed crust; placing
    // its producer step in a later timeline entry contradicts chronology.
    recipe.timeline.find((t) => t.id === 'tl-serve')!.references.push({ kind: 'step', id: 'step-brush' });
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('before the step that produces'))).toBe(true);
  });

  it('uses step references when checking section timeline dependencies', () => {
    const recipe = parsedTart();
    recipe.timeline.find((t) => t.id === 'tl-crust')!.references = [{ kind: 'step', id: 'step-mix-crust' }];
    recipe.timeline.find((t) => t.id === 'tl-filling')!.order = 0;
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('before its dependency'))).toBe(true);
  });

  it('uses section references when checking result dependency timeline order', () => {
    const recipe = parsedTart();
    recipe.timeline.find((t) => t.id === 'tl-crust')!.references = [{ kind: 'section', id: 'sec-crust' }];
    recipe.timeline.find((t) => t.id === 'tl-filling')!.order = 0;
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('before the step that produces'))).toBe(true);
  });

  it('errors on a section dependency cycle', () => {
    const recipe = parsedTart();
    recipe.sections[0].dependsOn = ['sec-serve'];
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('cycle'))).toBe(true);
  });

  it('errors on a duplicate timeline entry id', () => {
    const recipe = parsedTart();
    recipe.timeline[1].id = recipe.timeline[0].id;
    const { errors } = validateWorkflow(recipe);
    expect(errors.some((e) => e.includes('duplicate timeline entry id'))).toBe(true);
  });
});
