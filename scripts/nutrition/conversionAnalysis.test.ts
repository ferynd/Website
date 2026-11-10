import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  LEGACY_V1_KEYS,
  V2_DETAIL_KEYS,
  readNutrientFields,
  toV2Fields,
} from '../../public/shared/nutrition/nutrientRegistry.js';
import { NUTRIENT_V2_WRITES_ENABLED, INGREDIENT_STORE_WRITES_ENABLED } from '../../public/shared/nutrition/capabilities.js';
import {
  conversionVerdict,
  classifyBasis,
  quantityState,
  summarizeConversion,
  SITE_CODEC,
  REASON_CODES,
  BASIS_CLASSES,
  type ConversionCodec,
} from './conversionAnalysis';
import { main, isProcessEntry, ConversionCliError, REPO_ROOT } from './conversionAnalysisCli';

// Synthetic fixtures only. Every value is distinctive so the sentinel test can look for it.
const SYNTHETIC_NAME = 'Zephyrquill Synthetic Crumble';
const SYNTHETIC_ID = 'synthetic-fixture-id-qx41';

function flatFood(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const doc: Record<string, unknown> = { name: `${SYNTHETIC_NAME} (2 bars)` };
  LEGACY_V1_KEYS.forEach((key, index) => {
    doc[key] = 731.0917 + index * 1.0013;
  });
  return { ...doc, ...overrides };
}

function without(doc: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...doc };
  delete copy[key];
  return copy;
}

const temp: string[] = [];
afterEach(async () => {
  await Promise.all(temp.splice(0).map(p => rm(p, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'conv77-'));
  temp.push(dir);
  return dir;
}

describe('conversionVerdict: clean', () => {
  it('a complete flat v1 food converts losslessly through the site code', () => {
    const verdict = conversionVerdict(flatFood());
    expect(verdict.status).toBe('clean');
    expect(verdict.reasons).toEqual([]);
    expect(verdict.roundTrip).toEqual({
      legacyIdentical: LEGACY_V1_KEYS.length,
      detailNull: V2_DETAIL_KEYS.length,
      detailNonNull: 0,
      fiberMeaningSet: false,
      carbConventionSet: false,
    });
  });

  it('the real conversion keeps every legacy value, nulls every detail key, and invents no meaning', () => {
    const doc = flatFood({ fiber: 0, omega3: 0 });
    const converted = toV2Fields(readNutrientFields(doc));
    for (const key of LEGACY_V1_KEYS) {
      expect(converted.fields[key]).toBe(doc[key]);
      expect(converted.nutrientMeta.quality[key]).toEqual({ status: 'legacy_unclassified' });
    }
    for (const key of V2_DETAIL_KEYS) {
      expect(converted.fields[key]).toBeNull();
      expect(converted.nutrientMeta.quality[key]).toBeUndefined();
    }
    expect(converted.nutrientMeta).not.toHaveProperty('fiberMeaning');
    expect(converted.nutrientMeta).not.toHaveProperty('carbConvention');
    expect(conversionVerdict(doc).status).toBe('clean');
  });

  it('stored zeros and reserved fields carried verbatim stay clean', () => {
    const doc = flatFood({
      calories: 0,
      quantity: 0,
      id: SYNTHETIC_ID,
      timestamp: 'synthetic',
      lastUpdated: 'synthetic',
      nutrientSchemaVersion: 1,
    });
    expect(conversionVerdict(doc).status).toBe('clean');
  });
});

describe('conversionVerdict: blocked reasons', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['name absent', without(flatFood(), 'name'), 'missing_name'],
    ['name empty', flatFood({ name: '' }), 'missing_name'],
    ['name whitespace', flatFood({ name: '   ' }), 'missing_name'],
    ['name not a string', flatFood({ name: 42 }), 'missing_name'],
    ['legacy key absent', without(flatFood(), 'vitaminK'), 'missing_key'],
    ['legacy key undefined', flatFood({ iodine: undefined }), 'missing_key'],
    ['legacy key null', flatFood({ selenium: null }), 'null_value'],
    ['numeric string', flatFood({ protein: '12' }), 'non_numeric_value'],
    ['empty string', flatFood({ protein: '' }), 'non_numeric_value'],
    ['NaN', flatFood({ carbs: Number.NaN }), 'non_numeric_value'],
    ['Infinity', flatFood({ fat: Number.POSITIVE_INFINITY }), 'non_numeric_value'],
    ['negative', flatFood({ sodium: -1 }), 'negative_value'],
    ['unknown field', flatFood({ brandNotes: 'synthetic' }), 'extra_field'],
    ['detail key present', flatFood({ [V2_DETAIL_KEYS[0]]: 1 }), 'v2_collision'],
    ['detail key null', flatFood({ [V2_DETAIL_KEYS[0]]: null }), 'v2_collision'],
    ['nutrientMeta present', flatFood({ nutrientMeta: {} }), 'v2_collision'],
    ['already v2', flatFood({ nutrientSchemaVersion: 2 }), 'already_v2'],
  ];
  it.each(cases)('%s', (_label, doc, reason) => {
    const verdict = conversionVerdict(doc);
    expect(verdict.status).toBe('blocked');
    expect(verdict.reasons).toContain(reason);
  });

  it('reports every reason once, in stable order', () => {
    const doc = flatFood({ name: '', calories: null, protein: -2, extra: 1, nutrientMeta: {} });
    expect(conversionVerdict(doc).reasons).toEqual(['missing_name', 'null_value', 'negative_value', 'extra_field', 'v2_collision']);
  });

  it('skips the round trip when a stored value cannot be represented', () => {
    expect(conversionVerdict(flatFood({ zinc: null })).roundTrip).toBeNull();
  });
});

