'use client';

/* --- CONFIGURATION: nutrition export card copy --- */
const CARD_TITLE = 'Nutrition Tracker food';
const EXPORT_LABEL = 'Export to Nutrition Tracker';
const UPDATE_LABEL = 'Update tracker food';
const RECREATE_LABEL = 'Create it again';
const CARD_DESCRIPTION = 'Save this recipe as a food you can log in the Nutrition Tracker.';
const SCALE_NOTE = "Exports always use the recipe at 1×; the working scale doesn't change the tracker food.";
const PARTIAL_LABEL = 'partial';

/**
 * Shows per-basis export references and the current status of their tracker foods.
 * The card delegates all writes to the parent transaction flow.
 */

import { PackagePlus } from 'lucide-react';
import Button from '@/components/Button';
import {
  describeExportBlocks,
  describeExportStatus,
  exportDisabledReason,
  EXPORT_BASIS_LABELS,
} from '../lib/nutritionExportFormat';
import {
  buildExportPayload,
  exportAction,
  selectMissingExportBasis,
  selectExportBasis,
  type ExportStatus,
} from '../lib/nutritionExport';
import { NUTRITION_EXPORT_BASIS_KEYS, type NutritionExportBasisKey } from '../lib/types';
import type { FoodsState } from '../lib/trackerFoods';
import type { RecipeNutritionResult } from '../lib/nutritionCalc';
import type { Recipe } from '../lib/types';

interface NutritionExportCardProps {
  recipe: Recipe;
  result: RecipeNutritionResult;
  recipeId: string | null;
  dirty: boolean;
  foods: FoodsState;
  statuses: ExportStatus[];
  scaleActive: boolean;
  onOpen: (basis: NutritionExportBasisKey | 'choose') => void;
}

function StatusPill({ status }: { status: ExportStatus }) {
  const descriptions = [describeExportStatus(status)];
  const recipeIsStale = status.recipe === 'changed' || status.recipe === 'unavailable';
  const targetIsStale = status.target === 'modified' || status.target === 'missing';
  if (recipeIsStale && targetIsStale) {
    descriptions.push(describeExportStatus({ ...status, recipe: 'current' }));
  }
  const colors = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    error: 'bg-error/10 text-error',
    muted: 'bg-surface-2 text-text-3',
  };
  return (
    <>
      {descriptions.map((description) => (
        <span
          key={description.label}
          className={`rounded-full px-2 py-1 text-xs ${colors[description.tone]}`}
        >
          {description.label}
        </span>
      ))}
    </>
  );
}

function ExportRow({
  status,
  action,
  disabled,
  disabledReason,
  onOpen,
}: {
  status: ExportStatus;
  action: ReturnType<typeof exportAction>;
  disabled: boolean;
  disabledReason: string | null;
  onOpen: (basis: NutritionExportBasisKey) => void;
}) {
  if (status.ref === null) return null;
  const label =
    action === 'recreate'
      ? RECREATE_LABEL
      : action === 'update' || action === 'update-overwrite-tracker-edits'
        ? UPDATE_LABEL
        : EXPORT_LABEL;
  return (
    <li className="space-y-2 rounded-lg border border-border bg-surface-1 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{EXPORT_BASIS_LABELS[status.basis]}</span>
        <span className="text-sm text-text-2">“{status.ref.foodName}”</span>
        <span className="text-xs text-text-3">{new Date(status.ref.exportedAtMs).toLocaleDateString()}</span>
        {status.ref.coverage === 'partial' ? (
          <span className="rounded-full bg-warning/10 px-2 py-1 text-xs text-warning">{PARTIAL_LABEL}</span>
        ) : null}
        <StatusPill status={status} />
      </div>
      {status.ownership === 'foreign' ? null : (
        <>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            aria-describedby={disabledReason ? `nutrition-export-${status.basis}-disabled` : undefined}
            onClick={() => onOpen(status.basis)}
          >
            {label}
          </Button>
          {disabledReason ? (
            <p id={`nutrition-export-${status.basis}-disabled`} className="text-sm text-text-3">
              {disabledReason}
            </p>
          ) : null}
        </>
      )}
    </li>
  );
}

/** Render status rows and the primary export action. */
export default function NutritionExportCard({
  recipe,
  result,
  recipeId,
  dirty,
  foods,
  statuses,
  scaleActive,
  onOpen,
}: NutritionExportCardProps) {
  const disabledReason = exportDisabledReason({ saved: recipeId !== null, dirty, foodsStatus: foods.status });
  const choice = selectExportBasis(recipe, result, recipeId);
  const hasMissingOwnBasis = statuses.some((status) => status.ownership !== 'own');
  const basisActions = new Map(
    statuses.map((status) => {
      const payload = buildExportPayload(recipe, result, status.basis);
      return [status.basis, exportAction(status, payload)];
    }),
  );
  const blockedReasons = describeExportBlocks(choice.options);
  const blockedReasonIds = NUTRITION_EXPORT_BASIS_KEYS.filter((basis) => blockedReasons[basis] !== null).map(
    (basis) => `nutrition-export-blocked-${basis}`,
  );
  const noBasisAvailable = choice.preferred === null;
  const missingBasis = selectMissingExportBasis(statuses, choice);
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-surface-2 p-4"
      aria-labelledby="nutrition-export-card-title"
    >
      <div className="flex items-center gap-2">
        <PackagePlus size={18} className="text-accent" />
        <h3 id="nutrition-export-card-title" className="font-semibold">
          {CARD_TITLE}
        </h3>
      </div>
      <p className="text-sm text-text-2">{CARD_DESCRIPTION}</p>
      {statuses.some((status) => status.ref !== null) ? (
        <ul className="space-y-2">
          {statuses.map((status) => (
            <ExportRow
              key={status.basis}
              status={status}
              action={basisActions.get(status.basis) ?? 'blocked'}
              disabled={disabledReason !== null || basisActions.get(status.basis) === 'blocked'}
              disabledReason={disabledReason ?? blockedReasons[status.basis]}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : null}
      <Button
        disabled={disabledReason !== null || !hasMissingOwnBasis || noBasisAvailable}
        aria-describedby={
          [disabledReason ? 'nutrition-export-disabled-reason' : null, ...blockedReasonIds]
            .filter((id): id is string => id !== null)
            .join(' ') || undefined
        }
        onClick={() => onOpen(missingBasis ?? 'choose')}
      >
        {EXPORT_LABEL}
      </Button>
      {disabledReason ? (
        <p id="nutrition-export-disabled-reason" className="text-sm text-text-3">
          {disabledReason}
        </p>
      ) : null}
      {NUTRITION_EXPORT_BASIS_KEYS.map((basis) =>
        blockedReasons[basis] === null ? null : (
          <p id={`nutrition-export-blocked-${basis}`} key={basis} className="text-sm text-text-3">
            {blockedReasons[basis]}
          </p>
        ),
      )}
      {scaleActive ? <p className="text-sm text-text-3">{SCALE_NOTE}</p> : null}
    </section>
  );
}
