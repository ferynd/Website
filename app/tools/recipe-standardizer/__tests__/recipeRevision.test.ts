/* --- CONFIGURATION: revision transaction fixtures --- */
/** Data-loss regressions across editor updates, explicit overwrites, exports, and deletes. */

import { describe, expect, it } from 'vitest';
import {
  readRecipeRevision,
  runRecipeUpdateTransaction,
  RecipeRevisionConflictError,
  deriveRemoteRecipeState,
  conflictChoices,
  identityAfterDeleting,
  loadedRecipeBlockReason,
  remoteConflictToShow,
  SAVING_LOAD_REASON,
  saveBlockedWhileWriting,
  type RemoteStateInput,
  type RecipeConflict,
} from '../lib/recipeRevision';
import { runExportTransaction } from '../lib/nutritionExportTx';
import {
  buildExportCommitRequest,
  buildExportPayload,
  calculateExportNutrition,
  deriveExportStatuses,
} from '../lib/nutritionExport';
import type { NutritionExportBasisKey, Recipe } from '../lib/types';
import { FakeFirestore, FakeTx } from './fakeFirestore';
import { STORED_DOC_WITHOUT_REVISION } from './savedShapeFixtures';
import { butterCookiesRecipe, exportedRef, sourceFoodsReady } from './exportFixtures';

const PATH = 'recipes/recipe-1';
const STAMP = 'server-time';
const seed = (revision = 0) => {
  const db = new FakeFirestore();
  db.store.set(PATH, {
    name: 'Original',
    recipe: butterCookiesRecipe(),
    revision,
    createdAt: 'created',
  });
  return db;
};
const update = (db: FakeFirestore, expectedRevision = 0, recipe = butterCookiesRecipe()) =>
  db.runTransaction((tx) => runRecipeUpdateTransaction(tx, PATH, { recipe, expectedRevision }, STAMP));
const storedRecipe = (db: FakeFirestore) => db.store.get(PATH)?.recipe as Recipe;
const exportRequest = (basis: NutritionExportBasisKey = 'perPortion', revision = 0) => {
  const recipe = butterCookiesRecipe();
  const foods = sourceFoodsReady();
  const result = calculateExportNutrition(recipe, foods);
  const payload = buildExportPayload(recipe, result, basis);
  if (!payload.ok) throw new Error('Invalid export fixture');
  return buildExportCommitRequest({
    recipe,
    recipeId: 'recipe-1',
    recipeRevision: revision,
    basis,
    status: deriveExportStatuses(recipe, 'recipe-1', result, foods).find((status) => status.basis === basis)!,
    payload: payload.payload,
    sourceTargets: [],
    chosenName: `Cookies ${basis}`,
    overwriteTrackerEdits: false,
    reviewedTarget: null,
    partialConfirmed: true,
    nowIso: '2025-01-01T00:00:00.000Z',
    nowMs: 1,
  });
};
const exportFood = (db: FakeFirestore, basis: NutritionExportBasisKey = 'perPortion') => {
  const request = exportRequest(basis);
  return db.runTransaction((tx) => runExportTransaction(tx, {
    food: `foods/${request.foodId}`,
    recipe: PATH,
    sourceFood: (id) => `foods/${id}`,
  }, request, STAMP));
};

describe('readRecipeRevision', () => {
  it.each([
    [{}, 0], [{ revision: 3 }, 3], [{ revision: -1 }, 0], [{ revision: 1.5 }, 0],
    [{ revision: '2' }, 0], [{ revision: Number.NaN }, 0], [null, 0],
  ])('reads %j as %i', (data, expected) => {
    expect(readRecipeRevision(data)).toBe(expected);
  });
});

