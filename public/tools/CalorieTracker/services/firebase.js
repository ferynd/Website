/**
 * @file src/services/firebase.js
 * @description Initializes Firebase and exports auth and Firestore functions.
 * This module centralizes all direct interactions with the Firebase backend.
 */

import { appId } from '../config.js';
import { state, coerceQuantity } from '../state/store.js';
import { handleError, debugLog, showMessage } from '../utils/ui.js';

// FIXED: Import from the correct relative path
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
  deleteDoc
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
    // Ensure the food items list for the day is included in the saved document.
    entry.foodItems = state.dailyFoodItems.map(it => ({
      ...it,
      id: it.id || safeId(),
      quantity: coerceQuantity(it).quantity
    }));
    await setDoc(doc(db, `artifacts/${appId}/users/${state.userId}/dailyEntries`, dateStr), entry);
    state.dailyEntries.set(dateStr, entry); // Update local state
    debugLog('firebase-save', 'Daily entry saved successfully', dateStr);
  } catch (e) {
    handleError('daily-entry-save', e, 'Failed to save entry.');
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
      rows.push(data);
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
 * ADDED: Fetches user's saved food items and returns as Map
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
 * ADDED: Fetch daily entries for a date range
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Map} Map of daily entries by date string
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
        entries.set(dateStr, data);
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