import { assertCuratedMatchTable, publishedIdentityFor, reviewContentHash } from './researchReview.js';
import { validateProposal } from './researchValidator.js';
import { buildCatalogShards } from '../ingredientCatalog.js';
const REVIEWER_HANDLE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
// Names such as "Private Selection" are not private data. Licenses still are.
const SECRET_TEXT = /\brestricted\b|\bconfidential\b|\bblob:|\bdata:|\bfile:|\/users\/|\\users\\|\/home\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const SECRET_LICENSE = /\bprivate\b|\brestricted\b|\bconfidential\b/i;
function hasPrivatePayload(value) {
    if (!value || typeof value !== 'object')
        return false;
    if (Array.isArray(value))
        return value.some(hasPrivatePayload);
    for (const [key, child] of Object.entries(value)) {
        if (key === 'ownerUid' && child)
            return true;
        if (hasPrivatePayload(child))
            return true;
    }
    return false;
}
function collectStrings(value, out) {
    if (typeof value === 'string') {
        out.push(value);
        return;
    }
    if (!value || typeof value !== 'object')
        return;
    if (Array.isArray(value)) {
        for (const child of value)
            collectStrings(child, out);
        return;
    }
    // Keys are published too (for example revision.sources ids), so scan them with the values.
    for (const [key, child] of Object.entries(value)) {
        out.push(key);
        collectStrings(child, out);
    }
}
function licenseTexts(record) {
    const texts = [];
    collectStrings(record.research?.licenses, texts);
    for (const revision of record.revisions || [])
        for (const source of Object.values(revision.sources || {}))
            if (source && typeof source.permittedUse === 'string')
                texts.push(source.permittedUse);
    for (const conversion of record.conversions || [])
        if (typeof conversion?.source?.permittedUse === 'string')
            texts.push(conversion.source.permittedUse);
    return texts;
}
function hasPrivateMaterial(record) {
    if (hasPrivatePayload(record))
        return true;
    const texts = [];
    collectStrings(record, texts);
    // Free text uses the targeted patterns only. The bare word private stays a license check,
    // so a brand such as Private Selection can be published.
    if (texts.some(text => SECRET_TEXT.test(text)))
        return true;
    return licenseTexts(record).some(text => SECRET_LICENSE.test(text));
}
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
    if (job.ownerUid || job.target?.ownerUid)
        throw new TypeError('Curated staging refuses private data');
    if (job.proposal?.assistantResult && job.proposal.assistantResult.sources.some(s => {
        const verification = job.proposal.sourceVerification?.[s.sourceId];
        return verification?.status !== 'verified' || verification?.method !== 'deterministic_refetch';
    }))
        throw new TypeError('Curated staging requires deterministic refetch');
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
    const published = publishedIdentityFor(job);
    const identity = {
        canonicalName: published.canonicalName,
        category: published.category,
        kind: published.kind,
        aliases: published.aliases,
    };
    const variant = {
        variantId,
        identityId,
        dims: published.dims,
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
    const rawReviewer = typeof job.review?.reviewer === 'string' ? job.review.reviewer.trim() : '';
    if (rawReviewer && !REVIEWER_HANDLE.test(rawReviewer))
        throw new TypeError('Curated staging requires a reviewer handle');
    const reviewer = rawReviewer || 'unknown';
    const research = {
        jobIds: [job.jobId],
        passIds: job.passId ? [job.passId] : [],
        gaps: job.proposal?.gaps || {},
        licenses,
        reviewer,
        checklistVersion: job.review?.checklistVersion || 1,
    };
    const record = {
        identity,
        variant,
        revisions: [revisionRecord],
        conversions,
        research,
    };
    if (hasPrivateMaterial(record))
        throw new TypeError('Curated staging refuses private data');
    return record;
}
export async function stageCatalog(jobs, { matches = [] } = {}) {
    if (!Array.isArray(jobs)) {
        throw new TypeError('stageCatalog requires an array of approved jobs');
    }
    for (const job of jobs) {
        // Staging is the last choke point, so it re-checks the reviewed match table itself.
        assertCuratedMatchTable(job, matches);
        toCatalogRecord(job);
        const validation = await validateProposal(job);
        if (!validation.isValid || job.review?.approvedContentHash !== await reviewContentHash(job))
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