describe('runRecipeUpdateTransaction', () => {
  it('updates name, recipe, updatedAt, and increments revision when the expected revision matches', async () => {
    const db = seed(3);
    const recipe = { ...butterCookiesRecipe(), name: 'New name' };
    await update(db, 3, recipe);
    expect(db.store.get(PATH)).toMatchObject({
      name: 'New name',
      recipe,
      updatedAt: STAMP,
      revision: 4,
    });
  });
  it('legacy document without revision updates with expectedRevision 0 and becomes revision 1', async () => {
    const db = new FakeFirestore();
    db.store.set(PATH, structuredClone(STORED_DOC_WITHOUT_REVISION));
    expect((await update(db)).revision).toBe(1);
    expect(db.store.get(PATH)?.revision).toBe(1);
  });
  it('throws a changed conflict with the remote revision and writes nothing when revisions differ', async () => {
    const db = seed(3);
    const before = structuredClone(db.store);
    await expect(update(db, 2)).rejects.toMatchObject({ conflict: { kind: 'changed', remoteRevision: 3 } });
    expect(db.store).toEqual(before);
  });
  it('throws a deleted conflict and writes nothing when the document is missing', async () => {
    const db = new FakeFirestore();
    await expect(update(db)).rejects.toMatchObject({ conflict: { kind: 'deleted' } });
    expect(db.store.size).toBe(0);
  });
  it('writes the stored nutritionExports, never the client copy', async () => {
    const db = seed();
    storedRecipe(db).nutritionExports = { perPortion: exportedRef() };
    const client = butterCookiesRecipe();
    client.nutritionExports = { per100gCooked: exportedRef({ basis: 'per100gCooked' }) };
    await update(db, 0, client);
    expect(storedRecipe(db).nutritionExports).toEqual({ perPortion: exportedRef() });
  });
  it('returns the parsed stored nutritionExports for the client to adopt', async () => {
    const db = seed();
    storedRecipe(db).nutritionExports = { perPortion: exportedRef() };
    expect((await update(db)).nutritionExports).toEqual({ perPortion: exportedRef() });
  });
  it('replaces the whole recipe map so removed keys do not survive', async () => {
    const db = seed();
    (storedRecipe(db) as unknown as Record<string, unknown>).removed = 'old';
    storedRecipe(db).ingredients[0].equivalentBakeFactor = 3;
    await update(db);
    expect(storedRecipe(db)).not.toHaveProperty('removed');
    expect(storedRecipe(db).ingredients[0].equivalentBakeFactor).toBeNull();
  });
  it('leaves createdAt untouched', async () => {
    const db = seed();
    await update(db);
    expect(db.store.get(PATH)?.createdAt).toBe('created');
  });
  it('rejects an invalid expected revision before any read', async () => {
    const tx = new FakeTx(seed().store);
    await expect(runRecipeUpdateTransaction(tx, PATH, {
      recipe: butterCookiesRecipe(), expectedRevision: -1,
    }, STAMP)).rejects.toThrow('Invalid expected recipe revision.');
    expect(tx.operations).toEqual([]);
  });
  it('all reads happen before any write', async () => {
    const db = seed();
    const tx = new FakeTx(db.store);
    await runRecipeUpdateTransaction(tx, PATH, { recipe: butterCookiesRecipe(), expectedRevision: 0 }, STAMP);
    expect(tx.operations).toEqual([`get:${PATH}`, `update:${PATH}`]);
  });
});