describe('conversionVerdict: the round trip is a real check', () => {
  // These codecs stand in for a regression in the site code. If step 5 were removed, all three would pass as clean.
  const roundingCodec: ConversionCodec = {
    readNutrientFields: SITE_CODEC.readNutrientFields,
    toV2Fields: record => {
      const converted = SITE_CODEC.toV2Fields(record);
      converted.fields.calories = Math.round(converted.fields.calories ?? 0);
      return converted;
    },
  };
  const zeroFillCodec: ConversionCodec = {
    readNutrientFields: SITE_CODEC.readNutrientFields,
    toV2Fields: record => {
      const converted = SITE_CODEC.toV2Fields(record);
      for (const key of V2_DETAIL_KEYS) converted.fields[key] = 0;
      return converted;
    },
  };
  const meaningCodec: ConversionCodec = {
    readNutrientFields: SITE_CODEC.readNutrientFields,
    toV2Fields: record => {
      const converted = SITE_CODEC.toV2Fields(record);
      converted.nutrientMeta.fiberMeaning = 'total';
      return converted;
    },
  };
  const statusCodec: ConversionCodec = {
    readNutrientFields: SITE_CODEC.readNutrientFields,
    toV2Fields: record => {
      const converted = SITE_CODEC.toV2Fields(record);
      converted.nutrientMeta.quality.calories = { status: 'measured' };
      return converted;
    },
  };

  it('a changed stored value is round_trip_mismatch', () => {
    const verdict = conversionVerdict(flatFood(), roundingCodec);
    expect(verdict).toMatchObject({ status: 'blocked', reasons: ['round_trip_mismatch'] });
    expect(verdict.roundTrip?.legacyIdentical).toBe(LEGACY_V1_KEYS.length - 1);
  });

  it('a zero-filled detail key is invented_detail', () => {
    const verdict = conversionVerdict(flatFood(), zeroFillCodec);
    expect(verdict).toMatchObject({ status: 'blocked', reasons: ['invented_detail'] });
    expect(verdict.roundTrip?.detailNonNull).toBe(V2_DETAIL_KEYS.length);
  });

  it('an invented fiber meaning or a changed legacy status is meta_mismatch', () => {
    expect(conversionVerdict(flatFood(), meaningCodec)).toMatchObject({ status: 'blocked', reasons: ['meta_mismatch'] });
    expect(conversionVerdict(flatFood(), statusCodec)).toMatchObject({ status: 'blocked', reasons: ['meta_mismatch'] });
  });
});

