/* --- CONFIGURATION: checklist storage test fixtures --- */
/** Node tests for checklist parsing and best-effort device storage wrappers. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mergeStorageChecklist,
  CHECKLIST_STORAGE_KEY,
  MAX_RECIPES,
  checklistKeysForBaseline,
  checklistKeysForDisplay,
  parseChecklistStore,
  pruneChecklistKeys,
  readChecklist,
  sameChecklistKeys,
  saveChecklist,
} from '../lib/checklistStore';

const values = new Map<string, string>();
const storage = {
  getItem: (key: string): string | null => values.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    values.set(key, value);
  },
};

describe('parseChecklistStore', () => {
  it.each([
    ['bad JSON', '{'],
    ['wrong version', JSON.stringify({ version: 2, recipes: {} })],
    ['wrong recipes shape', JSON.stringify({ version: 1, recipes: [] })],
  ])('returns an empty store for %s', (_label, raw) => {
    expect(parseChecklistStore(raw)).toEqual({ version: 1, recipes: {} });
  });

  it('drops non-string keys, deduplicates keys, and drops malformed entries', () => {
    const parsed = parseChecklistStore({
      version: 1,
      recipes: {
        valid: { keys: ['flour', 2, 'flour', null, 'salt'], updatedAtMs: 10 },
        missingKeys: { updatedAtMs: 11 },
        missingTimestamp: { keys: ['sugar'] },
      },
    });
    expect(parsed.recipes).toEqual({
      valid: { keys: ['flour', 'salt'], updatedAtMs: 10 },
    });
  });

  it('keeps the 50 most recently updated recipe entries', () => {
    const recipes = Object.fromEntries(
      Array.from({ length: MAX_RECIPES + 10 }, (_unused, index) => [
        `recipe-${index}`,
        { keys: ['flour'], updatedAtMs: index },
      ]),
    );
    const parsed = parseChecklistStore({ version: 1, recipes });
    expect(Object.keys(parsed.recipes)).toHaveLength(MAX_RECIPES);
    expect(parsed.recipes['recipe-59']).toBeDefined();
    expect(parsed.recipes['recipe-9']).toBeUndefined();
  });
});

describe('checklist storage', () => {
  beforeEach(() => {
    values.clear();
    vi.stubGlobal('window', { localStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('round-trips saved checklist keys', () => {
    saveChecklist('recipe-a', ['flour', 'salt']);
    expect(readChecklist('recipe-a')).toEqual(['flour', 'salt']);
    expect(JSON.parse(values.get(CHECKLIST_STORAGE_KEY) ?? '{}')).toMatchObject({ version: 1 });
  });

  it('does not throw when storage reads fail', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: storage.setItem,
      },
    });
    expect(() => readChecklist('recipe-a')).not.toThrow();
    expect(readChecklist('recipe-a')).toEqual([]);
  });

  it('does not throw when storage writes fail', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
    });
    expect(() => saveChecklist('recipe-a', ['flour'])).not.toThrow();
  });

  it('removes a recipe entry when its checklist becomes empty', () => {
    saveChecklist('recipe-a', ['flour']);
    saveChecklist('recipe-a', []);
    expect(readChecklist('recipe-a')).toEqual([]);
  });

  it('keeps a fresh save newest when the device clock moves backward', () => {
    const recipes = Object.fromEntries(
      Array.from({ length: MAX_RECIPES }, (_unused, index) => [
        `recipe-${index}`,
        { keys: ['flour'], updatedAtMs: 100 + index },
      ]),
    );
    values.set(CHECKLIST_STORAGE_KEY, JSON.stringify({ version: 1, recipes }));
    vi.spyOn(Date, 'now').mockReturnValue(1);

    saveChecklist('recipe-new', ['salt']);

    const stored = JSON.parse(values.get(CHECKLIST_STORAGE_KEY) ?? '{}') as {
      recipes: Record<string, { updatedAtMs: number }>;
    };
    expect(stored.recipes['recipe-new']?.updatedAtMs).toBe(150);
    expect(stored.recipes['recipe-new']).toBeDefined();
    expect(stored.recipes['recipe-0']).toBeUndefined();
  });
});

describe('pruneChecklistKeys', () => {
  it('drops ticks for shopping items that no longer exist', () => {
    expect(pruneChecklistKeys(['flour', 'salt'], ['salt', 'sugar'])).toEqual(['salt']);
  });

  it('returns an empty list when the recipe has no shopping keys', () => {
    expect(pruneChecklistKeys(['flour'], [])).toEqual([]);
  });
});

describe('draft and baseline checklist keys', () => {
  it('hides ticks invalid for the draft while retaining ticks valid for the saved baseline', () => {
    const checked = ['flour', 'salt'];
    const draftKeys = ['bread flour', 'salt'];
    const baselineKeys = ['flour', 'salt'];

    expect(checklistKeysForDisplay(checked, draftKeys)).toEqual(['salt']);
    expect(checklistKeysForBaseline(checked, baselineKeys)).toEqual(['flour', 'salt']);
  });
});

describe('sameChecklistKeys', () => {
  it('compares keys without considering order or duplicates', () => {
    expect(sameChecklistKeys(['flour', 'salt', 'flour'], ['salt', 'flour'])).toBe(true);
  });

  it('detects a different key set', () => {
    expect(sameChecklistKeys(['flour'], ['salt'])).toBe(false);
  });
});

describe('mergeStorageChecklist', () => {
  it('adopts stored ticks and keeps ticks on ingredients not yet saved', () => {
    expect(mergeStorageChecklist(['flour'], ['salt', 'milk'], ['flour', 'salt'])).toEqual(['flour', 'milk']);
  });

  it('dedupes keys present in both sets', () => {
    expect(mergeStorageChecklist(['milk'], ['milk'], [])).toEqual(['milk']);
  });
});
