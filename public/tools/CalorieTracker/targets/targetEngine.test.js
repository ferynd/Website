/**
 * @file targets/targetEngine.test.js
 * Vitest tests for targetEngine.js — pure function tests, no Firebase or DOM.
 *
 * Run from repo root: npx vitest run public/tools/CalorieTracker/targets/targetEngine.test.js
 */

import { describe, it, expect } from 'vitest';
import {
  resolveAge,
  resolveCurrentWeightLb,
  computeBMR,
  computeTDEE,
  computeCalorieTarget,
  computeProteinTarget,
  computeFatTarget,
  computeCarbsTarget,
  computeMicronutrientTargets,
  generateTargets,
  applyManualOverrides,
  resolveDailyBaseTargets,
} from './targetEngine.js';

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeProfile(overrides = {}) {
  return {
    sex: 'male',
    birthDate: null,
    age: 35,
    heightValue: 71,   // 5'11" in inches
    heightUnit: 'in',
    manualWeightOverrideLb: null,
    manualWeightOverrideDate: null,
    useUploadedWeightForCurrentWeight: true,
    bodyFatPercent: null,
    baselineActivityLevel: 'moderate',
    ...overrides,
  };
}

function makeGoals(overrides = {}) {
  return {
    goalType: 'maintenance',
    targetWeightLb: null,
    targetDate: null,
    priority: 'maintenance',
    useRollingBanking: true,
    manualTargetOverrides: {},
    ...overrides,
  };
}

function makeAnalysis(overrides = {}) {
  return {
    summary: { currentWeight: 185.0 },
    bmrModel: { tdee_current: 2400, error: null },
    ...overrides,
  };
}

// ── resolveAge ────────────────────────────────────────────────────────────────

describe('resolveAge', () => {
  it('returns numeric age when age field is provided', () => {
    expect(resolveAge(makeProfile({ age: 35, birthDate: null }))).toBe(35);
  });

  it('derives age from birthDate when provided', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 40);
    const bd = past.toISOString().slice(0, 10);
    const age = resolveAge(makeProfile({ birthDate: bd, age: null }));
    expect(age).toBeGreaterThanOrEqual(39);
    expect(age).toBeLessThanOrEqual(40);
  });

  it('returns null when neither birthDate nor age are set', () => {
    expect(resolveAge(makeProfile({ age: null, birthDate: null }))).toBeNull();
  });

  it('rejects absurd age values', () => {
    expect(resolveAge(makeProfile({ age: 150, birthDate: null }))).toBeNull();
    expect(resolveAge(makeProfile({ age: -5,  birthDate: null }))).toBeNull();
  });

  it('prefers birthDate over age field', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 28);
    const bd = past.toISOString().slice(0, 10);
    const age = resolveAge(makeProfile({ birthDate: bd, age: 40 }));
    expect(age).toBeGreaterThanOrEqual(27);
    expect(age).toBeLessThanOrEqual(28);
  });
});

// ── resolveCurrentWeightLb ────────────────────────────────────────────────────

describe('resolveCurrentWeightLb', () => {
  it('prefers manual override over uploaded data', () => {
    const profile = makeProfile({ manualWeightOverrideLb: 180 });
    const { weightLb, source } = resolveCurrentWeightLb(profile, makeAnalysis());
    expect(weightLb).toBe(180);
    expect(source).toBe('manual_override');
  });

  it('uses smoothed uploaded weight when no manual override', () => {
    const { weightLb, source } = resolveCurrentWeightLb(
      makeProfile(),
      makeAnalysis({ summary: { currentWeight: 190 } })
    );
    expect(weightLb).toBe(190);
    expect(source).toBe('uploaded_smoothed');
  });

  it('returns null when no data is available', () => {
    const { weightLb } = resolveCurrentWeightLb(
      makeProfile({ useUploadedWeightForCurrentWeight: false }),
      null
    );
    expect(weightLb).toBeNull();
  });

  it('returns null when analysisResults is null and no override', () => {
    const { weightLb } = resolveCurrentWeightLb(makeProfile(), null);
    expect(weightLb).toBeNull();
  });

  it('respects useUploadedWeightForCurrentWeight=false', () => {
    const profile = makeProfile({ useUploadedWeightForCurrentWeight: false });
    const { weightLb } = resolveCurrentWeightLb(profile, makeAnalysis());
    expect(weightLb).toBeNull();
  });

  it('uses rawLatestWeightLb as tertiary fallback when analysisResults is null', () => {
    const { weightLb, source } = resolveCurrentWeightLb(makeProfile(), null, 172.5);
    expect(weightLb).toBe(172.5);
    expect(source).toBe('uploaded_raw');
  });

  it('prefers smoothed analysisResults over rawLatestWeightLb', () => {
    const { weightLb, source } = resolveCurrentWeightLb(
      makeProfile(),
      makeAnalysis({ summary: { currentWeight: 185 } }),
      172.5
    );
    expect(weightLb).toBe(185);
    expect(source).toBe('uploaded_smoothed');
  });

  it('ignores rawLatestWeightLb when useUploadedWeightForCurrentWeight=false', () => {
    const profile = makeProfile({ useUploadedWeightForCurrentWeight: false });
    const { weightLb } = resolveCurrentWeightLb(profile, null, 172.5);
    expect(weightLb).toBeNull();
  });
});

// ── computeBMR ────────────────────────────────────────────────────────────────

