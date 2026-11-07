import type { ResearchJobStore, SourceCache, ResearchAdapter } from './researchPorts';
import type { ResearchJob, ResearchJobScope } from './researchJob';
import type { ReviewDecision } from './researchReview';
export interface ResearchServiceOptions {
    store: ResearchJobStore;
    sourceCache: SourceCache;
    adapters?: ResearchAdapter[];
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    retry?: {
        maxAttempts?: number;
        baseMs?: number;
        maxMs?: number;
    };
}
export interface ResearchService {
    retryJob(jobId: string): Promise<ResearchJob>;
    prepareRequest(jobIds: string[], options?: any): Promise<any[]>;
    acceptResponse(input: any, options?: any): Promise<ResearchJob[]>;
    cancelRequest(requestId: string, options?: {
        expiredOnly?: boolean;
    }): Promise<ResearchJob[]>;
    attestSource(jobId: string, sourceId: string, reviewer: string): Promise<ResearchJob>;
    verifySource(jobId: string, sourceId: string, adapterId: string, context?: any): Promise<ResearchJob>;
    enqueue(params: {
        scope?: ResearchJobScope;
        ownerUid?: string;
        targetKind?: 'catalog' | 'private';
        target: any;
        fields?: string[] | '*';
        sourceRelease?: string;
        parentBatchId?: string;
        passId?: string;
    }): Promise<ResearchJob>;
    runJob(jobId: string, options?: {
        signal?: AbortSignal;
        passId?: string;
        context?: any;
        adapterId?: string;
    }): Promise<ResearchJob>;
    runBatch(batchId: string, options?: {
        signal?: AbortSignal;
    }): Promise<{
        batchId: string;
        total: number;
        processed: number;
        completed: number;
        blocked: number;
        items: ResearchJob[];
    }>;
    review(jobId: string, decision: ReviewDecision): Promise<ResearchJob>;
    report(batchId: string): Promise<{
        batchId: string;
        total: number;
        queued: number;
        matched: number;
        needs_review: number;
        approved: number;
        imported: number;
        blocked: number;
    }>;
}
export declare function createResearchService(options: ResearchServiceOptions): ResearchService;
