/* --- CONFIGURATION: recipe revision contract --- */
/** Firebase-free revision checks; editor saves replace the recipe while preserving raw stored exports. */

import type { ParseFailure, ParseSuccess } from './schema';
import { parseNutritionExports } from './nutritionExportRef';
import type { Recipe, RecipeNutritionExports, SavedRecipeMeta } from './types';

/** Top-level Firestore revision field, excluded from imported/exported recipe JSON. */
export const RECIPE_REVISION_FIELD = 'revision';
/** Revision assumed for legacy or invalid stored fields. */
export const LEGACY_RECIPE_REVISION = 0;
/** Revision written on a new recipe document. */
export const INITIAL_RECIPE_REVISION = 1;
const NAME_FIELD = 'name';
const RECIPE_FIELD = 'recipe';
const UPDATED_AT_FIELD = 'updatedAt';
const INVALID_REVISION_MESSAGE = 'Invalid expected recipe revision.';
const CONFLICT_MESSAGES = {
  deleted: 'Recipe was deleted.',
  changed: 'Recipe changed since it was loaded.',
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** True for a non-negative safe integer revision. */
export const isValidRecipeRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= LEGACY_RECIPE_REVISION;

/** Missing or invalid stored revision is treated as legacy revision zero. */
export const readRecipeRevision = (data: unknown): number => {
  const value = isRecord(data) ? data[RECIPE_REVISION_FIELD] : undefined;
  return isValidRecipeRevision(value) ? value : LEGACY_RECIPE_REVISION;
};

/** Detected remote change to the open saved document. */
export type RecipeConflict =
  | {
    kind: 'changed'; /** Revision observed remotely, required for an explicit overwrite. */ remoteRevision: number;
  }
  | {
    kind: 'deleted';
  };

/** Derived listener state; never persisted. */
export type RemoteRecipeState = {
  kind: 'none';
} | RecipeConflict;

/** A failed precondition; the transaction commits no writes. */
export class RecipeRevisionConflictError extends Error {
  /** Observed conflict presented to the user. */
  readonly conflict: RecipeConflict;

  constructor(conflict: RecipeConflict) {
    super(CONFLICT_MESSAGES[conflict.kind]);
    this.name = 'RecipeRevisionConflictError';
    this.conflict = conflict;
  }
}

/** Snapshot surface shared with the export transaction. */
export interface RecipeTxSnapshot {
  /** Whether the requested document exists. */
  exists(): boolean;
  /** Untrusted stored fields. */
  data(): unknown;
}

/** Minimal transaction surface for recipe updates. */
export interface RecipeTxPort<R> {
  /** Read before staging any writes. */
  get(ref: R): Promise<RecipeTxSnapshot>;
  /** Stage top-level field replacements. */
  update(ref: R, data: Record<string, unknown>): void;
}

/** Committed revision and parsed references the editor must adopt. */
export interface RecipeUpdateResult {
  /** Stored revision incremented by one. */
  revision: number;
  /** Parsed stored exports; never taken from the draft. */
  nutritionExports: RecipeNutritionExports;
}

/** Verify existence and equality with the revision reviewed by this editor. */
export const checkRecipeRevision = (snapshot: RecipeTxSnapshot, expectedRevision: number): number => {
  if (!snapshot.exists()) throw new RecipeRevisionConflictError({ kind: 'deleted' });
  const stored = readRecipeRevision(snapshot.data());
  if (stored !== expectedRevision) {
    throw new RecipeRevisionConflictError({ kind: 'changed', remoteRevision: stored });
  }
  return stored;
};

/** Replace name and recipe atomically, retaining the raw stored nutrition-export map. */
export const runRecipeUpdateTransaction = async <R>(
  tx: RecipeTxPort<R>,
  ref: R,
  input: {
    recipe: Recipe;
    expectedRevision: number;
  },
  serverTimestampValue: unknown,
): Promise<RecipeUpdateResult> => {
  if (!isValidRecipeRevision(input.expectedRevision)) throw new Error(INVALID_REVISION_MESSAGE);
  const snapshot = await tx.get(ref);
  const stored = checkRecipeRevision(snapshot, input.expectedRevision);
  const data = snapshot.data();
  const recipe = isRecord(data) && isRecord(data.recipe) ? data.recipe : {};
  const rawExports = isRecord(recipe.nutritionExports) ? recipe.nutritionExports : {};
  tx.update(ref, {
    [NAME_FIELD]: input.recipe.name,
    [RECIPE_FIELD]: { ...input.recipe, nutritionExports: rawExports },
    [UPDATED_AT_FIELD]: serverTimestampValue,
    [RECIPE_REVISION_FIELD]: stored + 1,
  });
  return { revision: stored + 1, nutritionExports: parseNutritionExports(rawExports, []) };
};

/** Parse result plus revision, distinguishing absent documents from malformed ones. */
export type LoadRecipeResult =
  | (ParseSuccess & {
    revision: number;
  })
  | (ParseFailure & {
    missing: boolean;
  });

/** Listener and editor state needed for deriving a remote change notice. */
export interface RemoteStateInput {
  currentId: string | null;
  baseRevision: number | null;
  metas: SavedRecipeMeta[];
  listLoaded: boolean;
  listError: boolean;
  /** Suppress own commit snapshots until local revision adoption. */
  writeInFlight: boolean;
  /** Has this ID appeared in this session's list? Avoids false deletion for new saves. */
  seenInList: boolean;
}

/** Derive remote change/deletion without another Firestore listener. */
export const deriveRemoteRecipeState = (input: RemoteStateInput): RemoteRecipeState => {
  const none = { kind: 'none' } as const;
  if (input.currentId === null || input.baseRevision === null) return none;
  if (!input.listLoaded || input.listError || input.writeInFlight) return none;
  const meta = input.metas.find((item) => item.id === input.currentId);
  if (!meta) return input.seenInList ? { kind: 'deleted' } : none;
  return meta.revision > input.baseRevision
    ? { kind: 'changed', remoteRevision: meta.revision }
    : none;
};

/** Conflict actions in display order. */
export type RecipeConflictChoice = 'reload' | 'overwrite' | 'save-as-new' | 'close' | 'keep-editing';

/** Overwrite is offered only for a changed saved document with local edits. */
export const conflictChoices = (conflict: RecipeConflict, dirty: boolean): RecipeConflictChoice[] => {
  switch (conflict.kind) {
    case 'changed':
      return dirty
        ? ['reload', 'overwrite', 'save-as-new', 'keep-editing']
        : ['reload', 'save-as-new', 'keep-editing'];
    case 'deleted':
      return ['save-as-new', 'close', 'keep-editing'];
    default: {
      const exhaustive: never = conflict;
      return exhaustive;
    }
  }
};
