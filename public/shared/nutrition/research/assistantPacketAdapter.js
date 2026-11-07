import { buildResearchPackets, validateResearchResponse } from './researchPacket.js';
/** Copy/paste transport. #71 may implement this same two-phase interface later. */
export function createAssistantPacketAdapter() {
    return { id: 'assistant-packet', scope: ['curated', 'private'], runsIn: ['browser', 'cli'], requiresSecret: false,
        release: async () => 'research-v1', prepareRequest: buildResearchPackets, acceptResponse: validateResearchResponse };
}
