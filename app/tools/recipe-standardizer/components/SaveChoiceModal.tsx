'use client';

/* --- CONFIGURATION: save choice copy --- */
/** Offer explicit save actions for edits to an existing recipe. */

const SAVE_CHOICE_COPY = {
  title: (recipeName: string) => `Save changes to “${recipeName}”?`,
  update: 'Update existing recipe',
  saveAsNewLabel: 'Save as new recipe',
  saveAsNew: 'Save as new',
  cancel: 'Cancel — keep editing without saving',
} as const;

import { useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';

interface SaveChoiceModalProps {
  recipeName: string;
  suggestedNewName: string;
  /** What triggered the save, shown so the choice is informed (e.g. "ingredient substitution"). */
  changeSummary: string;
  onUpdate: () => void;
  onSaveAsNew: (name: string) => void;
  onCancel: () => void;
  /** True while an update is already in flight. */
  updateDisabled: boolean;
  /** True while any recipe write is already in flight. */
  saveAsNewDisabled: boolean;
}

/**
 * Guard against accidental overwrites: every meaningful change to an
 * already-saved recipe routes through an explicit
 * update / save-as-new / cancel decision.
 */
export default function SaveChoiceModal({
  recipeName,
  suggestedNewName,
  changeSummary,
  onUpdate,
  onSaveAsNew,
  onCancel,
  updateDisabled,
  saveAsNewDisabled,
}: SaveChoiceModalProps) {
  const [newName, setNewName] = useState(suggestedNewName);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-6 shadow-xl space-y-4">
        <h3 className="text-lg font-semibold text-text">{SAVE_CHOICE_COPY.title(recipeName)}</h3>
        <p className="text-sm text-text-2">{changeSummary}</p>

        <div className="space-y-3">
          <Button
            className="w-full"
            size="sm"
            disabled={updateDisabled}
            onClick={onUpdate}
          >
            Update existing recipe
          </Button>
          <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-2">
            <Input
              label={SAVE_CHOICE_COPY.saveAsNewLabel}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button
              className="w-full"
              size="sm"
              variant="secondary"
              disabled={saveAsNewDisabled || !newName.trim()}
              onClick={() => onSaveAsNew(newName.trim())}
            >
              {SAVE_CHOICE_COPY.saveAsNew}
            </Button>
          </div>
          <Button
            className="w-full"
            size="sm"
            variant="ghost"
            onClick={onCancel}
          >
            {SAVE_CHOICE_COPY.cancel}
          </Button>
        </div>
      </div>
    </div>
  );
}
