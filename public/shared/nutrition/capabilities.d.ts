export const NUTRIENT_V2_WRITES_ENABLED: false;
export const NUTRITRACK_CACHE_NAME: 'nutritrack-v3';
export function resolveNutrientWriteVersion(): 1 | 2;
export const NUTRITION_CAPABILITIES: {
  registryVersion: 2;
  readVersions: readonly [1, 2];
  readonly writeVersion: 1 | 2;
  textLabelsV2: true;
  cacheName: string;
};
