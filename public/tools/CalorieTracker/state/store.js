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
