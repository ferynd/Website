import { describe, expect, it } from 'vitest';
import { convertUnit, getNutrient, V2_KEYS } from '../../../shared/nutrition/nutrientRegistry.js';
import { parseNutritionText } from '../../../shared/nutrition/nutrientText.js';

const KJ_1000 = convertUnit('calories', 1000, 'kJ').value;

/**
 * One line in, one expected outcome.
 * A parsed line is { key, value, unit } plus optional status.
 * A review line is { key, code } and stores nothing.
 * 'unknown' stores nothing and reports the label.
 */
const LINES = [
  // The tracker's own 24-line chat block, one line each.
  ['Calories: 165 kcal', { key: 'calories', value: 165, unit: 'kcal' }],
  ['Protein: 31 g', { key: 'protein', value: 31, unit: 'g' }],
  ['Carbohydrates: 0 g', { key: 'carbs', value: 0, unit: 'g' }],
  ['Fat: 3.6 g', { key: 'fat', value: 3.6, unit: 'g' }],
  ['Fiber: 0 g', { key: 'fiber', value: 0, unit: 'g' }],
  ['Potassium: 256 mg', { key: 'potassium', value: 256, unit: 'mg' }],
  ['Magnesium: 29 mg', { key: 'magnesium', value: 29, unit: 'mg' }],
  ['Sodium: 74 mg', { key: 'sodium', value: 74, unit: 'mg' }],
  ['Calcium: 15 mg', { key: 'calcium', value: 15, unit: 'mg' }],
  ['Choline: 82.1 mg', { key: 'choline', value: 82.1, unit: 'mg' }],
  ['Vitamin B12: 0.3 mcg', { key: 'vitaminB12', value: 0.3, unit: 'mcg' }],
  ['Folate: 4 mcg', { key: 'folate', value: 4, unit: 'mcg' }],
  ['Vitamin C: 0 mg', { key: 'vitaminC', value: 0, unit: 'mg' }],
  ['Vitamin B6: 0.6 mg', { key: 'vitaminB6', value: 0.6, unit: 'mg' }],
  ['Vitamin A: 6 mcg', { key: 'vitaminA', value: 6, unit: 'mcg' }],
  ['Vitamin D: 0.1 mcg', { key: 'vitaminD', value: 0.1, unit: 'mcg' }],
  ['Vitamin E: 0.3 mg', { key: 'vitaminE', value: 0.3, unit: 'mg' }],
  ['Vitamin K: 0.3 mcg', { key: 'vitaminK', value: 0.3, unit: 'mcg' }],
  ['Selenium: 22.5 mcg', { key: 'selenium', value: 22.5, unit: 'mcg' }],
  ['Iodine: 0 mcg', { key: 'iodine', value: 0, unit: 'mcg' }],
  ['Phosphorus: 210 mg', { key: 'phosphorus', value: 210, unit: 'mg' }],
  ['Iron: 0.9 mg', { key: 'iron', value: 0.9, unit: 'mg' }],
  ['Zinc: 1 mg', { key: 'zinc', value: 1, unit: 'mg' }],
  ['Omega-3: 0.05 g', { key: 'omega3', value: 0.05, unit: 'g' }],

  // Round 4 label lines, with and without a colon.
  ['Total Carbohydrate: 30g', { key: 'carbs', value: 30, unit: 'g' }],
  ['Total Carbohydrate 30 g', { key: 'carbs', value: 30, unit: 'g' }],
  ['Total Carbohydrates: 27g', { key: 'carbs', value: 27, unit: 'g' }],
  ['Total Carbohydrates 27 g', { key: 'carbs', value: 27, unit: 'g' }],
  ['Total Calories: 200 kcal', { key: 'calories', value: 200, unit: 'kcal' }],
  ['Total Calories 180 kcal', { key: 'calories', value: 180, unit: 'kcal' }],
  ['Carbohydrate, by difference: 25 g', { key: 'carbs', value: 25, unit: 'g' }],
  ['Carbohydrate, by difference 25 g', { key: 'carbs', value: 25, unit: 'g' }],
  ['Fat, total: 10 g', { key: 'fat', value: 10, unit: 'g' }],
  ['Fat, total 10 g', { key: 'fat', value: 10, unit: 'g' }],
  ['Fiber, total dietary: 4 g', { key: 'fiber', value: 4, unit: 'g' }],
  ['Fiber, total dietary 4 g', { key: 'fiber', value: 4, unit: 'g' }],
  ['Vitamin A (RAE): 6 mcg', { key: 'vitaminA', value: 6, unit: 'mcg' }],
  ['Vitamin A (RAE) 6 mcg', { key: 'vitaminA', value: 6, unit: 'mcg' }],
  ['Vitamin A, RAE: 9 mcg', { key: 'vitaminA', value: 9, unit: 'mcg' }],
  ['Vitamin A, RAE 9 mcg', { key: 'vitaminA', value: 9, unit: 'mcg' }],
  ['Folate (DFE): 40 mcg', { key: 'folate', value: 40, unit: 'mcg' }],
  ['Folate (DFE) 40 mcg', { key: 'folate', value: 40, unit: 'mcg' }],
  ['Sodium (Na): 74 mg', { key: 'sodium', value: 74, unit: 'mg' }],
  ['Sodium (Na) 74 mg', { key: 'sodium', value: 74, unit: 'mg' }],
  ['Iron (Fe): 2 mg', { key: 'iron', value: 2, unit: 'mg' }],
  ['Iron (Fe) 2 mg', { key: 'iron', value: 2, unit: 'mg' }],
  ['Vitamin E (alpha-tocopherol): 1.1 mg', { key: 'vitaminE', value: 1.1, unit: 'mg' }],
  ['Vitamin E (alpha-tocopherol) 1.1 mg', { key: 'vitaminE', value: 1.1, unit: 'mg' }],
  ['| Protein | 25 g |', { key: 'protein', value: 25, unit: 'g' }],
  ['| Total Carbohydrate | 30 g |', { key: 'carbs', value: 30, unit: 'g' }],
  ['Iron: 2 mg (10-15% DV)', { key: 'iron', value: 2, unit: 'mg' }],
  ['Iron 3 mg (10-15% DV)', { key: 'iron', value: 3, unit: 'mg' }],
  ['Calories from Fat: 70 kcal', 'unknown'],
  ['Calories from Fat 70 kcal', 'unknown'],
  ['Net Carbs: 8 g', 'unknown'],
  ['Net Carbs 8 g', 'unknown'],
  ['EPA + DHA: 0.5 g', 'unknown'],
  ['EPA + DHA 0.5 g', 'unknown'],
  ['Omega-3 (EPA + DHA): 0.5 g', 'unknown'],
  ['Omega-3 (EPA + DHA) 0.5 g', 'unknown'],

  // Round 5. Longest label wins; a code does not absorb the next digit.
  ['Vitamin B12 (mcg) 2.4', { key: 'vitaminB12', value: 2.4, unit: 'mcg' }],
  ['Vitamin B12 (as methylcobalamin) 500 mcg', { key: 'vitaminB12', value: 500, unit: 'mcg' }],
  ['Vitamin B12 2.4 mcg', { key: 'vitaminB12', value: 2.4, unit: 'mcg' }],
  ['Vitamin  B12   2.4 mcg', { key: 'vitaminB12', value: 2.4, unit: 'mcg' }],
  ['Vitamin B6 1.2 mg', { key: 'vitaminB6', value: 1.2, unit: 'mg' }],
  ['Vitamin B1 1.2 mg', { key: 'vitaminB1', value: 1.2, unit: 'mg' }],
  ['Vitamin D3 10 mcg', { key: 'vitaminD', value: 10, unit: 'mcg' }],
  ['Vitamin K2 100 mcg', { key: 'vitaminK', value: 100, unit: 'mcg' }],
  ['D3 10 mcg', { key: 'vitaminD', value: 10, unit: 'mcg' }],
  ['K2 100 mcg', { key: 'vitaminK', value: 100, unit: 'mcg' }],
  ['Cholecalciferol 10 mcg', { key: 'vitaminD', value: 10, unit: 'mcg' }],
  ['Menaquinone 100 mcg', { key: 'vitaminK', value: 100, unit: 'mcg' }],
  ['Vitamin D2 10 mcg', 'unknown'],
  ['Vitamin K1 80 mcg', 'unknown'],
  ['Vitamin B123 4 mcg', 'unknown'],

  // Separators between the label and the value.
  ['Protein - 25g', { key: 'protein', value: 25, unit: 'g' }],
  ['Protein — 25 g', { key: 'protein', value: 25, unit: 'g' }],
  ['Protein – 25 g', { key: 'protein', value: 25, unit: 'g' }],
  ['Protein = 25 g', { key: 'protein', value: 25, unit: 'g' }],
  ['Protein: 25 g', { key: 'protein', value: 25, unit: 'g' }],
  ['Protein approx 25 g', { key: 'protein', value: 25, unit: 'g', status: 'estimated_from_comparable' }],
  ['Protein about 25 g', { key: 'protein', value: 25, unit: 'g', status: 'estimated_from_comparable' }],
  ['Protein ~ 25 g', { key: 'protein', value: 25, unit: 'g', status: 'estimated_from_comparable' }],

  // "(as …)" is a form note. A parenthetical that names another nutrient is not.
  ['Vitamin C (as ascorbic acid) 60 mg', { key: 'vitaminC', value: 60, unit: 'mg' }],
  ['Vitamin C (as ascorbic acid): 60 mg', { key: 'vitaminC', value: 60, unit: 'mg' }],
  ['Zinc (as zinc oxide) 11 mg', { key: 'zinc', value: 11, unit: 'mg' }],
  ['Zinc (as zinc oxide): 11 mg', { key: 'zinc', value: 11, unit: 'mg' }],
  ['Saturated Fat (fat) 3 g', 'unknown'],
  ['Saturated Fat (fat): 3 g', 'unknown'],
  ['EPA (omega-3) 0.2 g', 'unknown'],
  ['EPA (omega-3): 0.2 g', 'unknown'],
  ['Fat, saturated: 3 g', { key: 'fatSaturated', value: 3, unit: 'g' }],
  ['Fat, saturated 3 g', { key: 'fatSaturated', value: 3, unit: 'g' }],
  ['Omega-3 (ALA): 0.4 g', { key: 'omega3ALA', value: 0.4, unit: 'g' }],
  ['Omega-3 (ALA) 0.2 g', { key: 'omega3ALA', value: 0.2, unit: 'g' }],
  ['Saturated Fat: 3 g', { key: 'fatSaturated', value: 3, unit: 'g' }],
  ['EPA: 0.15 g', { key: 'omega3EPA', value: 0.15, unit: 'g' }],
  ['DHA: 0.2 g', { key: 'omega3DHA', value: 0.2, unit: 'g' }],
  ['Total omega-3: 1.2 g', { key: 'omega3', value: 1.2, unit: 'g' }],
  ['Fiber (total dietary): 8 g', { key: 'fiberTotal', value: 8, unit: 'g' }],
  ['Fiber (total dietary) 8 g', { key: 'fiberTotal', value: 8, unit: 'g' }],

  // A unit in the label is used when the value has none, and a disagreement is review.
  ['Energy (kJ): 1000', { key: 'calories', value: KJ_1000, unit: 'kcal' }],
  ['Energy (kJ): 1000 kJ', { key: 'calories', value: KJ_1000, unit: 'kcal' }],
  ['Energy: 1000 kJ', { key: 'calories', value: KJ_1000, unit: 'kcal' }],
  ['Energy (kcal): 1000', { key: 'calories', value: 1000, unit: 'kcal' }],
  ['Sodium (g): 1.2', { key: 'sodium', value: 1200, unit: 'mg' }],
  ['Sodium (g): 1.2 g', { key: 'sodium', value: 1200, unit: 'mg' }],
  ['Sodium (mg): 1.2', { key: 'sodium', value: 1.2, unit: 'mg' }],
  ['Vitamin A (IU): 5000', { key: 'vitaminA', code: 'nondefensible_conversion' }],
  ['Vitamin A: 5000 IU', { key: 'vitaminA', code: 'nondefensible_conversion' }],
  ['Vitamin E: 30 IU', { key: 'vitaminE', code: 'nondefensible_conversion' }],
  ['Vitamin E (IU): 30', { key: 'vitaminE', code: 'nondefensible_conversion' }],
  ['Folic acid: 200 mcg', { key: 'folate', code: 'nondefensible_conversion' }],
  ['Folic acid (DFE): 200 mcg', { key: 'folate', code: 'nondefensible_conversion' }],
  ['Vitamin D: 40 IU', { key: 'vitaminD', value: 1, unit: 'mcg' }],
  ['Vitamin D (IU): 40', { key: 'vitaminD', value: 1, unit: 'mcg' }],
  ['Sodium (g): 1.2 mg', { key: 'sodium', code: 'unit_mismatch' }],
  ['Sodium (mg): 1.2 g', { key: 'sodium', code: 'unit_mismatch' }],
  ['Energy (kJ): 1000 kcal', { key: 'calories', code: 'unit_mismatch' }],
  ['Vitamin A (IU): 5000 mcg', { key: 'vitaminA', code: 'unit_mismatch' }],
  ['Vitamin A (mcg): 5000 IU', { key: 'vitaminA', code: 'unit_mismatch' }],

  // US "Includes" added-sugars line, including the % DV tail.
  ['Includes 10g Added Sugars', { key: 'sugarsAdded', value: 10, unit: 'g' }],
  ['Includes 10g Added Sugars 20%', { key: 'sugarsAdded', value: 10, unit: 'g' }],
  ['Includes 10 g Added Sugars 20% DV', { key: 'sugarsAdded', value: 10, unit: 'g' }],
  ['Includes added sugars: 10 g', { key: 'sugarsAdded', value: 10, unit: 'g' }],
  ['Includes added sugars 10 g', { key: 'sugarsAdded', value: 10, unit: 'g' }],

  // Shapes that already parsed: no substring match, leading decimals, ranges on the first token only.
  ['fat-soluble vitamins: 5 mg', 'unknown'],
  ['fat-soluble vitamins 5 mg', 'unknown'],
  ['sodium-free seasoning: 0 mg', 'unknown'],
  ['sodium-free seasoning 0 mg', 'unknown'],
  ['Unicorn dust: 4 mg', 'unknown'],
  ['Unicorn dust 4 mg', 'unknown'],
  ['Protein: .5 g', { key: 'protein', value: 0.5, unit: 'g' }],
  ['Protein .5 g', { key: 'protein', value: 0.5, unit: 'g' }],
  ['Protein: 1,234.5 g', { key: 'protein', value: 1234.5, unit: 'g' }],
  ['Protein: <1 g', { key: 'protein', upperBound: 1, unit: 'g' }],
  ['Protein: <.5 g', { key: 'protein', upperBound: 0.5, unit: 'g' }],
  ['Fat: 1-2 g', { key: 'fat', code: 'range' }],
  ['Carbs: .5-.8 g', { key: 'carbs', code: 'range' }],
  ['Fiber: .5 to 1 g', { key: 'fiber', code: 'range' }],
  ['Sodium: -5 mg', { key: 'sodium', code: 'negative' }],
  ['Fat: -.5 g', { key: 'fat', code: 'negative' }],
  ['Fat: ~3 g', { key: 'fat', value: 3, unit: 'g', status: 'estimated_from_comparable' }],
  ['Omega-3 1.5 g', { key: 'omega3', value: 1.5, unit: 'g' }],
];

