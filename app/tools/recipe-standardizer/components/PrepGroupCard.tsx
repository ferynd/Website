'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

import { AlertTriangle, ChevronRight, Clock, CornerDownRight, MapPin } from 'lucide-react';
import { formatAmount } from '../lib/display';
import type { Technique } from '../lib/techniques';
import type { NormalizedPrepGroup } from '../lib/workflow';
import TechniqueHelp from './TechniqueHelp';

interface PrepGroupCardProps {
  group: NormalizedPrepGroup;
  factor: number;
  /** Techniques to explain here (first occurrence only); may be empty. */
  techniques: Technique[];
}

/**
 * One named prepared input: what it is, when to make it, where it goes, how
 * to hold it, and exactly what goes into it. Critical sequencing (timing +
 * hold note) stays visible; extra detail and technique help are collapsed.
 * For v1 recipes the group is section-derived and shows its original prep
 * steps instead of a single instruction.
 */
export default function PrepGroupCard({ group, factor, techniques }: PrepGroupCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-4 space-y-2.5">
      <div className="space-y-1">
        <h3 className="font-semibold text-text">{group.name}</h3>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-info">
            <Clock size={12} /> {group.timingLabel}
          </span>
          {group.destination && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-1 border border-border px-2 py-0.5 text-text-2">
              <MapPin size={12} /> {group.destination}
            </span>
          )}
          {group.firstUseLabel && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-1 border border-border px-2 py-0.5 text-text-3">
              <CornerDownRight size={12} /> Used in: {group.firstUseLabel}
            </span>
          )}
        </div>
      </div>

      {group.holdNote && (
        <p className="flex items-start gap-1.5 text-sm text-warning">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {group.holdNote}
        </p>
      )}

      {group.instruction && <p className="text-sm text-text">{group.instruction}</p>}

      {group.ingredients.length > 0 && (
        <ul className="space-y-1">
          {group.ingredients.map((ing) => {
            const amount = formatAmount(ing, factor);
            return (
              <li key={ing.id} className="text-sm text-text flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium tabular-nums">{amount.grams}</span>
                {amount.equivalent && (
                  <span className="text-text-3">
                    ({amount.equivalent}{amount.equivalentUnscaled ? ' at 1×' : ''})
                  </span>
                )}
                <span>{ing.displayName}</span>
                {ing.prepNote && <span className="text-text-3">— {ing.prepNote}</span>}
                {ing.optional && <span className="text-xs italic text-text-3">optional</span>}
              </li>
            );
          })}
        </ul>
      )}

      {group.steps.length > 0 && (
        <ol className="space-y-1.5 border-t border-border pt-2.5">
          {group.steps.map((step, i) => (
            <li key={step.id} className="flex gap-2 text-sm text-text">
              <span className="flex-shrink-0 tabular-nums text-text-3">{i + 1}.</span>
              <div className="min-w-0">
                <p>{step.text}</p>
                {(step.timing || step.dependencyNote) && (
                  <p className="mt-0.5 text-xs text-text-3">
                    {[step.timing, step.dependencyNote].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {group.details && (
        <details className="group/details">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1 rounded text-xs text-text-3 hover:text-text-2 focus-ring">
            <ChevronRight size={12} className="transition-transform group-open/details:rotate-90" />
            More detail
          </summary>
          <p className="mt-1 ps-4 text-xs text-text-2">{group.details}</p>
        </details>
      )}

      <TechniqueHelp techniques={techniques} />
    </div>
  );
}
