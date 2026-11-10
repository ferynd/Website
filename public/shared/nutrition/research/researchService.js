import { createAssistantPacketAdapter } from './assistantPacketAdapter.js';
import { PACKET_LIMITS } from './researchPacket.js';
import { packetProposal } from './packetProposal.js';
import { canonicalJson, contentHashOf } from '../contentHash.js';
import { emptyStagedRecord } from '../nutrientRegistry.js';
import { buildRevisionDraft, revisionToStagedRecord } from '../ingredientProfile.js';
import { buildConversion } from '../ingredientConversion.js';
import { CURATED_CATALOG_ID } from '../ingredientIds.js';
import { PermanentSourceError } from './fdcFood.js';
import { applyStagedConventions, normalizeSourceResult } from './sourceResult.js';
import { validateProposal } from './researchValidator.js';
import { buildRevisionDiff, applyReviewDecision, verifiedRecordMatchesTable } from './researchReview.js';
import { jobKeyV1, createResearchJob, transition, passIdFor } from './researchJob.js';
function citedObservation({ value, status, upperBound, roundingInterval, qualifier, derivation }) {
    const observation = { value: value ?? null, status: status ?? null };
    if (upperBound != null)
        observation.upperBound = upperBound;
    if (roundingInterval != null)
        observation.roundingInterval = roundingInterval;
    if (qualifier)
        observation.qualifier = qualifier;
    if (derivation)
        observation.derivation = derivation;
    return observation;
}
function adapterObservation(normalized, key) {
    const quality = normalized.nutrientMeta?.quality?.[key] || {};
    const provenance = normalized.fieldProvenance?.[key] || {};
    return citedObservation({
        value: normalized.nutrients?.[key],
        status: quality.status,
        upperBound: quality.upperBound,
        roundingInterval: quality.roundingInterval,
        qualifier: quality.qualifier,
        derivation: provenance.derivation,
    });
}
function sameRange(left, right) {
    const range = value => value == null ? null : { min: value.min, max: value.max };
    return canonicalJson(range(left)) === canonicalJson(range(right));
}
function citesSource(conversion, sourceId) {
    return Array.isArray(conversion?.sourceIds) && conversion.sourceIds.includes(sourceId);
}
/** Gap text published with a verified observation. A real measurement or limit of quantification clears the gap. */
function gapFromWrittenObservation(quality, value) {
    if (!quality)
        return 'not_reported_by_source';
    if (quality.status === 'below_quantification_limit' || quality.status === 'not_applicable')
        return null;
    if (value != null && quality.status !== 'unknown')
        return null;
    if (typeof quality.qualifier === 'string' && quality.qualifier.startsWith('gap:'))
        return quality.qualifier.slice(4);
    if (quality.status === 'unknown' || value == null)
        return 'not_reported_by_source';
    return null;
}
export function createResearchService({ store, sourceCache, adapters = [], now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), random = () => Math.random(), retry: retryConfig = { maxAttempts: 3, baseMs: 1000, maxMs: 30000 }, } = {}) {
    const adapterMap = new Map();
    for (const a of adapters) {
        adapterMap.set(a.id, a);
    }
    const { maxAttempts = 3, baseMs = 1000, maxMs = 30000 } = retryConfig;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 || baseMs < 0 || maxMs < baseMs)
        throw new TypeError('Invalid retry limits');
    async function enqueue({ scope = 'curated', ownerUid, targetKind = 'catalog', target, fields = '*', sourceRelease = 'unknown', parentBatchId, passId, }) {
        const key = jobKeyV1({ targetKind, target: { ...target, ownerUid: ownerUid || target.ownerUid }, fields, sourceRelease });
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
        try {
            await store.save(job, { expectedVersion: 0 });
        }
        catch (error) {
            const concurrent = await store.getByKey(key);
            if (concurrent)
                return concurrent;
            throw error;
        }
        return job;
    }
    async function retryJob(jobId) {
        const job = await store.get(jobId);
        if (job?.state !== 'blocked')
            throw new TypeError('Retry requires a blocked job');
        const updated = transition(job, 'queued', {
            blocked: null, match: null, proposal: null, validation: null, review: null,
            checkpoint: null, nextAttemptAt: null, attempts: [], sourceEvidence: [],
            pendingRequest: null, staged: null,
        });
        await store.save(updated, { expectedVersion: job.version });
        return updated;
    }
    async function runJob(jobId, { signal, passId, context = {}, adapterId: chosenAdapter } = {}) {
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
        let job = await store.get(jobId);
        if (!job)
            throw new Error(`Job not found: ${jobId}`);
        if (job.state === 'awaiting_response' && Date.parse(job.pendingRequest.expiresAt) <= now()) {
            await cancelRequest(job.pendingRequest.requestId, { expiredOnly: true });
            return store.get(jobId);
        }
        // Terminal or awaiting review states: do not re-run
        if (['awaiting_response', 'needs_review', 'approved', 'imported', 'blocked'].includes(job.state)) {
            return job;
        }
        if (job.state === 'matched' && job.proposal)
            return job;
        if (job.nextAttemptAt) {
            const delay = Date.parse(job.nextAttemptAt) - now();
            if (delay > 0)
                await sleep(Math.min(maxMs, delay));
            if (signal?.aborted)
                throw new DOMException('Aborted', 'AbortError');
            job.nextAttemptAt = null;
        }
        // Determine adapter
        let adapterId = chosenAdapter || job.match?.sourceAdapter;
        if (!adapterId) {
            if (job.target?.sourceStrategy === 'compound-reference') {
                adapterId = 'manual';
            }
            else if (job.target?.kind === 'branded') {
                adapterId = 'label';
            }
            else {
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
                    const matchResult = await adapter.match(job.target, context);
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
                }
                catch (err) {
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
                // The adapter receives the same release as the cache key, so a
                // multi-release adapter fetches and stamps this job's release.
                cachedEntry = await sourceCache.getOrFetch(cacheKey, async () => {
                    return await adapter.fetch(sourceId, { ...context, scope: job.scope, release });
                });
            }
            catch (err) {
                attemptError = err;
                const isPermanent = err instanceof PermanentSourceError ||
                    err.name === 'PermanentSourceError' ||
                    err.isPermanent;
                if (isPermanent) {
                    attemptOutcome = 'blocked';
                    job.attempts.push({
                        attemptId: `att-${job.attempts.length + 1}`,
                        passId: passId || job.passId,
                        adapter: adapter.id,
                        release,
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
                        release,
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
                const backoffMs = Math.min(maxMs, Math.max(baseMs * Math.pow(2, currentAttempts) * (0.75 + random() * 0.5), attemptError.retryAfterMs || 0));
                const nextAttemptAt = new Date(now() + backoffMs).toISOString();
                job.attempts.push({
                    attemptId: `att-${currentAttempts + 1}`,
                    passId: passId || job.passId,
                    adapter: adapter.id,
                    release,
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
                return runJob(jobId, { signal, passId, context, adapterId: chosenAdapter });
            }
            // Convert cached source data to SourceResult
            let sourceResult;
            try {
                sourceResult = await adapter.toSourceResult(cachedEntry.data, { ...context, scope: job.scope, release });
                // A reviewed bulk match names its pinned release; a bulk result stamped
                // with another release is refused. (fdc_api stamps the live record's own
                // dataType@publicationDate, a different vocabulary, and is unchanged.)
                if (adapter.id === 'fdc_bulk' && job.match?.sourceRelease && sourceResult?.release != null && String(sourceResult.release) !== String(job.match.sourceRelease))
                    throw new Error(`Source result release ${sourceResult.release} differs from the matched release ${release}`);
            }
            catch (error) {
                job = transition(job, 'blocked', { blocked: { code: 'source_malformed', needs: error.message } });
                await store.save(job, { expectedVersion: job.version - 1 });
                return job;
            }
            if (sourceResult.existingRevision) {
                // needs_review, not matched: a matched proposal is never run again,
                // so a reused profile would be stuck before anyone could review it.
                job = transition(job, 'needs_review', {
                    proposal: { revisionDraft: sourceResult.existingRevision, reused: true, conversions: [] },
                    checkpoint: { step: 'curated_reused' },
                });
                await store.save(job, { expectedVersion: job.version - 1 });
                return job;
            }
            const proposal = normalizeSourceResult(sourceResult, { ...job.target, requestedFields: job.requestedFields });
            // Determine identityId and variantId (D6: catalog identityId and variantId both equal manifestId)
            let identityId = job.target.identityId;
            let variantId = job.target.variantId;
            if (job.scope === 'curated' || job.target.targetKind === 'catalog') {
                identityId = identityId || job.target.manifestId;
                variantId = variantId || job.target.manifestId;
            }
            // Seed a field-limited pass from the stored revision, then overlay only
            // the requested fields. A first pass still keeps the normalizer's
            // explicit unknown gaps; sparse revision storage drops a bare unknown.
            const base = job.target.baseRevision || null;
            const requested = job.requestedFields === '*' ? Object.keys(proposal.nutrients) : job.requestedFields;
            // Keep the base's evidence intact, even when both passes use the same
            // adapter source key for different records/releases.
            if (base?.sources?.[proposal.sourceKey] && canonicalJson(base.sources[proposal.sourceKey]) !== canonicalJson(proposal.sourceRecord)) {
                const oldKey = proposal.sourceKey;
                proposal.sourceKey = oldKey + ':' + await contentHashOf(proposal.sourceRecord);
                proposal.sources = { [proposal.sourceKey]: proposal.sourceRecord };
                for (const evidence of Object.values(proposal.fieldProvenance))
                    if (evidence.sourceKey === oldKey) evidence.sourceKey = proposal.sourceKey;
            }
            const stagedRecord = base ? revisionToStagedRecord(base) : emptyStagedRecord();
            const fieldProvenance = { ...(base?.fieldProvenance || {}) };
            if (base) {
                for (const key of requested) {
                    stagedRecord.values[key] = proposal.nutrients[key];
                    stagedRecord.quality[key] = proposal.nutrientMeta.quality[key];
                    delete fieldProvenance[key];
                    if (proposal.fieldProvenance[key])
                        fieldProvenance[key] = proposal.fieldProvenance[key];
                }
            }
            else {
                stagedRecord.values = { ...proposal.nutrients };
                stagedRecord.quality = { ...proposal.nutrientMeta.quality };
                Object.assign(fieldProvenance, proposal.fieldProvenance);
            }
            for (const key of Object.keys(stagedRecord.values)) {
                const quality = stagedRecord.quality[key];
                const bareUnknown = !quality?.status || (quality.status === 'unknown' && quality.roundingInterval == null && quality.upperBound == null && !quality.qualifier);
                if (bareUnknown)
                    stagedRecord.quality[key] = proposal.nutrientMeta.quality?.[key]?.qualifier ? proposal.nutrientMeta.quality[key] : { status: 'unknown', qualifier: 'gap:not_requested' };
            }
            applyStagedConventions(stagedRecord, proposal.nutrientMeta, {
                base,
                requested: job.requestedFields,
                explicit: proposal.conventionOverrides,
            });
            delete proposal.conventionOverrides;
            proposal.sources = { ...(base?.sources || {}), ...proposal.sources };
            proposal.fieldProvenance = fieldProvenance;
            proposal.nutrients = stagedRecord.values;
            proposal.nutrientMeta.quality = stagedRecord.quality;
            proposal.gaps = Object.fromEntries(Object.entries(proposal.gaps).filter(([key]) => requested.includes(key)));
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
                base: job.target.baseRevision || null,
            });
            proposal.revisionDraft = revisionDraft;
            // Attach variantRef to portion conversions
            const variantRef = {
                refVersion: 1,
                scope: job.scope,
                namespace: job.scope === 'curated' ? 'catalog:' + CURATED_CATALOG_ID : (job.target.namespace || 'default-app-id'),
                identityId,
                variantId,
                revision: (job.target.baseRef?.revision || 0) + 1,
                revisionId: `${variantId}~r${(job.target.baseRef?.revision || 0) + 1}`,
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
                }
                catch {
                    // If conversion fails building, preserve as-is for validator to inspect
                    conversions.push({ ...conv, variantRef });
                }
            }
            proposal.conversions = conversions;
            proposal.diff = buildRevisionDiff(base, revisionDraft, conversions);
            // Validate proposal
            const validation = await validateProposal({
                ...job,
                proposal,
            });
            job.attempts.push({
                attemptId: `att-${job.attempts.length + 1}`,
                passId: passId || job.passId,
                adapter: adapter.id,
                release,
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
            if (pA !== pB)
                return pA - pB;
            const cA = a.target?.category || '';
            const cB = b.target?.category || '';
            if (cA !== cB)
                return cA.localeCompare(cB);
            return a.jobId.localeCompare(b.jobId);
        });
        const results = [];
        for (const j of jobs) {
            if (signal?.aborted)
                break;
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
    async function saveGroup(updated, previous) {
        if (store.saveMany)
            return store.saveMany(updated.map((job, i) => ({ job, expectedVersion: previous[i].version })));
        if (updated.length > 1)
            throw new Error('Store must support atomic saveMany for packet groups');
        if (updated.length)
            await store.save(updated[0], { expectedVersion: previous[0].version });
    }
    async function prepareRequest(jobIds, options = {}) {
        const jobs = await Promise.all(jobIds.map(id => store.get(id)));
        if (jobs.some(j => !j))
            throw new Error('Unknown job');
        if (new Set(jobIds).size !== jobIds.length)
            throw new TypeError('Duplicate target');
        const adapter = adapterMap.get('assistant-packet') || createAssistantPacketAdapter();
        const batches = new Map();
        for (const job of jobs) {
            const batch = job.parentBatchId || 'single';
            if (!batches.has(batch)) batches.set(batch, []);
            batches.get(batch).push(job);
        }
        const requests = [];
        for (const batch of [...batches.keys()].sort())
            requests.push(...await adapter.prepareRequest(batches.get(batch), { ...options, now }));
        const updated = [];
        for (const request of requests) {
            const parentBatchId = jobs.find(j => j.jobId === request.targets[0].targetId).parentBatchId || 'single';
            const passId = await passIdFor({ parentBatchId, adapter: adapter.id, sourceRelease: request.requestId, purpose: request.purpose });
            for (const target of request.targets) {
                const job = jobs.find(j => j.jobId === target.targetId);
                const pendingRequest = { requestId: request.requestId, requestDigest: request.requestDigest, passId, status: 'pending', expiresAt: new Date(now() + (options.limits?.ttlMs || PACKET_LIMITS.ttlMs)).toISOString(), baseRef: job.target.baseRef || null, request };
                updated.push(transition(job, 'awaiting_response', { pendingRequest, requests: [...(job.requests || []), { requestId: request.requestId, requestDigest: request.requestDigest, passId, status: 'pending' }], passId }));
            }
        }
        await saveGroup(updated, updated.map(j => jobs.find(old => old.jobId === j.jobId)));
        return requests;
    }
    async function acceptResponse(input, options = {}) {
        let echo;
        try {
            echo = typeof input === 'string' ? JSON.parse(input) : input;
        }
        catch {
            throw new TypeError('$: strict JSON required');
        }
        let jobs = [];
        let cursor;
        do {
            const page = await store.list({ limit: 100, cursor });
            jobs.push(...page.items);
            cursor = page.cursor;
        } while (cursor);
        const first = jobs.find(j => j.pendingRequest?.requestId === echo.requestId);
        if (!first)
            throw new TypeError('$.requestId: unknown or stale request');
        const request = first.pendingRequest.request;
        const adapter = adapterMap.get('assistant-packet') || createAssistantPacketAdapter();
        const response = await adapter.acceptResponse(input, { ...options, request, jobs, now: now() });
        const previous = [], updated = [];
        for (const result of response.results) {
            const job = jobs.find(j => j.jobId === result.targetId), proposal = await packetProposal(job, result);
            const validation = await validateProposal({ ...job, proposal });
            previous.push(job);
            updated.push(transition(job, 'needs_review', { proposal, validation, pendingRequest: { ...job.pendingRequest, status: 'answered' }, requests: job.requests.map(r => r.requestId === request.requestId ? { ...r, status: 'answered' } : r) }));
        }
        await saveGroup(updated, previous);
        return updated;
    }
    async function cancelRequest(requestId, { expiredOnly = false } = {}) {
        const previous = [];
        let cursor;
        do {
            const page = await store.list({ state: 'awaiting_response', limit: 100, cursor });
            previous.push(...page.items.filter(j => j.pendingRequest.requestId === requestId));
            cursor = page.cursor;
        } while (cursor);
        if (expiredOnly && previous.some(j => Date.parse(j.pendingRequest.expiresAt) > now()))
            return [];
        const updated = previous.map(job => transition(job, 'queued', { pendingRequest: null, requests: job.requests.map(r => r.requestId === requestId ? { ...r, status: expiredOnly ? 'expired' : 'cancelled' } : r) }));
        await saveGroup(updated, previous);
        return updated;
    }
    async function attestSource(jobId, sourceId, reviewer) {
        const job = await store.get(jobId);
        if (job?.state !== 'needs_review' || !job.proposal?.sourceVerification?.[sourceId] || !reviewer?.trim())
            throw new TypeError('Specific source and reviewer required');
        if (job.scope === 'curated')
            throw new TypeError('Curated sources require deterministic refetch');
        const proposal = structuredClone(job.proposal);
        proposal.sourceVerification[sourceId] = { status: 'verified', method: 'reviewer_attestation', reviewer, verifiedAt: new Date(now()).toISOString() };
        const updated = { ...job, proposal, version: job.version + 1 };
        await store.save(updated, { expectedVersion: job.version });
        return updated;
    }
    async function verifySource(jobId, sourceId, adapterId, context = {}) {
        const job = await store.get(jobId), source = job?.proposal?.revisionDraft?.sources?.[job.proposal.assistantSourceKeys?.[sourceId] || sourceId], adapter = adapterMap.get(adapterId);
        if (job?.state !== 'needs_review' || !job.proposal?.assistantResult || source?.type !== 'fdc' || !source.recordId || !adapter || !['fdc_bulk', 'fdc_api'].includes(adapter.id))
            throw new TypeError('Deterministic FDC verification required');
        async function mismatch(message) {
            const proposal = structuredClone(job.proposal);
            proposal.sourceVerification[sourceId] = { status: 'unverified', reason: message };
            await store.save({ ...job, proposal, version: job.version + 1 }, { expectedVersion: job.version });
            throw new TypeError(message);
        }
        const matches = Array.isArray(context.matches) ? context.matches : [];
        const adapterContext = { ...context };
        delete adapterContext.matches;
        const raw = await adapter.fetch(source.recordId, adapterContext), result = await adapter.toSourceResult(raw, adapterContext), normalized = normalizeSourceResult(result, job.target);
        if (String(result.recordId) !== source.recordId)
            await mismatch('Source record changed');
        const cited = Object.entries(job.proposal.assistantResult.nutrients).filter(([, n]) => n.sourceIds.includes(sourceId));
        for (const [key, n] of cited)
            if (canonicalJson(adapterObservation(normalized, key)) !== canonicalJson(citedObservation(n)))
                await mismatch('Source observation mismatch: ' + key);
        // Packet weights describe one unit. FDC portions may describe several;
        // compare grams per unit and ranges, and refuse unexpressed portion qualifiers.
        for (const c of job.proposal.assistantResult.conversions) {
            if (!citesSource(c, sourceId)) continue;
            const portions = normalized.conversions.filter(p => p.unit === c.unit && p.state === c.state && !p.unitQualifier);
            if (!portions.length || portions.some(p => !Number.isFinite(p.grams / p.amount) || Math.abs(p.grams / p.amount - c.grams) > 1e-6 || !sameRange(p.range, c.range)))
                await mismatch('Source conversion mismatch: ' + c.unit);
        }
        const verifiedRecord = {
            recordId: String(result.recordId || source.recordId || ''),
            description: String(result.description || result.title || normalized.sourceRecord?.title || '').trim(),
            // The release and dataType the record is published with, checked against the reviewed entry.
            ...(normalized.sourceRecord?.version ? { release: String(normalized.sourceRecord.version) } : {}),
            ...(normalized.sourceRecord?.datasetId ? { dataType: String(normalized.sourceRecord.datasetId) } : {}),
        };
        // A source can be refetched before its match-table entry is reviewed.
        // If a reviewed entry exists, it must agree. Missing entries fail closed
        // later at curated approval and staging through assertCuratedMatchTable.
        const hasReviewedMatch = matches.some(entry => entry?.manifestId === job.target?.manifestId);
        if (job.scope === 'curated' && hasReviewedMatch && !verifiedRecordMatchesTable(job.target?.manifestId, verifiedRecord, matches))
            await mismatch('Verified FDC record must equal the match table entry');
        const proposal = structuredClone(job.proposal);
        const sourceKey = proposal.assistantSourceKeys[sourceId];
        proposal.revisionDraft.sources[sourceKey] = normalized.sourceRecord;
        const draft = proposal.revisionDraft;
        const stagedRecord = revisionToStagedRecord(draft);
        const fieldProvenance = { ...draft.fieldProvenance };
        proposal.gaps = { ...(proposal.gaps || {}) };
        // The verified source stays on its assistant key. Cited fields point at
        // that key, not at whichever source was listed first.
        for (const [key] of cited) {
            stagedRecord.values[key] = normalized.nutrients[key] ?? null;
            stagedRecord.quality[key] = { ...(normalized.nutrientMeta.quality[key] || { status: 'unknown' }) };
            const from = normalized.fieldProvenance[key] || {};
            fieldProvenance[key] = {
                sourceKey,
                ...(from.sourceNutrientId ? { sourceNutrientId: from.sourceNutrientId } : {}),
                ...(from.derivation ? { derivation: from.derivation } : {}),
                ...(from.comparatorRef ? { comparatorRef: from.comparatorRef } : {}),
                ...(from.confidence !== undefined ? { confidence: from.confidence } : {}),
                ...(from.range ? { range: from.range } : {}),
            };
            const gap = gapFromWrittenObservation(stagedRecord.quality[key], stagedRecord.values[key]);
            if (gap)
                proposal.gaps[key] = gap;
            else
                delete proposal.gaps[key];
        }
        proposal.revisionDraft = { ...draft, ...await buildRevisionDraft({
            identityId: draft.identityId, variantId: draft.variantId,
            stagedRecord, sources: draft.sources, fieldProvenance,
            basis: draft.basis, basedOn: draft.basedOn, base: job.target.baseRevision || null,
        }) };
        proposal.conversions = await Promise.all(proposal.conversions.map((c, i) => {
            const { conversionId, ...input } = c;
            const citedConversion = proposal.assistantResult.conversions[i];
            const citedHere = citesSource(citedConversion, sourceId);
            const portion = citedHere
                ? normalized.conversions.find(p => p.unit === citedConversion.unit && p.state === citedConversion.state && !p.unitQualifier && sameRange(p.range, citedConversion.range) && Number.isFinite(p.grams / p.amount) && Math.abs(p.grams / p.amount - citedConversion.grams) <= 1e-6)
                : null;
            const range = portion?.range ? { min: portion.range.min, max: portion.range.max } : null;
            return buildConversion({
                ...input,
                ...(range ? { range } : {}),
                variantRef: { ...c.variantRef, contentHash: proposal.revisionDraft.contentHash },
                source: citedHere ? normalized.sourceRecord : c.source,
            });
        }));
        proposal.diff = buildRevisionDiff(job.target.baseRevision || null, proposal.revisionDraft, proposal.conversions);
        // Keep each verified source's state words and validate that source on its own.
        // A flattened union let a cooked source hide a raw-only conflict.
        proposal.stateWordsBySource = {
            ...(proposal.stateWordsBySource || {}),
            [sourceId]: [...(normalized.extractedStateWords || [])],
        };
        const seenWords = new Set();
        proposal.extractedStateWords = [];
        for (const words of Object.values(proposal.stateWordsBySource)) {
            for (const word of words || []) {
                const normalizedWord = String(word).toLowerCase();
                if (!normalizedWord || seenWords.has(normalizedWord))
                    continue;
                seenWords.add(normalizedWord);
                proposal.extractedStateWords.push(normalizedWord);
            }
        }
        proposal.sourceVerification[sourceId] = { status: 'verified', method: 'deterministic_refetch', verifiedAt: new Date(now()).toISOString() };
        const updated = { ...job, proposal, validation: await validateProposal({ ...job, proposal }), version: job.version + 1 };
        await store.save(updated, { expectedVersion: job.version });
        return updated;
    }
    async function review(jobId, decision) {
        const job = await store.get(jobId);
        if (!job)
            throw new Error(`Job not found: ${jobId}`);
        const validation = await validateProposal(job);
        const updated = await applyReviewDecision({ ...job, validation }, decision);
        await store.save(updated, { expectedVersion: job.version });
        return updated;
    }
    async function report(batchId) {
        const jobs = await store.listByBatch(batchId);
        const summary = {
            batchId,
            total: jobs.length,
            queued: 0,
            awaiting_response: 0,
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
        retryJob,
        prepareRequest, acceptResponse, cancelRequest, attestSource, verifySource,
        runJob,
        runBatch,
        review,
        report,
    };
}
