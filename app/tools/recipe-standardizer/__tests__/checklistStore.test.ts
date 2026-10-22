/* --- CONFIGURATION: checklist storage test fixtures --- */
/** Node tests for checklist parsing and best-effort device storage wrappers. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECKLIST_STORAGE_KEY,
  MAX_RECIPES,
  parseChecklistStore,
  pruneChecklistKeys,
  readChecklist,
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
});

describe('pruneChecklistKeys', () => {
  it('drops ticks for shopping items that no longer exist', () => {
    expect(pruneChecklistKeys(['flour', 'salt'], ['salt', 'sugar'])).toEqual(['salt']);
  });

  it('returns an empty list when the recipe has no shopping keys', () => {
    expect(pruneChecklistKeys(['flour'], [])).toEqual([]);
  });
});
