'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: ingredient display modes                       */
/* ------------------------------------------------------------ */
const MODES = [
  { key: 'workflow', label: 'Recipe Workflow' },
  { key: 'shopping', label: 'Shopping / Pantry' },
  { key: 'grocery', label: 'Grocery Category' },
] as const;
type IngredientMode = (typeof MODES)[number]['key'];

import { useState } from 'react';
import { AlertTriangle, ChevronDown, Clock, HeartPulse, Link2, MapPin, Pencil } from 'lucide-react';
import Button from '@/components/Button';
import { formatAmount } from '../lib/display';
import type { MatchSummary } from '../lib/nutritionMatch';
import type { NutritionLink, Recipe, RecipeIngredient } from '../lib/types';
import { groupIngredientsForDisplay, type NormalizedWorkflow } from '../lib/workflow';
import ConsolidatedList from './ConsolidatedList';
import IngredientEditModal from './IngredientEditModal';

interface IngredientsViewProps {
  recipe: Recipe;
  workflow: NormalizedWorkflow;
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
 * The single hub for all ingredient views, switched by a compact segmented
 * control:
 * - Recipe Workflow: ingredients grouped by their prep group (imported or
 *   derived), with each group's destination, schedule, and holding note in
 *   the header; rows stay phone-narrow — prep/substitution/conversion notes
 *   sit behind a per-row disclosure. Inline editing and Nutrition Tracker
 *   link status/matching stay on every row.
 * - Shopping / Pantry: consolidated checklist grouped by first-use section.
 * - Grocery Category: the same consolidated checklist grouped by category.
 * Checkbox ticks are shared between the two consolidated modes and survive
 * mode switches (view state only — not persisted).
 */
export default function IngredientsView({ recipe, workflow, factor, onIngredientChange, onRunNutritionMatch }: IngredientsViewProps) {
  const [mode, setMode] = useState<IngredientMode>('workflow');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<RecipeIngredient | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchMessage, setMatchMessage] = useState('');

  const toggleChecked = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleNotes = (id: string) => {
    setOpenNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  const renderRow = (ing: RecipeIngredient) => {
    const amount = formatAmount(ing, factor);
    const hasNotes = Boolean(ing.prepNote || ing.substitutionNotes || ing.conversionNotes);
    const notesOpen = openNotes.has(ing.id);
    return (
      <li key={ing.id} className="rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium tabular-nums text-text">{amount.grams}</span>
          {amount.equivalent && (
            <span className="text-text-3">({amount.equivalent}{amount.equivalentUnscaled ? ' at 1×' : ''})</span>
          )}
          <span className="text-text">{ing.displayName}</span>
          {ing.optional && <span className="text-xs italic text-text-3">optional</span>}
          <span className="ml-auto flex items-center gap-1.5">
            <NutritionBadge link={ing.nutritionLink} />
            {hasNotes && (
              <button
                type="button"
                onClick={() => toggleNotes(ing.id)}
                aria-expanded={notesOpen}
                aria-label={`${notesOpen ? 'Hide' : 'Show'} notes for ${ing.displayName}`}
                className="rounded p-1 text-text-3 hover:text-accent hover:bg-surface-1 focus-ring"
              >
                <ChevronDown size={14} className={`transition-transform ${notesOpen ? 'rotate-180' : ''}`} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(ing)}
              aria-label={`Edit ${ing.displayName}`}
              className="rounded p-1 text-text-3 hover:text-accent hover:bg-surface-1 focus-ring"
            >
              <Pencil size={14} />
            </button>
          </span>
        </div>
        {hasNotes && notesOpen && (
          <div className="mt-1.5 space-y-0.5 border-t border-border pt-1.5 text-xs text-text-2">
            {ing.prepNote && <p>Prep: {ing.prepNote}</p>}
            {ing.substitutionNotes && <p>Substitution: {ing.substitutionNotes}</p>}
            {ing.conversionNotes && <p>Conversion: {ing.conversionNotes}</p>}
          </div>
        )}
      </li>
    );
  };

  const displayGroups = groupIngredientsForDisplay(recipe, workflow);

  return (
    <div className="space-y-4">
      {/* Segmented mode control — wraps on narrow screens */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-2 p-1 w-fit max-w-full" role="group" aria-label="Ingredient view mode">
        {MODES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            aria-pressed={mode === key}
            className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-ring ${
              mode === key ? 'bg-accent text-black' : 'text-text-2 hover:text-text hover:bg-surface-1'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'workflow' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" onClick={runMatch} loading={matching} className="inline-flex items-center gap-2">
              <HeartPulse size={16} /> Match against Nutrition Tracker foods
            </Button>
            {matchMessage && <p className="text-xs text-text-2">{matchMessage}</p>}
          </div>

          {displayGroups.map((group) => (
            <div key={group.key}>
              <div className="mb-2 space-y-0.5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-text-3">{group.title}</h3>
                {(group.destination || group.timingLabel) && (
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-3">
                    {group.timingLabel && (
                      <span className="inline-flex items-center gap-1"><Clock size={11} /> {group.timingLabel}</span>
                    )}
                    {group.destination && (
                      <span className="inline-flex items-center gap-1"><MapPin size={11} /> {group.destination}</span>
                    )}
                  </p>
                )}
                {group.holdNote && (
                  <p className="flex items-center gap-1 text-xs text-warning">
                    <AlertTriangle size={11} /> {group.holdNote}
                  </p>
                )}
              </div>
              <ul className="space-y-1">{group.ingredients.map(renderRow)}</ul>
            </div>
          ))}
        </>
      )}

      {mode !== 'workflow' && (
        <ConsolidatedList
          recipe={recipe}
          factor={factor}
          order={mode === 'shopping' ? 'workflow' : 'grocery'}
          checked={checked}
          onToggle={toggleChecked}
        />
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
