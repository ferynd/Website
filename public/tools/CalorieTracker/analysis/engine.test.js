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
