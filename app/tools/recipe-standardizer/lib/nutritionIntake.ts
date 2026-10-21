/* Nutrition Tracker intake prompt and pasted JSON parsing. */

import { TRACKER_NUTRIENT_KEYS, type TrackerNutrientKey } from './trackerFoods';

/* CONFIGURATION: nutrition intake contract */
/** Intake payload kind accepted by this tool. */
export const NUTRITION_INTAKE_KIND = 'recipe-nutrition';
/** Current intake payload schema version. */
export const NUTRITION_INTAKE_SCHEMA_VERSION = 1;
/** Required basis for every supplied nutrient value. */
export const NUTRITION_INTAKE_BASIS = 'per-100g';
/** Maximum number of nutrition rows accepted in one payload. */
export const MAX_INTAKE_ITEMS = 100;
/** Maximum stored length for a row's assumptions text. */
export const MAX_ASSUMPTIONS_LENGTH = 300;
/** Macro mass threshold used to flag implausible per-100 g values. */
export const MACRO_MASS_TOLERANCE_G = 105;

/** Unit used for a nutrient in the intake prompt and review. */
export type NutrientUnit = 'kcal' | 'g' | 'mg' | 'mcg';

/** Prompt and validation settings for one tracked nutrient. */
export interface NutrientIntakeSpec {
  label: string;
  unit: NutrientUnit;
  promptNote: string;
  max: number;
  trackerCap: boolean;
}

const spec = (
  label: string,
  unit: NutrientUnit,
  max: number,
  promptNote = '',
  trackerCap = false,
): NutrientIntakeSpec => ({ label, unit, max, promptNote, trackerCap });

/** Validation settings for all Nutrition Tracker nutrient keys. */
export const NUTRIENT_INTAKE_SPEC: Record<TrackerNutrientKey, NutrientIntakeSpec> = {
  calories: spec('Calories', 'kcal', 900),
  protein: spec('Protein', 'g', 100),
  carbs: spec('Carbs', 'g', 100, 'total carbohydrate'),
  fat: spec('Fat', 'g', 100),
  fiber: spec('Fiber', 'g', 100),
  potassium: spec('Potassium', 'mg', 20000),
  magnesium: spec('Magnesium', 'mg', 2000),
  sodium: spec('Sodium', 'mg', 23000, '', true),
  calcium: spec('Calcium', 'mg', 5000),
  choline: spec('Choline', 'mg', 5000),
  vitaminB12: spec('Vitamin B12', 'mcg', 1000),
  folate: spec('Folate', 'mcg', 5000, 'DFE'),
  vitaminC: spec('Vitamin C', 'mg', 3000),
  vitaminB6: spec('Vitamin B6', 'mg', 50),
  vitaminA: spec('Vitamin A', 'mcg', 30000, 'RAE, not IU', true),
  vitaminD: spec('Vitamin D', 'mcg', 300, 'not IU'),
  vitaminE: spec('Vitamin E', 'mg', 200, 'alpha-tocopherol'),
  vitaminK: spec('Vitamin K', 'mcg', 2000),
  selenium: spec('Selenium', 'mcg', 3000),
  iodine: spec('Iodine', 'mcg', 11000, '', true),
  phosphorus: spec('Phosphorus', 'mg', 10000),
  iron: spec('Iron', 'mg', 200),
  zinc: spec('Zinc', 'mg', 200),
  omega3: spec('Omega-3', 'g', 100, 'total ALA+EPA+DHA', true),
};

/** One deduplicated recipe ingredient included in a nutrition prompt. */
export interface IntakeGroup {
  key: string;
  displayName: string;
  normalizedName: string;
  ingredientIds: string[];
  note: string;
}

