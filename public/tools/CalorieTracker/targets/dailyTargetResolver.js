/**
 * @file targets/dailyTargetResolver.js
 * Centralized per-day target resolution.
 *
 * resolveDailyBaseTargets  — backward-compat resolver used by the banking loop.
 * resolveDailyPlanningTargets — richer resolver that exposes the full TDEE
 *   breakdown, exerciseAddMode, weight source, and goal metadata.  Use this
 *   when any tab needs to explain where today's target came from.
 *
 * Usage:
 *   import { resolveDailyBaseTargets }    from '../targets/dailyTargetResolver.js';
 *   import { resolveDailyPlanningTargets } from '../targets/dailyTargetResolver.js';
 */

export { resolveDailyBaseTargets } from './targetEngine.js';

import { resolveDailyBaseTargets } from './targetEngine.js';

/**
 * Resolve today's per-day planning targets with full metadata.
 *
 * In manual mode most TDEE fields are null (the engine is not run).
 * In autoGoal mode all fields are populated from generateTargets().
 *
 * @param {string} dateStr   - 'YYYY-MM-DD'
 * @param {object} stateLike - { baselineTargets, goalSettings, userProfile,
 *                               analysisResults, weightEntries }
 * @returns {{
 *   mode:                  'manual'|'autoGoal'|'manual_fallback',
 *   targets:               object,
 *   baseCalories:          number,
 *   calorieFloor:          number,
 *   exerciseAddMode:       'add'|'skip',
 *   planningTdee:          number|null,
 *   planningTdeeSource:    string|null,
 *   planningTdeeSourceLabel: string|null,
 *   restDayTdee:           number|null,
 *   observedTdee:          number|null,
 *   tdeeCurrent:           number|null,
 *   tdeeCurrentRejected:   boolean,
 *   bmr:                   number|null,
 *   currentWeightLb:       number|null,
 *   weightSource:          string|null,
 *   weightSourceLabel:     string,
 *   goalDeficit:           number|null,
 *   daysLeft:              number|null,
 *   targetWeightDeltaLb:   number|null,
 *   warnings:              string[],
 * }}
 */
export function resolveDailyPlanningTargets(dateStr, stateLike) {
  const r = resolveDailyBaseTargets(dateStr, stateLike);
  const m = r.meta;

  if (!m) {
    return {
      mode:                  r.source,
      targets:               r.targets,
      baseCalories:          parseFloat(r.targets?.calories) || 0,
      calorieFloor:          r.calorieFloor,
      exerciseAddMode:       r.exerciseAddMode ?? 'add',
      planningTdee:          null,
      planningTdeeSource:    null,
      planningTdeeSourceLabel: null,
      restDayTdee:           null,
      observedTdee:          null,
      tdeeCurrent:           null,
      tdeeCurrentRejected:   false,
      bmr:                   null,
      currentWeightLb:       null,
      weightSource:          null,
      weightSourceLabel:     'Not available',
      goalDeficit:           null,
      daysLeft:              null,
      targetWeightDeltaLb:   null,
      warnings:              r.warnings,
    };
  }

  return {
    mode:                  r.source,
    targets:               r.targets,
    baseCalories:          parseFloat(r.targets?.calories) || 0,
    calorieFloor:          r.calorieFloor,
    exerciseAddMode:       r.exerciseAddMode ?? 'add',
    planningTdee:          m.tdeeValue          ?? null,
    planningTdeeSource:    m.tdeeSource          ?? null,
    planningTdeeSourceLabel: m.tdeeSourceLabel   ?? null,
    restDayTdee:           m.restDayTdee         ?? null,
    observedTdee:          m.observedTdee        ?? null,
    tdeeCurrent:           m.tdeeCurrent         ?? null,
    tdeeCurrentRejected:   m.tdeeCurrentRejected ?? false,
    bmr:                   m.bmrValue            ?? null,
    currentWeightLb:       m.weightLb            ?? null,
    weightSource:          m.weightSource        ?? null,
    weightSourceLabel:     m.weightLabel         ?? 'Not available',
    goalDeficit:           m.goalDeficit         ?? null,
    daysLeft:              m.daysLeft            ?? null,
    targetWeightDeltaLb:   m.targetWeightDeltaLb ?? null,
    warnings:              r.warnings,
  };
}