describe('computeBMR', () => {
  it('uses Cunningham when body fat % is available', () => {
    const profile = makeProfile({ bodyFatPercent: 15 });
    const { method } = computeBMR(profile, 185);
    expect(method).toBe('cunningham');
  });

  it('Cunningham returns ffm_kg in result', () => {
    const profile = makeProfile({ bodyFatPercent: 20 });
    const { ffm_kg } = computeBMR(profile, 200);
    expect(ffm_kg).toBeGreaterThan(0);
  });

  it('uses Mifflin-St Jeor for male with complete profile', () => {
    const profile = makeProfile({ sex: 'male', age: 35, heightValue: 71, heightUnit: 'in' });
    const { bmr, method } = computeBMR(profile, 185);
    expect(method).toBe('mifflin_st_jeor');
    // 185 lb ≈ 83.9 kg; 71 in ≈ 180.3 cm; male 35yo
    // RMR = (10×83.9)+(6.25×180.3)-(5×35)+5 ≈ 1886
    expect(bmr).toBeGreaterThan(1700);
    expect(bmr).toBeLessThan(2100);
  });

  it('uses Mifflin-St Jeor for female with complete profile', () => {
    const profile = makeProfile({ sex: 'female', age: 30, heightValue: 64, heightUnit: 'in' });
    const { bmr, method } = computeBMR(profile, 140);
    expect(method).toBe('mifflin_st_jeor');
    expect(bmr).toBeGreaterThan(1200);
    expect(bmr).toBeLessThan(1700);
  });

  it('assumes male sex when sex is null but height and age available', () => {
    const profile = makeProfile({ sex: null });
    const { method } = computeBMR(profile, 185);
    expect(method).toBe('mifflin_st_jeor_assumed_sex');
  });

  it('falls back to weight-only estimate when height and age are missing', () => {
    const profile = makeProfile({ sex: null, age: null, heightValue: null });
    const { method } = computeBMR(profile, 185);
    expect(method).toBe('weight_only_fallback');
  });

  it('female BMR is lower than male at same weight/height/age', () => {
    const male   = computeBMR(makeProfile({ sex: 'male',   age: 35, heightValue: 68 }), 155);
    const female = computeBMR(makeProfile({ sex: 'female', age: 35, heightValue: 68 }), 155);
    expect(male.bmr).toBeGreaterThan(female.bmr);
  });
});

// ── computeTDEE ──────────────────────────────────────────────────────────────

describe('computeTDEE', () => {
  const bmrResult = { bmr: 1800, methodLabel: 'Mifflin-St Jeor RMR' };

  it('uses empirical TDEE from analysis when available', () => {
    const { tdee, source } = computeTDEE(bmrResult, makeProfile(), makeAnalysis({ bmrModel: { tdee_current: 2500 } }));
    expect(tdee).toBe(2500);
    expect(source).toBe('empirical');
  });

  it('falls back to BMR × PAL when analysis is not available', () => {
    const { tdee, source, pal } = computeTDEE(bmrResult, makeProfile({ baselineActivityLevel: 'moderate' }), null);
    expect(tdee).toBe(Math.round(1800 * 1.55));
    expect(source).toBe('formula');
    expect(pal).toBe(1.55);
  });

  it('defaults to moderate PAL when activity level is not set', () => {
    const { pal } = computeTDEE(bmrResult, makeProfile({ baselineActivityLevel: null }), null);
    expect(pal).toBe(1.55);
  });

  it('ignores empirical TDEE when bmrModel has an error', () => {
    const analysis = makeAnalysis({ bmrModel: { tdee_current: 2500, error: 'Not enough data' } });
    const { source } = computeTDEE(bmrResult, makeProfile(), analysis);
    expect(source).toBe('formula');
  });

  it('activity level sedentary gives lower TDEE than very_active', () => {
    const sedentary  = computeTDEE(bmrResult, makeProfile({ baselineActivityLevel: 'sedentary'   }), null);
    const veryActive = computeTDEE(bmrResult, makeProfile({ baselineActivityLevel: 'very_active' }), null);
    expect(sedentary.tdee).toBeLessThan(veryActive.tdee);
  });
});

// ── computeCalorieTarget ──────────────────────────────────────────────────────

describe('computeCalorieTarget', () => {
  it('fat loss defaults to ~400 kcal deficit', () => {
    const { calories, deficit } = computeCalorieTarget('fatLoss', 2400, 1800, makeGoals(), 185);
    expect(deficit).toBe(400);
    expect(calories).toBe(2000);
  });

  it('fat loss computes time-based deficit within safe clamps', () => {
    const future = new Date();
    future.setMonth(future.getMonth() + 6);
    const goals = makeGoals({ targetWeightLb: 165, targetDate: future.toISOString().slice(0, 10) });
    const { deficit } = computeCalorieTarget('fatLoss', 2400, 1800, goals, 185);
    expect(deficit).toBeGreaterThanOrEqual(200);
    expect(deficit).toBeLessThanOrEqual(750);
  });

  it('fat loss never drops below BMR × 0.85 floor', () => {
    // TDEE 1400, BMR 1400 → floor = max(1000, 1190) = 1190; deficit clamped
    const { calories } = computeCalorieTarget('fatLoss', 1400, 1400, makeGoals(), 100);
    expect(calories).toBeGreaterThanOrEqual(1000);
  });

  it('fat loss skips time-based calc when target already met (target >= current)', () => {
    const future = new Date();
    future.setMonth(future.getMonth() + 3);
    // target weight >= current weight → should use default 400 deficit
    const goals = makeGoals({ targetWeightLb: 200, targetDate: future.toISOString().slice(0, 10) });
    const { deficit } = computeCalorieTarget('fatLoss', 2400, 1800, goals, 185);
    expect(deficit).toBe(400);
  });

  it('maintenance returns TDEE exactly', () => {
    const { calories } = computeCalorieTarget('maintenance', 2400, 1800, makeGoals(), 185);
    expect(calories).toBe(2400);
  });

  it('muscleGain returns TDEE + 250', () => {
    const { calories } = computeCalorieTarget('muscleGain', 2400, 1800, makeGoals(), 185);
    expect(calories).toBe(2650);
  });

  it('performance returns TDEE + 400', () => {
    const { calories } = computeCalorieTarget('performance', 2400, 1800, makeGoals(), 185);
    expect(calories).toBe(2800);
  });

  it('recomp returns TDEE exactly', () => {
    const { calories } = computeCalorieTarget('recomp', 2400, 1800, makeGoals(), 185);
    expect(calories).toBe(2400);
  });
});

// ── computeProteinTarget ──────────────────────────────────────────────────────

