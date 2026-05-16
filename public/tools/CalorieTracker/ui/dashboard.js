/**
 * @file src/ui/dashboard.js
 * @description Dashboard with rolling 7-day balance calculations and micronutrient tracking
 */

import { state } from '../state/store.js';
import {
  allNutrients,
  nutrients,
  dailyTrackedNutrients,
  averagedNutrients,
  BANKING_CONFIG,
  BankingHelpers,
  DEFAULT_TARGETS,
  DAY_ACTIVITY_LEVELS,
} from '../constants.js';
import {
  ACTIVITY_TYPES,
  INTENSITY_LABELS,
  estimateSessionCalories,
  computeSessionTotals,
  hasMeaningfulSweatActivity,
  hasHeavyTraining,
} from '../exercise/met.js';
import { formatNutrientName } from '../utils/ui.js';
import { getPastDate, formatDate } from '../utils/time.js';
import { initializeChartControls } from './chart.js';
import { CONFIG } from '../config.js';
import { renderAnalysisSection, initAnalysisEvents } from '../analysis/analysisUI.js';

// =========================
// CONFIGURATION (Top of file for easy modification)
// =========================
const DASHBOARD_CONFIG = {
  // Debug settings
  ENABLE_BANKING_DEBUG: false,
  LOG_CALCULATION_STEPS: false,

  // UI behavior settings
  DEFAULT_COLLAPSED_DETAILS: true, // Start with bank details collapsed

  // Error handling
  SHOW_ERRORS_IN_UI: true, // Display errors in the dashboard
  FALLBACK_TO_DEFAULTS: true // Use default values if user settings are invalid
};

// =========================
// MICRONUTRIENT SCALING CONFIGURATION
// Only Na / K / Mg scale, and only for meaningful sweat/endurance sessions.
// Shown as optional suggestions, not hard requirements.
// =========================

