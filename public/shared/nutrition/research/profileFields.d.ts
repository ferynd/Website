import type { NutrientKey } from '../nutrientRegistry';
export type ProfileNutrientKey = Exclude<NutrientKey, 'fiberWeightedLegacy'>;
export const PROFILE_FIELDS: readonly ProfileNutrientKey[];
export function requestedFields(fields?: readonly string[] | '*'): ProfileNutrientKey[];
