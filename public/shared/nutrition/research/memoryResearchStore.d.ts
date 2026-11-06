import type { ResearchJobStore, SourceCache } from './researchPorts';

export declare function createMemoryResearchStore(): ResearchJobStore;
export declare function createMemorySourceCache(): SourceCache & { clear(): void };