/** Build the Nutrition Tracker prompt with the established exact output text. */
export const buildNutritionPrompt = (recipeName: string, groups: IntakeGroup[]): string => {
  const units = TRACKER_NUTRIENT_KEYS
    .map((key) => {
      const nutrient = NUTRIENT_INTAKE_SPEC[key];
      return `${key} ${nutrient.unit}${nutrient.promptNote ? ` (${nutrient.promptNote})` : ''}`;
    })
    .join('; ');
  const shape = TRACKER_NUTRIENT_KEYS.map((key) => `"${key}":0`).join(',');
  const lines = groups.map((group) => JSON.stringify({
    ingredientId: group.key,
    name: group.displayName,
    note: group.note,
  }));
  const promptLines = [
    'Estimate nutrition for the ingredients listed below for my Nutrition Tracker.',
    '',
    'Output one valid JSON object only — no markdown, code fences, commentary, or text outside it.',
    '',
    'Rules:',
    '- Basis: every value is per 100 g of the ingredient as listed (edible portion; raw/uncooked unless the name or note says cooked, canned, dried, etc.). Never per serving, per cup, or per piece.',
    '- Use standard food-composition data (for example USDA FoodData Central) for the closest generic match; use a brand only when one is named.',
    '- All 24 nutrient keys are required. Each must be a plain JSON number in exactly the unit shown — no strings, units, ranges, or null. Use 0 only when the food contains essentially none; otherwise give your best estimate and mention low confidence in "assumptions".',
    '- Return exactly one item per listed ingredient, in the same order. Copy "ingredientId" exactly and "name" as listed. Do not add, merge, split, or rename ingredients.',
    '- "assumptions": one short sentence on the form and data assumed ("raw, USDA SR Legacy"; "unsalted"); "" when none.',
    '',
    'Nutrient keys and units (per 100 g):',
    units,
    '',
    'Use exactly this shape — no extra fields:',
    `{"kind":"${NUTRITION_INTAKE_KIND}","schemaVersion":${NUTRITION_INTAKE_SCHEMA_VERSION},"basis":"${NUTRITION_INTAKE_BASIS}","items":[{"ingredientId":"","name":"","assumptions":"","nutrients":{${shape}}}]}`,
    '',
    'Final check — do internally; output only the JSON:',
    '1. One item per listed ingredient, ids copied exactly.',
    '2. All 24 nutrient keys present as numbers in the listed units (mcg vs mg; vitamin A and D in mcg, not IU).',
    '3. Values are per 100 g: protein + carbs + fat is at most 100.',
    '4. Output is one valid JSON object with nothing outside it.',
    '',
    `Recipe: ${JSON.stringify(recipeName || 'Untitled recipe')}`,
    'Ingredients (one JSON object per line):',
    lines.join('\n'),
  ];
  return promptLines.join('\n');
};

/** Parsed nutrition values and row-level validation messages. */
export interface ParsedNutritionItem {
  index: number;
  path: string;
  ingredientId: string | null;
  name: string;
  assumptions: string;
  nutrients: Record<TrackerNutrientKey, number | null>;
  errors: string[];
  warnings: string[];
}

/** Result of parsing pasted nutrition JSON. */
export type NutritionParseResult =
  | { ok: false; errors: string[] }
  | { ok: true; items: ParsedNutritionItem[]; warnings: string[] };

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hint = 'Do not include markdown fences, commentary, or trailing text.';

