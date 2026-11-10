/**
 * #76 priority-1 population pilot, dry run.
 *
 * Offline and deterministic. Inputs are the committed catalog, the synthetic
 * reviewed match table, and the pinned synthetic FDC fixtures. Matched
 * identities go through the real research service path (bulk adapter ->
 * parseFdcFood -> normalizeSourceResult -> buildRevisionDraft ->
 * validateProposal) in an in-memory store. Nothing is written except the
 * aggregate report, and only when the CLI is asked to write it.
 *
 * This module must not import the live FDC API adapter or researchCli.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createMemoryResearchStore, createMemorySourceCache } from '../../public/shared/nutrition/research/memoryResearchStore.js';
import { createResearchService } from '../../public/shared/nutrition/research/researchService.js';
import { parentBatchIdFor, passIdFor } from '../../public/shared/nutrition/research/researchJob.js';
import { PROFILE_FIELDS } from '../../public/shared/nutrition/research/profileFields.js';
import { NUTRIENT_V2_WRITES_ENABLED, INGREDIENT_STORE_WRITES_ENABLED } from '../../public/shared/nutrition/capabilities.js';
import { readManifest, stateToDims, type ManifestEntry } from './manifestReader';
import { validateMatchTable, type MatchEntry } from './matchTable';
import { createFdcBulkAdapter, indexPinnedRecord, readPinnedRecord, type DatasetPin } from './fdcBulkReader';

export const DRY_RUN_REPORT_PATH = 'docs/nutrition/dry-run-pilot-report.md';
export const DRY_RUN_COMMAND = 'npx --no-install vite-node scripts/nutrition/dryRunPilotCli.ts -- --date YYYY-MM-DD';
export const CATALOG_PATH = 'docs/nutrition/ingredient-catalog.json';
export const MATCH_TABLE_FIXTURE = 'scripts/fixtures/nutrition/match-table-mini.json';
export const FIXTURE_DIR = 'scripts/fixtures/nutrition/fdc';
export const EXPECTED_CATALOG_COUNT = 1114;
export const EXPECTED_PRIORITY_1 = 253;
export const UNRESOLVED_OUTCOME = 'unresolved_no_pinned_local_source';
export const FIELD_STATUSES = ['measured', 'label_reported', 'calculated', 'estimated_from_comparable', 'below_quantification_limit', 'unknown', 'not_applicable'] as const;

/** Roles: `bulk` and `quality` are indexed into the offline bulk cache; `api_shape` is parsed only; `malformed` must fail. */
export type FixtureRole = 'bulk' | 'quality' | 'api_shape' | 'malformed';
export const FIXTURE_SET: readonly { file: string; role: FixtureRole }[] = Object.freeze([
    { file: 'apple-api.json', role: 'api_shape' },
    { file: 'apple-bulk.json', role: 'bulk' },
    { file: 'legume-bulk.json', role: 'bulk' },
    { file: 'oil-bulk.json', role: 'bulk' },
    { file: 'salt-additive-bulk.json', role: 'bulk' },
    { file: 'loq-food.json', role: 'quality' },
    { file: 'mismatch-vitamins.json', role: 'quality' },
    { file: 'malformed-duplicate-nutrient.json', role: 'malformed' },
    { file: 'malformed-missing-id.json', role: 'malformed' },
    { file: 'malformed-string-amount.json', role: 'malformed' },
]);

export type IdentityOutcome = 'validated' | 'failed_validation' | typeof UNRESOLVED_OUTCOME;

export interface DryRunOptions {
    /** Report date (YYYY-MM-DD). Also fixes the service clock so runs are reproducible. */
    date: string;
    /** Test seams. Defaults are the committed catalog, match table, and fixtures. */
    entries?: ManifestEntry[];
    matchTable?: unknown;
    fixtureDir?: string;
    fixtures?: readonly { file: string; role: FixtureRole }[];
    expectedPriority1?: number;
}

export interface FixtureCheck {
    file: string;
    role: FixtureRole;
    sha256: string;
    ok: boolean;
    indexed: boolean;
    failureCategory: string | null;
}

