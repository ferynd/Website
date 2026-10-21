/* --- CONFIGURATION: fake export transaction paths --- */
const FAKE_TS = { fakeServerTimestamp: true };
const FOOD_PATH = (id: string): string => `foodItems/${id}`;
const RECIPE_PATH = 'recipes/recipe-1';

/**
 * Exercises the transaction body with a read-before-write fake and commit-on-success staging.
 */

import { describe, expect, it } from 'vitest';
import { butterCookiesRecipe, foodsReady, sourceFoodsReady } from './exportFixtures';
import {
  buildExportCommitRequest,
  buildExportPayload,
  calculateExportNutrition,
  deriveExportStatus,
} from '../lib/nutritionExport';
import {
  buildTrackerFoodDoc,
  FoodIdCollisionError,
  FoodLinkTargetChangedError,
  fingerprintTrackerFood,
  parseTrackerFood,
  TRACKER_NUTRIENT_KEYS,
} from '../lib/trackerFoods';
import {
  ExportRecipeMissingError,
  ExportRefChangedError,
  ExportTargetChangedError,
  ExportTargetMissingError,
  runExportTransaction,
  assertExportRequestIds,
} from '../lib/nutritionExportTx';
import type { ExportCommitRequest } from '../lib/nutritionExport';
import type { ExportTxPort, ExportTxSnapshot } from '../lib/nutritionExportTx';

class FakeSnapshot implements ExportTxSnapshot {
  constructor(
    private readonly value: unknown,
    private readonly present: boolean,
  ) {}
  exists(): boolean {
    return this.present;
  }
  data(): unknown {
    return this.value;
  }
}

class FakeTx implements ExportTxPort<string> {
  private readonly staged = new Map<string, unknown>();
  private hasWritten = false;
  readonly operations: string[] = [];

  constructor(readonly store: Map<string, unknown>) {}

  async get(ref: string): Promise<ExportTxSnapshot> {
    if (this.hasWritten) throw new Error('reads must precede writes');
    this.operations.push(`get:${ref}`);
    return new FakeSnapshot(this.store.get(ref), this.store.has(ref));
  }

  set(ref: string, data: ExportCommitRequest['doc']): void {
    this.hasWritten = true;
    this.operations.push(`set:${ref}`);
    this.staged.set(ref, data);
  }

  update(ref: string, data: Record<string, unknown>): void {
    this.hasWritten = true;
    this.operations.push(`update:${ref}`);
    const current = this.store.get(ref);
    const next = structuredClone(current) as Record<string, unknown>;
    for (const [path, value] of Object.entries(data)) {
      const parts = path.split('.');
      let target = next;
      for (const part of parts.slice(0, -1)) {
        if (typeof target[part] !== 'object' || target[part] === null) target[part] = {};
        target = target[part] as Record<string, unknown>;
      }
      target[parts[parts.length - 1]] = value;
    }
    this.staged.set(ref, next);
  }

  commit(): void {
    for (const [key, value] of this.staged) this.store.set(key, value);
  }
}

const makeRequest = (basis: 'perPortion' | 'per100gCooked' = 'perPortion'): ExportCommitRequest => {
  const recipe = butterCookiesRecipe();
  const foods = sourceFoodsReady();
  const result = calculateExportNutrition(recipe, foods);
  const payloadResult = buildExportPayload(recipe, result, basis);
  if (!payloadResult.ok) throw new Error('Fixture should be exportable.');
  const status = deriveExportStatus({
    basis,
    ref: undefined,
    recipeId: 'recipe-1',
    payload: payloadResult,
    foods,
  });
  return buildExportCommitRequest({
    recipe,
    recipeId: 'recipe-1',
    basis,
    status,
    payload: payloadResult.payload,
    sourceTargets: [],
    chosenName: basis === 'perPortion' ? 'Butter cookies (per portion)' : 'Butter cookies (per 100 g cooked)',
    overwriteTrackerEdits: false,
    partialConfirmed: false,
    nowIso: '2025-01-01T00:00:00.000Z',
    nowMs: 5,
  });
};

