/**
 * @file targets/dailyTargetResolver.js
 * Dedicated entry-point for per-day base target resolution.
 *
 * Re-exports `resolveDailyBaseTargets` from targetEngine.js so callers can
 * import from this purpose-named module rather than the full engine file.
 *
 * Usage:
 *   import { resolveDailyBaseTargets } from '../targets/dailyTargetResolver.js';
 */

export { resolveDailyBaseTargets } from './targetEngine.js';
