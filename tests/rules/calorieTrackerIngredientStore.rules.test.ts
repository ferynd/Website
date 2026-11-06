import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, type Firestore } from 'firebase/firestore';
let env: RulesTestEnvironment;
const uid = 'ingredient-owner', pi = 'pi-' + 'a'.repeat(20), pv = 'pv-' + 'b'.repeat(20), hash = 'sha256:' + 'c'.repeat(64);
const prefix = `artifacts/default-app-id/users/${uid}`;
const path = (collection: string, id: string) => `${prefix}/${collection}/${id}`;
const stamp = () => serverTimestamp();
const identity = () => ({ schemaVersion: 1, ownerUid: uid, identityId: pi, identityKeyV1: 'v1|chicken|meat|food', canonicalName: 'Chicken', category: 'meat', kind: 'food', aliases: [], searchTokens: ['chicken'], createdAt: stamp(), updatedAt: stamp(), retiredAt: null });
const variant = (id = pv, overrides: unknown = null) => ({ schemaVersion: 1, ownerUid: uid, identityId: overrides ? 'chicken' : pi, variantId: id, variantKeyV1: 'raw', dims: { state: 'raw' }, overrides, headRevision: 1, headRevisionId: id + '~r1', headContentHash: hash, createdAt: stamp(), updatedAt: stamp(), retiredAt: null });
const revision = (id = pv, n = 1) => ({ schemaVersion: 1, ownerUid: uid, identityId: id.startsWith('ov-') ? 'chicken' : pi, variantId: id, basis: { kind: 'per_100g_edible', state: 'raw' }, nutrients: { protein: 10 }, nutrientMeta: { registryVersion: 2, quality: { protein: { status: 'measured' } } }, fieldProvenance: { protein: { sourceKey: 'manual' } }, sources: { manual: { type: 'manual' } }, basedOn: null, supersedes: n === 1 ? null : { revision: n - 1, revisionId: id + '~r' + (n - 1), contentHash: hash }, contentHash: hash, revision: n, revisionId: id + '~r' + n, idempotencyKey: 'test', createdAt: stamp() });
async function create(db: Firestore, id = pv, overrides: unknown = null, changes: Record<string, unknown> = {}) { const b = writeBatch(db); if (!overrides)
    b.set(doc(db, path('ingredientIdentities', pi)), identity()); b.set(doc(db, path('ingredientVariants', id)), { ...variant(id, overrides), ...changes }); b.set(doc(db, path('ingredientRevisions', id + '~r1')), revision(id)); return b.commit(); }
