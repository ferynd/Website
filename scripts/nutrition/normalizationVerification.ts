/**
 * #63 V3: verify FDC nutrient normalization against actual pinned records.
 *
 * The checked path is the pipeline's own: the FDC bulk adapter's
 * toSourceResult (parseFdcFood) and normalizeSourceResult, exactly as
 * researchService.runJob calls them. The 17 A1 proposed matches also run end to
 * end through runJob, as one mixed-release batch, and are re-checked against an
 * in-memory reviewed entry with the fail-closed table check.
 *
 * Each record is classified independently of the normalizer, from the parsed
 * source rows and the FDC nutrient map, and the normalized output must agree.
 * Unit spot checks recompute values with the registry converter.
 *
 * Output is aggregate counts, registry keys, unit labels, FDC ids, and FDC
 * derivation codes only. No nutrient value and no description leaves this
 * module. Nothing is written: stores and caches are in memory.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../public/shared/nutrition/contentHash.js';
import { convertUnit, getNutrient, normalizeUnit } from '../../public/shared/nutrition/nutrientRegistry.js';
import { PROFILE_FIELDS } from '../../public/shared/nutrition/research/profileFields.js';
import { FDC_NUTRIENT_ENTRIES, ENERGY_PREFERENCE_ORDER } from '../../public/shared/nutrition/research/fdcNutrientMap.js';
import { normalizeSourceResult } from '../../public/shared/nutrition/research/sourceResult.js';
import { createResearchService } from '../../public/shared/nutrition/research/researchService.js';
import { createMemoryResearchStore, createMemorySourceCache } from '../../public/shared/nutrition/research/memoryResearchStore.js';
import { assertCuratedMatchTable } from '../../public/shared/nutrition/research/researchReview.js';
import type { SourceCache } from '../../public/shared/nutrition/research/researchPorts.js';
import { auditPinnedBulk, indexBulk, createFdcBulkAdapter, type DatasetPin } from './fdcBulkReader';
import { validateMatchTable, type MatchEntry } from './matchTable';
import { stateToDims, type ManifestEntry } from './manifestReader';

export type KeyOutcome = 'resolved' | 'below_loq' | 'unknown' | 'gap' | 'absent';
export const KEY_OUTCOMES: readonly KeyOutcome[] = ['resolved', 'below_loq', 'unknown', 'gap', 'absent'];
const RESOLVED_STATUSES = new Set(['measured', 'calculated', 'label_reported']);
const OMEGA3_COMPONENTS = [1404, 1278, 1272] as const;
const KJ_ENERGY_ID = 1062;

interface ParsedRow {
    nutrientId: number;
    unitName: string;
    amount: number | null;
    isBelowLoq: boolean;
    loq: number | null;
}
interface ParsedFood {
    recordId: string;
    fdcId: number;
    dataType: string;
    description: string;
    release: string;
    publishedAt?: string;
    checksum: string;
    nutrients: ParsedRow[];
}
interface Normalized {
    sourceKey: string;
    sourceRecord: Record<string, unknown>;
    nutrients: Record<string, number | null>;
    nutrientMeta: { quality: Record<string, { status?: string; qualifier?: string; upperBound?: number }> };
    fieldProvenance: Record<string, { sourceKey?: string; sourceNutrientId?: string; derivation?: string }>;
}
type RawFood = { fdcId: number; dataType?: string; description?: string; publicationDate?: string; foodNutrients?: { nutrient?: { id?: number }; nutrientId?: number; foodNutrientDerivation?: { code?: string } }[] };

/** Registry key -> FDC ids the map treats as the key's definition (non-gap), in preference order. */
const EXACT_IDS = new Map<string, number[]>();
/** Registry key -> FDC ids the map records as definition mismatches. */
const GAP_IDS = new Map<string, number[]>();
for (const entry of FDC_NUTRIENT_ENTRIES) {
    const target = entry.policy === 'gap' ? GAP_IDS : EXACT_IDS;
    target.set(entry.key, [...(target.get(entry.key) || []), entry.fdcNutrientId]);
}
EXACT_IDS.set('calories', [...ENERGY_PREFERENCE_ORDER]);
// fiber is documented as the same measurement as fiberTotal (1079).
EXACT_IDS.set('fiber', [1079]);

