/**
 * @file src/services/data.js
 * @description Handles loading and preparing application data.
 * Acts as a bridge between Firebase services and UI components.
 */
import { state, cacheDom } from '../state/store.js';
import { getTodayInTimezone } from '../utils/time.js';
import { handleError, debugLog } from '../utils/ui.js';
import { fetchTargets, fetchRecentEntries, loadSavedFoodItems } from './firebase.js';
import { updateDashboard, populateSettingsForm } from '../ui/dashboard.js';
import { updateChart } from '../ui/chart.js';
import { allNutrients } from '../constants.js';

/**
 * Ensures the date input has a value, defaulting to today's date in the correct timezone.
 */
export function ensureDateInput() {
  if (!state.dom.dateInput) {
    debugLog('data-init', 'Date input element not found, caching DOM');
    cacheDom();
  }
  
  if (state.dom.dateInput && !state.dom.dateInput.value) {
    state.dom.dateInput.value = getTodayInTimezone();
    debugLog('data-init', 'Date input set to today', state.dom.dateInput.value);
  }
}

/**
 * Orchestrates the loading of all user-specific data from Firebase.
 * This function is called on initial load and when the user changes.
 */
export async function loadUserData() {
  if (!state.userId) {
    debugLog('data-load', 'No user ID available, skipping data load');
    return; // Do nothing if there's no user.
  }
  
  if (!state.dom.dateInput) {
    debugLog('data-load', 'DOM not cached, caching now');
    cacheDom(); // Ensure DOM is cached.
  }
  
  ensureDateInput();

  // Show loader while fetching data.
  if (state.dom.mainContent) state.dom.mainContent.classList.add('hidden');
  if (state.dom.loader) state.dom.loader.classList.remove('hidden');

  try {
    debugLog('data-load', 'Starting parallel data fetch for user', state.userId);
    
    // Fetch all necessary data in parallel for better performance.
    const [targets, entries] = await Promise.all([
      fetchTargets(),
      fetchRecentEntries(),
    ]);
    
    state.baselineTargets = targets;
    state.dailyEntries = entries;
    debugLog('data-load', 'Core data loaded', { targetsCount: Object.keys(targets).length, entriesCount: entries.size });

    // Load food items after initial data is fetched.
    await loadSavedFoodItems();
    debugLog('data-load', 'Food items loaded', state.savedFoodItems.size);

    // Once all data is loaded, populate the UI.
    loadDailyFoodItems();
    populateSettingsForm();
    updateDashboard();
    updateChart();
    
    debugLog('data-load', 'User data loading complete');

  } catch (e) {
    handleError('load-user-data', e, 'Error loading data. Please refresh and try again.');
  }

  // Hide loader and show main content.
  if (state.dom.loader) state.dom.loader.classList.add('hidden');
  if (state.dom.mainContent) state.dom.mainContent.classList.remove('hidden');
}

/**
 * Loads the food items for the currently selected date from the `dailyEntries` state.
 */
export function loadDailyFoodItems() {
  if (!state.dom.dateInput) {
    debugLog('data-daily', 'Date input not available, cannot load daily food items');
    return;
  }
  
  const dateStr = state.dom.dateInput.value;
  const entry = state.dailyEntries.get(dateStr) || {};
  state.dailyFoodItems = entry.foodItems || [];
  
  debugLog('data-daily', 'Daily food items loaded', { date: dateStr, itemCount: state.dailyFoodItems.length });
  updateFoodItemsList();
}

/**
 * Renders the list of food items logged for the current day in the UI.
 */
export function updateFoodItemsList() {
  const container = document.getElementById('food-items-list');
  if (!container) {
    debugLog('data-ui', 'Food items list container not found');
    return;
  }

  if (state.dailyFoodItems.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-sm">No food items logged yet for this day.</p>';
    debugLog('data-ui', 'No food items to display');
    return;
  }

  container.innerHTML = state.dailyFoodItems.map((item, index) => {
    const name = item.name || '(blank)';
    // Check if the item represents a subtraction (negative calories).
    const isSubtraction = (item.calories || 0) < 0;
    const details = `Cal: ${item.calories || 0} | P: ${item.protein || 0} / C: ${item.carbs || 0} / F: ${item.fat || 0}`;

    return `
      <div class="flex justify-between items-center p-2 rounded ${isSubtraction ? 'bg-red-50' : 'bg-gray-50'}">
        <span class="text-sm">
          <strong>${name}:</strong>
          ${details}
        </span>
        <button onclick="removeFoodItem(${index})" class="text-red-500 hover:text-red-700 text-xs" title="Remove Item">
          <i class="fas fa-times"></i>
        </button>
      </div>`;
  }).join('');
  
  debugLog('data-ui', 'Food items list updated', state.dailyFoodItems.length);
}

/**
 * Clears all nutrient input fields in the staging area.
 */
export function clearStagingArea() {
  let clearedCount = 0;
  
  allNutrients.forEach(n => {
    const input = document.getElementById(`actual-${n}`);
    if (input && input.value) {
      input.value = '';
      clearedCount++;
    }
  });
  
  const pasteArea = document.getElementById('paste-area');
  if (pasteArea && pasteArea.value) {
    pasteArea.value = '';
    clearedCount++;
  }
  
  const foodInput = document.getElementById('food-item-input');
  if (foodInput && foodInput.value) {
    foodInput.value = '';
    clearedCount++;
  }
  
  debugLog('data-ui', 'Staging area cleared', { fieldsCleared: clearedCount });
}

/**
 * ADDED: Validates that required data is loaded before performing operations
 * @returns {boolean} True if data is ready for operations
 */
export function validateDataReady() {
  if (!state.userId) {
    debugLog('data-validation', 'Validation failed: No user authenticated');
    return false;
  }

  if (Object.keys(state.baselineTargets).length === 0) {
    debugLog('data-validation', 'Validation failed: No baseline targets set');
    return false;
  }

  debugLog('data-validation', 'Data validation passed');
  return true;
}

/**
 * ADDED: Gets the current daily entry for the selected date, creating one if it doesn't exist
 * @returns {Object} Daily entry object
 */
export function getCurrentDailyEntry() {
  const dateStr = state.dom.dateInput?.value || getTodayInTimezone();
  
  let entry = state.dailyEntries.get(dateStr);
  if (!entry) {
    entry = {
      date: dateStr,
      foodItems: []
    };
    
    // Initialize all nutrients to 0
    allNutrients.forEach(nutrient => {
      entry[nutrient] = 0;
    });
    
    state.dailyEntries.set(dateStr, entry);
    debugLog('data-entry', 'Created new daily entry', { date: dateStr });
  }
  
  return entry;
}

/**
 * ADDED: Refreshes all UI components that depend on data
 */
export function refreshUI() {
  try {
    updateDashboard();
    updateChart();
    updateFoodItemsList();
    debugLog('data-ui', 'UI refresh complete');
  } catch (error) {
    handleError('data-refresh-ui', error, 'Failed to refresh UI components');
  }
}

/**
 * ADDED: Gets summary statistics for debugging and monitoring
 * @returns {Object} Summary of current data state
 */
export function getDataSummary() {
  const summary = {
    userId: state.userId || 'not authenticated',
    hasTargets: Object.keys(state.baselineTargets).length > 0,
    totalDailyEntries: state.dailyEntries.size,
    totalFoodItems: state.savedFoodItems.size,
    currentDayFoodItems: state.dailyFoodItems.length,
    currentDate: state.dom.dateInput?.value || 'not set'
  };
  
  debugLog('data-summary', 'Data summary generated', summary);
  return summary;
}