const recipeDoc = (request: ExportCommitRequest, extra: Record<string, unknown> = {}) => ({
  name: 'Butter cookies',
  recipe: { ...butterCookiesRecipe(), ...extra },
  updatedAt: 'old',
});

const run = async (request: ExportCommitRequest, store: Map<string, unknown>) => {
  const tx = new FakeTx(store);
  const refs = { food: FOOD_PATH(request.foodId), recipe: RECIPE_PATH, sourceFood: FOOD_PATH };
  await runExportTransaction(tx, refs, request, FAKE_TS);
  tx.commit();
  return tx;
};

const seed = (request: ExportCommitRequest, targetPresent = false) => {
  const store = new Map<string, unknown>([[RECIPE_PATH, recipeDoc(request)]]);
  if (targetPresent) store.set(FOOD_PATH(request.foodId), request.doc);
  return store;
};

describe('nutritionExportTx', () => {
  it('create writes the exact food doc and the recipe ref field path atomically', async () => {
    const request = makeRequest();
    const store = seed(request);
    await run(request, store);
    expect(store.get(FOOD_PATH(request.foodId))).toEqual(request.doc);
    expect(
      (store.get(RECIPE_PATH) as { recipe: { nutritionExports: { perPortion: unknown } } }).recipe
        .nutritionExports.perPortion,
    ).toEqual(request.nextRef);
  });

  it('create never overwrites an existing doc at the id (FoodIdCollisionError, nothing written)', async () => {
    const request = makeRequest();
    const store = seed(request, true);
    const original = store.get(FOOD_PATH(request.foodId));
    await expect(run(request, store)).rejects.toBeInstanceOf(FoodIdCollisionError);
    expect(store.get(FOOD_PATH(request.foodId))).toEqual(original);
    expect(
      (store.get(RECIPE_PATH) as { recipe: { nutritionExports: object } }).recipe.nutritionExports,
    ).toEqual({});
  });

  it('create at a slug occupied by a foreign food with a different name still collides', async () => {
    const request = makeRequest();
    const store = seed(request);
    store.set(FOOD_PATH(request.foodId), { ...request.doc, name: 'Completely different' });
    await expect(run(request, store)).rejects.toBeInstanceOf(FoodIdCollisionError);
  });

  it('update writes only when the target matches the stored ref (name, fingerprint, lastUpdated)', async () => {
    const create = makeRequest();
    const withRef = { ...butterCookiesRecipe(), nutritionExports: { perPortion: create.nextRef } };
    const currentFood = parseTrackerFood(create.foodId, create.doc);
    if (currentFood === null) throw new Error('Expected tracker food.');
    const payload = buildExportPayload(
      withRef,
      calculateExportNutrition(withRef, sourceFoodsReady()),
      'perPortion',
    );
    if (!payload.ok) throw new Error('Expected payload.');
    const status = deriveExportStatus({
      basis: 'perPortion',
      ref: create.nextRef,
      recipeId: 'recipe-1',
      payload,
      foods: foodsReady(currentFood),
    });
    const request = buildExportCommitRequest({
      recipe: withRef,
      recipeId: 'recipe-1',
      basis: 'perPortion',
      status,
      payload: payload.payload,
      sourceTargets: [],
      chosenName: '',
      overwriteTrackerEdits: false,
      partialConfirmed: false,
      nowIso: '2025-02-01T00:00:00.000Z',
      nowMs: 6,
    });
    const store = new Map<string, unknown>([
      [RECIPE_PATH, { ...recipeDoc(request), recipe: withRef }],
      [FOOD_PATH(request.foodId), create.doc],
    ]);
    await run(request, store);
    expect(store.get(FOOD_PATH(request.foodId))).toEqual(request.doc);
  });

  it('update aborts with ExportTargetChangedError when the tracker edited nutrients, nothing written', async () => {
    const request = makeRequest();
    const updateRequest = {
      ...request,
      mode: 'update' as const,
      expectedTarget: {
        id: request.foodId,
        fingerprint: 'old',
        normalizedName: 'butter cookies',
        lastUpdated: request.doc.lastUpdated,
      },
    };
    const store = seed(updateRequest, true);
    const original = store.get(FOOD_PATH(request.foodId));
    await expect(run(updateRequest, store)).rejects.toBeInstanceOf(ExportTargetChangedError);
    expect(store.get(FOOD_PATH(request.foodId))).toEqual(original);
  });

  it.each(['quantity', 'name'] as const)(
    'update aborts with ExportTargetChangedError when the tracker changed quantity or name',
    async (field) => {
      const request = makeRequest();
      const target = parseTrackerFood(request.foodId, request.doc);
      if (target === null) throw new Error('Expected food.');
      const expected = {
        id: request.foodId,
        fingerprint: fingerprintTrackerFood(target),
        normalizedName: 'butter cookies per portion',
        lastUpdated: target.lastUpdated,
      };
      const changed =
        field === 'quantity' ? { ...request.doc, quantity: 2 } : { ...request.doc, name: 'Different' };
      const updateRequest = { ...request, mode: 'update' as const, expectedTarget: expected };
      const store = seed(updateRequest);
      store.set(FOOD_PATH(request.foodId), changed);
      await expect(run(updateRequest, store)).rejects.toBeInstanceOf(ExportTargetChangedError);
    },
  );

  it('update aborts with ExportTargetMissingError when the target was deleted', async () => {
    const request = makeRequest();
    const updateRequest = {
      ...request,
      mode: 'update' as const,
      expectedTarget: { id: request.foodId, fingerprint: 'x', normalizedName: 'x', lastUpdated: null },
    };
    await expect(run(updateRequest, seed(updateRequest))).rejects.toBeInstanceOf(ExportTargetMissingError);
  });

  it('overwrite update succeeds against the observed target and fails if it changed again after review', async () => {
    const request = makeRequest();
    const observedDoc = { ...request.doc, calories: 100 };
    const food = parseTrackerFood(request.foodId, observedDoc);
    if (food === null) throw new Error('Expected food.');
    const changedAgain = { ...request.doc, calories: 101 };
    const expectedTarget = {
      id: food.id,
      fingerprint: fingerprintTrackerFood(food),
      normalizedName: 'butter cookies per portion',
      lastUpdated: food.lastUpdated,
    };
    const store = seed({ ...request, mode: 'update' }, true);
    store.set(FOOD_PATH(request.foodId), observedDoc);
    await run({ ...request, mode: 'update', expectedTarget }, store);
    const nextStore = seed({ ...request, mode: 'update' }, true);
    nextStore.set(FOOD_PATH(request.foodId), changedAgain);
    await expect(run({ ...request, mode: 'update', expectedTarget }, nextStore)).rejects.toBeInstanceOf(
      ExportTargetChangedError,
    );
  });

  it('aborts with ExportRefChangedError when another tab already wrote a different ref', async () => {
    const request = makeRequest();
    const store = seed(request);
    (
      store.get(RECIPE_PATH) as { recipe: { nutritionExports: Record<string, unknown> } }
    ).recipe.nutritionExports.perPortion = { ...request.nextRef, exportedAtMs: 99 };
    await expect(run(request, store)).rejects.toBeInstanceOf(ExportRefChangedError);
  });

  it('aborts with ExportRefChangedError when a ref appeared since review (previousRef null)', async () => {
    const request = makeRequest();
    const store = seed(request);
    (
      store.get(RECIPE_PATH) as { recipe: { nutritionExports: Record<string, unknown> } }
    ).recipe.nutritionExports.perPortion = request.nextRef;
    await expect(run(request, store)).rejects.toBeInstanceOf(ExportRefChangedError);
  });

  it('aborts with ExportRecipeMissingError when the recipe doc was deleted', async () => {
    const request = makeRequest();
    await expect(run(request, new Map())).rejects.toBeInstanceOf(ExportRecipeMissingError);
  });

  it.each([true, false])(
    'aborts with FoodLinkTargetChangedError when a source ingredient food changed or vanished',
    async (sourceExists) => {
      const request = {
        ...makeRequest(),
        sourceTargets: [{ id: 'source', fingerprint: 'old', normalizedName: 'source', lastUpdated: 'old' }],
      };
      const store = seed(request);
      if (sourceExists) {
        store.set(FOOD_PATH('source'), {
          ...buildTrackerFoodDoc(
            'Source',
            Object.fromEntries(TRACKER_NUTRIENT_KEYS.map((key) => [key, 1])) as never,
            'now',
          ),
          calories: 2,
        });
      }
      await expect(run(request, store)).rejects.toBeInstanceOf(FoodLinkTargetChangedError);
      expect(
        (store.get(RECIPE_PATH) as { recipe: { nutritionExports: object } }).recipe.nutritionExports,
      ).toEqual({});
    },
  );

  it('all reads happen before any write', async () => {
    const request = makeRequest();
    const tx = await run(request, seed(request));
    const firstWrite = tx.operations.findIndex(
      (operation) => operation.startsWith('set:') || operation.startsWith('update:'),
    );
    expect(firstWrite).toBeGreaterThan(0);
    expect(tx.operations.slice(0, firstWrite).every((operation) => operation.startsWith('get:'))).toBe(true);
  });

  it('update replaces the full doc (no extra fields survive)', async () => {
    const request = makeRequest();
    const existingDoc = { ...request.doc, extraField: 'must disappear' };
    const existingFood = parseTrackerFood(request.foodId, existingDoc);
    if (existingFood === null) throw new Error('Expected tracker food.');
    const expectedTarget = {
      id: request.foodId,
      fingerprint: fingerprintTrackerFood(existingFood),
      normalizedName: 'butter cookies per portion',
      lastUpdated: existingFood.lastUpdated,
    };
    const updated = { ...request, mode: 'update' as const, expectedTarget };
    const store = seed(updated, true);
    store.set(FOOD_PATH(request.foodId), existingDoc);
    await run(updated, store);
    expect(Object.keys(store.get(FOOD_PATH(request.foodId)) as object)).toEqual([
      'name',
      'quantity',
      ...TRACKER_NUTRIENT_KEYS,
      'lastUpdated',
    ]);
  });

  it('recipe update touches only recipe.nutritionExports.<basis> and updatedAt', async () => {
    const request = makeRequest();
    const store = seed(request);
    (store.get(RECIPE_PATH) as { recipe: Record<string, unknown> }).recipe.extraField = 'preserved';
    await run(request, store);
    expect((store.get(RECIPE_PATH) as { recipe: { extraField: string } }).recipe.extraField).toBe(
      'preserved',
    );
    expect((store.get(RECIPE_PATH) as { updatedAt: unknown }).updatedAt).toBe(FAKE_TS);
  });

  it('writing the per100g ref keeps an existing perPortion ref intact', async () => {
    const request = makeRequest('per100gCooked');
    const existing = makeRequest().nextRef;
    const store = seed(request);
    (
      store.get(RECIPE_PATH) as { recipe: { nutritionExports: Record<string, unknown> } }
    ).recipe.nutritionExports.perPortion = existing;
    request.previousRef = null;
    await run(request, store);
    expect(
      (store.get(RECIPE_PATH) as { recipe: { nutritionExports: Record<string, unknown> } }).recipe
        .nutritionExports.perPortion,
    ).toEqual(existing);
  });

  it('assertExportRequestIds rejects invalid foodId/recipeId/source ids before any read', async () => {
    const request = makeRequest();
    const invalidRequests = [
      { ...request, foodId: 'bad/id' },
      { ...request, recipeId: 'bad/id' },
      {
        ...request,
        sourceTargets: [{ id: 'bad/id', fingerprint: '', normalizedName: '', lastUpdated: null }],
      },
    ];
    for (const invalidRequest of invalidRequests) {
      const tx = new FakeTx(new Map());
      await expect(
        runExportTransaction(
          tx,
          { food: FOOD_PATH('food'), recipe: RECIPE_PATH, sourceFood: FOOD_PATH },
          invalidRequest,
          FAKE_TS,
        ),
      ).rejects.toThrow();
      expect(tx.operations).toEqual([]);
      expect(() => assertExportRequestIds(invalidRequest)).toThrow();
    }
  });
});