describe('multi-tab races (fake Firestore)', () => {
  it('update/update: the stale second save conflicts and the first tab\'s data survives', async () => {
    const db = seed();
    await update(db, 0, { ...butterCookiesRecipe(), name: 'Tab A' });
    await expect(update(db, 0)).rejects.toBeInstanceOf(RecipeRevisionConflictError);
    expect(storedRecipe(db).name).toBe('Tab A');
  });
  it('update/update: overwrite with the observed remote revision succeeds and bumps the revision', async () => {
    const db = seed();
    await update(db);
    await expect(update(db)).rejects.toMatchObject({ conflict: { remoteRevision: 1 } });
    await update(db, 1, { ...butterCookiesRecipe(), name: 'Overwrite' });
    expect(db.store.get(PATH)?.revision).toBe(2);
    expect(storedRecipe(db).name).toBe('Overwrite');
  });
  it('update/update: overwrite conflicts again if the remote changed after the conflict was shown', async () => {
    const db = seed();
    await update(db);
    await expect(update(db)).rejects.toMatchObject({ conflict: { remoteRevision: 1 } });
    await update(db, 1);
    await expect(update(db, 1)).rejects.toMatchObject({ conflict: { remoteRevision: 2 } });
  });
  it('update/delete: saving a recipe deleted in another tab conflicts as deleted and does not recreate it', async () => {
    const db = seed();
    db.delete(PATH);
    await expect(update(db)).rejects.toMatchObject({ conflict: { kind: 'deleted' } });
    expect(db.store.has(PATH)).toBe(false);
  });
  it('export then stale edit: an editor save based on the pre-export revision conflicts', async () => {
    const db = seed();
    await exportFood(db);
    await expect(update(db)).rejects.toMatchObject({ conflict: { kind: 'changed', remoteRevision: 1 } });
  });
  it('export then stale edit: overwrite keeps the export back-reference written by the other tab', async () => {
    const db = seed();
    await exportFood(db);
    const ref = structuredClone(storedRecipe(db).nutritionExports);
    await update(db, 1);
    expect(storedRecipe(db).nutritionExports).toEqual(ref);
    expect(db.store.get(PATH)?.revision).toBe(2);
  });
  it('edit then stale export: an export based on the pre-edit revision conflicts and writes no food', async () => {
    const db = seed();
    await update(db);
    await expect(exportFood(db)).rejects.toBeInstanceOf(RecipeRevisionConflictError);
    expect(db.store.size).toBe(1);
  });
  it('two tabs exporting different bases: the second export conflicts on revision', async () => {
    const db = seed();
    await exportFood(db);
    await expect(exportFood(db, 'per100gCooked')).rejects.toBeInstanceOf(RecipeRevisionConflictError);
    expect(db.store.size).toBe(2);
    expect(storedRecipe(db).nutritionExports.per100gCooked).toBeUndefined();
  });
});

const remoteInput = (extra: Partial<RemoteStateInput> = {}): RemoteStateInput => ({
  currentId: 'recipe-1',
  baseRevision: 1,
  listLoaded: true,
  listError: false,
  writeInFlight: false,
  seenInList: true,
  metas: [{
    id: 'recipe-1',
    name: 'Cookies',
    revision: 2,
    updatedAtMs: null,
    sectionCount: 1,
    ingredientCount: 3,
  }],
  ...extra,
});
describe('deriveRemoteRecipeState', () => {
  it('none when no recipe is open', () => {
    expect(deriveRemoteRecipeState(remoteInput({ currentId: null })).kind).toBe('none');
  });
  it('none when the open recipe is unsaved', () => {
    expect(deriveRemoteRecipeState(remoteInput({ baseRevision: null })).kind).toBe('none');
  });
  it('none before the list has loaded', () => {
    expect(deriveRemoteRecipeState(remoteInput({ listLoaded: false })).kind).toBe('none');
  });
  it('none when the list errored', () => {
    expect(deriveRemoteRecipeState(remoteInput({ listError: true })).kind).toBe('none');
  });
  it('none while this tab\'s write is in flight', () => {
    expect(deriveRemoteRecipeState(remoteInput({ writeInFlight: true })).kind).toBe('none');
  });
  it('changed when the listed revision is newer than the base revision', () => {
    expect(deriveRemoteRecipeState(remoteInput())).toEqual({ kind: 'changed', remoteRevision: 2 });
  });
  it('none when the listed revision equals or trails the base revision', () => {
    expect(deriveRemoteRecipeState(remoteInput({ baseRevision: 2 })).kind).toBe('none');
    expect(deriveRemoteRecipeState(remoteInput({ baseRevision: 3 })).kind).toBe('none');
  });
  it('deleted when a recipe seen in the list disappears', () => {
    expect(deriveRemoteRecipeState(remoteInput({ metas: [] })).kind).toBe('deleted');
  });
  it('none when the open recipe has not yet appeared in the list', () => {
    expect(deriveRemoteRecipeState(remoteInput({ metas: [], seenInList: false })).kind).toBe('none');
  });
  it('clearing the open id before its list row disappears is not a remote delete', () => {
    const next = identityAfterDeleting('recipe-1', 1, 'recipe-1');
    expect(next).toEqual({ currentId: null, baseRevision: null });
    expect(deriveRemoteRecipeState(remoteInput({
      currentId: next.currentId,
      baseRevision: next.baseRevision,
      metas: [],
    })).kind).toBe('none');
  });
});

