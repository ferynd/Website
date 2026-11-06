import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import * as React from 'react';
import type {User} from 'firebase/auth';
const harness = vi.hoisted(() => ({
  states: [] as unknown[], effects: [] as (() => unknown)[], cursor: 0,
  listener: undefined as undefined | ((user: User | null) => void),
  clear: vi.fn(), clearJobs: vi.fn(), signOut: vi.fn(), failPublish: false,
}));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.states)) harness.states[index] = initial;
    return [harness.states[index], (value: unknown) => {
      if (index === 0 && harness.failPublish) { harness.failPublish = false; throw new Error('Publish failed'); }
      harness.states[index] = value;
    }];
  },
  useEffect: (effect: () => unknown) => harness.effects.push(effect),
  useCallback: (callback: unknown) => callback,
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_: unknown, listener: typeof harness.listener) => { harness.listener = listener; return vi.fn(); },
  signOut: harness.signOut,
}));
vi.mock('@/public/shared/nutrition/research/indexedDbResearchStore.js', () => ({clearResearchJobs: harness.clearJobs}));
vi.mock('@/public/shared/nutrition/profileCache.js', () => ({clearProfileCache: harness.clear}));
vi.mock('../lib/firebase', () => ({auth: {}}));
vi.mock('../lib/db', () => ({}));
import {RecipeProvider} from '../RecipeContext';
const user = (uid: string) => ({uid} as User);
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.stubGlobal('React', React);
  harness.states = []; harness.effects = []; harness.cursor = 0; harness.failPublish = false;
  harness.clearJobs.mockReset(); harness.clear.mockReset(); harness.signOut.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
it('preserves persisted-owner reload, clears only observed owner transitions', async () => {
  RecipeProvider({children:null}); harness.effects[0]();
  harness.listener!(user('a')); await drain();
  harness.listener!(user('a')); await drain();
  expect(harness.clear).not.toHaveBeenCalled();
  harness.listener!(user('b')); await drain();
  harness.listener!(null); await drain();
  expect(harness.clear).toHaveBeenCalledTimes(2);
  expect(harness.clearJobs).toHaveBeenCalledTimes(2);
  expect(harness.states.slice(0, 2)).toEqual([null, false]);
});
it.each(['throw', 'error', 'rejected-helper'])('login, logout and explicit sign-out complete when cleanup fails: %s', async mode => {
  const {clearProfileCache: realClear} = await vi.importActual<typeof import('@/public/shared/nutrition/profileCache.js')>('@/public/shared/nutrition/profileCache.js');
  const idb = {deleteDatabase() {
    if (mode === 'throw') throw new Error('deleteDatabase throws');
    const req = {onerror:null as null | (() => void)};
    queueMicrotask(() => req.onerror?.());
    return req;
  }} as unknown as IDBFactory;
  harness.clear.mockImplementation(() => mode === 'rejected-helper'
    ? Promise.reject(new Error('Unexpected cleanup rejection')) : realClear({idb}));
  const provider = RecipeProvider({children:null}); harness.effects[0]();
  harness.listener!(user('a')); await drain();
  harness.listener!(user('b')); await drain();
  expect(harness.states.slice(0, 2)).toEqual([user('b'), false]);
  harness.listener!(null); await drain();
  expect(harness.states.slice(0, 2)).toEqual([null, false]);
  await provider.props.value.signOut();
  expect(harness.signOut).toHaveBeenCalledTimes(1);
});
it('recovers a rejected transition before processing the next auth event', async () => {
  RecipeProvider({children:null}); harness.effects[0]();
  harness.failPublish = true;
  harness.listener!(user('a'));
  harness.listener!(user('b'));
  await drain();
  expect(harness.states.slice(0, 2)).toEqual([user('b'), false]);
});

it('clears research jobs on initial signed-out auth and before explicit sign-out',async()=>{
 const provider=RecipeProvider({children:null});harness.effects[0]();harness.listener!(null);await drain();expect(harness.clearJobs).toHaveBeenCalledOnce();
 harness.clearJobs.mockRejectedValueOnce(new Error('denied'));await provider.props.value.signOut();expect(harness.signOut).toHaveBeenCalledOnce();expect(harness.clearJobs).toHaveBeenCalledTimes(2);
});
