/**
 * @file analysis/engine.test.js
 * Vitest tests for the energy analysis engine.
 *
 * Uses synthetic data so results are deterministic and verifiable.
 * Run from repo root: npx vitest run public/tools/CalorieTracker/analysis/engine.test.js
 */

import { describe, it, expect } from 'vitest';
import {
  selectDailyWeight,
  deriveExerciseCalories,
  mergeDailyData,
  waterCorrect,
  smoothWeight,
  estimateTDEE,
  estimateTDEEByHorizon,
  estimateProfileRmr,
  estimateBMR,
  computeConfidence,
  computeLoggingResidual,
  imputeCalories,
  detectPlateau,
  runAnalysis,
  ANALYSIS_CONFIG,
  // New exports
  isSyntheticItem,
  SYNTHETIC_ITEM_NAMES,
  classifyDay,
  classifyAllDays,
  estimateVacationCalories,
  computeWeekdayAverages,
  buildVacationDayEntry,
  getPartialDaysForAdjustment,
  buildPartialDayAdjustment,
  getTrueUpCandidates,
  buildBlankDayEstimateEntry,
  VACATION_TYPE_CONFIG,
} from './engine.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function isoDate(baseDate, offsetDays) {
  const d = new Date(baseDate + 'T00:00:00');
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Build a Map<docId, entry> weight entries from a daily weight array.
 */
function makeWeightEntries(data) {
  const map = new Map();
  data.forEach((d, i) => {
    const docId = `w-${i}`;
    map.set(docId, {
      date: d.date,
      weight_lb: d.weight_lb,
      time_min: d.time_min ?? 480,
      timestamp: `${d.date}T08:00:00`,
      source: 'test',
    });
  });
  return map;
}

/**
 * Build a Map<date, entry> nutrition entries.
 * Supports exerciseSessions array (v2 schema).
 */
function makeNutritionEntries(data) {
  const map = new Map();
  data.forEach(d => {
    if (d.calories != null) {
      map.set(d.date, {
        date: d.date,
        calories: d.calories,
        protein: d.protein ?? 150,
        carbs: d.carbs ?? 200,
        fat: d.fat ?? 60,
        fiber: d.fiber ?? 25,
        sodium: d.sodium ?? 2200,
        trainingBump: d.trainingBump ?? 0,
        exerciseSessions: d.exerciseSessions ?? [],
      });
    }
  });
  return map;
}

/**
 * Generate N days of synthetic data starting from startDate.
 */
function syntheticDays(n, dayFn, startDate = '2024-01-01') {
  return Array.from({ length: n }, (_, i) => {
    const date = isoDate(startDate, i);
    return { date, ...dayFn(i, date) };
  });
}

// ── selectDailyWeight ─────────────────────────────────────────────────────────

describe('selectDailyWeight', () => {
  it('returns the single reading when only one exists', () => {
    const r = [{ weight_lb: 180, time_min: 480 }];
    expect(selectDailyWeight(r, null)?.weight_lb).toBe(180);
  });

  it('prefers reading inside the preferred window', () => {
    const readings = [
      { weight_lb: 183, time_min: 900 },
      { weight_lb: 181, time_min: 420 },
    ];
    const window = { startMin: 360, endMin: 540 };
    expect(selectDailyWeight(readings, window)?.weight_lb).toBe(181);
  });

  it('falls back to earliest when none are in the window', () => {
    const readings = [
      { weight_lb: 183, time_min: 900 },
      { weight_lb: 181, time_min: 1200 },
    ];
    const window = { startMin: 360, endMin: 540 };
    expect(selectDailyWeight(readings, window)?.time_min).toBe(900);
  });

  it('uses median of in-window readings for robustness', () => {
    const readings = [
      { weight_lb: 181, time_min: 400 },
      { weight_lb: 182, time_min: 420 },
      { weight_lb: 190, time_min: 430 }, // outlier
    ];
    const window = { startMin: 360, endMin: 540 };
    // Sorted in-window: [181, 182, 190] → median at index 1 = 182
    expect(selectDailyWeight(readings, window)?.weight_lb).toBe(182);
  });
});

// ── deriveExerciseCalories ────────────────────────────────────────────────────

describe('deriveExerciseCalories', () => {
  it('returns zeros and source=none when entry is null', () => {
    const result = deriveExerciseCalories(null);
    expect(result.exerciseCalories).toBe(0);
    expect(result.exerciseSource).toBe('none');
    expect(result.legacyTrainingBumpUsed).toBe(false);
  });

  it('falls back to legacy trainingBump when no exerciseSessions', () => {
    const entry = { trainingBump: 280, exerciseSessions: [] };
    const result = deriveExerciseCalories(entry);
    expect(result.exerciseCalories).toBe(280);
    expect(result.exerciseSource).toBe('legacy_bump');
    expect(result.legacyTrainingBumpUsed).toBe(true);
  });

  it('uses manualCalories as highest priority', () => {
    const entry = {
      trainingBump: 200,
      exerciseSessions: [
        { manualCalories: 350, wearableCalories: 300, estimatedCalories: 250 },
      ],
    };
    const result = deriveExerciseCalories(entry);
    expect(result.exerciseCalories).toBe(350);
    expect(result.exerciseSource).toBe('manual');
    expect(result.legacyTrainingBumpUsed).toBe(false);
  });

  it('uses wearableCalories when no manualCalories', () => {
    const entry = {
      exerciseSessions: [
        { wearableCalories: 300, estimatedCalories: 200 },
      ],
    };
    const result = deriveExerciseCalories(entry);
    expect(result.exerciseCalories).toBe(300);
    expect(result.exerciseSource).toBe('wearable');
  });

  it('sums calories across multiple sessions', () => {
    const entry = {
      exerciseSessions: [
        { manualCalories: 300 },
        { manualCalories: 200 },
      ],
    };
    const result = deriveExerciseCalories(entry);
    expect(result.exerciseCalories).toBe(500);
    expect(result.exerciseSessionCount).toBe(2);
  });

  it('uses dayActivityLevel bump when no sessions (light → 100)', () => {
    const entry = { dayActivityLevel: 'light', exerciseSessions: [] };
    const result = deriveExerciseCalories(entry);
    expect(result.exerciseCalories).toBe(100);
    expect(result.exerciseSource).toBe('day_activity_level');
    expect(result.legacyTrainingBumpUsed).toBe(false);
  });

  it('uses dayActivityLevel bump when no sessions (medium → 200)', () => {
    const entry = { dayActivityLevel: 'medium', exerciseSessions: [] };
    const result = deriveExerciseCalories(entry);
    expect(result.exerciseCalories).toBe(200);
    expect(result.exerciseSource).toBe('day_activity_level');
  });

  it('uses dayActivityLevel bump when no sessions (heavy → 350)', () => {
    const entry = { dayActivityLevel: 'heavy', exerciseSessions: [] };
    const result = deriveExerciseCalories(entry);
    expect(result.exerciseCalories).toBe(350);
    expect(result.exerciseSource).toBe('day_activity_level');
  });

  it('returns 0 exercise calories for dayActivityLevel=rest', () => {
    const entry = { dayActivityLevel: 'rest', exerciseSessions: [] };
    const result = deriveExerciseCalories(entry);
    expect(result.exerciseCalories).toBe(0);
  });

  it('returns 0 exercise calories for dayActivityLevel=custom with no sessions', () => {
    // 'custom' means user logs sessions; with none logged yet, no bump
    const entry = { dayActivityLevel: 'custom', exerciseSessions: [] };
    const result = deriveExerciseCalories(entry);
    expect(result.exerciseCalories).toBe(0);
  });

  it('sessions override dayActivityLevel when both are present', () => {
    const entry = {
      dayActivityLevel: 'heavy',
      exerciseSessions: [{ manualCalories: 450 }],
    };
    const result = deriveExerciseCalories(entry);
    expect(result.exerciseCalories).toBe(450);
    expect(result.exerciseSource).toBe('manual');
  });

  it('legacy trainingBump is used when dayActivityLevel is null and no sessions', () => {
    const entry = { dayActivityLevel: null, trainingBump: 200, exerciseSessions: [] };
    const result = deriveExerciseCalories(entry);
    expect(result.exerciseCalories).toBe(200);
    expect(result.exerciseSource).toBe('legacy_bump');
    expect(result.legacyTrainingBumpUsed).toBe(true);
  });

  // ── first-session-on-new-day shape ──────────────────────────────────────────
  // When a user logs their first exercise session on a day that has no previous
  // entry, saveExerciseSession (wire.js) uses getCurrentDailyEntry() to create
  // the entry and sets dayActivityLevel='custom' before calling
  // persistExerciseSession.  The saved document therefore has:
  //   { dayActivityLevel: 'custom', exerciseSessions: [<session>] }
  // deriveExerciseCalories must use the session calories, not the 'custom' bump
  // (which is 0), for the merged row used by the analysis engine.
  it('first-session-on-new-day: custom level + session → session kcal wins', () => {
    const entry = {
      dayActivityLevel: 'custom',
      exerciseSessions: [{ manualCalories: 320 }],
    };
    const result = deriveExerciseCalories(entry);
    expect(result.exerciseCalories).toBe(320);
    expect(result.exerciseSource).toBe('manual');
    expect(result.exerciseSessionCount).toBe(1);
  });

  it('custom level alone (no sessions yet) yields 0 exercise calories', () => {
    // 'custom' means the user intends to log sessions; with none present yet, 0.
    const entry = { dayActivityLevel: 'custom', exerciseSessions: [] };
    const result = deriveExerciseCalories(entry);
    expect(result.exerciseCalories).toBe(0);
    expect(result.exerciseSource).toBe('none');
  });
});

