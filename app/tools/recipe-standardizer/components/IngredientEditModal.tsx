/* --- CONFIGURATION: ingredient edit copy --- */
/** Ingredient edits retain stale equivalent provenance until correction or explicit confirmation. */
'use client';

const VIEW_COPY = {
  ingredientNameCannotBeEmpty: 'Ingredient name cannot be empty.',
  gramsMustBeANonNegative: 'Grams must be a non-negative number, or blank for unknown.',
  editIngredient: 'Edit ingredient',
  name: 'Name',
  grams: 'Grams',
  equivalentLabel: 'Equivalent (e.g. 2 cups)',
  prepNote: 'Prep note',
  groceryCategory: 'Grocery category',
  substitutionNotes: 'Substitution notes',
  optionalIngredient: 'Optional ingredient',
  cancel: 'Cancel',
  applyChange: 'Apply change',
} as const;

const ANNOTATION_COPY = {
  warning: (factor: string) =>
    `This equivalent was written before a ${factor} bake and wasn't rescaled. ` +
    'Edit it, or confirm it matches the current grams.',
  confirm: 'The equivalent matches the current grams',
} as const;

import { useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { formatFactor, nextEquivalentBakeFactor } from '../lib/scaling';
import { linkAfterRename } from '../lib/nutritionLink';
import type { RecipeIngredient } from '../lib/types';

interface IngredientEditModalProps {
  ingredient: RecipeIngredient;
  onSave: (updated: RecipeIngredient) => void;
  onCancel: () => void;
}

/**
 * Edit one ingredient. Because steps reference ingredients by id, a rename
 * or substitution here flows through every structured display — sections,
 * step chips, and the shopping modes. Step prose is handled separately: a
 * rename opens StepTextReviewModal so affected instruction text can be
 * updated too instead of going stale. Renaming demotes a confirmed nutrition
 * link to a candidate for the same food with its gram basis cleared.
 */
export default function IngredientEditModal({ ingredient, onSave, onCancel }: IngredientEditModalProps) {
  const [displayName, setDisplayName] = useState(ingredient.displayName);
  const [quantityG, setQuantityG] = useState(ingredient.quantityG === null ? '' : String(ingredient.quantityG));
  const [markedCorrect, setMarkedCorrect] = useState(false);
  const [equivalent, setEquivalent] = useState(ingredient.equivalent);
  const [prepNote, setPrepNote] = useState(ingredient.prepNote);
  const [groceryCategory, setGroceryCategory] = useState(ingredient.groceryCategory);
  const [substitutionNotes, setSubstitutionNotes] = useState(ingredient.substitutionNotes);
  const [optional, setOptional] = useState(ingredient.optional);
  const [error, setError] = useState('');

  const handleSave = () => {
    const name = displayName.trim();
    if (!name) {
      setError(VIEW_COPY.ingredientNameCannotBeEmpty);
      return;
    }
    let grams: number | null = null;
    if (quantityG.trim() !== '') {
      grams = Number(quantityG);
      if (!Number.isFinite(grams) || grams < 0) {
        setError(VIEW_COPY.gramsMustBeANonNegative);
        return;
      }
    }
    const renamed = name.toLowerCase() !== ingredient.displayName.trim().toLowerCase();
    onSave({
      ...ingredient,
      displayName: name,
      quantityG: grams,
      equivalent: equivalent.trim(),
      equivalentBakeFactor: nextEquivalentBakeFactor(ingredient, equivalent.trim(), markedCorrect, grams),
      prepNote: prepNote.trim(),
      groceryCategory: groceryCategory.trim(),
      substitutionNotes: substitutionNotes.trim(),
      optional,
      nutritionLink: renamed ? linkAfterRename(ingredient.nutritionLink) : ingredient.nutritionLink,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface-1 p-6 shadow-xl space-y-4 max-h-[90dvh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-text">{VIEW_COPY.editIngredient}</h3>
        <Input
          label={VIEW_COPY.name}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <div className="flex gap-3">
          <Input
            label={VIEW_COPY.grams}
            type="number"
            min={0}
            step="any"
            value={quantityG}
            onChange={(e) => setQuantityG(e.target.value)}
            wrapperClassName="flex flex-col flex-1"
          />
          <Input
            label={VIEW_COPY.equivalentLabel}
            value={equivalent}
            onChange={(e) => setEquivalent(e.target.value)}
            wrapperClassName="flex flex-col flex-1"
          />
        </div>
        {ingredient.equivalentBakeFactor !== null && (
          <div className="space-y-2">
            <p className="text-xs text-warning">
              {ANNOTATION_COPY.warning(formatFactor(ingredient.equivalentBakeFactor))}
            </p>
            <label className="flex items-center gap-2 text-sm text-text-2">
              <input
                type="checkbox"
                checked={markedCorrect}
                onChange={(event) => setMarkedCorrect(event.target.checked)}
              />
              {ANNOTATION_COPY.confirm}
            </label>
          </div>
        )}
        <Input
          label={VIEW_COPY.prepNote}
          value={prepNote}
          onChange={(e) => setPrepNote(e.target.value)}
        />
        <Input
          label={VIEW_COPY.groceryCategory}
          value={groceryCategory}
          onChange={(e) => setGroceryCategory(e.target.value)}
        />
        <Input
          label={VIEW_COPY.substitutionNotes}
          value={substitutionNotes}
          onChange={(e) => setSubstitutionNotes(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-text-2">
          <input
            type="checkbox"
            checked={optional}
            onChange={(e) => setOptional(e.target.checked)}
            className="rounded border-border bg-surface-2 text-accent focus:ring-accent"
          />
          {VIEW_COPY.optionalIngredient}
        </label>
        {error && <p className="text-sm text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
          >{VIEW_COPY.cancel}</Button>
          <Button size="sm" onClick={handleSave}>{VIEW_COPY.applyChange}</Button>
        </div>
      </div>
    </div>
  );
}
