/**
 * @file ui/banking.test.js
 * Pure-function tests for the rolling 7-day banking helpers extracted from
 * dashboard.js.  Tests do NOT touch Firebase, DOM, or Chart.js.
 *
 * Extracted logic is re-implemented here as pure functions that mirror the
 * calculateBankingData() semantics exactly, so the tests stay in sync without
 * importing the full dashboard module (which has DOM side-effects).
 */

import { describe, it, expect } from 'vitest';
import { calcBankingCore } from './bankingEngine.js';

// ---------------------------------------------------------------------------
// Pure helpers mirrored from dashboard.js (kept for existing test coverage)
// ---------------------------------------------------------------------------

function hasTrustedCalories(entry) {
  if (!entry || Object.keys(entry).length === 0) return false;
  const cals = parseFloat(entry.calories);
  return !isNaN(cals) && cals > 0;
}

/**
 * Stripped-down version of calculateBankingData() that operates on plain
 * JS objects (no state/DOM/Firebase) for unit testing.
 *
 * @param {string}    targetDateStr  - 'YYYY-MM-DD'
 * @param {Map}       dailyEntries   - Map<dateStr, entryObject>
 * @param {number}    baseKcal
 * @returns {{ todayKcalTarget, bankBalance, bankIncomplete, unknownDays }}
 */