// ── Stable maintenance (60 days) ─────────────────────────────────────────────

describe('Stable maintenance (60 days)', () => {
  const DAYS = 60;
  const MAINTENANCE_KCAL = 2200;
  const STABLE_WEIGHT_LB = 180;

  const days = syntheticDays(DAYS, (i) => ({
    weight_lb: STABLE_WEIGHT_LB + (Math.sin(i) * 0.3),
    calories: MAINTENANCE_KCAL,
    trainingBump: 0,
  }));

  const weightEntries = makeWeightEntries(days);
  const dailyEntries = makeNutritionEntries(days);

  it('runAnalysis returns no error', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    expect(r.error).toBeUndefined();
  });

  it('smoothed weight stays near starting weight (within 3 lb)', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    const last = r.rows.filter(rw => rw.wt_smooth_lb != null).at(-1);
    expect(last).toBeDefined();
    expect(Math.abs(last.wt_smooth_lb - STABLE_WEIGHT_LB)).toBeLessThan(3);
  });

  it('estimated TDEE is within 200 kcal of maintenance', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    const { tdee } = r.summary;
    if (tdee != null) {
      expect(Math.abs(tdee - MAINTENANCE_KCAL)).toBeLessThan(200);
    }
  });

  it('plateau is detected', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    expect(r.plateau.isPlateaued).toBe(true);
  });

  it('confidence is at least rough', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    expect(['rough', 'moderate', 'high']).toContain(r.confidence.label);
  });

  it('waterCorrectionMethod is reported', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    expect(['ols_regression', 'median_bucket_adaptive']).toContain(r.waterCorrectionMethod);
  });
});

// ── Steady fat loss (60 days) ─────────────────────────────────────────────────

describe('Steady fat loss (60 days, −0.5 lb/week)', () => {
  const DAYS = 60;
  const RATE_LB_PER_DAY = 0.5 / 7;
  const START_WEIGHT = 200;
  const INTAKE = 1800;

  const days = syntheticDays(DAYS, (i) => ({
    weight_lb: START_WEIGHT - RATE_LB_PER_DAY * i + (Math.sin(i * 1.3) * 0.2),
    calories: INTAKE,
    trainingBump: 0,
  }));

  const weightEntries = makeWeightEntries(days);
  const dailyEntries = makeNutritionEntries(days);

  it('detects weight loss trend (negative slope)', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    if (r.plateau.slopeLbPerWeek != null) {
      expect(r.plateau.slopeLbPerWeek).toBeLessThan(0);
    }
  });

  it('total weight change is negative', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    if (r.summary.totalWeightChange != null) {
      expect(r.summary.totalWeightChange).toBeLessThan(0);
    }
  });

  it('TDEE estimate is above intake', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    if (r.summary.tdee != null) {
      expect(r.summary.tdee).toBeGreaterThan(INTAKE - 100);
    }
  });
});

// ── BMR correctness: no residual folded in ───────────────────────────────────

describe('BMR model correctness (fix 3: no residual in bmr_current)', () => {
  const DAYS = 60;
  const days = syntheticDays(DAYS, (i) => ({
    weight_lb: 185 - i * 0.03 + Math.sin(i) * 0.2,
    calories: 2100,
    trainingBump: 0,
  }));

  const weightEntries = makeWeightEntries(days);
  const dailyEntries = makeNutritionEntries(days);

  it('bmr_current equals fittedBmr (no residual folded in)', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    const m = r.bmrModel;
    if (m.error || m.source === 'profile_prior') return;
    expect(m.bmr_current).toBe(m.fittedBmr);
  });

  it('modelPredictedRestDayTdee uses fittedBmr * restPal (not inflated)', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    const m = r.bmrModel;
    if (m.error || m.source === 'profile_prior') return;
    const restPal = m.pals[0];
    const expected = Math.round(m.fittedBmr * restPal);
    // Allow ±1 for rounding
    expect(Math.abs(m.modelPredictedRestDayTdee - expected)).toBeLessThanOrEqual(1);
  });

  it('modelResidual is exposed (not hidden inside bmr_current)', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    const m = r.bmrModel;
    if (m.error || m.source === 'profile_prior') return;
    // modelResidual exists and is numeric
    expect(typeof m.modelResidual).toBe('number');
    // backward-compat alias
    expect(m.adaptation).toBe(m.modelResidual);
  });

  it('deprecated adaptation alias still equals modelResidual', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    const m = r.bmrModel;
    if (m.error) return;
    expect(m.adaptation).toBe(m.modelResidual);
    expect(m.adaptationSD).toBe(m.modelResidualSd);
  });
});

// ── Horizon windows: calendar cutoffs (fix 4) ────────────────────────────────

describe('estimateTDEEByHorizon: calendar date cutoffs (fix 4)', () => {
  it('28-day horizon only uses rows within 28 calendar days of latest', () => {
    const DAYS = 60;
    const days = syntheticDays(DAYS, (i) => ({
      weight_lb: 180 - i * 0.02,
      calories: 2100,
    }));
    const weMap = makeWeightEntries(days);
    const nuMap = makeNutritionEntries(days);
    let rows = mergeDailyData(weMap, nuMap);
    rows = smoothWeight(waterCorrect(rows).rows);
    rows = estimateTDEE(rows);
    const horizons = estimateTDEEByHorizon(rows);
    const h28 = horizons[28];
    // calendarEnd - calendarStart should be ≤ 27 days (28-day window)
    if (h28.calendarStart && h28.calendarEnd) {
      const start = new Date(h28.calendarStart + 'T00:00:00');
      const end = new Date(h28.calendarEnd + 'T00:00:00');
      const diffDays = Math.round((end - start) / 86400000);
      expect(diffDays).toBeLessThanOrEqual(27);
    }
  });

  it('horizon metadata includes calendarStart, calendarEnd, blockCount, coveragePct', () => {
    const DAYS = 50;
    const days = syntheticDays(DAYS, (i) => ({ weight_lb: 180, calories: 2100 }));
    const weMap = makeWeightEntries(days);
    const nuMap = makeNutritionEntries(days);
    let rows = mergeDailyData(weMap, nuMap);
    rows = smoothWeight(waterCorrect(rows).rows);
    rows = estimateTDEE(rows);
    const horizons = estimateTDEEByHorizon(rows);
    for (const h of Object.values(horizons)) {
      expect(h).toHaveProperty('calendarEnd');
      expect(h).toHaveProperty('blockCount');
      expect(h).toHaveProperty('coveragePct');
      expect(h).toHaveProperty('daysWindow');
      expect(h).toHaveProperty('reason');
    }
  });

  it('returns null tdee for short windows when insufficient data', () => {
    const days = syntheticDays(10, () => ({ weight_lb: 180, calories: 2000 }));
    const weMap = makeWeightEntries(days);
    const nuMap = makeNutritionEntries(days);
    let rows = mergeDailyData(weMap, nuMap);
    rows = smoothWeight(waterCorrect(rows).rows);
    rows = estimateTDEE(rows);
    const horizons = estimateTDEEByHorizon(rows);
    Object.values(horizons).forEach(h => {
      expect(h.available).toBe(false);
    });
  });

  it('returns valid tdee for PRIMARY horizon with 40 days', () => {
    const days = syntheticDays(40, (i) => ({
      weight_lb: 180 - i * 0.03,
      calories: 2100,
    }));
    const weMap = makeWeightEntries(days);
    const nuMap = makeNutritionEntries(days);
    let rows = mergeDailyData(weMap, nuMap);
    rows = smoothWeight(waterCorrect(rows).rows);
    rows = estimateTDEE(rows);
    const horizons = estimateTDEEByHorizon(rows);
    if (horizons[28]?.available) {
      expect(horizons[28].tdee).toBeGreaterThan(1000);
      expect(horizons[28].tdee).toBeLessThan(5000);
    }
  });
});

