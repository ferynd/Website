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
 *  - 'manual_override' — user explicitly pinned this nutrient via manualTargetOverrides
 *  - 'auto_goal'       — computed by the auto-goal engine (targetMode='autoGoal')
 *  - 'manual_baseline' — user saved a custom value via the Settings tab (manual mode)
 *  - 'dri'             — matches the DRI/default reference value
 *
 * @param {string} nutrient
 * @param {object} effectiveTargets  - resolved targets (baseline or auto-goal)
 * @param {object} defaultTargets    - DEFAULT_TARGETS (DRI reference values)
 * @param {object} manualOverrides   - state.goalSettings?.manualTargetOverrides (may be undefined)
 * @param {string} [targetMode]      - 'manual' | 'autoGoal' (default 'manual')
 * @returns {'manual_override'|'auto_goal'|'manual_baseline'|'dri'}
 */
export function classifyTargetSource(nutrient, effectiveTargets, defaultTargets, manualOverrides, targetMode = 'manual') {
  if (manualOverrides?.[nutrient] !== undefined) return 'manual_override';
  if (
    effectiveTargets[nutrient] !== undefined &&
    Math.abs((effectiveTargets[nutrient] ?? 0) - (defaultTargets[nutrient] ?? 0)) > 0.001
  ) {
    return targetMode === 'autoGoal' ? 'auto_goal' : 'manual_baseline';
  }
  return 'dri';
}
