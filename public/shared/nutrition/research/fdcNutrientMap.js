import { V2_KEYS, getNutrient, convertUnit } from '../nutrientRegistry.js';
/**
 * @typedef {'exact' | 'convert' | 'gap'} FdcMappingPolicy
 * @typedef {{
 *   fdcNutrientId: number,
 *   nutrientNumber: string,
 *   key: import('../nutrientRegistry.js').NutrientKey,
 *   sourceUnit: string,
 *   policy: FdcMappingPolicy,
 *   gapReason?: string,
 *   note?: string
 * }} FdcNutrientMapping
 */
export const ENERGY_PREFERENCE_ORDER = Object.freeze([1008, 2048, 2047]);
/** @type {readonly FdcNutrientMapping[]} */
export const FDC_NUTRIENT_ENTRIES = Object.freeze([
    // Energy (preference: 1008, then 2048, then 2047)
    { fdcNutrientId: 1008, nutrientNumber: '208', key: 'calories', sourceUnit: 'kcal', policy: 'exact', note: 'Energy' },
    { fdcNutrientId: 2048, nutrientNumber: '268', key: 'calories', sourceUnit: 'kcal', policy: 'exact', note: 'Energy (Atwater general factors)' },
    // USDA nutrient number 957. Number 269 is total sugars (id 2000).
    { fdcNutrientId: 2047, nutrientNumber: '957', key: 'calories', sourceUnit: 'kcal', policy: 'exact', note: 'Energy (Atwater specific factors)' },
    // Macros & base components
    { fdcNutrientId: 1003, nutrientNumber: '203', key: 'protein', sourceUnit: 'g', policy: 'exact', note: 'Protein' },
    { fdcNutrientId: 1004, nutrientNumber: '204', key: 'fat', sourceUnit: 'g', policy: 'exact', note: 'Total lipid (fat)' },
    { fdcNutrientId: 1005, nutrientNumber: '205', key: 'carbs', sourceUnit: 'g', policy: 'exact', note: 'Carbohydrate, by difference' },
    { fdcNutrientId: 1051, nutrientNumber: '255', key: 'water', sourceUnit: 'g', policy: 'exact', note: 'Water' },
    { fdcNutrientId: 1018, nutrientNumber: '221', key: 'alcohol', sourceUnit: 'g', policy: 'exact', note: 'Alcohol, ethyl' },
    { fdcNutrientId: 1057, nutrientNumber: '262', key: 'caffeine', sourceUnit: 'mg', policy: 'exact', note: 'Caffeine' },
    { fdcNutrientId: 1253, nutrientNumber: '601', key: 'cholesterol', sourceUnit: 'mg', policy: 'exact', note: 'Cholesterol' },
    { fdcNutrientId: 1009, nutrientNumber: '209', key: 'starch', sourceUnit: 'g', policy: 'exact', note: 'Starch' },
    { fdcNutrientId: 2000, nutrientNumber: '269', key: 'sugarsTotal', sourceUnit: 'g', policy: 'exact', note: 'Sugars, total including NLEA' },
    { fdcNutrientId: 1235, nutrientNumber: '539', key: 'sugarsAdded', sourceUnit: 'g', policy: 'exact', note: 'Sugars, added' },
    { fdcNutrientId: 1213, nutrientNumber: '213', key: 'lactose', sourceUnit: 'g', policy: 'exact', note: 'Lactose' },
    // Fiber
    { fdcNutrientId: 1079, nutrientNumber: '291', key: 'fiberTotal', sourceUnit: 'g', policy: 'exact', note: 'Fiber, total dietary' },
    { fdcNutrientId: 1082, nutrientNumber: '295', key: 'fiberSoluble', sourceUnit: 'g', policy: 'exact', note: 'Fiber, soluble' },
    { fdcNutrientId: 1084, nutrientNumber: '297', key: 'fiberInsoluble', sourceUnit: 'g', policy: 'exact', note: 'Fiber, insoluble' },
    // Fat classes & fatty acids
    { fdcNutrientId: 1258, nutrientNumber: '606', key: 'fatSaturated', sourceUnit: 'g', policy: 'exact', note: 'Fatty acids, total saturated' },
    { fdcNutrientId: 1257, nutrientNumber: '605', key: 'fatTrans', sourceUnit: 'g', policy: 'exact', note: 'Fatty acids, total trans' },
    { fdcNutrientId: 1292, nutrientNumber: '645', key: 'fatMonounsaturated', sourceUnit: 'g', policy: 'exact', note: 'Fatty acids, total monounsaturated' },
    { fdcNutrientId: 1293, nutrientNumber: '646', key: 'fatPolyunsaturated', sourceUnit: 'g', policy: 'exact', note: 'Fatty acids, total polyunsaturated' },
    { fdcNutrientId: 1404, nutrientNumber: '851', key: 'omega3ALA', sourceUnit: 'g', policy: 'exact', note: '18:3 n-3 c,c,c (ALA)' },
    { fdcNutrientId: 1278, nutrientNumber: '629', key: 'omega3EPA', sourceUnit: 'g', policy: 'exact', note: '20:5 n-3 (EPA)' },
    { fdcNutrientId: 1272, nutrientNumber: '621', key: 'omega3DHA', sourceUnit: 'g', policy: 'exact', note: '22:6 n-3 (DHA)' },
    { fdcNutrientId: 1280, nutrientNumber: '631', key: 'omega3DPA', sourceUnit: 'g', policy: 'exact', note: '22:5 n-3 (DPA)' },
    // Minerals
    { fdcNutrientId: 1087, nutrientNumber: '301', key: 'calcium', sourceUnit: 'mg', policy: 'exact', note: 'Calcium, Ca' },
    { fdcNutrientId: 1089, nutrientNumber: '303', key: 'iron', sourceUnit: 'mg', policy: 'exact', note: 'Iron, Fe' },
    { fdcNutrientId: 1090, nutrientNumber: '304', key: 'magnesium', sourceUnit: 'mg', policy: 'exact', note: 'Magnesium, Mg' },
    { fdcNutrientId: 1091, nutrientNumber: '305', key: 'phosphorus', sourceUnit: 'mg', policy: 'exact', note: 'Phosphorus, P' },
    { fdcNutrientId: 1092, nutrientNumber: '306', key: 'potassium', sourceUnit: 'mg', policy: 'exact', note: 'Potassium, K' },
    { fdcNutrientId: 1093, nutrientNumber: '307', key: 'sodium', sourceUnit: 'mg', policy: 'exact', note: 'Sodium, Na' },
    { fdcNutrientId: 1095, nutrientNumber: '309', key: 'zinc', sourceUnit: 'mg', policy: 'exact', note: 'Zinc, Zn' },
    { fdcNutrientId: 1098, nutrientNumber: '312', key: 'copper', sourceUnit: 'mg', policy: 'exact', note: 'Copper, Cu' },
    { fdcNutrientId: 1101, nutrientNumber: '315', key: 'manganese', sourceUnit: 'mg', policy: 'exact', note: 'Manganese, Mn' },
    { fdcNutrientId: 1103, nutrientNumber: '317', key: 'selenium', sourceUnit: 'mcg', policy: 'exact', note: 'Selenium, Se' },
    { fdcNutrientId: 1100, nutrientNumber: '314', key: 'iodine', sourceUnit: 'mcg', policy: 'exact', note: 'Iodine, I' },
    // Vitamins
    { fdcNutrientId: 1162, nutrientNumber: '401', key: 'vitaminC', sourceUnit: 'mg', policy: 'exact', note: 'Vitamin C, total ascorbic acid' },
    { fdcNutrientId: 1165, nutrientNumber: '404', key: 'vitaminB1', sourceUnit: 'mg', policy: 'exact', note: 'Thiamin' },
    { fdcNutrientId: 1166, nutrientNumber: '405', key: 'vitaminB2', sourceUnit: 'mg', policy: 'exact', note: 'Riboflavin' },
    { fdcNutrientId: 1167, nutrientNumber: '406', key: 'vitaminB3', sourceUnit: 'mg', policy: 'exact', note: 'Niacin' },
    { fdcNutrientId: 1170, nutrientNumber: '410', key: 'vitaminB5', sourceUnit: 'mg', policy: 'exact', note: 'Pantothenic acid' },
    { fdcNutrientId: 1175, nutrientNumber: '415', key: 'vitaminB6', sourceUnit: 'mg', policy: 'exact', note: 'Vitamin B-6' },
    { fdcNutrientId: 1178, nutrientNumber: '418', key: 'vitaminB12', sourceUnit: 'mcg', policy: 'exact', note: 'Vitamin B-12' },
    { fdcNutrientId: 1176, nutrientNumber: '416', key: 'biotin', sourceUnit: 'mcg', policy: 'exact', note: 'Biotin' },
    { fdcNutrientId: 1180, nutrientNumber: '421', key: 'choline', sourceUnit: 'mg', policy: 'exact', note: 'Choline, total' },
    { fdcNutrientId: 1190, nutrientNumber: '435', key: 'folate', sourceUnit: 'mcg', policy: 'exact', note: 'Folate, DFE' },
    { fdcNutrientId: 1106, nutrientNumber: '320', key: 'vitaminA', sourceUnit: 'mcg', policy: 'exact', note: 'Vitamin A, RAE' },
    { fdcNutrientId: 1114, nutrientNumber: '328', key: 'vitaminD', sourceUnit: 'mcg', policy: 'exact', note: 'Vitamin D (D2 + D3)' },
    { fdcNutrientId: 1109, nutrientNumber: '323', key: 'vitaminE', sourceUnit: 'mg', policy: 'exact', note: 'Vitamin E (alpha-tocopherol)' },
    // Decision D11: Definition mismatches mapped to gaps
    { fdcNutrientId: 1177, nutrientNumber: '417', key: 'folate', sourceUnit: 'mcg', policy: 'gap', gapReason: 'definition_mismatch', note: 'Folate, total (not DFE)' },
    { fdcNutrientId: 1104, nutrientNumber: '318', key: 'vitaminA', sourceUnit: 'IU', policy: 'gap', gapReason: 'definition_mismatch', note: 'Vitamin A, IU' },
    { fdcNutrientId: 1185, nutrientNumber: '430', key: 'vitaminK', sourceUnit: 'mcg', policy: 'gap', gapReason: 'definition_mismatch', note: 'Vitamin K (phylloquinone only)' },
    { fdcNutrientId: 1270, nutrientNumber: '685', key: 'omega3ALA', sourceUnit: 'g', policy: 'gap', gapReason: 'definition_mismatch', note: '18:3 undifferentiated' },
]);
const BY_ID = new Map(FDC_NUTRIENT_ENTRIES.map(e => [e.fdcNutrientId, e]));
const BY_NUMBER = new Map(FDC_NUTRIENT_ENTRIES.map(e => [e.nutrientNumber, e]));
export function getFdcMapping(fdcNutrientId) {
    return BY_ID.get(Number(fdcNutrientId)) ?? null;
}
export function getFdcMappingByNumber(nutrientNumber) {
    return BY_NUMBER.get(String(nutrientNumber)) ?? null;
}
export function validateFdcNutrientMappings(entries = FDC_NUTRIENT_ENTRIES) {
    const errors = [];
    const seenNumbers = new Set();
    for (const entry of entries) {
        const number = String(entry.nutrientNumber);
        if (seenNumbers.has(number))
            errors.push(`Duplicate nutrient number ${number}`);
        seenNumbers.add(number);
        if (!V2_KEYS.includes(entry.key)) {
            errors.push(`Mapping ${entry.fdcNutrientId} targets unknown key: ${entry.key}`);
            continue;
        }
        const def = getNutrient(entry.key);
        if (!def) {
            errors.push(`Mapping ${entry.fdcNutrientId} missing nutrient definition: ${entry.key}`);
            continue;
        }
        if (entry.policy !== 'gap') {
            const res = convertUnit(entry.key, 1, entry.sourceUnit);
            if (res.error) {
                errors.push(`Mapping ${entry.fdcNutrientId} sourceUnit ${entry.sourceUnit} cannot convert to ${def.unit} for ${entry.key}: ${res.error}`);
            }
        }
    }
    return errors;
}
