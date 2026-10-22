import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Trip, UserProfile } from '../../pageTypes';
import { buildLedger } from '../ledger';
import { tripRevision } from '../tripSettings';

// Follow the existing node-only component tests, retaining state and running
// changed effects between renders so optimistic snapshots exercise the form.
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  dependencies: [] as (React.DependencyList | undefined)[],
  effects: [] as (() => void)[],
  index: 0,
  changed: false,
  useTrip: vi.fn(),
  getDocs: vi.fn(),
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useId: () => 'settings-test',
  useMemo: <T,>(factory: () => T) => factory(),
  useState: <T,>(initial: T | (() => T)) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) {
      hooks.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    }
    return [hooks.states[index] as T, (next: React.SetStateAction<T>) => {
      const previous = hooks.states[index] as T;
      const value = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
      if (!Object.is(previous, value)) hooks.changed = true;
      hooks.states[index] = value;
    }];
  },
  useEffect: (effect: () => void, dependencies?: React.DependencyList) => {
    const index = hooks.index++;
    const previous = hooks.dependencies[index];
    if (!dependencies || !previous || dependencies.some((value, i) => !Object.is(value, previous[i]))) {
      hooks.effects.push(effect);
    }
    hooks.dependencies[index] = dependencies;
  },
}));
vi.mock('../../TripContext', () => ({ useTrip: hooks.useTrip }));
vi.mock('../../db', () => ({ usersCol: () => 'users' }));
vi.mock('firebase/firestore', () => ({
  getDocs: (...args: unknown[]) => hooks.getDocs(...args),
  query: (...args: unknown[]) => args,
  limit: (count: number) => count,
  documentId: () => '__name__',
  orderBy: (field: string) => ({ orderBy: field }),
  startAfter: (cursor: string) => ({ startAfter: cursor }),
}));
vi.mock('@/components/Button', () => ({
  default: ({ loading, ...props }: React.ComponentProps<'button'> & { loading?: boolean }) =>
    React.createElement('button', { ...props, disabled: props.disabled || loading }),
}));
vi.mock('@/components/Input', () => ({ default: 'input' }));

import ParticipantsSettingsTab from '../../components/TripDetail/ParticipantsSettingsTab';
import ParticipantsSection from '../../components/TripDetail/ParticipantsSection';
import BudgetCapsSection from '../../components/TripDetail/BudgetCapsSection';

const admin: UserProfile = {
  uid: 'admin',
  email: 'admin@example.com',
  displayName: 'Admin',
  firstName: 'A',
  lastInitial: 'D',
  isAdmin: true,
};

const original: Trip = {
  id: 'trip',
  name: 'Weekend',
  createdBy: 'admin',
  participants: [{ id: 'a', name: 'Ada', isRegistered: false, addedBy: 'admin' }],
  participantIds: ['a'],
  expenses: [],
  payments: [],
  spendCaps: [],
  overageSplit: { type: 'even' },
  defaultSplit: {},
};

const props = { userProfile: admin, onDeleteParticipant: () => undefined };

function renderSettled<T>(component: () => T): T {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    hooks.index = 0;
    hooks.effects = [];
    hooks.changed = false;
    const tree = component();
    for (const effect of hooks.effects) effect();
    if (!hooks.changed) return tree;
  }
  throw new Error('Component effects did not settle.');
}

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}

function findElement(
  tree: React.ReactNode,
  predicate: (node: React.ReactElement<Record<string, unknown>>) => boolean,
): React.ReactElement<Record<string, unknown>> {
  const found = elements(tree).find(predicate);
  if (!found) throw new Error('Expected element is missing.');
  return found;
}

function setupForm() {
  const updateTripSettings = vi.fn(() => Promise.resolve());
  const context = {
    trip: original,
    participants: original.participants,
    ledger: buildLedger(original),
    auditEntries: [],
    updateTripSettings,
  };
  hooks.useTrip.mockReturnValue(context);
  const render = () => renderSettled(() => ParticipantsSettingsTab(props));
  const caps = (tree: React.ReactNode) => findElement(tree, (node) => node.type === BudgetCapsSection)
    .props as unknown as React.ComponentProps<typeof BudgetCapsSection>;
  const form = (tree: React.ReactNode) => findElement(tree, (node) => node.type === 'form');
  const markup = (tree: React.ReactNode) => renderToStaticMarkup(form(tree));
  const submit = (tree: React.ReactNode) => {
    const onSubmit = form(tree).props.onSubmit as (event: { preventDefault: () => void }) => void;
    onSubmit({ preventDefault: vi.fn() });
  };
  const confirmation = (tree: React.ReactNode) => findElement(tree, (node) => node.props.type === 'checkbox');
  const confirm = (tree: React.ReactNode) => {
    const onChange = confirmation(tree).props.onChange as (event: { target: { checked: boolean } }) => void;
    onChange({ target: { checked: true } });
  };
  return { context, render, caps, markup, submit, confirmation, confirm, updateTripSettings };
}