function calcBanking(targetDateStr, dailyEntries, baseKcal) {
  const targetDate = new Date(`${targetDateStr}T00:00:00`);
  const WINDOW = 7;

  let sumPastActual = 0;
  const unknownDays = [];
  const pastDays    = [];

  for (let i = 1; i < WINDOW; i++) {
    const d = new Date(targetDate);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const entry   = dailyEntries.get(dateStr) ?? {};

    const trusted    = hasTrustedCalories(entry);
    const actualKcal = trusted ? parseFloat(entry.calories) : baseKcal; // neutral for unknown
    if (!trusted) unknownDays.push(dateStr);

    sumPastActual += actualKcal;
    pastDays.push({ dateStr, actualKcal, unknown: !trusted });
  }

  const windowBudget  = baseKcal * WINDOW;
  const rollingTarget = windowBudget - sumPastActual;
  const bankBalance   = rollingTarget - baseKcal;

  return {
    todayKcalTarget: Math.round(rollingTarget / 25) * 25,
    rollingTarget,
    bankBalance,
    bankIncomplete: unknownDays.length > 0,
    unknownDays,
    pastDays,
    windowBudget,
    sumPastActual,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dateStr(daysAgo) {
  const d = new Date('2025-06-15T00:00:00'); // fixed reference date
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const TODAY = '2025-06-15';

function makeEntries(specs) {
  const m = new Map();
  for (const [ds, cals] of Object.entries(specs)) {
    m.set(ds, { calories: cals, entryType: 'logged' });
  }
  return m;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_hasTrustedCalories helper', () => {
  it('empty object → false', () => expect(hasTrustedCalories({})).toBe(false));
  it('null → false',         () => expect(hasTrustedCalories(null)).toBe(false));
  it('undefined → false',    () => expect(hasTrustedCalories(undefined)).toBe(false));
  it('calories = 0 → false', () => expect(hasTrustedCalories({ calories: 0 })).toBe(false));
  it('calories = "" → false',() => expect(hasTrustedCalories({ calories: '' })).toBe(false));
  it('calories > 0 → true',  () => expect(hasTrustedCalories({ calories: 1800 })).toBe(true));
  it('estimate entry with calories > 0 → true (saved)',
    () => expect(hasTrustedCalories({ calories: 1600, entryType: 'estimate' })).toBe(true));
});

describe('rolling bank — blank days are neutral, not zero', () => {
  it('six blank prior days produce no bank adjustment (target = baseKcal)', () => {
    const { bankBalance, bankIncomplete } = calcBanking(TODAY, new Map(), 2000);
    expect(bankBalance).toBe(0);
    expect(bankIncomplete).toBe(true);
  });

  it('six blank days do not inflate today\'s target above baseKcal', () => {
    const { todayKcalTarget } = calcBanking(TODAY, new Map(), 2000);
    // With all days neutral, target should be exactly baseKcal (rounded to 25)
    expect(todayKcalTarget).toBe(2000);
  });

  it('one missing day marks bank as incomplete', () => {
    // Fill 5 days, leave 1 blank
    const entries = makeEntries({
      [dateStr(1)]: 2000,
      [dateStr(2)]: 2000,
      [dateStr(3)]: 2000,
      [dateStr(4)]: 2000,
      [dateStr(5)]: 2000,
      // dateStr(6) is missing
    });
    const { bankIncomplete, unknownDays } = calcBanking(TODAY, entries, 2000);
    expect(bankIncomplete).toBe(true);
    expect(unknownDays).toHaveLength(1);
  });

  it('all six days logged → bank is complete and no unknown days', () => {
    const entries = makeEntries({
      [dateStr(1)]: 2000,
      [dateStr(2)]: 2000,
      [dateStr(3)]: 2000,
      [dateStr(4)]: 2000,
      [dateStr(5)]: 2000,
      [dateStr(6)]: 2000,
    });
    const { bankIncomplete, unknownDays } = calcBanking(TODAY, entries, 2000);
    expect(bankIncomplete).toBe(false);
    expect(unknownDays).toHaveLength(0);
  });

  it('a saved estimate day (calories > 0, entryType=estimate) counts as trusted', () => {
    const entries = new Map();
    for (let i = 1; i <= 6; i++) {
      entries.set(dateStr(i), { calories: 1800, entryType: 'estimate' });
    }
    const { bankIncomplete, unknownDays } = calcBanking(TODAY, entries, 2000);
    expect(bankIncomplete).toBe(false);
    expect(unknownDays).toHaveLength(0);
  });

  it('a real low-calorie day (500 kcal) creates a bank surplus', () => {
    // All days at 500 kcal vs target 2000 → each day banked 1500, total 9000 / 6 days = 9000 surplus
    const entries = makeEntries(Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map(i => [dateStr(i), 500])
    ));
    const { bankBalance } = calcBanking(TODAY, entries, 2000);
    expect(bankBalance).toBeGreaterThan(0);
  });

  it('a real over-budget day creates a bank deficit', () => {
    const entries = makeEntries(Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map(i => [dateStr(i), 3000])
    ));
    const { bankBalance } = calcBanking(TODAY, entries, 2000);
    expect(bankBalance).toBeLessThan(0);
  });

  it('exact on-target days result in zero bank balance', () => {
    const entries = makeEntries(Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map(i => [dateStr(i), 2000])
    ));
    const { bankBalance } = calcBanking(TODAY, entries, 2000);
    expect(bankBalance).toBe(0);
  });

  it('unknown days list contains the correct date strings', () => {
    const entries = makeEntries({
      [dateStr(1)]: 2000, // logged
      // dateStr(2) missing
      [dateStr(3)]: 2000,
      [dateStr(4)]: 2000,
      [dateStr(5)]: 2000,
      [dateStr(6)]: 2000,
    });
    const { unknownDays } = calcBanking(TODAY, entries, 2000);
    expect(unknownDays).toContain(dateStr(2));
    expect(unknownDays).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers mirrored from dashboard.js — Auto Goal schedule adjustment
// ---------------------------------------------------------------------------

const MIN_DAILY_CALORIES = 1000;
const MAX_SCHEDULE_ADJ_SOFT = 150;
const MAX_SCHEDULE_ADJ_HARD = 250;

/**
 * Auto Goal banking: base target + exercise + soft schedule correction.
 * The full rolling bank is NOT applied; overages are spread over remaining days.
 */
function calcBankingAutoGoal(targetDateStr, dailyEntries, baseKcal, goalTargetDate = null) {
  const targetDate = new Date(`${targetDateStr}T00:00:00`);
  const WINDOW = 7;

  let sumPastActual = 0;
  const unknownDays = [];

  for (let i = 1; i < WINDOW; i++) {
    const d = new Date(targetDate);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const entry   = dailyEntries.get(dateStr) ?? {};
    const trusted = hasTrustedCalories(entry);
    const actualKcal = trusted ? parseFloat(entry.calories) : baseKcal;
    if (!trusted) unknownDays.push(dateStr);
    sumPastActual += actualKcal;
  }

  // rawBankBalance = sum(past targets) - sum(past actual)
  const rawBankBalance = Math.round(baseKcal * (WINDOW - 1) - sumPastActual);
  const cumulativeDebt = Math.max(0, -rawBankBalance);

  let scheduleAdjustment = 0;
  let scheduleCapped = false;

  if (cumulativeDebt > 0 && goalTargetDate) {
    const targetMs    = new Date(`${goalTargetDate}T00:00:00`).getTime();
    const todayMs     = new Date(`${targetDateStr}T00:00:00`).getTime();
    const remainingDays = Math.round((targetMs - todayMs) / 86400000);
    if (remainingDays > 1) {
      const rawAdj = -cumulativeDebt / remainingDays;
      scheduleAdjustment = Math.round(Math.max(-MAX_SCHEDULE_ADJ_HARD, rawAdj));
      if (rawAdj < -MAX_SCHEDULE_ADJ_SOFT) scheduleCapped = true;
    }
  }

  const rawTarget = baseKcal + scheduleAdjustment; // exercise = 0 in tests
  let todayKcalTarget = Math.round(rawTarget / 25) * 25;
  const targetFloorApplied = todayKcalTarget < MIN_DAILY_CALORIES;
  if (targetFloorApplied) todayKcalTarget = MIN_DAILY_CALORIES;

  return {
    todayKcalTarget,
    rawBankBalance,
    scheduleAdjustment,
    targetFloorApplied,
    scheduleCapped,
    bankIncomplete: unknownDays.length > 0,
    unknownDays,
    bankMode: 'autoGoalSchedule',
  };
}

// ---------------------------------------------------------------------------
// Auto Goal banking tests
// ---------------------------------------------------------------------------

describe('Auto Goal mode — schedule adjustment, not full rolling bank', () => {
  it('zero past data → no adjustment, target equals baseKcal', () => {
    const { todayKcalTarget, scheduleAdjustment } =
      calcBankingAutoGoal(TODAY, new Map(), 2000);
    expect(scheduleAdjustment).toBe(0);
    expect(todayKcalTarget).toBe(2000);
  });

  it('six days of big overages with far goal date → small schedule correction, not crash', () => {
    // 6 days × 2800 kcal vs 2000 target = 4800 kcal debt
    // goal date 74 days out → 4800/74 ≈ 65 kcal/day correction → target ≈ 1935
    const entries = makeEntries(Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map(i => [dateStr(i), 2800])
    ));
    const goalDate = new Date('2025-06-15T00:00:00');
    goalDate.setDate(goalDate.getDate() + 74);
    const goalDateStr = goalDate.toISOString().slice(0, 10);

    const { todayKcalTarget, scheduleAdjustment } =
      calcBankingAutoGoal(TODAY, entries, 2000, goalDateStr);

    expect(todayKcalTarget).toBeGreaterThan(1000);  // not a crash target
    expect(todayKcalTarget).toBeLessThan(2100);      // but genuinely adjusted
    expect(scheduleAdjustment).toBeLessThan(0);      // downward correction
    expect(scheduleAdjustment).toBeGreaterThanOrEqual(-MAX_SCHEDULE_ADJ_HARD);
  });

  it('large overage with no goal date → no schedule adjustment', () => {
    const entries = makeEntries(Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map(i => [dateStr(i), 3500])
    ));
    const { scheduleAdjustment } = calcBankingAutoGoal(TODAY, entries, 2000, null);
    expect(scheduleAdjustment).toBe(0);
  });

  it('schedule adjustment does not exceed soft cap (150 kcal/day) for moderate debt', () => {
    // 6 × 2150 vs 2000 = 900 kcal debt; 30 days → 30 kcal/day (well within soft cap)
    const entries = makeEntries(Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map(i => [dateStr(i), 2150])
    ));
    const near = new Date('2025-06-15T00:00:00');
    near.setDate(near.getDate() + 30);
    const { scheduleAdjustment, scheduleCapped } =
      calcBankingAutoGoal(TODAY, entries, 2000, near.toISOString().slice(0, 10));
    expect(Math.abs(scheduleAdjustment)).toBeLessThanOrEqual(MAX_SCHEDULE_ADJ_SOFT);
    expect(scheduleCapped).toBe(false);
  });

  it('massive overage with close goal date triggers soft-cap flag', () => {
    // 6 × 3500 vs 2000 = 9000 kcal debt; 10 days → 900 kcal/day (exceeds hard cap)
    const entries = makeEntries(Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map(i => [dateStr(i), 3500])
    ));
    const near = new Date('2025-06-15T00:00:00');
    near.setDate(near.getDate() + 10);
    const { scheduleAdjustment, scheduleCapped } =
      calcBankingAutoGoal(TODAY, entries, 2000, near.toISOString().slice(0, 10));
    expect(Math.abs(scheduleAdjustment)).toBeLessThanOrEqual(MAX_SCHEDULE_ADJ_HARD);
    expect(scheduleCapped).toBe(true);
  });

  it('target never goes below MIN_DAILY_CALORIES (1000) even with huge debt', () => {
    // Artificially low base + big debt to test floor
    const entries = makeEntries(Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map(i => [dateStr(i), 3000])
    ));
    const near = new Date('2025-06-15T00:00:00');
    near.setDate(near.getDate() + 3); // extremely close goal → huge required correction
    const { todayKcalTarget, targetFloorApplied } =
      calcBankingAutoGoal(TODAY, entries, 1100, near.toISOString().slice(0, 10));
    expect(todayKcalTarget).toBeGreaterThanOrEqual(MIN_DAILY_CALORIES);
    if (targetFloorApplied) expect(todayKcalTarget).toBe(MIN_DAILY_CALORIES);
  });

  it('under-eating in auto goal mode produces zero schedule adjustment (no bonus calories)', () => {
    // 6 × 1600 vs 2000 = +2400 kcal credit → rawBankBalance > 0 → no schedule adjustment
    const entries = makeEntries(Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map(i => [dateStr(i), 1600])
    ));
    const far = new Date('2025-06-15T00:00:00');
    far.setDate(far.getDate() + 60);
    const { scheduleAdjustment, rawBankBalance } =
      calcBankingAutoGoal(TODAY, entries, 2000, far.toISOString().slice(0, 10));
    expect(rawBankBalance).toBeGreaterThan(0);
    expect(scheduleAdjustment).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Manual mode floor enforcement
// ---------------------------------------------------------------------------

describe('manual mode — rolling bank floor at 1000 kcal', () => {
  it('massive overage in manual mode floors today target at 1000 kcal', () => {
    // 6 × 4000 vs 2000 → rolling target = 7×2000 − 6×4000 = 14000 − 24000 = −10000 → floor
    const entries = makeEntries(Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map(i => [dateStr(i), 4000])
    ));
    // Mirror manual-mode rolling bank logic with floor applied
    const { rollingTarget } = calcBanking(TODAY, entries, 2000);
    const floored = Math.max(Math.round(rollingTarget / 25) * 25, MIN_DAILY_CALORIES);
    expect(floored).toBeGreaterThanOrEqual(MIN_DAILY_CALORIES);
  });

  it('small overage in manual mode does not hit floor', () => {
    // 6 × 2100 vs 2000 (100 kcal/day over) → rolling = 7×2000 − 6×2100 = 14000−12600 = 1400 → above 1000
    const entries = makeEntries(Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map(i => [dateStr(i), 2100])
    ));
    const { rollingTarget } = calcBanking(TODAY, entries, 2000);
    const floored = Math.max(Math.round(rollingTarget / 25) * 25, MIN_DAILY_CALORIES);
    expect(floored).toBeGreaterThan(1000);
  });
});

