import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fingerprintTrackerFoodV1, parseTrackerFood } from '@/app/tools/recipe-standardizer/lib/trackerFoods';
import { LEGACY_V1_KEYS } from '@/public/shared/nutrition/nutrientRegistry.js';
import { censusFromFixtures, encodeBackup, refuseUnsafeRun, type CensusUser } from './nutrientCensusLogic';

const SENTINEL_NAME = 'zz-sentinel-food-name';
const SENTINEL_VALUE = 8675309;

function legacyNumbers(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...Object.fromEntries(LEGACY_V1_KEYS.map((key) => [key, 0])),
    ...overrides,
  };
}

describe('nutrient census', () => {
  it('census counts v1/v2/other shapes, collisions and fingerprint formats from fixtures without emitting names or values', () => {
    const verifiedFood = {
      name: SENTINEL_NAME,
      quantity: 1,
      ...legacyNumbers({ sodium: SENTINEL_VALUE }),
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const parsed = parseTrackerFood('food-verified', verifiedFood);
    expect(parsed).not.toBeNull();
    const verifiedFingerprint = fingerprintTrackerFoodV1(parsed!);
    const expandedFood = {
      name: SENTINEL_NAME,
      quantity: 1,
      ...legacyNumbers({ sodium: 1 }),
      fatSaturated: 4,
      nutrientSchemaVersion: 2,
      nutrientMeta: { registryVersion: 2, quality: {} },
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const expanded = parseTrackerFood('food-expanded', expandedFood);
    const expandedFingerprint = fingerprintTrackerFoodV1(expanded!);

    const users: CensusUser[] = [
      {
        uid: 'user-a',
        foods: [
          { id: 'food-verified', data: verifiedFood },
          { id: 'food-null', data: { name: SENTINEL_NAME, quantity: 1, ...legacyNumbers({ sodium: null }) } },
          { id: 'food-text', data: { name: SENTINEL_NAME, quantity: 1, ...legacyNumbers({ calories: 'twelve' }) } },
          {
            id: 'food-collision',
            data: { name: SENTINEL_NAME, quantity: 1, ...legacyNumbers(), fatSaturated: SENTINEL_VALUE, nutrientMeta: { registryVersion: 2 } },
          },
          { id: 'food-expanded', data: expandedFood },
          { id: 'food-other', data: { name: SENTINEL_NAME, quantity: 1, nutrientSchemaVersion: 3, ...legacyNumbers() } },
        ],
        dailyEntries: [
          {
            id: '2026-11-01',
            data: {
              date: '2026-11-01',
              foodItems: [
                { id: 'item-1', name: SENTINEL_NAME, calories: SENTINEL_VALUE, fatSaturated: 1 },
                { id: 'item-2', name: SENTINEL_NAME, calories: 1 },
              ],
            },
          },
          { id: '2026-11-02', data: { date: '2026-11-02', notes: SENTINEL_NAME } },
        ],
        recipes: [
          {
            id: 'recipe-1',
            data: {
              name: SENTINEL_NAME,
              recipe: {
                name: SENTINEL_NAME,
                ingredients: [
                  { nutritionLink: { status: 'confirmed', foodItemId: 'food-verified', targetFingerprint: verifiedFingerprint } },
                  { nutritionLink: { status: 'confirmed', foodItemId: 'food-verified', targetFingerprint: '00000000' } },
                  { nutritionLink: { status: 'confirmed', foodItemId: 'food-expanded', targetFingerprint: expandedFingerprint } },
                  { nutritionLink: { status: 'confirmed', foodItemId: 'food-expanded', targetFingerprint: 'v2:deadbeef' } },
                  { nutritionLink: { status: 'confirmed', foodItemId: 'missing', targetFingerprint: 'not-a-hash' } },
                  { nutritionLink: { status: 'candidate', foodItemId: 'food-verified', targetFingerprint: verifiedFingerprint } },
                ],
                nutritionExports: {
                  perPortion: { nutritionFingerprint: verifiedFingerprint, foodId: 'food-verified', foodName: SENTINEL_NAME },
                  per100gCooked: { nutritionFingerprint: 'v2:cafebabe', foodId: 'food-expanded' },
                },
              },
            },
          },
        ],
      },
      { uid: 'user-b', foods: [], dailyEntries: [], recipes: [] },
    ];

    const report = censusFromFixtures(users);
    expect(report.users).toBe(2);
    expect(report.foodItems).toEqual({
      total: 6,
      v1: 4,
      v2: 1,
      other: 1,
      nonNumericOrNullLegacy: 2,
      collisions: 1,
    });
    expect(report.dailyEntries.total).toBe(2);
    expect(report.dailyEntries.foodItemElements).toBe(2);
    expect(report.dailyEntries.elementCollisions).toBe(1);
    expect(report.dailyEntries.largestBytes).toBeGreaterThan(0);
    expect(report.recipes).toBe(1);
    expect(report.confirmedLinks).toBe(5);
    expect(report.exportRefs).toBe(2);
    expect(report.fingerprints.confirmedLinks).toEqual({ hex8: 3, v2: 1, other: 1 });
    expect(report.fingerprints.exportRefs).toEqual({ hex8: 1, v2: 1, other: 0 });
    expect(report.v1Links).toEqual({ verified: 2, stale: 2 });

    const printed = JSON.stringify(report);
    expect(printed).not.toContain(SENTINEL_NAME);
    expect(printed).not.toContain(String(SENTINEL_VALUE));
    expect(printed).not.toContain('food-verified');
    expect(printed).not.toContain('user-a');
  });

  it('backup encoding keeps typed values', () => {
    const encoded = encodeBackup({ sodium: 39340, fatSaturated: null, quantity: 1, nested: { water: 0 } });
    const round = JSON.parse(JSON.stringify(encoded)) as {
      sodium: number;
      fatSaturated: null;
      quantity: number;
      nested: { water: number };
    };
    expect(round).toEqual(encoded);
    expect(round.sodium).toBe(39340);
    expect(round.fatSaturated).toBeNull();
    expect(typeof round.sodium).toBe('number');
    expect(typeof round.quantity).toBe('number');
  });

  it('refuses to run without --dry-run or with an existing output directory', () => {
    expect(() => refuseUnsafeRun({ dryRun: false, outputDirExists: false })).toThrow(/dry-run/);
    expect(() => refuseUnsafeRun({ dryRun: true, outputDirExists: true })).toThrow(/output directory/);
    expect(() => refuseUnsafeRun({ dryRun: true, outputDirExists: false })).not.toThrow();
  });

  it('has no write code path', () => {
    const source = readFileSync(new URL('./nutrientCensus.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\.set\s*\(/);
    expect(source).not.toMatch(/\.update\s*\(/);
    expect(source).not.toMatch(/\.delete\s*\(/);
    expect(source).not.toMatch(/\.create\s*\(/);
    expect(source).not.toMatch(/\bbatch\s*\(/);
    expect(source).not.toMatch(/from\s+['"]firebase-admin/);
    expect(source).toMatch(/import\('firebase-admin\/app'\)/);
    expect(source).toMatch(/import\('firebase-admin\/firestore'\)/);
  });
});
