import { describe, expect, it } from 'vitest';
import { LEGACY_V1_KEYS } from '../../../shared/nutrition/nutrientRegistry.js';
import { parseNutritionText } from '../../../shared/nutrition/nutrientText.js';
import {
  NewerSchemaError,
  NutrientBoundsError,
  applyLegacyInputOverlay,
  assessFoodSave,
  buildFoodWrite,
  commitSavedFoodWrite,
  deriveDayDetailTotals,
  diaryFoodItem,
  foodNameLeavesStagedDetail,
  legacyPartialNote,
  readFoodNutrients,
  sumLegacyDayTotals,
  targetsFromStagedRecord,
  withoutStagedDetail,
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

  it('reads the target food by id inside the transaction and keeps the v1 object', async () => {
    const record = parseNutritionText('Protein: <1 g\nFat: ~3 g\nSaturated Fat: 1 g');
    const sets = [];
    const blocking = {
      async get(ref) {
        expect(ref).toEqual({ id: 'chicken_breast' });
        return {
          exists: () => true,
          data: () => ({ nutrientSchemaVersion: 2, name: 'Chicken Breast', protein: 20 }),
        };
      },
      set() { sets.push('blocked'); },
    };
    await expect(commitSavedFoodWrite(blocking, { id: 'chicken_breast' }, record, {
      writeVersion: 1,
      existingDoc: null,
      name: 'Chicken-Breast',
      quantity: 1,
      lastUpdated: 't',
    })).rejects.toBeInstanceOf(NewerSchemaError);
    expect(sets).toEqual([]);

    const staleV2Cache = {
      async get() {
        return { exists: () => false, data: () => undefined };
      },
      set(_ref, data) { sets.push(data); },
    };
    const written = await commitSavedFoodWrite(staleV2Cache, { id: 'egg' }, record, {
      writeVersion: 1,
      existingDoc: { nutrientSchemaVersion: 2, name: 'Egg' },
      name: 'Egg',
      quantity: 2,
      lastUpdated: 't',
    });
    expect(written.doc).toBe(sets[0]);
    expect(Object.keys(written.doc)).toEqual(['name', 'quantity', ...LEGACY_V1_KEYS, 'lastUpdated']);
    expect(written.doc).not.toHaveProperty('nutrientSchemaVersion');
    expect(written.doc).not.toHaveProperty('nutrientMeta');
    expect(written.doc).not.toHaveProperty('fatSaturated');
    expect(written.doc.protein).toBe(0);
    expect(written.doc.fat).toBe(3);
    expect(written.doc.name).toBe('Egg');
    expect(written.doc.quantity).toBe(2);
    expect(written.doc.lastUpdated).toBe('t');
  });

  it('v2 diary items keep nutrientMeta and v1 items stay the legacy shape', () => {
    const record = parseNutritionText('Protein: <1 g\nFat: ~3 g\nFiber (total dietary): 4 g');
    const built = buildFoodWrite(record, { writeVersion: 2, name: 'Yogurt', quantity: 1, lastUpdated: 't' });
    const identity = { id: 'item-1', name: 'Yogurt', quantity: 1, timestamp: 't' };
    const item = diaryFoodItem(built, identity, 2);
    expect(item.nutrientSchemaVersion).toBe(2);
    expect(item.protein).toBeNull();
    expect(item.nutrientMeta.quality.protein).toMatchObject({ status: 'label_reported', upperBound: 1 });
    expect(item.nutrientMeta.quality.fat).toMatchObject({ status: 'estimated_from_comparable' });
    expect(item.nutrientMeta.fiberMeaning).toBe('total');
    const read = readFoodNutrients(item);
    expect(read.values.protein).toBeNull();
    expect(read.quality.protein).toMatchObject({ status: 'label_reported', upperBound: 1 });
    expect(read.quality.fat.status).toBe('estimated_from_comparable');
    expect(read.fiberMeaning).toBe('total');

    const negative = Object.fromEntries(Object.entries(built.fields).map(([key, value]) => (
      [key, typeof value === 'number' ? -value : value]
    )));
    const subtracted = diaryFoodItem({ fields: negative, doc: built.doc }, { ...identity, name: 'Yogurt (subtracted)' }, 2);
    expect(subtracted.fat).toBe(-3);
    expect(subtracted.nutrientMeta.quality.protein.upperBound).toBe(1);

    const v1Built = buildFoodWrite(record, { writeVersion: 1, name: 'Yogurt', quantity: 1, lastUpdated: 't' });
    const v1Item = diaryFoodItem(v1Built, identity, 1);
    expect(Object.keys(v1Item)).toEqual(['id', 'name', 'quantity', 'timestamp', ...LEGACY_V1_KEYS]);
    expect(v1Item).not.toHaveProperty('nutrientSchemaVersion');
    expect(v1Item).not.toHaveProperty('nutrientMeta');
    expect(v1Item.protein).toBe(0);
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

  it('blank legacy overlay keeps an upper bound and a cleared number becomes unknown', () => {
    const record = parseNutritionText('Protein: <1 g\nFat: 3 g');
    expect(record.values.protein).toBeNull();
    expect(record.quality.protein).toMatchObject({ status: 'label_reported', upperBound: 1 });
    const overlaid = applyLegacyInputOverlay(record, { protein: '', fat: '3', calories: '' });
    expect(overlaid.values.protein).toBeNull();
    expect(overlaid.quality.protein).toMatchObject({ status: 'label_reported', upperBound: 1 });
    expect(overlaid.values.fat).toBe(3);
    expect(overlaid.quality.fat.status).toBe('label_reported');
    expect(overlaid.values.calories).toBeNull();
    expect(overlaid.quality.calories).toEqual({ status: 'unknown' });

    const cleared = applyLegacyInputOverlay(record, { fat: '' });
    expect(cleared.values.fat).toBeNull();
    expect(cleared.quality.fat).toEqual({ status: 'unknown' });
    expect(cleared.quality.protein).toMatchObject({ status: 'label_reported', upperBound: 1 });

    const replaced = applyLegacyInputOverlay(record, { protein: '4' });
    expect(replaced.values.protein).toBe(4);
    expect(replaced.quality.protein).toEqual({ status: 'label_reported' });

    const conflict = parseNutritionText('Protein: 10 g\nProtein: 12 g');
    expect(conflict.values.protein).toBeNull();
    const typed = applyLegacyInputOverlay(conflict, { protein: '12' });
    expect(typed.conflicts).toEqual([]);
    expect(typed.values.protein).toBe(12);

    const v2 = buildFoodWrite(overlaid, { writeVersion: 2, name: 'Yogurt', quantity: 1, lastUpdated: 't' });
    expect(v2.doc.protein).toBeNull();
    expect(v2.doc.nutrientMeta.quality.protein).toMatchObject({ status: 'label_reported', upperBound: 1 });
    const v1 = buildFoodWrite(overlaid, { writeVersion: 1, name: 'Yogurt', quantity: 1, lastUpdated: 't' });
    expect(Object.keys(v1.doc)).toEqual(['name', 'quantity', ...LEGACY_V1_KEYS, 'lastUpdated']);
    expect(v1.doc.protein).toBe(0);
    expect(v1.doc.fat).toBe(3);
    expect(v1.doc).not.toHaveProperty('nutrientSchemaVersion');
    expect(v1.doc).not.toHaveProperty('nutrientMeta');
  });

  it('drops anchored detail when the food name changes and keeps legacy values', () => {
    const record = parseNutritionText('Protein: 20 g\nSaturated Fat: 3 g\nFiber (total dietary): 4 g');
    expect(record.values.fatSaturated).toBe(3);
    expect(record.values.fiberTotal).toBe(4);
    expect(record.fiberMeaning).toBe('total');
    expect(foodNameLeavesStagedDetail(null, 'Chicken')).toBe(false);
    expect(foodNameLeavesStagedDetail('Salmon', 'salmon')).toBe(false);
    expect(foodNameLeavesStagedDetail('Salmon', 'Chicken')).toBe(true);
    const stripped = withoutStagedDetail(record);
    expect(stripped.values.protein).toBe(20);
    expect(stripped.values.fatSaturated).toBeNull();
    expect(stripped.values.fiberTotal).toBeNull();
    expect(stripped.fiberMeaning).toBe('unknown');
    const built = buildFoodWrite(stripped, { writeVersion: 2, name: 'Chicken', quantity: 1, lastUpdated: 't' });
    expect(built.doc.protein).toBe(20);
    expect(built.doc.fatSaturated).toBeNull();
    expect(built.doc.fiberTotal).toBeNull();
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
