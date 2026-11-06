import type { VariantDims } from '../ingredientVariants';
import type { NutrientKey } from '../nutrientRegistry';
import type { IngredientRef } from '../ingredientRefs';

export type ResearchJobState = 'queued' | 'matched' | 'needs_review' | 'approved' | 'imported' | 'blocked';
export type ResearchJobScope = 'curated' | 'private';

export interface ResearchJobAttempt {
  attemptId: string;
  passId?: string;
  adapter: string;
  outcome: 'success' | 'retry' | 'blocked' | 'error';
  errorCode?: string;
  timestamp: string;
}

export interface ResearchJobTarget {
  targetKind: 'catalog' | 'private';
  manifestId?: string;
  identityId?: string;
  variantId?: string;
  dims: VariantDims;
  baseRef?: IngredientRef | null;
  sourceStrategy?: string;
  kind?: string;
}

export interface ResearchJob {
  schemaVersion: 1;
  jobId: string;
  jobKey: string;
  parentBatchId?: string;
  passId?: string;
  scope: ResearchJobScope;
  ownerUid?: string;
  target: ResearchJobTarget;
  requestedFields: NutrientKey[] | '*';
  state: ResearchJobState;
  version: number;
  attempts: ResearchJobAttempt[];
  nextAttemptAt: string | null;
  checkpoint: { step: string; sourceCacheKeys?: string[] } | null;
  match: any;
  sourceEvidence: Array<{ cacheKey: string; checksum: string; license: string }>;
  proposal: any;
  validation: any;
  review: any;
  blocked: { code: string; needs: string } | null;
  staged: any;
  createdAt: string;
  updatedAt: string;
}

export declare const RESEARCH_JOB_STATES: readonly ResearchJobState[];
export declare const ALLOWED_TRANSITIONS: Record<ResearchJobState, readonly ResearchJobState[]>;

export declare function jobKeyV1(params: {
  targetKind: 'catalog' | 'private';
  target: any;
  fields?: NutrientKey[] | '*';
  sourceRelease?: string;
}): string;

export declare function jobIdFor(jobKey: string): Promise<string>;
export declare function parentBatchIdFor(params: {
  priority?: number;
  category?: string;
  manifestIds: string[];
}): Promise<string>;
export declare function passIdFor(params: {
  parentBatchId: string;
  adapter: string;
  sourceRelease: string;
  purpose?: string;
}): Promise<string>;

export declare function validateJob(job: any): string[];
export declare function transition(job: ResearchJob, nextState: ResearchJobState, updates?: Partial<ResearchJob>): ResearchJob;
export declare function createResearchJob(params: any): Promise<ResearchJob>;
