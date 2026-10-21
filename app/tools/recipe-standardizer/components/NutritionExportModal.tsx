'use client';

/* --- CONFIGURATION: nutrition export review copy --- */
const DIALOG_TITLE = 'Export to Nutrition Tracker';
const CREATE_LABEL = 'Create food';
const UPDATE_LABEL = 'Update food';
const RECREATE_LABEL = 'Create food again';
const EXPORT_COPY = {
  basisLegend: 'Export basis',
  basisPreference: 'Per portion is recommended when the recipe has portions.',
  partialConfirm: 'Export anyway with partial nutrition',
  replaceConfirm: 'Replace the Nutrition Tracker changes',
  previewTitle: 'Nutrition per exported unit',
  showAllNutrients: 'Show all 24 nutrients',
  hideAllNutrients: 'Hide all nutrients',
  nameLabel: 'Nutrition Tracker food name',
  keepNameNote: "Updates keep the food's name and ID in the Nutrition Tracker.",
  collisionLead: 'A Nutrition Tracker food with this name already exists (“',
  collisionTail: '”). Choose a different name — existing foods are never replaced.',
  updateDiffTitle: 'What changes in the tracker',
  noChanges: 'No nutrient changes — this refreshes the export record only.',
  quantityLabel: 'Quantity:',
  unknown: 'unknown',
  pastLogsNote: 'Past Nutrition Tracker log entries keep the values they were logged with.',
  reviewAgain: 'Review again',
  close: 'Close',
  cancel: 'Cancel',
  noData: '0 (no data)',
  saving: 'Saving…',
  trackerEditLead:
    '” was changed in the Nutrition Tracker after you exported it. Updating replaces those changes.',
  trackerEditPrefix: '“',
} as const;

