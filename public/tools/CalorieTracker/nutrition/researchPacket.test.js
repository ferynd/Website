import { verifyRevisionHash } from '../../../shared/nutrition/ingredientProfile.js';
import { reviewContentHash, buildReviewPacket } from '../../../shared/nutrition/research/researchReview.js';
import { it, expect, vi } from 'vitest';
import { packetFixture, responseFor } from './researchPacketFixtures.js';
import { buildResearchPackets, canonicalRequestBody, requestDigestFor, copyableResearchPacket, PACKET_LIMITS } from '../../../shared/nutrition/research/researchPacket.js';
import { createResearchJob, passIdFor } from '../../../shared/nutrition/research/researchJob.js';
import { createResearchService } from '../../../shared/nutrition/research/researchService.js';
import { PROFILE_FIELDS } from '../../../shared/nutrition/research/profileFields.js';
import { stageCatalog } from '../../../shared/nutrition/research/stagedCatalog.js';
import { validateProposal } from '../../../shared/nutrition/research/researchValidator.js';
it('round trips, resumes awaiting_response without fetch, and records one pass per issued request', async () => {
    const f = await packetFixture(), fetch = vi.fn();
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch }], now: f.now });
    expect((await service.runJob(f.job.jobId)).state).toBe('awaiting_response');
    expect(fetch).not.toHaveBeenCalled();
    const [result] = await service.acceptResponse(f.response);
    expect(result.state).toBe('needs_review');
    expect(result.proposal.verification).toBe('unverified');
    expect(result.requests).toEqual([{ requestId: f.request.requestId, requestDigest: f.request.requestDigest, passId: result.passId, status: 'answered' }]);
    await expect(service.acceptResponse(f.response)).rejects.toThrow('stale');
});
it('starts assistant values unverified and gates curated/private approval', async () => {
    for (const scope of ['curated', 'private']) {
        const f = await packetFixture({ scope });
        f.response.results[0].nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['s1'] };
        const [j] = await f.service.acceptResponse(f.response);
        expect(j.validation.errors.length).toBe(scope === 'curated' ? 1 : 0);
        const decision = { decision: 'approve', reviewer: 'reviewer', approvedContentHash: await reviewContentHash(j), acknowledgedWarnings: j.validation.warnings };
        await expect(f.service.review(j.jobId, decision)).rejects.toThrow(scope === 'curated' ? 'unresolved permittedUse' : 'attestation');
        if (scope === 'curated') {
            await expect(f.service.attestSource(j.jobId, 's1', 'reviewer')).rejects.toThrow('deterministic refetch');
            const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => ({ type: 'fdc', recordId: '9900001', nutrients: [{ nutrientId: 1003, amount: 2, unitName: 'g' }], permittedUse: 'CC0 fixture' }) }] });
            const verified = await service.verifySource(j.jobId, 's1', 'fdc_bulk');
            decision.approvedContentHash = await reviewContentHash(verified);
        }
        const approved = await f.service.review(j.jobId, { ...decision, attestation: true });
        expect(approved.state).toBe('approved');
        if (scope === 'private') {
            expect(approved.review.label).toBe('assistant-researched');
            await expect(stageCatalog([approved])).rejects.toThrow('private');
        }
    }
});
it.each([
    { value: null, unit: 'g', status: 'unknown', qualifier: 'not reported' },
    { value: null, unit: 'g', status: 'below_quantification_limit', upperBound: 0.1, qualifier: 'less than limit' },
    { value: 2, unit: 'g', status: 'label_reported', roundingInterval: 1, qualifier: 'label rounded' },
])('preserves complete known observations including null and unit-normalized metadata: %j', async known => {
    const f = await packetFixture({ knownObservations: { protein: known } });
    const cited = known.value !== null || known.status === 'below_quantification_limit' || known.status === 'not_applicable';
    const n = { ...known, unit: 'mg', value: known.value === null ? null : known.value * 1000, sourceIds: cited ? ['s1'] : [] };
    for (const k of ['roundingInterval', 'upperBound']) if (n[k] !== undefined) n[k] *= 1000;
    f.response.results[0].nutrients.protein = n;
    const [j] = await f.service.acceptResponse(f.response);
    expect(j.proposal.revisionDraft.nutrients.protein).toBe(known.value);
    expect(j.proposal.revisionDraft.nutrientMeta.quality.protein).toEqual(Object.fromEntries(Object.entries(known).filter(([k]) => !['value', 'unit'].includes(k))));
});
it.each(['value', 'status', 'qualifier', 'roundingInterval', 'upperBound'])('rejects changes and removal of known %s', async key => {
    for (const remove of [false, true]) {
        const known = { value: 2, unit: 'g', status: 'label_reported', qualifier: 'rounded', roundingInterval: 1, upperBound: 3 };
        const f = await packetFixture({ knownObservations: { protein: known } });
        const n = { ...known, sourceIds: ['s1'] };
        if (remove) delete n[key];
        else n[key] = { value: 3, status: 'measured', qualifier: 'changed', roundingInterval: 0.5, upperBound: 4 }[key];
        f.response.results[0].nutrients.protein = n;
        await expect(f.service.acceptResponse(f.response)).rejects.toThrow(/known observation|required/);
        expect((await f.store.get(f.job.jobId)).state).toBe('awaiting_response');
    }
});
it('partitions multi-batch requests and derives each pass from its own parent', async () => {
    const f = await packetFixture();
    const jobs = [];
    for (const [id, parentBatchId] of [['a', 'batch-a'], ['b', 'batch-b'], ['c', 'batch-a']])
        jobs.push(await f.service.enqueue({ parentBatchId, fields: ['protein'], target: { manifestId: id, dims: { state: 'raw' } } }));
    const requests = await f.service.prepareRequest(jobs.map(j => j.jobId));
    expect(requests).toHaveLength(2);
    for (const request of requests) {
        const pending = await Promise.all(request.targets.map(t => f.store.get(t.targetId)));
        expect(new Set(pending.map(j => j.parentBatchId)).size).toBe(1);
        const passId = await passIdFor({ parentBatchId: pending[0].parentBatchId, adapter: 'assistant-packet', sourceRelease: request.requestId, purpose: request.purpose });
        expect(pending.every(j => j.passId === passId && j.pendingRequest.passId === passId)).toBe(true);
        await f.service.acceptResponse(responseFor(request));
    }
});
it.each(['weight', 'unit', 'state', 'missing', 'qualified', 'ambiguous'])('does not verify mismatched conversion-only FDC evidence: %s', async mismatch => {
    const f = await packetFixture();
    await f.service.cancelRequest(f.request.requestId);
    const [request] = await f.service.prepareRequest([f.job.jobId], { purpose: 'conversion' });
    const response = responseFor(request);
    response.results[0].nutrients = {};
    response.results[0].conversions = [{ unit: 'cup', grams: 125, state: 'raw', sourceIds: ['s1'], confidence: 1 }];
    const [j] = await f.service.acceptResponse(response);
    const portion = { kind: 'household', unit: 'cup', amount: 2, grams: 250 };
    const result = { type: 'fdc', recordId: '9900001', nutrients: [], portions: [portion], permittedUse: 'CC0 fixture' };
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => result }] });
    // A later mismatch must also revoke a previous successful verification.
    await service.verifySource(j.jobId, 's1', 'fdc_bulk');
    if (mismatch === 'weight') portion.grams = 400;
    if (mismatch === 'unit') portion.unit = 'piece';
    if (mismatch === 'state') response.results[0].conversions[0].state = 'cooked';
    if (mismatch === 'missing') result.portions = [];
    if (mismatch === 'qualified') portion.unitQualifier = 'sliced';
    if (mismatch === 'ambiguous') result.portions.push({ ...portion, grams: 400 });
    if (mismatch === 'state') {
        const current = await f.store.get(j.jobId);
        current.proposal.assistantResult.conversions[0].state = 'cooked';
        current.version++;
        await f.store.save(current);
    }
    await expect(service.verifySource(j.jobId, 's1', 'fdc_bulk')).rejects.toThrow('conversion mismatch');
    expect((await f.store.get(j.jobId)).proposal.sourceVerification.s1.status).toBe('unverified');
});
it('verifies normalized FDC portion weights, resolves licenses and rehashes drafts/conversions before approval', async () => {
    const f = await packetFixture();
    await f.service.cancelRequest(f.request.requestId);
    const [request] = await f.service.prepareRequest([f.job.jobId], { purpose: 'conversion' });
    const response = responseFor(request);
    response.results[0].nutrients = {};
    response.results[0].conversions = [{ unit: 'cup', grams: 125, state: 'raw', sourceIds: ['s1'], confidence: 1 }];
    const [j] = await f.service.acceptResponse(response);
    const decision = { decision: 'approve', reviewer: 'r', approvedContentHash: await reviewContentHash(j) };
    await expect(f.service.review(j.jobId, decision)).rejects.toThrow('unresolved permittedUse');
    const originalSource = j.proposal.revisionDraft.sources[j.proposal.assistantSourceKeys.s1];
    const originalMatches = [{ manifestId: j.target.manifestId, fdcId: originalSource.recordId, description: originalSource.description || originalSource.title }];
    await expect(stageCatalog([{ ...j, state: 'approved', proposal: { ...j.proposal, sourceVerification: { s1: { status: 'verified', method: 'deterministic_refetch' } } }, review: { approvedContentHash: decision.approvedContentHash } }], { matches: originalMatches })).rejects.toThrow('valid reviewed content hash');
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => ({ type: 'fdc', recordId: '9900001', release: 'fixture-v2', permittedUse: 'CC0 fixture', nutrients: [], portions: [{ kind: 'household', unit: 'cup', amount: 2, grams: 250 }] }) }] });
    const verified = await service.verifySource(j.jobId, 's1', 'fdc_bulk');
    const draft = verified.proposal.revisionDraft, conv = verified.proposal.conversions[0];
    expect(draft.sources[verified.proposal.assistantSourceKeys.s1].permittedUse).toBe('CC0 fixture');
    expect(conv.source.permittedUse).toBe('CC0 fixture');
    expect(draft.contentHash).not.toBe(j.proposal.revisionDraft.contentHash);
    expect(conv.variantRef.contentHash).toBe(draft.contentHash);
    expect(conv.conversionId).not.toBe(j.proposal.conversions[0].conversionId);
    expect(verified.validation.isValid).toBe(true);
    await expect(service.review(j.jobId, decision)).rejects.toThrow('hash mismatch');
    const approved = await service.review(j.jobId, { ...decision, approvedContentHash: await reviewContentHash(verified) });
    const approvedSource = approved.proposal.revisionDraft.sources[approved.proposal.assistantSourceKeys.s1];
    const approvedMatches = [{ manifestId: approved.target.manifestId, fdcId: approvedSource.recordId, description: approvedSource.description || approvedSource.title }];
    expect((await stageCatalog([approved], { matches: approvedMatches })).manifest.profileCount).toBe(1);
});
it.each([
    ['wrong echo', r => { r.requestId = 'rq-' + '0'.repeat(24); }, 'requestId'],
    ['wrong digest', r => { r.requestDigest = 'sha256:' + '0'.repeat(64); }, 'requestId'],
    ['unrequested target', r => { r.results[0].targetId = 'another'; }, 'targetId'],
    ['duplicate target', r => { r.results.push(r.results[0]); }, 'duplicate'],
    ['missing target', r => { r.results = []; }, 'missing requested'],
    ['missing status', r => { delete r.results[0].nutrients.protein.status; }, '.status'],
    ['derived field', r => { r.results[0].nutrients.fiberWeightedLegacy = { value: 1 }; }, 'fiberWeightedLegacy'],
    ['unrequested field', r => { r.results[0].nutrients.sodium = { value: 1 }; }, 'sodium'],
    ['numeric text', r => { r.results[0].nutrients.protein.value = '2 g'; }, 'numeric text'],
    ['zero without evidence', r => { r.results[0].nutrients.protein.value = 0; }, 'evidence'],
    ['unsourced value', r => { r.results[0].nutrients.protein.value = 2; }, 'evidence'],
    ['unknown reason', r => { r.results[0].unresolved = []; }, 'reason'],
    ['http URL', r => { r.results[0].sources[0].url = 'http://example.test'; }, 'https'],
    ['unknown source', r => { r.results[0].nutrients.protein.sourceIds = ['fake']; }, 'sourceId'],
    ['unsupported unit', r => { r.results[0].nutrients.protein.unit = 'cups'; }, 'unit'],
    ['bounds', r => { r.results[0].nutrients.protein = { value: 101, unit: 'g', status: 'measured', sourceIds: ['s1'] }; }, 'checkPer100g'],
    ['false measured', r => { r.results[0].sources[0].type = 'other'; r.results[0].nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['s1'] }; }, 'proper source'],
    ['estimate missing comparator', r => { r.results[0].nutrients.protein = { value: 2, unit: 'g', status: 'estimated_from_comparable', sourceIds: ['s1'] }; }, 'comparator'],
    ['text range', r => { r.results[0].nutrients.protein.range = { min: '1', max: 3 }; }, 'finite'],
    ['extra property', r => { r.meal = {}; }, 'unknown field'],
    ['unrequested conversion', r => { r.results[0].conversions = [{}]; }, 'unrequested conversions'],
])('rejects %s without staging', async (_label, mutate, message) => {
    const f = await packetFixture();
    mutate(f.response);
    await expect(f.service.acceptResponse(f.response)).rejects.toThrow(message);
    expect((await f.store.get(f.job.jobId)).state).toBe('awaiting_response');
});
it('rejects changed known observations, profile revision, and registry', async () => {
    const f = await packetFixture({ knownObservations: { protein: { value: 2, unit: 'g', status: 'measured' } } });
    f.response.results[0].nutrients.protein = { value: 3, unit: 'g', status: 'measured', sourceIds: ['s1'] };
    await expect(f.service.acceptResponse(f.response)).rejects.toThrow('known observation');
    let j = await f.store.get(f.job.jobId);
    j.target.baseRef = { revision: 2 };
    j.version++;
    await f.store.save(j);
    await expect(f.service.acceptResponse(f.response)).rejects.toThrow('revision changed');
    const g = await packetFixture();
    await expect(g.service.acceptResponse(g.response, { registryVersion: 3 })).rejects.toThrow('registry changed');
});
it('cancel and expiry return jobs to queued and reject old responses', async () => {
    const f = await packetFixture();
    await f.service.cancelRequest(f.request.requestId);
    expect((await f.store.get(f.job.jobId)).state).toBe('queued');
    await expect(f.service.acceptResponse(f.response)).rejects.toThrow('unknown or stale');
    const clock = { value: Date.now() }, g = await packetFixture({ now: () => clock.value });
    clock.value += PACKET_LIMITS.ttlMs + 1;
    await expect(g.service.acceptResponse(g.response)).rejects.toThrow('expired');
    expect((await g.service.runJob(g.job.jobId)).state).toBe('queued');
});
it('converts units/ranges and retains estimate comparator with transfer reason', async () => {
    const f = await packetFixture();
    f.response.results[0].nutrients.protein = { value: 2000, unit: 'mg', status: 'estimated_from_comparable', sourceIds: ['s1'], comparator: { name: 'Synthetic comparable', sourceId: 's1', transferReason: 'Same form' }, derivation: 'Comparable estimate', range: { min: 1000, max: 3000 } };
    const [j] = await f.service.acceptResponse(f.response);
    expect(j.proposal.revisionDraft.nutrients.protein).toBe(2);
    expect(j.proposal.revisionDraft.fieldProvenance.protein.range).toEqual({ min: 1, max: 3 });
    expect(j.proposal.revisionDraft.fieldProvenance.protein.comparatorRef).toContain('Same form');
});
it('deterministically separates mixed sets, enforces caps, and excludes derived fields from star', async () => {
    const jobs = [];
    for (let i = 0; i < 71; i++)
        jobs.push(await createResearchJob({ target: { manifestId: 'synthetic-' + i, dims: { state: 'raw' } }, fields: i < 17 ? '*' : ['protein'] }));
    const a = await buildResearchPackets(jobs), b = await buildResearchPackets([...jobs].reverse());
    expect(a.map(r => r.targets.length)).toEqual([8, 8, 1, 25, 25, 4]);
    expect(a.map(canonicalRequestBody)).toEqual(b.map(canonicalRequestBody));
    for (const r of a) {
        expect(r.requestId).toMatch(/^rq-[a-f0-9]{24}$/);
        expect(r.requestDigest).toBe(await requestDigestFor(r));
        for (const t of r.targets)
            expect(Object.keys(t.expectedUnits)).not.toContain('fiberWeightedLegacy');
        expect(copyableResearchPacket(r)).toContain(JSON.stringify(r, null, 2));
    }
    const smaller = await buildResearchPackets(jobs, { limits: { allFieldTargets: 3, fieldLimitedTargets: 4 } });
    expect(smaller.every(r => r.targets.length <= (r.targets[0].requestedFields === '*' ? 3 : 4))).toBe(true);
    await expect(createResearchJob({ target: { manifestId: 'derived' }, fields: ['fiberWeightedLegacy'] })).rejects.toThrow('derived');
    expect(PROFILE_FIELDS).not.toContain('fiberWeightedLegacy');
});
it('bounds request and response bytes and never copies meal composition or unselected label evidence', async () => {
    const f = await packetFixture();
    const j = { ...f.job, target: { ...f.job.target, meal: { private: true }, labelEvidence: { title: 'Selected label' } } };
    const [r] = await buildResearchPackets([j]);
    expect(JSON.stringify(r)).not.toContain('private');
    expect(r.targets[0]).not.toHaveProperty('labelEvidence');
    await expect(buildResearchPackets([j], { limits: { requestBytes: 50 } })).rejects.toThrow('byte limit');
    await expect(f.service.acceptResponse(f.response, { limits: { responseBytes: 50 } })).rejects.toThrow('byte limit');
});
it('source attestation is tied to a specific source and cannot inject values into review', async () => {
    const f = await packetFixture({ scope: 'private' });
    const [j] = await f.service.acceptResponse(f.response);
    await expect(f.service.attestSource(j.jobId, 'unknown', 'r')).rejects.toThrow('Specific source');
    const before = j.proposal.revisionDraft.contentHash;
    const approved = await f.service.attestSource(j.jobId, 's1', 'r');
    expect(approved.proposal.revisionDraft.contentHash).toBe(before);
});
it('rejects externally refreshed profile heads and estimates missing transfer reason, derivation or range', async () => {
    const f = await packetFixture();
    await expect(f.service.acceptResponse(f.response, { currentRefs: { [f.job.jobId]: { revision: 2 } } })).rejects.toThrow('revision changed');
    for (const missing of ['transferReason', 'derivation', 'range']) {
        const g = await packetFixture(), n = { value: 2, unit: 'g', status: 'estimated_from_comparable', sourceIds: ['s1'], comparator: { name: 'Synthetic', sourceId: 's1', transferReason: 'Same state' }, derivation: 'Comparable', range: { min: 1, max: 3 } };
        if (missing === 'transferReason')
            delete n.comparator.transferReason;
        else
            delete n[missing];
        g.response.results[0].nutrients.protein = n;
        await expect(g.service.acceptResponse(g.response)).rejects.toThrow();
    }
});
it('verifies a cited FDC source only after deterministic value comparison', async () => {
    const f = await packetFixture();
    f.response.results[0].nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['s1'] };
    const [j] = await f.service.acceptResponse(f.response);
    const adapter = { id: 'fdc_bulk', fetch: vi.fn(async () => ({})), toSourceResult: async () => ({ type: 'fdc', recordId: '9900001', nutrients: [{ nutrientId: 1003, amount: 2, unitName: 'g' }] }) };
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [adapter] });
    const verified = await service.verifySource(j.jobId, 's1', 'fdc_bulk');
    expect(verified.proposal.sourceVerification.s1.method).toBe('deterministic_refetch');
    adapter.toSourceResult = async () => ({ type: 'fdc', recordId: '9900001', nutrients: [{ nutrientId: 1003, amount: 3, unitName: 'g' }] });
    await expect(service.verifySource(j.jobId, 's1', 'fdc_bulk')).rejects.toThrow('mismatch');
    expect((await f.store.get(j.jobId)).proposal.sourceVerification.s1.status).toBe('unverified');
});
it('field passes preserve the base revision and its provenance when response source IDs collide', async () => {
    const { buildRevisionDraft } = await import('../../../shared/nutrition/ingredientProfile.js'), { emptyStagedRecord } = await import('../../../shared/nutrition/nutrientRegistry.js');
    const record = emptyStagedRecord();
    record.values.calories = 40;
    record.quality.calories = { status: 'measured' };
    const base = await buildRevisionDraft({ identityId: 'synthetic-identity', variantId: 'synthetic-variant', stagedRecord: record, basis: { kind: 'per_100g_edible', state: 'raw' }, sources: { s1: { type: 'fdc', recordId: '9900002', title: 'Synthetic base', version: 'fixture', accessedAt: '2026-11-06', permittedUse: 'CC0' } }, fieldProvenance: { calories: { sourceKey: 's1' } } });
    base.revision = 1;
    base.revisionId = base.variantId + '~r1';
    const baseRef = { refVersion: 1, scope: 'curated', namespace: 'catalog:nutrition-curated', identityId: base.identityId, variantId: base.variantId, revision: 1, revisionId: base.revisionId, contentHash: base.contentHash };
    const f = await packetFixture({ baseRevision: base, baseRef });
    f.response.results[0].nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['s1'] };
    const [result] = await f.service.acceptResponse(f.response), draft = result.proposal.revisionDraft;
    expect(draft.nutrients.calories).toBe(40);
    expect(draft.sources.s1.recordId).toBe('9900002');
    expect(draft.fieldProvenance.protein.sourceKey).not.toBe('s1');
    expect(draft.nutrients.protein).toBe(2);
});
it('copies selected text label evidence and strips alias metadata; rejects nested meal/image payloads', async () => {
    const f = await packetFixture(), job = { ...f.job, target: { ...f.job.target, aliases: [{ text: 'Synthetic alias', ownerUid: 'private-metadata' }], labelEvidence: { title: 'Synthetic label', nutrients: { protein: { value: 2, unit: 'g' } } } } };
    const [request] = await buildResearchPackets([job], { includeLabelEvidence: true });
    expect(request.targets[0].labelEvidence.title).toBe('Synthetic label');
    expect(request.targets[0].identity.aliases).toEqual(['Synthetic alias']);
    expect(JSON.stringify(request)).not.toContain('private-metadata');
    job.target.labelEvidence.nutrients = { meal: { ingredients: ['private meal'] } };
    await expect(buildResearchPackets([job], { includeLabelEvidence: true })).rejects.toThrow('requestedFields');
});
it.each(['measured', 'label_reported', 'calculated', 'estimated_from_comparable'])('rejects null packet values with %s status', async status => {
    const f = await packetFixture();
    const n = f.response.results[0].nutrients.protein;
    Object.assign(n, { value: null, status, sourceIds: ['s1'], derivation: 'Synthetic calculation', comparator: { name: 'Synthetic comparator', sourceId: 's1', transferReason: 'Fixture' }, range: { min: 0, max: 1 } });
    await expect(f.service.acceptResponse(f.response)).rejects.toThrow('non-null value required');
    expect((await f.store.get(f.job.jobId)).state).toBe('awaiting_response');
});
it.each(['unknown', 'below_quantification_limit', 'not_applicable'])('allows null packet values with %s status', async status => {
    const f = await packetFixture();
    Object.assign(f.response.results[0].nutrients.protein, { status, sourceIds: ['s1'], ...(status === 'below_quantification_limit' ? { upperBound: 0.1 } : {}) });
    const [job] = await f.service.acceptResponse(f.response);
    expect(job.proposal.revisionDraft.nutrients.protein).toBeNull();
    expect(job.proposal.revisionDraft.nutrientMeta.quality.protein.status).toBe(status);
});
it('includes packet conversions in the review diff and review content hash', async () => {
    const f = await packetFixture();
    await f.service.cancelRequest(f.request.requestId);
    const [request] = await f.service.prepareRequest([f.job.jobId], { purpose: 'conversion' });
    const response = responseFor(request);
    response.results[0].nutrients = {};
    response.results[0].conversions = [{ unit: 'cup', grams: 125, state: 'raw', sourceIds: ['s1'], confidence: 1 }];
    const [job] = await f.service.acceptResponse(response);
    expect(job.proposal.diff.addedConversions).toEqual(job.proposal.conversions);
    const packet = await buildReviewPacket(job);
    expect(packet.json.conversions).toEqual(job.proposal.conversions);
    expect(packet.json.diff.addedConversions).toEqual(job.proposal.conversions);
    expect(packet.markdown).toContain('1 cup: 125 g');
    expect(packet.json.contentHash).not.toBe(job.proposal.revisionDraft.contentHash);
});
it('refuses a cited observation that disagrees in status, bound, rounding, qualifier, or derivation', async () => {
    const f = await packetFixture({ fields: ['sodium', 'calories'] });
    f.response.results[0].nutrients.sodium = { value: null, unit: 'mg', status: 'below_quantification_limit', upperBound: 500, sourceIds: ['s1'] };
    f.response.results[0].nutrients.calories = { value: 100, unit: 'kcal', status: 'measured', sourceIds: ['s1'] };
    const [j] = await f.service.acceptResponse(f.response);
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => ({ type: 'fdc', recordId: '9900001', nutrients: [
        { nutrientId: 1093, amount: 0, unitName: 'mg', loq: 0.2, isBelowLoq: true },
        { nutrientId: 2048, amount: 100, unitName: 'kcal' },
    ] }) }] });
    await expect(service.verifySource(j.jobId, 's1', 'fdc_bulk')).rejects.toThrow(/observation mismatch/);
    const rejected = await f.store.get(j.jobId);
    expect(rejected.proposal.sourceVerification.s1.status).toBe('unverified');
    expect(rejected.proposal.sourceVerification.s1.method).toBeUndefined();
    expect(rejected.proposal.revisionDraft.nutrientMeta.quality.sodium.upperBound).toBe(500);
    expect(rejected.proposal.revisionDraft.nutrientMeta.quality.calories.status).toBe('measured');
    expect(rejected.proposal.revisionDraft.contentHash).toBe(j.proposal.revisionDraft.contentHash);
    for (const tweak of [
        { roundingInterval: 0.1 },
        { qualifier: 'lab' },
        { derivation: 'lab method' },
    ]) {
        const g = await packetFixture();
        g.response.results[0].nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['s1'], ...tweak };
        const [accepted] = await g.service.acceptResponse(g.response);
        const narrow = createResearchService({ store: g.store, sourceCache: g.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => ({ type: 'fdc', recordId: '9900001', nutrients: [{ nutrientId: 1003, amount: 2, unitName: 'g' }] }) }] });
        await expect(narrow.verifySource(accepted.jobId, 's1', 'fdc_bulk')).rejects.toThrow(/observation mismatch/);
        const saved = await g.store.get(accepted.jobId);
        expect(saved.proposal.sourceVerification.s1.status).toBe('unverified');
        expect(saved.proposal.revisionDraft.contentHash).toBe(accepted.proposal.revisionDraft.contentHash);
        if (tweak.roundingInterval)
            expect(saved.proposal.revisionDraft.nutrientMeta.quality.protein.roundingInterval).toBe(0.1);
        if (tweak.qualifier)
            expect(saved.proposal.revisionDraft.nutrientMeta.quality.protein.qualifier).toBe('lab');
        if (tweak.derivation)
            expect(saved.proposal.revisionDraft.fieldProvenance.protein.derivation).toBe('lab method');
    }
});
it('writes the matching deterministic observation onto the draft before hashing', async () => {
    const f = await packetFixture({ fields: ['sodium', 'calories'] });
    f.response.results[0].nutrients.sodium = { value: null, unit: 'mg', status: 'below_quantification_limit', upperBound: 0.2, sourceIds: ['s1'] };
    f.response.results[0].nutrients.calories = { value: 100, unit: 'kcal', status: 'calculated', derivation: 'atwater_specific_factors', sourceIds: ['s1'] };
    const [j] = await f.service.acceptResponse(f.response);
    expect(j.proposal.gaps.sodium).toBeUndefined();
    expect(j.proposal.revisionDraft.nutrientMeta.quality.sodium.qualifier).toBeUndefined();
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => ({ type: 'fdc', recordId: '9900001', permittedUse: 'CC0 fixture', nutrients: [
        { nutrientId: 1093, amount: 0, unitName: 'mg', loq: 0.2, isBelowLoq: true },
        { nutrientId: 2048, amount: 100, unitName: 'kcal' },
    ] }) }] });
    const verified = await service.verifySource(j.jobId, 's1', 'fdc_bulk');
    const draft = verified.proposal.revisionDraft;
    const sourceKey = verified.proposal.assistantSourceKeys.s1;
    expect(verified.proposal.sourceVerification.s1).toMatchObject({ status: 'verified', method: 'deterministic_refetch' });
    expect(draft.nutrientMeta.quality.sodium).toEqual({ status: 'below_quantification_limit', upperBound: 0.2 });
    expect(draft.fieldProvenance.sodium).toMatchObject({ sourceKey, sourceNutrientId: '1093' });
    expect(draft.nutrientMeta.quality.calories.status).toBe('calculated');
    expect(draft.fieldProvenance.calories).toMatchObject({ sourceKey, sourceNutrientId: '2048', derivation: 'atwater_specific_factors' });
    expect(await verifyRevisionHash(draft)).toBe(true);
});
it('compares cited conversion ranges and records a matching range', async () => {
    async function conversionJob(assistantRange, portionRange) {
        const f = await packetFixture();
        await f.service.cancelRequest(f.request.requestId);
        const [request] = await f.service.prepareRequest([f.job.jobId], { purpose: 'conversion' });
        const response = responseFor(request);
        response.results[0].nutrients = {};
        response.results[0].conversions = [{ unit: 'cup', grams: 125, state: 'raw', sourceIds: ['s1'], confidence: 1, ...(assistantRange ? { range: assistantRange } : {}) }];
        const [j] = await f.service.acceptResponse(response);
        const portion = { kind: 'household', unit: 'cup', amount: 2, grams: 250, ...(portionRange ? { range: portionRange } : {}) };
        const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => ({ type: 'fdc', recordId: '9900001', nutrients: [], portions: [portion], permittedUse: 'CC0 fixture' }) }] });
        return { f, j, service };
    }
    for (const [assistantRange, portionRange] of [
        [{ min: 120, max: 130 }, { min: 100, max: 110 }],
        [null, { min: 100, max: 110 }],
        [{ min: 120, max: 130 }, null],
    ]) {
        const mismatch = await conversionJob(assistantRange, portionRange);
        await expect(mismatch.service.verifySource(mismatch.j.jobId, 's1', 'fdc_bulk')).rejects.toThrow(/conversion mismatch/);
        expect((await mismatch.f.store.get(mismatch.j.jobId)).proposal.sourceVerification.s1.status).toBe('unverified');
    }
    const match = await conversionJob({ min: 120, max: 130 }, { min: 120, max: 130 });
    const verified = await match.service.verifySource(match.j.jobId, 's1', 'fdc_bulk');
    expect(verified.proposal.sourceVerification.s1.status).toBe('verified');
    expect(verified.proposal.conversions[0].range).toEqual({ min: 120, max: 130 });
});
it('copies normalizer conventions onto a first packet and keeps them from the base on a field-limited packet', async () => {
    const first = await packetFixture();
    const [job] = await first.service.acceptResponse(first.response);
    expect(job.proposal.revisionDraft.nutrientMeta.fiberMeaning).toBe('total');
    expect(job.proposal.revisionDraft.nutrientMeta.carbConvention).toBe('includes_fiber');
    const { buildRevisionDraft } = await import('../../../shared/nutrition/ingredientProfile.js');
    const { emptyStagedRecord } = await import('../../../shared/nutrition/nutrientRegistry.js');
    const record = emptyStagedRecord();
    record.values.calories = 40;
    record.quality.calories = { status: 'measured' };
    record.fiberMeaning = 'weighted_legacy';
    record.carbConvention = 'excludes_fiber';
    const base = await buildRevisionDraft({ identityId: 'synthetic-identity', variantId: 'synthetic-variant', stagedRecord: record, basis: { kind: 'per_100g_edible', state: 'raw' }, sources: { 'base-source': { type: 'manual', title: 'Base', version: '1', accessedAt: '2026-11-06', permittedUse: 'CC0' } }, fieldProvenance: { calories: { sourceKey: 'base-source' } } });
    base.revision = 1;
    base.revisionId = base.variantId + '~r1';
    const baseRef = { refVersion: 1, scope: 'curated', namespace: 'catalog:nutrition-curated', identityId: base.identityId, variantId: base.variantId, revision: 1, revisionId: base.revisionId, contentHash: base.contentHash };
    const residual = await packetFixture({ baseRevision: base, baseRef });
    residual.response.results[0].nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['s1'] };
    const [next] = await residual.service.acceptResponse(residual.response);
    expect(next.proposal.revisionDraft.nutrientMeta.fiberMeaning).toBe('weighted_legacy');
    expect(next.proposal.revisionDraft.nutrientMeta.carbConvention).toBe('excludes_fiber');
    expect(next.proposal.revisionDraft.nutrients.calories).toBe(40);
    const full = await packetFixture({ fields: '*', baseRevision: base, baseRef });
    const [fullJob] = await full.service.acceptResponse(full.response);
    expect(fullJob.proposal.revisionDraft.nutrientMeta.fiberMeaning).toBe('total');
    expect(fullJob.proposal.revisionDraft.nutrientMeta.carbConvention).toBe('includes_fiber');
});
it('fails a cooked target when the deterministic FDC record is raw', async () => {
    const f = await packetFixture();
    const stored = await f.store.get(f.job.jobId);
    await f.store.save({ ...stored, target: { ...stored.target, dims: { state: 'cooked' } }, version: stored.version + 1 }, { expectedVersion: stored.version });
    f.response.results[0].identityMatch.state = 'cooked';
    f.response.results[0].nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['s1'] };
    f.response.results[0].unresolved = [];
    const [accepted] = await f.service.acceptResponse(f.response);
    expect(accepted.proposal.extractedStateWords).toContain('cooked');
    expect(accepted.validation.errors).not.toContain('Explicit conflict: target is cooked but source is raw');
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => ({ type: 'fdc', recordId: '9900001', description: 'Apples, raw', extractedStateWords: ['raw'], permittedUse: 'CC0 fixture', nutrients: [{ nutrientId: 1003, amount: 2, unitName: 'g' }] }) }] });
    const verified = await service.verifySource(accepted.jobId, 's1', 'fdc_bulk');
    expect(verified.proposal.extractedStateWords).toEqual(['raw']);
    expect(verified.validation.errors).toContain('Explicit conflict: target is cooked but source is raw');
    await expect(service.review(verified.jobId, { decision: 'approve', reviewer: 'reviewer', approvedContentHash: await reviewContentHash(verified), acknowledgedWarnings: verified.validation.warnings || [] })).rejects.toThrow(/validation errors/);
});
it('rebuilds gaps from the verified observation instead of the assistant unresolved text', async () => {
    const f = await packetFixture({ fields: ['sodium'] });
    f.response.results[0].nutrients.sodium = { value: null, unit: 'mg', status: 'below_quantification_limit', upperBound: 0.2, sourceIds: ['s1'] };
    f.response.results[0].unresolved = [{ field: 'sodium', reason: 'unknown' }];
    const [j] = await f.service.acceptResponse(f.response);
    expect(j.proposal.gaps.sodium).toBeUndefined();
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => ({ type: 'fdc', recordId: '9900001', permittedUse: 'CC0 fixture', nutrients: [{ nutrientId: 1093, amount: 0, unitName: 'mg', loq: 0.2, isBelowLoq: true }] }) }] });
    const verified = await service.verifySource(j.jobId, 's1', 'fdc_bulk');
    expect(verified.proposal.revisionDraft.nutrientMeta.quality.sodium).toEqual({ status: 'below_quantification_limit', upperBound: 0.2 });
    expect(verified.proposal.gaps.sodium).toBeUndefined();
    expect(await reviewContentHash(verified)).not.toBe(await reviewContentHash(j));
});
it('rewrites a conversion cited to a verified source that is not listed first', async () => {
    function citeSecond(response, range) {
        response.results[0].nutrients = {};
        response.results[0].sources.push({ sourceId: 's2', type: 'literature', title: 'Synthetic literature', url: 'https://example.test/literature', accessedAt: '2026-11-06' });
        response.results[0].conversions = [{ unit: 'cup', grams: 125, state: 'raw', sourceIds: ['s2', 's1'], confidence: 1, range }];
    }
    const f = await packetFixture();
    await f.service.cancelRequest(f.request.requestId);
    const [request] = await f.service.prepareRequest([f.job.jobId], { purpose: 'conversion' });
    const response = responseFor(request);
    citeSecond(response, { min: 120, max: 130 });
    const [j] = await f.service.acceptResponse(response);
    expect(j.proposal.assistantResult.conversions[0].sourceIds).toEqual(['s2', 's1']);
    expect(j.proposal.conversions[0].source.recordId).toBe('s2');
    expect(j.proposal.conversions[0].source.permittedUse).toBe('review_required');
    const portion = { kind: 'household', unit: 'cup', amount: 1, grams: 125, range: { min: 120, max: 130 } };
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => ({ type: 'fdc', recordId: '9900001', nutrients: [], portions: [portion], permittedUse: 'CC0 fixture' }) }] });
    const verified = await service.verifySource(j.jobId, 's1', 'fdc_bulk');
    expect(verified.proposal.sourceVerification.s1.status).toBe('verified');
    expect(verified.proposal.conversions[0].source.recordId).toBe('9900001');
    expect(verified.proposal.conversions[0].source.permittedUse).toBe('CC0 fixture');
    expect(verified.proposal.conversions[0].range).toEqual({ min: 120, max: 130 });
    const other = await packetFixture();
    await other.service.cancelRequest(other.request.requestId);
    const [otherRequest] = await other.service.prepareRequest([other.job.jobId], { purpose: 'conversion' });
    const otherResponse = responseFor(otherRequest);
    citeSecond(otherResponse, { min: 90, max: 100 });
    const [mismatched] = await other.service.acceptResponse(otherResponse);
    const narrow = createResearchService({ store: other.store, sourceCache: other.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => ({ type: 'fdc', recordId: '9900001', nutrients: [], portions: [portion], permittedUse: 'CC0 fixture' }) }] });
    await expect(narrow.verifySource(mismatched.jobId, 's1', 'fdc_bulk')).rejects.toThrow(/conversion mismatch/);
    expect((await other.store.get(mismatched.jobId)).proposal.sourceVerification.s1.status).toBe('unverified');
});
it('rejects uncited below-quantification and not-applicable claims', async () => {
    for (const nutrient of [
        { status: 'below_quantification_limit', upperBound: 0.001 },
        { status: 'not_applicable' },
    ]) {
        const f = await packetFixture();
        f.response.results[0].nutrients.protein = { value: null, unit: 'g', status: nutrient.status, sourceIds: [], ...(nutrient.upperBound !== undefined ? { upperBound: nutrient.upperBound } : {}) };
        await expect(f.service.acceptResponse(f.response)).rejects.toThrow('source evidence required');
        expect((await f.store.get(f.job.jobId)).state).toBe('awaiting_response');
    }
});
it('requires verified provenance for a curated upper bound or not-applicable claim and does not store the status as a gap', async () => {
    for (const nutrient of [
        { status: 'below_quantification_limit', upperBound: 0.001 },
        { status: 'not_applicable' },
    ]) {
        const f = await packetFixture();
        f.response.results[0].nutrients.protein = { value: null, unit: 'g', status: nutrient.status, sourceIds: ['s1'], ...(nutrient.upperBound !== undefined ? { upperBound: nutrient.upperBound } : {}) };
        f.response.results[0].unresolved = [];
        const [job] = await f.service.acceptResponse(f.response);
        expect(job.proposal.gaps.protein).toBeUndefined();
        expect(JSON.stringify(job.proposal.gaps)).not.toContain(nutrient.status);
        expect(job.proposal.revisionDraft.nutrientMeta.quality.protein.qualifier || '').not.toMatch(/^gap:/);
        expect(job.validation.errors).toContain('Curated field protein requires verified provenance');
        job.proposal.sourceVerification.s1 = { status: 'verified' };
        expect((await validateProposal(job)).errors.some(error => error.includes('verified provenance'))).toBe(false);
    }
});
it('points verified nutrient provenance at the verified source, not the first citation', async () => {
    const f = await packetFixture({ fields: ['protein'] });
    const result = f.response.results[0];
    result.sources.push({ sourceId: 'lit', type: 'literature', title: 'Synthetic literature', url: 'https://example.test/literature', accessedAt: '2026-11-06' });
    result.nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['lit', 's1'] };
    result.unresolved = [];
    const [accepted] = await f.service.acceptResponse(f.response);
    const litKey = accepted.proposal.assistantSourceKeys.lit;
    const fdcKey = accepted.proposal.assistantSourceKeys.s1;
    expect(accepted.proposal.revisionDraft.fieldProvenance.protein.sourceKey).toBe(litKey);
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => ({ type: 'fdc', recordId: '9900001', permittedUse: 'CC0 fixture', nutrients: [{ nutrientId: 1003, amount: 2, unitName: 'g' }] }) }] });
    const verified = await service.verifySource(accepted.jobId, 's1', 'fdc_bulk');
    expect(verified.proposal.revisionDraft.fieldProvenance.protein.sourceKey).toBe(fdcKey);
    expect(verified.proposal.revisionDraft.sources[fdcKey].permittedUse).toBe('CC0 fixture');
    expect(verified.proposal.revisionDraft.sources[litKey].permittedUse).toBe('review_required');
});
it('drops base provenance when a residual null cites no source', async () => {
    const { buildRevisionDraft } = await import('../../../shared/nutrition/ingredientProfile.js');
    const { emptyStagedRecord } = await import('../../../shared/nutrition/nutrientRegistry.js');
    const record = emptyStagedRecord();
    record.values.protein = 20;
    record.quality.protein = { status: 'measured' };
    const base = await buildRevisionDraft({ identityId: 'synthetic-identity', variantId: 'synthetic-variant', stagedRecord: record, basis: { kind: 'per_100g_edible', state: 'raw' }, sources: { 'base-fdc': { type: 'fdc', recordId: '9900002', title: 'Synthetic base', version: 'fixture', accessedAt: '2026-11-06', permittedUse: 'CC0' } }, fieldProvenance: { protein: { sourceKey: 'base-fdc' } } });
    base.revision = 1;
    base.revisionId = base.variantId + '~r1';
    const baseRef = { refVersion: 1, scope: 'curated', namespace: 'catalog:nutrition-curated', identityId: base.identityId, variantId: base.variantId, revision: 1, revisionId: base.revisionId, contentHash: base.contentHash };
    const f = await packetFixture({ baseRevision: base, baseRef });
    f.response.results[0].nutrients.protein = { value: null, unit: 'g', status: 'unknown', sourceIds: [] };
    const [job] = await f.service.acceptResponse(f.response);
    const draft = job.proposal.revisionDraft;
    expect(draft.nutrients.protein).toBeNull();
    expect(draft.fieldProvenance.protein).toBeUndefined();
    expect(draft.sources['base-fdc'].recordId).toBe('9900002');
});
it('keeps state words from every verified source and conflicts on their union', async () => {
    const f = await packetFixture({ fields: ['protein', 'sodium'] });
    const result = f.response.results[0];
    result.sources.push({ sourceId: 's2', type: 'fdc', title: 'Cooked fixture', url: 'https://example.test/cooked', recordId: '9900002', version: 'fixture-v1', accessedAt: '2026-11-06' });
    result.identityMatch.state = 'raw';
    result.nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['s1'] };
    result.nutrients.sodium = { value: 50, unit: 'mg', status: 'measured', sourceIds: ['s2'] };
    result.unresolved = [];
    const [accepted] = await f.service.acceptResponse(f.response);
    const foods = {
        '9900001': { type: 'fdc', recordId: '9900001', description: 'Apples, raw', extractedStateWords: ['raw'], permittedUse: 'CC0 fixture', nutrients: [{ nutrientId: 1003, amount: 2, unitName: 'g' }] },
        '9900002': { type: 'fdc', recordId: '9900002', description: 'Lentils, cooked', extractedStateWords: ['cooked'], permittedUse: 'CC0 fixture', nutrients: [{ nutrientId: 1093, amount: 50, unitName: 'mg' }] },
    };
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async (id) => foods[id], toSourceResult: async (raw) => raw }] });
    const cookedFirst = await service.verifySource(accepted.jobId, 's2', 'fdc_bulk');
    expect(cookedFirst.proposal.stateWordsBySource.s2).toEqual(['cooked']);
    expect(cookedFirst.validation.errors).toContain('Explicit conflict: target is raw but source is cooked/prepared');
    const both = await service.verifySource(accepted.jobId, 's1', 'fdc_bulk');
    expect(both.proposal.stateWordsBySource).toEqual({ s2: ['cooked'], s1: ['raw'] });
    expect(both.proposal.extractedStateWords).toEqual(expect.arrayContaining(['raw', 'cooked']));
    expect(both.validation.errors).toContain('Explicit conflict: target is raw but source is cooked/prepared');
});
it('conflicts a raw-only verified source with a cooked target even after a cooked source is verified', async () => {
    const f = await packetFixture({ fields: ['protein', 'sodium'] });
    const stored = await f.store.get(f.job.jobId);
    await f.store.save({ ...stored, target: { ...stored.target, dims: { state: 'cooked' } }, version: stored.version + 1 }, { expectedVersion: stored.version });
    const result = f.response.results[0];
    result.sources[0].recordId = '9900002';
    result.sources.push({ sourceId: 's2', type: 'fdc', title: 'Raw fixture', url: 'https://example.test/raw', recordId: '9900001', version: 'fixture-v1', accessedAt: '2026-11-06' });
    result.identityMatch.state = 'cooked';
    result.nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['s1'] };
    result.nutrients.sodium = { value: 50, unit: 'mg', status: 'measured', sourceIds: ['s2'] };
    result.unresolved = [];
    const [accepted] = await f.service.acceptResponse(f.response);
    const foods = {
        '9900002': { type: 'fdc', recordId: '9900002', description: 'Lentils, cooked', extractedStateWords: ['cooked'], permittedUse: 'CC0 fixture', nutrients: [{ nutrientId: 1003, amount: 2, unitName: 'g' }] },
        '9900001': { type: 'fdc', recordId: '9900001', description: 'Lentils, raw', extractedStateWords: ['raw'], permittedUse: 'CC0 fixture', nutrients: [{ nutrientId: 1093, amount: 50, unitName: 'mg' }] },
    };
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async (id) => foods[id], toSourceResult: async (raw) => raw }] });
    const rawFirst = await service.verifySource(accepted.jobId, 's2', 'fdc_bulk');
    expect(rawFirst.proposal.stateWordsBySource.s2).toEqual(['raw']);
    expect(rawFirst.validation.errors).toContain('Explicit conflict: target is cooked but source is raw');
    const both = await service.verifySource(accepted.jobId, 's1', 'fdc_bulk');
    expect(both.proposal.stateWordsBySource).toEqual({ s2: ['raw'], s1: ['cooked'] });
    expect(both.validation.errors).toContain('Explicit conflict: target is cooked but source is raw');
});
it('refuses curated attestation after a failed refetch and blocks approval', async () => {
    const f = await packetFixture();
    f.response.results[0].nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['s1'] };
    f.response.results[0].unresolved = [];
    const [j] = await f.service.acceptResponse(f.response);
    const nutrients = [{ nutrientId: 1003, amount: 2, unitName: 'g' }];
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => ({ type: 'fdc', recordId: '9900001', permittedUse: 'CC0 fixture', nutrients }) }] });
    const verified = await service.verifySource(j.jobId, 's1', 'fdc_bulk');
    expect(verified.proposal.sourceVerification.s1).toMatchObject({ status: 'verified', method: 'deterministic_refetch' });
    nutrients[0].amount = 3;
    await expect(service.verifySource(j.jobId, 's1', 'fdc_bulk')).rejects.toThrow('mismatch');
    const mismatched = await f.store.get(j.jobId);
    expect(mismatched.proposal.sourceVerification.s1.status).toBe('unverified');
    expect(mismatched.proposal.revisionDraft.sources[mismatched.proposal.assistantSourceKeys.s1].permittedUse).toBe('CC0 fixture');
    await expect(service.attestSource(j.jobId, 's1', 'reviewer')).rejects.toThrow('deterministic refetch');
    expect((await f.store.get(j.jobId)).proposal.sourceVerification.s1.status).toBe('unverified');
    const validation = await validateProposal(mismatched);
    const decision = { decision: 'approve', reviewer: 'reviewer', approvedContentHash: await reviewContentHash(mismatched), acknowledgedWarnings: validation.warnings };
    await expect(service.review(j.jobId, decision)).rejects.toThrow('deterministic refetch');
    const bypass = await f.store.get(j.jobId);
    bypass.proposal.sourceVerification.s1 = { status: 'verified', method: 'reviewer_attestation', reviewer: 'reviewer' };
    bypass.version += 1;
    await f.store.save(bypass);
    const bypassValidation = await validateProposal(bypass);
    const bypassDecision = { decision: 'approve', reviewer: 'reviewer', approvedContentHash: await reviewContentHash(bypass), acknowledgedWarnings: bypassValidation.warnings };
    await expect(service.review(j.jobId, bypassDecision)).rejects.toThrow('deterministic refetch');
    await expect(stageCatalog([{ ...bypass, state: 'approved', review: { reviewer: 'reviewer', checklistVersion: 1, approvedContentHash: bypassDecision.approvedContentHash } }])).rejects.toThrow('deterministic refetch');
});
it('verifySource reports a missing assistant result instead of crashing', async () => {
    const { createMemoryResearchStore, createMemorySourceCache } = await import('../../../shared/nutrition/research/memoryResearchStore.js');
    const store = createMemoryResearchStore();
    const sourceCache = createMemorySourceCache();
    const service = createResearchService({ store, sourceCache, adapters: [{
        id: 'fdc_bulk',
        async match() { return { sourceAdapter: 'fdc_bulk', sourceId: '9900001', sourceRelease: 'fixture' }; },
        async fetch() { return { fdcId: 9900001, description: 'Synthetic apple', foodNutrients: [] }; },
        async toSourceResult(raw) {
            const { parseFdcFood } = await import('../../../shared/nutrition/research/fdcFood.js');
            return parseFdcFood(raw, { release: 'fixture' });
        },
    }] });
    const job = await service.enqueue({ target: { manifestId: 'synthetic-apple', dims: { state: 'raw' } } });
    const reviewed = await service.runJob(job.jobId);
    expect(reviewed.state).toBe('needs_review');
    expect(reviewed.proposal.assistantResult).toBeUndefined();
    const sourceId = Object.keys(reviewed.proposal.revisionDraft.sources)[0];
    expect(reviewed.proposal.revisionDraft.sources[sourceId].type).toBe('fdc');
    await expect(service.verifySource(reviewed.jobId, sourceId, 'fdc_bulk')).rejects.toThrow('Deterministic FDC verification required');
});
it('shows a verified FDC description beside the curated target and requires a match-table record', async () => {
    const f = await packetFixture();
    const stored = await f.store.get(f.job.jobId);
    await f.store.save({ ...stored, target: { ...stored.target, canonicalName: 'Lentils, raw' }, version: stored.version + 1 }, { expectedVersion: stored.version });
    const result = f.response.results[0];
    result.sources[0].recordId = '9900002';
    result.identityMatch = { description: 'Lentils, raw', state: 'raw', conflict: false, notes: '' };
    result.nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['s1'] };
    result.unresolved = [];
    const [accepted] = await f.service.acceptResponse(f.response);
    const chickpeas = { type: 'fdc', recordId: '9900002', description: 'Chickpeas, raw', extractedStateWords: ['raw'], permittedUse: 'CC0 fixture', nutrients: [{ nutrientId: 1003, amount: 2, unitName: 'g' }] };
    const service = createResearchService({ store: f.store, sourceCache: f.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => chickpeas }] });
    const verified = await service.verifySource(accepted.jobId, 's1', 'fdc_bulk');
    expect(verified.proposal.sourceVerification.s1.status).toBe('verified');
    const reviewedMatch = { manifestId: verified.target.manifestId, fdcId: '9900002', description: 'Chickpeas, raw' };
    await expect(buildReviewPacket(verified)).rejects.toThrow('match table');
    const packet = await buildReviewPacket(verified, { matches: [reviewedMatch] });
    expect(packet.markdown).toContain('Lentils, raw');
    expect(packet.markdown).toContain('Chickpeas, raw');
    expect(packet.markdown).toContain('**Identity mismatch:** yes');
    expect(packet.json.identityMismatch).toBe(true);
    expect(packet.json.verifiedFdc).toEqual([{ sourceId: 's1', recordId: '9900002', description: 'Chickpeas, raw' }]);
    const manifestId = verified.target.manifestId;
    await expect(buildReviewPacket(verified, { matches: [{ manifestId, fdcId: '171000', description: 'Lentils, raw' }] })).rejects.toThrow('match table');
    const same = await buildReviewPacket(verified, { matches: [{ manifestId, fdcId: '9900002', description: 'Chickpeas, raw' }] });
    expect(same.json.identityMismatch).toBe(true);
    expect(same.markdown).toContain('Chickpeas, raw');
    const again = await packetFixture();
    again.response.results[0].sources[0].recordId = '9900002';
    again.response.results[0].nutrients.protein = { value: 2, unit: 'g', status: 'measured', sourceIds: ['s1'] };
    again.response.results[0].unresolved = [];
    const [job] = await again.service.acceptResponse(again.response);
    const rejecting = createResearchService({ store: again.store, sourceCache: again.sourceCache, adapters: [{ id: 'fdc_bulk', fetch: async () => ({}), toSourceResult: async () => chickpeas }] });
    await expect(rejecting.verifySource(job.jobId, 's1', 'fdc_bulk', { matches: [{ manifestId: job.target.manifestId, fdcId: '171000', description: 'Lentils, raw' }] })).rejects.toThrow('match table');
    expect((await again.store.get(job.jobId)).proposal.sourceVerification.s1.status).toBe('unverified');
});
it('rejects source ids that are not short opaque ids, because they become published source keys', async () => {
    for (const sourceId of ['pat@example.com', '/users/pat/notes', 'C:\\Users\\pat', '']) {
        const f = await packetFixture();
        f.response.results[0].sources.push({ sourceId, type: 'literature', title: 'Conversion note', url: 'https://example.org/note', accessedAt: '2026-11-06' });
        await expect(f.service.acceptResponse(f.response)).rejects.toThrow(/sourceId/);
    }
    const ok = await packetFixture();
    ok.response.results[0].sources.push({ sourceId: 'fdc-2_cup.v1', type: 'literature', title: 'Conversion note', url: 'https://example.org/note', accessedAt: '2026-11-06' });
    await expect(ok.service.acceptResponse(ok.response)).resolves.toBeTruthy();
});
it('keeps source version, publication, and retrieval dates on the revision draft (#73)', async () => {
    const f = await packetFixture({ fields: ['protein', 'fat', 'sodium'] });
    const result = f.response.results[0];
    result.sources[0].publishedAt = '2026-04-01';
    result.sources.push({ sourceId: 'c1', type: 'composition_db', title: 'Synthetic comparable table', url: 'https://example.test/comparable', recordId: 'cmp-7', version: 'cmp-2026.1', publishedAt: '2026-01-15', accessedAt: '2026-11-07' });
    result.nutrients.protein = { value: 2.7, unit: 'g', status: 'measured', sourceIds: ['s1'] };
    result.nutrients.fat = { value: 0.3, unit: 'g', status: 'estimated_from_comparable', sourceIds: ['c1'], comparator: { name: 'Synthetic comparable', sourceId: 'c1', transferReason: 'Same form' }, derivation: 'Comparable estimate', range: { min: 0.2, max: 0.4 }, confidence: 0.6 };
    result.unresolved = [{ field: 'sodium', reason: 'Salt is not stated' }];
    const [j] = await f.service.acceptResponse(f.response), draft = j.proposal.revisionDraft, keys = j.proposal.assistantSourceKeys;
    expect(draft.sources[keys.s1]).toMatchObject({ type: 'fdc', recordId: '9900001', version: 'fixture-v1', publishedAt: '2026-04-01', accessedAt: '2026-11-06' });
    expect(draft.sources[keys.c1]).toMatchObject({ type: 'comparable', recordId: 'cmp-7', version: 'cmp-2026.1', publishedAt: '2026-01-15', accessedAt: '2026-11-07' });
    expect(draft.fieldProvenance.fat).toEqual({ sourceKey: keys.c1, derivation: 'Comparable estimate', comparatorRef: JSON.stringify({ name: 'Synthetic comparable', sourceId: 'c1', transferReason: 'Same form' }), range: { min: 0.2, max: 0.4 }, confidence: 0.6 });
    expect(draft.nutrients.sodium).toBeNull();
    expect(draft.nutrientMeta.quality.sodium.status).toBe('unknown');
    expect(j.proposal.gaps.sodium).toBe('Salt is not stated');
    await expect(verifyRevisionHash(draft)).resolves.toBe(true);
});
it('keeps sourceless evidence for an unknown field on the assistant result, not as invented provenance (#73)', async () => {
    const f = await packetFixture({ fields: ['sodium'] });
    const result = f.response.results[0];
    result.nutrients.sodium = { value: null, unit: 'mg', status: 'unknown', sourceIds: [], derivation: 'No comparable lists added salt', range: { min: 0, max: 400 }, confidence: 0.2 };
    result.unresolved = [{ field: 'sodium', reason: 'Salt is not stated' }];
    const [j] = await f.service.acceptResponse(f.response);
    // Revision provenance needs a cited sourceKey, so a sourceless unknown gets no entry there.
    expect(j.proposal.revisionDraft.fieldProvenance.sodium).toBeUndefined();
    expect(j.proposal.revisionDraft.nutrients.sodium).toBeNull();
    expect(j.proposal.assistantResult.nutrients.sodium).toMatchObject({ value: null, status: 'unknown', derivation: 'No comparable lists added salt', range: { min: 0, max: 400 }, confidence: 0.2 });
    expect(j.proposal.assistantResult.unresolved).toEqual([{ field: 'sodium', reason: 'Salt is not stated' }]);
    expect(j.proposal.gaps.sodium).toBe('Salt is not stated');
});
