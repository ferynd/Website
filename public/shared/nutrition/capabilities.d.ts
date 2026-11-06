export const NUTRIENT_V2_WRITES_ENABLED: false;
export const INGREDIENT_STORE_WRITES_ENABLED: false;
export const INGREDIENT_STORE_SCHEMA_VERSION: 1;
export const NUTRITRACK_CACHE_NAME: 'nutritrack-v4';
export function resolveNutrientWriteVersion(): 1 | 2;
export const NUTRITION_CAPABILITIES: {
  ingredientStore: Readonly<{schemaVersion:1;writes:false}>;
  registryVersion: 2;
  readVersions: readonly [1, 2];
  readonly writeVersion: 1 | 2;
  textLabelsV2: true;
  cacheName: string;
};
