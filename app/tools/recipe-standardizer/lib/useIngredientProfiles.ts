import {useEffect, useMemo, useState} from 'react';
import {refCacheKey, type IngredientProfileRef} from '@/public/shared/nutrition/ingredientRefs.js';
import type {IngredientStore} from '@/public/shared/nutrition/ingredientStore.js';
import {createRecipeIngredientStore} from './ingredientStore';
import type {ProfilesState} from './ingredientLink';
import type {Recipe} from './types';

/** Resolve only when pinned refs change; keep prior results while loading. */
export function useIngredientProfiles(uid: string | null, draft: Recipe | null): ProfilesState {
  const refsByKey = new Map((draft?.ingredients ?? []).flatMap(i => {
    const ref = i.nutritionLink.ingredientRef;
    return ref ? [[refCacheKey(ref), ref] as const] : [];
  }));
  // Include the hash and identity too so a changed/corrupt ref is reassessed.
  const refsKey = JSON.stringify([...refsByKey].sort(([a], [b]) => a.localeCompare(b)));
  const refs = useMemo(() => (JSON.parse(refsKey) as [string, IngredientProfileRef][]).map(([, ref]) => ref), [refsKey]);
  const [resolved, setResolved] = useState<{uid: string | null; profiles: ProfilesState}>({uid: null, profiles: new Map()});
  useEffect(() => {
    let cancelled = false;
    let ingredientStore: IngredientStore | undefined;
    if (!uid || !refs.length) return;
    const resolve = async () => {
      const store = await createRecipeIngredientStore(uid);
      ingredientStore = store;
      if (cancelled) { store.close(); return; }
      const entries = await Promise.all(refs.map(async ref => [refCacheKey(ref), await store.resolveRef(ref)] as const));
      if (!cancelled) setResolved({uid, profiles: new Map(entries)});
    };
    void resolve().catch(() => {
      if (!cancelled) setResolved({uid, profiles: new Map(refs.map(ref => [refCacheKey(ref), {status: 'missing', ref}]))});
    });
    return () => { cancelled = true; ingredientStore?.close(); };
  }, [uid, refs]);
  // Never expose one owner's retained results to another owner.
  return uid && resolved.uid === uid ? resolved.profiles : new Map();
}
