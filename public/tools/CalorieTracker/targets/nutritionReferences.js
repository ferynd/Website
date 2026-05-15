/**
 * @file targets/nutritionReferences.js
 * Pure reference data: DRI/NASEM values, UL limits, BMR equations, PAL multipliers.
 * No Firebase, no DOM, no state mutations.
 */

// ---------------------------------------------------------------------------
// Age band resolution
// ---------------------------------------------------------------------------

const AGE_BANDS = [
  { min: 14, max: 18, label: '14-18' },
  { min: 19, max: 30, label: '19-30' },
  { min: 31, max: 50, label: '31-50' },
  { min: 51, max: 70, label: '51-70' },
  { min: 71, max: Infinity, label: '71+' },
];

/**
 * Map a numeric age to its DRI age band label.
 * @param {number} age
 * @returns {string}
 */
export function getAgeBand(age) {
  const band = AGE_BANDS.find(b => age >= b.min && age <= b.max);
  return band ? band.label : '19-30';
}

// ---------------------------------------------------------------------------
// DRI reference table (NASEM 2019-2023)
// Values: RDA where one exists, AI otherwise.
// Units match the app tracking units (g, mg, mcg as used in constants.js).
// ---------------------------------------------------------------------------

const DRI_TABLE = {
  fiber: {
    '14-18': { male: 38, female: 26 },
    '19-30': { male: 38, female: 25 },
    '31-50': { male: 38, female: 25 },
    '51-70': { male: 30, female: 21 },
    '71+':   { male: 30, female: 21 },
  },
  potassium: {
    '14-18': { male: 3000, female: 2300 },
    '19-30': { male: 3400, female: 2600 },
    '31-50': { male: 3400, female: 2600 },
    '51-70': { male: 3400, female: 2600 },
    '71+':   { male: 3400, female: 2600 },
  },
  magnesium: {
    '14-18': { male: 410, female: 360 },
    '19-30': { male: 400, female: 310 },
    '31-50': { male: 420, female: 320 },
    '51-70': { male: 420, female: 320 },
    '71+':   { male: 420, female: 320 },
  },
  sodium: {
    '14-18': { male: 2300, female: 2300 },
    '19-30': { male: 2300, female: 2300 },
    '31-50': { male: 2300, female: 2300 },
    '51-70': { male: 2300, female: 2300 },
    '71+':   { male: 2300, female: 2300 },
  },
  calcium: {
    '14-18': { male: 1300, female: 1300 },
    '19-30': { male: 1000, female: 1000 },
    '31-50': { male: 1000, female: 1000 },
    '51-70': { male: 1000, female: 1200 },
    '71+':   { male: 1200, female: 1200 },
  },
  choline: {
    '14-18': { male: 550, female: 400 },
    '19-30': { male: 550, female: 425 },
    '31-50': { male: 550, female: 425 },
    '51-70': { male: 550, female: 425 },
    '71+':   { male: 550, female: 425 },
  },
  vitaminB12: {
    '14-18': { male: 2.4, female: 2.4 },
    '19-30': { male: 2.4, female: 2.4 },
    '31-50': { male: 2.4, female: 2.4 },
    '51-70': { male: 2.4, female: 2.4 },
    '71+':   { male: 2.4, female: 2.4 },
  },
  folate: {
    '14-18': { male: 400, female: 400 },
    '19-30': { male: 400, female: 400 },
    '31-50': { male: 400, female: 400 },
    '51-70': { male: 400, female: 400 },
    '71+':   { male: 400, female: 400 },
  },
  vitaminC: {
    '14-18': { male: 75,  female: 65 },
    '19-30': { male: 90,  female: 75 },
    '31-50': { male: 90,  female: 75 },
    '51-70': { male: 90,  female: 75 },
    '71+':   { male: 90,  female: 75 },
  },
  vitaminB6: {
    '14-18': { male: 1.3, female: 1.2 },
    '19-30': { male: 1.3, female: 1.3 },
    '31-50': { male: 1.3, female: 1.3 },
    '51-70': { male: 1.7, female: 1.5 },
    '71+':   { male: 1.7, female: 1.5 },
  },
  vitaminA: {
    '14-18': { male: 900, female: 700 },
    '19-30': { male: 900, female: 700 },
    '31-50': { male: 900, female: 700 },
    '51-70': { male: 900, female: 700 },
    '71+':   { male: 900, female: 700 },
  },
  vitaminD: {
    '14-18': { male: 15, female: 15 },
    '19-30': { male: 15, female: 15 },
    '31-50': { male: 15, female: 15 },
    '51-70': { male: 15, female: 15 },
    '71+':   { male: 20, female: 20 },
  },
  vitaminE: {
    '14-18': { male: 15, female: 15 },
    '19-30': { male: 15, female: 15 },
    '31-50': { male: 15, female: 15 },
    '51-70': { male: 15, female: 15 },
    '71+':   { male: 15, female: 15 },
  },
  vitaminK: {
    '14-18': { male: 75,  female: 75 },
    '19-30': { male: 120, female: 90 },
    '31-50': { male: 120, female: 90 },
    '51-70': { male: 120, female: 90 },
    '71+':   { male: 120, female: 90 },
  },
  selenium: {
    '14-18': { male: 55, female: 55 },
    '19-30': { male: 55, female: 55 },
    '31-50': { male: 55, female: 55 },
    '51-70': { male: 55, female: 55 },
    '71+':   { male: 55, female: 55 },
  },
  iodine: {
    '14-18': { male: 150, female: 150 },
    '19-30': { male: 150, female: 150 },
    '31-50': { male: 150, female: 150 },
    '51-70': { male: 150, female: 150 },
    '71+':   { male: 150, female: 150 },
  },
  phosphorus: {
    '14-18': { male: 1250, female: 1250 },
    '19-30': { male: 700,  female: 700  },
    '31-50': { male: 700,  female: 700  },
    '51-70': { male: 700,  female: 700  },
    '71+':   { male: 700,  female: 700  },
  },
  iron: {
    '14-18': { male: 11, female: 15 },
    '19-30': { male: 8,  female: 18 },
    '31-50': { male: 8,  female: 18 },
    '51-70': { male: 8,  female: 8  },
    '71+':   { male: 8,  female: 8  },
  },
  zinc: {
    '14-18': { male: 11, female: 9 },
    '19-30': { male: 11, female: 8 },
    '31-50': { male: 11, female: 8 },
    '51-70': { male: 11, female: 8 },
    '71+':   { male: 11, female: 8 },
  },
  omega3: {
    '14-18': { male: 1.6, female: 1.1 },
    '19-30': { male: 1.6, female: 1.1 },
    '31-50': { male: 1.6, female: 1.1 },
    '51-70': { male: 1.6, female: 1.1 },
    '71+':   { male: 1.6, female: 1.1 },
  },
};

