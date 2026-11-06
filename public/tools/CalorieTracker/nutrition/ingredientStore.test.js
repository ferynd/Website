import { it, expect, vi, beforeEach } from 'vitest';
const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../../shared/nutrition/capabilities.js', () => ({ get INGREDIENT_STORE_WRITES_ENABLED() { return flags.enabled; } }));
import { createIngredientStore, RevisionConflictError, IngredientWritesDisabledError, IdentityKeyCollisionError, NeedsReviewError } from '../../../shared/nutrition/ingredientStore.js';
import { fixture, fakePort, identity, dims } from './ingredientFixtures.js';
import { matchIngredient } from '../../../shared/nutrition/ingredientMatch.js';
import { overrideVariantId } from '../../../shared/nutrition/ingredientIds.js';
import { buildRevisionDraft } from '../../../shared/nutrition/ingredientProfile.js';
let port, store, pending;
beforeEach(() => { flags.enabled = true; port = fakePort(); pending = new Map(); store = createIngredientStore({ port, namespace: 'default-app-id', ownerUid: 'owner', cache: { getRevision: async () => ({ status: 'missing' }), putRevision: async () => { }, putConversion: async () => { }, getConversions: async () => [], getHead: async () => ({ status: 'missing' }), putHead: async () => { }, putPendingSave: async (d) => pending.set(d.idempotencyKey, d), deletePendingSave: async (k) => pending.delete(k), listPendingSaves: async () => [...pending.values()] } }); });
const payload = async (v = 10) => ({ identity, variant: { dims }, revisionDraft: (await fixture(v)).draft, confirmNew: true });
it('concurrent creates converge and repeat saves are idempotent', async () => { const p = await payload(); let arrivals=0,release; const barrier=new Promise(resolve=>{release=resolve;}); port.beforeCommit=async()=>{if(++arrivals===2)release();await barrier;}; const [a, b] = await Promise.all([store.createIngredient(p), store.createIngredient(p)]); expect(a).toEqual(b); expect(port.docs.size).toBe(3); expect(port.attempts).toBeGreaterThanOrEqual(3); const draft = (await fixture(20)).draft; const r2 = await store.saveRevision({ variantId: a.variantId, baseRevision: 1, revisionDraft: draft }); expect(r2.revision).toBe(2); expect(await store.saveRevision({ variantId: a.variantId, baseRevision: 1, revisionDraft: draft })).toEqual(r2); expect(port.docs.size).toBe(4); });
it('retains stale drafts and retries after explicit rebase', async () => { const r = await store.createIngredient(await payload()); await store.saveRevision({ variantId: r.variantId, baseRevision: 1, revisionDraft: (await fixture(20)).draft }); await expect(store.saveRevision({ variantId: r.variantId, baseRevision: 1, revisionDraft: (await fixture(30)).draft })).rejects.toBeInstanceOf(RevisionConflictError); expect(pending.size).toBe(1); const [saved] = await store.listPendingSaves(); const result = await store.retryPendingSave(saved.idempotencyKey, { ...saved.payload, baseRevision: 2 }); expect(result.revision).toBe(3); expect(pending.size).toBe(0); });
it('all writes fail with flag off', async () => { flags.enabled = false; await expect(store.createIngredient(await payload())).rejects.toBeInstanceOf(IngredientWritesDisabledError); await expect(store.saveRevision({})).rejects.toBeInstanceOf(IngredientWritesDisabledError); await expect(store.addConversion({})).rejects.toBeInstanceOf(IngredientWritesDisabledError); await expect(store.retireVariant('pv-test')).rejects.toBeInstanceOf(IngredientWritesDisabledError); await expect(store.updateIdentity('pi-test', {})).rejects.toBeInstanceOf(IngredientWritesDisabledError); await expect(store.retryPendingSave('x')).rejects.toBeInstanceOf(IngredientWritesDisabledError); expect(port.docs.size).toBe(0); });
it('detects an injected key collision and ambiguous aliases', async () => { await store.createIngredient(await payload()); const [key, doc] = [...port.docs].find(([p]) => p.includes('/ingredientIdentities/')); port.docs.set(key, { ...doc, identityKeyV1: 'collision' }); await expect(store.createIngredient(await payload())).rejects.toBeInstanceOf(IdentityKeyCollisionError); await expect(store.createIngredient({ ...await payload(), confirmNew: false })).rejects.toBeInstanceOf(NeedsReviewError); });
it('resolves pinned refs without research, detects corrupt content', async () => { const ref = await store.createIngredient(await payload()); const research = vi.fn(); expect((await store.resolveRef(ref)).status).toBe('fresh'); expect(research).not.toHaveBeenCalled(); const key = [...port.docs.keys()].find(p => p.includes('/ingredientRevisions/')); port.docs.get(key).nutrients.protein = 999; expect((await store.resolveRef(ref)).status).toBe('corrupt'); });
it('private override takes precedence without a private identity; pinned curated ref stays pinned', async () => { const f = await fixture(); const variantId = await overrideVariantId('nutrition-curated', 'chicken'); const draft = await buildRevisionDraft({ ...f.input, identityId: 'chicken', variantId }); const ref = await store.createIngredient({ identity, variant: { dims, overrides: { catalogId: 'nutrition-curated', variantId: 'chicken', revision: 1 } }, revisionDraft: draft, confirmNew: true }); expect([...port.docs.keys()].some(k => k.includes('/ingredientIdentities/'))).toBe(false); expect((await store.resolveEffectiveProfile({ ...f.ref, scope: 'curated', namespace: 'catalog:nutrition-curated', variantId: 'chicken' })).ref).toEqual(ref); });
it('alias-only suggestions require review, exact compatible confirmed alias may reuse', async () => { const { ref } = await fixture(); const candidate = { canonicalName: 'Chicken', aliases: [{ text: 'chicken', kind: 'search' }], dims, ref }; const services = { privateSearch: async () => [candidate], curatedSearch: async () => [] }; expect((await matchIngredient({ name: 'chicken', dims }, services)).kind).toBe('candidates'); candidate.aliases[0].kind = 'confirmed'; expect((await matchIngredient({ name: 'chicken', dims }, services)).kind).toBe('exact'); expect((await matchIngredient({ name: 'chicken', dims: { state: 'cooked' } }, services)).kind).toBe('candidates'); });
it('confirmed exact reference skips both searches and research', async () => {
    const ref = await store.createIngredient(await payload());
    const privateSearch = vi.fn(() => { throw new Error('Unexpected search'); });
    const curatedSearch = vi.fn(() => { throw new Error('Unexpected search'); });
    const research = vi.fn(() => { throw new Error('Unexpected research'); });
    const result = await matchIngredient({ ref, name: 'chicken', dims }, { privateSearch, curatedSearch, confirmedRefs: [ref], research });
    expect(result).toEqual({ kind: 'exact', ref });
    expect((await store.resolveRef(result.ref)).revision.nutrients.protein).toBe(10);
    expect(privateSearch).not.toHaveBeenCalled();
    expect(curatedSearch).not.toHaveBeenCalled();
    expect(research).not.toHaveBeenCalled();
});
it('failed atomic creates preserve a recoverable draft without partial documents', async () => {
    port.failCommit = true;
    await expect(store.createIngredient(await payload())).rejects.toThrow('Offline');
    expect(port.docs.size).toBe(0);
    expect(pending.size).toBe(1);
    port.failCommit = false;
    const [draft] = await store.listPendingSaves();
    const ref = await store.retryPendingSave(draft.idempotencyKey);
    expect(ref.revision).toBe(1);
    expect(port.docs.size).toBe(3);
    expect(pending.size).toBe(0);
});
it('keeps conversions immutable and validates the pinned source revision',async()=>{
 const {buildConversion}=await import('../../../shared/nutrition/ingredientConversion.js');
 const ref=await store.createIngredient(await payload());
 const conversion=await buildConversion({variantRef:ref,kind:'piece',unit:'piece',amount:1,grams:100,state:'raw',source:{type:'manual'},confidence:1});
 await store.addConversion(conversion);await store.addConversion(conversion);
 expect([...port.docs.keys()].filter(p=>p.includes('/ingredientConversions/'))).toHaveLength(1);
 await expect(store.addConversion({...conversion,variantRef:{...ref,contentHash:'sha256:'+'0'.repeat(64)}})).rejects.toThrow('mismatch');
});
it('private search caps pages and forwards an indexed token/cursor query',async()=>{
 const query=vi.spyOn(port,'queryCollection');
 await store.searchPrivate('Chicken',{pageSize:100,cursor:'previous'});
 expect(query).toHaveBeenCalledWith(expect.stringContaining('/ingredientIdentities'),{arrayContains:['searchTokens','chicken'],orderById:true,limit:26,startAfterId:'previous'});
});

