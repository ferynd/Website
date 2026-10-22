import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expense, Payment, Trip, TripParticipant, UserProfile } from '../../pageTypes';
import { STALE_SETTINGS_MESSAGE, tripRevision, type TripSettingsFields } from '../tripSettings';

type AccountSnapshot = {
  exists: () => boolean;
  data: () => { displayName?: string; email?: string } | undefined;
};

type TripSnapshot = {
  id: string;
  exists: () => boolean;
  data: () => Omit<Trip, 'id'> | undefined;
};

type SettingsTransaction = {
  get: (ref: unknown) => Promise<TripSnapshot>;
  update: (...args: unknown[]) => void;
};

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  seed: [] as unknown[],
  setDoc: vi.fn((...args: unknown[]) => Promise.resolve(void args)),
  updateDoc: vi.fn((...args: unknown[]) => Promise.resolve(void args)),
  db: { name: 'test-db' },
  transactionGet: vi.fn<(ref: unknown) => Promise<TripSnapshot>>(),
  transactionUpdate: vi.fn<(...args: unknown[]) => void>(),
  runTransaction: vi.fn<(
    db: unknown,
    callback: (tx: SettingsTransaction) => Promise<void>,
  ) => Promise<void>>(),
  getDoc: vi.fn((...args: unknown[]): Promise<AccountSnapshot> => Promise.resolve(void args).then(() => ({
    exists: () => true,
    data: () => ({ displayName: 'Ada', email: 'ada@example.com' }),
  }))),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.index++;
      if (!(index in hooks.states)) {
        hooks.states[index] = index < hooks.seed.length
          ? hooks.seed[index]
          : (typeof initial === 'function' ? (initial as () => T)() : initial);
      }
      return [hooks.states[index] as T, (next: React.SetStateAction<T>) => {
        const current = hooks.states[index] as T;
        hooks.states[index] = typeof next === 'function' ? (next as (value: T) => T)(current) : next;
      }];
    },
  };
});

vi.mock('firebase/firestore', () => ({
  getDoc: (...args: unknown[]) => hooks.getDoc(...args),
  onSnapshot: vi.fn(() => () => undefined),
  orderBy: vi.fn(),
  query: vi.fn(),
  runTransaction: hooks.runTransaction,
  setDoc: (...args: unknown[]) => hooks.setDoc(...args),
  updateDoc: (...args: unknown[]) => hooks.updateDoc(...args),
  serverTimestamp: () => 'server-time',
  Timestamp: { fromDate: (date: Date) => ({ toDate: () => date }) },
}));

vi.mock('../../db', () => ({
  db: hooks.db,
  tripDoc: (id: string) => ({ id }),
  tripAuditCol: (id: string) => ({ id }),
  userDoc: (uid: string) => ({ id: uid }),
}));

import { TripProvider, useTrip } from '../../TripContext';

const person = (id: string, userId?: string): TripParticipant => ({
  id,
  name: `Name ${id}`,
  isRegistered: Boolean(userId),
  addedBy: 'admin',
  ...(userId ? { userId } : {}),
});

const trip: Trip = {
  id: 'trip-1',
  name: 'Weekend',
  createdBy: 'admin',
  participants: [person('a'), person('b', 'uid-b')],
  participantIds: ['a', 'uid-b'],
  expenses: [],
  payments: [],
  spendCaps: [],
  overageSplit: { type: 'even' },
  defaultSplit: {},
};

const admin: UserProfile = {
  uid: 'admin',
  email: 'admin@example.com',
  displayName: 'Admin',
  firstName: 'A',
  lastInitial: 'D',
  isAdmin: true,
};

const member: UserProfile = { ...admin, uid: 'member', isAdmin: false };

const validSettings: TripSettingsFields = {
  spendCaps: [{ participantId: 'a', maxAmount: 10 }],
  overageSplit: { type: 'manual', shares: { a: 25, b: 75 } },
  defaultSplit: { a: 40, b: 60 },
};

function serverSnapshot(serverTrip: Trip): TripSnapshot {
  const { id, ...data } = serverTrip;
  return { id, exists: () => true, data: () => data };
}

