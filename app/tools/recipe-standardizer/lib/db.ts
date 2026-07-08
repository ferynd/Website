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
  serverTimestamp,
  setDoc,
  Timestamp,
  type CollectionReference,
  type FirestoreError,
} from 'firebase/firestore';
import { db } from './firebase';
import { parseRecipeJson, type ParseResult } from './schema';
import type { FoodItemRef, Recipe, SavedRecipeMeta } from './types';

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

/** Fetch the user's CalorieTracker saved foods for nutrition-link matching. */
export const fetchFoodItems = async (uid: string): Promise<FoodItemRef[]> => {
  const snap = await getDocs(foodItemsCol(uid));
  return snap.docs
    .map((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      return { id: docSnap.id, name: typeof data.name === 'string' ? data.name : '' };
    })
    .filter((item) => item.name.length > 0);
};
