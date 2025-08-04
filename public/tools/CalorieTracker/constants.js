/**
 * @file src/constants.js
 * @description UPDATED: Configurable safety caps and banking system parameters
 */

// Banking System Configuration (now fully configurable in settings)
export const BANKING_CONFIG = {
  // Base parameters
  BASE_KCAL: 1450,
  PROTEIN_G: 150,
  FAT_FLOOR_G: 50,
  
  // Banking algorithm parameters
  DECAY_HALF_LIFE_DAYS: 3.5,
  CORRECTION_DIVISOR: 3, // bank / 3 for raw correction
  
  // UPDATED: Configurable adaptive correction caps (based on bank size relative to base_kcal)
  CORRECTION_CAPS: {
    SMALL_BANK: { threshold: 1, cap: 0.15 }, // |bank| < 1x base_kcal → ±15%
    MEDIUM_BANK: { threshold: 2, cap: 0.30 }, // |bank| ≥ 1x base_kcal → ±30%
    LARGE_BANK: { threshold: Infinity, cap: 0.40 } // |bank| ≥ 2x base_kcal → ±40%
  },
  
  // Workout adjustments (training bump calories)
  TRAINING_BUMPS: {
    REST: 0,
    LIGHT_LIFT: 100, // 25-40g carbs * 4 kcal/g = 100-160 kcal
    HARD_LIFT: 280, // 50-90g carbs * 4 kcal/g = 200-360 kcal  
    HIIT_ENDURANCE: 400 // 60-120g carbs * 4 kcal/g = 240-480 kcal
  }
};

// Calculate decay factor: d = 0.5^(1/half_life)
export const DAILY_DECAY_FACTOR = Math.pow(0.5, 1 / BANKING_CONFIG.DECAY_HALF_LIFE_DAYS);

// Groups nutrients by tracking behavior (daily floors vs 7-day averages)
export const nutrients = {
  macros: ['calories', 'protein', 'carbs', 'fat'],
  
  // Daily floors - must meet target each day
  dailyFloors: ['fiber', 'potassium', 'magnesium', 'sodium', 'calcium', 'choline'],
  
  // Water-soluble vitamins - daily floors
  dailyVitamins: ['vitaminB12', 'folate', 'vitaminC', 'vitaminB6'],
  
  // Fat-soluble vitamins - 7-day rolling averages
  avgVitamins: ['vitaminA', 'vitaminD', 'vitaminE', 'vitaminK'],
  
  // Stored minerals - 7-day rolling averages  
  avgMinerals: ['selenium', 'iodine', 'phosphorus', 'iron', 'zinc'],
  
  // Optional nutrients - 7-day averages
  optional: ['omega3']
};

// A flattened array of all nutrient keys for easier iteration
export const allNutrients = [
  ...nutrients.macros,
  ...nutrients.dailyFloors,
  ...nutrients.dailyVitamins,
  ...nutrients.avgVitamins,
  ...nutrients.avgMinerals,
  ...nutrients.optional
];

// Nutrients that require daily floor tracking (not just averages)
export const dailyTrackedNutrients = [
  ...nutrients.dailyFloors,
  ...nutrients.dailyVitamins
];

// Nutrients that use 7-day rolling averages
export const averagedNutrients = [
  ...nutrients.avgVitamins,
  ...nutrients.avgMinerals,
  ...nutrients.optional
];

// Default micronutrient targets (user can override in settings)
export const DEFAULT_TARGETS = {
  // Macros (calculated dynamically by banking system)
  calories: 1450,
  protein: 150,
  carbs: 0, // calculated
  fat: 50,
  
  // Banking configuration - NEW: Now user-configurable
  fatMinimum: 50,
  smallBankCap: 15, // Small bank safety cap percentage
  mediumBankCap: 30, // Medium bank safety cap percentage  
  largeBankCap: 40, // Large bank safety cap percentage
  correctionDivisor: 3, // Bank to correction ratio
  decayHalfLife: 3.5, // Decay half-life in days
  
  // Daily floors
  fiber: 38,
  potassium: 3500,
  magnesium: 420,
  sodium: 2300,
  calcium: 1000,
  choline: 550,
  
  // Daily vitamins
  vitaminB12: 2.4,
  folate: 400,
  vitaminC: 90,
  vitaminB6: 1.3,
  
  // 7-day average vitamins
  vitaminA: 900,
  vitaminD: 15,
  vitaminE: 15,
  vitaminK: 120,
  
  // 7-day average minerals
  selenium: 55,
  iodine: 150,
  phosphorus: 700,
  iron: 8,
  zinc: 11,
  
  // Optional
  omega3: 1.6
};

