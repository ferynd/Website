/* --- CONFIGURATION: export commit labels --- */
/** Pure modal decisions; reviewed identity changes invalidate confirmations and reset the name. */

import {
  defaultExportFoodName,
  findExportCollision,
  type ExportAction,
  type ExportCommitOutcome,
  type ExportPayload,
  type ExportPayloadResult,
  type ExportStatus,
} from './nutritionExport';
import {
  fingerprintTrackerFood,
  trackerFoodId,
  validateTrackerFoodName,
  type FoodsState,
  type TrackerFood,
} from './trackerFoods';
import type { NutritionExportBasisKey } from './types';

const CREATE_LABEL = 'Create food';
const UPDATE_LABEL = 'Update food';
const RECREATE_LABEL = 'Create food again';

/** Reuse a deleted own export's name; other exports use the recipe and basis suffix. */
export const initialExportName = (
  recipeName: string,
  statuses: ExportStatus[],
  basis: NutritionExportBasisKey,
): string => {
  const row = statuses.find((status) => status.basis === basis);
  const ref = row?.ownership === 'own' && row.target === 'missing' ? row.ref : null;
  return ref?.foodName ?? defaultExportFoodName(recipeName, basis);
};

/** Identity of the reviewed payload, action, and tracker target revision. */
export const exportReviewIdentity = (input: {
  basis: NutritionExportBasisKey;
  payloadResult: ExportPayloadResult;
  action: ExportAction;
  targetFood: TrackerFood | null;
}): string => [
  input.basis,
  input.payloadResult.ok ? input.payloadResult.payload.fingerprint : input.payloadResult.ok,
  input.action,
  input.targetFood?.lastUpdated ?? '',
  input.targetFood === null ? '' : fingerprintTrackerFood(input.targetFood),
].join(':');

/** Commit requires valid create identity and all applicable explicit confirmations. */
export const exportSubmitDisabled = (input: {
  submitting: boolean;
  action: ExportAction;
  name: string;
  foods: FoodsState;
  status: ExportStatus;
  payload: ExportPayload;
  partialConfirmed: boolean;
  overwriteConfirmed: boolean;
}): boolean => {
  const creating = input.action === 'create' || input.action === 'recreate';
  const nameInvalid = creating && validateTrackerFoodName(input.name) !== null;
  const collision = creating && findExportCollision(
    trackerFoodId(input.name), input.foods.items, input.status,
  ) !== null;
  return input.submitting || nameInvalid || collision ||
    (input.payload.coverage === 'partial' && !input.partialConfirmed) ||
    (input.action === 'update-overwrite-tracker-edits' && !input.overwriteConfirmed) ||
    input.action === 'blocked';
};

/** A name collision keeps the user's typed name; other review retries reset it. */
export const nameAfterReviewAgain = (input: {
  outcome: ExportCommitOutcome;
  currentName: string;
  recipeName: string;
  statuses: ExportStatus[];
  basis: NutritionExportBasisKey;
}): string => input.outcome.status === 'collision'
    ? input.currentName
    : initialExportName(input.recipeName, input.statuses, input.basis);

/** Outcome-specific actions; a conflict returns to review before closing. */
export const exportOutcomeActions = (outcome: ExportCommitOutcome): {
  reviewAgain: boolean;
  close: boolean;
} => {
  switch (outcome.status) {
    case 'review-changed':
    case 'collision':
      return { reviewAgain: true, close: false };
    case 'done':
    case 'error':
      return { reviewAgain: false, close: true };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
};

/** Label matching the operation committed by this review. */
export const exportCommitLabel = (action: ExportAction): string => {
  switch (action) {
    case 'create':
    case 'blocked':
      return CREATE_LABEL;
    case 'update':
    case 'update-overwrite-tracker-edits':
      return UPDATE_LABEL;
    case 'recreate':
      return RECREATE_LABEL;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
};

/** Every dismissal path stays disabled while its transaction runs. */
export const canDismissExport = (submitting: boolean): boolean => !submitting;
