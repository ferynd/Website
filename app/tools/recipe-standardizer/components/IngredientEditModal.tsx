'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

import { useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { UNLINKED_NUTRITION, type RecipeIngredient } from '../lib/types';

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
 * updated too instead of going stale. Renaming also resets a non-confirmed
 * nutrition link so a stale match is never carried onto a different food.
 */
export default function IngredientEditModal({ ingredient, onSave, onCancel }: IngredientEditModalProps) {
  const [displayName, setDisplayName] = useState(ingredient.displayName);
  const [quantityG, setQuantityG] = useState(ingredient.quantityG === null ? '' : String(ingredient.quantityG));
  const [equivalent, setEquivalent] = useState(ingredient.equivalent);
  const [prepNote, setPrepNote] = useState(ingredient.prepNote);
  const [groceryCategory, setGroceryCategory] = useState(ingredient.groceryCategory);
  const [substitutionNotes, setSubstitutionNotes] = useState(ingredient.substitutionNotes);
  const [optional, setOptional] = useState(ingredient.optional);
  const [error, setError] = useState('');

  const handleSave = () => {
    const name = displayName.trim();
    if (!name) {
      setError('Ingredient name cannot be empty.');
      return;
    }
    let grams: number | null = null;
    if (quantityG.trim() !== '') {
      grams = Number(quantityG);
      if (!Number.isFinite(grams) || grams < 0) {
        setError('Grams must be a non-negative number, or blank for unknown.');
        return;
      }
    }
    const renamed = name.toLowerCase() !== ingredient.displayName.trim().toLowerCase();
    onSave({
      ...ingredient,
      displayName: name,
      quantityG: grams,
      equivalent: equivalent.trim(),
      prepNote: prepNote.trim(),
      groceryCategory: groceryCategory.trim(),
      substitutionNotes: substitutionNotes.trim(),
      optional,
      nutritionLink: renamed ? { ...UNLINKED_NUTRITION } : ingredient.nutritionLink,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface-1 p-6 shadow-xl space-y-4 max-h-[90dvh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-text">Edit ingredient</h3>
        <Input label="Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <div className="flex gap-3">
          <Input
            label="Grams"
            type="number"
            min={0}
            step="any"
            value={quantityG}
            onChange={(e) => setQuantityG(e.target.value)}
            wrapperClassName="flex flex-col flex-1"
          />
          <Input
            label="Equivalent (e.g. 2 cups)"
            value={equivalent}
            onChange={(e) => setEquivalent(e.target.value)}
            wrapperClassName="flex flex-col flex-1"
          />
        </div>
        <Input label="Prep note" value={prepNote} onChange={(e) => setPrepNote(e.target.value)} />
        <Input label="Grocery category" value={groceryCategory} onChange={(e) => setGroceryCategory(e.target.value)} />
        <Input label="Substitution notes" value={substitutionNotes} onChange={(e) => setSubstitutionNotes(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-text-2">
          <input
            type="checkbox"
            checked={optional}
            onChange={(e) => setOptional(e.target.checked)}
            className="rounded border-border bg-surface-2 text-accent focus:ring-accent"
          />
          Optional ingredient
        </label>
        {error && <p className="text-sm text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>Apply change</Button>
        </div>
      </div>
    </div>
  );
}
