/**
 * @file src/events/wire.js
 * @description Fixed event wiring with proper training bump integration
 */

import { state } from '../state/store.js';
import {
  ensureDateInput, loadUserData, loadDailyFoodItems,
  getCurrentDailyEntry, persistExerciseSession, updateExerciseSessionsList,
} from '../services/data.js';
import { setupFoodDropdown } from '../food/dropdown.js';
import { parseAndStage, addStagedNutrientsToDailyLog, subtractStagedNutrientsFromDailyLog, handleStagingAction } from '../staging/parser.js';
import { exportTargetsJson, exportSavedFoodsCsv, exportDailyLogCsv } from '../exports/exporters.js';
import { openFoodManager, closeFoodManager, selectFoodItem, editFoodItem, deleteFoodItemFromManager, removeFoodItem } from '../food/manager.js';
import { closeBlankFoodNameModal, closeDuplicateDialog } from '../ui/modals.js';
import { saveFoodItemToDatabase } from '../food/save.js';
import { handleLogin, handleSignUp, handleGuestLogin, handleLogout } from '../main.js';
import { saveTargets, saveDailyEntry } from '../services/firebase.js';
import { allNutrients } from '../constants.js';
import { updateDashboard, activateTab } from '../ui/dashboard.js';
import { updateChart } from '../ui/chart.js';
import { debugLog, handleError, clampNutrient, flushPendingUndo } from '../utils/ui.js';
import {
  ACTIVITY_TYPES,
  estimateSessionCalories,
} from '../exercise/met.js';
import { getTodayInTimezone } from '../utils/time.js';
import { resolveWeightKg } from '../ui/nutrientHelpers.js';

/**
 * Main event wiring function - called from main.js after DOM is ready
 */
export function wire() {
  try {
    debugLog('wire', 'Starting event listener setup');

    // Set up food dropdown with delay to ensure DOM is ready
    setTimeout(() => {
      try {
        setupFoodDropdown();
        debugLog('wire', 'Food dropdown setup complete');
      } catch (error) {
        handleError('wire-dropdown', error, 'Failed to setup food dropdown');
      }
    }, 100);

    // Wire up all event categories
    wireAuthEvents();
    wireModalEvents();
    wireSettingsEvents();
    wireMainControls();
    wireStagingEvents();
    wireFoodDatabaseEvents();
    wireExportEvents();
    wireTabs();
    wireExerciseSessionModal();

    // Expose global functions for inline HTML onclick handlers
    exposeGlobalFunctions();

    debugLog('wire', 'All event listeners attached successfully');

  } catch (error) {
    handleError('wire', error, 'Failed to wire up event listeners');
  }
}

/**
 * Wire up authentication related events
 */
function wireAuthEvents() {
  try {
    const openLoginBtn = document.getElementById('open-login-btn');
    const closeLoginBtn = document.getElementById('close-login-btn');
    const loginBtn = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const guestBtn = document.getElementById('guest-btn');
    const logoutBtn = document.getElementById('logout-btn');

    if (openLoginBtn) openLoginBtn.addEventListener('click', () => {
      if (state.dom.loginModal) state.dom.loginModal.classList.remove('hidden');
    });
    
    if (closeLoginBtn) closeLoginBtn.addEventListener('click', () => {
      if (state.dom.loginModal) state.dom.loginModal.classList.add('hidden');
    });
    
    if (loginBtn) loginBtn.addEventListener('click', handleLogin);
    if (signupBtn) signupBtn.addEventListener('click', handleSignUp);
    if (guestBtn) guestBtn.addEventListener('click', handleGuestLogin);
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    debugLog('wire', 'Auth events wired');
  } catch (error) {
    handleError('wire-auth', error, 'Failed to wire auth events');
  }
}

/**
 * Wire up modal related events
 */
function wireModalEvents() {
  try {
    const openSettingsBtn = document.getElementById('open-settings-btn');
    // Settings are now inline in the Settings tab – navigate there instead of opening a modal.
    if (openSettingsBtn) openSettingsBtn.addEventListener('click', () => activateTab('settings'));

    debugLog('wire', 'Modal events wired');
  } catch (error) {
    handleError('wire-modals', error, 'Failed to wire modal events');
  }
}

