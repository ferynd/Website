import type { ResearchJob } from './researchJob';
import type { StagedNutrientRecord } from '../nutrientRegistry';
export declare const CHECKLIST_VERSION: number;
export declare const PLAYBOOK_CHECKLIST: readonly Array<{
    id: string;
    text: string;
}>;
export interface RevisionDiff {
    hasChanges: boolean;
    totalChanges: number;
    nutrientChanges: Record<string, {
        oldValue: number | null;
        newValue: number | null;
        oldStatus: string | null;
        newStatus: string | null;
        oldSource: string | null;
        newSource: string | null;
    }>;
    addedConversions: any[];
    supersededConversions: any[];
}
export interface ReviewPacket {
    json: any;
    markdown: string;
}
export interface ReviewDecision {
    attestation?: boolean;
    decision: 'approve' | 'reject' | 'block';
    reviewer: string;
    approvedContentHash?: string;
    acknowledgedWarnings?: string[];
    blockedReason?: {
        code: string;
        needs: string;
    };
    notes?: string;
}
export interface PublishedIdentity {
    canonicalName: string | null;
    aliases: any;
    category: string;
    kind: string;
    dims: any;
}
export declare function publishedIdentityFor(job: { target?: any }): PublishedIdentity;
export declare function buildRevisionDiff(base: any, draft: any, conversions?: any[]): RevisionDiff;
export declare function reviewContentHash(job: { proposal: any; target?: any }): Promise<string>;
export interface VerifiedFdcRecord {
    sourceId: string;
    recordId: string;
    description: string;
}
export interface MatchTableRef {
    manifestId: string;
    fdcId: string;
    description: string;
}
export declare function verifiedFdcRecords(job: { proposal?: any }): VerifiedFdcRecord[];
export declare function verifiedRecordMatchesTable(manifestId: string | undefined, record: { recordId?: string; description?: string }, matches?: MatchTableRef[]): boolean;
export declare function assertCuratedMatchTable(job: { scope?: string; target?: { manifestId?: string }; proposal?: any }, matches?: MatchTableRef[]): void;
export declare function buildReviewPacket(job: ResearchJob, options?: { matches?: MatchTableRef[] }): Promise<ReviewPacket>;
export declare function applyReviewDecision(job: ResearchJob, decision: ReviewDecision): Promise<ResearchJob>;
