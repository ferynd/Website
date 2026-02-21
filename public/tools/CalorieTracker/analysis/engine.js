/**
 * @file analysis/engine.js
 * @description Core analysis engine for weight trend, TDEE, BMR, imputation, and plateau detection.
 *
 * All computation is pure functions — no Firebase or DOM access.
 * Consumes merged daily rows and returns a results object for the UI.
 */

// ==========================================
// CONFIGURATION — all tuneable knobs
// ==========================================
export const ANALYSIS_CONFIG = {
  // Unit conversion
  LB_TO_KG: 0.45359237,
  ENERGY_DENSITY_KCAL_PER_KG: 7700,

  // EWMA smoothing
  EWMA_SPAN: 10, // equivalent "span" — alpha = 2/(span+1) ≈ 0.182

  // Water noise correction: bucket thresholds
  SODIUM_HIGH_THRESHOLD: 2800, // mg
  CARBS_HIGH_THRESHOLD: 200,   // g

  // TDEE block
  TDEE_BLOCK_DAYS: 14,
  TDEE_PLAUSIBLE_MIN: 1200,
  TDEE_PLAUSIBLE_MAX: 4500,

  // PAL constraints — maps to training bump levels
  // training bump: 0=rest, 100=light, 280=hard, 400=hiit
  PAL_RANGES: {
    0:   [1.20, 1.40],  // rest / sedentary WFH
    100: [1.30, 1.55],  // light lift
    280: [1.45, 1.70],  // hard lift
    400: [1.55, 1.85],  // HIIT / endurance
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
};

// ==========================================
// HELPERS
// ==========================================

/** Compute EWMA alpha from span */
function ewmaAlpha(span) {
  return 2 / (span + 1);
}

/** Simple median of an array */
function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Population standard deviation (returns 0 for fewer than 2 elements) */
function stdDev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/** Median absolute deviation */
function mad(arr) {
  const med = median(arr);
  return median(arr.map(v => Math.abs(v - med)));
}

/** Trimmed mean — drop top/bottom p fraction */
function trimmedMean(arr, p = 0.1) {
  if (arr.length < 4) return median(arr);
  const sorted = [...arr].sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor(arr.length * p));
  const trimmed = sorted.slice(cut, sorted.length - cut);
  return trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
}

/** Linear regression: returns { slope, intercept } */
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

/** Days between two YYYY-MM-DD strings */
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

// ==========================================
// STEP 1: MERGE weight + nutrition into daily rows
// ==========================================

/**
 * Merge weight entries and nutrition entries into a unified daily array.
 * One row per date, sorted chronologically.
 * @param {Map} weightEntries - state.weightEntries
 * @param {Map} dailyEntries  - state.dailyEntries
 * @returns {Array<object>} Sorted array of daily rows
 */