it.each([
    ['strawberr', 'Strawberries', 'strawber'],
    ['chicken,', 'Chicken', 'chicken'],
    ['half-and-half', 'Half and half', 'half'],
    ['x'.repeat(100), 'x'.repeat(100), 'xxxxxxxx'],
])('private token query %s matches indexed prefixes and word splitting', async (query, name, token) => {
    const {buildSearchTokens} = await import('../../../shared/nutrition/ingredientIds.js');
    const p = await payload(), ref = await store.createIngredient(p);
    const key = [...port.docs.keys()].find(p => p.includes('/ingredientIdentities/'));
    port.docs.set(key, {...port.docs.get(key),canonicalName:name,searchTokens:buildSearchTokens(name)});
    const spy = vi.spyOn(port,'queryCollection');
    expect((await store.searchPrivate(query)).items[0].ref).toEqual(ref);
    expect(spy.mock.calls[0][1].arrayContains).toEqual(['searchTokens',token]);
    if (query === 'strawberr') expect((await store.searchPrivate('strawberrx')).items).toEqual([]);
    if (query === 'half-and-half') expect((await store.searchPrivate('half-and-cream')).items).toEqual([]);
});
it('single-character private search waits for an indexed prefix', async () => {
    const query = vi.spyOn(port,'queryCollection');
    expect(await store.searchPrivate('c')).toEqual({items:[],cursor:null});
    expect(query).not.toHaveBeenCalled();
});
it('composes real private search with matching to return a resolvable exact pinned head', async () => {
    const p = await payload(); p.identity = {...identity,aliases:[{text:'Poultry',kind:'confirmed'}]};
    const ref = await store.createIngredient(p);
    const matched = await matchIngredient({name:'Poultry',dims},{privateSearch:store.searchPrivate,curatedSearch:async()=>[]});
    expect(matched).toEqual({kind:'exact',ref});
    expect((await store.resolveRef(matched.ref)).status).toBe('fresh');
    expect((await matchIngredient({name:'Poultry',dims:{state:'cooked'}},{privateSearch:store.searchPrivate,curatedSearch:async()=>[]})).kind).toBe('candidates');
});
it('composes real curated catalog search with matching to return a resolvable exact pinned head', async () => {
    const {buildCatalogShards,createCuratedCatalogSource} = await import('../../../shared/nutrition/ingredientCatalog.js');
    const f = await fixture();
    const draft = await buildRevisionDraft({...f.input,identityId:'chicken',variantId:'chicken-raw'});
    const revision = {...draft,revision:1,revisionId:'chicken-raw~r1'};
    const built = await buildCatalogShards([{identity:{identityId:'chicken',canonicalName:'Chicken',aliases:[{text:'Poultry',kind:'confirmed'}]},variant:{identityId:'chicken',variantId:'chicken-raw',dims,headRevision:1,headRevisionId:revision.revisionId,headContentHash:revision.contentHash},revisions:[revision]}]);
    const catalog = createCuratedCatalogSource({fetchJson:async url => url.endsWith('manifest.json') ? built.manifest : built.files[url.split('/nutrition-curated/')[1]]});
    const reader = createIngredientStore({port,namespace:'default-app-id',ownerUid:'owner',catalog});
    const matched = await matchIngredient({name:'Poultry',dims},{privateSearch:reader.searchPrivate,curatedSearch:catalog.search});
    expect(matched.kind).toBe('exact');
    expect(matched.ref.scope).toBe('curated');
    expect((await reader.resolveRef(matched.ref)).revision.nutrients.protein).toBe(10);
});
it.each(['create','add','read-through'])('conversions saved online remain usable after offline reload: %s', async mode => {
    const {openProfileCache} = await import('../../../shared/nutrition/profileCache.js');
    const {memoryIndexedDb} = await import('./memoryIndexedDb.js');
    const {buildConversion,toGrams} = await import('../../../shared/nutrition/ingredientConversion.js');
    const idb = memoryIndexedDb(), cache = await openProfileCache({ownerUid:'owner',idb});
    const online = createIngredientStore({port,namespace:'default-app-id',ownerUid:'owner',cache});
    const p = await payload(), {ref} = await fixture();
    const conversion = await buildConversion({variantRef:ref,kind:'household',unit:'cup',amount:1,grams:120,state:'raw',source:{type:'manual'},confidence:1});
    if (mode === 'create') await online.createIngredient({...p,conversions:[conversion]});
    else {
        await online.createIngredient(p);
        if (mode === 'add') await online.addConversion(conversion);
        else {
            await store.addConversion(conversion);
            expect(await cache.getConversions(ref.namespace)).toEqual([]);
            expect(await online.getConversions(ref)).toHaveLength(1);
        }
    }
    online.close();
    const reloaded = await openProfileCache({ownerUid:'owner',idb});
    port.queryCollection = async () => {throw new Error('Offline');};
    const offline = createIngredientStore({port,namespace:'default-app-id',ownerUid:'owner',cache:reloaded});
    expect(toGrams(2,'cup',null,await offline.getConversions(ref),'raw')).toEqual({grams:240,conversionId:conversion.conversionId});
    expect(await offline.getConversions({...ref,revision:2,revisionId:ref.variantId+'~r2'})).toEqual([]);
    offline.close();
});
it('failed conversion commits and idempotent create with unsaved conversions do not populate cache', async () => {
    const {buildConversion} = await import('../../../shared/nutrition/ingredientConversion.js');
    const putConversion = vi.fn();
    const cached = createIngredientStore({port,namespace:'default-app-id',ownerUid:'owner',cache:{putPendingSave:async()=>{},deletePendingSave:async()=>{},putConversion}});
    const p = await payload(), ref = await cached.createIngredient(p);
    const conversion = await buildConversion({variantRef:ref,kind:'piece',unit:'piece',amount:1,grams:100,state:'raw',source:{type:'manual'},confidence:1});
    port.failCommit = true;
    await expect(cached.addConversion(conversion)).rejects.toThrow('Offline');
    expect(putConversion).not.toHaveBeenCalled();
    port.failCommit = false;
    await cached.createIngredient({...p,conversions:[conversion]});
    expect(putConversion).not.toHaveBeenCalled();
});

