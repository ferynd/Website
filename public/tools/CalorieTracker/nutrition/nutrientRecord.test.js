import { describe, expect, it } from 'vitest';
import { LEGACY_V1_KEYS } from '../../../shared/nutrition/nutrientRegistry.js';
import { parseNutritionText } from '../../../shared/nutrition/nutrientText.js';
import {
  NewerSchemaError,
  NutrientBoundsError,
  applyLegacyInputOverlay,
  assessFoodSave,
  buildFoodWrite,
  deriveDayDetailTotals,
  legacyPartialNote,
  readFoodNutrients,
  sumLegacyDayTotals,
  targetsFromStagedRecord,
  writeLegacyDayTotals,
} from './nutrientRecord.js';

function recordWith(assignments, quality = {}) {
  const record = parseNutritionText('');
  for (const [key, value] of Object.entries(assignments)) {
    record.values[key] = value;
    record.quality[key] = quality[key] || { status: value == null ? 'unknown' : 'measured' };
  }
  return record;
}

describe('nutrient records', () => {
  it('v2 round trip preserves null, measured, estimated and label-rounded zero', () => {
    const record = recordWith(
      { sodium: null, protein: 10, fat: 3, fiber: 0 },
      {
        sodium: { status: 'unknown' },
        protein: { status: 'measured' },
        fat: { status: 'estimated_from_comparable' },
        fiber: { status: 'label_reported', roundingInterval: 1 },
      },
    );
    const built = buildFoodWrite(record, { writeVersion: 1 + 1, name: 'Egg', quantity: 1, lastUpdated: 't' });
    expect(built.doc.sodium).toBeNull();
    expect(built.doc.nutrientSchemaVersion).toBe(2);
    const read = readFoodNutrients(built.doc);
    expect(read.values.sodium).toBeNull();
    expect(read.values.protein).toBe(10);
    expect(read.quality.protein.status).toBe('measured');
    expect(read.values.fat).toBe(3);
    expect(read.quality.fat.status).toBe('estimated_from_comparable');
    expect(read.values.fiber).toBe(0);
    expect(read.quality.fiber).toMatchObject({ status: 'label_reported', roundingInterval: 1 });
  });

  it('reading a v1 doc yields legacy_unclassified numbers and unknown for absent keys', () => {
    const read = readFoodNutrients({ name: 'Egg', calories: 165, protein: 0 });
    expect(read.values.calories).toBe(165);
    expect(read.quality.calories.status).toBe('legacy_unclassified');
    expect(read.values.protein).toBe(0);
    expect(read.values.fat).toBeNull();
    expect(read.quality.fat.status).toBe('unknown');
  });

  it('writeVersion 1 produces exactly the pre-#60 food doc shape and reports zeroFilled and droppedDetail', () => {
    const record = recordWith({ calories: 100, sodium: 39340, fatSaturated: 2 });
    const built = buildFoodWrite(record, {
      writeVersion: 1,
      name: 'Salt',
      quantity: 1,
      lastUpdated: '2020-01-01T00:00:00.000Z',
    });
    expect(Object.keys(built.doc)).toEqual(['name', 'quantity', ...LEGACY_V1_KEYS, 'lastUpdated']);
    expect(built.doc.calories).toBe(100);
    expect(built.doc.sodium).toBe(23000);
    expect(built.doc.protein).toBe(0);
    expect(built.doc.nutrientSchemaVersion).toBeUndefined();
    expect(built.doc.fatSaturated).toBeUndefined();
    expect(built.zeroFilled).toContain('protein');
    expect(built.zeroFilled).not.toContain('calories');
    expect(built.droppedDetail).toContain('fatSaturated');
    expect(built.fields.sodium).toBe(23000);
  });

  it('writeVersion 1 refuses to overwrite a doc with nutrientSchemaVersion 2', () => {
    const record = recordWith({ calories: 1 });
    const existing = { nutrientSchemaVersion: 2, calories: 1 };
    expect(() => buildFoodWrite(record, { writeVersion: 1, existingDoc: existing, name: 'A', quantity: 1, lastUpdated: 't' })).toThrow(NewerSchemaError);
  });

  it('identical 24-key match still refuses overwriting a v2 doc', () => {
    const existing = { nutrientSchemaVersion: 2, name: 'Salt', quantity: 1 };
    for (const key of LEGACY_V1_KEYS) existing[key] = 0;
    existing.sodium = 100;
    const record = recordWith(Object.fromEntries(LEGACY_V1_KEYS.map((key) => [key, existing[key]])));
    const assessment = assessFoodSave(existing, record, 1);
    expect(assessment.newerSchema).toBe(true);
    expect(assessment.identical).toBe(false);
  });

  it('salt sodium 39,340 round-trips without legacy clamp in v2', () => {
    const record = recordWith({ sodium: 39340 });
    const built = buildFoodWrite(record, { writeVersion: 1 + 1, name: 'Salt', quantity: 1, lastUpdated: 't' });
    expect(built.doc.sodium).toBe(39340);
    expect(readFoodNutrients(built.doc).values.sodium).toBe(39340);
    expect(built.doc.nutrientMeta.quality.sodium.status).toBe('measured');
  });

  it('fiberMeaning is never inferred from the field name', () => {
    const record = recordWith({ fiberTotal: 5 }, { fiberTotal: { status: 'measured' } });
    expect(record.fiberMeaning).toBe('unknown');
    const built = buildFoodWrite(record, { writeVersion: 1 + 1, name: 'Oats', quantity: 1, lastUpdated: 't' });
    expect(built.doc.fiberTotal).toBe(5);
    expect(built.doc.nutrientMeta.fiberMeaning).toBeUndefined();
    expect(readFoodNutrients(built.doc).fiberMeaning).toBe('unknown');
  });

  it('deriveDayDetailTotals reports partial coverage when some foodItems lack a key', () => {
    const totals = deriveDayDetailTotals([
      { quantity: 1, nutrientSchemaVersion: 2, fatSaturated: 2 },
      { quantity: 2, nutrientSchemaVersion: 2, fatSaturated: null },
    ]);
    expect(totals.fatSaturated).toEqual({ value: 2, coverage: 'partial' });
    const legacy = sumLegacyDayTotals([
      { quantity: 1, nutrientSchemaVersion: 2, sodium: null, calories: 10 },
      { quantity: 1, calories: 5 },
    ]);
    expect(legacy.totals.calories).toBe(15);
    expect(legacy.totals.sodium).toBe(0);
    expect(legacy.partialKeys).toContain('sodium');
    const items = [{ quantity: 1, nutrientSchemaVersion: 2, sodium: null }];
    sumLegacyDayTotals(items);
    expect(items[0].sodium).toBeNull();
  });

  it('updateTargets staging saves only legacy v1 keys', () => {
    const record = recordWith({ protein: 20, fatSaturated: 3, calories: null });
    const targets = targetsFromStagedRecord(record);
    expect(Object.keys(targets)).toEqual([...LEGACY_V1_KEYS]);
    expect(targets.protein).toBe(20);
    expect(targets.fatSaturated).toBeUndefined();
    expect(targets.calories).toBe(0);
  });

  it('staged blanks stay null when overlaid and v1 projection zero-fills', () => {
    const record = parseNutritionText('Protein: 10 g');
    const overlaid = applyLegacyInputOverlay(record, { protein: '12', calories: '' });
    expect(overlaid.values.protein).toBe(12);
    expect(overlaid.values.calories).toBeNull();
    const built = buildFoodWrite(overlaid, { writeVersion: 1, name: 'A', quantity: 1, lastUpdated: 't' });
    expect(built.fields.protein).toBe(12);
    expect(built.fields.calories).toBe(0);
  });

  it('v2 writes reject values that fail both per-unit and per-100 g bounds', () => {
    const options = { writeVersion: 1 + 1, name: 'Salt', quantity: 1, lastUpdated: 't' };
    expect(buildFoodWrite(recordWith({ sodium: 39340 }), options).doc.sodium).toBe(39340);
    expect(buildFoodWrite(recordWith({ protein: 150 }), options).doc.protein).toBe(150);
    expect(buildFoodWrite(recordWith({ calories: 901 }), options).doc.calories).toBe(901);
    expect(buildFoodWrite(recordWith({ sodium: null }), options).doc.sodium).toBeNull();
    expect(() => buildFoodWrite(recordWith({ sodium: -1 }), options)).toThrow(NutrientBoundsError);
    expect(() => buildFoodWrite(recordWith({ sodium: 100001 }), options)).toThrow(NutrientBoundsError);
    expect(() => buildFoodWrite(recordWith({ protein: 5000 }), options)).toThrow(NutrientBoundsError);
    expect(() => buildFoodWrite(recordWith({ calories: 20000 }), options)).toThrow(NutrientBoundsError);
    const v1 = buildFoodWrite(recordWith({ sodium: 39340 }), { writeVersion: 1, name: 'Salt', quantity: 1, lastUpdated: 't' });
    expect(v1.doc.sodium).toBe(23000);
    expect(v1.doc).not.toHaveProperty('nutrientSchemaVersion');
  });

  it('day total writes stay numeric and do not store partialKeys', () => {
    const entry = { name: 'day' };
    const items = [
      { quantity: 1, nutrientSchemaVersion: 2, calories: 10.2, sodium: null, protein: 2 },
      { quantity: 2, calories: 3, sodium: 5 },
    ];
    const summed = writeLegacyDayTotals(entry, items, { missingQuantity: 0 });
    expect(entry.calories).toBe(16.2);
    expect(entry.sodium).toBe(10);
    expect(entry.protein).toBe(2);
    expect(typeof entry.calories).toBe('number');
    expect(Object.prototype.hasOwnProperty.call(entry, 'partialKeys')).toBe(false);
    expect(summed.partialKeys).toContain('sodium');
    expect(legacyPartialNote(summed.partialKeys)).toBe(`Partial day totals (≥): ${summed.partialKeys.join(', ')}.`);
    expect(legacyPartialNote([])).toBe('');
    const rounded = {};
    writeLegacyDayTotals(rounded, [{ calories: 10.6 }], { missingQuantity: 1, round: true });
    expect(rounded.calories).toBe(11);
    expect(Object.prototype.hasOwnProperty.call(rounded, 'partialKeys')).toBe(false);
  });
});
