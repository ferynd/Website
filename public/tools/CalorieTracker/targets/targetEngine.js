/**
 * @file targets/targetEngine.js
 * Pure auto-target calculator. No Firebase, no DOM, no state access.
 *
 * Entry point: generateTargets(profile, goals, analysisResults)
 * Returns:     { targets, explanation, warnings, meta }
 *
 * profile  = state.userProfile  (normalizeUserProfile() shape from constants.js)
 * goals    = state.goalSettings (normalizeGoalSettings() shape from constants.js)
 * analysis = state.analysisResults (from analysis/engine.js runAnalysis(), or null)
 */

import {
  getDRI,
  getAgeBand,
  PAL_MULTIPLIERS,
  ACTIVITY_LABELS,
  UL_TABLE,
  mifflinStJeor,
  cunningham,
} from './nutritionReferences.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LB_TO_KG = 0.45359237;
const IN_TO_CM = 2.54;

const MICRONUTRIENT_KEYS = [
  'fiber', 'potassium', 'magnesium', 'sodium', 'calcium', 'choline',
  'vitaminB12', 'folate', 'vitaminC', 'vitaminB6',
  'vitaminA', 'vitaminD', 'vitaminE', 'vitaminK',
  'selenium', 'iodine', 'phosphorus', 'iron', 'zinc', 'omega3',
];