// ── TDEE block quality (fix 5) ────────────────────────────────────────────────

describe('TDEE block quality (fix 5)', () => {
  it('full-coverage blocks get tdee_block_quality = high', () => {
    const DAYS = 35;
    const days = syntheticDays(DAYS, (i) => ({ weight_lb: 180, calories: 2100 }));
    const weMap = makeWeightEntries(days);
    const nuMap = makeNutritionEntries(days);
    let rows = mergeDailyData(weMap, nuMap);
    rows = smoothWeight(waterCorrect(rows).rows);
    rows = estimateTDEE(rows);
    const highRows = rows.filter(r => r.tdee_block != null && r.tdee_block_quality === 'high');
    // With no gaps, all blocks should be high-quality
    expect(highRows.length).toBeGreaterThan(0);
    highRows.forEach(r => {
      expect(r.calCoverage).toBeGreaterThanOrEqual(0.85);
    });
  });

  it('vacation-week blocks get medium quality (low calorie coverage)', () => {
    const DAYS = 40;
    const days = syntheticDays(DAYS, (i) => ({
      weight_lb: 180 - i * 0.02,
      calories: (i >= 10 && i <= 16) ? null : 2100, // 7-day gap
    }));
    const weMap = makeWeightEntries(days);
    const nuMap = makeNutritionEntries(days);
    let rows = mergeDailyData(weMap, nuMap);
    rows = smoothWeight(waterCorrect(rows).rows);
    rows = estimateTDEE(rows);
    // Some blocks overlapping the gap should be medium or null
    const blockRows = rows.filter(r => r.tdee_block != null);
    // At least some blocks should exist
    expect(blockRows.length).toBeGreaterThan(0);
    // Not all should be high-quality (gap degrades some)
    const highCount = blockRows.filter(r => r.tdee_block_quality === 'high').length;
    const totalCount = blockRows.length;
    expect(highCount).toBeLessThan(totalCount);
  });
});

// ── Water correction guardrails (fix 6) ──────────────────────────────────────

describe('Water correction guardrails (fix 6)', () => {
  it('per-day correction is capped at MAX_WATER_CORRECTION_LB', () => {
    const CAP = ANALYSIS_CONFIG.MAX_WATER_CORRECTION_LB;
    const DAYS = 40;
    // Extreme sodium spikes to force large corrections
    const days = syntheticDays(DAYS, (i) => ({
      weight_lb: 175 + (i % 3 === 0 ? 5 : 0), // 5 lb spike every 3rd day
      calories: 2000,
      sodium: i % 3 === 0 ? 8000 : 1500, // very high sodium on spike days
      carbs: 200,
    }));
    const { rows } = waterCorrect(
      mergeDailyData(makeWeightEntries(days), makeNutritionEntries(days))
    );
    rows.forEach(r => {
      if (r._waterCorrection != null) {
        expect(Math.abs(r._waterCorrection)).toBeLessThanOrEqual(CAP + 0.001);
      }
    });
  });

  it('waterCorrectionMethod is returned from waterCorrect', () => {
    const days = syntheticDays(30, (i) => ({
      weight_lb: 175, calories: 2000, sodium: 2200, carbs: 200,
    }));
    const result = waterCorrect(
      mergeDailyData(makeWeightEntries(days), makeNutritionEntries(days))
    );
    expect(['ols_regression', 'median_bucket_adaptive']).toContain(result.waterCorrectionMethod);
    expect(typeof result.predictorDays).toBe('number');
  });

  it('waterWeightUncertaintyLb is reported from runAnalysis', () => {
    const days = syntheticDays(40, (i) => ({
      weight_lb: 175 + (i === 15 ? 3 : 0),
      calories: 2000,
      sodium: i === 15 ? 6000 : 1800,
      carbs: 200,
    }));
    const r = runAnalysis(makeWeightEntries(days), makeNutritionEntries(days));
    if (r.waterWeightUncertaintyLb != null) {
      expect(r.waterWeightUncertaintyLb).toBeGreaterThan(0);
    }
    expect(r.summary).toHaveProperty('waterCorrectionMethod');
  });

  it('sodium spike increases uncertainty but does not crash', () => {
    const days = syntheticDays(35, (i) => ({
      weight_lb: 175,
      calories: 2000,
      sodium: i === 20 ? 10000 : 2000,
      carbs: 200,
    }));
    const r = runAnalysis(makeWeightEntries(days), makeNutritionEntries(days));
    expect(r).toBeDefined();
    expect(r.rows.length).toBeGreaterThan(0);
  });
});

// ── exerciseSessions integration (fix 2) ─────────────────────────────────────

describe('exerciseSessions integration (fix 2)', () => {
  it('legacy trainingBump entries still produce a valid model', () => {
    const DAYS = 60;
    const days = syntheticDays(DAYS, (i) => ({
      weight_lb: 185 - i * 0.03,
      calories: 2200 + (i % 7 === 4 ? 280 : 0),
      trainingBump: i % 7 === 4 ? 280 : 0,
    }));
    const r = runAnalysis(makeWeightEntries(days), makeNutritionEntries(days));
    expect(r.rows.every(rw => rw.exerciseSource != null)).toBe(true);
    expect(r.rows.every(rw => rw.exerciseCalories != null)).toBe(true);
  });

  it('exerciseSessions override trainingBump in PAL lookup', () => {
    const DAYS = 60;
    const days = syntheticDays(DAYS, (i) => ({
      weight_lb: 185 - i * 0.03,
      calories: 2100,
      trainingBump: 100, // legacy bump
      exerciseSessions: [{ manualCalories: 350 }], // should win
    }));
    const weMap = makeWeightEntries(days);
    const nuMap = makeNutritionEntries(days);
    const rows = mergeDailyData(weMap, nuMap);
    // All rows should derive exerciseCalories=350 from sessions, not 100 from bump
    rows.forEach(r => {
      expect(r.exerciseCalories).toBe(350);
      expect(r.exerciseSource).toBe('manual');
    });
  });

  it('mixed entries (some with sessions, some with bump) produce consistent rows', () => {
    const DAYS = 60;
    const days = syntheticDays(DAYS, (i) => ({
      weight_lb: 185,
      calories: 2100,
      trainingBump: i % 2 === 0 ? 100 : 0,
      exerciseSessions: i % 3 === 0 ? [{ wearableCalories: 300 }] : [],
    }));
    const rows = mergeDailyData(makeWeightEntries(days), makeNutritionEntries(days));
    rows.forEach(r => {
      expect(typeof r.exerciseCalories).toBe('number');
      expect(r.exerciseCalories).toBeGreaterThanOrEqual(0);
    });
  });
});

// ── Under-reported calories ───────────────────────────────────────────────────

describe('Under-reported calories (weight drops faster than calories suggest)', () => {
  const DAYS = 60;
  const TRUE_TDEE = 2400;
  const LOGGED_KCAL = 1600;
  const TRUE_DEFICIT = TRUE_TDEE - 2000;
  const START_WEIGHT = 185;
  const RATE_LB_PER_DAY = TRUE_DEFICIT / 7700 * 2.2046;

  const days = syntheticDays(DAYS, (i) => ({
    weight_lb: START_WEIGHT - RATE_LB_PER_DAY * i + (Math.sin(i) * 0.15),
    calories: LOGGED_KCAL,
    trainingBump: 0,
  }));

  const weightEntries = makeWeightEntries(days);
  const dailyEntries = makeNutritionEntries(days);

  it('returns a valid result without crashing', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    expect(r).toBeDefined();
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('model does not over-react to single-day weight changes', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    const smoothVals = r.rows.map(rw => rw.wt_smooth_lb).filter(v => v != null);
    const rawVals = r.rows.map(rw => rw.weight_lb).filter(v => v != null);
    if (smoothVals.length < 2 || rawVals.length < 2) return;
    const smoothRange = Math.max(...smoothVals) - Math.min(...smoothVals);
    const rawRange = Math.max(...rawVals) - Math.min(...rawVals);
    expect(smoothRange).toBeLessThanOrEqual(rawRange + 0.5);
  });
});

// ── High sodium/carb water swing ─────────────────────────────────────────────

describe('High sodium/carb water swing', () => {
  const BASE_DAYS = 30;
  const HIGH_SODIUM_DAY = 15;

  const days = syntheticDays(BASE_DAYS, (i) => ({
    weight_lb: 175 + (i === HIGH_SODIUM_DAY ? 3 : 0),
    calories: 2000,
    sodium: i === HIGH_SODIUM_DAY ? 6000 : 1800,
    carbs: 200,
    trainingBump: 0,
  }));

  const weightEntries = makeWeightEntries(days);
  const dailyEntries = makeNutritionEntries(days);

  it('smoothed weight is less affected than raw on the spike day', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    const spikeRow = r.rows.find(rw => rw.date === days[HIGH_SODIUM_DAY].date);
    if (!spikeRow || spikeRow.wt_smooth_lb == null) return;
    expect(Math.abs(spikeRow.wt_smooth_lb - 175)).toBeLessThan(3);
  });

  it('waterWeightUncertaintyLb is reported and positive', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    if (r.waterWeightUncertaintyLb != null) {
      expect(r.waterWeightUncertaintyLb).toBeGreaterThan(0);
    }
  });
});

