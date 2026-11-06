import {beforeEach, expect, it, vi} from 'vitest';
import type {IngredientStore, ResolvedIngredientProfile} from '@/public/shared/nutrition/ingredientStore.js';
import {ingredientFixture} from './ingredientFixtures';
import {validRecipeJson} from './fixtures';
import {parseRecipeJson} from '../lib/schema';
const harness = vi.hoisted(() => ({
  slots: [] as {value?: unknown; deps?: unknown[]; cleanup?: (() => void)}[], cursor: 0, effects: [] as (() => void)[], createStore: vi.fn(),
}));
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    harness.slots[index] ??= {value: initial};
    return [harness.slots[index].value, (value: unknown) => {harness.slots[index].value = value;}];
  },
  useMemo: (fn: () => unknown, deps: unknown[]) => {
    const index = harness.cursor++, old = harness.slots[index];
    if (!old || deps.some((dep, i) => dep !== old.deps![i])) harness.slots[index] = {value:fn(),deps};
    return harness.slots[index].value;
  },
  useEffect: (fn: () => (() => void) | undefined, deps: unknown[]) => {
    const index = harness.cursor++, old = harness.slots[index];
    if (!old || deps.some((dep, i) => dep !== old.deps![i])) {
      old?.cleanup?.();
      harness.slots[index] = {deps};
      harness.effects.push(() => {harness.slots[index].cleanup = fn();});
    }
  },
}));
vi.mock('../lib/ingredientStore', () => ({createRecipeIngredientStore:harness.createStore}));
import {useIngredientProfiles} from '../lib/useIngredientProfiles';
beforeEach(() => {harness.slots = []; harness.cursor = 0; harness.effects = []; harness.createStore.mockReset();});
it('keeps resolved totals and avoids work across unrelated draft edits; replaces results after changed refs resolve', async () => {
  const {ref, resolved} = await ingredientFixture();
  const parsed = parseRecipeJson(JSON.stringify(validRecipeJson()));
  if (!parsed.ok) throw new Error('Invalid fixture');
  const draft = parsed.recipe;
  draft.ingredients[0].nutritionLink = {...draft.ingredients[0].nutritionLink, ingredientRef:ref};
  const resolveRef = vi.fn().mockResolvedValue(resolved), close = vi.fn();
  harness.createStore.mockResolvedValue({resolveRef,close} as unknown as IngredientStore);
  const useRender = (uid = 'a', recipe = draft) => {
    harness.cursor = 0;
    const profiles = useIngredientProfiles(uid, recipe);
    harness.effects.splice(0).forEach(effect => effect());
    return profiles;
  };
  useRender();
  await vi.waitFor(() => expect(resolveRef).toHaveBeenCalledTimes(1));
  const first = useRender();
  expect(first.size).toBe(1);
  expect(useRender('a', {...structuredClone(draft), name:'Edited', notes:['New note']})).toBe(first);
  expect(harness.createStore).toHaveBeenCalledTimes(1);
  let finish!: (value: ResolvedIngredientProfile) => void;
  resolveRef.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const changed = structuredClone(draft);
  changed.ingredients[0].nutritionLink.ingredientRef = {...ref,revision:2,revisionId:ref.variantId+'~r2'};
  expect(useRender('a',changed)).toBe(first);
  await vi.waitFor(() => expect(resolveRef).toHaveBeenCalledTimes(2));
  finish({...resolved,ref:changed.ingredients[0].nutritionLink.ingredientRef});
  await vi.waitFor(() => expect(useRender('a',changed)).not.toBe(first));
  expect(useRender('b',changed).size).toBe(0);
  expect(close).toHaveBeenCalled();
});
