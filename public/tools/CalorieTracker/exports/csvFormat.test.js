import { describe, expect, it } from 'vitest';
import { LEGACY_V1_KEYS, V2_DETAIL_KEYS } from '../../../shared/nutrition/nutrientRegistry.js';
import {
  decideCsvFoodWrite,
  formatSavedFoodsCsv,
  parseSavedFoodsCsv,
  savedFoodDocId,
  summarizeCsvImportWarnings,
  writeImportedFood,
} from './csvFormat.js';

describe('saved food CSV', () => {
  it('legacy CSV columns keep order and v2 columns are appended', () => {
    const food = {
      name: 'Egg "large"',
      quantity: 2,
      lastUpdated: '2020-01-01T00:00:00.000Z',
      calories: 165,
      protein: 31,
      sodium: 39340,
      fatSaturated: 1,
      nutrientMeta: { registryVersion: 2, quality: { sodium: { status: 'measured' } } },
    };
    const v1 = formatSavedFoodsCsv([food], 1);
    const v1Headers = v1.split('\n')[0].split(',').map((cell) => cell.slice(1, -1));
    expect(v1Headers).toEqual(['name', 'quantity', 'lastUpdated', ...LEGACY_V1_KEYS]);
    expect(v1).not.toContain('fatSaturated');
    expect(v1).not.toContain('nutrientMeta');
    expect(v1).toContain('"Egg ""large"""');
    expect(v1).toContain(',2,');
    expect(v1).toContain(',165,');

    const v2 = formatSavedFoodsCsv([food], 1 + 1);
    const v2Headers = v2.split('\n')[0].split(',').map((cell) => cell.slice(1, -1));
    expect(v2Headers.slice(0, 3 + LEGACY_V1_KEYS.length)).toEqual(['name', 'quantity', 'lastUpdated', ...LEGACY_V1_KEYS]);
    expect(v2Headers.slice(3 + LEGACY_V1_KEYS.length, -1)).toEqual([...V2_DETAIL_KEYS]);
    expect(v2Headers.at(-1)).toBe('nutrientMeta');
    expect(v2).toContain('39340');
  });

  it('CSV import maps exact headers, warns on unknown headers, empty cell is unknown in v2 and absent in v1', () => {
    const header = ['name', 'quantity', 'Vitamin B12', 'sodium', 'Saturated Fat', 'Mystery', 'vitaminb12'].map((cell) => `"${cell}"`).join(',');
    const row = ['Salt', '1', '', '', '2', '9', '0.4'].join(',');
    const csv = `${header}\n${row}\n`;
    const v1 = parseSavedFoodsCsv(csv, 1);
    expect(v1.unknownHeaders).toEqual(['Mystery']);
    expect(v1.rows[0].fields.sodium).toBeUndefined();
    expect(v1.rows[0].fields.vitaminB12).toBe(0.4);
    expect(v1.rows[0].fields.fatSaturated).toBeUndefined();
    expect(v1.warnings.some((warning) => warning.code === 'detail_not_stored')).toBe(true);

    const v2 = parseSavedFoodsCsv(csv, 1 + 1);
    expect(v2.rows[0].record.values.sodium).toBeNull();
    expect(v2.rows[0].record.values.fatSaturated).toBe(2);
    expect(v2.rows[0].record.values.vitaminB12).toBe(0.4);
    expect(v2.rows[0].fields.sodium).toBeUndefined();
    expect(v2.rows[0].rejected).toBe(false);
  });

  it('rejects conflicting duplicate columns and keeps a blank-plus-value pair', () => {
    const conflict = '"name","quantity","Vitamin B12","vitaminb12"\n"Egg","1","1","9"\n';
    const parsed = parseSavedFoodsCsv(conflict, 1);
    expect(parsed.rows[0].rejected).toBe(true);
    expect(parsed.rows[0].fields.vitaminB12).toBeUndefined();
    expect(parsed.rows[0].clamped).toBe(0);
    expect(parsed.warnings.some((warning) => warning.code === 'duplicate_column' && warning.key === 'vitaminB12')).toBe(true);
    const v2 = parseSavedFoodsCsv(conflict, 1 + 1);
    expect(v2.rows[0].rejected).toBe(true);
    expect(v2.rows[0].record.values.vitaminB12).toBeNull();

    const equal = parseSavedFoodsCsv('"name","quantity","Vitamin B12","vitaminb12"\n"Egg","1","0.4","0.4"\n', 1);
    expect(equal.rows[0].rejected).toBe(false);
    expect(equal.rows[0].fields.vitaminB12).toBe(0.4);

    const blankThen = parseSavedFoodsCsv('"name","quantity","sodium","Sodium"\n"Salt","1","5",""\n', 1 + 1);
    expect(blankThen.rows[0].rejected).toBe(false);
    expect(blankThen.rows[0].record.values.sodium).toBe(5);
  });

  it('reads the slugged target document before writing and keeps the v1 object shape', async () => {
    expect(savedFoodDocId('Chicken-Breast')).toBe('chicken_breast');
    expect(savedFoodDocId('Chicken Breast')).toBe(savedFoodDocId('Chicken-Breast'));
    const row = parseSavedFoodsCsv('"name","quantity","protein"\n"Chicken-Breast","1","20"\n', 1).rows[0];
    expect(decideCsvFoodWrite(row, { nutrientSchemaVersion: 2, name: 'Chicken Breast' }, 1, 't')).toEqual({
      action: 'skip',
      reason: 'newer-schema',
    });

    const egg = parseSavedFoodsCsv('"name","quantity","protein"\n"Egg","2","10"\n', 1).rows[0];
    expect(decideCsvFoodWrite(egg, null, 1, 't')).toEqual({
      action: 'write',
      doc: { name: 'Egg', quantity: 2, protein: 10, lastUpdated: 't' },
    });

    const salt = parseSavedFoodsCsv('"name","quantity","sodium"\n"Salt","1","39340"\n', 1 + 1).rows[0];
    const saltWrite = decideCsvFoodWrite(salt, null, 1 + 1, 't');
    expect(saltWrite.action).toBe('write');
    expect(saltWrite.doc.sodium).toBe(39340);
    expect(saltWrite.doc.nutrientSchemaVersion).toBe(2);

    const negative = parseSavedFoodsCsv('"name","quantity","sodium"\n"Salt","1","-5"\n', 1 + 1).rows[0];
    expect(decideCsvFoodWrite(negative, null, 1 + 1, 't')).toEqual({ action: 'skip', reason: 'bounds' });

    const sets = [];
    let gets = 0;
    const blocking = {
      async get() {
        gets += 1;
        return {
          exists: () => true,
          data: () => ({ nutrientSchemaVersion: 2, name: 'Chicken Breast' }),
        };
      },
      set(ref, data) { sets.push({ ref, data }); },
    };
    const blocked = await writeImportedFood(blocking, { id: 'chicken_breast' }, row, 1, 't');
    expect(blocked).toEqual({ action: 'skip', reason: 'newer-schema' });
    expect(gets).toBe(1);
    expect(sets).toEqual([]);

    const missing = {
      async get() {
        return { exists: () => false, data: () => undefined };
      },
      set(_ref, data) { sets.push(data); },
    };
    const written = await writeImportedFood(missing, { id: 'egg' }, egg, 1, 't');
    expect(written.action).toBe('write');
    expect(sets).toEqual([{ name: 'Egg', quantity: 2, protein: 10, lastUpdated: 't' }]);
    expect(sets[0].nutrientSchemaVersion).toBeUndefined();

    const rejectedGets = { async get() { throw new Error('should not read'); }, set() { throw new Error('should not write'); } };
    const conflict = parseSavedFoodsCsv('"name","quantity","Vitamin B12","vitaminb12"\n"Egg","1","1","9"\n', 1).rows[0];
    expect(await writeImportedFood(rejectedGets, { id: 'egg' }, conflict, 1, 't')).toEqual({
      action: 'skip',
      reason: 'conflict',
    });
  });

  it('summarizes import warnings without repeating unknown headers', () => {
    const text = summarizeCsvImportWarnings([
      { code: 'unknown_header', message: 'Unknown CSV headers: Mystery.' },
      { code: 'detail_not_stored' },
      { code: 'detail_not_stored' },
      { code: 'bad_number' },
      { code: 'bad_meta' },
      { code: 'duplicate_column' },
    ]);
    expect(text).not.toContain('Mystery');
    expect(text).toContain('2 detail value(s) were not stored while v2 writes are off.');
    expect(text).toContain('1 malformed number(s) were omitted.');
    expect(text).toContain('nutrientMeta was not valid JSON.');
    expect(text).toContain('1 conflicting duplicate column(s) blocked a row.');
  });
});