const adminEmail = readFileSync('firestore.rules', 'utf8').match(/token\.get\('email', null\) == '([^']+)'/)![1];
const owner = () => env.authenticatedContext(uid).firestore() as unknown as Firestore;
beforeAll(async () => { env = await initializeTestEnvironment({ projectId: 'demo-website-rules-test', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } }); });
beforeEach(async () => env.clearFirestore());
afterAll(async () => env.cleanup());
describe('ingredient store boundary (source only)', () => {
    it('allows owner atomic create, alias update, sourced conversion and head advance', async () => { const db = owner(); await assertSucceeds(create(db)); await assertSucceeds(updateDoc(doc(db, path('ingredientIdentities', pi)), { aliases: [{ text: 'poultry', kind: 'search' }], updatedAt: stamp() })); const pc = 'pc-' + 'd'.repeat(20); await assertSucceeds(setDoc(doc(db, path('ingredientConversions', pc)), { schemaVersion: 1, ownerUid: uid, conversionId: pc, variantRef: { refVersion: 1, scope: 'private', namespace: 'default-app-id', identityId: pi, variantId: pv, revision: 1, revisionId: pv + '~r1', contentHash: hash }, kind: 'piece', unit: 'piece', amount: 1, grams: 100, state: 'raw', source: { type: 'manual' }, confidence: 1, createdAt: stamp() })); await assertFails(updateDoc(doc(db, path('ingredientConversions', pc)), { grams: 1 })); await assertFails(deleteDoc(doc(db, path('ingredientConversions', pc)))); const b = writeBatch(db); b.set(doc(db, path('ingredientRevisions', pv + '~r2')), revision(pv, 2)); b.update(doc(db, path('ingredientVariants', pv)), { headRevision: 2, headRevisionId: pv + '~r2', headContentHash: hash, updatedAt: stamp() }); await assertSucceeds(b.commit()); });
    it('allows anonymous-auth owner and soft retirement without a head bump (A4)', async () => { const db = env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore() as unknown as Firestore; await assertSucceeds(create(db)); await assertSucceeds(updateDoc(doc(db, path('ingredientVariants', pv)), { retiredAt: stamp(), updatedAt: stamp() })); await assertFails(updateDoc(doc(db, path('ingredientVariants', pv)), { dims: { state: 'cooked' }, updatedAt: stamp() })); });
    it('allows curated override without private identity (A2), rejects both malformed override branches', async () => { const id = 'ov-' + 'e'.repeat(20); await assertSucceeds(create(owner(), id, { catalogId: 'nutrition-curated', variantId: 'chicken', revision: 1 })); await assertFails(create(owner(), 'ov-' + 'f'.repeat(20))); await assertFails(create(owner(), pv, { catalogId: 'nutrition-curated', variantId: 'chicken', revision: 1 })); });
    it('rejects mismatched head hash on initial create (A8)', async () => { await assertFails(create(owner(), pv, null, { headContentHash: 'sha256:' + '0'.repeat(64) })); });
    it('rejects missing identity on non-override create', async () => { const db = owner(), b = writeBatch(db); b.set(doc(db, path('ingredientVariants', pv)), variant()); b.set(doc(db, path('ingredientRevisions', pv + '~r1')), revision()); await assertFails(b.commit()); });
    it.each(['update', 'delete'])('denies revision %s and immutable identity mutations', async (mode) => { const db = owner(); await create(db); const r = doc(db, path('ingredientRevisions', pv + '~r1')); await assertFails(mode === 'update' ? updateDoc(r, { contentHash: hash }) : deleteDoc(r)); await assertFails(updateDoc(doc(db, path('ingredientIdentities', pi)), { category: 'other', updatedAt: stamp() })); await assertFails(deleteDoc(doc(db, path('ingredientIdentities', pi)))); await assertFails(deleteDoc(doc(db, path('ingredientVariants', pv)))); });
    it('denies standalone revision, head skip, missing revision and hash mismatch', async () => { const db = owner(); await create(db); await assertFails(setDoc(doc(db, path('ingredientRevisions', pv + '~r2')), revision(pv, 2))); await assertFails(updateDoc(doc(db, path('ingredientVariants', pv)), { headRevision: 2, headRevisionId: pv + '~r2', updatedAt: stamp() })); for (const [n, h] of [[3, hash], [2, 'sha256:' + '0'.repeat(64)]] as const) {
        const b = writeBatch(db);
        b.set(doc(db, path('ingredientRevisions', pv + '~r' + n)), revision(pv, n));
        b.update(doc(db, path('ingredientVariants', pv)), { headRevision: n, headRevisionId: pv + '~r' + n, headContentHash: h, updatedAt: stamp() });
        await assertFails(b.commit());
    } });
    it('denies revision ID mismatch, owner mismatch and extra keys', async () => { const db = owner(); await create(db); await assertFails(setDoc(doc(db, path('ingredientRevisions', 'wrong')), revision(pv, 2))); await assertFails(setDoc(doc(db, path('ingredientIdentities', 'pi-' + '1'.repeat(20))), { ...identity(), identityId: 'pi-' + '1'.repeat(20), ownerUid: 'other' })); await assertFails(updateDoc(doc(db, path('ingredientIdentities', pi)), { extra: 'no', updatedAt: stamp() })); });
    it.each(['other', 'unauthenticated', 'admin'])('denies %s cross-user access and catalog writes', async (persona) => { await create(owner()); const db = persona === 'unauthenticated' ? env.unauthenticatedContext().firestore() : env.authenticatedContext(persona, persona === 'admin' ? { email: adminEmail, email_verified: true } : {}).firestore(); for (const c of ['ingredientIdentities', 'ingredientVariants', 'ingredientRevisions', 'ingredientConversions']) {
        await assertFails(getDoc(doc(db, path(c, c === 'ingredientIdentities' ? pi : c === 'ingredientVariants' ? pv : c === 'ingredientRevisions' ? pv + '~r1' : 'pc-' + 'd'.repeat(20)))));
        await assertFails(setDoc(doc(db, path(c, 'unexpected')), { ownerUid: uid }));
    } await assertFails(setDoc(doc(db, 'artifacts/nutrition-catalog/profiles/chicken'), { value: 1 })); });
    it('also denies catalog writes by owner and zero-depth user document; reserves nested ingredient paths', async () => { const db = owner(); await assertFails(setDoc(doc(db, 'artifacts/nutrition-catalog/profiles/chicken'), {})); await assertFails(setDoc(doc(db, prefix), {})); await assertFails(setDoc(doc(db, path('ingredientRevisions', pv + '~r1') + '/deep/doc'), {})); });
    it.each(['foodItems/chicken', 'dailyEntries/2026-11-06', 'targets/baseline', 'goals/settings', 'profile/main', 'weightEntries/one', 'foodItems/chicken/deep/doc'])('preserves legacy owner access and cross-user denial: %s', async (suffix) => { const p = prefix + '/' + suffix; await assertSucceeds(setDoc(doc(owner(), p), { legacy: true })); const other = env.authenticatedContext('other').firestore(); await assertFails(getDoc(doc(other, p))); await assertFails(setDoc(doc(other, p), { legacy: false })); });
    it('preserves recipe namespace ownership', async () => { const p = `artifacts/recipe-standardizer/users/${uid}/recipes/one`; await assertSucceeds(setDoc(doc(owner(), p), { recipe: {} })); await assertFails(setDoc(doc(env.authenticatedContext('other').firestore(), p), {})); });
});

