/**
 * @file src/constants.js
 * @description Defines constant data structures for nutrients.
 * This includes nutrient groupings and a map for parsing text.
 */

// Groups nutrients by category for UI rendering and calculation logic.
export const nutrients = {
  macros: ['calories', 'protein', 'carbs', 'fat'],
  vitaminsDaily: ['vitaminB12', 'folate', 'vitaminC', 'vitaminB6'],
  vitaminsAvg: ['vitaminA', 'vitaminD', 'vitaminE', 'vitaminK'],
  mineralsDaily: ['iron', 'calcium', 'magnesium', 'zinc', 'potassium', 'sodium'],
  mineralsAvg: ['selenium', 'iodine', 'phosphorus'],
  optional: ['omega3', 'fiber', 'choline'],
};

// A flattened array of all nutrient keys for easier iteration.
export const allNutrients = [
  ...nutrients.macros,
  ...nutrients.vitaminsDaily,
  ...nutrients.vitaminsAvg,
  ...nutrients.mineralsDaily,
  ...nutrients.mineralsAvg,
  ...nutrients.optional,
];

// A specific list of nutrients whose targets are tracked daily rather than averaged.
export const dailyTrackedNutrients = ['protein', ...nutrients.vitaminsDaily, ...nutrients.mineralsDaily];

// A map to normalize various text inputs into standardized nutrient keys.
// Used for parsing pasted logs. Keys are lowercase for case-insensitive matching.
export const nutrientMap = {
  'calories': 'calories', 'cal': 'calories',
  'protein': 'protein', 'prot': 'protein',
  'carbs': 'carbs', 'carbohydrate': 'carbs',
  'fat': 'fat',
  'vitamin d': 'vitaminD', 'vit d': 'vitaminD',
  'vitamin b12': 'vitaminB12', 'vit b12': 'vitaminB12', 'b12': 'vitaminB12',
  'folate': 'folate', 'b9': 'folate',
  'vitamin c': 'vitaminC', 'vit c': 'vitaminC',
  'vitamin b6': 'vitaminB6', 'vit b6': 'vitaminB6', 'b6': 'vitaminB6',
  'vitamin a': 'vitaminA', 'vit a': 'vitaminA',
  'vitamin e': 'vitaminE', 'vit e': 'vitaminE',
  'vitamin k': 'vitaminK', 'vit k': 'vitaminK',
  'iron': 'iron',
  'calcium': 'calcium',
  'magnesium': 'magnesium',
  'zinc': 'zinc',
  'potassium': 'potassium',
  'sodium': 'sodium',
  'selenium': 'selenium',
  'iodine': 'iodine',
  'phosphorus': 'phosphorus',
  'omega-3': 'omega3', 'omega 3': 'omega3',
  'fiber': 'fiber',
  'choline': 'choline',
};
