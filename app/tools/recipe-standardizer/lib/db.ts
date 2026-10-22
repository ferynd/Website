/* --- CONFIGURATION: namespaces live in lib/namespaces.ts --- */
/**
 * Firestore layout: one document per recipe at
 *   artifacts/recipe-standardizer/users/{uid}/recipes/{recipeId}
 *
 * A whole recipe (sections + ingredients + steps) is a few KB — far below
 * the 1 MB document limit — so a single document keeps loads/saves atomic
 * and needs no subcollections. Updates replace the recipe in a revision-checked transaction. First save creates the path implicitly; no
 * manual Firestore seeding is required.
 */
'use client';

const MESSAGE_COPY = {
  untitledRecipe: 'Untitled recipe',
  missingRecipe: 'This recipe no longer exists in Firestore.',

  invalidFoodDocumentIdS: (value0: unknown) => `Invalid food document ID(s): ${value0}`,
  atMostFoodsCanBeCreated: (value0: unknown) => `At most ${value0} foods can be created at once.`,
  duplicateFoodIdsInOneBatch: 'Duplicate food ids in one batch.',
} as const;

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type CollectionReference,
  type DocumentReference,
  type FirestoreError,
} from 'firebase/firestore';
import { ROOT_COLLECTION, RECIPE_APP_ID, CALORIE_TRACKER_APP_ID } from './namespaces';
import { db } from './firebase';
import { parseRecipeJson } from './schema';
import type { Recipe, SavedRecipeMeta } from './types';
import {
  FoodIdCollisionError,
  FoodLinkTargetChangedError,
  FoodTargetReappearedError,
  isValidFirestoreDocId,
  linkTargetChanged,
  parseTrackerFood,
  type LinkTarget,
  type TrackerFood,
  type TrackerFoodDoc,
} from './trackerFoods';
import { MAX_INTAKE_ITEMS } from './nutritionIntake';
import { assertExportRequestIds, runExportTransaction, type ExportTxPort } from './nutritionExportTx';
import type { ExportCommitRequest } from './nutritionExport';

import {
  INITIAL_RECIPE_REVISION,
  RECIPE_REVISION_FIELD,
  readRecipeRevision,
  runRecipeUpdateTransaction,
  type LoadRecipeResult,
  type RecipeUpdateResult,
  type RecipeTxPort,
} from './recipeRevision';

const recipesCol = (uid: string): CollectionReference =>
  collection(db, ROOT_COLLECTION, RECIPE_APP_ID, 'users', uid, 'recipes');

const foodItemsCol = (uid: string): CollectionReference =>
  collection(db, ROOT_COLLECTION, CALORIE_TRACKER_APP_ID, 'users', uid, 'foodItems');

/** Watch the user's saved recipes (metadata only, newest first). */
export const watchRecipeList = (
  uid: string,
  onData: (recipes: SavedRecipeMeta[], error?: FirestoreError) => void,
): (() => void) =>
  onSnapshot(
    query(recipesCol(uid), orderBy('updatedAt', 'desc')),
    (snap) => {
      const metas = snap.docs.map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;
        const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : null;
        const recipe = data.recipe as Record<string, unknown> | undefined;
        return {
          id: docSnap.id,
          name: typeof data.name === 'string' ? data.name : MESSAGE_COPY.untitledRecipe,
          updatedAtMs: updatedAt,
          revision: readRecipeRevision(data),
          sectionCount: Array.isArray(recipe?.sections) ? recipe.sections.length : 0,
          ingredientCount: Array.isArray(recipe?.ingredients) ? recipe.ingredients.length : 0,
        };
      });
      onData(metas);
    },
    (error) => onData([], error),
  );

/**
 * Recipes are stored as `{ name, recipe, createdAt, updatedAt, revision }` where
 * `recipe` is the full Recipe object. Loading re-runs the same strict
 * validator as import so a hand-edited or legacy document can never put the
 * UI into a half-valid state.
 */
export const loadRecipe = async (uid: string, recipeId: string): Promise<LoadRecipeResult> => {
  const snap = await getDoc(doc(recipesCol(uid), recipeId));
  if (!snap.exists()) {
    return {
      ok: false,
      errors: [MESSAGE_COPY.missingRecipe],
      missing: true,
    };
  }
  const data = snap.data() as Record<string, unknown>;
  const parsed = parseRecipeJson(JSON.stringify(data.recipe ?? {}));
  return parsed.ok ? { ...parsed, revision: readRecipeRevision(data) } : { ...parsed, missing: false };
};

