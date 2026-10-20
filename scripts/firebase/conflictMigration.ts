import { createHash } from 'node:crypto';
import { Timestamp, GeoPoint, DocumentReference, type DocumentData, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';

export const TARGET_PROJECT = 'jlb-calorietracker';
const sides = ['personA', 'personB'] as const;
type Stamp = { seconds: number; nanoseconds: number };
type Mirror = 'personASubmittedAt' | 'personBSubmittedAt';
export type PlannedConflict = {
  path: string;
  versions: Record<string, Stamp | null>;
  writes: Partial<Record<Mirror, Stamp | null>>;
};
export type MigrationPlan = {
  schemaVersion: 1; projectId: string; createdAt: string; backupSha256: string;
  counts: { scanned: number; affected: number; unchanged: number; blocked: number; fields: number };
  issues: { path: string; reasons: string[] }[];
  entries: PlannedConflict[];
};
export const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const stamp = (value: Timestamp): Stamp => ({ seconds: value.seconds, nanoseconds: value.nanoseconds });
const sameStamp = (a: Stamp | null, b: Stamp | null) =>
  a === null || b === null ? a === b : a.seconds === b.seconds && a.nanoseconds === b.nanoseconds;
const has = (data: DocumentData, key: string) => Object.prototype.hasOwnProperty.call(data, key);

/** Does not return/log reflection content; only writes to the two parent mirrors. */
export function planMirrors(tracker: DocumentData | undefined, conflictId: string, conflict: DocumentData, reflections: (DocumentData | undefined)[]) {
  const writes: PlannedConflict['writes'] = {};
  const reasons: string[] = [];
  if (!tracker) return { writes, reasons: ['missing tracker'] };
  for (const [index, side] of sides.entries()) {
    const key: Mirror = `${side}SubmittedAt`;
    const reflection = reflections[index];
    const uid = tracker[`${side}Uid`];
    let submitted: Timestamp | null = null;
    if (reflection) {
      if (typeof uid !== 'string' || !uid || reflection.authorUid !== uid
        || reflection.id !== side || reflection.person !== side || reflection.conflictId !== conflictId) {
        reasons.push(`${side}: side/author/document identity mismatch`);
        continue;
      }
      if (reflection.submittedAt != null && !(reflection.submittedAt instanceof Timestamp)) {
        reasons.push(`${side}: invalid submission timestamp`);
        continue;
      }
      submitted = reflection.submittedAt ?? null;
    }
    const current = conflict[key];
    if (current != null && (!(current instanceof Timestamp) || !submitted || !current.isEqual(submitted))) {
      reasons.push(`${side}: existing mirror disagrees with the genuine submission`);
      continue;
    }
    if (!has(conflict, key) || (current == null && submitted)) writes[key] = submitted ? stamp(submitted) : null;
  }
  // Quarantine the whole conflict, rather than partially correcting inconsistent data.
  return { writes: reasons.length ? {} : writes, reasons };
}

/** Lossless tagged backup encoding. Private values stay in the protected file. */
export function encodeBackup(value: unknown): unknown {
  if (value === null) return { type: 'null' };
  if (value instanceof Timestamp) return { type: 'timestamp', ...stamp(value) };
  if (value instanceof GeoPoint) return { type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (value instanceof DocumentReference) {
    // Firestore 7 exposes this runtime getter but omits it from its .d.ts.
    const source = value.firestore as Firestore & { readonly projectId?: string };
    if (!source.projectId) throw new Error('Cannot preserve reference project metadata');
    return { type: 'reference', projectId: source.projectId, databaseId: source.databaseId, path: value.path };
  }
  if (Buffer.isBuffer(value)) return { type: 'bytes', base64: value.toString('base64') };
  if (Array.isArray(value)) return { type: 'array', values: value.map(encodeBackup) };
  if (typeof value === 'object' && value
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return {
    type: 'map', fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeBackup(item)])),
  };
  if (['string', 'number', 'boolean'].includes(typeof value)) return {
    type: typeof value, value: typeof value === 'number' && !Number.isFinite(value) ? String(value) : value,
  };
  throw new Error('Unsupported backup value; migration aborted before writing');
}
function backupSnapshot(snapshot: DocumentSnapshot) {
  return { path: snapshot.ref.path, exists: snapshot.exists, updateTime: snapshot.updateTime ? stamp(snapshot.updateTime) : null,
    data: snapshot.exists ? encodeBackup(snapshot.data()) : null };
}