describe('identityAfterDeleting', () => {
  it('keeps the open recipe when a different library row is deleted', () => {
    expect(identityAfterDeleting('recipe-1', 4, 'recipe-2')).toEqual({
      currentId: 'recipe-1',
      baseRevision: 4,
    });
  });
});

describe('remoteConflictToShow', () => {
  it.each([
    {
      label: 'own write at the adopted revision',
      conflict: { kind: 'changed', remoteRevision: 2 } as RecipeConflict,
      baseRevision: 2,
      expected: null,
    },
  ])('$label is not a conflict', ({ conflict, baseRevision, expected }) => {
    expect(remoteConflictToShow(conflict, baseRevision)).toBe(expected);
  });
  it('shows a stored revision reset below the adopted revision', () => {
    expect(remoteConflictToShow({ kind: 'changed', remoteRevision: 1 }, 2)).toEqual({
      kind: 'changed',
      remoteRevision: 1,
    });
  });
  it('shows a changed conflict newer than the adopted revision', () => {
    expect(remoteConflictToShow({ kind: 'changed', remoteRevision: 3 }, 2)).toEqual({
      kind: 'changed',
      remoteRevision: 3,
    });
  });
  it('shows a deleted conflict even when this tab has a base revision', () => {
    expect(remoteConflictToShow({ kind: 'deleted' }, 2)).toEqual({ kind: 'deleted' });
  });
});

describe('saveBlockedWhileWriting', () => {
  it('blocks Save and Update only while a write is in flight', () => {
    expect(saveBlockedWhileWriting(true)).toBe(true);
    expect(saveBlockedWhileWriting(false)).toBe(false);
  });
});

describe('loadedRecipeBlockReason', () => {
  it('blocks every load while a write is in flight', () => {
    expect(loadedRecipeBlockReason(true, 0, 1, 'recipe-2', 'recipe-1')).toBe(SAVING_LOAD_REASON);
  });
  it('blocks reapplying the open recipe when a write overlapped the load', () => {
    expect(loadedRecipeBlockReason(false, 0, 1, 'recipe-1', 'recipe-1')).toBe(SAVING_LOAD_REASON);
  });
  it('allows a load when no write overlapped it', () => {
    expect(loadedRecipeBlockReason(false, 2, 2, 'recipe-1', 'recipe-1')).toBeNull();
  });
  it('allows opening a different recipe after a write finishes', () => {
    expect(loadedRecipeBlockReason(false, 0, 1, 'recipe-2', 'recipe-1')).toBeNull();
  });
});

describe('conflictChoices', () => {
  it.each([
    {
      label: 'changed dirty',
      conflict: { kind: 'changed', remoteRevision: 2 },
      dirty: true,
      expected: ['reload', 'overwrite', 'save-as-new', 'keep-editing'],
    },
    {
      label: 'changed clean',
      conflict: { kind: 'changed', remoteRevision: 2 },
      dirty: false,
      expected: ['reload', 'save-as-new', 'keep-editing'],
    },
    {
      label: 'deleted dirty',
      conflict: { kind: 'deleted' },
      dirty: true,
      expected: ['save-as-new', 'close', 'keep-editing'],
    },
    {
      label: 'deleted clean',
      conflict: { kind: 'deleted' },
      dirty: false,
      expected: ['save-as-new', 'close', 'keep-editing'],
    },
  ])('$label offers $expected', ({ conflict, dirty, expected }) => {
    expect(conflictChoices(conflict as RecipeConflict, dirty)).toEqual(expected);
  });
});
