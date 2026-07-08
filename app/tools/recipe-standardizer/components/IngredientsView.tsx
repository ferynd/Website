'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

import { useState } from 'react';
import { HeartPulse, Link2, Pencil } from 'lucide-react';
import Button from '@/components/Button';
import { formatAmount } from '../lib/display';
import type { MatchSummary } from '../lib/nutritionMatch';
import type { NutritionLink, Recipe, RecipeIngredient } from '../lib/types';
import IngredientEditModal from './IngredientEditModal';

interface IngredientsViewProps {
  recipe: Recipe;
  factor: number;
  onIngredientChange: (updated: RecipeIngredient) => void;
  onRunNutritionMatch: () => Promise<MatchSummary>;
}

function NutritionBadge({ link }: { link: NutritionLink }) {
  if (link.status === 'linked') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success" title={`Linked to "${link.matchedName}"`}>
        <Link2 size={11} /> linked
      </span>
    );
  }
  if (link.status === 'likely') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning" title={`Likely "${link.matchedName}" (${Math.round((link.matchConfidence ?? 0) * 100)}%)`}>
        <Link2 size={11} /> likely: {link.matchedName}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-surface-1 border border-border px-2 py-0.5 text-xs text-text-3" title="No matching Nutrition Tracker food item — add one there to link it later.">
      unlinked
    </span>
  );
}

/**
 * All ingredients grouped by their primary workflow section, with inline
 * editing and Nutrition Tracker link status. Matching is on-demand (one
 * Firestore read of the CalorieTracker foodItems list) and never blocks
 * saving or using the recipe.
 */
export default function IngredientsView({ recipe, factor, onIngredientChange, onRunNutritionMatch }: IngredientsViewProps) {
  const [editing, setEditing] = useState<RecipeIngredient | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchMessage, setMatchMessage] = useState('');

  const runMatch = async () => {
    setMatching(true);
    setMatchMessage('');
    try {
      const summary = await onRunNutritionMatch();
      const unlinkedNote = summary.unlinked > 0
        ? ` For unlinked ingredients, add a matching saved food in the Nutrition Tracker and re-run matching.`
        : '';
      setMatchMessage(
        `Matched against Nutrition Tracker foods: ${summary.linked} linked, ${summary.likely} likely, ${summary.unlinked} unlinked.${unlinkedNote}`,
      );
    } catch (err) {
      setMatchMessage(`Matching failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setMatching(false);
    }
  };

  const orderedSections = [...recipe.sections].sort((a, b) => a.order - b.order);
  const unassigned = recipe.ingredients.filter((ing) => !ing.primarySectionId);

  const renderRow = (ing: RecipeIngredient) => {
    const amount = formatAmount(ing, factor);
    return (
      <li key={ing.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm">
        <span className="font-medium tabular-nums text-text">{amount.grams}</span>
        {amount.equivalent && (
          <span className="text-text-3">({amount.equivalent}{amount.equivalentUnscaled ? ' at 1×' : ''})</span>
        )}
        <span className="text-text">{ing.displayName}</span>
        {ing.prepNote && <span className="text-text-3">— {ing.prepNote}</span>}
        {ing.optional && <span className="text-xs italic text-text-3">optional</span>}
        <span className="ml-auto flex items-center gap-2">
          <NutritionBadge link={ing.nutritionLink} />
          <button
            type="button"
            onClick={() => setEditing(ing)}
            aria-label={`Edit ${ing.displayName}`}
            className="rounded p-1 text-text-3 hover:text-accent hover:bg-surface-1 focus-ring"
          >
            <Pencil size={14} />
          </button>
        </span>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={runMatch} loading={matching} className="inline-flex items-center gap-2">
          <HeartPulse size={16} /> Match against Nutrition Tracker foods
        </Button>
        {matchMessage && <p className="text-xs text-text-2">{matchMessage}</p>}
      </div>

      {orderedSections.map((section) => {
        const items = recipe.ingredients.filter((ing) => ing.primarySectionId === section.id);
        if (items.length === 0) return null;
        return (
          <div key={section.id}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-3">{section.name}</h3>
            <ul className="space-y-1">{items.map(renderRow)}</ul>
          </div>
        );
      })}
      {unassigned.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-3">No section</h3>
          <ul className="space-y-1">{unassigned.map(renderRow)}</ul>
        </div>
      )}

      {editing && (
        <IngredientEditModal
          ingredient={editing}
          onSave={(updated) => { setEditing(null); onIngredientChange(updated); }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
