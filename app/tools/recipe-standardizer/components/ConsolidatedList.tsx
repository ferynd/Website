'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

import { useMemo } from 'react';
import { buildShoppingItems, groupShoppingItems, type ShoppingOrder } from '../lib/shoppingList';
import { formatGrams } from '../lib/scaling';
import type { Recipe } from '../lib/types';

interface ConsolidatedListProps {
  recipe: Recipe;
  factor: number;
  /** 'workflow' = grouped by first-use section; 'grocery' = by grocery category. */
  order: ShoppingOrder;
  /** Checked item keys — owned by the parent so ticks survive mode switches. */
  checked: Set<string>;
  onToggle: (key: string) => void;
}

/**
 * Consolidated shopping / pantry-pull / mise en place checklist, rendered
 * inside the Ingredients panel's Shopping/Pantry and Grocery Category modes.
 * Duplicate ingredient names consolidate into one line with summed grams.
 */
export default function ConsolidatedList({ recipe, factor, order, checked, onToggle }: ConsolidatedListProps) {
  const groups = useMemo(
    () => groupShoppingItems(buildShoppingItems(recipe, factor), order, recipe.sections),
    [recipe, factor, order],
  );

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-3">{group.label}</h3>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const isChecked = checked.has(item.key);
              return (
                <li key={item.key}>
                  <label className={`flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm cursor-pointer ${isChecked ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggle(item.key)}
                      className="rounded border-border bg-surface-1 text-accent focus:ring-accent"
                    />
                    <span className={`text-text ${isChecked ? 'line-through' : ''}`}>{item.displayName}</span>
                    <span className="font-medium tabular-nums text-text-2">
                      {item.totalQuantityG !== null ? formatGrams(item.totalQuantityG) : ''}
                      {item.hasUnweighedPart ? (item.totalQuantityG !== null ? ' + unweighed part' : 'no weight') : ''}
                    </span>
                    {item.equivalent && <span className="text-text-3">({item.equivalent})</span>}
                    {item.optional && <span className="text-xs italic text-text-3">optional</span>}
                    {item.ingredientIds.length > 1 && (
                      <span className="text-xs text-text-3">used in {item.sectionIds.length} sections</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
