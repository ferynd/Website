import type { ResearchAdapter } from './researchPorts';

export declare function getFdaRoundingInterval(key: string, value: number): number | undefined;
export declare function createManualAdapter(): ResearchAdapter;
export declare function createLabelAdapter(): ResearchAdapter;