const quantified = (row?: ParsedRow) => !!row && Number.isFinite(row.amount) && !row.isBelowLoq;

export interface ExpectedOutcome {
    outcome: KeyOutcome;
    sourceNutrientId?: number;
    gapQualifier?: string;
}
/** What the source record says a key should become, without consulting the normalizer. */
export function expectedOutcome(key: string, rows: Map<number, ParsedRow>): ExpectedOutcome {
    if (key === 'omega3') {
        if (OMEGA3_COMPONENTS.every(id => quantified(rows.get(id))))
            return { outcome: 'resolved' };
        return { outcome: 'gap', gapQualifier: 'gap:partial_components' };
    }
    const exact = (EXACT_IDS.get(key) || []).map(id => rows.get(id)).filter((r): r is ParsedRow => !!r);
    const used = exact.find(quantified);
    if (used)
        return { outcome: 'resolved', sourceNutrientId: used.nutrientId };
    const loq = exact.find(r => r.isBelowLoq);
    if (loq)
        return { outcome: 'below_loq', sourceNutrientId: loq.nutrientId };
    if ((GAP_IDS.get(key) || []).some(id => rows.has(id)))
        return { outcome: 'gap', gapQualifier: 'gap:definition_mismatch' };
    if (exact.length)
        return { outcome: 'unknown' };
    return { outcome: 'absent' };
}

