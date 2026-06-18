/**
 * @file src/services/data.js
 * @description Data service — Firebase reads/writes for daily entries, food items, weight, profile, and goals.
 */
import { state, cacheDom, coerceQuantity } from '../state/store.js';
import { getTodayInTimezone } from '../utils/time.js';
import { handleError, debugLog, escapeHtml, showUndoToast, showMessage, flushPendingUndo } from '../utils/ui.js';
import {
  fetchTargets,
  fetchRecentEntries,
  loadSavedFoodItems,
  saveDailyEntry,
  saveDailyEntrySnapshot,
  fetchWeightEntries,
  fetchUserProfile,
  fetchGoalSettings,
} from './firebase.js';
import { updateDashboard, populateSettingsForm } from '../ui/dashboard.js';
import { updateChart } from '../ui/chart.js';
import { allNutrients, SCHEMA_VERSIONS } from '../constants.js';
import {
  normalizeEntry,
  normalizeUserProfile,
  normalizeGoalSettings,
} from '../state/schema.js';
import {
  ACTIVITY_TYPES,
  INTENSITY_LABELS,
  estimateSessionCalories,
} from '../exercise/met.js';
import { resolveWeightKg } from '../ui/nutrientHelpers.js';

// Re-export so other modules that imported normalize functions from data.js
// keep working without changes.
export { normalizeEntry, normalizeUserProfile, normalizeGoalSettings };

