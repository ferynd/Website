/**
 * @file analysis/engine.js
 * @description Core analysis engine for weight trend, TDEE, BMR, imputation, and plateau detection.
 *
 * All computation is pure functions — no Firebase or DOM access.
 * Consumes merged daily rows and returns a results object for the UI.
 */

import { DAY_ACTIVITY_LEVELS } from '../constants.js';

// ==========================================
// CONFIGURATION — all tuneable knobs
// ==========================================
export const ANALYSIS_CONFIG = {
  // Unit conversion
  LB_TO_KG: 0.45359237,
  ENERGY_DENSITY_KCAL_PER_KG: 7700,

  // EWMA smoothing
  EWMA_SPAN: 10, // equivalent "span" — alpha = 2/(span+1) ≈ 0.182

  // Water noise correction: fallback bucket thresholds (used when regression unavailable)
  SODIUM_HIGH_THRESHOLD: 2800, // mg
  CARBS_HIGH_THRESHOLD: 200,   // g
  // Minimum complete-predictor days required to attempt OLS regression
  MIN_DAYS_FOR_WATER_REGRESSION: 20,

  // TDEE block
  TDEE_BLOCK_DAYS: 14,
  TDEE_PLAUSIBLE_MIN: 1200,
  TDEE_PLAUSIBLE_MAX: 4500,

  // Multi-horizon TDEE estimates (days)
  HORIZONS: { QUICK: 14, PRIMARY: 28, STABILITY_1: 42, STABILITY_2: 56 },

  // PAL constraints — maps to training bump levels
  PAL_RANGES: {
    0:   [1.20, 1.40],
    100: [1.30, 1.55],
    280: [1.45, 1.70],
    400: [1.55, 1.85],
  },
  PAL_GRID_STEPS: 11,

  // Calorie imputation
  IMPUTE_LAG_DAYS: 14,
  IMPUTE_MIN_FUTURE_WEIGHTS: 7,
  IMPUTE_CAL_MIN: 600,
  IMPUTE_CAL_MAX: 6000,

  // Plateau detection
  PLATEAU_WINDOW_DAYS: 21,
  PLATEAU_SLOPE_THRESHOLD_LB_PER_WEEK: 0.25,

  // Confidence thresholds (minimum days with both weight and logged calories)
  DATA_SUFFICIENCY_THRESHOLDS: { ROUGH: 14, MODERATE: 28, HIGH: 42 },

  // Default preferred weigh-in window: 6–9 AM (minutes from midnight)
  WEIGH_IN_WINDOW_DEFAULT: { startMin: 360, endMin: 540 },

  // Maximum per-day water-weight correction magnitude in lb
  MAX_WATER_CORRECTION_LB: 2.0,
};

// ==========================================
// HELPERS
// ==========================================

function ewmaAlpha(span) { return 2 / (span + 1); }

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function mad(arr) {
  const med = median(arr);
  return median(arr.map(v => Math.abs(v - med)));
}

function trimmedMean(arr, p = 0.1) {
  if (arr.length < 4) return median(arr);
  const sorted = [...arr].sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor(arr.length * p));
  const trimmed = sorted.slice(cut, sorted.length - cut);
  return trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
}

function linearRegression(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] || 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i];
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

function dateOffset(dateStr, offsetDays) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Return the PAL bucket key (0 | 100 | 280 | 400) nearest to `bump`. */
function nearestPalKey(palKeys, bump) {
  return palKeys.reduce((b, k) => Math.abs(k - bump) < Math.abs(b - bump) ? k : b, palKeys[0]);
}

/** Resolve exercise calories for a merged row: sessions take priority over legacy bump. */
function rowExerciseCalories(r) {
  return r.exerciseCalories != null ? r.exerciseCalories : (r.trainingBump || 0);
}

/**
 * Solve Ax = b via Gauss-Jordan elimination with partial pivoting.
 * Returns the solution vector or null if the system is singular.
 */
function solveLinearSystem(A, b) {
  const n = b.length;
  // Augmented matrix [A | b]
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) return null;

    // Eliminate all other rows
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Ordinary least squares via normal equations with a small ridge term for stability.
 * X: array of feature-row arrays, y: response array.
 * Returns coefficient vector or null on failure.
 */
function solveOLS(X, y) {
  const n = X.length;
  const p = X[0].length;
  const RIDGE = 0.01; // tiny ridge for numerical stability only

  const XtX = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty = Array(p).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let k = 0; k < p; k++) XtX[j][k] += X[i][j] * X[i][k];
    }
  }
  for (let j = 0; j < p; j++) XtX[j][j] += RIDGE;

  return solveLinearSystem(XtX, Xty);
}

// ==========================================
// DAILY WEIGHT SELECTION (multi-weigh-in)
// ==========================================

/**
 * Given an array of weigh-in readings for one day, select the single best representative.
 *
 * Priority:
 *  1. If a preferred window is defined and any reading falls in it, return the
 *     median (by weight) of those in-window readings.
 *  2. Otherwise return the reading with the smallest time_min (earliest in day).
 *  3. If all time_min are null, return the first reading.
 *
 * @param {Array<{weight_lb:number, time_min:number|null}>} readings
 * @param {{startMin:number, endMin:number}|null} preferredWindow
 * @returns {object}
 */
export function selectDailyWeight(readings, preferredWindow = null) {
  if (!readings || readings.length === 0) return null;
  if (readings.length === 1) return readings[0];

  if (preferredWindow) {
    const { startMin, endMin } = preferredWindow;
    const inWindow = readings.filter(
      r => r.time_min != null && r.time_min >= startMin && r.time_min <= endMin
    );
    if (inWindow.length > 0) {
      // Median of in-window readings (robust to single outlier syncs)
      const sorted = [...inWindow].sort((a, b) => a.weight_lb - b.weight_lb);
      return sorted[Math.floor(sorted.length / 2)];
    }
  }

  // Fall back to earliest reading
  const withTime = readings.filter(r => r.time_min != null);
  if (withTime.length > 0) {
    return withTime.reduce((best, r) => r.time_min < best.time_min ? r : best, withTime[0]);
  }
  return readings[0];
}

// ==========================================
// EXERCISE CALORIES DERIVATION
// ==========================================

/**
 * Derive exercise calories from a nutrition entry's exerciseSessions array or
 * fall back to the legacy trainingBump field.
 *
 * Priority per session: manualCalories > wearableCalories > estimatedCalories
 * If no sessions, falls back to trainingBump.
 *
 * @param {object|null} nEntry - nutrition entry (dailyEntries value)
 * @returns {{ exerciseCalories, exerciseSource, exerciseSessionCount, legacyTrainingBumpUsed }}
 */
export function deriveExerciseCalories(nEntry) {
  const sessions = nEntry?.exerciseSessions;
  let exerciseCalories = 0;
  let exerciseSource = 'none';
  let exerciseSessionCount = 0;
  let legacyTrainingBumpUsed = false;

  if (Array.isArray(sessions) && sessions.length > 0) {
    exerciseSessionCount = sessions.length;
    let totalCals = 0;
    let dominantSource = 'estimated';
    for (const s of sessions) {
      if (s.manualCalories != null && s.manualCalories > 0) {
        totalCals += s.manualCalories;
        dominantSource = 'manual';
      } else if (s.wearableCalories != null && s.wearableCalories > 0) {
        totalCals += s.wearableCalories;
        if (dominantSource === 'estimated') dominantSource = 'wearable';
      } else if (s.estimatedCalories != null && s.estimatedCalories > 0) {
        totalCals += s.estimatedCalories;
      }
    }
    exerciseCalories = totalCals;
    exerciseSource = dominantSource;
  } else {
    // Check dayActivityLevel next (new entries without logged sessions)
    const level = nEntry?.dayActivityLevel;
    if (level && level !== 'rest' && level !== 'custom') {
      const bump = DAY_ACTIVITY_LEVELS[level]?.bump || 0;
      if (bump > 0) {
        exerciseCalories = bump;
        exerciseSource = 'day_activity_level';
      }
    } else {
      const bump = parseFloat(nEntry?.trainingBump) || 0;
      if (bump > 0) {
        exerciseCalories = bump;
        exerciseSource = 'legacy_bump';
        legacyTrainingBumpUsed = true;
      }
    }
  }

  return { exerciseCalories, exerciseSource, exerciseSessionCount, legacyTrainingBumpUsed };
}

// ==========================================
// STEP 1: MERGE weight + nutrition into daily rows
// ==========================================

/**
 * Merge weight entries and nutrition entries into a unified daily array.
 *
 * @param {Map} weightEntries      - state.weightEntries (docId → entry)
 * @param {Map} dailyEntries       - state.dailyEntries
 * @param {Map|null} weightEntriesMulti - state.weightEntriesMulti (date → Array), optional
 * @param {object|null} profile    - state.userProfile for preferred weigh-in window, optional
 * @returns {Array<object>} Sorted array of daily rows
 */