/** Parse and validate pasted nutrition JSON without throwing. */
export const parseNutritionJson = (raw: string): NutritionParseResult => {
  const fatal: string[] = [];
  let parsed: unknown;

  if (!raw.trim()) return { ok: false, errors: ['Paste the JSON ChatGPT returned.'] };

  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      errors: [`Invalid JSON: ${err instanceof Error ? err.message : 'parse error'}. ${hint}`],
    };
  }

  if (!object(parsed)) {
    return { ok: false, errors: ['The pasted JSON must be a single object (starting with "{").'] };
  }

  const top = parsed;
  if (top.kind !== NUTRITION_INTAKE_KIND) {
    fatal.push('kind must be "recipe-nutrition".');
    if ('ingredients' in top || 'sections' in top) {
      fatal.push('This looks like recipe JSON — paste it into Import recipe instead.');
    }
  }
  if (typeof top.schemaVersion === 'number' && top.schemaVersion > 1) {
    fatal.push(`schemaVersion ${top.schemaVersion} is newer than this tool supports (1).`);
  } else if (top.schemaVersion !== 1) {
    fatal.push('schemaVersion must be 1.');
  }
  if (top.basis !== NUTRITION_INTAKE_BASIS) {
    fatal.push('basis must be "per-100g" — values must be per 100 g.');
  }
  if (!Array.isArray(top.items)) {
    fatal.push('items must be an array.');
  } else if (!top.items.length) {
    fatal.push('items is empty — the prompt lists at least one ingredient.');
  } else if (top.items.length > MAX_INTAKE_ITEMS) {
    fatal.push(`items has ${top.items.length} entries; at most 100 are supported.`);
  }
  if (fatal.length) return { ok: false, errors: fatal };

  const warnings = Object.keys(top)
    .filter((key) => !['kind', 'schemaVersion', 'basis', 'items'].includes(key))
    .map((key) => `Ignored unknown field "${key}".`);
  const items = (top.items as unknown[]).map((rawItem, index): ParsedNutritionItem => {
    const path = `items[${index}]`;
    const errors: string[] = [];
    const rowWarnings: string[] = [];
    const nutrients = Object.fromEntries(
      TRACKER_NUTRIENT_KEYS.map((key) => [key, null]),
    ) as Record<TrackerNutrientKey, number | null>;

    if (!object(rawItem)) {
      errors.push(`${path} must be an object.`);
      return { index, path, ingredientId: null, name: '', assumptions: '', nutrients, errors, warnings: rowWarnings };
    }

    const id = typeof rawItem.ingredientId === 'string' && rawItem.ingredientId.trim()
      ? rawItem.ingredientId.trim()
      : null;
    if (!id) rowWarnings.push(`${path}.ingredientId is missing — assign the ingredient manually.`);

    let name = '';
    if (typeof rawItem.name === 'string') name = rawItem.name.trim();
    else if (rawItem.name !== undefined) errors.push(`${path}.name must be a string.`);

    let assumptions = '';
    if (typeof rawItem.assumptions === 'string') {
      assumptions = rawItem.assumptions.trim();
      if (assumptions.length > MAX_ASSUMPTIONS_LENGTH) {
        assumptions = assumptions.slice(0, MAX_ASSUMPTIONS_LENGTH);
        rowWarnings.push(`${path}.assumptions was shortened to 300 characters.`);
      }
    } else if (rawItem.assumptions !== undefined) {
      errors.push(`${path}.assumptions must be a string.`);
    }

    Object.keys(rawItem)
      .filter((key) => !['ingredientId', 'name', 'assumptions', 'nutrients'].includes(key))
      .forEach((key) => rowWarnings.push(`${path}: ignored unknown field "${key}".`));

    if (!object(rawItem.nutrients)) {
      errors.push(`${path}.nutrients must be an object with all 24 nutrient keys.`);
    } else {
      const ns = rawItem.nutrients;
      for (const key of TRACKER_NUTRIENT_KEYS) {
        const nutrientPath = `${path}.nutrients.${key}`;
        const value = ns[key];
        const nutrientSpec = NUTRIENT_INTAKE_SPEC[key];

        if (!(key in ns)) {
          errors.push(`${nutrientPath} is missing (${nutrientSpec.unit} per 100 g).`);
          continue;
        }
        if (value === null) {
          errors.push(`${nutrientPath} must be a number — estimate it, or use 0 only if the food has essentially none.`);
          continue;
        }
        if (typeof value === 'string') {
          errors.push(`${nutrientPath} must be a number in ${nutrientSpec.unit} without units or quotes (got "${value.slice(0, 20)}").`);
          continue;
        }
        if (typeof value !== 'number') {
          errors.push(`${nutrientPath} must be a number in ${nutrientSpec.unit}.`);
          continue;
        }
        if (!Number.isFinite(value)) {
          errors.push(`${nutrientPath} must be a finite number.`);
          continue;
        }
        if (value < 0) {
          errors.push(`${nutrientPath} must be 0 or more.`);
          continue;
        }
        if (value > nutrientSpec.max) {
          errors.push(nutrientSpec.trackerCap
            ? `${nutrientPath} is ${value} ${nutrientSpec.unit}, above the ${nutrientSpec.max} ${nutrientSpec.unit} per 100 g the Nutrition Tracker can store. Skip this row and link the ingredient to a smaller-unit food (for example per 1 g) from its nutrition badge.`
            : `${nutrientPath} is ${value} ${nutrientSpec.unit}, above the plausible maximum of ${nutrientSpec.max} ${nutrientSpec.unit} per 100 g — check the unit (mg vs mcg, IU vs mcg) and that the value is per 100 g.`);
          continue;
        }
        nutrients[key] = Object.is(value, -0) ? 0 : value;
      }

      Object.keys(ns)
        .filter((key) => !TRACKER_NUTRIENT_KEYS.includes(key as TrackerNutrientKey))
        .forEach((key) => rowWarnings.push(`${path}.nutrients.${key} is not a tracked nutrient and was ignored.`));

      const valid = (key: TrackerNutrientKey): number | null => nutrients[key];
      const protein = valid('protein');
      const carbs = valid('carbs');
      const fat = valid('fat');
      const omega3 = valid('omega3');
      const calories = valid('calories');

      if (protein !== null && carbs !== null && fat !== null) {
        const sum = protein + carbs + fat;
        if (sum > MACRO_MASS_TOLERANCE_G) {
          errors.push(`${path}.nutrients: protein + carbs + fat = ${sum.toFixed(1)} g exceeds 100 g per 100 g — the values look per serving, not per 100 g.`);
        }
      }
      if (omega3 !== null && fat !== null && omega3 > fat + 0.5) {
        errors.push(`${path}.nutrients.omega3 (${omega3} g) cannot exceed fat (${fat} g).`);
      }
      if (protein !== null && carbs !== null && fat !== null && calories !== null) {
        const estimate = 4 * protein + 4 * carbs + 9 * fat;
        if (Math.abs(calories - estimate) > Math.max(50, 0.3 * calories)) {
          rowWarnings.push(`${path}.nutrients.calories (${calories} kcal) differs from protein/carbs/fat (≈${Math.round(estimate)} kcal) — double-check.`);
        }
      }
    }

    return { index, path, ingredientId: id, name, assumptions, nutrients, errors, warnings: rowWarnings };
  });

  return { ok: true, items, warnings };
};