/**
 * Wire up settings form events
 */
function wireSettingsEvents() {
  try {
    const settingsForm = document.getElementById('settings-form');
    
    if (settingsForm) {
      settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        try {
          const newTargets = {};
          
          // Get all nutrient targets (clamped to safe bounds)
          allNutrients.forEach(nutrient => {
            const input = document.getElementById(`target-${nutrient}`);
            if (input) {
              newTargets[nutrient] = clampNutrient(nutrient, parseFloat(input.value) || 0);
            }
          });

          // Get banking-specific settings (fat floor uses same bound as fat macro)
          const fatMinInput = document.getElementById('target-fatMinimum');
          if (fatMinInput) {
            newTargets.fatMinimum = clampNutrient('fat', parseFloat(fatMinInput.value) || 50);
          }

          await saveTargets(newTargets);

          // Navigate back to Today tab after saving
          activateTab('today');

          // Refresh UI to reflect new targets
          updateDashboard();
          updateChart();
          
          debugLog('wire-settings', 'Targets saved successfully');
          
        } catch (error) {
          handleError('wire-settings-save', error, 'Failed to save targets');
        }
      });
    }

    debugLog('wire', 'Settings events wired');
  } catch (error) {
    handleError('wire-settings', error, 'Failed to wire settings events');
  }
}

// Token to detect stale date-change renders: each date-change increments this
// counter; if a second change fires before the first finishes, the first's
// post-render steps bail out so they don't overwrite the newer date's data.
let _dateChangeToken = 0;

/**
 * Wire up main control events including date and day activity level
 */
function wireMainControls() {
  try {
    // Date input change handler
    if (state.dom.dateInput) {
      state.dom.dateInput.addEventListener('change', async () => {
        flushPendingUndo();
        const token = ++_dateChangeToken;
        try {
          await loadDailyFoodItems();
          if (token !== _dateChangeToken) return;
          loadDayActivityForDate();
          updateDashboard();
          updateChart();
          debugLog('wire-date', 'Date changed and UI updated');
        } catch (error) {
          if (token !== _dateChangeToken) return;
          handleError('wire-date-change', error, 'Failed to handle date change');
        }
      });
    }

    // Day activity level change handler (replaces legacy training-bump)
    const dayActivitySelect = document.getElementById('day-activity-level');
    if (dayActivitySelect) {
      dayActivitySelect.addEventListener('change', async (e) => {
        try {
          flushPendingUndo();
          const dateStr = state.dom.dateInput?.value;
          if (!dateStr) return;

          const entry = getCurrentDailyEntry();
          entry.dayActivityLevel = e.target.value;
          state.dailyEntries.set(dateStr, entry);
          await saveDailyEntry(dateStr, entry);
          updateDashboard();
          debugLog('wire-activity', `Day activity level set to ${e.target.value} for ${dateStr}`);
        } catch (error) {
          handleError('wire-activity-level', error, 'Failed to save day activity level');
        }
      });

      setTimeout(loadDayActivityForDate, 500);
    }

    debugLog('wire', 'Main control events wired');
  } catch (error) {
    handleError('wire-main', error, 'Failed to wire main control events');
  }
}

/**
 * Load and display the day activity level for the currently selected date.
 * Falls back to migrated dayActivityLevel from legacy trainingBump.
 */
function loadDayActivityForDate() {
  try {
    const dateStr = state.dom.dateInput?.value;
    const select  = document.getElementById('day-activity-level');
    if (!dateStr || !select) return;

    const entry = state.dailyEntries.get(dateStr) || {};
    // normalizeEntry already migrated trainingBump → dayActivityLevel in memory
    const level = entry.dayActivityLevel || 'rest';
    select.value = level;

    debugLog('wire-activity-load', `Loaded day activity level: ${level} for ${dateStr}`);
  } catch (error) {
    handleError('wire-activity-load', error, 'Failed to load day activity for date');
  }
}

/**
 * Wire up staging area events
 */
