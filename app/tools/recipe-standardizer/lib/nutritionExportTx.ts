/* --- CONFIGURATION: export transaction field paths --- */
/** Firebase-free transaction body; validate all sources and the recipe revision before staging atomic writes. */

const MESSAGE_COPY = {
  recipeNoLongerExists: 'Recipe no longer exists.',
  recipeExportReferenceChangedFor: (value0: unknown) => `Recipe export reference changed for ${value0}.`,
  nutritionTrackerFoodWasDeleted: (value0: unknown) => `Nutrition Tracker food ${value0} was deleted.`,
  nutritionTrackerFoodChangedAfterReview: (value0: unknown) =>
    `Nutrition Tracker food ${value0} changed after review.`,
  invalidExportDocumentIdS: (value0: unknown) => `Invalid export document ID(s): ${value0}`,
} as const;

const RECIPE_FIELD_PREFIX = 'recipe.nutritionExports.';
const UPDATED_AT_FIELD = 'updatedAt';

/**
 * Firebase-free transaction body for writing a tracker food and its recipe back-reference atomically.
 * It checks and bumps the recipe revision, then reads and validates every dependency before staging either write.
 */

import { checkRecipeRevision, RECIPE_REVISION_FIELD } from './recipeRevision';
import { parseNutritionExport, sameNutritionExport } from './nutritionExportRef';
import type { ExportCommitRequest } from './nutritionExport';
import {
  FoodIdCollisionError,
  FoodLinkTargetChangedError,
  isValidFirestoreDocId,
  linkTargetChanged,
  parseTrackerFood,
} from './trackerFoods';
import type { NutritionExportBasisKey } from './types';

/** Minimal snapshot surface used by the export transaction. */
export interface ExportTxSnapshot {
  /** Return whether the document exists. */
  exists(): boolean;
  /** Return untrusted document data. */
  data(): unknown;
}

/** Minimal transaction surface adapted by the Firestore layer. */
export interface ExportTxPort<R> {
  /** Read a document snapshot. */
  get(ref: R): Promise<ExportTxSnapshot>;
  /** Stage a full document replacement. */
  set(ref: R, data: ExportCommitRequest['doc']): void;
  /** Stage an update using dotted field paths. */
  update(ref: R, data: Record<string, unknown>): void;
}

/** Document references used for the food, recipe, and ingredient reads. */
export interface ExportTxRefs<R> {
  /** Tracker food document being created or replaced. */
  food: R;
  /** Saved recipe document receiving the back-reference. */
  recipe: R;
  /** Resolve a tracker food document by id. */
  sourceFood: (foodId: string) => R;
}

/** Return the stored field path for one basis reference. */
export const exportRefFieldPath = (basis: NutritionExportBasisKey): string =>
  `${RECIPE_FIELD_PREFIX}${basis}`;

/** Error raised when the referenced recipe has disappeared. */
export class ExportRecipeMissingError extends Error {
  constructor() {
    super(MESSAGE_COPY.recipeNoLongerExists);
    this.name = 'ExportRecipeMissingError';
  }
}

/** Error raised when the export reference changed after review. */
export class ExportRefChangedError extends Error {
  readonly basis: NutritionExportBasisKey;

  constructor(basis: NutritionExportBasisKey) {
    super(MESSAGE_COPY.recipeExportReferenceChangedFor(basis));
    this.name = 'ExportRefChangedError';
    this.basis = basis;
  }
}

/** Error raised when the update target was deleted after review. */
export class ExportTargetMissingError extends Error {
  readonly foodId: string;

  constructor(foodId: string) {
    super(MESSAGE_COPY.nutritionTrackerFoodWasDeleted(foodId));
    this.name = 'ExportTargetMissingError';
    this.foodId = foodId;
  }
}

/** Error raised when the update target changed after review. */
export class ExportTargetChangedError extends Error {
  readonly foodId: string;

  constructor(foodId: string) {
    super(MESSAGE_COPY.nutritionTrackerFoodChangedAfterReview(foodId));
    this.name = 'ExportTargetChangedError';
    this.foodId = foodId;
  }
}

/** Validate every document id before opening a transaction. */
export const assertExportRequestIds = (request: ExportCommitRequest): void => {
  const ids = [request.foodId, request.recipeId, ...request.sourceTargets.map((target) => target.id)];
  const invalid = [...new Set(ids.filter((id) => !isValidFirestoreDocId(id)))];
  if (invalid.length > 0) throw new Error(MESSAGE_COPY.invalidExportDocumentIdS(invalid.join(', ')));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Read all documents, verify their captured revisions, and stage both writes. */
export const runExportTransaction = async <R>(
  tx: ExportTxPort<R>,
  refs: ExportTxRefs<R>,
  request: ExportCommitRequest,
  serverTimestampValue: unknown,
): Promise<void> => {
  assertExportRequestIds(request);
  const sourceIds = [...new Set(request.sourceTargets.map((target) => target.id))];
  const sourceRefs = sourceIds.map((id) => refs.sourceFood(id));
  const [foodSnapshot, recipeSnapshot, sourceSnapshots] = await Promise.all([
    tx.get(refs.food),
    tx.get(refs.recipe),
    Promise.all(sourceRefs.map((ref) => tx.get(ref))),
  ]);
  if (!recipeSnapshot.exists()) throw new ExportRecipeMissingError();
  const storedRevision = checkRecipeRevision(recipeSnapshot, request.expectedRecipeRevision);
  const recipeData = recipeSnapshot.data();
  const recipeRecord = isRecord(recipeData) ? recipeData.recipe : null;
  const recipeBody = isRecord(recipeRecord) ? recipeRecord : {};
  const exportsValue = isRecord(recipeBody.nutritionExports) ? recipeBody.nutritionExports : {};
  const warnings: string[] = [];
  const storedRefValue = exportsValue[request.basis];
  const storedRef =
    storedRefValue === undefined
      ? null
      : parseNutritionExport(storedRefValue, request.basis, `nutritionExports.${request.basis}`, warnings);
  if (!sameNutritionExport(storedRef, request.previousRef)) throw new ExportRefChangedError(request.basis);

  const sourceById = new Map(sourceSnapshots.map((snapshot, index) => [sourceIds[index], snapshot]));
  const changedSourceIds: string[] = [];
  for (const target of request.sourceTargets) {
    const snapshot = sourceById.get(target.id);
    if (snapshot === undefined || !snapshot.exists()) {
      changedSourceIds.push(target.id);
      continue;
    }
    if (linkTargetChanged(parseTrackerFood(target.id, snapshot.data()), target)) {
      changedSourceIds.push(target.id);
    }
  }
  if (changedSourceIds.length > 0) throw new FoodLinkTargetChangedError(changedSourceIds);

  if (request.mode === 'create') {
    if (foodSnapshot.exists()) throw new FoodIdCollisionError([request.foodId]);
  } else {
    if (!foodSnapshot.exists()) throw new ExportTargetMissingError(request.foodId);
    if (request.expectedTarget === null) throw new ExportTargetChangedError(request.foodId);
    const target = parseTrackerFood(request.foodId, foodSnapshot.data());
    if (linkTargetChanged(target, request.expectedTarget)) throw new ExportTargetChangedError(request.foodId);
  }

  tx.set(refs.food, request.doc);
  tx.update(refs.recipe, {
    [exportRefFieldPath(request.basis)]: request.nextRef,
    [UPDATED_AT_FIELD]: serverTimestampValue,
    [RECIPE_REVISION_FIELD]: storedRevision + 1,
  });
};