export interface DryRunSummary {
    date: string;
    inputs: {
        catalog: string;
        catalogCount: number;
        priority1Count: number;
        matchTable: string;
        matchTableEntries: number;
        matchTableEntriesInPriority1: number;
        sourceRelease: string;
        fixtureDir: string;
        fixtures: FixtureCheck[];
    };
    identities: {
        attempted: number;
        matched: number;
        unresolved: number;
        validated: number;
        failedValidation: number;
        lookupsRun: number;
        outcomes: Record<string, number>;
        matchedByKind: Record<string, number>;
        matchedByState: Record<string, number>;
    };
    coverage: {
        storedFieldCount: number;
        validatedProfiles: number;
        fieldStatus: Record<string, number>;
        total: number;
    };
    unresolvedFields: { unknown: number; byGapReason: Record<string, number> };
    uncertainty: {
        belowQuantificationLimit: number;
        estimatedWithComparatorAndRange: number;
        estimatedMissingComparatorOrRange: number;
        roundingInterval: number;
        upperBound: number;
    };
    validationFailures: {
        fixtureChecks: { checked: number; passed: number; failed: number; byCategory: Record<string, number> };
        matchedProfiles: { failed: number; byCategory: Record<string, number> };
        warningsByCategory: Record<string, number>;
        total: number;
    };
    wouldBeProductionChanges: {
        profilesCreated: number;
        stagedRecords: number;
        portionConversions: number;
        identitiesStayQueued: number;
        identitiesBlocked: number;
    };
    writesPerformed: { catalog: 0; stagedShards: 0; firestore: 0; flagChanges: 0 };
    flags: { NUTRIENT_V2_WRITES_ENABLED: boolean; INGREDIENT_STORE_WRITES_ENABLED: boolean };
    reconciliation: {
        attemptedEqualsPriority1: boolean;
        matchedPlusUnresolvedEqualsAttempted: boolean;
        validatedSubsetOfMatched: boolean;
        fieldStatusTotalEqualsFieldsTimesValidated: boolean;
    };
}

export interface DryRunResult {
    summary: DryRunSummary;
    /** Per-identity outcomes for tests only. Never rendered into the report. */
    identityOutcomes: Record<string, IdentityOutcome>;
}

const sha256 = (data: Buffer) => 'sha256:' + createHash('sha256').update(data).digest('hex');
const bump = (map: Record<string, number>, key: string, by = 1) => { map[key] = (map[key] || 0) + by; };
const sorted = (map: Record<string, number>) => Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));

/** Parse/pin failure category. Messages may carry ids or values, so only the category is kept. */
export function fixtureFailureCategory(message: string) {
    if (/missing fdcId/i.test(message)) return 'missing_fdc_id';
    if (/Duplicate nutrientId/i.test(message)) return 'duplicate_nutrient_id';
    if (/Non-numeric amount/i.test(message)) return 'non_numeric_amount';
    if (/checksum mismatch|unpinned/i.test(message)) return 'pin_mismatch';
    if (/unlabeled/i.test(message)) return 'unlabeled_fixture';
    return 'malformed_record_other';
}
/** Validator error category for a matched profile. */
export function validationErrorCategory(message: string) {
    if (/^Explicit conflict/.test(message)) return 'state_conflict';
    if (/compound-reference/.test(message)) return 'source_strategy_conflict';
    if (/Branded entry requires/.test(message)) return 'branded_requires_label';
    if (/concentration/.test(message)) return 'composition_required';
    if (/Identity match conflict/.test(message)) return 'identity_conflict';
    if (/checkPer100g/.test(message)) return 'per_100g_bounds';
    if (/has no status|requires non-null/.test(message)) return 'field_status';
    if (/Zero without evidence/.test(message)) return 'zero_without_evidence';
    if (/Estimate requires/.test(message)) return 'estimate_incomplete';
    if (/provenance/i.test(message)) return 'provenance';
    if (/permittedUse|license/i.test(message)) return 'license';
    if (/^Source /.test(message)) return 'source_metadata';
    if (/hash/i.test(message)) return 'revision_hash';
    return 'validator_other';
}
export function validationWarningCategory(message: string) {
    if (/unspecified/.test(message)) return 'state_unspecified';
    if (/Atwater/.test(message)) return 'atwater_inconsistency';
    if (/exceeds total/.test(message)) return 'component_sum';
    if (/unit mix-up/.test(message)) return 'unit_mixup';
    if (/requires review/.test(message)) return 'per_100g_review';
    return 'warning_other';
}

