import { describe, expect, it } from 'vitest';
import { parseRecipeJson } from '../lib/schema';
import { buildShoppingItems, groupShoppingItems } from '../lib/shoppingList';
import type { Recipe } from '../lib/types';
import { validRecipeJson } from './fixtures';

const recipe = (): Recipe => {
  const parsed = parseRecipeJson(JSON.stringify(validRecipeJson()));
  if (!parsed.ok) throw new Error('fixture must be valid');
  return parsed.recipe;
};

describe('buildShoppingItems', () => {
  it('lists each unique ingredient once with scaled grams', () => {
    const items = buildShoppingItems(recipe(), 2);
    expect(items).toHaveLength(3);
    expect(items.find((i) => i.displayName === 'all-purpose flour')?.totalQuantityG).toBe(600);
  });

  it('consolidates duplicate ingredient names across sections and sums grams', () => {
    const base = recipe();
    base.ingredients.push({
      ...base.ingredients[2],
      id: 'ing-butter-topping',
      quantityG: 25,
      sectionIds: ['sec-dry'],
      primarySectionId: 'sec-dry',
    });
    const items = buildShoppingItems(base, 1);
    const butter = items.find((i) => i.displayName === 'unsalted butter');
    expect(items).toHaveLength(3);
    expect(butter?.totalQuantityG).toBe(250);
    expect(butter?.ingredientIds).toEqual(['ing-butter', 'ing-butter-topping']);
    // Consolidated lines drop the single-entry equivalent text.
    expect(butter?.equivalent).toBeNull();
  });

  it('flags a baseline-text equivalent as unscaled at a non-1 factor', () => {
    const base = recipe();
    base.ingredients[0].equivalent = 'a generous handful';
    const items = buildShoppingItems(base, 2);
    const chocolate = items.find((i) => i.displayName === 'dark chocolate');
    expect(chocolate?.equivalent).toBe('a generous handful');
    expect(chocolate?.equivalentUnscaled).toBe(true);
    // Parseable equivalents scale and are not flagged.
    const flour = items.find((i) => i.displayName === 'all-purpose flour');
    expect(flour?.equivalent).toBe('5 cups');
    expect(flour?.equivalentUnscaled).toBe(false);
  });

  it('flags partially unweighed consolidations', () => {
    const base = recipe();
    base.ingredients.push({ ...base.ingredients[2], id: 'ing-butter-2', quantityG: null });
    const butter = buildShoppingItems(base, 1).find((i) => i.displayName === 'unsalted butter');
    expect(butter?.totalQuantityG).toBe(225);
    expect(butter?.hasUnweighedPart).toBe(true);
  });
});

describe('groupShoppingItems', () => {
  it('groups by first-use section in workflow order by default', () => {
    const groups = groupShoppingItems(buildShoppingItems(recipe(), 1), 'workflow', recipe().sections);
    expect(groups.map((g) => g.label)).toEqual(['Prep Mix-Ins', 'Prep Dry Bowl', 'Build Dough']);
    expect(groups[0].items[0].displayName).toBe('dark chocolate');
  });

  it('groups by grocery category alphabetically with uncategorized last', () => {
    const base = recipe();
    base.ingredients[1].groceryCategory = '';
    const groups = groupShoppingItems(buildShoppingItems(base, 1), 'grocery', base.sections);
    expect(groups.map((g) => g.label)).toEqual(['Baking', 'Dairy', 'Other']);
  });
});