// Legacy bump-level scaling (used when no sessions on the entry — e.g. old trainingBump days)
const LEGACY_ELECTROLYTE_SCALING = {
  sodium:    { light: 1.05, hard: 1.15, hiit: 1.25 },
  potassium: { light: 1.05, hard: 1.10, hiit: 1.20 },
  magnesium: { light: 1.05, hard: 1.10, hiit: 1.15 },
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
 * Resolve current weight in kg from state (for MET estimates and banking).
 * Falls back to 80 kg if no weight data is available.
 */
function resolveWeightKg() {
  const manual = parseFloat(state.userProfile?.manualWeightOverrideLb);
  if (!isNaN(manual) && manual > 0) return manual * 0.45359237;
  const smoothed = state.analysisResults?.summary?.currentWeight;
  if (smoothed && smoothed > 0) return smoothed * 0.45359237;
  return 80;
}

/**
 * Get the effective exercise calorie bump for a daily entry.
 *
 * Priority:
 *  1. exerciseSessions (with MET / wearable / manual estimate)
 *  2. dayActivityLevel bump (new entries without sessions)
 *  3. Legacy trainingBump (old stored data — preserved exactly)
 *
 * @param {object} entry    - Daily entry from state.dailyEntries.
 * @param {number} weightKg - Body weight for MET calculation.
 * @returns {number} Exercise calories for this day.
 */
function getEntryExerciseKcal(entry, weightKg) {
  const sessions = entry?.exerciseSessions;
  if (Array.isArray(sessions) && sessions.length > 0) {
    return computeSessionTotals(sessions, weightKg).totalKcal;
  }
  // No sessions — check dayActivityLevel (new entries)
  const level = entry?.dayActivityLevel;
  const legacyBump = parseFloat(entry?.trainingBump);
  // If a legacy trainingBump was stored, use it exactly (backward compat)
  if (!isNaN(legacyBump) && legacyBump > 0 && !level) {
    return legacyBump;
  }
  if (level && level !== 'rest' && level !== 'custom') {
    return (DAY_ACTIVITY_LEVELS[level]?.bump) || 0;
  }
  // For legacy entries that normalizeEntry migrated to dayActivityLevel,
  // trainingBump is the authoritative stored value; use it.
  return !isNaN(legacyBump) ? legacyBump : 0;
}

/**
 * Return electrolyte scaling factor (Na / K / Mg only) for a daily entry.
 * Uses sessions when present; falls back to legacy bump for old entries.
 *
 * Returns { factor, suggested, reason } where `suggested` = true means the
 * scale is an optional recommendation, not a hard requirement.
 *
 * @param {string} nutrient
 * @param {object} entry
 * @returns {{ factor: number, suggested: boolean, reason: string }}
 */
function getElectrolyteScale(nutrient, entry) {
  if (!['sodium', 'potassium', 'magnesium'].includes(nutrient)) {
    return { factor: 1, suggested: false, reason: '' };
  }

  const sessions = entry?.exerciseSessions;
  if (Array.isArray(sessions) && sessions.length > 0) {
    if (hasMeaningfulSweatActivity(sessions)) {
      const f = nutrient === 'sodium' ? 1.25 : 1.15;
      return { factor: f, suggested: true, reason: 'sweat activity detected' };
    }
    if (hasHeavyTraining(sessions)) {
      return { factor: 1.10, suggested: true, reason: 'heavy training' };
    }
    return { factor: 1, suggested: false, reason: '' };
  }

  // Legacy bump fallback
  const bump = parseFloat(entry?.trainingBump) || 0;
  let intensity = 'rest';
  if (bump >= 350) intensity = 'hiit';
  else if (bump >= 200) intensity = 'hard';
  else if (bump > 0)   intensity = 'light';
  if (intensity === 'rest') return { factor: 1, suggested: false, reason: '' };

  const scaling = LEGACY_ELECTROLYTE_SCALING[nutrient];
  const f = scaling?.[intensity] ?? 1;
  return { factor: f, suggested: true, reason: 'legacy training bump' };
}

// KPI bar helpers
const clampPct150 = (v, tgt) => Math.max(0, Math.min(150, (v / Math.max(1, tgt)) * 100));
const pctWidth = (v, tgt) => clampPct150(v, tgt) + "%";
const markerLeft = "66.6667%";
const markerPct = parseFloat(markerLeft); // numeric position of 100% marker
const remainClass = v => v > 0 ? 'text-positive' : v < 0 ? 'text-negative' : 'text-muted';
const pctClass = (v, tgt) => {
  const pct = clampPct150(v, tgt);
  return pct >= 100 ? 'good'
       : pct >= markerPct ? 'warn'
       : 'bad';
};

// =========================
// MAIN BANKING CALCULATION (Rolling 7-Day Balance)
// =========================

/**
 * Calculate rolling 7-day balance data.
 *
 * Each day's "target" = baseGoal + that day's trainingBump.
 * The 7-day window budget = sum of all 7 individual day targets.
 * Today's target = windowBudget − sumPast6Actual + todaysTrainingBump
 *               = (baseKcal × 7 + sumPastTrainingBumps + todaysTrainingBump) − sumPast6Actual
 *
 * Eating exactly your target on a training day is budget-neutral — the extra
 * training calories are accounted for in the window budget, not treated as
 * overages. If you hit today's target exactly, tomorrow's target (on a rest
 * day) will be exactly baseGoal.
 *
 * @param {string} targetDateStr - Target date in YYYY-MM-DD format
 * @returns {Object} Banking calculation results
 */
export function calculateBankingData(targetDateStr) {
  try {
    debugLog('calc-start', { targetDateStr, userId: state.userId });

    const targetDate = new Date(`${targetDateStr}T00:00:00`);
    const windowDays = BANKING_CONFIG.ROLLING_WINDOW_DAYS; // 7

    // Get base parameters with proper fallbacks
    const baseKcal = parseFloat(state.baselineTargets.calories) || BANKING_CONFIG.BASE_KCAL;
    const proteinG = parseFloat(state.baselineTargets.protein) || BANKING_CONFIG.PROTEIN_G;

    // Proper fat minimum handling with hierarchy
    let fatFloorG;
    if (state.baselineTargets.fatMinimum !== undefined && state.baselineTargets.fatMinimum !== null) {
      fatFloorG = parseFloat(state.baselineTargets.fatMinimum);
    } else if (state.baselineTargets.fat !== undefined && state.baselineTargets.fat !== null) {
      fatFloorG = parseFloat(state.baselineTargets.fat);
    } else {
      fatFloorG = BANKING_CONFIG.FAT_FLOOR_G;
    }

    const weightKg = resolveWeightKg();

    // Sum actual intake AND exercise bumps for the previous (windowDays - 1) days.
    const pastDays = [];
    let sumPast6Actual = 0;
    let sumPastTrainingBumps = 0;

    for (let i = 1; i < windowDays; i++) {
      const pastDate = getPastDate(targetDate, i);
      const pastDateStr = formatDate(pastDate);
      const entry = state.dailyEntries.get(pastDateStr) || {};

      const actualKcal  = parseFloat(entry.calories) || 0;
      const trainingBump = getEntryExerciseKcal(entry, weightKg);
      const dailyTarget  = baseKcal + trainingBump;
      const delta        = actualKcal - dailyTarget;

      pastDays.push({
        date: pastDate,
        dateStr: pastDateStr,
        actualKcal,
        trainingBump,
        dailyTarget,
        delta,
        dayName: pastDate.toLocaleDateString('en-US', { weekday: 'short' })
      });

      sumPast6Actual     += actualKcal;
      sumPastTrainingBumps += trainingBump;
    }

    // Today's entry exercise calories
    const todaysEntry = state.dailyEntries.get(targetDateStr) || {};
    const todaysTrainingBump = getEntryExerciseKcal(todaysEntry, weightKg);

    // The full 7-day window budget includes base calories for every day
    // PLUS training bumps for every day (past and today).
    const windowBudget = baseKcal * windowDays + sumPastTrainingBumps + todaysTrainingBump;

    // Rolling target = how much of the window budget remains for today.
    const rollingTarget = windowBudget - sumPast6Actual;

    // Bank balance = how much today's target differs from a plain rest-day goal.
    // Positive = you under-ate relative to targets = more room today.
    // Negative = you over-ate relative to targets = less room today.
    const bankBalance = rollingTarget - baseKcal - todaysTrainingBump;

    // Round to nearest 25 for display friendliness
    const todayKcalTarget = BankingHelpers.roundToNearest25(rollingTarget);

    // Protein floor does not scale with exercise; carbs absorb the extra calories.
    const scaledProteinG = proteinG;
    const proteinKcal = scaledProteinG * 4;
    const fatKcal = fatFloorG * 9;
    const remainingKcal = Math.max(0, todayKcalTarget - proteinKcal - fatKcal);
    const carbsG = Math.round(remainingKcal / 4);

    // Sum of all past day targets (for display in the table footer)
    const sumPastTargets = baseKcal * pastDays.length + sumPastTrainingBumps;

    debugLog('calculation-summary', {
      windowBudget,
      sumPast6Actual: Math.round(sumPast6Actual),
      sumPastTrainingBumps,
      todaysTrainingBump,
      rollingTarget: Math.round(rollingTarget),
      bankBalance: Math.round(bankBalance),
      todayKcalTarget
    });

    if (DASHBOARD_CONFIG.LOG_CALCULATION_STEPS && pastDays.length > 0) {
      console.table(pastDays.map(d => ({
        date: d.dateStr,
        actual: Math.round(d.actualKcal),
        training: d.trainingBump,
        target: d.dailyTarget,
        delta: Math.round(d.delta)
      })));
    }

    return {
      // Core rolling balance values
      bankBalance: Math.round(bankBalance),
      pastDays,
      sumPast6Actual: Math.round(sumPast6Actual),
      sumPastTargets: Math.round(sumPastTargets),
      windowBudget: Math.round(windowBudget),

      // Base parameters
      baseKcal,
      todaysTrainingBump,

      // Target results
      todayKcalTarget,
      proteinG: Math.round(scaledProteinG),
      fatG: Math.round(fatFloorG),
      carbsG,

      // Config
      config: {
        windowDays
      }
    };

  } catch (error) {
    handleError('calculate-banking', error, 'Failed to calculate banking data');

    return {
      bankBalance: 0,
      pastDays: [],
      sumPast6Actual: 0,
      sumPastTargets: 0,
      windowBudget: BANKING_CONFIG.BASE_KCAL * BANKING_CONFIG.ROLLING_WINDOW_DAYS,
      baseKcal: BANKING_CONFIG.BASE_KCAL,
      todaysTrainingBump: 0,
      todayKcalTarget: BANKING_CONFIG.BASE_KCAL,
      proteinG: BANKING_CONFIG.PROTEIN_G,
      fatG: BANKING_CONFIG.FAT_FLOOR_G,
      carbsG: 0,
      trainingIntensity: 'rest',
      config: { windowDays: BANKING_CONFIG.ROLLING_WINDOW_DAYS }
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

    const metrics = {};

    allNutrients.forEach(nutrient => {
      if (nutrients.macros.includes(nutrient)) return; // Skip macros

      const baseTarget = parseFloat(state.baselineTargets[nutrient]) || DEFAULT_TARGETS[nutrient] || 0;
      const { factor, suggested, reason } = getElectrolyteScale(nutrient, todayEntry);
      const scaledTarget = baseTarget * factor;
      const todaysIntake = dateStr === state.dom.dateInput.value
        ? state.dailyFoodItems.reduce((sum, item) => {
            const q = parseFloat(item.quantity ?? 0) || 0;
            const val = parseFloat(item[nutrient]) || 0;
            return sum + q * val;
          }, 0)
        : parseFloat(todayEntry[nutrient]) || 0;
      
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
          const intake = pastDateStr === dateStr
            ? todaysIntake
            : parseFloat(entry[nutrient]) || 0;
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
        isScaled: scaledTarget !== baseTarget,
        scaleSuggested: suggested,
        scaleReason: reason,
      };
    });
    
    return metrics;
    
  } catch (error) {
    handleError('calculate-micronutrients', error, 'Failed to calculate micronutrient metrics');
    return {};
  }
}

// =========================
// TAB MANAGEMENT
// =========================

const VALID_TABS = ['today', 'nutrients', 'energy', 'profile', 'settings'];

/**
 * Initialize tabs from URL hash or localStorage without triggering data renders.
 * Call this once after wire() but before data loads.
 */
export function initializeTabs() {
  try {
    const hash = location.hash.replace(/^#tab-/, '').replace(/^#/, '');
    const stored = localStorage.getItem('ct-active-tab');
    const initial = VALID_TABS.includes(hash) ? hash
                  : VALID_TABS.includes(stored) ? stored
                  : 'today';

    state.activeTab = initial;

    document.querySelectorAll('.tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === initial;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });

    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.id !== `tab-${initial}`);
    });

    const macroHeader = document.getElementById('today-macro-header');
    if (macroHeader) macroHeader.classList.toggle('hidden', initial !== 'today');

    debugLog('init-tabs', `Initial tab: ${initial}`);
  } catch (error) {
    handleError('init-tabs', error, 'Failed to initialize tabs');
  }
}