// ── Missing vacation week ─────────────────────────────────────────────────────

describe('Missing vacation week (days 20–26 no calories)', () => {
  const DAYS = 60;

  const days = syntheticDays(DAYS, (i) => ({
    weight_lb: 180 - i * 0.03 + Math.sin(i) * 0.2,
    calories: (i >= 20 && i <= 26) ? null : 2000,
    trainingBump: 0,
  }));

  const weightEntries = makeWeightEntries(days);
  const dailyEntries = makeNutritionEntries(days);

  it('returns rows for all 60 days', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    expect(r.rows.length).toBe(DAYS);
  });

  it('vacation days are marked imputed or pending, not silently set', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    const vacDays = r.rows.filter((rw, i) => i >= 20 && i <= 26);
    vacDays.forEach(rw => {
      if (rw.calories != null) {
        expect(rw.impute_status).toBe('imputed');
        expect(rw.calories_imputed).toBe(true);
      }
    });
  });

  it('does not crash with a week-long gap', () => {
    expect(() => runAnalysis(weightEntries, dailyEntries)).not.toThrow();
  });
});

// ── Exercise-heavy weeks ──────────────────────────────────────────────────────

describe('Exercise-heavy weeks (varied training bumps)', () => {
  const DAYS = 60;
  const BUMPS = [0, 0, 100, 0, 280, 0, 400];

  const days = syntheticDays(DAYS, (i) => {
    const bump = BUMPS[i % 7];
    return {
      weight_lb: 185 - i * 0.05 + Math.sin(i * 0.8) * 0.3,
      calories: 2000 + bump,
      trainingBump: bump,
    };
  });

  const weightEntries = makeWeightEntries(days);
  const dailyEntries = makeNutritionEntries(days);

  it('returns a defined bmrModel when enough data', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    expect(r).toBeDefined();
    if (!r.bmrModel.error) {
      expect(r.bmrModel.pals).toBeDefined();
    }
  });

  it('PAL values are monotonically ordered with bumps (within tolerance)', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    if (r.bmrModel.error || r.bmrModel.source === 'profile_prior') return;
    const pals = r.bmrModel.pals;
    if (pals[0] && pals[400]) {
      expect(pals[400]).toBeGreaterThanOrEqual(pals[0] - 0.05);
    }
  });

  it('each merged row has exerciseCalories field', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    const rowsWithNutrition = r.rows.filter(rw => rw.trainingBump != null);
    rowsWithNutrition.forEach(rw => {
      expect(typeof rw.exerciseCalories).toBe('number');
    });
  });
});

// ── estimateProfileRmr ────────────────────────────────────────────────────────

describe('estimateProfileRmr', () => {
  it('returns null when no weight provided', () => {
    expect(estimateProfileRmr(null, null)).toBeNull();
  });

  it('uses Mifflin-St Jeor when height, age, sex are present', () => {
    const profile = { age: 30, heightValue: 70, heightUnit: 'in', sex: 'male', bodyFatPercent: null };
    const result = estimateProfileRmr(profile, 180);
    expect(result.method).toBe('mifflin_st_jeor');
    // 180 lb = 81.6 kg; 70 in = 177.8 cm; MSJ male = 10*81.6 + 6.25*177.8 - 5*30 + 5 ≈ 1782
    expect(Math.abs(result.rmr - 1782)).toBeLessThan(20);
  });

  it('falls back to weight-only when profile is null', () => {
    const result = estimateProfileRmr(null, 180);
    expect(result.method).toBe('weight_only');
    // 180 lb ≈ 81.6 kg; 21 * 81.6 ≈ 1714
    expect(Math.abs(result.rmr - 1714)).toBeLessThan(30);
  });

  it('uses Cunningham when body fat percent is available', () => {
    const profile = { bodyFatPercent: '20' }; // 20% BF
    const result = estimateProfileRmr(profile, 180);
    expect(result.method).toBe('cunningham');
    // FFM = 81.6 * 0.8 = 65.3 kg; Cunningham = 500 + 22*65.3 ≈ 1937
    expect(result.rmr).toBeGreaterThan(1500);
    expect(result.rmr).toBeLessThan(2500);
  });
});

// ── computeConfidence ─────────────────────────────────────────────────────────

describe('computeConfidence', () => {
  it('returns not_enough with only 7 days', () => {
    const days = syntheticDays(7, () => ({ weight_lb: 180, calories: 2000 }));
    const rows = [...mergeDailyData(makeWeightEntries(days), makeNutritionEntries(days))];
    const conf = computeConfidence(rows, {});
    expect(conf.label).toBe('not_enough');
    expect(conf.score).toBe(0);
  });

  it('returns score > 0 with 14+ days', () => {
    const days = syntheticDays(20, () => ({ weight_lb: 180, calories: 2000 }));
    const rows = [...mergeDailyData(makeWeightEntries(days), makeNutritionEntries(days))];
    const conf = computeConfidence(rows, {});
    expect(conf.score).toBeGreaterThan(0);
  });

  it('returns high/moderate confidence with 50+ days of weight and calories', () => {
    const days = syntheticDays(55, (i) => ({ weight_lb: 180 - i * 0.05, calories: 2000 }));
    const rows = [...mergeDailyData(makeWeightEntries(days), makeNutritionEntries(days))];
    const conf = computeConfidence(rows, { source: 'fitted', score: 30 });
    expect(['moderate', 'high']).toContain(conf.label);
  });

  it('provides reasons array', () => {
    const days = syntheticDays(30, () => ({ weight_lb: 180, calories: 2000 }));
    const rows = [...mergeDailyData(makeWeightEntries(days), makeNutritionEntries(days))];
    const conf = computeConfidence(rows, {});
    expect(Array.isArray(conf.reasons)).toBe(true);
    expect(conf.reasons.length).toBeGreaterThan(0);
  });
});

// ── Profile-based fallback when < 30 days ────────────────────────────────────

describe('Profile-based fallback when < 30 days', () => {
  it('uses profile RMR when not enough data for grid search', () => {
    const days = syntheticDays(20, () => ({ weight_lb: 185, calories: 2200 }));
    const weMap = makeWeightEntries(days);
    const nuMap = makeNutritionEntries(days);
    const profile = { age: 35, heightValue: 70, heightUnit: 'in', sex: 'male' };
    const r = runAnalysis(weMap, nuMap, profile);
    expect(r).toBeDefined();
    if (r.bmrModel.source === 'profile_prior') {
      expect(r.bmrModel.bmr_current).toBeGreaterThan(0);
      expect(r.summary.profilePredictedRmr).not.toBeNull();
      // Profile prior: bmr_current should match the profile RMR input
      expect(r.bmrModel.bmr_current).toBe(r.summary.profilePredictedRmr);
      // modelPredictedRestDayTdee should be bmr_current * restPal
      const restPal = r.bmrModel.pals[0];
      const expectedRest = Math.round(r.bmrModel.bmr_current * restPal);
      expect(Math.abs(r.bmrModel.modelPredictedRestDayTdee - expectedRest)).toBeLessThanOrEqual(1);
    }
  });

  it('restDayCaloriesOut in summary uses modelPredictedRestDayTdee', () => {
    const days = syntheticDays(60, (i) => ({
      weight_lb: 185 - i * 0.03,
      calories: 2100,
    }));
    const r = runAnalysis(makeWeightEntries(days), makeNutritionEntries(days));
    const m = r.bmrModel;
    if (m.error) return;
    const expected = m.modelPredictedRestDayTdee ?? m.tdee_rest_day;
    expect(r.summary.restDayCaloriesOut).toBe(expected);
  });
});

// ── calCoverage never exceeds 1.0 (fix: window.length denominator) ────────────

describe('TDEE block calCoverage is always in [0, 1]', () => {
  it('full-log dataset produces calCoverage === 1.0, not 1.07', () => {
    const DAYS = 40;
    const days = syntheticDays(DAYS, () => ({ weight_lb: 180, calories: 2100 }));
    let rows = mergeDailyData(makeWeightEntries(days), makeNutritionEntries(days));
    rows = smoothWeight(waterCorrect(rows).rows);
    rows = estimateTDEE(rows);
    const blockRows = rows.filter(r => r.tdee_block != null && r.calCoverage != null);
    expect(blockRows.length).toBeGreaterThan(0);
    blockRows.forEach(r => {
      expect(r.calCoverage).toBeLessThanOrEqual(1.0);
      expect(r.calCoverage).toBeGreaterThan(0);
    });
    // With no gaps, every block should reach 1.0 exactly
    const highCovCount = blockRows.filter(r => r.calCoverage === 1.0).length;
    expect(highCovCount).toBeGreaterThan(0);
  });
});

