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
    /** The release the record is published with (source record `version`), when known. */
    release?: string;
    /** The FDC data type the record is published with (source record `datasetId`), when known. */
    dataType?: string;
}
export interface MatchTableRef {
    manifestId: string;
    fdcId: string;
    description: string;
    /** When present, a matching record must carry the same release. */
    release?: string;
    /** When present, a matching record must carry the same dataType. */
    dataType?: string;
}
export declare function verifiedFdcRecords(job: { proposal?: any }): VerifiedFdcRecord[];
/** Curated FDC records a deterministic FDC adapter matched from the table (job.match). */
export declare function deterministicFdcRecords(job: { proposal?: any; match?: any }): VerifiedFdcRecord[];
/** Fail closed: false when the table has no entry for the manifest id, or no entry equals the record. */
export declare function verifiedRecordMatchesTable(manifestId: string | undefined, record: { recordId?: string; description?: string; release?: string; dataType?: string }, matches?: MatchTableRef[]): boolean;
export declare function assertCuratedMatchTable(job: { scope?: string; target?: { manifestId?: string }; proposal?: any; match?: any }, matches?: MatchTableRef[]): void;
export declare function buildReviewPacket(job: ResearchJob, options?: { matches?: MatchTableRef[] }): Promise<ReviewPacket>;
export declare function applyReviewDecision(job: ResearchJob, decision: ReviewDecision): Promise<ResearchJob>;
