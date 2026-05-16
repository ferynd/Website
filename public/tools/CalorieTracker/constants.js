/**
 * @file src/constants.js
 * @description Rolling 7-day balance system for calorie/macro target calculation
 */

// Day-level activity quick-select (replaces legacy trainingBump select).
// 'custom' means the user will log detailed sessions; bump = 0 from the level
// itself — sessions provide the actual calorie estimate.
export const DAY_ACTIVITY_LEVELS = {
  rest:   { label: 'Rest',   bump: 0,   description: 'No planned exercise' },
  light:  { label: 'Light',  bump: 100, description: 'Easy walk or gentle movement' },
  medium: { label: 'Medium', bump: 200, description: 'Moderate training ~45 min' },
  heavy:  { label: 'Heavy',  bump: 350, description: 'Intense or long session (>60 min)' },
  custom: { label: 'Custom', bump: 0,   description: 'Log sessions manually below' },
};

// Banking System Configuration
export const BANKING_CONFIG = {
  // Base parameters
  BASE_KCAL: 1450,
  PROTEIN_G: 150,
  FAT_FLOOR_G: 50,

  // Rolling balance window size (days)
  ROLLING_WINDOW_DAYS: 7,

  // Workout adjustments (training bump calories)
  TRAINING_BUMPS: {
    REST: 0,
    LIGHT_LIFT: 100, // 25-40g carbs * 4 kcal/g = 100-160 kcal
    HARD_LIFT: 280, // 50-90g carbs * 4 kcal/g = 200-360 kcal
    HIIT_ENDURANCE: 400 // 60-120g carbs * 4 kcal/g = 240-480 kcal
  }
};

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

  // Banking configuration
  fatMinimum: 50,

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

// FIXED: A map to normalize various text inputs into standardized nutrient keys
// Ordered from most specific to least specific to avoid conflicts
export const nutrientMap = {
  // Multi-word vitamin names (most specific first)
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
  
  // Multi-word omega names
  'omega-3': 'omega3',
  'omega 3': 'omega3',
  'omega-3 fatty acids': 'omega3',
  'omega 3 fatty acids': 'omega3',
  
  // Full nutrient names
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
  
  // Common abbreviations (avoid conflicts with units)
  'cal': 'calories',
  'kcal': 'calories',
  'prot': 'protein',
  'cho': 'carbs',
  'b12': 'vitaminB12',
  'b6': 'vitaminB6', 
  'b9': 'folate',
  'dha': 'omega3',
  'epa': 'omega3',
  
  // Chemical symbols (last to avoid conflicts)
  'fe': 'iron',
  'zn': 'zinc',
  'se': 'selenium',
  'na': 'sodium',
  'ca': 'calcium'
  
};

// =============================================================================
// SCHEMA VERSIONS
// Bump a version when the stored document shape changes in a non-backward-
// compatible way.  Documents without a schemaVersion field are treated as v0
// and normalized at read time by the functions in services/data.js.
// =============================================================================
export const SCHEMA_VERSIONS = {
  ENTRY: 2,    // daily entry documents (v1 pre-dates the schemaVersion field)
  PROFILE: 1,  // userProfile document
  GOAL: 1,     // goalSettings document
};

// Default shape for a new userProfile document.
// Every field is optional/nullable — an empty object is valid for a first-time
// user.  normalizeUserProfile() in services/data.js merges this at read time.
export const DEFAULT_USER_PROFILE = {
  schemaVersion: SCHEMA_VERSIONS.PROFILE,
  sex: null,                               // 'male' | 'female' | null
  birthDate: null,                         // 'YYYY-MM-DD' | null
  age: null,                               // numeric fallback when birthDate absent
  heightValue: null,                       // number
  heightUnit: 'in',                        // 'in' | 'cm'
  manualWeightOverrideLb: null,            // overrides uploaded weight when set
  manualWeightOverrideDate: null,          // 'YYYY-MM-DD' | null
  useUploadedWeightForCurrentWeight: true,
  bodyFatPercent: null,
  preferredWeighInStartMin: null,          // minutes from midnight
  preferredWeighInEndMin: null,
  baselineActivityLevel: null,             // 'sedentary'|'light'|'moderate'|'active'|'very_active'
};

// Default shape for a new goalSettings document.
// manualTargetOverrides is intentionally empty — only explicitly set keys are
// applied; it never silently wipes the user's baselineTargets.
// normalizeGoalSettings() in services/data.js merges this at read time.
export const DEFAULT_GOAL_SETTINGS = {
  schemaVersion: SCHEMA_VERSIONS.GOAL,
  goalType: 'maintenance',   // 'fatLoss'|'maintenance'|'recomp'|'muscleGain'|'performance'
  targetWeightLb: null,
  targetDate: null,          // 'YYYY-MM-DD' | null
  priority: 'maintenance',
  useRollingBanking: true,
  manualTargetOverrides: {}, // { [nutrientKey]: number } — sparse, never auto-populated
};

// Analysis horizons (in days) for multi-window TDEE estimates
export const ENERGY_HORIZONS = {
  QUICK: 14,
  PRIMARY: 28,
  STABILITY_1: 42,
  STABILITY_2: 56,
};

// Data sufficiency labels for confidence reporting
export const DATA_SUFFICIENCY = {
  NOT_ENOUGH: 'not_enough',
  ROUGH: 'rough',
  MODERATE: 'moderate',
  HIGH: 'high',
};

// Helper functions for banking calculations
export const BankingHelpers = {
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