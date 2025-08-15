/**
 * @file src/ui/dashboard.js
 * @description Complete dashboard with fixed banking calculations, collapsible details, and configurable safety caps
 */

import { state } from '../state/store.js';
import { 
  allNutrients, 
  nutrients, 
  dailyTrackedNutrients, 
  averagedNutrients,
  BANKING_CONFIG, 
  DAILY_DECAY_FACTOR, 
  BankingHelpers,
  DEFAULT_TARGETS 
} from '../constants.js';
import { formatNutrientName } from '../utils/ui.js';
import { getPastDate, formatDate } from '../utils/time.js';
import { initializeChartControls } from './chart.js';
import { CONFIG } from '../config.js';

// =========================
// CONFIGURATION (Top of file for easy modification)
// =========================
const DASHBOARD_CONFIG = {
  // Banking calculation settings
  ENABLE_BANKING_DEBUG: true, // Set to false to disable banking debug logs
  SHOW_MATH_VERIFICATION: true, // Show math verification in UI when debugging
  MAX_BANK_HISTORY_DAYS: 30, // How many days back to look for bank calculations
  
  // UI behavior settings
  DEFAULT_COLLAPSED_DETAILS: true, // Start with bank details collapsed
  ANIMATION_DURATION: 300, // Milliseconds for UI animations
  SHOW_CONFIGURATION_HINTS: true, // Show helpful tooltips in settings
  
  // Micronutrient display settings
  SHOW_TRAINING_SCALING_BADGES: true, // Show "Training+" badges on scaled nutrients
  GROUP_NUTRIENTS_BY_TYPE: true, // Group nutrients in logical sections
  SHOW_PERCENTAGE_PROGRESS: true, // Show percentage bars for nutrients
  
  // Error handling
  SHOW_ERRORS_IN_UI: true, // Display errors in the dashboard
  LOG_CALCULATION_STEPS: true, // Log detailed calculation steps
  FALLBACK_TO_DEFAULTS: true // Use default values if user settings are invalid
};

// =========================
// MICRONUTRIENT SCALING CONFIGURATION
// =========================
const TRAINING_SCALING = {
  // Electrolytes scale with training intensity (sweat replacement)
  sodium: { light: 1.1, hard: 1.3, hiit: 1.5 },
  potassium: { light: 1.1, hard: 1.2, hiit: 1.3 },
  magnesium: { light: 1.1, hard: 1.2, hiit: 1.3 },
  
  // Slight protein bump for very intense sessions only
  protein: { light: 1.0, hard: 1.0, hiit: 1.1 },
  
  // Water-soluble vitamins may increase slightly for hard sessions
  vitaminC: { light: 1.0, hard: 1.1, hiit: 1.2 },
  vitaminB6: { light: 1.0, hard: 1.1, hiit: 1.1 }
};

const TRAINING_EXPLANATIONS = {
  rest: "Rest day - no extra calories needed",
  light: "Light training - modest calorie and electrolyte boost",
  hard: "Hard training - significant calorie boost, enhanced electrolytes", 
  hiit: "Intense training - major calorie boost, maximum electrolyte support"
};

// =========================
// UTILITY FUNCTIONS
// =========================

/**
 * Logs debug information for banking calculations
 * @param {string} operation - The operation being performed
 * @param {*} data - Data to log
 */
function debugLog(operation, data) {
  if (DASHBOARD_CONFIG.ENABLE_BANKING_DEBUG && CONFIG.DEBUG_MODE) {
    console.log(`🏦 [BANKING][${operation}]`, data);
  }
}

/**
 * Handles dashboard errors with user-friendly display
 * @param {string} operation - The operation that failed
 * @param {Error} error - The error object
 * @param {string} userMessage - User-friendly error message
 */
function handleError(operation, error, userMessage) {
  console.error(`❌ [DASHBOARD-ERROR][${operation}]`, error);
  
  if (DASHBOARD_CONFIG.SHOW_ERRORS_IN_UI) {
    const errorContainer = document.getElementById('dashboard-errors');
    if (errorContainer) {
      errorContainer.innerHTML = `
        <div class="mb-4 p-4 border surface-2 rounded-lg">
          <div class="flex items-center">
            <i class="fas fa-exclamation-triangle text-negative mr-2"></i>
            <span class="font-medium text-negative">${userMessage}</span>
          </div>
          ${DASHBOARD_CONFIG.ENABLE_BANKING_DEBUG ? `
            <details class="mt-2">
              <summary class="text-sm text-negative cursor-pointer">Technical Details</summary>
              <pre class="mt-1 text-xs text-negative surface-3 p-2 rounded overflow-x-auto">${error.stack || error.message}</pre>
            </details>
          ` : ''}
        </div>
      `;
    }
  }
}

/**
 * Get training intensity category from training bump calories
 * @param {number} trainingBump - Training bump calories
 * @returns {string} Training intensity category
 */
function getTrainingIntensity(trainingBump) {
  if (trainingBump >= 400) return 'hiit';
  if (trainingBump >= 280) return 'hard';
  if (trainingBump >= 100) return 'light';
  return 'rest';
}

