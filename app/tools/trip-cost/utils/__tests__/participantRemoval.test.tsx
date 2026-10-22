import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expense, Trip, UserProfile } from '../../pageTypes';
import { buildLedger } from '../ledger';

// Exercise real removal handlers and dialogs using the existing node-only
// component test style, keeping each component's hooks in its own scope.
const hooks = vi.hoisted(() => ({
  states: {} as Record<string, unknown[]>,
  scope: 'detail',
  index: 0,
  useTrip: vi.fn(),
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: () => undefined,
  useId: () => 'removal-dialog-title',
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(current: T) => ({ current }),
  useState: <T,>(initial: T | (() => T)) => {
    const states = hooks.states[hooks.scope] ??= [];
    const index = hooks.index++;
    if (!(index in states)) {
      states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    }
    return [states[index] as T, (next: React.SetStateAction<T>) => {
      const current = states[index] as T;
      states[index] = typeof next === 'function' ? (next as (value: T) => T)(current) : next;
    }];
  },
}));
vi.mock('../../TripContext', () => ({ useTrip: hooks.useTrip }));
vi.mock('../../db', () => ({ usersCol: () => 'users' }));
vi.mock('@/components/Button', () => ({
  default: ({ loading, ...props }: React.ComponentProps<'button'> & { loading?: boolean }) =>
    React.createElement('button', { ...props, disabled: props.disabled || loading }),
}));
vi.mock('@/components/Input', () => ({ default: 'input' }));
vi.mock('@/components/Select', () => ({ default: 'select' }));

import TripDetail from '../../components/TripDetail/TripDetail';
import TripTabs from '../../components/TripDetail/TripTabs';
import ParticipantsSettingsTab from '../../components/TripDetail/ParticipantsSettingsTab';
import ParticipantsSection from '../../components/TripDetail/ParticipantsSection';
import ParticipantRemovalDialog from '../../components/TripDetail/ParticipantRemovalDialog';
import ConfirmDeleteModal from '../../components/TripDetail/ConfirmDeleteModal';

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
  name: 'Ohio',
  createdBy: 'admin',
  participantIds: ['a', 'b'],
  participants: [
    { id: 'a', name: 'Jackie N', isRegistered: false, addedBy: 'admin' },
    { id: 'b', name: 'Jimi', isRegistered: false, addedBy: 'admin' },
  ],
  expenses: [],
  payments: [],
};
const dinner: Expense = {
  id: 'dinner',
  category: 'Food',
  description: 'Saturday dinner',
  totalAmount: 10,
  paidBy: { b: 10 },
  splitType: 'even',
  splitParticipants: ['a', 'b'],
  manualSplit: {},
  createdBy: 'admin',
};
const withReferences: Trip = {
  ...original,
  expenses: [dinner],
  payments: [{
    id: 'cash',
    payerId: 'a',
    payeeId: 'b',
    amount: 5,
    date: '2026-10-22',
    description: 'Cash repayment',
  }],
};

function renderScope<T>(scope: string, component: () => T): T {
  hooks.scope = scope;
  hooks.index = 0;
  return component();
}

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as React.ReactNode)];
}

function findElement<P>(tree: React.ReactNode, type: React.JSXElementConstructor<P>): React.ReactElement<P> {
  const found = elements(tree).find((node) => node.type === type);
  if (!found) throw new Error('Expected component is missing.');
  return found as React.ReactElement<P>;
}