/**
 * Activate a tab, update URL hash, persist to localStorage, and render content.
 * @param {string} name - Tab name (today|nutrients|energy|profile|settings)
 */
export function activateTab(name) {
  try {
    if (!VALID_TABS.includes(name)) return;

    state.activeTab = name;
    localStorage.setItem('ct-active-tab', name);

    if (history.replaceState) {
      history.replaceState(null, '', `#tab-${name}`);
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === name;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });

    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.id !== `tab-${name}`);
    });

    const macroHeader = document.getElementById('today-macro-header');
    if (macroHeader) macroHeader.classList.toggle('hidden', name !== 'today');

    // Profile tab works without baseline targets — it's how first-time users set them
    if (state.userId && name === 'profile' && window.__populateProfileForm) {
      window.__populateProfileForm();
    }

    if (!state.userId || Object.keys(state.baselineTargets).length === 0) return;

    if (name === 'nutrients') renderNutrientsOutput();
    else if (name === 'energy') renderEnergyOutput();
    else if (name === 'settings') populateSettingsForm();

    debugLog('activate-tab', `Activated tab: ${name}`);
  } catch (error) {
    handleError('activate-tab', error, 'Failed to activate tab');
  }
}

// =========================
// TAB CONTENT RENDERERS
// =========================

