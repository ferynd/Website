/**
 * @file src/ui/dashboard.js
 * @description Dashboard with rolling 7-day balance calculations and micronutrient tracking
 */

import { state, parseQty } from '../state/store.js';
import {
  allNutrients,
  nutrients,
  dailyTrackedNutrients,
  averagedNutrients,
  BANKING_CONFIG,
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
  getEntryExerciseKcal,
} from '../exercise/met.js';
import { computeTrendDirection, classifyTargetSource, resolveWeightKg } from './nutrientHelpers.js';
import { formatNutrientName } from '../utils/ui.js';
import { getPastDate, formatDate } from '../utils/time.js';
import { initializeChartControls } from './chart.js';
import { CONFIG } from '../config.js';
import { renderAnalysisSection, initAnalysisEvents } from '../analysis/analysisUI.js';
import { UL_TABLE } from '../targets/nutritionReferences.js';
import { resolveDailyBaseTargets, resolveDailyPlanningTargets } from '../targets/dailyTargetResolver.js';
import { runAnalysis } from '../analysis/engine.js';
import { computeBMR, resolveCurrentWeightLb, latestWeightLbFromEntries, computeMicronutrientTargets } from '../targets/targetEngine.js';
import { calcBankingCore, hasTrustedCalories, prepareBankingInputs } from './bankingEngine.js';
import { getTodayInTimezone } from '../utils/time.js';

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