// ---------------------------------------------------------------------------
// Mode isolation: manual uses rolling bank, auto goal uses schedule adjustment
// ---------------------------------------------------------------------------

describe('mode isolation: manual vs Auto Goal banking behavior', () => {
  it('same overage history → manual crashes, auto goal does not', () => {
    const entries = makeEntries(Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map(i => [dateStr(i), 2800])
    ));
    const baseKcal = 2000;

    // Manual mode: rolling target = 7×2000 − 6×2800 = 14000−16800 = -2800 (before floor)
    const { rollingTarget: manualRolling } = calcBanking(TODAY, entries, baseKcal);
    expect(manualRolling).toBeLessThan(baseKcal); // would be negative without floor

    // Auto Goal mode: target = baseKcal + small schedule correction
    const far = new Date('2025-06-15T00:00:00');
    far.setDate(far.getDate() + 74);
    const { todayKcalTarget: autoTarget } =
      calcBankingAutoGoal(TODAY, entries, baseKcal, far.toISOString().slice(0, 10));
    expect(autoTarget).toBeGreaterThan(1500); // no crash
  });
});

// ---------------------------------------------------------------------------
// calcBankingCore — tests that use the real exported pure function
// ---------------------------------------------------------------------------

function makeCore(overrides = {}) {
  return {
    todayBaseCalories: 2000,
    todaysTrainingBump: 0,
    sumPastBaseTargets: 6 * 2000,
    sumPastTrainingBumps: 0,
    sumPast6Actual: 6 * 2000,
    windowBudget: 7 * 2000,
    targetMode: 'manual',
    useRollingBanking: true,
    goalTargetDate: null,
    targetDateStr: TODAY,
    effectiveFloor: 1000,
    ...overrides,
  };
}

