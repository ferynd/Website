'use client';

/* ------------------------------------------------------------ */
/* CONFIGURATION: nutrition panel interaction copy               */
/* ------------------------------------------------------------ */
const TABLE_ID = 'nutrition-full-table';
const TABLE_SHOW_LABEL = 'Show all 24 nutrients';
const TABLE_HIDE_LABEL = 'Hide full nutrient table';

/**
 * Derived nutrition summary, basis controls, full nutrient table, and direct ingredient repair actions.
 * This component does not persist calculated values.
 */

import { useMemo, useState } from 'react';
import {
  Apple,
  BadgeCheck,
  ChevronDown,
  Info,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import Button from '@/components/Button';
import {
  NUTRITION_BASIS_KEYS,
  type NutritionBasis,
  type NutritionBasisKey,
  type RecipeNutritionResult,
} from '../lib/nutritionCalc';
import { assessNutritionLink, type LinkAssessment } from '../lib/nutritionLink';
import {
  BASIS_LABELS,
  describeBasisCaption,
  ESTIMATED_FINAL_WEIGHT_LABEL,
  PROJECTED_FINAL_WEIGHT_LABEL,
  describeBasisUnavailable,
  describeExclusionReason,
  exclusionTone,
  formatNutrientAmount,
  formatWholeGrams,
  coverageDetail,
  coverageHeadline,
  defaultBasis,
  nutrientGapNote,
  nutrientLabel,
  NUTRIENT_DISPLAY_GROUPS,
  HEADLINE_NUTRIENT_KEYS,
  LOWER_BOUND_NOTE,
  NUTRITION_ASSUMPTION_NOTE,
} from '../lib/nutritionFormat';
import { selectIntakeGroups, type IntakeCommitOutcome, type IntakeCommitPlan } from '../lib/nutritionIntakeReview';
import type { ScaleResult } from '../lib/scaling';
import type { FoodsState, TrackerNutrientKey } from '../lib/trackerFoods';
import type { NutritionLink, Recipe, RecipeIngredient } from '../lib/types';
import IngredientEditModal from './IngredientEditModal';
import NutritionIntakeModal from './NutritionIntakeModal';
import NutritionLinkEditor from './NutritionLinkEditor';

/** Inputs and repair callbacks for the Nutrition panel. */
interface NutritionPanelProps {
  recipe: Recipe;
  result: RecipeNutritionResult;
  scale: ScaleResult;
  foods: FoodsState;
  linkAssessments: Map<string, LinkAssessment>;
  onNutritionLinkChange: (ingredientId: string, link: NutritionLink) => void;
  onIngredientChange: (updated: RecipeIngredient) => void;
  onRefreshFoods: () => void;
  onCommitIntake: (plan: IntakeCommitPlan) => Promise<IntakeCommitOutcome>;
  onReviewIngredients: () => void;
}

interface PanelDisplayProps {
  result: RecipeNutritionResult;
}

function CoverageSummary({ result, scale, onRefreshFoods }: PanelDisplayProps & {
  scale: ScaleResult;
  onRefreshFoods: () => void;
}) {
  const complete = result.coverage.status === 'complete';
  const partial = result.coverage.status === 'partial';
  const isLoading = result.foodsStatus === 'loading';
  const tone = complete
    ? 'border-success/30 bg-success/10'
    : partial
      ? 'border-warning/30 bg-warning/10'
      : 'border-border bg-surface-2';
  return (
    <section className={`rounded-xl border p-4 space-y-2 ${tone}`} aria-live="polite">
      <div className="flex items-start gap-2">
        {isLoading ? <Loader2 size={18} className="mt-0.5 animate-spin" /> : null}
        {!isLoading && complete ? <BadgeCheck size={18} className="mt-0.5 text-success" /> : null}
        {!isLoading && partial ? <TriangleAlert size={18} className="mt-0.5 text-warning" /> : null}
        {!isLoading && !complete && !partial ? <Info size={18} className="mt-0.5 text-text-3" /> : null}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold text-text">{coverageHeadline(result)}</p>
          {result.foodsStatus === 'ready' && (
            <p className="text-sm text-text-2">{coverageDetail(result)}</p>
          )}
          {result.foodsStatus === 'ready' && nutrientGapNote(result.coverage) && (
            <p className="text-sm text-warning">{nutrientGapNote(result.coverage)}</p>
          )}
          {result.factor !== 1 && (
            <p className="text-sm text-text-2">
              Scaled to {scale.label}: totals follow the working copy; per-serving and per-100 g values don&apos;t change with batch size.
            </p>
          )}
          {result.foodsStatus === 'error' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onRefreshFoods}
              className="inline-flex items-center gap-2"
            >
              <RefreshCw size={14} /> Retry
            </Button>
          )}
          {result.foodsStatus === 'idle' && (
            <Button size="sm" variant="secondary" onClick={onRefreshFoods}>
              Load Nutrition Tracker foods
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function BasisSelector({
  basisKey,
  result,
  onChange,
}: {
  basisKey: NutritionBasisKey;
  result: RecipeNutritionResult;
  onChange: (key: NutritionBasisKey) => void;
}) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface-2 p-1" role="group" aria-label="Nutrition basis">
      {NUTRITION_BASIS_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={basisKey === key}
          onClick={() => onChange(key)}
          className={`flex-shrink-0 rounded-md px-3 py-1.5 text-sm focus-ring ${basisKey === key ? 'bg-surface-1 text-text shadow-sm' : 'text-text-3 hover:text-text-2'}`}
        >
          {BASIS_LABELS[key]}
          {!result.bases[key].available ? ' ·' : ''}
        </button>
      ))}
    </div>
  );
}

