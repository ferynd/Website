import { canonicalJson, sha256Hex } from '../contentHash.js';
import { V2_KEYS } from '../nutrientRegistry.js';
import { normalizeVariantDims } from '../ingredientVariants.js';

export const RESEARCH_JOB_STATES = Object.freeze([
  'queued',
  'matched',
  'needs_review',
  'approved',
  'imported',
  'blocked',
]);

export const ALLOWED_TRANSITIONS = Object.freeze({
  queued: ['matched', 'blocked', 'queued'],
  matched: ['needs_review', 'blocked', 'queued'],
  needs_review: ['approved', 'blocked', 'queued'],
  approved: ['imported', 'blocked'],
  blocked: ['queued'],
  imported: [],
});

/**
 * Builds canonical job key v1.
 * Catalog jobs use targetKind: 'catalog' and manifestId.
 * Private jobs use targetKind: 'private', namespace, ownerUid, identityId, variantId.
 */
export function jobKeyV1({ targetKind, target, fields = '*', sourceRelease = 'unknown' }) {
  const normFields = Array.isArray(fields)
    ? [...new Set(fields)].sort().filter(f => V2_KEYS.includes(f))
    : '*';

  let normTarget;
  if (targetKind === 'catalog') {
    if (!target?.manifestId) throw new TypeError('Catalog target requires manifestId');
    normTarget = {
      targetKind: 'catalog',
      manifestId: String(target.manifestId),
    };
  } else if (targetKind === 'private') {
    if (!target?.identityId || !target?.variantId) {
      throw new TypeError('Private target requires identityId and variantId');
    }
    normTarget = {
      targetKind: 'private',
      namespace: String(target.namespace || 'default-app-id'),
      ownerUid: String(target.ownerUid || ''),
      identityId: String(target.identityId),
      variantId: String(target.variantId),
    };
  } else {
    throw new TypeError(`Unknown targetKind: ${targetKind}`);
  }

  return canonicalJson({
    targetKind,
    target: normTarget,
    fields: normFields,
    sourceRelease: String(sourceRelease),
  });
}

/** 24-hex sha256 prefix ID generators */
export async function jobIdFor(jobKey) {
  return 'rj-' + (await sha256Hex(jobKey)).slice(0, 24);
}

export async function parentBatchIdFor({ priority = 1, category = 'all', manifestIds = [] }) {
  const sorted = [...new Set(manifestIds)].sort();
  const payload = canonicalJson({
    priority: Number(priority),
    category: String(category),
    manifestIds: sorted,
  });
  return 'rb-' + (await sha256Hex(payload)).slice(0, 24);
}

export async function passIdFor({ parentBatchId, adapter, sourceRelease, purpose = 'population' }) {
  const payload = canonicalJson({
    parentBatchId: String(parentBatchId),
    adapter: String(adapter),
    sourceRelease: String(sourceRelease),
    purpose: String(purpose),
  });
  return 'rp-' + (await sha256Hex(payload)).slice(0, 24);
}

export function validateJob(job) {
  const errors = [];
  if (!job || typeof job !== 'object') return ['Invalid job: expected object'];

  if (job.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (typeof job.jobId !== 'string' || !job.jobId.startsWith('rj-') || job.jobId.length !== 27) {
    errors.push('jobId must be rj- followed by 24 hex chars');
  }

  if (!['curated', 'private'].includes(job.scope)) errors.push('Invalid job scope');
  if (job.scope === 'private') {
    if (!job.ownerUid || typeof job.ownerUid !== 'string') errors.push('Private job requires ownerUid');
  } else {
    if (job.ownerUid) errors.push('Curated job must not include ownerUid');
  }

  if (!RESEARCH_JOB_STATES.includes(job.state)) errors.push(`Invalid job state: ${job.state}`);
  if (!Number.isSafeInteger(job.version) || job.version < 1) errors.push('version must be a positive integer');

  if (!Array.isArray(job.attempts) || job.attempts.length > 10) {
    errors.push('attempts must be an array of at most 10 attempts');
  }

  if (job.state === 'blocked') {
    if (!job.blocked?.code || typeof job.blocked.code !== 'string') {
      errors.push('Blocked job must specify blocked.code');
    }
  }

  if (job.state === 'approved') {
    if (!job.review?.reviewer || !job.review?.approvedContentHash) {
      errors.push('Approved job must specify review.reviewer and review.approvedContentHash');
    }
  }

  return errors;
}

export function transition(job, nextState, updates = {}) {
  const allowed = ALLOWED_TRANSITIONS[job.state];
  if (!allowed || !allowed.includes(nextState)) {
    throw new Error(`Illegal job state transition from ${job.state} to ${nextState}`);
  }
  const nextVersion = (job.version || 1) + 1;
  const updated = {
    ...job,
    ...updates,
    state: nextState,
    version: nextVersion,
    updatedAt: updates.updatedAt || new Date().toISOString(),
  };

  const errors = validateJob(updated);
  if (errors.length) {
    throw new TypeError(`Invalid job after transition: ${errors.join('; ')}`);
  }
  return updated;
}

export async function createResearchJob({
  scope = 'curated',
  ownerUid,
  targetKind = 'catalog',
  target,
  fields = '*',
  sourceRelease = 'unknown',
  parentBatchId,
  passId,
  state = 'queued',
}) {
  const dims = normalizeVariantDims(target?.dims || {});
  const keyTarget = { ...target, dims };
  const key = jobKeyV1({ targetKind, target: keyTarget, fields, sourceRelease });
  const jobId = await jobIdFor(key);

  const job = {
    schemaVersion: 1,
    jobId,
    jobKey: key,
    parentBatchId: parentBatchId || undefined,
    passId: passId || undefined,
    scope,
    ownerUid: scope === 'private' ? ownerUid : undefined,
    target: {
      targetKind,
      manifestId: targetKind === 'catalog' ? target.manifestId : undefined,
      identityId: target.identityId || undefined,
      variantId: target.variantId || undefined,
      dims,
      baseRef: target.baseRef || null,
      sourceStrategy: target.sourceStrategy || undefined,
      kind: target.kind || undefined,
    },
    requestedFields: Array.isArray(fields) ? [...fields].sort() : '*',
    state,
    version: 1,
    attempts: [],
    nextAttemptAt: null,
    checkpoint: null,
    match: null,
    sourceEvidence: [],
    proposal: null,
    validation: null,
    review: null,
    blocked: null,
    staged: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const errors = validateJob(job);
  if (errors.length) {
    throw new TypeError(`Invalid job creation: ${errors.join('; ')}`);
  }
  return job;
}
