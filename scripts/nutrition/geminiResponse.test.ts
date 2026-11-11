import { describe, it, expect, beforeAll } from 'vitest';
import { readFile, mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { validateManifest } from './manifestReader';
import { validateMatchTable } from './matchTable';
import { buildGeminiBundle, type BundleDataset, type GeminiBundle } from './geminiBundle';
import { validateGeminiResults, renderReviewMatrix, renderExceptions, CANDIDATE_REVIEWER, CANDIDATE_RATIONALE_PREFIX, type ResponseFile } from './geminiResponse';
import { geminiResponseCli } from './geminiResponseCli';

const DIR = 'scripts/fixtures/nutrition/gemini-response';
const NOW = new Date('2026-11-11T12:00:00Z');
async function datasets(): Promise<BundleDataset[]> {
    const pin = async (id: 'foundation' | 'sr-legacy', file: string, release: string) => ({
        pin: { id, release, fileName: file, fixtureOnly: true, sha256: 'sha256:' + createHash('sha256').update(await readFile(`${DIR}/${file}`)).digest('hex') },
        file: `${DIR}/${file}`,
    });
    return [await pin('foundation', 'foundation.json', 'fixture-foundation-v1'), await pin('sr-legacy', 'sr-legacy.json', 'fixture-sr-v1')];
}

let bundle: GeminiBundle;
let ds: BundleDataset[];
beforeAll(async () => {
    ds = await datasets();
    const entries = validateManifest(JSON.parse(await readFile(`${DIR}/manifest.json`, 'utf8')));
    // No replayed batches and an empty match table: all four fixture targets are selected.
    ({ bundle } = await buildGeminiBundle({ entries, matchTable: [], datasets: ds, batchMax: 25, batches: 0, unresolved: [], now: NOW }));
});

const target = (id: string) => bundle.targets.find(t => t.targetId === id)!;
const cand = (id: string, fdcId: string) => target(id).candidates.find(c => c.fdcId === fdcId)!;
function proposed(targetId: string, fdcId: string, over: Record<string, unknown> = {}) {
    const c = cand(targetId, fdcId);
    return {
        targetId, category: 'PROPOSED_MATCH',
        match: { fdcId: c.fdcId, dataset: c.dataset, release: c.release, description: c.description },
        alternatives: [], materialAttributesChecked: ['state'], unsupportedAssumptions: [], unresolvedReason: null,
        evidenceNeeded: [], evidenceRefs: [c.ref], notes: `${targetId} matches`, ...over,
    };
}
const unresolved = (targetId: string, over: Record<string, unknown> = {}) => ({
    targetId, category: 'UNRESOLVED', match: null, alternatives: [], materialAttributesChecked: [], unsupportedAssumptions: [],
    unresolvedReason: 'no candidate in the same state', evidenceNeeded: ['a raw record'], evidenceRefs: [], notes: '', ...over,
});
/** A full, clean four-target response. */
function baseDecisions() {
    return [
        proposed('pear-raw', '9930001'),
        proposed('plum-raw', '9930002'),
        proposed('lentils-boiled-drained-without-added-salt', '9940002'),
        proposed('milk-reduced-fat-2-percent-fat-as-sold', '9940003'),
    ];
}
const results = (decisions: unknown[], over: Record<string, unknown> = {}) => ({ bundleId: bundle.bundleId, inputDigest: bundle.inputDigest, decisions, ...over });
const file = (name: string, data: unknown): ResponseFile => ({ file: name, text: JSON.stringify(data) });
const validate = (files: ResponseFile[]) => validateGeminiResults(bundle, files, { datasets: ds, now: NOW });
const decisionFor = (r: Awaited<ReturnType<typeof validate>>, id: string) => r.decisions.find(d => d.targetId === id)!;
const codes = (r: Awaited<ReturnType<typeof validate>>, id: string) => decisionFor(r, id).findings.map(f => f.code);

describe('fixture bundle', () => {
    it('has the four targets and the candidates the cases rely on', () => {
        expect(bundle.targets.map(t => t.targetId).sort()).toEqual(['lentils-boiled-drained-without-added-salt', 'milk-reduced-fat-2-percent-fat-as-sold', 'pear-raw', 'plum-raw']);
        expect(target('pear-raw').candidates.map(c => c.fdcId)).toEqual(['9930001', '9940001']);
        expect(target('plum-raw').candidates.map(c => c.fdcId)).toEqual(['9930002']);
    });
});

describe('validateGeminiResults', () => {
    it('a clean PROPOSED_MATCH validates CLEAN and yields an unverified candidate entry', async () => {
        const r = await validate([file('results.json', results(baseDecisions()))]);
        expect(r.ok).toBe(true);
        expect(r.findings).toEqual([]);
        expect(r.summary).toMatchObject({ totalDecisions: 4, clean: 4, adjudication: 0, unresolved: 0, invalid: 0, coverageErrors: 0 });
        const entry = r.candidateEntries.find(e => e.manifestId === 'pear-raw')!;
        expect(entry).toEqual({
            manifestId: 'pear-raw', adapter: 'fdc_bulk', dataType: 'Foundation', fdcId: '9930001', release: 'fixture-foundation-v1',
            description: 'Pears, raw', stateEvidence: expect.stringContaining('UNVERIFIED'),
            rationale: CANDIDATE_RATIONALE_PREFIX + 'pear-raw matches', reviewer: CANDIDATE_REVIEWER, reviewedAt: '2026-11-11', checklistVersion: 1,
        });
        expect(entry.reviewer).toBe('gemini-unverified');
        // Exactly the match-table entry shape: the real table's validator accepts it.
        await expect(validateMatchTable({ schemaVersion: 1, entries: r.candidateEntries })).resolves.toHaveLength(4);
        expect(renderReviewMatrix(r)).toContain('| pear-raw | PROPOSED_MATCH | foundation 9930001: Pears, raw | CLEAN |');
        expect(renderExceptions(r)).toContain('No errors or flags.');
    });

    it('a missing target and a duplicated target fail coverage with both ids listed', async () => {
        const decisions = baseDecisions().filter(d => d.targetId !== 'plum-raw');
        decisions.push(proposed('pear-raw', '9930001'));
        const r = await validate([file('results.json', results(decisions))]);
        expect(r.ok).toBe(false);
        expect(r.coverage).toEqual({ missing: ['plum-raw'], duplicate: ['pear-raw'], unexpected: [] });
        expect(r.findings.filter(f => f.code === 'missing_target').map(f => f.targetId)).toEqual(['plum-raw']);
        expect(r.findings.filter(f => f.code === 'duplicate_target').map(f => f.targetId)).toEqual(['pear-raw']);
        expect(r.summary.coverageErrors).toBe(2);
        expect(r.decisions.filter(d => d.targetId === 'pear-raw').map(d => d.classification)).toEqual(['INVALID', 'INVALID']);
        expect(r.summary.invalid).toBe(2);
        expect(r.candidateEntries.map(e => e.manifestId)).not.toContain('pear-raw');
        expect(renderReviewMatrix(r)).toContain('| plum-raw | (missing) | none | MISSING | E:missing_target |');
    });

    it('a match description with one word changed fails verbatim verification', async () => {
        const decisions = baseDecisions();
        decisions[2] = proposed('lentils-boiled-drained-without-added-salt', '9940002');
        (decisions[2].match as { description: string }).description = 'Lentils, mature seeds, cooked, boiled, with salt';
        const r = await validate([file('results.json', results(decisions))]);
        const d = decisionFor(r, 'lentils-boiled-drained-without-added-salt');
        expect(codes(r, d.targetId!)).toContain('description_mismatch');
        expect(d.classification).toBe('INVALID');
        expect(r.ok).toBe(false);
        expect(r.candidateEntries.map(e => e.manifestId)).not.toContain(d.targetId);
    });

    it('a match outside the bundle candidates is flagged and goes to ADJUDICATION, still source-verified', async () => {
        const decisions = baseDecisions();
        // Pears, raw is a real pinned record, but not a candidate for plum-raw.
        decisions[1] = { ...proposed('plum-raw', '9930002'), match: { fdcId: '9930001', dataset: 'foundation', release: 'fixture-foundation-v1', description: 'Pears, raw' } };
        let r = await validate([file('results.json', results(decisions))]);
        expect(codes(r, 'plum-raw')).toEqual(['match_not_in_bundle_candidates']);
        expect(decisionFor(r, 'plum-raw')).toMatchObject({ classification: 'ADJUDICATION', inBundleCandidates: false });
        expect(r.ok).toBe(true);
        expect(r.candidateEntries.find(e => e.manifestId === 'plum-raw')).toMatchObject({ fdcId: '9930001', reviewer: 'gemini-unverified' });
        // Not silently accepted either when the record does not exist.
        decisions[1] = { ...proposed('plum-raw', '9930002'), match: { fdcId: '9939999', dataset: 'foundation', release: 'fixture-foundation-v1', description: 'Plums, raw' } };
        r = await validate([file('results.json', results(decisions))]);
        expect(codes(r, 'plum-raw')).toContain('fdc_id_not_found');
        expect(decisionFor(r, 'plum-raw').classification).toBe('INVALID');
    });

    it('a cooked record for a raw target is flagged attribute_contradiction and goes to ADJUDICATION', async () => {
        const decisions = baseDecisions();
        decisions[0] = proposed('pear-raw', '9940001');
        const r = await validate([file('results.json', results(decisions))]);
        const d = decisionFor(r, 'pear-raw');
        expect(d.classification).toBe('ADJUDICATION');
        const contradiction = d.findings.find(f => f.code === 'attribute_contradiction')!;
        expect(contradiction).toMatchObject({ severity: 'flag', detail: expect.stringContaining('description says cooked') });
        expect(renderExceptions(r)).toContain('## attribute_contradiction (1 flag)');
    });

    it('unsupported assumptions keep a PROPOSED_MATCH out of CLEAN', async () => {
        const decisions = baseDecisions();
        decisions[3] = proposed('milk-reduced-fat-2-percent-fat-as-sold', '9940003', { unsupportedAssumptions: ['fluid'] });
        const r = await validate([file('results.json', results(decisions))]);
        expect(decisionFor(r, 'milk-reduced-fat-2-percent-fat-as-sold').classification).toBe('ADJUDICATION');
    });

    it('validates a chunked response with a manifest, and errors when a chunk disagrees with the manifest', async () => {
        const [a, b, c, d] = baseDecisions();
        const p1 = `gemini-results-${bundle.bundleId}-part-01-of-02.json`, p2 = `gemini-results-${bundle.bundleId}-part-02-of-02.json`;
        const manifest = (lists: string[][]) => file(`gemini-results-${bundle.bundleId}-manifest.json`, {
            bundleId: bundle.bundleId, inputDigest: bundle.inputDigest, totalTargets: 4,
            chunks: [{ file: p1, targetIds: lists[0] }, { file: p2, targetIds: lists[1] }],
        });
        const chunks = [file(p1, results([a, b])), file(p2, results([c, d]))];
        let r = await validate([...chunks, manifest([[a.targetId, b.targetId], [c.targetId, d.targetId]])]);
        expect(r.ok).toBe(true);
        expect(r.summary).toMatchObject({ totalDecisions: 4, clean: 4, coverageErrors: 0 });
        expect(r.files.map(f => f.kind).sort()).toEqual(['manifest', 'results', 'results']);
        // Same files, one chunk's ids disagreeing with the manifest listing.
        r = await validate([...chunks, manifest([[a.targetId, c.targetId], [b.targetId, d.targetId]])]);
        expect(r.ok).toBe(false);
        expect(r.findings.filter(f => f.code === 'manifest_chunk_mismatch').map(f => f.file).sort()).toEqual([p1, p2]);
        // Several results files without a manifest are a failure too.
        r = await validate(chunks);
        expect(r.findings.map(f => f.code)).toContain('manifest_missing');
        expect(r.ok).toBe(false);
    });

    it('flags UNRESOLVED without a reason; NEEDS_REVIEW is ADJUDICATION with a candidate entry only when it carries a match', async () => {
        const decisions: Record<string, unknown>[] = baseDecisions();
        decisions[0] = unresolved('pear-raw', { unresolvedReason: null });
        decisions[1] = unresolved('plum-raw');
        decisions[2] = { ...unresolved('lentils-boiled-drained-without-added-salt'), category: 'NEEDS_REVIEW', unresolvedReason: 'drained not stated' };
        decisions[3] = { ...proposed('milk-reduced-fat-2-percent-fat-as-sold', '9940003'), category: 'NEEDS_REVIEW', unresolvedReason: 'fortification judgment' };
        const r = await validate([file('results.json', results(decisions))]);
        expect(r.ok).toBe(true);
        expect(codes(r, 'pear-raw')).toEqual(['unresolved_without_reason']);
        expect(decisionFor(r, 'pear-raw').classification).toBe('UNRESOLVED');
        expect(codes(r, 'plum-raw')).toEqual([]);
        expect(decisionFor(r, 'plum-raw').classification).toBe('UNRESOLVED');
        expect(decisionFor(r, 'lentils-boiled-drained-without-added-salt').classification).toBe('ADJUDICATION');
        expect(decisionFor(r, 'milk-reduced-fat-2-percent-fat-as-sold').classification).toBe('ADJUDICATION');
        expect(codes(r, 'milk-reduced-fat-2-percent-fat-as-sold')).toEqual(['needs_review_candidate']);
        expect(r.candidateEntries.map(e => e.manifestId)).toEqual(['milk-reduced-fat-2-percent-fat-as-sold']);
        expect(r.summary).toMatchObject({ clean: 0, adjudication: 2, unresolved: 2, invalid: 0 });
    });

    it('enforces the envelope and strict decision shape', async () => {
        const decisions: Record<string, unknown>[] = baseDecisions();
        decisions[0] = { ...decisions[0], confidence: 0.9 };
        decisions[1] = { ...decisions[1], category: 'MATCH' };
        decisions[2] = { ...decisions[2], match: null };
        decisions[3] = { ...unresolved('milk-reduced-fat-2-percent-fat-as-sold'), match: (decisions[3] as { match: unknown }).match };
        let r = await validate([file('results.json', results(decisions))]);
        expect(codes(r, 'pear-raw')).toEqual(['unknown_key']);
        expect(codes(r, 'plum-raw')).toEqual(['invalid_category']);
        expect(codes(r, 'lentils-boiled-drained-without-added-salt')).toEqual(['match_required']);
        expect(codes(r, 'milk-reduced-fat-2-percent-fat-as-sold')).toContain('unexpected_match');
        expect(r.summary.invalid).toBe(4);
        r = await validate([file('results.json', results(baseDecisions(), { inputDigest: 'f'.repeat(64) }))]);
        expect(r.findings.map(f => f.code)).toEqual(['input_digest_mismatch']);
        expect(r.summary.invalid).toBe(4);
        r = await validate([{ file: 'results.json', text: '```json\n{}\n```' }]);
        expect(r.findings.map(f => f.code)).toContain('json_parse_error');
        expect(r.coverage.missing).toHaveLength(4);
    });

    it('refuses dataset pins that differ from the bundle source versions', async () => {
        const wrong = ds.map(d => d.pin.id === 'sr-legacy' ? { ...d, pin: { ...d.pin, release: 'other' } } : d);
        await expect(validateGeminiResults(bundle, [], { datasets: wrong })).rejects.toThrow('does not match the bundle');
    });
});

describe('CLI', () => {
    const pins = async () => (await datasets()).map(d => d.pin);
    async function setup(decisions: unknown[]) {
        const root = await mkdtemp(path.join(os.tmpdir(), 'gemini-response-'));
        const bundleFile = path.join(root, 'bundle.json'), resultsDir = path.join(root, 'results');
        await mkdir(resultsDir);
        await writeFile(bundleFile, JSON.stringify(bundle));
        const resultsFile = path.join(resultsDir, 'gemini-results.json');
        const text = JSON.stringify(results(decisions));
        await writeFile(resultsFile, text);
        return { root, bundleFile, resultsDir, resultsFile, text };
    }
    const args = (s: { root: string; bundleFile: string; resultsDir: string }) => ['check', '--bundle', s.bundleFile, '--results', s.resultsDir, '--out', path.join(s.root, 'out'),
        '--foundation-file', `${DIR}/foundation.json`, '--sr-legacy-file', `${DIR}/sr-legacy.json`];

    it('writes the four outputs, leaves the response untouched, and exits 0 when clean', async () => {
        const s = await setup(baseDecisions());
        const res = await geminiResponseCli(args(s), { output: () => {}, now: NOW, pins: await pins() });
        expect(res).toMatchObject({ totalDecisions: 4, clean: 4, adjudication: 0, unresolved: 0, invalid: 0, coverageErrors: 0, exitCode: 0 });
        const report = JSON.parse(await readFile(res.files.report, 'utf8'));
        expect(report.summary.clean).toBe(4);
        expect(JSON.parse(await readFile(res.files.candidates, 'utf8'))).toHaveLength(4);
        expect(await readFile(res.files.matrix, 'utf8')).toContain('| Target | Gemini category | Chosen record | Classification | Flags |');
        expect(await readFile(res.files.exceptions, 'utf8')).toContain('No errors or flags.');
        expect(await readFile(s.resultsFile, 'utf8')).toBe(s.text);
    });

    it('exits 1 on coverage errors and rejects bad flags', async () => {
        const s = await setup(baseDecisions().slice(1));
        const res = await geminiResponseCli(args(s), { output: () => {}, now: NOW, pins: await pins() });
        expect(res).toMatchObject({ totalDecisions: 3, coverageErrors: 1, missingTargets: 1, exitCode: 1 });
        await expect(geminiResponseCli(['build'])).rejects.toThrow('Expected check');
        await expect(geminiResponseCli(['check', '--write'])).rejects.toThrow('Unknown flag');
        await expect(geminiResponseCli(['check', '--bundle', s.bundleFile])).rejects.toThrow('--results required');
        // The real pins do not match the fixture bundle.
        await expect(geminiResponseCli(args(s), { output: () => {} })).rejects.toThrow('does not match the pinned release');
    });
});
