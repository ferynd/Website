/* --- CONFIGURATION: bake review copy --- */
/** Review measures the bake cannot rescale; keeping one always persists its cumulative annotation. */
'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/Button';
import {
  formatGrams,
  type BakeEquivalentIssue,
  type BakeIssueReason,
  type EquivalentBakeChoice,
} from '../lib/scaling';

const BAKE_COPY = {
  titleLead: 'Bake ',
  titleTail: ' into the recipe?',
  lead:
    'These equivalent measures can\'t be rescaled automatically. Grams will be ' +
    'scaled; choose what to do with each equivalent.',
  keep: 'Keep it, marked “not rescaled”',
  clear: 'Remove it',
  footer:
    'Kept equivalents show a “not rescaled” note everywhere, including the ' +
    'copied JSON, until you edit them.',
  confirm: 'Bake into recipe',
  cancel: 'Cancel',
} as const;
const REASON_COPY: Record<BakeIssueReason, string> = {
  range: 'Ranges aren\'t rescaled.',
  unparseable: 'No leading amount to rescale.',
  'already-stale': 'Already marked “not rescaled” from an earlier bake.',
};

interface BakeReviewModalProps {
  scaleLabel: string;
  issues: BakeEquivalentIssue[];
  onConfirm: (choices: Record<string, EquivalentBakeChoice>) => void;
  onCancel: () => void;
}

function IssueRow({ issue, choice, onChange }: {
  issue: BakeEquivalentIssue;
  choice: EquivalentBakeChoice;
  onChange: (choice: EquivalentBakeChoice) => void;
}) {
  return (
    <fieldset className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
      <legend className="font-medium">{issue.displayName}</legend>
      <p className="text-sm text-text-2">
        {formatGrams(issue.gramsBefore)} → {formatGrams(issue.gramsAfter)}
      </p>
      <p className="text-sm">“{issue.equivalent}”</p>
      <p className="text-xs text-warning">{REASON_COPY[issue.reason]}</p>
      {(['annotate', 'clear'] as const).map((value) => (
        <label key={value} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`bake-${issue.ingredientId}`}
            value={value}
            checked={choice === value}
            onChange={() => onChange(value)}
          />
          {value === 'annotate' ? BAKE_COPY.keep : BAKE_COPY.clear}
        </label>
      ))}
    </fieldset>
  );
}

/** Explicit review before changing grams while keeping old-batch equivalent text. */
export default function BakeReviewModal({ scaleLabel, issues, onConfirm, onCancel }: BakeReviewModalProps) {
  const [choices, setChoices] = useState<Record<string, EquivalentBakeChoice>>(() =>
    Object.fromEntries(issues.map((issue) => [issue.ingredientId, 'annotate'])),
  );
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bake-review-title"
    >
      <div className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-border bg-surface-1 p-6 shadow-xl">
        <h3 id="bake-review-title" className="text-lg font-semibold">
          {BAKE_COPY.titleLead}{scaleLabel}{BAKE_COPY.titleTail}
        </h3>
        <p className="text-sm text-text-2">{BAKE_COPY.lead}</p>
        {issues.map((issue) => (
          <IssueRow
            key={issue.ingredientId}
            issue={issue}
            choice={choices[issue.ingredientId] ?? 'annotate'}
            onChange={(choice) => setChoices((previous) => ({ ...previous, [issue.ingredientId]: choice }))}
          />
        ))}
        <p className="text-xs text-text-3">{BAKE_COPY.footer}</p>
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
          >
            {BAKE_COPY.cancel}
          </Button>
          <Button size="sm" onClick={() => onConfirm(choices)}>
            {BAKE_COPY.confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
