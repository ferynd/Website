/**
 * @file src/events/wire.js
 * @description Wires up all DOM event listeners for the application.
 * This keeps the main HTML clean and centralizes event management.
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
import { saveTargets } from '../services/firebase.js';
import { allNutrients } from '../constants.js';
import { updateDashboard } from '../ui/dashboard.js';
import { updateChart } from '../ui/chart.js';
import { debugLog, handleError } from '../utils/ui.js';

/**
 * Attaches all event listeners to the DOM elements.
 * Called from main.js after DOM is ready and elements are cached.
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

    // --- Auth & Modals ---
    wireAuthEvents();
    wireModalEvents();
    wireSettingsEvents();
    wireMainControls();
    wireStagingEvents();
    wireFoodDatabaseEvents();
    wireExportEvents();
    
    // --- Expose Globals for Inline HTML `onclick` Handlers ---
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
          allNutrients.forEach(n => {
            const input = document.getElementById(`target-${n}`);
            newTargets[n] = input ? (parseFloat(input.value) || 0) : 0;
          });
          
          const fatMinInput = document.getElementById('target-fatMinimum');
          newTargets.fatMinimum = fatMinInput ? (parseFloat(fatMinInput.value) || 50) : 50;

          await saveTargets(newTargets);
          
          if (state.dom.settingsModal) {
            state.dom.settingsModal.classList.add('hidden');
          }

          // Refresh UI to reflect new targets
          updateDashboard();
          updateChart();
          
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
 * Wire up main control events
 */
function wireMainControls() {
  try {
    if (state.dom.dateInput) {
      state.dom.dateInput.addEventListener('change', () => {
        try {
          // When date changes, load food items for that day and update UI
          loadDailyFoodItems();
          updateDashboard();
          updateChart();
        } catch (error) {
          handleError('wire-date-change', error, 'Failed to handle date change');
        }
      });
    }

    debugLog('wire', 'Main control events wired');
  } catch (error) {
    handleError('wire-main', error, 'Failed to wire main control events');
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
 * This maintains compatibility with existing HTML without rewriting it
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