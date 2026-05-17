/**
 * @file ui/nutrientHelpers.js
 * Pure helper functions for nutrient display logic.
 * No DOM, Firebase, or state access — safe to import anywhere and to unit-test.
 */

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
 *  - 'override' — user explicitly pinned this nutrient via manualTargetOverrides
 *  - 'custom'   — target differs from the DRI/default (goal-engine or manual settings)
 *  - 'dri'      — target exactly matches the DRI/default value
 *
 * @param {string} nutrient
 * @param {object} baselineTargets   - state.baselineTargets
 * @param {object} defaultTargets    - DEFAULT_TARGETS (reference values)
 * @param {object} manualOverrides   - state.goalSettings?.manualTargetOverrides (may be undefined)
 * @returns {'override'|'custom'|'dri'}
 */
export function classifyTargetSource(nutrient, baselineTargets, defaultTargets, manualOverrides) {
  if (manualOverrides?.[nutrient] !== undefined) return 'override';
  if (
    baselineTargets[nutrient] !== undefined &&
    Math.abs((baselineTargets[nutrient] ?? 0) - (defaultTargets[nutrient] ?? 0)) > 0.001
  ) return 'custom';
  return 'dri';
}