function mount(profile: UserProfile, expenses: Expense[] = [], payments: Payment[] = []) {
  hooks.states = [];
  hooks.index = 0;
  hooks.seed = [trip, expenses, payments, []];
  let api!: ReturnType<typeof useTrip>;
  function Capture() {
    api = useTrip();
    return null;
  }
  hooks.index = 0;
  renderToStaticMarkup(
    <TripProvider selectedTripId={trip.id} userProfile={profile}>
      <Capture />
    </TripProvider>,
  );
  return api;
}

beforeEach(() => {
  hooks.setDoc.mockClear();
  hooks.updateDoc.mockClear();
  hooks.transactionGet.mockReset();
  hooks.transactionGet.mockResolvedValue(serverSnapshot(trip));
  hooks.transactionUpdate.mockReset();
  hooks.runTransaction.mockReset();
  hooks.runTransaction.mockImplementation(async (_db, callback) => {
    await callback({ get: hooks.transactionGet, update: hooks.transactionUpdate });
  });
  hooks.getDoc.mockReset();
  hooks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ displayName: 'Ada', email: 'ada@example.com' }) });
});

describe('updateTripSettings', () => {
  it('rejects invalid settings before starting a transaction', async () => {
    const api = mount(admin);
    const baseline = tripRevision(trip);
    await expect(api.updateTripSettings({
      ...validSettings,
      spendCaps: [{ participantId: 'a', maxAmount: 10.005 }],
    }, baseline)).rejects.toThrow(/whole cents/);
    expect(hooks.runTransaction).not.toHaveBeenCalled();
    expect(hooks.transactionGet).not.toHaveBeenCalled();
    expect(hooks.transactionUpdate).not.toHaveBeenCalled();
    expect(hooks.updateDoc).not.toHaveBeenCalled();
    expect(hooks.setDoc).not.toHaveBeenCalled();
  });

  it('saves all settings with exactly one transactional update', async () => {
    const api = mount(admin);
    const baseline = tripRevision(trip);
    await expect(api.updateTripSettings(validSettings, baseline)).resolves.toBeUndefined();
    expect(hooks.runTransaction).toHaveBeenCalledTimes(1);
    expect(hooks.runTransaction).toHaveBeenCalledWith(hooks.db, expect.any(Function));
    expect(hooks.transactionGet).toHaveBeenCalledTimes(1);
    expect(hooks.transactionGet).toHaveBeenCalledWith({ id: 'trip-1' });
    expect(hooks.transactionUpdate).toHaveBeenCalledTimes(1);
    expect(hooks.updateDoc).not.toHaveBeenCalled();
    expect(hooks.setDoc).not.toHaveBeenCalled();
    expect(hooks.transactionUpdate).toHaveBeenCalledWith(
      { id: 'trip-1' },
      {
        spendCaps: validSettings.spendCaps,
        overageSplit: validSettings.overageSplit,
        defaultSplit: validSettings.defaultSplit,
        updatedAt: 'server-time',
      },
    );
  });

  it('rejects a server change that has not reached the cached snapshot', async () => {
    const api = mount(admin);
    hooks.transactionGet.mockResolvedValue(serverSnapshot({ ...trip, defaultSplit: { a: 100 } }));
    await expect(api.updateTripSettings(validSettings, tripRevision(trip)))
      .rejects.toThrow(STALE_SETTINGS_MESSAGE);
    expect(hooks.transactionGet).toHaveBeenCalledTimes(1);
    expect(hooks.transactionUpdate).not.toHaveBeenCalled();
    expect(hooks.updateDoc).not.toHaveBeenCalled();
    expect(hooks.setDoc).not.toHaveBeenCalled();
  });

  it('writes once when the caller acknowledges the server revision', async () => {
    const api = mount(admin);
    const serverTrip: Trip = { ...trip, defaultSplit: { a: 100 } };
    hooks.transactionGet.mockResolvedValue(serverSnapshot(serverTrip));
    await api.updateTripSettings(validSettings, tripRevision(trip), tripRevision(serverTrip));
    expect(hooks.transactionUpdate).toHaveBeenCalledTimes(1);
    expect(hooks.updateDoc).not.toHaveBeenCalled();
    expect(hooks.setDoc).not.toHaveBeenCalled();
  });

  it('rejects overwrite acknowledgement for an older server revision', async () => {
    const api = mount(admin);
    hooks.transactionGet.mockResolvedValue(serverSnapshot({ ...trip, defaultSplit: { b: 100 } }));
    await expect(api.updateTripSettings(validSettings, 'old-revision', tripRevision(trip)))
      .rejects.toThrow(STALE_SETTINGS_MESSAGE);
    expect(hooks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('validates settings against server travelers even when that revision is acknowledged', async () => {
    const api = mount(admin);
    const serverTrip: Trip = { ...trip, participants: [person('b', 'uid-b')], participantIds: ['uid-b'] };
    hooks.transactionGet.mockResolvedValue(serverSnapshot(serverTrip));
    await expect(api.updateTripSettings(validSettings, tripRevision(trip), tripRevision(serverTrip)))
      .rejects.toThrow(/distinct travelers/);
    expect(hooks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('reports a deleted trip without writing', async () => {
    const api = mount(admin);
    hooks.transactionGet.mockResolvedValue({ id: trip.id, exists: () => false, data: () => undefined });
    await expect(api.updateTripSettings(validSettings, tripRevision(trip)))
      .rejects.toThrow('The trip no longer exists.');
    expect(hooks.transactionUpdate).not.toHaveBeenCalled();
  });

  it('does not write settings for a non-admin', async () => {
    const api = mount(member);
    await expect(api.updateTripSettings(validSettings, tripRevision(trip))).rejects.toThrow(/admin/);
    expect(hooks.runTransaction).not.toHaveBeenCalled();
    expect(hooks.transactionUpdate).not.toHaveBeenCalled();
    expect(hooks.updateDoc).not.toHaveBeenCalled();
    expect(hooks.setDoc).not.toHaveBeenCalled();
  });
});

describe('linkParticipantAccount writes', () => {
  it('keeps the traveler id, recomputes participantIds, and does not write expenses', async () => {
    const api = mount(admin);
    await api.linkParticipantAccount('a', 'uid-a');
    expect(hooks.setDoc).toHaveBeenCalledTimes(1);
    const payload = hooks.setDoc.mock.calls[0][1] as {
      participants: TripParticipant[];
      participantIds: string[];
      expenses?: unknown;
    };
    expect(payload.participants.map((item) => item.id)).toEqual(['a', 'b']);
    expect(payload.participants[0]).toMatchObject({ id: 'a', name: 'Name a', userId: 'uid-a', isRegistered: true });
    expect(payload.participantIds).toEqual(['uid-a', 'uid-b']);
    expect(payload.expenses).toBeUndefined();
  });

  it('does not write when the account is missing or already linked', async () => {
    const api = mount(admin);
    hooks.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    await expect(api.linkParticipantAccount('a', 'missing')).rejects.toThrow(/existing registered account/);
    await expect(api.linkParticipantAccount('a', 'uid-b')).rejects.toThrow(/already linked/);
    expect(hooks.setDoc).not.toHaveBeenCalled();
  });
});

describe('deleteParticipant removal guard', () => {
  it('lists blocking records and does not write', async () => {
    const blocking: Expense = {
      id: 'dinner',
      category: 'Food',
      description: 'Saturday dinner',
      totalAmount: 10,
      paidBy: { a: 10 },
      splitType: 'even',
      splitParticipants: ['a', 'b'],
      manualSplit: {},
      createdBy: 'admin',
    };
    const api = mount(admin, [blocking], [{
      id: 'pay',
      payerId: 'a',
      payeeId: 'b',
      amount: 5,
      date: '2026-10-22',
      description: 'Cash',
    }]);
    await expect(api.deleteParticipant('a')).rejects.toThrow(/Saturday dinner/);
    await expect(api.deleteParticipant('a')).rejects.toThrow(/Name a to Name b \(Cash\)/);
    expect(hooks.setDoc).not.toHaveBeenCalled();
    expect(hooks.updateDoc).not.toHaveBeenCalled();
  });
});