describe('classifyBasis', () => {
  const cases: Array<[unknown, string]> = [
    ['Synthetic oats (40g)', 'weight_stated'],
    ['Synthetic oats (100g)', 'weight_stated'],
    ['Synthetic juice (250 ml)', 'weight_stated'],
    ['Synthetic nuts (1 oz)', 'weight_stated'],
    ['Synthetic bar (1 bar, 45g)', 'weight_stated'],
    ['Synthetic rice 100g', 'weight_stated'],
    ['Synthetic rice 1.5 oz', 'weight_stated'],
    ['Synthetic cookie (2 pc)', 'count_unit_stated'],
    ['Synthetic soda (1 can)', 'count_unit_stated'],
    ['Synthetic shake (scoop)', 'count_unit_stated'],
    ['Synthetic bread (1 slice)', 'count_unit_stated'],
    ['Synthetic chips 1 bag', 'count_unit_stated'],
    ['Synthetic gummies 3ct', 'count_unit_stated'],
    ['Synthetic soup (homemade)', 'other_basis_stated'],
    ['Synthetic pasta (half portion)', 'other_basis_stated'],
    ['Synthetic granola bar', 'no_explicit_basis'],
    ['Synthetic stew', 'no_explicit_basis'],
    ['Synthetic (old) stew', 'no_explicit_basis'],
    [undefined, 'no_explicit_basis'],
  ];
  it.each(cases)('%s -> %s', (name, expected) => {
    expect(classifyBasis(name)).toBe(expected);
  });
});

describe('quantityState', () => {
  it('distinguishes absent, zero, and present', () => {
    expect(quantityState({})).toBe('absent');
    expect(quantityState({ quantity: undefined })).toBe('absent');
    expect(quantityState({ quantity: 0 })).toBe('zero');
    expect(quantityState({ quantity: '0' })).toBe('zero');
    expect(quantityState({ quantity: 2 })).toBe('present_nonzero');
    expect(quantityState({ quantity: null })).toBe('present_nonzero');
  });
});

describe('summarizeConversion', () => {
  const extract = [
    { id: SYNTHETIC_ID, data: flatFood({ quantity: 0 }) },
    { id: 'synthetic-fixture-id-qx42', data: flatFood({ name: 'Synthetic oats (40g)', quantity: 1 }) },
    flatFood({ name: 'Synthetic stew' }),
    { id: 'synthetic-fixture-id-qx43', data: flatFood({ selenium: null, quantity: 0 }) },
    { id: 'synthetic-fixture-id-qx44', data: flatFood({ name: 'Synthetic soup (homemade)', nutrientSchemaVersion: 2, nutrientMeta: {} }) },
  ];

  it('counts verdicts, reasons, basis, values, and quantity', () => {
    const summary = summarizeConversion(extract);
    expect(summary.total).toBe(5);
    expect(summary.schema).toEqual({ v1: 4, v2: 1 });
    expect(summary.clean).toBe(3);
    expect(summary.blocked).toBe(2);
    expect(summary.reasons).toMatchObject({ null_value: 1, v2_collision: 1, already_v2: 1, round_trip_mismatch: 0 });
    expect(Object.keys(summary.reasons)).toEqual([...REASON_CODES]);
    expect(summary.basis).toEqual({ weight_stated: 1, count_unit_stated: 2, other_basis_stated: 1, no_explicit_basis: 1 });
    expect(Object.keys(summary.basis)).toEqual([...BASIS_CLASSES]);
    expect(summary.legacyValues).toEqual({ checked: 5 * LEGACY_V1_KEYS.length, identical: 3 * LEGACY_V1_KEYS.length });
    expect(summary.convertedDetailValues).toEqual({ null: 3 * V2_DETAIL_KEYS.length, nonNull: 0 });
    expect(summary.nutrientMeta).toEqual({ fiberMeaningSet: 0, carbConventionSet: 0 });
    expect(summary.quantity).toEqual({ present: 3, zero: 2, absent: 2 });
    expect(summary.clean + summary.blocked).toBe(summary.total);
  });

  it('sentinel: the summary has numbers only and no fixture name, id, or nutrient value', () => {
    const summary = summarizeConversion(extract);
    const text = JSON.stringify(summary);
    for (const needle of [SYNTHETIC_NAME, 'Synthetic', SYNTHETIC_ID, 'qx4', '731', '0917', '1.0013']) {
      expect(text).not.toContain(needle);
    }
    const leaves: unknown[] = [];
    const walk = (value: unknown): void => {
      if (value && typeof value === 'object') Object.values(value).forEach(walk);
      else leaves.push(value);
    };
    walk(summary);
    expect(leaves.every(value => Number.isInteger(value))).toBe(true);
  });

  it('treats a non-object item as a blocked empty document', () => {
    const summary = summarizeConversion([null, 'x', 3]);
    expect(summary).toMatchObject({ total: 3, clean: 0, blocked: 3 });
    expect(summary.reasons.missing_name).toBe(3);
  });
});

