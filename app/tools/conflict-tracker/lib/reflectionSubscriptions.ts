import {
  doc, onSnapshot, serverTimestamp, updateDoc, type Firestore, type FirestoreError,
} from 'firebase/firestore';
import { bothSubmitted, selfHealPatch } from './submission';
import type { Reflection } from './types';

type Side = Reflection['person'];

/**
 * Subscribe to named documents, never the restricted collection. The parent
 * listener controls partner access using committed (not optimistic) mirrors.
 * A null side (unclaimed member/admin observer) reads nothing before reveal.
 * When `ownUid` is given, a historical own submission whose parent mirror is
 * missing is healed once per subscription (own side only; see selfHealPatch).
 */
export function subscribeReflections(
  db: Firestore,
  trackerId: string,
  conflictId: string,
  ownSide: Side | null,
  onData: (reflections: Reflection[], error?: FirestoreError) => void,
  ownUid?: string,
): () => void {
  const parent = doc(db, 'artifacts', 'conflict-tracker', 'trackers', trackerId, 'conflicts', conflictId);
  const values = new Map<Side, Reflection>();
  const subscriptions = new Map<Side, { stop: () => void }>();
  let stopped = false;
  let serverRevealed = false;
  let serverParent: Record<string, unknown> | undefined;
  let ownRaw: Record<string, unknown> | undefined;
  let healAttempted = false;
  const maybeHeal = () => {
    if (stopped || healAttempted || !ownSide || !ownUid) return;
    const patch = selfHealPatch(ownSide, ownUid, conflictId, serverParent, ownRaw);
    if (!patch) return;
    healAttempted = true; // One attempt per subscription: never loop on failure.
    updateDoc(parent, { ...patch, updatedAt: serverTimestamp() }).catch((error: FirestoreError) => {
      // Code only; never reflection data.
      console.warn('Conflict Tracker: could not restore submission mirror', error?.code);
    });
  };
  const emit = (error?: FirestoreError) => {
    if (!stopped) onData(
      (['personA', 'personB'] as const).flatMap(side => values.has(side) ? [values.get(side)!] : []),
      error,
    );
  };
  const remove = (side: Side) => {
    const subscription = subscriptions.get(side);
    subscriptions.delete(side); // Ignore an already queued snapshot/error.
    subscription?.stop();
    values.delete(side);
  };
  const watch = (side: Side) => {
    if (subscriptions.has(side)) return;
    const subscription = { stop: () => {} };
    subscriptions.set(side, subscription);
    subscription.stop = onSnapshot(doc(parent, 'reflections', side), snap => {
      if (stopped || subscriptions.get(side) !== subscription) return;
      if (side === ownSide) {
        ownRaw = snap.exists() && !snap.metadata.hasPendingWrites ? snap.data() : undefined;
        maybeHeal();
      }
      if (snap.exists()) {
        const data = snap.data() as Reflection;
        values.set(side, {
          ...data, id: side,
          tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string') : [],
        });
      } else values.delete(side);
      emit();
    }, error => {
      if (stopped || subscriptions.get(side) !== subscription) return;
      remove(side);
      emit(error);
    });
  };

  if (ownSide) watch(ownSide);
  const stopParent = onSnapshot(parent, { includeMetadataChanges: true }, snap => {
    if (stopped) return;
    // Cached/optimistic parent data must not initiate a prohibited remote read.
    // Once confirmed by the server the last server state wins: rules never let a member
    // reset a mirror, so later local writes must not tear down the partner listener.
    if (!snap.exists()) { serverRevealed = false; serverParent = undefined; }
    else if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) {
      serverParent = snap.data();
      serverRevealed = bothSubmitted(serverParent);
      maybeHeal();
    }
    const revealed = serverRevealed;
    for (const side of ['personA', 'personB'] as const) {
      if (side === ownSide || revealed) watch(side);
      else remove(side);
    }
    emit();
  }, error => {
    if (stopped) return;
    for (const side of ['personA', 'personB'] as const) remove(side);
    emit(error);
  });

  return () => {
    stopped = true;
    stopParent();
    for (const side of ['personA', 'personB'] as const) remove(side);
  };
}
