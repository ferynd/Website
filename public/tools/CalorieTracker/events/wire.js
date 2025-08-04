/**
 * @file src/events/wire.js
 * @description Fixed event wiring with proper training bump integration
 */

import { state } from '../state/store.js';
import { ensureDateInput, loadUserData, loadDailyFoodItems } from '../services/data.js';
import { setupFoodDropdown } from '../food/dropdown.js';
import { parseAndStage, addStagedNutrientsToDailyLog, subtractStagedNutrientsFromDailyLog, handleStagingAction } from '../staging/parser.js';
import { exportTargetsJson, exportSavedFoodsCsv, exportDailyLogCsv } from '../exports/exporters.js';
import { openFoodManager, closeFoodManager, selectFoodItem, editFoodItem, deleteFoodItemFromManager, removeFoodItem } from '../food/manager.js';
import { closeBlankFoodNameModal, closeDuplicateDialog } from '../ui/modals.js';
import { saveFoodItemToDatabase } from '../food/save.js';
import { handleLogin, handleSignUp, handleGuestLogin, handleLogout } from '../main.js';
import { saveTargets, saveDailyEntry } from '../services/firebase.js';
import { allNutrients } from '../constants.js';
import { updateDashboard } from '../ui/dashboard.js';
import { updateChart } from '../ui/chart.js';
import { debugLog, handleError } from '../utils/ui.js';

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
    const closeSettingsBtn = document.getElementById('close-settings-btn');

    if (openSettingsBtn) openSettingsBtn.addEventListener('click', () => {
      if (state.dom.settingsModal) state.dom.settingsModal.classList.remove('hidden');
    });
    
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => {
      if (state.dom.settingsModal) state.dom.settingsModal.classList.add('hidden');
    });

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
          
          // Get all nutrient targets
          allNutrients.forEach(nutrient => {
            const input = document.getElementById(`target-${nutrient}`);
            if (input) {
              newTargets[nutrient] = parseFloat(input.value) || 0;
            }
          });
          
          // Get banking-specific settings
          const fatMinInput = document.getElementById('target-fatMinimum');
          if (fatMinInput) {
            newTargets.fatMinimum = parseFloat(fatMinInput.value) || 50;
          }

          await saveTargets(newTargets);
          
          if (state.dom.settingsModal) {
            state.dom.settingsModal.classList.add('hidden');
          }

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

/**
 * Wire up main control events including date and training bump
 */
function wireMainControls() {
  try {
    // Date input change handler
    if (state.dom.dateInput) {
      state.dom.dateInput.addEventListener('change', async () => {
        try {
          // Load food items and training bump for the new date
          await loadDailyFoodItems();
          loadTrainingBumpForDate();
          
          // Update UI
          updateDashboard();
          updateChart();
          
          debugLog('wire-date', 'Date changed and UI updated');
        } catch (error) {
          handleError('wire-date-change', error, 'Failed to handle date change');
        }
      });
    }

    // Training bump change handler
    const trainingBumpSelect = document.getElementById('training-bump');
    if (trainingBumpSelect) {
      trainingBumpSelect.addEventListener('change', async (e) => {
        try {
          const dateStr = state.dom.dateInput?.value;
          if (!dateStr) return;
          
          const trainingBump = parseFloat(e.target.value) || 0;
          
          // Get or create today's entry
          let entry = state.dailyEntries.get(dateStr) || { 
            date: dateStr, 
            foodItems: state.dailyFoodItems || [] 
          };
          
          // Update training bump
          entry.trainingBump = trainingBump;
          
          // Save to local state and Firebase
          state.dailyEntries.set(dateStr, entry);
          await saveDailyEntry(dateStr, entry);
          
          // Update UI to reflect new calculations
          updateDashboard();
          
          debugLog('wire-training', `Training bump set to ${trainingBump} kcal for ${dateStr}`);
          
        } catch (error) {
          handleError('wire-training-bump', error, 'Failed to save training bump');
        }
      });
      
      // Load training bump when page loads
      setTimeout(loadTrainingBumpForDate, 500);
    }

    debugLog('wire', 'Main control events wired');
  } catch (error) {
    handleError('wire-main', error, 'Failed to wire main control events');
  }
}

/**
 * Load and display the training bump for the currently selected date
 */
function loadTrainingBumpForDate() {
  try {
    const dateStr = state.dom.dateInput?.value;
    const trainingBumpSelect = document.getElementById('training-bump');
    
    if (!dateStr || !trainingBumpSelect) return;
    
    const entry = state.dailyEntries.get(dateStr) || {};
    const trainingBump = parseFloat(entry.trainingBump) || 0;
    
    // Set the select value
    trainingBumpSelect.value = trainingBump.toString();
    
    debugLog('wire-training-load', `Loaded training bump: ${trainingBump} kcal for ${dateStr}`);
    
  } catch (error) {
    handleError('wire-training-load', error, 'Failed to load training bump for date');
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
    });

    debugLog('wire', 'Global functions exposed');
  } catch (error) {
    handleError('wire-globals', error, 'Failed to expose global functions');
  }
}