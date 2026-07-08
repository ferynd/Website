'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

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
}: SaveChoiceModalProps) {
  const [newName, setNewName] = useState(suggestedNewName);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-6 shadow-xl space-y-4">
        <h3 className="text-lg font-semibold text-text">Save changes to “{recipeName}”?</h3>
        <p className="text-sm text-text-2">{changeSummary}</p>

        <div className="space-y-3">
          <Button className="w-full" size="sm" onClick={onUpdate}>
            Update existing recipe
          </Button>
          <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-2">
            <Input
              label="Save as new recipe"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button
              className="w-full"
              size="sm"
              variant="secondary"
              disabled={!newName.trim()}
              onClick={() => onSaveAsNew(newName.trim())}
            >
              Save as new
            </Button>
          </div>
          <Button className="w-full" size="sm" variant="ghost" onClick={onCancel}>
            Cancel — keep editing without saving
          </Button>
        </div>
      </div>
    </div>
  );
}
