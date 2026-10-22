/* --- CONFIGURATION: fake transaction errors --- */
/** In-memory atomic staging with Firestore field replacement and read-before-write semantics. */

import type { RecipeTxPort, RecipeTxSnapshot } from '../lib/recipeRevision';
import type { ExportTxPort } from '../lib/nutritionExportTx';

const FAKE_ERRORS = {
  missing: 'No document to update',
  lateRead: 'reads must precede writes',
} as const;

/** Minimal transaction fake implementing both recipe and export ports. */
export class FakeTx implements RecipeTxPort<string>, ExportTxPort<string> {
  /** Ordered read/write calls for transaction-order assertions. */
  readonly operations: string[] = [];
  private readonly staged = new Map<string, Record<string, unknown>>();
  private hasWritten = false;

  constructor(private readonly store: Map<string, Record<string, unknown>>) { }

  /** Read an isolated snapshot before staging any writes. */
  async get(ref: string): Promise<RecipeTxSnapshot> {
    if (this.hasWritten) throw new Error(FAKE_ERRORS.lateRead);
    this.operations.push(`get:${ref}`);
    const present = this.store.has(ref);
    const value = structuredClone(this.store.get(ref));
    return { exists: () => present, data: () => value };
  }

  /** Stage a full document replacement. */
  set(ref: string, data: Record<string, unknown>): void {
    this.hasWritten = true;
    this.operations.push(`set:${ref}`);
    this.staged.set(ref, structuredClone(data));
  }

  /** Top-level keys replace fields wholesale; dotted keys update nested fields. */
  update(ref: string, data: Record<string, unknown>): void {
    if (!this.store.has(ref) && !this.staged.has(ref)) throw new Error(FAKE_ERRORS.missing);
    this.hasWritten = true;
    this.operations.push(`update:${ref}`);
    const next = structuredClone(this.staged.get(ref) ?? this.store.get(ref)) ?? {};
    for (const [path, value] of Object.entries(data)) {
      const parts = path.split('.');
      let target = next;
      for (const part of parts.slice(0, -1)) {
        const child = target[part];
        if (!child || typeof child !== 'object' || Array.isArray(child)) target[part] = {};
        target = target[part] as Record<string, unknown>;
      }
      target[parts[parts.length - 1]] = structuredClone(value);
    }
    this.staged.set(ref, next);
  }

  /** Apply staged writes only after successful completion of the transaction callback. */
  commit(): void {
    for (const [path, data] of this.staged) this.store.set(path, data);
  }
}

/** Atomic in-memory store with no network or production effects. */
export class FakeFirestore {
  /** Committed document maps keyed by path. */
  readonly store = new Map<string, Record<string, unknown>>();

  /** Discard every staged write if the body throws. */
  async runTransaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    const tx = new FakeTx(this.store);
    const result = await fn(tx);
    tx.commit();
    return result;
  }

  /** Model an unconditional library delete. */
  delete(path: string): void {
    this.store.delete(path);
  }
}
