/**
 * @file src/state/store.js
 * @description Centralized state management for the application.
 * Includes the main state object and a function to cache DOM elements.
 */

// The single source of truth for the application's state.
export const state = {
  // The current authenticated user's ID. Undefined if not logged in.
  userId: undefined,

  // An object holding the user's baseline nutrient targets.
  baselineTargets: {},

  // A Map to store daily nutrition entries, with date strings as keys.
  dailyEntries: new Map(),

  // A Map to store weight entries, keyed by Firestore document ID.
  // Each value: { date, weight_lb, time_min, timestamp, source }
  weightEntries: new Map(),

  // Multi-weigh-in map: Map<date-string, Array<{weight_lb, time_min, ...}>>
  // Built from weightEntries by grouping all readings that share the same date.
  // Used by the analysis engine to apply preferred-window selection.
  weightEntriesMulti: new Map(),

  // Cached analysis results (recomputed when weight/nutrition data changes).
  analysisResults: null,

  // A reference to the Chart.js instance.
  chartInstance: null,

  // An array of food items logged for the currently selected day.
  dailyFoodItems: [],

  // A Map of all food items saved by the user, with food IDs as keys.
  savedFoodItems: new Map(),

  // A boolean flag indicating if the food search dropdown is visible.
  foodDropdownVisible: false,

  // A timeout ID for debouncing the food search.
  searchTimeout: null,

  // The index of the currently highlighted item in the food search dropdown.
  selectedDropdownIndex: -1,

  // The user's physical profile and goal preferences.
  // Both are populated by loadUserData() via the normalize* functions in
  // services/data.js.  An empty object is the valid pre-load state — callers
  // should treat missing keys as unset rather than checking for null/undefined
  // at call sites (normalizeUserProfile / normalizeGoalSettings guarantee all
  // keys are present after the initial data load).
  userProfile: {},
  goalSettings: {},

  // Active tab name — persisted to localStorage as 'ct-active-tab'.
  activeTab: 'today',

  // Last weight upload status — persisted across dashboard re-renders so the
  // final success/error message is not wiped when the Energy tab repaints.
  // Shape: { message: string, isError: boolean } | null
  lastWeightUploadStatus: null,

  // An object to cache frequently accessed DOM elements.
  dom: {},
};

/**
 * Caches frequently accessed DOM elements into the state.dom object.
 * This improves performance by reducing the number of document.getElementById calls.
 */
export function cacheDom() {
  const $ = (id) => document.getElementById(id);
  state.dom = {
    // Modals
    settingsModal: $('settings-modal'),
    loginModal: $('login-modal'),
    foodManagerModal: $('food-manager-modal'),
    duplicateFoodModal: $('duplicate-food-modal'),
    blankFoodNameModal: $('blank-food-name-modal'),
    confirmationModal: $('confirmation-modal'),

    // Main UI elements
    dateInput: $('date-input'),
    dashboard: $('dashboard'),
    loader: $('loader'),
    mainContent: $('main-content'),
    messageBox: $('message-box'),
    messageText: $('message-text'),
    userStatus: $('user-status'),

    // Confirmation modal elements
    confirmationMessage: $('confirmation-message'),
    confirmActionButton: $('confirm-action-btn'),
    cancelActionButton: $('cancel-action-btn'),
    promptInput: $('prompt-input'),
    promptInputContainer: $('prompt-input-container'),

    // Food dropdown elements
    foodDropdown: $('food-dropdown'),
    foodItemInput: $('food-item-input'),
  };
}

// Helper to ensure quantity fields are numeric and safely defaulted
export function coerceQuantity(item) {
  item.quantity = (item.quantity === undefined || item.quantity === null)
    ? 0
    : parseFloat(item.quantity) || 0;
  return item;
}