/**
 * Calculate scaled micronutrient target for training days
 * @param {string} nutrient - Nutrient name
 * @param {number} baseTarget - Base target value
 * @param {number} trainingBump - Training bump calories
 * @returns {number} Scaled target value
 */
function getScaledNutrientTarget(nutrient, baseTarget, trainingBump) {
  const intensity = getTrainingIntensity(trainingBump);
  if (intensity === 'rest') return baseTarget;
  
  const scaling = TRAINING_SCALING[nutrient];
  if (scaling && scaling[intensity]) {
    return baseTarget * scaling[intensity];
  }
  
  return baseTarget; // No scaling for this nutrient
}

// =========================
// MAIN BANKING CALCULATION
// =========================

/**
 * Calculate banking data with consistent math and configurable parameters
 * @param {string} targetDateStr - Target date in YYYY-MM-DD format
 * @returns {Object} Banking calculation results
 */
export function calculateBankingData(targetDateStr) {
  try {
    debugLog('calc-start', { targetDateStr, userId: state.userId });
    
    const targetDate = new Date(`${targetDateStr}T00:00:00`);
    
    // Get base parameters with proper fallbacks
    const baseKcal = parseFloat(state.baselineTargets.calories) || BANKING_CONFIG.BASE_KCAL;
    const proteinG = parseFloat(state.baselineTargets.protein) || BANKING_CONFIG.PROTEIN_G;
    
    // Proper fat minimum handling with hierarchy
    let fatFloorG;
    if (state.baselineTargets.fatMinimum !== undefined && state.baselineTargets.fatMinimum !== null) {
      fatFloorG = parseFloat(state.baselineTargets.fatMinimum);
      debugLog('fat-selection', 'Using fatMinimum from settings');
    } else if (state.baselineTargets.fat !== undefined && state.baselineTargets.fat !== null) {
      fatFloorG = parseFloat(state.baselineTargets.fat);
      debugLog('fat-selection', 'Using fat from settings');
    } else {
      fatFloorG = BANKING_CONFIG.FAT_FLOOR_G;
      debugLog('fat-selection', 'Using default fat floor');
    }
    
    // Get configurable banking parameters
    const decayHalfLife = BankingHelpers.getDecayHalfLife(state.baselineTargets);
    const correctionDivisor = BankingHelpers.getCorrectionDivisor(state.baselineTargets);
    const dynamicDecayFactor = BankingHelpers.calculateDecayFactor(decayHalfLife);
    
    debugLog('banking-config', {
      baseKcal,
      proteinG,
      fatFloorG,
      decayHalfLife,
      correctionDivisor,
      dynamicDecayFactor: dynamicDecayFactor.toFixed(4)
    });
    
    // Calculate bank with consistent tracking
    const bankContributions = [];
    let totalBankBalance = 0;
    let olderContributions = 0;
    let recentContributions = 0;
    
    // Track all contributions for debugging
    const allContributions = [];
    
    // *** FIX: Loop from 1 to MAX_BANK_HISTORY_DAYS to calculate the bank based on *past* days only.
    // This excludes the current day (ageInDays = 0) from the calculation.
    for (let i = 1; i <= DASHBOARD_CONFIG.MAX_BANK_HISTORY_DAYS; i++) {
      const pastDate = getPastDate(targetDate, i);
      const pastDateStr = formatDate(pastDate);
      const entry = state.dailyEntries.get(pastDateStr) || {};
      
      const actualKcal = parseFloat(entry.calories) || 0;
      const trainingBump = parseFloat(entry.trainingBump) || 0;
      const dailyTarget = baseKcal + trainingBump;
      const deltaKcal = actualKcal - dailyTarget;
      
      const ageInDays = i;
      const decayWeight = Math.pow(dynamicDecayFactor, ageInDays);
      const contribution = deltaKcal * decayWeight;
      
      // Add to total bank
      totalBankBalance += contribution;
      
      // Store all for debugging
      if (DASHBOARD_CONFIG.LOG_CALCULATION_STEPS) {
        allContributions.push({
          date: pastDateStr,
          actualKcal,
          trainingBump,
          dailyTarget,
          deltaKcal,
          ageInDays,
          decayWeight: decayWeight.toFixed(4),
          contribution: contribution.toFixed(2)
        });
      }
      
      // Only store last 5 days for display
      if (i <= 5) {
        const contributionData = {
          date: pastDate,
          dateStr: pastDateStr,
          deltaKcal,
          ageInDays,
          decayWeight,
          contribution,
          dayName: pastDate.toLocaleDateString('en-US', { weekday: 'short' })
        };
        bankContributions.push(contributionData);
        recentContributions += contribution;
      } else {
        // Accumulate older contributions
        olderContributions += contribution;
      }
    }
    
    // Use consistent bank balance for all calculations
    const bankToday = totalBankBalance;
    
    // Calculate correction using configurable parameters
    const rawCorrection = -bankToday / correctionDivisor;
    const capPct = BankingHelpers.getCorrectionCap(bankToday, baseKcal, state.baselineTargets);
    const capValue = capPct * baseKcal;
    const correction = BankingHelpers.clamp(rawCorrection, -capValue, capValue);
    
    // Today's targets
    const todaysEntry = state.dailyEntries.get(targetDateStr) || {};
    const todaysTrainingBump = parseFloat(todaysEntry.trainingBump) || 0;
    const todayKcalTarget = BankingHelpers.roundToNearest25(baseKcal + todaysTrainingBump + correction);
    
    // Calculate macros with training scaling
    const scaledProteinG = getScaledNutrientTarget('protein', proteinG, todaysTrainingBump);
    const proteinKcal = scaledProteinG * 4;
    const fatKcal = fatFloorG * 9;
    const remainingKcal = Math.max(0, todayKcalTarget - proteinKcal - fatKcal);
    const carbsG = Math.round(remainingKcal / 4);
    
    // Math verification
    const calculatedTotal = Math.round(recentContributions + olderContributions);
    const mathIsConsistent = Math.abs(calculatedTotal - Math.round(bankToday)) <= 1;
    
    // DEBUGGING: Comprehensive calculation logging
    if (DASHBOARD_CONFIG.ENABLE_BANKING_DEBUG) {
      debugLog('calculation-summary', {
        totalBankBalance: Math.round(totalBankBalance),
        recentContributions: Math.round(recentContributions),
        olderContributions: Math.round(olderContributions),
        mathVerification: { calculatedTotal, bankToday: Math.round(bankToday), consistent: mathIsConsistent },
        rawCorrection: Math.round(rawCorrection),
        capPct: (capPct * 100).toFixed(1) + '%',
        appliedCorrection: Math.round(correction),
        todayTarget: todayKcalTarget
      });
      
      if (DASHBOARD_CONFIG.LOG_CALCULATION_STEPS && allContributions.length > 0) {
        console.table(allContributions.slice(0, 10)); // Show most recent 10 days of contributions
      }
      
      if (!mathIsConsistent) {
        console.warn('🚨 BANKING MATH INCONSISTENCY:', {
          expected: Math.round(bankToday),
          calculated: calculatedTotal,
          difference: calculatedTotal - Math.round(bankToday)
        });
      }
    }
    
    return {
      // Core banking values
      bankToday: Math.round(bankToday),
      bankContributions,
      olderContributions: Math.round(olderContributions),
      recentContributions: Math.round(recentContributions),
      
      // Base parameters
      baseKcal,
      todaysTrainingBump,
      
      // Correction calculation
      rawCorrection: Math.round(rawCorrection),
      capPct,
      correction: Math.round(correction),
      
      // Target results
      todayKcalTarget,
      proteinG: Math.round(scaledProteinG),
      fatG: Math.round(fatFloorG),
      carbsG,
      trainingIntensity: getTrainingIntensity(todaysTrainingBump),
      
      // Configuration details for display
      config: {
        decayHalfLife,
        correctionDivisor,
        decayFactor: dynamicDecayFactor,
        smallBankCap: state.baselineTargets.smallBankCap || DEFAULT_TARGETS.smallBankCap,
        mediumBankCap: state.baselineTargets.mediumBankCap || DEFAULT_TARGETS.mediumBankCap,
        largeBankCap: state.baselineTargets.largeBankCap || DEFAULT_TARGETS.largeBankCap
      },
      
      // Debug information
      debug: {
        mathIsConsistent,
        calculatedTotal,
        allContributionsCount: allContributions.length
      }
    };
    
  } catch (error) {
    handleError('calculate-banking', error, 'Failed to calculate banking data');
    
    // Return safe fallback values
    return {
      bankToday: 0,
      bankContributions: [],
      olderContributions: 0,
      recentContributions: 0,
      baseKcal: BANKING_CONFIG.BASE_KCAL,
      todaysTrainingBump: 0,
      rawCorrection: 0,
      capPct: 0.15,
      correction: 0,
      todayKcalTarget: BANKING_CONFIG.BASE_KCAL,
      proteinG: BANKING_CONFIG.PROTEIN_G,
      fatG: BANKING_CONFIG.FAT_FLOOR_G,
      carbsG: 0,
      trainingIntensity: 'rest',
      config: {
        decayHalfLife: BANKING_CONFIG.DECAY_HALF_LIFE_DAYS,
        correctionDivisor: BANKING_CONFIG.CORRECTION_DIVISOR,
        decayFactor: DAILY_DECAY_FACTOR,
        smallBankCap: DEFAULT_TARGETS.smallBankCap,
        mediumBankCap: DEFAULT_TARGETS.mediumBankCap,
        largeBankCap: DEFAULT_TARGETS.largeBankCap
      },
      debug: {
        mathIsConsistent: false,
        calculatedTotal: 0,
        allContributionsCount: 0
      }
    };
  }
}

