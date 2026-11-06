import { describe, expect, it } from 'vitest';
import { parseNutritionText } from '../../../shared/nutrition/nutrientText.js';

const CHAT_BLOCK = [
  'Calories: 165 kcal',
  'Protein: 31 g',
  'Carbohydrates: 0 g',
  'Fat: 3.6 g',
  'Fiber: 0 g',
  'Potassium: 256 mg',
  'Magnesium: 29 mg',
  'Sodium: 74 mg',
  'Calcium: 15 mg',
  'Choline: 82.1 mg',
  'Vitamin B12: 0.3 mcg',
  'Folate: 4 mcg',
  'Vitamin C: 0 mg',
  'Vitamin B6: 0.6 mg',
  'Vitamin A: 6 mcg',
  'Vitamin D: 0.1 mcg',
  'Vitamin E: 0.3 mg',
  'Vitamin K: 0.3 mcg',
  'Selenium: 22.5 mcg',
  'Iodine: 0 mcg',
  'Phosphorus: 210 mg',
  'Iron: 0.9 mg',
  'Zinc: 1 mg',
  'Omega-3: 0.05 g',
].join('\n');

const CHAT_VALUES = {
  calories: 165,
  protein: 31,
  carbs: 0,
  fat: 3.6,
  fiber: 0,
  potassium: 256,
  magnesium: 29,
  sodium: 74,
  calcium: 15,
  choline: 82.1,
  vitaminB12: 0.3,
  folate: 4,
  vitaminC: 0,
  vitaminB6: 0.6,
  vitaminA: 6,
  vitaminD: 0.1,
  vitaminE: 0.3,
  vitaminK: 0.3,
  selenium: 22.5,
  iodine: 0,
  phosphorus: 210,
  iron: 0.9,
  zinc: 1,
  omega3: 0.05,
};

