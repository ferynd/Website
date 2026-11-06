import { validateProposal } from './researchValidator.js';
import { buildCatalogShards } from '../ingredientCatalog.js';
export function toCatalogRecord(job) {
    if (!job || typeof job !== 'object') {
        throw new TypeError('Invalid job: expected object');
    }
    if (job.state !== 'approved') {
        throw new Error(`Cannot stage unapproved job: ${job.jobId} is in state ${job.state}`);
    }
    if (job.scope !== 'curated') {
        throw new Error(`Cannot stage private job into curated catalog: ${job.jobId}`);
    }
    if (job.ownerUid || job.target?.ownerUid || job.proposal?.conversions?.some(c => c.ownerUid || /private|restricted|confidential|blob:|data:|\/users\//i.test(JSON.stringify(c.source))) || /private|restricted|confidential|blob:|data:|\/users\//i.test(JSON.stringify(job.proposal?.revisionDraft?.sources || {})))
        throw new TypeError('Curated staging refuses private data');
    if (job.proposal?.assistantResult && job.proposal.assistantResult.sources.some(s => job.proposal.sourceVerification?.[s.sourceId]?.status !== 'verified'))
        throw new TypeError('Verified sources required');
    const draft = job.proposal?.revisionDraft;
    if (!draft) {
        throw new Error(`Job ${job.jobId} is missing revisionDraft`);
    }
    const manifestId = job.target?.manifestId;
    if (!manifestId) {
        throw new Error(`Job ${job.jobId} is missing target.manifestId`);
    }
    const identityId = draft.identityId || manifestId;
    const variantId = draft.variantId || manifestId;
    const revisionNumber = draft.revision || (job.target.baseRef?.revision || 0) + 1;
    const identity = {
        canonicalName: job.target.canonicalName || job.target.name || manifestId,
        category: job.target.category || 'other',
        kind: job.target.kind || 'generic',
        aliases: job.target.aliases || [],
    };
    const variant = {
        variantId,
        identityId,
        dims: job.target.dims || { state: 'unspecified' },
        headRevision: revisionNumber,
        headRevisionId: draft.revisionId || `${variantId}~r${revisionNumber}`,
        headContentHash: draft.contentHash,
    };
    const revisionRecord = {
        ...draft,
        revision: revisionNumber,
        revisionId: draft.revisionId || `${variantId}~r${revisionNumber}`,
        createdAt: draft.createdAt || 0,
    };
    const conversions = job.proposal?.conversions || [];
    const licenses = [
        ...new Set(Object.values(draft.sources || {})
            .map(s => s.permittedUse)
            .filter(Boolean)),
    ];
    const research = {
        jobIds: [job.jobId],
        passIds: job.passId ? [job.passId] : [],
        gaps: job.proposal?.gaps || {},
        licenses,
        reviewer: job.review?.reviewer || 'unknown',
        checklistVersion: job.review?.checklistVersion || 1,
    };
    return {
        identity,
        variant,
        revisions: [revisionRecord],
        conversions,
        research,
    };
}
export async function stageCatalog(jobs) {
    if (!Array.isArray(jobs)) {
        throw new TypeError('stageCatalog requires an array of approved jobs');
    }
    for (const job of jobs) {
        toCatalogRecord(job);
        const validation = await validateProposal(job);
        if (!validation.isValid || job.review?.approvedContentHash !== job.proposal.revisionDraft.contentHash)
            throw new TypeError('Staging requires valid reviewed content hash');
    }
    const records = jobs.map(toCatalogRecord);
    const variants = new Set();
    for (const record of records) {
        const id = record.variant.variantId;
        if (variants.has(id))
            throw new TypeError(`Duplicate variant conflict: ${id}; select one reviewed pass before staging`);
        variants.add(id);
    }
    // Deterministic order: sort records by variantId
    records.sort((a, b) => a.variant.variantId.localeCompare(b.variant.variantId));
    const { manifest, files } = await buildCatalogShards(records);
    return {
        manifest,
        files,
        records,
    };
}
