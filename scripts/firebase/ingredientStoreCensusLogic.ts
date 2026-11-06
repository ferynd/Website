import { INGREDIENT_COLLECTIONS } from '../../public/shared/nutrition/ingredientIds.js';
export const CENSUS_COLLECTIONS = Object.values(INGREDIENT_COLLECTIONS);
export interface IngredientCensus {
    schemaVersion: 1;
    readOnly: true;
    collections: Record<string, {
        trackerNamespace: number;
        otherPaths: number;
    }>;
}
/** No document IDs, owners, names, or nutrient values are retained. */
export function countIngredientPaths(paths: Iterable<string>): IngredientCensus {
    const collections = Object.fromEntries(CENSUS_COLLECTIONS.map(name => [name, { trackerNamespace: 0, otherPaths: 0 }]));
    for (const path of paths) {
        const segments = path.split('/');
        const collection = segments.at(-2) ?? '';
        if (!CENSUS_COLLECTIONS.includes(collection as typeof CENSUS_COLLECTIONS[number]))
            continue;
        const tracker = segments.length === 6 && segments[0] === 'artifacts' && segments[1] === 'default-app-id' && segments[2] === 'users';
        collections[collection][tracker ? 'trackerNamespace' : 'otherPaths']++;
    }
    return { schemaVersion: 1, readOnly: true, collections };
}
export function refuseIngredientCensusWrites(options: {
    write?: boolean;
    apply?: boolean;
    delete?: boolean;
    project: string;
}): void {
    if (options.write || options.apply || options.delete)
        throw new Error('Ingredient census is read-only; writes are refused');
    if (options.project !== 'jlb-calorietracker')
        throw new Error('Explicit census project required');
}
