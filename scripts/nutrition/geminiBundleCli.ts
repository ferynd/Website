/**
 * #63 Gemini research bundle CLI. Review-only: it reads the manifest, the
 * reviewed match table, and the two pinned FDC bulk files, and writes a bundle
 * plus the filled-in prompt to --out. It never edits the match table, the
 * catalog, or any capability flag.
 *
 *   npx --yes tsx scripts/nutrition/geminiBundleCli.ts build --out <dir> [--count 200]
 *       [--data-dir <dir>] [--foundation-file <file>] [--sr-legacy-file <file>]
 *
 * Dataset files: the pins (release, file name, sha256) come from
 * RESEARCH_CONFIG. Each file is --<dataset>-file, else <data-dir>/<pin fileName>,
 * where --data-dir falls back to the FDC_DATA_DIR environment variable. The
 * files stay operator-local and are checksum-verified against their pins.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readManifest } from './manifestReader';
import { readMatchTable } from './matchTable';
import { assertLocalPath } from './fileResearchStore';
import { RESEARCH_CONFIG } from './researchConfig';
import { buildGeminiBundle, renderPrompt, DEFAULT_COUNT, type BundleDataset, type BundleDatasetId } from './geminiBundle';

export const PROMPT_TEMPLATE = 'docs/nutrition/gemini-research-prompt.md';
const COMMANDS: readonly string[] = ['build'];

export async function geminiBundleCli(args: string[], { output = (v: unknown) => process.stdout.write(typeof v === 'string' ? v + '\n' : JSON.stringify(v, null, 2) + '\n'), env = process.env, now }: {
    output?: (v: unknown) => void;
    env?: Record<string, string | undefined>;
    now?: Date;
} = {}) {
    const argv = args[0] === '--' ? args.slice(1) : args;
    const command = argv[0];
    if (!COMMANDS.includes(command))
        throw new Error('Expected build');
    const flags: Record<string, string> = {};
    const valueFlags = ['out', 'count', 'data-dir', 'foundation-file', 'sr-legacy-file'];
    for (let i = 1; i < argv.length; i++) {
        const flag = argv[i].replace(/^--/, '');
        if (!argv[i].startsWith('--') || !valueFlags.includes(flag))
            throw new Error('Unknown flag');
        if (!argv[i + 1] || argv[i + 1].startsWith('--'))
            throw new Error('Flag requires a value: ' + flag);
        flags[flag] = argv[++i];
    }
    if (!flags.out)
        throw new Error('--out required');
    const count = flags.count === undefined ? DEFAULT_COUNT : Number(flags.count);
    if (!Number.isSafeInteger(count) || count < 1)
        throw new Error('--count must be a positive integer');
    const dataDir = flags['data-dir'] || env.FDC_DATA_DIR;
    const datasets: BundleDataset[] = RESEARCH_CONFIG.datasets.map(pin => {
        const file = flags[`${pin.id}-file`] || (dataDir ? path.join(dataDir, pin.fileName) : undefined);
        if (!file)
            throw new Error(`No file for dataset ${pin.id}: pass --${pin.id}-file or --data-dir (or set FDC_DATA_DIR)`);
        return { pin: { ...pin, id: pin.id as BundleDatasetId }, file };
    });
    const out = await assertLocalPath(flags.out);
    const entries = await readManifest(), matchTable = await readMatchTable();
    const { bundle, eligibleCount, candidateTotals, skippedRecords } = await buildGeminiBundle({ entries, matchTable, datasets, count, now });
    const prompt = renderPrompt(await readFile(PROMPT_TEMPLATE, 'utf8'), bundle);
    await mkdir(out, { recursive: true });
    const bundleFile = path.join(out, `gemini-bundle-${bundle.bundleId}.json`);
    const promptFile = path.join(out, 'gemini-prompt.md');
    await writeFile(bundleFile, JSON.stringify(bundle, null, 2) + '\n', { mode: 0o600 });
    await writeFile(promptFile, prompt, { mode: 0o600 });
    const result = {
        bundleId: bundle.bundleId,
        inputDigest: bundle.inputDigest,
        targetCount: bundle.targets.length,
        candidateTotals,
        selection: { eligibleCount, ...bundle.selection },
        skippedRecords,
        files: { bundle: bundleFile, prompt: promptFile },
    };
    output(result);
    return result;
}

export function isGeminiBundleCliEntry(argv: readonly string[], scriptFilePath: string) {
    const launcher = argv[1];
    if (!launcher)
        return false;
    const real = (p: string) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
    return real(launcher) === real(scriptFilePath);
}
if (isGeminiBundleCliEntry(process.argv, fileURLToPath(import.meta.url))) {
    geminiBundleCli(process.argv.slice(2)).catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
}
