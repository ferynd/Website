import { describe, it, expect } from 'vitest';
import * as ids from '../../../shared/nutrition/ingredientIds.js';
import { canonicalJson, contentHashOf } from '../../../shared/nutrition/contentHash.js';
import { parseIngredientRef, sameRef, refCacheKey } from '../../../shared/nutrition/ingredientRefs.js';
import { fixture, identity } from './ingredientFixtures.js';
describe('stable ingredient IDs and references', () => {
    it('normalizes names and derives deterministic IDs from frozen keys', async () => { const key = ids.identityKeyV1(identity); expect(ids.normalizeIdentityName('  CHICKEN  meat ')).toBe('chicken meat'); expect(await ids.privateIdentityId(key)).toBe(await ids.privateIdentityId({ ...identity, canonicalName: ' CHICKEN ' })); const renamed = { ...identity, canonicalName: 'Poultry', identityKeyV1: key }; expect(await ids.privateIdentityId(renamed.identityKeyV1)).toBe(await ids.privateIdentityId(key)); });
    it('canonicalizes key order, changes hashes on changed content, rejects non JSON', async () => { expect(await contentHashOf({ b: 1, a: 2 })).toBe(await contentHashOf({ a: 2, b: 1 })); expect(await contentHashOf({ a: 3 })).not.toBe(await contentHashOf({ a: 2 })); expect(() => canonicalJson({ x: undefined })).toThrow(); expect(ids.variantKeyV1({ state: 'raw', fatPercent: 10 })).toBe(ids.variantKeyV1({ fatPercent: 10, state: 'raw' })); });
    it('uses override and revision ID formats and bounded tokens', async () => { expect(await ids.overrideVariantId('nutrition-curated', 'salt')).toMatch(/^ov-[a-f0-9]{20}$/); expect(ids.revisionIdFor('salt', 2)).toBe('salt~r2'); expect(() => ids.revisionIdFor('salt', 0)).toThrow(); expect(ids.buildSearchTokens('Long ingredient', Array.from({ length: 32 }, (_, n) => 'alias' + n)).length).toBeLessThanOrEqual(64); for (const id of ['a/b', '..', '__reserved__', ''])
        expect(ids.isValidFirestoreDocId(id)).toBe(false); });
    it('parses only complete pinned refs', async () => { const { ref } = await fixture(); expect(parseIngredientRef(ref)).toEqual(ref); expect(parseIngredientRef({ ...ref, revisionId: 'wrong' })).toBeNull(); expect(parseIngredientRef({ ...ref, contentHash: 'no' })).toBeNull(); expect(sameRef(ref, { ...ref })).toBe(true); expect(refCacheKey(ref)).toContain('default-app-id|pv-'); });
});

it('indexes every full first alias word before optional prefixes', () => {
 const aliases=Array.from({length:32},(_,i)=>({text:'Longaliasword'+i+' extra words',kind:'confirmed'}));
 const tokens=ids.buildSearchTokens('Canonical food',aliases);
 expect(tokens.length).toBeLessThanOrEqual(64);
 for(const text of ['Canonical food',...aliases.map(a=>a.text)]) expect(tokens).toContain(ids.searchWords(text)[0]);
 expect(()=>ids.buildSearchTokens('food',[...aliases,{text:'extra'}])).toThrow('32');
 expect(()=>ids.buildSearchTokens('food',[{text:'!!!'}])).toThrow('searchable');
});
