import { emptyStagedRecord } from '../nutrientRegistry.js';
import { buildRevisionDraft } from '../ingredientProfile.js';
import { buildConversion } from '../ingredientConversion.js';
import { CURATED_CATALOG_ID } from '../ingredientIds.js';
import { PROFILE_FIELDS } from './profileFields.js';
import { extractStateWords } from './fdcFood.js';
import { buildRevisionDiff } from './researchReview.js';
import { applyStagedConventions } from './sourceResult.js';
export async function packetProposal(job, result) {
    const stagedRecord = emptyStagedRecord(), sources = {}, fieldProvenance = {};
    for (const key of PROFILE_FIELDS) {
        stagedRecord.values[key] = null;
        stagedRecord.quality[key] = { status: 'unknown', qualifier: 'gap:not_requested' };
    }
    // A field-limited pass extends a caller-supplied base, never zero-fills it.
    const base = job.target.baseRevision;
    if (base) {
        Object.assign(stagedRecord.values, base.nutrients);
        Object.assign(stagedRecord.quality, base.nutrientMeta.quality);
        if (base.nutrientMeta.fiberMeaning)
            stagedRecord.fiberMeaning = base.nutrientMeta.fiberMeaning;
        if (base.nutrientMeta.carbConvention)
            stagedRecord.carbConvention = base.nutrientMeta.carbConvention;
        Object.assign(sources, base.sources);
        Object.assign(fieldProvenance, base.fieldProvenance);
    }
    stagedRecord.values.fiberWeightedLegacy = null;
    delete stagedRecord.quality.fiberWeightedLegacy;
    delete fieldProvenance.fiberWeightedLegacy;
    applyStagedConventions(stagedRecord, { fiberMeaning: 'total', carbConvention: 'includes_fiber' }, { base, requested: job.requestedFields });
    const assistantSourceKeys = Object.fromEntries(result.sources.map(s => [s.sourceId, job.pendingRequest.requestId + ':' + s.sourceId]));
    for (const s of result.sources)
        sources[assistantSourceKeys[s.sourceId]] = { type: ['fdc', 'label', 'manufacturer'].includes(s.type) ? s.type : 'comparable', recordId: s.recordId || s.sourceId, title: s.title, url: s.url, version: s.version || 'assistant-cited-v1', accessedAt: s.accessedAt, permittedUse: 'review_required' };
    const gaps = {};
    for (const [key, n] of Object.entries(result.nutrients)) {
        stagedRecord.values[key] = n.value;
        stagedRecord.quality[key] = { status: n.status, ...(n.qualifier ? { qualifier: n.qualifier } : {}), ...(n.roundingInterval !== undefined ? { roundingInterval: n.roundingInterval } : {}), ...(n.upperBound !== undefined ? { upperBound: n.upperBound } : {}) };
        if (n.value === null) {
            gaps[key] = result.unresolved.find(u => u.field === key)?.reason || n.status;
            stagedRecord.quality[key].qualifier = n.qualifier || 'gap:' + gaps[key];
        }
        if (n.sourceIds.length)
            fieldProvenance[key] = { sourceKey: assistantSourceKeys[n.sourceIds[0]], ...(n.derivation ? { derivation: n.derivation } : {}), ...(n.comparator ? { comparatorRef: JSON.stringify(n.comparator) } : {}), ...(n.range ? { range: n.range } : {}), ...(n.confidence !== undefined ? { confidence: n.confidence } : {}) };
    }
    const identityId = job.target.identityId || job.target.manifestId, variantId = job.target.variantId || job.target.manifestId;
    const revisionDraft = await buildRevisionDraft({ identityId, variantId, stagedRecord, sources, fieldProvenance, basis: { kind: 'per_100g_edible', state: job.target.dims.state }, basedOn: job.target.baseRef || null, base: base || null });
    const revision = (job.target.baseRef?.revision || 0) + 1;
    const variantRef = { refVersion: 1, scope: job.scope, namespace: job.scope === 'curated' ? 'catalog:' + CURATED_CATALOG_ID : job.target.namespace, identityId, variantId, revision, revisionId: variantId + '~r' + revision, contentHash: revisionDraft.contentHash };
    const conversions = [];
    for (const c of result.conversions)
        conversions.push(await buildConversion({ variantRef, kind: 'household', unit: c.unit, amount: 1, grams: c.grams, state: c.state, source: sources[assistantSourceKeys[c.sourceIds[0]]], confidence: c.confidence, ...(c.range ? { range: c.range } : {}) }));
    return { assistantSourceKeys, revisionDraft, conversions, gaps, extractedStateWords: extractStateWords(result.identityMatch.state), identityConflict: result.identityMatch.conflict, assistantResult: result, verification: 'unverified', sourceVerification: Object.fromEntries(result.sources.map(s => [s.sourceId, { status: 'unverified' }])), diff: buildRevisionDiff(base, revisionDraft, conversions) };
}
