import { it, expect, vi, afterEach } from 'vitest';
import { openProfileCache, clearProfileCache } from '../../../shared/nutrition/profileCache.js';
import { memoryIndexedDb } from './memoryIndexedDb.js';
import { fixture } from './ingredientFixtures.js';
afterEach(() => vi.useRealTimers());
it('owner mismatch wipes all stores and signout deletes DB; old handles cannot repopulate', async () => { const idb = memoryIndexedDb(), a = await openProfileCache({ ownerUid: 'a', idb }); const { ref, revision } = await fixture(); await a.putRevision(ref, revision); await a.putPendingSave({ idempotencyKey: 'draft' }); const b = await openProfileCache({ ownerUid: 'b', idb }); expect((await b.getRevision(ref)).status).toBe('missing'); expect(await b.listPendingSaves()).toEqual([]); await a.putRevision(ref, revision); expect((await b.getRevision(ref)).status).toBe('missing'); await clearProfileCache({ idb }); expect(idb.databases.size).toBe(0); });
it('keys include namespace and revision; bounded LRU retains outbox', async () => { const idb = memoryIndexedDb(), cache = await openProfileCache({ ownerUid: 'owner', idb, limits: { revisions: 1, conversions: 1 } }); const a = await fixture(10), b = await fixture(20); b.ref = { ...b.ref, revision: 2, revisionId: b.ref.variantId + '~r2' }; b.revision = { ...b.revision, revision: 2, revisionId: b.ref.revisionId }; await cache.putPendingSave({ idempotencyKey: 'draft', payload: 'keep' }); await cache.putRevision(a.ref, a.revision); await cache.putRevision(b.ref, b.revision); expect((await cache.getRevision(a.ref)).status).toBe('missing'); expect((await cache.getRevision({ ...b.ref, namespace: 'other' })).status).toBe('missing'); expect((await cache.getRevision(b.ref)).status).toBe('fresh'); expect(await cache.listPendingSaves()).toHaveLength(1); await cache.putConversion('default-app-id', { conversionId: 'a' }); await cache.putConversion('default-app-id', { conversionId: 'b' }); expect(await cache.getConversions('default-app-id')).toHaveLength(1); cache.close(); });
it('heads expire and revalidate without changing pinned revisions', async () => { vi.useFakeTimers(); const idb = memoryIndexedDb(), cache = await openProfileCache({ ownerUid: 'owner', idb }); const { ref } = await fixture(); await cache.putHead(ref, { headRevision: 1 }); vi.setSystemTime(Date.now() + 86400001); expect((await cache.getHead(ref)).status).toBe('stale'); await cache.revalidate(async () => ({ headRevision: 2 })); expect((await cache.getHead(ref)).head.headRevision).toBe(2); expect((await cache.getHead(ref)).status).toBe('fresh'); cache.close(); });
it('drops corrupt data, uses no zero fallback, and disables unavailable IDB', async () => { const idb = memoryIndexedDb(), cache = await openProfileCache({ ownerUid: 'owner', idb }); const { ref, revision } = await fixture(); await cache.putRevision(ref, revision); idb.databases.get('nutrition-profile-cache-v1').get('revisions').values().next().value.revision.nutrients.protein = 999; expect((await cache.getRevision(ref)).status).toBe('corrupt'); expect((await cache.getRevision(ref)).status).toBe('missing'); const disabled = await openProfileCache({ ownerUid: 'owner', idb: null }); expect(await disabled.getRevision(ref)).toEqual({ status: 'missing' }); cache.close(); });
it('refreshes known heads when the browser reconnects', async () => {
    const target = new EventTarget();
    vi.stubGlobal('addEventListener', target.addEventListener.bind(target));
    vi.stubGlobal('removeEventListener', target.removeEventListener.bind(target));
    const idb = memoryIndexedDb(), cache = await openProfileCache({ ownerUid: 'owner', idb });
    const { ref } = await fixture();
    await cache.putHead(ref, { headRevision: 1 });
    const fetcher = vi.fn(async () => ({ headRevision: 2 }));
    await cache.revalidate(fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    target.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    cache.close();
    vi.unstubAllGlobals();
});
it('enforces total estimated JSON size without evicting pending drafts', async () => {
    const idb = memoryIndexedDb(), cache = await openProfileCache({ ownerUid: 'owner', idb, limits: { bytes: 50 } });
    const { ref, revision } = await fixture();
    await cache.putPendingSave({ idempotencyKey: 'keep', payload: 'x'.repeat(1000) });
    await cache.putRevision(ref, revision);
    expect((await cache.getRevision(ref)).status).toBe('missing');
    expect(await cache.listPendingSaves()).toHaveLength(1);
    cache.close();
});
it.each(['throw', 'error', 'blocked', 'silent'])('cache deletion is bounded and non-throwing: %s', async mode => {
    vi.useFakeTimers();
    const idb = { deleteDatabase() {
        if (mode === 'throw') throw new Error('Storage denied');
        const req = {};
        queueMicrotask(() => { if (mode === 'error') req.onerror(); if (mode === 'blocked') req.onblocked(); });
        return req;
    } };
    const result = clearProfileCache({idb});
    await vi.runAllTimersAsync();
    expect(await result).toBe(false);
});
it('same-owner reload preserves revisions, conversions and pending drafts', async () => {
    const idb = memoryIndexedDb(), first = await openProfileCache({ownerUid:'owner',idb});
    const {ref, revision} = await fixture();
    await first.putRevision(ref, revision);
    await first.putConversion(ref.namespace, {conversionId:'saved'});
    await first.putPendingSave({idempotencyKey:'draft'});
    first.close();
    const reloaded = await openProfileCache({ownerUid:'owner',idb});
    expect((await reloaded.getRevision(ref)).status).toBe('fresh');
    expect(await reloaded.getConversions(ref.namespace)).toHaveLength(1);
    expect(await reloaded.listPendingSaves()).toHaveLength(1);
    reloaded.close();
});
it('disables cache rather than exposing another owner when deletion fails', async () => {
    const idb = memoryIndexedDb(), first = await openProfileCache({ownerUid:'a',idb});
    await first.putPendingSave({idempotencyKey:'private'});
    idb.deleteDatabase = () => { throw new Error('Denied'); };
    const second = await openProfileCache({ownerUid:'b',idb});
    expect(await second.listPendingSaves()).toEqual([]);
    second.close();
});

it('reopened cache refreshes only expired heads',async()=>{
 vi.useFakeTimers();const idb=memoryIndexedDb(),first=await openProfileCache({ownerUid:'owner',idb,limits:{headTtlMs:100}}),{ref}=await fixture();
 await first.putHead(ref,{headRevision:1});vi.setSystemTime(Date.now()+101);
 await first.putHead({...ref,variantId:'another'},{headRevision:1});first.close();
 const reopened=await openProfileCache({ownerUid:'owner',idb,limits:{headTtlMs:100}}),fetcher=vi.fn(async()=>({headRevision:2}));
 await reopened.revalidate(fetcher);expect(fetcher.mock.calls).toEqual([[ref]]);await reopened.revalidate(fetcher);expect(fetcher).toHaveBeenCalledOnce();reopened.close();
});
it('bounds reconnect refresh to 50 heads and four concurrent requests and coalesces events',async()=>{
 const target=new EventTarget();vi.stubGlobal('addEventListener',target.addEventListener.bind(target));vi.stubGlobal('removeEventListener',target.removeEventListener.bind(target));
 const cache=await openProfileCache({ownerUid:'owner',idb:memoryIndexedDb()}),{ref}=await fixture();
 for(let i=0;i<55;i++)await cache.putHead({...ref,variantId:'variant'+i},{headRevision:1});
 let active=0,maxActive=0,release;const barrier=new Promise(resolve=>{release=resolve;});
 const fetcher=vi.fn(async()=>{active++;maxActive=Math.max(maxActive,active);await barrier;active--;return{headRevision:2};});
 await cache.revalidate(fetcher);target.dispatchEvent(new Event('online'));await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(4));
 target.dispatchEvent(new Event('online'));release();await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(50));expect(maxActive).toBe(4);cache.close();vi.unstubAllGlobals();
});
