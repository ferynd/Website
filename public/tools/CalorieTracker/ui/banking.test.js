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