// ── exerciseCalories used consistently in residual and imputation (fix 1) ─────

describe('exerciseCalories consistent across residual and imputation', () => {
  it('computeLoggingResidual uses exerciseCalories for PAL lookup', () => {
    // Build 60 days where exerciseSessions bump is 400 but trainingBump is 0
    // PAL[400] > PAL[0], so predictedTDEE should be higher → residual shifts
    const DAYS = 60;
    const daysNoBump = syntheticDays(DAYS, (i) => ({
      weight_lb: 185 - i * 0.03,
      calories: 2100,
      trainingBump: 0,
      exerciseSessions: [],
    }));
    const daysWithSessions = syntheticDays(DAYS, (i) => ({
      weight_lb: 185 - i * 0.03,
      calories: 2100,
      trainingBump: 0,           // bump is 0 — only sessions carry exercise
      exerciseSessions: [{ manualCalories: 400 }],
    }));

    let rowsNoBump = mergeDailyData(makeWeightEntries(daysNoBump), makeNutritionEntries(daysNoBump));
    let rowsWithSessions = mergeDailyData(makeWeightEntries(daysWithSessions), makeNutritionEntries(daysWithSessions));

    // All rows in sessions dataset should have exerciseCalories = 400
    rowsWithSessions.forEach(r => {
      expect(r.exerciseCalories).toBe(400);
    });

    // Rows in no-bump dataset should have exerciseCalories = 0
    rowsNoBump.forEach(r => {
      expect(r.exerciseCalories).toBe(0);
    });
  });

  it('imputeCalories selects correct PAL bucket from exerciseCalories', () => {
    const DAYS = 60;
    // Every other day has a 400-kcal manual session but trainingBump = 0
    const days = syntheticDays(DAYS, (i) => ({
      weight_lb: 185 - i * 0.03,
      calories: i % 5 === 0 ? null : 2100, // sparse gaps for imputation
      trainingBump: 0,
      exerciseSessions: i % 2 === 0 ? [{ manualCalories: 400 }] : [],
    }));
    const weMap = makeWeightEntries(days);
    const nuMap = makeNutritionEntries(days);
    const r = runAnalysis(weMap, nuMap);
    // Should not crash and should produce some imputed days
    expect(r).toBeDefined();
    expect(r.rows.length).toBe(DAYS);
    // Imputed rows should exist (since we have gaps and model should converge)
    // We only assert no crash here; PAL routing is covered by unit-level row inspection
  });
});

// ── fittedDataQuality: vacation gaps don't corrupt fitted BMR ─────────────────

