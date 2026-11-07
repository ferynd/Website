import { buildResearchPackets, validateResearchResponse } from './researchPacket';
export function createAssistantPacketAdapter(): {
    id: string;
    scope: ('curated' | 'private')[];
    runsIn: ('browser' | 'cli')[];
    requiresSecret: boolean;
    release(): Promise<string>;
    prepareRequest: typeof buildResearchPackets;
    acceptResponse: typeof validateResearchResponse;
};
