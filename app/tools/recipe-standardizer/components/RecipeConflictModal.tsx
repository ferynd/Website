/* --- CONFIGURATION: recipe conflict copy --- */
/** Offer explicit conflict choices; an overwrite remains tied to the observed remote revision. */
'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { conflictChoices, type RecipeConflict, type RecipeConflictChoice } from '../lib/recipeRevision';

const CONFLICT_COPY = {
  changedTitle: 'This recipe changed somewhere else',
  changedLead: 'Another tab or device saved “',
  changedTail: '” after you opened it. Choose which version to keep.',
  deletedTitle: 'This recipe was deleted somewhere else',
  deletedLead: 'Another tab or device deleted “',
  deletedTail: '”. Your copy here is not saved.',
  reloadDirty: 'Reload the saved version (discard my changes)',
  reloadClean: 'Reload the saved version',
  overwrite: 'Overwrite it with my version',
  overwriteNote:
    'Replaces the other changes. Nutrition Tracker export links on the saved ' +
    'version are kept.',
  saveAsNewLabel: 'Save my version as a new recipe',
  saveAsNew: 'Save as new',
  close: 'Close this recipe without saving',
  keepEditing: 'Cancel — keep editing',
  working: 'Working…',
} as const;

interface RecipeConflictModalProps {
  conflict: RecipeConflict;
  recipeName: string;
  dirty: boolean;
  suggestedNewName: string;
  busy: boolean;
  onReload: () => void;
  onOverwrite: () => void;
  onSaveAsNew: (name: string) => void;
  onClose: () => void;
  onKeepEditing: () => void;
}

function ChoiceButton({ choice, props, name, setName }: {
  choice: RecipeConflictChoice;
  props: RecipeConflictModalProps;
  name: string;
  setName: (name: string) => void;
}) {
  const { busy, dirty, onReload, onOverwrite, onSaveAsNew, onClose, onKeepEditing } = props;
  switch (choice) {
    case 'reload':
      return (
        <Button
          className="w-full"
          size="sm"
          disabled={busy}
          onClick={onReload}
        >
          {dirty ? CONFLICT_COPY.reloadDirty : CONFLICT_COPY.reloadClean}
        </Button>
      );
    case 'overwrite':
      return (
        <div className="space-y-2">
          <Button
            className="w-full"
            size="sm"
            disabled={busy}
            onClick={onOverwrite}
          >
            {CONFLICT_COPY.overwrite}
          </Button>
          <p className="text-xs text-warning">{CONFLICT_COPY.overwriteNote}</p>
        </div>
      );
    case 'save-as-new':
      return (
        <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
          <Input
            label={CONFLICT_COPY.saveAsNewLabel}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            className="w-full"
            size="sm"
            variant="secondary"
            disabled={busy || !name.trim()}
            onClick={() => onSaveAsNew(name.trim())}
          >
            {CONFLICT_COPY.saveAsNew}
          </Button>
        </div>
      );
    case 'close':
      return (
        <Button
          className="w-full"
          size="sm"
          disabled={busy}
          onClick={onClose}
        >
          {CONFLICT_COPY.close}
        </Button>
      );
    case 'keep-editing':
      return (
        <Button
          className="w-full"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onKeepEditing}
        >
          {CONFLICT_COPY.keepEditing}
        </Button>
      );
    default: {
      const exhaustive: never = choice;
      return exhaustive;
    }
  }
}

/** Render only the actions valid for this remote change or deletion. */
export default function RecipeConflictModal(props: RecipeConflictModalProps) {
  const [name, setName] = useState(props.suggestedNewName);
  const { conflict, recipeName, busy, onKeepEditing } = props;
  const changed = conflict.kind === 'changed';
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onKeepEditing();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [busy, onKeepEditing]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recipe-conflict-title"
    >
      <div className="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-xl border border-border bg-surface-1 p-6 shadow-xl">
        <h3 id="recipe-conflict-title" className="text-lg font-semibold">
          {changed ? CONFLICT_COPY.changedTitle : CONFLICT_COPY.deletedTitle}
        </h3>
        <p className="text-sm text-text-2">
          {changed ? CONFLICT_COPY.changedLead : CONFLICT_COPY.deletedLead}
          {recipeName}
          {changed ? CONFLICT_COPY.changedTail : CONFLICT_COPY.deletedTail}
        </p>
        {conflictChoices(conflict, props.dirty).map((choice) => (
          <ChoiceButton
            key={choice}
            choice={choice}
            props={props}
            name={name}
            setName={setName}
          />
        ))}
        {busy && <p className="text-sm text-text-3">{CONFLICT_COPY.working}</p>}
      </div>
    </div>
  );
}
