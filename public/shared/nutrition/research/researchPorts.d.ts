import type { ResearchJob, ResearchJobState, ResearchJobScope } from './researchJob';
export interface ResearchJobStore {
    saveMany?(entries: {
        job: ResearchJob;
        expectedVersion?: number;
    }[]): Promise<void>;
    get(jobId: string): Promise<ResearchJob | null>;
    save(job: ResearchJob, options?: {
        expectedVersion?: number;
    }): Promise<void>;
    getByKey(jobKey: string): Promise<ResearchJob | null>;
    listByBatch(batchId: string): Promise<ResearchJob[]>;
    list(query?: {
        state?: ResearchJobState;
        scope?: ResearchJobScope;
        cursor?: string;
        limit?: number;
    }): Promise<{
        items: ResearchJob[];
        cursor: string | null;
    }>;
}
export interface CachedSourceEntry<T = any> {
    data: T;
    checksum: string;
    cached: boolean;
}
export interface SourceCache {
    getOrFetch<T = any>(key: string, fetcher: () => Promise<T>): Promise<CachedSourceEntry<T>>;
    get(key: string): Promise<{
        data: any;
        checksum: string;
    } | null>;
    set(key: string, data: any, checksum?: string): Promise<void>;
    has(key: string): Promise<boolean>;
}
export interface ResearchAdapterMetadata {
    id: string;
    scope: ('curated' | 'private')[];
    runsIn: ('browser' | 'cli')[];
    requiresSecret: boolean;
    release(): Promise<string>;
}
export interface FetchResearchAdapter {
    match(target: any, context?: any): Promise<any>;
    fetch(recordId: string, context?: any): Promise<any>;
    toSourceResult(raw: any, context?: any): Promise<any>;
}
export interface TwoPhaseResearchAdapter {
    prepareRequest(jobs: ResearchJob[], options?: any): Promise<any[]>;
    acceptResponse(input: any, context: any): Promise<any>;
}
export type ResearchAdapter = ResearchAdapterMetadata & (FetchResearchAdapter | TwoPhaseResearchAdapter);