function setup(trip: Trip) {
  const deleteParticipant = vi.fn(() => Promise.resolve());
  const context = {
    trip,
    participants: trip.participants,
    expenses: trip.expenses,
    payments: trip.payments,
    ledger: buildLedger(trip),
    auditEntries: [],
    deleteParticipant,
  };
  hooks.useTrip.mockReturnValue(context);
  const render = () => renderScope('detail', () => TripDetail({ userProfile: admin, onBack: vi.fn() }));
  const remove = (id: string) => {
    const tabs = findElement(render(), TripTabs);
    const settings = tabs.props.participantsSettings as React.ReactElement<React.ComponentProps<typeof ParticipantsSettingsTab>>;
    const tab = renderScope('settings', () => ParticipantsSettingsTab(settings.props));
    const section = findElement(tab, ParticipantsSection);
    const travelers = renderScope('travelers', () => ParticipantsSection(section.props));
    const name = context.participants.find((person) => person.id === id)?.name;
    const button = elements(travelers).find((node) => node.props['aria-label'] === `Remove ${name}`);
    if (!button) throw new Error('Remove button is missing.');
    (button.props.onClick as () => void)();
  };
  const markup = (tree: React.ReactNode) => renderScope('markup', () => renderToStaticMarkup(tree));
  return { context, render, remove, markup, deleteParticipant };
}

beforeEach(() => {
  hooks.states = {};
  hooks.useTrip.mockReset();
});

describe('participant removal flow', () => {
  it('opens a blocker dialog listing the expense and payment, with no Delete action', () => {
    const view = setup(withReferences);
    view.remove('a');
    const dialog = findElement(view.render(), ParticipantRemovalDialog);
    const html = view.markup(dialog);
    expect(html).toContain('Can&#x27;t remove Jackie N yet');
    expect(html).toContain('Remove or reassign these records first:');
    expect(html).toContain('Expense: Saturday dinner');
    expect(html).toContain('Payment: Jackie N to Jimi (Cash repayment)');
    expect(html).toContain('>Close</button>');
    expect(html).not.toContain('>Delete</button>');
    expect(view.deleteParticipant).not.toHaveBeenCalled();
    dialog.props.onClose();
    expect(elements(view.render()).some((node) => node.type === ParticipantRemovalDialog)).toBe(false);
  });

  it('keeps the named confirmation for an unreferenced traveler', async () => {
    const view = setup(original);
    view.remove('a');
    const confirm = findElement(view.render(), ConfirmDeleteModal);
    const html = view.markup(confirm);
    expect(html).toContain('Are you sure you want to delete Jackie N?');
    expect(html).toContain('>Delete</button>');
    expect(html).toContain('>Cancel</button>');
    confirm.props.onConfirm();
    await Promise.resolve();
    expect(view.deleteParticipant).toHaveBeenCalledTimes(1);
    expect(view.deleteParticipant).toHaveBeenCalledWith('a');
  });

  it('switches an open confirmation to blockers when a live snapshot adds references', () => {
    const view = setup(original);
    view.remove('a');
    findElement(view.render(), ConfirmDeleteModal);
    view.context.trip = withReferences;
    view.context.expenses = withReferences.expenses;
    view.context.payments = withReferences.payments;
    const tree = view.render();
    const html = view.markup(findElement(tree, ParticipantRemovalDialog));
    expect(html).toContain('Expense: Saturday dinner');
    expect(html).toContain('Payment: Jackie N to Jimi (Cash repayment)');
    expect(elements(tree).some((node) => node.type === ConfirmDeleteModal)).toBe(false);
    expect(html).not.toContain('>Delete</button>');
    expect(view.deleteParticipant).not.toHaveBeenCalled();
  });

  it('lists every blocker in the shared scrolling body with a separate close footer', () => {
    const expenses = Array.from({ length: 12 }, (_, index) => ({
      ...dinner,
      id: `e-${index}`,
      description: `Dinner ${index + 1} ${'long description '.repeat(10)}`,
    }));
    const view = setup({ ...withReferences, expenses });
    view.remove('a');
    const dialog = findElement(view.render(), ParticipantRemovalDialog);
    expect(dialog.props.blockers).toHaveLength(13);
    const html = view.markup(dialog);
    expect(html).toContain('Expense: Dinner 12');
    expect(html).toContain('Payment: Jackie N to Jimi (Cash repayment)');
    expect(html).toContain('min-h-0 flex-1 overflow-y-auto');
    expect(html).toContain('h-full min-h-0');
    expect(html).toMatch(/<footer class="sticky bottom-0 shrink-0[^>]*><button[^>]*>Close<\/button><\/footer>/);
    expect(html).not.toContain('>Delete</button>');
  });
});