describe('parseNutritionText', () => {
  it('Saturated Fat maps to fatSaturated and never overwrites fat (either line order)', () => {
    const first = parseNutritionText('Saturated Fat: 3 g\nFat: 10 g');
    expect(first.values.fatSaturated).toBe(3);
    expect(first.values.fat).toBe(10);
    const second = parseNutritionText('Fat: 10 g\nSaturated Fat: 3 g');
    expect(second.values.fatSaturated).toBe(3);
    expect(second.values.fat).toBe(10);
  });

  it('Trans, Monounsaturated and Polyunsaturated map to fat subtypes', () => {
    const record = parseNutritionText('Trans Fat: 0 g\nMonounsaturated Fat: 4 g\nPolyunsaturated: 2 g');
    expect(record.values.fatTrans).toBe(0);
    expect(record.values.fatMonounsaturated).toBe(4);
    expect(record.values.fatPolyunsaturated).toBe(2);
    expect(record.values.fat).toBeNull();
  });

  it('EPA and DHA lines map to components and leave omega3 unknown', () => {
    const record = parseNutritionText('EPA: 0.15 g\nDHA: 0.2 g');
    expect(record.values.omega3EPA).toBe(0.15);
    expect(record.values.omega3DHA).toBe(0.2);
    expect(record.values.omega3).toBeNull();
  });

  it('Total omega-3 maps to omega3', () => {
    expect(parseNutritionText('Total omega-3: 1.2 g').values.omega3).toBe(1.2);
  });

  it('fat-soluble, sodium-free and other substring words do not match', () => {
    const record = parseNutritionText('fat-soluble vitamins: 5 mg\nsodium-free seasoning: 0 mg');
    expect(record.values.fat).toBeNull();
    expect(record.values.sodium).toBeNull();
    expect(record.unknownLabels).toEqual(['fat-soluble vitamins', 'sodium-free seasoning']);
  });

  it('unknown label with a number yields an unknownLabels warning', () => {
    const record = parseNutritionText('Unicorn dust: 4 mg');
    expect(record.unknownLabels).toEqual(['Unicorn dust']);
    expect(record.warnings.some((warning) => warning.code === 'unknown_label')).toBe(true);
    expect(record.values.calories).toBeNull();
  });

  it('equal duplicate values merge; unequal duplicates yield a conflict', () => {
    const merged = parseNutritionText('Protein: 10 g\nProtein: 10 g');
    expect(merged.values.protein).toBe(10);
    expect(merged.conflicts).toEqual([]);
    const conflict = parseNutritionText('Protein: 10 g\nProtein: 11 g');
    expect(conflict.values.protein).toBeNull();
    expect(conflict.conflicts).toEqual([{ key: 'protein', values: [10, 11] }]);
  });

  it('legacy 24-field chat block parses to the same values as the pre-#60 parser', () => {
    const record = parseNutritionText(CHAT_BLOCK);
    for (const [key, value] of Object.entries(CHAT_VALUES)) {
      expect(record.values[key]).toBe(value);
    }
    expect(record.values.fatSaturated).toBeNull();
  });

  it('absent fields stay null, not zero', () => {
    const record = parseNutritionText('Protein: 10 g');
    expect(record.values.protein).toBe(10);
    expect(record.values.calories).toBeNull();
    expect(record.values.fat).toBeNull();
  });

  it('label "0 g" is label_reported with rounding interval; "<1 g" is null with upperBound 1', () => {
    const zero = parseNutritionText('Fiber: 0 g');
    expect(zero.values.fiber).toBe(0);
    expect(zero.quality.fiber.status).toBe('label_reported');
    expect(zero.quality.fiber.roundingInterval).toBe(1);
    const bounded = parseNutritionText('Protein: <1 g');
    expect(bounded.values.protein).toBeNull();
    expect(bounded.quality.protein).toMatchObject({ status: 'label_reported', upperBound: 1 });
  });

  it('Fiber/Dietary fiber stage legacy fiber with meaning unknown; explicit total/weighted labels classify', () => {
    const legacy = parseNutritionText('Fiber: 4 g\nDietary fiber: 4 g');
    expect(legacy.values.fiber).toBe(4);
    expect(legacy.fiberMeaning).toBe('unknown');
    const total = parseNutritionText('Fiber (total dietary): 8 g');
    expect(total.values.fiberTotal).toBe(8);
    expect(total.values.fiber).toBeNull();
    expect(total.fiberMeaning).toBe('total');
    const weighted = parseNutritionText('Fiber (weighted, project): 5 g');
    expect(weighted.values.fiberWeightedLegacy).toBe(5);
    expect(weighted.fiberMeaning).toBe('weighted_legacy');
    const both = parseNutritionText('Fiber (total dietary): 8 g\nFiber: 4 g');
    expect(both.fiberMeaning).toBe('total');
    expect(both.values.fiber).toBe(4);
  });

  it('ranges and negative values are flagged for review', () => {
    const record = parseNutritionText('Fat: 1-2 g\nSodium: -5 mg');
    expect(record.values.fat).toBeNull();
    expect(record.values.sodium).toBeNull();
    expect(record.warnings.some((warning) => warning.code === 'range' && warning.level === 'review')).toBe(true);
    expect(record.warnings.some((warning) => warning.code === 'negative' && warning.level === 'review')).toBe(true);
  });

  it('parses leading decimals and does not turn a signed leading decimal positive', () => {
    const record = parseNutritionText('Protein: .5 g\nFat: -.5 g\nSodium: .25 mg\nVitamin B12: .5 mcg');
    expect(record.values.protein).toBe(0.5);
    expect(record.values.protein).not.toBe(5);
    expect(record.values.sodium).toBe(0.25);
    expect(record.values.vitaminB12).toBe(0.5);
    expect(record.values.fat).toBeNull();
    expect(record.warnings.some((warning) => warning.code === 'negative' && warning.key === 'fat')).toBe(true);
    const colonless = parseNutritionText('Protein .5 g');
    expect(colonless.values.protein).toBe(0.5);
    const bounded = parseNutritionText('Protein: <.5 g');
    expect(bounded.values.protein).toBeNull();
    expect(bounded.quality.protein).toMatchObject({ status: 'label_reported', upperBound: 0.5 });
    const range = parseNutritionText('Carbs: .5-.8 g\nFiber: .5 to 1 g');
    expect(range.values.carbs).toBeNull();
    expect(range.values.fiber).toBeNull();
    expect(range.warnings.filter((warning) => warning.code === 'range')).toHaveLength(2);
    expect(parseNutritionText('Protein: 5 g').values.protein).toBe(5);
    expect(parseNutritionText('Protein: 1,234.5 g').values.protein).toBe(1234.5);
  });

  it('colonless labels keep the whole nutrient name, including B12, B6 and omega-3', () => {
    const record = parseNutritionText([
      'Vitamin B12 2.4 mcg',
      'Vitamin  B12   2.4 mcg',
      'Vitamin B6 1.2 mg',
      'Omega-3 1.5 g',
    ].join('\n'));
    expect(record.values.vitaminB12).toBe(2.4);
    expect(record.values.vitaminB6).toBe(1.2);
    expect(record.values.omega3).toBe(1.5);
    expect(record.unknownLabels).toEqual([]);
    expect(record.conflicts).toEqual([]);
  });

  it('colonless unknown labels and hyphenated non-labels stay out of the matched nutrient', () => {
    const record = parseNutritionText([
      'Unicorn dust 4 mg',
      'fat-soluble vitamins 5 mg',
      'sodium-free seasoning 0 mg',
    ].join('\n'));
    expect(record.values.fat).toBeNull();
    expect(record.values.sodium).toBeNull();
    expect(record.unknownLabels).toEqual([
      'Unicorn dust',
      'fat-soluble vitamins',
      'sodium-free seasoning',
    ]);
  });

  it('folic acid and vitamin A/E IU are nondefensible and do not set a value', () => {
    const record = parseNutritionText('Folic acid: 200 mcg\nVitamin A: 5000 IU\nVitamin E: 30 IU\nVitamin D: 40 IU');
    expect(record.values.folate).toBeNull();
    expect(record.values.vitaminA).toBeNull();
    expect(record.values.vitaminE).toBeNull();
    expect(record.values.vitaminD).toBe(1);
    expect(record.warnings.filter((warning) => warning.code === 'nondefensible_conversion')).toHaveLength(3);
  });
});
