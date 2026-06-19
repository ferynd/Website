/**
 * @file ui/bankingEngine.js
 * Pure banking math — no state, no DOM, no Firebase.
 * Imported by calculateBankingData() in dashboard.js and by unit tests.
 */

import { BANKING_CONFIG, BankingHelpers } from '../constants.js';

/**
 * Returns true when an entry contains calories the user (or a saved estimate)
 * deliberately logged — i.e. calories are a real signal, not an absent default.
 */
export function hasTrustedCalories(entry) {
  if (!entry || Object.keys(entry).length === 0) return false;
  const cals = parseFloat(entry.calories);
  return !isNaN(cals) && cals > 0;
}

/**
 * Pure data preparation: iterate past days from an entries map,
 * classify trusted/untrusted days, and sum actuals and targets.
 *
 * @param {string}   targetDateStr  - 'YYYY-MM-DD'
 * @param {Map}      dailyEntries   - Map<dateStr, entryObject>
 * @param {object}   config
 * @param {number}   config.baseKcal          - base daily calorie target
 * @param {number}   [config.windowDays=7]    - rolling window size
 * @param {function} [config.getTrainingBump] - (entry, dateStr) => number; default 0
 * @param {function} [config.getDayTarget]    - (dateStr) => number; default baseKcal
 * @returns {{ sumPast6Actual, sumPastBaseTargets, sumPastTrainingBumps,
 *             unknownDays, pastDays, bankIncomplete }}
 */
export function prepareBankingInputs(targetDateStr, dailyEntries, {
  baseKcal,
  windowDays = 7,
  getTrainingBump = () => 0,
  getDayTarget = null,
}) {
  const targetDate = new Date(`${targetDateStr}T00:00:00`);
  let sumPastActual = 0;
  let sumPastBaseTargets = 0;
  let sumPastTrainingBumps = 0;
  const unknownDays = [];
  const pastDays = [];

  for (let i = 1; i < windowDays; i++) {
    const d = new Date(targetDate);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const entry = dailyEntries.get(dateStr) ?? {};

    const dayBaseTarget = getDayTarget ? getDayTarget(dateStr) : baseKcal;
    const trainingBump = getTrainingBump(entry, dateStr);
    const dailyTarget = dayBaseTarget + trainingBump;

    const trusted = hasTrustedCalories(entry);
    const actualKcal = trusted ? parseFloat(entry.calories) : dailyTarget;
    const delta = actualKcal - dailyTarget;
    if (!trusted) unknownDays.push(dateStr);

    pastDays.push({
      date: d,
      dateStr,
      actualKcal,
      trainingBump,
      dailyTarget,
      delta,
      unknown: !trusted,
      dayName: d.toLocaleDateString('en-US', { weekday: 'short' }),
    });

    sumPastActual += actualKcal;
    sumPastBaseTargets += dayBaseTarget;
    sumPastTrainingBumps += trainingBump;
  }

  return {
    sumPast6Actual: sumPastActual,
    sumPastBaseTargets,
    sumPastTrainingBumps,
    unknownDays,
    pastDays,
    bankIncomplete: unknownDays.length > 0,
  };
}

/**
 * Core banking calculation — given summarized inputs, produce today's calorie target.
 *
 * @param {object}      p
 * @param {number}      p.todayBaseCalories    - Auto-goal or baseline daily calorie target
 * @param {number}      p.todaysTrainingBump   - Exercise kcal for today
 * @param {number}      p.sumPastBaseTargets   - Sum of past 6 days' base calorie targets
 * @param {number}      p.sumPastTrainingBumps - Sum of past 6 days' exercise bumps
 * @param {number}      p.sumPast6Actual       - Sum of past 6 days' actual intake
 * @param {number}      p.windowBudget         - Full 7-day window budget (for manual rolling mode display)
 * @param {string}      p.targetMode           - 'manual' | 'autoGoal'
 * @param {boolean}     [p.useRollingBanking]  - Whether rolling bank is enabled (manual mode only); default true
 * @param {string|null} [p.goalTargetDate]     - Goal target date 'YYYY-MM-DD' or null (auto goal only)
 * @param {string}      p.targetDateStr        - Today's date 'YYYY-MM-DD'
 * @param {number}      p.effectiveFloor       - Minimum daily calories (BMR-based ≥ 1000 or fixed 1000)
 * @returns {{ bankMode, bankBalance, bankAdjustmentApplied, scheduleAdjustment, rawBankBalance, todayKcalTarget, targetFloorApplied, scheduleCapped }}
 */