function deferredSave() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  hooks.states = [];
  hooks.dependencies = [];
  hooks.effects = [];
  hooks.index = 0;
  hooks.useTrip.mockReset();
  hooks.getDocs.mockReset();
});

describe('settings save lifecycle', () => {
  it('invalidates overwrite confirmation when a further remote revision arrives', async () => {
    const form = setupForm();
    form.caps(form.render()).onChange('a', '75.00');
    form.context.trip = { ...original, name: 'First remote change' };
    let tree = form.render();
    expect(form.markup(tree)).toContain('changed while you were editing');
    form.confirm(tree);
    expect(form.confirmation(form.render()).props.checked).toBe(true);

    form.context.trip = { ...original, name: 'Second remote change' };
    tree = form.render();
    expect(form.confirmation(tree).props.checked).toBe(false);
    expect(form.markup(tree)).toContain('changed while you were editing');
    form.submit(tree);
    expect(form.updateTripSettings).not.toHaveBeenCalled();

    form.confirm(tree);
    form.submit(form.render());
    expect(form.updateTripSettings).toHaveBeenCalledWith(
      expect.objectContaining({ spendCaps: [{ participantId: 'a', maxAmount: 75 }] }),
      tripRevision(original),
      tripRevision(form.context.trip),
    );
    await Promise.resolve();
  });

  it('keeps the typed draft dirty after an optimistic snapshot and server rejection', async () => {
    const form = setupForm();
    const save = deferredSave();
    form.updateTripSettings.mockReturnValue(save.promise);
    form.caps(form.render()).onChange('a', '75.00');
    form.submit(form.render());

    form.context.trip = { ...original, spendCaps: [{ participantId: 'a', maxAmount: 75 }] };
    let tree = form.render();
    expect(form.caps(tree).caps.a).toBe('75.00');
    expect(form.caps(tree).readOnly).toBe(true);
    expect(form.markup(tree)).not.toContain('changed while you were editing');

    save.reject(new Error('Permission denied'));
    await save.promise.catch(() => undefined);
    tree = form.render();
    expect(form.caps(tree).caps.a).toBe('75.00');
    form.context.trip = original;
    tree = form.render();
    expect(form.caps(tree).caps.a).toBe('75.00');
    expect(form.caps(tree).readOnly).toBe(false);
    expect(form.markup(tree)).toContain('Permission denied');
    expect(form.markup(tree)).not.toContain('changed while you were editing');

    // A subsequent remote change must still warn: rejection kept dirty=true.
    form.context.trip = { ...original, name: 'Changed after rejection' };
    expect(form.markup(form.render())).toContain('changed while you were editing');
    expect(form.caps(form.render()).caps.a).toBe('75.00');
  });

  it.each(['before', 'after'] as const)(
    'cleans the form when its snapshot arrives %s the successful save promise', async (timing) => {
      const form = setupForm();
      const save = deferredSave();
      form.updateTripSettings.mockReturnValue(save.promise);
      form.caps(form.render()).onChange('a', '75.00');
      form.submit(form.render());
      const saved: Trip = { ...original, spendCaps: [{ participantId: 'a', maxAmount: 75 }] };
      if (timing === 'before') form.context.trip = saved;
      let tree = form.render();
      expect(form.caps(tree).caps.a).toBe('75.00');
      expect(form.markup(tree)).not.toContain('changed while you were editing');

      save.resolve();
      await save.promise;
      tree = form.render();
      expect(form.markup(tree)).not.toContain('changed while you were editing');
      form.context.trip = saved;
      tree = form.render();
      expect(form.caps(tree).caps.a).toBe('75');
      expect(form.caps(tree).readOnly).toBe(false);
      expect(form.markup(tree)).not.toContain('changed while you were editing');

      // A clean form follows the next snapshot without raising a stale warning.
      form.context.trip = { ...saved, spendCaps: [{ participantId: 'a', maxAmount: 90 }] };
      tree = form.render();
      expect(form.caps(tree).caps.a).toBe('90');
      expect(form.markup(tree)).not.toContain('changed while you were editing');
    },
  );
});

