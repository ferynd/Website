import { reviewContentHash } from '../../../shared/nutrition/research/researchReview.js';
import { CURATED_CATALOG_ID } from '../../../shared/nutrition/ingredientIds.js';
import { it, expect, describe } from 'vitest';
import { emptyStagedRecord, V2_KEYS } from '../../../shared/nutrition/nutrientRegistry.js';
import { buildRevisionDraft, revisionToStagedRecord } from '../../../shared/nutrition/ingredientProfile.js';
import { buildConversion } from '../../../shared/nutrition/ingredientConversion.js';
import { createCuratedCatalogSource } from '../../../shared/nutrition/ingredientCatalog.js';
import { createResearchJob } from '../../../shared/nutrition/research/researchJob.js';
import { stageCatalog, toCatalogRecord } from '../../../shared/nutrition/research/stagedCatalog.js';
async function makeApprovedCuratedJob({ manifestId = 'apple-raw-with-skin', canonicalName = 'Apple, raw, with skin', category = 'fruits-fruit-juices', protein = 0.26, calories = 52, } = {}) {
    const staged = emptyStagedRecord();
    for (const k of V2_KEYS) {
        staged.values[k] = null;
        staged.quality[k] = { status: 'unknown', qualifier: 'gap:not_reported_by_source' };
    }
    staged.values.protein = protein;
    staged.quality.protein = { status: 'measured' };
    staged.values.calories = calories;
    staged.quality.calories = { status: 'measured' };
    const identityId = manifestId;
    const variantId = manifestId;
    const draft = await buildRevisionDraft({
        identityId,
        variantId,
        basis: { kind: 'per_100g_edible', state: 'raw' },
        stagedRecord: staged,
        fieldProvenance: {
            protein: { sourceKey: 'src-1' },
            calories: { sourceKey: 'src-1' },
        },
        sources: {
            'src-1': {
                type: 'fdc',
                datasetId: 'Foundation',
                recordId: '9900001',
                title: 'Apple raw',
                version: '2024-10-31',
                accessedAt: '2026-11-06',
                permittedUse: 'CC0 1.0',
            },
        },
    });
    const convDoc = {
        schemaVersion: 1,
        variantRef: {
            refVersion: 1,
            scope: 'curated',
            namespace: 'catalog:' + CURATED_CATALOG_ID,
            identityId,
            variantId,
            revision: 1,
            revisionId: `${variantId}~r1`,
            contentHash: draft.contentHash,
        },
        kind: 'household',
        unit: 'cup',
        unitQualifier: 'sliced',
        amount: 1,
        grams: 125,
        state: 'raw',
        source: {
            type: 'fdc',
            version: '2024-10-31',
            accessedAt: '2026-11-06',
            permittedUse: 'CC0 1.0',
        },
        confidence: 1,
    };
    const conv = await buildConversion(convDoc);
    const job = await createResearchJob({
        scope: 'curated',
        targetKind: 'catalog',
        target: {
            manifestId,
            canonicalName,
            category,
            dims: { state: 'raw' },
            aliases: ['fresh apple'],
        },
        sourceRelease: '2024-10-31',
        state: 'needs_review',
    });
    job.proposal = {
        revisionDraft: draft,
        conversions: [conv],
        gaps: { carbs: 'not_reported_by_source' },
    };
    job.review = {
        checklistVersion: 1,
        decision: 'approve',
        reviewer: 'James',
        reviewedAt: '2026-11-06T12:00:00Z',
        approvedContentHash: await reviewContentHash(job),
        acknowledgedWarnings: [],
    };
    job.state = 'approved';
    return job;
}
describe('Staged Catalog', () => {
    it('rejects duplicate variants from identical or different approved passes', async () => {
        const a = await makeApprovedCuratedJob();
        const b = await makeApprovedCuratedJob({ protein: 0.3 });
        b.jobId = 'rj-' + '1'.repeat(24);
        for (const jobs of [[a, a], [a, b], [b, a]])
            await expect(stageCatalog(jobs)).rejects.toThrow('Duplicate variant conflict');
        expect((await stageCatalog([b])).manifest.profileCount).toBe(1);
    });
    it('stages approved jobs and opens round-trip through createCuratedCatalogSource', async () => {
        const job1 = await makeApprovedCuratedJob({
            manifestId: 'apple-raw-with-skin',
            canonicalName: 'Apple, raw, with skin',
        });
        const job2 = await makeApprovedCuratedJob({
            manifestId: 'olive-oil-extra-virgin',
            canonicalName: 'Olive oil, extra virgin',
            calories: 884,
            protein: 0,
        });
        const staged = await stageCatalog([job1, job2]);
        expect(staged.manifest.catalogId).toBe(CURATED_CATALOG_ID);
        expect(staged.manifest.profileCount).toBe(2);
        // In-memory catalog source using injected fetchJson
        const catalogSource = createCuratedCatalogSource({
            fetchJson: async (url) => {
                const root = '/shared/nutrition/catalog/' + CURATED_CATALOG_ID + '/';
                const path = url.slice(root.length);
                if (path === 'manifest.json') {
                    return staged.manifest;
                }
                if (staged.files[path]) {
                    return staged.files[path];
                }
                throw new Error(`File not found: ${path}`);
            },
        });
        // 1. Search
        const searchResults = await catalogSource.search('apple');
        expect(searchResults.items.length).toBeGreaterThan(0);
        expect(searchResults.items[0].variantId).toBe('apple-raw-with-skin');
        // 2. getVariant
        const variantRec = await catalogSource.getVariant('apple-raw-with-skin');
        expect(variantRec).not.toBeNull();
        expect(variantRec.identityId).toBe('apple-raw-with-skin');
        // 3. getRevision
        const rev1 = await catalogSource.getRevision('apple-raw-with-skin', 1);
        expect(rev1).not.toBeNull();
        expect(rev1.revision).toBe(1);
        expect(rev1.nutrients.calories).toBe(52);
        expect(rev1.contentHash).toBe(job1.proposal.revisionDraft.contentHash);
        // 4. getConversions
        const convs = await catalogSource.getConversions('apple-raw-with-skin');
        expect(convs.length).toBe(1);
        expect(convs[0].unit).toBe('cup');
        expect(convs[0].grams).toBe(125);
    });
    it('guarantees byte-for-byte reproducibility of staged output', async () => {
        const job1 = await makeApprovedCuratedJob({ manifestId: 'apple-raw-with-skin' });
        const job2 = await makeApprovedCuratedJob({ manifestId: 'olive-oil-extra-virgin' });
        // Stage with order [job1, job2]
        const stagedA = await stageCatalog([job1, job2]);
        // Stage with reverse order [job2, job1]
        const stagedB = await stageCatalog([job2, job1]);
        expect(JSON.stringify(stagedA.manifest)).toBe(JSON.stringify(stagedB.manifest));
        expect(Object.keys(stagedA.files).sort()).toEqual(Object.keys(stagedB.files).sort());
        for (const key of Object.keys(stagedA.files)) {
            expect(JSON.stringify(stagedA.files[key])).toBe(JSON.stringify(stagedB.files[key]));
        }
    });
    it('refuses unapproved jobs', async () => {
        const job = await makeApprovedCuratedJob();
        job.state = 'needs_review';
        expect(() => toCatalogRecord(job)).toThrow('Cannot stage unapproved job');
        await expect(stageCatalog([job])).rejects.toThrow('Cannot stage unapproved job');
    });
    it('refuses private jobs', async () => {
        const job = await makeApprovedCuratedJob();
        job.scope = 'private';
        expect(() => toCatalogRecord(job)).toThrow('Cannot stage private job');
        await expect(stageCatalog([job])).rejects.toThrow('Cannot stage private job');
    });
});
it.each(['grams', 'amount', 'unit', 'state', 'source', 'range', 'removed', 'added'])('refuses staging when conversions change after review: %s', async field => {
    const job = await makeApprovedCuratedJob();
    const conv = job.proposal.conversions[0];
    if (field === 'grams') conv.grams = 200;
    if (field === 'amount') conv.amount = 2;
    if (field === 'unit') conv.unit = 'tbsp';
    if (field === 'state') conv.state = 'cooked';
    if (field === 'source') conv.source.permittedUse = 'CC0 changed';
    if (field === 'range') conv.range = { min: 100, max: 150 };
    if (field === 'removed') job.proposal.conversions = [];
    if (field === 'added') job.proposal.conversions.push({ ...conv, unit: 'tbsp' });
    await expect(stageCatalog([job])).rejects.toThrow('valid reviewed content hash');
});
it('refuses staging when gaps or published identity change after approval', async () => {
    const renamed = await makeApprovedCuratedJob();
    renamed.target.canonicalName = 'Pear';
    await expect(stageCatalog([renamed])).rejects.toThrow('valid reviewed content hash');
    const realias = await makeApprovedCuratedJob();
    realias.target.aliases = ['changed apple'];
    await expect(stageCatalog([realias])).rejects.toThrow('valid reviewed content hash');
    const cooked = await makeApprovedCuratedJob();
    cooked.target.dims = { ...cooked.target.dims, state: 'cooked' };
    await expect(stageCatalog([cooked])).rejects.toThrow('valid reviewed content hash');
    const recategorized = await makeApprovedCuratedJob();
    expect((await stageCatalog([recategorized])).records[0].identity).toMatchObject({ category: 'fruits-fruit-juices', kind: 'generic' });
    recategorized.target.category = 'vegetables';
    await expect(stageCatalog([recategorized])).rejects.toThrow('valid reviewed content hash');
    const rekinded = await makeApprovedCuratedJob();
    rekinded.target.kind = 'branded';
    await expect(stageCatalog([rekinded])).rejects.toThrow('valid reviewed content hash');
    const gaps = await makeApprovedCuratedJob();
    gaps.proposal.gaps = { carbs: 'not_computed' };
    await expect(stageCatalog([gaps])).rejects.toThrow('valid reviewed content hash');
});
it('allows a private brand name and refuses an email reviewer or leaked contact', async () => {
    const brand = await makeApprovedCuratedJob({ canonicalName: 'Private Selection apple' });
    brand.target.aliases = ['Private Selection'];
    brand.review.approvedContentHash = await reviewContentHash(brand);
    const staged = await stageCatalog([brand]);
    expect(staged.records[0].identity.canonicalName).toBe('Private Selection apple');
    expect(staged.records[0].identity.aliases).toEqual(['Private Selection']);
    expect(staged.records[0].research.reviewer).toBe('James');
    const emailed = await makeApprovedCuratedJob();
    emailed.review.reviewer = 'pat@example.com';
    emailed.review.approvedContentHash = await reviewContentHash(emailed);
    await expect(stageCatalog([emailed])).rejects.toThrow('reviewer handle');
    const leaked = await makeApprovedCuratedJob();
    leaked.proposal.gaps = { iodine: 'ask pat@example.com' };
    leaked.review.approvedContentHash = await reviewContentHash(leaked);
    await expect(stageCatalog([leaked])).rejects.toThrow('refuses private');
});
it('refuses a nutrient qualifier that is the only private leak', async () => {
    const job = await makeApprovedCuratedJob();
    const staged = revisionToStagedRecord(job.proposal.revisionDraft);
    staged.quality.iodine = { status: 'unknown', qualifier: 'ask pat@example.com' };
    const draft = job.proposal.revisionDraft;
    job.proposal.revisionDraft = await buildRevisionDraft({
        identityId: draft.identityId,
        variantId: draft.variantId,
        basis: draft.basis,
        stagedRecord: staged,
        fieldProvenance: draft.fieldProvenance,
        sources: draft.sources,
    });
    job.proposal.gaps = { ...(job.proposal.gaps || {}), iodine: 'not_reported_by_source' };
    expect(job.proposal.revisionDraft.nutrientMeta.quality.iodine).toEqual({ status: 'unknown', qualifier: 'ask pat@example.com' });
    expect(job.proposal.revisionDraft.fieldProvenance.iodine).toBeUndefined();
    expect(JSON.stringify(job.proposal.gaps)).not.toContain('pat@example.com');
    expect(JSON.stringify(job.proposal.revisionDraft.sources)).not.toContain('pat@example.com');
    job.review.approvedContentHash = await reviewContentHash(job);
    await expect(stageCatalog([job])).rejects.toThrow('refuses private');
});
it.each(['derivation', 'comparatorRef', 'version', 'datasetId', 'originalBasis'])('refuses private text in %s', async (field) => {
    const job = await makeApprovedCuratedJob();
    const draft = job.proposal.revisionDraft;
    if (field === 'derivation' || field === 'comparatorRef')
        draft.fieldProvenance.protein = { ...draft.fieldProvenance.protein, [field]: 'ask pat@example.com' };
    else
        draft.sources['src-1'] = { ...draft.sources['src-1'], [field]: 'ask pat@example.com' };
    const staged = revisionToStagedRecord(draft);
    job.proposal.revisionDraft = await buildRevisionDraft({
        identityId: draft.identityId,
        variantId: draft.variantId,
        basis: draft.basis,
        stagedRecord: staged,
        fieldProvenance: draft.fieldProvenance,
        sources: draft.sources,
    });
    job.review.approvedContentHash = await reviewContentHash(job);
    await expect(stageCatalog([job])).rejects.toThrow('refuses private');
});
it('refuses private text anywhere in the staged record even when the review hash matches', async () => {
    for (const mutate of [
        job => { job.proposal.gaps = { iodine: 'see /users/hidden confidential note' }; },
        job => { job.target.aliases = ['/users/hidden']; },
        job => { job.target.canonicalName = 'confidential blend'; },
    ]) {
        const job = await makeApprovedCuratedJob();
        mutate(job);
        job.review.approvedContentHash = await reviewContentHash(job);
        await expect(stageCatalog([job])).rejects.toThrow('refuses private');
    }
});
