import { publishedIdentityFor, reviewContentHash } from './researchReview.js';
import { validateProposal } from './researchValidator.js';
import { buildCatalogShards } from '../ingredientCatalog.js';
const REVIEWER_HANDLE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
// Names such as "Private Selection" are not private data. Licenses still are.
const SECRET_TEXT = /\brestricted\b|\bconfidential\b|\bblob:|\bdata:|\/users\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
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
function asStrings(value) {
    if (typeof value === 'string')
        return [value];
    if (Array.isArray(value))
        return value.flatMap(asStrings);
    return [];
}
function sourceLeaks(source) {
    if (!source || typeof source !== 'object')
        return false;
    if (typeof source.permittedUse === 'string' && SECRET_LICENSE.test(source.permittedUse))
        return true;
    return [source.title, source.url, source.recordId].some(text => typeof text === 'string' && SECRET_TEXT.test(text));
}
function hasPrivateMaterial(record) {
    if (hasPrivatePayload(record))
        return true;
    const published = [
        ...asStrings(record.identity?.canonicalName),
        ...asStrings(record.identity?.aliases),
        ...asStrings(Object.values(record.research?.gaps || {})),
    ];
    if (published.some(text => SECRET_TEXT.test(text)))
        return true;
    if (asStrings(record.research?.licenses).some(text => SECRET_LICENSE.test(text)))
        return true;
    for (const revision of record.revisions || []) {
        if (Object.values(revision.sources || {}).some(sourceLeaks))
            return true;
    }
    return (record.conversions || []).some(conversion => sourceLeaks(conversion?.source));
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
export async function stageCatalog(jobs) {
    if (!Array.isArray(jobs)) {
        throw new TypeError('stageCatalog requires an array of approved jobs');
    }
    for (const job of jobs) {
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