function BasisCaption({ basis, factor }: { basis: NutritionBasis; factor: number }) {
  if (!basis.available && basis.unavailableReason !== null) {
    return (
      <p className="text-sm text-text-2">
        {BASIS_LABELS[basis.key]} unavailable — {describeBasisUnavailable(basis.unavailableReason, basis.key)}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-text-2">
      <span>{describeBasisCaption(basis, factor)}</span>
      {basis.estimated && (
        <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">
          {basis.weightSource === 'actual' && factor !== 1
            ? PROJECTED_FINAL_WEIGHT_LABEL
            : ESTIMATED_FINAL_WEIGHT_LABEL}
        </span>
      )}
    </div>
  );
}

function MacroTiles({ basis }: { basis: NutritionBasis }) {
  if (!basis.available || basis.amounts === null) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {HEADLINE_NUTRIENT_KEYS.map((key) => {
        const amount = basis.amounts?.[key];
        if (amount === undefined) return null;
        return (
          <div key={key} className="rounded-lg border border-border bg-surface-1 p-3">
            <p className="text-xs text-text-3">{nutrientLabel(key)}</p>
            <p className="tabular-nums text-lg font-semibold text-text" title={amount.isLowerBound ? 'at least' : undefined}>
              {formatNutrientAmount(key, amount)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function NutrientTable({ basis, open, onToggle }: { basis: NutritionBasis; open: boolean; onToggle: () => void }) {
  if (!basis.available || basis.amounts === null) return null;
  return (
    <section className="rounded-lg border border-border bg-surface-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={TABLE_ID}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium text-text focus-ring"
      >
        <span>{open ? TABLE_HIDE_LABEL : TABLE_SHOW_LABEL}</span>
        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={TABLE_ID} className="space-y-4 border-t border-border p-3">
          {NUTRIENT_DISPLAY_GROUPS.map((group) => (
            <section key={group.key}>
              <h4 className="mb-1 text-sm font-semibold text-text">{group.title}</h4>
              <table className="w-full text-sm">
                <tbody>
                  {group.nutrients.map((key) => (
                    <NutrientTableRow key={key} nutrientKey={key} basis={basis} />
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function NutrientTableRow({ nutrientKey, basis }: { nutrientKey: TrackerNutrientKey; basis: NutritionBasis }) {
  const amount = basis.amounts?.[nutrientKey];
  if (!amount) return null;
  return (
    <tr className="border-b border-border/60 last:border-0">
      <th scope="row" className="py-1.5 text-left font-normal text-text-2">
        {nutrientLabel(nutrientKey)}
        {amount.missingFromIngredientIds.length > 0 && (
          <span className="ml-1 text-xs text-text-3">no value for {amount.missingFromIngredientIds.length} ingredient(s)</span>
        )}
      </th>
      <td className="py-1.5 text-right tabular-nums text-text">{formatNutrientAmount(nutrientKey, amount)}</td>
    </tr>
  );
}

function ExclusionList({
  result,
  onEditLink,
  onEditIngredient,
}: {
  result: RecipeNutritionResult;
  onEditLink: (id: string) => void;
  onEditIngredient: (id: string) => void;
}) {
  if (result.excluded.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-text">Not counted ({result.excluded.length})</h3>
      <ul className="space-y-2">
        {result.excluded.map((row) => {
          const tone = exclusionTone(row);
          const toneClass = tone === 'error' ? 'text-error' : tone === 'warning' ? 'text-warning' : 'text-text-3';
          return (
            <li key={`${row.ingredientId}-${row.index}`} className="rounded-lg border border-border bg-surface-1 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-text">
                    {row.displayName}{row.optional ? <span className="ml-1 text-xs text-text-3">optional</span> : null}
                    <span className="ml-2 text-sm font-normal text-text-3">{row.scaledGrams === null ? '— g' : formatWholeGrams(row.scaledGrams)}</span>
                  </p>
                  <ul className="mt-1 space-y-1">
                    {row.reasons.map((reason, index) => (
                      <li key={`${reason}-${index}`} className={`text-sm ${toneClass}`}>
                        {describeExclusionReason(reason, row)}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-wrap gap-1">
                  {row.canEditLink && (
                    <Button size="sm" variant="ghost" onClick={() => onEditLink(row.ingredientId)} className="inline-flex items-center gap-1">
                      <Link2 size={14} /> Edit link
                    </Button>
                  )}
                  {row.canEditQuantity && (
                    <Button size="sm" variant="ghost" onClick={() => onEditIngredient(row.ingredientId)} className="inline-flex items-center gap-1">
                      <Pencil size={14} /> Edit ingredient
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AssumptionNote({ result }: PanelDisplayProps) {
  const hasLowerBound = Object.values(result.bases).some((basis) =>
    basis.amounts !== null && Object.values(basis.amounts).some((amount) => amount.isLowerBound),
  );
  return (
    <aside className="space-y-1 rounded-lg bg-surface-2 p-3 text-xs text-text-3">
      <p>{NUTRITION_ASSUMPTION_NOTE}</p>
      {hasLowerBound && <p>{LOWER_BOUND_NOTE}</p>}
    </aside>
  );
}

function NutritionModals({
  recipe,
  foods,
  linkAssessments,
  linkEditingId,
  quantityEditingId,
  intakeOpen,
  onCloseLink,
  onCloseIngredient,
  onCloseIntake,
  onNutritionLinkChange,
  onIngredientChange,
  onRefreshFoods,
  onCommitIntake,
}: {
  recipe: Recipe;
  foods: FoodsState;
  linkAssessments: Map<string, LinkAssessment>;
  linkEditingId: string | null;
  quantityEditingId: string | null;
  intakeOpen: boolean;
  onCloseLink: () => void;
  onCloseIngredient: () => void;
  onCloseIntake: () => void;
  onNutritionLinkChange: (ingredientId: string, link: NutritionLink) => void;
  onIngredientChange: (updated: RecipeIngredient) => void;
  onRefreshFoods: () => void;
  onCommitIntake: (plan: IntakeCommitPlan) => Promise<IntakeCommitOutcome>;
}) {
  const linkIngredient = recipe.ingredients.find((ingredient) => ingredient.id === linkEditingId) ?? null;
  const quantityIngredient = recipe.ingredients.find((ingredient) => ingredient.id === quantityEditingId) ?? null;
  const assessment = linkIngredient
    ? linkAssessments.get(linkIngredient.id) ?? assessNutritionLink(linkIngredient.nutritionLink, null)
    : null;
  return (
    <>
      {linkIngredient && assessment && (
        <NutritionLinkEditor
          ingredient={linkIngredient}
          assessment={assessment}
          foods={foods}
          onApply={(link) => {
            onCloseLink();
            onNutritionLinkChange(linkIngredient.id, link);
          }}
          onCancel={onCloseLink}
          onRetryFoods={onRefreshFoods}
        />
      )}
      {quantityIngredient && (
        <IngredientEditModal
          ingredient={quantityIngredient}
          onSave={(updated) => {
            onCloseIngredient();
            onIngredientChange(updated);
          }}
          onCancel={onCloseIngredient}
        />
      )}
      {intakeOpen && (
        <NutritionIntakeModal
          recipe={recipe}
          linkAssessments={linkAssessments}
          foods={foods}
          onRetryFoods={onRefreshFoods}
          onCommit={onCommitIntake}
          onClose={onCloseIntake}
        />
      )}
    </>
  );
}

/** Render the nutrition coverage, basis controls, nutrient values, and repair modals. */
export default function NutritionPanel({
  recipe,
  result,
  scale,
  foods,
  linkAssessments,
  onNutritionLinkChange,
  onIngredientChange,
  onRefreshFoods,
  onCommitIntake,
  onReviewIngredients,
}: NutritionPanelProps) {
  const [basis, setBasis] = useState<NutritionBasisKey | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [linkEditingId, setLinkEditingId] = useState<string | null>(null);
  const [quantityEditingId, setQuantityEditingId] = useState<string | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const intakeGroupCount = useMemo(
    () => selectIntakeGroups(recipe, linkAssessments).length,
    [recipe, linkAssessments],
  );
  const selectedBasis = basis ?? defaultBasis(result);
  const selected = result.bases[selectedBasis];
  const showValues = result.coverage.status !== 'none' && result.coverage.totalCount > 0;

  return (
    <div className="space-y-4">
      <CoverageSummary result={result} scale={scale} onRefreshFoods={onRefreshFoods} />
      {showValues && (
        <div className="space-y-3">
          <BasisSelector basisKey={selectedBasis} result={result} onChange={setBasis} />
          <BasisCaption basis={selected} factor={result.factor} />
          {selected.available && (
            <>
              <MacroTiles basis={selected} />
              <NutrientTable basis={selected} open={tableOpen} onToggle={() => setTableOpen((value) => !value)} />
            </>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {foods.status === 'ready' && intakeGroupCount > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setIntakeOpen(true)}
            className="inline-flex items-center gap-2"
          >
            <Apple size={15} /> Create foods with ChatGPT ({intakeGroupCount})
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onReviewIngredients}>
          Review in Ingredients
        </Button>
      </div>
      <ExclusionList
        result={result}
        onEditLink={(id) => {
          setLinkEditingId(id);
          if (foods.status === 'idle' || foods.status === 'error') onRefreshFoods();
        }}
        onEditIngredient={setQuantityEditingId}
      />
      <AssumptionNote result={result} />
      <NutritionModals
        recipe={recipe}
        foods={foods}
        linkAssessments={linkAssessments}
        linkEditingId={linkEditingId}
        quantityEditingId={quantityEditingId}
        intakeOpen={intakeOpen}
        onCloseLink={() => setLinkEditingId(null)}
        onCloseIngredient={() => setQuantityEditingId(null)}
        onCloseIntake={() => setIntakeOpen(false)}
        onNutritionLinkChange={onNutritionLinkChange}
        onIngredientChange={onIngredientChange}
        onRefreshFoods={onRefreshFoods}
        onCommitIntake={onCommitIntake}
      />
    </div>
  );
}
