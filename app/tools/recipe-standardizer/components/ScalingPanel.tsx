/* --- CONFIGURATION: scaling controls and copy --- */
/** Scale controls keep the baseline unchanged until an explicit bake and review. */
'use client';

const VIEW_COPY = {
  multiplierError: 'Enter a positive multiplier (scale 0.001×–1000×).',
  servingsError: 'Enter a positive serving count (scale 0.001×–1000×).',
  missingServings:
    'This recipe has no baselineServings, so serving-based scaling is ' +
    'unavailable — use a multiplier or weight instead.',
  weightError:
    'Enter a positive weight with an actual/estimated reference weight (scale ' +
    '0.001×–1000×).',
  portionsError:
    'Enter a positive portion count and size with a reference weight (scale ' +
    '0.001×–1000×).',

  currentScale: 'Current scale: ',
  resetTo1: 'Reset to 1×',
  bakeScaleIntoRecipe: 'Bake scale into recipe…',
  scalingAdjustsAWorkingCopyOf:
    'Scaling adjusts a working copy of the quantities. Grams are the source of ' +
    'truth; equivalent measures are scaled when their leading number can be ' +
    'parsed, otherwise shown “at 1×”. Baking the scale in rewrites baseline ' +
    'grams; equivalents that can\'t be rescaled are listed for review first, then ' +
    'it asks how to save.',
  batchMultiplier: 'Batch multiplier',
  example15: '1.5',
  apply: 'Apply',
  servings: 'Servings ',
  baseline: '(baseline ',
  noBaseline: '(no baseline)',
  example12: '12',
  targetServings: 'Target servings',
  targetFinalWeight: 'Target final weight',
  actual: 'actual',
  estimated: 'estimated',
  noReferenceWeight: '(no reference weight)',
  example2000: '2000',
  targetFinalWeightInGrams: 'Target final weight in grams',
  portionsSize: 'Portions × size',
  example10: '10',
  portionCount: 'Portion count',
  example150G: '150 g',
  portionSizeInGrams: 'Portion size in grams',
} as const;

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
  isScaleActive,
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
  const scaleActive = isScaleActive(scale);

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
          {VIEW_COPY.currentScale}
          <span className="font-semibold">{formatFactor(scale.factor)}</span>
          {scaleActive && <span className="text-text-3"> — {scale.label}</span>}
        </p>
        {scaleActive && (
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onScaleChange({ factor: 1, label: 'baseline' })}
              className="inline-flex items-center gap-1"
            >
              <RotateCcw size={14} /> {VIEW_COPY.resetTo1}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={onBakeScale}
            >
              {VIEW_COPY.bakeScaleIntoRecipe}</Button>
          </div>
        )}
      </div>
      <p className="text-xs text-text-3">
        {VIEW_COPY.scalingAdjustsAWorkingCopyOf}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <form
          className="rounded-lg border border-border bg-surface-2 p-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply(factorFromMultiplier(Number(multiplier)), VIEW_COPY.multiplierError);
          }}
        >
          <p className="text-sm font-medium text-text">{VIEW_COPY.batchMultiplier}</p>
          <div className="flex items-end gap-2">
            <Input
              type="number"
              min={0}
              step="any"
              placeholder={VIEW_COPY.example15}
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
              wrapperClassName="flex flex-col flex-1"
              aria-label={VIEW_COPY.batchMultiplier}
            />
            <Button size="sm" type="submit">{VIEW_COPY.apply}</Button>
          </div>
        </form>
        <form
          className="rounded-lg border border-border bg-surface-2 p-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply(
              factorFromServings(Number(servings), baseline),
              baseline
                ? VIEW_COPY.servingsError
                : VIEW_COPY.missingServings,
            );
          }}
        >
          <p className="text-sm font-medium text-text">
            {VIEW_COPY.servings}{baseline ? <span className="text-text-3">{VIEW_COPY.baseline}{baseline})</span> : <span className="text-text-3">{VIEW_COPY.noBaseline}</span>}
          </p>
          <div className="flex items-end gap-2">
            <Input
              type="number"
              min={0}
              step="any"
              placeholder={VIEW_COPY.example12}
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              wrapperClassName="flex flex-col flex-1"
              aria-label={VIEW_COPY.targetServings}
            />
            <Button
              size="sm"
              type="submit"
              disabled={!baseline}
            >{VIEW_COPY.apply}</Button>
          </div>
        </form>
        <form
          className="rounded-lg border border-border bg-surface-2 p-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply(
              factorFromTargetWeight(Number(targetWeight), refWeight),
              refWeight
                ? 'Enter a positive target weight in grams (scale 0.001×–1000×).'
                : 'This recipe has no estimated or actual final weight, so weight-based scaling is unavailable.',
            );
          }}
        >
          <p className="text-sm font-medium text-text">
            {VIEW_COPY.targetFinalWeight}{' '}
            <span className="text-text-3">
              {refWeight
                ? `(reference ${Math.round(refWeight)} g ${recipe.yield.actualFinalWeightG ? VIEW_COPY.actual : VIEW_COPY.estimated})`
                : VIEW_COPY.noReferenceWeight}
            </span>
          </p>
          <div className="flex items-end gap-2">
            <Input
              type="number"
              min={0}
              step="any"
              placeholder={VIEW_COPY.example2000}
              value={targetWeight}
              onChange={(e) => setTargetWeight(e.target.value)}
              wrapperClassName="flex flex-col flex-1"
              aria-label={VIEW_COPY.targetFinalWeightInGrams}
            />
            <Button
              size="sm"
              type="submit"
              disabled={!refWeight}
            >{VIEW_COPY.apply}</Button>
          </div>
        </form>
        <form
          className="rounded-lg border border-border bg-surface-2 p-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply(
              factorFromPortions(Number(portionCount), Number(portionSize), refWeight),
              refWeight
                ? 'Enter a positive portion count and portion size (scale 0.001×–1000×).'
                : 'This recipe has no estimated or actual final weight, so portion-based scaling is unavailable.',
            );
          }}
        >
          <p className="text-sm font-medium text-text">{VIEW_COPY.portionsSize}</p>
          <div className="flex items-end gap-2">
            <Input
              type="number"
              min={0}
              step="any"
              placeholder={VIEW_COPY.example10}
              value={portionCount}
              onChange={(e) => setPortionCount(e.target.value)}
              wrapperClassName="flex flex-col flex-1"
              aria-label={VIEW_COPY.portionCount}
            />
            <Input
              type="number"
              min={0}
              step="any"
              placeholder={VIEW_COPY.example150G}
              value={portionSize}
              onChange={(e) => setPortionSize(e.target.value)}
              wrapperClassName="flex flex-col flex-1"
              aria-label={VIEW_COPY.portionSizeInGrams}
            />
            <Button
              size="sm"
              type="submit"
              disabled={!refWeight}
            >{VIEW_COPY.apply}</Button>
          </div>
        </form>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
