/**
 * @file exercise/met.js
 * MET table (2024 Compendium of Physical Activities) + session calorie estimation.
 * Pure functions only — no DOM, Firebase, or state access.
 *
 * Formula: kcal = MET × body_weight_kg × duration_hours
 * Priority per session: manualCalories > wearableCalories > MET estimate
 */

// ---------------------------------------------------------------------------
// Activity type definitions
// ---------------------------------------------------------------------------

export const ACTIVITY_TYPES = {
  walking:        { label: 'Walking',         hasDistance: true,  hasSteps: true  },
  running:        { label: 'Running',         hasDistance: true,  hasSteps: false },
  cycling:        { label: 'Cycling',         hasDistance: true,  hasSteps: false },
  lifting:        { label: 'Lifting',         hasDistance: false, hasSteps: false },
  hiit:           { label: 'HIIT / Circuit',  hasDistance: false, hasSteps: false },
  sport:          { label: 'Sport',           hasDistance: false, hasSteps: false },
  swimming:       { label: 'Swimming',        hasDistance: true,  hasSteps: false },
  rowing:         { label: 'Rowing',          hasDistance: true,  hasSteps: false },
  cardio_machine: { label: 'Cardio Machine',  hasDistance: false, hasSteps: false },
  yoga:           { label: 'Yoga / Mobility', hasDistance: false, hasSteps: false },
  custom:         { label: 'Manual / Custom', hasDistance: false, hasSteps: false },
};

// ---------------------------------------------------------------------------
// MET values — base at "moderate" intensity
// Source: 2024 Compendium of Physical Activities (Ainsworth et al.)
// ---------------------------------------------------------------------------

const BASE_MET = {
  walking:        3.5,   // 3.0 mph, level surface (code 17130)
  running:        9.8,   // ~6 mph (code 02050)
  cycling:        7.5,   // 12–14 mph moderate (code 01050)
  lifting:        5.0,   // moderate free-weight / machine (code 02395)
  hiit:           8.0,   // vigorous circuit training (code 02040)
  sport:          6.0,   // general sport / recreational (code 15000)
  swimming:       6.0,   // freestyle moderate (code 18210)
  rowing:         7.0,   // ergometer moderate effort (code 02065)
  cardio_machine: 6.0,   // elliptical / stairmill general (code 02070)
  yoga:           3.0,   // hatha yoga (code 11059)
  custom:         5.0,   // user-defined — population midpoint fallback
};

// ---------------------------------------------------------------------------
// Intensity scaling multipliers
// ---------------------------------------------------------------------------

const INTENSITY_SCALE = {
  easy:      0.75,
  moderate:  1.00,
  hard:      1.25,
  very_hard: 1.50,
};

export const INTENSITY_LABELS = {
  easy:      'Easy',
  moderate:  'Moderate',
  hard:      'Hard',
  very_hard: 'Very Hard',
};

// ---------------------------------------------------------------------------
// Electrolyte / sweat classification
// ---------------------------------------------------------------------------

/**
 * Activities that produce significant sweat loss and may warrant
 * optional sodium / potassium / magnesium target adjustments.
 */
export const SWEAT_ACTIVITIES = new Set([
  'running', 'cycling', 'swimming', 'rowing', 'hiit', 'sport',
]);

// ---------------------------------------------------------------------------
// Core estimation
// ---------------------------------------------------------------------------

/**
 * Estimate kcal burned for a single exercise session.
 *
 * Priority: manualCalories > wearableCalories > MET × weight × duration.
 *
 * @param {object} session   - Exercise session object from exerciseSessions[].
 * @param {number} weightKg  - User body weight in kg (default 80 kg if unknown).
 * @returns {{ kcal: number, source: string, met: number|null }}
 */
export function estimateSessionCalories(session, weightKg = 80) {
  const manual = parseFloat(session.manualCalories);
  if (!isNaN(manual) && manual > 0) {
    return { kcal: Math.round(manual), source: 'manual', met: null };
  }

  const wearable = parseFloat(session.wearableCalories);
  if (!isNaN(wearable) && wearable > 0) {
    return { kcal: Math.round(wearable), source: 'wearable', met: null };
  }

  const baseMet       = BASE_MET[session.activityType] ?? BASE_MET.custom;
  const scale         = INTENSITY_SCALE[session.intensity] ?? 1.0;
  const met           = +(baseMet * scale).toFixed(2);
  const durationHours = (parseFloat(session.durationMin) || 0) / 60;
  const safeWeight    = Math.max(weightKg, 40); // floor at 40 kg

  return {
    kcal:   Math.round(met * safeWeight * durationHours),
    source: 'met_estimate',
    met,
  };
}

/**
 * Sum calories across all sessions in a daily entry.
 *
 * @param {object[]} sessions - entry.exerciseSessions array.
 * @param {number}   weightKg
 * @returns {{ totalKcal: number, source: string, sessionCount: number }}
 */
export function computeSessionTotals(sessions, weightKg = 80) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return { totalKcal: 0, source: 'none', sessionCount: 0 };
  }

  let totalKcal      = 0;
  let dominantSource = 'met_estimate';

  for (const s of sessions) {
    const { kcal, source } = estimateSessionCalories(s, weightKg);
    totalKcal += kcal;
    if (source === 'manual') dominantSource = 'manual';
    else if (source === 'wearable' && dominantSource !== 'manual') dominantSource = 'wearable';
  }

  return { totalKcal, source: dominantSource, sessionCount: sessions.length };
}

// ---------------------------------------------------------------------------
// Electrolyte scaling helpers
// ---------------------------------------------------------------------------

/**
 * True when sessions include ≥1 meaningful sweat activity
 * (sweat type, moderate+ intensity, ≥30 min duration).
 * Used to decide whether to suggest Na / K / Mg adjustments.
 */
export function hasMeaningfulSweatActivity(sessions) {
  if (!Array.isArray(sessions)) return false;
  return sessions.some(s =>
    SWEAT_ACTIVITIES.has(s.activityType) &&
    ['moderate', 'hard', 'very_hard'].includes(s.intensity) &&
    (parseFloat(s.durationMin) || 0) >= 30
  );
}

/**
 * True when any session is hard/very_hard for ≥45 min (moderate electrolyte bump).
 * Covers lifting and strength-based work that still causes some sweat.
 */
export function hasHeavyTraining(sessions) {
  if (!Array.isArray(sessions)) return false;
  return sessions.some(s =>
    ['hard', 'very_hard'].includes(s.intensity) &&
    (parseFloat(s.durationMin) || 0) >= 45
  );
}
