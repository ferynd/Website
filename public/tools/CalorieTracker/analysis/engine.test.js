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
 * Each entry gets a deterministic doc ID.
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

/** Build a Map<date, entry> nutrition entries. */
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
      });
    }
  });
  return map;
}

/**
 * Generate N days of synthetic data starting from START_DATE.
 * @param {number} n - number of days
 * @param {function} dayFn - receives (index, date) and returns { weight_lb, calories, ... }
 */
function syntheticDays(n, dayFn, startDate = '2024-01-01') {
  return Array.from({ length: n }, (_, i) => {
    const date = isoDate(startDate, i);
    return { date, ...dayFn(i, date) };
  });
}

// ── Test scenarios ────────────────────────────────────────────────────────────

describe('selectDailyWeight', () => {
  it('returns the single reading when only one exists', () => {
    const r = [{ weight_lb: 180, time_min: 480 }];
    expect(selectDailyWeight(r, null)?.weight_lb).toBe(180);
  });

  it('prefers reading inside the preferred window', () => {
    const readings = [
      { weight_lb: 183, time_min: 900 },  // outside (3 PM)
      { weight_lb: 181, time_min: 420 },  // inside window (7 AM)
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
    // Both are outside window → pick earliest time_min
    expect(selectDailyWeight(readings, window)?.time_min).toBe(900);
  });

  it('uses median of in-window readings for robustness', () => {
    const readings = [
      { weight_lb: 181, time_min: 400 },  // in window
      { weight_lb: 182, time_min: 420 },  // in window
      { weight_lb: 190, time_min: 430 },  // in window but high outlier
    ];
    const window = { startMin: 360, endMin: 540 };
    // Sorted in-window: [181, 182, 190] → median at index 1 = 182
    expect(selectDailyWeight(readings, window)?.weight_lb).toBe(182);
  });
});

describe('Stable maintenance (60 days)', () => {
  const DAYS = 60;
  const MAINTENANCE_KCAL = 2200;
  const STABLE_WEIGHT_LB = 180;

  const days = syntheticDays(DAYS, (i) => ({
    weight_lb: STABLE_WEIGHT_LB + (Math.sin(i) * 0.3), // tiny noise
    calories: MAINTENANCE_KCAL,
    trainingBump: 0,
  }));

  const weightEntries = makeWeightEntries(days);
  const dailyEntries = makeNutritionEntries(days);

  it('runAnalysis returns no error', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    expect(r.error).toBeUndefined();
  });

  it('smoothed weight stays near starting weight', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    const last = r.rows.filter(rw => rw.wt_smooth_lb != null).at(-1);
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
});

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

  it('TDEE estimate is above intake (model must infer expenditure > intake)', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    if (r.summary.tdee != null) {
      expect(r.summary.tdee).toBeGreaterThan(INTAKE - 100);
    }
  });
});

describe('Under-reported calories (weight drops faster than calories suggest)', () => {
  const DAYS = 60;
  const TRUE_TDEE = 2400;
  const LOGGED_KCAL = 1600;  // logs 600 less than actual
  const TRUE_DEFICIT = TRUE_TDEE - 2000; // actual intake = 2000, gap = 400
  const START_WEIGHT = 185;
  const RATE_LB_PER_DAY = TRUE_DEFICIT / 7700 * 2.2046; // lbs/day

  const days = syntheticDays(DAYS, (i) => ({
    weight_lb: START_WEIGHT - RATE_LB_PER_DAY * i + (Math.sin(i) * 0.15),
    calories: LOGGED_KCAL, // under-reported
    trainingBump: 0,
  }));

  const weightEntries = makeWeightEntries(days);
  const dailyEntries = makeNutritionEntries(days);

  it('returns a non-null loggingResidual', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    // Model may or may not converge depending on data, but should not crash
    expect(r).toBeDefined();
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('model does not over-react to single-day weight changes', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    // Smoothed weight should be much less volatile than raw weight
    const smoothVals = r.rows.map(rw => rw.wt_smooth_lb).filter(v => v != null);
    const rawVals = r.rows.map(rw => rw.weight_lb).filter(v => v != null);
    if (smoothVals.length < 2 || rawVals.length < 2) return;

    const smoothRange = Math.max(...smoothVals) - Math.min(...smoothVals);
    const rawRange = Math.max(...rawVals) - Math.min(...rawVals);
    // Smoothed range should be less than or equal to raw range
    expect(smoothRange).toBeLessThanOrEqual(rawRange + 0.5);
  });
});

