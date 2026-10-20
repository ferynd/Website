import { constants, existsSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, realpathSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { applyEntry, digest, makeDryRun, TARGET_PROJECT, type MigrationPlan } from './conflictMigration';

const separator = process.argv.indexOf('--');
const { values } = parseArgs({
  args: process.argv.slice(separator >= 0 ? separator + 1 : 2),
  options: {
    project: { type: 'string' }, out: { type: 'string' }, 'dry-run': { type: 'boolean' }, apply: { type: 'boolean' },
    'approve-plan-sha256': { type: 'string' }, 'maintenance-confirmed': { type: 'boolean' }, emulator: { type: 'boolean' },
  },
});
function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function exclusivePrivateFile(path: string, contents: string) {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
}
async function main() {
  requireCondition(values.out && values.project, '--project and --out are required');
  requireCondition(!!values['dry-run'] !== !!values.apply, 'Choose exactly one of --dry-run or --apply');
  const projectId = values.project;
  if (values.emulator) {
    requireCondition(projectId === 'demo-website-rules-test' && /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? ''), 'Emulator mode requires the local demo project and loopback Firestore');
  } else {
    requireCondition(projectId === TARGET_PROJECT && !process.env.FIRESTORE_EMULATOR_HOST, 'Production requires jlb-calorietracker and no emulator routing');
  }
  const out = resolve(values.out);
  const repo = realpathSync(resolve(dirname(new URL(import.meta.url).pathname), '../..'));
  if (values['dry-run']) {
    requireCondition(!existsSync(out), 'Use a new output directory for each dry run; backups are never overwritten');
    mkdirSync(out, { recursive: true, mode: 0o700 });
  }
  const realOut = realpathSync(out);
  const rel = relative(repo, realOut);
  requireCondition(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel), 'Private plans/backups must be outside the checkout');
  requireCondition((statSync(realOut).mode & 0o077) === 0, 'Output directory must have mode 0700');
  const credential = values.emulator ? undefined : applicationDefault();
  // Fail cleanly before Firestore starts background gRPC initialization.
  if (credential) await credential.getAccessToken();
  const app = initializeApp({ projectId, ...(credential ? { credential } : {}) });
  const db = getFirestore(app);
  try {
    if (values['dry-run']) {
      const { plan, backupText } = await makeDryRun(db, projectId);
      // Backup is durably written before publishing the plan that refers to it.
      exclusivePrivateFile(resolve(realOut, 'backup.json'), backupText);
      const planText = JSON.stringify(plan, null, 2) + '\n';
      exclusivePrivateFile(resolve(realOut, 'plan.json'), planText);
      console.log(JSON.stringify({ mode: 'dry-run', projectId, counts: plan.counts, issues: plan.issues.length,
        planSha256: digest(planText), backupSha256: plan.backupSha256,
        writes: 'Only personASubmittedAt/personBSubmittedAt on listed conflict parents; inspect protected plan.json',
        applied: 0 }, null, 2));
    } else {
      requireCondition(values['maintenance-confirmed'], 'Pause old writers and confirm maintenance before applying');
      const planText = readFileSync(resolve(realOut, 'plan.json'), 'utf8');
      requireCondition(values['approve-plan-sha256'] === digest(planText), 'The explicitly approved plan digest is required');
      const plan = JSON.parse(planText) as MigrationPlan;
      requireCondition(plan.schemaVersion === 1 && plan.projectId === projectId, 'Plan schema/project mismatch');
      requireCondition(plan.issues.length === 0 && plan.counts.blocked === 0, 'Resolve all inconsistencies with a new dry run before applying');
      requireCondition(digest(readFileSync(resolve(realOut, 'backup.json'), 'utf8')) === plan.backupSha256, 'Backup checksum mismatch');
      const audit = resolve(realOut, `apply-${Date.now()}.jsonl`);
      exclusivePrivateFile(audit, JSON.stringify({ event: 'start', projectId, planSha256: digest(planText), at: new Date().toISOString() }) + '\n');
      let applied = 0, unchanged = 0;
      for (const entry of plan.entries) {
        try {
          const result = await applyEntry(db, entry);
          if (result === 'applied') applied++; else unchanged++;
          appendFileSync(audit, JSON.stringify({ event: result, path: entry.path, at: new Date().toISOString() }) + '\n');
        } catch {
          appendFileSync(audit, JSON.stringify({ event: 'stopped', path: entry.path, applied, unchanged, at: new Date().toISOString() }) + '\n');
          throw new Error('Apply stopped; prior successes are recorded in the private audit. Re-run a dry run to inspect drift.');
        }
      }
      console.log(JSON.stringify({ mode: 'apply', projectId, applied, unchanged, planSha256: digest(planText) }));
    }
  } finally { await db.terminate(); await deleteApp(app); }
}
main().catch(() => {
  // SDK errors can include request data; never log them or a credential object.
  console.error('Migration stopped without printing private data. Verify explicit project/mode, trusted ADC, private output permissions, approved plan/backup digests, maintenance, and source versions.');
  process.exitCode = 1;
});