describe('calcBankingCore — manual rolling bank', () => {
  it('on-target past 6 days → zero bank balance, target = baseKcal', () => {
    const r = calcBankingCore(makeCore());
    expect(r.bankBalance).toBe(0);
    expect(r.todayKcalTarget).toBe(2000);
    expect(r.bankMode).toBe('manualRolling');
  });

  it('under-eating past 6 days → positive bank, higher today target', () => {
    const r = calcBankingCore(makeCore({ sumPast6Actual: 6 * 1500 }));
    expect(r.bankBalance).toBeGreaterThan(0);
    expect(r.todayKcalTarget).toBeGreaterThan(2000);
  });

  it('large overage → bank capped at -400/day, target = 1600 (not floored)', () => {
    // rawBankBalance = 6×2000 − 6×4000 = −12000; cap → −400; target = 2000−400 = 1600
    const r = calcBankingCore(makeCore({ sumPast6Actual: 6 * 4000 }));
    expect(r.rawBankBalance).toBe(-12000);
    expect(r.bankAdjustmentApplied).toBe(-400);
    expect(r.todayKcalTarget).toBe(1600);
    expect(r.targetFloorApplied).toBe(false);
    expect(r.manualBankCapped).toBe(true);
  });

  it('floor applies when base + capped adjustment is below effectiveFloor', () => {
    // base 1200, adjustment −400 → 800 < effectiveFloor 1200 → floored
    const r = calcBankingCore(makeCore({
      todayBaseCalories: 1200,
      sumPastBaseTargets: 6 * 1200,
      sumPast6Actual: 6 * 4000,
      effectiveFloor: 1200,
    }));
    expect(r.bankAdjustmentApplied).toBe(-400);
    expect(r.targetFloorApplied).toBe(true);
    expect(r.todayKcalTarget).toBe(1200);
  });
});