export function mergeDailyData(weightEntries, dailyEntries) {
  const dateMap = new Map();

  // Aggregate weight: if multiple readings per day, take earliest (lowest time_min)
  const weightByDate = new Map();
  for (const [, entry] of weightEntries) {
    const d = entry.date;
    if (!weightByDate.has(d) || entry.time_min < weightByDate.get(d).time_min) {
      weightByDate.set(d, entry);
    }
  }

  // Create rows for every date that has either weight or nutrition
  const allDates = new Set([...weightByDate.keys(), ...dailyEntries.keys()]);

  for (const dateStr of allDates) {
    const wEntry = weightByDate.get(dateStr);
    const nEntry = dailyEntries.get(dateStr);

    dateMap.set(dateStr, {
      date: dateStr,
      weight_lb: wEntry ? wEntry.weight_lb : null,
      time_min: wEntry ? wEntry.time_min : null,
      calories: nEntry ? (parseFloat(nEntry.calories) || null) : null,
      sodium: nEntry ? (parseFloat(nEntry.sodium) || null) : null,
      carbs: nEntry ? (parseFloat(nEntry.carbs) || null) : null,
      fiber: nEntry ? (parseFloat(nEntry.fiber) || null) : null,
      trainingBump: nEntry ? (parseFloat(nEntry.trainingBump) || 0) : 0,
    });
  }

  return [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ==========================================
// STEP 2: WATER NOISE CORRECTION (median-bucket approach)
// ==========================================

/**
 * Compute a water noise correction per row based on sodium/carb buckets.
 * Returns a new array with `weight_corr` added to each row.
 */
export function waterCorrect(rows) {
  const C = ANALYSIS_CONFIG;

  // First pass: compute baseline rolling mean (7-day backward)
  const result = rows.map((r, i) => ({ ...r }));

  for (let i = 0; i < result.length; i++) {
    if (result[i].weight_lb == null) continue;
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - 6); j <= i; j++) {
      if (result[j].weight_lb != null) { sum += result[j].weight_lb; count++; }
    }
    result[i]._baseline = count >= 3 ? sum / count : result[i].weight_lb;
  }

  // Build buckets: high-sodium vs low, high-carb vs low
  // Then compute median residual per bucket
  const buckets = { hh: [], hl: [], lh: [], ll: [] };

  for (const r of result) {
    if (r.weight_lb == null || r._baseline == null) continue;
    const resid = r.weight_lb - r._baseline;
    const sHigh = r.sodium != null && r.sodium > C.SODIUM_HIGH_THRESHOLD;
    const cHigh = r.carbs != null && r.carbs > C.CARBS_HIGH_THRESHOLD;

    if (r.sodium == null || r.carbs == null) continue; // skip days without nutrition
    const key = (sHigh ? 'h' : 'l') + (cHigh ? 'h' : 'l');
    buckets[key].push(resid);
  }

  const corrections = {};
  for (const key of Object.keys(buckets)) {
    corrections[key] = buckets[key].length >= 3 ? median(buckets[key]) : 0;
  }

  // Apply corrections
  for (const r of result) {
    if (r.weight_lb == null) {
      r.weight_corr = null;
      continue;
    }
    if (r.sodium == null || r.carbs == null) {
      r.weight_corr = r.weight_lb; // no nutrition data to correct with
      continue;
    }
    const sHigh = r.sodium > C.SODIUM_HIGH_THRESHOLD;
    const cHigh = r.carbs > C.CARBS_HIGH_THRESHOLD;
    const key = (sHigh ? 'h' : 'l') + (cHigh ? 'h' : 'l');
    r.weight_corr = r.weight_lb - corrections[key];
  }

  return result;
}

// ==========================================
// STEP 3: EWMA SMOOTHING for "true weight"
// ==========================================

/**
 * Apply EWMA smoothing to weight_corr, producing wt_smooth_lb.
 * Gaps (null weight) are skipped — EWMA resumes from last known value.
 */
export function smoothWeight(rows) {
  const alpha = ewmaAlpha(ANALYSIS_CONFIG.EWMA_SPAN);
  const result = rows.map(r => ({ ...r }));
  let prev = null;

  for (const r of result) {
    if (r.weight_corr == null) {
      r.wt_smooth_lb = prev; // carry forward
      continue;
    }
    if (prev == null) {
      r.wt_smooth_lb = r.weight_corr;
    } else {
      r.wt_smooth_lb = alpha * r.weight_corr + (1 - alpha) * prev;
    }
    prev = r.wt_smooth_lb;
  }

  return result;
}

// ==========================================
// STEP 4: TDEE BLOCK ESTIMATION
// ==========================================

/**
 * Compute rolling-block TDEE estimates.
 * For each day t with a full window of calories and smoothed weight,
 * computes: TDEE = avg_intake - (energy_density * Δweight_kg / window_days)
 */
