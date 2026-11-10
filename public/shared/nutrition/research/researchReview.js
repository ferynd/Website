import { contentHashOf } from '../contentHash.js';
import { PROFILE_FIELDS as V2_KEYS } from './profileFields.js';
import { transition } from './researchJob.js';
export const CHECKLIST_VERSION = 1;
export const PLAYBOOK_CHECKLIST = Object.freeze([
    { id: 'identity_verified', text: 'Food state, variant dimensions and category match evidence' },
    { id: 'source_attributed', text: 'Official source ID, version, access date and license verified' },
    { id: 'basis_confirmed', text: 'Normalized to 100 g edible portion without assumed density' },
    { id: 'evidence_documented', text: 'Every non-null value has documented provenance and evidence' },
    { id: 'warnings_acknowledged', text: 'All validation warnings reviewed and acknowledged' },
]);
export function buildRevisionDiff(base, draft, conversions = []) {
    const nutrientChanges = {};
    let totalChanges = 0;
    for (const key of V2_KEYS) {
        const oldValue = base?.nutrients?.[key] ?? null;
        const newValue = draft?.nutrients?.[key] ?? null;
        const oldStatus = base?.nutrientMeta?.quality?.[key]?.status ?? null;
        const newStatus = draft?.nutrientMeta?.quality?.[key]?.status ?? null;
        const oldSource = base?.fieldProvenance?.[key]?.sourceKey ?? null;
        const newSource = draft?.fieldProvenance?.[key]?.sourceKey ?? null;
        const valueChanged = oldValue !== newValue;
        const statusChanged = oldStatus !== newStatus;
        const sourceChanged = oldSource !== newSource;
        if (valueChanged || statusChanged || sourceChanged) {
            totalChanges++;
            nutrientChanges[key] = {
                oldValue,
                newValue,
                oldStatus,
                newStatus,
                oldSource,
                newSource,
            };
        }
    }
    const baseConvs = new Map((base?.conversions || []).map(c => [c.conversionId, c]));
    const draftConvs = conversions;
    const addedConversions = draftConvs.filter(c => !baseConvs.has(c.conversionId));
    const supersededConversions = draftConvs.filter(c => c.supersedes && baseConvs.has(c.supersedes));
    return {
        hasChanges: totalChanges > 0 || addedConversions.length > 0,
        totalChanges,
        nutrientChanges,
        addedConversions,
        supersededConversions,
    };
}
function identityText(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function identityTextsConflict(targetName, description) {
    const target = identityText(targetName);
    const record = identityText(description);
    if (!record)
        return true;
    if (!target)
        return false;
    return target !== record && !record.includes(target) && !target.includes(record);
}
/** FDC sources verified by deterministic refetch, keyed the way the assistant cited them. */
export function verifiedFdcRecords(job) {
    const proposal = job?.proposal;
    const sources = proposal?.revisionDraft?.sources || {};
    const verification = proposal?.sourceVerification || {};
    const keys = proposal?.assistantSourceKeys;
    if (!keys || !proposal?.assistantResult)
        return [];
    const records = [];
    for (const [sourceId, sourceKey] of Object.entries(keys)) {
        const source = sources[sourceKey];
        const check = verification[sourceId];
        if (!source || source.type !== 'fdc' || check?.status !== 'verified' || check?.method !== 'deterministic_refetch')
            continue;
        records.push({
            sourceId,
            recordId: String(source.recordId || ''),
            description: String(source.description || source.title || '').trim(),
            ...(source.version ? { release: String(source.version) } : {}),
            ...(source.datasetId ? { dataType: String(source.datasetId) } : {}),
        });
    }
    return records;
}
/**
 * FDC records that a deterministic FDC adapter (bulk or API) matched and
 * normalized into the proposal. Their match came from the table, so approval
 * and staging re-check that the published source record still equals it.
 * A deterministic FDC proposal whose source record is missing yields a record
 * with no description, which can never equal a reviewed entry.
 */
export function deterministicFdcRecords(job) {
    const proposal = job?.proposal;
    const match = job?.match;
    if (!proposal?.revisionDraft || proposal.assistantResult || proposal.reused)
        return [];
    if (!match || !['fdc_bulk', 'fdc_api'].includes(match.sourceAdapter))
        return [];
    const recordId = String(match.sourceId ?? '');
    const source = Object.values(proposal.revisionDraft.sources || {})
        .find(s => s && s.type === 'fdc' && String(s.recordId) === recordId);
    return [{
        sourceId: 'match',
        recordId,
        description: String(source?.description || source?.title || '').trim(),
        ...(source?.version ? { release: String(source.version) } : {}),
        ...(source?.datasetId ? { dataType: String(source.datasetId) } : {}),
    }];
}
const sameText = (left, right) => String(left ?? '').trim() === String(right ?? '').trim();
/**
 * Fail-closed check of a curated FDC record against the reviewed match table.
 * Callers use it only for curated jobs and FDC records; private jobs and
 * non-FDC sources never reach it.
 *
 * - No table entry for the manifest id means no match (PR #213). researchService
 *   still lets a source be refetched before its entry is reviewed; the missing
 *   entry then fails here, at curated approval and staging.
 * - The record must equal an entry on fdcId and (non-empty) description.
 * - When the entry carries release or dataType, the record must carry the
 *   same value; a record that omits it does not match.
 */
export function verifiedRecordMatchesTable(manifestId, record, matches = []) {
    if (!manifestId || !record)
        return false;
    const entries = (matches || []).filter(entry => entry && entry.manifestId === manifestId);
    if (!entries.length)
        return false;
    const description = String(record.description || '').trim();
    const recordId = String(record.recordId || '');
    if (!description || !recordId)
        return false;
    return entries.some(entry => String(entry.fdcId) === recordId
        && sameText(entry.description, description)
        && (!entry.release || sameText(entry.release, record.release))
        && (!entry.dataType || sameText(entry.dataType, record.dataType)));
}
export function assertCuratedMatchTable(job, matches = []) {
    if (job?.scope !== 'curated')
        return;
    const records = [...verifiedFdcRecords(job), ...deterministicFdcRecords(job)];
    if (!records.length)
        return;
    if (records.some(record => !verifiedRecordMatchesTable(job.target?.manifestId, record, matches)))
        throw new TypeError('Verified FDC record must equal the match table entry');
}
/** Identity fields copied onto the public catalog record. */
export function publishedIdentityFor(job) {
    const target = job?.target || {};
    return {
        canonicalName: target.canonicalName || target.name || target.manifestId || null,
        aliases: target.aliases || [],
        category: target.category || 'other',
        kind: target.kind || 'generic',
        dims: target.dims || { state: 'unspecified' },
    };
}
/** Approval covers the revision, every staged conversion, the gap report, and the published identity. */
export async function reviewContentHash(job) {
    const proposal = job.proposal;
    return contentHashOf({
        revisionContentHash: proposal.revisionDraft.contentHash,
        conversions: JSON.parse(JSON.stringify(proposal.conversions || [])),
        gaps: JSON.parse(JSON.stringify(proposal.gaps || {})),
        identity: JSON.parse(JSON.stringify(publishedIdentityFor(job))),
    });
}
export async function buildReviewPacket(job, options = {}) {
    assertCuratedMatchTable(job, options?.matches || []);
    const draft = job.proposal?.revisionDraft;
    const conversions = job.proposal?.conversions || [];
    const diff = buildRevisionDiff(job.target?.baseRevision, draft, conversions);
    const contentHash = draft ? await reviewContentHash(job) : null;
    const identity = publishedIdentityFor(job);
    const verifiedFdc = job.scope === 'curated' ? verifiedFdcRecords(job) : [];
    const identityMismatch = verifiedFdc.some(record => identityTextsConflict(identity.canonicalName, record.description));
    const gaps = job.proposal?.gaps || {};
    const validation = job.validation || { isValid: false, errors: [], warnings: [] };
    const mdLines = [
        `# Research Review: ${job.target?.manifestId || job.target?.variantId || job.jobId}`,
        ``,
        `- **Job ID:** \`${job.jobId}\``,
        `- **Target Kind:** ${job.target?.targetKind}`,
        `- **State:** ${job.target?.dims?.state || 'unspecified'}`,
        `- **Approval Content Hash:** \`${contentHash || 'none'}\``,
        `- **Draft Content Hash:** \`${draft?.contentHash || 'none'}\``,
        `- **Status:** ${job.state}`,
        `- **Validation:** ${validation.isValid ? 'VALID' : 'INVALID'} (${validation.errors.length} errors, ${validation.warnings.length} warnings)`,
        ``,
    ];
    if (validation.errors.length) {
        mdLines.push(`### Validation Errors (Blockers)`);
        for (const err of validation.errors) {
            mdLines.push(`- ❌ ${err}`);
        }
        mdLines.push(``);
    }
    if (validation.warnings.length) {
        mdLines.push(`### Validation Warnings`);
        for (const w of validation.warnings) {
            mdLines.push(`- ⚠️ ${w}`);
        }
        mdLines.push(``);
    }
    mdLines.push(`### Proposed Macro Nutrients (per 100g)`);
    mdLines.push(`- **Calories:** ${draft?.nutrients?.calories ?? 'unknown'} kcal`);
    mdLines.push(`- **Protein:** ${draft?.nutrients?.protein ?? 'unknown'} g`);
    mdLines.push(`- **Carbs:** ${draft?.nutrients?.carbs ?? 'unknown'} g`);
    mdLines.push(`- **Fat:** ${draft?.nutrients?.fat ?? 'unknown'} g`);
    mdLines.push(`- **Fiber:** ${draft?.nutrients?.fiber ?? 'unknown'} g`);
    mdLines.push(``);
    mdLines.push(`### Proposed Conversions`);
    for (const c of conversions)
        mdLines.push(`- ${c.amount} ${c.unit}${c.unitQualifier ? ' (' + c.unitQualifier + ')' : ''}: ${c.grams ?? c.gramsPerMl} ${c.kind === 'density' ? 'g/mL' : 'g'}; state: ${c.state}; source: ${JSON.stringify(c.source)}`);
    mdLines.push(``);
    mdLines.push(`### Published identity`);
    mdLines.push(`- **Canonical name:** ${identity.canonicalName || 'unknown'}`);
    mdLines.push(`- **Aliases:** ${Array.isArray(identity.aliases) && identity.aliases.length ? identity.aliases.join(', ') : 'none'}`);
    mdLines.push(`- **Category:** ${identity.category}`);
    mdLines.push(`- **Kind:** ${identity.kind}`);
    mdLines.push(`- **Dimensions:** ${JSON.stringify(identity.dims)}`);
    if (job.scope === 'curated') {
        const verifiedLine = verifiedFdc.length
            ? verifiedFdc.map(record => `${record.description || 'unknown'}${record.recordId ? ' (' + record.recordId + ')' : ''}`).join('; ')
            : 'none';
        mdLines.push(`- **Verified FDC description:** ${verifiedLine}`);
        mdLines.push(`- **Identity mismatch:** ${identityMismatch ? 'yes' : 'no'}`);
    }
    mdLines.push(``);
    mdLines.push(`### Gaps`);
    const gapEntries = Object.entries(gaps);
    if (!gapEntries.length)
        mdLines.push('- none');
    for (const [field, reason] of gapEntries)
        mdLines.push(`- **${field}:** ${reason}`);
    mdLines.push(``);
    mdLines.push(`### Checklist (Version ${CHECKLIST_VERSION})`);
    for (const item of PLAYBOOK_CHECKLIST) {
        mdLines.push(`- [ ] **${item.id}**: ${item.text}`);
    }
    mdLines.push(``);
    const jsonPacket = {
        checklistVersion: CHECKLIST_VERSION,
        jobId: job.jobId,
        target: job.target,
        contentHash,
        revisionContentHash: draft?.contentHash,
        conversions,
        gaps,
        identity,
        ...(job.scope === 'curated' ? { verifiedFdc, identityMismatch } : {}),
        validation,
        diff,
        nutrients: draft?.nutrients,
        quality: draft?.nutrientMeta?.quality,
        sources: draft?.sources,
    };
    return {
        json: jsonPacket,
        markdown: mdLines.join('\n'),
    };
}
export async function applyReviewDecision(job, decision) {
    if (!decision || typeof decision !== 'object') {
        throw new TypeError('Invalid decision: expected object');
    }
    if (Object.keys(decision).some(k => !['decision', 'reviewer', 'approvedContentHash', 'acknowledgedWarnings', 'notes', 'blockedReason', 'attestation'].includes(k)))
        throw new TypeError('Unknown review decision field; corrections require a new pass');
    const { decision: action, reviewer, approvedContentHash, acknowledgedWarnings = [], notes } = decision;
    if (action === 'block') {
        return transition(job, 'blocked', {
            blocked: {
                code: decision.blockedReason?.code || 'review_blocked',
                needs: decision.blockedReason?.needs || 'Reviewer flagged entry as blocked',
            },
            review: {
                decision: 'block',
                reviewer: String(reviewer || 'anonymous'),
                reviewedAt: new Date().toISOString(),
                notes,
            },
        });
    }
    if (action === 'reject') {
        return transition(job, 'queued', {
            match: null, proposal: null, validation: null, checkpoint: null,
            sourceEvidence: [], nextAttemptAt: null, attempts: [], blocked: null,
            review: {
                decision: 'reject',
                reviewer: String(reviewer || 'anonymous'),
                reviewedAt: new Date().toISOString(),
                notes,
            },
        });
    }
    if (action !== 'approve') {
        throw new Error(`Unknown review decision action: ${action}`);
    }
    // Action is 'approve'
    if (!reviewer || typeof reviewer !== 'string' || !reviewer.trim()) {
        throw new Error('Approval requires reviewer identifier');
    }
    const draft = job.proposal?.revisionDraft;
    if (!draft || !draft.contentHash) {
        throw new Error('Cannot approve job: proposal is missing revisionDraft or contentHash');
    }
    const contentHash = await reviewContentHash(job);
    if (contentHash !== approvedContentHash) {
        throw new Error(`Approved content hash mismatch: approved ${approvedContentHash} !== proposal ${contentHash}`);
    }
    if (job.validation?.errors?.length) {
        throw new Error(`Cannot approve job with validation errors: ${job.validation.errors.join('; ')}`);
    }
    if (!job.validation?.isValid)
        throw new Error('Approval requires valid proposal');
    if (job.proposal?.assistantResult) {
        const verification = job.proposal.sourceVerification || {};
        const ids = job.proposal.assistantResult.sources.map(s => s.sourceId);
        if (job.scope === 'curated' && ids.some(id => verification[id]?.status !== 'verified' || verification[id]?.method !== 'deterministic_refetch'))
            throw new Error('Curated approval requires deterministic refetch');
        if (job.scope === 'private' && ids.some(id => verification[id]?.status !== 'verified') && decision.attestation !== true)
            throw new Error('Private approval requires reviewer attestation');
    }
    const unacknowledged = (job.validation?.warnings || []).filter(w => !acknowledgedWarnings.includes(w));
    if (unacknowledged.length > 0) {
        throw new Error(`Cannot approve job: unacknowledged warnings: ${unacknowledged.join('; ')}`);
    }
    return transition(job, 'approved', {
        review: {
            checklistVersion: CHECKLIST_VERSION,
            decision: 'approve',
            reviewer: reviewer.trim(),
            reviewedAt: new Date().toISOString(),
            approvedContentHash,
            acknowledgedWarnings: [...acknowledgedWarnings],
            notes: notes || undefined,
            ...(job.proposal?.assistantResult ? { attestation: decision.attestation === true, label: 'assistant-researched' } : {}),
        },
    });
}