function wireStagingEvents() {
  try {
    const parseBtn = document.getElementById('parse-btn');
    const addDayBtn = document.getElementById('add-day-btn');
    const subtractDayBtn = document.getElementById('subtract-day-btn');
    const replaceDayBtn = document.getElementById('replace-day-btn');
    const stageToTargetsBtn = document.getElementById('stage-to-targets-btn');

    if (parseBtn) parseBtn.addEventListener('click', parseAndStage);
    if (addDayBtn) addDayBtn.addEventListener('click', addStagedNutrientsToDailyLog);
    if (subtractDayBtn) subtractDayBtn.addEventListener('click', subtractStagedNutrientsFromDailyLog);
    if (replaceDayBtn) replaceDayBtn.addEventListener('click', () => handleStagingAction('replace'));
    if (stageToTargetsBtn) stageToTargetsBtn.addEventListener('click', () => handleStagingAction('updateTargets'));

    const inlineQty = document.getElementById('food-inline-qty');
    const actualQty = document.getElementById('actual-quantity');
    if (inlineQty && actualQty) {
      inlineQty.addEventListener('input', () => { actualQty.value = inlineQty.value; });
      actualQty.addEventListener('input', () => { inlineQty.value = actualQty.value; });
    }

    debugLog('wire', 'Staging events wired');
  } catch (error) {
    handleError('wire-staging', error, 'Failed to wire staging events');
  }
}

/**
 * Wire up food database events
 */
function wireFoodDatabaseEvents() {
  try {
    const saveFoodBtn = document.getElementById('save-food-item-btn');
    const foodInput = document.getElementById('food-item-input');
    const openFoodManagerBtn = document.getElementById('open-food-manager-btn');

    if (saveFoodBtn) {
      saveFoodBtn.addEventListener('click', saveFoodItemToDatabase);
    }
    
    if (foodInput) {
      foodInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveFoodItemToDatabase();
        }
      });
    }
    
    if (openFoodManagerBtn) {
      openFoodManagerBtn.addEventListener('click', openFoodManager);
    }

    debugLog('wire', 'Food database events wired');
  } catch (error) {
    handleError('wire-food', error, 'Failed to wire food database events');
  }
}

/**
 * Wire up export events
 */
function wireExportEvents() {
  try {
    const exportAllBtn = document.getElementById('export-all-data-btn');
    const exportTargetsBtn = document.getElementById('export-targets-json-btn');
    const exportFoodsBtn = document.getElementById('export-saved-foods-csv-btn');

    if (exportAllBtn) exportAllBtn.addEventListener('click', exportDailyLogCsv);
    if (exportTargetsBtn) exportTargetsBtn.addEventListener('click', exportTargetsJson);
    if (exportFoodsBtn) exportFoodsBtn.addEventListener('click', exportSavedFoodsCsv);

    debugLog('wire', 'Export events wired');
  } catch (error) {
    handleError('wire-exports', error, 'Failed to wire export events');
  }
}

/**
 * Wire up tab button click handlers and keyboard navigation
 */
function wireTabs() {
  try {
    const tabBtns = Array.from(document.querySelectorAll('.tab-btn'));
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        if (tabName) activateTab(tabName);
      });
    });

    const tabBar = document.querySelector('.tab-bar');
    if (tabBar) {
      tabBar.addEventListener('keydown', (e) => {
        const current = tabBtns.findIndex(b => b.classList.contains('active'));
        let next = current;
        if (e.key === 'ArrowRight') next = (current + 1) % tabBtns.length;
        else if (e.key === 'ArrowLeft') next = (current - 1 + tabBtns.length) % tabBtns.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabBtns.length - 1;
        else return;
        e.preventDefault();
        tabBtns[next].focus();
        activateTab(tabBtns[next].dataset.tab);
      });

      const wrap = tabBar.closest('.tab-bar-wrap');
      if (wrap) {
        const updateShadows = () => {
          const { scrollLeft, scrollWidth, clientWidth } = tabBar;
          wrap.classList.toggle('scroll-left', scrollLeft > 2);
          wrap.classList.toggle('scroll-right', scrollLeft + clientWidth < scrollWidth - 2);
        };
        tabBar.addEventListener('scroll', updateShadows, { passive: true });
        window.addEventListener('resize', updateShadows);
        updateShadows();
      }
    }

    debugLog('wire', 'Tab events wired');
  } catch (error) {
    handleError('wire-tabs', error, 'Failed to wire tab events');
  }
}

