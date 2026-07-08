'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: none                                           */
/* ------------------------------------------------------------ */

import { useState } from 'react';
import { RotateCcw, Scale } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import {
  factorFromMultiplier,
  factorFromPortions,
  factorFromServings,
  factorFromTargetWeight,
  formatFactor,
  referenceWeightG,
  type ScaleResult,
} from '../lib/scaling';
import type { Recipe } from '../lib/types';

interface ScalingPanelProps {
  recipe: Recipe;
  scale: ScaleResult;
  onScaleChange: (scale: ScaleResult) => void;
  onBakeScale: () => void;
}

/**
 * Scaling controls. Every mode reduces to one multiplier applied to the
 * working copy at render time — the baseline recipe is untouched until the
 * user explicitly bakes the scale in, which then routes through the
 * update / save-as-new / cancel flow.
 */
export default function ScalingPanel({ recipe, scale, onScaleChange, onBakeScale }: ScalingPanelProps) {
  const [multiplier, setMultiplier] = useState('');
  const [servings, setServings] = useState('');
  const [targetWeight, setTargetWeight] = useState('');
  const [portionCount, setPortionCount] = useState('');
  const [portionSize, setPortionSize] = useState('');
  const [error, setError] = useState('');

  const refWeight = referenceWeightG(recipe);
  const baseline = recipe.servings.baselineServings;

  const apply = (result: ScaleResult | null, failureHint: string) => {
    if (!result) {
      setError(failureHint);
      return;
    }
    setError('');
    onScaleChange(result);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
        <Scale size={18} className="text-accent" />
        <p className="text-sm text-text">
          Current scale: <span className="font-semibold">{formatFactor(scale.factor)}</span>
          {scale.factor !== 1 && <span className="text-text-3"> — {scale.label}</span>}
        </p>
        {scale.factor !== 1 && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => onScaleChange({ factor: 1, label: 'baseline' })} className="inline-flex items-center gap-1">
              <RotateCcw size={14} /> Reset to 1×
            </Button>
            <Button size="sm" variant="secondary" onClick={onBakeScale}>
              Bake scale into recipe…
            </Button>
          </div>
        )}
      </div>
      <p className="text-xs text-text-3">
        Scaling adjusts a working copy of the quantities. Grams are the source of truth; equivalent
        measures are scaled when their leading number can be parsed, otherwise shown “at 1×”.
        Baking the scale in rewrites baseline grams and then asks how to save.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <form
          className="rounded-lg border border-border bg-surface-2 p-3 space-y-2"
          onSubmit={(e) => { e.preventDefault(); apply(factorFromMultiplier(Number(multiplier)), 'Enter a positive multiplier.'); }}
        >
          <p className="text-sm font-medium text-text">Batch multiplier</p>
          <div className="flex items-end gap-2">
            <Input type="number" min={0} step="any" placeholder="1.5" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} wrapperClassName="flex flex-col flex-1" aria-label="Batch multiplier" />
            <Button size="sm" type="submit">Apply</Button>
          </div>
        </form>

        <form
          className="rounded-lg border border-border bg-surface-2 p-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply(
              factorFromServings(Number(servings), baseline),
              baseline
                ? 'Enter a positive serving count.'
                : 'This recipe has no baselineServings, so serving-based scaling is unavailable — use a multiplier or weight instead.',
            );
          }}
        >
          <p className="text-sm font-medium text-text">
            Servings {baseline ? <span className="text-text-3">(baseline {baseline})</span> : <span className="text-text-3">(no baseline)</span>}
          </p>
          <div className="flex items-end gap-2">
            <Input type="number" min={0} step="any" placeholder="12" value={servings} onChange={(e) => setServings(e.target.value)} wrapperClassName="flex flex-col flex-1" aria-label="Target servings" />
            <Button size="sm" type="submit" disabled={!baseline}>Apply</Button>
          </div>
        </form>

        <form
          className="rounded-lg border border-border bg-surface-2 p-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply(
              factorFromTargetWeight(Number(targetWeight), refWeight),
              refWeight
                ? 'Enter a positive target weight in grams.'
                : 'This recipe has no estimated or actual final weight, so weight-based scaling is unavailable.',
            );
          }}
        >
          <p className="text-sm font-medium text-text">
            Target final weight{' '}
            <span className="text-text-3">
              {refWeight
                ? `(reference ${Math.round(refWeight)} g ${recipe.yield.actualFinalWeightG ? 'actual' : 'estimated'})`
                : '(no reference weight)'}
            </span>
          </p>
          <div className="flex items-end gap-2">
            <Input type="number" min={0} step="any" placeholder="2000" value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} wrapperClassName="flex flex-col flex-1" aria-label="Target final weight in grams" />
            <Button size="sm" type="submit" disabled={!refWeight}>Apply</Button>
          </div>
        </form>

        <form
          className="rounded-lg border border-border bg-surface-2 p-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply(
              factorFromPortions(Number(portionCount), Number(portionSize), refWeight),
              refWeight
                ? 'Enter a positive portion count and portion size.'
                : 'This recipe has no estimated or actual final weight, so portion-based scaling is unavailable.',
            );
          }}
        >
          <p className="text-sm font-medium text-text">Portions × size</p>
          <div className="flex items-end gap-2">
            <Input type="number" min={0} step="any" placeholder="10" value={portionCount} onChange={(e) => setPortionCount(e.target.value)} wrapperClassName="flex flex-col flex-1" aria-label="Portion count" />
            <Input type="number" min={0} step="any" placeholder="150 g" value={portionSize} onChange={(e) => setPortionSize(e.target.value)} wrapperClassName="flex flex-col flex-1" aria-label="Portion size in grams" />
            <Button size="sm" type="submit" disabled={!refWeight}>Apply</Button>
          </div>
        </form>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