/**
 * Basis selection and confirmation flow for a recipe nutrition export.
 * The parent revalidates every reviewed value before the transaction starts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@/components/Button';
import { formatNutrientAmount, nutrientLabel } from '../lib/nutritionFormat';
import {
  buildExportPayload,
  defaultExportFoodName,
  diffExportNutrients,
  exportAction,
  findExportCollision,
  selectExportBasis,
  TRACKER_EXPORT_QUANTITY,
  trackerFoodLinkTarget,
  type ExportAction,
  type ExportCommitInput,
  type ExportCommitOutcome,
  type ExportPayload,
  type ExportStatus,
} from '../lib/nutritionExport';
import {
  describeExportBlock,
  describeExportOutcome,
  exportQuantityHint,
  partialExportWarning,
  EXPORT_BASIS_LABELS,
} from '../lib/nutritionExportFormat';
import {
  TRACKER_NUTRIENT_KEYS,
  fingerprintTrackerFood,
  trackerFoodId,
  validateTrackerFoodName,
  type FoodsState,
  type TrackerNutrientKey,
} from '../lib/trackerFoods';
import { NUTRITION_EXPORT_BASIS_KEYS, type NutritionExportBasisKey, type Recipe } from '../lib/types';
import type { RecipeNutritionResult } from '../lib/nutritionCalc';

interface NutritionExportModalProps {
  recipe: Recipe;
  recipeId: string;
  foods: FoodsState;
  result: RecipeNutritionResult;
  statuses: ExportStatus[];
  initialBasis: 'perPortion' | 'per100gCooked' | 'choose';
  onCommit: (input: ExportCommitInput) => Promise<ExportCommitOutcome>;
  onClose: () => void;
}

function BasisStep({
  recipe,
  result,
  recipeId,
  basis,
  onChange,
}: {
  recipe: Recipe;
  result: RecipeNutritionResult;
  recipeId: string;
  basis: NutritionExportBasisKey;
  onChange: (basis: NutritionExportBasisKey) => void;
}) {
  const choice = selectExportBasis(recipe, result, recipeId);
  return (
    <fieldset className="space-y-2">
      <legend className="font-medium text-text">{EXPORT_COPY.basisLegend}</legend>
      <p className="text-sm text-text-2">{EXPORT_COPY.basisPreference}</p>
      {NUTRITION_EXPORT_BASIS_KEYS.map((key) => {
        const option = choice.options[key];
        const disabled = !option.ok;
        return (
          <label key={key} className="block rounded-lg border border-border p-3">
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="export-basis"
                value={key}
                checked={basis === key}
                disabled={disabled}
                onChange={() => onChange(key)}
              />
              <span>{EXPORT_BASIS_LABELS[key]}</span>
            </span>
            {!option.ok ? (
              <span className="mt-1 block text-sm text-text-3">
                {describeExportBlock(option.reason, key, option.overCapKeys)}
              </span>
            ) : null}
          </label>
        );
      })}
    </fieldset>
  );
}

function PartialWarning({
  payload,
  confirmed,
  onChange,
}: {
  payload: ExportPayload;
  confirmed: boolean;
  onChange: (value: boolean) => void;
}) {
  if (payload.coverage !== 'partial') return null;
  return (
    <section className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
      <p>{partialExportWarning(payload)}</p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={confirmed} onChange={(event) => onChange(event.target.checked)} />
        <span>{EXPORT_COPY.partialConfirm}</span>
      </label>
    </section>
  );
}

function TrackerEditsWarning({
  checked,
  onChange,
  foodName,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  foodName: string;
}) {
  return (
    <section className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
      <p>
        {EXPORT_COPY.trackerEditPrefix}
        {foodName}
        {EXPORT_COPY.trackerEditLead}
      </p>
      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span>{EXPORT_COPY.replaceConfirm}</span>
      </label>
    </section>
  );
}

function ExportPreview({ payload }: { payload: ExportPayload }) {
  const [showAll, setShowAll] = useState(false);
  const headline: TrackerNutrientKey[] = ['calories', 'protein', 'carbs', 'fat'];
  const keys = showAll ? TRACKER_NUTRIENT_KEYS : headline;
  return (
    <section className="space-y-2">
      <h4 className="font-semibold">{EXPORT_COPY.previewTitle}</h4>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {keys.map((key) => {
          const amount = {
            value: payload.nutrients[key],
            isLowerBound: payload.lowerBoundKeys.includes(key),
          };
          return (
            <div key={key} className="rounded border border-border p-2">
              <dt className="text-xs text-text-3">{nutrientLabel(key)}</dt>
              <dd>
                {payload.zeroFilledKeys.includes(key)
                  ? EXPORT_COPY.noData
                  : formatNutrientAmount(key, amount)}
              </dd>
            </div>
          );
        })}
      </dl>
      <button type="button" className="text-sm text-accent" onClick={() => setShowAll((current) => !current)}>
        {showAll ? EXPORT_COPY.hideAllNutrients : EXPORT_COPY.showAllNutrients}
      </button>
    </section>
  );
}

function ReviewStep({
  foods,
  status,
  payload,
  action,
  name,
  onNameChange,
  partialConfirmed,
  onPartialChange,
  overwriteConfirmed,
  onOverwriteChange,
}: {
  foods: FoodsState;
  status: ExportStatus;
  payload: ExportPayload;
  action: ExportAction;
  name: string;
  onNameChange: (name: string) => void;
  partialConfirmed: boolean;
  onPartialChange: (value: boolean) => void;
  overwriteConfirmed: boolean;
  onOverwriteChange: (value: boolean) => void;
}) {
  const creating = action === 'create' || action === 'recreate';
  const nameError = creating ? validateTrackerFoodName(name) : null;
  const collision =
    creating && nameError === null ? findExportCollision(trackerFoodId(name), foods.items, status) : null;
  const diff = diffExportNutrients(status.targetFood, payload);
  return (
    <div className="space-y-4">
      <div>
        {creating ? (
          <label className="block space-y-1 text-sm">
            <span>{EXPORT_COPY.nameLabel}</span>
            <input
              className="w-full rounded-lg border border-border bg-surface-1 p-2"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
        ) : (
          <div className="text-sm">
            <p className="font-medium">{status.targetFood?.name}</p>
            <p className="text-text-3">{EXPORT_COPY.keepNameNote}</p>
          </div>
        )}
        {nameError ? <p className="mt-1 text-sm text-error">{nameError}</p> : null}
        {collision ? (
          <p className="mt-1 text-sm text-error">
            {EXPORT_COPY.collisionLead}
            {collision.name}
            {EXPORT_COPY.collisionTail}
          </p>
        ) : null}
      </div>
      <p className="text-sm text-text-2">{exportQuantityHint(payload)}</p>
      <ExportPreview payload={payload} />
      {!creating ? (
        <section className="space-y-1 text-sm">
          <h4 className="font-semibold">{EXPORT_COPY.updateDiffTitle}</h4>
          {diff.changes.length === 0 && !diff.quantityChanged ? <p>{EXPORT_COPY.noChanges}</p> : null}
          {diff.quantityChanged ? (
            <p>
              {EXPORT_COPY.quantityLabel} {status.targetFood?.quantity ?? EXPORT_COPY.unknown} →{' '}
              {TRACKER_EXPORT_QUANTITY}
            </p>
          ) : null}
          {diff.changes.map((change) => (
            <p key={change.key}>
              {nutrientLabel(change.key)}: {change.before ?? EXPORT_COPY.unknown} → {change.after}
            </p>
          ))}
          <p className="pt-1 text-text-3">{EXPORT_COPY.pastLogsNote}</p>
        </section>
      ) : null}
      {payload.coverage === 'partial' ? (
        <PartialWarning payload={payload} confirmed={partialConfirmed} onChange={onPartialChange} />
      ) : null}
      {action === 'update-overwrite-tracker-edits' ? (
        <TrackerEditsWarning
          checked={overwriteConfirmed}
          onChange={onOverwriteChange}
          foodName={status.targetFood?.name ?? ''}
        />
      ) : null}
    </div>
  );
}

function OutcomeStep({
  outcome,
  onClose,
  onReviewAgain,
  closeDisabled,
}: {
  outcome: ExportCommitOutcome;
  onClose: () => void;
  onReviewAgain: () => void;
  closeDisabled: boolean;
}) {
  return (
    <div className="space-y-4" role="status">
      <p>{describeExportOutcome(outcome)}</p>
      {outcome.status === 'review-changed' || outcome.status === 'collision' ? (
        <Button onClick={onReviewAgain}>{EXPORT_COPY.reviewAgain}</Button>
      ) : null}
      {outcome.status !== 'review-changed' && outcome.status !== 'collision' ? (
        <Button disabled={closeDisabled} onClick={onClose}>{EXPORT_COPY.close}</Button>
      ) : null}
    </div>
  );
}

/** Render the basis and confirmation steps for one recipe export. */
export default function NutritionExportModal({
  recipe,
  recipeId,
  foods,
  result,
  statuses,
  initialBasis,
  onCommit,
  onClose,
}: NutritionExportModalProps) {
  const choice = useMemo(() => selectExportBasis(recipe, result, recipeId), [recipe, result, recipeId]);
  const initial = initialBasis === 'choose' ? choice.preferred : initialBasis;
  const [basis, setBasis] = useState<NutritionExportBasisKey>(initial ?? 'perPortion');
  const [name, setName] = useState(() => {
    const basisToUse = initial ?? 'perPortion';
    const row = statuses.find((item) => item.basis === basisToUse);
    const ref = row?.ownership === 'own' && row.target === 'missing' ? row.ref : null;
    return ref?.foodName ?? defaultExportFoodName(recipe.name, basisToUse);
  });
  const [partialConfirmed, setPartialConfirmed] = useState(false);
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const [outcome, setOutcome] = useState<ExportCommitOutcome | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const payloadResult = buildExportPayload(recipe, result, basis);
  const status = statuses.find((item) => item.basis === basis) ?? statuses[0];
  const payload = payloadResult.ok ? payloadResult.payload : null;
  const action = exportAction(status, payloadResult);
  const targetFingerprint = status.targetFood === null ? '' : fingerprintTrackerFood(status.targetFood);
  const reviewIdentity = [
    basis,
    payload?.fingerprint ?? payloadResult.ok,
    action,
    status.targetFood?.lastUpdated ?? '',
    targetFingerprint,
  ].join(':');
  const previousReviewIdentity = useRef(reviewIdentity);

  useEffect(() => {
    if (previousReviewIdentity.current === reviewIdentity) return;
    previousReviewIdentity.current = reviewIdentity;
    setPartialConfirmed(false);
    setOverwriteConfirmed(false);
    const ref = status.ownership === 'own' && action === 'recreate' ? status.ref : null;
    setName(ref?.foodName ?? defaultExportFoodName(recipe.name, basis));
  }, [action, basis, recipe.name, reviewIdentity, status]);

  // Closing does not cancel the in-flight transaction, so every dismiss path is a no-op while it runs.
  const requestClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [onClose, submitting]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  if (outcome) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nutrition-export-title"
      >
        <div className="w-full max-w-xl space-y-4 rounded-xl border border-border bg-surface-1 p-5">
          <h2 id="nutrition-export-title" className="text-lg font-semibold">
            {DIALOG_TITLE}
          </h2>
          <OutcomeStep
            outcome={outcome}
            onClose={requestClose}
            closeDisabled={submitting}
            onReviewAgain={() => {
              setPartialConfirmed(false);
              setOverwriteConfirmed(false);
              if (outcome.status !== 'collision') {
                const ref = status.ownership === 'own' && action === 'recreate' ? status.ref : null;
                setName(ref?.foodName ?? defaultExportFoodName(recipe.name, basis));
              }
              setOutcome(null);
            }}
          />
        </div>
      </div>
    );
  }
  if (!payloadResult.ok) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nutrition-export-title"
      >
        <div className="w-full max-w-xl space-y-4 rounded-xl border border-border bg-surface-1 p-5">
          <h2 id="nutrition-export-title" className="text-lg font-semibold">
            {DIALOG_TITLE}
          </h2>
          <p>{describeExportBlock(payloadResult.reason, basis, payloadResult.overCapKeys)}</p>
          <Button disabled={submitting} onClick={requestClose}>{EXPORT_COPY.close}</Button>
        </div>
      </div>
    );
  }
  if (payload === null) return null;
  const nameInvalid =
    (action === 'create' || action === 'recreate') && validateTrackerFoodName(name) !== null;
  const collision =
    (action === 'create' || action === 'recreate') &&
    findExportCollision(trackerFoodId(name), foods.items, status) !== null;
  const disabled =
    submitting ||
    nameInvalid ||
    collision ||
    (payload.coverage === 'partial' && !partialConfirmed) ||
    (action === 'update-overwrite-tracker-edits' && !overwriteConfirmed) ||
    action === 'blocked';

  const submit = async () => {
    const nextOutcome = await onCommit({
      basis,
      reviewedFingerprint: payload.fingerprint,
      reviewedAction: action,
      reviewedTarget: status.targetFood === null ? null : trackerFoodLinkTarget(status.targetFood),
      chosenName: name,
      partialConfirmed,
      overwriteTrackerEdits: overwriteConfirmed,
    });
    setOutcome(nextOutcome);
  };

  const buttonLabel =
    action === 'update' || action === 'update-overwrite-tracker-edits'
      ? UPDATE_LABEL
      : action === 'recreate'
        ? RECREATE_LABEL
        : CREATE_LABEL;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nutrition-export-title"
    >
      <div className="my-auto w-full max-w-2xl space-y-4 rounded-xl border border-border bg-surface-1 p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 id="nutrition-export-title" className="text-lg font-semibold">
            {DIALOG_TITLE}
          </h2>
          <Button variant="ghost" disabled={submitting} onClick={requestClose}>
            {EXPORT_COPY.cancel}
          </Button>
        </div>
        <>
          {initialBasis === 'choose' ? (
              <BasisStep
                recipe={recipe}
                result={result}
                recipeId={recipeId}
                basis={basis}
                onChange={(nextBasis) => {
                  setBasis(nextBasis);
                  const row = statuses.find((item) => item.basis === nextBasis);
                  const ref = row?.ownership === 'own' && row.target === 'missing' ? row.ref : null;
                  setName(ref?.foodName ?? defaultExportFoodName(recipe.name, nextBasis));
                  setPartialConfirmed(false);
                  setOverwriteConfirmed(false);
                }}
              />
            ) : null}
            <ReviewStep
              foods={foods}
              status={status}
              payload={payload}
              action={action}
              name={name}
              onNameChange={setName}
              partialConfirmed={partialConfirmed}
              onPartialChange={setPartialConfirmed}
              overwriteConfirmed={overwriteConfirmed}
              onOverwriteChange={setOverwriteConfirmed}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={submitting} onClick={requestClose}>
                {EXPORT_COPY.cancel}
              </Button>
              <Button
                disabled={disabled}
                onClick={() => {
                  setSubmitting(true);
                  void submit().finally(() => setSubmitting(false));
                }}
              >
                {submitting ? EXPORT_COPY.saving : buttonLabel}
              </Button>
          </div>
        </>
      </div>
    </div>
  );
}