// A map to normalize various text inputs into standardized nutrient keys
export const nutrientMap = {
  'calories': 'calories', 'cal': 'calories', 'kcal': 'calories',
  'protein': 'protein', 'prot': 'protein',
  'carbs': 'carbs', 'carbohydrate': 'carbs', 'carbohydrates': 'carbs',
  'fat': 'fat', 'fats': 'fat',
  'fiber': 'fiber', 'fibre': 'fiber',
  'potassium': 'potassium', 'k': 'potassium',
  'magnesium': 'magnesium', 'mg': 'magnesium',
  'sodium': 'sodium', 'na': 'sodium',
  'calcium': 'calcium', 'ca': 'calcium',
  'choline': 'choline',
  'vitamin d': 'vitaminD', 'vit d': 'vitaminD', 'd': 'vitaminD',
  'vitamin b12': 'vitaminB12', 'vit b12': 'vitaminB12', 'b12': 'vitaminB12',
  'folate': 'folate', 'b9': 'folate', 'folic acid': 'folate',
  'vitamin c': 'vitaminC', 'vit c': 'vitaminC', 'c': 'vitaminC',
  'vitamin b6': 'vitaminB6', 'vit b6': 'vitaminB6', 'b6': 'vitaminB6',
  'vitamin a': 'vitaminA', 'vit a': 'vitaminA', 'a': 'vitaminA',
  'vitamin e': 'vitaminE', 'vit e': 'vitaminE', 'e': 'vitaminE',
  'vitamin k': 'vitaminK', 'vit k': 'vitaminK', 'k': 'vitaminK',
  'iron': 'iron', 'fe': 'iron',
  'zinc': 'zinc', 'zn': 'zinc',
  'selenium': 'selenium', 'se': 'selenium',
  'iodine': 'iodine', 'i': 'iodine',
  'phosphorus': 'phosphorus', 'p': 'phosphorus',
  'omega-3': 'omega3', 'omega 3': 'omega3', 'dha': 'omega3', 'epa': 'omega3'
};

// Helper functions for banking calculations
export const BankingHelpers = {
  /**
   * Calculate daily decay factor from half-life
   * @param {number} halfLifeDays - Half-life in days
   * @returns {number} Daily decay factor
   */
  calculateDecayFactor: (halfLifeDays) => Math.pow(0.5, 1 / halfLifeDays),
  
  /**
   * UPDATED: Get correction cap percentage based on bank size (now uses user settings)
   * @param {number} bankSize - Absolute value of bank
   * @param {number} baseKcal - Base calorie target
   * @param {object} userTargets - User's baseline targets with safety cap settings
   * @returns {number} Cap percentage (default: 0.15, 0.30, or 0.40)
   */
  getCorrectionCap: (bankSize, baseKcal, userTargets = {}) => {
    const absBank = Math.abs(bankSize);
    
    // Use user-configured caps if available, otherwise use defaults
    const smallCap = (userTargets.smallBankCap || DEFAULT_TARGETS.smallBankCap) / 100;
    const mediumCap = (userTargets.mediumBankCap || DEFAULT_TARGETS.mediumBankCap) / 100;
    const largeCap = (userTargets.largeBankCap || DEFAULT_TARGETS.largeBankCap) / 100;
    
    if (absBank < 1 * baseKcal) {
      return smallCap;
    } else if (absBank < 2 * baseKcal) {
      return mediumCap;
    } else {
      return largeCap;
    }
  },
  
  /**
   * UPDATED: Get correction divisor (now user-configurable)
   * @param {object} userTargets - User's baseline targets
   * @returns {number} Correction divisor
   */
  getCorrectionDivisor: (userTargets = {}) => {
    return userTargets.correctionDivisor || DEFAULT_TARGETS.correctionDivisor;
  },
  
  /**
   * UPDATED: Get decay half-life (now user-configurable)
   * @param {object} userTargets - User's baseline targets  
   * @returns {number} Decay half-life in days
   */
  getDecayHalfLife: (userTargets = {}) => {
    return userTargets.decayHalfLife || DEFAULT_TARGETS.decayHalfLife;
  },
  
  /**
   * Round number to nearest 25
   * @param {number} value - Value to round
   * @returns {number} Rounded value
   */
  roundToNearest25: (value) => Math.round(value / 25) * 25,
  
  /**
   * Clamp value between min and max
   * @param {number} value - Value to clamp
   * @param {number} min - Minimum value
   * @param {number} max - Maximum value
   * @returns {number} Clamped value
   */
  clamp: (value, min, max) => Math.min(Math.max(value, min), max)
};