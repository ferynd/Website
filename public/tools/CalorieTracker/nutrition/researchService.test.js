import { createManualAdapter } from '../../../shared/nutrition/research/manualAdapters.js';
import { it, expect, describe, vi } from 'vitest';
import fs from 'node:fs';
import { createMemoryResearchStore, createMemorySourceCache } from '../../../shared/nutrition/research/memoryResearchStore.js';
import { createResearchService } from '../../../shared/nutrition/research/researchService.js';
import { parseFdcFood, PermanentSourceError } from '../../../shared/nutrition/research/fdcFood.js';
function loadFixture(relPath) {
    const url = new URL(`../../../../scripts/fixtures/nutrition/fdc/${relPath}`, import.meta.url);
    return JSON.parse(fs.readFileSync(url, 'utf8'));
}
function createFakeFdcAdapter({ failTimes = 0, failPermanent = false, fetchCallLog = [], } = {}) {
    let callCount = 0;
    return {
        id: 'fdc_bulk',
        scope: ['curated', 'private'],
        runsIn: ['browser', 'cli'],
        requiresSecret: false,
        async release() {
            return '2024-10-31';
        },
        async match(target) {
            return {
                sourceAdapter: 'fdc_bulk',
                sourceId: '9900001',
                sourceRelease: '2024-10-31',
                matchConfidence: 1.0,
                matchType: 'exact',
            };
        },
        async fetch(sourceId) {
            callCount++;
            fetchCallLog.push({ sourceId, callCount });
            if (failPermanent) {
                throw new PermanentSourceError('Food record is permanently corrupted');
            }
            if (callCount <= failTimes) {
                throw new Error('Temporary 503 Service Unavailable');
            }
            return loadFixture('apple-bulk.json');
        },
        async toSourceResult(raw) {
            return parseFdcFood(raw, { release: '2024-10-31' });
        },
    };
}
describe('Research Service', () => {
    it.each(['match_not_found', 'retries_exhausted', 'review_blocked'])('requeues %s with fresh matching and retry state', async reason => {
        const store = createMemoryResearchStore(), sourceCache = createMemorySourceCache();
        const adapter = createFakeFdcAdapter();
        const originalMatch = adapter.match;
        if (reason === 'match_not_found') adapter.match = async () => null;
        if (reason === 'retries_exhausted') adapter.fetch = async () => { throw new Error('temporary'); };
        const service = createResearchService({ store, sourceCache, adapters: [adapter], retry: { maxAttempts: 1 } });
        const j = await service.enqueue({ target: { manifestId: 'retry-fixture', dims: { state: 'raw' } } });
        await expect(service.retryJob(j.jobId)).rejects.toThrow('blocked job');
        let blocked = await service.runJob(j.jobId);
        if (reason === 'review_blocked') blocked = await service.review(j.jobId, { decision: 'block', reviewer: 'r' });
        expect(blocked.blocked.code).toBe(reason);
        expect((await service.runJob(j.jobId)).state).toBe('blocked');
        adapter.match = vi.fn(originalMatch);
        adapter.fetch = vi.fn(async () => loadFixture('apple-bulk.json'));
        const queued = await service.retryJob(j.jobId);
        expect(queued).toMatchObject({ state: 'queued', version: blocked.version + 1, blocked: null, match: null, proposal: null, validation: null, review: null, attempts: [], checkpoint: null, nextAttemptAt: null, sourceEvidence: [], pendingRequest: null });
        const recovered = await service.runJob(j.jobId);
        expect(recovered.state).toBe('needs_review');
        expect(adapter.match).toHaveBeenCalledOnce();
        expect(recovered.attempts).toHaveLength(1);
        await expect(service.retryJob(j.jobId)).rejects.toThrow('blocked job');
        await expect(service.retryJob('missing')).rejects.toThrow('blocked job');
    });
    it('deduplicates enqueue: same jobKey returns identical job; different fields/release creates new job', async () => {
        const store = createMemoryResearchStore();
        const sourceCache = createMemorySourceCache();
        const service = createResearchService({ store, sourceCache });
        const job1 = await service.enqueue({
            targetKind: 'catalog',
            target: { manifestId: 'apple-raw-with-skin', dims: { state: 'raw' } },
            fields: '*',
            sourceRelease: '2024-10-31',
        });
        const job2 = await service.enqueue({
            targetKind: 'catalog',
            target: { manifestId: 'apple-raw-with-skin', dims: { state: 'raw' } },
            fields: '*',
            sourceRelease: '2024-10-31',
        });
        expect(job1.jobId).toBe(job2.jobId);
        expect(job1.jobKey).toBe(job2.jobKey);
        // Different fields -> different job
        const job3 = await service.enqueue({
            targetKind: 'catalog',
            target: { manifestId: 'apple-raw-with-skin', dims: { state: 'raw' } },
            fields: ['calories', 'protein'],
            sourceRelease: '2024-10-31',
        });
        expect(job3.jobId).not.toBe(job1.jobId);
        // Different release -> different job
        const job4 = await service.enqueue({
            targetKind: 'catalog',
            target: { manifestId: 'apple-raw-with-skin', dims: { state: 'raw' } },
            fields: '*',
            sourceRelease: '2025-04-30',
        });
        expect(job4.jobId).not.toBe(job1.jobId);
    });
    it('runs a single-item job to completion through the same pipeline as a batch', async () => {
        const store = createMemoryResearchStore();
        const sourceCache = createMemorySourceCache();
        const adapter = createFakeFdcAdapter();
        const service = createResearchService({ store, sourceCache, adapters: [adapter] });
        const job = await service.enqueue({
            targetKind: 'catalog',
            target: { manifestId: 'apple-raw-with-skin', dims: { state: 'raw' } },
            sourceRelease: '2024-10-31',
        });
        const finished = await service.runJob(job.jobId);
        expect(finished.state).toBe('needs_review');
        expect(finished.proposal?.revisionDraft).toBeDefined();
        expect(finished.proposal.revisionDraft.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(finished.validation.isValid).toBe(true);
    });
    it('keys private jobs by owner and variant identity, not manifest ID', async () => {
        const store = createMemoryResearchStore();
        const sourceCache = createMemorySourceCache();
        const service = createResearchService({ store, sourceCache });
        const job = await service.enqueue({
            scope: 'private',
            ownerUid: 'user-abc',
            targetKind: 'private',
            target: {
                namespace: 'default-app-id',
                ownerUid: 'user-abc',
                identityId: 'pi-11111111111111111111',
                variantId: 'pv-22222222222222222222',
                dims: { state: 'raw' },
            },
            sourceRelease: '2024-10-31',
        });
        expect(job.scope).toBe('private');
        expect(job.ownerUid).toBe('user-abc');
        expect(job.target.manifestId).toBeUndefined();
        expect(job.target.identityId).toBe('pi-11111111111111111111');
    });
    it('retries temporary errors with backoff and succeeds on subsequent attempt', async () => {
        const store = createMemoryResearchStore();
        const sourceCache = createMemorySourceCache();
        const fetchLog = [];
        // Fail 2 times temporarily, then succeed on 3rd
        const adapter = createFakeFdcAdapter({ failTimes: 2, fetchCallLog: fetchLog });
        const service = createResearchService({
            store,
            sourceCache,
            adapters: [adapter],
            sleep: () => Promise.resolve(), // fast sleep
            retry: { maxAttempts: 4, baseMs: 10, maxMs: 100 },
        });
        const job = await service.enqueue({
            targetKind: 'catalog',
            target: { manifestId: 'apple-raw-with-skin', dims: { state: 'raw' } },
        });
        const finished = await service.runJob(job.jobId);
        expect(finished.state).toBe('needs_review');
        expect(finished.attempts.length).toBe(3); // 2 retries + 1 success
        expect(fetchLog.length).toBe(3);
    });
    it('blocks job when retries are exhausted', async () => {
        const store = createMemoryResearchStore();
        const sourceCache = createMemorySourceCache();
        // Fail 5 times, but maxAttempts is 3
        const adapter = createFakeFdcAdapter({ failTimes: 5 });
        const service = createResearchService({
            store,
            sourceCache,
            adapters: [adapter],
            sleep: () => Promise.resolve(),
            retry: { maxAttempts: 3, baseMs: 10, maxMs: 100 },
        });
        const job = await service.enqueue({
            targetKind: 'catalog',
            target: { manifestId: 'apple-raw-with-skin', dims: { state: 'raw' } },
        });
        const finished = await service.runJob(job.jobId);
        expect(finished.state).toBe('blocked');
        expect(finished.blocked?.code).toBe('retries_exhausted');
    });
    it('immediately blocks job on permanent error without wasting retries', async () => {
        const store = createMemoryResearchStore();
        const sourceCache = createMemorySourceCache();
        const adapter = createFakeFdcAdapter({ failPermanent: true });
        const service = createResearchService({
            store,
            sourceCache,
            adapters: [adapter],
        });
        const job = await service.enqueue({
            targetKind: 'catalog',
            target: { manifestId: 'apple-raw-with-skin', dims: { state: 'raw' } },
        });
        const finished = await service.runJob(job.jobId);
        expect(finished.state).toBe('blocked');
        expect(finished.blocked?.code).toBe('source_permanent_error');
        expect(finished.attempts.length).toBe(1);
    });
    it('resumes from cache: a warm-cache rerun makes 0 fetches and produces identical hash', async () => {
        const store = createMemoryResearchStore();
        const sourceCache = createMemorySourceCache();
        const fetchLog = [];
        const adapter = createFakeFdcAdapter({ fetchCallLog: fetchLog });
        const service = createResearchService({ store, sourceCache, adapters: [adapter] });
        const job1 = await service.enqueue({
            targetKind: 'catalog',
            target: { manifestId: 'apple-raw-with-skin', dims: { state: 'raw' } },
            sourceRelease: '2024-10-31',
        });
        const finished1 = await service.runJob(job1.jobId);
        expect(fetchLog.length).toBe(1);
        const hash1 = finished1.proposal.revisionDraft.contentHash;
        // Reset job state to matched to simulate re-running from checkpoint
        finished1.state = 'matched';
        finished1.version += 1;
        await store.save(finished1);
        // Re-run
        const finished2 = await service.runJob(job1.jobId);
        expect(fetchLog.length).toBe(1); // 0 additional fetches!
        expect(finished2.proposal.revisionDraft.contentHash).toBe(hash1);
    });
    it('detects compare-and-swap concurrency conflicts', async () => {
        const store = createMemoryResearchStore();
        const sourceCache = createMemorySourceCache();
        const service = createResearchService({ store, sourceCache });
        const job = await service.enqueue({
            targetKind: 'catalog',
            target: { manifestId: 'apple-raw-with-skin', dims: { state: 'raw' } },
        });
        // Save with wrong expectedVersion
        await expect(store.save(job, { expectedVersion: 999 })).rejects.toThrow('Compare-and-swap conflict');
    });
});
it('seeds a field-limited deterministic pass from its base and preserves original source evidence', async () => {
    const store = createMemoryResearchStore(), sourceCache = createMemorySourceCache();
    const service = createResearchService({ store, sourceCache, adapters: [createManualAdapter()] });
    const target = { manifestId: 'residual-fixture', dims: { state: 'raw' } };
    const first = await service.enqueue({ target, fields: ['protein', 'calories', 'sodium'] });
    const original = await service.runJob(first.jobId, { adapterId: 'manual', context: { manualRecord: {
        recordId: 'base-record', source: { type: 'manual' }, nutrients: {
            protein: { value: 10, unit: 'g', status: 'measured' },
            calories: { value: 40, unit: 'kcal', status: 'calculated', derivation: 'Synthetic base' },
            sodium: { value: 20, unit: 'mg', status: 'measured' },
        },
    } } });
    const base = { ...original.proposal.revisionDraft, revision: 1, revisionId: 'residual-fixture~r1' };
    const baseRef = { refVersion: 1, scope: 'curated', namespace: 'catalog:nutrition-curated', identityId: base.identityId, variantId: base.variantId, revision: 1, revisionId: base.revisionId, contentHash: base.contentHash };
    const next = await service.enqueue({ target: { ...target, baseRevision: base, baseRef }, fields: ['sodium', 'iodine'] });
    const reviewed = await service.runJob(next.jobId, { adapterId: 'manual', context: { manualRecord: {
        recordId: 'new-record', source: { type: 'manual' }, nutrients: {
            // Unrequested observations must not overwrite the base either.
            protein: { value: 99, unit: 'g', status: 'measured' },
            sodium: { value: 30, unit: 'mg', status: 'measured' },
        },
    } } });
    const draft = reviewed.proposal.revisionDraft;
    expect(reviewed.validation.isValid).toBe(true);
    expect(draft.nutrients).toMatchObject({ protein: 10, calories: 40, sodium: 30, iodine: null });
    for (const key of ['protein', 'calories']) {
        expect(draft.nutrientMeta.quality[key]).toEqual(base.nutrientMeta.quality[key]);
        expect(draft.fieldProvenance[key]).toEqual(base.fieldProvenance[key]);
        expect(draft.sources[draft.fieldProvenance[key].sourceKey]).toEqual(base.sources[base.fieldProvenance[key].sourceKey]);
        expect(reviewed.proposal.diff.nutrientChanges[key]).toBeUndefined();
        expect(reviewed.proposal.gaps[key]).toBeUndefined();
    }
    expect(draft.sources[draft.fieldProvenance.sodium.sourceKey].recordId).toBe('new-record');
    expect(draft.fieldProvenance.sodium.sourceKey).not.toBe(base.fieldProvenance.sodium.sourceKey);
    expect(draft.supersedes).toEqual({ revision: 1, revisionId: base.revisionId, contentHash: base.contentHash });
});
