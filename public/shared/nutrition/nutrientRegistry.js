/**
 * Versioned nutrient registry shared by Calorie Tracker and Recipe Standardizer.
 * Version 1 is the historical 24-key contract. Version 2 appends detail keys.
 * Nothing in this module decides the write version; see capabilities.js.
 */

export const NUTRIENT_REGISTRY_VERSION = 2;

export const NUTRIENT_STATUSES = Object.freeze([
  'measured',
  'label_reported',
  'calculated',
  'estimated_from_comparable',
  'below_quantification_limit',
  'unknown',
  'not_applicable',
  'legacy_unclassified',
]);

/** Stored fiber meaning. workflow.md says "weighted"; this registry stores weighted_legacy. */
export const FIBER_MEANINGS = Object.freeze(['total', 'weighted_legacy', 'unknown']);

export const CARB_CONVENTIONS = Object.freeze(['includes_fiber', 'excludes_fiber', 'unknown']);

export const RESERVED_DOC_FIELDS = Object.freeze([
  'name', 'quantity', 'id', 'timestamp', 'lastUpdated',
  'nutrientMeta', 'nutrientSchemaVersion',
  'date', 'schemaVersion', 'entryType', 'exerciseSessions',
  'dayActivityLevel', 'vacationDayType', 'manualLock',
  'calorieAdjustmentItems', 'estimateMeta', 'foodItems',
  'notes', 'userId', 'targets', 'profile', 'weight', 'weightLb',
  'timeMin', 'source', 'createdAt', 'updatedAt', 'revision',
  'basis', 'coverage', 'fingerprint', 'nutritionFingerprint',
  'targetFingerprint', 'matchedName', 'foodItemId', 'gramsPerUnit',
  'assumptions', 'ingredientId', 'kind', 'items', 'observations',
  'registryVersion', 'quality', 'fiberMeaning', 'carbConvention',
]);

const LEGACY_ORDER = [
  'calories', 'protein', 'carbs', 'fat',
  'fiber', 'potassium', 'magnesium', 'sodium', 'calcium', 'choline',
  'vitaminB12', 'folate', 'vitaminC', 'vitaminB6',
  'vitaminA', 'vitaminD', 'vitaminE', 'vitaminK',
  'selenium', 'iodine', 'phosphorus', 'iron', 'zinc', 'omega3',
];

const DETAIL_ORDER = [
  'fatSaturated', 'fatTrans', 'fatMonounsaturated', 'fatPolyunsaturated',
  'omega3ALA', 'omega3EPA', 'omega3DHA', 'omega3DPA', 'omega6',
  'sugarsTotal', 'sugarsAdded', 'starch', 'allulose', 'sugarAlcoholsTotal',
  'erythritol', 'sorbitol', 'mannitol', 'isomalt', 'xylitol', 'glycerol', 'maltitol',
  'fiberTotal', 'fiberSoluble', 'fiberInsoluble', 'resistantStarch', 'fiberWeightedLegacy',
  'vitaminB1', 'vitaminB2', 'vitaminB3', 'vitaminB5', 'biotin',
  'copper', 'manganese', 'chromium', 'molybdenum', 'chloride',
  'cholesterol', 'alcohol', 'water', 'caffeine',
  'lactose', 'fructans', 'gos', 'excessFructose',
];

function hardMaxFor(unit) {
  if (unit === 'kcal') return 900;
  if (unit === 'g') return 100;
  if (unit === 'mg') return 100000;
  if (unit === 'mcg') return 100000000;
  throw new Error(`Unknown unit ${unit}`);
}

function bounds(unit, perUnitMax, reviewAbove) {
  const hardMax = hardMaxFor(unit);
  return {
    perUnit: { max: perUnitMax },
    per100g: { hardMax, reviewAbove: reviewAbove == null ? hardMax : reviewAbove },
  };
}

