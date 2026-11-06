import type { ResearchJobStore } from './researchPorts';
export const RESEARCH_DB_NAME: 'nutrition-research-jobs-v1';
export function clearResearchJobs(options?: {
    idb?: IDBFactory | null;
}): Promise<boolean>;
export function openResearchJobStore(options: {
    ownerUid: string;
    idb?: IDBFactory | null;
}): Promise<ResearchJobStore & {
    close(): void;
}>;
