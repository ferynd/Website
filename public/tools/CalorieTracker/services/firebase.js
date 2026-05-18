/**
 * @file src/services/firebase.js
 * @description Initializes Firebase and exports auth and Firestore functions.
 * This module centralizes all direct interactions with the Firebase backend.
 */

import { appId } from '../config.js';
import { allNutrients } from '../constants.js';
import { state, coerceQuantity } from '../state/store.js';
import { handleError, debugLog, showMessage } from '../utils/ui.js';
import {
  normalizeEntry,
  normalizeUserProfile,
  normalizeGoalSettings,
  prepareEntryForSave,
  prepareProfileForSave,
  prepareGoalSettingsForSave,
} from '../state/schema.js';

import { firebaseConfig as importedConfig } from '../firebaseConfig.js';

// Firebase ESM CDN imports
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  signInWithCustomToken
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  deleteDoc,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

// Helper to safely generate IDs across environments
function safeId() {
  try {
    return crypto.randomUUID();
  } catch (e) {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
// Configuration
const FIREBASE_DATA_CONFIG = {
  DEFAULT_QUANTITY: 0
};

// Validate that the imported config is valid before initializing.
if (!importedConfig || !importedConfig.apiKey) {
  throw new Error('firebaseConfig.js is missing or does not contain required keys (e.g., apiKey).');
}
debugLog('firebase', '✅ Firebase config loaded from ../firebaseConfig.js');

// Initialize Firebase services
export const app = initializeApp(importedConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// ---------- DATABASE (FIRESTORE) CRUD FUNCTIONS ----------

/**
 * Saves or updates the user's baseline nutrient targets in Firestore.
 * @param {object} targets - The nutrient targets object to save.
 */
export async function saveTargets(targets) {
  if (!state.userId) return showMessage('Cannot save targets. Not authenticated.', true);
  try {
    await setDoc(doc(db, `artifacts/${appId}/users/${state.userId}/targets/baseline`), targets);
    state.baselineTargets = targets; // Update local state immediately
    showMessage('Targets saved successfully!');
    debugLog('firebase-save', 'Targets saved successfully');
  } catch (e) {
    handleError('targets-save', e, 'Failed to save targets.');
    throw e; // Re-throw to be caught by the caller if needed
  }
}

/**
 * Fetches the user's baseline nutrient targets from Firestore.
 * @returns {Promise<object>} A promise that resolves to the targets object, or an empty object if not found.
 */
export async function fetchTargets() {
  if (!state.userId) return {};
  try {
    const ref = doc(db, `artifacts/${appId}/users/${state.userId}/targets/baseline`);
    const snap = await getDoc(ref);
    const result = snap.exists() ? snap.data() : {};
    debugLog('firebase-fetch', 'Targets fetched successfully');
    return result;
  } catch (e) {
    return handleError('targets-fetch', e, 'Failed to fetch targets.') || {};
  }
}

/**
 * Saves or updates a single daily nutrition entry in Firestore.
 * @param {string} dateStr - The date of the entry in 'YYYY-MM-DD' format.
 * @param {object} entry - The entry data to save.
 */
export async function saveDailyEntry(dateStr, entry) {
  if (!state.userId) return showMessage('Cannot save entry. Not authenticated.', true);
  try {
    // Always snapshot state.dailyFoodItems into the saved document.
    const foodItems = state.dailyFoodItems.map(it => ({
      ...it,
      id: it.id || safeId(),
      quantity: coerceQuantity(it).quantity,
    }));
    // prepareEntryForSave guarantees all v2 schema fields are present,
    // strips the diagnostic _storedSchemaVersion, and sets schemaVersion
    // to SCHEMA_VERSIONS.ENTRY regardless of what the caller passed in.
    const toSave = prepareEntryForSave({ ...entry, foodItems });
    await setDoc(doc(db, `artifacts/${appId}/users/${state.userId}/dailyEntries`, dateStr), toSave);
    state.dailyEntries.set(dateStr, toSave);
    debugLog('firebase-save', 'Daily entry saved successfully', dateStr);
  } catch (e) {
    handleError('daily-entry-save', e, 'Failed to save entry.');
    throw e;
  }
}

/**
 * Saves a pre-built daily entry that already contains its own foodItems array.
 * Unlike saveDailyEntry(), this does NOT overwrite foodItems with state.dailyFoodItems,
 * making it safe to call for historical days without corrupting today's food log.
 * Used by the blank-day population feature in analysisUI.js.
 * @param {string} dateStr - The date key in YYYY-MM-DD format.
 * @param {object} entry   - Fully-formed entry object including entry.foodItems.
 */
export async function saveEstimatedEntry(dateStr, entry) {
  if (!state.userId) return showMessage('Cannot save entry. Not authenticated.', true);
  try {
    // Does NOT overwrite foodItems from state.dailyFoodItems — caller provides them.
    const foodItems = Array.isArray(entry.foodItems)
      ? entry.foodItems.map(it => ({ ...it, id: it.id || safeId() }))
      : [];
    // Preserve caller-supplied entryType; default to 'estimate' if absent.
    const toSave = prepareEntryForSave(
      { ...entry, foodItems },
      { entryType: entry.entryType || 'estimate' },
    );
    // Guard: estimate entries must have a complete estimateMeta object.
    if (toSave.entryType === 'estimate' && toSave.estimateMeta === null) {
      const now = new Date().toISOString();
      toSave.estimateMeta = {
        method: null, modelVersion: null, confidence: null,
        sourceDataWindow: null, createdAt: now, updatedAt: now,
        locked: false, previousEstimate: null,
      };
    }
    await setDoc(doc(db, `artifacts/${appId}/users/${state.userId}/dailyEntries`, dateStr), toSave);
    state.dailyEntries.set(dateStr, toSave);
    debugLog('firebase-save', 'Estimated entry saved', dateStr);
  } catch (e) {
    handleError('estimated-entry-save', e, 'Failed to save estimated entry.');
    throw e;
  }
}

/**
 * Fetches all daily entries for the user from Firestore, ordered by date.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of all entry objects.
 */
export async function fetchAllEntries() {
  if (!state.userId) return [];
  const rows = [];
  try {
    const qy = query(collection(db, `artifacts/${appId}/users/${state.userId}/dailyEntries`), orderBy('date', 'asc'));
    const qs = await getDocs(qy);
    qs.forEach(d => {
      const data = d.data();
      if (Array.isArray(data.foodItems)) {
        data.foodItems = data.foodItems.map(it => {
          if (!it.id) it.id = safeId();
          return coerceQuantity(it);
        });
      }
      // Normalize to v2 shape so every consumer (including the CSV exporter)
      // receives entries with all v2 fields present.
      rows.push(normalizeEntry(data));
    });
    debugLog('firebase-fetch', 'All entries fetched successfully', rows.length);
  } catch (e) {
    handleError('fetch-all-entries', e, 'Failed to fetch all entries.');
  }
  return rows;
}

/**
 * Fetches the most recent 365 daily entries for the user.
 * @returns {Promise<Map<string, object>>} A promise that resolves to a Map of entries, with date strings as keys.
 */
export async function fetchRecentEntries() {
  if (!state.userId) return new Map();
  const map = new Map();
  try {
    const qy = query(collection(db, `artifacts/${appId}/users/${state.userId}/dailyEntries`), orderBy('date', 'desc'), limit(365));
    const qs = await getDocs(qy);
    qs.forEach(d => {
      const data = d.data();
        if (Array.isArray(data.foodItems)) {
          data.foodItems = data.foodItems.map(it => {
            if (!it.id) it.id = safeId();
            return coerceQuantity(it);
          });
        }
      map.set(d.id, data);
    });
    debugLog('firebase-fetch', 'Recent entries fetched successfully', map.size);
  } catch (e) {
    handleError('fetch-recent-entries', e, 'Failed to fetch recent entries.');
  }
  return map;
}

/**
 * Loads all saved food items for the user from Firestore into the local state.
 */
export async function loadSavedFoodItems() {
  if (!state.userId) return;
  try {
    const qy = query(collection(db, `artifacts/${appId}/users/${state.userId}/foodItems`), orderBy('name'));
    const qs = await getDocs(qy);
    state.savedFoodItems.clear();
    qs.forEach(d => {
      const data = d.data();
      coerceQuantity(data);
      state.savedFoodItems.set(d.id, data);
    });
    debugLog('firebase-fetch', 'Saved food items loaded successfully', state.savedFoodItems.size);
  } catch (e) {
    handleError('load-saved-foods', e, 'Failed to load saved foods.');
  }
}

/**
 * Fetches all saved food items for the user and returns them as a Map.
 * @returns {Promise<Map>} Map of food items
 */
export async function fetchFoodItems() {
  if (!state.userId) return new Map();
  try {
    const qy = query(collection(db, `artifacts/${appId}/users/${state.userId}/foodItems`), orderBy('name'));
    const qs = await getDocs(qy);
    const foodItems = new Map();
    qs.forEach(d => {
      const data = d.data();
      coerceQuantity(data);
      foodItems.set(d.id, data);
    });
    debugLog('firebase-fetch', 'Food items fetched successfully', foodItems.size);
    return foodItems;
  } catch (e) {
    handleError('fetch-food-items', e, 'Failed to fetch food items.');
    return new Map();
  }
}

/**
 * Fetch daily entries that fall within a calendar date range.
 * @param {Date} startDate - Start date (inclusive)
 * @param {Date} endDate   - End date (inclusive)
 * @returns {Promise<Map>} Map of daily entries keyed by date string
 */
export async function fetchEntriesInRange(startDate, endDate) {
  if (!state.userId) return new Map();
  try {
    const entries = new Map();
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    
    const qy = query(collection(db, `artifacts/${appId}/users/${state.userId}/dailyEntries`));
    const qs = await getDocs(qy);
    
    qs.forEach((doc) => {
      const dateStr = doc.id;
      if (dateStr >= startStr && dateStr <= endStr) {
        const data = doc.data();
        if (Array.isArray(data.foodItems)) {
          data.foodItems = data.foodItems.map(it => {
            if (!it.id) it.id = safeId();
            return coerceQuantity(it);
          });
        }
        entries.set(dateStr, normalizeEntry(data));
      }
    });

    debugLog('firebase-fetch', 'Range entries fetched successfully', entries.size);
    return entries;
  } catch (e) {
    handleError('fetch-entries-range', e, 'Failed to fetch entries for date range.');
    return new Map();
  }
}

/**
 * Deletes a specific food item from the user's saved foods in Firestore.
 * @param {string} foodId - The ID of the food item to delete.
 */
export async function deleteFoodItem(foodId) {
  if (!state.userId) throw new Error('User not authenticated');
  try {
    await deleteDoc(doc(db, `artifacts/${appId}/users/${state.userId}/foodItems`, foodId));
    state.savedFoodItems.delete(foodId); // Update local state
    debugLog('firebase-delete', 'Food item deleted successfully', foodId);
  } catch (e) {
    handleError('delete-food-item', e, 'Failed to delete food item from database');
    throw e;
  }
}

// ---------- USER PROFILE ----------

/**
 * Fetches the user's profile document from Firestore.
 * Returns {} if the document does not exist (first-time user).
 * The caller is responsible for passing the raw result through
 * normalizeUserProfile() in services/data.js before storing it in state.
 * @returns {Promise<object>}
 */
export async function fetchUserProfile() {
  if (!state.userId) return {};
  try {
    const ref = doc(db, `artifacts/${appId}/users/${state.userId}/profile/userProfile`);
    const snap = await getDoc(ref);
    const result = snap.exists() ? snap.data() : {};
    debugLog('firebase-fetch', 'User profile fetched');
    return result;
  } catch (e) {
    return handleError('profile-fetch', e, 'Failed to fetch user profile.') || {};
  }
}

/**
 * Saves the user's profile document to Firestore and updates state.userProfile.
 * @param {object} profile - The normalized profile object to persist.
 */
export async function saveUserProfile(incoming) {
  if (!state.userId) return showMessage('Cannot save profile. Not authenticated.', true);
  try {
    // Merge: defaults → current state → incoming, then force schemaVersion.
    // This prevents a partial update from wiping fields the caller didn't include.
    const toSave = prepareProfileForSave(incoming, state.userProfile);
    await setDoc(doc(db, `artifacts/${appId}/users/${state.userId}/profile/userProfile`), toSave);
    state.userProfile = normalizeUserProfile(toSave);
    showMessage('Profile saved!');
    debugLog('firebase-save', 'User profile saved');
  } catch (e) {
    handleError('profile-save', e, 'Failed to save profile.');
    throw e;
  }
}

// ---------- GOAL SETTINGS ----------

/**
 * Fetches the user's goal settings document from Firestore.
 * Returns {} if the document does not exist (first-time user).
 * The caller is responsible for passing the raw result through
 * normalizeGoalSettings() in services/data.js before storing it in state.
 * @returns {Promise<object>}
 */
export async function fetchGoalSettings() {
  if (!state.userId) return {};
  try {
    const ref = doc(db, `artifacts/${appId}/users/${state.userId}/goals/goalSettings`);
    const snap = await getDoc(ref);
    const result = snap.exists() ? snap.data() : {};
    debugLog('firebase-fetch', 'Goal settings fetched');
    return result;
  } catch (e) {
    return handleError('goals-fetch', e, 'Failed to fetch goal settings.') || {};
  }
}

/**
 * Saves the user's goal settings document to Firestore and updates state.goalSettings.
 * @param {object} goals       - The normalized goal settings object to persist.
 * @param {object} [opts]      - Options forwarded to prepareGoalSettingsForSave.
 *   opts.replaceOverrides: true replaces manualTargetOverrides entirely (used by Apply Targets).
 */
export async function saveGoalSettings(incoming, opts = {}) {
  if (!state.userId) return showMessage('Cannot save goal settings. Not authenticated.', true);
  try {
    // Merge: defaults → current state → incoming, then force schemaVersion.
    // manualTargetOverrides is key-merged by default; pass replaceOverrides:true to replace.
    const toSave = prepareGoalSettingsForSave(incoming, state.goalSettings, opts);
    await setDoc(doc(db, `artifacts/${appId}/users/${state.userId}/goals/goalSettings`), toSave);
    state.goalSettings = normalizeGoalSettings(toSave);
    showMessage('Goals saved!');
    debugLog('firebase-save', 'Goal settings saved');
  } catch (e) {
    handleError('goals-save', e, 'Failed to save goal settings.');
    throw e;
  }
}

// ---------- WEIGHT ENTRIES ----------

/**
 * Saves a batch of weight entries to Firestore using deterministic document IDs.
 * Re-uploading the same CSV just overwrites existing docs = automatic dedup.
 * @param {Array<{date: string, weight_lb: number, time_min: number, timestamp: string}>} entries
 * @returns {Promise<{saved: number, skipped: number}>}
 */
export async function saveWeightEntries(entries) {
  const withDocIds = entries.map(entry => ({
    ...entry,
    docId: entry.docId ?? entry.timestamp.replace(/[:/]/g, '-').replace(/\s/g, 'T'),
    source: entry.source ?? 'csv_upload',
  }));
  return saveWeightEntriesBatch(withDocIds);
}

/**
 * Save weight entries in batched Firestore writes (≤450 per batch).
 * Re-uploading the same CSV is idempotent: existing docs are overwritten.
 * Local state (state.weightEntries) is updated inline after each batch,
 * so no extra full-refetch is needed after the call completes.
 *
 * @param {Array<{
 *   docId: string,
 *   date: string,
 *   weight_lb: number,
 *   time_min: number,
 *   timestamp: string,
 *   originalUnit: string,
 *   parserVersion: string,
 *   sourceHash: string,
 *   importedAt: string,
 * }>} entries
 * @param {{ onProgress?: (saved: number, total: number, batchIdx: number, totalBatches: number) => void }} [opts]
 * @returns {Promise<{ saved: number, skipped: number, partialFailure: boolean }>}
 */
export async function saveWeightEntriesBatch(entries, opts = {}) {
  if (!state.userId) {
    showMessage('Cannot save weight data. Not authenticated.', true);
    return { saved: 0, skipped: entries.length, partialFailure: false };
  }
  if (entries.length === 0) return { saved: 0, skipped: 0, partialFailure: false };

  const BATCH_SIZE = 450;
  const chunks = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    chunks.push(entries.slice(i, i + BATCH_SIZE));
  }

  let totalSaved = 0;
  try {
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const batch = writeBatch(db);

      for (const entry of chunk) {
        const { docId, ...docData } = entry;
        const ref = doc(db, `artifacts/${appId}/users/${state.userId}/weightEntries`, docId);
        batch.set(ref, docData);
      }

      await batch.commit();
      totalSaved += chunk.length;

      // Update local state immediately so the UI reflects progress without a refetch
      for (const entry of chunk) {
        const { docId, ...docData } = entry;
        state.weightEntries.set(docId, docData);
      }

      if (opts.onProgress) {
        opts.onProgress(totalSaved, entries.length, ci + 1, chunks.length);
      }

      debugLog('firebase-weight', `Batch ${ci + 1}/${chunks.length} committed (${chunk.length} docs)`);
    }
  } catch (e) {
    handleError('weight-batch-save', e, 'Failed to save weight entries.');
    // Return partial results — already-committed batches are in local state
    return { saved: totalSaved, skipped: entries.length - totalSaved, partialFailure: true };
  }

  debugLog('firebase-weight', `Saved ${totalSaved} weight entries in ${chunks.length} batch(es)`);
  return { saved: totalSaved, skipped: 0, partialFailure: false };
}

/**
 * Fetches all weight entries for the user from Firestore.
 * @returns {Promise<Map<string, object>>} Map with docIds as keys.
 */
export async function fetchWeightEntries() {
  if (!state.userId) return new Map();
  const map = new Map();
  try {
    const qy = query(
      collection(db, `artifacts/${appId}/users/${state.userId}/weightEntries`),
      orderBy('date', 'asc')
    );
    const qs = await getDocs(qy);
    qs.forEach(d => map.set(d.id, d.data()));
    debugLog('firebase-weight', `Fetched ${map.size} weight entries`);
  } catch (e) {
    handleError('weight-fetch', e, 'Failed to fetch weight entries.');
  }
  return map;
}

// ---------- ESTIMATE MANAGEMENT ----------

/**
 * Detects whether a food item was auto-generated by the estimation system.
 * Mirrors isSyntheticItem() in engine.js without creating a circular import.
 */
function _isSyntheticFoodItem(item) {
  const syntheticNames = new Set(["Day's estimate", "Estimated vacation day", "Unlogged intake estimate"]);
  if (syntheticNames.has(item?.name)) return true;
  if (typeof item?.id === 'string') {
    return item.id.startsWith('est-') || item.id.startsWith('vac-') || item.id.startsWith('adj-');
  }
  return false;
}

/**
 * Remove a single synthetic food item from an existing daily entry.
 * Real (non-synthetic) food items are never touched.
 * Recalculates calorie/macro totals from remaining items after removal.
 *
 * @param {string} dateStr  – 'YYYY-MM-DD'
 * @param {string} itemId   – id of the synthetic foodItem to remove
 */
export async function removeEstimateItem(dateStr, itemId) {
  if (!state.userId) return showMessage('Cannot update entry. Not authenticated.', true);
  try {
    const existing = state.dailyEntries.get(dateStr);
    if (!existing) return;

    const itemToRemove = (existing.foodItems || []).find(fi => fi.id === itemId);
    if (!itemToRemove || !_isSyntheticFoodItem(itemToRemove)) {
      debugLog('firebase-estimate', 'removeEstimateItem: item not found or not synthetic', itemId);
      return;
    }

    const newItems = (existing.foodItems || []).filter(fi => fi.id !== itemId);
    const sum = key => newItems.reduce((s, fi) => s + (parseFloat(fi.quantity ?? 1) || 0) * (parseFloat(fi[key]) || 0), 0);

    const allSynthetic = newItems.length > 0 && newItems.every(fi => _isSyntheticFoodItem(fi));
    const newEntryType = allSynthetic ? 'estimate' : 'logged';
    const newVacationDayType = allSynthetic ? existing.vacationDayType : null;
    const newEstimateMeta = newItems.some(fi => _isSyntheticFoodItem(fi))
      ? existing.estimateMeta
      : null;

    const updated = {
      ...existing,
      ...Object.fromEntries(allNutrients.map(k => [k, Math.round(sum(k))])),
      foodItems: newItems,
      entryType: newEntryType,
      vacationDayType: newVacationDayType,
      estimateMeta: newEstimateMeta,
    };

    const toSave = prepareEntryForSave(updated);
    await setDoc(doc(db, `artifacts/${appId}/users/${state.userId}/dailyEntries`, dateStr), toSave);
    state.dailyEntries.set(dateStr, toSave);
    debugLog('firebase-estimate', 'Removed estimate item', itemId, 'from', dateStr);
  } catch (e) {
    handleError('remove-estimate-item', e, 'Failed to remove estimate item.');
    throw e;
  }
}

/**
 * Toggle the locked flag on an existing day's estimateMeta.
 * When locked=true the auto-update logic will skip this entry.
 *
 * @param {string}  dateStr
 * @param {boolean} locked
 */
export async function lockEstimateForDate(dateStr, locked) {
  if (!state.userId) return;
  try {
    const existing = state.dailyEntries.get(dateStr);
    if (!existing) return;

    const prevMeta = existing.estimateMeta || {};
    const updated = {
      ...existing,
      manualLock: Boolean(locked),
      estimateMeta: {
        ...prevMeta,
        locked: Boolean(locked),
        updatedAt: new Date().toISOString(),
      },
    };

    const toSave = prepareEntryForSave(updated);
    await setDoc(doc(db, `artifacts/${appId}/users/${state.userId}/dailyEntries`, dateStr), toSave);
    state.dailyEntries.set(dateStr, toSave);
    debugLog('firebase-estimate', `${locked ? 'Locked' : 'Unlocked'} estimate for`, dateStr);
  } catch (e) {
    handleError('lock-estimate', e, `Failed to ${locked ? 'lock' : 'unlock'} estimate.`);
    throw e;
  }
}

// ---------- AUTHENTICATION FUNCTIONS ----------

/**
 * Sets up a listener for authentication state changes.
 * @param {function} callback - The function to call when the auth state changes, which receives the user object.
 */
export function onAuth(callback) {
  try {
    onAuthStateChanged(auth, callback);
    debugLog('firebase-auth', 'Auth state listener attached');
  } catch (error) {
    handleError('firebase-onauth', error, 'Failed to set up authentication listener');
  }
}

export async function loginEmail(email, password) {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    debugLog('firebase-auth', 'Email login successful', result.user.uid);
    return result;
  } catch (error) {
    handleError('firebase-email-login', error, 'Failed to sign in with email');
    throw error;
  }
}

export async function signupEmail(email, password) {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    debugLog('firebase-auth', 'Email signup successful', result.user.uid);
    return result;
  } catch (error) {
    handleError('firebase-email-signup', error, 'Failed to create account');
    throw error;
  }
}

export async function loginGuest() {
  try {
    const result = await signInAnonymously(auth);
    debugLog('firebase-auth', 'Guest login successful', result.user.uid);
    return result;
  } catch (error) {
    handleError('firebase-guest', error, 'Failed to sign in as guest');
    throw error;
  }
}

export async function logout() {
  try {
    await signOut(auth);
    debugLog('firebase-auth', 'Logout successful');
  } catch (error) {
    handleError('firebase-logout', error, 'Failed to log out');
    throw error;
  }
}

export async function loginWithCustomToken(token) {
  try {
    const result = await signInWithCustomToken(auth, token);
    debugLog('firebase-auth', 'Custom token login successful', result.user.uid);
    return result;
  } catch (error) {
    handleError('firebase-custom-token', error, 'Failed to sign in with custom token');
    throw error;
  }
}