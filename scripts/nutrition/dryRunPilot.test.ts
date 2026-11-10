import { it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readManifest, type ManifestEntry } from './manifestReader';
import { readPinnedRecord } from './fdcBulkReader';
import { createMemorySourceCache } from '../../public/shared/nutrition/research/memoryResearchStore.js';
import { NUTRIENT_V2_WRITES_ENABLED, INGREDIENT_STORE_WRITES_ENABLED } from '../../public/shared/nutrition/capabilities.js';
import { PROFILE_FIELDS } from '../../public/shared/nutrition/research/profileFields.js';
import {
    runDryRunPilot, renderDryRunReport, dryRunPilotCli, FIXTURE_SET, FIXTURE_DIR, MATCH_TABLE_FIXTURE,
    DRY_RUN_REPORT_PATH, UNRESOLVED_OUTCOME,
} from './dryRunPilot';

const DATE = '2026-11-10';
const temp: string[] = [];
const savedKey = process.env.FDC_API_KEY;
afterEach(async () => {
    await Promise.all(temp.splice(0).map(p => rm(p, { recursive: true, force: true })));
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.FDC_API_KEY;
    else process.env.FDC_API_KEY = savedKey;
});
async function dir() { const p = await mkdtemp(path.join(tmpdir(), 'ct76-')); temp.push(p); return p; }
const priority1 = async () => (await readManifest()).filter(e => e.priority === 1);
const miniTable = async () => JSON.parse(await readFile(MATCH_TABLE_FIXTURE, 'utf8')) as { entries: { manifestId: string; adapter: string }[] };

it('reconciles attempted, matched, unresolved, and validated against the live priority-1 catalog', async () => {
    const p1 = await priority1();
    const p1Ids = new Set(p1.map(e => e.id));
    const intersection = (await miniTable()).entries.filter(m => m.adapter === 'fdc_bulk' && p1Ids.has(m.manifestId));
    const { summary, identityOutcomes } = await runDryRunPilot({ date: DATE });
    const id = summary.identities;
    expect(id.attempted).toBe(p1.length);
    expect(summary.inputs.priority1Count).toBe(p1.length);
    expect(id.matched + id.unresolved).toBe(id.attempted);
    expect(id.matched).toBe(intersection.length);
    expect(id.validated + id.failedValidation).toBe(id.matched);
    expect(Object.keys(identityOutcomes).sort()).toEqual([...p1Ids].sort());
    for (const [manifestId, outcome] of Object.entries(identityOutcomes))
        if (outcome === 'validated') expect(intersection.some(m => m.manifestId === manifestId)).toBe(true);
    expect(summary.coverage.total).toBe(PROFILE_FIELDS.length * id.validated);
    expect(Object.values(summary.coverage.fieldStatus).reduce((a, b) => a + b, 0)).toBe(summary.coverage.total);
    expect(Object.values(summary.reconciliation).every(Boolean)).toBe(true);
    expect(summary.wouldBeProductionChanges.identitiesStayQueued).toBe(id.unresolved);
    expect(summary.writesPerformed).toEqual({ catalog: 0, stagedShards: 0, firestore: 0, flagChanges: 0 });
});

it('never records not_found for identities where no lookup ran', async () => {
    const { summary, identityOutcomes } = await runDryRunPilot({ date: DATE });
    const outcomes = Object.values(identityOutcomes);
    expect(outcomes).not.toContain('not_found');
    expect(outcomes.filter(o => o === UNRESOLVED_OUTCOME)).toHaveLength(summary.identities.unresolved);
    expect(summary.identities.lookupsRun).toBe(summary.identities.matched);
    expect(Object.keys(summary.identities.outcomes)).not.toContain('not_found');
    expect(renderDryRunReport(summary)).not.toMatch(/not_found/);
});