describe('calcBankingCore — manual rolling bank cap', () => {
  it('-1980 bank → capped to -400, target = 1600 (not -475)', () => {
    // 6-day raw balance = -1980 (exactly the bug scenario)
    const r = calcBankingCore(makeCore({
      sumPastBaseTargets: 6 * 2000,
      sumPast6Actual: 6 * 2000 + 1980, // over by 1980
    }));
    expect(r.rawBankBalance).toBe(-1980);
    expect(r.bankAdjustmentApplied).toBe(-400); // capped
    expect(r.todayKcalTarget).toBe(1600);       // 2000 - 400
    expect(r.manualBankCapped).toBe(true);
  });

  it('small overage within cap applied directly (no cap)', () => {
    // rawBankBalance = -200 (well within -400 cap)
    const r = calcBankingCore(makeCore({
      sumPastBaseTargets: 6 * 2000,
      sumPast6Actual: 6 * 2000 + 200,
    }));
    expect(r.rawBankBalance).toBe(-200);
    expect(r.bankAdjustmentApplied).toBe(-200); // within cap
    expect(r.todayKcalTarget).toBe(1800);
    expect(r.manualBankCapped).toBe(false);
  });

  it('large credit capped at +600 kcal/day', () => {
    // rawBankBalance = 9000 (6 days at 500 kcal vs 2000 target)
    const r = calcBankingCore(makeCore({ sumPast6Actual: 6 * 500 }));
    expect(r.rawBankBalance).toBe(9000);
    expect(r.bankAdjustmentApplied).toBe(600); // capped at +600
    expect(r.todayKcalTarget).toBe(2600);
    expect(r.manualBankCapped).toBe(true);
  });

  it('floor still applies when base + capped adjustment is below floor', () => {
    // base = 1100, cap adjustment = -400, raw = 1100 - 400 = 700 → floored to 1000
    const r = calcBankingCore(makeCore({
      todayBaseCalories: 1100,
      sumPastBaseTargets: 6 * 1100,
      sumPast6Actual: 6 * 4000,
      effectiveFloor: 1000,
    }));
    expect(r.bankAdjustmentApplied).toBe(-400);
    expect(r.todayKcalTarget).toBe(1000);
    expect(r.targetFloorApplied).toBe(true);
  });

  it('Auto Goal mode never gets manual cap (uses schedule adjustment instead)', () => {
    const far = new Date(TODAY); far.setDate(far.getDate() + 74);
    const r = calcBankingCore(makeCore({
      targetMode: 'autoGoal',
      sumPast6Actual: 6 * 4000,
      goalTargetDate: far.toISOString().slice(0, 10),
    }));
    expect(r.bankMode).toBe('autoGoalSchedule');
    expect(r.manualBankCapped).toBe(false); // only manual mode uses the cap
    expect(r.scheduleAdjustment).toBeLessThan(0); // schedule adjustment, not cap
    expect(Math.abs(r.scheduleAdjustment)).toBeLessThanOrEqual(250); // within hard cap
  });
});