const PROTEIN_RATES = {
  fatLoss:     { rate: 2.2, note: '2.2 g/kg body weight — high protein preserves muscle during a deficit' },
  maintenance: { rate: 1.6, note: '1.6 g/kg body weight — general active maintenance' },
  recomp:      { rate: 2.2, note: '2.2 g/kg body weight — high protein supports muscle retention during recomp' },
  muscleGain:  { rate: 1.8, note: '1.8 g/kg body weight — sufficient for hypertrophy (1.6–2.2 g/kg range)' },
  performance: { rate: 1.8, note: '1.8 g/kg body weight — supports recovery; carbohydrates prioritized for fuel' },
  custom:      { rate: 1.6, note: '1.6 g/kg body weight — general baseline, adjust as needed' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function roundInt(v) { return Math.round(v); }
function round1(v) { return Math.round(v * 10) / 10; }

// ---------------------------------------------------------------------------
// Profile resolution helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Convert stored height to cm. Returns null when not available. */
function resolveHeightCm(profile) {
  const v = profile.heightValue;
  if (!v || v <= 0) return null;
  return profile.heightUnit === 'cm' ? v : v * IN_TO_CM;
}

/**
 * Compute age from birthDate or numeric age field.
 * @param {object} profile
 * @returns {number|null}
 */
export function resolveAge(profile) {
  if (profile.birthDate) {
    const birth = new Date(profile.birthDate);
    if (!isNaN(birth.getTime())) {
      const today = new Date();
      let age = today.getFullYear() - birth.getFullYear();
      const m = today.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
      if (age > 0 && age < 120) return age;
    }
  }
  const age = Number(profile.age);
  if (!isNaN(age) && age > 0 && age < 120) return age;
  return null;
}

/**
 * Resolve current weight in lb from profile + optional analysis results.
 * Priority: manual override > uploaded smoothed weight.
 *
 * @param {object}      profile         - state.userProfile
 * @param {object|null} analysisResults - state.analysisResults or null
 * @returns {{ weightLb: number|null, source: string|null, sourceLabel: string }}
 */
export function resolveCurrentWeightLb(profile, analysisResults) {
  const ovr = parseFloat(profile.manualWeightOverrideLb);
  if (!isNaN(ovr) && ovr > 0) {
    return { weightLb: ovr, source: 'manual_override', sourceLabel: 'Manual entry' };
  }

  if (profile.useUploadedWeightForCurrentWeight !== false) {
    const smoothed = analysisResults?.summary?.currentWeight;
    if (smoothed && smoothed > 0) {
      return {
        weightLb: smoothed,
        source: 'uploaded_smoothed',
        sourceLabel: 'Smoothed from uploaded CSV (water-corrected EWMA)',
      };
    }
  }
  return { weightLb: null, source: null, sourceLabel: 'Not available' };
}

// ---------------------------------------------------------------------------
// Step 1: BMR
// ---------------------------------------------------------------------------

/**
 * Compute BMR/RMR using the best available method.
 * Falls back gracefully when profile data is missing.
 *
 * @param {object} profile
 * @param {number} weightLb
 * @returns {{ bmr: number, method: string, methodLabel: string, ffm_kg: number|null }}
 */
export function computeBMR(profile, weightLb) {
  const weight_kg = weightLb * LB_TO_KG;

  // Cunningham when body fat % is available (more accurate for athletes)
  const bf = parseFloat(profile.bodyFatPercent);
  if (!isNaN(bf) && bf > 5 && bf < 60) {
    const ffm_kg = weight_kg * (1 - bf / 100);
    return {
      bmr: roundInt(cunningham(ffm_kg)),
      method: 'cunningham',
      methodLabel: 'Cunningham RMR (body-fat adjusted)',
      ffm_kg: round1(ffm_kg),
    };
  }

  // Mifflin-St Jeor (default) — needs height, age, sex
  const height_cm = resolveHeightCm(profile);
  const age = resolveAge(profile);
  const sex = profile.sex;

  if (height_cm && age && sex) {
    return {
      bmr: roundInt(mifflinStJeor(weight_kg, height_cm, age, sex)),
      method: 'mifflin_st_jeor',
      methodLabel: 'Mifflin-St Jeor RMR',
      ffm_kg: null,
    };
  }

  if (height_cm && age) {
    return {
      bmr: roundInt(mifflinStJeor(weight_kg, height_cm, age, 'male')),
      method: 'mifflin_st_jeor_assumed_sex',
      methodLabel: 'Mifflin-St Jeor RMR (sex assumed male)',
      ffm_kg: null,
    };
  }

  return {
    bmr: roundInt(21 * weight_kg),
    method: 'weight_only_fallback',
    methodLabel: 'Weight-based estimate — add height, age, and sex for accuracy',
    ffm_kg: null,
  };
}

// ---------------------------------------------------------------------------
// Step 2: TDEE
// ---------------------------------------------------------------------------

/**
 * Compute TDEE using empirical analysis data when sufficient, otherwise BMR × PAL.
 *
 * @param {{ bmr: number, methodLabel: string }} bmrResult
 * @param {object}      profile
 * @param {object|null} analysisResults
 * @returns {{ tdee: number, source: string, sourceLabel: string, pal: number|null }}
 */
export function computeTDEE(bmrResult, profile, analysisResults) {
  const empirical = analysisResults?.bmrModel?.tdee_current;
  if (empirical && !analysisResults?.bmrModel?.error && empirical > 800) {
    return {
      tdee: roundInt(empirical),
      source: 'empirical',
      sourceLabel: 'Measured from your weight and calorie history',
      pal: null,
    };
  }

  const activityKey = profile.baselineActivityLevel;
  const pal = PAL_MULTIPLIERS[activityKey] ?? PAL_MULTIPLIERS.moderate;
  const label = ACTIVITY_LABELS[activityKey] ?? 'Moderate activity (assumed)';

  return {
    tdee: roundInt(bmrResult.bmr * pal),
    source: 'formula',
    sourceLabel: `${bmrResult.methodLabel} × ${pal} PAL (${label})`,
    pal,
  };
}

// ---------------------------------------------------------------------------
// Step 3: Calorie target
// ---------------------------------------------------------------------------

/**
 * Compute daily calorie target based on goal type, TDEE, BMR floor, and
 * optional time-based fat loss calculation.
 *
 * @param {string} goalType
 * @param {number} tdee
 * @param {number} bmr
 * @param {object} goals  - state.goalSettings (targetWeightLb, targetDate)
 * @param {number} weightLb
 * @returns {{ calories: number, deficit: number, deficitNote: string }}
 */
export function computeCalorieTarget(goalType, tdee, bmr, goals, weightLb) {
  const minSafeFloor = Math.max(1000, roundInt(bmr * 0.85));

  switch (goalType) {
    case 'fatLoss': {
      let deficit = 400;
      let deficitNote = 'Moderate deficit (~400 kcal below TDEE)';

      const targetLb = parseFloat(goals.targetWeightLb);
      const targetDate = goals.targetDate;

      if (!isNaN(targetLb) && targetLb > 0 && targetDate && weightLb > targetLb) {
        const daysLeft = (new Date(targetDate).getTime() - Date.now()) / 86400000;
        if (daysLeft > 14) {
          const deltaKg = (weightLb - targetLb) * LB_TO_KG;
          const required = roundInt((deltaKg * 7700) / daysLeft);
          deficit = clamp(required, 200, 750);
          deficitNote = `~${roundInt(weightLb - targetLb)} lb to lose by ${targetDate} → ${deficit} kcal/day deficit`;
        }
      }

      return {
        calories: clamp(tdee - deficit, minSafeFloor, tdee - 100),
        deficit,
        deficitNote,
      };
    }

    case 'maintenance':
      return { calories: tdee, deficit: 0, deficitNote: 'At TDEE (maintenance)' };

    case 'recomp':
      return {
        calories: tdee,
        deficit: 0,
        deficitNote: 'At TDEE — training bump system handles day-to-day surplus/deficit cycling',
      };

    case 'muscleGain':
      return { calories: tdee + 250, deficit: -250, deficitNote: 'Lean bulk (+250 kcal above TDEE)' };

    case 'performance':
      return {
        calories: tdee + 400,
        deficit: -400,
        deficitNote: 'Performance surplus (+400 kcal — carbohydrates prioritized for fuel)',
      };

    case 'custom':
    default:
      return { calories: tdee, deficit: 0, deficitNote: 'Starting from TDEE estimate — adjust as needed' };
  }
}

// ---------------------------------------------------------------------------
// Step 4: Protein
// ---------------------------------------------------------------------------

/**
 * Compute daily protein target in grams.
 * Uses body-weight-based rates; switches to FFM-based rate for lean dieters
 * when body fat % data is available.
 *
 * @param {string}      goalType
 * @param {number}      weightLb
 * @param {number|null} ffm_kg   - fat-free mass in kg (from Cunningham BMR step), or null
 * @returns {{ protein: number, note: string }}
 */
export function computeProteinTarget(goalType, weightLb, ffm_kg) {
  const weight_kg = weightLb * LB_TO_KG;
  const { rate, note } = PROTEIN_RATES[goalType] ?? PROTEIN_RATES.maintenance;

  if (ffm_kg && (goalType === 'fatLoss' || goalType === 'recomp')) {
    const ffmRate = 2.7;
    const proteinFFM = roundInt(ffm_kg * ffmRate);
    const proteinBW  = roundInt(weight_kg * rate);
    if (proteinFFM > proteinBW) {
      return {
        protein: proteinFFM,
        note: `2.7 g/kg fat-free mass (${round1(ffm_kg)} kg FFM) — high-end for lean resistance-trained dieting`,
      };
    }
  }

  return { protein: roundInt(weight_kg * rate), note };
}

// ---------------------------------------------------------------------------
// Step 5: Fat
// ---------------------------------------------------------------------------

/**
 * Compute daily fat target in grams.
 * Floor: largest of 40 g, 0.5 g/kg body weight, or 20% of calories.
 * Default: ~25% of calories (capped at 40%).
 *
 * @param {number} weightLb
 * @param {number} calories
 * @returns {{ fat: number, fatMinimum: number, note: string }}
 */
export function computeFatTarget(weightLb, calories) {
  const weight_kg = weightLb * LB_TO_KG;

  const floorByWeight   = 0.5 * weight_kg;
  const floorByCalories = (calories * 0.20) / 9;
  const absoluteFloor   = 40;

  const fatFloor   = Math.max(absoluteFloor, floorByWeight, floorByCalories);
  const fatDefault = Math.max(fatFloor, (calories * 0.25) / 9);
  const fatCap     = (calories * 0.40) / 9;

  return {
    fat: roundInt(clamp(fatDefault, fatFloor, fatCap)),
    fatMinimum: roundInt(fatFloor),
    note: `~25% of calories, minimum ${roundInt(fatFloor)} g/day (0.5 g/kg and 20%-of-calories floors)`,
  };
}

// ---------------------------------------------------------------------------
// Step 6: Carbs
// ---------------------------------------------------------------------------

/**
 * Fill remaining calories after protein and fat with carbohydrates.
 * @param {number} calories
 * @param {number} protein
 * @param {number} fat
 * @returns {{ carbs: number }}
 */
export function computeCarbsTarget(calories, protein, fat) {
  const remaining = calories - (protein * 4) - (fat * 9);
  return { carbs: Math.max(0, roundInt(remaining / 4)) };
}

// ---------------------------------------------------------------------------
// Step 7: Micronutrients
// ---------------------------------------------------------------------------

/**
 * Look up DRI-based micronutrient targets for the user's age and sex.
 * @param {object} profile
 * @returns {{ microTargets: object, warnings: string[] }}
 */
export function computeMicronutrientTargets(profile) {
  const age = resolveAge(profile) ?? 30;
  const sex = profile.sex;

  const targets = {};
  const warnings = [];

  for (const key of MICRONUTRIENT_KEYS) {
    const dri = getDRI(key, age, sex);
    if (dri) targets[key] = dri.rda;
  }

  return { microTargets: targets, warnings };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate auto-calculated daily targets from profile, goals, and optional
 * analysis results.
 *
 * @param {object}      profile         - state.userProfile (normalizeUserProfile() shape)
 * @param {object}      goals           - state.goalSettings (normalizeGoalSettings() shape)
 * @param {object|null} analysisResults - from runAnalysis(), or null
 * @returns {{ targets: object|null, explanation: object|null, warnings: string[], meta: object }}
 */
export function generateTargets(profile, goals, analysisResults = null) {
  const warnings = [];

  // ── Current weight ────────────────────────────────────────────────────────
  const { weightLb, source: weightSource, sourceLabel: weightLabel } =
    resolveCurrentWeightLb(profile, analysisResults);

  if (!weightLb) {
    return {
      targets: null,
      explanation: null,
      warnings: ['Current weight is required. Enter a manual weight override or upload weight CSV data.'],
      meta: { weightLb: null, weightSource: null },
    };
  }

  // ── BMR ───────────────────────────────────────────────────────────────────
  const bmrResult = computeBMR(profile, weightLb);

  // ── TDEE ──────────────────────────────────────────────────────────────────
  const tdeeResult = computeTDEE(bmrResult, profile, analysisResults);

  // ── Calorie target ────────────────────────────────────────────────────────
  const goalType = goals.goalType ?? 'maintenance';
  const calResult = computeCalorieTarget(goalType, tdeeResult.tdee, bmrResult.bmr, goals, weightLb);

  // ── Protein ───────────────────────────────────────────────────────────────
  const proteinResult = computeProteinTarget(goalType, weightLb, bmrResult.ffm_kg);

  // ── Fat ───────────────────────────────────────────────────────────────────
  const fatResult = computeFatTarget(weightLb, calResult.calories);

  // ── Carbs ─────────────────────────────────────────────────────────────────
  const carbsResult = computeCarbsTarget(calResult.calories, proteinResult.protein, fatResult.fat);

  // ── Micronutrients ────────────────────────────────────────────────────────
  const age = resolveAge(profile) ?? 30;
  const { microTargets, warnings: microWarnings } = computeMicronutrientTargets(profile);
  warnings.push(...microWarnings);

  // ── Assemble targets ──────────────────────────────────────────────────────
  const targets = {
    calories:   calResult.calories,
    protein:    proteinResult.protein,
    carbs:      carbsResult.carbs,
    fat:        fatResult.fat,
    fatMinimum: fatResult.fatMinimum,
    ...microTargets,
  };

  // ── UL warnings ───────────────────────────────────────────────────────────
  for (const [key, ul] of Object.entries(UL_TABLE)) {
    if (ul !== null && targets[key] !== undefined && targets[key] > ul) {
      warnings.push(
        `Warning: ${key} target (${targets[key]}) exceeds the NASEM Tolerable Upper Intake Level (${ul}). Review before saving.`
      );
    }
  }

  // ── Explanation ───────────────────────────────────────────────────────────
  const explanation = {
    currentWeight: `${round1(weightLb)} lb — ${weightLabel}`,
    bmr: `${bmrResult.bmr} kcal/day via ${bmrResult.methodLabel}`,
    tdee: `${tdeeResult.tdee} kcal/day — ${tdeeResult.sourceLabel}`,
    calories: `${calResult.calories} kcal/day — ${calResult.deficitNote}`,
    protein: `${proteinResult.protein} g/day — ${proteinResult.note}`,
    fat: `${fatResult.fat} g/day — ${fatResult.note}`,
    carbs: `${carbsResult.carbs} g/day — fills remaining calories after protein (${proteinResult.protein * 4} kcal) and fat (${fatResult.fat * 9} kcal)`,
    micronutrients: `NASEM/DRI values for ${age}-year-old ${profile.sex ?? 'adult'} (age band: ${getAgeBand(age)})`,
  };

  return {
    targets,
    explanation,
    warnings,
    meta: {
      weightLb: round1(weightLb),
      weightSource,
      bmrValue: bmrResult.bmr,
      bmrMethod: bmrResult.method,
      tdeeValue: tdeeResult.tdee,
      tdeeSource: tdeeResult.source,
      goalType,
    },
  };
}

/**
 * Merge generated targets with the user's manual overrides.
 * Only keys explicitly set in manualOverrides replace the generated value.
 *
 * @param {object|null} generated      - targets from generateTargets()
 * @param {object}      manualOverrides - goals.manualTargetOverrides (sparse dict)
 * @returns {object|null}
 */
export function applyManualOverrides(generated, manualOverrides = {}) {
  if (!generated) return generated;
  return { ...generated, ...manualOverrides };
}