describe('conversionAnalysisCli', () => {
  async function run(args: string[]): Promise<string> {
    let out = '';
    await main(['node', 'cli', '--', ...args], { write: text => { out += text; } });
    return out;
  }

  it('prints aggregates only for an extract outside the checkout', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'foods.json');
    await writeFile(file, JSON.stringify([{ id: SYNTHETIC_ID, data: flatFood() }, flatFood({ name: 'Synthetic oats (40g)' })]));
    const out = await run(['--extract', file]);
    expect(JSON.parse(out)).toMatchObject({ total: 2, clean: 2, blocked: 0 });
    for (const needle of [SYNTHETIC_NAME, SYNTHETIC_ID, 'Synthetic', '731', dir]) expect(out).not.toContain(needle);
  });

  it('refuses an extract inside the checkout, directly or through a symlink', async () => {
    await expect(run(['--extract', path.join(REPO_ROOT, 'package.json')])).rejects.toThrow('outside the checkout');
    const dir = await tempDir();
    const link = path.join(dir, 'link.json');
    await symlink(path.join(REPO_ROOT, 'package.json'), link);
    await expect(run(['--extract', link])).rejects.toThrow('outside the checkout');
  });

  it('error messages carry no path or extract content', async () => {
    const dir = await tempDir();
    const bad = path.join(dir, 'bad.json');
    await writeFile(bad, `[{"name":"${SYNTHETIC_NAME}", "calories": 731.0917,`);
    const notArray = path.join(dir, 'object.json');
    await writeFile(notArray, JSON.stringify({ id: SYNTHETIC_ID, name: SYNTHETIC_NAME }));
    for (const args of [[], ['--extract', bad], ['--extract', notArray], ['--extract', path.join(dir, 'missing.json')], ['--bogus', SYNTHETIC_ID]]) {
      const error = await run(args).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(ConversionCliError);
      const message = (error as Error).message;
      for (const needle of [SYNTHETIC_NAME, SYNTHETIC_ID, '731', dir]) expect(message).not.toContain(needle);
    }
  });

  it('the entry guard fires under vite-node and for a direct launch, not under another runner', () => {
    const script = path.join(REPO_ROOT, 'scripts/nutrition/conversionAnalysisCli.ts');
    expect(isProcessEntry(['node', '/x/node_modules/.bin/vite-node', '--', '--extract', 'f'], script)).toBe(true);
    expect(isProcessEntry(['node', '/x/node_modules/vite-node/vite-node.mjs'], script)).toBe(true);
    expect(isProcessEntry(['node', script], script)).toBe(true);
    expect(isProcessEntry(['node', '/x/node_modules/vitest/vitest.mjs'], script)).toBe(false);
    expect(isProcessEntry(['node'], script)).toBe(false);
  });

  it('both write flags stay false', () => {
    expect(NUTRIENT_V2_WRITES_ENABLED).toBe(false);
    expect(INGREDIENT_STORE_WRITES_ENABLED).toBe(false);
  });
});
