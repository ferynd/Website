import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
import { catalogueErrors } from './lib/catalogue.mjs';
import { docLinkErrors, hasBackLink } from './lib/docs.mjs';
import { allowlistErrors, scanSensitive, secretFile, unexpectedSensitive } from './lib/sensitive.mjs';

const args = process.argv.slice(2);
let only, root = process.cwd();
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--only' && args[i + 1]) only = args[++i];
  else if (args[i] === '--root' && args[i + 1]) root = path.resolve(args[++i]);
  else { console.error('usage: check-docs-manifest.mjs [--only catalogue|back-links|docs|secret-files|sensitive] [--root dir]'); process.exit(2); }
}
if (only && !['catalogue', 'back-links', 'docs', 'secret-files', 'sensitive'].includes(only)) process.exit(2);
const repo = (await exec('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' })).stdout.trim();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const inRepo = root === repo;
function walk(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = `${prefix}${entry.name}`;
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? walk(path.join(dir, entry.name), `${name}/`) : [name];
  });
}
const tracked = (await exec('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' })).stdout.split('\0').filter(Boolean);
// Include new worktree files so local checks also cover changes before git add.
const files = inRepo ? [...new Set((await exec('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8' })).stdout.split('\0').filter(Boolean))].filter(exists) : walk(root);
const allowlist = JSON.parse(fs.readFileSync(path.join(repo, '.github/ci/sensitive-allowlist.json'), 'utf8'));
const errors = [];
const run = (rule, fn) => { if (!only || only === rule) errors.push(...fn()); };
run('catalogue', () => catalogueErrors(Object.fromEntries(['app/page.tsx', 'app/tools/page.tsx', 'app/games/page.tsx', 'app/trips/page.tsx'].map((file) => [file, read(file)])), exists));
run('back-links', () => files.filter((file) => /^public\/.*\/index\.html$/.test(file) && !hasBackLink(read(file))).map((file) => `back-link: ${file}`));
run('docs', () => files.filter((file) => /^(?:README|AGENTS|CLAUDE|ARCHITECTURE|SECURITY|BACKLOG|CONTRIBUTING)\.md$|^(?:backlogs|docs)\/.+\.md$/.test(file))
  .flatMap((file) => docLinkErrors(file, read(file), exists, { checkCodePaths: !/-completed\.md$/.test(file), read })));
run('secret-files', () => (inRepo ? tracked : files).filter(secretFile).map((file) => `secret-file: ${file}`));
run('sensitive', () => {
  const hits = files.flatMap((file) => {
    const data = fs.readFileSync(path.join(root, file));
    return data.includes(0) ? [] : scanSensitive(file, data.toString('utf8'));
  });
  return [...allowlistErrors(allowlist.entries), ...unexpectedSensitive(hits, allowlist.entries).map(({ file, pattern }) => `sensitive:${pattern}: ${file}`)];
});
for (const error of [...new Set(errors)]) console.error(`FAIL ${error}`);
console.log(`DOCS ${errors.length ? 'FAIL' : 'PASS'}`);
process.exitCode = errors.length ? 1 : 0;
