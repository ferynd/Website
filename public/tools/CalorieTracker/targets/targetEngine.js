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
 * Priority: manual override > uploaded smoothed weight > raw latest uploaded weight.
 *
 * @param {object}      profile            - state.userProfile
 * @param {object|null} analysisResults    - state.analysisResults or null
 * @param {number|null} rawLatestWeightLb  - latest raw weight_lb from state.weightEntries, or null
 * @returns {{ weightLb: number|null, source: string|null, sourceLabel: string }}
 */
export function resolveCurrentWeightLb(profile, analysisResults, rawLatestWeightLb = null) {
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

    // Tertiary fallback: raw latest uploaded weight entry (no smoothing)
    const raw = parseFloat(rawLatestWeightLb);
    if (!isNaN(raw) && raw > 0) {
      return {
        weightLb: raw,
        source: 'uploaded_raw',
        sourceLabel: 'Latest uploaded weight (visit Energy tab for EWMA smoothing)',
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
 * @param {string}      goalType
 * @param {number}      tdee
 * @param {number}      bmr
 * @param {object}      goals       - state.goalSettings (targetWeightLb, targetDate)
 * @param {number}      weightLb
 * @param {string|null} asOfDateStr - 'YYYY-MM-DD'; when provided, days-left math uses this
 *                                    date instead of today (timezone-safe, historical-date safe).
 * @returns {{ calories: number, deficit: number, deficitNote: string, daysLeft: number|null, targetWeightDeltaLb: number|null, rawRequiredDeficit: number|null, appliedDeficit: number, deficitClampReason: string, calorieFloor: number }}
 */
export function computeCalorieTarget(goalType, tdee, bmr, goals, weightLb, asOfDateStr = null) {
  const minSafeFloor = Math.max(1000, roundInt(bmr * 0.85));

  switch (goalType) {
    case 'fatLoss': {
      let deficit = 400;
      let deficitNote = 'Moderate deficit (~400 kcal below TDEE)';
      let deficitClampReason = 'none';
      let daysLeft = null;
      let targetWeightDeltaLb = null;
      let rawRequiredDeficit = null;

      const targetLb = parseFloat(goals.targetWeightLb);
      const targetDate = goals.targetDate;

      if (!isNaN(targetLb) && targetLb > 0 && targetDate && weightLb > targetLb) {
        // Use local date-only math (no time-of-day noise, works for historical dates)
        const asOfMs = asOfDateStr
          ? new Date(`${asOfDateStr}T00:00:00`).getTime()
          : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
        daysLeft = (new Date(`${targetDate}T00:00:00`).getTime() - asOfMs) / 86400000;
        targetWeightDeltaLb = round1(weightLb - targetLb);
        if (daysLeft > 14) {
          const deltaKg = (weightLb - targetLb) * LB_TO_KG;
          rawRequiredDeficit = roundInt((deltaKg * 7700) / daysLeft);
          if (rawRequiredDeficit < 200) {
            deficit = 200;
            deficitClampReason = 'minimum_deficit';
          } else if (rawRequiredDeficit > 750) {
            deficit = 750;
            deficitClampReason = 'maximum_deficit';
          } else {
            deficit = rawRequiredDeficit;
          }
          deficitNote = `~${roundInt(weightLb - targetLb)} lb to lose by ${targetDate} → ${deficit} kcal/day deficit`;
        } else {
          deficitClampReason = 'target_invalid';
        }
      }

      const appliedDeficit = deficit;
      const rawCalories = tdee - deficit;
      let calories;
      if (rawCalories < minSafeFloor) {
        calories = minSafeFloor;
        deficitClampReason = 'bmr_floor';
      } else if (rawCalories > tdee - 100) {
        calories = tdee - 100;
      } else {
        calories = rawCalories;
      }

      return {
        calories,
        deficit: tdee - calories,
        deficitNote,
        daysLeft,
        targetWeightDeltaLb,
        rawRequiredDeficit,
        appliedDeficit,
        deficitClampReason,
        calorieFloor: minSafeFloor,
      };
    }

    case 'maintenance':
      return { calories: tdee, deficit: 0, deficitNote: 'At TDEE (maintenance)', daysLeft: null, targetWeightDeltaLb: null, rawRequiredDeficit: null, appliedDeficit: 0, deficitClampReason: 'none', calorieFloor: minSafeFloor };

    case 'recomp':
      return {
        calories: tdee,
        deficit: 0,
        deficitNote: 'At TDEE — training bump system handles day-to-day surplus/deficit cycling',
        daysLeft: null, targetWeightDeltaLb: null, rawRequiredDeficit: null, appliedDeficit: 0, deficitClampReason: 'none', calorieFloor: minSafeFloor,
      };

    case 'muscleGain':
      return { calories: tdee + 250, deficit: -250, deficitNote: 'Lean bulk (+250 kcal above TDEE)', daysLeft: null, targetWeightDeltaLb: null, rawRequiredDeficit: null, appliedDeficit: -250, deficitClampReason: 'none', calorieFloor: minSafeFloor };

    case 'performance':
      return {
        calories: tdee + 400,
        deficit: -400,
        deficitNote: 'Performance surplus (+400 kcal — carbohydrates prioritized for fuel)',
        daysLeft: null, targetWeightDeltaLb: null, rawRequiredDeficit: null, appliedDeficit: -400, deficitClampReason: 'none', calorieFloor: minSafeFloor,
      };

    case 'custom':
    default:
      return { calories: tdee, deficit: 0, deficitNote: 'Starting from TDEE estimate — adjust as needed', daysLeft: null, targetWeightDeltaLb: null, rawRequiredDeficit: null, appliedDeficit: 0, deficitClampReason: 'none', calorieFloor: minSafeFloor };
  }
}

// ---------------------------------------------------------------------------
// Step 4: Protein
// ---------------------------------------------------------------------------

/**
 * Compute daily protein target in grams.
 *
 * proteinBasis controls which weight is used for rate × weight_kg:
 *   null / 'auto'       — fat loss/recomp: leanMass → targetWeight → currentWeight
 *                         other goals: currentWeight
 *   'currentWeight'     — g/kg current weight (explicit, no auto override)
 *   'targetWeight'      — g/kg goal weight; falls back to currentWeight if no valid target
 *   'adjustedWeight'    — g/kg midpoint of current + target; falls back if target missing/invalid
 *   'leanMass'          — 2.7 g/kg FFM; falls back to currentWeight if BF% not set
 *
 * @param {string}      goalType
 * @param {number}      weightLb
 * @param {number|null} ffm_kg   - fat-free mass in kg (from Cunningham BMR step), or null
 * @param {object|null} goals    - state.goalSettings, or null
 * @returns {{ protein: number, note: string, proteinBasisUsed: string, proteinBasisFallbackReason: string|null }}
 */
export function computeProteinTarget(goalType, weightLb, ffm_kg, goals = null) {
  const weight_kg = weightLb * LB_TO_KG;
  const { rate, note } = PROTEIN_RATES[goalType] ?? PROTEIN_RATES.maintenance;
  const proteinBasis = goals?.proteinBasis ?? 'auto';

  // ── Explicit: leanMass ───────────────────────────────────────────────────
  if (proteinBasis === 'leanMass') {
    if (ffm_kg) {
      return {
        protein: roundInt(ffm_kg * 2.7),
        note: `2.7 g/kg fat-free mass (${round1(ffm_kg)} kg FFM)`,
        proteinBasisUsed: 'leanMass',
        proteinBasisFallbackReason: null,
      };
    }
    return {
      protein: roundInt(weight_kg * rate),
      note: `${note} — lean-mass basis requested but body-fat % not set`,
      proteinBasisUsed: 'currentWeight',
      proteinBasisFallbackReason: 'leanMass requested but BF% is not set; using current weight instead',
    };
  }

  // ── Explicit: targetWeight ───────────────────────────────────────────────
  if (proteinBasis === 'targetWeight') {
    const targetLb = parseFloat(goals?.targetWeightLb);
    if (targetLb > 0) {
      const targetKg = targetLb * LB_TO_KG;
      return {
        protein: roundInt(targetKg * rate),
        note: `${rate} g/kg target weight (${round1(targetLb)} lb / ${round1(targetKg)} kg)`,
        proteinBasisUsed: 'targetWeight',
        proteinBasisFallbackReason: null,
      };
    }
    return {
      protein: roundInt(weight_kg * rate),
      note,
      proteinBasisUsed: 'currentWeight',
      proteinBasisFallbackReason: 'targetWeight requested but no valid target weight set; using current weight instead',
    };
  }

  // ── Explicit: adjustedWeight (midpoint of current + target) ─────────────
  if (proteinBasis === 'adjustedWeight') {
    const targetLb = parseFloat(goals?.targetWeightLb);
    if (targetLb > 0 && targetLb < weightLb) {
      const adjustedLb = (weightLb + targetLb) / 2;
      const adjustedKg = adjustedLb * LB_TO_KG;
      return {
        protein: roundInt(adjustedKg * rate),
        note: `${rate} g/kg adjusted weight (${round1(adjustedLb)} lb — midpoint of ${round1(weightLb)} lb current and ${round1(targetLb)} lb target)`,
        proteinBasisUsed: 'adjustedWeight',
        proteinBasisFallbackReason: null,
      };
    }
    const fallbackReason = (!targetLb || targetLb <= 0)
      ? 'adjustedWeight requested but no valid target weight set; using current weight instead'
      : 'adjustedWeight requested but target weight is not lower than current weight; using current weight instead';
    return {
      protein: roundInt(weight_kg * rate),
      note,
      proteinBasisUsed: 'currentWeight',
      proteinBasisFallbackReason: fallbackReason,
    };
  }

  // ── Explicit: currentWeight ──────────────────────────────────────────────
  if (proteinBasis === 'currentWeight') {
    return { protein: roundInt(weight_kg * rate), note, proteinBasisUsed: 'currentWeight', proteinBasisFallbackReason: null };
  }

  // ── Auto ─────────────────────────────────────────────────────────────────
  // fat loss / recomp: leanMass → targetWeight → currentWeight
  // all other goals:   currentWeight
  if (goalType === 'fatLoss' || goalType === 'recomp') {
    if (ffm_kg) {
      return {
        protein: roundInt(ffm_kg * 2.7),
        note: `2.7 g/kg fat-free mass (${round1(ffm_kg)} kg FFM) — high-end for lean resistance-trained dieting`,
        proteinBasisUsed: 'leanMass',
        proteinBasisFallbackReason: null,
      };
    }
    const targetLb = parseFloat(goals?.targetWeightLb);
    if (!isNaN(targetLb) && targetLb > 0 && targetLb < weightLb) {
      const targetKg = targetLb * LB_TO_KG;
      return {
        protein: roundInt(targetKg * rate),
        note: `${rate} g/kg target weight (${round1(targetLb)} lb) — uses goal weight to avoid excess protein during a deficit`,
        proteinBasisUsed: 'targetWeight',
        proteinBasisFallbackReason: null,
      };
    }
  }

  return { protein: roundInt(weight_kg * rate), note, proteinBasisUsed: 'currentWeight', proteinBasisFallbackReason: null };
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

function buildDeficitClampNote(calResult, tdeeResult) {
  const reason = calResult.deficitClampReason;
  if (reason === 'minimum_deficit') {
    return `Required deficit (${calResult.rawRequiredDeficit} kcal) is below the 200 kcal minimum — clamped to 200 kcal/day. The target date is achievable but calories are not lowered further.`;
  }
  if (reason === 'maximum_deficit') {
    return `Required deficit (${calResult.rawRequiredDeficit} kcal) exceeds the 750 kcal safety cap — clamped to 750 kcal/day. Reaching target weight by the target date would require an unsafe rate; target date may need adjustment.`;
  }
  if (reason === 'bmr_floor') {
    return `The calculated target (${tdeeResult.tdee} − ${calResult.appliedDeficit} = ${tdeeResult.tdee - calResult.appliedDeficit} kcal) is below the safe floor of ${calResult.calorieFloor} kcal/day (85% of BMR). Calories set to the BMR floor. Target date is not achievable at a safe deficit — consider a later target date.`;
  }
  if (reason === 'target_invalid') {
    return `Target date is less than 14 days away — time-based deficit calculation skipped. Using default 400 kcal/day deficit instead.`;
  }
  return null;
}

/**
 * Generate auto-calculated daily targets from profile, goals, and optional
 * analysis results.
 *
 * @param {object}      profile            - state.userProfile (normalizeUserProfile() shape)
 * @param {object}      goals              - state.goalSettings (normalizeGoalSettings() shape)
 * @param {object|null} analysisResults    - from runAnalysis(), or null
 * @param {number|null} rawLatestWeightLb  - raw latest weight from state.weightEntries, or null
 * @param {string|null} asOfDateStr        - 'YYYY-MM-DD'; forwarded to computeCalorieTarget
 * @returns {{ targets: object|null, explanation: object|null, warnings: string[], meta: object }}
 */
export function generateTargets(profile, goals, analysisResults = null, rawLatestWeightLb = null, asOfDateStr = null) {
  const warnings = [];

  // ── Current weight ────────────────────────────────────────────────────────
  const { weightLb, source: weightSource, sourceLabel: weightLabel } =
    resolveCurrentWeightLb(profile, analysisResults, rawLatestWeightLb);

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
  const calResult = computeCalorieTarget(goalType, tdeeResult.tdee, bmrResult.bmr, goals, weightLb, asOfDateStr);

  // ── Protein ───────────────────────────────────────────────────────────────
  const proteinResult = computeProteinTarget(goalType, weightLb, bmrResult.ffm_kg, goals);

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
    activityIgnored: tdeeResult.source === 'empirical'
      ? `Baseline activity level setting is ignored — TDEE is measured directly from your weight and calorie history (${tdeeResult.tdee} kcal/day)`
      : null,
    calories: `${calResult.calories} kcal/day — ${calResult.deficitNote}`,
    deficitClamped: (goalType === 'fatLoss' && calResult.deficitClampReason !== 'none')
      ? buildDeficitClampNote(calResult, tdeeResult)
      : null,
    protein: `${proteinResult.protein} g/day — ${proteinResult.note}${
      proteinResult.proteinBasisUsed && proteinResult.proteinBasisUsed !== 'currentWeight'
        ? ` (basis: ${proteinResult.proteinBasisUsed})`
        : ''
    }${
      proteinResult.proteinBasisFallbackReason
        ? ` ⚠ ${proteinResult.proteinBasisFallbackReason}`
        : ''
    }`,
    fat: `${fatResult.fat} g/day — ${fatResult.note}`,
    carbs: `${carbsResult.carbs} g/day — fills remaining calories after protein (${proteinResult.protein * 4} kcal) and fat (${fatResult.fat * 9} kcal)`,
    micronutrients: `NASEM/DRI values for ${age}-year-old ${profile.sex ?? 'adult'} (age band: ${getAgeBand(age)}); RDA/AI for most nutrients, CDRR for sodium`,
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
      calorieFloor: calResult.calorieFloor,
    },
  };
}

/**
 * Merge generated targets with the user's manual overrides, then recompose
 * macros so the calorie total stays consistent.
 *
 * Recomposition rules (applied whenever calories, protein, or fat are overridden
 * and carbs are NOT explicitly pinned):
 *   carbs = max(0, floor((calories - protein×4 - fat×9) / 4))
 *
 * If protein×4 + fat×9 > calories after the merge, carbs is clamped to 0 and
 * a warning is attached as result._warnings[].
 *
 * @param {object|null} generated       - targets from generateTargets()
 * @param {object}      manualOverrides  - goals.manualTargetOverrides (sparse dict)
 * @returns {object|null}  New targets object; never mutates inputs.
 */
export function applyManualOverrides(generated, manualOverrides = {}) {
  if (!generated) return generated;
  const merged = { ...generated, ...manualOverrides };

  const calOverridden     = 'calories' in manualOverrides;
  const proteinOverridden = 'protein'  in manualOverrides;
  const fatOverridden     = 'fat' in manualOverrides || 'fatMinimum' in manualOverrides;
  const carbsOverridden   = 'carbs'    in manualOverrides;

  const warnings = [];

  if ((calOverridden || proteinOverridden || fatOverridden) && !carbsOverridden) {
    const remaining = merged.calories - (merged.protein * 4) - (merged.fat * 9);
    merged.carbs = Math.max(0, Math.round(remaining / 4));
    if (remaining < 0) {
      warnings.push(
        `Protein (${merged.protein} g × 4 = ${merged.protein * 4} kcal) + Fat (${merged.fat} g × 9 = ${merged.fat * 9} kcal) ` +
        `exceeds calorie target (${merged.calories} kcal). Carbs set to 0.`
      );
    }
  }

  if (warnings.length) merged._warnings = warnings;
  return merged;
}

/**
 * Pure helper: returns the latest weight_lb from a weightEntries Map, or null.
 * Accepts the same Map<docId, {date, weight_lb, ...}> shape as state.weightEntries.
 * Used by resolveDailyBaseTargets so auto-goal works before the Energy tab is visited.
 */
export function latestWeightLbFromEntries(weightEntries) {
  if (!weightEntries || weightEntries.size === 0) return null;
  let latestDate = '';
  let latestWeight = null;
  for (const entry of weightEntries.values()) {
    if (entry.date > latestDate && parseFloat(entry.weight_lb) > 0) {
      latestDate = entry.date;
      latestWeight = parseFloat(entry.weight_lb);
    }
  }
  return latestWeight;
}

/**
 * Resolve today's base calorie/macro targets for a given date.
 *
 * In 'manual' mode  — returns state.baselineTargets unchanged.
 * In 'autoGoal' mode — runs generateTargets() live from profile + goals +
 *                       latest analysis, then applies manual overrides.
 *
 * Falls back gracefully to manual baseline when auto-goal computation fails.
 *
 * @param {string} dateStr   - Date string 'YYYY-MM-DD'; forwarded to computeCalorieTarget for date-aware deficit math
 * @param {object} stateLike - Object with { baselineTargets, goalSettings, userProfile, analysisResults }
 * @returns {{ targets: object, source: 'manual'|'autoGoal'|'manual_fallback', warnings: string[] }}
 */
export function resolveDailyBaseTargets(dateStr, stateLike) {
  const mode = stateLike.goalSettings?.targetMode ?? 'manual';

  if (mode !== 'autoGoal') {
    return {
      targets: { ...stateLike.baselineTargets },
      source: 'manual',
      warnings: [],
      calorieFloor: 1000,
    };
  }

  const rawLatestWeightLb = latestWeightLbFromEntries(stateLike.weightEntries ?? null);

  const result = generateTargets(
    stateLike.userProfile  ?? {},
    stateLike.goalSettings ?? {},
    stateLike.analysisResults ?? null,
    rawLatestWeightLb,
    dateStr
  );

  if (!result.targets) {
    const reason = result.warnings[0] ?? 'unknown reason';
    return {
      targets: { ...stateLike.baselineTargets },
      source: 'manual_fallback',
      warnings: [`Auto-goal targets unavailable (${reason}); falling back to manual baseline.`],
      calorieFloor: 1000,
    };
  }

  const finalTargets = applyManualOverrides(result.targets, stateLike.goalSettings?.manualTargetOverrides ?? {});
  return {
    targets: finalTargets,
    source: 'autoGoal',
    warnings: result.warnings,
    calorieFloor: result.meta?.calorieFloor ?? 1000,
  };
}

/**
 * Pure helper: build the calorie-target series for the Energy-tab eating-pattern chart.
 *
 * In manual mode: flat line at baselineTargets.calories (null before firstNutritionDate).
 * In autoGoal mode: per-date resolution via resolveDailyBaseTargets, cached to avoid
 *   redundant generateTargets calls across a long label array.
 *
 * @param {string[]}    labels            - chart date strings YYYY-MM-DD (chronological)
 * @param {string|null} firstNutritionDate - earliest manually-logged date; null = unknown
 * @param {object}      stateLike         - { goalSettings, baselineTargets, userProfile,
 *                                          analysisResults, weightEntries }
 * @returns {{ targetData: (number|null)[], label: string|null, anyFallback: boolean }}
 */
export function buildEatingPatternTargetSeries(labels, firstNutritionDate, stateLike) {
  const targetMode = stateLike.goalSettings?.targetMode ?? 'manual';
  const baseCals   = parseFloat(stateLike.baselineTargets?.calories) || null;

  if (targetMode !== 'autoGoal') {
    return {
      targetData: labels.map(d =>
        (!firstNutritionDate || d < firstNutritionDate) ? null : baseCals
      ),
      label: baseCals ? `Manual target (${baseCals} kcal)` : null,
      anyFallback: false,
    };
  }

  // autoGoal: resolve per date, cache to avoid calling generateTargets O(n) times
  const cache = new Map();
  let anyFallback = false;

  const targetData = labels.map(dateStr => {
    if (!firstNutritionDate || dateStr < firstNutritionDate) return null;
    if (!cache.has(dateStr)) {
      const r = resolveDailyBaseTargets(dateStr, stateLike);
      if (r.source === 'manual_fallback') anyFallback = true;
      cache.set(dateStr, parseFloat(r.targets?.calories) || baseCals);
    }
    return cache.get(dateStr);
  });

  const label = anyFallback ? 'Auto-goal target (manual fallback)' : 'Auto-goal target';
  return { targetData, label, anyFallback };
}