export async function runDryRunPilot(options: DryRunOptions): Promise<DryRunResult> {
    const { date } = options;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')))
        throw new Error('Dry run requires --date YYYY-MM-DD');
    if (NUTRIENT_V2_WRITES_ENABLED !== false || INGREDIENT_STORE_WRITES_ENABLED !== false)
        throw new Error('Dry run refuses to run with a write flag enabled');
    const fixtureDir = options.fixtureDir || FIXTURE_DIR;
    const fixtures = options.fixtures || FIXTURE_SET;
    const expectedPriority1 = options.expectedPriority1 ?? EXPECTED_PRIORITY_1;

    // 1. Catalog and priority-1 selection.
    const entries = options.entries || await readManifest(CATALOG_PATH, EXPECTED_CATALOG_COUNT);
    const priority1 = entries.filter(e => e.priority === 1).sort((a, b) => a.id.localeCompare(b.id));
    if (priority1.length !== expectedPriority1)
        throw new Error(`Catalog changed: expected ${expectedPriority1} priority-1 entries, found ${priority1.length}`);

    // 2. Reviewed match table (synthetic) intersected with priority 1.
    const rawTable = options.matchTable ?? JSON.parse(await readFile(MATCH_TABLE_FIXTURE, 'utf8'));
    const table = await validateMatchTable(rawTable) as (MatchEntry & { hash: string })[];
    const p1Ids = new Set(priority1.map(e => e.id));
    const matches = table.filter(m => m.adapter === 'fdc_bulk' && p1Ids.has(m.manifestId));
    const releases = [...new Set(table.map(m => m.release))];
    if (releases.length > 1)
        throw new Error('Dry run expects one fixture release in the match table');
    const release = releases[0] || 'unconfigured';

    // 3. Pinned fixtures: pin = sha256 of the committed bytes; synthetic label required.
    const cache = createMemorySourceCache();
    const fixtureChecks: FixtureCheck[] = [];
    for (const { file, role } of fixtures) {
        const full = path.join(fixtureDir, file);
        const pin: DatasetPin = { id: file, release, sha256: sha256(await readFile(full)), fixtureOnly: true };
        const indexable = role === 'bulk' || role === 'quality';
        const check: FixtureCheck = { file, role, sha256: pin.sha256!, ok: true, indexed: false, failureCategory: null };
        try {
            if (indexable) {
                await indexPinnedRecord(full, pin, cache);
                check.indexed = true;
            }
            else
                await readPinnedRecord(full, pin);
        }
        catch (error) {
            check.ok = false;
            check.failureCategory = fixtureFailureCategory(String((error as Error).message));
        }
        fixtureChecks.push(check);
    }

    // 4. Real service path for matched identities only. No other adapter is registered.
    const fixedNow = Date.parse(date + 'T00:00:00Z');
    const store = createMemoryResearchStore();
    const adapter = createFdcBulkAdapter({ cache, release, matches });
    const service = createResearchService({ store, sourceCache: cache, adapters: [adapter], now: () => fixedNow, sleep: async () => {}, random: () => 0.5, retry: { maxAttempts: 1, baseMs: 0, maxMs: 0 } });
    const matchedEntries = priority1.filter(e => matches.some(m => m.manifestId === e.id));
    const parentBatchId = await parentBatchIdFor({ priority: 1, category: 'all', manifestIds: matchedEntries.map(e => e.id) });
    const passId = await passIdFor({ parentBatchId, adapter: 'fdc_bulk', sourceRelease: release });

    const identityOutcomes: Record<string, IdentityOutcome> = {};
    const outcomes: Record<string, number> = {};
    const matchedByKind: Record<string, number> = {}, matchedByState: Record<string, number> = {};
    const fieldStatus: Record<string, number> = Object.fromEntries(FIELD_STATUSES.map(s => [s, 0]));
    const byGapReason: Record<string, number> = {};
    const profileFailures: Record<string, number> = {}, warningsByCategory: Record<string, number> = {};
    const uncertainty = { belowQuantificationLimit: 0, estimatedWithComparatorAndRange: 0, estimatedMissingComparatorOrRange: 0, roundingInterval: 0, upperBound: 0 };
    let validated = 0, failedValidation = 0, unknownFields = 0, portionConversions = 0, lookupsRun = 0;

    for (const e of matchedEntries) {
        const { dims, needsReview } = stateToDims(e.state);
        bump(matchedByKind, e.kind);
        bump(matchedByState, e.state);
        const queued = await service.enqueue({ parentBatchId, passId, sourceRelease: release, fields: '*', target: { ...e, manifestId: e.id, canonicalName: e.name, dims, needsReview, catalogState: e.state } });
        const job = await service.runJob(queued.jobId, { adapterId: 'fdc_bulk' });
        lookupsRun++;
        const validation = job.validation as { isValid: boolean; errors: string[]; warnings: string[] } | null;
        for (const w of validation?.warnings || [])
            bump(warningsByCategory, validationWarningCategory(w));
        if (job.state !== 'needs_review' || !validation?.isValid) {
            failedValidation++;
            identityOutcomes[e.id] = 'failed_validation';
            bump(outcomes, 'failed_validation');
            if (job.state === 'blocked')
                bump(profileFailures, 'blocked:' + (job.blocked?.code || 'unknown'));
            for (const category of new Set((validation?.errors || []).map(validationErrorCategory)))
                bump(profileFailures, category);
            continue;
        }
        validated++;
        identityOutcomes[e.id] = 'validated';
        bump(outcomes, 'validated');
        const draft = job.proposal.revisionDraft;
        portionConversions += (job.proposal.conversions || []).length;
        for (const key of PROFILE_FIELDS) {
            const q = draft.nutrientMeta?.quality?.[key] || {};
            const status = q.status as string;
            if (!FIELD_STATUSES.includes(status as typeof FIELD_STATUSES[number]))
                throw new Error('Validated profile has a field without a known status');
            fieldStatus[status]++;
            const provenance = draft.fieldProvenance?.[key] || {};
            if (status === 'unknown') {
                unknownFields++;
                bump(byGapReason, typeof q.qualifier === 'string' && q.qualifier.startsWith('gap:') ? q.qualifier.slice(4) : 'unspecified');
            }
            if (status === 'below_quantification_limit') uncertainty.belowQuantificationLimit++;
            if (status === 'estimated_from_comparable') {
                if (provenance.comparatorRef && provenance.range) uncertainty.estimatedWithComparatorAndRange++;
                else uncertainty.estimatedMissingComparatorOrRange++;
            }
            if (q.roundingInterval != null) uncertainty.roundingInterval++;
            if (q.upperBound != null) uncertainty.upperBound++;
        }
    }
    // 5. Every other priority-1 identity: no reviewed local match and no pinned source, so no lookup ran.
    for (const e of priority1)
        if (!identityOutcomes[e.id]) {
            identityOutcomes[e.id] = UNRESOLVED_OUTCOME;
            bump(outcomes, UNRESOLVED_OUTCOME);
        }

    const attempted = priority1.length, matched = matchedEntries.length, unresolved = attempted - matched;
    const fixtureFailures: Record<string, number> = {};
    for (const c of fixtureChecks)
        if (c.failureCategory) bump(fixtureFailures, c.failureCategory);
    const fixturesFailed = fixtureChecks.filter(c => !c.ok).length;
    const total = Object.values(fieldStatus).reduce((a, b) => a + b, 0);
    const summary: DryRunSummary = {
        date,
        inputs: {
            catalog: CATALOG_PATH,
            catalogCount: entries.length,
            priority1Count: priority1.length,
            matchTable: MATCH_TABLE_FIXTURE,
            matchTableEntries: table.length,
            matchTableEntriesInPriority1: matches.length,
            sourceRelease: release,
            fixtureDir: FIXTURE_DIR,
            fixtures: fixtureChecks,
        },
        identities: { attempted, matched, unresolved, validated, failedValidation, lookupsRun, outcomes: sorted(outcomes), matchedByKind: sorted(matchedByKind), matchedByState: sorted(matchedByState) },
        coverage: { storedFieldCount: PROFILE_FIELDS.length, validatedProfiles: validated, fieldStatus, total },
        unresolvedFields: { unknown: unknownFields, byGapReason: sorted(byGapReason) },
        uncertainty,
        validationFailures: {
            fixtureChecks: { checked: fixtureChecks.length, passed: fixtureChecks.length - fixturesFailed, failed: fixturesFailed, byCategory: sorted(fixtureFailures) },
            matchedProfiles: { failed: failedValidation, byCategory: sorted(profileFailures) },
            warningsByCategory: sorted(warningsByCategory),
            total: fixturesFailed + failedValidation,
        },
        wouldBeProductionChanges: { profilesCreated: validated, stagedRecords: validated, portionConversions, identitiesStayQueued: unresolved, identitiesBlocked: failedValidation },
        writesPerformed: { catalog: 0, stagedShards: 0, firestore: 0, flagChanges: 0 },
        flags: { NUTRIENT_V2_WRITES_ENABLED, INGREDIENT_STORE_WRITES_ENABLED },
        reconciliation: {
            attemptedEqualsPriority1: attempted === priority1.length,
            matchedPlusUnresolvedEqualsAttempted: matched + unresolved === attempted && (outcomes[UNRESOLVED_OUTCOME] || 0) === unresolved,
            validatedSubsetOfMatched: validated + failedValidation === matched && Object.entries(identityOutcomes).filter(([, o]) => o === 'validated').every(([id]) => matches.some(m => m.manifestId === id)),
            fieldStatusTotalEqualsFieldsTimesValidated: total === PROFILE_FIELDS.length * validated,
        },
    };
    if (!Object.values(summary.reconciliation).every(Boolean))
        throw new Error('Dry-run reconciliation failed');
    return { summary, identityOutcomes };
}

