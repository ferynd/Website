/* --- CONFIGURATION: nutrition export reference test cases --- */
const INVALID_IDS = ['', 'has/slash', '__reserved__'];
const INVALID_TIMES = [Number.NaN, Number.POSITIVE_INFINITY, -1];

/**
 * Covers defensive stored-reference parsing, equality, ownership, and link-target conversion.
 */

import { describe, expect, it } from 'vitest';
import { butterCookiesRecipe, exportedRef } from './exportFixtures';
import {
  exportLinkTarget,
  exportOwnership,
  parseNutritionExport,
  parseNutritionExports,
  sameNutritionExport,
  withoutNutritionExports,
} from '../lib/nutritionExportRef';

describe('nutritionExportRef', () => {
  it('parses a complete stored ref unchanged', () => {
    const ref = exportedRef();
    expect(parseNutritionExport(ref, ref.basis, 'nutritionExports.perPortion', [])).toEqual(ref);
  });

  it.each(INVALID_IDS)(
    'returns null with a warning when foodId is empty, contains a slash, or is reserved',
    (foodId) => {
      const warnings: string[] = [];
      expect(
        parseNutritionExport(exportedRef({ foodId }), 'perPortion', 'nutritionExports.perPortion', warnings),
      ).toBeNull();
      expect(warnings).toHaveLength(1);
    },
  );

  it('returns null with a warning when basis inside the ref disagrees with its map key', () => {
    const warnings: string[] = [];
    expect(
      parseNutritionExport(exportedRef({ basis: 'per100gCooked' }), 'perPortion', 'path', warnings),
    ).toBeNull();
    expect(warnings[0]).toContain('unreadable');
  });

  it.each(INVALID_TIMES)(
    'returns null with a warning for non-finite exportedAtMs or negative counts',
    (value) => {
      const warnings: string[] = [];
      const bad =
        Number.isFinite(value) && value < 0
          ? exportedRef({ includedCount: value })
          : exportedRef({ exportedAtMs: value });
      expect(parseNutritionExport(bad, 'perPortion', 'path', warnings)).toBeNull();
      expect(warnings).toHaveLength(1);
    },
  );

  it.each([undefined, null, [], 'bad'])(
    'parseNutritionExports returns {} silently for undefined, null, arrays, and strings',
    (value) => {
      const warnings: string[] = [];
      expect(parseNutritionExports(value, warnings)).toEqual({});
      expect(warnings).toEqual([]);
    },
  );

  it('parseNutritionExports ignores unknown basis keys with a warning', () => {
    const warnings: string[] = [];
    expect(parseNutritionExports({ unknown: exportedRef() }, warnings)).toEqual({});
    expect(warnings[0]).toContain('unknown export basis');
  });

  it.each([
    ['basis', 'per100gCooked'],
    ['recipeId', 'recipe-2'],
    ['foodId', 'other'],
    ['foodName', 'Different'],
    ['foodLastUpdated', '2025-02-01T00:00:00.000Z'],
    ['nutritionFingerprint', 'different'],
    ['exportedAtMs', 2],
    ['coverage', 'partial'],
    ['includedCount', 2],
    ['totalCount', 2],
    ['portionCount', 2],
    ['portionSizeG', 20],
    ['finalWeightG', 20],
  ] as const)(
    'sameNutritionExport is true for null/null and identical refs, false when any field differs',
    (field, value) => {
      const ref = exportedRef();
      const changed = { ...ref, [field]: value } as typeof ref;
      expect(sameNutritionExport(null, null)).toBe(true);
      expect(sameNutritionExport(ref, exportedRef())).toBe(true);
      expect(sameNutritionExport(ref, changed)).toBe(false);
    },
  );

  it('withoutNutritionExports removes refs and reports removed=true; is a no-op on {}', () => {
    const recipe = { ...butterCookiesRecipe(), nutritionExports: { perPortion: exportedRef() } };
    expect(withoutNutritionExports(recipe)).toEqual({
      recipe: { ...recipe, nutritionExports: {} },
      removed: true,
    });
    expect(withoutNutritionExports(butterCookiesRecipe()).removed).toBe(false);
  });

  it('exportOwnership is foreign for a different recipeId and for an unsaved recipe (null id)', () => {
    const ref = exportedRef();
    expect(exportOwnership(ref, 'recipe-1')).toBe('own');
    expect(exportOwnership(ref, 'recipe-2')).toBe('foreign');
    expect(exportOwnership(ref, null)).toBe('foreign');
  });

  it('exportLinkTarget normalizes the food name and carries fingerprint/lastUpdated', () => {
    expect(exportLinkTarget(exportedRef())).toEqual({
      id: 'butter_cookies__per_portion_',
      fingerprint: 'snapshot',
      normalizedName: 'butter cookies per portion',
      lastUpdated: '2025-01-01T00:00:00.000Z',
    });
  });
});
