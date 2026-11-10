import { it, expect, describe } from 'vitest';
import { emptyStagedRecord, V2_KEYS } from '../../../shared/nutrition/nutrientRegistry.js';
import { buildRevisionDraft } from '../../../shared/nutrition/ingredientProfile.js';
import { createResearchJob } from '../../../shared/nutrition/research/researchJob.js';
import { buildRevisionDiff, buildReviewPacket, applyReviewDecision, CHECKLIST_VERSION, publishedIdentityFor, reviewContentHash, verifiedRecordMatchesTable, verifiedFdcRecords, deterministicFdcRecords, assertCuratedMatchTable } from '../../../shared/nutrition/research/researchReview.js';
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
it('fails closed on unreviewed curated FDC records and permits exact reviewed matches', () => {
    const manifestId = 'apple-raw-with-skin';
    const entry = { manifestId, fdcId: '9900001', description: 'Apple, raw' };
    const record = { recordId: '9900001', description: 'Apple, raw' };
    expect(verifiedRecordMatchesTable(manifestId, record, [])).toBe(false);
    expect(verifiedRecordMatchesTable(manifestId, record, [entry])).toBe(true);
    expect(verifiedRecordMatchesTable(manifestId, { ...record, description: 'Apple, cooked' }, [entry])).toBe(false);
    expect(verifiedRecordMatchesTable(manifestId, { ...record, recordId: '9900002' }, [entry])).toBe(false);

    const job = {
        scope: 'curated',
        target: { manifestId },
        proposal: {
            revisionDraft: { sources: { s1: { type: 'fdc', recordId: record.recordId, title: record.description } } },
            assistantSourceKeys: { s1: 's1' },
            assistantResult: { sources: [{ sourceId: 's1' }] },
            sourceVerification: { s1: { status: 'verified', method: 'deterministic_refetch' } },
        },
    };
    expect(() => assertCuratedMatchTable(job, [])).toThrow('match table');
    expect(() => assertCuratedMatchTable(job, [entry])).not.toThrow();
    expect(() => assertCuratedMatchTable({ ...job, scope: 'private' }, [])).not.toThrow();
});

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
    job.target.category = 'fruit';
    job.target.kind = 'generic';
    job.proposal.gaps = { iodine: 'not_reported_by_source' };
    const packet = await buildReviewPacket(job);
    expect(packet.json.gaps).toEqual(job.proposal.gaps);
    expect(packet.json.identity).toEqual(publishedIdentityFor(job));
    expect(packet.json.identity).toMatchObject({ category: 'fruit', kind: 'generic' });
    expect(packet.json.contentHash).toBe(await reviewContentHash(job));
    expect(packet.markdown).toContain('Synthetic apple');
    expect(packet.markdown).toContain('fixture alias');
    expect(packet.markdown).toContain('fruit');
    expect(packet.markdown).toContain('generic');
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
    const recategorized = structuredClone(job);
    recategorized.target.category = 'vegetable';
    await expect(applyReviewDecision(recategorized, decision)).rejects.toThrow('hash mismatch');
    const rekinded = structuredClone(job);
    rekinded.target.kind = 'branded';
    await expect(applyReviewDecision(rekinded, decision)).rejects.toThrow('hash mismatch');
});
describe('reviewed match table fails closed for curated FDC records (#63 V2)', () => {
    const entry = { manifestId: 'lemon-juice', fdcId: '167747', description: 'Lemon juice, raw', release: '2018-04', dataType: 'SR Legacy' };
    const record = { recordId: '167747', description: 'Lemon juice, raw', release: '2018-04', dataType: 'SR Legacy' };
    it('treats a missing table entry as no match', () => {
        expect(verifiedRecordMatchesTable('lemon-juice', record, [])).toBe(false);
        expect(verifiedRecordMatchesTable('lemon-juice', record, undefined)).toBe(false);
        expect(verifiedRecordMatchesTable('lemon-juice', record, [{ ...entry, manifestId: 'lime-juice' }])).toBe(false);
        expect(verifiedRecordMatchesTable(undefined, record, [entry])).toBe(false);
    });
    it('requires the record to agree on fdcId, description, release, and dataType', () => {
        expect(verifiedRecordMatchesTable('lemon-juice', record, [entry])).toBe(true);
        expect(verifiedRecordMatchesTable('lemon-juice', { ...record, recordId: '167748' }, [entry])).toBe(false);
        expect(verifiedRecordMatchesTable('lemon-juice', { ...record, description: 'Lemon juice, from concentrate' }, [entry])).toBe(false);
        expect(verifiedRecordMatchesTable('lemon-juice', { ...record, release: '2026-10-29' }, [entry])).toBe(false);
        expect(verifiedRecordMatchesTable('lemon-juice', { ...record, dataType: 'Foundation' }, [entry])).toBe(false);
        // A record that omits a release or dataType the entry names does not match.
        const bare = { recordId: record.recordId, description: record.description };
        expect(verifiedRecordMatchesTable('lemon-juice', bare, [entry])).toBe(false);
        expect(verifiedRecordMatchesTable('lemon-juice', { ...bare, release: '2018-04' }, [entry])).toBe(false);
        // An empty description never matches, even an entry with an empty description.
        expect(verifiedRecordMatchesTable('lemon-juice', { ...record, description: '' }, [{ ...entry, description: '' }])).toBe(false);
        // An entry without release/dataType still checks fdcId and description.
        expect(verifiedRecordMatchesTable('lemon-juice', bare, [{ manifestId: 'lemon-juice', fdcId: '167747', description: 'Lemon juice, raw' }])).toBe(true);
    });
    function assistantVerifiedJob(source, { scope = 'curated', method = 'deterministic_refetch' } = {}) {
        return {
            scope, target: { manifestId: 'lemon-juice' },
            proposal: {
                assistantResult: { sources: [{ sourceId: 's1' }] }, assistantSourceKeys: { s1: 'req:s1' },
                revisionDraft: { sources: { 'req:s1': source } },
                sourceVerification: { s1: { status: 'verified', method } },
            },
        };
    }
    const published = { type: 'fdc', recordId: '167747', title: 'Lemon juice, raw', version: '2018-04', datasetId: 'SR Legacy' };
    it('fails a refetch-verified curated record with no entry, a wrong release, or a wrong dataType', () => {
        expect(verifiedFdcRecords(assistantVerifiedJob(published))).toEqual([{ sourceId: 's1', ...record }]);
        expect(() => assertCuratedMatchTable(assistantVerifiedJob(published), [])).toThrow('match table');
        expect(() => assertCuratedMatchTable(assistantVerifiedJob({ ...published, version: '2026-10-29' }), [entry])).toThrow('match table');
        expect(() => assertCuratedMatchTable(assistantVerifiedJob({ ...published, datasetId: 'Foundation' }), [entry])).toThrow('match table');
        expect(() => assertCuratedMatchTable(assistantVerifiedJob(published), [entry])).not.toThrow();
    });
    it('keeps private jobs and non-FDC or unverified sources out of the curated table check', () => {
        expect(() => assertCuratedMatchTable(assistantVerifiedJob(published, { scope: 'private' }), [])).not.toThrow();
        expect(() => assertCuratedMatchTable(assistantVerifiedJob({ ...published, type: 'literature' }), [])).not.toThrow();
        expect(() => assertCuratedMatchTable(assistantVerifiedJob(published, { method: 'reviewer_attestation' }), [])).not.toThrow();
    });
    function deterministicJob(source, match = { sourceAdapter: 'fdc_bulk', sourceId: '167747', sourceRelease: '2018-04' }) {
        return { scope: 'curated', target: { manifestId: 'lemon-juice' }, match, proposal: { revisionDraft: { sources: { 'fdc:167747': source } } } };
    }
    it('re-checks a deterministic bulk proposal against its reviewed entry', () => {
        expect(deterministicFdcRecords(deterministicJob(published))).toEqual([{ sourceId: 'match', ...record }]);
        expect(() => assertCuratedMatchTable(deterministicJob(published), [entry])).not.toThrow();
        expect(() => assertCuratedMatchTable(deterministicJob(published), [])).toThrow('match table');
        // A record stamped with another release (the mixed-release mis-stamp) fails.
        expect(() => assertCuratedMatchTable(deterministicJob({ ...published, version: '2026-10-29' }), [entry])).toThrow('match table');
        expect(() => assertCuratedMatchTable(deterministicJob({ ...published, datasetId: 'Foundation' }), [entry])).toThrow('match table');
        // A missing source record cannot equal a reviewed entry.
        expect(() => assertCuratedMatchTable(deterministicJob({ ...published, recordId: '1' }), [entry])).toThrow('match table');
        // Manual and curated-reuse jobs are not FDC matches.
        expect(deterministicFdcRecords(deterministicJob(published, { sourceAdapter: 'manual', sourceId: 'x' }))).toEqual([]);
        const reused = deterministicJob(published);
        reused.proposal.reused = true;
        expect(deterministicFdcRecords(reused)).toEqual([]);
    });
});
