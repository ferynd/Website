import type { ResearchJob } from './researchJob';
export interface PacketLimits {
    allFieldTargets: number;
    fieldLimitedTargets: number;
    fieldThreshold: number;
    requestBytes: number;
    responseBytes: number;
    ttlMs: number;
}
export const PACKET_LIMITS: Readonly<PacketLimits>;
export const RESEARCH_RULES: readonly string[];
export interface PacketOptions {
    purpose?: 'profile' | 'fields' | 'conversion';
    limits?: Partial<PacketLimits>;
    now?: () => number;
    randomBytes?: () => Uint8Array;
    includeLabelEvidence?: boolean;
}
export interface ResearchRequest {
    kind: 'nutrition.researchRequest';
    schemaVersion: 1;
    requestId: string;
    requestDigest: string;
    createdAt: string;
    registryVersion: number;
    responseSchemaVersion: 1;
    purpose: string;
    targets: any[];
    rules: string[];
    responseTemplate: Record<string, unknown>;
}
export function canonicalRequestBody(request: ResearchRequest): string;
export function requestDigestFor(request: ResearchRequest): Promise<string>;
export function buildResearchPackets(jobs: ResearchJob[], options?: PacketOptions): Promise<ResearchRequest[]>;
export function copyableResearchPacket(request: ResearchRequest): string;
export function validateResearchResponse(input: unknown, context: {
    request: ResearchRequest;
    jobs: ResearchJob[];
    now?: number;
    registryVersion?: number;
    limits?: Partial<PacketLimits>;
    currentRefs?: Record<string, unknown>;
}): Promise<any>;
