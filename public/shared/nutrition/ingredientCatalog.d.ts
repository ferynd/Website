export function buildCatalogShards(records: any[]): Promise<{
    manifest: any;
    files: Record<string, any>;
}>;
export function createCuratedCatalogSource(options?: {
    fetchJson?: (url: string) => Promise<any>;
    maxShards?: number;
}): {
    open(): Promise<any>;
    search(q: string, options?: {
        pageSize?: number;
        cursor?: string;
    }): Promise<{
        items: any[];
        cursor: string | null;
    }>;
    getVariant(id: string): Promise<any | null>;
    getConversions(id: string): Promise<import('./ingredientConversion').IngredientConversion[]>;
    getRevision(id: string, n: number): Promise<any | null>;
    stats(): {
        shards: number;
        profileCount: number;
    };
};
export type CuratedCatalogSource = ReturnType<typeof createCuratedCatalogSource>;