// =========================
// MICRONUTRIENT CALCULATIONS
// =========================

/**
 * Calculate micronutrients with training day scaling
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @returns {Object} Micronutrient metrics
 */
export function calculateMicronutrientMetrics(dateStr) {
  try {
    const targetDate = new Date(`${dateStr}T00:00:00`);
    const todayEntry = state.dailyEntries.get(dateStr) || {};
    const todaysTrainingBump = parseFloat(todayEntry.trainingBump) || 0;
    
    const metrics = {};
    
    allNutrients.forEach(nutrient => {
      if (nutrients.macros.includes(nutrient)) return; // Skip macros
      
      const baseTarget = parseFloat(state.baselineTargets[nutrient]) || DEFAULT_TARGETS[nutrient] || 0;
      const scaledTarget = getScaledNutrientTarget(nutrient, baseTarget, todaysTrainingBump);
      const todaysIntake = parseFloat(todayEntry[nutrient]) || 0;
      
      let avgIntake = todaysIntake;
      let status = 'red';
      
      // Calculate 7-day average for averaged nutrients
      if (averagedNutrients.includes(nutrient)) {
        let sum = 0;
        let count = 0;
        
        for (let i = 0; i < 7; i++) {
          const pastDate = getPastDate(targetDate, i);
          const pastDateStr = formatDate(pastDate);
          const entry = state.dailyEntries.get(pastDateStr) || {};
          const intake = parseFloat(entry[nutrient]) || 0;
          sum += intake;
          count++;
        }
        
        avgIntake = count > 0 ? sum / count : 0;
        
        // Status based on 7-day average vs base target (not scaled)
        if (avgIntake >= baseTarget * 0.9) status = 'green';
        else if (avgIntake >= baseTarget * 0.7) status = 'amber';
        else status = 'red';
      } else {
        // Daily nutrients - status based on today's intake vs scaled target
        if (todaysIntake >= scaledTarget) status = 'green';
        else if (todaysIntake >= scaledTarget * 0.8) status = 'amber';
        else status = 'red';
      }
      
      metrics[nutrient] = {
        name: nutrient,
        baseTarget,
        scaledTarget,
        todaysIntake,
        avgIntake,
        status,
        isDailyFloor: dailyTrackedNutrients.includes(nutrient),
        isAveraged: averagedNutrients.includes(nutrient),
        isScaled: scaledTarget !== baseTarget
      };
    });
    
    return metrics;
    
  } catch (error) {
    handleError('calculate-micronutrients', error, 'Failed to calculate micronutrient metrics');
    return {};
  }
}