export function mergeDailyData(weightEntries, dailyEntries, weightEntriesMulti = null, profile = null) {
  const dateMap = new Map();

  // Determine preferred weigh-in window from profile or use default
  let preferredWindow = ANALYSIS_CONFIG.WEIGH_IN_WINDOW_DEFAULT;
  if (profile) {
    const s = parseFloat(profile.preferredWeighInStartMin);
    const e = parseFloat(profile.preferredWeighInEndMin);
    if (!isNaN(s) && !isNaN(e) && s < e) preferredWindow = { startMin: s, endMin: e };
  }

  // Build per-date weight representative using multi-weigh-in map when available
  const weightByDate = new Map();
  if (weightEntriesMulti && weightEntriesMulti.size > 0) {
    for (const [dateStr, readings] of weightEntriesMulti) {
      const best = selectDailyWeight(readings, preferredWindow);
      if (best) weightByDate.set(dateStr, best);
    }
  } else {
    // Fall back: from the flat map, keep the reading with the lowest time_min per date
    for (const [, entry] of weightEntries) {
      const d = entry.date;
      if (!weightByDate.has(d) || entry.time_min < weightByDate.get(d).time_min) {
        weightByDate.set(d, entry);
      }
    }
  }

  const allDates = new Set([...weightByDate.keys(), ...dailyEntries.keys()]);

  for (const dateStr of allDates) {
    const wEntry = weightByDate.get(dateStr);
    const nEntry = dailyEntries.get(dateStr);

    const exFields = deriveExerciseCalories(nEntry || null);
    dateMap.set(dateStr, {
      date: dateStr,
      weight_lb: wEntry ? wEntry.weight_lb : null,
      time_min: wEntry ? wEntry.time_min : null,
      calories: nEntry ? (parseFloat(nEntry.calories) || null) : null,
      sodium: nEntry ? (parseFloat(nEntry.sodium) || null) : null,
      carbs: nEntry ? (parseFloat(nEntry.carbs) || null) : null,
      fiber: nEntry ? (parseFloat(nEntry.fiber) || null) : null,
      trainingBump: nEntry ? (parseFloat(nEntry.trainingBump) || 0) : 0,
      ...exFields,
    });
  }

  return [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ==========================================
// STEP 2: WATER NOISE CORRECTION
// ==========================================

/**
 * Estimate and remove systematic water-weight noise from daily weigh-ins.
 *
 * Strategy:
 *  1. Compute a 7-day rolling baseline for each weight reading.
 *  2. Fit an OLS regression (intercept + sodium_z + carbs_z [+ fiber_z]) to the
 *     residuals from that baseline, provided ≥20 complete-predictor days exist.
 *     A small ridge term prevents overfitting on sparse data.
 *  3. If insufficient data for regression, fall back to adaptive median buckets
 *     (using the data-driven median sodium/carb as thresholds, not fixed values).
 *  4. Remove the fitted component from each weight reading → weight_corr.
 *  5. Return { rows, uncertaintyLb } where uncertaintyLb is the RMSE of the
 *     residuals AFTER correction — an honest uncertainty band (±lb) that the
 *     UI should surface rather than hide.
 *
 * IMPORTANT: corrections here are statistical estimates, not exact physiology.
 * Water weight is also influenced by stress, sleep, hormones, and dozens of other
 * factors not captured in the food log. The returned uncertaintyLb reflects this.
 */
export function waterCorrect(rows) {
  const C = ANALYSIS_CONFIG;
  const result = rows.map(r => ({ ...r }));

  // Pass 1: 7-day rolling baseline
  for (let i = 0; i < result.length; i++) {
    if (result[i].weight_lb == null) continue;
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - 6); j <= i; j++) {
      if (result[j].weight_lb != null) { sum += result[j].weight_lb; count++; }
    }
    result[i]._baseline = count >= 3 ? sum / count : result[i].weight_lb;
  }

  // Gather rows with complete predictor data
  const trainRows = result.filter(
    r => r.weight_lb != null && r._baseline != null && r.sodium != null && r.carbs != null
  );

  let correctFn = null;   // (row) => correction in lb
  let uncertaintyLb = null;
  let usedOLS = false;

  if (trainRows.length >= C.MIN_DAYS_FOR_WATER_REGRESSION) {
    // Standardise predictors
    const sodVals = trainRows.map(r => r.sodium);
    const carbVals = trainRows.map(r => r.carbs);
    const sodMean = sodVals.reduce((s, v) => s + v, 0) / sodVals.length;
    const carbMean = carbVals.reduce((s, v) => s + v, 0) / carbVals.length;
    const sodSd = Math.max(1, stdDev(sodVals));
    const carbSd = Math.max(1, stdDev(carbVals));

    // Include fiber only when it has >50% coverage
    const fibRows = trainRows.filter(r => r.fiber != null);
    const useFiber = fibRows.length > trainRows.length * 0.5;
    const fibMean = useFiber ? fibRows.reduce((s, r) => s + r.fiber, 0) / fibRows.length : 0;
    const fibSd = useFiber ? Math.max(1, stdDev(fibRows.map(r => r.fiber))) : 1;

    const fitRows = useFiber ? fibRows : trainRows;
    const X = fitRows.map(r => [
      1,
      (r.sodium - sodMean) / sodSd,
      (r.carbs - carbMean) / carbSd,
      ...(useFiber ? [(r.fiber - fibMean) / fibSd] : []),
    ]);
    const y = fitRows.map(r => r.weight_lb - r._baseline);

    try {
      const beta = solveOLS(X, y);
      if (beta && beta.every(v => !isNaN(v) && isFinite(v))) {
        correctFn = (r) => {
          if (r.sodium == null || r.carbs == null) return 0;
          const fib = useFiber && r.fiber != null ? (r.fiber - fibMean) / fibSd : 0;
          return beta[0]
            + beta[1] * (r.sodium - sodMean) / sodSd
            + beta[2] * (r.carbs - carbMean) / carbSd
            + (useFiber ? beta[3] * fib : 0);
        };
        usedOLS = true;

        const residAfter = fitRows.map(r => {
          const resid = r.weight_lb - r._baseline;
          return resid - correctFn(r);
        });
        uncertaintyLb = +(Math.sqrt(
          residAfter.reduce((s, v) => s + v * v, 0) / residAfter.length
        )).toFixed(2);
      }
    } catch (_e) {
      correctFn = null;
    }
  }

  if (!correctFn) {
    // Adaptive median-bucket fallback (data-driven thresholds)
    const sodThr = trainRows.length > 0
      ? median(trainRows.map(r => r.sodium))
      : C.SODIUM_HIGH_THRESHOLD;
    const carbThr = trainRows.length > 0
      ? median(trainRows.map(r => r.carbs))
      : C.CARBS_HIGH_THRESHOLD;

    const buckets = { hh: [], hl: [], lh: [], ll: [] };
    for (const r of result) {
      if (r.weight_lb == null || r._baseline == null || r.sodium == null || r.carbs == null) continue;
      const key = (r.sodium > sodThr ? 'h' : 'l') + (r.carbs > carbThr ? 'h' : 'l');
      buckets[key].push(r.weight_lb - r._baseline);
    }
    const medCorr = {};
    for (const key of Object.keys(buckets)) {
      medCorr[key] = buckets[key].length >= 3 ? median(buckets[key]) : 0;
    }
    correctFn = (r) => {
      if (r.sodium == null || r.carbs == null) return 0;
      const key = (r.sodium > sodThr ? 'h' : 'l') + (r.carbs > carbThr ? 'h' : 'l');
      return medCorr[key] || 0;
    };

    const allResid = Object.values(buckets).flat();
    if (allResid.length > 3) {
      uncertaintyLb = +(mad(allResid) * 1.4826).toFixed(2); // MAD → σ equiv.
    }
  }

  // Apply corrections with per-day cap to prevent over-correction
  const CAP = C.MAX_WATER_CORRECTION_LB;
  for (const r of result) {
    if (r.weight_lb == null) { r.weight_corr = null; r._waterCorrection = 0; continue; }
    const rawCorr = correctFn(r);
    const corr = Math.min(Math.max(rawCorr, -CAP), CAP);
    r._waterCorrection = corr;
    r.weight_corr = r.weight_lb - corr;
  }

  return {
    rows: result,
    uncertaintyLb: uncertaintyLb ?? null,
    waterCorrectionMethod: usedOLS ? 'ols_regression' : 'median_bucket_adaptive',
    predictorDays: trainRows.length,
  };
}

// ==========================================
// STEP 3: EWMA SMOOTHING
// ==========================================

export function smoothWeight(rows) {
  const alpha = ewmaAlpha(ANALYSIS_CONFIG.EWMA_SPAN);
  const result = rows.map(r => ({ ...r }));
  let prev = null;

  for (const r of result) {
    if (r.weight_corr == null) { r.wt_smooth_lb = prev; continue; }
    r.wt_smooth_lb = prev == null ? r.weight_corr : alpha * r.weight_corr + (1 - alpha) * prev;
    prev = r.wt_smooth_lb;
  }
  return result;
}

// ==========================================
// STEP 4: TDEE BLOCK ESTIMATION (14-day rolling)
// ==========================================

export function estimateTDEE(rows) {
  const C = ANALYSIS_CONFIG;
  const result = rows.map(r => ({ ...r }));
  const blockDays = C.TDEE_BLOCK_DAYS;

  for (let i = blockDays; i < result.length; i++) {
    const window = result.slice(i - blockDays, i + 1);
    const cals = window.map(r => r.calories).filter(c => c != null);
    if (cals.length < window.length * 0.7) continue;

    const wStart = window[0].wt_smooth_lb;
    const wEnd = window[window.length - 1].wt_smooth_lb;
    if (wStart == null || wEnd == null) continue;

    const avgIntake = cals.reduce((s, v) => s + v, 0) / cals.length;
    const deltaKg = (wEnd - wStart) * C.LB_TO_KG;
    const avgStorage = C.ENERGY_DENSITY_KCAL_PER_KG * deltaKg / blockDays;
    const tdee = avgIntake - avgStorage;

    if (tdee >= C.TDEE_PLAUSIBLE_MIN && tdee <= C.TDEE_PLAUSIBLE_MAX) {
      const calCoverage = cals.length / window.length;
      result[i].tdee_block = Math.round(tdee);
      result[i].calCoverage = +calCoverage.toFixed(2);
      result[i].tdee_block_quality = calCoverage >= 0.85 ? 'high' : 'medium';
    }
  }
  return result;
}

