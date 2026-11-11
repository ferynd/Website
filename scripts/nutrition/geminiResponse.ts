/**
 * #63 Gemini response validator (PR 2 of the Gemini-assisted workflow).
 *
 * Deterministically checks Gemini's results for one research bundle before
 * ChatGPT adjudicates them in issue #215: envelope and strict schema shape,
 * exact target coverage (single object or chunk files plus a results
 * manifest), source verification of every match and alternative against the
 * pinned FDC releases, and a material attribute recheck of each chosen record
 * through geminiBundle.ts's own conflict machinery.
 *
 * Gemini output is UNVERIFIED research. This module only reads; it never
 * writes the match table, the catalog, or any capability flag. Candidate match
 * entries it emits are labelled reviewer 'gemini-unverified' and are meant for
 * a separate output file, never for docs/nutrition/source-match-table.json.
 */
import path from 'node:path';
import { canonicalJson } from '../../public/shared/nutrition/contentHash.js';
import { auditPinnedBulk } from './fdcBulkReader';
import { findConflicts, materialAttributesOf, type BundleDataset, type BundleDatasetId, type BundleTarget, type GeminiBundle } from './geminiBundle';
import type { ManifestEntry } from './manifestReader';
import type { MatchEntry } from './matchTable';

export const REPORT_SCHEMA_VERSION = 1;
export const CATEGORIES = Object.freeze(['PROPOSED_MATCH', 'NEEDS_REVIEW', 'UNRESOLVED'] as const);
export type GeminiCategory = typeof CATEGORIES[number];
export const DATASETS: readonly BundleDatasetId[] = Object.freeze(['foundation', 'sr-legacy']);
export const DATA_TYPES: Readonly<Record<BundleDatasetId, string>> = Object.freeze({ foundation: 'Foundation', 'sr-legacy': 'SR Legacy' });
export const CANDIDATE_REVIEWER = 'gemini-unverified';
export const CANDIDATE_RATIONALE_PREFIX = 'UNVERIFIED Gemini proposal, pending ChatGPT adjudication: ';

const RESULTS_KEYS = ['bundleId', 'inputDigest', 'decisions'];
const MANIFEST_KEYS = ['bundleId', 'inputDigest', 'totalTargets', 'chunks'];
const CHUNK_KEYS = ['file', 'targetIds'];
const DECISION_KEYS = ['targetId', 'category', 'match', 'alternatives', 'materialAttributesChecked', 'unsupportedAssumptions', 'unresolvedReason', 'evidenceNeeded', 'evidenceRefs', 'notes'];
const REQUIRED_DECISION_KEYS = ['targetId', 'category', 'alternatives', 'materialAttributesChecked', 'unsupportedAssumptions', 'evidenceNeeded', 'evidenceRefs', 'notes'];
const STRING_ARRAY_KEYS = ['materialAttributesChecked', 'unsupportedAssumptions', 'evidenceNeeded', 'evidenceRefs'] as const;
const MATCH_KEYS = ['fdcId', 'dataset', 'release', 'description'];
const ALTERNATIVE_KEYS = ['fdcId', 'dataset', 'reasonRejected'];

/**
 * Codes for errors that are not attached to one decision (file envelope,
 * results manifest, coverage). Any of them fails the run.
 */
export const COVERAGE_CODES: readonly string[] = Object.freeze([
    'missing_target', 'duplicate_target', 'unexpected_target',
    'json_parse_error', 'file_schema_invalid', 'unknown_key', 'bundle_id_mismatch', 'input_digest_mismatch',
    'manifest_missing', 'manifest_duplicate', 'manifest_total_mismatch', 'manifest_chunk_missing', 'chunk_not_in_manifest', 'manifest_chunk_mismatch', 'manifest_coverage_mismatch',
]);