function entry(spec) {
  const labels = spec.labels.includes(spec.label) ? spec.labels : [spec.label, ...spec.labels];
  return {
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    group: spec.group,
    since: spec.since,
    parent: spec.parent,
    relation: spec.parent ? 'component' : undefined,
    labels,
    legacyAliases: spec.legacyAliases || [],
    bounds: bounds(spec.unit, spec.perUnitMax, spec.reviewAbove),
    targetRole: spec.targetRole,
    optional: Boolean(spec.optional),
    notes: spec.notes || '',
  };
}

function v1(spec) {
  return entry({ ...spec, since: 1 });
}

function v2(spec) {
  return entry({
    ...spec,
    since: 2,
    targetRole: 'none',
    perUnitMax: spec.perUnitMax == null ? hardMaxFor(spec.unit) : spec.perUnitMax,
  });
}

const DEFINITIONS = [
  v1({
    key: 'calories', label: 'Calories', unit: 'kcal', group: 'macros', targetRole: 'floor', perUnitMax: 10000,
    labels: ['Calories', 'Energy'],
    legacyAliases: ['calories', 'cal', 'kcal'],
  }),
  v1({
    key: 'protein', label: 'Protein', unit: 'g', group: 'macros', targetRole: 'floor', perUnitMax: 1000,
    labels: ['Protein'],
    legacyAliases: ['protein', 'prot'],
  }),
  v1({
    key: 'carbs', label: 'Carbs', unit: 'g', group: 'macros', targetRole: 'floor', perUnitMax: 1000,
    notes: 'total carbohydrate',
    labels: ['Carbs', 'Carbohydrate', 'Carbohydrates'],
    legacyAliases: ['carbohydrate', 'carbohydrates', 'carbs', 'cho'],
  }),
  v1({
    key: 'fat', label: 'Fat', unit: 'g', group: 'macros', targetRole: 'floor', perUnitMax: 1000,
    labels: ['Fat', 'Total Fat'],
    legacyAliases: ['fat', 'fats'],
  }),
  v1({
    key: 'fiber', label: 'Fiber', unit: 'g', group: 'dailyFloors', targetRole: 'floor', perUnitMax: 500,
    labels: ['Fiber', 'Fibre', 'Dietary fiber'],
    legacyAliases: ['fiber', 'fibre', 'dietary fiber'],
  }),
  v1({
    key: 'potassium', label: 'Potassium', unit: 'mg', group: 'dailyFloors', targetRole: 'floor', perUnitMax: 50000,
    reviewAbove: 60000,
    labels: ['Potassium'],
    legacyAliases: ['potassium'],
  }),
  v1({
    key: 'magnesium', label: 'Magnesium', unit: 'mg', group: 'dailyFloors', targetRole: 'floor', perUnitMax: 10000,
    labels: ['Magnesium'],
    legacyAliases: ['magnesium'],
  }),
  v1({
    key: 'sodium', label: 'Sodium', unit: 'mg', group: 'dailyFloors', targetRole: 'floor', perUnitMax: 23000,
    reviewAbove: 40000,
    labels: ['Sodium'],
    legacyAliases: ['sodium', 'na'],
  }),
  v1({
    key: 'calcium', label: 'Calcium', unit: 'mg', group: 'dailyFloors', targetRole: 'floor', perUnitMax: 25000,
    labels: ['Calcium'],
    legacyAliases: ['calcium', 'ca'],
  }),
  v1({
    key: 'choline', label: 'Choline', unit: 'mg', group: 'dailyFloors', targetRole: 'floor', perUnitMax: 35000,
    labels: ['Choline'],
    legacyAliases: ['choline'],
  }),
  v1({
    key: 'vitaminB12', label: 'Vitamin B12', unit: 'mcg', group: 'dailyVitamins', targetRole: 'floor', perUnitMax: 10000,
    labels: ['Vitamin B12', 'Vit B12', 'B12'],
    legacyAliases: ['vitamin b12', 'vit b12', 'b12'],
  }),
  v1({
    key: 'folate', label: 'Folate', unit: 'mcg', group: 'dailyVitamins', targetRole: 'floor', perUnitMax: 10000,
    notes: 'mcg DFE',
    labels: ['Folate', 'Vitamin B9', 'B9'],
    legacyAliases: ['folate', 'b9'],
  }),
  v1({
    key: 'vitaminC', label: 'Vitamin C', unit: 'mg', group: 'dailyVitamins', targetRole: 'floor', perUnitMax: 20000,
    labels: ['Vitamin C', 'Vit C'],
    legacyAliases: ['vitamin c', 'vit c'],
  }),
  v1({
    key: 'vitaminB6', label: 'Vitamin B6', unit: 'mg', group: 'dailyVitamins', targetRole: 'floor', perUnitMax: 1000,
    labels: ['Vitamin B6', 'Vit B6', 'B6'],
    legacyAliases: ['vitamin b6', 'vit b6', 'b6'],
  }),
  v1({
    key: 'vitaminA', label: 'Vitamin A', unit: 'mcg', group: 'avgVitamins', targetRole: 'average', perUnitMax: 30000,
    notes: 'mcg RAE',
    labels: ['Vitamin A', 'Vit A'],
    legacyAliases: ['vitamin a', 'vit a'],
  }),
  v1({
    key: 'vitaminD', label: 'Vitamin D', unit: 'mcg', group: 'avgVitamins', targetRole: 'average', perUnitMax: 1000,
    notes: 'not IU',
    labels: ['Vitamin D', 'Vit D'],
    legacyAliases: ['vitamin d', 'vit d'],
  }),
  v1({
    key: 'vitaminE', label: 'Vitamin E', unit: 'mg', group: 'avgVitamins', targetRole: 'average', perUnitMax: 10000,
    notes: 'alpha-tocopherol',
    labels: ['Vitamin E', 'Vit E'],
    legacyAliases: ['vitamin e', 'vit e'],
  }),
  v1({
    key: 'vitaminK', label: 'Vitamin K', unit: 'mcg', group: 'avgVitamins', targetRole: 'average', perUnitMax: 10000,
    labels: ['Vitamin K', 'Vit K'],
    legacyAliases: ['vitamin k', 'vit k'],
  }),
  v1({
    key: 'selenium', label: 'Selenium', unit: 'mcg', group: 'avgMinerals', targetRole: 'average', perUnitMax: 4000,
    labels: ['Selenium'],
    legacyAliases: ['selenium', 'se'],
  }),
  v1({
    key: 'iodine', label: 'Iodine', unit: 'mcg', group: 'avgMinerals', targetRole: 'average', perUnitMax: 11000,
    labels: ['Iodine'],
    legacyAliases: ['iodine'],
  }),
  v1({
    key: 'phosphorus', label: 'Phosphorus', unit: 'mg', group: 'avgMinerals', targetRole: 'average', perUnitMax: 40000,
    labels: ['Phosphorus'],
    legacyAliases: ['phosphorus'],
  }),
  v1({
    key: 'iron', label: 'Iron', unit: 'mg', group: 'avgMinerals', targetRole: 'average', perUnitMax: 450,
    reviewAbove: 100000,
    labels: ['Iron'],
    legacyAliases: ['iron', 'fe'],
  }),
  v1({
    key: 'zinc', label: 'Zinc', unit: 'mg', group: 'avgMinerals', targetRole: 'average', perUnitMax: 400,
    labels: ['Zinc'],
    legacyAliases: ['zinc', 'zn'],
  }),
  v1({
    key: 'omega3', label: 'Omega-3', unit: 'g', group: 'optional', targetRole: 'optional', perUnitMax: 100,
    notes: 'total ALA+EPA+DHA',
    labels: ['Omega-3', 'Omega 3', 'Total omega-3', 'Total omega 3', 'Omega-3 fatty acids', 'Omega 3 fatty acids'],
    legacyAliases: ['omega-3', 'omega 3', 'omega-3 fatty acids', 'omega 3 fatty acids'],
  }),

  v2({ key: 'fatSaturated', label: 'Saturated Fat', unit: 'g', group: 'fatClasses', parent: 'fat', labels: ['Saturated Fat', 'Saturated', 'Sat Fat'] }),
  v2({ key: 'fatTrans', label: 'Trans Fat', unit: 'g', group: 'fatClasses', parent: 'fat', labels: ['Trans Fat', 'Trans', 'Trans fatty acids'] }),
  v2({ key: 'fatMonounsaturated', label: 'Monounsaturated Fat', unit: 'g', group: 'fatClasses', parent: 'fat', labels: ['Monounsaturated Fat', 'Monounsaturated', 'MUFA'] }),
  v2({ key: 'fatPolyunsaturated', label: 'Polyunsaturated Fat', unit: 'g', group: 'fatClasses', parent: 'fat', labels: ['Polyunsaturated Fat', 'Polyunsaturated', 'PUFA'] }),
  v2({ key: 'omega3ALA', label: 'ALA', unit: 'g', group: 'fattyAcids', parent: 'omega3', labels: ['ALA', 'Omega-3 ALA', 'Alpha-linolenic acid'] }),
  v2({ key: 'omega3EPA', label: 'EPA', unit: 'g', group: 'fattyAcids', parent: 'omega3', labels: ['EPA', 'Omega-3 EPA', 'Eicosapentaenoic acid'] }),
  v2({ key: 'omega3DHA', label: 'DHA', unit: 'g', group: 'fattyAcids', parent: 'omega3', labels: ['DHA', 'Omega-3 DHA', 'Docosahexaenoic acid'] }),
  v2({ key: 'omega3DPA', label: 'DPA', unit: 'g', group: 'fattyAcids', parent: 'omega3', optional: true, labels: ['DPA', 'Omega-3 DPA'] }),
  v2({ key: 'omega6', label: 'Omega-6', unit: 'g', group: 'fattyAcids', labels: ['Omega-6', 'Omega 6'] }),
  v2({ key: 'sugarsTotal', label: 'Total Sugars', unit: 'g', group: 'sugars', labels: ['Total Sugars', 'Sugars', 'Sugars total'] }),
  v2({ key: 'sugarsAdded', label: 'Added Sugars', unit: 'g', group: 'sugars', labels: ['Added Sugars', 'Sugars added', 'Includes added sugars'] }),
  v2({ key: 'starch', label: 'Starch', unit: 'g', group: 'sugars', labels: ['Starch'] }),
  v2({ key: 'allulose', label: 'Allulose', unit: 'g', group: 'sugars', labels: ['Allulose'] }),
  v2({ key: 'sugarAlcoholsTotal', label: 'Sugar Alcohols', unit: 'g', group: 'polyols', labels: ['Sugar Alcohols', 'Total sugar alcohols', 'Sugar alcohols total'] }),
  v2({ key: 'erythritol', label: 'Erythritol', unit: 'g', group: 'polyols', labels: ['Erythritol'] }),
  v2({ key: 'sorbitol', label: 'Sorbitol', unit: 'g', group: 'polyols', labels: ['Sorbitol'] }),
  v2({ key: 'mannitol', label: 'Mannitol', unit: 'g', group: 'polyols', labels: ['Mannitol'] }),
  v2({ key: 'isomalt', label: 'Isomalt', unit: 'g', group: 'polyols', labels: ['Isomalt'] }),
  v2({ key: 'xylitol', label: 'Xylitol', unit: 'g', group: 'polyols', labels: ['Xylitol'] }),
  v2({ key: 'glycerol', label: 'Glycerol', unit: 'g', group: 'polyols', labels: ['Glycerol', 'Glycerin', 'Glycerine'] }),
  v2({ key: 'maltitol', label: 'Maltitol', unit: 'g', group: 'polyols', labels: ['Maltitol'] }),
  v2({ key: 'fiberTotal', label: 'Fiber (total dietary)', unit: 'g', group: 'fiberDetail', labels: ['Fiber (total dietary)', 'Total dietary fiber', 'Dietary fiber (total)'] }),
  v2({ key: 'fiberSoluble', label: 'Soluble Fiber', unit: 'g', group: 'fiberDetail', labels: ['Soluble Fiber', 'Soluble fibre'] }),
  v2({ key: 'fiberInsoluble', label: 'Insoluble Fiber', unit: 'g', group: 'fiberDetail', labels: ['Insoluble Fiber', 'Insoluble fibre'] }),
  v2({ key: 'resistantStarch', label: 'Resistant Starch', unit: 'g', group: 'fiberDetail', optional: true, labels: ['Resistant Starch'] }),
  v2({ key: 'fiberWeightedLegacy', label: 'Fiber (weighted, project)', unit: 'g', group: 'fiberDetail', labels: ['Fiber (weighted, project)', 'Weighted fiber', 'Fiber weighted legacy'] }),
  v2({ key: 'vitaminB1', label: 'Vitamin B1', unit: 'mg', group: 'extraVitamins', labels: ['Vitamin B1', 'Thiamin', 'Thiamine', 'Vit B1'] }),
  v2({ key: 'vitaminB2', label: 'Vitamin B2', unit: 'mg', group: 'extraVitamins', labels: ['Vitamin B2', 'Riboflavin', 'Vit B2'] }),
  v2({ key: 'vitaminB3', label: 'Vitamin B3', unit: 'mg', group: 'extraVitamins', labels: ['Vitamin B3', 'Niacin', 'Vit B3'] }),
  v2({ key: 'vitaminB5', label: 'Vitamin B5', unit: 'mg', group: 'extraVitamins', labels: ['Vitamin B5', 'Pantothenic acid', 'Vit B5'] }),
  v2({ key: 'biotin', label: 'Biotin', unit: 'mcg', group: 'extraVitamins', optional: true, labels: ['Biotin', 'Vitamin B7'] }),
  v2({ key: 'copper', label: 'Copper', unit: 'mg', group: 'extraMinerals', labels: ['Copper'] }),
  v2({ key: 'manganese', label: 'Manganese', unit: 'mg', group: 'extraMinerals', labels: ['Manganese'] }),
  v2({ key: 'chromium', label: 'Chromium', unit: 'mcg', group: 'extraMinerals', optional: true, labels: ['Chromium'] }),
  v2({ key: 'molybdenum', label: 'Molybdenum', unit: 'mcg', group: 'extraMinerals', optional: true, labels: ['Molybdenum'] }),
  v2({ key: 'chloride', label: 'Chloride', unit: 'mg', group: 'extraMinerals', optional: true, labels: ['Chloride'] }),
  v2({ key: 'cholesterol', label: 'Cholesterol', unit: 'mg', group: 'otherComponents', labels: ['Cholesterol'] }),
  v2({ key: 'alcohol', label: 'Alcohol', unit: 'g', group: 'otherComponents', labels: ['Alcohol', 'Ethanol'] }),
  v2({ key: 'water', label: 'Water', unit: 'g', group: 'otherComponents', labels: ['Water'] }),
  v2({ key: 'caffeine', label: 'Caffeine', unit: 'mg', group: 'otherComponents', optional: true, labels: ['Caffeine'] }),
  v2({ key: 'lactose', label: 'Lactose', unit: 'g', group: 'fodmap', labels: ['Lactose'] }),
  v2({ key: 'fructans', label: 'Fructans', unit: 'g', group: 'fodmap', labels: ['Fructans'] }),
  v2({ key: 'gos', label: 'GOS', unit: 'g', group: 'fodmap', labels: ['GOS', 'Galactooligosaccharides', 'Galacto-oligosaccharides'] }),
  v2({ key: 'excessFructose', label: 'Excess Fructose', unit: 'g', group: 'fodmap', optional: true, labels: ['Excess Fructose'] }),
];

