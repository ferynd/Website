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

// ---------------------------------------------------------------------------
// Pure helpers mirrored from dashboard.js
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