describe('computeProteinTarget', () => {
  it('fat loss uses ~2.2 g/kg body weight', () => {
    // 185 lb × 0.45359 = 83.9 kg × 2.2 = 184.6 → 185 g
    const { protein } = computeProteinTarget('fatLoss', 185, null);
    expect(protein).toBeGreaterThan(170);
    expect(protein).toBeLessThan(200);
  });

  it('maintenance uses ~1.6 g/kg body weight', () => {
    // 185 lb × 0.45359 = 83.9 kg × 1.6 = 134.2 → 134 g
    const { protein } = computeProteinTarget('maintenance', 185, null);
    expect(protein).toBeGreaterThan(120);
    expect(protein).toBeLessThan(160);
  });

  it('switches to FFM-based rate for fat loss when FFM yields more protein', () => {
    // 185 lb = 83.9 kg; 15% BF → FFM = 71.3 kg
    // FFM rate 2.7 → 71.3 × 2.7 = 192.5 g (> BW rate 83.9 × 2.2 = 184.6 g)
    const ffm_kg = 185 * 0.45359237 * (1 - 0.15);
    const { protein } = computeProteinTarget('fatLoss', 185, ffm_kg);
    expect(protein).toBeGreaterThan(185); // FFM-based should exceed BW-based
  });

  it('two calls at same weight produce same protein (deterministic)', () => {
    const a = computeProteinTarget('maintenance', 180, null);
    const b = computeProteinTarget('maintenance', 180, null);
    expect(a.protein).toBe(b.protein);
  });
});

// ── computeFatTarget ─────────────────────────────────────────────────────────

describe('computeFatTarget', () => {
  it('fat is at least 40 g even for a small person at very low calories', () => {
    const { fat, fatMinimum } = computeFatTarget(80, 1200);
    expect(fat).toBeGreaterThanOrEqual(40);
    expect(fatMinimum).toBeGreaterThanOrEqual(40);
  });

  it('fat is approximately 25% of calories for a typical case', () => {
    // 2000 × 0.25 / 9 ≈ 55.6 g
    const { fat } = computeFatTarget(185, 2000);
    expect(fat).toBeGreaterThan(50);
    expect(fat).toBeLessThan(80);
  });

  it('fat does not exceed 40% of calories', () => {
    const { fat } = computeFatTarget(250, 1200);
    expect(fat * 9).toBeLessThanOrEqual(1200 * 0.41);
  });

  it('fatMinimum is always <= fat', () => {
    const { fat, fatMinimum } = computeFatTarget(185, 2000);
    expect(fatMinimum).toBeLessThanOrEqual(fat);
  });
});

// ── computeCarbsTarget ────────────────────────────────────────────────────────

describe('computeCarbsTarget', () => {
  it('fills remaining calories with carbs', () => {
    // 2000 - (150×4) - (55×9) = 2000 - 600 - 495 = 905 → 226.25 → 226 g
    const { carbs } = computeCarbsTarget(2000, 150, 55);
    expect(carbs).toBeCloseTo(226, 0);
  });

  it('carbs cannot be negative when protein+fat exceed calorie budget', () => {
    const { carbs } = computeCarbsTarget(1000, 200, 80);
    expect(carbs).toBe(0);
  });
});

// ── computeMicronutrientTargets ───────────────────────────────────────────────

describe('computeMicronutrientTargets', () => {
  it('sets iron higher for pre-menopausal female', () => {
    const female = makeProfile({ sex: 'female', age: 30 });
    const male   = makeProfile({ sex: 'male',   age: 30 });
    const { microTargets: fT } = computeMicronutrientTargets(female);
    const { microTargets: mT } = computeMicronutrientTargets(male);
    expect(fT.iron).toBeGreaterThan(mT.iron); // 18 vs 8
  });

  it('sets calcium higher for adults 51+ (female)', () => {
    const young = makeProfile({ sex: 'female', age: 30 });
    const older = makeProfile({ sex: 'female', age: 55 });
    const { microTargets: yT } = computeMicronutrientTargets(young);
    const { microTargets: oT } = computeMicronutrientTargets(older);
    expect(oT.calcium).toBeGreaterThan(yT.calcium); // 1200 vs 1000
  });

  it('sets vitaminD higher for adults 71+', () => {
    const young = makeProfile({ age: 40 });
    const old   = makeProfile({ age: 75 });
    const { microTargets: yT } = computeMicronutrientTargets(young);
    const { microTargets: oT } = computeMicronutrientTargets(old);
    expect(oT.vitaminD).toBeGreaterThan(yT.vitaminD); // 20 vs 15
  });

  it('falls back to 30-year-old male values when profile is empty', () => {
    const { microTargets } = computeMicronutrientTargets(makeProfile({ age: null, sex: null }));
    expect(microTargets.iron).toBe(8);     // male default
    expect(microTargets.calcium).toBe(1000);
    expect(microTargets.vitaminD).toBe(15);
  });

  it('produces a value for every tracked micronutrient key', () => {
    const { microTargets } = computeMicronutrientTargets(makeProfile());
    const expected = [
      'fiber', 'potassium', 'magnesium', 'sodium', 'calcium', 'choline',
      'vitaminB12', 'folate', 'vitaminC', 'vitaminB6',
      'vitaminA', 'vitaminD', 'vitaminE', 'vitaminK',
      'selenium', 'iodine', 'phosphorus', 'iron', 'zinc', 'omega3',
    ];
    for (const key of expected) {
      expect(microTargets).toHaveProperty(key);
      expect(typeof microTargets[key]).toBe('number');
    }
  });
});

// ── generateTargets (integration) ────────────────────────────────────────────