function assertOrder(list, expected, name) {
  if (list.length !== expected.length || list.some((key, index) => key !== expected[index])) {
    throw new Error(`${name} drifted from the pinned order`);
  }
}

const definedKeys = DEFINITIONS.map((def) => def.key);
assertOrder(definedKeys.slice(0, LEGACY_ORDER.length), LEGACY_ORDER, 'LEGACY_V1_KEYS');
assertOrder(definedKeys.slice(LEGACY_ORDER.length), DETAIL_ORDER, 'V2_DETAIL_KEYS');

export const NUTRIENTS = Object.freeze(DEFINITIONS.map((def) => Object.freeze({ ...def, labels: Object.freeze([...def.labels]), legacyAliases: Object.freeze([...(def.legacyAliases || [])]) })));

export const LEGACY_V1_KEYS = Object.freeze(NUTRIENTS.filter((def) => def.since === 1).map((def) => def.key));
export const V2_KEYS = Object.freeze(NUTRIENTS.map((def) => def.key));
export const V2_DETAIL_KEYS = Object.freeze(V2_KEYS.filter((key) => !LEGACY_V1_KEYS.includes(key)));

export const FINGERPRINT_KEYSETS = Object.freeze({
  1: LEGACY_V1_KEYS,
  2: V2_KEYS,
});

