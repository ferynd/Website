/* --- CONFIGURATION: nutrition export card copy --- */
/** Render export availability from the pure card model; owned bases remain reachable through their rows. */
'use client';

const CARD_TITLE = 'Nutrition Tracker food';
const CARD_DESCRIPTION = 'Save this recipe as a food you can log in the Nutrition Tracker.';
const SCALE_NOTE = 'Exports always use the recipe at 1×; the working scale doesn\'t change the tracker food.';
const PARTIAL_LABEL = 'partial';

/**
 * Shows per-basis export references and the current status of their tracker foods.
 * The card delegates all writes to the parent transaction flow.
 */

import { PackagePlus } from 'lucide-react';
import Button from '@/components/Button';
import {
  buildExportCardModel,
  exportRowLabel,
  EXPORT_LABEL,
  type ExportCardRowModel,
  describeExportStatus,
  EXPORT_BASIS_LABELS,
} from '../lib/nutritionExportFormat';
import {
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

function StatusPill({ status }: {
  status: ExportStatus;
}) {
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
  model,
  onOpen,
}: {
  status: ExportStatus;
  model: ExportCardRowModel;
  onOpen: (basis: NutritionExportBasisKey) => void;
}) {
  if (status.ref === null) return null;
  const { action, disabled, disabledReason } = model;
  const label = exportRowLabel(action);
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
      {!model.showButton ? null : (
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
  const model = buildExportCardModel({
    recipe,
    result,
    recipeId,
    dirty,
    foodsStatus: foods.status,
    statuses,
  });
  const { disabledReason, blockedReasons } = model;
  const blockedReasonIds = NUTRITION_EXPORT_BASIS_KEYS.filter((basis) => blockedReasons[basis] !== null).map(
    (basis) => `nutrition-export-blocked-${basis}`,
  );
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
      {model.rows.length > 0 ? (
        <ul className="space-y-2">
          {model.rows.map((row) => {
            const status = statuses.find((status) => status.basis === row.basis);
            if (!status) return null;
            return (
              <ExportRow
                key={row.basis}
                status={status}
                model={row}
                onOpen={onOpen}
              />
            );
          })}
        </ul>
      ) : null}
      <Button
        disabled={model.primaryDisabled}
        aria-describedby={
          [disabledReason ? 'nutrition-export-disabled-reason' : null, ...blockedReasonIds]
            .filter((id): id is string => id !== null)
            .join(' ') || undefined
        }
        onClick={() => onOpen(model.primaryTarget)}
      >
        {EXPORT_LABEL}
      </Button>
      {model.primaryNote && <p className="text-sm text-text-3">{model.primaryNote}</p>}
      {disabledReason ? (
        <p id="nutrition-export-disabled-reason" className="text-sm text-text-3">
          {disabledReason}
        </p>
      ) : null}
      {NUTRITION_EXPORT_BASIS_KEYS.map((basis) =>
        blockedReasons[basis] === null ? null : (
          <p
            id={`nutrition-export-blocked-${basis}`}
            key={basis}
            className="text-sm text-text-3"
          >
            {blockedReasons[basis]}
          </p>
        ),
      )}
      {scaleActive ? <p className="text-sm text-text-3">{SCALE_NOTE}</p> : null}
    </section>
  );
}