export function calcBankingCore(p) {
  const {
    todayBaseCalories,
    todaysTrainingBump,
    sumPastBaseTargets,
    sumPastTrainingBumps,
    sumPast6Actual,
    windowBudget,
    targetMode,
    useRollingBanking = true,
    goalTargetDate = null,
    targetDateStr,
    effectiveFloor,
  } = p;

  const SOFT_CAP = -(BANKING_CONFIG.MAX_SCHEDULE_ADJ_SOFT ?? 150);
  const HARD_CAP = -(BANKING_CONFIG.MAX_SCHEDULE_ADJ_HARD ?? 250);

  // rawBankBalance: positive = under-ate (credit), negative = over-ate (debt)
  const rawBankBalance = Math.round(sumPastBaseTargets + sumPastTrainingBumps - sumPast6Actual);

  let bankMode, bankBalance, bankAdjustmentApplied, scheduleAdjustment, scheduleCapped, todayKcalTarget;
  scheduleAdjustment = 0;
  scheduleCapped = false;

  if (targetMode === 'autoGoal') {
    // AUTO GOAL: base + exercise + soft schedule correction.
    // Full rolling bank NOT applied — overages AND credits are spread gently.
    const cumulativeDebt   = Math.max(0, -rawBankBalance);
    const cumulativeCredit = Math.max(0, rawBankBalance);
    const MAX_CREDIT_PER_DAY = BANKING_CONFIG.MAX_SCHEDULE_ADJ_SOFT ?? 150;

    if ((cumulativeDebt > 0 || cumulativeCredit > 0) && goalTargetDate) {
      const targetMs = new Date(`${goalTargetDate}T00:00:00`).getTime();
      const todayMs  = new Date(`${targetDateStr}T00:00:00`).getTime();
      const remainingDays = Math.round((targetMs - todayMs) / 86400000);
      if (remainingDays > 1) {
        if (cumulativeDebt > 0) {
          const rawAdj = -cumulativeDebt / remainingDays;
          scheduleAdjustment = Math.round(Math.max(HARD_CAP, rawAdj));
          if (rawAdj < SOFT_CAP) scheduleCapped = true;
        } else {
          // Spread credit forward; cap at soft-cap to avoid over-eating days
          const rawAdj = cumulativeCredit / remainingDays;
          scheduleAdjustment = Math.round(Math.min(MAX_CREDIT_PER_DAY, rawAdj));
        }
      }
    }
    bankMode = 'autoGoalSchedule';
    bankAdjustmentApplied = scheduleAdjustment;
    bankBalance = rawBankBalance; // informational — not directly applied
    todayKcalTarget = BankingHelpers.roundToNearest25(todayBaseCalories + todaysTrainingBump + scheduleAdjustment);

  } else if (!useRollingBanking) {
    // MANUAL + banking off: fixed base + exercise, no week-level adjustment.
    bankMode = 'off';
    bankBalance = 0;
    bankAdjustmentApplied = 0;
    todayKcalTarget = BankingHelpers.roundToNearest25(todayBaseCalories + todaysTrainingBump);

  } else {
    // MANUAL rolling bank: window budget adjusts today's target up/down.
    // The raw adjustment is capped so a single bad week never crashes the target.
    bankMode = 'manualRolling';
    const MANUAL_DOWN = BANKING_CONFIG.MANUAL_BANK_CAP_DOWN ?? -400;
    const MANUAL_UP   = BANKING_CONFIG.MANUAL_BANK_CAP_UP   ?? 600;
    // rawBankBalance already computed above (positive = credit, negative = debt)
    const cappedBankAdj = Math.max(MANUAL_DOWN, Math.min(MANUAL_UP, rawBankBalance));
    bankBalance = rawBankBalance;            // keep raw as informational
    bankAdjustmentApplied = cappedBankAdj;  // what actually moves the target
    todayKcalTarget = BankingHelpers.roundToNearest25(
      todayBaseCalories + todaysTrainingBump + cappedBankAdj
    );
  }

  const targetFloorApplied = todayKcalTarget < effectiveFloor;
  if (targetFloorApplied) todayKcalTarget = effectiveFloor;

  const manualBankCapped = bankMode === 'manualRolling' && bankAdjustmentApplied !== bankBalance;
  return {
    bankMode,
    bankBalance: Math.round(bankBalance),
    bankAdjustmentApplied,
    scheduleAdjustment,
    rawBankBalance,
    todayKcalTarget,
    targetFloorApplied,
    scheduleCapped,
    manualBankCapped,
  };
}
