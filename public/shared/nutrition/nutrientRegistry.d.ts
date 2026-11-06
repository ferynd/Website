export const NUTRIENT_REGISTRY_VERSION: 2;

export type NutrientStatus =
  | 'measured'
  | 'label_reported'
  | 'calculated'
  | 'estimated_from_comparable'
  | 'below_quantification_limit'
  | 'unknown'
  | 'not_applicable'
  | 'legacy_unclassified';

export const NUTRIENT_STATUSES: readonly NutrientStatus[];
export const FIBER_MEANINGS: readonly ['total', 'weighted_legacy', 'unknown'];
export const CARB_CONVENTIONS: readonly ['includes_fiber', 'excludes_fiber', 'unknown'];
export type FiberMeaning = (typeof FIBER_MEANINGS)[number];
export type CarbConvention = (typeof CARB_CONVENTIONS)[number];
export const RESERVED_DOC_FIELDS: readonly string[];

export const V2_KEYS: readonly [
  'calories',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'potassium',
  'magnesium',
  'sodium',
  'calcium',
  'choline',
  'vitaminB12',
  'folate',
  'vitaminC',
  'vitaminB6',
  'vitaminA',
  'vitaminD',
  'vitaminE',
  'vitaminK',
  'selenium',
  'iodine',
  'phosphorus',
  'iron',
  'zinc',
  'omega3',
  'fatSaturated',
  'fatTrans',
  'fatMonounsaturated',
  'fatPolyunsaturated',
  'omega3ALA',
  'omega3EPA',
  'omega3DHA',
  'omega3DPA',
  'omega6',
  'sugarsTotal',
  'sugarsAdded',
  'starch',
  'allulose',
  'sugarAlcoholsTotal',
  'erythritol',
  'sorbitol',
  'mannitol',
  'isomalt',
  'xylitol',
  'glycerol',
  'maltitol',
  'fiberTotal',
  'fiberSoluble',
  'fiberInsoluble',
  'resistantStarch',
  'fiberWeightedLegacy',
  'vitaminB1',
  'vitaminB2',
  'vitaminB3',
  'vitaminB5',
  'biotin',
  'copper',
  'manganese',
  'chromium',
  'molybdenum',
  'chloride',
  'cholesterol',
  'alcohol',
  'water',
  'caffeine',
  'lactose',
  'fructans',
  'gos',
  'excessFructose',
];
export const LEGACY_V1_KEYS: readonly [
  'calories',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'potassium',
  'magnesium',
  'sodium',
  'calcium',
  'choline',
  'vitaminB12',
  'folate',
  'vitaminC',
  'vitaminB6',
  'vitaminA',
  'vitaminD',
  'vitaminE',
  'vitaminK',
  'selenium',
  'iodine',
  'phosphorus',
  'iron',
  'zinc',
  'omega3',
];
export const V2_DETAIL_KEYS: readonly [
  'fatSaturated',
  'fatTrans',
  'fatMonounsaturated',
  'fatPolyunsaturated',
  'omega3ALA',
  'omega3EPA',
  'omega3DHA',
  'omega3DPA',
  'omega6',
  'sugarsTotal',
  'sugarsAdded',
  'starch',
  'allulose',
  'sugarAlcoholsTotal',
  'erythritol',
  'sorbitol',
  'mannitol',
  'isomalt',
  'xylitol',
  'glycerol',
  'maltitol',
  'fiberTotal',
  'fiberSoluble',
  'fiberInsoluble',
  'resistantStarch',
  'fiberWeightedLegacy',
  'vitaminB1',
  'vitaminB2',
  'vitaminB3',
  'vitaminB5',
  'biotin',
  'copper',
  'manganese',
  'chromium',
  'molybdenum',
  'chloride',
  'cholesterol',
  'alcohol',
  'water',
  'caffeine',
  'lactose',
  'fructans',
  'gos',
  'excessFructose',
];

export type NutrientKey = (typeof V2_KEYS)[number];
export type LegacyKey = (typeof LEGACY_V1_KEYS)[number];
export type DetailKey = (typeof V2_DETAIL_KEYS)[number];
export type NutrientUnit = 'kcal' | 'g' | 'mg' | 'mcg';
export type TargetRole = 'floor' | 'average' | 'optional' | 'none';

export interface NutrientDef {
  key: NutrientKey;
  label: string;
  unit: NutrientUnit;
  group: string;
  since: 1 | 2;
  parent?: NutrientKey;
  relation?: 'component';
  labels: readonly string[];
  legacyAliases: readonly string[];
  bounds: { perUnit: { max: number }; per100g: { hardMax: number; reviewAbove: number } };
  targetRole: TargetRole;
  optional: boolean;
  notes: string;
}

export const NUTRIENTS: readonly NutrientDef[];
export const FINGERPRINT_KEYSETS: { 1: typeof LEGACY_V1_KEYS; 2: typeof V2_KEYS };
export const V1_DISPLAY_GROUPS: readonly { key: string; title: string }[];

export interface NutrientQuality {
  status: NutrientStatus;
  roundingInterval?: number;
  upperBound?: number;
  qualifier?: string;
}

export interface NutrientConflict {
  key: NutrientKey;
  values: Array<number | null>;
}

export interface NutrientWarning {
  level: 'info' | 'review' | 'warning';
  message: string;
  key?: string;
  code?: string;
}

export interface StagedNutrientRecord {
  values: Record<NutrientKey, number | null>;
  quality: Record<NutrientKey, NutrientQuality>;
  fiberMeaning: FiberMeaning;
  carbConvention: CarbConvention;
  conflicts: NutrientConflict[];
  unknownLabels: string[];
  warnings: NutrientWarning[];
}

export interface Observation {
  key: NutrientKey;
  value: number | null;
  quality?: NutrientQuality;
}

export function normalizeLabel(raw: string): string;
export function getNutrient(key: string): NutrientDef | undefined;
export function lookupLabel(rawLabel: string): { key: NutrientKey; via: 'exact' | 'legacy_alias' } | null;
export function targetableKeys(): NutrientKey[];
export function keysForGroup(group: string, since?: 1 | 2): NutrientKey[];
export function convertUnit(
  key: string,
  value: number,
  fromUnit: string,
): { value: number; unit: NutrientUnit } | { error: 'unsupported_unit' | 'nondefensible_conversion' };
export function checkPer100g(key: string, value: number): 'ok' | 'review' | 'reject';
export function checkPerUnit(key: string, value: number): 'ok' | 'reject';
export function emptyStagedRecord(): StagedNutrientRecord;
export function mergeObservations(observations: Observation[]): StagedNutrientRecord;
export function projectToV1(record: StagedNutrientRecord): {
  fields: Record<LegacyKey, number>;
  zeroFilled: LegacyKey[];
  droppedDetail: DetailKey[];
};
export function toV2Fields(record: StagedNutrientRecord): {
  fields: Record<NutrientKey, number | null>;
  nutrientSchemaVersion: 2;
  nutrientMeta: {
    registryVersion: 2;
    quality: Partial<Record<NutrientKey, NutrientQuality>>;
    fiberMeaning?: FiberMeaning;
    carbConvention?: CarbConvention;
  };
};
export function readNutrientFields(doc: unknown): StagedNutrientRecord;