export function estimateTDEE(rows) {
  const C = ANALYSIS_CONFIG;
  const result = rows.map(r => ({ ...r }));
  const blockDays = C.TDEE_BLOCK_DAYS;

  for (let i = blockDays; i < result.length; i++) {
    const window = result.slice(i - blockDays, i + 1);

    // Need calories for every day in the window
    const cals = window.map(r => r.calories).filter(c => c != null);
    if (cals.length < blockDays * 0.7) continue; // need at least 70% coverage

    // Need smoothed weight at start and end
    const wStart = window[0].wt_smooth_lb;
    const wEnd = window[window.length - 1].wt_smooth_lb;
    if (wStart == null || wEnd == null) continue;

    const avgIntake = cals.reduce((s, v) => s + v, 0) / cals.length;
    const deltaKg = (wEnd - wStart) * C.LB_TO_KG;
    const avgStorage = C.ENERGY_DENSITY_KCAL_PER_KG * deltaKg / blockDays;
    const tdee = avgIntake - avgStorage;

    if (tdee >= C.TDEE_PLAUSIBLE_MIN && tdee <= C.TDEE_PLAUSIBLE_MAX) {
      result[i].tdee_block = Math.round(tdee);
    }
  }

  return result;
}

// ==========================================
// STEP 5: BMR ESTIMATION with PAL GRID SEARCH
// ==========================================

/**
 * Estimate BMR by finding PAL values per training bump level that minimize
 * BMR volatility (MAD of residuals from a weight-based BMR model).
 * @param {Array} rows - Rows with tdee_block and wt_smooth_lb populated
 * @returns {object} BMR model: { pals, a, b, bmr_current, adaptation, tdee_current, error? }
 */