function observedKeys(record) {
  return V2_KEYS.filter((key) => record.values[key] != null || record.quality[key]?.upperBound != null);
}

function assertLine(line, expected) {
  const record = parseNutritionText(line);
  const observed = observedKeys(record);
  if (expected === 'unknown') {
    expect({ line, observed, unknown: record.unknownLabels.length > 0 }).toEqual({
      line, observed: [], unknown: true,
    });
    return;
  }
  if (expected.code) {
    const codes = record.warnings.filter((warning) => warning.code === expected.code && warning.key === expected.key);
    expect({ line, observed, codes: codes.length, unknown: record.unknownLabels }).toEqual({
      line, observed: [], codes: 1, unknown: [],
    });
    expect(record.values[expected.key]).toBeNull();
    return;
  }
  if (expected.upperBound != null) {
    expect({
      line,
      observed,
      value: record.values[expected.key],
      upperBound: record.quality[expected.key]?.upperBound,
      status: record.quality[expected.key]?.status,
      unit: getNutrient(expected.key)?.unit,
    }).toEqual({
      line,
      observed: [expected.key],
      value: null,
      upperBound: expected.upperBound,
      status: 'label_reported',
      unit: expected.unit,
    });
    return;
  }
  expect({
    line,
    observed,
    value: record.values[expected.key],
    status: record.quality[expected.key]?.status,
    unit: getNutrient(expected.key)?.unit,
    unknown: record.unknownLabels,
  }).toEqual({
    line,
    observed: [expected.key],
    value: expected.value,
    status: expected.status || 'label_reported',
    unit: expected.unit,
    unknown: [],
  });
}

describe('paste line golden', () => {
  it('maps every review and chat-block line to one nutrient, a review status, or unknown', () => {
    expect(KJ_1000).toBeCloseTo(239, 0);
    expect(KJ_1000).not.toBe(1000);
    expect(LINES.length).toBeGreaterThanOrEqual(24 + 40);
    for (const [line, expected] of LINES) assertLine(line, expected);
  });
});