describe('generateTargets', () => {
  it('returns error when no weight is available', () => {
    const { targets, warnings } = generateTargets(
      makeProfile({ manualWeightOverrideLb: null, useUploadedWeightForCurrentWeight: false }),
      makeGoals(),
      null
    );
    expect(targets).toBeNull();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/weight/i);
  });

  it('produces reasonable maintenance targets for a male adult', () => {
    const { targets } = generateTargets(makeProfile(), makeGoals({ goalType: 'maintenance' }), makeAnalysis());
    expect(targets.calories).toBeGreaterThan(1800);
    expect(targets.calories).toBeLessThan(3500);
    expect(targets.protein).toBeGreaterThan(80);
    expect(targets.fat).toBeGreaterThan(40);
    expect(targets.carbs).toBeGreaterThanOrEqual(0);
  });

  it('fat loss has fewer calories than maintenance at same profile', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const maintenance = generateTargets(profile, makeGoals({ goalType: 'maintenance' }), analysis);
    const fatLoss     = generateTargets(profile, makeGoals({ goalType: 'fatLoss'     }), analysis);
    expect(fatLoss.targets.calories).toBeLessThan(maintenance.targets.calories);
  });

  it('muscle gain has more calories than maintenance at same profile', () => {
    const profile = makeProfile();
    const analysis = makeAnalysis();
    const maintenance = generateTargets(profile, makeGoals({ goalType: 'maintenance' }), analysis);
    const muscleGain  = generateTargets(profile, makeGoals({ goalType: 'muscleGain'  }), analysis);
    expect(muscleGain.targets.calories).toBeGreaterThan(maintenance.targets.calories);
  });

  it('generates all expected macro and micronutrient keys', () => {
    const { targets } = generateTargets(makeProfile(), makeGoals(), makeAnalysis());
    const expected = [
      'calories', 'protein', 'carbs', 'fat', 'fatMinimum',
      'fiber', 'potassium', 'magnesium', 'sodium', 'calcium', 'choline',
      'vitaminB12', 'folate', 'vitaminC', 'vitaminB6',
      'vitaminA', 'vitaminD', 'vitaminE', 'vitaminK',
      'selenium', 'iodine', 'phosphorus', 'iron', 'zinc', 'omega3',
    ];
    for (const key of expected) {
      expect(targets, `missing key: ${key}`).toHaveProperty(key);
      expect(typeof targets[key], `${key} is not a number`).toBe('number');
    }
  });

  it('uses manual weight override over uploaded smoothed weight', () => {
    const profile = makeProfile({ manualWeightOverrideLb: 200 });
    const { meta } = generateTargets(profile, makeGoals(), makeAnalysis({ summary: { currentWeight: 185 } }));
    expect(meta.weightLb).toBe(200);
    expect(meta.weightSource).toBe('manual_override');
  });

  it('uses Cunningham BMR method when body fat % is set', () => {
    const profile = makeProfile({ bodyFatPercent: 20 });
    const { meta } = generateTargets(profile, makeGoals(), makeAnalysis());
    expect(meta.bmrMethod).toBe('cunningham');
  });

  it('uses empirical TDEE from analysis', () => {
    const analysis = makeAnalysis({ bmrModel: { tdee_current: 2600 } });
    const { meta } = generateTargets(makeProfile(), makeGoals(), analysis);
    expect(meta.tdeeSource).toBe('empirical');
    expect(meta.tdeeValue).toBe(2600);
  });

  it('macro calorie balance: protein×4 + fat×9 + carbs×4 ≈ calories (within 20 kcal rounding)', () => {
    const { targets } = generateTargets(makeProfile(), makeGoals(), makeAnalysis());
    const check = (targets.protein * 4) + (targets.fat * 9) + (targets.carbs * 4);
    expect(Math.abs(check - targets.calories)).toBeLessThan(20);
  });

  it('works with formula fallback (no analysisResults)', () => {
    const profile = makeProfile({ manualWeightOverrideLb: 185 });
    const { targets, warnings } = generateTargets(profile, makeGoals(), null);
    expect(targets).not.toBeNull();
    expect(targets.calories).toBeGreaterThan(0);
    expect(warnings.length).toBe(0);
  });

  it('uses rawLatestWeightLb when analysisResults is null and no manual override', () => {
    const profile = makeProfile({ manualWeightOverrideLb: null });
    const { targets, meta } = generateTargets(profile, makeGoals(), null, 175);
    expect(targets).not.toBeNull();
    expect(meta.weightLb).toBe(175);
    expect(meta.weightSource).toBe('uploaded_raw');
  });

  it('returns error when both analysisResults and rawLatestWeightLb are absent', () => {
    const profile = makeProfile({ manualWeightOverrideLb: null });
    const { targets } = generateTargets(profile, makeGoals(), null, null);
    expect(targets).toBeNull();
  });

  it('produces correct targets for 60-year-old female maintenance', () => {
    const profile = makeProfile({
      sex: 'female', age: 60, heightValue: 65, heightUnit: 'in',
      manualWeightOverrideLb: 155, baselineActivityLevel: 'light',
    });
    const { targets, meta } = generateTargets(profile, makeGoals(), null);
    expect(meta.bmrMethod).toBe('mifflin_st_jeor');
    expect(targets.iron).toBe(8);    // post-menopausal female: 8 mg
    expect(targets.calcium).toBe(1200); // 51-70 female: 1200 mg
    expect(targets.calories).toBeGreaterThan(1300);
    expect(targets.calories).toBeLessThan(2500);
  });
});

// ── applyManualOverrides ──────────────────────────────────────────────────────

describe('applyManualOverrides', () => {
  it('overriding protein recomputes carbs and leaves calories/fat unchanged', () => {
    // protein 150→180: carbs = (2000 − 180×4 − 60×9)/4 = (2000−720−540)/4 = 740/4 = 185
    const generated = { calories: 2000, protein: 150, carbs: 200, fat: 60 };
    const result    = applyManualOverrides(generated, { protein: 180 });
    expect(result.protein).toBe(180);
    expect(result.calories).toBe(2000);
    expect(result.fat).toBe(60);
    expect(result.carbs).toBe(Math.max(0, Math.round((2000 - 180 * 4 - 60 * 9) / 4)));
  });

  it('returns generated unchanged when overrides is empty', () => {
    const generated = { calories: 2000, protein: 150 };
    expect(applyManualOverrides(generated, {})).toEqual(generated);
  });

  it('handles null generated gracefully', () => {
    expect(applyManualOverrides(null, { protein: 150 })).toBeNull();
  });

  it('does not mutate the generated object', () => {
    const generated = { calories: 2000, protein: 150 };
    const original  = { ...generated };
    applyManualOverrides(generated, { protein: 200 });
    expect(generated).toEqual(original);
  });
});

// ── computeCalorieTarget — new metadata fields ────────────────────────────────

