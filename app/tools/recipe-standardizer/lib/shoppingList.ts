/* ------------------------------------------------------------ */
/* CONFIGURATION: grocery group fallback label                   */
/* ------------------------------------------------------------ */
const UNCATEGORIZED_LABEL = 'Other';

/**
 * Consolidated shopping / pantry-pull / mise en place list.
 *
 * Always derived from the recipe's ingredients (never from a pasted
 * `shoppingList` array) so it stays correct after edits and scaling.
 * Ingredients that share a normalized display name (e.g. butter listed
 * separately for dough and topping) consolidate into one line with summed
 * grams.
 */

import { scaleEquivalentText, scaleQuantityG } from './scaling';
import type { Recipe, RecipeIngredient, RecipeSection } from './types';

export interface ShoppingItem {
  /** Normalized-name consolidation key. */
  key: string;
  displayName: string;
  /** Scaled total grams across all consolidated entries; null if none had weights. */
  totalQuantityG: number | null;
  /** True when at least one consolidated entry had no gram weight (total is partial). */
  hasUnweighedPart: boolean;
  /** Scaled equivalent text, only when the line came from a single entry. */
  equivalent: string | null;
  /** True when `equivalent` could not be scaled and shows the baseline (1×) text. */
  equivalentUnscaled: boolean;
  groceryCategory: string;
  optional: boolean;
  sectionIds: string[];
  ingredientIds: string[];
}

export interface ShoppingGroup {
  label: string;
  items: ShoppingItem[];
}

export type ShoppingOrder = 'workflow' | 'grocery';

export const normalizeIngredientName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const buildShoppingItems = (recipe: Recipe, factor: number): ShoppingItem[] => {
  const byKey = new Map<string, { item: ShoppingItem; entries: RecipeIngredient[] }>();

  recipe.ingredients.forEach((ing) => {
    const key = normalizeIngredientName(ing.displayName) || ing.id;
    const scaledG = scaleQuantityG(ing.quantityG, factor);
    const existing = byKey.get(key);
    if (!existing) {
      const scaledEquivalent = ing.equivalent ? scaleEquivalentText(ing.equivalent, factor) : null;
      byKey.set(key, {
        entries: [ing],
        item: {
          key,
          displayName: ing.displayName,
          totalQuantityG: scaledG,
          hasUnweighedPart: scaledG === null,
          equivalent: ing.equivalent ? scaledEquivalent ?? ing.equivalent : null,
          // Baseline-text fallback must be labeled, same as the workflow view.
          equivalentUnscaled: Boolean(ing.equivalent && scaledEquivalent === null && factor !== 1),
          groceryCategory: ing.groceryCategory,
          optional: ing.optional,
          sectionIds: [...ing.sectionIds],
          ingredientIds: [ing.id],
        },
      });
      return;
    }
    const { item } = existing;
    existing.entries.push(ing);
    if (scaledG !== null) {
      item.totalQuantityG = (item.totalQuantityG ?? 0) + scaledG;
    } else {
      item.hasUnweighedPart = true;
    }
    // Consolidated lines drop the single-entry equivalent — summed free text is unreliable.
    item.equivalent = null;
    item.equivalentUnscaled = false;
    item.optional = item.optional && ing.optional;
    if (!item.groceryCategory && ing.groceryCategory) item.groceryCategory = ing.groceryCategory;
    ing.sectionIds.forEach((sid) => {
      if (!item.sectionIds.includes(sid)) item.sectionIds.push(sid);
    });
    item.ingredientIds.push(ing.id);
  });

  return Array.from(byKey.values()).map(({ item }) => item);
};

const earliestSectionOrder = (item: ShoppingItem, sectionsById: Map<string, RecipeSection>): number => {
  const orders = item.sectionIds
    .map((sid) => sectionsById.get(sid)?.order)
    .filter((v): v is number => typeof v === 'number');
  return orders.length ? Math.min(...orders) : Number.MAX_SAFE_INTEGER;
};

/**
 * Group + order the consolidated items.
 * - workflow: grouped by the first section each ingredient is used in, in section order.
 * - grocery: grouped by grocery category alphabetically, uncategorized last.
 */
export const groupShoppingItems = (
  items: ShoppingItem[],
  order: ShoppingOrder,
  sections: RecipeSection[],
): ShoppingGroup[] => {
  if (order === 'grocery') {
    const groups = new Map<string, ShoppingItem[]>();
    items.forEach((item) => {
      const label = item.groceryCategory || UNCATEGORIZED_LABEL;
      const list = groups.get(label) ?? [];
      list.push(item);
      groups.set(label, list);
    });
    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        if (a === UNCATEGORIZED_LABEL) return 1;
        if (b === UNCATEGORIZED_LABEL) return -1;
        return a.localeCompare(b);
      })
      .map(([label, groupItems]) => ({
        label,
        items: [...groupItems].sort((a, b) => a.displayName.localeCompare(b.displayName)),
      }));
  }

  const sectionsById = new Map(sections.map((s) => [s.id, s]));
  const orderedSections = [...sections].sort((a, b) => a.order - b.order);
  const groups: ShoppingGroup[] = [];
  const placed = new Set<string>();

  orderedSections.forEach((section) => {
    const inSection = items.filter(
      (item) =>
        !placed.has(item.key) && earliestSectionOrder(item, sectionsById) === section.order && item.sectionIds.includes(section.id),
    );
    if (inSection.length === 0) return;
    inSection.forEach((item) => placed.add(item.key));
    groups.push({
      label: section.name,
      items: [...inSection].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    });
  });

  const unplaced = items.filter((item) => !placed.has(item.key));
  if (unplaced.length > 0) {
    groups.push({
      label: 'No section',
      items: [...unplaced].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    });
  }
  return groups;
};
