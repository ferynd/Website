import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
import { calorieErrors, ownershipErrors, quarantineErrors, retryErrors, stageErrors, workflowErrors } from './lib/contract.mjs';
const read = (file) => fs.readFileSync(file, 'utf8');
const json = (file) => JSON.parse(read(file));
const files = [...new Set((await exec('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })).stdout.split('\0').filter((file) => file && fs.existsSync(file)))];
const workflows = Object.fromEntries(files.filter((file) => /^\.github\/workflows\/.*\.ya?ml$/.test(file)).map((file) => [file, read(file)]));
const contract = json('.github/ci/contract.json');
const tests = Object.fromEntries(files.filter((file) => /\.test\.[cm]?[jt]sx?$/.test(file)).map((file) => [file, read(file)]));
const quarantine = quarantineErrors(json('.github/ci/quarantine.json'), tests, contract.stages);
const configs = Object.fromEntries(files.filter((file) => /(?:^|\/)vitest(?:\.[\w-]+)?\.config\.[cm]?[jt]s$/.test(file)).map((file) => [file, read(file)]));
const packages = files.filter((file) => /(?:^|\/)package\.json$/.test(file));
const scripts = Object.fromEntries(packages.flatMap((file) => Object.entries(json(file).scripts ?? {}).map(([name, script]) => [`${file}:${name}`, script])));
const errors = [...stageErrors(contract, workflows), ...ownershipErrors(files, contract.stages),
  ...calorieErrors(files, json('public/tools/CalorieTracker/package.json').scripts.test),
  ...quarantine.errors, ...retryErrors(configs, scripts), ...workflowErrors(workflows)];
for (const warning of quarantine.warnings) console.log(`::warning::${warning}`);
for (const error of errors) console.error(`FAIL ${error}`);
console.log(`CONTRACT ${errors.length ? 'FAIL' : 'PASS'}`);
process.exitCode = errors.length ? 1 : 0;
