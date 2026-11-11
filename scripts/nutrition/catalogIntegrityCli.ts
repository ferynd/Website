/**
 * #63 V4 catalog integrity entry. Prints counts and defect codes only:
 *
 *   npx --no-install vite-node scripts/nutrition/catalogIntegrityCli.ts
 *       verify the shipped catalog (public/shared/nutrition/catalog/nutrition-curated)
 *   ... -- --previous <dir> --next <dir>
 *       verify both and the append-only relation previous -> next
 *   ... -- --combine <previousDir> <newDir>
 *       verify both, combine them in memory, verify the result and its
 *       append-only relation to previous
 *
 * Nothing is written to disk in any mode. Any defect makes the run fail after
 * the summary is printed.
 */
import { realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { combineCatalogs, readCatalogDirectory, verifyAppendOnly, verifyCatalog, type CatalogInput } from './catalogIntegrity';

export class CatalogIntegrityCliError extends Error {}
export const GENERIC_FAILURE = 'Catalog integrity check stopped without printing catalog content.';
export const DEFECTS_FOUND = 'Catalog integrity defects found';
const REPO_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
export const SHIPPED_CATALOG_DIR = resolve(REPO_ROOT, 'public/shared/nutrition/catalog/nutrition-curated');
const USAGE = 'Usage: [--previous <dir> --next <dir>] | [--combine <previousDir> <newDir>]';

export interface CliDeps {
    write?: (text: string) => void;
    /** Tests only: the directory verified when no mode is given. */
    shippedDir?: string;
}

async function load(dir: string): Promise<CatalogInput> {
    try {
        return await readCatalogDirectory(resolve(dir));
    }
    catch {
        throw new CatalogIntegrityCliError('A catalog directory could not be read');
    }
}
const counts = ({ variantIds: _ids, ...rest }: Awaited<ReturnType<typeof verifyCatalog>>) => rest;

export async function main(argv: string[] = process.argv, deps: CliDeps = {}) {
    const separator = argv.indexOf('--');
    let values: { previous?: string; next?: string; combine?: boolean };
    let positionals: string[];
    try {
        ({ values, positionals } = parseArgs({ args: argv.slice(separator >= 0 ? separator + 1 : 2), allowPositionals: true, options: {
            previous: { type: 'string' }, next: { type: 'string' }, combine: { type: 'boolean' },
        } }));
    }
    catch {
        throw new CatalogIntegrityCliError(USAGE);
    }
    const pair = values.previous !== undefined || values.next !== undefined;
    if (pair && (!values.previous || !values.next || values.combine || positionals.length))
        throw new CatalogIntegrityCliError(USAGE);
    if (values.combine && positionals.length !== 2)
        throw new CatalogIntegrityCliError(USAGE);
    if (!pair && !values.combine && positionals.length)
        throw new CatalogIntegrityCliError(USAGE);

    let summary: Record<string, unknown>;
    let defects: number;
    try {
        if (pair || values.combine) {
            const [prevDir, nextDir] = pair ? [values.previous!, values.next!] : positionals;
            const previous = await load(prevDir), next = await load(nextDir);
            const [p, n] = await Promise.all([verifyCatalog(previous), verifyCatalog(next)]);
            if (pair) {
                const append = await verifyAppendOnly(previous, next);
                summary = { previous: counts(p), next: counts(n), append };
                defects = p.defects.length + n.defects.length + append.defects.length;
            }
            else if (p.defects.length || n.defects.length) {
                summary = { previous: counts(p), next: counts(n), combined: null };
                defects = p.defects.length + n.defects.length;
            }
            else {
                const combined = await combineCatalogs(previous, next);
                const c = await verifyCatalog(combined);
                const append = await verifyAppendOnly(previous, combined);
                summary = { previous: counts(p), next: counts(n), combined: counts(c), append: { added: append.added.length, preserved: append.preserved, defects: append.defects } };
                defects = c.defects.length + append.defects.length;
            }
        }
        else {
            const shipped = counts(await verifyCatalog(await load(deps.shippedDir ?? SHIPPED_CATALOG_DIR)));
            summary = shipped;
            defects = shipped.defects.length;
        }
    }
    catch (error) {
        throw error instanceof CatalogIntegrityCliError ? error : new CatalogIntegrityCliError(GENERIC_FAILURE);
    }
    (deps.write ?? ((out: string) => process.stdout.write(out)))(`${JSON.stringify(summary, null, 2)}\n`);
    if (defects)
        throw new CatalogIntegrityCliError(DEFECTS_FOUND);
    return summary;
}

/** vite-node consumes the script path, so its own binary is argv[1]. Nothing else imports this file except its test. */
export function isProcessEntry(argv: readonly string[], scriptFilePath: string) {
    const launcher = argv[1];
    if (!launcher)
        return false;
    const name = basename(launcher);
    if (name === 'vite-node' || name === 'vite-node.mjs')
        return true;
    const real = (path: string) => { try { return realpathSync(path); } catch { return resolve(path); } };
    return real(launcher) === real(scriptFilePath);
}

if (isProcessEntry(process.argv, fileURLToPath(import.meta.url))) {
    main().catch((error: unknown) => {
        process.stderr.write(`${error instanceof CatalogIntegrityCliError ? error.message : GENERIC_FAILURE}\n`);
        process.exitCode = 1;
    });
}
