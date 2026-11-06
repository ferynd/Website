import { it, expect } from 'vitest';
import { buildConversion, toGrams } from '../../../shared/nutrition/ingredientConversion.js';
import { fixture } from './ingredientFixtures.js';
it.each([['household', 'cup', 200, 2, 400], ['piece', 'egg', 50, 2, 100], ['package', 'pack', 300, 1, 300], ['density', 'mL', 1.2, 100, 120]])('converts sourced %s quantities', async (kind, unit, value, quantity, grams) => { const { ref } = await fixture(); const c = await buildConversion({ variantRef: ref, kind, unit, amount: 1, ...(kind === 'density' ? { gramsPerMl: value } : { grams: value }), state: 'raw', source: { type: 'manual' }, confidence: 1 }); expect(toGrams(quantity, unit, null, [c], 'raw')).toEqual({ grams, conversionId: c.conversionId }); expect(toGrams(quantity, unit, null, [c], 'cooked')).toEqual({ error: 'state_mismatch' }); });
it('refuses missing density instead of assuming water', () => { expect(toGrams(100, 'mL', null, [], 'raw')).toEqual({ error: 'missing_conversion' }); expect(toGrams(10, 'g', null, [], 'raw')).toEqual({ grams: 10, conversionId: null }); });

it('resolves supersession chains and forks independently of record ordering', async () => {
 const {ref}=await fixture(), base={variantRef:ref,kind:'piece',unit:'piece',amount:1,grams:100,state:'raw',source:{type:'manual'},confidence:1};
 const a=await buildConversion(base), b=await buildConversion({...base,grams:120,supersedes:a.conversionId});
 const c=await buildConversion({...base,grams:150,supersedes:b.conversionId});
 for(const records of [[a,b,c],[c,b,a],[b,a,c]]) expect(toGrams(2,'piece',null,records,'raw')).toEqual({grams:300,conversionId:c.conversionId});
 const d=await buildConversion({...base,grams:140,supersedes:a.conversionId}), e=await buildConversion({...base,grams:130});
 for(const records of [[a,e],[e,a],[a,b,d],[d,b,a]]) expect(toGrams(1,'piece',null,records,'raw')).toEqual({error:'ambiguous_conversion'});
});
it('does not revive ancestors with changed state or supersede another profile', async () => {
 const {ref}=await fixture(), base={variantRef:ref,kind:'piece',unit:'piece',amount:1,grams:100,state:'raw',source:{type:'manual'},confidence:1};
 const a=await buildConversion(base), b=await buildConversion({...base,state:'cooked',supersedes:a.conversionId});
 expect(toGrams(1,'piece',null,[a,b],'raw')).toEqual({error:'state_mismatch'});
 expect(toGrams(1,'piece',null,[a,{...b,variantRef:{...ref,identityId:'other'}}],'raw')).toEqual({grams:100,conversionId:a.conversionId});
});
