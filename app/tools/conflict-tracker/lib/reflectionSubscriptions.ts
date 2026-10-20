import {
  doc, onSnapshot, type Firestore, type FirestoreError,
} from 'firebase/firestore';
import { bothSubmitted } from './submission';
import type { Reflection } from './types';

type Side = Reflection['person'];

/**
 * Subscribe to named documents, never the restricted collection. The parent
 * listener controls partner access using committed (not optimistic) mirrors.
 * A null side (unclaimed member/admin observer) reads nothing before reveal.
 */
export function subscribeReflections(
  db: Firestore,
  trackerId: string,
  conflictId: string,
  ownSide: Side | null,
  onData: (reflections: Reflection[], error?: FirestoreError) => void,
): () => void {
  const parent = doc(db, 'artifacts', 'conflict-tracker', 'trackers', trackerId, 'conflicts', conflictId);
  const values = new Map<Side, Reflection>();
  const subscriptions = new Map<Side, { stop: () => void }>();
  let stopped = false;
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
    const revealed = snap.exists() && !snap.metadata.fromCache
      && !snap.metadata.hasPendingWrites && bothSubmitted(snap.data());
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
