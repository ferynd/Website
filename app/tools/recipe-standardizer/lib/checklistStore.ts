/* --- CONFIGURATION: local checklist storage --- */
/** Device-local checklist ticks, isolated by saved recipe and bounded by least-recent use. */

/** Storage key for the versioned checklist object. */
export const CHECKLIST_STORAGE_KEY = 'recipe-standardizer:checklist';
/** Maximum number of saved recipe checklists retained on this device. */
export const MAX_RECIPES = 50;
const STORE_VERSION = 1;
const INITIAL_UPDATED_AT_MS = 0;
const UPDATED_AT_INCREMENT_MS = 1;

/** A saved recipe's checked normalized shopping item keys and last update time. */
export interface ChecklistEntry {
  /** Normalized ingredient-name keys from the consolidated shopping list. */
  keys: string[];
  /** Timestamp used to evict least-recently-updated recipes at the storage cap. */
  updatedAtMs: number;
}

/** Versioned collection of device-local ingredient checklists. */
export interface ChecklistStore {
  /** Storage schema version. */
  version: 1;
  /** Checklist entries indexed by Firestore recipe ID. */
  recipes: Record<string, ChecklistEntry>;
}

interface ChecklistStorage {
  /** Reads one storage value. */
  getItem(key: string): string | null;
  /** Writes one storage value. */
  setItem(key: string, value: string): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getStorage = (): ChecklistStorage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const capRecipes = (recipes: Record<string, ChecklistEntry>): Record<string, ChecklistEntry> => {
  const entries = Object.entries(recipes);
  if (entries.length <= MAX_RECIPES) return recipes;
  entries.sort(([, first], [, second]) => second.updatedAtMs - first.updatedAtMs);
  return Object.fromEntries(entries.slice(0, MAX_RECIPES));
};

/** Parse and sanitize persisted checklist data, returning an empty store for invalid input. */
export const parseChecklistStore = (raw: unknown): ChecklistStore => {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { version: STORE_VERSION, recipes: {} };
    }
  }
  if (!isRecord(value) || value.version !== STORE_VERSION || !isRecord(value.recipes)) {
    return { version: STORE_VERSION, recipes: {} };
  }

  const recipes: Record<string, ChecklistEntry> = {};
  Object.entries(value.recipes).forEach(([recipeId, candidate]) => {
    if (
      !isRecord(candidate) ||
      !Array.isArray(candidate.keys) ||
      typeof candidate.updatedAtMs !== 'number' ||
      !Number.isFinite(candidate.updatedAtMs)
    ) {
      return;
    }
    recipes[recipeId] = {
      keys: Array.from(new Set(candidate.keys.filter((key): key is string => typeof key === 'string'))),
      updatedAtMs: candidate.updatedAtMs,
    };
  });
  return { version: STORE_VERSION, recipes: capRecipes(recipes) };
};

/** Keep only checked keys that still exist in the recipe's current shopping list. */
export const pruneChecklistKeys = (keys: string[], currentKeys: string[]): string[] => {
  const validKeys = new Set(currentKeys);
  return keys.filter((key) => validKeys.has(key));
};

/** Keep visible ticks limited to the current draft's shopping items. */
export const checklistKeysForDisplay = (keys: string[], draftKeys: string[]): string[] =>
  pruneChecklistKeys(keys, draftKeys);

/** Keep persisted ticks aligned with the saved recipe, even while its draft is edited. */
export const checklistKeysForBaseline = (keys: string[], baselineKeys: string[]): string[] =>
  pruneChecklistKeys(keys, baselineKeys);

/** Compare checklist keys as sets, ignoring ordering and duplicate keys. */
export const sameChecklistKeys = (left: string[], right: string[]): boolean => {
  const leftKeys = new Set(left);
  const rightKeys = new Set(right);
  if (leftKeys.size !== rightKeys.size) return false;
  return Array.from(leftKeys).every((key) => rightKeys.has(key));
};

/** Merge another tab's stored ticks with this tab's ticks on ingredients not yet saved. */
export const mergeStorageChecklist = (
  storedKeys: string[],
  currentKeys: string[],
  baselineKeys: string[],
): string[] => {
  const savedKeys = new Set(baselineKeys);
  const unsavedTicks = currentKeys.filter((key) => !savedKeys.has(key));
  return Array.from(new Set([...storedKeys, ...unsavedTicks]));
};

/** Read one saved recipe checklist; unavailable storage and malformed data produce no ticks. */
export const readChecklist = (recipeId: string): string[] => {
  const storage = getStorage();
  if (storage === null) return [];
  try {
    const store = parseChecklistStore(storage.getItem(CHECKLIST_STORAGE_KEY));
    return store.recipes[recipeId]?.keys ?? [];
  } catch {
    return [];
  }
};

/** Save a checklist and apply the LRU cap; an empty list removes that recipe's entry. */
export const saveChecklist = (recipeId: string, keys: string[]): void => {
  const storage = getStorage();
  if (storage === null) return;
  try {
    const store = parseChecklistStore(storage.getItem(CHECKLIST_STORAGE_KEY));
    if (keys.length === 0) {
      delete store.recipes[recipeId];
    } else {
      const maxStoredUpdatedAtMs = Math.max(
        INITIAL_UPDATED_AT_MS,
        ...Object.values(store.recipes).map((entry) => entry.updatedAtMs),
      );
      store.recipes[recipeId] = {
        keys: Array.from(new Set(keys)),
        updatedAtMs: Math.max(Date.now(), maxStoredUpdatedAtMs + UPDATED_AT_INCREMENT_MS),
      };
    }
    const nextStore: ChecklistStore = {
      version: STORE_VERSION,
      recipes: capRecipes(store.recipes),
    };
    storage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(nextStore));
  } catch {
    // Storage can be disabled or full; checklist persistence is best-effort.
  }
};

/** Remove one recipe checklist after recipe deletion; storage failures are ignored. */
export const removeChecklist = (recipeId: string): void => {
  const storage = getStorage();
  if (storage === null) return;
  try {
    const store = parseChecklistStore(storage.getItem(CHECKLIST_STORAGE_KEY));
    delete store.recipes[recipeId];
    storage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Recipe deletion must not depend on optional device-local storage.
  }
};