// Module-level filter state for the Nutrients tab (persists across re-renders)
let _nutrientFilter = 'all';

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
    const targetMode = state.goalSettings?.targetMode ?? 'manual';

    // Resolve today's full planning targets ONCE via the rich planning resolver —
    // supplies baseCalories, exerciseAddMode, displayBaseTargets, and full TDEE metadata.
    const todayResolvedFull   = resolveDailyPlanningTargets(targetDateStr, state);
    const todayBaseCalories   = todayResolvedFull.baseCalories || baseKcal;
    const exerciseAddMode     = todayResolvedFull.exerciseAddMode ?? 'add';
    const resolvedTargetSource = todayResolvedFull.mode;
    const displayBaseTargets  = todayResolvedFull.targets || {};

    // Gather past-day data via the pure preparation function.
    const {
      sumPast6Actual, sumPastBaseTargets, sumPastTrainingBumps,
      unknownDays, pastDays, bankIncomplete,
    } = prepareBankingInputs(targetDateStr, state.dailyEntries, {
      baseKcal,
      windowDays,
      getTrainingBump: (entry) => exerciseAddMode === 'skip' ? 0 : getEntryExerciseKcal(entry, weightKg),
      getDayTarget: targetMode !== 'autoGoal' ? null : (dateStr) => {
        const resolved = resolveDailyBaseTargets(dateStr, state);
        return parseFloat(resolved.targets?.calories) || baseKcal;
      },
    });

    // Today's exercise bump (raw = actual logged kcal; effective = 0 when skip mode)
    const todaysEntry            = state.dailyEntries.get(targetDateStr) || {};
    const todaysTrainingBumpRaw  = getEntryExerciseKcal(todaysEntry, weightKg);
    const todaysTrainingBump     = exerciseAddMode === 'skip' ? 0 : todaysTrainingBumpRaw;

    // The full 7-day window budget (for display and manual-mode calc).
    const windowBudget = sumPastBaseTargets + todayBaseCalories + sumPastTrainingBumps + todaysTrainingBump;

    // Sum of all past day targets (for display in the table footer)
    const sumPastTargets = sumPastBaseTargets + sumPastTrainingBumps;

    // ── Effective calorie floor (BMR-based or 1000 kcal minimum) ─────────────
    const MIN_DAILY_CALORIES = BANKING_CONFIG.MIN_DAILY_CALORIES ?? 1000;
    let effectiveFloor = MIN_DAILY_CALORIES;
    let floorSource = 'min_daily';
    const _rawWtLb = latestWeightLbFromEntries(state.weightEntries);
    const { weightLb: _wLb } = resolveCurrentWeightLb(state.userProfile ?? {}, state.analysisResults ?? null, _rawWtLb);
    if (_wLb) {
      const _bmrFloorValue = Math.max(MIN_DAILY_CALORIES, Math.round(computeBMR(state.userProfile ?? {}, _wLb).bmr * 0.85));
      if (_bmrFloorValue > MIN_DAILY_CALORIES) { effectiveFloor = _bmrFloorValue; floorSource = 'bmr_floor'; }
    }

    // ── Mode-specific target resolution (via pure calcBankingCore) ────────────
    const coreResult = calcBankingCore({
      todayBaseCalories,
      todaysTrainingBump,
      sumPastBaseTargets,
      sumPastTrainingBumps,
      sumPast6Actual,
      windowBudget,
      targetMode,
      useRollingBanking: state.goalSettings?.useRollingBanking ?? true,
      goalTargetDate: state.goalSettings?.targetDate ?? null,
      targetDateStr,
      effectiveFloor,
    });
    const {
      bankMode, bankBalance, bankAdjustmentApplied, scheduleAdjustment,
      rawBankBalance, todayKcalTarget, targetFloorApplied, scheduleCapped,
      manualBankCapped,
    } = coreResult;

    // Macro split using today's final target.
    const scaledProteinG = proteinG;
    const proteinKcal    = scaledProteinG * 4;
    const fatKcal        = fatFloorG * 9;
    const remainingKcal  = Math.max(0, todayKcalTarget - proteinKcal - fatKcal);
    const carbsG         = Math.round(remainingKcal / 4);

    // displayBaseTargets and resolvedTargetSource already computed from todayResolvedFull above.
    // For manual mode, fall back to state.baselineTargets (todayResolvedFull.targets = same).
    const effectiveDisplayTargets = targetMode === 'autoGoal' ? displayBaseTargets : state.baselineTargets;
    const displayProteinG = Math.round(parseFloat(effectiveDisplayTargets.protein) || scaledProteinG);
    const displayFatG     = Math.round(parseFloat(effectiveDisplayTargets.fatMinimum ?? effectiveDisplayTargets.fat) || fatFloorG);
    const displayCarbsG   = (() => {
      const fromTargets = parseFloat(effectiveDisplayTargets.carbs);
      if (fromTargets > 0) return Math.round(fromTargets);
      const calBudget = parseFloat(effectiveDisplayTargets.calories) || baseKcal;
      return Math.round(Math.max(0, (calBudget - displayProteinG * 4 - displayFatG * 9) / 4));
    })();

    debugLog('calculation-summary', {
      targetMode, bankMode,
      rawBankBalance, scheduleAdjustment, bankBalance,
      todayBaseCalories, todaysTrainingBump,
      todayKcalTarget, targetFloorApplied, scheduleCapped,
      sumPast6Actual: Math.round(sumPast6Actual),
      bankIncomplete, unknownDays,
    });

    if (DASHBOARD_CONFIG.LOG_CALCULATION_STEPS && pastDays.length > 0) {
      console.table(pastDays.map(d => ({
        date: d.dateStr,
        actual: Math.round(d.actualKcal),
        training: d.trainingBump,
        target: d.dailyTarget,
        delta: Math.round(d.delta),
        unknown: d.unknown,
      })));
    }

    return {
      // Core balance values
      bankBalance: Math.round(bankBalance),
      pastDays,
      sumPast6Actual: Math.round(sumPast6Actual),
      sumPastTargets: Math.round(sumPastTargets),
      windowBudget: Math.round(windowBudget),

      // Base parameters
      baseKcal,
      todaysTrainingBump,
      todaysTrainingBumpRaw,  // actual logged exercise (may differ from bump when skip mode)

      // Target results
      todayKcalTarget,
      proteinG: Math.round(scaledProteinG),
      fatG: Math.round(fatFloorG),
      carbsG,

      // Stable display macros (not reduced by bank/schedule)
      displayProteinG,
      displayFatG,
      displayCarbsG,

      // Base macros (from todayBaseCalories, before exercise/bank/floor)
      baseProteinG: displayProteinG,
      baseFatG: displayFatG,
      baseCarbsG: displayCarbsG,

      // Final macros (from todayKcalTarget — carbs absorbs all adjustments)
      finalProteinG: displayProteinG,
      finalFatG: displayFatG,
      finalCarbsG: carbsG,

      // Macro feasibility: protein+fat floors exceed calorie target → carbs forced to 0
      macroFloorExceedsCalories: (displayProteinG * 4 + displayFatG * 9) > todayKcalTarget,
      macroFloorCalories: displayProteinG * 4 + displayFatG * 9,

      // Today's resolved base calorie target
      todayBaseCalories,
      resolvedTargetSource,

      // Bank completeness
      bankIncomplete,
      unknownDays,

      // Mode / adjustment metadata
      targetMode,
      bankMode,            // 'manualRolling' | 'autoGoalSchedule' | 'off'
      bankAdjustmentApplied,
      manualBankCapped,    // true when manual bank adj was capped by MANUAL_BANK_CAP_DOWN/UP
      rawBankBalance,      // cumulative 6-day credit/debt (informational in autoGoal mode)
      scheduleAdjustment,  // auto goal only: spread overage/credit over remaining days
      targetFloorApplied,  // true when effectiveFloor was applied
      minDailyCalories: MIN_DAILY_CALORIES,
      effectiveFloor,      // actual floor used (BMR-based or MIN_DAILY_CALORIES)
      floorSource,         // 'bmr_floor' | 'min_daily'
      scheduleCapped,      // true if soft cap was exceeded on debt correction
      exerciseAddMode,     // 'add' | 'skip' — 'skip' when TDEE includes historical activity
      // TDEE provenance (autoGoal only) — from resolveDailyPlanningTargets:
      tdeeSource:      todayResolvedFull.planningTdeeSource      ?? null,
      tdeeSourceLabel: todayResolvedFull.planningTdeeSourceLabel ?? null,
      planningTdee:    todayResolvedFull.planningTdee            ?? null,

      // Aliases for structured consumers (Today/Energy/Nutrients)
      finalCalories:    todayKcalTarget,
      exerciseCalories: todaysTrainingBump,

      // Structured adjustment object
      adjustment: {
        type:               bankMode,
        rawBankBalance,
        appliedAdjustment:  bankAdjustmentApplied,
        capped:             scheduleCapped || manualBankCapped,
        capReason:          scheduleCapped ? 'schedule_cap' : manualBankCapped ? 'manual_cap' : null,
        overageSpreadPerDay: scheduleAdjustment,
      },

      // Structured floor object
      floor: {
        minDailyCalories: MIN_DAILY_CALORIES,
        effectiveFloor,
        source:  floorSource,
        applied: targetFloorApplied,
        reason:  floorSource === 'bmr_floor'
          ? `85% of BMR floor (${effectiveFloor} kcal)`
          : `Minimum daily floor (${MIN_DAILY_CALORIES} kcal)`,
      },

      // Explanation: ordered list of what shaped today's target
      explanation: (() => {
        const parts = [`Base: ${todayBaseCalories} kcal (${resolvedTargetSource === 'autoGoal' ? 'Auto Goal' : 'Manual Baseline'})`];
        if (exerciseAddMode === 'skip' && todaysTrainingBumpRaw > 0) {
          parts.push(`Exercise (${todaysTrainingBumpRaw} kcal): reflected in TDEE — not added separately`);
        } else if (todaysTrainingBump > 0) {
          parts.push(`Exercise: +${todaysTrainingBump} kcal`);
        }
        if (scheduleAdjustment > 0) {
          parts.push(`Schedule credit spread forward: +${scheduleAdjustment} kcal/day`);
        } else if (scheduleAdjustment < 0) {
          parts.push(`Schedule overage spread: ${scheduleAdjustment} kcal/day`);
        }
        if (bankAdjustmentApplied !== 0 && bankMode === 'manualRolling') {
          parts.push(`Rolling bank: ${bankAdjustmentApplied > 0 ? '+' : ''}${bankAdjustmentApplied} kcal`);
        }
        if (targetFloorApplied) {
          parts.push(`Floor applied: ${effectiveFloor} kcal (${floorSource === 'bmr_floor' ? '85% BMR' : 'minimum'})`);
        }
        parts.push(`Final: ${todayKcalTarget} kcal`);
        return parts;
      })(),

      // Config
      config: { windowDays }
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
      displayProteinG: BANKING_CONFIG.PROTEIN_G,
      displayFatG: BANKING_CONFIG.FAT_FLOOR_G,
      displayCarbsG: 0,
      baseProteinG: BANKING_CONFIG.PROTEIN_G,
      baseFatG: BANKING_CONFIG.FAT_FLOOR_G,
      baseCarbsG: 0,
      finalProteinG: BANKING_CONFIG.PROTEIN_G,
      finalFatG: BANKING_CONFIG.FAT_FLOOR_G,
      finalCarbsG: 0,
      macroFloorExceedsCalories: false,
      macroFloorCalories: BANKING_CONFIG.PROTEIN_G * 4 + BANKING_CONFIG.FAT_FLOOR_G * 9,
      todayBaseCalories: BANKING_CONFIG.BASE_KCAL,
      resolvedTargetSource: 'manual',
      bankIncomplete: false,
      unknownDays: [],
      targetMode: 'manual',
      bankMode: 'manualRolling',
      bankAdjustmentApplied: 0,
      rawBankBalance: 0,
      scheduleAdjustment: 0,
      targetFloorApplied: false,
      minDailyCalories: BANKING_CONFIG.MIN_DAILY_CALORIES ?? 1000,
      effectiveFloor: BANKING_CONFIG.MIN_DAILY_CALORIES ?? 1000,
      floorSource: 'min_daily',
      scheduleCapped: false,
      config: { windowDays: BANKING_CONFIG.ROLLING_WINDOW_DAYS }
    };
  }
}

// =========================
// MICRONUTRIENT CALCULATIONS
// =========================

/**
 * Calculate micronutrients with training day scaling, trend direction, and UL checks.
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @returns {Object} Micronutrient metrics
 */
