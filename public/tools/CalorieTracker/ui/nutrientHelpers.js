/**
 * @file ui/nutrientHelpers.js
 * Shared helper functions for nutrient display logic and weight resolution.
 * No DOM or Firebase access. resolveWeightKg reads from state (not pure),
 * but computeTrendDirection and classifyTargetSource are fully pure.
 */

import { state } from '../state/store.js';

// ---------------------------------------------------------------------------
// Weight resolution (shared by dashboard, chart, and data service)
// ---------------------------------------------------------------------------

/**
 * Resolve the user's current body weight in kg from state.
 * Prefers manual override, then smoothed analysis weight, then falls back to 80 kg.
 *
 * Used as an approximation for historical MET-based exercise calorie calculations.
 */
export function resolveWeightKg() {
  const manual = parseFloat(state.userProfile?.manualWeightOverrideLb);
  if (!isNaN(manual) && manual > 0) return manual * 0.45359237;
  const smoothed = state.analysisResults?.summary?.currentWeight;
  if (smoothed && smoothed > 0) return smoothed * 0.45359237;
  return 80;
}

// ---------------------------------------------------------------------------
// Trend and target-source helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Compute trend direction by comparing a recent window to a prior window.
 *
 * Suppresses the trend arrow when either value is zero or the prior window
 * is null (insufficient data).
 *
 * @param {number}      recentVal - Average intake for the recent window (e.g. days 0-2).
 * @param {number|null} priorVal  - Average intake for the prior window (e.g. days 3-6).
 *                                  Pass null to suppress the arrow (not enough history).
 * @returns {'up'|'down'|'stable'}
 */
export function computeTrendDirection(recentVal, priorVal) {
  if (priorVal === null || priorVal === 0 || recentVal === 0) return 'stable';
  const ratio = (recentVal - priorVal) / priorVal;
  return ratio > 0.05 ? 'up' : ratio < -0.05 ? 'down' : 'stable';
}

/**
 * Classify the source of a nutrient target.
 *
 * Returns one of:
 *  - 'manual_override'    — user explicitly pinned this nutrient via manualTargetOverrides
 *  - 'auto_goal'          — computed by the auto-goal engine (targetMode='autoGoal')
 *  - 'manual_baseline'    — user saved a custom value via the Settings tab (manual mode)
 *  - 'dri_profile_default'— matches the age/sex-specific profile DRI (differs from generic default)
 *  - 'dri'                — matches the generic DEFAULT_TARGETS reference value
 *
 * @param {string} nutrient
 * @param {object} effectiveTargets  - resolved targets (baseline or auto-goal)
 * @param {object} defaultTargets    - DEFAULT_TARGETS (generic DRI reference values)
 * @param {object} manualOverrides   - state.goalSettings?.manualTargetOverrides (may be undefined)
 * @param {string} [targetMode]      - 'manual' | 'autoGoal' (default 'manual')
 * @param {object} [profileDriTargets] - age/sex-specific DRI from computeMicronutrientTargets()
 * @returns {'manual_override'|'auto_goal'|'manual_baseline'|'dri_profile_default'|'dri'}
 */
export function classifyTargetSource(nutrient, effectiveTargets, defaultTargets, manualOverrides, targetMode = 'manual', profileDriTargets = null) {
  if (manualOverrides?.[nutrient] !== undefined) return 'manual_override';
  const effective = effectiveTargets[nutrient];
  if (effective !== undefined) {
    // Exact match against generic default → plain DRI
    if (Math.abs((effective ?? 0) - (defaultTargets[nutrient] ?? 0)) <= 0.001) return 'dri';
    // Match against profile-specific DRI (age/sex adjusted) — a profile DRI default, not customized
    if (profileDriTargets && profileDriTargets[nutrient] !== undefined &&
        Math.abs((effective ?? 0) - (profileDriTargets[nutrient] ?? 0)) <= 0.001) return 'dri_profile_default';
    return targetMode === 'autoGoal' ? 'auto_goal' : 'manual_baseline';
  }
  return 'dri';
}

const STATUS_BADGES = {
  measured: 'measured',
  label_reported: 'label',
  calculated: 'calculated',
  estimated_from_comparable: 'estimated',
  estimated_from_recipe: 'estimated',
  below_quantification_limit: 'below LOQ',
  unknown: 'unknown',
  not_applicable: 'n/a',
  legacy_unclassified: 'legacy',
  assumed_zero: 'assumed zero',
  source_reported: 'source reported',
};

/** Pure display string. Partial coverage is a caller prefix ("≥"), not baked in here. */
export function formatNutrientWithStatus(value, def, quality) {
  const unit = def?.unit ? ` ${def.unit}` : '';
  const badge = STATUS_BADGES[quality?.status] || 'unknown';
  if (value == null) {
    if (quality?.upperBound != null) return `< ${quality.upperBound}${unit} (${badge})`;
    return `unknown (${badge})`;
  }
  return `${value}${unit} (${badge})`;
}
