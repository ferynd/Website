'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

import { useMemo, useState } from 'react';
import { buildShoppingItems, groupShoppingItems, type ShoppingOrder } from '../lib/shoppingList';
import { formatGrams } from '../lib/scaling';
import type { Recipe } from '../lib/types';

interface ShoppingListViewProps {
  recipe: Recipe;
  factor: number;
}

/**
 * Consolidated shopping / pantry-pull / mise en place list, toggleable
 * between workflow order (default) and grocery category. Checkboxes are
 * ephemeral view state — a page reload gives a fresh list.
 */
export default function ShoppingListView({ recipe, factor }: ShoppingListViewProps) {
  const [order, setOrder] = useState<ShoppingOrder>('workflow');
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () => groupShoppingItems(buildShoppingItems(recipe, factor), order, recipe.sections),
    [recipe, factor, order],
  );

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-border overflow-hidden" role="group" aria-label="List order">
        {(['workflow', 'grocery'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setOrder(mode)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              order === mode ? 'bg-accent text-black' : 'bg-surface-2 text-text-2 hover:text-text'
            }`}
          >
            {mode === 'workflow' ? 'Workflow order' : 'Grocery category'}
          </button>
        ))}
      </div>

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
                      onChange={() => toggle(item.key)}
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
