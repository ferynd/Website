/**
 * @file src/services/data.js
 * @description UPDATED: Data handling with expandable food items list
 */
import { state, cacheDom } from '../state/store.js';
import { getTodayInTimezone } from '../utils/time.js';
import { handleError, debugLog } from '../utils/ui.js';
import { fetchTargets, fetchRecentEntries, loadSavedFoodItems } from './firebase.js';
import { updateDashboard, populateSettingsForm } from '../ui/dashboard.js';
import { updateChart } from '../ui/chart.js';
import { allNutrients } from '../constants.js';

// Configuration at top of file
const DATA_CONFIG = {
  MAX_FOOD_ITEMS_DISPLAY: 50, // Maximum food items to show before scrolling
  FOOD_ITEM_ANIMATION_DURATION: 200, // Animation for adding/removing items
  AUTO_SCROLL_TO_NEW_ITEMS: true, // Scroll to newly added items
  DEBUG_FOOD_OPERATIONS: true // Log food item operations
};

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
 * UPDATED: Renders the expandable list of food items logged for the current day
 */
export function updateFoodItemsList() {
  const container = document.getElementById('food-items-list');
  if (!container) {
    debugLog('data-ui', 'Food items list container not found');
    return;
  }

  // Clear existing content with animation
  if (DATA_CONFIG.FOOD_ITEM_ANIMATION_DURATION > 0) {
    container.style.transition = `opacity ${DATA_CONFIG.FOOD_ITEM_ANIMATION_DURATION}ms ease-in-out`;
    container.style.opacity = '0';
    
    setTimeout(() => {
      renderFoodItemsContent(container);
      container.style.opacity = '1';
    }, DATA_CONFIG.FOOD_ITEM_ANIMATION_DURATION / 2);
  } else {
    renderFoodItemsContent(container);
  }

  if (DATA_CONFIG.DEBUG_FOOD_OPERATIONS) {
    debugLog('data-ui', 'Food items list updated', {
      itemCount: state.dailyFoodItems.length,
      containerHeight: container.offsetHeight
    });
  }
}

/**
 * UPDATED: Renders the actual content of the food items list with improved layout
 */
function renderFoodItemsContent(container) {
  if (state.dailyFoodItems.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-muted">
        <i class="fas fa-utensils text-2xl mb-2 opacity-50"></i>
        <p class="text-sm">No food items logged for this day yet.</p>
        <p class="text-xs mt-1">Add nutrients above and hit the + button!</p>
      </div>`;
    debugLog('data-ui', 'Showing empty state for food items');
    return;
  }

  // Calculate totals for summary
  const totals = state.dailyFoodItems.reduce((acc, item) => {
    acc.calories += parseFloat(item.calories) || 0;
    acc.protein += parseFloat(item.protein) || 0;
    acc.carbs += parseFloat(item.carbs) || 0;
    acc.fat += parseFloat(item.fat) || 0;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  // Generate food items HTML with improved styling
  const itemsHtml = state.dailyFoodItems.map((item, index) => {
    const name = item.name || '(blank)';
    const isSubtraction = (item.calories || 0) < 0;
    const details = `Cal: ${Math.round(item.calories || 0)} | P: ${Math.round(item.protein || 0)} / C: ${Math.round(item.carbs || 0)} / F: ${Math.round(item.fat || 0)}`;
    
    // Format timestamp if available
    let timeStamp = '';
    if (item.timestamp) {
      const time = new Date(item.timestamp);
      timeStamp = time.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
    }

    return `
      <div class="group flex justify-between items-center p-3 rounded-lg border surface-2 ${isSubtraction ? 'text-negative' : ''} hover:shadow-md transition-all duration-200">
        <div class="flex-grow min-w-0">
          <div class="flex items-center justify-between mb-1">
            <span class="font-medium text-primary truncate">${name}</span>
            ${timeStamp ? `<span class="text-xs text-muted ml-2">${timeStamp}</span>` : ''}
          </div>
          <div class="text-xs text-secondary">${details}</div>
        </div>
        <button onclick="removeFoodItem(${index})" class="btn btn-danger icon-btn" aria-label="Delete" title="Delete">&times;</button>
      </div>`;
  }).join('');

  // Summary section
  const summaryHtml = `
    <div class="kpi card mb-3">
      <div class="flex justify-between items-center">
        <span class="kpi-title">Today's Totals (${state.dailyFoodItems.length} items):</span>
        <span class="kpi-value">${Math.round(totals.calories)} cal | ${Math.round(totals.protein)}p / ${Math.round(totals.carbs)}c / ${Math.round(totals.fat)}f</span>
      </div>
    </div>
  `;

  // Combine summary and items
  container.innerHTML = summaryHtml + itemsHtml;

  // Auto-scroll to show new items if enabled
  if (DATA_CONFIG.AUTO_SCROLL_TO_NEW_ITEMS && state.dailyFoodItems.length > 3) {
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, DATA_CONFIG.FOOD_ITEM_ANIMATION_DURATION);
  }

  debugLog('data-ui', 'Food items content rendered', { 
    itemCount: state.dailyFoodItems.length,
    totals: totals
  });
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
 * Validates that required data is loaded before performing operations
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
 * Gets the current daily entry for the selected date, creating one if it doesn't exist
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
 * Refreshes all UI components that depend on data
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
 * Gets summary statistics for debugging and monitoring
 * @returns {Object} Summary of current data state
 */
export function getDataSummary() {
  const summary = {
    userId: state.userId || 'not authenticated',
    hasTargets: Object.keys(state.baselineTargets).length > 0,
    totalDailyEntries: state.dailyEntries.size,
    totalFoodItems: state.savedFoodItems.size,
    currentDayFoodItems: state.dailyFoodItems.length,
    currentDate: state.dom.dateInput?.value || 'not set',
    foodItemsContainerHeight: document.getElementById('food-items-list')?.offsetHeight || 'not found'
  };
  
  debugLog('data-summary', 'Data summary generated', summary);
  return summary;
}