export function calculateMicronutrientMetrics(dateStr) {
  try {
    const targetDate = new Date(`${dateStr}T00:00:00`);
    const todayEntry = state.dailyEntries.get(dateStr) || {};

    // In autoGoal mode resolve targets once so Nutrients tab matches Today/Charts.
    const targetMode = state.goalSettings?.targetMode ?? 'manual';
    const effectiveTargets = targetMode === 'autoGoal'
      ? (resolveDailyBaseTargets(dateStr, state).targets ?? state.baselineTargets)
      : state.baselineTargets;

    // Profile-specific DRI targets (age/sex adjusted) for accurate source classification.
    // These differ from DEFAULT_TARGETS for age groups outside the generic reference range.
    const { microTargets: profileDriTargets } = computeMicronutrientTargets(state.userProfile ?? {});

    const metrics = {};

    allNutrients.forEach(nutrient => {
      if (nutrients.macros.includes(nutrient)) return; // Skip macros

      const baseTarget = parseFloat(effectiveTargets[nutrient]) || DEFAULT_TARGETS[nutrient] || 0;
      const { factor, suggested, reason } = getElectrolyteScale(nutrient, todayEntry);
      const scaledTarget = baseTarget * factor;
      const todaysIntake = dateStr === state.dom.dateInput.value
        ? state.dailyFoodItems.reduce((sum, item) => {
            const q = parseQty(item.quantity);
            const val = parseFloat(item[nutrient]) || 0;
            return sum + q * val;
          }, 0)
        : parseFloat(todayEntry[nutrient]) || 0;

      let avgIntake = todaysIntake;
      let threeDayAvg = 0;
      let status = 'red';

      let trendDirection = 'stable';

      if (averagedNutrients.includes(nutrient)) {
        // Accumulate 7-day window with separate buckets for recent (0-2) and prior (3-6)
        let sum7 = 0, count7 = 0, sum3 = 0, count3 = 0;
        let sumPrior = 0, nonZeroPriorCount = 0;
        for (let i = 0; i < 7; i++) {
          const pd = getPastDate(targetDate, i);
          const pds = formatDate(pd);
          const entry = state.dailyEntries.get(pds) || {};
          const intake = pds === dateStr ? todaysIntake : parseFloat(entry[nutrient]) || 0;
          sum7 += intake; count7++;
          if (i < 3) { sum3 += intake; count3++; }
          else if (intake > 0) { sumPrior += intake; nonZeroPriorCount++; }
        }
        avgIntake = count7 > 0 ? sum7 / count7 : 0;
        threeDayAvg = count3 > 0 ? sum3 / count3 : 0;

        if (avgIntake >= baseTarget * 0.9) status = 'green';
        else if (avgIntake >= baseTarget * 0.7) status = 'amber';
        else status = 'red';

        // Trend: compare recent 3-day avg vs non-overlapping prior window (days 3-6)
        const priorAvg = nonZeroPriorCount >= 2 ? sumPrior / nonZeroPriorCount : null;
        trendDirection = computeTrendDirection(threeDayAvg, priorAvg);
      } else {
        // For daily-floor nutrients, also compute the 3-day avg and compare today vs prior 2 days
        let sum3 = 0, count3 = 0;
        let sumPrior = 0, nonZeroPriorCount = 0;
        for (let i = 0; i < 3; i++) {
          const pd = getPastDate(targetDate, i);
          const pds = formatDate(pd);
          const entry = state.dailyEntries.get(pds) || {};
          const intake = pds === dateStr ? todaysIntake : parseFloat(entry[nutrient]) || 0;
          sum3 += intake; count3++;
          if (i >= 1 && intake > 0) { sumPrior += intake; nonZeroPriorCount++; }
        }
        threeDayAvg = count3 > 0 ? sum3 / count3 : 0;

        if (todaysIntake >= scaledTarget) status = 'green';
        else if (todaysIntake >= scaledTarget * 0.8) status = 'amber';
        else status = 'red';

        // Trend: today vs average of the prior 2 days (non-overlapping)
        const priorAvg = nonZeroPriorCount >= 1 ? sumPrior / nonZeroPriorCount : null;
        trendDirection = computeTrendDirection(todaysIntake, priorAvg);
      }

      // Target source classification (pass profileDriTargets so age/sex DRI values aren't
      // mislabeled as auto_goal or manual_baseline when they merely reflect the user's DRI)
      const targetSource = classifyTargetSource(
        nutrient,
        effectiveTargets,
        DEFAULT_TARGETS,
        state.goalSettings?.manualTargetOverrides,
        targetMode,
        profileDriTargets,
      );

      // Upper-limit check (warn at ≥ 80% of UL)
      const ul = UL_TABLE[nutrient] ?? null;
      const checkValue = averagedNutrients.includes(nutrient) ? avgIntake : todaysIntake;
      const isUlExceeded = ul !== null && checkValue >= ul * 0.8;

      metrics[nutrient] = {
        name: nutrient,
        baseTarget,
        scaledTarget,
        todaysIntake,
        avgIntake,
        threeDayAvg,
        status,
        isDailyFloor: dailyTrackedNutrients.includes(nutrient),
        isAveraged: averagedNutrients.includes(nutrient),
        isScaled: scaledTarget !== baseTarget,
        scaleSuggested: suggested,
        scaleReason: reason,
        targetSource,
        trendDirection,
        ul,
        isUlExceeded,
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

    // Restore Paste & Parse open/closed state
    const parserDetails = document.getElementById('paste-parse-details');
    if (parserDetails) {
      const saved = localStorage.getItem('ct-parser-open');
      if (saved === 'false') parserDetails.removeAttribute('open');
      parserDetails.addEventListener('toggle', () => {
        localStorage.setItem('ct-parser-open', String(parserDetails.open));
      });
    }
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
    else if (name === 'today') updateDashboard();

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

  const { todayKcalTarget, finalProteinG, finalFatG, finalCarbsG } = bankingData;

  const totals = state.dailyFoodItems.reduce((acc, item) => {
    const q = parseQty(item.quantity);
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
    cell('Protein', totals.pro,  finalProteinG)   +
    cell('Fat',     totals.fat,  finalFatG)        +
    cell('Carbs',   totals.carb, finalCarbsG);
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

  const metrics = calculateMicronutrientMetrics(dateStr);

  container.innerHTML =
    renderNutrientSummaryCards(metrics) +
    renderChartSection() +
    renderNutrientFilterBar(_nutrientFilter) +
    `<div id="nutrient-sections-container">${renderMicronutrientSections(metrics, _nutrientFilter)}</div>`;

  initializeChartControls();
  initializeNutrientFilterBar(metrics);
}

/**
 * Render status summary cards at the top of the Nutrients tab.
 */
function renderNutrientSummaryCards(metrics) {
  const vals = Object.values(metrics);
  const red  = vals.filter(m => m.status === 'red');
  const amber = vals.filter(m => m.status === 'amber');
  const green = vals.filter(m => m.status === 'green');
  const ulWarn = vals.filter(m => m.isUlExceeded);

  const card = (icon, count, label, colorClass) => `
    <div class="nutrient-status-card">
      <span class="nutrient-status-icon">${icon}</span>
      <span class="nutrient-status-count ${colorClass}">${count}</span>
      <span class="nutrient-status-label">${label}</span>
    </div>`;

  const shortfallList = red.length > 0 ? `
    <div class="mb-3 p-3 surface-2 rounded-lg border">
      <p class="text-sm font-semibold text-negative mb-2">⬇️ Common Shortfalls</p>
      <div class="flex flex-wrap gap-1">
        ${red.map(m => `<span class="nutrient-tag nutrient-tag-bad">${formatNutrientName(m.name)}</span>`).join('')}
      </div>
    </div>` : '';

  const ulList = ulWarn.length > 0 ? `
    <div class="mb-3 p-3 surface-2 rounded-lg border">
      <p class="text-sm font-semibold text-warning mb-2">⚠️ Near Upper Limit</p>
      <div class="flex flex-wrap gap-1">
        ${ulWarn.map(m => {
          const limitLabel = m.name === 'sodium' ? `CDRR: ${m.ul}` : `UL: ${m.ul}`;
          return `<span class="nutrient-tag nutrient-tag-warn" title="${limitLabel}">${formatNutrientName(m.name)}</span>`;
        }).join('')}
      </div>
    </div>` : '';

  return `
    <div class="mb-6">
      <div class="nutrient-status-grid mb-3">
        ${card('🔴', red.length,   'Low',        'text-negative')}
        ${card('🟡', amber.length, 'Near Target', 'text-warning')}
        ${card('🟢', green.length, 'On Target',   'text-positive')}
        ${card('⚠️', ulWarn.length,'Near UL',     'text-warning')}
      </div>
      ${shortfallList}${ulList}
    </div>`;
}

/**
 * Render the filter chip bar for the nutrient list.
 */
function renderNutrientFilterBar(activeFilter) {
  const filters = [
    { id: 'all',      label: 'All' },
    { id: 'low',      label: '🔴 Low' },
    { id: 'near',     label: '🟡 Near Target' },
    { id: 'above',    label: '🟢 On Target' },
    { id: 'override', label: '📌 Overridden' },
  ];
  return `
    <div id="nutrient-filter-bar" class="nutrient-filter-bar mb-4" role="group" aria-label="Filter nutrients">
      ${filters.map(f =>
        `<button type="button" class="nutrient-filter-chip${f.id === activeFilter ? ' active' : ''}" data-filter="${f.id}">${f.label}</button>`
      ).join('')}
    </div>`;
}

/**
 * Wire up click handlers on filter chips; re-renders the nutrient list only.
 */
function initializeNutrientFilterBar(metrics) {
  const bar = document.getElementById('nutrient-filter-bar');
  if (!bar) return;
  bar.querySelectorAll('.nutrient-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      _nutrientFilter = chip.dataset.filter;
      bar.querySelectorAll('.nutrient-filter-chip').forEach(c =>
        c.classList.toggle('active', c.dataset.filter === _nutrientFilter));
      const sc = document.getElementById('nutrient-sections-container');
      if (sc) sc.innerHTML = renderMicronutrientSections(metrics, _nutrientFilter);
    });
  });
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
      + renderEnergyExerciseBlock(dateStr, bankingData.exerciseAddMode)
      + renderBankingPanel(bankingData)
      + renderCalcDetailsPanel(bankingData);
  }

  container.innerHTML = bankingHtml + renderAnalysisSection();
  setupCollapsibleHandlers();
  initAnalysisEvents();
}

/**
 * Render the calculation formula panel for Energy tab (mode-aware).
 */
function renderCalcDetailsPanel(bankingData) {
  const {
    todayBaseCalories, todaysTrainingBump, todaysTrainingBumpRaw, bankBalance, targetMode, bankMode,
    sumPast6Actual, sumPastTargets, windowBudget, todayKcalTarget,
    scheduleAdjustment, rawBankBalance, targetFloorApplied, effectiveFloor, floorSource,
    bankAdjustmentApplied, manualBankCapped, exerciseAddMode, tdeeSourceLabel, planningTdee,
  } = bankingData;

  if (bankMode === 'autoGoalSchedule') {
    const tomorrowNote = 'Hit this target and tomorrow recalculates from Auto Goal mode.';
    const exerciseSkipNote = exerciseAddMode === 'skip' && todaysTrainingBumpRaw > 0
      ? `<div class="flex justify-between items-center p-2 surface-1 rounded border text-muted text-xs">
           <span>Exercise logged (+${todaysTrainingBumpRaw} kcal) — not added separately:</span>
           <span>already in TDEE estimate</span>
         </div>`
      : '';
    return `
      <div class="section-card p-4 mb-6">
        <h3 class="text-responsive-xl font-bold text-secondary mb-3">🧮 How Today's Target Was Calculated</h3>
        <div class="grid grid-cols-1 gap-2 text-sm">
          ${planningTdee ? `
            <div class="flex justify-between items-center p-2 surface-1 rounded border text-xs text-muted">
              <span>Planning TDEE:</span>
              <span>${planningTdee} kcal — ${tdeeSourceLabel ?? ''}</span>
            </div>
          ` : ''}
          <div class="flex justify-between items-center p-2 surface-1 rounded border">
            <span>Auto Goal base target (from weight &amp; goal):</span>
            <span class="font-medium">${todayBaseCalories} kcal</span>
          </div>
          ${exerciseSkipNote}
          ${todaysTrainingBump > 0 ? `
            <div class="flex justify-between items-center p-2 surface-1 rounded border">
              <span>Exercise:</span>
              <span class="font-medium text-accent">+${todaysTrainingBump} kcal</span>
            </div>
          ` : ''}
          ${scheduleAdjustment !== 0 ? `
            <div class="flex justify-between items-center p-2 surface-1 rounded border">
              <span>${scheduleAdjustment > 0 ? 'Schedule credit (spread forward over remaining goal days):' : 'Schedule correction (overage spread over goal window):'}</span>
              <span class="font-medium ${scheduleAdjustment > 0 ? 'text-positive' : 'text-negative'}">${scheduleAdjustment > 0 ? '+' : ''}${scheduleAdjustment} kcal</span>
            </div>
          ` : ''}
          ${targetFloorApplied ? `
            <div class="flex justify-between items-center p-2 surface-1 rounded border text-warning">
              <span>Minimum daily floor applied${floorSource === 'bmr_floor' ? ' (BMR-based)' : ''}:</span>
              <span class="font-medium">${effectiveFloor} kcal</span>
            </div>
          ` : ''}
          <div class="mt-2 pt-2 border-t border text-xs text-muted space-y-1">
            <div>${todayBaseCalories} + ${todaysTrainingBump} + ${scheduleAdjustment} = <strong>${todayKcalTarget} kcal today</strong></div>
            ${rawBankBalance !== 0 ? `
              <div class="italic">7-day raw balance: ${rawBankBalance > 0 ? '+' : ''}${rawBankBalance} kcal (${rawBankBalance < 0 ? 'overage spread over remaining goal days — not applied as a single crash day' : 'credit spread forward as a small schedule increase'}).</div>
            ` : ''}
            <div>${tomorrowNote}</div>
            <div>In Auto Goal mode: overages are spread gently, not concentrated. The base target recalculates as your weight changes.</div>
          </div>
        </div>
      </div>
    `;
  }

  // Manual — banking off: fixed base + exercise only
  if (bankMode === 'off') {
    return `
      <div class="section-card p-4 mb-6">
        <h3 class="text-responsive-xl font-bold text-secondary mb-3">🧮 How Today's Target Was Calculated</h3>
        <div class="grid grid-cols-1 gap-2 text-sm">
          <div class="flex justify-between items-center p-2 surface-1 rounded border">
            <span>Manual base target:</span>
            <span class="font-medium">${todayBaseCalories} kcal</span>
          </div>
          ${todaysTrainingBump > 0 ? `
            <div class="flex justify-between items-center p-2 surface-1 rounded border">
              <span>Exercise:</span>
              <span class="font-medium text-accent">+${todaysTrainingBump} kcal</span>
            </div>
          ` : ''}
          ${targetFloorApplied ? `
            <div class="flex justify-between items-center p-2 surface-1 rounded border text-warning">
              <span>Minimum daily floor applied${floorSource === 'bmr_floor' ? ' (BMR-based)' : ''}:</span>
              <span class="font-medium">${effectiveFloor} kcal</span>
            </div>
          ` : ''}
          <div class="mt-2 pt-2 border-t border text-xs text-muted space-y-1">
            <div>${todayBaseCalories}${todaysTrainingBump > 0 ? ` + ${todaysTrainingBump}` : ''} = <strong>${todayKcalTarget} kcal today</strong></div>
            <div>Banking is off — past days do not alter today's target.</div>
          </div>
        </div>
      </div>
    `;
  }

  // Manual mode — rolling bank
  const tomorrowNote = `Hit this target and tomorrow resets to ${todayBaseCalories} kcal (rest day).`;
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
        ${bankAdjustmentApplied !== 0 ? `
          <div class="flex justify-between items-center p-2 rounded border surface-2">
            <span>Rolling balance adjustment${manualBankCapped ? ' (capped)' : ''}:</span>
            <span class="font-medium ${bankAdjustmentApplied > 0 ? 'text-positive' : 'text-negative'}">${bankAdjustmentApplied > 0 ? '+' : ''}${bankAdjustmentApplied} kcal</span>
          </div>
          ${manualBankCapped ? `
            <div class="flex justify-between items-center p-2 rounded border surface-1 text-xs text-muted">
              <span>Raw 7-day balance (informational):</span>
              <span>${bankBalance > 0 ? '+' : ''}${bankBalance} kcal (capped to ${bankAdjustmentApplied} kcal/day)</span>
            </div>
          ` : ''}
        ` : ''}
        <div class="mt-2 pt-2 border-t border text-xs text-muted space-y-1">
          <div>${todayBaseCalories}${todaysTrainingBump > 0 ? ` + ${todaysTrainingBump}` : ''} + ${bankAdjustmentApplied > 0 ? '+' : ''}${bankAdjustmentApplied}${manualBankCapped ? ` (raw: ${bankBalance > 0 ? '+' : ''}${bankBalance}, capped)` : ''} = <strong>${todayKcalTarget} kcal today</strong></div>
          <div>${tomorrowNote}</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render compact calorie + macro summary for the Today tab.
 */
function renderTodayCompact(bankingData) {
  const {
    todayKcalTarget, finalProteinG, finalFatG, finalCarbsG,
    todayBaseCalories, todaysTrainingBump, bankBalance, bankIncomplete, unknownDays, targetMode,
    bankMode, scheduleAdjustment, rawBankBalance, targetFloorApplied, effectiveFloor, floorSource, scheduleCapped,
    macroFloorExceedsCalories, bankAdjustmentApplied, manualBankCapped,
  } = bankingData;

  const totals = state.dailyFoodItems.reduce((acc, item) => {
    const q = parseQty(item.quantity);
    acc.calories += q * (parseFloat(item.calories) || 0);
    acc.protein  += q * (parseFloat(item.protein)  || 0);
    acc.fat      += q * (parseFloat(item.fat)      || 0);
    acc.carbs    += q * (parseFloat(item.carbs)    || 0);
    return acc;
  }, { calories: 0, protein: 0, fat: 0, carbs: 0 });

  const remaining   = todayKcalTarget - totals.calories;
  const remainColor = remaining >= 0 ? 'text-positive' : 'text-negative';
  // Label changes when over target so the large number isn't mistaken for a negative calorie target
  const remainLabel = remaining >= 0 ? 'Calories Remaining' : 'Calories Over Target';
  const remainDisplay = Math.abs(Math.round(remaining));

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

  const modeBadge = targetMode === 'autoGoal'
    ? `<span class="text-xs font-medium text-accent ml-1">Auto Goal</span>`
    : `<span class="text-xs text-muted ml-1">Manual Baseline</span>`;

  // Build the adjustment segment of the formula line.
  let adjSegment = '';
  if (bankMode === 'autoGoalSchedule') {
    if (scheduleAdjustment !== 0) {
      adjSegment = ` + Schedule: ${scheduleAdjustment > 0 ? '+' : ''}${scheduleAdjustment}`;
    }
  } else {
    // Manual mode — rolling bank (use applied/capped value in formula)
    if (bankAdjustmentApplied !== 0) {
      adjSegment = ` + Bank: ${bankAdjustmentApplied > 0 ? '+' : ''}${bankAdjustmentApplied}`;
      if (manualBankCapped) {
        adjSegment += ` (raw: ${bankBalance > 0 ? '+' : ''}${bankBalance}, capped)`;
      }
    }
  }
  const exerciseSegment = todaysTrainingBump > 0 ? ` + Exercise: +${todaysTrainingBump}` : '';

  // Informational raw-bank line for Auto Goal mode
  const rawBankNote = bankMode === 'autoGoalSchedule' && rawBankBalance !== 0
    ? `<div class="text-xs text-muted mt-0.5">
        7-day raw ${rawBankBalance < 0 ? 'overage' : 'credit'}: ${Math.abs(rawBankBalance)} kcal
        ${rawBankBalance < 0 && scheduleAdjustment !== 0 ? '— spread over goal window' : ''}
        ${rawBankBalance > 0 && scheduleAdjustment > 0 ? '— spread forward as a small schedule increase' : ''}
       </div>`
    : '';

  const bankNote = bankIncomplete
    ? `<div class="text-xs text-warning mt-1">⚠ ${bankMode === 'autoGoalSchedule' ? 'Schedule context' : 'Rolling bank'} incomplete — missing data for: ${unknownDays.join(', ')}. Unknown days treated as on-target.</div>`
    : '';

  const floorNote = targetFloorApplied
    ? `<div class="text-xs text-warning mt-1">⚠ Target was floored at ${effectiveFloor} kcal${floorSource === 'bmr_floor' ? ' (BMR-based minimum)' : ''}. Goal date may need adjustment or recent overage is being carried forward.</div>`
    : '';

  const capNote = scheduleCapped
    ? `<div class="text-xs text-warning mt-0.5">Schedule correction capped at ${scheduleAdjustment} kcal/day (daily limit). Goal date may benefit from extension.</div>`
    : '';

  const profileNote = targetMode !== 'autoGoal'
    ? `<div class="text-xs text-muted mt-0.5 italic" style="font-size:0.7rem">Profile &amp; Goals only changes Today after "Apply to Baseline Targets" or switching to Auto Goal mode.</div>`
    : '';

  const macroFeasibilityNote = macroFloorExceedsCalories
    ? `<div class="text-xs text-warning mt-1">⚠ Protein + fat floors exceed today's calorie target — carbs set to 0. Consider relaxing the target or adjusting macro floors.</div>`
    : '';

  return `
    <div class="mb-4 p-4 surface-2 rounded-lg border text-center">
      <div class="text-xs text-muted uppercase tracking-wide mb-1">${remainLabel}</div>
      <div class="text-4xl font-bold ${remainColor}">${remainDisplay}</div>
      <div class="text-xs text-muted mt-1">${Math.round(totals.calories)} eaten · ${todayKcalTarget} target</div>
      <div class="text-xs text-muted mt-1">
        Target: ${modeBadge} · Base: ${todayBaseCalories}${exerciseSegment}${adjSegment} = ${todayKcalTarget} kcal
      </div>
      ${rawBankNote}
      ${floorNote}
      ${macroFeasibilityNote}
      ${capNote}
      ${bankNote}
      ${profileNote}
      <div class="hbar mt-2">
        <div class="hbar-fill ${pctClass(totals.calories, todayKcalTarget)}" style="width:${pctWidth(totals.calories, todayKcalTarget)}"></div>
        <div class="hbar-marker" style="left:${markerLeft}"></div>
      </div>
    </div>
    <div class="divide-y">
      ${macroRow('Protein', totals.protein, finalProteinG)}
      ${macroRow('Fat (min)', totals.fat, finalFatG)}
      ${macroRow('Carbs', totals.carbs, finalCarbsG)}
    </div>
  `;
}

// =========================
// EXERCISE IMPACT PANEL (Today tab output + Energy tab)
// =========================

/**
 * Render a compact exercise summary card for the Today dashboard output.
 * Shows sessions, calorie estimate, and method source.
 * @param {string} dateStr
 * @param {'add'|'skip'} [exerciseAddMode] - when 'skip', show note that calories are in TDEE
 */
function renderExerciseSummaryCard(dateStr, exerciseAddMode = 'add') {
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
  const skipNote = exerciseAddMode === 'skip'
    ? `<div class="text-xs text-warning mt-1">⚠ Exercise calories are already reflected in your planning TDEE — not added separately to today's target.</div>`
    : '';

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
        <span class="text-sm font-bold text-accent">${exerciseAddMode === 'add' ? '+' : ''}${totalKcal} kcal <span class="text-xs text-muted font-normal">(${sourceLabel})</span></span>
      </div>
      ${sessionLines}
      ${skipNote}
    </div>`;
}

/**
 * Render an exercise impact block for the Energy tab.
 * @param {string} dateStr
 * @param {'add'|'skip'} [exerciseAddMode]
 */
function renderEnergyExerciseBlock(dateStr, exerciseAddMode = 'add') {
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
      ${exerciseAddMode === 'skip' ? `
        <p class="text-xs text-warning mt-1">
          ⚠ Your planning TDEE is derived from observed data that already includes your historical activity. Exercise calories above are logged but not added separately to today's target — they are already reflected in the base estimate.
        </p>` : ''}
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

    // Populate analysis cache synchronously when data is available but Energy tab
    // hasn't been visited yet.  runAnalysis() is pure CPU — no I/O or DOM.
    if (!state.analysisResults && state.weightEntries?.size > 0 && state.dailyEntries?.size > 0) {
      try {
        state.analysisResults = runAnalysis(
          state.weightEntries, state.dailyEntries,
          state.userProfile ?? null, state.weightEntriesMulti ?? null,
          getTodayInTimezone()
        );
      } catch (_) {}
    }

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
      ${renderExerciseSummaryCard(dateStr, bankingData.exerciseAddMode)}
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
 * Render info box with explanations (mode-aware).
 */
function renderInfoBox() {
  const targetMode = state.goalSettings?.targetMode ?? 'manual';

  if (targetMode === 'autoGoal') {
    const softCap = BANKING_CONFIG.MAX_SCHEDULE_ADJ_SOFT ?? 150;
    const hardCap = BANKING_CONFIG.MAX_SCHEDULE_ADJ_HARD ?? 250;
    return `
      <div class="mb-6 p-4 surface-2 rounded-lg border">
        <h3 class="font-semibold text-secondary mb-2"><i class="fas fa-info-circle mr-2"></i>How Auto Goal Works</h3>
        <div class="text-sm text-muted space-y-1">
          <p><strong>Daily Target:</strong> Recalculated from your current weight, goal, and target date — adapts as your weight changes. The base calorie target never comes from a fixed 7-day window.</p>
          <p><strong>Schedule Correction:</strong> Weekly overages and credits are spread symmetrically across remaining goal days. Overage correction: up to ${softCap} kcal/day normally, up to ${hardCap} kcal/day in extreme cases. Credit bonus: up to ${softCap} kcal/day — never concentrated into a single day.</p>
          <p><strong>Training Days:</strong> Exercise calories are added when the planning TDEE is a rest-day estimate. If your TDEE was derived from observed data (which already includes your activity), exercise bumps are skipped to avoid double-counting.</p>
          <p><strong>7-Day Raw Balance:</strong> Shown as informational context only. In Auto Goal mode it feeds the schedule correction but does not directly set today's target.</p>
        </div>
      </div>
    `;
  }

  if (state.goalSettings?.useRollingBanking === false) {
    return `
      <div class="mb-6 p-4 surface-2 rounded-lg border">
        <h3 class="font-semibold text-secondary mb-2"><i class="fas fa-info-circle mr-2"></i>How This Works</h3>
        <div class="text-sm text-muted space-y-1">
          <p><strong>Fixed Daily Target:</strong> Banking is off. Your target each day is your manual baseline plus any exercise calories — past intake has no effect on today's number.</p>
          <p><strong>Past 6 Days:</strong> Shown as context only and do not roll into the current target.</p>
          <p><strong>Training Days:</strong> Select your workout type above — this adds calories and scales electrolytes appropriately.</p>
        </div>
      </div>
    `;
  }

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
 * Render banking/adjustment panel showing 7-day balance context.
 * Auto Goal mode: shows raw balance as informational + schedule adjustment.
 * Manual mode: shows rolling bank balance as usual.
 */
function renderBankingPanel(bankingData) {
  const {
    bankBalance, rawBankBalance, pastDays, sumPast6Actual, sumPastTargets,
    windowBudget, todayBaseCalories, todaysTrainingBump, targetMode, bankMode, scheduleAdjustment,
    targetFloorApplied, effectiveFloor, floorSource, scheduleCapped, todayKcalTarget,
    bankAdjustmentApplied, manualBankCapped, exerciseAddMode,
  } = bankingData;

  const contributionRows = pastDays.map(d => `
    <tr${d.unknown ? ' class="opacity-60"' : ''}>
      <td class="px-3 py-2 text-sm font-medium">${d.dayName}${d.trainingBump > 0 ? ' <span class="text-xs text-accent">+' + d.trainingBump + '</span>' : ''}${d.unknown ? ' <span class="text-xs text-warning">(missing)</span>' : ''}</td>
      <td class="px-3 py-2 text-sm text-center">${d.unknown ? '<span class="text-muted">—</span>' : Math.round(d.actualKcal)}</td>
      <td class="px-3 py-2 text-sm text-center text-muted">${Math.round(d.dailyTarget)}</td>
      <td class="px-3 py-2 text-sm text-center font-medium ${d.unknown ? 'text-muted' : d.delta > 0 ? 'text-negative' : d.delta < 0 ? 'text-positive' : 'text-muted'}">
        ${d.unknown ? '0' : (d.delta > 0 ? '+' : '') + Math.round(d.delta)}
      </td>
    </tr>
  `).join('');

  const pastDaysTable = `
    <div id="recent-days-content" class="hidden">
      <div class="overflow-x-auto mt-3">
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
              <td class="px-3 py-2 text-sm text-center font-bold ${rawBankBalance > 0 ? 'text-positive' : rawBankBalance < 0 ? 'text-negative' : 'text-muted'}">
                ${rawBankBalance > 0 ? '+' : ''}${rawBankBalance}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;

  if (bankMode === 'autoGoalSchedule') {
    const cumulativeDebt = Math.max(0, -rawBankBalance);
    let statusText;
    if (rawBankBalance < 0) {
      statusText = `Over budget by ${cumulativeDebt} kcal this week.`;
      if (scheduleAdjustment !== 0) {
        statusText += ` Spreading correction over remaining goal window (${scheduleAdjustment} kcal/day today).`;
      }
    } else if (rawBankBalance > 0) {
      statusText = `Under budget by ${rawBankBalance} kcal this week.`;
      if (scheduleAdjustment > 0) {
        statusText += ` Credit spread forward (+${scheduleAdjustment} kcal/day today).`;
      }
    } else {
      statusText = `On track this week — no adjustment needed.`;
    }

    return `
      <div class="section-card p-4">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-responsive-xl font-bold text-secondary">📊 Auto Goal — 7-Day Context</h3>
          <button id="recent-days-toggle" class="btn-subtle">
            <i class="fas fa-chevron-down"></i>
            <span class="toggle-text">Show Past 6 Days</span>
          </button>
        </div>

        <div class="p-3 rounded-lg border surface-2 mb-3">
          <div class="text-center">
            <div class="text-xs text-muted mb-1">7-Day Raw Balance (informational)</div>
            <div class="text-responsive-2xl font-bold ${rawBankBalance > 0 ? 'text-positive' : rawBankBalance < 0 ? 'text-negative' : 'text-muted'}">
              ${rawBankBalance > 0 ? '+' : ''}${rawBankBalance} kcal
            </div>
            <p class="text-sm text-muted mt-1">${statusText}</p>
          </div>
        </div>

        ${targetFloorApplied ? `
          <div class="mb-3 p-3 surface-2 rounded-lg border text-sm text-warning">
            ⚠ Target was floored at ${effectiveFloor} kcal${floorSource === 'bmr_floor' ? ' (BMR-based minimum)' : ''}. Goal date may need adjustment or the recent overage is large relative to remaining time.
          </div>` : ''}

        ${scheduleCapped ? `
          <div class="mb-3 p-3 surface-2 rounded-lg border text-sm text-warning">
            Schedule correction capped at ${scheduleAdjustment} kcal/day. Extending your goal date would allow a gentler adjustment.
          </div>` : ''}

        ${pastDaysTable}
      </div>
    `;
  }

  // Banking-off mode — fixed base + exercise, no week-level adjustment
  if (bankMode === 'off') {
    return `
      <div class="section-card p-4">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-responsive-xl font-bold text-secondary">📋 Manual — Banking Off</h3>
          <button id="recent-days-toggle" class="btn-subtle">
            <i class="fas fa-chevron-down"></i>
            <span class="toggle-text">Show Past 6 Days</span>
          </button>
        </div>

        <div class="p-3 rounded-lg border surface-2 mb-3 text-sm text-muted">
          <p>Banking is disabled. Today's target is your base target${todaysTrainingBump > 0 ? ` plus today's exercise (+${todaysTrainingBump} kcal)` : ''} — past intake does not adjust it.</p>
          <p class="mt-1 text-xs">Past 6 days are shown below for context only.</p>
        </div>

        ${targetFloorApplied ? `
          <div class="mb-3 p-3 surface-2 rounded-lg border text-sm text-warning">
            ⚠ Target was floored at ${effectiveFloor} kcal${floorSource === 'bmr_floor' ? ' (BMR-based minimum)' : ''}.
          </div>` : ''}

        ${pastDaysTable}
      </div>
    `;
  }

  // Manual mode — rolling bank panel
  const bankExplanation = bankBalance > 0
    ? `You have ${bankBalance} kcal banked from under-eating — today's target is ${bankAdjustmentApplied > 0 ? `+${bankAdjustmentApplied}` : `${bankAdjustmentApplied}`} kcal${manualBankCapped ? ` (capped from +${bankBalance})` : ''}.`
    : bankBalance < 0
    ? `You're ${Math.abs(bankBalance)} kcal over budget — today's target is reduced by ${Math.abs(bankAdjustmentApplied)} kcal${manualBankCapped ? ` (capped from −${Math.abs(bankBalance)})` : ''}.`
    : "You're perfectly on track — no adjustment needed!";

  const budgetExplain = `${windowBudget} kcal (${todayBaseCalories}/day × 7 + training bumps).`;
  const tomorrowNote  = `If you hit today's target (${todayKcalTarget} kcal), tomorrow's target resets to ${todayBaseCalories} kcal (on a rest day).`;

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

      ${targetFloorApplied ? `
        <div class="mt-3 p-3 surface-2 rounded-lg border text-sm text-warning">
          ⚠ Target was floored at ${effectiveFloor} kcal${floorSource === 'bmr_floor' ? ' (BMR-based minimum)' : ''}. The rolling bank pulled today's budget below the minimum safe daily intake.
        </div>` : ''}

      ${pastDaysTable}

      <div class="mt-3 p-3 surface-2 rounded-lg text-xs text-muted space-y-1">
        <p><strong>How it works:</strong> Your 7-day calorie budget is ${budgetExplain}</p>
        <p>You've consumed ${sumPast6Actual} kcal over the last 6 days against a target of ${sumPastTargets} kcal.</p>
        <p>${tomorrowNote}</p>
      </div>
    </div>
  `;
}

/**
 * Render chart section — uses chip-based nutrient picker for mobile-friendly selection.
 */
function renderChartSection() {
  return `
    <div class="mb-8 card p-6 shadow-lg">
      <h3 class="text-responsive-2xl font-bold text-secondary mb-4">📊 Nutrition Progress Chart</h3>

      <div class="mb-3">
        <p class="text-sm font-medium text-primary mb-2">Select Nutrients <span class="text-xs text-muted font-normal">(tap to toggle)</span></p>
        <div id="chart-nutrient-chips" class="chart-chip-picker" role="group" aria-label="Select nutrients for chart"></div>
      </div>

      <div class="mb-4 flex flex-wrap gap-4 items-end">
        <div class="flex-1">
          <label for="chart-timeframe" class="block text-sm font-medium text-primary mb-1">Time Frame</label>
          <select id="chart-timeframe">
            <option value="3days">Last 3 Days</option>
            <option value="week">Last Week</option>
            <option value="month">Last Month</option>
          </select>
        </div>
        <div class="flex gap-4 items-center flex-wrap">
          <label class="flex items-center gap-2 cursor-pointer text-sm text-primary">
            <input type="checkbox" id="show-3day-avg" class="h-4 w-4">
            <span>3-day avg</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer text-sm text-primary">
            <input type="checkbox" id="show-7day-avg" class="h-4 w-4">
            <span>7-day avg</span>
          </label>
        </div>
      </div>

      <div class="chart-container"><canvas id="nutrition-chart"></canvas></div>
      <div id="chart-table" class="mt-6"></div>
    </div>
  `;
}

/**
 * Render micronutrient sections with filter support and enhanced per-nutrient detail.
 * @param {Object} metrics - Output of calculateMicronutrientMetrics()
 * @param {string} filter  - 'all'|'low'|'near'|'above'|'override'
 */
function renderMicronutrientSections(metrics, filter = 'all') {
  const filterFn = (data) => {
    switch (filter) {
      case 'low':      return data.status === 'red';
      case 'near':     return data.status === 'amber';
      case 'above':    return data.status === 'green';
      case 'override': return data.targetSource === 'manual_override';
      default:         return true;
    }
  };

  const renderNutrientRow = (nutrient, data) => {
    if (!filterFn(data)) return '';

    const {
      baseTarget, scaledTarget, todaysIntake, avgIntake, threeDayAvg,
      isDailyFloor, isAveraged, scaleSuggested, scaleReason,
      targetSource, trendDirection, ul, isUlExceeded,
    } = data;

    const displayValue = isAveraged ? avgIntake : todaysIntake;
    const targetValue  = isDailyFloor ? scaledTarget : baseTarget;
    const remaining    = targetValue - displayValue;

    // Source badge (no badge for DRI defaults — only call out deviations)
    const sourceBadge = targetSource === 'manual_override'
      ? `<span class="nt-badge nt-badge-override" title="Manually pinned target">📌</span>`
      : targetSource === 'auto_goal'
      ? `<span class="nt-badge nt-badge-custom" title="Auto Goal calculated target">🎯</span>`
      : targetSource === 'manual_baseline'
      ? `<span class="nt-badge nt-badge-custom" title="Custom target from Settings">✏️</span>`
      : targetSource === 'dri_profile_default'
      ? `<span class="nt-badge nt-badge-custom" title="Age/sex-specific DRI for your profile">👤</span>`
      : '';

    // Exercise-scaling note
    const scaleBadge = scaleSuggested && scaledTarget !== baseTarget
      ? `<span class="nt-badge nt-badge-scale" title="Exercise scaling: ${scaleReason}">⚡+${Math.round(scaledTarget - baseTarget)}</span>`
      : '';

    // Trend indicator
    const trendMap = { up: ['↑', 'text-positive'], down: ['↓', 'text-negative'], stable: ['→', 'text-muted'] };
    const [trendIcon, trendCls] = trendMap[trendDirection] || trendMap.stable;
    const trendBadge = `<span class="${trendCls} nt-trend" title="Recent trend">${trendIcon}</span>`;

    // UL warning
    const ulLabel = nutrient === 'sodium'
      ? `Near/above CDRR target (${ul})`
      : `Near/above upper limit (UL: ${ul})`;
    const ulBadge = isUlExceeded
      ? `<span class="nt-badge nt-badge-ul" title="${ulLabel}">⚠️</span>`
      : '';

    // Source label in target span
    const srcLabel = targetSource === 'manual_override'    ? ' (pinned)'
                   : targetSource === 'auto_goal'           ? ' (auto goal)'
                   : targetSource === 'manual_baseline'     ? ' (custom)'
                   : targetSource === 'dri_profile_default' ? ' (profile DRI)'
                   : ' (DRI)'; // 'dri' = matches generic DRI reference value

    // For averaged nutrients show today's value as sub-detail below the bar
    const subDetail = isAveraged
      ? `<div class="nt-sub-detail">Today: ${todaysIntake.toFixed(1)} · 3d avg: ${threeDayAvg.toFixed(1)}</div>`
      : '';

    return `
      <div class="kpi-row">
        <div class="meta">
          <span class="label">${formatNutrientName(nutrient)}${sourceBadge}${scaleBadge}${trendBadge}${ulBadge}</span>
          <span class="current">${displayValue.toFixed(1)}${isAveraged ? '<span class="nt-avg-label">avg</span>' : ''}</span>
          <span class="target">target ${targetValue.toFixed(1)}${srcLabel}</span>
          <span class="remain ${remainClass(remaining)}">${remaining > 0 ? `${remaining.toFixed(1)} left` : remaining < 0 ? `${Math.abs(remaining).toFixed(1)} over` : '0 left'}</span>
        </div>
        <div class="hbar">
          <div class="hbar-fill ${pctClass(displayValue, targetValue)}" style="width:${pctWidth(displayValue, targetValue)}"></div>
          <div class="hbar-marker" style="left:${markerLeft}"></div>
        </div>
        ${subDetail}
      </div>`;
  };

  const renderSection = (title, nutrientKeys, description) => {
    const rows = nutrientKeys
      .filter(n => metrics[n] && filterFn(metrics[n]))
      .map(n => renderNutrientRow(n, metrics[n]))
      .filter(Boolean)
      .join('');
    if (!rows) return '';
    return `
      <div class="mb-8">
        <div class="mb-3">
          <h3 class="text-responsive-2xl font-bold text-secondary">${title}</h3>
          <p class="text-sm text-muted">${description}</p>
        </div>
        <div class="divide-y">${rows}</div>
      </div>`;
  };

  const sections = [
    renderSection('💧 Daily Electrolytes & Essentials', nutrients.dailyFloors,
      'Must meet daily targets — electrolytes scale with training intensity'),
    renderSection('🧪 Daily Vitamins', nutrients.dailyVitamins,
      'Water-soluble — daily targets'),
    renderSection('🟡 Fat-Soluble Vitamins', nutrients.avgVitamins,
      '7-day rolling average — stored in body fat, no training scaling'),
    renderSection('⚡ Stored Minerals', nutrients.avgMinerals,
      '7-day rolling average — stored in tissues, no training scaling'),
    renderSection('🔄 Optional Nutrients', nutrients.optional,
      '7-day rolling average targets'),
  ].join('');

  if (!sections.trim()) {
    const labels = { low: 'Low', near: 'Near Target', above: 'On Target', override: 'Overridden' };
    return `<p class="text-muted text-center py-8">No nutrients match the "${labels[filter] || filter}" filter.</p>`;
  }
  return sections;
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
