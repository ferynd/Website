"use client";

import type { Reflection } from '../lib/types';

interface Props {
  reflection: Reflection;
  name: string;
}

const Field = ({ label, value }: { label: string; value?: string }) => {
  if (!value?.trim()) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-3">{label}</p>
      <p className="text-sm text-text whitespace-pre-wrap">{value}</p>
    </div>
  );
};

const RESOLVED_LABEL: Record<Reflection['feelsResolved'], string> = {
  yes: 'Yes — feels resolved',
  partially: 'Partially',
  no: 'Not yet',
};

export default function ReflectionView({ reflection, name }: Props) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-text">{name}&apos;s reflection</h3>
        <span className={`text-xs rounded-full px-3 py-1 border ${
          reflection.feelsResolved === 'yes'
            ? 'bg-green-900/30 text-green-300 border-green-700/40'
            : reflection.feelsResolved === 'partially'
            ? 'bg-yellow-900/30 text-yellow-300 border-yellow-700/40'
            : 'bg-surface-2 text-text-3 border-border'
        }`}>
          {RESOLVED_LABEL[reflection.feelsResolved]}
        </span>
      </div>

      <Field label="Trigger" value={reflection.trigger} />
      <Field label="What happened" value={reflection.whatHappened} />
      <Field label="What I felt" value={reflection.whatIFelt} />
      <Field label="Physical / emotional signals" value={reflection.physicalOrEmotionalSignals} />
      <Field label="What I thought they meant" value={reflection.whatIThoughtTheyMeant} />
      <Field label="What felt hurtful" value={reflection.whatIFeltHurtBy} />
      <Field label="What I needed" value={reflection.whatINeeded} />
      <Field label="What helped" value={reflection.whatHelped} />
      <Field label="What made it worse" value={reflection.whatMadeItWorse} />
      <Field label="What I am owning" value={reflection.whatIAmOwning} />
      <Field label="What I will do differently" value={reflection.whatIWillDoDifferently} />
      <Field label="Unresolved pieces" value={reflection.unresolvedPieces} />

      {reflection.tags?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {reflection.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs bg-surface-2 border border-border rounded-full px-2 py-0.5 text-text-2"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