it('renders aggregate counts only: no priority-1 id or name and no fixture id, description, or nutrient value', async () => {
    const { summary } = await runDryRunPilot({ date: DATE });
    const report = renderDryRunReport(summary);
    const lower = report.toLowerCase();
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const e of await priority1()) {
        expect(lower).not.toContain(e.id.toLowerCase());
        for (const name of [e.name, ...(e.aliases || [])])
            expect(report).not.toMatch(new RegExp(`(^|[^a-z])${escape(name.toLowerCase())}([^a-z]|$)`, 'i'));
    }
    // Numbers in the report: only counts from the summary, the date, and the per-100 g basis.
    const allowed = new Set<string>(['100']);
    const collect = (v: unknown): void => {
        if (typeof v === 'number') allowed.add(String(v));
        else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(summary);
    for (const part of DATE.split('-')) { allowed.add(part); allowed.add(String(Number(part))); }
    for (const item of ['62', '63', '76']) allowed.add(item);
    const scrubbed = report.replace(/sha256:[a-f0-9]{64}/g, '').replace(/\d{4}-\d{2}-\d{2}/g, '').replace(/sha256/g, '').replace(/^\d+\. /gm, '');
    const numbers = scrubbed.match(/(?<![\w.])\d+(?:\.\d+)?(?![\w.]\d)/g) || [];
    expect(numbers.filter(n => !allowed.has(n))).toEqual([]);
    expect(scrubbed).not.toMatch(/\d\.\d/);
    for (const { file } of FIXTURE_SET) {
        const food = JSON.parse(await readFile(path.join(FIXTURE_DIR, file), 'utf8'));
        if (food.fdcId != null) expect(report).not.toContain(String(food.fdcId));
        expect(report).not.toContain(food.description);
        for (const n of food.foodNutrients || []) {
            const amount = n.amount;
            if (typeof amount === 'number' && !allowed.has(String(amount)))
                expect(numbers).not.toContain(String(amount));
        }
    }
});

it('counts the three malformed fixtures as failures and none of the valid ones', async () => {
    const { summary } = await runDryRunPilot({ date: DATE });
    const checks = summary.inputs.fixtures;
    expect(checks.map(c => c.file)).toEqual(FIXTURE_SET.map(f => f.file));
    for (const c of checks) expect(c.ok).toBe(c.role !== 'malformed');
    expect(Object.fromEntries(checks.filter(c => !c.ok).map(c => [c.file, c.failureCategory]))).toEqual({
        'malformed-duplicate-nutrient.json': 'duplicate_nutrient_id',
        'malformed-missing-id.json': 'missing_fdc_id',
        'malformed-string-amount.json': 'non_numeric_amount',
    });
    expect(summary.validationFailures.fixtureChecks).toMatchObject({ checked: 10, passed: 7, failed: 3 });
    // The pins are the sha256 of the committed bytes.
    for (const c of checks)
        expect(c.sha256).toBe('sha256:' + createHash('sha256').update(await readFile(path.join(FIXTURE_DIR, c.file))).digest('hex'));
    // The compound-reference additive is refused by the real validator, not by a hand-written tally.
    expect(summary.validationFailures.matchedProfiles.byCategory).toEqual({ source_strategy_conflict: 1 });
    expect(summary.validationFailures.total).toBe(3 + summary.identities.failedValidation);
});

it('keeps catalog state: a cooked fixture against a raw catalog target is a validation failure, not a match', async () => {
    const entry = (id: string, state: string): ManifestEntry => ({ id, name: 'Synthetic ' + id, category: 'synthetic', kind: 'generic', state, priority: 1, sourceStrategy: 'usda-first', status: 'queued' });
    const entries = [entry('apple-raw-with-skin', 'raw'), entry('lentils-mature-seeds-cooked-boiled-without-salt', 'raw'), entry('unmatched-synthetic', 'raw')];
    const { summary, identityOutcomes } = await runDryRunPilot({ date: DATE, entries, expectedPriority1: 3 });
    expect(identityOutcomes).toEqual({
        'apple-raw-with-skin': 'validated',
        'lentils-mature-seeds-cooked-boiled-without-salt': 'failed_validation',
        'unmatched-synthetic': UNRESOLVED_OUTCOME,
    });
    expect(summary.validationFailures.matchedProfiles.byCategory.state_conflict).toBe(1);
    expect(summary.wouldBeProductionChanges).toMatchObject({ profilesCreated: 1, identitiesBlocked: 1, identitiesStayQueued: 1 });
});

it('fails loudly when the priority-1 count changes underneath the report', async () => {
    await expect(runDryRunPilot({ date: DATE, expectedPriority1: 254 })).rejects.toThrow('Catalog changed');
    await expect(runDryRunPilot({ date: 'today' })).rejects.toThrow('--date');
});

