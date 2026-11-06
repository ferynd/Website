/**
 * Single switch for nutrient v2 writes. Stays false until Part B is approved.
 * resolveNutrientWriteVersion has no localStorage, query, or env override.
 */
export const NUTRIENT_V2_WRITES_ENABLED = false;

export const INGREDIENT_STORE_WRITES_ENABLED = false;
export const INGREDIENT_STORE_SCHEMA_VERSION = 1;

export const NUTRITRACK_CACHE_NAME = 'nutritrack-v5';

export function resolveNutrientWriteVersion() {
  return NUTRIENT_V2_WRITES_ENABLED ? 2 : 1;
}

export const NUTRITION_CAPABILITIES = {
  ingredientStore: Object.freeze({schemaVersion: INGREDIENT_STORE_SCHEMA_VERSION, writes: INGREDIENT_STORE_WRITES_ENABLED}),
  registryVersion: 2,
  readVersions: [1, 2],
  get writeVersion() {
    return resolveNutrientWriteVersion();
  },
  textLabelsV2: true,
  cacheName: NUTRITRACK_CACHE_NAME,
};