describe('computeCalorieTarget — deficit metadata', () => {
  function futureDate(months) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  }

  it('shorter deadline → larger deficit than longer deadline (unclamped)', () => {
    const goals2mo = makeGoals({ goalType: 'fatLoss', targetWeightLb: 178, targetDate: futureDate(2) });
    const goals4mo = makeGoals({ goalType: 'fatLoss', targetWeightLb: 178, targetDate: futureDate(4) });
    const r2 = computeCalorieTarget('fatLoss', 2400, 1800, goals2mo, 185);
    const r4 = computeCalorieTarget('fatLoss', 2400, 1800, goals4mo, 185);
    expect(r2.appliedDeficit).toBeGreaterThan(r4.appliedDeficit);
  });

  it('returns rawRequiredDeficit and daysLeft when target date set', () => {
    const goals = makeGoals({ goalType: 'fatLoss', targetWeightLb: 178, targetDate: futureDate(3) });
    const { rawRequiredDeficit, daysLeft, targetWeightDeltaLb } = computeCalorieTarget('fatLoss', 2400, 1800, goals, 185);
    expect(rawRequiredDeficit).toBeGreaterThan(0);
    expect(daysLeft).toBeGreaterThan(14);
    expect(targetWeightDeltaLb).toBeCloseTo(7, 0);
  });

  it('clamps to maximum_deficit when required deficit exceeds 750 kcal', () => {
    const goals = makeGoals({ goalType: 'fatLoss', targetWeightLb: 155, targetDate: futureDate(1) });
    const { deficitClampReason, appliedDeficit } = computeCalorieTarget('fatLoss', 2400, 1800, goals, 185);
    expect(deficitClampReason).toBe('maximum_deficit');
    expect(appliedDeficit).toBe(750);
  });

  it('clamps to minimum_deficit when required deficit is below 200 kcal', () => {
    const goals = makeGoals({ goalType: 'fatLoss', targetWeightLb: 184, targetDate: futureDate(12) });
    const { deficitClampReason, appliedDeficit } = computeCalorieTarget('fatLoss', 2400, 1800, goals, 185);
    expect(deficitClampReason).toBe('minimum_deficit');
    expect(appliedDeficit).toBe(200);
  });

  it('returns bmr_floor when TDEE − deficit would go below safe floor', () => {
    const { deficitClampReason, calorieFloor, calories } = computeCalorieTarget('fatLoss', 1200, 1200, makeGoals(), 100);
    expect(deficitClampReason).toBe('bmr_floor');
    expect(calories).toBeGreaterThanOrEqual(calorieFloor);
  });

  it('returns calorieFloor = max(1000, 0.85 × bmr)', () => {
    const { calorieFloor } = computeCalorieTarget('fatLoss', 2400, 1800, makeGoals(), 185);
    expect(calorieFloor).toBe(Math.max(1000, Math.round(1800 * 0.85)));
  });

  it('non-fatLoss goals have deficitClampReason none', () => {
    for (const goalType of ['maintenance', 'muscleGain', 'performance', 'recomp', 'custom']) {
      const { deficitClampReason } = computeCalorieTarget(goalType, 2400, 1800, makeGoals(), 185);
      expect(deficitClampReason, goalType).toBe('none');
    }
  });
});

// ── computeTDEE — activity level interaction with empirical ───────────────────

describe('computeTDEE — activity level vs empirical', () => {
  const bmrResult = { bmr: 1800, methodLabel: 'Mifflin-St Jeor RMR' };

  it('baseline activity level changes formula TDEE when no empirical data', () => {
    const sed  = computeTDEE(bmrResult, makeProfile({ baselineActivityLevel: 'sedentary'   }), null);
    const very = computeTDEE(bmrResult, makeProfile({ baselineActivityLevel: 'very_active' }), null);
    expect(sed.tdee).toBeLessThan(very.tdee);
    expect(sed.source).toBe('formula');
    expect(very.source).toBe('formula');
  });

  it('baseline activity level does NOT change TDEE when empirical is active', () => {
    const analysis = makeAnalysis({ bmrModel: { tdee_current: 2400, error: null } });
    const sed  = computeTDEE(bmrResult, makeProfile({ baselineActivityLevel: 'sedentary'   }), analysis);
    const very = computeTDEE(bmrResult, makeProfile({ baselineActivityLevel: 'very_active' }), analysis);
    expect(sed.tdee).toBe(2400);
    expect(very.tdee).toBe(2400);
    expect(sed.source).toBe('empirical');
    expect(very.source).toBe('empirical');
  });

  it('generateTargets explanation includes activityIgnored note when empirical TDEE active', () => {
    const profile = makeProfile({ manualWeightOverrideLb: 185, baselineActivityLevel: 'sedentary' });
    const analysis = makeAnalysis({ bmrModel: { tdee_current: 2400, error: null } });
    const { explanation } = generateTargets(profile, makeGoals(), analysis);
    expect(explanation.activityIgnored).toBeTruthy();
    expect(explanation.activityIgnored).toMatch(/empirical|measured|history/i);
  });

  it('generateTargets explanation has no activityIgnored when TDEE is formula-based', () => {
    const profile = makeProfile({ manualWeightOverrideLb: 185 });
    const { explanation } = generateTargets(profile, makeGoals(), null);
    expect(explanation.activityIgnored).toBeNull();
  });
});

// ── Profile-change sensitivity (Fix 1: stale context guard) ──────────────────
// These tests prove that profile fields (activity level, weight, goal type)
// immediately affect the formula TDEE and calorie targets — the mechanism that
// makes buildTargetContext(mergedProfile) useful when it always reruns.

describe('profile changes affect formula targets immediately', () => {
  it('switching from sedentary to active raises formula TDEE', () => {
    const sedentary = makeProfile({ baselineActivityLevel: 'sedentary', manualWeightOverrideLb: 185 });
    const active    = makeProfile({ baselineActivityLevel: 'active',    manualWeightOverrideLb: 185 });

    const { targets: tSed } = generateTargets(sedentary, makeGoals({ goalType: 'maintenance' }), null);
    const { targets: tAct } = generateTargets(active,    makeGoals({ goalType: 'maintenance' }), null);

    expect(tAct.calories).toBeGreaterThan(tSed.calories);
  });

  it('heavier weight produces higher formula TDEE for same activity level', () => {
    const light  = makeProfile({ manualWeightOverrideLb: 150 });
    const heavy  = makeProfile({ manualWeightOverrideLb: 220 });

    const { targets: tL } = generateTargets(light, makeGoals({ goalType: 'maintenance' }), null);
    const { targets: tH } = generateTargets(heavy, makeGoals({ goalType: 'maintenance' }), null);

    expect(tH.calories).toBeGreaterThan(tL.calories);
  });

  it('fat-loss goal produces fewer calories than maintenance for same profile', () => {
    const profile = makeProfile({ manualWeightOverrideLb: 185 });
    const { targets: tMaint } = generateTargets(profile, makeGoals({ goalType: 'maintenance' }), null);
    const { targets: tFat   } = generateTargets(
      profile,
      makeGoals({ goalType: 'fatLoss', targetWeightLb: 170, targetDate: '2025-06-01' }),
      null,
    );

    expect(tFat.calories).toBeLessThan(tMaint.calories);
  });

  it('two extreme activity levels produce different formula TDEE via generateTargets', () => {
    const p1 = makeProfile({ baselineActivityLevel: 'sedentary',  manualWeightOverrideLb: 185 });
    const p2 = makeProfile({ baselineActivityLevel: 'very_active', manualWeightOverrideLb: 185 });
    const g  = makeGoals({ goalType: 'maintenance' });
    const r1 = generateTargets(p1, g, null);
    const r2 = generateTargets(p2, g, null);
    expect(r1.targets.calories).not.toEqual(r2.targets.calories);
  });
});