export function estimateBMR(rows) {
  const C = ANALYSIS_CONFIG;

  // Filter to rows with valid TDEE and weight
  const valid = rows.filter(r => r.tdee_block != null && r.wt_smooth_lb != null);
  if (valid.length < 30) {
    return { error: 'Not enough data (need 30+ days with both weight and calorie data).' };
  }

  // Discretize PAL ranges into grids
  const palKeys = Object.keys(C.PAL_RANGES).map(Number).sort((a, b) => a - b);
  const grids = {};
  for (const k of palKeys) {
    const [lo, hi] = C.PAL_RANGES[k];
    const step = (hi - lo) / (C.PAL_GRID_STEPS - 1);
    grids[k] = Array.from({ length: C.PAL_GRID_STEPS }, (_, i) => lo + i * step);
  }

  // For tractability with 4 PAL levels × 11 steps each = 14641 combos — fine
  let bestScore = Infinity;
  let bestPals = {};
  let bestModel = {};

  // Helper to run one PAL combo
  function tryPals(pals) {
    const wts = [];
    const bmrs = [];

    for (const r of valid) {
      const bump = r.trainingBump || 0;
      // Find closest PAL key
      const palKey = palKeys.reduce((best, k) => Math.abs(k - bump) < Math.abs(best - bump) ? k : best, palKeys[0]);
      const pal = pals[palKey];
      const impliedBMR = r.tdee_block / pal;
      const wtKg = r.wt_smooth_lb * C.LB_TO_KG;

      wts.push(wtKg);
      bmrs.push(impliedBMR);
    }

    // Robust fit: BMR ~ a + b * weight_kg
    // Use trimmed regression: drop top/bottom 10% of residuals and refit
    const reg1 = linearRegression(wts, bmrs);
    const resid1 = bmrs.map((b, i) => b - (reg1.intercept + reg1.slope * wts[i]));
    const cutoff = 1.5 * mad(resid1);

    const keepIdx = [];
    for (let i = 0; i < resid1.length; i++) {
      if (Math.abs(resid1[i]) <= cutoff) keepIdx.push(i);
    }

    if (keepIdx.length < 20) return null;

    const wts2 = keepIdx.map(i => wts[i]);
    const bmrs2 = keepIdx.map(i => bmrs[i]);
    const reg2 = linearRegression(wts2, bmrs2);

    // Score: MAD of residuals from trimmed fit
    const resid2 = bmrs2.map((b, i) => b - (reg2.intercept + reg2.slope * wts2[i]));
    const score = mad(resid2);

    return { score, a: reg2.intercept, b: reg2.slope };
  }

  // Grid search over all PAL combos
  // To keep it tractable, do 2-level search:
  // 1) Coarse: step by 2 across grid
  // 2) Fine: refine around best

  function searchPals(gridSubset) {
    const keys = Object.keys(gridSubset).map(Number).sort((a, b) => a - b);

    function recurse(depth, current) {
      if (depth === keys.length) {
        const result = tryPals(current);
        if (result && result.score < bestScore) {
          bestScore = result.score;
          bestPals = { ...current };
          bestModel = result;
        }
        return;
      }
      const k = keys[depth];
      for (const palVal of gridSubset[k]) {
        current[k] = palVal;
        recurse(depth + 1, current);
      }
    }

    recurse(0, {});
  }

  // Coarse search (every other grid point)
  const coarseGrids = {};
  for (const k of palKeys) {
    coarseGrids[k] = grids[k].filter((_, i) => i % 2 === 0);
  }
  searchPals(coarseGrids);

  // Fine search: ±1 step around best
  if (Object.keys(bestPals).length > 0) {
    const fineGrids = {};
    for (const k of palKeys) {
      const bestVal = bestPals[k];
      const [lo, hi] = C.PAL_RANGES[k];
      const step = (hi - lo) / (C.PAL_GRID_STEPS - 1);
      fineGrids[k] = [
        Math.max(lo, bestVal - step),
        bestVal,
        Math.min(hi, bestVal + step)
      ];
    }
    searchPals(fineGrids);
  }

  if (!bestModel.a) {
    return { error: 'BMR model fitting failed.' };
  }

  // Current values
  const lastValid = [...valid].reverse().find(r => r.wt_smooth_lb != null);
  const currentWtKg = lastValid.wt_smooth_lb * C.LB_TO_KG;
  const bmrBase = bestModel.a + bestModel.b * currentWtKg;

  // Adaptation: recent median of (implied BMR - fitted BMR)
  const recent = valid.slice(-21);
  const adaptResiduals = recent.map(r => {
    const bump = r.trainingBump || 0;
    const palKey = palKeys.reduce((best, k) => Math.abs(k - bump) < Math.abs(best - bump) ? k : best, palKeys[0]);
    const impliedBMR = r.tdee_block / bestPals[palKey];
    const fittedBMR = bestModel.a + bestModel.b * r.wt_smooth_lb * C.LB_TO_KG;
    return impliedBMR - fittedBMR;
  });
  const adaptation = Math.round(median(adaptResiduals));
  // SD of the residuals: captures both true day-to-day variation and logging noise
  // (missed entries or incorrect amounts shift the apparent energy balance, so this
  // is a combined "biological + measurement" uncertainty, not just physiology).
  const adaptationSD = Math.round(stdDev(adaptResiduals));

  // Current TDEE estimate for a rest day
  const restPal = bestPals[0] || 1.3;
  const tdeeRestDay = Math.round((bmrBase + adaptation) * restPal);

  // Recent TDEE: trimmed mean of last 21 block estimates
  const recentTDEEs = valid.slice(-21).map(r => r.tdee_block).filter(t => t != null);
  const tdeeRecent = recentTDEEs.length >= 7 ? Math.round(trimmedMean(recentTDEEs)) : tdeeRestDay;

  return {
    pals: bestPals,
    a: bestModel.a,
    b: bestModel.b,
    bmr_current: Math.round(bmrBase + adaptation),
    bmr_baseline: Math.round(bmrBase),
    adaptation,
    adaptationSD,
    tdee_current: tdeeRecent,
    tdee_rest_day: tdeeRestDay,
    score: bestScore,
  };
}

