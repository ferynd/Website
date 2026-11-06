/** Synthetic protocol fixtures; not nutrition data. */
import { createResearchService } from '../../../shared/nutrition/research/researchService.js';
import { createMemoryResearchStore, createMemorySourceCache } from '../../../shared/nutrition/research/memoryResearchStore.js';
export async function packetFixture({ fields = ['protein'], scope = 'curated', store = createMemoryResearchStore(), now = () => Date.parse('2026-11-06T20:00:00Z'), knownObservations = {}, baseRevision = null, baseRef = null } = {}) {
    const sourceCache = createMemorySourceCache(), service = createResearchService({ store, sourceCache, now });
    const job = await service.enqueue({ scope, ownerUid: scope === 'private' ? 'a' : undefined, targetKind: scope === 'private' ? 'private' : 'catalog', fields, target: { manifestId: 'synthetic-apple', identityId: 'synthetic-identity', variantId: 'synthetic-variant', namespace: 'test', canonicalName: 'Synthetic apple', category: 'fruit', kind: 'generic', dims: { state: 'raw' }, knownObservations, baseRevision, baseRef } });
    const [request] = await service.prepareRequest([job.jobId]);
    const response = responseFor(request);
    return { store, sourceCache, service, job, request, response, now };
}
export function responseFor(request) { return { kind: 'nutrition.researchResponse', schemaVersion: 1, requestId: request.requestId, requestDigest: request.requestDigest, responder: { assistant: 'claude', webAccess: true }, results: request.targets.map(t => ({ targetId: t.targetId, identityMatch: { description: 'Synthetic apple', state: 'raw', conflict: false, notes: '' }, sources: [{ sourceId: 's1', type: 'fdc', title: 'Synthetic fixture', url: 'https://example.test/synthetic', recordId: '9900001', version: 'fixture-v1', accessedAt: '2026-11-06' }], nutrients: Object.fromEntries((t.requestedFields === '*' ? Object.keys(t.expectedUnits) : t.requestedFields).map(k => [k, { value: null, unit: t.expectedUnits[k], status: 'unknown', sourceIds: [] }])), conversions: [], assumptions: [], unresolved: (t.requestedFields === '*' ? Object.keys(t.expectedUnits) : t.requestedFields).map(field => ({ field, reason: 'Synthetic unknown' })) })) }; }
