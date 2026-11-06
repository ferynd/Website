import { emptyStagedRecord, toV2Fields } from '../nutrientRegistry.js';
import { buildRevisionDraft } from '../ingredientProfile.js';
import { buildConversion } from '../ingredientConversion.js';
import { CURATED_CATALOG_ID } from '../ingredientIds.js';
import { PermanentSourceError } from './fdcFood.js';
import { normalizeSourceResult } from './sourceResult.js';
import { validateProposal } from './researchValidator.js';
import { buildRevisionDiff, applyReviewDecision } from './researchReview.js';
import {
  jobKeyV1,
  createResearchJob,
  transition,
  validateJob,
  parentBatchIdFor,
  passIdFor
} from './researchJob.js';

export function createResearchService({
  store,
  sourceCache,
  adapters = [],
  now = () => Date.now(),
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  random = () => Math.random(),
  retry: retryConfig = { maxAttempts: 3, baseMs: 1000, maxMs: 30000 },
} = {}) {
  const adapterMap = new Map();
  for (const a of adapters) {
    adapterMap.set(a.id, a);
  }

  const { maxAttempts = 3, baseMs = 1000, maxMs = 30000 } = retryConfig;

  async function enqueue({
    scope = 'curated',
    ownerUid,
    targetKind = 'catalog',
    target,
    fields = '*',
    sourceRelease = 'unknown',
    parentBatchId,
    passId,
  }) {
    const key = jobKeyV1({ targetKind, target, fields, sourceRelease });
    const existing = await store.getByKey(key);
    if (existing) {
      return existing;
    }

    const job = await createResearchJob({
      scope,
      ownerUid,
      targetKind,
      target,
      fields,
      sourceRelease,
      parentBatchId,
      passId,
    });

    await store.save(job);
    return job;
  }

  async function runJob(jobId, { signal, passId } = {}) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    let job = await store.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    // Terminal or awaiting review states: do not re-run
    if (['needs_review', 'approved', 'imported', 'blocked'].includes(job.state)) {
      return job;
    }

    // Determine adapter
    let adapterId = job.match?.sourceAdapter;
    if (!adapterId) {
      if (job.target?.sourceStrategy === 'compound-reference') {
        adapterId = 'manual';
      } else if (job.target?.kind === 'branded') {
        adapterId = 'label';
      } else {
        adapterId = 'fdc_bulk';
      }
    }

    // Normalize fdc_bulk or fdc_api to fdc if needed
    let adapter = adapterMap.get(adapterId);
    if (!adapter && (adapterId === 'fdc_bulk' || adapterId === 'fdc_api')) {
      adapter = adapterMap.get('fdc') || adapterMap.get('fdc_bulk') || adapterMap.get('fdc_api');
    }

    if (!adapter) {
      job = transition(job, 'blocked', {
        blocked: {
          code: 'no_adapter_available',
          needs: `No registered adapter for id ${adapterId}`,
        },
      });
      await store.save(job, { expectedVersion: job.version - 1 });
      return job;
    }

    // Step 1: Matching
    if (job.state === 'queued') {
      if (!job.match) {
        try {
          const matchResult = await adapter.match(job.target);
          if (!matchResult) {
            job = transition(job, 'blocked', {
              blocked: {
                code: 'match_not_found',
                needs: 'Manual match review or entry into source match table required',
              },
            });
            await store.save(job, { expectedVersion: job.version - 1 });
            return job;
          }
          job.match = matchResult;
        } catch (err) {
          job = transition(job, 'blocked', {
            blocked: {
              code: 'match_error',
              needs: err.message,
            },
          });
          await store.save(job, { expectedVersion: job.version - 1 });
          return job;
        }
      }

      job = transition(job, 'matched', {
        checkpoint: { step: 'matched' },
      });
      await store.save(job, { expectedVersion: job.version - 1 });
    }

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // Step 2: Fetch and normalization
    if (job.state === 'matched') {
      const sourceId = job.match.sourceId || job.target.manifestId;
      const release = job.match.sourceRelease || (await adapter.release()) || 'unknown';
      const cacheKey = `${adapter.id}:${release}:${sourceId}`;

      let cachedEntry;
      let attemptOutcome = 'success';
      let attemptError = null;

      try {
        cachedEntry = await sourceCache.getOrFetch(cacheKey, async () => {
          return await adapter.fetch(sourceId, { scope: job.scope });
        });
      } catch (err) {
        attemptError = err;
        const isPermanent =
          err instanceof PermanentSourceError ||
          err.name === 'PermanentSourceError' ||
          err.isPermanent;

        if (isPermanent) {
          attemptOutcome = 'blocked';
          job.attempts.push({
            attemptId: `att-${job.attempts.length + 1}`,
            passId: passId || job.passId,
            adapter: adapter.id,
            outcome: 'blocked',
            errorCode: err.message,
            timestamp: new Date(now()).toISOString(),
          });
          job = transition(job, 'blocked', {
            blocked: {
              code: 'source_permanent_error',
              needs: err.message,
            },
          });
          await store.save(job, { expectedVersion: job.version - 1 });
          return job;
        }

        // Temporary error handling
        const currentAttempts = job.attempts.length;
        if (currentAttempts + 1 >= maxAttempts) {
          job.attempts.push({
            attemptId: `att-${currentAttempts + 1}`,
            passId: passId || job.passId,
            adapter: adapter.id,
            outcome: 'blocked',
            errorCode: err.message,
            timestamp: new Date(now()).toISOString(),
          });
          job = transition(job, 'blocked', {
            blocked: {
              code: 'retries_exhausted',
              needs: `Exhausted ${maxAttempts} retry attempts: ${err.message}`,
            },
          });
          await store.save(job, { expectedVersion: job.version - 1 });
          return job;
        }

        // Schedule retry
        const backoffMs = Math.min(maxMs, baseMs * Math.pow(2, currentAttempts));
        const nextAttemptAt = new Date(now() + backoffMs).toISOString();

        job.attempts.push({
          attemptId: `att-${currentAttempts + 1}`,
          passId: passId || job.passId,
          adapter: adapter.id,
          outcome: 'retry',
          errorCode: err.message,
          timestamp: new Date(now()).toISOString(),
        });
        job.nextAttemptAt = nextAttemptAt;
        job.version += 1;
        await store.save(job, { expectedVersion: job.version - 1 });

        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        await sleep(backoffMs);
        return runJob(jobId, { signal, passId });
      }

      // Convert cached source data to SourceResult
      const sourceResult = await adapter.toSourceResult(cachedEntry.data, { scope: job.scope });
      const proposal = normalizeSourceResult(sourceResult, job.target);

      // Determine identityId and variantId (D6: catalog identityId and variantId both equal manifestId)
      let identityId = job.target.identityId;
      let variantId = job.target.variantId;
      if (job.scope === 'curated' || job.target.targetKind === 'catalog') {
        identityId = identityId || job.target.manifestId;
        variantId = variantId || job.target.manifestId;
      }

      // Staged record for buildRevisionDraft
      const stagedRecord = emptyStagedRecord();
      stagedRecord.values = proposal.nutrients;
      stagedRecord.quality = proposal.nutrientMeta.quality;

      const revisionDraft = await buildRevisionDraft({
        identityId,
        variantId,
        stagedRecord,
        fieldProvenance: proposal.fieldProvenance,
        sources: proposal.sources,
        basis: {
          kind: 'per_100g_edible',
          state: job.target.dims?.state || 'unspecified',
        },
        basedOn: job.target.baseRef || null,
      });

      proposal.revisionDraft = revisionDraft;
      proposal.diff = buildRevisionDiff(null, revisionDraft);

      // Attach variantRef to portion conversions
      const variantRef = {
        refVersion: 1,
        scope: job.scope,
        namespace: job.scope === 'curated' ? 'catalog:' + CURATED_CATALOG_ID : (job.target.namespace || 'default-app-id'),
        identityId,
        variantId,
        revision: 1,
        revisionId: `${variantId}~r1`,
        contentHash: revisionDraft.contentHash,
      };

      const conversions = [];
      for (const conv of proposal.conversions || []) {
        try {
          const fullConv = await buildConversion({
            ...conv,
            variantRef,
          });
          conversions.push(fullConv);
        } catch {
          // If conversion fails building, preserve as-is for validator to inspect
          conversions.push({ ...conv, variantRef });
        }
      }
      proposal.conversions = conversions;

      // Validate proposal
      const validation = await validateProposal({
        ...job,
        proposal,
      });

      job.attempts.push({
        attemptId: `att-${job.attempts.length + 1}`,
        passId: passId || job.passId,
        adapter: adapter.id,
        outcome: 'success',
        timestamp: new Date(now()).toISOString(),
      });

      job = transition(job, 'needs_review', {
        proposal,
        validation,
        checkpoint: {
          step: 'proposal_ready',
          sourceCacheKeys: [cacheKey],
        },
        sourceEvidence: [
          {
            cacheKey,
            checksum: cachedEntry.checksum,
            license: sourceResult.sourceRecord?.permittedUse || sourceResult.permittedUse || 'public',
          },
        ],
      });

      await store.save(job, { expectedVersion: job.version - 1 });
    }

    return job;
  }

  async function runBatch(batchId, { signal } = {}) {
    const jobs = await store.listByBatch(batchId);

    // Sort order: priority, category, jobId
    jobs.sort((a, b) => {
      const pA = a.target?.priority ?? 999;
      const pB = b.target?.priority ?? 999;
      if (pA !== pB) return pA - pB;
      const cA = a.target?.category || '';
      const cB = b.target?.category || '';
      if (cA !== cB) return cA.localeCompare(cB);
      return a.jobId.localeCompare(b.jobId);
    });

    const results = [];
    for (const j of jobs) {
      if (signal?.aborted) break;
      const res = await runJob(j.jobId, { signal, passId: j.passId });
      results.push(res);
    }

    return {
      batchId,
      total: jobs.length,
      processed: results.length,
      completed: results.filter(r => r.state === 'needs_review' || r.state === 'approved').length,
      blocked: results.filter(r => r.state === 'blocked').length,
      items: results,
    };
  }

  async function review(jobId, decision) {
    const job = await store.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    const updated = applyReviewDecision(job, decision);
    await store.save(updated, { expectedVersion: job.version - 1 });
    return updated;
  }

  async function report(batchId) {
    const jobs = await store.listByBatch(batchId);
    const summary = {
      batchId,
      total: jobs.length,
      queued: 0,
      matched: 0,
      needs_review: 0,
      approved: 0,
      imported: 0,
      blocked: 0,
    };

    for (const j of jobs) {
      if (summary[j.state] !== undefined) {
        summary[j.state]++;
      }
    }

    return summary;
  }

  return {
    enqueue,
    runJob,
    runBatch,
    review,
    report,
  };
}
