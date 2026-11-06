import { it, expect, vi } from 'vitest';
import { onIngredientAuthChange } from './ingredientSession.js';
it('clears on sign-out and owner switch, keeps same-uid refresh', async () => { const clear = vi.fn(); await onIngredientAuthChange('a', 'a', clear); expect(clear).not.toHaveBeenCalled(); await onIngredientAuthChange('a', null, clear); await onIngredientAuthChange('a', 'b', clear); expect(clear).toHaveBeenCalledTimes(2); });
it('keeps persisted-owner reloads and clears initial signed-out events', async () => {
    const clear = vi.fn();
    for (const previous of [undefined, null]) {
        await onIngredientAuthChange(previous, 'owner', clear);
        await onIngredientAuthChange(previous, null, clear);
    }
    expect(clear).toHaveBeenCalledTimes(2);
});
it('ignores rejected cleanup during an observed account transition', async () => {
    await expect(onIngredientAuthChange('a', 'b', async () => { throw new Error('Denied'); })).resolves.toBeUndefined();
});

it.each(['throw', 'error', 'rejected-helper'])('tracker login/logout handlers complete after cleanup failure: %s', async mode => {
    const {readFileSync} = await import('node:fs');
    const {clearProfileCache} = await import('../../../shared/nutrition/profileCache.js');
    const source = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    const handlers = source.slice(source.indexOf('async function handleUserLoggedIn('), source.indexOf('// ===== STEP 6:'));
    const state = {userId:'a'};
    const loaded = vi.fn(), loggedIn = vi.fn(), loggedOut = vi.fn(() => {state.userId = null;}), auto = vi.fn();
    const idb = {deleteDatabase() {
        if (mode === 'throw') throw new Error('Denied');
        const req = {}; queueMicrotask(() => req.onerror()); return req;
    }};
    const transition = mode === 'rejected-helper' ? async () => {throw new Error('Helper failed');} :
        (prev, next) => onIngredientAuthChange(prev, next, () => clearProfileCache({idb}));
    const {login,logout} = new Function('onIngredientAuthChange','stateObject','debugLog','errorLog','updateUIForLoggedInUser','loadUserDataFunction','showFallbackUI','updateUIForLoggedOutUser','attemptAutoSignIn', handlers + '\nreturn {login:handleUserLoggedIn,logout:handleUserLoggedOut};')(
        transition,state,vi.fn(),vi.fn(),loggedIn,loaded,vi.fn(),loggedOut,auto);
    await login({uid:'b'});
    expect(state.userId).toBe('b'); expect(loggedIn).toHaveBeenCalled(); expect(loaded).toHaveBeenCalled();
    await logout();
    expect(state.userId).toBeNull(); expect(loggedOut).toHaveBeenCalled(); expect(auto).toHaveBeenCalled();
});

it('clears undefined-to-null auth',async()=>{const clear=vi.fn();await onIngredientAuthChange(undefined,null,clear);expect(clear).toHaveBeenCalledOnce();});
it.each([false,true])('explicit logout clears before auth, including failed cleanup: %s',async failure=>{
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('../main.js',import.meta.url),'utf8');
 const start=source.indexOf('export async function handleLogout()');
 const body=source.slice(start,source.indexOf('\n}',start)+2).replace('export ','');
 const calls=[],clear=async()=>{calls.push('clear');if(failure)throw new Error('denied');};
 const logout=new Function('clearProfileCache','authFunctions','debugLog','errorLog','stateObject','showMessageFunction',body+'; return handleLogout;')(
 clear,{logout:async()=>calls.push('logout')},vi.fn(),vi.fn(),{dailyEntries:new Map(),savedFoodItems:new Map(),weightEntries:new Map()},vi.fn());
 await logout();expect(calls).toEqual(['clear','logout']);
});
