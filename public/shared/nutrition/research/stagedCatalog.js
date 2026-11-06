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

  const identity = {
    canonicalName: job.target.canonicalName || job.target.name || manifestId,
    category: job.target.category || 'other',
    kind: job.target.kind || 'food',
    aliases: job.target.aliases || [],
  };

  const variant = {
    variantId,
    identityId,
    dims: job.target.dims || { state: 'unspecified' },
    headRevision: draft.revision || 1,
    headRevisionId: draft.revisionId || `${variantId}~r1`,
    headContentHash: draft.contentHash,
  };

  const revisionRecord = {
    ...draft,
    revision: draft.revision || 1,
    revisionId: draft.revisionId || `${variantId}~r1`,
    createdAt: draft.createdAt || 0,
  };

  const conversions = job.proposal?.conversions || [];

  const licenses = [
    ...new Set(
      Object.values(draft.sources || {})
        .map(s => s.permittedUse)
        .filter(Boolean)
    ),
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

  const records = jobs.map(toCatalogRecord);

  // Deterministic order: sort records by variantId
  records.sort((a, b) => a.variant.variantId.localeCompare(b.variant.variantId));

  const { manifest, files } = await buildCatalogShards(records);

  return {
    manifest,
    files,
    records,
  };
}