// ---------------------------------------------------------------------------
// Tolerable Upper Intake Levels (null = no established UL from NASEM)
// ---------------------------------------------------------------------------

export const UL_TABLE = {
  vitaminA:    3000,  // mcg RAE
  vitaminD:    100,   // mcg
  vitaminE:    1000,  // mg
  vitaminK:    null,
  vitaminC:    2000,  // mg
  vitaminB6:   100,   // mg
  folate:      1000,  // mcg (synthetic/supplemental)
  vitaminB12:  null,
  calcium:     2500,  // mg
  iron:        45,    // mg
  zinc:        40,    // mg
  selenium:    400,   // mcg
  iodine:      1100,  // mcg
  magnesium:   null,  // no UL for dietary magnesium
  sodium:      2300,  // mg (CDRR)
  phosphorus:  4000,  // mg
  choline:     3500,  // mg
  fiber:       null,
  potassium:   null,
  omega3:      null,
};

// ---------------------------------------------------------------------------
// Public DRI lookup
// ---------------------------------------------------------------------------

/**
 * Look up DRI and UL for a nutrient key, age, and sex.
 * Falls back to '19-30' band and 'male' sex if values are missing.
 *
 * @param {string} nutrientKey
 * @param {number} age - numeric age in years
 * @param {'male'|'female'|null} sex
 * @returns {{ rda: number, ul: number|null } | null}
 */
export function getDRI(nutrientKey, age, sex) {
  const table = DRI_TABLE[nutrientKey];
  if (!table) return null;
  const band = getAgeBand(age ?? 30);
  const row = table[band] ?? table['19-30'];
  if (!row) return null;
  const effectiveSex = sex === 'female' ? 'female' : 'male';
  return {
    rda: row[effectiveSex],
    ul: UL_TABLE[nutrientKey] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Activity level PAL multipliers
// ---------------------------------------------------------------------------

export const PAL_MULTIPLIERS = {
  sedentary:   1.20,
  light:       1.375,
  moderate:    1.55,
  active:      1.725,
  very_active: 1.90,
};

export const ACTIVITY_LABELS = {
  sedentary:   'Sedentary (desk job, minimal movement)',
  light:       'Lightly active (1-3 days/week)',
  moderate:    'Moderately active (3-5 days/week)',
  active:      'Active (6-7 days/week hard exercise)',
  very_active: 'Very active (physical job or 2× daily training)',
};

// ---------------------------------------------------------------------------
// BMR / RMR equations
// ---------------------------------------------------------------------------

/**
 * Mifflin-St Jeor RMR (kcal/day). Reference: Mifflin et al., 1990.
 * @param {number} weight_kg
 * @param {number} height_cm
 * @param {number} age
 * @param {'male'|'female'} sex
 * @returns {number}
 */
export function mifflinStJeor(weight_kg, height_cm, age, sex) {
  const base = (10 * weight_kg) + (6.25 * height_cm) - (5 * age);
  return sex === 'female' ? base - 161 : base + 5;
}

/**
 * Cunningham RMR (kcal/day). Reference: Cunningham, 1991.
 * @param {number} ffm_kg - fat-free (lean) mass in kg
 * @returns {number}
 */
export function cunningham(ffm_kg) {
  return 500 + (22 * ffm_kg);
}

/**
 * Katch-McArdle BMR (kcal/day). Reference: McArdle et al., 1986.
 * @param {number} ffm_kg
 * @returns {number}
 */
export function katchMcArdle(ffm_kg) {
  return 370 + (21.6 * ffm_kg);
}
