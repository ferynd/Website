import { describe, expect, it } from 'vitest';
import { parseRecipeJson } from '../lib/schema';
import { validRecipeJson } from './fixtures';

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
