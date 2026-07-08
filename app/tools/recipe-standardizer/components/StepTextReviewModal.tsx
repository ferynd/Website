'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

import { useState } from 'react';
import Button from '@/components/Button';
import type { AffectedStep, StepTextUpdate } from '../lib/stepTextUpdate';
import type { Recipe } from '../lib/types';

interface StepTextReviewModalProps {
  oldName: string;
  newName: string;
  recipe: Recipe;
  items: AffectedStep[];
  onApply: (updates: StepTextUpdate[]) => void;
  onSkip: () => void;
}

/**
 * After an ingredient rename, this modal lists every prep/active step that
 * references the ingredient or mentions the old name, prefilled with a safe
 * word-boundary replacement where one was possible. The user reviews and can
 * adjust each text before it is applied — step prose is never rewritten
 * silently.
 */
export default function StepTextReviewModal({
  oldName,
  newName,
  recipe,
  items,
  onApply,
  onSkip,
}: StepTextReviewModalProps) {
  const [texts, setTexts] = useState<string[]>(
    items.map((item) => item.suggestedText ?? item.originalText),
  );

  const sectionName = (sectionId: string): string =>
    recipe.sections.find((s) => s.id === sectionId)?.name ?? '';

  const changedUpdates = (): StepTextUpdate[] =>
    items
      .map((item, i) => ({ list: item.list, stepId: item.stepId, text: texts[i] }))
      .filter((update, i) => update.text.trim() !== items[i].originalText.trim() && update.text.trim() !== '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-surface-1 p-6 shadow-xl space-y-4 max-h-[90dvh] overflow-y-auto">
        <div>
          <h3 className="text-lg font-semibold text-text">
            Update step text for “{oldName}” → “{newName}”?
          </h3>
          <p className="mt-1 text-sm text-text-2">
            Ingredient lists and step chips already show “{newName}”, but these step instructions
            are free text and could still say “{oldName}”. Review each one — edits apply to the
            working copy and still go through the normal save flow.
          </p>
        </div>

        <ul className="space-y-3">
          {items.map((item, i) => (
            <li key={`${item.list}-${item.stepId}`} className="rounded-lg border border-border bg-surface-2 p-3 space-y-2">
              <p className="text-xs text-text-3">
                {item.list === 'prepSteps' ? 'Prep' : 'Cook'} · {sectionName(item.sectionId)}
                {item.suggestedText === null && (
                  <span className="ml-2 text-warning">
                    “{oldName}” not found verbatim — edit manually if this step needs it.
                  </span>
                )}
              </p>
              <p className="text-xs text-text-3">Current: {item.originalText}</p>
              <textarea
                value={texts[i]}
                onChange={(e) =>
                  setTexts((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))
                }
                rows={2}
                className="w-full rounded-lg bg-surface-1 border border-border text-text p-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
                aria-label={`Updated text for step in ${sectionName(item.sectionId)}`}
              />
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onSkip}>
            Keep original text
          </Button>
          <Button size="sm" onClick={() => onApply(changedUpdates())}>
            Apply step updates
          </Button>
        </div>
      </div>
    </div>
  );
}