export type Severity = 'error' | 'flag';
export interface Finding {
    severity: Severity;
    targetId: string | null;
    code: string;
    detail: string;
    /** Response file basename the finding came from, when it has one. */
    file?: string;
    /** Index of the decision within its file, when the finding is about one decision. */
    decisionIndex?: number;
}
export type Classification = 'CLEAN' | 'ADJUDICATION' | 'UNRESOLVED' | 'INVALID';
export interface ResponseMatch { fdcId: string; dataset: BundleDatasetId; release: string; description: string }
export interface DecisionReport {
    targetId: string | null;
    file: string;
    decisionIndex: number;
    category: string | null;
    match: ResponseMatch | null;
    /** Whether the match's fdcId was among the bundle's candidates for this target. */
    inBundleCandidates: boolean | null;
    classification: Classification;
    findings: Finding[];
}
export interface ResponseFile {
    /** Path or name of the file; manifest listings are compared by basename. */
    file: string;
    /** Raw file text (parsed here so parse failures become findings). */
    text: string;
}
export interface ValidationSummary {
    totalDecisions: number;
    clean: number;
    adjudication: number;
    unresolved: number;
    invalid: number;
    coverageErrors: number;
    missingTargets: number;
    duplicateTargets: number;
    unexpectedTargets: number;
    errors: number;
    flags: number;
    candidateEntries: number;
}
export interface ValidationReport {
    schemaVersion: 1;
    bundleId: string;
    inputDigest: string;
    validatedAt: string;
    bundleTargetCount: number;
    sourceVersions: GeminiBundle['sourceVersions'];
    files: { file: string; kind: 'results' | 'manifest' | 'unreadable'; decisions: number }[];
    coverage: { missing: string[]; duplicate: string[]; unexpected: string[] };
    summary: ValidationSummary;
    ok: boolean;
    findings: Finding[];
    decisions: DecisionReport[];
    candidateEntries: CandidateMatchEntry[];
}
export type CandidateMatchEntry = Omit<MatchEntry, 'sharedJustification'>;
export interface ValidateOptions {
    /** The two pinned datasets (pin plus local file), as for buildGeminiBundle. */
    datasets: BundleDataset[];
    now?: Date;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const quote = (v: unknown) => JSON.stringify(v);
const unknownKeys = (obj: Record<string, unknown>, allowed: readonly string[]) => Object.keys(obj).filter(k => !allowed.includes(k)).sort();

/** The bundle target as the manifest entry geminiBundle's conflict machinery reads. */
export function entryOfTarget(t: BundleTarget): ManifestEntry {
    return {
        id: t.targetId, name: t.name, category: t.category, kind: t.kind, state: t.state, priority: 0, sourceStrategy: 'usda-first', status: 'queued',
        aliases: [...(t.aliases || [])],
        ...(t.notes !== null && t.notes !== undefined ? { notes: t.notes } : {}),
        ...(t.variant !== null && t.variant !== undefined ? { variant: t.variant } : {}),
    };
}

interface IndexedDataset { id: BundleDatasetId; release: string; records: Map<string, Record<string, unknown>> }
/**
 * Indexes each pinned release once, through the same checksum-verifying audit
 * path the bundle builder uses. The pins must be the bundle's own source
 * versions; anything else is a configuration error and throws.
 */
export async function indexPinnedDatasets(bundle: Pick<GeminiBundle, 'sourceVersions'>, datasets: BundleDataset[]) {
    const ids = datasets.map(d => d.pin.id).sort();
    if (canonicalJson(ids) !== canonicalJson([...DATASETS]))
        throw new Error('Validation needs exactly the foundation and sr-legacy pins');
    const out = new Map<BundleDatasetId, IndexedDataset>();
    for (const d of [...datasets].sort((a, b) => a.pin.id.localeCompare(b.pin.id))) {
        const version = bundle.sourceVersions.find(v => v.dataset === d.pin.id);
        if (!version || version.release !== d.pin.release || version.sha256 !== String(d.pin.sha256))
            throw new Error(`Dataset pin ${d.pin.id} does not match the bundle's source version`);
        const audit = await auditPinnedBulk(d.file, d.pin);
        out.set(d.pin.id, { id: d.pin.id, release: d.pin.release, records: new Map(audit.foods.map(f => [String(f.fdcId), f])) });
    }
    return out;
}

interface ParsedDecision { file: string; index: number; raw: unknown; fileOk: boolean }

/**
 * Validates Gemini's response files for one bundle. Returns the full
 * structured report; never throws on response content (only on a bundle or
 * pin mismatch, which is an operator configuration error).
 */
export async function validateGeminiResults(bundle: GeminiBundle, responseFiles: ResponseFile[], { datasets, now = new Date() }: ValidateOptions): Promise<ValidationReport> {
    if (!isObject(bundle) || !Array.isArray(bundle.targets) || !nonEmpty(bundle.bundleId) || !nonEmpty(bundle.inputDigest))
        throw new Error('Invalid bundle');
    const indexed = await indexPinnedDatasets(bundle, datasets);
    const targets = new Map(bundle.targets.map(t => [t.targetId, t]));
    const findings: Finding[] = [];
    const add = (f: Finding) => { findings.push(f); return f; };
    const files: ValidationReport['files'] = [];

    // ---- Files: parse, envelope, manifest detection
    const resultFiles: { file: string; data: Record<string, unknown>; ok: boolean }[] = [];
    const manifests: { file: string; data: Record<string, unknown> }[] = [];
    for (const rf of [...responseFiles].sort((a, b) => path.basename(a.file).localeCompare(path.basename(b.file)))) {
        const file = path.basename(rf.file);
        let data: unknown;
        try { data = JSON.parse(rf.text); }
        catch (error) {
            add({ severity: 'error', targetId: null, code: 'json_parse_error', file, detail: `Not strict JSON: ${(error as Error).message}` });
            files.push({ file, kind: 'unreadable', decisions: 0 });
            continue;
        }
        if (!isObject(data)) {
            add({ severity: 'error', targetId: null, code: 'file_schema_invalid', file, detail: 'Top level is not a JSON object' });
            files.push({ file, kind: 'unreadable', decisions: 0 });
            continue;
        }
        const isManifest = 'chunks' in data && !('decisions' in data);
        const allowed = isManifest ? MANIFEST_KEYS : RESULTS_KEYS;
        let ok = true;
        const fileError = (code: string, detail: string) => { ok = false; add({ severity: 'error', targetId: null, code, file, detail }); };
        const extra = unknownKeys(data, allowed);
        if (extra.length) fileError('unknown_key', `Unknown top-level key(s): ${extra.join(', ')}`);
        if (data.bundleId !== bundle.bundleId) fileError('bundle_id_mismatch', `bundleId ${quote(data.bundleId)} != bundle ${bundle.bundleId}`);
        if (data.inputDigest !== bundle.inputDigest) fileError('input_digest_mismatch', `inputDigest ${quote(data.inputDigest)} != bundle ${bundle.inputDigest}`);
        if (isManifest) {
            manifests.push({ file, data });
            files.push({ file, kind: 'manifest', decisions: 0 });
            continue;
        }
        if (!Array.isArray(data.decisions)) {
            fileError('file_schema_invalid', '`decisions` must be an array');
            files.push({ file, kind: 'unreadable', decisions: 0 });
            continue;
        }
        resultFiles.push({ file, data, ok });
        files.push({ file, kind: 'results', decisions: data.decisions.length });
    }

    // ---- Results manifest (chunked protocol)
    const resultNames = resultFiles.map(r => r.file);
    const fileIds = new Map(resultFiles.map(r => [r.file, (r.data.decisions as unknown[]).map(d => isObject(d) && typeof d.targetId === 'string' ? d.targetId : null)]));
    if (manifests.length > 1)
        add({ severity: 'error', targetId: null, code: 'manifest_duplicate', detail: `More than one results manifest: ${manifests.map(m => m.file).join(', ')}` });
    const manifest = manifests[0];
    if (!manifest && resultFiles.length > 1)
        add({ severity: 'error', targetId: null, code: 'manifest_missing', detail: `${resultFiles.length} results files without a results manifest: ${resultNames.join(', ')}` });
    if (manifest) {
        const m = manifest.data, file = manifest.file;
        const chunks = m.chunks;
        if (m.totalTargets !== bundle.targets.length)
            add({ severity: 'error', targetId: null, code: 'manifest_total_mismatch', file, detail: `totalTargets ${quote(m.totalTargets)} != bundle target count ${bundle.targets.length}` });
        if (!Array.isArray(chunks) || !chunks.every(c => isObject(c) && typeof c.file === 'string' && isStringArray(c.targetIds) && !unknownKeys(c, CHUNK_KEYS).length)) {
            add({ severity: 'error', targetId: null, code: 'file_schema_invalid', file, detail: '`chunks` must be an array of { file, targetIds: [string] } with no other keys' });
        }
        else {
            const listed = new Map<string, string[]>();
            for (const c of chunks as { file: string; targetIds: string[] }[]) {
                const name = path.basename(c.file);
                if (listed.has(name)) add({ severity: 'error', targetId: null, code: 'manifest_duplicate', file, detail: `Chunk ${name} is listed more than once` });
                listed.set(name, c.targetIds);
            }
            for (const [name, ids] of listed) {
                const actual = fileIds.get(name);
                if (!actual) { add({ severity: 'error', targetId: null, code: 'manifest_chunk_missing', file, detail: `Manifest lists ${name}, which was not provided` }); continue; }
                const want = [...ids].sort(), got = actual.map(x => x ?? '<no targetId>').sort();
                if (canonicalJson(want) !== canonicalJson(got)) {
                    const onlyListed = want.filter(x => !got.includes(x)), onlyFile = got.filter(x => !want.includes(x));
                    add({ severity: 'error', targetId: null, code: 'manifest_chunk_mismatch', file: name, detail: `Chunk ids disagree with the manifest listing. Listed but not in file: ${onlyListed.join(', ') || 'none'}. In file but not listed: ${onlyFile.join(', ') || 'none'}.${want.length !== got.length ? ` Counts: listed ${want.length}, file ${got.length}.` : ''}` });
                }
            }
            for (const name of resultNames)
                if (!listed.has(name)) add({ severity: 'error', targetId: null, code: 'chunk_not_in_manifest', file: name, detail: `Results file ${name} is not listed in the manifest` });
            const allListed = [...listed.values()].flat();
            const bundleIds = bundle.targets.map(t => t.targetId);
            if (allListed.length !== bundleIds.length || canonicalJson([...allListed].sort()) !== canonicalJson([...bundleIds].sort()))
                add({ severity: 'error', targetId: null, code: 'manifest_coverage_mismatch', file, detail: `Manifest listing (${allListed.length} ids, ${new Set(allListed).size} distinct) does not cover the bundle's ${bundleIds.length} targets exactly once` });
        }
    }

    // ---- Coverage over the union of decisions
    const parsed: ParsedDecision[] = resultFiles.flatMap(r => (r.data.decisions as unknown[]).map((raw, index) => ({ file: r.file, index, raw, fileOk: r.ok })));
    const seenCount = new Map<string, number>();
    for (const p of parsed) if (isObject(p.raw) && typeof p.raw.targetId === 'string') seenCount.set(p.raw.targetId, (seenCount.get(p.raw.targetId) || 0) + 1);
    const missing = bundle.targets.map(t => t.targetId).filter(id => !seenCount.has(id)).sort();
    const duplicate = [...seenCount].filter(([, n]) => n > 1).map(([id]) => id).sort();
    const unexpected = [...seenCount.keys()].filter(id => !targets.has(id)).sort();
    for (const id of missing) add({ severity: 'error', targetId: id, code: 'missing_target', detail: `No decision for bundle target ${id}` });
    for (const id of duplicate) add({ severity: 'error', targetId: id, code: 'duplicate_target', detail: `${seenCount.get(id)} decisions for ${id}: ${parsed.filter(p => isObject(p.raw) && p.raw.targetId === id).map(p => `${p.file}#${p.index}`).join(', ')}` });
    for (const id of unexpected) add({ severity: 'error', targetId: id, code: 'unexpected_target', detail: `${id} is not a target in bundle ${bundle.bundleId}` });

    // ---- Per decision
    const decisions: DecisionReport[] = [];
    const candidateEntries: CandidateMatchEntry[] = [];
    const reviewedAt = now.toISOString().slice(0, 10);
    for (const p of parsed) {
        const own: Finding[] = [];
        const raw = p.raw;
        const targetId = isObject(raw) && typeof raw.targetId === 'string' ? raw.targetId : null;
        const f = (severity: Severity, code: string, detail: string) => { own.push(add({ severity, targetId, code, detail, file: p.file, decisionIndex: p.index })); };
        const report: DecisionReport = { targetId, file: p.file, decisionIndex: p.index, category: null, match: null, inBundleCandidates: null, classification: 'INVALID', findings: own };
        decisions.push(report);
        if (!isObject(raw)) {
            f('error', 'decision_schema_invalid', 'Decision is not a JSON object');
            continue;
        }
        // Strict shape
        const extra = unknownKeys(raw, DECISION_KEYS);
        if (extra.length) f('error', 'unknown_key', `Unknown decision key(s): ${extra.join(', ')}`);
        for (const k of REQUIRED_DECISION_KEYS) if (!(k in raw)) f('error', 'missing_field', `Missing required field ${k}`);
        if ('targetId' in raw && !nonEmpty(raw.targetId)) f('error', 'invalid_field', 'targetId must be a non-empty string');
        const category = typeof raw.category === 'string' && (CATEGORIES as readonly string[]).includes(raw.category) ? raw.category as GeminiCategory : null;
        report.category = typeof raw.category === 'string' ? raw.category : null;
        if ('category' in raw && !category) f('error', 'invalid_category', `category ${quote(raw.category)} is not one of ${CATEGORIES.join(', ')}`);
        for (const k of STRING_ARRAY_KEYS) if (k in raw && !isStringArray(raw[k])) f('error', 'invalid_field', `${k} must be an array of strings`);
        if ('notes' in raw && typeof raw.notes !== 'string') f('error', 'invalid_field', 'notes must be a string');
        if ('unresolvedReason' in raw && raw.unresolvedReason !== null && typeof raw.unresolvedReason !== 'string') f('error', 'invalid_field', 'unresolvedReason must be a string or null');

        const target = targetId ? targets.get(targetId) : undefined;
        const candidateOf = (fdcId: string) => target?.candidates.find(c => c.fdcId === fdcId);

        // Shared source verification for a match or an alternative.
        const verifySource = (role: 'match' | 'alternative', ref: { fdcId: string; dataset: BundleDatasetId; release?: string; description?: string }, label: string) => {
            const ds = indexed.get(ref.dataset)!;
            if (ref.release !== undefined && ref.release !== ds.release)
                f('error', 'release_mismatch', `${label} release ${quote(ref.release)} != pinned ${ref.dataset} release ${ds.release}`);
            const record = ds.records.get(ref.fdcId);
            if (!record) {
                f('error', 'fdc_id_not_found', `${label} fdcId ${ref.fdcId} is not in the pinned ${ref.dataset} ${ds.release} file`);
                return null;
            }
            const recordDescription = String(record.description);
            if (ref.description !== undefined && ref.description !== recordDescription)
                f('error', 'description_mismatch', `${label} description is not verbatim. Response: ${quote(ref.description)}. Pinned ${ref.dataset} ${ref.fdcId}: ${quote(recordDescription)}`);
            const cand = candidateOf(ref.fdcId);
            if (cand) {
                if (cand.dataset !== ref.dataset)
                    f('error', 'dataset_mismatch', `${label} fdcId ${ref.fdcId} is a bundle candidate in ${cand.dataset}, response names ${ref.dataset}`);
                else {
                    if (cand.description !== recordDescription)
                        f('error', 'bundle_description_mismatch', `${label} pinned description ${quote(recordDescription)} != bundle candidate description ${quote(cand.description)}`);
                    if (cand.release !== ds.release)
                        f('error', 'release_mismatch', `${label} bundle candidate release ${cand.release} != pinned ${ref.dataset} release ${ds.release}`);
                }
            }
            else if (role === 'match')
                f('flag', 'match_not_in_bundle_candidates', `${label} ${ref.dataset} ${ref.fdcId} ${quote(recordDescription)} was not among the bundle's candidates for ${targetId}`);
            else
                f('flag', 'alternative_not_in_bundle_candidates', `${label} ${ref.dataset} ${ref.fdcId} was not among the bundle's candidates for ${targetId}`);
            return { record, recordDescription, inBundle: !!cand && cand.dataset === ref.dataset };
        };

        // Match
        const hasMatch = 'match' in raw && raw.match !== null && raw.match !== undefined;
        let matchRef: ResponseMatch | null = null;
        if (hasMatch) {
            const m = raw.match;
            if (!isObject(m)) f('error', 'invalid_field', 'match must be an object or null');
            else {
                const extraM = unknownKeys(m, MATCH_KEYS);
                if (extraM.length) f('error', 'unknown_key', `Unknown match key(s): ${extraM.join(', ')}`);
                const problems = [
                    !(typeof m.fdcId === 'string' && /^\d+$/.test(m.fdcId)) && 'fdcId must be a digit string',
                    !(DATASETS as readonly unknown[]).includes(m.dataset) && `dataset must be one of ${DATASETS.join(', ')}`,
                    !nonEmpty(m.release) && 'release must be a non-empty string',
                    !nonEmpty(m.description) && 'description must be a non-empty string',
                ].filter(Boolean);
                if (problems.length) f('error', 'invalid_field', `match: ${problems.join('; ')}`);
                else matchRef = { fdcId: m.fdcId as string, dataset: m.dataset as BundleDatasetId, release: m.release as string, description: m.description as string };
            }
        }
        report.match = matchRef;
        if (category === 'PROPOSED_MATCH' && !hasMatch) f('error', 'match_required', 'PROPOSED_MATCH requires a non-null match');
        if (category === 'UNRESOLVED' && hasMatch) f('error', 'unexpected_match', 'UNRESOLVED requires match null or absent');
        if (category === 'NEEDS_REVIEW' && hasMatch) f('flag', 'needs_review_candidate', 'NEEDS_REVIEW carries a candidate match; treated as a flagged candidate for adjudication');
        if (category === 'UNRESOLVED' && !nonEmpty(raw.unresolvedReason)) f('flag', 'unresolved_without_reason', 'UNRESOLVED without an unresolvedReason');

        // Alternatives
        const alternatives: { fdcId: string; dataset: BundleDatasetId }[] = [];
        if ('alternatives' in raw) {
            if (!Array.isArray(raw.alternatives)) f('error', 'invalid_field', 'alternatives must be an array');
            else raw.alternatives.forEach((a, i) => {
                if (!isObject(a)) { f('error', 'invalid_field', `alternatives[${i}] must be an object`); return; }
                const extraA = unknownKeys(a, ALTERNATIVE_KEYS);
                if (extraA.length) f('error', 'unknown_key', `Unknown alternatives[${i}] key(s): ${extraA.join(', ')}`);
                const problems = [
                    !(typeof a.fdcId === 'string' && /^\d+$/.test(a.fdcId)) && 'fdcId must be a digit string',
                    !(DATASETS as readonly unknown[]).includes(a.dataset) && `dataset must be one of ${DATASETS.join(', ')}`,
                    typeof a.reasonRejected !== 'string' && 'reasonRejected must be a string',
                ].filter(Boolean);
                if (problems.length) f('error', 'invalid_field', `alternatives[${i}]: ${problems.join('; ')}`);
                else alternatives.push({ fdcId: a.fdcId as string, dataset: a.dataset as BundleDatasetId });
            });
        }

        // Source verification, attribute recheck, evidence refs (needs a known target).
        let verifiedMatch: ReturnType<typeof verifySource> = null;
        if (target) {
            if (matchRef) {
                verifiedMatch = verifySource('match', matchRef, 'match');
                report.inBundleCandidates = verifiedMatch ? verifiedMatch.inBundle : null;
                if (verifiedMatch) {
                    const entry = entryOfTarget(target);
                    const attributes = materialAttributesOf(entry);
                    if (canonicalJson(attributes) !== canonicalJson(target.materialAttributes))
                        f('flag', 'material_attributes_drift', `Recomputed material attributes differ from the bundle's: ${attributes.map(a => `${a.attribute}=${a.value}`).join(', ')}`);
                    for (const c of findConflicts(entry, verifiedMatch.recordDescription))
                        f('flag', 'attribute_contradiction', `${c.attribute}: ${c.reason} (${matchRef.dataset} ${matchRef.fdcId} ${quote(verifiedMatch.recordDescription)}; target ${target.targetId}: ${attributes.map(a => `${a.attribute}=${a.value}`).join(', ')})`);
                }
            }
            alternatives.forEach((a, i) => verifySource('alternative', a, `alternatives[${i}]`));
            if (isStringArray(raw.evidenceRefs)) {
                const refs = new Set(target.candidates.map(c => c.ref));
                const bad = raw.evidenceRefs.filter(r => !refs.has(r));
                if (bad.length) f('flag', 'unknown_evidence_ref', `evidenceRefs not among this target's candidate refs: ${bad.join(', ')}`);
            }
        }

        // Classification
        const hasError = !p.fileOk || own.some(x => x.severity === 'error')
            || (targetId !== null && (duplicate.includes(targetId) || unexpected.includes(targetId)));
        const hasFlag = own.some(x => x.severity === 'flag');
        const unsupported = isStringArray(raw.unsupportedAssumptions) ? raw.unsupportedAssumptions.filter(nonEmpty) : [];
        if (hasError || !category) report.classification = 'INVALID';
        else if (category === 'UNRESOLVED') report.classification = 'UNRESOLVED';
        else if (category === 'NEEDS_REVIEW') report.classification = 'ADJUDICATION';
        else report.classification = hasFlag || unsupported.length || !verifiedMatch ? 'ADJUDICATION' : 'CLEAN';

        // Candidate match entries (never written to the real table by this code).
        if ((report.classification === 'CLEAN' || report.classification === 'ADJUDICATION') && matchRef && verifiedMatch && targetId) {
            const checked = isStringArray(raw.materialAttributesChecked) ? raw.materialAttributesChecked : [];
            candidateEntries.push({
                manifestId: targetId,
                adapter: 'fdc_bulk',
                dataType: DATA_TYPES[matchRef.dataset],
                fdcId: matchRef.fdcId,
                release: indexed.get(matchRef.dataset)!.release,
                description: verifiedMatch.recordDescription,
                stateEvidence: `UNVERIFIED Gemini attribute check (${report.classification}): ${checked.join('; ') || 'none listed'}${unsupported.length ? `. Unsupported assumptions: ${unsupported.join('; ')}` : ''}`,
                rationale: CANDIDATE_RATIONALE_PREFIX + (typeof raw.notes === 'string' ? raw.notes : ''),
                reviewer: CANDIDATE_REVIEWER,
                reviewedAt,
                checklistVersion: 1,
            });
        }
    }

    // Per-decision errors raised before the decision loop (duplicate / unexpected
    // ids) also belong on those decisions' finding lists for the review matrix.
    for (const d of decisions)
        if (d.targetId && (duplicate.includes(d.targetId) || unexpected.includes(d.targetId)))
            d.findings.unshift(...findings.filter(x => x.targetId === d.targetId && (x.code === 'duplicate_target' || x.code === 'unexpected_target')));

    const count = (c: Classification) => decisions.filter(d => d.classification === c).length;
    const coverageErrors = findings.filter(x => x.severity === 'error' && COVERAGE_CODES.includes(x.code) && x.decisionIndex === undefined).length;
    const summary: ValidationSummary = {
        totalDecisions: decisions.length,
        clean: count('CLEAN'), adjudication: count('ADJUDICATION'), unresolved: count('UNRESOLVED'), invalid: count('INVALID'),
        coverageErrors,
        missingTargets: missing.length, duplicateTargets: duplicate.length, unexpectedTargets: unexpected.length,
        errors: findings.filter(x => x.severity === 'error').length,
        flags: findings.filter(x => x.severity === 'flag').length,
        candidateEntries: candidateEntries.length,
    };
    return {
        schemaVersion: REPORT_SCHEMA_VERSION,
        bundleId: bundle.bundleId,
        inputDigest: bundle.inputDigest,
        validatedAt: now.toISOString(),
        bundleTargetCount: bundle.targets.length,
        sourceVersions: bundle.sourceVersions,
        files,
        coverage: { missing, duplicate, unexpected },
        summary,
        ok: summary.invalid === 0 && coverageErrors === 0,
        findings,
        decisions,
        candidateEntries,
    };
}

// ---------------------------------------------------------------------------
// Rendering

const CLASS_ORDER = ['CLEAN', 'ADJUDICATION', 'UNRESOLVED', 'INVALID', 'MISSING'];
const cell = (v: string) => v.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** One row per decision plus one row per missing target, sorted by classification then targetId. */
export function renderReviewMatrix(report: ValidationReport) {
    const rows = [
        ...report.decisions.map(d => ({
            target: d.targetId ?? `(no targetId: ${d.file}#${d.decisionIndex})`,
            category: d.category ?? '(none)',
            record: d.match ? `${d.match.dataset} ${d.match.fdcId}: ${d.match.description}` : 'none',
            classification: d.classification as string,
            flags: [...new Set(d.findings.map(x => `${x.severity === 'error' ? 'E' : 'F'}:${x.code}`))].join(', '),
        })),
        ...report.coverage.missing.map(id => ({ target: id, category: '(missing)', record: 'none', classification: 'MISSING', flags: 'E:missing_target' })),
    ].sort((a, b) => CLASS_ORDER.indexOf(a.classification) - CLASS_ORDER.indexOf(b.classification) || a.target.localeCompare(b.target));
    const s = report.summary;
    return [
        `# Gemini review matrix: ${report.bundleId}`,
        '',
        `UNVERIFIED Gemini research, pending ChatGPT adjudication in issue #215. Validated ${report.validatedAt}.`,
        '',
        `Decisions ${s.totalDecisions}: clean ${s.clean}, adjudication ${s.adjudication}, unresolved ${s.unresolved}, invalid ${s.invalid}. Coverage errors ${s.coverageErrors} (missing ${s.missingTargets}, duplicate ${s.duplicateTargets}, unexpected ${s.unexpectedTargets}).`,
        '',
        '| Target | Gemini category | Chosen record | Classification | Flags |',
        '| --- | --- | --- | --- | --- |',
        ...rows.map(r => `| ${cell(r.target)} | ${cell(r.category)} | ${cell(r.record)} | ${r.classification} | ${cell(r.flags) || ''} |`),
        '',
    ].join('\n');
}

/** Only errors and flags, grouped by code (errors first), with each finding's detail. */
export function renderExceptions(report: ValidationReport) {
    const groups = new Map<string, Finding[]>();
    for (const x of report.findings) groups.set(x.code, [...(groups.get(x.code) || []), x]);
    const order = [...groups.keys()].sort((a, b) => {
        const sa = groups.get(a)!.some(x => x.severity === 'error') ? 0 : 1, sb = groups.get(b)!.some(x => x.severity === 'error') ? 0 : 1;
        return sa - sb || a.localeCompare(b);
    });
    const out = [`# Gemini response exceptions: ${report.bundleId}`, '', `${report.summary.errors} error(s), ${report.summary.flags} flag(s).`, ''];
    if (!order.length) out.push('No errors or flags.', '');
    for (const code of order) {
        const list = groups.get(code)!;
        out.push(`## ${code} (${list.length} ${list[0].severity === 'error' ? 'error' : 'flag'}${list.length === 1 ? '' : 's'})`, '');
        for (const x of [...list].sort((a, b) => (a.targetId ?? '').localeCompare(b.targetId ?? '') || (a.file ?? '').localeCompare(b.file ?? '')))
            out.push(`- ${x.severity.toUpperCase()} ${x.targetId ?? '(file)'}${x.file ? ` [${x.file}${x.decisionIndex !== undefined ? '#' + x.decisionIndex : ''}]` : ''}: ${x.detail.replace(/\r?\n/g, ' ')}`);
        out.push('');
    }
    return out.join('\n');
}