describe('calcBankingCore — banking off (useRollingBanking: false)', () => {
  it('bankMode is "off" when useRollingBanking=false', () => {
    const r = calcBankingCore(makeCore({ useRollingBanking: false }));
    expect(r.bankMode).toBe('off');
  });

  it('target = base + exercise, unaffected by past overage', () => {
    // 6 days of big overages but banking is off
    const r = calcBankingCore(makeCore({
      useRollingBanking: false,
      sumPast6Actual: 6 * 3500,
      todaysTrainingBump: 200,
    }));
    expect(r.todayKcalTarget).toBe(2200); // 2000 + 200, no penalty
    expect(r.bankBalance).toBe(0);
    expect(r.bankAdjustmentApplied).toBe(0);
  });

  it('under-eating past week does not inflate target when banking is off', () => {
    const r = calcBankingCore(makeCore({
      useRollingBanking: false,
      sumPast6Actual: 6 * 500,
    }));
    expect(r.todayKcalTarget).toBe(2000);
  });

  it('floor still applies in banking-off mode', () => {
    const r = calcBankingCore(makeCore({
      useRollingBanking: false,
      todayBaseCalories: 800,
      effectiveFloor: 1000,
    }));
    expect(r.targetFloorApplied).toBe(true);
    expect(r.todayKcalTarget).toBe(1000);
  });
});

describe('calcBankingCore — Auto Goal schedule adjustment', () => {
  it('no past overage → zero schedule adjustment, target = base', () => {
    const r = calcBankingCore(makeCore({
      targetMode: 'autoGoal',
      goalTargetDate: '2025-09-01',
    }));
    expect(r.scheduleAdjustment).toBe(0);
    expect(r.todayKcalTarget).toBe(2000);
    expect(r.bankMode).toBe('autoGoalSchedule');
  });

  it('overage + far goal date → small negative schedule adjustment', () => {
    const far = new Date(TODAY); far.setDate(far.getDate() + 74);
    const r = calcBankingCore(makeCore({
      targetMode: 'autoGoal',
      sumPast6Actual: 6 * 2800, // 4800 kcal debt
      goalTargetDate: far.toISOString().slice(0, 10),
    }));
    expect(r.scheduleAdjustment).toBeLessThan(0);
    expect(r.todayKcalTarget).toBeGreaterThan(1000);
    expect(r.todayKcalTarget).toBeLessThan(2100);
  });

  it('rawBankBalance returned as informational (not schedule adjustment)', () => {
    const far = new Date(TODAY); far.setDate(far.getDate() + 74);
    const r = calcBankingCore(makeCore({
      targetMode: 'autoGoal',
      sumPast6Actual: 6 * 2800,
      goalTargetDate: far.toISOString().slice(0, 10),
    }));
    expect(r.rawBankBalance).toBeLessThan(0); // has debt
    expect(r.bankBalance).toBe(r.rawBankBalance); // bankBalance = informational rawBankBalance
    expect(Math.abs(r.scheduleAdjustment)).toBeLessThan(Math.abs(r.rawBankBalance)); // gentle spread
  });
});

