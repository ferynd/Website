'use client';

import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CircleSlash, RefreshCw, Unlink } from 'lucide-react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import { rankFoodsForQuery } from '../lib/nutritionMatch';
import {
  confirmNutritionLink,
  isValidGramsPerUnit,
  noMatchLink,
  type LinkAssessment,
} from '../lib/nutritionLink';
import { MAX_GRAMS_PER_UNIT, UNLINKED_NUTRITION, type NutritionLink, type RecipeIngredient } from '../lib/types';
import type { FoodsState } from '../lib/trackerFoods';

interface NutritionLinkEditorProps {
  ingredient: RecipeIngredient;
  assessment: LinkAssessment;
  foods: FoodsState;
  onApply: (link: NutritionLink) => void;
  onCancel: () => void;
  onRetryFoods: () => void;
}

export default function NutritionLinkEditor({ ingredient, assessment, foods, onApply, onCancel, onRetryFoods }: NutritionLinkEditorProps) {
  const link = ingredient.nutritionLink;
  const initialFood = foods.items.find((food) => food.id === link.foodItemId);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialFood?.id ?? null);
  const [grams, setGrams] = useState(link.status === 'confirmed' && initialFood ? String(link.gramsPerUnit) : '');
  const [error, setError] = useState('');
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const selectedFood = foods.items.find((food) => food.id === selectedId) ?? null;
  const rankedFoods = useMemo(() => {
    if (foods.status !== 'ready') return [];
    if (query) return rankFoodsForQuery(query, foods.items);
    const matching = rankFoodsForQuery(ingredient.displayName, foods.items);
    return matching.length ? matching : rankFoodsForQuery('', foods.items);
  }, [foods, query, ingredient.displayName]);
  const matchName = link.matchedName ?? 'the selected food';
  const confidence = link.matchConfidence === null ? '' : ` (${Math.round(link.matchConfidence * 100)}%)`;
  const statusText: Record<LinkAssessment['state'], string> = {
    candidate: `Suggested match “${matchName}”${confidence} — not confirmed.`,
    'candidate-missing': `The suggested food “${matchName}” no longer exists in the Nutrition Tracker.`,
    confirmed: `Confirmed: “${matchName}”, 1 unit = ${link.gramsPerUnit} g.`,
    'confirmed-unverified': `Confirmed: “${matchName}”, 1 unit = ${link.gramsPerUnit} g — not yet checked against current Nutrition Tracker foods.`,
    'stale-missing': `Needs review: the confirmed food “${matchName}” was deleted from the Nutrition Tracker.`,
    'stale-renamed': `Needs review: the confirmed food was renamed from “${matchName}” to “${assessment.currentName ?? 'unknown'}”.`,
    'stale-revised': `Needs review: “${matchName}” changed in the Nutrition Tracker since you confirmed it.`,
    'no-match': 'Marked as having no Nutrition Tracker match.',
    unlinked: 'Not linked.',
  };
  const statusClass = assessment.state.startsWith('stale-') ? 'text-error' : assessment.state.startsWith('candidate') ? 'text-warning' : 'text-text-2';
  const retry = <Button variant="secondary" onClick={onRetryFoods} className="inline-flex items-center gap-2"><RefreshCw size={14} /> Retry</Button>;
  const currentTarget = selectedFood?.id === link.foodItemId;
  const reconfirm = (assessment.state === 'stale-renamed' || assessment.state === 'stale-revised') && currentTarget;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="nutrition-link-title">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface-1 p-6 shadow-xl space-y-4 max-h-[90dvh] overflow-y-auto">
        <h3 id="nutrition-link-title" className="text-lg font-semibold text-text">Nutrition link — {ingredient.displayName}</h3>
        <p className={`text-sm ${statusClass}`}>{statusText[assessment.state]}</p>

        {foods.status === 'loading' && <p className="text-sm text-text-2">Loading Nutrition Tracker foods…</p>}
        {foods.status === 'error' && <div className="space-y-2"><p className="text-sm text-error">{foods.error || 'Could not load Nutrition Tracker foods.'}</p>{retry}</div>}
        {foods.status === 'idle' && retry}
        {foods.status === 'ready' && foods.items.length === 0 && <div className="space-y-2"><p className="text-sm text-text-2">No saved foods in the Nutrition Tracker yet. Save one there, then retry.</p>{retry}</div>}

        {foods.status === 'ready' && foods.items.length > 0 && <>
          <Input label="Search Nutrition Tracker foods" value={query} onChange={(event) => setQuery(event.target.value)} />
          <ul className="max-h-64 overflow-y-auto space-y-1">
            {rankedFoods.map((food) => {
              const selected = selectedId === food.id;
              return <li key={food.id}><button type="button" aria-pressed={selected} onClick={() => { setSelectedId(food.id); setError(''); }} className={`w-full rounded-lg border p-3 text-left text-sm focus-ring ${selected ? 'border-accent bg-accent/10' : 'border-border bg-surface-2 hover:bg-surface-1'}`}>
                <span className="flex items-center justify-between gap-2 font-medium text-text">{food.name}{food.id === link.foodItemId && <span className="rounded bg-surface-1 px-1.5 py-0.5 text-xs text-text-3">current</span>}</span>
                <span className="text-xs text-text-3">{food.nutrients.calories ?? '—'} kcal · {food.nutrients.protein ?? '—'} g protein per unit</span>
              </button></li>;
            })}
            {rankedFoods.length === 0 && <li className="p-2 text-sm text-text-3">No foods match this search.</li>}
          </ul>
        </>}

        {selectedFood && <div className="space-y-2">
          <Input label="Grams in one Nutrition Tracker unit" type="number" min={0} step="any" value={grams} onChange={(event) => setGrams(event.target.value)} />
          <p className="text-xs text-text-3">The tracker stores nutrients per one unit with no weight. Enter how many grams that unit is (e.g. 1 egg ≈ 50 g). Use 100 if the food&apos;s values are per 100 g.</p>
          <Button size="sm" variant="ghost" onClick={() => setGrams('100')}>Per 100 g</Button>
        </div>}
        {error && <p className="text-sm text-error">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          {link.status !== 'unlinked' && <Button variant="ghost" onClick={() => onApply({ ...UNLINKED_NUTRITION })} className="inline-flex items-center gap-1"><Unlink size={14} /> Clear link</Button>}
          {link.status !== 'no-match' && <Button variant="secondary" onClick={() => onApply(noMatchLink())} className="inline-flex items-center gap-1"><CircleSlash size={14} /> No match</Button>}
          <Button disabled={!selectedFood} onClick={() => {
            const value = Number(grams);
            if (!isValidGramsPerUnit(value)) { setError(`Enter grams per unit greater than 0 and at most ${MAX_GRAMS_PER_UNIT}.`); return; }
            if (selectedFood) onApply(confirmNutritionLink(selectedFood, value, Date.now(), link));
          }} className="inline-flex items-center gap-1"><BadgeCheck size={14} /> {reconfirm ? 'Re-confirm link' : 'Confirm link'}</Button>
        </div>
      </div>
    </div>
  );
}
