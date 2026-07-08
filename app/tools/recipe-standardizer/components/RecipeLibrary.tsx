'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

import { useState } from 'react';
import { BookOpen, Trash2 } from 'lucide-react';
import Button from '@/components/Button';
import { formatUpdatedAt } from '../lib/display';
import type { SavedRecipeMeta } from '../lib/types';

interface RecipeLibraryProps {
  recipes: SavedRecipeMeta[];
  currentId: string | null;
  listError: string | null;
  onLoad: (recipeId: string) => void;
  onDelete: (recipeId: string) => void;
}

/** Saved-recipe list with load + (confirmed) delete. */
export default function RecipeLibrary({ recipes, currentId, listError, onLoad, onDelete }: RecipeLibraryProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (listError) {
    return <p className="text-sm text-error">{listError}</p>;
  }
  if (recipes.length === 0) {
    return <p className="text-sm text-text-3">No saved recipes yet — import one below to get started.</p>;
  }

  return (
    <ul className="space-y-2">
      {recipes.map((meta) => (
        <li
          key={meta.id}
          className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 ${
            meta.id === currentId ? 'border-accent bg-accent/5' : 'border-border bg-surface-2'
          }`}
        >
          <div className="flex-1 min-w-0">
            <p className="font-medium text-text truncate">{meta.name}</p>
            <p className="text-xs text-text-3">
              {meta.sectionCount} sections · {meta.ingredientCount} ingredients
              {meta.updatedAtMs ? ` · updated ${formatUpdatedAt(meta.updatedAtMs)}` : ''}
            </p>
          </div>
          {confirmDeleteId === meta.id ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-error">Delete permanently?</span>
              <Button size="sm" variant="danger" onClick={() => { setConfirmDeleteId(null); onDelete(meta.id); }}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                Keep
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => onLoad(meta.id)} className="inline-flex items-center gap-1">
                <BookOpen size={14} /> Open
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${meta.name}`}
                onClick={() => setConfirmDeleteId(meta.id)}
              >
                <Trash2 size={14} className="text-error" />
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