it('runs offline: fetch throws, no FDC_API_KEY, and no live adapter in the import graph', async () => {
    const fetch = vi.fn(() => { throw new Error('network is not allowed in the dry run'); });
    vi.stubGlobal('fetch', fetch);
    delete process.env.FDC_API_KEY;
    const { summary } = await runDryRunPilot({ date: DATE });
    expect(summary.identities.attempted).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
    const seen = new Set<string>();
    const walk = async (file: string): Promise<void> => {
        if (seen.has(file)) return;
        seen.add(file);
        const source = await readFile(file, 'utf8').catch(async error => {
            // Declaration-only ports (import type) have no runtime module.
            if (file.endsWith('.js') && await readFile(file.replace(/\.js$/, '.d.ts'), 'utf8').then(() => true, () => false)) return '';
            throw error;
        });
        expect(source).not.toMatch(/FDC_API_KEY|api\.nal\.usda\.gov/);
        for (const [, spec] of source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
            const base = path.resolve(path.dirname(file), spec);
            const resolved = /\.[jt]s$/.test(base) ? base : base + '.ts';
            expect(path.basename(resolved)).not.toMatch(/fdcApiAdapter|researchCli|researchConfig/);
            await walk(resolved);
        }
    };
    await walk(path.resolve('scripts/nutrition/dryRunPilotCli.ts'));
    expect(seen.has(path.resolve('scripts/nutrition/dryRunPilot.ts'))).toBe(true);
});

it('is deterministic and the committed report matches a regeneration', async () => {
    const first = await runDryRunPilot({ date: DATE }), second = await runDryRunPilot({ date: DATE });
    expect(second.summary).toEqual(first.summary);
    expect(renderDryRunReport(second.summary)).toBe(renderDryRunReport(first.summary));
    const committed = await readFile(DRY_RUN_REPORT_PATH, 'utf8');
    const date = committed.match(/^Generated: (\d{4}-\d{2}-\d{2})\./m)?.[1];
    expect(date).toBeTruthy();
    const { summary } = await runDryRunPilot({ date: date! });
    expect(renderDryRunReport(summary)).toBe(committed);
});

it('CLI writes only the named report and --check verifies it without writing', async () => {
    const out = path.join(await dir(), 'report.md'), lines: string[] = [];
    await expect(dryRunPilotCli(['--'], { output: l => lines.push(l), reportPath: out })).rejects.toThrow('--date');
    await expect(dryRunPilotCli(['--date', DATE, '--live'], { reportPath: out })).rejects.toThrow('Usage');
    await expect(dryRunPilotCli(['--date', DATE, '--check'], { reportPath: out })).rejects.toThrow('out of date');
    const written = await dryRunPilotCli(['--', '--date', DATE], { output: l => lines.push(l), reportPath: out });
    expect(written.wrote).toBe(true);
    expect(await readFile(out, 'utf8')).toBe(written.markdown);
    const checked = await dryRunPilotCli(['--date', DATE, '--check'], { output: l => lines.push(l), reportPath: out });
    expect(checked.wrote).toBe(false);
    expect(lines.at(-1)).toContain('is current');
});

it('reads one pinned synthetic record and refuses a wrong pin or an unlabeled record', async () => {
    const root = await dir(), file = path.join(root, 'food.json');
    const food = JSON.parse(await readFile(path.join(FIXTURE_DIR, 'oil-bulk.json'), 'utf8'));
    await writeFile(file, JSON.stringify(food));
    const pin = { id: 'one', release: 'fixture-v1', sha256: 'sha256:' + '0'.repeat(64) as string | null, fixtureOnly: true };
    await expect(readPinnedRecord(file, pin)).rejects.toThrow('checksum');
    pin.sha256 = null;
    await expect(readPinnedRecord(file, pin)).rejects.toThrow('unpinned');
    pin.sha256 = 'sha256:' + createHash('sha256').update(await readFile(file)).digest('hex');
    expect((await readPinnedRecord(file, pin)).fdcId).toBe(food.fdcId);
    delete food._fixture;
    await writeFile(file, JSON.stringify(food));
    pin.sha256 = 'sha256:' + createHash('sha256').update(await readFile(file)).digest('hex');
    await expect(readPinnedRecord(file, pin)).rejects.toThrow('unlabeled');
    expect(createMemorySourceCache()).toBeTruthy();
});

it('keeps both write flags false', () => {
    expect(NUTRIENT_V2_WRITES_ENABLED).toBe(false);
    expect(INGREDIENT_STORE_WRITES_ENABLED).toBe(false);
});
