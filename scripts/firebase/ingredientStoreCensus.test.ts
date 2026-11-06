import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { countIngredientPaths, refuseIngredientCensusWrites } from './ingredientStoreCensusLogic';
it('counts the four groups by prefix and emits only aggregates', () => {
    const result = countIngredientPaths([
        'artifacts/default-app-id/users/private-sentinel/ingredientIdentities/name-sentinel',
        'artifacts/default-app-id/users/private-sentinel/ingredientRevisions/revision-sentinel',
        'artifacts/other/users/private-sentinel/ingredientVariants/variant-sentinel',
        'artifacts/default-app-id/users/private-sentinel/foodItems/not-counted',
        'artifacts/default-app-id/users/private-sentinel/foodItems/x/ingredientConversions/conversion-sentinel',
    ]);
    expect(result.collections.ingredientIdentities).toEqual({ trackerNamespace: 1, otherPaths: 0 });
    expect(result.collections.ingredientVariants).toEqual({ trackerNamespace: 0, otherPaths: 1 });
    expect(result.collections.ingredientConversions).toEqual({ trackerNamespace: 0, otherPaths: 1 });
    expect(JSON.stringify(result)).not.toContain('sentinel');
});
it('refuses all remote write modes and projects other than the explicit target', () => {
    for (const key of ['write', 'apply', 'delete'])
        expect(() => refuseIngredientCensusWrites({ project: 'jlb-calorietracker', [key]: true })).toThrow('read-only');
    expect(() => refuseIngredientCensusWrites({ project: 'other' })).toThrow();
    const source = readFileSync('scripts/firebase/ingredientStoreCensus.ts', 'utf8');
    expect(source).not.toMatch(/\.(?:set|update|delete|batch|runTransaction)\(/);
    expect(source).toContain('.select()');
});
