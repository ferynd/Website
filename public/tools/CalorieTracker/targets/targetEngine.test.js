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
  it('replaces only the keys present in manualOverrides', () => {
    const generated = { calories: 2000, protein: 150, carbs: 200, fat: 60 };
    const result    = applyManualOverrides(generated, { protein: 180 });
    expect(result.protein).toBe(180);
    expect(result.calories).toBe(2000);
    expect(result.carbs).toBe(200);
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