// =========================
// MAIN DASHBOARD UPDATE
// =========================

/**
 * Main dashboard update function
 */
export function updateDashboard() {
  try {
    debugLog('update-start', 'Starting dashboard update');
    
    const { dashboard } = state.dom;

    if (!dashboard) {
      throw new Error('Dashboard container not found');
    }

    // Clear any previous errors
    const errorContainer = document.getElementById('dashboard-errors');
    if (errorContainer) {
      errorContainer.innerHTML = '';
    }

    if (!state.userId || Object.keys(state.baselineTargets).length === 0) {
      dashboard.innerHTML = `
        <div id="dashboard-errors"></div>
        <div class="text-center p-8 surface-1 rounded-lg shadow-md">
          <h3 class="text-xl font-semibold text-secondary">Welcome to Adaptive Nutrition Tracker!</h3>
          <p class="mt-2 text-muted">Please log in and set your baseline targets to get started.</p>
          <button onclick="document.getElementById('open-settings-btn').click()"
            class="mt-4 px-6 py-2 btn btn-primary">Set Targets</button>
        </div>`;
      return;
    }

    const dateStr = state.dom.dateInput.value;
    const todaysEntry = state.dailyEntries.get(dateStr) || {};
    const bankingData = calculateBankingData(dateStr);
    const micronutrientMetrics = calculateMicronutrientMetrics(dateStr);

    dashboard.innerHTML = `
      <div id="dashboard-errors"></div>
      ${renderInfoBox()}
      ${renderBankingPanel(bankingData)}
      ${renderTodaysPlanPanel(bankingData, todaysEntry)}
      ${renderChartSection()}
      ${renderMicronutrientSections(micronutrientMetrics)}
    `;

    initializeChartControls();
    
    // Set up event handlers for collapsible sections
    setupCollapsibleHandlers();

    debugLog('update-complete', 'Dashboard update completed successfully');

  } catch (error) {
    handleError('update-dashboard', error, 'Failed to update dashboard');
  }
}

/**
 * Set up event handlers for collapsible sections
 */
function setupCollapsibleHandlers() {
  try {
    const setupToggle = (toggleId, contentId, showText, hideText) => {
      const toggle = document.getElementById(toggleId);
      const content = document.getElementById(contentId);
      if (toggle && content) {
        toggle.addEventListener('click', () => {
          const isHidden = content.classList.contains('hidden');
          content.classList.toggle('hidden', !isHidden);
          const icon = toggle.querySelector('.fa-chevron-down, .fa-chevron-up');
          const text = toggle.querySelector('.toggle-text');
          if (icon && text) {
            if (isHidden) {
              icon.classList.remove('fa-chevron-down');
              icon.classList.add('fa-chevron-up');
              text.textContent = hideText;
            } else {
              icon.classList.remove('fa-chevron-up');
              icon.classList.add('fa-chevron-down');
              text.textContent = showText;
            }
          }
        });
      }
    };

    setupToggle(
      'bank-details-toggle', 
      'bank-details-content', 
      'Show How We Calculated This', 
      'Hide Calculation Details'
    );

    setupToggle(
      'recent-days-toggle',
      'recent-days-content',
      'Show Recent Days Breakdown',
      'Hide Recent Days Breakdown'
    );

  } catch (error) {
    handleError('setup-collapsible', error, 'Failed to set up collapsible handlers');
  }
}