// ==========================================
// MULTI-HORIZON TDEE ESTIMATES
// ==========================================

/**
 * Compute aggregate TDEE estimates at multiple horizons using calendar-date cutoffs.
 *
 * Window = [latestDate - (horizonDays-1), latestDate] — exactly `horizonDays` calendar
 * days regardless of how many valid block rows fall within it.
 *
 * High-quality blocks (calCoverage ≥ 0.85) are preferred when ≥ 5 exist; otherwise
 * all plausible blocks in the window are used.
 *
 * @param {Array} rows - Rows with tdee_block populated (output of estimateTDEE)
 * @returns {object} { 14: {...}, 28: {...}, 42: {...}, 56: {...} }
 */
export function estimateTDEEByHorizon(rows) {
  const C = ANALYSIS_CONFIG;
  const horizons = C.HORIZONS;
  const result = {};

  const allValid = rows.filter(r => r.tdee_block != null && r.wt_smooth_lb != null);
  if (allValid.length === 0) {
    for (const [label, days] of Object.entries(horizons)) {
      result[days] = {
        tdee: null, daysUsed: 0, available: false, label,
        calendarStart: null, calendarEnd: null, blockCount: 0,
        coveragePct: 0, daysWindow: days, reason: 'no_data',
      };
    }
    return result;
  }

  const latestDate = allValid[allValid.length - 1].date;

  for (const [label, days] of Object.entries(horizons)) {
    const cutoffDate = dateOffset(latestDate, -(days - 1));
    const windowRows = allValid.filter(r => r.date >= cutoffDate);

    const highRows = windowRows.filter(r => r.tdee_block_quality === 'high');
    const primaryRows = highRows.length >= 5 ? highRows : windowRows;
    const tdees = primaryRows.map(r => r.tdee_block);

    const calendarStart = windowRows.length > 0 ? windowRows[0].date : cutoffDate;
    const blockCount = tdees.length;
    const coveragePct = Math.round(100 * windowRows.length / days);

    if (tdees.length < 5) {
      result[days] = {
        tdee: null,
        daysUsed: tdees.length,
        available: false,
        label,
        calendarStart,
        calendarEnd: latestDate,
        blockCount,
        coveragePct,
        daysWindow: days,
        reason: 'insufficient_blocks',
      };
    } else {
      result[days] = {
        tdee: Math.round(trimmedMean(tdees)),
        daysUsed: tdees.length,
        available: true,
        label,
        calendarStart,
        calendarEnd: latestDate,
        blockCount,
        coveragePct,
        daysWindow: days,
        reason: highRows.length >= 5 ? 'high_quality_blocks' : 'mixed_quality_blocks',
      };
    }
  }
  return result;
}

// ==========================================
// PROFILE-BASED RMR ESTIMATE
// ==========================================

/**
 * Compute a profile-predicted RMR using Mifflin-St Jeor (primary) or a
 * weight-only fallback. This is used as a Bayesian prior / sanity anchor
 * for the data-driven BMR model.
 *
 * @param {object|null} profile    - state.userProfile
 * @param {number|null} weightLb   - latest smoothed weight in lb
 * @returns {{ rmr:number, method:string, note:string }|null}
 */
export function estimateProfileRmr(profile, weightLb) {
  if (!weightLb || weightLb <= 0) return null;
  const C = ANALYSIS_CONFIG;
  const weightKg = weightLb * C.LB_TO_KG;

  if (profile) {
    const age = (() => {
      if (profile.birthDate) {
        const birth = new Date(profile.birthDate);
        if (!isNaN(birth.getTime())) {
          const today = new Date();
          let a = today.getFullYear() - birth.getFullYear();
          const m = today.getMonth() - birth.getMonth();
          if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) a--;
          if (a > 0 && a < 120) return a;
        }
      }
      const n = Number(profile.age);
      return !isNaN(n) && n > 0 && n < 120 ? n : null;
    })();

    const hv = parseFloat(profile.heightValue);
    const heightCm = hv > 0
      ? (profile.heightUnit === 'cm' ? hv : hv * 2.54)
      : null;

    const sex = profile.sex; // 'male' | 'female'

    if (age && heightCm && (sex === 'male' || sex === 'female')) {
      // Mifflin-St Jeor
      const rmr = sex === 'male'
        ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
        : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
      return {
        rmr: Math.round(rmr),
        method: 'mifflin_st_jeor',
        note: 'Mifflin-St Jeor equation (height + age + sex)',
      };
    }

    // Cunningham if BF% available
    const bf = parseFloat(profile.bodyFatPercent);
    if (!isNaN(bf) && bf > 0 && bf < 60) {
      const ffmKg = weightKg * (1 - bf / 100);
      const rmr = 500 + 22 * ffmKg;
      return { rmr: Math.round(rmr), method: 'cunningham', note: 'Cunningham equation (lean mass)' };
    }
  }

  // Weight-only fallback (~21 kcal/kg is a rough population midpoint)
  return {
    rmr: Math.round(21 * weightKg),
    method: 'weight_only',
    note: 'Weight-only estimate (no height/age/sex available). Use profile for accuracy.',
  };
}

// ==========================================
// STEP 5: BMR ESTIMATION with PAL GRID SEARCH
// ==========================================

/**
 * Estimate BMR via PAL grid search.
 *
 * When `profileRmrKcal` is supplied it acts as a fallback/prior:
 *  - If data is insufficient, a profile-based estimate is returned instead
 *    of a plain error so that new users still get a reasonable model.
 *  - The fitted BMR is compared to the profile prediction; a large deviation
 *    is flagged as potential logging noise rather than labelled "metabolic
 *    adaptation" (which would over-claim biological certainty).
 *
 * Returns an extended object including:
 *  - profilePredictedRmr      : from Mifflin-St Jeor / Cunningham / weight-only
 *  - observedTdee             : trimmed mean of high-quality block estimates
 *  - modelPredictedRestDayTdee: fittedBmr × restPal (model output, not empirical)
 *  - fittedDataQuality        : 'high' | 'mixed' — whether the fit used only full-coverage blocks
 *  - loggingResidualNote      : plain-language flag about residual size
 */