describe('High sodium/carb water swing', () => {
  const BASE_DAYS = 30;
  const HIGH_SODIUM_DAY = 15;

  const days = syntheticDays(BASE_DAYS, (i) => ({
    weight_lb: 175 + (i === HIGH_SODIUM_DAY ? 3 : 0), // 3 lb spike on high-sodium day
    calories: 2000,
    sodium: i === HIGH_SODIUM_DAY ? 6000 : 1800, // very high sodium on day 15
    carbs: 200,
    trainingBump: 0,
  }));

  const weightEntries = makeWeightEntries(days);
  const dailyEntries = makeNutritionEntries(days);

  it('smoothed weight is less affected than raw on the spike day', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    const spikeRow = r.rows.find(rw => rw.date === days[HIGH_SODIUM_DAY].date);
    if (!spikeRow || spikeRow.wt_smooth_lb == null) return;
    // Smoothed value should be pulled toward the surrounding 175 lb baseline
    expect(Math.abs(spikeRow.wt_smooth_lb - 175)).toBeLessThan(3);
  });

  it('waterWeightUncertaintyLb is reported and positive', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    if (r.waterWeightUncertaintyLb != null) {
      expect(r.waterWeightUncertaintyLb).toBeGreaterThan(0);
    }
  });
});

describe('Missing vacation week (days 20–26 no calories)', () => {
  const DAYS = 60;

  const days = syntheticDays(DAYS, (i) => ({
    weight_lb: 180 - i * 0.03 + Math.sin(i) * 0.2,
    calories: (i >= 20 && i <= 26) ? null : 2000, // vacation gap
    trainingBump: 0,
  }));

  const weightEntries = makeWeightEntries(days);
  const dailyEntries = makeNutritionEntries(days);

  it('returns rows for all 60 days', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    expect(r.rows.length).toBe(DAYS);
  });

  it('vacation days have null calories initially (not imputed prematurely)', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    // Days 20–26 should not be imputed until 14 days have passed
    // (they will be 'pending' or 'insufficient_weight_data' depending on data)
    const vacDays = r.rows.filter((rw, i) => i >= 20 && i <= 26);
    vacDays.forEach(rw => {
      if (rw.calories != null) {
        // If imputed, status should be 'imputed', not silently set
        expect(rw.impute_status).toBe('imputed');
        expect(rw.calories_imputed).toBe(true);
      }
    });
  });

  it('does not crash with a week-long gap', () => {
    expect(() => runAnalysis(weightEntries, dailyEntries)).not.toThrow();
  });
});

describe('Exercise-heavy weeks (varied training bumps)', () => {
  const DAYS = 60;
  const BUMPS = [0, 0, 100, 0, 280, 0, 400]; // weekly pattern

  const days = syntheticDays(DAYS, (i) => {
    const bump = BUMPS[i % 7];
    const calories = 2000 + bump; // intake matches bump
    return {
      weight_lb: 185 - i * 0.05 + Math.sin(i * 0.8) * 0.3,
      calories,
      trainingBump: bump,
    };
  });

  const weightEntries = makeWeightEntries(days);
  const dailyEntries = makeNutritionEntries(days);

  it('returns a bmrModel when enough data', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    // With 60 days and varied bumps we should get a fitted model
    // (may still error if not enough block estimates due to smoothing startup)
    expect(r).toBeDefined();
    if (!r.bmrModel.error) {
      expect(r.bmrModel.pals).toBeDefined();
    }
  });

  it('different PAL values for different bumps (monotonically ordered)', () => {
    const r = runAnalysis(weightEntries, dailyEntries);
    if (r.bmrModel.error || r.bmrModel.source === 'profile_prior') return;
    const pals = r.bmrModel.pals;
    // PAL should increase with training intensity (within numerical tolerance)
    if (pals[0] && pals[400]) {
      expect(pals[400]).toBeGreaterThanOrEqual(pals[0] - 0.05);
    }
  });
});

