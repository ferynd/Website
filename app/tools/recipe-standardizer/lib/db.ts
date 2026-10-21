"use client";

/* ------------------------------------------------------------ */
/* CONFIGURATION: Firestore roots                                */
/* ------------------------------------------------------------ */
export const ROOT_COLLECTION = 'artifacts';
export const APP_ID = 'recipe-standardizer';
/**
 * CalorieTracker's Firestore app id. Its static site never sets
 * `window.__app_id`, so it falls back to 'default-app-id'
 * (see public/tools/CalorieTracker/config.js). Saved food items live at
 * artifacts/default-app-id/users/{uid}/foodItems/{foodId}.
 */
export const CALORIE_TRACKER_APP_ID = 'default-app-id';

/**
 * Firestore layout: one document per recipe at
 *   artifacts/recipe-standardizer/users/{uid}/recipes/{recipeId}
 *
 * A whole recipe (sections + ingredients + steps) is a few KB — far below
 * the 1 MB document limit — so a single document keeps loads/saves atomic
 * and needs no subcollections. First save creates the path implicitly; no
 * manual Firestore seeding is required.
 */

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
  setDoc,
  Timestamp,
  type CollectionReference,
  type FirestoreError,
} from 'firebase/firestore';
import { db } from './firebase';
import { parseRecipeJson, type ParseResult } from './schema';
import type { Recipe, SavedRecipeMeta } from './types';
import { FoodIdCollisionError, FoodLinkTargetChangedError, FoodTargetReappearedError, isValidFirestoreDocId, linkTargetChanged, parseTrackerFood, type LinkTarget, type TrackerFood, type TrackerFoodDoc } from './trackerFoods';
import { MAX_INTAKE_ITEMS } from './nutritionIntake';

const recipesCol = (uid: string): CollectionReference =>
  collection(db, ROOT_COLLECTION, APP_ID, 'users', uid, 'recipes');

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
          name: typeof data.name === 'string' ? data.name : 'Untitled recipe',
          updatedAtMs: updatedAt,
          sectionCount: Array.isArray(recipe?.sections) ? recipe.sections.length : 0,
          ingredientCount: Array.isArray(recipe?.ingredients) ? recipe.ingredients.length : 0,
        };
      });
      onData(metas);
    },
    (error) => onData([], error),
  );

/**
 * Recipes are stored as `{ name, recipe, createdAt, updatedAt }` where
 * `recipe` is the full Recipe object. Loading re-runs the same strict
 * validator as import so a hand-edited or legacy document can never put the
 * UI into a half-valid state.
 */
export const loadRecipe = async (uid: string, recipeId: string): Promise<ParseResult> => {
  const snap = await getDoc(doc(recipesCol(uid), recipeId));
  if (!snap.exists()) {
    return { ok: false, errors: ['This recipe no longer exists in Firestore.'] };
  }
  const data = snap.data() as Record<string, unknown>;
  return parseRecipeJson(JSON.stringify(data.recipe ?? {}));
};

export const saveNewRecipe = async (uid: string, recipe: Recipe): Promise<string> => {
  const ref = await addDoc(recipesCol(uid), {
    name: recipe.name,
    recipe,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
};

export const updateRecipe = async (uid: string, recipeId: string, recipe: Recipe): Promise<void> => {
  await setDoc(doc(recipesCol(uid), recipeId), {
    name: recipe.name,
    recipe,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

export const deleteRecipe = async (uid: string, recipeId: string): Promise<void> => {
  await deleteDoc(doc(recipesCol(uid), recipeId));
};

/** Fetch full food records for linking and later nutrition math. This module creates foods but never updates or deletes existing tracker foods. */
export const fetchFoodItems = async (uid: string): Promise<TrackerFood[]> => {
  const snap = await getDocs(foodItemsCol(uid));
  return snap.docs
    .map((docSnap) => parseTrackerFood(docSnap.id, docSnap.data()))
    .filter((food): food is TrackerFood => food !== null);
};

/** Create new tracker foods atomically; never overwrites. */
export const createFoodItemsIfAbsent = async (
  uid: string,
  docs: { id: string; data: TrackerFoodDoc }[],
  guardIds: string[] = [],
  linkTargets: LinkTarget[] = [],
): Promise<void> => {
  const ids = docs.map((d) => d.id);
  const invalidIds = ids.filter((id) => !isValidFirestoreDocId(id));
  if (invalidIds.length) throw new Error(`Invalid food document ID(s): ${invalidIds.join(', ')}`);
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
  if (docs.length > MAX_INTAKE_ITEMS) throw new Error(`At most ${MAX_INTAKE_ITEMS} foods can be created at once.`);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate food ids in one batch.');
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