// ── computeProteinTarget — proteinBasis ───────────────────────────────────────

describe('computeProteinTarget — proteinBasis', () => {
  it('fat loss with no BF% and targetWeight < currentWeight uses target weight basis (auto)', () => {
    // 185 lb current, 165 lb target, no BF%
    // 165 lb × 0.45359 = 74.8 kg × 2.2 = 164.6 → should be ~165g (less than current 185 lb basis ~185g)
    const goals = makeGoals({ goalType: 'fatLoss', targetWeightLb: 165 });
    const { protein, proteinBasisUsed } = computeProteinTarget('fatLoss', 185, null, goals);
    const currentBasis = computeProteinTarget('fatLoss', 185, null, null);
    expect(protein).toBeLessThan(currentBasis.protein); // target-weight basis gives lower protein
    expect(protein).toBeGreaterThan(130);
    expect(proteinBasisUsed).toBe('targetWeight');
  });

  it('fat loss with no BF% and no targetWeight falls back to current weight', () => {
    const goals = makeGoals({ goalType: 'fatLoss', targetWeightLb: null });
    const { protein, proteinBasisUsed } = computeProteinTarget('fatLoss', 185, null, goals);
    const currentBasis = computeProteinTarget('fatLoss', 185, null, null);
    expect(protein).toBe(currentBasis.protein);
    expect(proteinBasisUsed).toBe('currentWeight');
  });

  it('fat loss with BF% uses leanMass basis (auto selects leanMass)', () => {
    // 185 lb, 15% BF → FFM = 185 × 0.45359 × 0.85 = 71.4 kg
    const ffm_kg = 185 * 0.45359237 * 0.85;
    const goals = makeGoals({ goalType: 'fatLoss', targetWeightLb: 165 });
    const { proteinBasisUsed, protein } = computeProteinTarget('fatLoss', 185, ffm_kg, goals);
    // leanMass should win over targetWeight when BF% is available
    expect(proteinBasisUsed).toBe('leanMass');
    // 2.7 g/kg FFM = 71.4 × 2.7 = 192.8 → ~193
    expect(protein).toBeGreaterThan(185);
  });

  it('maintenance with targetWeight set still uses current weight by default', () => {
    const goals = makeGoals({ goalType: 'maintenance', targetWeightLb: 165 });
    const { protein, proteinBasisUsed } = computeProteinTarget('maintenance', 185, null, goals);
    const currentBasis = computeProteinTarget('maintenance', 185, null, null);
    expect(protein).toBe(currentBasis.protein);
    expect(proteinBasisUsed).toBe('currentWeight');
  });

  it('explicit proteinBasis=currentWeight overrides auto for fat loss', () => {
    const goals = makeGoals({ goalType: 'fatLoss', targetWeightLb: 165, proteinBasis: 'currentWeight' });
    const { protein, proteinBasisUsed } = computeProteinTarget('fatLoss', 185, null, goals);
    expect(proteinBasisUsed).toBe('currentWeight');
    // Should be the same as current-weight basis
    const currentBasis = computeProteinTarget('fatLoss', 185, null, null);
    expect(protein).toBe(currentBasis.protein);
  });

  it('explicit leanMass uses FFM even when lean-mass protein is lower than body-weight protein', () => {
    // Use BF% = 45% (> 40.7% threshold) to make 2.7×FFM < 1.6×bodyWeight for maintenance
    // 100 lb, BF=45% → FFM = 100 × 0.45359 × 0.55 = 24.9 kg; 2.7×24.9 = 67.3 → 67 g
    // currentWeight maintenance (rate=1.6): 100 × 0.45359 × 1.6 = 72.6 → 73 g
    // So leanMass (67 g) < currentWeight (73 g) — explicit leanMass must still use FFM
    const ffm_kg = 100 * 0.45359237 * 0.55; // 24.95 kg FFM
    const goals = makeGoals({ goalType: 'maintenance', proteinBasis: 'leanMass' });
    const { protein, proteinBasisUsed, proteinBasisFallbackReason } = computeProteinTarget('maintenance', 100, ffm_kg, goals);
    expect(proteinBasisUsed).toBe('leanMass');
    expect(proteinBasisFallbackReason).toBeNull();
    const currentBasis = computeProteinTarget('maintenance', 100, null, null);
    expect(protein).toBeLessThan(currentBasis.protein); // FFM-based is lower but should still be used
    expect(protein).toBeCloseTo(Math.round(ffm_kg * 2.7), 0);
  });

  it('explicit leanMass without BF% falls back to currentWeight with fallback reason', () => {
    const goals = makeGoals({ goalType: 'maintenance', proteinBasis: 'leanMass' });
    const { protein, proteinBasisUsed, proteinBasisFallbackReason } = computeProteinTarget('maintenance', 185, null, goals);
    expect(proteinBasisUsed).toBe('currentWeight');
    expect(proteinBasisFallbackReason).toMatch(/BF%/i);
    const currentBasis = computeProteinTarget('maintenance', 185, null, null);
    expect(protein).toBe(currentBasis.protein);
  });

  it('adjustedWeight uses midpoint between current and target weight', () => {
    // 200 lb current, 160 lb target → midpoint = 180 lb
    // fatLoss rate = 2.2; 180 × 0.45359 × 2.2 = 179.4 → ~179
    const goals = makeGoals({ goalType: 'fatLoss', targetWeightLb: 160, proteinBasis: 'adjustedWeight' });
    const { protein, proteinBasisUsed, proteinBasisFallbackReason } = computeProteinTarget('fatLoss', 200, null, goals);
    expect(proteinBasisUsed).toBe('adjustedWeight');
    expect(proteinBasisFallbackReason).toBeNull();
    const midpointKg = ((200 + 160) / 2) * 0.45359237;
    expect(protein).toBeCloseTo(Math.round(midpointKg * 2.2), 0);
    // Must be between currentWeight and targetWeight basis
    const currentBasis = computeProteinTarget('fatLoss', 200, null, null);
    const targetBasis = computeProteinTarget('fatLoss', 200, null, makeGoals({ goalType: 'fatLoss', targetWeightLb: 160, proteinBasis: 'targetWeight' }));
    expect(protein).toBeLessThan(currentBasis.protein);
    expect(protein).toBeGreaterThan(targetBasis.protein);
  });

  it('adjustedWeight without valid target falls back to currentWeight with reason', () => {
    const goals = makeGoals({ goalType: 'fatLoss', targetWeightLb: null, proteinBasis: 'adjustedWeight' });
    const { protein, proteinBasisUsed, proteinBasisFallbackReason } = computeProteinTarget('fatLoss', 185, null, goals);
    expect(proteinBasisUsed).toBe('currentWeight');
    expect(proteinBasisFallbackReason).toMatch(/target weight/i);
  });

  it('adjustedWeight when target >= current falls back to currentWeight with reason', () => {
    // Target 190 lb >= current 185 lb — no valid conservative midpoint
    const goals = makeGoals({ goalType: 'muscleGain', targetWeightLb: 190, proteinBasis: 'adjustedWeight' });
    const { protein, proteinBasisUsed, proteinBasisFallbackReason } = computeProteinTarget('muscleGain', 185, null, goals);
    expect(proteinBasisUsed).toBe('currentWeight');
    expect(proteinBasisFallbackReason).toMatch(/not lower/i);
  });
});

