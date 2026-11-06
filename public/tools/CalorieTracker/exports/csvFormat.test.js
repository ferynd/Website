import { describe, expect, it } from 'vitest';
import { LEGACY_V1_KEYS, V2_DETAIL_KEYS } from '../../../shared/nutrition/nutrientRegistry.js';
import { formatSavedFoodsCsv, parseSavedFoodsCsv } from './csvFormat.js';

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
  });
});