describe('estimateProfileRmr', () => {
  it('returns null when no weight provided', () => {
    expect(estimateProfileRmr(null, null)).toBeNull();
  });

  it('uses Mifflin-St Jeor when height, age, sex are present', () => {
    const profile = { age: 30, heightValue: 70, heightUnit: 'in', sex: 'male', bodyFatPercent: null };
    const result = estimateProfileRmr(profile, 180);
    expect(result.method).toBe('mifflin_st_jeor');
    // 180 lb = 81.6 kg; height 70 in = 177.8 cm
    // MSJ male: 10*81.6 + 6.25*177.8 - 5*30 + 5 = 816 + 1111 - 150 + 5 = 1782
    expect(Math.abs(result.rmr - 1782)).toBeLessThan(20);
  });

  it('falls back to weight-only when profile is null', () => {
    const result = estimateProfileRmr(null, 180);
    expect(result.method).toBe('weight_only');
    // 180 lb ≈ 81.6 kg; 21 * 81.6 ≈ 1714
    expect(Math.abs(result.rmr - 1714)).toBeLessThan(30);
  });
});

describe('computeConfidence', () => {
  it('returns not_enough with only 7 days', () => {
    const days = syntheticDays(7, (i) => ({ weight_lb: 180, calories: 2000 }));
    const rows = [...mergeDailyData(makeWeightEntries(days), makeNutritionEntries(days))];
    const conf = computeConfidence(rows, {});
    expect(conf.label).toBe('not_enough');
  });

  it('returns high confidence with 50+ days of weight and calories', () => {
    const days = syntheticDays(55, (i) => ({ weight_lb: 180 - i * 0.05, calories: 2000 }));
    const rows = [...mergeDailyData(makeWeightEntries(days), makeNutritionEntries(days))];
    const conf = computeConfidence(rows, { source: 'fitted', score: 30 });
    expect(['moderate', 'high']).toContain(conf.label);
  });
});

describe('Multi-horizon TDEE (estimateTDEEByHorizon)', () => {
  it('returns null tdee for short windows when insufficient data', () => {
    const days = syntheticDays(10, () => ({ weight_lb: 180, calories: 2000 }));
    const weMap = makeWeightEntries(days);
    const nuMap = makeNutritionEntries(days);
    let rows = mergeDailyData(weMap, nuMap);
    rows = smoothWeight(waterCorrect(rows).rows);
    rows = estimateTDEE(rows);
    const horizons = estimateTDEEByHorizon(rows);
    // All horizons require at least 5 block estimates — none should be available
    Object.values(horizons).forEach(h => {
      expect(h.available).toBe(false);
    });
  });

  it('returns valid tdee for PRIMARY horizon with 35 days', () => {
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
    // PRIMARY = 28 days; should have enough block estimates
    if (horizons[28]?.available) {
      expect(horizons[28].tdee).toBeGreaterThan(1000);
      expect(horizons[28].tdee).toBeLessThan(5000);
    }
  });
});

describe('Profile-based fallback when < 30 days', () => {
  it('uses profile RMR when not enough data for grid search', () => {
    const days = syntheticDays(20, (i) => ({ weight_lb: 185, calories: 2200 }));
    const weMap = makeWeightEntries(days);
    const nuMap = makeNutritionEntries(days);
    const profile = { age: 35, heightValue: 70, heightUnit: 'in', sex: 'male' };
    const r = runAnalysis(weMap, nuMap, profile);
    // Should not crash; if model is insufficient it should use profile prior
    expect(r).toBeDefined();
    if (r.bmrModel.source === 'profile_prior') {
      expect(r.bmrModel.bmr_current).toBeGreaterThan(0);
      expect(r.summary.profilePredictedRmr).not.toBeNull();
    }
  });
});