// ── applyManualOverrides — macro recomposition (Issue 5) ─────────────────────

describe('applyManualOverrides — macro recomposition', () => {
  function baseTargets() {
    return { calories: 2200, protein: 150, fat: 60, fatMinimum: 50, carbs: 205 };
  }

  it('overriding calories down recomputes carbs proportionally', () => {
    // 1800 kcal − (150×4 = 600) − (60×9 = 540) = 660 → 165 g carbs
    const result = applyManualOverrides(baseTargets(), { calories: 1800 });
    expect(result.calories).toBe(1800);
    expect(result.protein).toBe(150);
    expect(result.fat).toBe(60);
    expect(result.carbs).toBe(Math.max(0, Math.round((1800 - 150 * 4 - 60 * 9) / 4)));
  });

  it('overriding calories up recomputes carbs proportionally', () => {
    // 2600 − (150×4) − (60×9) = 2600 − 600 − 540 = 1460 → 365 g carbs
    const result = applyManualOverrides(baseTargets(), { calories: 2600 });
    expect(result.carbs).toBe(Math.max(0, Math.round((2600 - 150 * 4 - 60 * 9) / 4)));
    expect(result.carbs).toBeGreaterThan(205);
  });

  it('overriding protein + calories recalculates carbs from the overridden values', () => {
    // calories=1800, protein=180: 1800 − (180×4) − (60×9) = 1800−720−540 = 540 → 135 g
    const result = applyManualOverrides(baseTargets(), { calories: 1800, protein: 180 });
    expect(result.protein).toBe(180);
    expect(result.carbs).toBe(Math.max(0, Math.round((1800 - 180 * 4 - 60 * 9) / 4)));
  });

  it('protein × 4 + fat × 9 exceeding calories sets carbs to 0 and attaches _warnings', () => {
    // 1000 kcal, protein=200(800 kcal), fat=30(270 kcal) → 1070 > 1000 → carbs = 0
    const result = applyManualOverrides(
      { calories: 1000, protein: 200, fat: 30, carbs: 50 },
      { calories: 1000, protein: 200 }
    );
    expect(result.carbs).toBe(0);
    expect(result._warnings).toBeDefined();
    expect(result._warnings.length).toBeGreaterThan(0);
  });

  it('carbs stay 0 and no underflow when protein+fat barely exceed target calories', () => {
    const result = applyManualOverrides(
      { calories: 1200, protein: 120, fat: 80, carbs: 100 },
      { calories: 1200, fat: 80 }
    );
    // 1200 − (120×4=480) − (80×9=720) = 0 → carbs = 0
    expect(result.carbs).toBe(0);
  });

  it('does not recompute carbs when carbs are explicitly overridden', () => {
    const result = applyManualOverrides(baseTargets(), { calories: 1800, carbs: 100 });
    // carbs explicitly set → should NOT be touched
    expect(result.carbs).toBe(100);
  });

  it('does not mutate the input targets object', () => {
    const base = baseTargets();
    const copy = { ...base };
    applyManualOverrides(base, { calories: 1800 });
    expect(base).toEqual(copy);
  });

  it('micronutrients are unaffected by calorie override', () => {
    const base = { ...baseTargets(), fiber: 38, potassium: 3500, vitaminD: 15 };
    const result = applyManualOverrides(base, { calories: 1600 });
    expect(result.fiber).toBe(38);
    expect(result.potassium).toBe(3500);
    expect(result.vitaminD).toBe(15);
  });

  it('returns null unchanged when generated is null', () => {
    expect(applyManualOverrides(null, { calories: 2000 })).toBeNull();
  });
});

// ── resolveDailyBaseTargets (Issue 2 — target mode) ──────────────────────────

