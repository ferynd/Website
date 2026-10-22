import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expense, Payment, Trip, TripParticipant, UserProfile } from '../../pageTypes';
import { tripRevision, type TripSettingsFields } from '../tripSettings';

type AccountSnapshot = {
  exists: () => boolean;
  data: () => { displayName?: string; email?: string } | undefined;
};

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  seed: [] as unknown[],
  setDoc: vi.fn((...args: unknown[]) => Promise.resolve(void args)),
  updateDoc: vi.fn((...args: unknown[]) => Promise.resolve(void args)),
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
  setDoc: (...args: unknown[]) => hooks.setDoc(...args),
  updateDoc: (...args: unknown[]) => hooks.updateDoc(...args),
  serverTimestamp: () => 'server-time',
  Timestamp: { fromDate: (date: Date) => ({ toDate: () => date }) },
}));

vi.mock('../../db', () => ({
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
  hooks.getDoc.mockReset();
  hooks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ displayName: 'Ada', email: 'ada@example.com' }) });
});

describe('updateTripSettings', () => {
  it('rejects invalid settings and a stale edit without writing', async () => {
    const api = mount(admin);
    const baseline = tripRevision(trip);
    await expect(api.updateTripSettings({
      ...validSettings,
      spendCaps: [{ participantId: 'a', maxAmount: 10.005 }],
    }, baseline)).rejects.toThrow(/whole cents/);
    await expect(api.updateTripSettings(validSettings, 'old-revision')).rejects.toThrow(/changed while you were editing/);
    await expect(api.updateTripSettings(validSettings, baseline)).resolves.toBeUndefined();
    expect(hooks.updateDoc).toHaveBeenCalledTimes(1);
    expect(hooks.setDoc).not.toHaveBeenCalled();
    expect(hooks.updateDoc).toHaveBeenCalledWith(
      { id: 'trip-1' },
      {
        spendCaps: validSettings.spendCaps,
        overageSplit: validSettings.overageSplit,
        defaultSplit: validSettings.defaultSplit,
        updatedAt: 'server-time',
      },
    );
  });

  it('writes once when the caller confirms the current revision', async () => {
    const api = mount(admin);
    await api.updateTripSettings(validSettings, 'old-revision', tripRevision(trip));
    expect(hooks.updateDoc).toHaveBeenCalledTimes(1);
    expect(hooks.setDoc).not.toHaveBeenCalled();
  });

  it('does not write settings for a non-admin', async () => {
    const api = mount(member);
    await expect(api.updateTripSettings(validSettings, tripRevision(trip))).rejects.toThrow(/admin/);
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
