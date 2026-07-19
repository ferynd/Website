'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

import { ArrowRight, ChevronRight, Clock, Eye, Link2, Package, Thermometer, Wrench } from 'lucide-react';
import { formatAmount } from '../lib/display';
import type { Technique } from '../lib/techniques';
import type { NormalizedExecutionSection, NormalizedStep } from '../lib/workflow';
import type { Recipe } from '../lib/types';
import TechniqueHelp from './TechniqueHelp';

interface ExecutionSectionCardProps {
  data: NormalizedExecutionSection;
  recipe: Recipe;
  factor: number;
  /** First-occurrence technique help per step id; may be empty. */
  techniquesForStep: (stepId: string) => Technique[];
}

function StepInputChips({ step }: { step: NormalizedStep }) {
  if (step.inputs.length === 0 && !step.resultName) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {step.inputs.map((input) => (
        <span
          key={`${input.kind}-${input.id}`}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
            input.kind === 'prepGroup' ? 'bg-info/10 text-info' : 'bg-accent/10 text-accent'
          }`}
        >
          <Package size={11} /> {input.name}
        </span>
      ))}
      {step.resultName && (
        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
          <ArrowRight size={11} /> {step.resultName}
        </span>
      )}
    </div>
  );
}

/**
 * One execution section: purpose, then steps that consume *named* inputs
 * (prep groups, prior results) instead of re-listing ingredients. Essential
 * timing, temperature, one completion cue, and sequencing notes stay
 * visible; the full ingredient verification and equipment sit behind a
 * collapsed disclosure. No section-wide ingredient list.
 */
export default function ExecutionSectionCard({ data, recipe, factor, techniquesForStep }: ExecutionSectionCardProps) {
  const { section, steps } = data;
  const dependsOnNames = section.dependsOn
    .map((id) => recipe.sections.find((s) => s.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-4 space-y-3">
      <div className="space-y-1">
        <h3 className="font-semibold text-text">{section.name}</h3>
        {section.purpose && <p className="text-sm text-text-2">{section.purpose}</p>}
        {dependsOnNames.length > 0 && (
          <p className="flex items-center gap-1 text-xs text-text-3">
            <Link2 size={12} /> After: {dependsOnNames.join(', ')}
          </p>
        )}
        {section.notes && <p className="text-xs text-text-3">{section.notes}</p>}
      </div>

      <ol className="space-y-3">
        {steps.map((item, i) => {
          const { step } = item;
          const techniques = techniquesForStep(step.id);
          const hasDisclosure = item.verifyIngredients.length > 0 || step.equipment.length > 0;
          return (
            <li key={step.id} className="flex gap-2 text-sm text-text">
              <span className="flex-shrink-0 tabular-nums text-text-3">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <p>{step.text}</p>
                <StepInputChips step={item} />
                {(step.timing || step.temperature || step.visualCue || step.dependencyNote) && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {step.timing && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-1 px-2 py-0.5 text-xs text-text-2">
                        <Clock size={12} /> {step.timing}
                      </span>
                    )}
                    {step.temperature && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-1 px-2 py-0.5 text-xs text-text-2">
                        <Thermometer size={12} /> {step.temperature}
                      </span>
                    )}
                    {step.visualCue && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-1 px-2 py-0.5 text-xs text-text-2">
                        <Eye size={12} /> {step.visualCue}
                      </span>
                    )}
                    {step.dependencyNote && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-1 px-2 py-0.5 text-xs text-text-2">
                        <Link2 size={12} /> {step.dependencyNote}
                      </span>
                    )}
                  </div>
                )}
                {hasDisclosure && (
                  <details className="group mt-1">
                    <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1 rounded text-xs text-text-3 hover:text-text-2 focus-ring">
                      <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                      Verify contents
                    </summary>
                    <div className="mt-1.5 space-y-1.5 ps-4">
                      {item.verifyIngredients.length > 0 && (
                        <ul className="space-y-1">
                          {item.verifyIngredients.map((ing) => {
                            const amount = formatAmount(ing, factor);
                            return (
                              <li key={ing.id} className="text-xs text-text-2 flex flex-wrap items-baseline gap-x-2">
                                <span className="font-medium tabular-nums">{amount.grams}</span>
                                {amount.equivalent && (
                                  <span className="text-text-3">
                                    ({amount.equivalent}{amount.equivalentUnscaled ? ' at 1×' : ''})
                                  </span>
                                )}
                                <span>{ing.displayName}</span>
                                {ing.optional && <span className="italic text-text-3">optional</span>}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {step.equipment.length > 0 && (
                        <p className="flex items-center gap-1 text-xs text-text-3">
                          <Wrench size={12} /> {step.equipment.join(', ')}
                        </p>
                      )}
                    </div>
                  </details>
                )}
                <TechniqueHelp techniques={techniques} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