// =========================
// RENDERING FUNCTIONS
// =========================

/**
 * Render info box with explanations
 */
function renderInfoBox() {
  return `
    <div class="mb-6 p-4 surface-2 rounded-lg border">
      <h3 class="font-semibold text-secondary mb-2"><i class="fas fa-info-circle mr-2"></i>How This Works</h3>
      <div class="text-sm text-muted space-y-1">
        <p><strong>Smart Banking:</strong> Your "bank" tracks when you eat more (+) or less (-) than planned. Recent days matter most.</p>
        <p><strong>Auto-Adjust:</strong> Tomorrow's calories adjust to balance your bank, with safety limits (15-40% max change).</p>
        <p><strong>Training Days:</strong> Select your workout type above - this adds calories and scales electrolytes appropriately.</p>
      </div>
    </div>
  `;
}

/**
 * Render banking panel with consistent math verification
 */
function renderBankingPanel(bankingData) {
  const { bankToday, bankContributions, olderContributions, recentContributions, debug } = bankingData;
  
  const dayDecayPcts = [1, 2, 3, 4, 5].map(days => {
    const pct = Math.pow(DAILY_DECAY_FACTOR, days) * 100;
    return Math.round(pct);
  });
  
  const contributionRows = bankContributions.map((c, index) => `
    <tr>
      <td class="px-3 py-2 text-sm font-medium">${c.dayName}</td>
      <td class="px-3 py-2 text-sm text-center">${c.deltaKcal > 0 ? '+' : ''}${Math.round(c.deltaKcal)}</td>
      <td class="px-3 py-2 text-sm text-center text-muted">${dayDecayPcts[index]}%</td>
      <td class="px-3 py-2 text-sm text-center font-medium ${c.contribution > 0 ? 'text-negative' : 'text-positive'}">
        ${c.contribution > 0 ? '+' : ''}${Math.round(c.contribution)}
      </td>
    </tr>
  `).join('');
  
  const bankExplanation = bankToday > 0 
    ? "You've been eating more than planned - tomorrow's calories will be reduced to balance this out."
    : bankToday < 0 
    ? "You've been eating less than planned - tomorrow's calories will be increased to balance this out."
    : "You're perfectly balanced - no adjustment needed!";
  
  return `
    <div class="section-card p-4">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-xl font-bold text-secondary">🏦 Your Calorie Bank</h3>
        <button id="recent-days-toggle" class="text-accent hover:text-accent-600 text-sm font-medium flex items-center gap-2">
            <i class="fas fa-chevron-down"></i>
            <span class="toggle-text">Show Recent Days Breakdown</span>
        </button>
      </div>

      <div class="p-3 rounded-lg border surface-2">
        <div class="text-center">
          <div class="text-2xl font-bold ${bankToday > 0 ? 'text-negative' : bankToday < 0 ? 'text-positive' : 'text-muted'}">
            ${bankToday > 0 ? '+' : ''}${bankToday} kcal
          </div>
          <p class="text-sm text-muted mt-1">${bankExplanation}</p>
          ${!debug.mathIsConsistent && DASHBOARD_CONFIG.SHOW_MATH_VERIFICATION ? `
            <div class="mt-2 p-2 border surface-2 text-xs text-warning rounded">
              ⚠️ Math verification: Expected ${bankToday}, calculated ${debug.calculatedTotal} (difference: ${debug.calculatedTotal - bankToday})
            </div>
          ` : ''}
        </div>
      </div>

      <div id="recent-days-content" class="hidden">
        <div class="overflow-x-auto">
          <table class="w-full border rounded-lg">
            <thead class="surface-2">
              <tr>
                <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Day</th>
                <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Over/Under</th>
                <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Weight</th>
                <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Impact Today</th>
              </tr>
            </thead>
            <tbody>
              ${contributionRows}
              <tr class="border-t-2 border">
                <td colspan="3" class="px-3 py-2 text-sm font-medium text-primary italic">Days 6+ ago contribution</td>
                <td class="px-3 py-2 text-sm text-center font-medium text-primary italic">
                  ${olderContributions > 0 ? '+' : ''}${Math.round(olderContributions)}
                </td>
              </tr>
              <tr class="surface-2 border-t-2 border">
                <td colspan="3" class="px-3 py-2 text-sm font-medium">Total Bank Balance:</td>
                <td class="px-3 py-2 text-lg text-center ${bankToday > 0 ? 'text-negative' : bankToday < 0 ? 'text-positive' : 'text-muted'} font-bold">
                  ${bankToday > 0 ? '+' : ''}${bankToday} kcal
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="mt-3 text-xs text-muted">
          <strong>How it works:</strong> Recent days have more impact (yesterday = 82%, 2 days = 67%, etc.).
          After 7-10 days, the impact is nearly zero (≤25%).
        </p>
      </div>
    </div>
  `;
}