describe('ingredient field bounds and types', () => {
    it.each([
        {category:'x'.repeat(81)}, {kind:'x'.repeat(81)}, {category:42}, {kind:[]},
        {aliases:[{text:'x'.repeat(201),kind:'confirmed'}]}, {aliases:[{text:42,kind:'search'}]},
        {aliases:[{text:'valid',kind:'invented'}]}, {aliases:[{text:'valid',kind:'search',extra:true}]},
        {aliases:['not a map']}, {aliases:Array(33).fill({text:'ok',kind:'search'})},
        {searchTokens:['x'.repeat(81)]}, {searchTokens:[42]}, {searchTokens:[null]}, {searchTokens:[false]}, {searchTokens:[{}]}, {searchTokens:['a|b']}, {searchTokens:Array(65).fill('ok')},
        {aliases:[...Array(31).fill({text:'ok',kind:'search'}),{text:'x'.repeat(201),kind:'confirmed'}]},
        {searchTokens:[...Array(63).fill('ok'),42]},
    ])('rejects malformed/oversize identity fields: %j', async changes => {
        await assertFails(setDoc(doc(owner(),path('ingredientIdentities',pi)),{...identity(),...changes}));
    });
    it('accepts 32 bounded aliases and 64 tokens, including the last entry', async () => {
        await assertSucceeds(setDoc(doc(owner(),path('ingredientIdentities',pi)),{
            ...identity(),aliases:Array.from({length:32},(_,i)=>({text:'alias '+i,kind:'search'})),searchTokens:Array.from({length:64},(_,i)=>'word'+i),
        }));
    });
    it('validates later alias/token entries on metadata updates too', async () => {
        const db = owner(); await create(db);
        await assertFails(updateDoc(doc(db,path('ingredientIdentities',pi)),{aliases:[{text:'ok',kind:'search'},{text:'x'.repeat(201),kind:'confirmed'}],updatedAt:stamp()}));
        await assertFails(updateDoc(doc(db,path('ingredientIdentities',pi)),{searchTokens:['ok',false],updatedAt:stamp()}));
    });
    it.each([
        {state:'x'.repeat(201)}, {state:4}, {preparation:'x'.repeat(201)}, {preparation:[]},
        {drained:4}, {salt:'invalid'}, {fortification:false}, {fatPercent:101}, {leanPercent:'50'},
        {fortificationDetail:'x'.repeat(201)}, {sweetening:{}}, {ediblePortion:'x'.repeat(201)},
        {brand:'invalid'}, {brand:{brand:'x'.repeat(201)}}, {brand:{gtin:123}}, {brand:{formulationNote:'x'.repeat(501)}},
    ])('rejects malformed/oversize dimension values: %j', async changes => {
        await assertFails(create(owner(),pv,null,{dims:{state:'raw',...changes}}));
    });
    it.each(['x'.repeat(201),42,'bad/identity'])('rejects invalid curated override identityId: %j', async identityId => {
        await assertFails(create(owner(),'ov-'+'e'.repeat(20),{catalogId:'nutrition-curated',variantId:'chicken',revision:1},{identityId}));
    });
    const conversion = () => ({schemaVersion:1,ownerUid:uid,conversionId:'pc-'+'d'.repeat(20),variantRef:{refVersion:1,scope:'private',namespace:'default-app-id',identityId:pi,variantId:pv,revision:1,revisionId:pv+'~r1',contentHash:hash},kind:'piece',unit:'piece',amount:1,grams:100,state:'raw',source:{type:'manual'},confidence:1,createdAt:stamp()});
    it.each([
        {unitQualifier:'x'.repeat(201)}, {unitQualifier:42}, {state:'x'.repeat(201)},
        {range:'invalid'}, {range:{min:0,max:1000001}}, {range:{min:'0',max:1}}, {range:{min:2,max:1}}, {range:{min:0,max:1,extra:true}},
        {supersedes:'x'.repeat(200)}, {supersedes:42}, {source:{type:'manual',title:'x'.repeat(501)}},
        {source:{type:'manual',url:'x'.repeat(2049)}}, {source:{type:'manual',recordId:123}},
        {source:{type:'manual',permittedUse:'x'.repeat(1001)}}, {source:{type:'manual',extra:'no'}},
    ])('rejects malformed/oversize conversion fields: %j', async changes => {
        const db = owner(); await create(db);
        await assertFails(setDoc(doc(db,path('ingredientConversions','pc-'+'d'.repeat(20))),{...conversion(),...changes}));
    });
    it('accepts bounded dimensions and conversion metadata', async () => {
        const db = owner();
        await assertSucceeds(create(db,pv,null,{dims:{state:'raw',preparation:'chopped',drained:'not_applicable',salt:'unsalted',fortification:'unfortified',fortificationDetail:'unspecified',sweetening:'unsweetened',ediblePortion:'all',fatPercent:2,leanPercent:null,brand:{brand:'Brand',product:'Food',gtin:'123',market:'US',labelDate:'2026-11-06',formulationNote:'Current'}}}));
        await assertSucceeds(setDoc(doc(db,path('ingredientConversions','pc-'+'d'.repeat(20))),{...conversion(),unitQualifier:'whole',range:{min:90,max:110},supersedes:'pc-'+'e'.repeat(20),source:{type:'manual',datasetId:'set',recordId:'record',title:'Fixture',url:'https://example.com',version:'1',publishedAt:'2026-01-01',accessedAt:'2026-11-06',originalBasis:'one piece',permittedUse:'private',checksum:'test'}}));
    });
});

describe('identity capacity', () => {
    it.each([0,1,7,8,9,15,16,17,24,25,31,32].map(count => [count,64]))('accepts %i aliases and %i tokens', async (aliases,tokens) => {
        await assertSucceeds(setDoc(doc(owner(),path('ingredientIdentities',pi)),{...identity(),aliases:Array.from({length:aliases},(_,i)=>({text:'alias '+i,kind:'search'})),searchTokens:Array.from({length:tokens},(_,i)=>'word'+i)}));
    });
});

it('accepts a full-capacity identity in the atomic ingredient create batch', async () => {
    const db = owner(), b = writeBatch(db);
    b.set(doc(db,path('ingredientIdentities',pi)),{...identity(),aliases:Array.from({length:32},(_,i)=>({text:'alias '+i,kind:'confirmed'})),searchTokens:Array.from({length:64},(_,i)=>'word'+i)});
    b.set(doc(db,path('ingredientVariants',pv)),variant());
    b.set(doc(db,path('ingredientRevisions',pv+'~r1')),revision());
    await assertSucceeds(b.commit());
});