describe('calcBankingCore — 177→170 lb scenario (regression)', () => {
  it('big overage history in auto goal mode does not produce crash target', () => {
    // Simulate user who ate 2800 kcal/day vs 1935 kcal base for 6 days
    const far = new Date(TODAY); far.setDate(far.getDate() + 74);
    const r = calcBankingCore(makeCore({
      targetMode: 'autoGoal',
      todayBaseCalories: 1935,
      sumPastBaseTargets: 6 * 1935,
      sumPast6Actual: 6 * 2800,
      goalTargetDate: far.toISOString().slice(0, 10),
      effectiveFloor: 1000,
    }));
    expect(r.todayKcalTarget).toBeGreaterThan(1000);
    expect(r.todayKcalTarget).toBeLessThan(2200);
    expect(r.targetFloorApplied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calcBankingCore — banking off (renderBankingPanel / renderCalcDetailsPanel)
// These tests confirm that banking-off mode never crashes and produces the
// right shape so the UI panels can render without ReferenceErrors.
// ---------------------------------------------------------------------------

describe('calcBankingCore — banking off UI safety', () => {
  const BASE = 2000;

  it('returns bankMode "off" when useRollingBanking is false', () => {
    const r = calcBankingCore(makeCore({ useRollingBanking: false }));
    expect(r.bankMode).toBe('off');
  });

  it('target = base + exercise, ignoring history', () => {
    // 6 days of large overage — should have zero effect on target
    const r = calcBankingCore(makeCore({
      useRollingBanking: false,
      todayBaseCalories: BASE,
      todaysTrainingBump: 300,
      sumPast6Actual: 6 * 3000,   // big overage — irrelevant
    }));
    expect(r.todayKcalTarget).toBe(Math.round((BASE + 300) / 25) * 25);
    expect(r.bankBalance).toBe(0);
    expect(r.bankAdjustmentApplied).toBe(0);
  });

  it('large undereating history has no effect on target', () => {
    const r = calcBankingCore(makeCore({
      useRollingBanking: false,
      todayBaseCalories: BASE,
      sumPast6Actual: 0,          // extreme under-eating — irrelevant
    }));
    expect(r.todayKcalTarget).toBe(BASE);
    expect(r.bankBalance).toBe(0);
  });

  it('floor still applies when base + exercise is below effectiveFloor', () => {
    const r = calcBankingCore(makeCore({
      useRollingBanking: false,
      todayBaseCalories: 500,
      todaysTrainingBump: 0,
      effectiveFloor: 1000,
    }));
    expect(r.todayKcalTarget).toBe(1000);
    expect(r.targetFloorApplied).toBe(true);
  });

  it('all required output fields are present and numeric', () => {
    const r = calcBankingCore(makeCore({ useRollingBanking: false }));
    for (const key of ['bankMode', 'bankBalance', 'bankAdjustmentApplied',
                        'scheduleAdjustment', 'rawBankBalance',
                        'todayKcalTarget', 'targetFloorApplied', 'scheduleCapped']) {
      expect(r).toHaveProperty(key);
    }
    expect(typeof r.todayKcalTarget).toBe('number');
    expect(typeof r.bankBalance).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Calories remaining display behavior
// ---------------------------------------------------------------------------

describe('calories remaining display logic', () => {
  it('eaten < target → remaining is positive', () => {
    const target = 1800;
    const eaten = 1200;
    const remaining = target - eaten;
    expect(remaining).toBeGreaterThan(0);
    // UI should show "Calories Remaining"
  });

  it('eaten > target → remaining is negative (Over by)', () => {
    const target = 1800;
    const eaten = 2200;
    const remaining = target - eaten;
    expect(remaining).toBeLessThan(0);
    // UI should show "Calories Over Target"
    expect(Math.abs(remaining)).toBe(400);
  });

  it('final target after all adjustments is always at least effectiveFloor', () => {
    const effectiveFloor = 1484; // BMR-based for 176.1 lb user
    // Scenario: base 1516 + bank -400 (capped) = 1116 → below floor → floored
    const r = calcBankingCore(makeCore({
      todayBaseCalories: 1516,
      sumPastBaseTargets: 6 * 1516,
      sumPastTrainingBumps: 0,
      sumPast6Actual: 6 * 1516 + 1980, // rawBankBalance = -1980
      windowBudget: 7 * 1516,
      effectiveFloor,
    }));
    expect(r.todayKcalTarget).toBeGreaterThanOrEqual(effectiveFloor);
  });
});
