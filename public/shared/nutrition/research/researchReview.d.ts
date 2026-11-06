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
export declare function buildRevisionDiff(base: any, draft: any): RevisionDiff;
export declare function buildReviewPacket(job: ResearchJob): ReviewPacket;
export declare function applyReviewDecision(job: ResearchJob, decision: ReviewDecision): ResearchJob;
