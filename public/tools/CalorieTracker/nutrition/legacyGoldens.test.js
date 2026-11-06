/**
 * Pins the pre-#60 paste behavior and does not import the live parser.
 * The frozen loop below is the nutrientMap walk that shipped before #60,
 * including substring matches this registry deliberately removes.
 */
import { describe, expect, it } from 'vitest';

const PRE_60_NUTRIENT_MAP = {
  'vitamin b12': 'vitaminB12',
  'vit b12': 'vitaminB12',
  'vitamin b6': 'vitaminB6',
  'vit b6': 'vitaminB6',
  'vitamin a': 'vitaminA',
  'vit a': 'vitaminA',
  'vitamin c': 'vitaminC',
  'vit c': 'vitaminC',
  'vitamin d': 'vitaminD',
  'vit d': 'vitaminD',
  'vitamin e': 'vitaminE',
  'vit e': 'vitaminE',
  'vitamin k': 'vitaminK',
  'vit k': 'vitaminK',
  'omega-3': 'omega3',
  'omega 3': 'omega3',
  'omega-3 fatty acids': 'omega3',
  'omega 3 fatty acids': 'omega3',
  'calories': 'calories',
  'protein': 'protein',
  'carbohydrate': 'carbs',
  'carbohydrates': 'carbs',
  'carbs': 'carbs',
  'fat': 'fat',
  'fats': 'fat',
  'fiber': 'fiber',
  'fibre': 'fiber',
  'dietary fiber': 'fiber',
  'potassium': 'potassium',
  'magnesium': 'magnesium',
  'sodium': 'sodium',
  'calcium': 'calcium',
  'choline': 'choline',
  'folate': 'folate',
  'folic acid': 'folate',
  'iron': 'iron',
  'zinc': 'zinc',
  'selenium': 'selenium',
  'iodine': 'iodine',
  'phosphorus': 'phosphorus',
  'cal': 'calories',
  'kcal': 'calories',
  'prot': 'protein',
  'cho': 'carbs',
  'b12': 'vitaminB12',
  'b6': 'vitaminB6',
  'b9': 'folate',
  'dha': 'omega3',
  'epa': 'omega3',
  'fe': 'iron',
  'zn': 'zinc',
  'se': 'selenium',
  'na': 'sodium',
  'ca': 'calcium',
};

/** Replay of staging/parser.js parseAndStage before anchored labels. */
function parsePre60(text) {
  const found = {};
  for (const line of String(text).split('\n')) {
    const lowerLine = line.toLowerCase();
    for (const key of Object.keys(PRE_60_NUTRIENT_MAP)) {
      const re = new RegExp(`\\b${key}\\b`, 'i');
      if (!re.test(lowerLine)) continue;
      const numberString = lowerLine.replace(re, '').replace(/(mg|mcg|g|kcal)/gi, '').replace(/,/g, '');
      const match = numberString.match(/-?[\d.]+/);
      if (!match) continue;
      found[PRE_60_NUTRIENT_MAP[key]] = parseFloat(match[0]);
      break;
    }
  }
  return found;
}

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

describe('pre-#60 parser goldens', () => {
  it('legacy 24-field chat block parses to the pinned pre-#60 numbers', () => {
    expect(parsePre60(CHAT_BLOCK)).toEqual({
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
    });
  });

  it('pins the pre-#60 substring and alias collisions', () => {
    expect(parsePre60('Saturated Fat: 3 g\nFat: 10 g')).toEqual({ fat: 10 });
    expect(parsePre60('Fat: 10 g\nSaturated Fat: 3 g')).toEqual({ fat: 3 });
    expect(parsePre60('DHA: 0.2 g')).toEqual({ omega3: 0.2 });
    expect(parsePre60('EPA: 0.15 g')).toEqual({ omega3: 0.15 });
    expect(parsePre60('Folic acid: 200 mcg')).toEqual({ folate: 200 });
    expect(parsePre60('fat-soluble vitamins: 5 mg')).toEqual({ fat: 5 });
    expect(parsePre60('sodium-free seasoning: 0 mg')).toEqual({ sodium: 0 });
    expect(parsePre60('Total omega-3: 1.2 g')).toEqual({ omega3: 1.2 });
  });
});
