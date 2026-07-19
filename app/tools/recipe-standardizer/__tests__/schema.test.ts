import { describe, expect, it } from 'vitest';
import { parseRecipeJson } from '../lib/schema';
import { UNLINKED_NUTRITION } from '../lib/types';
import { validRecipeJson, validV2RecipeJson } from './fixtures';

const parseObject = (obj: unknown) => parseRecipeJson(JSON.stringify(obj));

describe('parseRecipeJson', () => {
  it('accepts a valid recipe and normalizes it', () => {
    const result = parseObject(validRecipeJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.name).toBe('Chocolate Chip Cookies');
    expect(result.recipe.sections).toHaveLength(3);
    expect(result.recipe.ingredients).toHaveLength(3);
    expect(result.recipe.prepSteps).toHaveLength(2);
    expect(result.recipe.activeSteps).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('rejects empty input with a clear message', () => {
    const result = parseRecipeJson('   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/paste/i);
  });

  it('rejects invalid JSON with a clear error', () => {
    const result = parseRecipeJson('{"name": "broken"');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/^Invalid JSON:/);
  });

  it('rejects markdown-wrapped JSON as invalid JSON', () => {
    const result = parseRecipeJson('```json\n{"name":"x"}\n```');
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object root', () => {
    const result = parseRecipeJson('[1, 2, 3]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/single object/);
  });

  it('identifies a missing name', () => {
    const raw = validRecipeJson() as Record<string, unknown>;
    delete raw.name;
    const result = parseObject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.startsWith('name is missing'))).toBe(true);
  });

  it('identifies the exact ingredient missing an id', () => {
    const raw = validRecipeJson();
    delete (raw.ingredients[1] as Record<string, unknown>).id;
    const result = parseObject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('ingredients[1].id'))).toBe(true);
  });

  it('identifies duplicate step ids within a list', () => {
    const raw = validRecipeJson();
    raw.prepSteps[1].id = raw.prepSteps[0].id;
    const result = parseObject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('prepSteps[1].id') && e.includes('duplicate'))).toBe(true);
  });

  it('normalizes a primarySectionId missing from sectionIds into sectionIds, with a warning', () => {
    const raw = validRecipeJson();
    // Primary points at sec-dry but sectionIds only lists sec-dough.
    raw.ingredients[2].primarySectionId = 'sec-dry';
    const result = parseObject(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.ingredients[2].sectionIds).toContain('sec-dry');
    expect(result.warnings.some((w) => w.includes('ingredients[2].primarySectionId'))).toBe(true);
  });

  it('identifies duplicate section ids', () => {
    const raw = validRecipeJson();
    raw.sections[1].id = raw.sections[0].id;
    const result = parseObject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('duplicate section id'))).toBe(true);
  });

  it('identifies a broken ingredient reference in a step', () => {
    const raw = validRecipeJson();
    raw.activeSteps[0].ingredientRefs.push('ing-missing');
    const result = parseObject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('activeSteps[0].ingredientRefs') && e.includes('ing-missing'))).toBe(true);
  });

  it('identifies a step pointing at an unknown section', () => {
    const raw = validRecipeJson();
    raw.prepSteps[0].sectionId = 'sec-nope';
    const result = parseObject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('prepSteps[0].sectionId') && e.includes('sec-nope'))).toBe(true);
  });

  it('identifies an ingredient sectionIds entry pointing at an unknown section', () => {
    const raw = validRecipeJson();
    raw.ingredients[0].sectionIds.push('sec-ghost');
    const result = parseObject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('ingredients[0].sectionIds') && e.includes('sec-ghost'))).toBe(true);
  });

  it('identifies a dependsOn entry pointing at an unknown section', () => {
    const raw = validRecipeJson();
    raw.sections[2].dependsOn.push('sec-ghost');
    const result = parseObject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('sections[2].dependsOn') && e.includes('sec-ghost'))).toBe(true);
  });

  it('rejects negative gram quantities with the exact path', () => {
    const raw = validRecipeJson();
    (raw.ingredients[2] as Record<string, unknown>).quantityG = -5;
    const result = parseObject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('ingredients[2].quantityG'))).toBe(true);
  });

  it('warns (not errors) on a null gram weight', () => {
    const raw = validRecipeJson();
    (raw.ingredients[0] as Record<string, unknown>).quantityG = null;
    const result = parseObject(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes('ingredients[0]'))).toBe(true);
  });

  it('warns on an unknown section type and treats it as combined', () => {
    const raw = validRecipeJson();
    (raw.sections[0] as Record<string, unknown>).type = 'grocery';
    const result = parseObject(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.sections[0].type).toBe('combined');
    expect(result.warnings.some((w) => w.includes('sections[0].type'))).toBe(true);
  });

  it('falls back primarySectionId to the first sectionIds entry when missing', () => {
    const raw = validRecipeJson();
    (raw.ingredients[0] as Record<string, unknown>).primarySectionId = '';
    const result = parseObject(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.ingredients[0].primarySectionId).toBe('sec-mixins');
  });

  it('sorts sections and steps by order', () => {
    const raw = validRecipeJson();
    raw.sections.reverse();
    const result = parseObject(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.sections.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it('ignores a pasted shoppingList array (it is always derived)', () => {
    const raw = validRecipeJson();
    raw.shoppingList = [{ ingredientId: 'bogus', displayName: 'bogus' }] as never[];
    const result = parseObject(raw);
    expect(result.ok).toBe(true);
  });
});

describe('parseRecipeJson — schema versions and the v2 workflow model', () => {
  it('parses a saved v1 recipe silently through the compatibility path', () => {
    const result = parseObject(validRecipeJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No per-load warning for the known v1 path.
    expect(result.warnings).toEqual([]);
    // Normalized into the in-memory v2 shape with safe defaults.
    expect(result.recipe.schemaVersion).toBe(2);
    expect(result.recipe.prepGroups).toEqual([]);
    expect(result.recipe.timeline).toEqual([]);
    expect(result.recipe.techniqueOverrides).toEqual([]);
    result.recipe.activeSteps.forEach((step) => {
      expect(step.usesPrepGroupIds).toEqual([]);
      expect(step.usesResultIds).toEqual([]);
      expect(step.result).toBeNull();
      expect(step.techniqueIds).toEqual([]);
    });
  });

  it('parses the v2 fixture cleanly', () => {
    const result = parseObject(validV2RecipeJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
    expect(result.recipe.prepGroups).toHaveLength(8);
    expect(result.recipe.timeline).toHaveLength(7);
  });

  it('warns on an unknown future schema version instead of silently accepting it', () => {
    const raw = validV2RecipeJson() as Record<string, unknown>;
    raw.schemaVersion = 3;
    const result = parseObject(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes('newer than this tool supports'))).toBe(true);
  });

  it('defaults a missing nutritionLink so the v2 prompt need not emit it', () => {
    const result = parseObject(validV2RecipeJson());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.recipe.ingredients.forEach((ing) => {
      expect(ing.nutritionLink).toEqual(UNLINKED_NUTRITION);
    });
  });

  it('warns on technique ids outside the glossary and overrides', () => {
    const raw = validV2RecipeJson();
    raw.prepGroups[0].techniqueIds = ['mystery-move'];
    const result = parseObject(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes('mystery-move'))).toBe(true);
  });

  it('accepts a technique override and does not warn for it', () => {
    const raw = validV2RecipeJson();
    raw.prepGroups[0].techniqueIds = ['special-crumble'];
    (raw.techniqueOverrides as unknown[]).push({ id: 'special-crumble', name: 'Special crumble', help: 'Press gently.' });
    const result = parseObject(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  it('rejects during-wait timing without a waitEntryId, naming the path', () => {
    const raw = validV2RecipeJson();
    raw.prepGroups[2].timing = { when: 'during-wait', note: '' } as never;
    const result = parseObject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('prepGroups[2].timing.waitEntryId'))).toBe(true);
  });

  it('treats an unknown timing.when as "start" with a warning', () => {
    const raw = validV2RecipeJson();
    raw.prepGroups[0].timing = { when: 'whenever', note: 'soon' } as never;
    const result = parseObject(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.prepGroups[0].timing).toEqual({ when: 'start', note: 'soon' });
    expect(result.warnings.some((w) => w.includes('prepGroups[0].timing.when'))).toBe(true);
  });

  it('rejects a step result missing its name', () => {
    const raw = validV2RecipeJson();
    raw.activeSteps[0].result = { id: 'res-x' } as never;
    const result = parseObject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('activeSteps[0].result'))).toBe(true);
  });

  it('rejects a timeline reference with an invalid kind', () => {
    const raw = validV2RecipeJson();
    raw.timeline[0].references = [{ kind: 'bowl', id: 'sec-crust' }] as never[];
    const result = parseObject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('timeline[0].references[0].kind'))).toBe(true);
  });

  it('surfaces workflow chronology violations as import errors', () => {
    const raw = validV2RecipeJson();
    // The mix step consuming the sealed crust puts a consumer before its producer.
    raw.activeSteps[0].usesResultIds = ['res-sealed-crust'];
    const result = parseObject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('before its producing step'))).toBe(true);
  });
});