export interface RecordVerification {
    fdcId: number;
    dataType: string;
    keys: Record<string, KeyOutcome>;
    defects: string[];
    unitChecks: { pair: string; pass: boolean }[];
    zero: { preserved: number; lost: number; assumedZeroAsMeasured: number };
    nullStaysUnknown: number;
    absentStaysUnknown: number;
    loqPreserved: number;
    measuredDerivationCodes: Record<string, number>;
    energy: { hasKj: boolean; kjOnly: boolean; chosen: string | null; preferenceOk: boolean };
    policy: { vitaminAIuOnlyGap: number; vitaminAIuNeverConverted: boolean; folateTotalOnlyGap: number; vitaminKGap: number };
    provenance: { recordOk: boolean; fieldsOk: number; fieldsBad: number };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
/** The registry converter's value, or null when it refuses the conversion. */
const convertedValue = (key: string, amount: number, unit: string) => {
    const converted = convertUnit(key, amount, unit);
    return 'error' in converted ? null : converted.value;
};

/**
 * Checks one record's normalized output against its source. `raw` is the
 * pinned record, `parsed` the adapter's source result, `normalized` the
 * normalizer's output, and `release` the pin the record was read under.
 */
export function verifyNormalizedRecord(raw: RawFood, parsed: ParsedFood, normalized: Normalized, release: string): RecordVerification {
    const rows = new Map(parsed.nutrients.map(r => [r.nutrientId, r]));
    const codes = new Map<number, string>();
    for (const item of raw.foodNutrients || []) {
        const id = item?.nutrient?.id ?? item?.nutrientId;
        if (typeof id === 'number')
            codes.set(id, item.foodNutrientDerivation?.code || 'none');
    }
    const defects: string[] = [];
    const defect = (name: string) => defects.push(name);
    const keys: Record<string, KeyOutcome> = {};
    const unitChecks: RecordVerification['unitChecks'] = [];
    const zero = { preserved: 0, lost: 0, assumedZeroAsMeasured: 0 };
    let nullStaysUnknown = 0, absentStaysUnknown = 0, loqPreserved = 0, fieldsOk = 0, fieldsBad = 0;
    const measuredDerivationCodes: Record<string, number> = {};
    for (const key of PROFILE_FIELDS) {
        const expected = expectedOutcome(key, rows);
        keys[key] = expected.outcome;
        if (!(key in normalized.nutrients) || !normalized.nutrientMeta.quality[key]?.status) {
            defect(`key_unaccounted:${key}`);
            continue;
        }
        const value = normalized.nutrients[key];
        const quality = normalized.nutrientMeta.quality[key];
        const provenance = normalized.fieldProvenance[key];
        const provenanceOk = provenance?.sourceKey === normalized.sourceKey;
        switch (expected.outcome) {
            case 'resolved': {
                if (typeof value !== 'number' || !Number.isFinite(value) || !RESOLVED_STATUSES.has(quality.status!)) {
                    defect(`outcome_mismatch:${key}:resolved`);
                    break;
                }
                if (key === 'omega3') {
                    if (provenance?.derivation !== 'sum:ALA+EPA+DHA')
                        defect(`provenance_mismatch:${key}`);
                    const parts = OMEGA3_COMPONENTS.map(id => convertedValue('omega3', rows.get(id)!.amount!, rows.get(id)!.unitName));
                    const pass = parts.every(p => p !== null) && near(parts.reduce((sum: number, p) => sum + p!, 0), value);
                    unitChecks.push({ pair: 'sum(g)->g', pass });
                }
                else {
                    const row = rows.get(expected.sourceNutrientId!)!;
                    if (provenance?.sourceNutrientId !== String(expected.sourceNutrientId))
                        defect(`provenance_mismatch:${key}`);
                    if (key === 'fiber' && provenance?.derivation !== 'same_as:fiberTotal')
                        defect('provenance_mismatch:fiber_derivation');
                    const converted = convertedValue(key, row.amount!, row.unitName);
                    const from = normalizeUnit(row.unitName), to = getNutrient(key)!.unit;
                    unitChecks.push({ pair: from === to ? `${from} (identity)` : `${from}->${to}`, pass: converted !== null && near(converted, value) });
                    if (row.amount === 0) {
                        if (value === 0 && provenanceOk)
                            zero.preserved++;
                        else
                            zero.lost++;
                        if (codes.get(row.nutrientId) === 'Z' && quality.status === 'measured')
                            zero.assumedZeroAsMeasured++;
                    }
                    if (quality.status === 'measured') {
                        const code = codes.get(row.nutrientId) || 'none';
                        measuredDerivationCodes[code] = (measuredDerivationCodes[code] || 0) + 1;
                    }
                }
                provenanceOk ? fieldsOk++ : (fieldsBad++, defect(`field_provenance_missing:${key}`));
                break;
            }
            case 'below_loq':
                if (value !== null || quality.status !== 'below_quantification_limit' || !Number.isFinite(quality.upperBound))
                    defect(`outcome_mismatch:${key}:below_loq`);
                else
                    loqPreserved++;
                provenanceOk ? fieldsOk++ : (fieldsBad++, defect(`field_provenance_missing:${key}`));
                break;
            case 'gap':
                if (value !== null || quality.status !== 'unknown' || quality.qualifier !== expected.gapQualifier)
                    defect(`outcome_mismatch:${key}:gap`);
                if (provenance)
                    defect(`unexpected_provenance:${key}`);
                break;
            case 'unknown':
            case 'absent':
                if (value !== null || quality.status !== 'unknown' || quality.qualifier !== 'gap:not_reported_by_source')
                    defect(`outcome_mismatch:${key}:${expected.outcome}`);
                else if (expected.outcome === 'unknown')
                    nullStaysUnknown++;
                else
                    absentStaysUnknown++;
                if (provenance)
                    defect(`unexpected_provenance:${key}`);
                break;
        }
    }
    // Energy: preference 1008 > 2048 > 2047; kJ (1062) never maps to calories.
    const chosen = normalized.fieldProvenance.calories?.sourceNutrientId ?? null;
    const preferred = ENERGY_PREFERENCE_ORDER.find(id => quantified(rows.get(id)));
    const preferenceOk = preferred === undefined ? chosen === null || keys.calories === 'below_loq' : chosen === String(preferred);
    if (!preferenceOk)
        defect('energy_preference');
    if (chosen === String(KJ_ENERGY_ID))
        defect('energy_from_kj');
    const hasKj = rows.has(KJ_ENERGY_ID);
    const kjOnly = hasKj && !ENERGY_PREFERENCE_ORDER.some(id => rows.has(id));
    if (kjOnly && normalized.nutrients.calories !== null)
        defect('energy_from_kj');
    // Definition-mismatch policy: IU vitamin A and total folate stay gaps; never converted into RAE/DFE.
    const policy = { vitaminAIuOnlyGap: 0, vitaminAIuNeverConverted: true, folateTotalOnlyGap: 0, vitaminKGap: 0 };
    if (rows.has(1104) && !rows.has(1106)) {
        if (keys.vitaminA === 'gap' && normalized.nutrients.vitaminA === null)
            policy.vitaminAIuOnlyGap++;
        else
            defect('vitaminA_iu_converted');
    }
    if (normalized.nutrients.vitaminA !== null && normalized.fieldProvenance.vitaminA?.sourceNutrientId !== '1106') {
        policy.vitaminAIuNeverConverted = false;
        defect('vitaminA_not_from_rae');
    }
    if (rows.has(1177) && !rows.has(1190)) {
        if (keys.folate === 'gap' && normalized.nutrients.folate === null)
            policy.folateTotalOnlyGap++;
        else
            defect('folate_total_converted');
    }
    if (normalized.nutrients.folate !== null && normalized.fieldProvenance.folate?.sourceNutrientId !== '1190')
        defect('folate_not_from_dfe');
    if (rows.has(1185)) {
        if (normalized.nutrients.vitaminK === null && normalized.nutrientMeta.quality.vitaminK?.qualifier === 'gap:definition_mismatch')
            policy.vitaminKGap++;
        else
            defect('vitaminK_phylloquinone_mapped');
    }
    // Record provenance survives normalization.
    const record = normalized.sourceRecord;
    const checksum = 'sha256:' + createHash('sha256').update(canonicalJson(raw)).digest('hex');
    const recordChecks: [string, boolean][] = [
        ['recordId', record.recordId === String(raw.fdcId)],
        ['sourceKey', normalized.sourceKey === `fdc:${raw.fdcId}`],
        ['release', record.version === release && parsed.release === release],
        ['dataType', record.datasetId === raw.dataType],
        ['publishedAt', record.publishedAt === raw.publicationDate],
        ['checksum', record.checksum === checksum && parsed.checksum === checksum],
        ['title', record.title === String(raw.description || '').trim()],
        ['accessedAt', typeof record.accessedAt === 'string' && !!record.accessedAt],
        ['permittedUse', typeof record.permittedUse === 'string' && !!record.permittedUse],
    ];
    for (const [name, ok] of recordChecks)
        if (!ok)
            defect(`record_provenance:${name}`);
    return {
        fdcId: raw.fdcId, dataType: String(raw.dataType || ''), keys, defects, unitChecks, zero,
        nullStaysUnknown, absentStaysUnknown, loqPreserved, measuredDerivationCodes,
        energy: { hasKj, kjOnly, chosen, preferenceOk }, policy,
        provenance: { recordOk: recordChecks.every(([, ok]) => ok), fieldsOk, fieldsBad },
    };
}

/** Runs the pipeline's own parse + normalize path for one pinned record. */
export async function normalizeThroughAdapter(raw: unknown, release: string, cache: SourceCache = createMemorySourceCache()) {
    const adapter = createFdcBulkAdapter({ cache, release, matches: [] });
    const parsed = await adapter.toSourceResult(raw, { release }) as unknown as ParsedFood;
    const normalized = normalizeSourceResult(parsed, {}) as unknown as Normalized;
    return { parsed, normalized };
}

export interface DatasetSummary {
    id: string;
    release: string;
    total: number;
    parsed: number;
    blocked: number;
    checked: number;
    a1Checked: number;
    sampleChecked: number;
    recordsWithDefects: number;
    keyCoverage: Record<string, Record<KeyOutcome, number>>;
    outcomeTotals: Record<KeyOutcome, number>;
}
const emptyCoverage = () => Object.fromEntries(KEY_OUTCOMES.map(o => [o, 0])) as Record<KeyOutcome, number>;
/** Folds record verifications into value-free aggregate counts. */
export function summarizeVerifications(results: RecordVerification[]) {
    const keyCoverage: Record<string, Record<KeyOutcome, number>> = Object.fromEntries(PROFILE_FIELDS.map(k => [k, emptyCoverage()]));
    const outcomeTotals = emptyCoverage();
    const unitSpotChecks: Record<string, { pass: number; fail: number }> = {};
    const defects: Record<string, { count: number; exampleFdcIds: number[] }> = {};
    const zeroVsUnknown = { zeroPreserved: 0, zeroLost: 0, assumedZeroReportedAsMeasured: 0, nullAmountStaysUnknown: 0, absentStaysUnknown: 0, belowLoqPreserved: 0 };
    const energy = { recordsWithKj: 0, recordsWithKjOnly: 0, preferenceOk: 0, preferenceFail: 0, chosen: {} as Record<string, number> };
    const policy = { vitaminAIuOnlyGap: 0, vitaminAIuConverted: 0, folateTotalOnlyGap: 0, vitaminKPhylloquinoneGap: 0 };
    const provenance = { recordsOk: 0, recordsBad: 0, fieldsOk: 0, fieldsBad: 0 };
    const measuredDerivationCodes: Record<string, number> = {};
    for (const r of results) {
        for (const [key, outcome] of Object.entries(r.keys)) {
            keyCoverage[key][outcome]++;
            outcomeTotals[outcome]++;
        }
        for (const check of r.unitChecks) {
            const row = unitSpotChecks[check.pair] ||= { pass: 0, fail: 0 };
            check.pass ? row.pass++ : row.fail++;
        }
        for (const name of r.defects) {
            const row = defects[name] ||= { count: 0, exampleFdcIds: [] };
            row.count++;
            if (row.exampleFdcIds.length < 5 && !row.exampleFdcIds.includes(r.fdcId))
                row.exampleFdcIds.push(r.fdcId);
        }
        zeroVsUnknown.zeroPreserved += r.zero.preserved;
        zeroVsUnknown.zeroLost += r.zero.lost;
        zeroVsUnknown.assumedZeroReportedAsMeasured += r.zero.assumedZeroAsMeasured;
        zeroVsUnknown.nullAmountStaysUnknown += r.nullStaysUnknown;
        zeroVsUnknown.absentStaysUnknown += r.absentStaysUnknown;
        zeroVsUnknown.belowLoqPreserved += r.loqPreserved;
        energy.recordsWithKj += r.energy.hasKj ? 1 : 0;
        energy.recordsWithKjOnly += r.energy.kjOnly ? 1 : 0;
        r.energy.preferenceOk ? energy.preferenceOk++ : energy.preferenceFail++;
        const chosen = r.energy.chosen ?? 'none';
        energy.chosen[chosen] = (energy.chosen[chosen] || 0) + 1;
        policy.vitaminAIuOnlyGap += r.policy.vitaminAIuOnlyGap;
        policy.vitaminAIuConverted += r.policy.vitaminAIuNeverConverted ? 0 : 1;
        policy.folateTotalOnlyGap += r.policy.folateTotalOnlyGap;
        policy.vitaminKPhylloquinoneGap += r.policy.vitaminKGap;
        r.provenance.recordOk ? provenance.recordsOk++ : provenance.recordsBad++;
        provenance.fieldsOk += r.provenance.fieldsOk;
        provenance.fieldsBad += r.provenance.fieldsBad;
        for (const [code, n] of Object.entries(r.measuredDerivationCodes))
            measuredDerivationCodes[code] = (measuredDerivationCodes[code] || 0) + n;
    }
    return {
        records: results.length,
        recordsWithDefects: results.filter(r => r.defects.length).length,
        keyCoverage, outcomeTotals, unitSpotChecks, zeroVsUnknown, energy, policy, provenance,
        measuredDerivationCodes, defects,
    };
}

/** Deterministic sample: sort by fdcId, then take evenly spaced records. */
export function deterministicSample<T extends { fdcId?: unknown }>(foods: T[], size: number, exclude: ReadonlySet<number> = new Set()) {
    const pool = foods.filter(f => !exclude.has(f.fdcId as number)).sort((a, b) => (a.fdcId as number) - (b.fdcId as number));
    if (size >= pool.length)
        return pool;
    const stride = pool.length / size;
    return Array.from({ length: size }, (_, i) => pool[Math.floor(i * stride)]);
}

export interface ProposedMatch {
    manifestId: string;
    dataset: string;
    fdcId: number;
    dataType: string;
    description: string;
}
/** The 17 proposed matches of docs/nutrition/population-batch-a1-report.md (public ids and descriptions). */
export const A1_PROPOSED_MATCHES: readonly ProposedMatch[] = Object.freeze([
    ['lemon-juice-fresh-ready-to-drink', 'sr-legacy', 167747, 'Lemon juice, raw'],
    ['lime-juice-fresh-ready-to-drink', 'sr-legacy', 168156, 'Lime juice, raw'],
    ['orange-juice-fresh-ready-to-drink', 'sr-legacy', 169098, 'Orange juice, raw'],
    ['pomegranate-juice-100-percent-ready-to-drink', 'foundation', 2727588, 'Juice, pomegranate, from concentrate, shelf-stable'],
    ['breadcrumbs-plain-as-sold', 'sr-legacy', 174928, 'Bread, crumbs, dry, grated, plain'],
    ['chocolate-chips-semisweet-as-sold', 'sr-legacy', 167976, 'Candies, semisweet chocolate'],
    ['chocolate-dark-45-59-percent-cacao-as-sold', 'sr-legacy', 170271, 'Chocolate, dark, 45- 59% cacao solids'],
    ['chocolate-dark-60-69-percent-cacao-as-sold', 'sr-legacy', 170272, 'Chocolate, dark, 60-69% cacao solids'],
    ['chocolate-dark-70-85-percent-cacao-as-sold', 'sr-legacy', 170273, 'Chocolate, dark, 70-85% cacao solids'],
    ['chocolate-milk-as-sold', 'sr-legacy', 167587, 'Candies, milk chocolate'],
    ['chocolate-unsweetened-baking-as-sold', 'sr-legacy', 167568, 'Baking chocolate, unsweetened, squares'],
    ['chocolate-white-as-sold', 'sr-legacy', 167571, 'Candies, white chocolate'],
    ['cocoa-powder-unsweetened-dutch-process-as-sold', 'sr-legacy', 169594, 'Cocoa, dry powder, unsweetened, processed with alkali'],
    ['cocoa-powder-unsweetened-natural-as-sold', 'sr-legacy', 169593, 'Cocoa, dry powder, unsweetened'],
    ['mayonnaise-regular-as-sold', 'foundation', 2758986, 'Mayonnaise, Regular'],
    ['salsa-red-as-sold', 'foundation', 746777, 'Sauce, salsa, ready-to-serve'],
    ['soy-sauce-regular-as-sold', 'sr-legacy', 174277, 'Soy sauce made from soy and wheat (shoyu)'],
].map(([manifestId, dataset, fdcId, description]) => ({
    manifestId: manifestId as string, dataset: dataset as string, fdcId: fdcId as number, description: description as string,
    dataType: dataset === 'foundation' ? 'Foundation' : 'SR Legacy',
})));

export interface VerificationDataset {
    pin: DatasetPin;
    file: string;
}
export interface VerificationOptions {
    datasets: VerificationDataset[];
    proposed?: readonly ProposedMatch[];
    manifest?: ManifestEntry[];
    sampleSize?: number;
    all?: boolean;
}
/**
 * Verifies the proposed records plus a deterministic sample (or, with `all`,
 * every parsed record) of each pinned dataset. Returns aggregate counts only.
 */
export async function runNormalizationVerification({ datasets, proposed = A1_PROPOSED_MATCHES, manifest = [], sampleSize = 100, all = false }: VerificationOptions) {
    const cache = createMemorySourceCache();
    const perDataset: Record<string, ReturnType<typeof summarizeVerifications> & { release: string; total: number; parsed: number; blocked: number; a1Checked: number; sampleChecked: number }> = {};
    const allResults: RecordVerification[] = [];
    const recordsById = new Map<string, Map<number, Record<string, unknown>>>();
    for (const { pin, file } of datasets) {
        // Pin and checksum are verified on load (auditPinnedBulk throws otherwise).
        const audit = await auditPinnedBulk(file, pin);
        // PR #213's indexBulk: parsed records only; a duplicate fdcId is fatal.
        await indexBulk(file, pin, cache);
        const byId = new Map(audit.foods.map(f => [f.fdcId as number, f]));
        recordsById.set(pin.id, byId);
        const proposedIds = new Set(proposed.filter(p => p.dataset === pin.id).map(p => p.fdcId));
        const proposedFoods = [...proposedIds].map(id => byId.get(id)).filter((f): f is Record<string, unknown> => !!f);
        const sample = all ? audit.foods.filter(f => !proposedIds.has(f.fdcId as number)) : deterministicSample(audit.foods, sampleSize, proposedIds);
        const results: RecordVerification[] = [];
        for (const raw of [...proposedFoods, ...sample]) {
            const { parsed, normalized } = await normalizeThroughAdapter(raw, pin.release);
            results.push(verifyNormalizedRecord(raw as RawFood, parsed, normalized, pin.release));
        }
        allResults.push(...results);
        perDataset[pin.id] = { release: pin.release, total: audit.total, parsed: audit.parsedCount, blocked: audit.failures.length, a1Checked: proposedFoods.length, sampleChecked: sample.length, ...summarizeVerifications(results) };
    }
    const a1 = await verifyProposedMatches(proposed, datasets, recordsById, cache, manifest);
    return {
        mode: all ? 'all-parsed-records' : `deterministic-sample-${sampleSize}-per-dataset`,
        datasets: perDataset,
        combined: summarizeVerifications(allResults),
        a1,
    };
}

/**
 * The proposed matches, run as one mixed-release batch through the research
 * service with in-memory (unreviewed, verification-only) entries, then checked
 * with the fail-closed reviewed-table gate.
 */
async function verifyProposedMatches(proposed: readonly ProposedMatch[], datasets: VerificationDataset[], recordsById: Map<string, Map<number, Record<string, unknown>>>, cache: SourceCache, manifest: ManifestEntry[]) {
    const pins = new Map(datasets.map(d => [d.pin.id, d.pin]));
    const outcome = {
        proposed: proposed.length, foundInPinnedFile: 0, parsed: 0, descriptionMatches: 0, dataTypeMatches: 0,
        runJob: { needsReview: 0, blocked: 0, blockedCodes: {} as Record<string, number> },
        draftAgreesWithNormalized: 0, draftDisagrees: 0,
        stampedWithOwnRelease: 0, stampedWithOtherRelease: 0,
        tableCheck: { exactEntryPasses: 0, noEntryFails: 0, wrongReleaseFails: 0, wrongDataTypeFails: 0, reportDescriptionFails: 0 },
        problems: [] as { fdcId: number; check: string }[],
    };
    const present = proposed.filter(p => pins.has(p.dataset));
    const entries: MatchEntry[] = [];
    for (const p of present) {
        const raw = recordsById.get(p.dataset)?.get(p.fdcId) as RawFood | undefined;
        if (!raw) {
            outcome.problems.push({ fdcId: p.fdcId, check: 'not_parsed_in_pinned_file' });
            continue;
        }
        outcome.foundInPinnedFile++;
        outcome.parsed++;
        // The report quotes descriptions; a reviewed entry must carry the record's verbatim text.
        const verbatim = String(raw.description).trim();
        if (verbatim === p.description) outcome.descriptionMatches++;
        else outcome.problems.push({ fdcId: p.fdcId, check: 'report_description_not_verbatim' });
        if (raw.dataType === p.dataType) outcome.dataTypeMatches++;
        else outcome.problems.push({ fdcId: p.fdcId, check: 'data_type_differs_from_report' });
        entries.push({
            manifestId: p.manifestId, adapter: 'fdc_bulk', dataType: p.dataType, fdcId: String(p.fdcId), release: pins.get(p.dataset)!.release,
            description: verbatim, stateEvidence: 'verification only; not a reviewed entry', rationale: 'verification only; not a reviewed entry',
            reviewer: 'normalization-verification', reviewedAt: '2026-11-10', checklistVersion: 1,
        });
    }
    if (!entries.length)
        return outcome;
    const matches = await validateMatchTable({ schemaVersion: 1, entries });
    // One adapter for the whole mixed batch, constructed with the first dataset's release.
    const adapter = createFdcBulkAdapter({ cache, release: datasets[0].pin.release, matches });
    const service = createResearchService({ store: createMemoryResearchStore(), sourceCache: cache, adapters: [adapter] });
    const byManifest = new Map(manifest.map(e => [e.id, e]));
    for (const entry of matches) {
        const m = byManifest.get(entry.manifestId);
        const dims = m ? stateToDims(m.state).dims : { state: 'unspecified' };
        const job = await service.enqueue({ target: { ...(m || {}), manifestId: entry.manifestId, canonicalName: m?.name || entry.manifestId, dims } });
        const ran = await service.runJob(job.jobId);
        if (ran.state !== 'needs_review') {
            outcome.runJob.blocked++;
            const code = ran.blocked?.code || ran.state;
            outcome.runJob.blockedCodes[code] = (outcome.runJob.blockedCodes[code] || 0) + 1;
            outcome.problems.push({ fdcId: Number(entry.fdcId), check: `run_job_${code}` });
            continue;
        }
        outcome.runJob.needsReview++;
        const draft = ran.proposal!.revisionDraft!;
        const source = Object.values(draft.sources as Record<string, { recordId?: string; version?: string }>).find(s => s.recordId === entry.fdcId);
        if (source?.version === entry.release) outcome.stampedWithOwnRelease++;
        else outcome.stampedWithOtherRelease++;
        // The draft keeps the normalizer's values and statuses for every field.
        const pin = [...pins.values()].find(p => p.release === entry.release)!;
        const raw = recordsById.get(pin.id)!.get(Number(entry.fdcId));
        const { normalized } = await normalizeThroughAdapter(raw, entry.release);
        const agrees = PROFILE_FIELDS.every(key => (draft.nutrients[key] ?? null) === (normalized.nutrients[key] ?? null)
            && canonicalJson(draft.nutrientMeta.quality[key] ?? null) === canonicalJson(normalized.nutrientMeta.quality[key] ?? null));
        if (agrees) outcome.draftAgreesWithNormalized++;
        else {
            outcome.draftDisagrees++;
            outcome.problems.push({ fdcId: Number(entry.fdcId), check: 'draft_differs_from_normalized' });
        }
        const fails = (table: unknown[]) => { try { assertCuratedMatchTable(ran, table as never); return false; } catch { return true; } };
        if (!fails([entry])) outcome.tableCheck.exactEntryPasses++;
        if (fails([])) outcome.tableCheck.noEntryFails++;
        if (fails([{ ...entry, release: entry.release + '-other' }])) outcome.tableCheck.wrongReleaseFails++;
        if (fails([{ ...entry, dataType: entry.dataType === 'Foundation' ? 'SR Legacy' : 'Foundation' }])) outcome.tableCheck.wrongDataTypeFails++;
        // An entry that copied a non-verbatim report description is refused too.
        const reported = proposed.find(p => p.manifestId === entry.manifestId)!.description;
        if (reported !== entry.description && fails([{ ...entry, description: reported }])) outcome.tableCheck.reportDescriptionFails++;
    }
    return outcome;
}