// ==========================================
// STEP 6: CALORIE IMPUTATION for missing days
// ==========================================

/**
 * Impute calories for missing days using TDEE + weight change, with lag gating.
 * @param {Array} rows - Daily rows with wt_smooth_lb
 * @param {object} bmrModel - The BMR model from estimateBMR
 * @returns {Array} Rows with imputed calories and metadata
 */
export function imputeCalories(rows, bmrModel) {
  const C = ANALYSIS_CONFIG;
  const result = rows.map(r => ({ ...r, calories_imputed: false, impute_status: null }));

  if (bmrModel.error) return result;

  const palKeys = Object.keys(C.PAL_RANGES).map(Number).sort((a, b) => a - b);
  const today = result.length > 0 ? result[result.length - 1].date : null;
  if (!today) return result;

  for (let i = 1; i < result.length; i++) {
    const r = result[i];

    // Only impute if calories are missing
    if (r.calories != null) continue;

    // Gate 1: must be old enough
    const age = daysBetween(r.date, today);
    if (age < C.IMPUTE_LAG_DAYS) {
      r.impute_status = 'pending';
      continue;
    }

    // Gate 2: need smoothed weight at this day and the previous day
    if (r.wt_smooth_lb == null || result[i - 1].wt_smooth_lb == null) {
      r.impute_status = 'insufficient_weight_data';
      continue;
    }

    // Gate 3: need enough future weight readings (use the full configured threshold,
    // not Math.min(..., 3) which would silently cap it to 3 and allow imputation
    // on far sparser follow-up data than IMPUTE_MIN_FUTURE_WEIGHTS advertises).
    const futureWeights = result.slice(i + 1, i + 1 + C.IMPUTE_MIN_FUTURE_WEIGHTS)
      .filter(fr => fr.weight_lb != null);
    if (futureWeights.length < C.IMPUTE_MIN_FUTURE_WEIGHTS) {
      r.impute_status = 'pending';
      continue;
    }

    // Predict TDEE for this day
    const bump = r.trainingBump || 0;
    const palKey = palKeys.reduce((best, k) => Math.abs(k - bump) < Math.abs(best - bump) ? k : best, palKeys[0]);
    const pal = bmrModel.pals[palKey];
    const wtKg = r.wt_smooth_lb * C.LB_TO_KG;
    const predictedBMR = bmrModel.a + bmrModel.b * wtKg + bmrModel.adaptation;
    const predictedTDEE = predictedBMR * pal;

    // Infer calories from weight change
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

/**
 * Detect whether the user is in a weight loss plateau.
 * Uses the slope of smoothed weight over the last N days.
 * @param {Array} rows - Daily rows with wt_smooth_lb
 * @returns {object} { isPlateaued, slopeLbPerWeek, daysCovered, message }
 */
export function detectPlateau(rows) {
  const C = ANALYSIS_CONFIG;
  const windowDays = C.PLATEAU_WINDOW_DAYS;

  // Get rows from the last N days that have smoothed weight
  const recent = rows.slice(-windowDays).filter(r => r.wt_smooth_lb != null);

  if (recent.length < 10) {
    return { isPlateaued: false, slopeLbPerWeek: null, daysCovered: 0, message: 'Not enough recent weight data for plateau detection.' };
  }

  // Compute slope via linear regression (days as x, weight as y)
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

/**
 * Return all days eligible to be filled with estimated nutrient data.
 *
 * A day qualifies when:
 *  - Its date is on or after the first date that has REAL (non-imputed) food data.
 *  - The engine successfully imputed a calorie value for it (calories_imputed === true).
 *
 * Each returned object is a ready-to-save Firestore entry whose macros sum to
 * the imputed calorie total (protein and fat are taken from the user's baseline
 * targets; carbs fill the remainder).  All micronutrient fields are set to the
 * baseline targets so that the saved document represents a plausible day.
 *
 * @param {Array}  rows            - Output of imputeCalories() (rows with calories_imputed).
 * @param {Map}    dailyEntries    - state.dailyEntries
 * @param {object} baselineTargets - state.baselineTargets
 * @returns {Array<object>} Estimated daily entries, one per eligible blank day.
 */
export function getBlankDaysForPopulation(rows, dailyEntries, baselineTargets) {
  // Find the earliest date with genuinely logged food (not imputed).
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

  // ── Compute per-nutrient averages from all actually-logged days ──────────
  // Using the historical average of what the user actually ate is a better
  // estimate for a blank day than the static baseline target, which may differ
  // substantially from habitual intake.  Falls back to the baseline target only
  // when no logged data exists for a given nutrient.
  const loggedEntries = [];
  for (const entry of dailyEntries.values()) {
    if ((parseFloat(entry.calories) || 0) > 0) loggedEntries.push(entry);
  }

  function avgNutrient(key, fallback) {
    const vals = loggedEntries
      .map(e => parseFloat(e[key]))
      .filter(v => !isNaN(v) && v > 0);
    if (vals.length === 0) return fallback ?? 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  const avgProtein = avgNutrient('protein', parseFloat(baselineTargets.protein) || 150);
  const avgFat     = avgNutrient('fat',     parseFloat(baselineTargets.fatMinimum ?? baselineTargets.fat) || 50);

  // Pre-compute micro averages once (not per-row).
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

      // Carbs absorb the remainder after protein and fat floors.
      const carbsG = Math.max(0, Math.round((estCals - avgProtein * 4 - avgFat * 9) / 4));

      // The food item carries ALL nutrients so that when the user adjusts quantity
      // (or removes the item), updateItemQuantity() correctly recomputes every
      // entry-level nutrient total — macros and micros alike.
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

      // Build the entry with nutrient totals mirroring qty=1 × foodItem values.
      const entry = {
        date: r.date,
        calories: estCals,
        protein: avgProtein,
        fat: avgFat,
        carbs: carbsG,
        trainingBump,
        foodItems: [foodItem],
        ...avgMicros,
      };

      return entry;
    });
}

// ==========================================
// MAIN PIPELINE: run all steps
// ==========================================

/**
 * Run the full analysis pipeline.
 * @param {Map} weightEntries - From state.weightEntries
 * @param {Map} dailyEntries  - From state.dailyEntries
 * @returns {object} Complete analysis results
 */
export function runAnalysis(weightEntries, dailyEntries) {
  if (weightEntries.size === 0) {
    return { error: 'No weight data. Upload a weight CSV to begin analysis.', rows: [] };
  }

  // Step 1: Merge
  let rows = mergeDailyData(weightEntries, dailyEntries);
  if (rows.length < 7) {
    return { error: 'Not enough data for analysis (need at least 7 days).', rows };
  }

  // Step 2: Water correction
  rows = waterCorrect(rows);

  // Step 3: Smooth
  rows = smoothWeight(rows);

  // Step 4: TDEE
  rows = estimateTDEE(rows);

  // Step 5: BMR
  const bmrModel = estimateBMR(rows);

  // Step 6: Impute
  rows = imputeCalories(rows, bmrModel);

  // Step 7: Plateau
  const plateau = detectPlateau(rows);

  // Summary stats
  const withWeight = rows.filter(r => r.wt_smooth_lb != null);
  const currentWeight = withWeight.length > 0 ? withWeight[withWeight.length - 1].wt_smooth_lb : null;
  const startWeight = withWeight.length > 0 ? withWeight[0].wt_smooth_lb : null;

  const imputedDays = rows.filter(r => r.calories_imputed);
  const pendingDays = rows.filter(r => r.impute_status === 'pending');

  return {
    rows,
    bmrModel,
    plateau,
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
    },
  };
}
