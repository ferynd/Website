import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { allNutrients, NUTRIENT_MAX_BOUNDS } from '../../../../public/tools/CalorieTracker/constants.js';
import {
  LEGACY_V1_KEYS,
  V2_KEYS,
  getNutrient,
  type NutrientKey,
} from '@/public/shared/nutrition/nutrientRegistry.js';
import { NUTRIENT_INTAKE_SPEC } from '../lib/nutritionIntake';
import { TRACKER_NUTRIENT_KEYS, TRACKER_NUTRIENT_MAX_BOUNDS } from '../lib/trackerFoods';

/** Pinned independently of the registry export so the union check is not tautological. */
const PINNED_NUTRIENT_KEYS = [
  'calories', 'protein', 'carbs', 'fat', 'fiber', 'potassium', 'magnesium', 'sodium', 'calcium', 'choline',
  'vitaminB12', 'folate', 'vitaminC', 'vitaminB6', 'vitaminA', 'vitaminD', 'vitaminE', 'vitaminK',
  'selenium', 'iodine', 'phosphorus', 'iron', 'zinc', 'omega3',
  'fatSaturated', 'fatTrans', 'fatMonounsaturated', 'fatPolyunsaturated',
  'omega3ALA', 'omega3EPA', 'omega3DHA', 'omega3DPA', 'omega6',
  'sugarsTotal', 'sugarsAdded', 'starch', 'allulose', 'sugarAlcoholsTotal',
  'erythritol', 'sorbitol', 'mannitol', 'isomalt', 'xylitol', 'glycerol', 'maltitol',
  'fiberTotal', 'fiberSoluble', 'fiberInsoluble', 'resistantStarch', 'fiberWeightedLegacy',
  'vitaminB1', 'vitaminB2', 'vitaminB3', 'vitaminB5', 'biotin',
  'copper', 'manganese', 'chromium', 'molybdenum', 'chloride',
  'cholesterol', 'alcohol', 'water', 'caffeine',
  'lactose', 'fructans', 'gos', 'excessFructose',
] as const;

const LIB_DIR = join(dirname(fileURLToPath(import.meta.url)), '../lib');
const KEY_SET = new Set<string>(PINNED_NUTRIENT_KEYS);
const ARRAY_PATTERN = /\[(?:\s*['"][A-Za-z0-9]+['"]\s*,){3,}\s*['"][A-Za-z0-9]+['"]\s*\]/g;

const sourceFiles = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !entry.includes('.test.')) found.push(path);
  }
  return found;
};

describe('nutrient registry parity', () => {
  it('TRACKER_NUTRIENT_KEYS equals registry LEGACY_V1_KEYS and tracker allNutrients', () => {
    expect([...TRACKER_NUTRIENT_KEYS]).toEqual([...LEGACY_V1_KEYS]);
    expect([...TRACKER_NUTRIENT_KEYS]).toEqual([...allNutrients]);
  });

  it('TRACKER_NUTRIENT_MAX_BOUNDS equals registry perUnit and NUTRIENT_MAX_BOUNDS', () => {
    expect(TRACKER_NUTRIENT_MAX_BOUNDS).toEqual(NUTRIENT_MAX_BOUNDS);
    for (const key of LEGACY_V1_KEYS) {
      expect(TRACKER_NUTRIENT_MAX_BOUNDS[key]).toBe(getNutrient(key)!.bounds.perUnit.max);
    }
  });

  it('NUTRIENT_INTAKE_SPEC labels and units come from the registry', () => {
    for (const key of TRACKER_NUTRIENT_KEYS) {
      const def = getNutrient(key)!;
      expect(NUTRIENT_INTAKE_SPEC[key].label).toBe(def.label);
      expect(NUTRIENT_INTAKE_SPEC[key].unit).toBe(def.unit);
    }
  });

  it('d.ts NutrientKey union matches runtime V2_KEYS', () => {
    expectTypeOf<NutrientKey>().toEqualTypeOf<(typeof PINNED_NUTRIENT_KEYS)[number]>();
    expect([...V2_KEYS]).toEqual([...PINNED_NUTRIENT_KEYS]);
  });

  it('no recipe lib file declares a literal nutrient key array', () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(LIB_DIR)) {
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(ARRAY_PATTERN)) {
        const keys = [...match[0].matchAll(/['"]([A-Za-z0-9]+)['"]/g)].map((item) => item[1]);
        if (keys.length >= 4 && keys.every((key) => KEY_SET.has(key))) offenders.push(`${path}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