/** Save new recipe helper. */
export const saveNewRecipe = async (uid: string, recipe: Recipe): Promise<string> => {
  const ref = await addDoc(recipesCol(uid), {
    name: recipe.name,
    recipe,
    [RECIPE_REVISION_FIELD]: INITIAL_RECIPE_REVISION,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
};

/** Replace a saved recipe only at the explicitly reviewed revision; retain server export refs. */
export const updateRecipe = async (
  uid: string,
  recipeId: string,
  recipe: Recipe,
  expectedRevision: number,
): Promise<RecipeUpdateResult> => runTransaction(db, (transaction) => {
  const port: RecipeTxPort<DocumentReference> = {
    get: (ref) => transaction.get(ref),
    update: (ref, data) => {
      transaction.update(ref, data);
    },
  };
  return runRecipeUpdateTransaction(
    port,
    doc(recipesCol(uid), recipeId),
    { recipe, expectedRevision },
    serverTimestamp(),
  );
});

/** Delete is unconditional after the library's explicit confirmation. */
export const deleteRecipe = async (uid: string, recipeId: string): Promise<void> => {
  await deleteDoc(doc(recipesCol(uid), recipeId));
};

/**
 * Fetch tracker foods for linking and nutrition math. Writes create foods or update verified own exports;
 * this adapter never deletes tracker foods.
 */
export const fetchFoodItems = async (uid: string): Promise<TrackerFood[]> => {
  const snap = await getDocs(foodItemsCol(uid));
  return snap.docs
    .map((docSnap) => parseTrackerFood(docSnap.id, docSnap.data()))
    .filter((food): food is TrackerFood => food !== null);
};

/**
 * Export a recipe as a tracker food in one transaction. It creates a new food or updates only this
 * recipe's verified previous export, and writes the recipe back-reference in the same transaction.
 */
export const exportRecipeFood = async (uid: string, request: ExportCommitRequest): Promise<void> => {
  assertExportRequestIds(request);
  await runTransaction(db, async (transaction) => {
    const port: ExportTxPort<DocumentReference> = {
      get: (ref) => transaction.get(ref),
      set: (ref, data) => {
        transaction.set(ref, data);
      },
      update: (ref, data) => {
        transaction.update(ref, data);
      },
    };
    await runExportTransaction(
      port,
      {
        food: doc(foodItemsCol(uid), request.foodId),
        recipe: doc(recipesCol(uid), request.recipeId),
        sourceFood: (foodId) => doc(foodItemsCol(uid), foodId),
      },
      request,
      serverTimestamp(),
    );
  });
};

/** Create new tracker foods atomically; never overwrites. */
export const createFoodItemsIfAbsent = async (
  uid: string,
  docs: {
    id: string;
    data: TrackerFoodDoc;
  }[],
  guardIds: string[] = [],
  linkTargets: LinkTarget[] = [],
): Promise<void> => {
  const ids = docs.map((d) => d.id);
  const invalidIds = ids.filter((id) => !isValidFirestoreDocId(id));
  if (invalidIds.length) throw new Error(MESSAGE_COPY.invalidFoodDocumentIdS(invalidIds.join(', ')));
  const invalidLinkIds = [...new Set(linkTargets.map(({ id }) => id).filter((id) => !isValidFirestoreDocId(id)))];
  if (invalidLinkIds.length) throw new FoodLinkTargetChangedError(invalidLinkIds);
  const idSet = new Set(ids);
  const uniqueGuardIds = [...new Set(guardIds.filter((id) => isValidFirestoreDocId(id) && !idSet.has(id)))];
  const linkTargetsById = new Map<string, LinkTarget>();
  for (const target of linkTargets) {
    if (!linkTargetsById.has(target.id)) linkTargetsById.set(target.id, target);
  }
  const uniqueLinkTargets = [...linkTargetsById.values()];
  if (!docs.length && !uniqueGuardIds.length && !uniqueLinkTargets.length) return;
  if (docs.length > MAX_INTAKE_ITEMS) throw new Error(MESSAGE_COPY.atMostFoodsCanBeCreated(MAX_INTAKE_ITEMS));
  if (new Set(ids).size !== ids.length) throw new Error(MESSAGE_COPY.duplicateFoodIdsInOneBatch);
  await runTransaction(db, async (tx) => {
    const refs = docs.map((d) => doc(foodItemsCol(uid), d.id));
    const guardRefs = uniqueGuardIds.map((id) => doc(foodItemsCol(uid), id));
    const linkRefs = uniqueLinkTargets.map(({ id }) => doc(foodItemsCol(uid), id));
    const [snaps, guardSnaps, linkSnaps] = await Promise.all([
      Promise.all(refs.map((ref) => tx.get(ref))),
      Promise.all(guardRefs.map((ref) => tx.get(ref))),
      Promise.all(linkRefs.map((ref) => tx.get(ref))),
    ]);
    const existing = snaps.filter((snap) => snap.exists()).map((snap) => snap.id);
    if (existing.length) throw new FoodIdCollisionError(existing);
    const reappeared = guardSnaps.filter((snap) => snap.exists()).map((snap) => snap.id);
    if (reappeared.length) throw new FoodTargetReappearedError(reappeared);
    const changedLinks = linkSnaps.flatMap((snap, index) => {
      const expected = uniqueLinkTargets[index];
      if (!snap.exists()) return [expected.id];
      const parsed = parseTrackerFood(snap.id, snap.data());
      if (linkTargetChanged(parsed, expected)) return [expected.id];
      return [];
    });
    if (changedLinks.length) throw new FoodLinkTargetChangedError(changedLinks);
    refs.forEach((ref, i) => tx.set(ref, docs[i].data));
  });
};