describe('resolveDailyBaseTargets', () => {
  function makeState(overrides = {}) {
    return {
      baselineTargets: { calories: 2000, protein: 150, fat: 60, carbs: 200 },
      goalSettings: { goalType: 'maintenance', targetMode: 'manual', manualTargetOverrides: {} },
      userProfile: makeProfile({ manualWeightOverrideLb: 185 }),
      analysisResults: null,
      ...overrides,
    };
  }

  it('manual mode returns static baselineTargets', () => {
    const s = makeState();
    const { targets, source } = resolveDailyBaseTargets('2025-01-01', s);
    expect(source).toBe('manual');
    expect(targets.calories).toBe(2000);
  });

  it('manual mode is the default when targetMode is missing', () => {
    const s = makeState();
    delete s.goalSettings.targetMode;
    const { source } = resolveDailyBaseTargets('2025-01-01', s);
    expect(source).toBe('manual');
  });

  it('manual mode does not recompute targets from profile', () => {
    const s = makeState({ goalSettings: { targetMode: 'manual', goalType: 'fatLoss', manualTargetOverrides: {} } });
    const { targets } = resolveDailyBaseTargets('2025-01-01', s);
    // baselineTargets should be returned as-is, not recalculated
    expect(targets.calories).toBe(2000);
  });

  it('autoGoal mode returns computed targets for maintenance', () => {
    const s = makeState({
      goalSettings: { goalType: 'maintenance', targetMode: 'autoGoal', manualTargetOverrides: {} },
    });
    const { targets, source } = resolveDailyBaseTargets('2025-01-01', s);
    expect(source).toBe('autoGoal');
    expect(targets.calories).toBeGreaterThan(1500);
  });

  it('autoGoal mode falls back to manual when weight is unavailable', () => {
    const s = makeState({
      userProfile: makeProfile({ manualWeightOverrideLb: null, useUploadedWeightForCurrentWeight: false }),
      goalSettings: { goalType: 'maintenance', targetMode: 'autoGoal', manualTargetOverrides: {} },
      analysisResults: null,
    });
    const { source, warnings } = resolveDailyBaseTargets('2025-01-01', s);
    expect(source).toBe('manual_fallback');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('autoGoal applies manualTargetOverrides on top of computed targets', () => {
    const s = makeState({
      goalSettings: {
        goalType: 'maintenance', targetMode: 'autoGoal',
        manualTargetOverrides: { protein: 999 },
      },
    });
    const { targets } = resolveDailyBaseTargets('2025-01-01', s);
    expect(targets.protein).toBe(999);
  });
});

// ── target date / weight behavior (Issue 6) ───────────────────────────────────

describe('target weight/date behavior', () => {
  function futureDate(months) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  }

  it('7 lb loss in 2 months has lower base calorie target than 7 lb loss in 4 months (unclamped)', () => {
    const base = makeProfile({ manualWeightOverrideLb: 185 });
    const g2 = makeGoals({ goalType: 'fatLoss', targetWeightLb: 178, targetDate: futureDate(2) });
    const g4 = makeGoals({ goalType: 'fatLoss', targetWeightLb: 178, targetDate: futureDate(4) });
    const r2 = generateTargets(base, g2, null);
    const r4 = generateTargets(base, g4, null);
    // Shorter deadline → larger deficit → fewer calories
    expect(r2.targets.calories).toBeLessThanOrEqual(r4.targets.calories);
  });

  it('both scenarios clamped to max deficit show clamp reason in explanation', () => {
    const base = makeProfile({ manualWeightOverrideLb: 185 });
    // Very aggressive: 30 lb loss in 1 month — both should hit max clamp
    const g1 = makeGoals({ goalType: 'fatLoss', targetWeightLb: 155, targetDate: futureDate(1) });
    const r  = generateTargets(base, g1, null);
    expect(r.explanation.deficitClamped).toBeTruthy();
    expect(r.explanation.deficitClamped).toMatch(/cap|clamp|750/i);
  });

  it('moving target date later (more time) increases calorie target when unclamped', () => {
    const base = makeProfile({ manualWeightOverrideLb: 185 });
    const g3 = makeGoals({ goalType: 'fatLoss', targetWeightLb: 178, targetDate: futureDate(3) });
    const g6 = makeGoals({ goalType: 'fatLoss', targetWeightLb: 178, targetDate: futureDate(6) });
    const r3 = generateTargets(base, g3, null);
    const r6 = generateTargets(base, g6, null);
    expect(r6.targets.calories).toBeGreaterThanOrEqual(r3.targets.calories);
  });

  it('moving target date earlier (less time) lowers calorie target when unclamped', () => {
    const base = makeProfile({ manualWeightOverrideLb: 185 });
    const g6 = makeGoals({ goalType: 'fatLoss', targetWeightLb: 178, targetDate: futureDate(6) });
    const g3 = makeGoals({ goalType: 'fatLoss', targetWeightLb: 178, targetDate: futureDate(3) });
    const r6 = generateTargets(base, g6, null);
    const r3 = generateTargets(base, g3, null);
    expect(r3.targets.calories).toBeLessThanOrEqual(r6.targets.calories);
  });

  it('in manual mode, changing profile fields does not affect today daily target', () => {
    const stateBase = {
      baselineTargets: { calories: 2000, protein: 150, fat: 60, carbs: 200 },
      goalSettings: { targetMode: 'manual', goalType: 'maintenance', manualTargetOverrides: {} },
      userProfile: makeProfile({ manualWeightOverrideLb: 185 }),
      analysisResults: null,
    };
    const stateChanged = {
      ...stateBase,
      userProfile: makeProfile({ manualWeightOverrideLb: 220 }),
    };
    const { targets: t1 } = resolveDailyBaseTargets('2025-01-01', stateBase);
    const { targets: t2 } = resolveDailyBaseTargets('2025-01-01', stateChanged);
    // Manual mode: baselineTargets unchanged regardless of profile edits
    expect(t1.calories).toBe(t2.calories);
  });

  it('in autoGoal mode, today daily target changes when weight changes', () => {
    const goalSettings = { goalType: 'maintenance', targetMode: 'autoGoal', manualTargetOverrides: {} };
    const stateLight = {
      baselineTargets: { calories: 2000 },
      goalSettings,
      userProfile: makeProfile({ manualWeightOverrideLb: 150 }),
      analysisResults: null,
    };
    const stateHeavy = {
      ...stateLight,
      userProfile: makeProfile({ manualWeightOverrideLb: 220 }),
    };
    const { targets: tL } = resolveDailyBaseTargets('2025-01-01', stateLight);
    const { targets: tH } = resolveDailyBaseTargets('2025-01-01', stateHeavy);
    expect(tH.calories).toBeGreaterThan(tL.calories);
  });
});
