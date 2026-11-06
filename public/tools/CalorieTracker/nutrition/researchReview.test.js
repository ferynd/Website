import { it, expect, describe } from 'vitest';
import { emptyStagedRecord, V2_KEYS } from '../../../shared/nutrition/nutrientRegistry.js';
import { buildRevisionDraft } from '../../../shared/nutrition/ingredientProfile.js';
import { createResearchJob } from '../../../shared/nutrition/research/researchJob.js';
import { buildRevisionDiff, buildReviewPacket, applyReviewDecision, CHECKLIST_VERSION, publishedIdentityFor, reviewContentHash } from '../../../shared/nutrition/research/researchReview.js';
async function makeJobWithDraft(values = { protein: 10, calories: 40 }) {
    const staged = emptyStagedRecord();
    for (const k of V2_KEYS) {
        staged.values[k] = values[k] !== undefined ? values[k] : null;
        staged.quality[k] = { status: values[k] !== null && values[k] !== undefined ? 'measured' : 'unknown' };
    }
    const draft = await buildRevisionDraft({
        identityId: 'pi-11111111111111111111',
        variantId: 'pv-22222222222222222222',
        basis: { kind: 'per_100g_edible', state: 'raw' },
        stagedRecord: staged,
        fieldProvenance: {
            protein: { sourceKey: 'src-1' },
            calories: { sourceKey: 'src-1' },
        },
        sources: {
            'src-1': {
                type: 'manual',
                title: 'Source',
                version: '1',
                accessedAt: '2026-11-06',
                permittedUse: 'CC0 1.0',
            },
        },
    });
    const job = await createResearchJob({
        scope: 'curated',
        targetKind: 'catalog',
        target: { manifestId: 'apple-raw-with-skin' },
        state: 'needs_review',
    });
    job.proposal = {
        revisionDraft: draft,
        conversions: [],
    };
    job.validation = {
        isValid: true,
        errors: [],
        warnings: [],
    };
    return { job, draft };
}
describe('Research Review', () => {
    it('correctly calculates revision diffs between base and draft', async () => {
        const { draft } = await makeJobWithDraft({ protein: 10, calories: 40 });
        const { draft: updatedDraft } = await makeJobWithDraft({ protein: 15, calories: 60 });
        const diff = buildRevisionDiff(draft, updatedDraft);
        expect(diff.hasChanges).toBe(true);
        expect(diff.nutrientChanges.protein).toBeDefined();
        expect(diff.nutrientChanges.protein.oldValue).toBe(10);
        expect(diff.nutrientChanges.protein.newValue).toBe(15);
        expect(diff.nutrientChanges.calories.oldValue).toBe(40);
        expect(diff.nutrientChanges.calories.newValue).toBe(60);
        const sameDiff = buildRevisionDiff(draft, draft);
        expect(sameDiff.hasChanges).toBe(false);
    });
    it('builds review packet with JSON, Markdown and checklist v1', async () => {
        const { job } = await makeJobWithDraft();
        const packet = await buildReviewPacket(job);
        expect(packet.json.checklistVersion).toBe(CHECKLIST_VERSION);
        expect(packet.json.jobId).toBe(job.jobId);
        expect(packet.markdown).toContain('# Research Review');
        expect(packet.markdown).toContain('identity_verified');
        expect(packet.markdown).toContain('warnings_acknowledged');
    });
    it('approves a job when approvedContentHash matches and warnings are acknowledged', async () => {
        const { job, draft } = await makeJobWithDraft();
        const approvedJob = await applyReviewDecision(job, {
            decision: 'approve',
            reviewer: 'James',
            approvedContentHash: await reviewContentHash(job),
            acknowledgedWarnings: [],
        });
        expect(approvedJob.state).toBe('approved');
        expect(approvedJob.review.reviewer).toBe('James');
        expect(approvedJob.review.approvedContentHash).toBe(await reviewContentHash(job));
        expect(approvedJob.version).toBe(2);
    });
    it('rejects approval if contentHash does not match approvedContentHash', async () => {
        const { job } = await makeJobWithDraft();
        await expect(applyReviewDecision(job, {
            decision: 'approve',
            reviewer: 'James',
            approvedContentHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
            acknowledgedWarnings: [],
        })).rejects.toThrow('Approved content hash mismatch');
    });
    it('blocks approval if there are unacknowledged validation warnings', async () => {
        const { job, draft } = await makeJobWithDraft();
        job.validation.warnings = ['Target food state is unspecified'];
        await expect(applyReviewDecision(job, {
            decision: 'approve',
            reviewer: 'James',
            approvedContentHash: await reviewContentHash(job),
            acknowledgedWarnings: [], // omitted acknowledgment!
        })).rejects.toThrow('unacknowledged warnings');
        // With acknowledgment, it passes
        const approvedJob = await applyReviewDecision(job, {
            decision: 'approve',
            reviewer: 'James',
            approvedContentHash: await reviewContentHash(job),
            acknowledgedWarnings: ['Target food state is unspecified'],
        });
        expect(approvedJob.state).toBe('approved');
    });
    it('blocks approval if there are validation errors', async () => {
        const { job, draft } = await makeJobWithDraft();
        job.validation.errors = ['Explicit conflict: target is raw but source is cooked'];
        await expect(applyReviewDecision(job, {
            decision: 'approve',
            reviewer: 'James',
            approvedContentHash: await reviewContentHash(job),
            acknowledgedWarnings: [],
        })).rejects.toThrow('Cannot approve job with validation errors');
    });
});
it('rejects a stale approval after conversion-only edits and displays the full weights/evidence', async () => {
    const { job } = await makeJobWithDraft();
    job.proposal.conversions = [{ unit: 'cup', amount: 1, grams: 125, state: 'raw', source: { type: 'manual', title: 'Synthetic portion' } }];
    const packet = await buildReviewPacket(job);
    expect(packet.json.conversions).toEqual(job.proposal.conversions);
    expect(packet.json.diff.addedConversions).toEqual(job.proposal.conversions);
    expect(packet.markdown).toContain('1 cup: 125 g');
    const decision = { decision: 'approve', reviewer: 'r', approvedContentHash: packet.json.contentHash };
    const unchanged = await applyReviewDecision(job, decision);
    expect(unchanged.state).toBe('approved');
    job.proposal.conversions[0].grams = 250;
    await expect(applyReviewDecision(job, decision)).rejects.toThrow('Approved content hash mismatch');
});
it('binds the review hash and packet to gaps and the published identity', async () => {
    const { job } = await makeJobWithDraft();
    job.target.canonicalName = 'Synthetic apple';
    job.target.aliases = ['fixture alias'];
    job.proposal.gaps = { iodine: 'not_reported_by_source' };
    const packet = await buildReviewPacket(job);
    expect(packet.json.gaps).toEqual(job.proposal.gaps);
    expect(packet.json.identity).toEqual(publishedIdentityFor(job));
    expect(packet.json.contentHash).toBe(await reviewContentHash(job));
    expect(packet.markdown).toContain('Synthetic apple');
    expect(packet.markdown).toContain('fixture alias');
    expect(packet.markdown).toContain('not_reported_by_source');
    const decision = { decision: 'approve', reviewer: 'James', approvedContentHash: packet.json.contentHash, acknowledgedWarnings: [] };
    expect((await applyReviewDecision(job, decision)).state).toBe('approved');
    const changed = structuredClone(job);
    changed.proposal.gaps = { iodine: 'edited_after_approval' };
    await expect(applyReviewDecision(changed, decision)).rejects.toThrow('hash mismatch');
    const renamed = structuredClone(job);
    renamed.target.canonicalName = 'Pear';
    await expect(applyReviewDecision(renamed, decision)).rejects.toThrow('hash mismatch');
    const realias = structuredClone(job);
    realias.target.aliases = ['other alias'];
    await expect(applyReviewDecision(realias, decision)).rejects.toThrow('hash mismatch');
    const cooked = structuredClone(job);
    cooked.target.dims = { ...cooked.target.dims, state: 'cooked' };
    await expect(applyReviewDecision(cooked, decision)).rejects.toThrow('hash mismatch');
});