// ---------------------------------------------------------------------------
// Exercise session modal
// ---------------------------------------------------------------------------

let _editingSessionId = null; // null = adding new, string = editing existing

/**
 * Wires the Add Session button and exposes modal globals to window scope.
 */
function wireExerciseSessionModal() {
  try {
    const addBtn = document.getElementById('add-exercise-session-btn');
    if (addBtn) addBtn.addEventListener('click', () => openExerciseModal(null));
    debugLog('wire', 'Exercise session modal wired');
  } catch (error) {
    handleError('wire-exercise-modal', error, 'Failed to wire exercise session modal');
  }
}

/**
 * Open the exercise session modal.
 * @param {string|null} sessionId - null to add new, id string to edit existing.
 */
function openExerciseModal(sessionId) {
  const modal = document.getElementById('exercise-session-modal');
  if (!modal) return;

  _editingSessionId = sessionId;
  const title = document.getElementById('exercise-modal-title');
  if (title) title.textContent = sessionId ? 'Edit Exercise Session' : 'Add Exercise Session';

  if (sessionId) {
    // Populate fields with existing session data
    const dateStr  = state.dom.dateInput?.value || getTodayInTimezone();
    const entry    = state.dailyEntries.get(dateStr) || {};
    const sessions = entry.exerciseSessions || [];
    const s = sessions.find(x => x.id === sessionId);
    if (s) {
      document.getElementById('es-activity-type').value  = s.activityType || 'walking';
      document.getElementById('es-duration').value        = s.durationMin  || '';
      document.getElementById('es-intensity').value       = s.intensity    || 'moderate';
      document.getElementById('es-rpe').value             = s.rpe          || '';
      document.getElementById('es-distance').value        = s.distanceValue || '';
      document.getElementById('es-distance-unit').value   = s.distanceUnit  || 'km';
      document.getElementById('es-steps').value           = s.steps         || '';
      document.getElementById('es-wearable-cal').value    = s.wearableCalories || '';
      document.getElementById('es-manual-cal').value      = s.manualCalories   || '';
      document.getElementById('es-notes').value           = s.notes           || '';
    }
  } else {
    // Reset to defaults
    document.getElementById('es-activity-type').value  = 'walking';
    document.getElementById('es-duration').value        = '';
    document.getElementById('es-intensity').value       = 'moderate';
    document.getElementById('es-rpe').value             = '';
    document.getElementById('es-distance').value        = '';
    document.getElementById('es-distance-unit').value   = 'km';
    document.getElementById('es-steps').value           = '';
    document.getElementById('es-wearable-cal').value    = '';
    document.getElementById('es-manual-cal').value      = '';
    document.getElementById('es-notes').value           = '';
  }

  updateExerciseModalFields();
  updateExerciseLiveEstimate();
  modal.classList.remove('hidden');
}

/** Close the exercise session modal without saving. */
function closeExerciseModal() {
  const modal = document.getElementById('exercise-session-modal');
  if (modal) modal.classList.add('hidden');
  _editingSessionId = null;
}

/** Show/hide distance and steps fields based on the selected activity type. */
function updateExerciseModalFields() {
  const actType = document.getElementById('es-activity-type')?.value;
  const info    = ACTIVITY_TYPES[actType] || {};

  const distRow  = document.getElementById('es-distance-row');
  const stepsRow = document.getElementById('es-steps-row');

  if (distRow)  distRow.classList.toggle('hidden',  !info.hasDistance);
  if (stepsRow) stepsRow.classList.toggle('hidden', !info.hasSteps);

  updateExerciseLiveEstimate();
}

/** Recompute and display the live calorie estimate while the user edits the form. */
function updateExerciseLiveEstimate() {
  const el = document.getElementById('es-estimate-display');
  if (!el) return;

  const session = {
    activityType:    document.getElementById('es-activity-type')?.value || 'custom',
    durationMin:     parseFloat(document.getElementById('es-duration')?.value) || 0,
    intensity:       document.getElementById('es-intensity')?.value || 'moderate',
    wearableCalories: parseFloat(document.getElementById('es-wearable-cal')?.value) || null,
    manualCalories:   parseFloat(document.getElementById('es-manual-cal')?.value)   || null,
  };

  const weightKg = resolveWeightKg();
  const { kcal, source } = estimateSessionCalories(session, weightKg);
  const sourceNote = source === 'manual' ? '(manual override)'
                   : source === 'wearable' ? '(from wearable)'
                   : `(MET estimate · ${weightKg.toFixed(0)} kg body weight)`;

  el.textContent = session.durationMin > 0 || source !== 'met_estimate'
    ? `Estimated: ~${kcal} kcal ${sourceNote}`
    : 'Estimated: — (enter duration)';
}