export function estimateBMR(rows, profileRmrKcal = null) {
  const C = ANALYSIS_CONFIG;

  const valid = rows.filter(r => r.tdee_block != null && r.wt_smooth_lb != null);

  // Prefer high-quality blocks (full calorie coverage) for all estimates
  const highQualValid = valid.filter(r => r.tdee_block_quality === 'high');
  const tdeeSource = highQualValid.length >= 5 ? highQualValid : valid;
  const allTDEEs = tdeeSource.map(r => r.tdee_block);
  const observedTdee = allTDEEs.length >= 5 ? Math.round(trimmedMean(allTDEEs)) : null;

  // Use high-quality blocks for BMR fitting when enough exist;
  // 20 matches the minimum post-outlier-rejection count in tryPals.
  const fitSource = highQualValid.length >= 20 ? highQualValid : valid;
  const fittedDataQuality = fitSource === highQualValid ? 'high' : 'mixed';

  if (valid.length < 30) {
    // Not enough data for grid search — use profile RMR as fallback if available
    if (profileRmrKcal && profileRmrKcal > 0) {
      const restPal = 1.30; // conservative rest-day PAL
      const tdeeRestDay = Math.round(profileRmrKcal * restPal);
      return {
        pals: { 0: restPal, 100: 1.45, 280: 1.58, 400: 1.70 },
        a: 0, b: 0,
        fittedBmr: profileRmrKcal,
        bmr_current: profileRmrKcal,
        bmr_baseline: profileRmrKcal,
        modelResidual: 0,
        modelResidualSd: 0,
        // Deprecated aliases for backward compat
        adaptation: 0,
        adaptationSD: 0,
        tdee_current: observedTdee ?? tdeeRestDay,
        tdee_rest_day: tdeeRestDay,
        modelPredictedRestDayTdee: tdeeRestDay,
        observedTdee,
        profilePredictedRmr: profileRmrKcal,
        fittedDataQuality: null,
        score: null,
        source: 'profile_prior',
        insufficientData: true,
        error: `Only ${valid.length} day(s) with both weight and calories — need 30 for a fitted model. Showing profile-based estimate.`,
      };
    }
    return {
      observedTdee,
      profilePredictedRmr: profileRmrKcal,
      error: `Not enough data (need 30+ days with both weight and calorie data; have ${valid.length}).`,
    };
  }

  const palKeys = Object.keys(C.PAL_RANGES).map(Number).sort((a, b) => a - b);
  const grids = {};
  for (const k of palKeys) {
    const [lo, hi] = C.PAL_RANGES[k];
    const step = (hi - lo) / (C.PAL_GRID_STEPS - 1);
    grids[k] = Array.from({ length: C.PAL_GRID_STEPS }, (_, i) => lo + i * step);
  }

  let bestScore = Infinity, bestPals = {}, bestModel = {};

  function tryPals(pals) {
    const wts = [], bmrs = [];
    for (const r of fitSource) {
      const palKey = nearestPalKey(palKeys, rowExerciseCalories(r));
      const impliedBMR = r.tdee_block / pals[palKey];
      wts.push(r.wt_smooth_lb * C.LB_TO_KG);
      bmrs.push(impliedBMR);
    }
    const reg1 = linearRegression(wts, bmrs);
    const resid1 = bmrs.map((b, i) => b - (reg1.intercept + reg1.slope * wts[i]));
    const cutoff = 1.5 * mad(resid1);
    const keepIdx = resid1.map((r, i) => [Math.abs(r), i]).filter(([v]) => v <= cutoff).map(([, i]) => i);
    if (keepIdx.length < 20) return null;
    const wts2 = keepIdx.map(i => wts[i]);
    const bmrs2 = keepIdx.map(i => bmrs[i]);
    const reg2 = linearRegression(wts2, bmrs2);
    const resid2 = bmrs2.map((b, i) => b - (reg2.intercept + reg2.slope * wts2[i]));
    return { score: mad(resid2), a: reg2.intercept, b: reg2.slope };
  }

  function searchPals(gridSubset) {
    const keys = Object.keys(gridSubset).map(Number).sort((a, b) => a - b);
    function recurse(depth, current) {
      if (depth === keys.length) {
        const res = tryPals(current);
        if (res && res.score < bestScore) { bestScore = res.score; bestPals = { ...current }; bestModel = res; }
        return;
      }
      const k = keys[depth];
      for (const v of gridSubset[k]) { current[k] = v; recurse(depth + 1, current); }
    }
    recurse(0, {});
  }

  const coarseGrids = {};
  for (const k of palKeys) coarseGrids[k] = grids[k].filter((_, i) => i % 2 === 0);
  searchPals(coarseGrids);

  if (Object.keys(bestPals).length > 0) {
    const fineGrids = {};
    for (const k of palKeys) {
      const bv = bestPals[k], [lo, hi] = C.PAL_RANGES[k];
      const step = (hi - lo) / (C.PAL_GRID_STEPS - 1);
      fineGrids[k] = [Math.max(lo, bv - step), bv, Math.min(hi, bv + step)];
    }
    searchPals(fineGrids);
  }

  if (!bestModel.a && bestModel.a !== 0) {
    return { observedTdee, profilePredictedRmr: profileRmrKcal, error: 'BMR model fitting failed.' };
  }

  const lastValid = [...valid].reverse().find(r => r.wt_smooth_lb != null);
  const currentWtKg = lastValid.wt_smooth_lb * C.LB_TO_KG;
  const bmrBase = bestModel.a + bestModel.b * currentWtKg;

  // fittedBmr = pure regression output — no residual folded in
  const fittedBmr = Math.round(bmrBase);

  const recent = valid.slice(-21);
  const adaptResiduals = recent.map(r => {
    const palKey = nearestPalKey(palKeys, rowExerciseCalories(r));
    const impliedBMR = r.tdee_block / bestPals[palKey];
    const fittedBMR = bestModel.a + bestModel.b * r.wt_smooth_lb * C.LB_TO_KG;
    return impliedBMR - fittedBMR;
  });
  // modelResidual is the ambiguous gap — could be logging error, water noise, or biology
  const modelResidual = Math.round(median(adaptResiduals));
  const modelResidualSd = Math.round(stdDev(adaptResiduals));

  const restPal = bestPals[0] || 1.3;
  // tdee_rest_day uses pure fittedBmr — not inflated by residual
  const tdeeRestDay = Math.round(bmrBase * restPal);

  const recentTDEEs = valid.slice(-21).map(r => r.tdee_block).filter(t => t != null);
  const tdeeRecent = recentTDEEs.length >= 7 ? Math.round(trimmedMean(recentTDEEs)) : tdeeRestDay;

  let loggingResidualNote = null;
  if (Math.abs(modelResidual) > 150) {
    loggingResidualNote = Math.abs(modelResidual) > 300
      ? 'Large gap between predicted and observed energy balance — likely reflects logging gaps or water weight noise, not just biology.'
      : 'Moderate gap between predicted and observed balance — could be logging error, activity change, or water noise.';
  }

  return {
    pals: bestPals,
    a: bestModel.a,
    b: bestModel.b,
    fittedBmr,
    bmr_current: fittedBmr,
    bmr_baseline: fittedBmr,
    modelResidual,
    modelResidualSd,
    // Deprecated aliases for backward compat
    adaptation: modelResidual,
    adaptationSD: modelResidualSd,
    tdee_current: tdeeRecent,
    tdee_rest_day: tdeeRestDay,
    modelPredictedRestDayTdee: tdeeRestDay,
    observedTdee,
    profilePredictedRmr: profileRmrKcal,
    loggingResidualNote,
    fittedDataQuality,
    score: bestScore,
    source: 'fitted',
  };
}

// ==========================================
// DATA SUFFICIENCY & CONFIDENCE
// ==========================================

/**
 * Assess how confident we should be in the energy model.
 *
 * @param {Array}  rows     - Merged daily rows
 * @param {object} bmrModel - Output of estimateBMR
 * @returns {{ label, score, reasons, daysWithWeight, daysWithLoggedCalories }}
 */
export function computeConfidence(rows, bmrModel) {
  const C = ANALYSIS_CONFIG;
  const thresholds = C.DATA_SUFFICIENCY_THRESHOLDS;

  const daysWithWeight = rows.filter(r => r.weight_lb != null).length;
  const daysWithLoggedCalories = rows.filter(r => r.calories != null && !r.calories_imputed).length;
  const minDays = Math.min(daysWithWeight, daysWithLoggedCalories);

  let label;
  if (minDays < thresholds.ROUGH) label = 'not_enough';
  else if (minDays < thresholds.MODERATE) label = 'rough';
  else if (minDays < thresholds.HIGH) label = 'moderate';
  else label = 'high';

  // Score: 0–100
  const score = label === 'not_enough' ? 0
    : label === 'rough' ? 20
    : label === 'moderate' ? 55
    : 85;

  const reasons = [];

  if (daysWithWeight >= thresholds.HIGH) {
    reasons.push(`${daysWithWeight} days of weight data — strong foundation.`);
  } else if (daysWithWeight >= thresholds.MODERATE) {
    reasons.push(`${daysWithWeight} days of weight data — moderate. 42+ gives higher confidence.`);
  } else {
    reasons.push(`Only ${daysWithWeight} days of weight data. Need at least ${thresholds.ROUGH} to start.`);
  }

  if (daysWithLoggedCalories >= thresholds.HIGH) {
    reasons.push(`${daysWithLoggedCalories} days with logged calories — good coverage.`);
  } else if (daysWithLoggedCalories >= thresholds.ROUGH) {
    reasons.push(`${daysWithLoggedCalories} days with logged calories. More logging = better estimates.`);
  } else {
    reasons.push(`Only ${daysWithLoggedCalories} logged food days. Log consistently for useful estimates.`);
  }

  // Recent gaps
  const recent30 = rows.slice(-30);
  const recentGaps = recent30.filter(r => r.calories == null && r.weight_lb != null).length;
  if (recentGaps > 7) {
    reasons.push(`${recentGaps} recent days without calorie logs — gaps reduce recent accuracy.`);
  }

  // BMR model quality
  if (bmrModel && !bmrModel.error && bmrModel.score != null) {
    if (bmrModel.score < 50) reasons.push('BMR model fit is tight — consistent logging pattern.');
    else if (bmrModel.score > 150) reasons.push('BMR model fit is loose — variable logging or activity.');
  }

  if (bmrModel?.source === 'profile_prior') {
    reasons.push('Using profile-based estimate — not enough data yet for a fitted model.');
  }

  if (bmrModel?.fittedDataQuality === 'mixed') {
    reasons.push('BMR fit includes some weeks with incomplete calorie logs — vacation or logging gaps may reduce model precision.');
  }

  return { label, score, reasons, daysWithWeight, daysWithLoggedCalories };
}

// ==========================================
// LOGGING RESIDUAL
// ==========================================

/**
 * Estimate the gap between what the TDEE model predicts and what the weight
 * data implies, expressed as a daily calorie residual.
 *
 * A positive residual means the model over-predicts expenditure relative to
 * the scale (could be under-logging OR lower-than-predicted activity OR water
 * noise). A negative residual means the opposite.
 *
 * This function explicitly declines to label the residual as "metabolic
 * adaptation" because scale + food-log data cannot separate that from
 * logging error and water weight noise.
 *
 * @param {Array}  rows     - Rows with tdee_block and calories
 * @param {object} bmrModel
 * @returns {{ medianKcalPerDay, sdKcalPerDay, note } | null}
 */
export function computeLoggingResidual(rows, bmrModel) {
  if (!bmrModel || bmrModel.error) return null;

  const C = ANALYSIS_CONFIG;
  const palKeys = Object.keys(C.PAL_RANGES).map(Number).sort((a, b) => a - b);

  // For each row with both tdee_block and actual calories, compute:
  // residual = predictedTDEE(by PAL model) - observedTDEE(block estimate)
  const residuals = [];
  for (const r of rows) {
    if (r.tdee_block == null || r.calories == null) continue;
    const palKey = nearestPalKey(palKeys, rowExerciseCalories(r));
    const pal = bmrModel.pals?.[palKey];
    if (!pal) continue;
    const wtKg = r.wt_smooth_lb != null ? r.wt_smooth_lb * C.LB_TO_KG : null;
    if (!wtKg) continue;
    // Use pure fitted BMR (no residual) — the residual IS the quantity we're measuring here
    const predictedTDEE = (bmrModel.a + bmrModel.b * wtKg) * pal;
    residuals.push(predictedTDEE - r.tdee_block);
  }

  if (residuals.length < 5) return null;

  const med = Math.round(median(residuals));
  const sd = Math.round(stdDev(residuals));

  let note;
  if (Math.abs(med) < 100) {
    note = 'Model and observations agree closely.';
  } else if (med > 0) {
    note = `Model predicts ~${med} kcal/day more than observed — could reflect under-logging, lower actual activity, or water noise. Cannot distinguish from scale data alone.`;
  } else {
    note = `Model predicts ~${Math.abs(med)} kcal/day less than observed — could reflect over-logging, higher actual activity, or water noise. Cannot distinguish from scale data alone.`;
  }

  return { medianKcalPerDay: med, sdKcalPerDay: sd, note };
}