const row = (label: string, value: string | number) => `| ${label} | ${value} |`;
const mapRows = (map: Record<string, number>) => Object.keys(map).length ? Object.entries(map).map(([k, v]) => row('`' + k + '`', v)) : [row('none', 0)];

/** Aggregate-only markdown. No food name, catalog id, FDC id, or nutrient value is rendered. */
export function renderDryRunReport(s: DryRunSummary) {
    const id = s.identities, cov = s.coverage, vf = s.validationFailures, w = s.wouldBeProductionChanges;
    return [
        '# Priority-1 population pilot: dry-run report (#76)',
        '',
        '<!-- Generated by scripts/nutrition/dryRunPilot.ts through dryRunPilotCli.ts. Do not edit by hand. -->',
        '',
        `Generated: ${s.date}. Regenerate from the repository root with \`${DRY_RUN_COMMAND}\`; add \`--check\` to verify this file without writing it.`,
        '',
        'Aggregate counts only. This report names no food, catalog id, source record id, or nutrient value. It is a dry run on pinned synthetic fixtures committed to the repository. No live FDC or manufacturer request was made, no catalog entry or staged shard was written, nothing was written to Firestore, and no write flag changed.',
        '',
        '## Method',
        '',
        `1. Read \`${s.inputs.catalog}\` with the manifest reader (values refused) and select priority 1. The run stops if the count is not ${s.inputs.priority1Count}.`,
        `2. Validate the synthetic reviewed match table \`${s.inputs.matchTable}\` and keep only its \`fdc_bulk\` entries whose manifest id is a priority-1 catalog id. Entries for identities outside priority 1 are not forced in. The production match table is empty.`,
        `3. Pin each fixture in \`${s.inputs.fixtureDir}\` by the sha256 of its committed bytes, require the synthetic label, and parse it with the shared FDC parser. Bulk and quality fixtures are indexed into an in-memory bulk cache; the API-shape fixture is parsed only.`,
        '4. Run each matched identity through the research service with only the offline bulk adapter registered: match, fetch from the pinned cache, normalize, build the revision draft, and validate. The target keeps its catalog state and kind; a state or source-strategy conflict is a validation failure, not a match.',
        `5. Every other priority-1 identity is recorded as \`${UNRESOLVED_OUTCOME}\`. No reviewed local match or pinned source exists for it, so no lookup ran and no official miss is claimed.`,
        '',
        '## Inputs',
        '',
        '| Input | Value |',
        '| --- | --- |',
        row('Catalog entries', s.inputs.catalogCount),
        row('Priority-1 entries', s.inputs.priority1Count),
        row('Synthetic match-table entries', s.inputs.matchTableEntries),
        row('Match-table entries that are priority-1 catalog ids', s.inputs.matchTableEntriesInPriority1),
        row('Fixture release label', '`' + s.inputs.sourceRelease + '`'),
        '',
        '| Fixture | Role | Pin | Parse and pin check |',
        '| --- | --- | --- | --- |',
        ...s.inputs.fixtures.map(f => `| \`${f.file}\` | ${f.role} | \`${f.sha256}\` | ${f.ok ? (f.indexed ? 'pass, indexed' : 'pass') : 'fail: `' + f.failureCategory + '`'} |`),
        '',
        '## Identities',
        '',
        '| Count | Value |',
        '| --- | --- |',
        row('Attempted (priority 1)', id.attempted),
        row('Matched (reviewed local match and pinned source)', id.matched),
        row('Validated', id.validated),
        row('Failed validation', id.failedValidation),
        row(`Unresolved (\`${UNRESOLVED_OUTCOME}\`)`, id.unresolved),
        row('Source lookups run (offline, pinned cache)', id.lookupsRun),
        '',
        `Reconciliation: attempted ${id.attempted} = priority-1 ${s.inputs.priority1Count}; matched ${id.matched} + unresolved ${id.unresolved} = ${id.matched + id.unresolved}; validated ${id.validated} + failed ${id.failedValidation} = matched ${id.matched}.`,
        '',
        '| Outcome | Identities |',
        '| --- | --- |',
        ...mapRows(id.outcomes),
        '',
        '| Matched by catalog kind | Identities |',
        '| --- | --- |',
        ...mapRows(id.matchedByKind),
        '',
        '| Matched by catalog state | Identities |',
        '| --- | --- |',
        ...mapRows(id.matchedByState),
        '',
        '## Coverage of validated profiles',
        '',
        `Stored profile fields per profile: ${cov.storedFieldCount}. Validated profiles: ${cov.validatedProfiles}. Field-status total: ${cov.total} (= ${cov.storedFieldCount} x ${cov.validatedProfiles}). Basis: per 100 g edible form.`,
        '',
        '| Field status | Fields |',
        '| --- | --- |',
        ...Object.entries(cov.fieldStatus).map(([k, v]) => row('`' + k + '`', v)),
        '',
        '## Unresolved fields',
        '',
        `Unknown fields across validated profiles: ${s.unresolvedFields.unknown}. Unknown stays explicit; no gap is filled with zero.`,
        '',
        '| Gap reason | Fields |',
        '| --- | --- |',
        ...mapRows(s.unresolvedFields.byGapReason),
        '',
        '## Uncertainty',
        '',
        '| Measure | Fields |',
        '| --- | --- |',
        row('Below quantification limit', s.uncertainty.belowQuantificationLimit),
        row('Estimated with comparator and range', s.uncertainty.estimatedWithComparatorAndRange),
        row('Estimated missing comparator or range', s.uncertainty.estimatedMissingComparatorOrRange),
        row('With rounding interval', s.uncertainty.roundingInterval),
        row('With upper bound', s.uncertainty.upperBound),
        '',
        '## Validation failures',
        '',
        `Total failures: ${vf.total} (fixture checks ${vf.fixtureChecks.failed}, matched profiles ${vf.matchedProfiles.failed}).`,
        '',
        `Fixture parse and pin checks: ${vf.fixtureChecks.checked} checked, ${vf.fixtureChecks.passed} passed, ${vf.fixtureChecks.failed} failed.`,
        '',
        '| Fixture failure category | Fixtures |',
        '| --- | --- |',
        ...mapRows(vf.fixtureChecks.byCategory),
        '',
        '| Matched-profile failure category | Profiles |',
        '| --- | --- |',
        ...mapRows(vf.matchedProfiles.byCategory),
        '',
        '| Validator warning category | Warnings |',
        '| --- | --- |',
        ...mapRows(vf.warningsByCategory),
        '',
        '## Production changes a later approved import would make',
        '',
        '| Change | Count |',
        '| --- | --- |',
        row('Curated profiles created', w.profilesCreated),
        row('Staged catalog records written', w.stagedRecords),
        row('Portion conversions staged', w.portionConversions),
        row('Identities that stay queued', w.identitiesStayQueued),
        row('Identities blocked pending review', w.identitiesBlocked),
        '',
        '## Writes performed by this run',
        '',
        '| Target | Writes |',
        '| --- | --- |',
        row('Catalog (`docs/nutrition/ingredient-catalog.json`)', s.writesPerformed.catalog),
        row('Staged shards', s.writesPerformed.stagedShards),
        row('Firestore', s.writesPerformed.firestore),
        row('Write-flag changes', s.writesPerformed.flagChanges),
        '',
        `\`NUTRIENT_V2_WRITES_ENABLED\` is ${s.flags.NUTRIENT_V2_WRITES_ENABLED} and \`INGREDIENT_STORE_WRITES_ENABLED\` is ${s.flags.INGREDIENT_STORE_WRITES_ENABLED}. The only file the command writes is this report.`,
        '',
        '## Conclusion',
        '',
        `${id.unresolved} of ${id.attempted} priority-1 identities cannot be resolved from local data. They have no reviewed match and no pinned source, and they stay unresolved until #62 Part B pins live sources with James's approval. Importing any result stays #63 and needs a separate approval. Metered APIs stay at $0; residual fields stay on the subscription assistant path. The ${id.matched} matched identities use synthetic fixtures, so their counts exercise the pipeline and are not nutrition data.`,
        '',
    ].join('\n');
}