/** Read the modal form and persist the session (add or update). */
async function saveExerciseSession() {
  try {
    const actType  = document.getElementById('es-activity-type')?.value;
    const duration = parseFloat(document.getElementById('es-duration')?.value);

    const durErr = document.getElementById('es-duration-error');
    if (durErr) { durErr.textContent = ''; durErr.classList.add('hidden'); }

    if (!actType || isNaN(duration) || duration <= 0) {
      if (durErr) { durErr.textContent = 'Duration must be greater than 0.'; durErr.classList.remove('hidden'); }
      return;
    }

    const distRow  = document.getElementById('es-distance-row');
    const stepsRow = document.getElementById('es-steps-row');

    const session = {
      id:              _editingSessionId || crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      activityType:    actType,
      durationMin:     duration,
      intensity:       document.getElementById('es-intensity')?.value || 'moderate',
      rpe:             parseFloat(document.getElementById('es-rpe')?.value) || null,
      distanceValue:   !distRow?.classList.contains('hidden')  ? (parseFloat(document.getElementById('es-distance')?.value) || null) : null,
      distanceUnit:    !distRow?.classList.contains('hidden')  ? (document.getElementById('es-distance-unit')?.value || 'km') : null,
      steps:           !stepsRow?.classList.contains('hidden') ? (parseFloat(document.getElementById('es-steps')?.value) || null) : null,
      wearableCalories: parseFloat(document.getElementById('es-wearable-cal')?.value) || null,
      manualCalories:   parseFloat(document.getElementById('es-manual-cal')?.value)   || null,
      notes:           document.getElementById('es-notes')?.value?.trim() || '',
      timestamp:       new Date().toISOString(),
    };

    // Compute and store the estimate so the analysis engine can use it
    const weightKg = resolveWeightKg();
    const { kcal, source, met } = estimateSessionCalories(session, weightKg);
    session.estimatedCalories = kcal;
    session.metValue          = met;

    // Use getCurrentDailyEntry (not .get) so a brand-new day gets its entry
    // created in state before persistExerciseSession runs — otherwise the
    // dayActivityLevel mutation is lost when persistExerciseSession creates
    // its own fresh entry via the same call.
    const dateStr = state.dom.dateInput?.value || getTodayInTimezone();
    const entry   = getCurrentDailyEntry();
    if (entry.dayActivityLevel !== 'custom') {
      entry.dayActivityLevel = 'custom';
      state.dailyEntries.set(dateStr, entry);
      const sel = document.getElementById('day-activity-level');
      if (sel) sel.value = 'custom';
    }

    // Await the cloud save. If it throws, the catch block below handles it and
    // the modal stays open — no silent data loss on navigation.
    await persistExerciseSession(session);
    closeExerciseModal();

    debugLog('wire-exercise-save', `Session saved: ${actType} ${duration} min`);
  } catch (error) {
    handleError('wire-exercise-save', error, 'Failed to save exercise session');
  }
}

/**
 * Expose functions globally for inline HTML onclick handlers
 */
function exposeGlobalFunctions() {
  try {
    Object.assign(window, {
      closeFoodManager,
      editFoodItem,
      deleteFoodItemFromManager,
      removeFoodItem,
      selectFoodItem,
      closeBlankFoodNameModal,
      closeDuplicateDialog,
      // Exercise session modal
      openExerciseModal,
      closeExerciseModal,
      saveExerciseSession,
      updateExerciseModalFields,
      updateExerciseLiveEstimate,
      editExerciseSession: (id) => openExerciseModal(id),
    });

    debugLog('wire', 'Global functions exposed');
  } catch (error) {
    handleError('wire-globals', error, 'Failed to expose global functions');
  }
}