// Helper to safely generate IDs across environments
function safeId() {
  try {
    return crypto.randomUUID();
  } catch (e) {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// Configuration at top of file
const DATA_CONFIG = {
  MAX_FOOD_ITEMS_DISPLAY: 50, // Maximum food items to show before scrolling
  FOOD_ITEM_ANIMATION_DURATION: 200, // Animation for adding/removing items
  AUTO_SCROLL_TO_NEW_ITEMS: true, // Scroll to newly added items
  DEBUG_FOOD_OPERATIONS: false,
  QUANTITY_UPDATE_DEBOUNCE_MS: 400 // Delay (ms) before persisting qty edits
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

// Retry a function with exponential backoff. Returns the result on success, throws after all attempts.
async function retryWithBackoff(fn, { attempts = 3, baseMs = 1000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === attempts - 1) throw e;
      await new Promise(r => setTimeout(r, baseMs * 2 ** i));
    }
  }
}

const SYNC_NOTICE_KEY = 'ct-sync-notice-dismissed';

function isSyncNoticeDismissed() {
  try {
    return localStorage.getItem(SYNC_NOTICE_KEY) === '1';
  } catch (e) {
    debugLog('sync-notice', 'Unable to read dismissal state', e);
    return false;
  }
}

function dismissSyncNotice() {
  try {
    localStorage.setItem(SYNC_NOTICE_KEY, '1');
  } catch (e) {
    debugLog('sync-notice', 'Unable to persist dismissal state', e);
  }
}

function showSyncNotice() {
  if (isSyncNoticeDismissed()) return;
  let notice = document.getElementById('sync-notice');
  if (notice) return;

  notice = document.createElement('div');
  notice.id = 'sync-notice';
  notice.className = 'sync-notice';
  notice.innerHTML =
    '<span>Data saves to the cloud but does not sync in real-time between devices. Refresh to see edits made elsewhere.</span>' +
    '<button class="sync-notice-dismiss" aria-label="Dismiss">&times;</button>';
  notice.querySelector('button').addEventListener('click', () => {
    notice.remove();
    dismissSyncNotice();
  });

  const container = document.getElementById('food-items-list');
  if (container?.parentElement) {
    container.parentElement.insertBefore(notice, container);
  }
}

function showLoadErrorBanner(msg) {
  let banner = document.getElementById('load-error-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'load-error-banner';
    banner.className = 'bg-red-600 text-primary text-center py-3 px-4 text-sm font-medium';
    const mainContent = document.getElementById('main-content');
    if (mainContent) mainContent.prepend(banner);
  }
  banner.textContent = msg;
  banner.classList.remove('hidden');
}

function hideLoadErrorBanner() {
  const banner = document.getElementById('load-error-banner');
  if (banner) banner.classList.add('hidden');
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

    // Fetch all necessary data in parallel with retry + backoff.
    // fetchTargets/fetchUserProfile/fetchGoalSettings now throw on network error
    // instead of silently returning {}. The retry gives transient failures a
    // chance to recover; a persistent failure surfaces a banner.
    const [targets, entries, weightEntries, rawProfile, rawGoals] = await Promise.all([
      retryWithBackoff(() => fetchTargets()),
      retryWithBackoff(() => fetchRecentEntries()),
      retryWithBackoff(() => fetchWeightEntries()),
      retryWithBackoff(() => fetchUserProfile()),
      retryWithBackoff(() => fetchGoalSettings()),
    ]);

    hideLoadErrorBanner();

    state.baselineTargets = targets;
    state.weightEntries = weightEntries;

    // Build multi-weigh-in map: all readings grouped by calendar date so the
    // analysis engine can apply preferred-window selection when multiple readings
    // exist for the same day (e.g. morning + evening scale syncs).
    const multiMap = new Map();
    for (const entry of weightEntries.values()) {
      const d = entry.date;
      if (!multiMap.has(d)) multiMap.set(d, []);
      multiMap.get(d).push(entry);
    }
    state.weightEntriesMulti = multiMap;

    // Normalize every entry at read time so all v2 fields are present in memory.
    // We never write back just because we read — this is a pure in-memory upgrade.
    const normalizedEntries = new Map();
    for (const [dateStr, entry] of entries) {
      normalizedEntries.set(dateStr, normalizeEntry(entry));
    }
    state.dailyEntries = normalizedEntries;

    // Profile and goals are normalized to ensure every field has a safe default.
    state.userProfile = normalizeUserProfile(rawProfile);
    state.goalSettings = normalizeGoalSettings(rawGoals);

    debugLog('data-load', 'Core data loaded', {
      targetsCount: Object.keys(targets).length,
      entriesCount: normalizedEntries.size,
      weightCount: weightEntries.size,
      hasProfile: Object.keys(rawProfile).length > 0,
      hasGoals: Object.keys(rawGoals).length > 0,
    });

    // Load food items after initial data is fetched.
    await loadSavedFoodItems();
    debugLog('data-load', 'Food items loaded', state.savedFoodItems.size);

    // Once all data is loaded, populate the UI.
    loadDailyFoodItems();
    populateSettingsForm();
    // forcePopulateProfileForm ensures the form is re-populated with the freshly
    // loaded data even if the user had already visited the tab this session.
    if (window.__forcePopulateProfileForm) window.__forcePopulateProfileForm();
    else if (window.__populateProfileForm) window.__populateProfileForm();
    updateDashboard();
    updateChart();

    showSyncNotice();

    debugLog('data-load', 'User data loading complete');

  } catch (e) {
    handleError('load-user-data', e, 'Error loading data.');
    showLoadErrorBanner('Data could not be loaded. Check your connection and refresh the page.');
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
  state.dailyFoodItems = (entry.foodItems || []).map(item => {
    if (!item.id) item.id = safeId();
    return coerceQuantity(item);
  });
  
  debugLog('data-daily', 'Daily food items loaded', { date: dateStr, itemCount: state.dailyFoodItems.length });
  updateFoodItemsList();
  updateExerciseSessionsList();
}

/**
 * Renders the food items logged for the current day into the food-items-list container.
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
 * Renders the list content: a totals summary card followed by per-item rows.
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
    const q = parseFloat(item.quantity ?? 0) || 0;
    const cals = parseFloat(item.calories) || 0;
    const p = parseFloat(item.protein) || 0;
    const c = parseFloat(item.carbs) || 0;
    const f = parseFloat(item.fat) || 0;
    acc.calories += q * cals;
    acc.protein  += q * p;
    acc.carbs    += q * c;
    acc.fat      += q * f;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  // Generate food items HTML with improved styling
  const itemsHtml = state.dailyFoodItems.map((item, index) => {
    // Food names are user-controlled; escape before interpolating into innerHTML (XSS).
    const name = escapeHtml(item.name || '(blank)');
    const isSubtraction = (item.calories || 0) < 0;
    const qty = parseFloat(item.quantity ?? 0) || 0;
    const nameDisplay = qty > 0 ? `${name} × ${qty}` : name;
    // Display nutrient totals multiplied by quantity
    const totalCals = qty * (parseFloat(item.calories) || 0);
    const totalProtein = qty * (parseFloat(item.protein) || 0);
    const totalCarbs = qty * (parseFloat(item.carbs) || 0);
    const totalFat = qty * (parseFloat(item.fat) || 0);
    const macroLine = `${Math.round(totalCals)} cal · ${Math.round(totalProtein)}p · ${Math.round(totalCarbs)}c · ${Math.round(totalFat)}f`;

    let timeStampHtml = '';
    if (item.timestamp) {
      try {
        const time = new Date(item.timestamp);
        const formatted = time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        timeStampHtml = `<div class="food-item-timestamp">${formatted}</div>`;
      } catch (_) { /* ignore unparseable timestamps */ }
    }

    const qtyInput = typeof window.updateItemQuantity === 'function'
      ? `<input type="number" step="0.01" min="0"
          class="input input-xs food-item-qty"
          value="${qty}"
          onchange="window.updateItemQuantity('${item.id}', this.value)" />`
      : '';

    return `
      <div class="food-item-card ${isSubtraction ? 'text-negative' : ''}">
        <div class="food-item-top">
          <span class="food-item-name" title="${name}">${name}</span>
          <button onclick="removeFoodItem(${index})" class="food-item-delete btn btn-danger icon-btn" aria-label="Delete" title="Delete">&times;</button>
        </div>
        ${timeStampHtml}
        <div class="food-item-bottom">
          <span class="food-item-macros">${qty > 0 ? `×${qty} · ` : ''}${macroLine}</span>
          ${qtyInput}
        </div>
      </div>`;
  }).join('');

  // Summary section
  const summaryHtml = `
      <div class="kpi card mb-3">
        <div class="kpi-row items-start">
          <div>
            <div class="kpi-label text-responsive-xl">Today's Totals</div>
            <div class="text-sm text-secondary">(${state.dailyFoodItems.length} ${state.dailyFoodItems.length === 1 ? 'item' : 'items'})</div>
          </div>
          <div class="text-right shrink-0">
            <div class="text-responsive-2xl font-extrabold whitespace-nowrap">${Math.round(totals.calories)} cal</div>
            <div class="text-sm text-secondary whitespace-nowrap">
              ${Math.round(totals.protein)}p / ${Math.round(totals.carbs)}c / ${Math.round(totals.fat)}f
            </div>
          </div>
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

  const warningEl = document.getElementById('parse-missing-warning');
  if (warningEl) {
    warningEl.textContent = '';
    warningEl.removeAttribute('title');
    warningEl.classList.add('hidden');
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
      foodItems: [],
      // v2 schema fields — present on all new entries from this point forward
      schemaVersion: SCHEMA_VERSIONS.ENTRY,
      entryType: 'logged',
      exerciseSessions: [],
      dayActivityLevel: null,
      vacationDayType: null,
      manualLock: false,
      calorieAdjustmentItems: [],
      estimateMeta: null,
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

// ---------------------------------------------------------------------------
// Exercise session helpers
// ---------------------------------------------------------------------------

/**
 * Render the compact exercise sessions list into #exercise-sessions-list.
 * Called after loadDailyFoodItems and after any session add/edit/remove.
 */
export function updateExerciseSessionsList() {
  const container = document.getElementById('exercise-sessions-list');
  if (!container) return;

  const dateStr = state.dom.dateInput?.value || getTodayInTimezone();
  const entry   = state.dailyEntries.get(dateStr) || {};
  const sessions = Array.isArray(entry.exerciseSessions) ? entry.exerciseSessions : [];

  if (sessions.length === 0) {
    container.innerHTML = `<p class="text-xs text-muted py-1">No sessions logged — use a Day Activity Level above or add a session.</p>`;
    return;
  }

  const weightKg = resolveWeightKg();
  let totalKcal = 0;

  const rows = sessions.map(s => {
    const typeLabel = ACTIVITY_TYPES[s.activityType]?.label ?? s.activityType;
    const intLabel  = INTENSITY_LABELS[s.intensity] ?? s.intensity;
    const { kcal, source } = estimateSessionCalories(s, weightKg);
    totalKcal += kcal;

    const sourceIcon = source === 'manual' ? '✏️' : source === 'wearable' ? '⌚' : '📊';
    const durationTxt = s.durationMin ? `${s.durationMin} min` : '';
    const distanceTxt = s.distanceValue
      ? ` · ${s.distanceValue} ${s.distanceUnit || 'km'}`
      : '';
    const stepsTxt = s.steps ? ` · ${Number(s.steps).toLocaleString()} steps` : '';

    return `
      <div class="flex items-center justify-between p-2 rounded-lg surface-2 border gap-2">
        <div class="flex-1 min-w-0">
          <span class="font-medium text-primary text-xs">${typeLabel}</span>
          <span class="text-muted text-xs ml-1">· ${durationTxt} · ${intLabel}${distanceTxt}${stepsTxt}</span>
          ${s.notes ? `<div class="text-xs text-muted truncate">${s.notes}</div>` : ''}
        </div>
        <span class="text-xs text-accent whitespace-nowrap">${sourceIcon} ~${kcal} kcal</span>
        <button onclick="editExerciseSession('${s.id}')"
          class="btn btn-ghost icon-btn shrink-0" title="Edit" style="padding:2px 6px;">
          <i class="fas fa-pencil-alt fa-xs"></i>
        </button>
        <button onclick="removeExerciseSession('${s.id}')"
          class="btn btn-danger icon-btn shrink-0" title="Remove" style="padding:2px 6px;">
          &times;
        </button>
      </div>`;
  }).join('');

  const totalRow = sessions.length > 1
    ? `<div class="text-xs text-right text-muted pr-1 pt-1">Total exercise: ~${totalKcal} kcal</div>`
    : '';

  container.innerHTML = rows + totalRow;
}

/**
 * Persist an exercise session (add or update by id) for the current date.
 *
 * Errors from saveDailyEntry propagate to the caller (wire.js saveExerciseSession)
 * which keeps the modal open and shows the error — no silent loss on navigation.
 * UI is only updated after a confirmed cloud save.
 */
export async function persistExerciseSession(session) {
  flushPendingUndo();

  const dateStr = state.dom.dateInput?.value || getTodayInTimezone();
  const entry   = getCurrentDailyEntry();

  if (!Array.isArray(entry.exerciseSessions)) entry.exerciseSessions = [];

  const idx = entry.exerciseSessions.findIndex(s => s.id === session.id);
  if (idx >= 0) {
    entry.exerciseSessions[idx] = session;
  } else {
    entry.exerciseSessions.push(session);
  }

  state.dailyEntries.set(dateStr, entry);
  await saveDailyEntry(dateStr, entry); // throws on failure → caller handles
  updateExerciseSessionsList();
  updateDashboard();
}

/**
 * Remove an exercise session by id for the current date with a 5-second undo window.
 * Exposed as window.removeExerciseSession.
 */
function removeExerciseSessionById(sessionId) {
  const dateStr = state.dom.dateInput?.value || getTodayInTimezone();
  const entry   = getCurrentDailyEntry();

  if (!Array.isArray(entry.exerciseSessions)) return;

  const removed = entry.exerciseSessions.find(s => s.id === sessionId);
  if (!removed) return;

  flushPendingUndo();

  const removedIndex = entry.exerciseSessions.findIndex(s => s.id === sessionId);

  entry.exerciseSessions = entry.exerciseSessions.filter(s => s.id !== sessionId);
  state.dailyEntries.set(dateStr, entry);
  updateExerciseSessionsList();
  updateDashboard();

  const label = removed.activityType || 'session';

  showUndoToast(
    `Removed exercise ${label}`,
    () => {
      entry.exerciseSessions.splice(Math.min(removedIndex, entry.exerciseSessions.length), 0, removed);
      state.dailyEntries.set(dateStr, entry);
      updateExerciseSessionsList();
      updateDashboard();
      showMessage('Deletion undone.');
    },
    async () => {
      try {
        await saveDailyEntrySnapshot(dateStr, entry);
      } catch (err) {
        entry.exerciseSessions.splice(Math.min(removedIndex, entry.exerciseSessions.length), 0, removed);
        state.dailyEntries.set(dateStr, entry);
        handleError('remove-exercise-session', err, 'Failed to remove exercise session from the cloud.');
        updateExerciseSessionsList();
        updateDashboard();
      }
    }
  );
}

// Expose session remove to inline onclick handlers (edit is handled in wire.js)
window.removeExerciseSession = removeExerciseSessionById;

// ---------------------------------------------------------------------------
// Debounced quantity update helper for inline inputs (fires on change)
// ---------------------------------------------------------------------------

let quantityUpdateTimer;
window.updateItemQuantity = (id, value) => {
  flushPendingUndo();

  const q = parseFloat(value);
  const item = state.dailyFoodItems.find(x => x.id === id);
  if (!item) return;

  const newQty = isNaN(q) || q < 0 ? 0 : q;
  if (item.quantity !== newQty) item.quantity = newQty;

  const dateStr = state.dom.dateInput?.value || getTodayInTimezone();
  const entry = getCurrentDailyEntry(); // always returns a v2-shaped entry
  entry.foodItems = state.dailyFoodItems;
  allNutrients.forEach(n => {
    entry[n] = state.dailyFoodItems.reduce((sum, fi) => {
      const qty = parseFloat(fi.quantity ?? 0) || 0;
      const val = parseFloat(fi[n]) || 0;
      return sum + qty * val;
    }, 0);
  });
  state.dailyEntries.set(dateStr, entry);

  updateFoodItemsList();
  updateDashboard();
  updateChart();

  clearTimeout(quantityUpdateTimer);
  quantityUpdateTimer = setTimeout(() => {
    saveDailyEntry(dateStr, entry);
  }, DATA_CONFIG.QUANTITY_UPDATE_DEBOUNCE_MS);
};