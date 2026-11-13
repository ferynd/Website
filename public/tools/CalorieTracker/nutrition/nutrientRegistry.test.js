import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allNutrients, DEFAULT_TARGETS, NUTRIENT_MAX_BOUNDS, nutrients } from '../constants.js';
import {
  baseHasChildren,
  isChildNutrient,
  checkPer100g,
  convertUnit,
  FIBER_MEANINGS,
  getNutrient,
  LEGACY_V1_KEYS,
  lookupLabel,
  noteKeepsParent,
  NUTRIENT_STATUSES,
  NUTRIENTS,
  RESERVED_DOC_FIELDS,
  targetableKeys,
  V2_DETAIL_KEYS,
  V2_KEYS,
} from '../../../shared/nutrition/nutrientRegistry.js';

const PINNED_V2_KEYS = [
  'calories', 'protein', 'carbs', 'fat',
  'fiber', 'potassium', 'magnesium', 'sodium', 'calcium', 'choline',
  'vitaminB12', 'folate', 'vitaminC', 'vitaminB6',
  'vitaminA', 'vitaminD', 'vitaminE', 'vitaminK',
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
];

const PRE_60_ORDER = [
  ...nutrients.macros,
  ...nutrients.dailyFloors,
  ...nutrients.dailyVitamins,
  ...nutrients.avgVitamins,
  ...nutrients.avgMinerals,
  ...nutrients.optional,
];

const PRE_60_BOUNDS = {
  calories: 10000, protein: 1000, carbs: 1000, fat: 1000,
  fiber: 500, potassium: 50000, magnesium: 10000, sodium: 23000,
  calcium: 25000, choline: 35000,
  vitaminB12: 10000, folate: 10000, vitaminC: 20000, vitaminB6: 1000,
  vitaminA: 30000, vitaminD: 1000, vitaminE: 10000, vitaminK: 10000,
  selenium: 4000, iodine: 11000, phosphorus: 40000,
  iron: 450, zinc: 400, omega3: 100,
};