describe('account selection feedback', () => {
  it('does not read registered accounts for a non-admin', () => {
    hooks.useTrip.mockReturnValue({ trip: original, participants: original.participants });
    const tree = renderSettled(() => ParticipantsSection({
      ...props,
      userProfile: { ...admin, isAdmin: false },
    }));

    expect(hooks.getDocs).not.toHaveBeenCalled();
    expect(elements(tree).some((node) => node.props.children === 'Link account')).toBe(false);
  });

  it('searches accounts beyond the first page and keeps linked accounts disabled', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `account-${String(index).padStart(3, '0')}`,
      data: () => ({ displayName: `Account ${index}`, email: `${index}@example.com` }),
    }));
    const lastPage = ['late-account', 'linked-account'].map((id) => ({
      id,
      data: () => ({ displayName: `Later ${id}`, email: `${id}@example.com` }),
    }));
    hooks.getDocs
      .mockResolvedValueOnce({ docs: firstPage })
      .mockResolvedValueOnce({ docs: lastPage });
    hooks.useTrip.mockReturnValue({
      trip: original,
      participants: [
        ...original.participants,
        { id: 'b', name: 'Bea', userId: 'linked-account', isRegistered: true, addedBy: 'admin' },
      ],
    });
    const render = () => renderSettled(() => ParticipantsSection(props));
    let tree = render();
    await vi.waitFor(() => expect(hooks.states).toContainEqual(expect.arrayContaining([
      expect.objectContaining({ uid: 'late-account' }),
    ])));
    const linkButton = findElement(tree, (node) => node.props.children === 'Link account');
    (linkButton.props.onClick as () => void)();
    tree = render();
    const searchLabel = findElement(tree, (node) =>
      node.type === 'label' && Array.isArray(node.props.children)
        && node.props.children[0] === 'Search registered accounts for ',
    );
    const input = findElement(searchLabel, (node) => typeof node.props.onChange === 'function');
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Later' } });
    tree = render();

    const choices = elements(tree).filter((node) => node.props['aria-pressed'] !== undefined);
    expect(choices).toHaveLength(2);
    expect(choices.map((node) => node.props.disabled)).toEqual([false, true]);
    expect(renderToStaticMarkup(<>{choices}</>)).toContain('Already on this trip');
    expect(hooks.getDocs).toHaveBeenNthCalledWith(2, [
      'users',
      { orderBy: '__name__' },
      100,
      { startAfter: 'account-099' },
    ]);
  });

  it('marks the chosen account pressed, styles it, and announces the link help', async () => {
    const accounts = ['one', 'two'].map((uid) => ({
      id: uid,
      data: () => ({ displayName: 'Shared Name', email: `${uid}@example.com` }),
    }));
    hooks.getDocs.mockResolvedValue({ docs: accounts });
    hooks.useTrip.mockReturnValue({ trip: original, participants: original.participants });
    const render = () => renderSettled(() => ParticipantsSection(props));
    let tree = render();
    await vi.waitFor(() => expect(hooks.states).toContainEqual(expect.arrayContaining([
      expect.objectContaining({ uid: 'one' }),
    ])));
    const linkButton = findElement(tree, (node) => node.props.children === 'Link account');
    (linkButton.props.onClick as () => void)();
    tree = render();
    const choices = elements(tree).filter((node) => node.props['aria-pressed'] !== undefined);
    expect(choices).toHaveLength(2);
    expect(choices.every((node) => node.props['aria-pressed'] === false)).toBe(true);
    (choices[0].props.onClick as () => void)();

    tree = render();
    const selected = findElement(tree, (node) => node.props['aria-pressed'] === true);
    expect(selected.props.className).toContain('aria-pressed:border-accent aria-pressed:bg-accent/10');
    expect(elements(tree).filter((node) => node.props['aria-pressed'] === false)).toHaveLength(1);
    const help = findElement(tree, (node) => node.props.id === 'a-link-help');
    expect(help.props['aria-live']).toBe('polite');
    expect(renderToStaticMarkup(help)).toContain('Link Ada to Shared Name · one@example.com');
    expect(hooks.getDocs).toHaveBeenCalledWith(['users', { orderBy: '__name__' }, 100]);
  });
});
