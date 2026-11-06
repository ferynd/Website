import type { ResearchJob } from './researchJob';

export interface CatalogRecord {
  identity: {
    canonicalName: string;
    category: string;
    kind: string;
    aliases: any[];
  };
  variant: {
    variantId: string;
    identityId: string;
    dims: any;
    headRevision: number;
    headRevisionId: string;
    headContentHash: string;
  };
  revisions: any[];
  conversions: any[];
  research: {
    jobIds: string[];
    passIds: string[];
    gaps: Record<string, string>;
    licenses: string[];
    reviewer: string;
    checklistVersion: number;
  };
}

export declare function toCatalogRecord(job: ResearchJob): CatalogRecord;

export declare function stageCatalog(jobs: ResearchJob[]): Promise<{
  manifest: any;
  files: Record<string, any>;
  records: CatalogRecord[];
}>;