it('reads curated conversions through the catalog and caches only the pinned revision for offline use', async () => {
    const {buildCatalogShards,createCuratedCatalogSource} = await import('../../../shared/nutrition/ingredientCatalog.js');
    const {openProfileCache} = await import('../../../shared/nutrition/profileCache.js');
    const {memoryIndexedDb} = await import('./memoryIndexedDb.js');
    const {buildConversion,toGrams} = await import('../../../shared/nutrition/ingredientConversion.js');
    const f = await fixture();
    const draft = await buildRevisionDraft({...f.input,identityId:'chicken',variantId:'chicken-raw'});
    const revision = {...draft,revision:1,revisionId:'chicken-raw~r1'};
    const ref = {...f.ref,scope:'curated',namespace:'catalog:nutrition-curated',identityId:'chicken',variantId:'chicken-raw',revisionId:revision.revisionId,contentHash:revision.contentHash};
    const conversion = await buildConversion({variantRef:ref,kind:'piece',unit:'piece',amount:1,grams:80,state:'raw',source:{type:'curated_catalog'},confidence:1});
    const built = await buildCatalogShards([{identity:{identityId:'chicken',canonicalName:'Chicken'},variant:{identityId:'chicken',variantId:'chicken-raw',dims,headRevision:1,headRevisionId:revision.revisionId,headContentHash:revision.contentHash},revisions:[revision],conversions:[conversion]}]);
    const catalog = createCuratedCatalogSource({fetchJson:async url => url.endsWith('manifest.json') ? built.manifest : built.files[url.split('/nutrition-curated/')[1]]});
    const idb = memoryIndexedDb(), cache = await openProfileCache({ownerUid:'owner',idb});
    const online = createIngredientStore({port,namespace:'default-app-id',ownerUid:'owner',cache,catalog});
    expect(await online.getConversions(ref)).toEqual([conversion]);
    online.close();
    const reloaded = await openProfileCache({ownerUid:'owner',idb});
    const offline = createIngredientStore({port,namespace:'default-app-id',ownerUid:'owner',cache:reloaded,catalog:createCuratedCatalogSource({fetchJson:async()=>{throw new Error('Offline');}})});
    expect(toGrams(2,'piece',null,await offline.getConversions(ref),'raw')).toEqual({grams:160,conversionId:conversion.conversionId});
    offline.close();
});