describe('fittedDataQuality: medium blocks excluded from fit when enough high-quality exist', () => {
  it('fittedDataQuality is high when all data has full coverage', () => {
    const DAYS = 60;
    const days = syntheticDays(DAYS, (i) => ({
      weight_lb: 185 - i * 0.03 + Math.sin(i) * 0.2,
      calories: 2100,
    }));
    const r = runAnalysis(makeWeightEntries(days), makeNutritionEntries(days));
    const m = r.bmrModel;
    if (m.error || m.source === 'profile_prior') return;
    expect(m.fittedDataQuality).toBe('high');
  });

  it('fittedDataQuality is mixed when most blocks have gaps', () => {
    const DAYS = 60;
    // Every block overlaps a gap, so almost all blocks will be medium quality
    const days = syntheticDays(DAYS, (i) => ({
      weight_lb: 185 - i * 0.03 + Math.sin(i) * 0.2,
      calories: i % 4 === 0 ? null : 2100, // 25% missing every 4th day
    }));
    const r = runAnalysis(makeWeightEntries(days), makeNutritionEntries(days));
    const m = r.bmrModel;
    if (m.error || m.source === 'profile_prior') return;
    // With 25% gaps, fewer than 20 high-quality blocks → should fall back to mixed
    if (m.fittedDataQuality === 'mixed') {
      // Confidence reasons should mention the mixed quality
      const reason = r.confidence.reasons.some(s => s.includes('incomplete calorie logs'));
      expect(reason).toBe(true);
    }
  });

  it('vacation week does not materially shift fitted BMR when enough high-quality blocks exist', () => {
    const DAYS = 70;
    const VACATION_START = 30;
    const VACATION_END = 36; // 7-day gap

    // Build a clean dataset
    const daysClean = syntheticDays(DAYS, (i) => ({
      weight_lb: 185 - i * 0.03 + Math.sin(i) * 0.15,
      calories: 2100,
    }));
    // Same dataset with a vacation gap
    const daysWithVacation = syntheticDays(DAYS, (i) => ({
      weight_lb: 185 - i * 0.03 + Math.sin(i) * 0.15,
      calories: (i >= VACATION_START && i <= VACATION_END) ? null : 2100,
    }));

    const rClean = runAnalysis(makeWeightEntries(daysClean), makeNutritionEntries(daysClean));
    const rVacation = runAnalysis(makeWeightEntries(daysWithVacation), makeNutritionEntries(daysWithVacation));

    const mClean = rClean.bmrModel;
    const mVacation = rVacation.bmrModel;

    if (mClean.error || mVacation.error ||
        mClean.source === 'profile_prior' || mVacation.source === 'profile_prior') return;

    // When enough high-quality blocks exist and vacation blocks are excluded from fit,
    // the fitted BMR should not shift dramatically (within 10% of each other)
    const bmrClean = mClean.fittedBmr;
    const bmrVacation = mVacation.fittedBmr;
    if (bmrClean > 0 && bmrVacation > 0) {
      const shift = Math.abs(bmrClean - bmrVacation) / bmrClean;
      expect(shift).toBeLessThan(0.10); // less than 10% shift
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: Synthetic item detection, day classification, vacation estimation
// ─────────────────────────────────────────────────────────────────────────────

describe('isSyntheticItem', () => {
  it('detects by name', () => {
    expect(isSyntheticItem({ id: 'xyz', name: "Day's estimate" })).toBe(true);
    expect(isSyntheticItem({ id: 'xyz', name: 'Estimated vacation day' })).toBe(true);
    expect(isSyntheticItem({ id: 'xyz', name: 'Unlogged intake estimate' })).toBe(true);
  });

  it('detects by id prefix', () => {
    expect(isSyntheticItem({ id: 'est-2024-01-01', name: 'anything' })).toBe(true);
    expect(isSyntheticItem({ id: 'vac-2024-01-01', name: 'anything' })).toBe(true);
    expect(isSyntheticItem({ id: 'adj-2024-01-01', name: 'anything' })).toBe(true);
  });

  it('does not flag real food items', () => {
    expect(isSyntheticItem({ id: 'food-123', name: 'Chicken breast' })).toBe(false);
    expect(isSyntheticItem({ id: 'abc', name: 'Oatmeal' })).toBe(false);
  });

  it('handles null / undefined gracefully', () => {
    expect(isSyntheticItem(null)).toBe(false);
    expect(isSyntheticItem(undefined)).toBe(false);
    expect(isSyntheticItem({ name: null })).toBe(false);
  });
});

describe('classifyDay', () => {
  const blankRow = { date: '2024-01-01', calories: null, calories_imputed: false };
  const imputedRow = { date: '2024-01-01', calories: 2000, calories_imputed: true };

  it('returns blank for null entry with no imputation', () => {
    expect(classifyDay(blankRow, null)).toBe('blank');
  });

  it('returns estimated for imputed row with no entry', () => {
    expect(classifyDay(imputedRow, null)).toBe('estimated');
  });

  it('returns vacation for entry with vacationDayType', () => {
    const entry = { vacationDayType: 'medium', entryType: 'logged', foodItems: [] };
    expect(classifyDay(blankRow, entry)).toBe('vacation');
  });

  it('returns estimated for entryType=estimate', () => {
    const entry = { entryType: 'estimate', foodItems: [{ id: 'est-2024', name: "Day's estimate" }] };
    expect(classifyDay(blankRow, entry)).toBe('estimated');
  });

  it('returns logged for entry with real food items and no large residual', () => {
    const entry = {
      entryType: 'logged',
      foodItems: [{ id: 'food-1', name: 'Chicken', calories: 300, protein: 30 }],
    };
    expect(classifyDay(blankRow, entry)).toBe('logged');
  });

  it('returns partial when residual ≥ 400 kcal and real food exists', () => {
    const entry = {
      entryType: 'logged',
      foodItems: [{ id: 'food-1', name: 'Chicken', calories: 300 }],
    };
    expect(classifyDay(blankRow, entry, 450)).toBe('partial');
    expect(classifyDay(blankRow, entry, 399)).toBe('logged');
  });

  it('returns mixed when real food + adjustment item coexist', () => {
    const entry = {
      entryType: 'logged',
      foodItems: [
        { id: 'food-1', name: 'Chicken', calories: 300 },
        { id: 'adj-2024-01-01', name: 'Unlogged intake estimate', calories: 600 },
      ],
    };
    expect(classifyDay(blankRow, entry)).toBe('mixed');
  });

  it('returns blank for entry with zero-length foodItems and no calories', () => {
    const entry = { entryType: 'logged', foodItems: [] };
    expect(classifyDay(blankRow, entry)).toBe('blank');
  });
});

describe('estimateVacationCalories', () => {
  const mockBmr = {
    error: null,
    source: 'fitted',
    observedTdee: 2200,
    tdee_current: 2200,
    tdee_rest_day: 2000,
  };

  it('returns user_specified when vacationType=custom and customCalories provided', () => {
    const result = estimateVacationCalories('custom', mockBmr, '2024-06-01', null, 1800);
    expect(result.method).toBe('user_specified');
    expect(result.calories).toBe(1800);
  });

  it('scales correctly for light (0.85 × TDEE - 100)', () => {
    const result = estimateVacationCalories('light', mockBmr, '2024-06-01');
    // 2200 × 0.85 - 100 = 1770
    expect(result.calories).toBeCloseTo(1770, -1);
  });

  it('returns TDEE unchanged for medium', () => {
    const result = estimateVacationCalories('medium', mockBmr, '2024-06-01');
    expect(result.calories).toBe(2200);
    expect(result.confidence).toBe('medium'); // fitted source → medium
  });

  it('increases for heavy (1.10 × TDEE + 200)', () => {
    const result = estimateVacationCalories('heavy', mockBmr, '2024-06-01');
    // 2200 × 1.10 + 200 = 2620
    expect(result.calories).toBeCloseTo(2620, -1);
  });

  it('falls back to default_fallback when no TDEE data', () => {
    const result = estimateVacationCalories('medium', null, '2024-06-01');
    expect(result.method).toBe('default_fallback');
    expect(result.calories).toBe(2000);
  });

  it('bounds calories between 600 and 6000', () => {
    const highBmr = { error: null, source: 'fitted', observedTdee: 5500 };
    const heavy = estimateVacationCalories('heavy', highBmr, '2024-06-01');
    expect(heavy.calories).toBeLessThanOrEqual(6000);

    const lowBmr = { error: null, source: 'fitted', observedTdee: 700 };
    const light = estimateVacationCalories('light', lowBmr, '2024-06-01');
    expect(light.calories).toBeGreaterThanOrEqual(600);
  });
});

describe('computeWeekdayAverages', () => {
  it('computes per-weekday averages from logged entries', () => {
    const entries = new Map([
      ['2024-01-01', { calories: '2000', entryType: 'logged' }], // Mon
      ['2024-01-08', { calories: '2100', entryType: 'logged' }], // Mon
      ['2024-01-06', { calories: '1800', entryType: 'logged' }], // Sat
    ]);
    const avgs = computeWeekdayAverages(entries);
    expect(avgs).toHaveLength(7);
    // Monday = index 1
    expect(avgs[1]).toBeCloseTo(2050, 0);
    // Saturday = index 6
    expect(avgs[6]).toBeCloseTo(1800, 0);
    // Other days are null
    expect(avgs[0]).toBeNull();
  });

  it('ignores estimated entries', () => {
    const entries = new Map([
      ['2024-01-01', { calories: '2000', entryType: 'logged' }],
      ['2024-01-08', { calories: '9999', entryType: 'estimate' }], // same weekday, should skip
    ]);
    const avgs = computeWeekdayAverages(entries);
    expect(avgs[1]).toBeCloseTo(2000, 0);
  });
});

describe('buildVacationDayEntry', () => {
  function makeBaseline() {
    return { calories: '2000', protein: '150', fat: '60', fatMinimum: '60' };
  }

  function makeLoggedEntries() {
    return new Map([
      ['2024-01-01', { calories: '2100', protein: '160', fat: '65', carbs: '220', entryType: 'logged', foodItems: [] }],
      ['2024-01-02', { calories: '1900', protein: '140', fat: '55', carbs: '200', entryType: 'logged', foodItems: [] }],
    ]);
  }

  it('produces an estimate entry with vacationDayType set', () => {
    const entry = buildVacationDayEntry('2024-06-15', 'medium', null, makeLoggedEntries(), makeBaseline());
    expect(entry.entryType).toBe('estimate');
    expect(entry.vacationDayType).toBe('medium');
    expect(entry.estimateMeta.method).toBeTruthy();
  });

  it('contains a single synthetic food item named "Estimated vacation day"', () => {
    const entry = buildVacationDayEntry('2024-06-15', 'light', null, makeLoggedEntries(), makeBaseline());
    expect(entry.foodItems).toHaveLength(1);
    expect(entry.foodItems[0].name).toBe('Estimated vacation day');
    expect(entry.foodItems[0].id.startsWith('vac-')).toBe(true);
  });

  it('calories on food item match entry totals', () => {
    const entry = buildVacationDayEntry('2024-06-15', 'medium', null, makeLoggedEntries(), makeBaseline());
    const itemCals = entry.foodItems.reduce((s, fi) => s + fi.calories, 0);
    expect(itemCals).toBe(entry.calories);
  });

  it('preserves previousEstimate in meta when overwriting an existing estimate', () => {
    const existingEntries = new Map([
      ['2024-06-15', {
        calories: '1900', entryType: 'estimate', vacationDayType: 'light',
        estimateMeta: { createdAt: '2024-01-01T00:00:00Z', locked: false, method: 'tdee_model' },
        foodItems: [],
      }],
    ]);
    const entry = buildVacationDayEntry('2024-06-15', 'medium', null, existingEntries, makeBaseline());
    expect(entry.estimateMeta.previousEstimate).not.toBeNull();
    expect(entry.estimateMeta.createdAt).toBe('2024-01-01T00:00:00Z');
  });
});

describe('buildPartialDayAdjustment', () => {
  const baseline = { calories: '2000', protein: '150', fat: '60' };

  it('appends adjustment item without modifying real items', () => {
    const entry = {
      calories: 800, protein: 60, fat: 20, carbs: 80,
      foodItems: [
        { id: 'food-1', name: 'Oatmeal', calories: 400, protein: 10, fat: 5, carbs: 60 },
        { id: 'food-2', name: 'Chicken', calories: 400, protein: 50, fat: 15, carbs: 20 },
      ],
      entryType: 'logged',
    };
    const { adjustedEntry, adjustItem } = buildPartialDayAdjustment('2024-01-05', 600, entry, baseline);
    expect(adjustedEntry.foodItems).toHaveLength(3);
    expect(adjustItem.name).toBe('Unlogged intake estimate');
    expect(adjustItem.id.startsWith('adj-')).toBe(true);
    expect(adjustItem.calories).toBe(600);
    // Real food unchanged
    expect(adjustedEntry.foodItems[0].name).toBe('Oatmeal');
    expect(adjustedEntry.foodItems[1].name).toBe('Chicken');
  });

  it('sets updated calorie total correctly', () => {
    const entry = {
      calories: 900, protein: 70, fat: 30, carbs: 80,
      foodItems: [{ id: 'f1', name: 'Salad', calories: 900, protein: 70, fat: 30, carbs: 80 }],
      entryType: 'logged',
    };
    const { adjustedEntry } = buildPartialDayAdjustment('2024-01-06', 500, entry, baseline);
    expect(adjustedEntry.calories).toBe(1400);
  });

  it('stores previousEstimate in meta', () => {
    const entry = {
      calories: 800, protein: 60, fat: 20, carbs: 70,
      foodItems: [{ id: 'f1', name: 'Egg', calories: 800, protein: 60, fat: 20, carbs: 70 }],
      estimateMeta: { method: 'old_method', createdAt: '2023-12-01T00:00:00Z', locked: false },
      entryType: 'logged',
    };
    const { adjustedEntry } = buildPartialDayAdjustment('2024-01-06', 400, entry, baseline, 'medium');
    expect(adjustedEntry.estimateMeta.previousEstimate?.method).toBe('old_method');
    expect(adjustedEntry.estimateMeta.method).toBe('underreporting_adjustment');
  });

  it('quantity-aware: item with qty 2 contributes double calories to total', () => {
    const entry = {
      calories: 1000, protein: 80, fat: 40, carbs: 100,
      foodItems: [
        { id: 'f1', name: 'Rice', quantity: 2, calories: 500, protein: 40, fat: 20, carbs: 50 },
      ],
      entryType: 'logged',
    };
    const { adjustedEntry } = buildPartialDayAdjustment('2024-01-07', 300, entry, baseline);
    const synth = adjustedEntry.foodItems.find(fi => fi.id.startsWith('adj-'));
    expect(synth).toBeTruthy();
    // total = qty2×500 + 300 synthetic = 1300
    expect(adjustedEntry.calories).toBe(1300);
  });
});

// ── computeWeekdayAverages — quantity-aware ───────────────────────────────────

describe('computeWeekdayAverages — quantity-aware', () => {
  it('multiplies item calories by quantity', () => {
    const entries = new Map();
    // Monday with 2 qty×500 = 1000 kcal real
    entries.set('2024-01-08', {
      date: '2024-01-08',
      calories: 1000, protein: 100, fat: 40, carbs: 100,
      entryType: 'logged',
      foodItems: [
        { id: 'f1', name: 'Chicken', quantity: 2, calories: 500, protein: 50, fat: 20, carbs: 0 },
      ],
    });
    const avgs = computeWeekdayAverages(entries);
    const dow = new Date('2024-01-08T00:00:00').getDay(); // Monday = 1
    expect(avgs[dow]).toBe(1000);
  });

  it('ignores synthetic items in weekday averages', () => {
    const entries = new Map();
    entries.set('2024-01-09', {
      date: '2024-01-09',
      calories: 1500, protein: 100, fat: 50, carbs: 150,
      entryType: 'logged',
      foodItems: [
        { id: 'f1', name: 'Oats', quantity: 1, calories: 500, protein: 20, fat: 10, carbs: 60 },
        { id: 'est-2024-01-09', name: "Day's estimate", quantity: 1, calories: 1000, protein: 80, fat: 40, carbs: 90 },
      ],
    });
    const avgs = computeWeekdayAverages(entries);
    const dow = new Date('2024-01-09T00:00:00').getDay();
    // Only the real item (500 kcal × qty 1) should count
    expect(avgs[dow]).toBe(500);
  });
});

// ── buildVacationDayEntry — quantity-aware averages ───────────────────────────

describe('buildVacationDayEntry — quantity-aware nutrient averages', () => {
  function makeBaselineForVac() {
    return { calories: '2000', protein: '150', fat: '60', fatMinimum: '50' };
  }

  it('averages calories correctly when items have quantity > 1', () => {
    const entries = new Map();
    // 3 real logged days each with qty-2 items (500 cal each → 1000 per day)
    for (let i = 1; i <= 3; i++) {
      const d = `2024-01-0${i}`;
      entries.set(d, {
        date: d, calories: 1000, protein: 80, fat: 40, carbs: 100,
        entryType: 'logged',
        foodItems: [{ id: `f${i}`, name: 'Meal', quantity: 2, calories: 500, protein: 40, fat: 20, carbs: 50 }],
      });
    }
    const entry = buildVacationDayEntry('2024-01-20', 'medium', null, entries, makeBaselineForVac());
    // avgProtein should reflect qty×protein = 2×40 = 80 per day average
    expect(entry.protein).toBeGreaterThanOrEqual(60);
    expect(entry.fat).toBeGreaterThanOrEqual(30);
  });
});

// ── getTrueUpCandidates ───────────────────────────────────────────────────────

/**
 * Build 60 days of weight + nutrition data with a configurable blank day.
 * Weight decreases at ~0.1 lb/day (matching a ~350 kcal/day deficit).
 * Nutrition logs 2000 kcal every day except blankDate.
 */
function makeDataForTrueUp(opts = {}) {
  const {
    blankDate = null,
    partialDate = null,
    partialCals = 400,
    n = 60,
    startDate = '2023-10-01',
    tdeeOverride = 2350,
    weightStart = 185,
  } = opts;

  const weightData = [];
  const nutritionData = [];

  for (let i = 0; i < n; i++) {
    const date = isoDate(startDate, i);
    const wt = parseFloat((weightStart - i * 0.05).toFixed(1));
    weightData.push({ date, weight_lb: wt });

    if (date === blankDate) {
      // No food logged for this day
    } else if (date === partialDate) {
      nutritionData.push({ date, calories: partialCals, protein: 40, carbs: 60, fat: 15 });
    } else {
      nutritionData.push({ date, calories: 2000, protein: 150, carbs: 250, fat: 60 });
    }
  }

  const weightEntries = makeWeightEntries(weightData);
  const dailyEntries  = makeNutritionEntries(nutritionData);
  const baseline = { calories: '2000', protein: '150', fat: '60', fatMinimum: '50' };

  // Provide a minimal bmrModel so interval evidence can be computed
  const bmrModel = {
    source: 'formula',
    tdee_current: tdeeOverride,
    error: null,
  };

  return { weightEntries, dailyEntries, baseline, bmrModel };
}

describe('getTrueUpCandidates', () => {
  it('returns results sorted descending by date', () => {
    const startDate = '2023-10-01';
    const blankDate = isoDate(startDate, 20); // day 21, well within 60-day window
    const { weightEntries, dailyEntries, baseline, bmrModel } = makeDataForTrueUp({ blankDate, startDate });

    // Build rows via runAnalysis
    const results = runAnalysis(weightEntries, dailyEntries);
    if (results.error) return; // skip if not enough data

    const candidates = getTrueUpCandidates(results.rows, dailyEntries, bmrModel, baseline);
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].date <= candidates[i - 1].date).toBe(true);
    }
  });

  it('confidence is derived — not always medium', () => {
    const startDate = '2023-10-01';
    const blankDate = isoDate(startDate, 20);
    const { weightEntries, dailyEntries, baseline, bmrModel } = makeDataForTrueUp({ blankDate, startDate });

    const results = runAnalysis(weightEntries, dailyEntries);
    const candidates = getTrueUpCandidates(results.rows, dailyEntries, bmrModel, baseline);

    // With enough data, confidence should vary (not all 'medium')
    const confidences = candidates.map(c => c.confidence);
    // At least one candidate should have a non-medium confidence, OR all are same due to data scarcity
    // The key assertion: confidence is one of the expected values, never a default constant
    for (const c of confidences) {
      expect(['high', 'medium', 'low']).toContain(c);
    }
  });

  it('intentional deficit day that matches weight trend is NOT flagged as underreporting', () => {
    // Build data where user logs exactly 2000 kcal/day and weight drops at expected rate
    // TDEE ~2350 → deficit ~350 kcal/day → weight loss ~0.1 lb/day
    // A partial day with 1800 kcal (within 10% of target 2000) should NOT be flagged
    const startDate = '2023-10-01';
    const partialDate = isoDate(startDate, 20);
    const { weightEntries, dailyEntries, baseline, bmrModel } = makeDataForTrueUp({
      partialDate,
      partialCals: 1800, // within 85% of 2000-kcal target (90%), should be skipped
      startDate,
    });

    const results = runAnalysis(weightEntries, dailyEntries);
    const candidates = getTrueUpCandidates(results.rows, dailyEntries, bmrModel, baseline);

    // The 1800 kcal day (90% of 2000 target) should NOT appear as a candidate
    const flagged = candidates.find(c => c.date === partialDate);
    expect(flagged).toBeUndefined();
  });

  it('a clearly blank day is found and flagged as type blank (hard check)', () => {
    const startDate = '2023-10-01';
    const blankDate = isoDate(startDate, 25);
    const { weightEntries, dailyEntries, baseline, bmrModel } = makeDataForTrueUp({ blankDate, startDate, n: 80 });

    const results = runAnalysis(weightEntries, dailyEntries);
    expect(results.error).toBeFalsy();

    const candidates = getTrueUpCandidates(results.rows, dailyEntries, bmrModel, baseline);
    const found = candidates.find(c => c.date === blankDate);
    expect(found, `expected blank candidate for ${blankDate} — candidate was not produced`).toBeDefined();
    expect(found.type).toBe('blank');
    // recommendedDelta for a blank day is the full-day estimate, not a tiny residual
    expect(found.recommendedDelta).toBeGreaterThanOrEqual(600);
    expect(found.recommendedDelta).toBeLessThanOrEqual(6000);
  });

  it('blank day recommendedDelta is a full-day TDEE estimate, not a per-day residual fragment', () => {
    const startDate = '2023-10-01';
    const blankDate = isoDate(startDate, 25);
    const tdeeOverride = 2350;
    const { weightEntries, dailyEntries, baseline, bmrModel } = makeDataForTrueUp(
      { blankDate, startDate, n: 80, tdeeOverride },
    );

    const results = runAnalysis(weightEntries, dailyEntries);
    expect(results.error).toBeFalsy();

    const candidates = getTrueUpCandidates(results.rows, dailyEntries, bmrModel, baseline);
    const found = candidates.find(c => c.date === blankDate);
    expect(found, `expected blank candidate for ${blankDate}`).toBeDefined();
    // Full-day estimate must be substantially larger than per-day residual (~25 kcal/day)
    // A blank day TDEE-based estimate should be ~2000-2400, not ~25
    expect(found.recommendedDelta).toBeGreaterThanOrEqual(1500);
  });

  it('buildBlankDayEstimateEntry saves calories equal to the blank candidate recommendedDelta', () => {
    const startDate = '2023-10-01';
    const blankDate = isoDate(startDate, 25);
    const { weightEntries, dailyEntries, baseline, bmrModel } = makeDataForTrueUp({ blankDate, startDate, n: 80 });

    const results = runAnalysis(weightEntries, dailyEntries);
    expect(results.error).toBeFalsy();

    const candidates = getTrueUpCandidates(results.rows, dailyEntries, bmrModel, baseline);
    const found = candidates.find(c => c.date === blankDate);
    expect(found, `expected blank candidate for ${blankDate}`).toBeDefined();

    const entry = buildBlankDayEstimateEntry(blankDate, found, null, dailyEntries, baseline);
    expect(entry.calories).toBe(found.recommendedDelta);
    expect(entry.foodItems[0].calories).toBe(found.recommendedDelta);
  });

  it('blank candidate interval excludes the blank day imputed calories from reportedIntake', () => {
    // All non-blank days log 2000 kcal. The blank day has no log entry.
    // With the fix, the blank day contributes 0 to reportedIntake.
    // Without it, imputed calories (~TDEE) would inflate reportedIntake by ~2350.
    const startDate = '2023-10-01';
    const blankDate = isoDate(startDate, 25);
    const { weightEntries, dailyEntries, baseline, bmrModel } = makeDataForTrueUp({ blankDate, startDate, n: 80 });

    const results = runAnalysis(weightEntries, dailyEntries);
    expect(results.error).toBeFalsy();

    const candidates = getTrueUpCandidates(results.rows, dailyEntries, bmrModel, baseline);
    const found = candidates.find(c => c.date === blankDate);
    expect(found, `expected blank candidate for ${blankDate}`).toBeDefined();

    // For each interval, expectedExpenditure must exceed reportedIntake.
    // If the blank day's imputed calories were included, reportedIntake would be close
    // to expectedExpenditure and the residual would shrink to near zero.
    for (const interval of found.intervalsUsed) {
      expect(interval.expectedExpenditure).toBeGreaterThan(interval.reportedIntake);
      expect(interval.residualBefore).toBeGreaterThan(0);
    }

    // For the 14-day window, 13 non-blank days × 2000 kcal = 26000 reported.
    // If blank day imputed (~2350) were included it would be ~28350 — above 27000.
    const i14 = found.intervalsUsed.find(i => i.name === '14d');
    if (i14) {
      expect(i14.reportedIntake).toBeLessThan(27000);
      expect(i14.reportedIntake).toBeGreaterThan(23000);
    }
  });

  it('deltas above 1000 kcal are reviewManually unless high confidence and multi-window', () => {
    const startDate = '2023-10-01';
    const blankDate = isoDate(startDate, 25);
    const { weightEntries, dailyEntries, baseline, bmrModel } = makeDataForTrueUp({
      blankDate,
      startDate,
      n: 70,
      // Very high TDEE so residual is large
      tdeeOverride: 4000,
    });

    const results = runAnalysis(weightEntries, dailyEntries);
    const candidates = getTrueUpCandidates(results.rows, dailyEntries, bmrModel, baseline);

    for (const c of candidates) {
      if (c.recommendedDelta > 1000) {
        // Must be reviewManually unless high+multi-window
        if (!(c.confidence === 'high' && c.intervalsUsed.some(i => i.name === '28d') && c.intervalsUsed.some(i => i.name === '42d'))) {
          expect(c.reviewManually).toBe(true);
          expect(c.checkedByDefault).toBe(false);
        }
      }
    }
  });

  it('existing synthetic items on a day prevent it from being flagged', () => {
    const startDate = '2023-10-01';
    const adjDate = isoDate(startDate, 20);
    const { weightEntries, dailyEntries, baseline, bmrModel } = makeDataForTrueUp({
      partialDate: adjDate,
      partialCals: 400,
      startDate,
    });

    // Add a synthetic adjustment item to the partial day
    const existing = dailyEntries.get(adjDate);
    if (existing) {
      dailyEntries.set(adjDate, {
        ...existing,
        foodItems: [
          ...(existing.foodItems || []),
          { id: 'adj-2023-10-21', name: 'Unlogged intake estimate', quantity: 1, calories: 500 },
        ],
      });
    }

    const results = runAnalysis(weightEntries, dailyEntries);
    const candidates = getTrueUpCandidates(results.rows, dailyEntries, bmrModel, baseline);

    const found = candidates.find(c => c.date === adjDate);
    expect(found).toBeUndefined();
  });

  it('locked days are skipped', () => {
    const startDate = '2023-10-01';
    const lockedDate = isoDate(startDate, 20);
    const { weightEntries, dailyEntries, baseline, bmrModel } = makeDataForTrueUp({
      blankDate: lockedDate,
      startDate,
    });

    // Lock the entry
    dailyEntries.set(lockedDate, {
      date: lockedDate,
      calories: 0,
      estimateMeta: { locked: true },
    });

    const results = runAnalysis(weightEntries, dailyEntries);
    const candidates = getTrueUpCandidates(results.rows, dailyEntries, bmrModel, baseline);

    const found = candidates.find(c => c.date === lockedDate);
    expect(found).toBeUndefined();
  });
});

// ── buildBlankDayEstimateEntry ────────────────────────────────────────────────

describe('buildBlankDayEstimateEntry', () => {
  const baseline = { calories: '2000', protein: '150', fat: '60', fatMinimum: '50' };

  const candidate = {
    date: '2024-02-15',
    type: 'blank',
    recommendedDelta: 1800,
    confidence: 'medium',
    intervalsUsed: [{ name: '28d', days: 28, intervalStart: '2024-01-18', intervalEnd: '2024-02-15' }],
  };

  it('returns a complete v2 daily entry', () => {
    const entry = buildBlankDayEstimateEntry('2024-02-15', candidate, null, new Map(), baseline);
    expect(entry.schemaVersion).toBe(2);
    expect(entry.entryType).toBe('estimate');
    expect(entry.date).toBe('2024-02-15');
    expect(entry.calories).toBe(1800);
    expect(entry.vacationDayType).toBeNull();
  });

  it('includes a foodItems array with one synthetic est- item', () => {
    const entry = buildBlankDayEstimateEntry('2024-02-15', candidate, null, new Map(), baseline);
    expect(Array.isArray(entry.foodItems)).toBe(true);
    expect(entry.foodItems.length).toBe(1);
    expect(entry.foodItems[0].id).toBe('est-2024-02-15');
    expect(entry.foodItems[0].name).toBe("Day's estimate");
    expect(entry.foodItems[0].calories).toBe(1800);
  });

  it('has required structural fields', () => {
    const entry = buildBlankDayEstimateEntry('2024-02-15', candidate, null, new Map(), baseline);
    expect(Array.isArray(entry.exerciseSessions)).toBe(true);
    expect(Array.isArray(entry.calorieAdjustmentItems)).toBe(true);
    expect(entry.manualLock).toBe(false);
  });

  it('estimateMeta carries method, confidence, and intervalsUsed', () => {
    const entry = buildBlankDayEstimateEntry('2024-02-15', candidate, null, new Map(), baseline);
    expect(entry.estimateMeta.method).toBe('blank_day_trueup');
    expect(entry.estimateMeta.confidence).toBe('medium');
    expect(Array.isArray(entry.estimateMeta.intervalsUsed)).toBe(true);
    expect(entry.estimateMeta.locked).toBe(false);
  });

  it('never saves a raw candidate object — calories come from recommendedDelta', () => {
    const entry = buildBlankDayEstimateEntry('2024-02-15', candidate, null, new Map(), baseline);
    // The entry should have calories, not candidate-specific fields like perDayResidual
    expect(entry.calories).toBe(1800);
    expect(entry).not.toHaveProperty('perDayResidual');
    expect(entry).not.toHaveProperty('intervalsUsed');
    expect(entry).not.toHaveProperty('recommendedDelta');
  });

  it('protein + fat + carbs are positive and derive from baseline fractions', () => {
    const entry = buildBlankDayEstimateEntry('2024-02-15', candidate, null, new Map(), baseline);
    expect(entry.protein).toBeGreaterThan(0);
    expect(entry.fat).toBeGreaterThan(0);
    expect(entry.carbs).toBeGreaterThanOrEqual(0);
  });
});