export const V1_DISPLAY_GROUPS = Object.freeze([
  Object.freeze({ key: 'macros', title: 'Macronutrients' }),
  Object.freeze({ key: 'dailyFloors', title: 'Fiber, electrolytes & choline' }),
  Object.freeze({ key: 'dailyVitamins', title: 'Water-soluble vitamins' }),
  Object.freeze({ key: 'avgVitamins', title: 'Fat-soluble vitamins' }),
  Object.freeze({ key: 'avgMinerals', title: 'Minerals' }),
  Object.freeze({ key: 'optional', title: 'Other' }),
]);

const BY_KEY = new Map(NUTRIENTS.map((def) => [def.key, def]));
const EXACT_LABELS = new Map();
const ALIAS_LABELS = new Map();

export function normalizeLabel(raw) {
  let text = String(raw ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  text = text.replace(/^includes\s+/, '');
  text = text.replace(/\s*\((?:mg|g|mcg|µg|μg|iu|kj|kcal)\)\s*$/i, '').trim();
  return text;
}

function claim(map, raw, key, other) {
  const norm = normalizeLabel(raw);
  if (!norm) return;
  const previous = map.get(norm);
  if (previous && previous !== key) {
    throw new Error(`Label "${norm}" maps to both ${previous} and ${key}`);
  }
  if (other && other.get(norm) && other.get(norm) !== key) {
    throw new Error(`Label "${norm}" maps to both ${other.get(norm)} and ${key}`);
  }
  map.set(norm, key);
}

for (const def of NUTRIENTS) {
  for (const label of def.labels) claim(EXACT_LABELS, label, def.key, ALIAS_LABELS);
}
for (const def of NUTRIENTS) {
  for (const alias of def.legacyAliases) claim(ALIAS_LABELS, alias, def.key, EXACT_LABELS);
}

const RESERVED = new Set(RESERVED_DOC_FIELDS);
for (const key of V2_KEYS) {
  if (RESERVED.has(key)) throw new Error(`Nutrient key ${key} collides with a reserved document field`);
}

export function getNutrient(key) {
  return BY_KEY.get(key);
}

export function lookupLabel(rawLabel) {
  const norm = normalizeLabel(rawLabel);
  if (!norm) return null;
  if (EXACT_LABELS.has(norm)) return { key: EXACT_LABELS.get(norm), via: 'exact' };
  if (ALIAS_LABELS.has(norm)) return { key: ALIAS_LABELS.get(norm), via: 'legacy_alias' };
  return null;
}

export function targetableKeys() {
  return NUTRIENTS.filter((def) => def.targetRole !== 'none').map((def) => def.key);
}

export function keysForGroup(group, since) {
  return NUTRIENTS.filter((def) => def.group === group && (since == null || def.since === since)).map((def) => def.key);
}

const MASS_SCALE = { g: 1, mg: 1e-3, mcg: 1e-6 };

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function normalizeUnit(raw) {
  const text = String(raw ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (text === 'µg' || text === 'μg' || text === 'ug') return 'mcg';
  if (text === 'folic acid' || text === 'folic_acid') return 'folic_acid';
  if (text === 'grams' || text === 'gram') return 'g';
  if (text === 'milligrams' || text === 'milligram') return 'mg';
  if (text === 'micrograms' || text === 'microgram') return 'mcg';
  return text;
}

export function convertUnit(key, value, fromUnit) {
  const def = getNutrient(key);
  if (!def || typeof value !== 'number' || !Number.isFinite(value)) return { error: 'unsupported_unit' };
  const from = normalizeUnit(fromUnit);
  if (!from) return { error: 'unsupported_unit' };
  if (from === 'folic_acid') return { error: 'nondefensible_conversion' };
  if (from === 'iu') {
    if (key === 'vitaminD') return { value: round6(value * 0.025), unit: 'mcg' };
    if (key === 'vitaminA' || key === 'vitaminE') return { error: 'nondefensible_conversion' };
    return { error: 'unsupported_unit' };
  }
  if (from === 'kj') {
    if (def.unit !== 'kcal') return { error: 'unsupported_unit' };
    return { value: round6(value * 0.239006), unit: 'kcal' };
  }
  if (from === 'kcal' || from === 'cal') {
    if (def.unit !== 'kcal') return { error: 'unsupported_unit' };
    return { value: round6(value), unit: 'kcal' };
  }
  const fromScale = MASS_SCALE[from];
  const toScale = MASS_SCALE[def.unit];
  if (fromScale == null || toScale == null) return { error: 'unsupported_unit' };
  return { value: round6((value * fromScale) / toScale), unit: def.unit };
}

export function checkPer100g(key, value) {
  const def = getNutrient(key);
  if (!def || typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'reject';
  if (value > def.bounds.per100g.hardMax) return 'reject';
  if (value > def.bounds.per100g.reviewAbove) return 'review';
  return 'ok';
}

export function checkPerUnit(key, value) {
  const def = getNutrient(key);
  if (!def || typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'reject';
  if (value > def.bounds.perUnit.max) return 'reject';
  return 'ok';
}

function blankQuality() {
  return { status: 'unknown' };
}

export function emptyStagedRecord() {
  const values = {};
  const quality = {};
  for (const key of V2_KEYS) {
    values[key] = null;
    quality[key] = blankQuality();
  }
  return {
    values,
    quality,
    fiberMeaning: 'unknown',
    carbConvention: 'unknown',
    conflicts: [],
    unknownLabels: [],
    warnings: [],
  };
}

function sameObserved(left, right) {
  if (left == null && right == null) return true;
  return typeof left === 'number' && typeof right === 'number' && left === right;
}

export function mergeObservations(observations) {
  const record = emptyStagedRecord();
  const grouped = new Map();
  for (const observation of observations || []) {
    if (!BY_KEY.has(observation.key)) continue;
    const list = grouped.get(observation.key) || [];
    list.push(observation);
    grouped.set(observation.key, list);
  }
  for (const [key, list] of grouped) {
    const first = list[0].value == null ? null : list[0].value;
    const equal = list.every((item) => sameObserved(item.value == null ? null : item.value, first));
    if (!equal) {
      record.conflicts.push({ key, values: list.map((item) => (item.value == null ? null : item.value)) });
      record.values[key] = null;
      record.quality[key] = blankQuality();
      continue;
    }
    record.values[key] = first;
    record.quality[key] = { ...(list[0].quality || { status: 'label_reported' }) };
  }
  return record;
}

function meaningfulQuality(quality) {
  if (!quality) return false;
  if (quality.status && quality.status !== 'unknown') return true;
  return quality.roundingInterval != null || quality.upperBound != null;
}

export function projectToV1(record) {
  const fields = {};
  const zeroFilled = [];
  for (const key of LEGACY_V1_KEYS) {
    const value = record?.values?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) fields[key] = value;
    else {
      fields[key] = 0;
      zeroFilled.push(key);
    }
  }
  const droppedDetail = V2_DETAIL_KEYS.filter((key) => {
    const value = record?.values?.[key];
    return (typeof value === 'number' && Number.isFinite(value)) || meaningfulQuality(record?.quality?.[key]);
  });
  return { fields, zeroFilled, droppedDetail };
}

function sparseQuality(quality) {
  if (!quality) return undefined;
  const copy = { status: quality.status || 'unknown' };
  if (quality.roundingInterval != null) copy.roundingInterval = quality.roundingInterval;
  if (quality.upperBound != null) copy.upperBound = quality.upperBound;
  if (quality.qualifier) copy.qualifier = quality.qualifier;
  if (copy.status === 'unknown' && copy.roundingInterval == null && copy.upperBound == null && !copy.qualifier) {
    return undefined;
  }
  return copy;
}

export function toV2Fields(record) {
  const fields = {};
  const quality = {};
  for (const key of V2_KEYS) {
    const value = record?.values?.[key];
    fields[key] = typeof value === 'number' && Number.isFinite(value) ? value : null;
    const sparse = sparseQuality(record?.quality?.[key]);
    if (sparse) quality[key] = sparse;
  }
  const nutrientMeta = { registryVersion: NUTRIENT_REGISTRY_VERSION, quality };
  if (record?.fiberMeaning && record.fiberMeaning !== 'unknown') nutrientMeta.fiberMeaning = record.fiberMeaning;
  if (record?.carbConvention && record.carbConvention !== 'unknown') nutrientMeta.carbConvention = record.carbConvention;
  return { fields, nutrientSchemaVersion: 2, nutrientMeta };
}

function readFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function statusAllowed(status) {
  return NUTRIENT_STATUSES.includes(status);
}

export function readNutrientFields(doc) {
  const record = emptyStagedRecord();
  if (!doc || typeof doc !== 'object') return record;
  const version = Number(doc.nutrientSchemaVersion);
  if (version === 2) {
    const meta = doc.nutrientMeta && typeof doc.nutrientMeta === 'object' ? doc.nutrientMeta : {};
    if (FIBER_MEANINGS.includes(meta.fiberMeaning)) record.fiberMeaning = meta.fiberMeaning;
    if (CARB_CONVENTIONS.includes(meta.carbConvention)) record.carbConvention = meta.carbConvention;
    const storedQuality = meta.quality && typeof meta.quality === 'object' ? meta.quality : {};
    for (const key of V2_KEYS) {
      if (Object.prototype.hasOwnProperty.call(doc, key) && doc[key] === null) record.values[key] = null;
      else if (Object.prototype.hasOwnProperty.call(doc, key)) record.values[key] = readFinite(doc[key]);
      const raw = storedQuality[key];
      if (raw && typeof raw === 'object' && statusAllowed(raw.status)) {
        record.quality[key] = {
          status: raw.status,
          ...(raw.roundingInterval != null ? { roundingInterval: raw.roundingInterval } : {}),
          ...(raw.upperBound != null ? { upperBound: raw.upperBound } : {}),
          ...(raw.qualifier ? { qualifier: raw.qualifier } : {}),
        };
      }
    }
    return record;
  }
  for (const key of LEGACY_V1_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(doc, key) || doc[key] == null || doc[key] === '') continue;
    const number = readFinite(doc[key]);
    if (number == null) continue;
    record.values[key] = number;
    record.quality[key] = { status: 'legacy_unclassified' };
  }
  return record;
}
