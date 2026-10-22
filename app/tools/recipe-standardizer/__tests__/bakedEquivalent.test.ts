/* --- CONFIGURATION: F-093 regression fixture --- */
/** Exercise bake → JSON → parser → display and shopping-list consumers together. */

import { describe, expect, it } from 'vitest';
import { parseRecipeJson } from '../lib/schema';
import { applyScaleToRecipe } from '../lib/scaling';
import { describeEquivalent, equivalentSuffix } from '../lib/display';
import { buildShoppingItems } from '../lib/shoppingList';
import { validRecipeJson } from './fixtures';

const baked = (clear = false) => {
  const raw = validRecipeJson();
  raw.ingredients[0].equivalent = 'a generous handful';
  const parsed = parseRecipeJson(JSON.stringify(raw));
  if (!parsed.ok) throw new Error('Invalid fixture');
  return applyScaleToRecipe(parsed.recipe, 3, undefined, clear ? { 'ing-chocolate': 'clear' } : {});
};
const reloaded = () => {
  const result = parseRecipeJson(JSON.stringify(baked()));
  if (!result.ok) throw new Error('Invalid baked fixture');
  return result.recipe;
};

describe('baked equivalent persistence', () => {
  it('bake → save as JSON → reload keeps the annotation', () => {
    expect(reloaded().ingredients[0].equivalentBakeFactor).toBe(3);
  });
  it('reloaded annotated ingredient shows the not-rescaled note at 1×', () => {
    expect(equivalentSuffix(describeEquivalent(reloaded().ingredients[0], 1).note))
      .toBe(' — not rescaled after 3× bake');
  });
  it('annotated ingredient shows the not-rescaled note instead of "at 1×" under live scaling', () => {
    const view = describeEquivalent(reloaded().ingredients[0], 2);
    expect(view.text).toBe('a generous handful');
    expect(view.note.kind).toBe('stale-after-bake');
    expect(equivalentSuffix(view.note)).not.toContain('at 1×');
  });
  it('copied JSON contains equivalentBakeFactor', () => {
    expect(JSON.stringify(baked())).toContain('"equivalentBakeFactor":3');
  });
  it('shopping item for an annotated single-entry ingredient carries the stale note', () => {
    expect(buildShoppingItems(reloaded(), 1)[0].equivalentNote)
      .toEqual({ kind: 'stale-after-bake', bakeFactor: 3 });
  });
  it('consolidated shopping line drops the equivalent and its note', () => {
    const recipe = reloaded();
    recipe.ingredients.push({ ...recipe.ingredients[0], id: 'duplicate' });
    expect(buildShoppingItems(recipe, 2)[0]).toMatchObject({
      equivalent: null, equivalentNote: { kind: 'none' },
    });
  });
  it('cleared equivalent saves as blank and displays nothing', () => {
    const result = parseRecipeJson(JSON.stringify(baked(true)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(describeEquivalent(result.recipe.ingredients[0], 1)).toEqual({ text: null, note: { kind: 'none' } });
  });
});
