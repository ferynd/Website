import type { IngredientProfileRef } from './ingredientRefs';
import type { IngredientRevision } from './ingredientProfile';
import type { IngredientConversion } from './ingredientConversion';
export const PROFILE_CACHE_LIMITS: Readonly<{
    revisions: 2000;
    conversions: 4000;
    bytes: number;
    headTtlMs: number;
}>;
export function clearProfileCache(options?: {
    idb?: IDBFactory;
}): Promise<void>;
export function openProfileCache(options: {
    ownerUid: string;
    idb?: IDBFactory;
    limits?: Partial<{revisions:number;conversions:number;bytes:number;headTtlMs:number}>;
}): Promise<{
    getRevision(ref: IngredientProfileRef): Promise<{
        status: 'fresh' | 'missing' | 'corrupt';
        revision?: IngredientRevision;
    }>;
    putRevision(ref: IngredientProfileRef, revision: IngredientRevision): Promise<void>;
    getHead(ref: IngredientProfileRef): Promise<{
        status: 'fresh' | 'stale' | 'missing';
        head?: any;
    }>;
    putHead(ref: IngredientProfileRef, head: any): Promise<void>;
    getConversions(namespace: string): Promise<IngredientConversion[]>;
    putConversion(namespace: string, conversion: IngredientConversion): Promise<void>;
    revalidate(fetcher: (ref: IngredientProfileRef) => Promise<any>): Promise<void>;
    evict(): Promise<void>;
    putPendingSave(draft: any): Promise<void>;
    listPendingSaves(): Promise<any[]>;
    deletePendingSave(key: string): Promise<void>;
    close(): void;
}>;
export type ProfileCache = Awaited<ReturnType<typeof openProfileCache>>;
