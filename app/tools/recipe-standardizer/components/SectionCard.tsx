'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

import { Clock, Link2, Thermometer, Eye, Wrench } from 'lucide-react';
import { formatAmount } from '../lib/display';
import type { Recipe, RecipeSection, RecipeStep } from '../lib/types';

interface SectionCardProps {
  section: RecipeSection;
  recipe: Recipe;
  steps: RecipeStep[];
  /** Which step list this card is rendering (prep view vs cook view). */
  mode: 'prep' | 'active';
  factor: number;
}

const typeBadgeClasses: Record<RecipeSection['type'], string> = {
  prep: 'bg-info/10 text-info',
  execution: 'bg-warning/10 text-warning',
  combined: 'bg-accent/10 text-accent',
};

function StepChips({ step }: { step: RecipeStep }) {
  const chips: Array<{ icon: React.ReactNode; text: string }> = [];
  if (step.timing) chips.push({ icon: <Clock size={12} />, text: step.timing });
  if (step.temperature) chips.push({ icon: <Thermometer size={12} />, text: step.temperature });
  if (step.visualCue) chips.push({ icon: <Eye size={12} />, text: step.visualCue });
  if (step.equipment.length > 0) chips.push({ icon: <Wrench size={12} />, text: step.equipment.join(', ') });
  if (step.dependencyNote) chips.push({ icon: <Link2 size={12} />, text: step.dependencyNote });
  if (chips.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {chips.map((chip, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-2">
          {chip.icon}
          {chip.text}
        </span>
      ))}
    </div>
  );
}

/**
 * One workflow section: purpose, equipment, the ingredients staged in it
 * (scaled), and its steps for the requested mode. Ingredient amounts render
 * from ingredient data (not step text), so ingredient edits flow through.
 */
export default function SectionCard({ section, recipe, steps, mode, factor }: SectionCardProps) {
  const sectionIngredients = recipe.ingredients.filter((ing) => ing.sectionIds.includes(section.id));
  const dependsOnNames = section.dependsOn
    .map((id) => recipe.sections.find((s) => s.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  const ingredientById = new Map(recipe.ingredients.map((ing) => [ing.id, ing]));

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-text">{section.name}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${typeBadgeClasses[section.type]}`}>
          {section.type}
        </span>
      </div>
      {section.purpose && <p className="text-sm text-text-2">{section.purpose}</p>}
      {(section.equipment.length > 0 || dependsOnNames.length > 0 || section.notes) && (
        <div className="space-y-1 text-xs text-text-3">
          {section.equipment.length > 0 && (
            <p className="flex items-center gap-1"><Wrench size={12} /> {section.equipment.join(', ')}</p>
          )}
          {dependsOnNames.length > 0 && (
            <p className="flex items-center gap-1"><Link2 size={12} /> After: {dependsOnNames.join(', ')}</p>
          )}
          {section.notes && <p>{section.notes}</p>}
        </div>
      )}

      {sectionIngredients.length > 0 && (
        <ul className="space-y-1">
          {sectionIngredients.map((ing) => {
            const amount = formatAmount(ing, factor);
            return (
              <li key={ing.id} className="text-sm text-text flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium tabular-nums">{amount.grams}</span>
                {amount.equivalent && (
                  <span className="text-text-3">
                    ({amount.equivalent}{amount.equivalentUnscaled ? ' at 1×' : ''})
                  </span>
                )}
                <span>{ing.displayName}</span>
                {ing.prepNote && <span className="text-text-3">— {ing.prepNote}</span>}
                {ing.optional && <span className="text-xs text-text-3 italic">optional</span>}
              </li>
            );
          })}
        </ul>
      )}

      {steps.length > 0 && (
        <ol className="space-y-2 border-t border-border pt-3">
          {steps.map((step, i) => {
            const refs = step.ingredientRefs
              .map((id) => ingredientById.get(id))
              .filter((ing): ing is NonNullable<typeof ing> => Boolean(ing));
            return (
              <li key={step.id} className="text-sm text-text">
                <div className="flex gap-2">
                  <span className="text-text-3 tabular-nums flex-shrink-0">{i + 1}.</span>
                  <div className="flex-1">
                    <p>{step.text}</p>
                    {refs.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {refs.map((ing) => {
                          const amount = formatAmount(ing, factor);
                          return (
                            <span key={ing.id} className="rounded bg-surface-1 border border-border px-1.5 py-0.5 text-xs text-text-2">
                              {ing.displayName} · {amount.grams}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <StepChips step={step} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {steps.length === 0 && (
        <p className="text-xs text-text-3 border-t border-border pt-3">
          No {mode === 'prep' ? 'prep' : 'active'} steps in this section.
        </p>
      )}
    </div>
  );
}
