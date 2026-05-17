/**
 * @file exercise/met.test.js
 * Unit tests for MET-based exercise calorie estimation and session helpers.
 * All tests are pure — no Firebase, DOM, or state access.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateSessionCalories,
  computeSessionTotals,
  hasMeaningfulSweatActivity,
  hasHeavyTraining,
  getEntryExerciseKcal,
  ACTIVITY_TYPES,
  SWEAT_ACTIVITIES,
} from './met.js';

// ---------------------------------------------------------------------------
// estimateSessionCalories — priority: manual > wearable > MET
// ---------------------------------------------------------------------------

describe('estimateSessionCalories priority chain', () => {
  it('uses manualCalories when set, ignoring wearable and duration', () => {
    const session = {
      activityType: 'running',
      durationMin: 30,
      intensity: 'hard',
      manualCalories: 500,
      wearableCalories: 400,
    };
    const { kcal, source } = estimateSessionCalories(session, 80);
    expect(kcal).toBe(500);
    expect(source).toBe('manual');
  });

  it('uses wearableCalories when manual is absent', () => {
    const session = {
      activityType: 'running',
      durationMin: 30,
      intensity: 'hard',
      wearableCalories: 380,
    };
    const { kcal, source } = estimateSessionCalories(session, 80);
    expect(kcal).toBe(380);
    expect(source).toBe('wearable');
  });

  it('falls through to MET estimate when neither override is set', () => {
    const session = {
      activityType: 'lifting',
      durationMin: 60,
      intensity: 'moderate', // scale = 1.0 → MET = 5.0
    };
    // kcal = 5.0 × 80 kg × 1 hour = 400
    const { kcal, source, met } = estimateSessionCalories(session, 80);
    expect(source).toBe('met_estimate');
    expect(met).toBe(5.0);
    expect(kcal).toBe(400);
  });

  it('ignores manualCalories of 0 and falls back to wearable', () => {
    const session = {
      activityType: 'cycling',
      durationMin: 45,
      intensity: 'moderate',
      manualCalories: 0,
      wearableCalories: 320,
    };
    const { kcal, source } = estimateSessionCalories(session, 80);
    expect(kcal).toBe(320);
    expect(source).toBe('wearable');
  });

  it('ignores wearableCalories of 0 and falls back to MET', () => {
    const session = {
      activityType: 'walking',
      durationMin: 60,
      intensity: 'easy', // scale = 0.75 → MET = 3.5 × 0.75 = 2.625
      wearableCalories: 0,
    };
    const { source } = estimateSessionCalories(session, 80);
    expect(source).toBe('met_estimate');
  });
});

// ---------------------------------------------------------------------------
// MET formula correctness
// ---------------------------------------------------------------------------

describe('estimateSessionCalories MET formula', () => {
  it('applies intensity scale correctly for hard running', () => {
    // running base MET = 9.8, hard scale = 1.25 → 12.25
    // kcal = 12.25 × 80 × 0.5h = 490
    const session = { activityType: 'running', durationMin: 30, intensity: 'hard' };
    const { kcal, met } = estimateSessionCalories(session, 80);
    expect(met).toBeCloseTo(12.25, 2);
    expect(kcal).toBe(490);
  });

  it('applies easy (0.75) scale for yoga', () => {
    // yoga base MET = 3.0, easy scale = 0.75 → 2.25
    // kcal = 2.25 × 70 × (45/60) = 118.125 → 118
    const session = { activityType: 'yoga', durationMin: 45, intensity: 'easy' };
    const { kcal } = estimateSessionCalories(session, 70);
    expect(kcal).toBe(118);
  });

  it('floors weight at 40 kg to avoid implausible results', () => {
    const session = { activityType: 'lifting', durationMin: 60, intensity: 'moderate' };
    // With weight 10 kg → floor to 40; MET=5.0, 1h → 200 kcal
    const { kcal } = estimateSessionCalories(session, 10);
    expect(kcal).toBe(200);
  });

  it('returns 0 kcal for 0-duration session', () => {
    const session = { activityType: 'running', durationMin: 0, intensity: 'hard' };
    const { kcal } = estimateSessionCalories(session, 80);
    expect(kcal).toBe(0);
  });

  it('falls back to custom MET for unknown activity type', () => {
    // custom base MET = 5.0, moderate = 1.0 → 5.0 × 80 × 0.5 = 200
    const session = { activityType: 'unicycling', durationMin: 30, intensity: 'moderate' };
    const { kcal, met } = estimateSessionCalories(session, 80);
    expect(met).toBe(5.0);
    expect(kcal).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// computeSessionTotals — multi-session aggregation
// ---------------------------------------------------------------------------

describe('computeSessionTotals', () => {
  it('returns zeros for an empty session array', () => {
    const { totalKcal, source, sessionCount } = computeSessionTotals([], 80);
    expect(totalKcal).toBe(0);
    expect(source).toBe('none');
    expect(sessionCount).toBe(0);
  });

  it('returns zeros for null input', () => {
    const { totalKcal, sessionCount } = computeSessionTotals(null, 80);
    expect(totalKcal).toBe(0);
    expect(sessionCount).toBe(0);
  });

  it('sums kcal across multiple sessions', () => {
    const sessions = [
      { activityType: 'lifting',  durationMin: 60, intensity: 'moderate' }, // 5.0×80×1 = 400
      { activityType: 'walking',  durationMin: 60, intensity: 'moderate' }, // 3.5×80×1 = 280
    ];
    const { totalKcal, sessionCount } = computeSessionTotals(sessions, 80);
    expect(totalKcal).toBe(680);
    expect(sessionCount).toBe(2);
  });

  it('source is manual when any session has manualCalories', () => {
    const sessions = [
      { activityType: 'running', durationMin: 30, intensity: 'hard', manualCalories: 400 },
      { activityType: 'lifting', durationMin: 45, intensity: 'moderate' },
    ];
    const { source } = computeSessionTotals(sessions, 80);
    expect(source).toBe('manual');
  });

  it('source is wearable when wearable but no manual override present', () => {
    const sessions = [
      { activityType: 'cycling',  durationMin: 60, intensity: 'moderate', wearableCalories: 500 },
      { activityType: 'swimming', durationMin: 30, intensity: 'moderate' },
    ];
    const { source } = computeSessionTotals(sessions, 80);
    expect(source).toBe('wearable');
  });
});

// ---------------------------------------------------------------------------
// hasMeaningfulSweatActivity
// ---------------------------------------------------------------------------

describe('hasMeaningfulSweatActivity', () => {
  it('returns false for null or empty sessions', () => {
    expect(hasMeaningfulSweatActivity(null)).toBe(false);
    expect(hasMeaningfulSweatActivity([])).toBe(false);
  });

  it('returns true for a sweat activity at moderate intensity ≥30 min', () => {
    const sessions = [{ activityType: 'running', intensity: 'moderate', durationMin: 30 }];
    expect(hasMeaningfulSweatActivity(sessions)).toBe(true);
  });

  it('returns false for a sweat activity at easy intensity', () => {
    const sessions = [{ activityType: 'running', intensity: 'easy', durationMin: 45 }];
    expect(hasMeaningfulSweatActivity(sessions)).toBe(false);
  });

  it('returns false for a sweat activity under 30 min', () => {
    const sessions = [{ activityType: 'cycling', intensity: 'hard', durationMin: 25 }];
    expect(hasMeaningfulSweatActivity(sessions)).toBe(false);
  });

  it('returns false for non-sweat activity even at hard intensity', () => {
    const sessions = [{ activityType: 'lifting', intensity: 'very_hard', durationMin: 60 }];
    expect(hasMeaningfulSweatActivity(sessions)).toBe(false);
  });

  it('returns true when at least one session qualifies out of several', () => {
    const sessions = [
      { activityType: 'yoga',    intensity: 'easy',     durationMin: 60 }, // no
      { activityType: 'running', intensity: 'hard',     durationMin: 40 }, // yes
    ];
    expect(hasMeaningfulSweatActivity(sessions)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasHeavyTraining
// ---------------------------------------------------------------------------

describe('hasHeavyTraining', () => {
  it('returns false for null or empty sessions', () => {
    expect(hasHeavyTraining(null)).toBe(false);
    expect(hasHeavyTraining([])).toBe(false);
  });

  it('returns true for a hard session ≥45 min', () => {
    const sessions = [{ activityType: 'lifting', intensity: 'hard', durationMin: 45 }];
    expect(hasHeavyTraining(sessions)).toBe(true);
  });

  it('returns true for very_hard session ≥45 min', () => {
    const sessions = [{ activityType: 'hiit', intensity: 'very_hard', durationMin: 50 }];
    expect(hasHeavyTraining(sessions)).toBe(true);
  });

  it('returns false for hard session under 45 min', () => {
    const sessions = [{ activityType: 'lifting', intensity: 'hard', durationMin: 44 }];
    expect(hasHeavyTraining(sessions)).toBe(false);
  });

  it('returns false for moderate session ≥45 min', () => {
    const sessions = [{ activityType: 'lifting', intensity: 'moderate', durationMin: 60 }];
    expect(hasHeavyTraining(sessions)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getEntryExerciseKcal — priority chain
// ---------------------------------------------------------------------------

describe('getEntryExerciseKcal priority chain', () => {
  it('uses exerciseSessions when present, ignoring level and trainingBump', () => {
    const entry = {
      exerciseSessions: [{ activityType: 'lifting', durationMin: 60, intensity: 'moderate' }],
      dayActivityLevel: 'heavy',
      trainingBump: 999,
    };
    // lifting moderate 1h × 80kg = 5.0 × 80 × 1 = 400
    expect(getEntryExerciseKcal(entry, 80)).toBe(400);
  });

  it('falls through to level/bump when exerciseSessions is empty array', () => {
    const entry = { exerciseSessions: [], dayActivityLevel: 'medium' };
    // medium bump = 200
    expect(getEntryExerciseKcal(entry, 80)).toBe(200);
  });

  it('uses dayActivityLevel bump when level is set and not rest/custom', () => {
    expect(getEntryExerciseKcal({ dayActivityLevel: 'heavy' }, 80)).toBe(350);
    expect(getEntryExerciseKcal({ dayActivityLevel: 'light' }, 80)).toBe(100);
    expect(getEntryExerciseKcal({ dayActivityLevel: 'medium' }, 80)).toBe(200);
  });

  it('returns 0 for rest level', () => {
    expect(getEntryExerciseKcal({ dayActivityLevel: 'rest' }, 80)).toBe(0);
  });

  it('returns 0 for custom level (sessions provide actual calories)', () => {
    expect(getEntryExerciseKcal({ dayActivityLevel: 'custom' }, 80)).toBe(0);
  });

  it('uses legacy trainingBump when no level is set', () => {
    expect(getEntryExerciseKcal({ trainingBump: 250 }, 80)).toBe(250);
  });

  it('prefers stored trainingBump over derived dayActivityLevel when both present', () => {
    // normalizeEntry() derives dayActivityLevel='light' from trainingBump=999 in memory,
    // but the exact stored value must win
    expect(getEntryExerciseKcal({ dayActivityLevel: 'light', trainingBump: 999 }, 80)).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// getEntryExerciseKcal — legacy trainingBump exactness (regression)
// ---------------------------------------------------------------------------

describe('getEntryExerciseKcal legacy trainingBump exactness', () => {
  it('exerciseSessions still win over trainingBump and derived level', () => {
    const entry = {
      exerciseSessions: [{ activityType: 'lifting', durationMin: 60, intensity: 'moderate' }],
      dayActivityLevel: 'heavy',
      trainingBump: 400,
    };
    // Sessions: 5.0 MET × 80 kg × 1 h = 400 — same coincidental value, confirms sessions path
    expect(getEntryExerciseKcal(entry, 80)).toBe(400);
    // Verify with a different weight to distinguish sessions from trainingBump path
    expect(getEntryExerciseKcal({ ...entry, trainingBump: 999 }, 70)).toBe(350); // 5.0×70×1
  });

  it('trainingBump=280 with derived dayActivityLevel=medium returns 280, not 200', () => {
    // normalizeEntry() maps 280 → 'medium'; DAY_ACTIVITY_LEVELS.medium.bump = 200
    const entry = { trainingBump: 280, dayActivityLevel: 'medium' };
    expect(getEntryExerciseKcal(entry, 80)).toBe(280);
  });

  it('trainingBump=400 with derived dayActivityLevel=heavy returns 400, not 350', () => {
    // normalizeEntry() maps 400 → 'heavy'; DAY_ACTIVITY_LEVELS.heavy.bump = 350
    const entry = { trainingBump: 400, dayActivityLevel: 'heavy' };
    expect(getEntryExerciseKcal(entry, 80)).toBe(400);
  });

  it('new entry with dayActivityLevel=medium and no trainingBump returns configured bump', () => {
    // Modern quick-select entries have no trainingBump — level is authoritative
    expect(getEntryExerciseKcal({ dayActivityLevel: 'medium' }, 80)).toBe(200);
  });

  it('custom level with no trainingBump returns 0 (sessions will provide calories)', () => {
    expect(getEntryExerciseKcal({ dayActivityLevel: 'custom' }, 80)).toBe(0);
  });

  it('rest level with no trainingBump returns 0', () => {
    expect(getEntryExerciseKcal({ dayActivityLevel: 'rest' }, 80)).toBe(0);
  });

  it('trainingBump=0 with a level still uses the level (0 is not a stored bump)', () => {
    expect(getEntryExerciseKcal({ trainingBump: 0, dayActivityLevel: 'medium' }, 80)).toBe(200);
  });

  it('returns 0 for null entry', () => {
    expect(getEntryExerciseKcal(null, 80)).toBe(0);
  });

  it('returns 0 for undefined entry', () => {
    expect(getEntryExerciseKcal(undefined, 80)).toBe(0);
  });

  it('returns 0 for empty entry object', () => {
    expect(getEntryExerciseKcal({}, 80)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ACTIVITY_TYPES metadata sanity checks
// ---------------------------------------------------------------------------

describe('ACTIVITY_TYPES metadata', () => {
  it('has exactly 11 activity types', () => {
    expect(Object.keys(ACTIVITY_TYPES)).toHaveLength(11);
  });

  it('walking has both hasDistance and hasSteps', () => {
    expect(ACTIVITY_TYPES.walking.hasDistance).toBe(true);
    expect(ACTIVITY_TYPES.walking.hasSteps).toBe(true);
  });

  it('lifting has neither hasDistance nor hasSteps', () => {
    expect(ACTIVITY_TYPES.lifting.hasDistance).toBe(false);
    expect(ACTIVITY_TYPES.lifting.hasSteps).toBe(false);
  });

  it('SWEAT_ACTIVITIES does not include lifting or yoga', () => {
    expect(SWEAT_ACTIVITIES.has('lifting')).toBe(false);
    expect(SWEAT_ACTIVITIES.has('yoga')).toBe(false);
  });

  it('SWEAT_ACTIVITIES includes running, cycling, swimming', () => {
    expect(SWEAT_ACTIVITIES.has('running')).toBe(true);
    expect(SWEAT_ACTIVITIES.has('cycling')).toBe(true);
    expect(SWEAT_ACTIVITIES.has('swimming')).toBe(true);
  });
});