/**
 * Render the compact 4-cell macro progress bar into #today-macro-header.
 */
function renderTodayMacroHeader(bankingData) {
  const el = document.getElementById('today-macro-header');
  if (!el) return;

  const { todayKcalTarget, proteinG, fatG, carbsG } = bankingData;

  const totals = state.dailyFoodItems.reduce((acc, item) => {
    const q = parseFloat(item.quantity ?? 0) || 0;
    acc.cal  += q * (parseFloat(item.calories) || 0);
    acc.pro  += q * (parseFloat(item.protein)  || 0);
    acc.fat  += q * (parseFloat(item.fat)      || 0);
    acc.carb += q * (parseFloat(item.carbs)    || 0);
    return acc;
  }, { cal: 0, pro: 0, fat: 0, carb: 0 });

  const cell = (label, actual, target) => {
    const pct = Math.max(0, Math.min(150, target > 0 ? (actual / target) * 100 : 0));
    const cls = pct >= 100 ? 'good' : pct >= 66 ? 'warn' : 'bad';
    return `
      <div class="macro-cell">
        <span class="macro-cell-label">${label}</span>
        <span class="macro-cell-value ${pct > 110 ? 'text-negative' : ''}">${Math.round(actual)}/${Math.round(target)}</span>
        <div class="hbar"><div class="hbar-fill ${cls}" style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
  };

  el.innerHTML =
    cell('Cal',     totals.cal,  todayKcalTarget) +
    cell('Protein', totals.pro,  proteinG)        +
    cell('Fat',     totals.fat,  fatG)            +
    cell('Carbs',   totals.carb, carbsG);
}

/**
 * Render chart + micronutrients into #nutrients-content.
 */
function renderNutrientsOutput() {
  const container = document.getElementById('nutrients-content');
  if (!container) return;

  if (!state.userId || Object.keys(state.baselineTargets).length === 0) {
    container.innerHTML = '<p class="text-muted text-center py-8">Log in and set targets to see nutrient data.</p>';
    return;
  }

  const dateStr = state.dom.dateInput?.value;
  if (!dateStr) return;

  const micronutrientMetrics = calculateMicronutrientMetrics(dateStr);
  container.innerHTML = renderChartSection() + renderMicronutrientSections(micronutrientMetrics);

  initializeChartControls();
}

/**
 * Render weight/energy analysis into #energy-content.
 */
function renderEnergyOutput() {
  const container = document.getElementById('energy-content');
  if (!container) return;

  if (!state.userId || Object.keys(state.baselineTargets).length === 0) {
    container.innerHTML = '<p class="text-muted text-center py-8">Log in and set targets to see energy analysis.</p>';
    return;
  }

  const dateStr = state.dom.dateInput?.value;
  let bankingHtml = '';
  if (dateStr) {
    const bankingData = calculateBankingData(dateStr);
    bankingHtml = renderInfoBox()
      + renderEnergyExerciseBlock(dateStr)
      + renderBankingPanel(bankingData)
      + renderCalcDetailsPanel(bankingData);
  }

  container.innerHTML = bankingHtml + renderAnalysisSection();
  setupCollapsibleHandlers();
  initAnalysisEvents();
}

/**
 * Render the calculation formula panel for Energy tab.
 */
function renderCalcDetailsPanel(bankingData) {
  const {
    baseKcal, todaysTrainingBump, bankBalance,
    sumPast6Actual, sumPastTargets, windowBudget, todayKcalTarget, trainingIntensity
  } = bankingData;

  return `
    <div class="section-card p-4 mb-6">
      <h3 class="text-responsive-xl font-bold text-secondary mb-3">🧮 How Today's Target Was Calculated</h3>
      <div class="grid grid-cols-1 gap-2 text-sm">
        <div class="flex justify-between items-center p-2 surface-1 rounded border">
          <span>7-day window budget:</span>
          <span class="font-medium">${windowBudget} kcal</span>
        </div>
        <div class="flex justify-between items-center p-2 surface-1 rounded border">
          <span>Past 6 days target:</span>
          <span class="font-medium">${sumPastTargets} kcal</span>
        </div>
        <div class="flex justify-between items-center p-2 surface-1 rounded border">
          <span>Past 6 days consumed:</span>
          <span class="font-medium">${sumPast6Actual} kcal</span>
        </div>
        ${todaysTrainingBump > 0 ? `
          <p class="text-xs text-muted px-2 italic">Exercise calories included in today's budget (+${todaysTrainingBump} kcal)</p>
        ` : ''}
        ${bankBalance !== 0 ? `
          <div class="flex justify-between items-center p-2 rounded border surface-2">
            <span>Rolling balance adjustment:</span>
            <span class="font-medium ${bankBalance > 0 ? 'text-positive' : 'text-negative'}">${bankBalance > 0 ? '+' : ''}${bankBalance} kcal</span>
          </div>
        ` : ''}
        <div class="mt-2 pt-2 border-t border text-xs text-muted space-y-1">
          <div>${windowBudget} − ${sumPast6Actual} = <strong>${todayKcalTarget} kcal today</strong></div>
          <div>Hit this target and tomorrow resets to ${baseKcal} kcal (rest day).</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render compact calorie + macro summary for the Today tab.
 */
function renderTodayCompact(bankingData) {
  const { todayKcalTarget, proteinG, fatG, carbsG } = bankingData;

  const totals = state.dailyFoodItems.reduce((acc, item) => {
    const q = parseFloat(item.quantity ?? 0) || 0;
    acc.calories += q * (parseFloat(item.calories) || 0);
    acc.protein  += q * (parseFloat(item.protein)  || 0);
    acc.fat      += q * (parseFloat(item.fat)      || 0);
    acc.carbs    += q * (parseFloat(item.carbs)    || 0);
    return acc;
  }, { calories: 0, protein: 0, fat: 0, carbs: 0 });

  const remaining = todayKcalTarget - totals.calories;
  const remainColor = remaining >= 0 ? 'text-positive' : 'text-negative';

  const macroRow = (label, actual, target) => {
    const rem = target - actual;
    return `
      <div class="kpi-row">
        <div class="meta">
          <span class="label">${label}</span>
          <span class="current">${Math.round(actual)}g</span>
          <span class="target">target ${Math.round(target)}g</span>
          <span class="remain ${remainClass(rem)}">
            ${rem > 0 ? `${Math.round(rem)}g left` : rem < 0 ? `${Math.abs(Math.round(rem))}g over` : '0g'}
          </span>
        </div>
        <div class="hbar">
          <div class="hbar-fill ${pctClass(actual, target)}" style="width:${pctWidth(actual, target)}"></div>
          <div class="hbar-marker" style="left:${markerLeft}"></div>
        </div>
      </div>`;
  };

  return `
    <div class="mb-4 p-4 surface-2 rounded-lg border text-center">
      <div class="text-xs text-muted uppercase tracking-wide mb-1">Calories Remaining</div>
      <div class="text-4xl font-bold ${remainColor}">${Math.round(remaining)}</div>
      <div class="text-xs text-muted mt-1">${Math.round(totals.calories)} eaten · ${todayKcalTarget} target</div>
      <div class="hbar mt-2">
        <div class="hbar-fill ${pctClass(totals.calories, todayKcalTarget)}" style="width:${pctWidth(totals.calories, todayKcalTarget)}"></div>
        <div class="hbar-marker" style="left:${markerLeft}"></div>
      </div>
    </div>
    <div class="divide-y">
      ${macroRow('Protein', totals.protein, proteinG)}
      ${macroRow('Fat (min)', totals.fat, fatG)}
      ${macroRow('Carbs', totals.carbs, carbsG)}
    </div>
  `;
}

// =========================
// EXERCISE IMPACT PANEL (Today tab output + Energy tab)
// =========================

/**
 * Render a compact exercise summary card for the Today dashboard output.
 * Shows sessions, calorie estimate, and method source.
 */
function renderExerciseSummaryCard(dateStr) {
  const entry    = state.dailyEntries.get(dateStr) || {};
  const sessions = Array.isArray(entry.exerciseSessions) ? entry.exerciseSessions : [];
  const weightKg = resolveWeightKg();

  if (sessions.length === 0) {
    // Show day activity level bump if set
    const level = entry.dayActivityLevel;
    const bump  = level ? (DAY_ACTIVITY_LEVELS[level]?.bump || 0) : (parseFloat(entry.trainingBump) || 0);
    if (bump <= 0) return ''; // nothing to show

    const levelLabel = level
      ? DAY_ACTIVITY_LEVELS[level]?.label
      : `Legacy bump (+${bump} kcal)`;
    return `
      <div class="mb-3 p-3 surface-2 rounded-lg border text-sm flex justify-between items-center">
        <span class="text-muted">Activity:</span>
        <span class="font-medium text-accent">${levelLabel} · +${bump} kcal</span>
      </div>`;
  }

  const { totalKcal, source } = computeSessionTotals(sessions, weightKg);
  const sourceLabel = source === 'manual' ? 'manual override' : source === 'wearable' ? 'wearable device' : 'MET estimate';

  const sessionLines = sessions.map(s => {
    const { kcal } = estimateSessionCalories(s, weightKg);
    const typeLabel = ACTIVITY_TYPES[s.activityType]?.label ?? s.activityType;
    const intLabel  = INTENSITY_LABELS[s.intensity] ?? s.intensity;
    return `<div class="text-xs text-muted">${typeLabel} · ${s.durationMin ?? '?'} min · ${intLabel} → ~${kcal} kcal</div>`;
  }).join('');

  return `
    <div class="mb-3 p-3 surface-2 rounded-lg border">
      <div class="flex justify-between items-center mb-1">
        <span class="text-sm font-medium text-secondary">🏋️ Exercise</span>
        <span class="text-sm font-bold text-accent">+${totalKcal} kcal <span class="text-xs text-muted font-normal">(${sourceLabel})</span></span>
      </div>
      ${sessionLines}
    </div>`;
}

/**
 * Render an exercise impact block for the Energy tab.
 */
function renderEnergyExerciseBlock(dateStr) {
  const entry    = state.dailyEntries.get(dateStr) || {};
  const sessions = Array.isArray(entry.exerciseSessions) ? entry.exerciseSessions : [];
  const weightKg = resolveWeightKg();

  if (sessions.length === 0) return '';

  const { totalKcal, source } = computeSessionTotals(sessions, weightKg);

  const rows = sessions.map(s => {
    const { kcal, source: src, met } = estimateSessionCalories(s, weightKg);
    const typeLabel = ACTIVITY_TYPES[s.activityType]?.label ?? s.activityType;
    const intLabel  = INTENSITY_LABELS[s.intensity] ?? s.intensity;
    const metNote   = src === 'met_estimate' && met != null
      ? `MET ${met} × ${weightKg.toFixed(1)} kg × ${((s.durationMin||0)/60).toFixed(2)} h`
      : src === 'wearable' ? 'from wearable device'
      : 'manual entry';
    return `
      <tr>
        <td class="px-3 py-2 text-sm">${typeLabel}</td>
        <td class="px-3 py-2 text-sm text-center">${s.durationMin ?? '?'} min</td>
        <td class="px-3 py-2 text-sm text-center">${intLabel}</td>
        <td class="px-3 py-2 text-sm text-center font-medium text-accent">~${kcal}</td>
        <td class="px-3 py-2 text-xs text-muted">${metNote}</td>
      </tr>`;
  }).join('');

  return `
    <div class="section-card p-4 mb-6">
      <h3 class="text-responsive-xl font-bold text-secondary mb-3">🏋️ Exercise Sessions — Calorie Impact</h3>
      <div class="overflow-x-auto">
        <table class="w-full border rounded-lg text-sm">
          <thead class="surface-2">
            <tr>
              <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Activity</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Duration</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Intensity</th>
              <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Est. kcal</th>
              <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Method</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot class="surface-2 border-t-2 border">
            <tr>
              <td colspan="3" class="px-3 py-2 text-sm font-medium">Total</td>
              <td class="px-3 py-2 text-center font-bold text-accent">~${totalKcal}</td>
              <td class="px-3 py-2 text-xs text-muted">kcal added to today's budget</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="text-xs text-muted mt-2">
        MET estimates from the 2024 Compendium of Physical Activities. Add wearable or manual calorie values in the session form to override estimates.
      </p>
    </div>`;
}

// =========================
// MAIN DASHBOARD UPDATE
// =========================

/**
 * Main dashboard update function.
 * Always re-renders the Today tab output (#dashboard + macro header).
 * Also re-renders the currently active secondary tab.
 */
export function updateDashboard() {
  try {
    debugLog('update-start', 'Starting dashboard update');

    const { dashboard } = state.dom;
    if (!dashboard) throw new Error('Dashboard container not found');

    const errorContainer = document.getElementById('dashboard-errors');
    if (errorContainer) errorContainer.innerHTML = '';

    if (!state.userId || Object.keys(state.baselineTargets).length === 0) {
      dashboard.innerHTML = `
        <div id="dashboard-errors"></div>
        <div class="text-center p-8 surface-1 rounded-lg shadow-md">
          <h3 class="text-responsive-xl font-semibold text-secondary">Welcome to Adaptive Nutrition Tracker!</h3>
          <p class="mt-2 text-muted">Please log in and set your baseline targets to get started.</p>
          <button onclick="document.getElementById('open-settings-btn').click()"
            class="mt-4 px-6 py-2 btn btn-primary">Set Targets</button>
        </div>`;
      return;
    }

    const dateStr = state.dom.dateInput.value;
    const bankingData = calculateBankingData(dateStr);

    dashboard.innerHTML = `
      <div id="dashboard-errors"></div>
      ${renderExerciseSummaryCard(dateStr)}
      ${renderTodayCompact(bankingData)}
    `;

    renderTodayMacroHeader(bankingData);

    // Re-render the active secondary tab so it stays fresh
    const activeTab = state.activeTab || 'today';
    if (activeTab === 'nutrients') renderNutrientsOutput();
    else if (activeTab === 'energy') renderEnergyOutput();

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
      'Show Past 6 Days',
      'Hide Past 6 Days'
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
        <p><strong>Rolling 7-Day Balance:</strong> Your calorie budget is tracked over a 7-day window. Under-eat one day? You get extra the next. Over-eat? Tomorrow's target drops.</p>
        <p><strong>Auto-Correct:</strong> Today's target is set so that hitting it exactly makes tomorrow's target your base goal. The system trues up naturally.</p>
        <p><strong>Training Days:</strong> Select your workout type above — this adds calories and scales electrolytes appropriately.</p>
      </div>
    </div>
  `;
}

/**
 * Render banking panel showing rolling 7-day balance
 */
function renderBankingPanel(bankingData) {
  const { bankBalance, pastDays, sumPast6Actual, sumPastTargets, windowBudget, baseKcal } = bankingData;

  const contributionRows = pastDays.map(d => `
    <tr>
      <td class="px-3 py-2 text-sm font-medium">${d.dayName}${d.trainingBump > 0 ? ' <span class="text-xs text-accent">+' + d.trainingBump + '</span>' : ''}</td>
      <td class="px-3 py-2 text-sm text-center">${Math.round(d.actualKcal)}</td>
      <td class="px-3 py-2 text-sm text-center text-muted">${Math.round(d.dailyTarget)}</td>
      <td class="px-3 py-2 text-sm text-center font-medium ${d.delta > 0 ? 'text-negative' : d.delta < 0 ? 'text-positive' : 'text-muted'}">
        ${d.delta > 0 ? '+' : ''}${Math.round(d.delta)}
      </td>
    </tr>
  `).join('');

  const bankExplanation = bankBalance > 0
    ? `You have ${bankBalance} kcal banked from under-eating — today's target is higher to use it.`
    : bankBalance < 0
    ? `You're ${Math.abs(bankBalance)} kcal over budget — today's target is lower to balance it out.`
    : "You're perfectly on track — no adjustment needed!";

  return `
    <div class="section-card p-4">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-responsive-xl font-bold text-secondary">🏦 Rolling 7-Day Balance</h3>
        <button id="recent-days-toggle" class="btn-subtle">
            <i class="fas fa-chevron-down"></i>
            <span class="toggle-text">Show Past 6 Days</span>
        </button>
      </div>

      <div class="p-3 rounded-lg border surface-2">
        <div class="text-center">
          <div class="text-responsive-2xl font-bold ${bankBalance > 0 ? 'text-positive' : bankBalance < 0 ? 'text-negative' : 'text-muted'}">
            ${bankBalance > 0 ? '+' : ''}${bankBalance} kcal
          </div>
          <p class="text-sm text-muted mt-1">${bankExplanation}</p>
        </div>
      </div>

      <div id="recent-days-content" class="hidden">
        <div class="overflow-x-auto">
          <table class="w-full border rounded-lg">
            <thead class="surface-2">
              <tr>
                <th class="px-3 py-2 text-left text-xs font-medium text-secondary uppercase">Day</th>
                <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Actual</th>
                <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Goal</th>
                <th class="px-3 py-2 text-center text-xs font-medium text-secondary uppercase">Over/Under</th>
              </tr>
            </thead>
            <tbody>
              ${contributionRows}
              <tr class="surface-2 border-t-2 border">
                <td class="px-3 py-2 text-sm font-medium">Total (6 days)</td>
                <td class="px-3 py-2 text-sm text-center font-bold">${sumPast6Actual}</td>
                <td class="px-3 py-2 text-sm text-center font-bold">${sumPastTargets}</td>
                <td class="px-3 py-2 text-sm text-center font-bold ${bankBalance > 0 ? 'text-positive' : bankBalance < 0 ? 'text-negative' : 'text-muted'}">
                  ${bankBalance > 0 ? '+' : ''}${bankBalance}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-3 p-3 surface-2 rounded-lg text-xs text-muted space-y-1">
          <p><strong>How it works:</strong> Your 7-day calorie budget is ${windowBudget} kcal (${baseKcal}/day × 7 + training bumps).</p>
          <p>You've consumed ${sumPast6Actual} kcal over the last 6 days against a target of ${sumPastTargets} kcal.</p>
          <p>If you hit today's target, tomorrow's target resets to exactly ${baseKcal} kcal (on a rest day).</p>
        </div>
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
    bankBalance,
    sumPast6Actual,
    sumPastTargets,
    windowBudget,
    todayKcalTarget,
    proteinG,
    fatG,
    carbsG,
    trainingIntensity
  } = bankingData;

  // Derive today's actuals from state with quantity awareness
  const todaysTotals = state.dailyFoodItems.reduce((acc, item) => {
    const q = parseFloat(item.quantity ?? 0) || 0;
    const cals = parseFloat(item.calories) || 0;
    const p = parseFloat(item.protein) || 0;
    const f = parseFloat(item.fat) || 0;
    const c = parseFloat(item.carbs) || 0;
    acc.calories += q * cals;
    acc.protein += q * p;
    acc.fat += q * f;
    acc.carbs += q * c;
    return acc;
  }, { calories: 0, protein: 0, fat: 0, carbs: 0 });

  const todaysCalories = todaysTotals.calories;
  const todaysProtein = todaysTotals.protein;
  const todaysFat = todaysTotals.fat;
  const todaysCarbs = todaysTotals.carbs;

  const remainingCalories = todayKcalTarget - todaysCalories;

  const remainingCaloriesColor = remainingCalories >= 0 ? 'text-muted' : 'text-negative';

  const renderMacroRow = (label, current, target) => {
    const remaining = target - current;
    return `
      <div class="kpi-row">
        <div class="meta">
          <span class="label">${label}</span>
          <span class="current">${Math.round(current)}g</span>
          <span class="target">target ${Math.round(target)}g</span>
          <span class="remain ${remainClass(remaining)}">
            ${remaining > 0 ? `${Math.round(remaining)}g left` : remaining < 0 ? `${Math.abs(Math.round(remaining))}g over` : '0g left'}
          </span>
        </div>
        <div class="hbar">
          <div class="hbar-fill ${pctClass(current, target)}" style="width:${pctWidth(current, target)}"></div>
          <div class="hbar-marker" style="left:${markerLeft}"></div>
        </div>
      </div>
    `;
  };

  const macroRows = [
    renderMacroRow('Protein', todaysProtein, proteinG),
    renderMacroRow('Fat (minimum)', todaysFat, fatG),
    renderMacroRow('Carbs (flexible)', todaysCarbs, carbsG)
  ].join('');

  return `
    <div class="mb-6 card p-6 shadow-lg">
      <h3 class="text-responsive-xl font-bold text-secondary mb-4">🍽️ Today's Nutrition Plan</h3>

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
        <button id="bank-details-toggle" class="mt-3 btn-subtle">
          <i class="fas fa-chevron-down"></i>
          <span class="toggle-text">Show How We Calculated This</span>
        </button>

        <!-- Collapsible Calculation Details -->
        <div id="bank-details-content" class="${DASHBOARD_CONFIG.DEFAULT_COLLAPSED_DETAILS ? 'hidden' : ''} mt-4 space-y-2 text-sm">
          <div class="grid grid-cols-1 gap-2">
            <div class="flex justify-between items-center p-2 surface-1 rounded border">
              <span>7-day window budget:</span>
              <span class="font-medium">${windowBudget} kcal</span>
            </div>
            <div class="flex justify-between items-center p-2 surface-1 rounded border">
              <span>Past 6 days target:</span>
              <span class="font-medium">${sumPastTargets} kcal (base + training)</span>
            </div>
            <div class="flex justify-between items-center p-2 surface-1 rounded border">
              <span>Past 6 days consumed:</span>
              <span class="font-medium">${sumPast6Actual} kcal</span>
            </div>
            <div class="flex justify-between items-center p-2 surface-1 rounded border">
              <span>Remaining for today:</span>
              <span class="font-medium">${windowBudget - sumPast6Actual} kcal</span>
            </div>
            ${todaysTrainingBump > 0 ? `
              <p class="text-xs text-muted px-2 italic">Exercise calories included in today's budget (+${todaysTrainingBump} kcal)</p>
            ` : ''}
            ${bankBalance !== 0 ? `
              <div class="flex justify-between items-center p-2 rounded border surface-2">
                <span>Rolling balance adjustment:</span>
                <span class="font-medium ${bankBalance > 0 ? 'text-positive' : 'text-negative'}">${bankBalance > 0 ? '+' : ''}${bankBalance} kcal</span>
              </div>
            ` : ''}
            <div class="mt-2 pt-2 border-t border">
              <div class="text-xs text-muted space-y-1">
                <div>Final target: ${windowBudget} − ${sumPast6Actual} = <strong>${todayKcalTarget} kcal</strong></div>
                <div>If you eat exactly this, tomorrow's target will be ${baseKcal} kcal (on a rest day).</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <!-- Macro Breakdown -->
        <div class="md:col-span-3">
          <h4 class="font-semibold text-secondary mb-3">Your Macro Targets</h4>
          <div class="divide-y">
            ${macroRows}
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
      <h3 class="text-responsive-2xl font-bold text-secondary mb-4">📊 Nutrition Progress Chart</h3>
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
  const renderNutrientRow = (nutrient, data) => {
    const { baseTarget, scaledTarget, todaysIntake, avgIntake, isDailyFloor, isAveraged, scaleSuggested, scaleReason } = data;

    const displayValue = isAveraged ? avgIntake : todaysIntake;
    const targetValue  = isDailyFloor ? scaledTarget : baseTarget;
    const remaining    = targetValue - displayValue;

    const suggestedNote = scaleSuggested && scaledTarget !== baseTarget
      ? `<span class="text-xs text-muted ml-1" title="Optional suggestion (${scaleReason})">(+${Math.round((scaledTarget - baseTarget))} suggested)</span>`
      : '';

    return `
      <div class="kpi-row">
        <div class="meta">
          <span class="label">${formatNutrientName(nutrient)}${suggestedNote}</span>
          <span class="current">${displayValue.toFixed(1)}</span>
          <span class="target">target ${targetValue.toFixed(1)}</span>
          <span class="remain ${remainClass(remaining)}">${remaining > 0 ? `${remaining.toFixed(1)} left` : remaining < 0 ? `${Math.abs(remaining).toFixed(1)} over` : '0 left'}</span>
        </div>
        <div class="hbar">
          <div class="hbar-fill ${pctClass(displayValue, targetValue)}" style="width:${pctWidth(displayValue, targetValue)}"></div>
          <div class="hbar-marker" style="left:${markerLeft}"></div>
        </div>
      </div>
    `;
  };

  const renderSection = (title, nutrientKeys, description) => {
    const rows = nutrientKeys
      .filter(nutrient => metrics[nutrient])
      .map(nutrient => renderNutrientRow(nutrient, metrics[nutrient]))
      .join('');

    if (!rows) return '';

    return `
      <div class="mb-8">
        <div class="mb-4">
          <h3 class="text-responsive-2xl font-bold text-secondary">${title}</h3>
          <p class="text-sm text-muted">${description}</p>
        </div>
        <div class="divide-y">
          ${rows}
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
