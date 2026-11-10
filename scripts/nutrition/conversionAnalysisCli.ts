/**
 * #77 conversion analysis entry. Reads a foods-only extract kept outside the
 * checkout and prints aggregate counts only:
 *
 *   npx --no-install vite-node scripts/nutrition/conversionAnalysisCli.ts -- --extract /private/foods.json
 *
 * The extract is a JSON array of `{ id?, data }` wrappers or bare food data.
 * Nothing is written. No name, id, path, or nutrient value is printed, including
 * in error messages.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { summarizeConversion } from './conversionAnalysis';

/** A precondition failure whose fixed message is safe to print. */
export class ConversionCliError extends Error {}

export const GENERIC_FAILURE = 'Conversion analysis stopped without printing private data.';

export const REPO_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));

function outsideCheckout(repo: string, path: string): boolean {
  const rel = relative(repo, path);
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

export type CliDeps = {
  repoRoot?: string;
  write?: (text: string) => void;
};

export async function main(argv: string[] = process.argv, deps: CliDeps = {}): Promise<void> {
  const separator = argv.indexOf('--');
  let extract: string | undefined;
  try {
    ({ values: { extract } } = parseArgs({
      args: argv.slice(separator >= 0 ? separator + 1 : 2),
      options: { extract: { type: 'string' } },
    }));
  } catch {
    throw new ConversionCliError('Usage: --extract <path outside the checkout>');
  }
  if (!extract) throw new ConversionCliError('Usage: --extract <path outside the checkout>');

  const repo = deps.repoRoot ?? REPO_ROOT;
  const requested = resolve(extract);
  if (!outsideCheckout(repo, requested)) throw new ConversionCliError('The extract must be outside the checkout');
  let real: string;
  try {
    real = realpathSync(requested);
  } catch {
    throw new ConversionCliError('The extract could not be opened');
  }
  if (!outsideCheckout(repo, real)) throw new ConversionCliError('The extract must be outside the checkout');

  let text: string;
  try {
    text = readFileSync(real, 'utf8');
  } catch {
    throw new ConversionCliError('The extract could not be read');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConversionCliError('The extract is not valid JSON');
  }
  if (!Array.isArray(parsed)) throw new ConversionCliError('The extract must be a JSON array of foods');

  const summary = summarizeConversion(parsed);
  (deps.write ?? ((out: string) => process.stdout.write(out)))(`${JSON.stringify(summary, null, 2)}\n`);
}

/** vite-node consumes the script path, so its own binary is argv[1]. Nothing else imports this file except its test. */
export function isProcessEntry(argv: readonly string[], scriptFilePath: string): boolean {
  const launcher = argv[1];
  if (!launcher) return false;
  const name = basename(launcher);
  if (name === 'vite-node' || name === 'vite-node.mjs') return true;
  const real = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  return real(launcher) === real(scriptFilePath);
}

if (isProcessEntry(process.argv, fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof ConversionCliError ? error.message : GENERIC_FAILURE}\n`);
    process.exitCode = 1;
  });
}