export async function makeDryRun(db: Firestore, projectId: string) {
  const plan: MigrationPlan = {
    schemaVersion: 1, projectId, createdAt: new Date().toISOString(), backupSha256: '',
    counts: { scanned: 0, affected: 0, unchanged: 0, blocked: 0, fields: 0 }, issues: [], entries: [],
  };
  const backup: ReturnType<typeof backupSnapshot>[] = [];
  // listDocuments includes missing parent documents with surviving subcollections.
  for (const trackerRef of await db.collection('artifacts/conflict-tracker/trackers').listDocuments()) {
    for (const conflictRef of await trackerRef.collection('conflicts').listDocuments()) {
      await db.runTransaction(async tx => {
        const snapshots = await tx.getAll(trackerRef, conflictRef, ...sides.map(side => conflictRef.collection('reflections').doc(side)));
        const [tracker, conflict, a, b] = snapshots;
        const reflectionDocs = await tx.get(conflictRef.collection('reflections'));
        plan.counts.scanned++;
        if (!conflict.exists) {
          plan.counts.blocked++;
          plan.issues.push({ path: conflictRef.path, reasons: ['missing conflict parent with surviving subcollection'] });
          return;
        }
        if (reflectionDocs.docs.some(snapshot => !['personA', 'personB'].includes(snapshot.id))) {
          plan.counts.blocked++;
          plan.issues.push({ path: conflictRef.path, reasons: ['unexpected reflection document IDs require review'] });
          return;
        }
        const { writes, reasons } = planMirrors(tracker.data(), conflict.id, conflict.data()!, [a.data(), b.data()]);
        if (reasons.length) {
          plan.counts.blocked++;
          plan.issues.push({ path: conflictRef.path, reasons });
        } else if (!Object.keys(writes).length) plan.counts.unchanged++;
        else {
          plan.counts.affected++;
          plan.counts.fields += Object.keys(writes).length;
          plan.entries.push({ path: conflictRef.path, writes, versions: Object.fromEntries(snapshots.map(snapshot => [
            snapshot.ref.path, snapshot.updateTime ? stamp(snapshot.updateTime) : null,
          ])) });
          backup.push(...snapshots.map(backupSnapshot));
        }
      }, { readOnly: true });
    }
  }
  const backupText = JSON.stringify({ schemaVersion: 1, projectId, createdAt: plan.createdAt, records: backup }, null, 2) + '\n';
  plan.backupSha256 = digest(backupText);
  return { plan, backupText };
}

/** Applies only an approved plan's mirror fields, with transactional drift checks. */
export async function applyEntry(db: Firestore, entry: PlannedConflict): Promise<'applied' | 'already-applied'> {
  if (!/^artifacts\/conflict-tracker\/trackers\/[^/]+\/conflicts\/[^/]+$/.test(entry.path)) throw new Error('Invalid conflict path');
  const parent = db.doc(entry.path);
  const tracker = parent.parent.parent!;
  const refs = [tracker, parent, ...sides.map(side => parent.collection('reflections').doc(side))];
  const writes: DocumentData = {};
  for (const [key, value] of Object.entries(entry.writes)) {
    if (!['personASubmittedAt', 'personBSubmittedAt'].includes(key)) throw new Error('Unexpected migration field');
    writes[key] = value === null ? null : new Timestamp(value.seconds, value.nanoseconds);
  }
  if (!Object.keys(writes).length) throw new Error('Empty migration write');
  return db.runTransaction(async tx => {
    const snapshots = await tx.getAll(...refs);
    const [trackerSnap, conflict, a, b] = snapshots;
    const reflectionDocs = await tx.get(parent.collection('reflections'));
    if (reflectionDocs.docs.some(snapshot => !['personA', 'personB'].includes(snapshot.id))) {
      throw new Error('Unexpected reflection documents appeared since dry run');
    }
    if (!conflict.exists) throw new Error('Conflict changed since dry run');
    const current = planMirrors(trackerSnap.data(), conflict.id, conflict.data()!, [a.data(), b.data()]);
    if (current.reasons.length) throw new Error('Conflict became inconsistent since dry run');
    // A repeat run is a no-op only if every planned value is already present and
    // the underlying submissions still justify it.
    const applied = Object.entries(writes).every(([key, value]) => {
      const actual = conflict.data()![key];
      return has(conflict.data()!, key) && (value === null ? actual === null : actual instanceof Timestamp && actual.isEqual(value));
    });
    if (applied) return 'already-applied';
    for (const snapshot of snapshots) {
      if (!has(entry.versions, snapshot.ref.path)
        || !sameStamp(snapshot.updateTime ? stamp(snapshot.updateTime) : null, entry.versions[snapshot.ref.path])) {
        throw new Error('Source changed since dry run; generate a fresh plan and backup');
      }
    }
    if (JSON.stringify(current.writes) !== JSON.stringify(entry.writes)) throw new Error('Plan does not match source submissions');
    tx.update(parent, writes);
    return 'applied';
  });
}
