/**
 * #63 Gemini response checker CLI. Review-only: it reads a research bundle,
 * Gemini's results (one results file, or a directory of chunk files plus a
 * results manifest), and the two pinned FDC bulk files, and writes a report to
 * --out. It never edits the response files, the match table, the catalog, or
 * any capability flag.
 *
 *   npx --yes tsx scripts/nutrition/geminiResponseCli.ts check --bundle <bundle.json> --results <file-or-dir> --out <dir>
 *       [--foundation-file <path>] [--sr-legacy-file <path>] [--data-dir <dir>]
 *
 * --results as a directory reads every *.json file in it (not recursive),
 * except the --bundle file itself. Dataset files resolve as in
 * geminiBundleCli.ts: --<dataset>-file, else <data-dir>/<pin fileName>, where
 * --data-dir falls back to FDC_DATA_DIR. The bundle's source versions must
 * equal the pins in RESEARCH_CONFIG.
 *
 * Writes validation-report.json, review-matrix.md, exceptions.md, and
 * candidate-match-entries.json. Exit code 0 when no decision is INVALID and
 * there are no coverage errors; 1 otherwise.
 */
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertLocalPath } from './fileResearchStore';
import { RESEARCH_CONFIG } from './researchConfig';
import type { BundleDataset, BundleDatasetId, GeminiBundle } from './geminiBundle';
import { renderExceptions, renderReviewMatrix, validateGeminiResults, type ResponseFile } from './geminiResponse';

const COMMANDS: readonly string[] = ['check'];
export const OUTPUT_FILES = Object.freeze({
    report: 'validation-report.json',
    matrix: 'review-matrix.md',
    exceptions: 'exceptions.md',
    candidates: 'candidate-match-entries.json',
});
interface Pin { id: string; release: string; fileName: string; sha256: string | null; fixtureOnly: boolean }

const real = (p: string) => { try { return realpathSync(p); } catch { return path.resolve(p); } };

export async function readResponseFiles(results: string, bundleFile?: string): Promise<ResponseFile[]> {
    const info = await stat(results);
    let files: string[];
    if (info.isDirectory()) {
        const skip = bundleFile ? real(bundleFile) : null;
        files = (await readdir(results)).filter(n => n.toLowerCase().endsWith('.json')).sort()
            .map(n => path.join(results, n)).filter(f => real(f) !== skip);
    }
    else files = [results];
    if (!files.length)
        throw new Error('No .json results files found in ' + results);
    return Promise.all(files.map(async file => ({ file, text: await readFile(file, 'utf8') })));
}

export async function geminiResponseCli(args: string[], { output = (v: unknown) => process.stdout.write(typeof v === 'string' ? v + '\n' : JSON.stringify(v, null, 2) + '\n'), env = process.env, now, pins = RESEARCH_CONFIG.datasets }: {
    output?: (v: unknown) => void;
    env?: Record<string, string | undefined>;
    now?: Date;
    pins?: readonly Pin[];
} = {}) {
    const argv = args[0] === '--' ? args.slice(1) : args;
    const command = argv[0];
    if (!COMMANDS.includes(command))
        throw new Error('Expected check');
    const flags: Record<string, string> = {};
    const valueFlags = ['bundle', 'results', 'out', 'data-dir', 'foundation-file', 'sr-legacy-file'];
    for (let i = 1; i < argv.length; i++) {
        const flag = argv[i].replace(/^--/, '');
        if (!argv[i].startsWith('--') || !valueFlags.includes(flag))
            throw new Error('Unknown flag');
        if (!argv[i + 1] || argv[i + 1].startsWith('--'))
            throw new Error('Flag requires a value: ' + flag);
        flags[flag] = argv[++i];
    }
    for (const required of ['bundle', 'results', 'out'])
        if (!flags[required])
            throw new Error(`--${required} required`);
    const dataDir = flags['data-dir'] || env.FDC_DATA_DIR;
    const datasets: BundleDataset[] = pins.map(pin => {
        const file = flags[`${pin.id}-file`] || (dataDir ? path.join(dataDir, pin.fileName) : undefined);
        if (!file)
            throw new Error(`No file for dataset ${pin.id}: pass --${pin.id}-file or --data-dir (or set FDC_DATA_DIR)`);
        return { pin: { ...pin, id: pin.id as BundleDatasetId }, file };
    });
    const bundle = JSON.parse(await readFile(flags.bundle, 'utf8')) as GeminiBundle;
    for (const pin of pins) {
        const v = (bundle.sourceVersions || []).find(s => s.dataset === pin.id);
        if (!v || v.release !== pin.release || v.file !== pin.fileName || v.sha256 !== pin.sha256)
            throw new Error(`Bundle source version for ${pin.id} does not match the pinned release`);
    }
    const responseFiles = await readResponseFiles(flags.results, flags.bundle);
    const out = await assertLocalPath(flags.out);
    const targets = Object.values(OUTPUT_FILES).map(name => path.join(out, name));
    const inputs = new Set([flags.bundle, ...responseFiles.map(r => r.file)].map(real));
    if (targets.some(t => inputs.has(real(t))))
        throw new Error('--out would overwrite an input file');

    const report = await validateGeminiResults(bundle, responseFiles, { datasets, now });
    await mkdir(out, { recursive: true });
    const [reportFile, matrixFile, exceptionsFile, candidatesFile] = targets;
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    await writeFile(matrixFile, renderReviewMatrix(report), { mode: 0o600 });
    await writeFile(exceptionsFile, renderExceptions(report), { mode: 0o600 });
    await writeFile(candidatesFile, JSON.stringify(report.candidateEntries, null, 2) + '\n', { mode: 0o600 });
    const s = report.summary;
    const result = {
        bundleId: report.bundleId,
        totalDecisions: s.totalDecisions,
        clean: s.clean,
        adjudication: s.adjudication,
        unresolved: s.unresolved,
        invalid: s.invalid,
        coverageErrors: s.coverageErrors,
        missingTargets: s.missingTargets,
        duplicateTargets: s.duplicateTargets,
        unexpectedTargets: s.unexpectedTargets,
        candidateEntries: s.candidateEntries,
        ok: report.ok,
        exitCode: report.ok ? 0 : 1,
        files: { report: reportFile, matrix: matrixFile, exceptions: exceptionsFile, candidates: candidatesFile },
    };
    output(result);
    return result;
}

export function isGeminiResponseCliEntry(argv: readonly string[], scriptFilePath: string) {
    const launcher = argv[1];
    if (!launcher)
        return false;
    return real(launcher) === real(scriptFilePath);
}
if (isGeminiResponseCliEntry(process.argv, fileURLToPath(import.meta.url))) {
    geminiResponseCli(process.argv.slice(2))
        .then(result => { process.exitCode = result.exitCode; })
        .catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
}