/**
 * CLI body. The entry point is dryRunPilotCli.ts because vite-node does not put
 * the script path in process.argv, so an import.meta guard cannot detect it.
 */
export async function dryRunPilotCli(argv: string[], { output = (text: string) => { process.stdout.write(text + '\n'); }, reportPath = DRY_RUN_REPORT_PATH } = {}) {
    const args = argv[0] === '--' ? argv.slice(1) : argv;
    let date: string | undefined, check = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--check') check = true;
        else if (args[i] === '--date' && args[i + 1] && !args[i + 1].startsWith('--')) date = args[++i];
        else throw new Error('Usage: dryRunPilotCli.ts --date YYYY-MM-DD [--check]');
    }
    if (!date) throw new Error('--date YYYY-MM-DD is required so the report is reproducible');
    const { summary } = await runDryRunPilot({ date });
    const markdown = renderDryRunReport(summary);
    if (check) {
        const current = await readFile(reportPath, 'utf8').catch(() => '');
        if (current !== markdown) throw new Error(`${reportPath} is out of date`);
        output(`${reportPath} is current`);
        return { summary, markdown, wrote: false };
    }
    await writeFile(reportPath, markdown);
    output(`Wrote ${reportPath}: attempted ${summary.identities.attempted}, matched ${summary.identities.matched}, validated ${summary.identities.validated}, unresolved ${summary.identities.unresolved}`);
    return { summary, markdown, wrote: true };
}