// ==========================================
// STEP 6: CALORIE IMPUTATION
// ==========================================

export function imputeCalories(rows, bmrModel) {
  const C = ANALYSIS_CONFIG;
  const result = rows.map(r => ({ ...r, calories_imputed: false, impute_status: null }));

  if (bmrModel.error) return result;

  const palKeys = Object.keys(C.PAL_RANGES).map(Number).sort((a, b) => a - b);
  const today = result.length > 0 ? result[result.length - 1].date : null;
  if (!today) return result;

  for (let i = 1; i < result.length; i++) {
    const r = result[i];
    if (r.calories != null) continue;

    const age = daysBetween(r.date, today);
    if (age < C.IMPUTE_LAG_DAYS) { r.impute_status = 'pending'; continue; }

    if (r.wt_smooth_lb == null || result[i - 1].wt_smooth_lb == null) {
      r.impute_status = 'insufficient_weight_data';
      continue;
    }

    const futureWeights = result.slice(i + 1, i + 1 + C.IMPUTE_MIN_FUTURE_WEIGHTS)
      .filter(fr => fr.weight_lb != null);
    if (futureWeights.length < C.IMPUTE_MIN_FUTURE_WEIGHTS) { r.impute_status = 'pending'; continue; }

    const palKey = nearestPalKey(palKeys, rowExerciseCalories(r));
    const pal = bmrModel.pals?.[palKey];
    if (!pal) { r.impute_status = 'insufficient_weight_data'; continue; }

    const wtKg = r.wt_smooth_lb * C.LB_TO_KG;
    // Use pure fitted BMR (no residual) so imputed calories reflect the structural model
    const predictedBMR = (bmrModel.a || 0) + (bmrModel.b || 0) * wtKg;
    const predictedTDEE = predictedBMR > 0 ? predictedBMR * pal : (bmrModel.tdee_current || 2000);
    const deltaKg = (r.wt_smooth_lb - result[i - 1].wt_smooth_lb) * C.LB_TO_KG;
    const calHat = predictedTDEE + C.ENERGY_DENSITY_KCAL_PER_KG * deltaKg;

    if (calHat >= C.IMPUTE_CAL_MIN && calHat <= C.IMPUTE_CAL_MAX) {
      r.calories = Math.round(calHat);
      r.calories_imputed = true;
      r.impute_status = 'imputed';
    } else {
      r.impute_status = 'out_of_range';
    }
  }
  return result;
}

// ==========================================
// STEP 7: PLATEAU DETECTION
// ==========================================

export function detectPlateau(rows) {
  const C = ANALYSIS_CONFIG;
  const recent = rows.slice(-C.PLATEAU_WINDOW_DAYS).filter(r => r.wt_smooth_lb != null);

  if (recent.length < 10) {
    return { isPlateaued: false, slopeLbPerWeek: null, daysCovered: 0, message: 'Not enough recent weight data for plateau detection.' };
  }

  const firstDate = recent[0].date;
  const xs = recent.map(r => daysBetween(firstDate, r.date));
  const ys = recent.map(r => r.wt_smooth_lb);
  const { slope } = linearRegression(xs, ys);
  const slopeLbPerWeek = slope * 7;
  const isPlateaued = Math.abs(slopeLbPerWeek) < C.PLATEAU_SLOPE_THRESHOLD_LB_PER_WEEK;

  let message;
  if (isPlateaued) {
    message = `Weight has been stable (${slopeLbPerWeek >= 0 ? '+' : ''}${slopeLbPerWeek.toFixed(2)} lb/week) over the last ${recent.length} days.`;
  } else if (slopeLbPerWeek < 0) {
    message = `Losing ${Math.abs(slopeLbPerWeek).toFixed(2)} lb/week over the last ${recent.length} days.`;
  } else {
    message = `Gaining ${slopeLbPerWeek.toFixed(2)} lb/week over the last ${recent.length} days.`;
  }

  return { isPlateaued, slopeLbPerWeek, daysCovered: recent.length, message };
}

// ==========================================
// BLANK DAY POPULATION
// ==========================================

