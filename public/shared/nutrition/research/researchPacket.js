import { normalizeVariantDims } from '../ingredientVariants.js';
import { verifyRevisionHash } from '../ingredientProfile.js';
import { canonicalJson, contentHashOf } from '../contentHash.js';
import { NUTRIENT_REGISTRY_VERSION, NUTRIENT_STATUSES, getNutrient, convertUnit, checkPer100g } from '../nutrientRegistry.js';
import { parseFormWords, formWordsFor } from '../variantVocabulary.js';
import { requestedFields } from './profileFields.js';
// Source ids become published revision.sources keys, so keep them opaque (no emails or paths).
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const PACKET_LIMITS = Object.freeze({ allFieldTargets: 8, fieldLimitedTargets: 25, fieldThreshold: 10, requestBytes: 200000, responseBytes: 1000000, ttlMs: 7 * 86400000 });
export const RESEARCH_RULES = Object.freeze([
    'Cite every source; never invent IDs or URLs.',
    'Return null plus a reason when a value is unknown.',
    'Keep raw, cooked, drained, and fortified forms distinct.',
    'Estimates need a comparator, a transfer reason, a derivation, and a range.',
    'Do not change known observations or return meal totals.'
]);
const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : canonicalJson(value)).length;
const jsonCopy = value => JSON.parse(JSON.stringify(value));
export function canonicalRequestBody(request) {
    const { requestId: _id, requestDigest: _digest, createdAt: _time, ...body } = request;
    return canonicalJson({ ...body, targets: [...body.targets].sort((a, b) => a.targetId.localeCompare(b.targetId)) });
}
export async function requestDigestFor(request) {
    // contentHashOf hashes canonical JSON; body is parsed to avoid hashing a JSON string.
    return contentHashOf(JSON.parse(canonicalRequestBody(request)));
}
function packetTarget(job, includeLabelEvidence) {
    if (job.state !== 'queued')
        throw new TypeError(`$.targets: job ${job.jobId} is not queued`);
    const t = job.target;
    // Validate recognized form words with the shared vocabulary, preserving free-text #61 dims.
    const variant = normalizeVariantDims(t.dims);
    parseFormWords(formWordsFor(variant));
    const identity = { name: t.canonicalName || t.name || t.manifestId || t.identityId, category: t.category || 'other', kind: t.kind || 'generic', aliases: (t.aliases || []).map(a => typeof a === 'string' ? a : a?.text) };
    if ([identity.name, identity.category, identity.kind, ...identity.aliases].some(v => typeof v !== 'string' || !v.trim() || v.length > 2000))
        throw new TypeError('$.identity: text-only identity fields required');
    const fields = requestedFields(job.requestedFields);
    const known = t.knownObservations || {};
    for (const [key, n] of Object.entries(known)) {
        if (!getNutrient(key) || key === 'fiberWeightedLegacy' || !n || Object.keys(n).some(k => !['value', 'unit', 'status', 'qualifier', 'roundingInterval', 'upperBound'].includes(k)) || (n.value !== null && (!Number.isFinite(n.value) || n.value < 0)) || !NUTRIENT_STATUSES.includes(n.status) || convertUnit(key, n.value === null ? 1 : n.value, n.unit).error)
            throw new TypeError('$.knownObservations.' + key + ': invalid observation');
    }
    for (const n of Object.values(known)) {
        if (n.qualifier !== undefined && typeof n.qualifier !== 'string')
            throw new TypeError('$.knownObservations: text qualifier required');
        for (const k of ['upperBound', 'roundingInterval'])
            if (n[k] !== undefined && (!Number.isFinite(n[k]) || n[k] < 0))
                throw new TypeError('$.knownObservations: numeric bound required');
    }
    if (includeLabelEvidence && t.labelEvidence) {
        const label = t.labelEvidence;
        if (typeof label !== 'object' || Object.keys(label).some(k => !['title', 'url', 'capturedAt', 'market', 'servingSize', 'servingSizeUnit', 'nutrients', 'ingredientStatement'].includes(k)) || /data:|base64|blob:/i.test(JSON.stringify(label)))
            throw new TypeError('$.labelEvidence: text-only label fields required');
        for (const k of ['title', 'url', 'capturedAt', 'market', 'servingSizeUnit', 'ingredientStatement'])
            if (label[k] !== undefined && typeof label[k] !== 'string')
                throw new TypeError('$.labelEvidence.' + k + ': text required');
        if (label.servingSize !== undefined && (!Number.isFinite(label.servingSize) || label.servingSize <= 0))
            throw new TypeError('$.labelEvidence.servingSize: positive number required');
        if (label.nutrients) {
            requestedFields(Object.keys(label.nutrients));
            for (const n of Object.values(label.nutrients)) {
                if (!n || typeof n !== 'object' || Object.keys(n).some(k => !['value', 'unit', 'status', 'roundingInterval', 'qualifier'].includes(k)) || !Number.isFinite(n.value) || n.value < 0 || typeof n.unit !== 'string' || (n.status !== undefined && n.status !== 'label_reported') || (n.qualifier !== undefined && typeof n.qualifier !== 'string') || (n.roundingInterval !== undefined && (!Number.isFinite(n.roundingInterval) || n.roundingInterval < 0)))
                    throw new TypeError('$.labelEvidence.nutrients: numeric label observations required');
            }
        }
    }
    return jsonCopy({ targetId: job.jobId,
        identity,
        variant, requestedFields: job.requestedFields === '*' ? '*' : fields,
        basis: 'per_100g_edible', expectedUnits: Object.fromEntries(fields.map(k => [k, getNutrient(k).unit])),
        knownObservations: t.knownObservations || {}, triedSources: job.attempts.map(a => ({ adapter: a.adapter, release: a.release || 'unknown', outcome: a.outcome })),
        ...(includeLabelEvidence && t.labelEvidence ? { labelEvidence: t.labelEvidence } : {}) });
}
export async function buildResearchPackets(jobs, { purpose = 'profile', limits = {}, now = () => Date.now(), randomBytes = () => crypto.getRandomValues(new Uint8Array(12)), includeLabelEvidence = false } = {}) {
    const bounds = { ...PACKET_LIMITS, ...limits };
    if (!['profile', 'fields', 'conversion'].includes(purpose))
        throw new TypeError('$.purpose: invalid purpose');
    for (const k of Object.keys(PACKET_LIMITS))
        if (!Number.isSafeInteger(bounds[k]) || bounds[k] < 1)
            throw new TypeError(`Invalid packet limit ${k}`);
    for (const job of jobs) {
        const { baseRef, baseRevision } = job.target;
        if (baseRef || baseRevision) {
            if (!baseRef || !baseRevision || baseRef.contentHash !== baseRevision.contentHash || baseRef.revision !== baseRevision.revision || baseRef.variantId !== baseRevision.variantId || baseRef.identityId !== baseRevision.identityId || !await verifyRevisionHash(baseRevision))
                throw new TypeError('$.targets: valid pinned base revision required');
        }
    }
    const sorted = jobs.map(j => packetTarget(j, includeLabelEvidence)).sort((a, b) => a.targetId.localeCompare(b.targetId));
    if (new Set(sorted.map(t => t.targetId)).size !== sorted.length)
        throw new TypeError('Duplicate target');
    const full = t => t.requestedFields === '*' || t.requestedFields.length > bounds.fieldThreshold;
    const requests = [];
    const bodyFor = targets => ({ kind: 'nutrition.researchRequest', schemaVersion: 1, registryVersion: NUTRIENT_REGISTRY_VERSION, responseSchemaVersion: 1, purpose, targets, rules: [...RESEARCH_RULES], responseTemplate: { kind: 'nutrition.researchResponse', schemaVersion: 1, requestId: '', requestDigest: '', responder: {}, results: [] } });
    async function issue(targets) {
        const random = randomBytes();
        if (!(random instanceof Uint8Array) || random.length !== 12)
            throw new TypeError('requestId requires 96 random bits');
        const request = { ...bodyFor(targets), requestId: 'rq-' + [...random].map(b => b.toString(16).padStart(2, '0')).join(''), createdAt: new Date(now()).toISOString() };
        request.requestDigest = await requestDigestFor(request);
        if (bytes(request) > bounds.requestBytes)
            throw new TypeError('$.targets: single target exceeds request byte limit');
        requests.push(request);
    }
    for (const all of [true, false]) {
        const cap = all ? bounds.allFieldTargets : bounds.fieldLimitedTargets;
        let chunk = [];
        for (const target of sorted.filter(t => full(t) === all)) {
            const trial = [...chunk, target];
            // Account for the exact fixed-size issue header before allocating random IDs.
            const trialSize = bytes({ ...bodyFor(trial), requestId: 'rq-' + '0'.repeat(24), requestDigest: 'sha256:' + '0'.repeat(64), createdAt: '2000-01-01T00:00:00.000Z' });
            if (chunk.length && (trial.length > cap || trialSize > bounds.requestBytes)) {
                await issue(chunk);
                chunk = [];
            }
            chunk.push(target);
        }
        if (chunk.length)
            await issue(chunk);
    }
    return requests;
}
export function copyableResearchPacket(request) {
    return 'Answer this text-only ingredient research request with exactly one JSON research response v1. No meal composition or totals. Follow every rule in the request.\n\n```json\n' + JSON.stringify(request, null, 2) + '\n```';
}
/** Strict response validation. Throws path-specific errors before any job is staged. */
export async function validateResearchResponse(input, { request, jobs, now = Date.now(), registryVersion = NUTRIENT_REGISTRY_VERSION, limits = {}, currentRefs }) {
    const bounds = { ...PACKET_LIMITS, ...limits };
    const fail = (path, reason) => { throw new TypeError(`${path}: ${reason}`); };
    if (bytes(input) > bounds.responseBytes)
        fail('$', 'response byte limit exceeded');
    let response;
    try {
        response = typeof input === 'string' ? JSON.parse(input) : jsonCopy(input);
    }
    catch {
        fail('$', 'strict JSON required');
    }
    const obj = (v, p, keys, required = []) => {
        if (!v || typeof v !== 'object' || Array.isArray(v))
            fail(p, 'expected object');
        for (const k of Object.keys(v))
            if (!keys.includes(k))
                fail(p + '.' + k, 'unknown field');
        for (const k of required)
            if (!(k in v))
                fail(p + '.' + k, 'required');
    };
    const arr = (v, p, max = 1000) => {
        if (!Array.isArray(v) || v.length > max)
            fail(p, 'expected bounded array');
    };
    const str = (v, p, max = 2000) => {
        if (typeof v !== 'string' || !v.trim() || v.length > max)
            fail(p, 'expected nonempty text');
    };
    const num = (v, p) => {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
            fail(p, 'expected finite nonnegative number');
    };
    const range = (v, p) => {
        obj(v, p, ['min', 'max'], ['min', 'max']);
        num(v.min, p + '.min');
        num(v.max, p + '.max');
        if (v.max < v.min)
            fail(p, 'reversed range');
    };
    const https = (v, p) => {
        try {
            if (new URL(v).protocol !== 'https:')
                fail(p, 'https required');
        }
        catch {
            fail(p, 'https URL required');
        }
    };
    obj(response, '$', ['kind', 'schemaVersion', 'requestId', 'requestDigest', 'responder', 'results'], ['kind', 'schemaVersion', 'requestId', 'requestDigest', 'responder', 'results']);
    if (response.kind !== 'nutrition.researchResponse' || response.schemaVersion !== 1)
        fail('$', 'unsupported response schema');
    if (request.requestDigest !== await requestDigestFor(request))
        fail('$.requestDigest', 'corrupt request');
    if (response.requestId !== request.requestId || response.requestDigest !== request.requestDigest)
        fail('$.requestId', 'wrong request echo');
    if (registryVersion !== request.registryVersion)
        fail('$.registryVersion', 'registry changed');
    obj(response.responder, '$.responder', ['assistant', 'label', 'webAccess'], ['assistant', 'webAccess']);
    if (!['chatgpt', 'claude', 'grok', 'codex', 'gemini', 'other'].includes(response.responder.assistant) || typeof response.responder.webAccess !== 'boolean')
        fail('$.responder', 'invalid assistant/webAccess');
    if (response.responder.label !== undefined)
        str(response.responder.label, '$.responder.label');
    arr(response.results, '$.results', Math.max(bounds.allFieldTargets, bounds.fieldLimitedTargets));
    const targetMap = new Map(request.targets.map(t => [t.targetId, t]));
    const seen = new Set();
    for (const [i, result] of response.results.entries()) {
        const p = `$.results[${i}]`;
        obj(result, p, ['targetId', 'identityMatch', 'sources', 'nutrients', 'conversions', 'assumptions', 'unresolved'], ['targetId', 'identityMatch', 'sources', 'nutrients', 'conversions', 'assumptions', 'unresolved']);
        const target = targetMap.get(result.targetId), job = jobs.find(j => j.jobId === result.targetId);
        if (!target || seen.has(result.targetId))
            fail(p + '.targetId', 'unrequested or duplicate target');
        seen.add(result.targetId);
        const pending = job?.pendingRequest;
        if (job?.state !== 'awaiting_response' || pending?.requestId !== request.requestId || pending?.requestDigest !== request.requestDigest || pending?.status !== 'pending' || Date.parse(pending.expiresAt) <= now || !Number.isFinite(Date.parse(pending.expiresAt)))
            fail(p + '.targetId', 'stale, expired, cancelled, or answered request');
        if (canonicalJson(job.target.baseRef || null) !== canonicalJson(pending.baseRef || null) || (currentRefs && canonicalJson(currentRefs[result.targetId] || null) !== canonicalJson(pending.baseRef || null)))
            fail(p + '.targetId', 'profile revision changed');
        if (canonicalJson(job.target.knownObservations || {}) !== canonicalJson(target.knownObservations))
            fail(p + '.targetId', 'known observations changed since issue');
        obj(result.identityMatch, p + '.identityMatch', ['description', 'state', 'conflict', 'notes'], ['description', 'state', 'conflict', 'notes']);
        str(result.identityMatch.description, p + '.identityMatch.description');
        str(result.identityMatch.state, p + '.identityMatch.state');
        if (typeof result.identityMatch.conflict !== 'boolean' || typeof result.identityMatch.notes !== 'string')
            fail(p + '.identityMatch', 'invalid conflict/notes');
        arr(result.sources, p + '.sources', 64);
        const sources = new Map();
        for (const [si, s] of result.sources.entries()) {
            const sp = p + `.sources[${si}]`;
            obj(s, sp, ['sourceId', 'type', 'title', 'url', 'recordId', 'version', 'publishedAt', 'accessedAt'], ['sourceId', 'type', 'title', 'url', 'accessedAt']);
            for (const k of ['sourceId', 'title', 'accessedAt'])
                str(s[k], sp + '.' + k);
            if (typeof s.sourceId === 'string' && !SOURCE_ID.test(s.sourceId))
                fail(sp + '.sourceId', 'sourceId must be a short opaque id');
            if (!Number.isFinite(Date.parse(s.accessedAt)))
                fail(sp + '.accessedAt', 'invalid date');
            for (const k of ['recordId', 'version', 'publishedAt'])
                if (s[k] !== undefined)
                    str(s[k], sp + '.' + k);
            https(s.url, sp + '.url');
            if (!['fdc', 'manufacturer', 'label', 'composition_db', 'literature', 'other'].includes(s.type) || sources.has(s.sourceId))
                fail(sp, 'invalid or duplicate source');
            sources.set(s.sourceId, s);
        }
        const sourceIds = (v, sp, required = false) => {
            arr(v, sp, 64);
            if (required && !v.length)
                fail(sp, 'source evidence required');
            for (const id of v)
                if (!sources.has(id))
                    fail(sp, 'unknown sourceId');
        };
        arr(result.unresolved, p + '.unresolved', 100);
        for (const u of result.unresolved) {
            obj(u, p + '.unresolved', ['field', 'reason'], ['field', 'reason']);
            str(u.reason, p + '.unresolved.reason');
            if (!requestedFields(target.requestedFields).includes(u.field))
                fail(p + '.unresolved.field', 'unrequested field');
        }
        obj(result.nutrients, p + '.nutrients', requestedFields(target.requestedFields));
        const normalized = {};
        for (const key of requestedFields(target.requestedFields)) {
            if (request.purpose === 'conversion' && !Object.hasOwn(result.nutrients, key))
                continue;
            const n = result.nutrients[key], np = p + '.nutrients.' + key;
            obj(n, np, ['value', 'unit', 'status', 'sourceIds', 'range', 'confidence', 'derivation', 'comparator', 'qualifier', 'roundingInterval', 'upperBound'], ['value', 'unit', 'status', 'sourceIds']);
            if (!NUTRIENT_STATUSES.includes(n.status) || n.status === 'legacy_unclassified')
                fail(np + '.status', 'invalid status');
            str(n.unit, np + '.unit');
            const converted = convertUnit(key, n.value === null ? 1 : n.value, n.unit);
            if (converted.error)
                fail(np + '.unit', 'unconvertible unit or numeric text');
            const citedNull = n.status === 'below_quantification_limit' || n.status === 'not_applicable';
            sourceIds(n.sourceIds, np + '.sourceIds', n.value !== null || citedNull);
            if (n.value !== null) {
                num(n.value, np + '.value');
                if (checkPer100g(key, converted.value) === 'reject')
                    fail(np + '.value', 'checkPer100g rejected');
                if (['unknown', 'below_quantification_limit'].includes(n.status))
                    fail(np + '.status', 'null required');
            }
            if (n.value === null && !['unknown', 'below_quantification_limit', 'not_applicable'].includes(n.status))
                fail(np + '.status', 'non-null value required for observational status');
            if (n.value === null && n.status === 'unknown' && !result.unresolved.some(u => u.field === key && u.reason))
                fail(np, 'unknown needs reason');
            if (n.status === 'below_quantification_limit' && n.upperBound === undefined)
                fail(np + '.upperBound', 'LOQ requires bound');
            if (n.range !== undefined) {
                range(n.range, np + '.range');
                if (n.value !== null && (n.value < n.range.min || n.value > n.range.max))
                    fail(np + '.range', 'value outside range');
            }
            for (const k of ['roundingInterval', 'upperBound', 'confidence'])
                if (n[k] !== undefined)
                    num(n[k], np + '.' + k);
            if (n.confidence > 1)
                fail(np + '.confidence', 'expected 0..1');
            for (const k of ['derivation', 'qualifier'])
                if (n[k] !== undefined)
                    str(n[k], np + '.' + k);
            if (n.comparator !== undefined) {
                obj(n.comparator, np + '.comparator', ['name', 'sourceId', 'transferReason'], ['name', 'sourceId', 'transferReason']);
                str(n.comparator.name, np + '.comparator.name');
                str(n.comparator.transferReason, np + '.comparator.transferReason');
                if (!sources.has(n.comparator.sourceId))
                    fail(np + '.comparator.sourceId', 'unknown source');
            }
            if (n.status === 'estimated_from_comparable' && (!n.comparator || !n.derivation || !n.range))
                fail(np, 'estimate requires comparator, transfer reason, derivation and range');
            if (['measured', 'label_reported'].includes(n.status) && !n.sourceIds.some(id => { const s = sources.get(id); return ['fdc', 'manufacturer', 'label'].includes(s.type) && (s.recordId || s.url); }))
                fail(np, 'measured/label requires proper source');
            normalized[key] = { ...n, value: n.value === null ? null : converted.value, unit: getNutrient(key).unit };
            for (const k of ['range', 'roundingInterval', 'upperBound'])
                if (n[k] !== undefined)
                    normalized[key][k] = k === 'range' ? { min: convertUnit(key, n.range.min, n.unit).value, max: convertUnit(key, n.range.max, n.unit).value } : convertUnit(key, n[k], n.unit).value;
            const known = target.knownObservations[key];
            if (known) {
                const observation = (value, normalize) => Object.fromEntries(['value', 'status', 'qualifier', 'roundingInterval', 'upperBound'].filter(k => value[k] !== undefined).map(k => [k,
                    normalize && ['value', 'roundingInterval', 'upperBound'].includes(k) && value[k] !== null ? convertUnit(key, value[k], value.unit).value : value[k]]));
                if (canonicalJson(observation(known, true)) !== canonicalJson(observation(normalized[key], false)))
                    fail(np, 'changed known observation');
            }
        }
        arr(result.conversions, p + '.conversions', 100);
        if (request.purpose !== 'conversion' && result.conversions.length)
            fail(p + '.conversions', 'unrequested conversions');
        for (const c of result.conversions) {
            obj(c, p + '.conversions', ['unit', 'grams', 'state', 'sourceIds', 'range', 'confidence'], ['unit', 'grams', 'state', 'sourceIds', 'confidence']);
            str(c.unit, p + '.conversions.unit');
            str(c.state, p + '.conversions.state');
            num(c.grams, p + '.conversions.grams');
            if (c.grams === 0)
                fail(p + '.conversions.grams', 'positive grams required');
            num(c.confidence, p + '.conversions.confidence');
            if (c.confidence > 1)
                fail(p + '.conversions.confidence', 'expected 0..1');
            sourceIds(c.sourceIds, p + '.conversions.sourceIds', true);
            if (c.range)
                range(c.range, p + '.conversions.range');
        }
        arr(result.assumptions, p + '.assumptions', 100);
        for (const a of result.assumptions)
            str(a, p + '.assumptions');
        result.nutrients = normalized;
        result.verification = 'unverified';
    }
    if (seen.size !== targetMap.size)
        fail('$.results', 'missing requested targets');
    return response;
}