/**
 * Render today's plan with collapsible calculation details
 */
function renderTodaysPlanPanel(bankingData, todaysEntry) {
  const {
    baseKcal,
    todaysTrainingBump,
    bankToday,
    rawCorrection,
    capPct,
    correction,
    todayKcalTarget,
    proteinG,
    fatG,
    carbsG,
    trainingIntensity
  } = bankingData;

  const todaysCalories = parseFloat(todaysEntry.calories) || 0;
  const todaysProtein = parseFloat(todaysEntry.protein) || 0;
  const todaysFat = parseFloat(todaysEntry.fat) || 0;
  const todaysCarbs = parseFloat(todaysEntry.carbs) || 0;

  const remainingCalories = todayKcalTarget - todaysCalories;
  const remainingProtein = proteinG - todaysProtein;
  const remainingFat = fatG - todaysFat;
  const remainingCarbs = carbsG - todaysCarbs;

  const remainingCaloriesColor = remainingCalories >= 0 ? 'text-muted' : 'text-negative';
  const remainingProteinColor = remainingProtein >= 0 ? 'text-positive' : 'text-negative';
  const remainingFatColor = remainingFat >= 0 ? 'text-positive' : 'text-negative';
  const remainingCarbsColor = remainingCarbs >= 0 ? 'text-positive' : 'text-negative';
  
  // User-friendly explanations
  const correctionExplanation = correction === rawCorrection 
    ? "Full bank correction applied"
    : `Bank correction was ${rawCorrection > 0 ? 'increased' : 'reduced'} to stay within safe limits (${Math.round(capPct * 100)}% max)`;
  
  return `
    <div class="mb-6 card p-6 shadow-lg">
      <h3 class="text-xl font-bold text-secondary mb-4">🍽️ Today's Nutrition Plan</h3>

      <!-- Summary Section -->
      <div class="mb-4 p-4 surface-2 rounded-lg border">
        <div class="flex justify-between items-center text-lg font-semibold">
          <span>Today's Calorie Target:</span>
          <span class="text-accent">${todayKcalTarget} kcal</span>
        </div>
        <div class="flex justify-between items-center text-sm mt-1">
          <span class="text-primary">Remaining:</span>
          <span class="font-medium ${remainingCaloriesColor}">${remainingCalories.toFixed(0)} kcal</span>
        </div>

        <!-- Collapsible Details Button -->
        <button id="bank-details-toggle" class="mt-3 text-sm text-accent hover:text-accent-600 font-medium flex items-center gap-2">
          <i class="fas fa-chevron-down"></i>
          <span class="toggle-text">Show How We Calculated This</span>
        </button>

        <!-- Collapsible Calculation Details -->
        <div id="bank-details-content" class="${DASHBOARD_CONFIG.DEFAULT_COLLAPSED_DETAILS ? 'hidden' : ''} mt-4 space-y-2 text-sm">
          <div class="grid grid-cols-1 gap-2">
            <div class="flex justify-between items-center p-2 surface-1 rounded border">
              <span>Your base daily calories:</span>
              <span class="font-medium">${baseKcal} kcal</span>
            </div>
            <div class="flex justify-between items-center p-2 rounded border ${todaysTrainingBump > 0 ? 'surface-2' : 'surface-1'}">
              <span>Training fuel today:</span>
              <span class="font-medium">${todaysTrainingBump > 0 ? '+' : ''}${todaysTrainingBump} kcal</span>
            </div>
            ${todaysTrainingBump > 0 ? `
              <p class="text-xs text-muted px-2 italic">${TRAINING_EXPLANATIONS[trainingIntensity]}</p>
            ` : ''}
            <div class="flex justify-between items-center p-2 rounded border ${bankToday !== 0 ? 'surface-2' : 'surface-1'}">
              <span>Bank balance adjustment:</span>
              <span class="font-medium">${correction > 0 ? '+' : ''}${correction} kcal</span>
            </div>
            ${correction !== rawCorrection ? `
              <p class="text-xs text-muted px-2 italic">${correctionExplanation}</p>
            ` : ''}
            <div class="mt-2 pt-2 border-t border">
              <div class="text-xs text-muted space-y-1">
                <div>Raw bank correction: ${rawCorrection > 0 ? '+' : ''}${rawCorrection} kcal (bank ÷ ${bankingData.config.correctionDivisor})</div>
                <div>Safety cap: ±${Math.round(capPct * 100)}% of base (±${Math.round(capPct * baseKcal)} kcal max)</div>
                <div>Final calculation: ${baseKcal} + ${todaysTrainingBump} + ${correction} = <strong>${todayKcalTarget} kcal</strong></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <!-- Macro Breakdown -->
        <div class="md:col-span-3">
          <h4 class="font-semibold text-secondary mb-3">Your Macro Targets</h4>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="kpi">
              <div class="flex justify-between items-center mb-1">
                <span class="kpi-label">Protein</span>
                <span class="kpi-value">${proteinG}g</span>
              </div>
              <div class="kpi-delta ${remainingProtein >= 0 ? 'positive' : 'negative'}">Remaining: ${remainingProtein.toFixed(0)}g</div>
              <div class="text-xs text-muted">${proteinG * 4} kcal • ${trainingIntensity !== 'rest' && proteinG > BANKING_CONFIG.PROTEIN_G ? 'Training boost applied' : 'Standard target'}</div>
            </div>

            <div class="kpi">
              <div class="flex justify-between items-center mb-1">
                <span class="kpi-label">Fat (minimum)</span>
                <span class="kpi-value">${fatG}g</span>
              </div>
              <div class="kpi-delta ${remainingFat >= 0 ? 'positive' : 'negative'}">Remaining: ${remainingFat.toFixed(0)}g</div>
              <div class="text-xs text-muted">${fatG * 9} kcal • Essential for hormone production</div>
            </div>

            <div class="kpi">
              <div class="flex justify-between items-center mb-1">
                <span class="kpi-label">Carbs (flexible)</span>
                <span class="kpi-value">${carbsG}g</span>
              </div>
              <div class="kpi-delta ${remainingCarbs >= 0 ? 'positive' : 'negative'}">Remaining: ${remainingCarbs.toFixed(0)}g</div>
              <div class="text-xs text-muted">${carbsG * 4} kcal • Fills remaining calories</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render chart section
 */
function renderChartSection() {
  return `
    <div class="mb-8 card p-6 shadow-lg">
      <h3 class="text-2xl font-bold text-secondary mb-4">📊 Nutrition Progress Chart</h3>
      <div class="mb-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label for="chart-nutrients" class="block text-sm font-medium text-primary mb-1">Select Nutrients</label>
          <select id="chart-nutrients" multiple class="w-full p-2 border rounded-md shadow-sm focus:ring-accent-600 focus:border-accent-600" size="4"></select>
        </div>
        <div>
          <label for="chart-timeframe" class="block text-sm font-medium text-primary mb-1">Time Frame</label>
          <select id="chart-timeframe" class="w-full p-2 border rounded-md shadow-sm focus:ring-accent-600 focus:border-accent-600">
            <option value="3days">Last 3 Days</option>
            <option value="week">Last Week</option>
            <option value="month">Last Month</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-primary mb-1">Trend Lines</label>
          <div class="space-y-2 mt-2">
            <div class="flex items-center">
              <input type="checkbox" id="show-3day-avg" class="mr-2 h-4 w-4 text-accent border rounded focus:ring-accent-600">
              <label for="show-3day-avg" class="text-sm text-primary">3-day average</label>
            </div>
            <div class="flex items-center">
              <input type="checkbox" id="show-7day-avg" class="mr-2 h-4 w-4 text-accent border rounded focus:ring-accent-600">
              <label for="show-7day-avg" class="text-sm text-primary">7-day average</label>
            </div>
          </div>
        </div>
      </div>
      <div class="chart-container"><canvas id="nutrition-chart"></canvas></div>
      <div id="chart-table" class="mt-6"></div>
    </div>
  `;
}

/**
 * Render micronutrient sections with training day scaling
 */
function renderMicronutrientSections(metrics) {
  const renderNutrientCard = (nutrient, data) => {
    const { baseTarget, scaledTarget, todaysIntake, avgIntake, status, isDailyFloor, isAveraged, isScaled } = data;
    
    const statusColors = {
      green: 'fill good',
      amber: 'fill warn',
      red: 'fill bad'
    };
    
    const displayValue = isAveraged ? avgIntake : todaysIntake;
    const targetValue = isDailyFloor ? scaledTarget : baseTarget;
    const percentage = targetValue > 0 ? (displayValue / targetValue) * 100 : 0;
    
    return `
      <div class="card p-4 hover:shadow-lg transition-shadow">
        <div class="flex items-center justify-between mb-2">
          <h4 class="font-bold text-primary">${formatNutrientName(nutrient)}</h4>
          <div class="flex items-center gap-2">
            ${isScaled && DASHBOARD_CONFIG.SHOW_TRAINING_SCALING_BADGES ? '<span class="badge-good">Training+</span>' : ''}
            <div class="w-3 h-3 rounded-full ${statusColors[status]}"></div>
          </div>
        </div>

        <div class="space-y-1 text-sm">
          <div class="flex justify-between">
            <span>Today:</span>
            <span class="font-medium">${todaysIntake.toFixed(1)}</span>
          </div>
          ${isAveraged ? `
            <div class="flex justify-between">
              <span>7-day avg:</span>
              <span class="font-medium">${avgIntake.toFixed(1)}</span>
            </div>
          ` : ''}
          <div class="flex justify-between">
            <span>Target:</span>
            <span class="font-medium">${targetValue.toFixed(1)}${isScaled ? ` (${baseTarget.toFixed(1)})` : ''}</span>
          </div>
          ${isDailyFloor ? `
            <div class="flex justify-between text-xs">
              <span>Daily goal:</span>
              <span class="${todaysIntake >= scaledTarget ? 'text-positive' : 'text-negative'} font-medium">
                ${todaysIntake >= scaledTarget ? '✅ Met' : '❌ Short'}
              </span>
            </div>
          ` : ''}
        </div>
        
        ${DASHBOARD_CONFIG.SHOW_PERCENTAGE_PROGRESS ? `
          <div class="mt-3">
            <div class="w-full surface-3 rounded-full h-2">
              <div class="h-2 rounded-full ${statusColors[status]}" style="width: ${Math.min(100, percentage)}%"></div>
            </div>
            <p class="text-xs text-muted mt-1">${percentage.toFixed(0)}% of target</p>
          </div>
        ` : ''}
      </div>
    `;
  };
  
  const renderSection = (title, nutrientKeys, description) => {
    const cards = nutrientKeys
      .filter(nutrient => metrics[nutrient])
      .map(nutrient => renderNutrientCard(nutrient, metrics[nutrient]))
      .join('');
    
    if (!cards) return '';
    
    return `
      <div class="mb-8">
        <div class="mb-4">
          <h3 class="text-2xl font-bold text-secondary">${title}</h3>
          <p class="text-sm text-muted">${description}</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          ${cards}
        </div>
      </div>
    `;
  };
  
  return [
    renderSection(
      '💧 Daily Electrolytes & Essentials',
      nutrients.dailyFloors,
      'Scale with training intensity - must meet daily targets'
    ),
    renderSection(
      '🧪 Daily Vitamins', 
      nutrients.dailyVitamins,
      'Water-soluble - daily targets, some scale with intense training'
    ),
    renderSection(
      '🟡 Fat-Soluble Vitamins',
      nutrients.avgVitamins, 
      '7-day rolling average - stored in body fat, no training scaling'
    ),
    renderSection(
      '⚡ Stored Minerals',
      nutrients.avgMinerals,
      '7-day rolling average - stored in tissues, no training scaling'
    ),
    renderSection(
      '🔄 Optional Nutrients',
      nutrients.optional,
      '7-day rolling average targets'
    )
  ].join('');
}

// =========================
// SETTINGS FORM POPULATION
// =========================

/**
 * Populate settings form with proper defaults and banking configuration
 */
export function populateSettingsForm() {
  try {
    debugLog('populate-settings', 'Starting settings form population');
    
    // Handle banking/macro parameters with proper defaults
    const macroFields = [
      { id: 'target-calories', key: 'calories', default: BANKING_CONFIG.BASE_KCAL },
      { id: 'target-protein', key: 'protein', default: BANKING_CONFIG.PROTEIN_G },
      { id: 'target-fat', key: 'fat', default: BANKING_CONFIG.FAT_FLOOR_G }
    ];
    
    macroFields.forEach(({ id, key, default: defaultValue }) => {
      const input = document.getElementById(id);
      if (input) {
        input.value = state.baselineTargets[key] || defaultValue;
      }
    });
    
    // Handle fat minimum separately with proper precedence
    const fatMinInput = document.getElementById('target-fatMinimum');
    if (fatMinInput) {
      const userFatMin = state.baselineTargets.fatMinimum;
      const userFat = state.baselineTargets.fat;
      
      // Use fatMinimum if set, otherwise use fat value, otherwise default
      if (userFatMin !== undefined) {
        fatMinInput.value = userFatMin;
      } else if (userFat !== undefined) {
        fatMinInput.value = userFat;
      } else {
        fatMinInput.value = BANKING_CONFIG.FAT_FLOOR_G;
      }
    }
    
    // Handle banking configuration parameters
    const bankingFields = [
      { id: 'target-smallBankCap', key: 'smallBankCap', default: DEFAULT_TARGETS.smallBankCap },
      { id: 'target-mediumBankCap', key: 'mediumBankCap', default: DEFAULT_TARGETS.mediumBankCap },
      { id: 'target-largeBankCap', key: 'largeBankCap', default: DEFAULT_TARGETS.largeBankCap },
      { id: 'target-correctionDivisor', key: 'correctionDivisor', default: DEFAULT_TARGETS.correctionDivisor },
      { id: 'target-decayHalfLife', key: 'decayHalfLife', default: DEFAULT_TARGETS.decayHalfLife }
    ];
    
    bankingFields.forEach(({ id, key, default: defaultValue }) => {
      const input = document.getElementById(id);
      if (input) {
        input.value = state.baselineTargets[key] || defaultValue;
      }
    });
    
    // Handle all other micronutrients
    allNutrients.forEach(nutrient => {
      if (!['calories', 'protein', 'fat'].includes(nutrient)) {
        const input = document.getElementById(`target-${nutrient}`);
        if (input) {
          input.value = state.baselineTargets[nutrient] || DEFAULT_TARGETS[nutrient] || '';
        }
      }
    });

    debugLog('populate-settings-complete', 'Settings form populated successfully');
    
  } catch (error) {
    handleError('populate-settings', error, 'Failed to populate settings form');
  }
}