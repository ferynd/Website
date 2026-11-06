/**
 * Read-only nutrient census. Built for Part B and not run in Part A.
 * Prints aggregate counts only. Document names and nutrient values stay in the optional backup file.
 */
import { constants, existsSync, mkdirSync, openSync, closeSync, fsyncSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  censusFromFixtures,
  digest,
  encodeBackup,
  refuseUnsafeRun,
  type CensusDoc,
  type CensusUser,
} from './nutrientCensusLogic';

const TARGET_PROJECT = 'jlb-calorietracker';

class CensusPreconditionError extends Error {}

/** Admin timestamps are not JSON. Keep numbers and nulls as themselves. */
function toJsonSafe(value: unknown): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === 'object') {
    const record = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof record.toMillis === 'function' && typeof record.seconds === 'number') {
      return { seconds: record.seconds, nanoseconds: typeof record.nanoseconds === 'number' ? record.nanoseconds : 0 };
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, toJsonSafe(item)]));
  }
  return null;
}

function isProcessEntry(): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    return import.meta.url === pathToFileURL(argvPath).href;
  }
}

function exclusivePrivateFile(path: string, contents: string): void {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

type DocSnap = { id: string; data(): Record<string, unknown> | undefined };
type ReaderDb = {
  collection(path: string): {
    listDocuments(): Promise<Array<{ id: string }>>;
    get(): Promise<{ docs: DocSnap[] }>;
  };
};

async function readCollection(db: ReaderDb, path: string): Promise<CensusDoc[]> {
  const snap = await db.collection(path).get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() ?? {} }));
}

function plainDocs(docs: CensusDoc[]): CensusDoc[] {
  return docs.map((doc) => {
    const data = toJsonSafe(doc.data);
    return {
      id: doc.id,
      data: typeof data === 'object' && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : {},
    };
  });
}

async function loadUsers(db: ReaderDb): Promise<{ users: CensusUser[]; backup: { path: string; data: Record<string, unknown> }[] }> {
  const trackerRefs = await db.collection('artifacts/default-app-id/users').listDocuments();
  const recipeRefs = await db.collection('artifacts/recipe-standardizer/users').listDocuments();
  const uids = [...new Set([...trackerRefs, ...recipeRefs].map((ref) => ref.id))].sort();
  const users: CensusUser[] = [];
  const backup: { path: string; data: Record<string, unknown> }[] = [];
  for (const uid of uids) {
    const foods = plainDocs(await readCollection(db, `artifacts/default-app-id/users/${uid}/foodItems`));
    const dailyEntries = plainDocs(await readCollection(db, `artifacts/default-app-id/users/${uid}/dailyEntries`));
    const recipes = plainDocs(await readCollection(db, `artifacts/recipe-standardizer/users/${uid}/recipes`));
    users.push({ uid, foods, dailyEntries, recipes });
    const groups = [
      [`artifacts/default-app-id/users/${uid}/foodItems`, foods],
      [`artifacts/default-app-id/users/${uid}/dailyEntries`, dailyEntries],
      [`artifacts/recipe-standardizer/users/${uid}/recipes`, recipes],
    ] as const;
    for (const [prefix, docs] of groups) {
      for (const doc of docs) backup.push({ path: `${prefix}/${doc.id}`, data: doc.data });
    }
  }
  return { users, backup };
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const separator = argv.indexOf('--');
  const { values } = parseArgs({
    args: argv.slice(separator >= 0 ? separator + 1 : 2),
    options: {
      project: { type: 'string' },
      out: { type: 'string' },
      'dry-run': { type: 'boolean' },
      backup: { type: 'boolean' },
    },
  });
  if (!values.project || !values.out) throw new CensusPreconditionError('--project and --out are required');
  if (values.project !== TARGET_PROJECT) throw new CensusPreconditionError('Census project must be jlb-calorietracker');
  const out = resolve(values.out);
  try {
    refuseUnsafeRun({ dryRun: values['dry-run'] === true, outputDirExists: existsSync(out) });
  } catch (error) {
    throw new CensusPreconditionError(error instanceof Error ? error.message : 'Refusing to run');
  }
  const repo = realpathSync(resolve(dirname(new URL(import.meta.url).pathname), '../..'));
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const realOut = realpathSync(out);
  const rel = relative(repo, realOut);
  if (!(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    throw new CensusPreconditionError('Census output must be outside the checkout');
  }
  if ((statSync(realOut).mode & 0o077) !== 0) throw new CensusPreconditionError('Output directory must have mode 0700');

  const { applicationDefault, deleteApp, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const credential = applicationDefault();
  await credential.getAccessToken();
  const app = initializeApp({ projectId: values.project, credential });
  const db = getFirestore(app);
  try {
    const { users, backup } = await loadUsers(db as unknown as ReaderDb);
    const report = censusFromFixtures(users);
    if (values.backup) {
      exclusivePrivateFile(resolve(realOut, 'backup.json'), `${JSON.stringify(encodeBackup(backup))}\n`);
    }
    const planText = `${JSON.stringify(report, null, 2)}\n`;
    exclusivePrivateFile(resolve(realOut, 'plan.json'), planText);
    console.log(JSON.stringify({ mode: 'dry-run', projectId: values.project, counts: report, planSha256: digest(planText) }));
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

if (isProcessEntry()) {
  main().catch((error: unknown) => {
    console.error(error instanceof CensusPreconditionError ? error.message : 'Census stopped without printing private data.');
    process.exitCode = 1;
  });
}