describe('nutrient registry', () => {
  it('LEGACY_V1_KEYS equals the frozen pre-#60 24-key order', () => {
    expect([...LEGACY_V1_KEYS]).toEqual(PRE_60_ORDER);
    expect(LEGACY_V1_KEYS).toHaveLength(24);
  });

  it('allNutrients and NUTRIENT_MAX_BOUNDS are unchanged and derived from the registry', () => {
    expect(allNutrients).toEqual([...LEGACY_V1_KEYS]);
    expect(NUTRIENT_MAX_BOUNDS).toEqual(PRE_60_BOUNDS);
    for (const key of LEGACY_V1_KEYS) {
      expect(NUTRIENT_MAX_BOUNDS[key]).toBe(getNutrient(key).bounds.perUnit.max);
    }
  });

  it('registry order is append-only against the pinned v2 key snapshot', () => {
    expect([...V2_KEYS]).toEqual(PINNED_V2_KEYS);
    expect(V2_KEYS.slice(0, 24)).toEqual([...LEGACY_V1_KEYS]);
    expect([...V2_DETAIL_KEYS]).toEqual(PINNED_V2_KEYS.slice(24));
  });

  it('every entry declares unit, label, group, since, bounds and targetRole', () => {
    const units = new Set(['kcal', 'g', 'mg', 'mcg']);
    const roles = new Set(['floor', 'average', 'optional', 'none']);
    for (const def of NUTRIENTS) {
      expect(units.has(def.unit)).toBe(true);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.group.length).toBeGreaterThan(0);
      expect(def.since === 1 || def.since === 2).toBe(true);
      expect(def.bounds.perUnit.max).toBeGreaterThan(0);
      expect(def.bounds.per100g.hardMax).toBeGreaterThan(0);
      expect(def.bounds.per100g.reviewAbove).toBeGreaterThan(0);
      expect(roles.has(def.targetRole)).toBe(true);
      expect(typeof def.notes).toBe('string');
    }
  });

  it('labels and aliases map to exactly one key; no key collides with RESERVED_DOC_FIELDS', () => {
    const seen = new Map();
    for (const def of NUTRIENTS) {
      expect(RESERVED_DOC_FIELDS).not.toContain(def.key);
      for (const label of [...def.labels, ...def.legacyAliases]) {
        const hit = lookupLabel(label);
        expect(hit?.key).toBe(def.key);
        const previous = seen.get(label.toLowerCase());
        if (previous) expect(previous).toBe(def.key);
        seen.set(label.toLowerCase(), def.key);
      }
    }
    expect(lookupLabel('Saturated Fat')?.key).toBe('fatSaturated');
    expect(lookupLabel('fat')?.key).toBe('fat');
    expect(lookupLabel('folic acid')).toBeNull();
    expect(lookupLabel('Total Carbohydrate')?.key).toBe('carbs');
    expect(lookupLabel('Total Carbohydrates')?.key).toBe('carbs');
    expect(lookupLabel('Total Calories')?.key).toBe('calories');
    expect(lookupLabel('Carbohydrate, by difference')?.key).toBe('carbs');
    expect(lookupLabel('Fat, total')?.key).toBe('fat');
    expect(lookupLabel('Fiber, total dietary')?.key).toBe('fiber');
    expect(lookupLabel('Fiber (total dietary)')?.key).toBe('fiberTotal');
    expect(lookupLabel('Vitamin A (RAE)')?.key).toBe('vitaminA');
    expect(lookupLabel('Folate (DFE)')?.key).toBe('folate');
    expect(lookupLabel('Total Carbs')?.key).toBe('carbs');
    expect(lookupLabel('Total Fiber')?.key).toBe('fiber');
    expect(lookupLabel('Total Fats')?.key).toBe('fat');
    expect(lookupLabel('Total lipid (fat)')?.key).toBe('fat');
    expect(lookupLabel('Vitamin D (D2 + D3)')?.key).toBe('vitaminD');
    expect(lookupLabel('Folate DFE')?.key).toBe('folate');
    expect(lookupLabel('Vit. B12')?.key).toBe('vitaminB12');
    expect(lookupLabel('Vit.B6')?.key).toBe('vitaminB6');
    expect(lookupLabel('Vitamin E (natural)')?.key).toBe('vitaminE');
    expect(lookupLabel('Dietary Fibre')?.key).toBe('fiber');
    expect(lookupLabel('Dietary fibre')?.key).toBe('fiber');
    expect(lookupLabel('Folate, total')).toBeNull();
    expect(lookupLabel('Folate , total')).toBeNull();
    expect(lookupLabel('Folate,total')).toBeNull();
    expect(lookupLabel('Folate (total)')).toBeNull();
    expect(lookupLabel('Fat (approx)')?.key).toBe('fat');
    expect(lookupLabel('Fat (approx.)')?.key).toBe('fat');
    expect(lookupLabel('Fat (est.)')?.key).toBe('fat');
    expect(lookupLabel('Fat (estimated)')?.key).toBe('fat');
    expect(lookupLabel('Fat (per serving)')?.key).toBe('fat');
    expect(lookupLabel('Fat (per portion)')?.key).toBe('fat');
    expect(lookupLabel('Total Carbohydrate (per 100g)')?.key).toBe('carbs');
    expect(lookupLabel('Total Carbohydrate (per 100 g)')?.key).toBe('carbs');
    expect(lookupLabel('Fat (mono)')).toBeNull();
    expect(lookupLabel('Sugars (alcohols)')).toBeNull();
    expect(noteKeepsParent('fat', 'mono')).toBe(false);
    expect(noteKeepsParent('fat', 'total')).toBe(true);
    expect(noteKeepsParent('fat', 'of which saturates')).toBe(false);
    expect(noteKeepsParent('carbs', 'net')).toBe(false);
    expect(noteKeepsParent('carbs', 'by difference')).toBe(true);
    expect(noteKeepsParent('sugarsTotal', 'alcohols')).toBe(false);
    expect(noteKeepsParent('fiber', 'soluble')).toBe(false);
    expect(noteKeepsParent('omega3', 'fish oil')).toBe(false);
    expect(noteKeepsParent('omega3', 'as fish oil')).toBe(true);
    expect(noteKeepsParent('vitaminE', 'natural')).toBe(true);
    expect(noteKeepsParent('protein', 'natural')).toBe(true);
    expect(noteKeepsParent('fat', 'approx')).toBe(true);
    expect(noteKeepsParent('fat', 'estimated')).toBe(true);
    expect(noteKeepsParent('fat', 'approx mono')).toBe(false);
    expect(noteKeepsParent('fat', 'per serving')).toBe(true);
    expect(noteKeepsParent('carbs', 'per 100 g')).toBe(true);
    expect(noteKeepsParent('carbs', 'per 100g')).toBe(true);
    expect(noteKeepsParent('fiber', 'per portion')).toBe(true);
    expect(baseHasChildren('carbs')).toBe(true);
    expect(baseHasChildren('fat')).toBe(true);
    expect(baseHasChildren('protein')).toBe(false);
    expect(baseHasChildren('sodium')).toBe(false);
    expect(baseHasChildren('calories')).toBe(false);
    expect(isChildNutrient('fat', 'fatSaturated')).toBe(true);
    expect(isChildNutrient('carbs', 'sugarsTotal')).toBe(true);
    expect(isChildNutrient('carbs', 'carbs')).toBe(false);
    expect(isChildNutrient('protein', 'protein')).toBe(false);
    expect(lookupLabel('Omega-3 (ALA)')?.key).toBe('omega3ALA');
    expect(lookupLabel('Fat, saturated')?.key).toBe('fatSaturated');
    expect(lookupLabel('Fat, saturated')?.key).not.toBe('fat');
    expect(lookupLabel('Calories from Fat')).toBeNull();
    expect(lookupLabel('Net Carbs')).toBeNull();
    expect(lookupLabel('EPA + DHA')).toBeNull();
    expect(lookupLabel('Vitamin D3')).toMatchObject({ key: 'vitaminD' });
    expect(lookupLabel('Cholecalciferol')).toMatchObject({ key: 'vitaminD' });
    expect(lookupLabel('Vitamin K2')).toMatchObject({ key: 'vitaminK' });
    expect(lookupLabel('Menaquinone')).toMatchObject({ key: 'vitaminK' });
    expect(lookupLabel('Vitamin C (as ascorbic acid)')).toMatchObject({ key: 'vitaminC' });
    expect(lookupLabel('Zinc (as zinc oxide)')).toMatchObject({ key: 'zinc' });
    expect(lookupLabel('Vitamin B12 (as methylcobalamin)')).toMatchObject({ key: 'vitaminB12' });
    expect(lookupLabel('Saturated Fat (fat)')).toBeNull();
    expect(lookupLabel('EPA (omega-3)')).toBeNull();
    expect(lookupLabel('Energy (kJ)')).toEqual({ key: 'calories', via: 'exact', unit: 'kj' });
    expect(lookupLabel('Sodium (g)')).toEqual({ key: 'sodium', via: 'exact', unit: 'g' });
    expect(lookupLabel('Vitamin A (IU)')).toEqual({ key: 'vitaminA', via: 'exact', unit: 'iu' });
    expect(lookupLabel('Vitamin A (RAE)').unit).toBeUndefined();
    expect(FIBER_MEANINGS).toEqual(['total', 'weighted_legacy', 'unknown']);
  });

  it('all v2 keys have targetRole none and no DEFAULT_TARGETS entry', () => {
    expect(targetableKeys()).toEqual([...LEGACY_V1_KEYS]);
    for (const key of V2_DETAIL_KEYS) {
      expect(getNutrient(key).targetRole).toBe('none');
      expect(DEFAULT_TARGETS).not.toHaveProperty(key);
    }
  });

  it('NUTRIENT_STATUSES matches the workflow.md contract plus legacy_unclassified', () => {
    const workflow = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/nutrition/workflow.md'), 'utf8');
    const line = workflow.split('\n').find((row) => row.includes('Status:') && row.includes('measured'));
    const listed = [...line.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
    expect(listed).toEqual([
      'measured', 'label_reported', 'calculated', 'estimated_from_comparable',
      'below_quantification_limit', 'unknown', 'not_applicable',
      'assumed_zero', 'source_reported',
    ]);
    expect([...NUTRIENT_STATUSES]).toEqual([...listed, 'legacy_unclassified']);
  });

  it('per100g accepts pure-salt sodium 39,340 mg, KCl potassium and reduced iron; rejects 100,001 mg and 911 kcal', () => {
    expect(checkPer100g('sodium', 39340)).toBe('ok');
    expect(checkPer100g('potassium', 52440)).toBe('ok');
    expect(checkPer100g('iron', 97000)).toBe('ok');
    expect(checkPer100g('sodium', 100001)).toBe('reject');
    expect(checkPer100g('iron', 100001)).toBe('reject');
    expect(checkPer100g('calories', 911)).toBe('reject');
  });

  it.each([
    [900, 'ok'],
    [900.000001, 'review'],
    [901, 'review'],
    [902, 'review'],
    [910, 'review'],
    [910.000001, 'reject'],
    [911, 'reject'],
    [-1, 'reject'],
    [NaN, 'reject'],
    [Infinity, 'reject'],
  ])('per100g energy %s returns %s without changing legacy per-unit bounds', (value, expected) => {
    expect(checkPer100g('calories', value)).toBe(expected);
    expect(getNutrient('calories').bounds).toEqual({
      perUnit: { max: 10000 },
      per100g: { hardMax: 910, reviewAbove: 900 },
    });
  });

  it('convertUnit handles g/mg/mcg/µg/μg, kJ→kcal and vitamin D IU; rejects vitamin A/E IU and folic acid→DFE', () => {
    expect(convertUnit('sodium', 1, 'g')).toEqual({ value: 1000, unit: 'mg' });
    expect(convertUnit('sodium', 1000, 'mg')).toEqual({ value: 1000, unit: 'mg' });
    expect(convertUnit('vitaminB12', 1, 'mg')).toEqual({ value: 1000, unit: 'mcg' });
    expect(convertUnit('vitaminB12', 2, 'µg')).toEqual({ value: 2, unit: 'mcg' });
    expect(convertUnit('vitaminB12', 3, 'μg')).toEqual({ value: 3, unit: 'mcg' });
    expect(convertUnit('calories', 100, 'kJ')).toEqual({ value: 23.9006, unit: 'kcal' });
    expect(convertUnit('vitaminD', 40, 'IU')).toEqual({ value: 1, unit: 'mcg' });
    expect(convertUnit('vitaminA', 500, 'IU')).toEqual({ error: 'nondefensible_conversion' });
    expect(convertUnit('vitaminE', 10, 'IU')).toEqual({ error: 'nondefensible_conversion' });
    expect(convertUnit('folate', 200, 'folic acid')).toEqual({ error: 'nondefensible_conversion' });
  });

  it('fat subtypes and omega-3 components declare their parent with relation component', () => {
    for (const key of ['fatSaturated', 'fatTrans', 'fatMonounsaturated', 'fatPolyunsaturated']) {
      expect(getNutrient(key).parent).toBe('fat');
      expect(getNutrient(key).relation).toBe('component');
    }
    for (const key of ['omega3ALA', 'omega3EPA', 'omega3DHA', 'omega3DPA']) {
      expect(getNutrient(key).parent).toBe('omega3');
      expect(getNutrient(key).relation).toBe('component');
    }
    expect(getNutrient('omega6').parent).toBeUndefined();
  });
});