export function getBlankDaysForPopulation(rows, dailyEntries, baselineTargets) {
  const firstFoodRow = rows.find(r => {
    if (!r.calories_imputed && r.calories != null) {
      const entry = dailyEntries.get(r.date);
      return entry && (parseFloat(entry.calories) || 0) > 0;
    }
    return false;
  });
  if (!firstFoodRow) return [];
  const firstFoodDate = firstFoodRow.date;

  const MICRO_KEYS = [
    'fiber', 'potassium', 'magnesium', 'sodium', 'calcium', 'choline',
    'vitaminB12', 'folate', 'vitaminC', 'vitaminB6',
    'vitaminA', 'vitaminD', 'vitaminE', 'vitaminK',
    'selenium', 'iodine', 'phosphorus', 'iron', 'zinc', 'omega3',
  ];

  const loggedEntries = [];
  for (const entry of dailyEntries.values()) {
    if ((parseFloat(entry.calories) || 0) > 0) loggedEntries.push(entry);
  }

  function avgNutrient(key, fallback) {
    const vals = loggedEntries.map(e => parseFloat(e[key])).filter(v => !isNaN(v) && v > 0);
    if (vals.length === 0) return fallback ?? 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  const avgProtein = avgNutrient('protein', parseFloat(baselineTargets.protein) || 150);
  const avgFat = avgNutrient('fat', parseFloat(baselineTargets.fatMinimum ?? baselineTargets.fat) || 50);
  const avgMicros = {};
  for (const key of MICRO_KEYS) {
    avgMicros[key] = avgNutrient(key, parseFloat(baselineTargets[key]) || 0);
  }

  return rows
    .filter(r => r.date >= firstFoodDate && r.calories_imputed)
    .map(r => {
      const existingEntry = dailyEntries.get(r.date) || {};
      const trainingBump = parseFloat(existingEntry.trainingBump) || 0;
      const estCals = r.calories;
      const carbsG = Math.max(0, Math.round((estCals - avgProtein * 4 - avgFat * 9) / 4));

      const foodItem = {
        id: `est-${r.date}`,
        name: "Day's estimate",
        quantity: 1,
        timestamp: `${r.date}T12:00:00.000Z`,
        calories: estCals,
        protein: avgProtein,
        fat: avgFat,
        carbs: carbsG,
        ...avgMicros,
      };

      const now = new Date().toISOString();
      return {
        date: r.date,
        schemaVersion: 2,
        entryType: 'estimate',
        calories: estCals,
        protein: avgProtein,
        fat: avgFat,
        carbs: carbsG,
        trainingBump,
        foodItems: [foodItem],
        exerciseSessions: [],
        dayActivityLevel: null,
        manualLock: false,
        calorieAdjustmentItems: [],
        estimateMeta: {
          method: 'tdee_weight_delta',
          modelVersion: '2.0',
          confidence: 'medium',
          sourceDataWindow: ANALYSIS_CONFIG.TDEE_BLOCK_DAYS,
          createdAt: now,
          updatedAt: now,
          locked: false,
        },
        ...avgMicros,
      };
    });
}

// ==========================================
// SYNTHETIC ITEM DETECTION
// ==========================================

/** Names assigned to auto-generated food entries by the estimation system. */
export const SYNTHETIC_ITEM_NAMES = new Set([
  "Day's estimate",
  "Estimated vacation day",
  "Unlogged intake estimate",
]);

/**
 * Returns true when a foodItem was created synthetically (not by the user).
 * Detects by name OR by the id prefix convention (est- / vac- / adj-).
 */
export function isSyntheticItem(item) {
  if (!item) return false;
  if (SYNTHETIC_ITEM_NAMES.has(item.name)) return true;
  if (typeof item.id === 'string') {
    return item.id.startsWith('est-') || item.id.startsWith('vac-') || item.id.startsWith('adj-');
  }
  return false;
}

// ==========================================
// DAY CLASSIFICATION
// ==========================================

/**
 * Classify a single day into one of six mutually-exclusive types:
 *
 *   'logged'    – has real (non-synthetic) food items; model residual < threshold
 *   'partial'   – has real food; model residual ≥ threshold (possible underreporting)
 *   'mixed'     – real food + a synthetic "Unlogged intake estimate" already applied
 *   'estimated' – entire day is synthetic (entryType='estimate')
 *   'vacation'  – explicitly marked via vacationDayType field
 *   'blank'     – no entry at all, or entry with no calories and no food items
 *
 * @param {object}      row          – Analysis row (date, calories_imputed, …)
 * @param {object|null} dailyEntry   – Normalized entry from state.dailyEntries
 * @param {number|null} residualKcal – Model underreporting gap for this day (optional)
 * @returns {string}
 */
export function classifyDay(row, dailyEntry, residualKcal = null) {
  const PARTIAL_THRESHOLD = 400; // kcal

  if (!dailyEntry) {
    return (row && row.calories_imputed) ? 'estimated' : 'blank';
  }

  if (dailyEntry.vacationDayType) return 'vacation';
  if ((dailyEntry.entryType || 'logged') === 'estimate') return 'estimated';

  const items = Array.isArray(dailyEntry.foodItems) ? dailyEntry.foodItems : [];
  const realItems = items.filter(fi => !isSyntheticItem(fi));
  const hasAdjustItem = items.some(fi => fi.name === 'Unlogged intake estimate');

  if (realItems.length === 0 && items.length === 0) return 'blank';
  if (realItems.length === 0 && items.length > 0) return 'estimated';
  if (realItems.length > 0 && hasAdjustItem) return 'mixed';
  if (residualKcal != null && residualKcal >= PARTIAL_THRESHOLD) return 'partial';

  return 'logged';
}

/**
 * Classify every day that appears in the analysis rows.
 * @returns {Map<string, string>}  dateStr → classification
 */
export function classifyAllDays(rows, dailyEntries, perDayResiduals = null) {
  const result = new Map();
  for (const row of rows) {
    const entry = dailyEntries.get(row.date) || null;
    const residual = perDayResiduals ? (perDayResiduals.get(row.date) ?? null) : null;
    result.set(row.date, classifyDay(row, entry, residual));
  }
  return result;
}

// ==========================================
// VACATION / MISSED DAY ESTIMATION
// ==========================================

/** Calorie-adjustment parameters keyed by vacation day type. */
export const VACATION_TYPE_CONFIG = {
  light: {
    label: 'Light',
    description: 'Relaxed day — lower activity, leisurely meals',
    tdeeMultiplier: 0.85,
    calorieOffset: -100,
  },
  medium: {
    label: 'Medium',
    description: 'Typical day away — some walking, normal eating',
    tdeeMultiplier: 1.00,
    calorieOffset: 0,
  },
  heavy: {
    label: 'Heavy',
    description: 'Active or indulgent day — more food and/or activity than usual',
    tdeeMultiplier: 1.10,
    calorieOffset: 200,
  },
  custom: {
    label: 'Custom',
    description: 'Set your own calorie estimate for this day',
    tdeeMultiplier: 1.00,
    calorieOffset: 0,
  },
};

/**
 * Compute per-weekday average calories from logged (non-synthetic) entries.
 *
 * Uses only real food items' calories so that mixed entries (real food plus a
 * synthetic "Unlogged intake estimate") do not inflate the weekday baseline.
 *
 * @param {Map} dailyEntries
 * @returns {Array<number|null>}  7-element array indexed by getDay() (0=Sun … 6=Sat)
 */
export function computeWeekdayAverages(dailyEntries) {
  const buckets = [[], [], [], [], [], [], []];
  for (const [dateStr, entry] of dailyEntries) {
    if (entry.entryType === 'estimate') continue;
    const items = Array.isArray(entry.foodItems) ? entry.foodItems : [];
    let cals;
    if (items.length > 0) {
      // Sum only real (non-synthetic) food items so mixed entries don't inflate the baseline.
      const realItems = items.filter(fi => !isSyntheticItem(fi));
      cals = realItems.reduce((s, fi) => s + (parseFloat(fi.quantity ?? 1) || 0) * (parseFloat(fi.calories) || 0), 0);
    } else {
      // Legacy entries without a foodItems array: use the top-level total directly.
      cals = parseFloat(entry.calories) || 0;
    }
    if (cals <= 0) continue;
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    buckets[dow].push(cals);
  }
  return buckets.map(arr =>
    arr.length === 0 ? null : arr.reduce((s, v) => s + v, 0) / arr.length
  );
}

/**
 * Estimate calories for a vacation/missed day.
 *
 * Method priority:
 *   1. User-specified custom value (vacationType='custom', customCalories provided)
 *   2. TDEE model (empirical or profile-based) × type multiplier + offset
 *      + weekday adjustment when pattern data exists
 *   3. Goal target calories (fallback)
 *   4. Generic 2000 kcal default
 *
 * @param {string}        vacationType
 * @param {object|null}   bmrModel
 * @param {string}        dateStr         – 'YYYY-MM-DD'
 * @param {object|null}   goalSettings
 * @param {number|null}   customCalories  – used only when vacationType='custom'
 * @param {Array|null}    weekdayAverages – 7-element array from computeWeekdayAverages()
 * @returns {{ calories, confidence, method, note }}
 */
export function estimateVacationCalories(
  vacationType, bmrModel, dateStr,
  goalSettings = null, customCalories = null, weekdayAverages = null
) {
  const cfg = VACATION_TYPE_CONFIG[vacationType] || VACATION_TYPE_CONFIG.medium;

  if (vacationType === 'custom' && customCalories != null && customCalories > 0) {
    return {
      calories: Math.round(customCalories),
      confidence: 'low',
      method: 'user_specified',
      note: 'User-specified calories for this day.',
    };
  }

  let baseTdee = null;
  let method = 'tdee_model';
  let confidence = 'low';

  if (bmrModel && !bmrModel.error) {
    baseTdee = bmrModel.observedTdee || bmrModel.tdee_current || bmrModel.tdee_rest_day;
    confidence = bmrModel.source === 'fitted' ? 'medium' : 'low';
  }

  if (!baseTdee && goalSettings) {
    const g = parseFloat(goalSettings.targetCalories);
    if (!isNaN(g) && g > 0) { baseTdee = g; method = 'goal_calories'; }
  }

  if (!baseTdee) {
    return {
      calories: 2000, confidence: 'low', method: 'default_fallback',
      note: 'No TDEE data available — using 2000 kcal generic default.',
    };
  }

  let weekdayAdjust = 0;
  if (weekdayAverages && dateStr) {
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    const dayAvg = weekdayAverages[dow];
    const allAvgs = weekdayAverages.filter(v => v != null);
    if (dayAvg != null && allAvgs.length > 0) {
      const overallAvg = allAvgs.reduce((s, v) => s + v, 0) / allAvgs.length;
      weekdayAdjust = Math.round(dayAvg - overallAvg);
      if (method === 'tdee_model') method = 'tdee_weekday';
    }
  }

  const raw = baseTdee * cfg.tdeeMultiplier + cfg.calorieOffset + weekdayAdjust;
  const bounded = Math.max(600, Math.min(6000, Math.round(raw)));
  const tdeeSource = bmrModel?.source === 'fitted' ? 'empirical TDEE' : 'profile TDEE';
  const offsetStr = weekdayAdjust !== 0
    ? ` and weekday pattern offset (${weekdayAdjust > 0 ? '+' : ''}${weekdayAdjust} kcal)`
    : '';
  const note = `Estimated from your ${tdeeSource} (${Math.round(baseTdee)} kcal) with ${cfg.label.toLowerCase()} vacation adjustment${offsetStr}.`;

  return { calories: bounded, confidence, method, note };
}

/**
 * Build a complete estimated entry for a vacation or explicitly missed day.
 * Caller should pass the result to saveEstimatedEntry().
 *
 * @param {string}      dateStr
 * @param {string}      vacationType
 * @param {object|null} analysisResults – full output of runAnalysis
 * @param {Map}         dailyEntries
 * @param {object}      baselineTargets
 * @param {number|null} customCalories  – only used when vacationType='custom'
 * @returns {object}  Complete v2 entry
 */
export function buildVacationDayEntry(dateStr, vacationType, analysisResults, dailyEntries, baselineTargets, customCalories = null) {
  const bmrModel = analysisResults?.bmrModel || null;
  const weekdayAverages = computeWeekdayAverages(dailyEntries);

  const estimate = estimateVacationCalories(
    vacationType, bmrModel, dateStr, null, customCalories, weekdayAverages
  );

  const MICRO_KEYS = [
    'fiber','potassium','magnesium','sodium','calcium','choline',
    'vitaminB12','folate','vitaminC','vitaminB6',
    'vitaminA','vitaminD','vitaminE','vitaminK',
    'selenium','iodine','phosphorus','iron','zinc','omega3',
  ];

  // Per-day nutrient sums using real (non-synthetic) food items where available.
  // Falls back to top-level entry fields for legacy entries that have no foodItems array.
  // This prevents synthetic adjustment items from inflating historical averages.
  const realDayTotals = [];
  for (const e of dailyEntries.values()) {
    if (e.entryType === 'estimate') continue;
    const items = Array.isArray(e.foodItems) ? e.foodItems : [];
    if (items.length > 0) {
      const real = items.filter(fi => !isSyntheticItem(fi));
      if (real.length === 0) continue;
      const daySum = {};
      for (const fi of real) {
        const qty = parseFloat(fi.quantity ?? 1) || 0;
        for (const k of Object.keys(fi)) {
          if (k === 'quantity') continue;
          const v = parseFloat(fi[k]);
          if (!isNaN(v)) daySum[k] = (daySum[k] || 0) + qty * v;
        }
      }
      realDayTotals.push(daySum);
    } else {
      // Legacy entry: use top-level fields directly.
      const cal = parseFloat(e.calories) || 0;
      if (cal <= 0) continue;
      realDayTotals.push(e);
    }
  }

  function avgNutrient(key, fallback) {
    const vals = realDayTotals.map(d => parseFloat(d[key]) || 0).filter(v => v > 0);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : (fallback ?? 0);
  }

  const avgProtein = avgNutrient('protein', parseFloat(baselineTargets.protein) || 150);
  const avgFat = avgNutrient('fat', parseFloat(baselineTargets.fatMinimum ?? baselineTargets.fat) || 50);
  const avgMicros = Object.fromEntries(
    MICRO_KEYS.map(k => [k, avgNutrient(k, parseFloat(baselineTargets[k]) || 0)])
  );

  const estCals = estimate.calories;
  const carbsG = Math.max(0, Math.round((estCals - avgProtein * 4 - avgFat * 9) / 4));
  const trainingBump = parseFloat((dailyEntries.get(dateStr) || {}).trainingBump) || 0;
  const now = new Date().toISOString();

  const prevEntry = dailyEntries.get(dateStr);
  const prevMeta = prevEntry?.estimateMeta || null;

  return {
    date: dateStr,
    schemaVersion: 2,
    entryType: 'estimate',
    vacationDayType: vacationType,
    calories: estCals,
    protein: Math.round(avgProtein),
    fat: Math.round(avgFat),
    carbs: carbsG,
    trainingBump,
    foodItems: [{
      id: `vac-${dateStr}`,
      name: 'Estimated vacation day',
      quantity: 1,
      timestamp: `${dateStr}T12:00:00.000Z`,
      calories: estCals,
      protein: Math.round(avgProtein),
      fat: Math.round(avgFat),
      carbs: carbsG,
      ...avgMicros,
    }],
    exerciseSessions: [],
    dayActivityLevel: null,
    manualLock: false,
    calorieAdjustmentItems: [],
    estimateMeta: {
      method: estimate.method,
      modelVersion: '2.1',
      confidence: estimate.confidence,
      sourceDataWindow: ANALYSIS_CONFIG.TDEE_BLOCK_DAYS,
      createdAt: prevMeta?.createdAt || now,
      updatedAt: now,
      locked: false,
      previousEstimate: prevMeta,
    },
    ...avgMicros,
  };
}

// ==========================================
// PARTIAL / UNDERREPORTED DAY DETECTION
// ==========================================

const PARTIAL_RESIDUAL_THRESHOLD_KCAL = 400;

/**
 * Find days with logged food that the model believes are significantly underreported.
 *
 * A day qualifies when:
 *   - It has real (non-synthetic) food items
 *   - The model-predicted TDEE minus logged calories ≥ PARTIAL_RESIDUAL_THRESHOLD_KCAL
 *   - It has not already been adjusted (no "Unlogged intake estimate" item)
 *   - It is not locked
 *   - It is at least IMPUTE_LAG_DAYS old (same staleness requirement as imputation)
 *
 * @param {Array}  rows         – output of runAnalysis (with tdee_block populated)
 * @param {Map}    dailyEntries
 * @param {object} bmrModel     – output of estimateBMR
 * @returns {Array<{ date, loggedCalories, modelEstimate, residual, confidence, reason }>}
 *          Sorted descending by residual.
 */
export function getPartialDaysForAdjustment(rows, dailyEntries, bmrModel) {
  if (!bmrModel || bmrModel.error || !bmrModel.pals) return [];

  const C = ANALYSIS_CONFIG;
  const palKeys = Object.keys(C.PAL_RANGES).map(Number).sort((a, b) => a - b);
  const today = rows.length > 0 ? rows[rows.length - 1].date : new Date().toISOString().slice(0, 10);

  const results = [];

  for (const r of rows) {
    const age = daysBetween(r.date, today);
    if (age < C.IMPUTE_LAG_DAYS) continue;

    const entry = dailyEntries.get(r.date);
    if (!entry) continue;
    if (entry.entryType === 'estimate' || entry.vacationDayType) continue;
    if (entry.manualLock) continue;

    const loggedCals = parseFloat(entry.calories) || 0;
    if (loggedCals <= 0) continue;

    if ((entry.foodItems || []).some(fi => fi.name === 'Unlogged intake estimate')) continue;

    const realItems = (entry.foodItems || []).filter(fi => !isSyntheticItem(fi));
    if (realItems.length === 0) continue;

    if (r.wt_smooth_lb == null || r.tdee_block == null) continue;

    const palKey = nearestPalKey(palKeys, rowExerciseCalories(r));
    const pal = bmrModel.pals[palKey];
    if (!pal) continue;

    const wtKg = r.wt_smooth_lb * C.LB_TO_KG;
    const predictedBmr = (bmrModel.a || 0) + (bmrModel.b || 0) * wtKg;
    const predictedCals = predictedBmr > 0
      ? Math.round(predictedBmr * pal)
      : (bmrModel.tdee_current || 2000);

    const residual = predictedCals - loggedCals;
    if (residual < PARTIAL_RESIDUAL_THRESHOLD_KCAL) continue;

    results.push({
      date: r.date,
      loggedCalories: Math.round(loggedCals),
      modelEstimate: predictedCals,
      residual: Math.round(residual),
      confidence: bmrModel.source === 'fitted' ? 'medium' : 'low',
      reason: residual > 800
        ? 'Very large gap — likely a significantly incomplete log (missed meals).'
        : 'Moderate gap — possible missed snacks or underweighed portions.',
    });
  }

  return results.sort((a, b) => b.residual - a.residual);
}

/**
 * Unified true-up candidate finder.
 * Returns blank days and likely-underreported partial days, each with
 * per-interval evidence and a derived confidence score.
 *
 * @param {Array}  rows            – runAnalysis() output rows
 * @param {Map}    dailyEntries
 * @param {object} bmrModel        – estimateBMR() output
 * @param {object} baselineTargets
 * @returns {Array} Sorted descending by date.
 */
export function getTrueUpCandidates(rows, dailyEntries, bmrModel, baselineTargets) {
  if (!rows || rows.length === 0) return [];

  const C = ANALYSIS_CONFIG;
  const today = rows[rows.length - 1].date;

  // Build weekday and recent medians for pattern comparison
  const weekdayBuckets = [[], [], [], [], [], [], []];
  const recentCalories = [];
  const recentCutoff = dateOffset(today, -28);

  for (const [dateStr, entry] of dailyEntries) {
    if (entry.entryType === 'estimate') continue;
    if (entry.manualLock) continue;
    const realItems = (entry.foodItems || []).filter(fi => !isSyntheticItem(fi));
    const cals = realItems.length > 0
      ? realItems.reduce((s, fi) => s + (parseFloat(fi.quantity ?? 1) || 0) * (parseFloat(fi.calories) || 0), 0)
      : parseFloat(entry.calories) || 0;
    if (cals <= 0) continue;
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    weekdayBuckets[dow].push(cals);
    if (dateStr >= recentCutoff) recentCalories.push(cals);
  }

  const weekdayMedians = weekdayBuckets.map(arr => arr.length >= 3 ? median(arr) : null);
  const recentMedian = recentCalories.length >= 7 ? median(recentCalories) : null;

  const INTERVALS = [
    { days: 14, name: '14d' },
    { days: 28, name: '28d' },
    { days: 42, name: '42d' },
  ];

  const candidates = [];

  for (const row of rows) {
    const age = daysBetween(row.date, today);
    if (age < C.IMPUTE_LAG_DAYS) continue;

    const entry = dailyEntries.get(row.date);
    const isLocked = entry && (entry.manualLock || entry.estimateMeta?.locked);
    if (isLocked) continue;

    // Skip if already has a partial adjustment item
    if (entry) {
      const hasAdj = (entry.foodItems || []).some(fi => fi.id?.startsWith('adj-'));
      if (hasAdj) continue;
    }

    // Classify day
    let type = null;
    let loggedCalories = 0;
    let realItemCount = 0;

    if (!entry || (parseFloat(entry.calories) || 0) === 0) {
      if (row.calories_imputed || row.impute_status === 'pending') {
        type = 'blank';
        loggedCalories = 0;
      }
    } else if (entry.entryType !== 'estimate') {
      const realItems = (entry.foodItems || []).filter(fi => !isSyntheticItem(fi));
      realItemCount = realItems.length;
      loggedCalories = realItems.length > 0
        ? realItems.reduce((s, fi) => s + (parseFloat(fi.quantity ?? 1) || 0) * (parseFloat(fi.calories) || 0), 0)
        : parseFloat(entry.calories) || 0;

      if (loggedCalories > 0) {
        const dow = new Date(row.date + 'T00:00:00').getDay();
        const refCals = weekdayMedians[dow] ?? recentMedian ?? 2000;
        // Partial: logged significantly below personal baseline, few items
        if (loggedCalories < refCals * 0.55 && realItemCount >= 1 && realItemCount <= 10) {
          type = 'partial';
        }
      }
    }

    if (!type) continue;

    // Compute interval evidence
    const intervalsUsed = [];

    for (const { days, name } of INTERVALS) {
      const start = dateOffset(row.date, -days);
      const intervalRows = rows.filter(r => r.date >= start && r.date < row.date);
      if (intervalRows.length < 7) continue;

      const weightRows = intervalRows.filter(r => r.wt_smooth_lb != null);
      if (weightRows.length < 5) continue;

      const loggedCount = intervalRows.filter(r => {
        const e = dailyEntries.get(r.date);
        return e ? (parseFloat(e.calories) || 0) > 0 : r.calories_imputed;
      }).length;
      const coverage = loggedCount / intervalRows.length;
      if (coverage < 0.5) continue;

      // Weight-based energy storage change
      const firstW = weightRows[0].wt_smooth_lb;
      const lastW = weightRows[weightRows.length - 1].wt_smooth_lb;
      const energyStorageChange = (lastW - firstW) * 3500;

      // Reported intake
      let totalIntake = 0;
      for (const r of intervalRows) {
        const e = dailyEntries.get(r.date);
        totalIntake += e ? (parseFloat(e.calories) || 0) : (r.calories_imputed ? (r.calories || 0) : 0);
      }

      // Expected expenditure from TDEE model
      const tdeeRows = intervalRows.filter(r => r.tdee_block != null);
      if (tdeeRows.length < 3 && (!bmrModel || bmrModel.error)) continue;
      const avgTdee = tdeeRows.length >= 3
        ? tdeeRows.reduce((s, r) => s + r.tdee_block, 0) / tdeeRows.length
        : (bmrModel?.tdee_current || 2000);

      const expectedExpenditure = avgTdee * intervalRows.length;
      const intervalResidual = expectedExpenditure - totalIntake + energyStorageChange;
      const perDay = Math.round(intervalResidual / intervalRows.length);

      intervalsUsed.push({
        name,
        days,
        intervalStart: start,
        intervalEnd: row.date,
        perDayResidual: perDay,
        coverage: Math.round(coverage * 100),
        weightPoints: weightRows.length,
      });
    }

    if (intervalsUsed.length === 0) continue;

    // Pick best interval (prefer 28d > 42d > 14d)
    const sorted = [...intervalsUsed].sort((a, b) => {
      const p = { '28d': 0, '42d': 1, '14d': 2 };
      return (p[a.name] ?? 3) - (p[b.name] ?? 3);
    });
    const primary = sorted[0];
    const perDay = primary.perDayResidual;

    if (perDay <= 0) continue;

    const recommendedDelta = Math.min(perDay, 1500);
    const expectedCalories = loggedCalories + perDay;

    // Skip likely-intentional low-cal days (small implied deficit already matches goal)
    if (type === 'partial') {
      const tdee = bmrModel?.tdee_current;
      if (tdee && (tdee - loggedCalories) < 250) continue;
    }

    // Derive confidence
    const has28 = intervalsUsed.some(i => i.name === '28d');
    const has42 = intervalsUsed.some(i => i.name === '42d');
    const multiInterval = has28 || has42;
    const highCoverage = intervalsUsed.every(i => i.coverage >= 70);
    const enoughWeight = intervalsUsed.every(i => i.weightPoints >= 10);
    const residuals = intervalsUsed.map(i => i.perDayResidual);
    const agree = residuals.length >= 2
      ? Math.max(...residuals) - Math.min(...residuals) < 200
      : true;

    let score = 0;
    if (has28 && has42) score += 30;
    else if (multiInterval) score += 15;
    if (highCoverage) score += 25;
    if (enoughWeight) score += 20;
    if (agree) score += 15;
    if (type === 'blank') score += 10;

    const confidence = score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';
    const reviewManually = recommendedDelta > 1000;
    const checkedByDefault = !reviewManually && confidence !== 'low';

    const reason = type === 'blank'
      ? `No food logged — model estimates ~${Math.round(expectedCalories)} kcal from ${primary.days}-day window.`
      : (perDay > 600
        ? 'Large gap — likely missed meals or significantly under-logged.'
        : 'Moderate gap — possible missed snacks or partial log.');

    candidates.push({
      date: row.date,
      type,
      recommendedDelta: Math.round(recommendedDelta),
      loggedCalories: Math.round(loggedCalories),
      expectedCalories: Math.round(expectedCalories),
      intervalStart: primary.intervalStart,
      intervalEnd: primary.intervalEnd,
      intervalsUsed,
      confidence,
      confidenceScore: score,
      reason,
      checkedByDefault,
      reviewManually,
    });
  }

  return candidates.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Build a synthetic adjustment item and an updated entry for a partially-logged day.
 *
 * The synthetic "Unlogged intake estimate" item is APPENDED to the existing foodItems.
 * Real logged food is never modified or deleted.
 *
 * @param {string} dateStr
 * @param {number} residualKcal   – estimated unlogged calories to fill
 * @param {object} dailyEntry     – existing normalized entry (will not be mutated)
 * @param {object} baselineTargets
 * @param {string} confidence     – 'low' | 'medium' | 'high'
 * @returns {{ adjustedEntry, adjustItem }}
 */
export function buildPartialDayAdjustment(dateStr, residualKcal, dailyEntry, baselineTargets, confidence = 'low') {
  const targetCal = parseFloat(baselineTargets.calories) || 2000;
  const fraction = Math.min(Math.max(residualKcal / targetCal, 0), 1);
  const targetProtein = parseFloat(baselineTargets.protein) || 150;
  const targetFat = parseFloat(baselineTargets.fatMinimum ?? baselineTargets.fat) || 50;

  const adjProtein = Math.round(targetProtein * fraction);
  const adjFat = Math.round(targetFat * fraction);
  const adjCarbs = Math.max(0, Math.round((residualKcal - adjProtein * 4 - adjFat * 9) / 4));

  const now = new Date().toISOString();

  const adjustItem = {
    id: `adj-${dateStr}`,
    name: 'Unlogged intake estimate',
    quantity: 1,
    timestamp: `${dateStr}T23:59:00.000Z`,
    calories: Math.round(residualKcal),
    protein: adjProtein,
    fat: adjFat,
    carbs: adjCarbs,
  };

  const existingItems = Array.isArray(dailyEntry.foodItems) ? dailyEntry.foodItems : [];
  const newItems = [...existingItems, adjustItem];
  const sum = key => newItems.reduce((s, fi) => s + (parseFloat(fi.quantity ?? 1) || 0) * (parseFloat(fi[key]) || 0), 0);

  const prevMeta = dailyEntry.estimateMeta || null;

  const adjustedEntry = {
    ...dailyEntry,
    calories: Math.round(sum('calories')),
    protein: Math.round(sum('protein')),
    fat: Math.round(sum('fat')),
    carbs: Math.round(sum('carbs')),
    foodItems: newItems,
    estimateMeta: {
      method: 'underreporting_adjustment',
      modelVersion: '2.1',
      confidence,
      sourceDataWindow: ANALYSIS_CONFIG.TDEE_BLOCK_DAYS,
      createdAt: prevMeta?.createdAt || now,
      updatedAt: now,
      locked: false,
      previousEstimate: prevMeta,
    },
  };

  return { adjustedEntry, adjustItem };
}

// ==========================================
// MAIN PIPELINE
// ==========================================

/**
 * Run the full analysis pipeline.
 *
 * @param {Map}         weightEntries      - state.weightEntries
 * @param {Map}         dailyEntries       - state.dailyEntries
 * @param {object|null} profile            - state.userProfile (for preferred window + profile RMR)
 * @param {Map|null}    weightEntriesMulti - state.weightEntriesMulti (multi-weigh-in map)
 * @returns {object} Complete analysis results
 */
export function runAnalysis(weightEntries, dailyEntries, profile = null, weightEntriesMulti = null) {
  if (weightEntries.size === 0) {
    return { error: 'No weight data. Upload a weight CSV to begin analysis.', rows: [] };
  }

  // Step 1: Merge (preferred-window weigh-in selection)
  let rows = mergeDailyData(weightEntries, dailyEntries, weightEntriesMulti, profile);
  if (rows.length < 7) {
    return { error: 'Not enough data for analysis (need at least 7 days).', rows };
  }

  // Step 2: Water correction (returns {rows, uncertaintyLb, waterCorrectionMethod, predictorDays})
  const {
    rows: correctedRows,
    uncertaintyLb: waterWeightUncertaintyLb,
    waterCorrectionMethod,
    predictorDays: waterPredictorDays,
  } = waterCorrect(rows);
  rows = correctedRows;

  // Step 3: Smooth
  rows = smoothWeight(rows);

  // Step 4: TDEE (14-day rolling)
  rows = estimateTDEE(rows);

  // Step 4b: Multi-horizon TDEE
  const tdeeByHorizon = estimateTDEEByHorizon(rows);

  // Profile RMR (used as prior/fallback)
  const withWeight = rows.filter(r => r.wt_smooth_lb != null);
  const latestWeightLb = withWeight.length > 0 ? withWeight[withWeight.length - 1].wt_smooth_lb : null;
  const profileRmrResult = estimateProfileRmr(profile, latestWeightLb);
  const profileRmrKcal = profileRmrResult?.rmr ?? null;

  // Step 5: BMR (with profile prior)
  const bmrModel = estimateBMR(rows, profileRmrKcal);

  // Step 6: Impute
  rows = imputeCalories(rows, bmrModel);

  // Step 7: Plateau
  const plateau = detectPlateau(rows);

  // Confidence
  const confidence = computeConfidence(rows, bmrModel);

  // Logging residual
  const loggingResidual = computeLoggingResidual(rows, bmrModel);

  // Summary stats
  const startWeight = withWeight.length > 0 ? withWeight[0].wt_smooth_lb : null;
  const currentWeight = latestWeightLb;

  const imputedDays = rows.filter(r => r.calories_imputed);
  const pendingDays = rows.filter(r => r.impute_status === 'pending');

  return {
    rows,
    bmrModel,
    plateau,
    tdeeByHorizon,
    waterWeightUncertaintyLb,
    waterCorrectionMethod,
    waterPredictorDays,
    loggingResidual,
    confidence,
    profileRmr: profileRmrResult,
    summary: {
      currentWeight: currentWeight ? +currentWeight.toFixed(1) : null,
      startWeight: startWeight ? +startWeight.toFixed(1) : null,
      totalWeightChange: currentWeight && startWeight ? +(currentWeight - startWeight).toFixed(1) : null,
      totalDays: rows.length,
      daysWithWeight: withWeight.length,
      daysWithCalories: rows.filter(r => r.calories != null).length,
      daysImputed: imputedDays.length,
      daysPendingImputation: pendingDays.length,
      tdee: bmrModel.error ? null : bmrModel.tdee_current,
      bmr: bmrModel.error ? null : bmrModel.bmr_current,
      observedTdee: bmrModel.observedTdee ?? null,
      restDayCaloriesOut: bmrModel.modelPredictedRestDayTdee ?? bmrModel.tdee_rest_day ?? null,
      profilePredictedRmr: profileRmrKcal,
      confidenceLabel: confidence.label,
      confidenceScore: confidence.score,
      confidenceReasons: confidence.reasons,
      waterWeightUncertaintyLb,
      waterCorrectionMethod,
    },
  };
}
