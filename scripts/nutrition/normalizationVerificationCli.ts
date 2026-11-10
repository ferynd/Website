/**
 * #63 V3 normalization verification entry. Reads the two pinned FDC bulk
 * files kept outside the checkout and prints an aggregate JSON summary:
 *
 *   npx --no-install vite-node scripts/nutrition/normalizationVerificationCli.ts -- \
 *     --foundation <dir>/FoodData_Central_foundation_food_json_2026-10-29.json \
 *     --sr-legacy <dir>/FoodData_Central_sr_legacy_food_json_2018-04.json [--sample 100] [--all]
 *
 * Each file is verified against its researchConfig pin. Nothing is written:
 * every store and cache is in memory, and stdout is the only output. The
 * summary holds counts, registry keys, unit labels, FDC ids, and FDC
 * derivation codes; never a nutrient value or a file path.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { RESEARCH_CONFIG } from './researchConfig';
import { readManifest } from './manifestReader';
import { runNormalizationVerification, type VerificationDataset } from './normalizationVerification';

export class VerificationCliError extends Error {}
export const GENERIC_FAILURE = 'Normalization verification stopped without printing dataset content.';
const REPO_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const USAGE = 'Usage: --foundation <file> --sr-legacy <file> [--sample <n>] [--all]; files must be outside the checkout';

function outsideCheckout(repo: string, path: string) {
    const rel = relative(repo, path);
    return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

export interface CliDeps {
    repoRoot?: string;
    write?: (text: string) => void;
    /** Tests only: synthetic pins in place of the live researchConfig pins. */
    pins?: Record<string, VerificationDataset['pin']>;
}

export async function main(argv: string[] = process.argv, deps: CliDeps = {}) {
    const separator = argv.indexOf('--');
    let values: { foundation?: string; 'sr-legacy'?: string; sample?: string; all?: boolean };
    try {
        ({ values } = parseArgs({ args: argv.slice(separator >= 0 ? separator + 1 : 2), options: {
            foundation: { type: 'string' }, 'sr-legacy': { type: 'string' }, sample: { type: 'string' }, all: { type: 'boolean' },
        } }));
    } catch {
        throw new VerificationCliError(USAGE);
    }
    const sampleSize = values.sample === undefined ? 100 : Number(values.sample);
    if (!Number.isSafeInteger(sampleSize) || sampleSize < 1)
        throw new VerificationCliError(USAGE);
    const repo = deps.repoRoot ?? REPO_ROOT;
    const pins = deps.pins ?? Object.fromEntries(RESEARCH_CONFIG.datasets.map(d => [d.id, d]));
    const datasets: VerificationDataset[] = [];
    for (const id of ['foundation', 'sr-legacy'] as const) {
        const given = values[id];
        if (!given)
            throw new VerificationCliError(USAGE);
        let real: string;
        try {
            real = realpathSync(resolve(given));
        }
        catch {
            throw new VerificationCliError(`The ${id} file could not be opened`);
        }
        if (!outsideCheckout(repo, resolve(given)) || !outsideCheckout(repo, real))
            throw new VerificationCliError('Dataset files must be outside the checkout');
        datasets.push({ pin: pins[id], file: real });
    }
    let summary;
    try {
        summary = await runNormalizationVerification({ datasets, manifest: await readManifest(), sampleSize, all: values.all === true });
    }
    catch (error) {
        // Pin and checksum errors carry no dataset content; anything else stays generic.
        const message = error instanceof Error ? error.message : '';
        throw new VerificationCliError(/^(Dataset is unpinned|Dataset checksum mismatch|Invalid bulk food array)$/.test(message) ? message : GENERIC_FAILURE);
    }
    (deps.write ?? ((out: string) => process.stdout.write(out)))(`${JSON.stringify(summary, null, 2)}\n`);
    return summary;
}

/** vite-node consumes the script path, so its own binary is argv[1]. */
export function isProcessEntry(argv: readonly string[], scriptFilePath: string) {
    const launcher = argv[1];
    if (!launcher)
        return false;
    const name = basename(launcher);
    if (name === 'vite-node' || name === 'vite-node.mjs')
        return argv.slice(2).some(arg => arg === '--foundation' || arg.startsWith('--foundation='));
    const real = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
    return real(launcher) === real(scriptFilePath);
}

if (isProcessEntry(process.argv, fileURLToPath(import.meta.url))) {
    main().catch((error: unknown) => {
        process.stderr.write(`${error instanceof VerificationCliError ? error.message : GENERIC_FAILURE}\n`);
        process.exitCode = 1;
    });
}
