import { V2_KEYS } from '../nutrientRegistry.js';
/** Stored research fields; custom weighted fiber is computed by #64. */
export const PROFILE_FIELDS = Object.freeze(V2_KEYS.filter(key => key !== 'fiberWeightedLegacy'));
export function requestedFields(fields = '*') {
    if (fields === '*')
        return [...PROFILE_FIELDS];
    if (!Array.isArray(fields) || !fields.length || fields.some(k => !PROFILE_FIELDS.includes(k)))
        throw new TypeError('requestedFields: expected stored registry keys (derived metrics excluded)');
    return [...new Set(fields)].sort();
}
