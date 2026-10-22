import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Vitest does not resolve the Next `@/` alias. Mock the shared controls the
// same way the other trip-cost component tests do, so this file can render
// the sections without a config change.
vi.mock('@/components/Button', () => ({
  default: ({ loading, ...props }: React.ComponentProps<'button'> & { loading?: boolean }) =>
    React.createElement('button', { ...props, disabled: props.disabled || loading }),
}));
vi.mock('@/components/Input', () => ({ default: 'input' }));

import TripList from '../../components/TripList';
import BudgetCapsSection from '../../components/TripDetail/BudgetCapsSection';
import DefaultSplitSection from '../../components/TripDetail/DefaultSplitSection';
import ConfirmDeleteModal from '../../components/TripDetail/ConfirmDeleteModal';
import type { Ledger } from '../ledger';
import type { Trip, TripParticipant, UserProfile } from '../../pageTypes';

const person = (id: string, name: string): TripParticipant => ({
  id,
  name,
  isRegistered: false,
  addedBy: 'admin',
});

const admin: UserProfile = {
  uid: 'admin',
  email: 'admin@example.com',
  displayName: 'Admin',
  firstName: 'A',
  lastInitial: 'D',
  isAdmin: true,
};

const trip = { id: 't', name: 'Trip', participants: [], expenses: [], payments: [] } as unknown as Trip;

describe('blocked participant removal dialog', () => {
  it('bounds long errors to a scrollable message area with reachable actions outside it', () => {
    const error = Array.from({ length: 5 }, (_, index) =>
      `Expense ${index + 1}: ${'Long participant removal blocker '.repeat(30)}`,
    ).join('\n');
    const html = renderToStaticMarkup(
      <ConfirmDeleteModal
        itemType="participant"
        error={error}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(html).toContain('max-h-[calc(100dvh-2rem)]');
    expect(html).toContain('flex-col gap-4 overflow-hidden');
    expect(html).toMatch(/class="min-h-0 min-w-0 space-y-4 overflow-y-auto"><p id="confirm-title"/);
    expect(html).toContain(error);
    expect(html).toMatch(/<\/p><\/div><div class="flex shrink-0 flex-wrap justify-end gap-2"><button/);
    expect(html).toContain('>Delete</button>');
    expect(html).toContain('>Cancel</button>');
    expect(html).toContain('aria-labelledby="confirm-title"');
  });
});

function list(tripsStatus: 'loading' | 'ready' | 'error', trips: Trip[] = []) {
  return renderToStaticMarkup(
    <TripList
      trips={trips}
      tripsStatus={tripsStatus}
      userProfile={admin}
      newTripName=""
      setNewTripName={() => undefined}
      onCreateTrip={() => undefined}
      onOpenTrip={() => undefined}
      onDeleteTrip={() => undefined}
      onLogout={() => undefined}
    />,
  );
}

describe('trip list loading state', () => {
  it('shows a loading state and hides the empty message until loading finishes', () => {
    const loading = list('loading');
    expect(loading).toContain('Loading trips');
    expect(loading).not.toContain('No trips yet');

    const ready = list('ready');
    expect(ready).toContain('No trips yet. Create your first trip above!');
    expect(ready).not.toContain('Loading trips');

    const failed = list('error');
    expect(failed).not.toContain('No trips yet');
    expect(failed).not.toContain('Loading trips');

    const loaded = list('ready', [trip]);
    expect(loaded).toContain('Trip');
    expect(loaded).not.toContain('No trips yet');
  });
});

describe('settings section markers', () => {
  const participants = [person('a', 'Kaitlyn'), person('b', 'Jimi')];

  it('shows the near-cap marker only under 5% remaining', () => {
    const markup = (final: number) => renderToStaticMarkup(
      <BudgetCapsSection
        participants={participants.slice(0, 1)}
        ledger={{ final: { a: final } } as unknown as Ledger}
        caps={{ a: '100.00' }}
        readOnly
        messageIds="settings-messages"
        onChange={() => undefined}
      />,
    );
    const near = markup(9501);
    expect(near).toContain('Near cap');
    expect(near).toContain('role="progressbar"');
    expect(near).toContain('$95.01 of $100.00');
    expect(markup(9500)).not.toContain('Near cap');
    expect(markup(10001)).toContain('Over cap');
    expect(markup(10001)).not.toContain('Near cap');
    expect(markup(10000)).toContain('At cap');
    expect(markup(10000)).not.toContain('Near cap');
  });

  it('uses blank default inputs and warns when a traveler is missing', () => {
    const html = renderToStaticMarkup(
      <DefaultSplitSection
        participants={participants}
        shares={{ a: '100', b: '' }}
        readOnly={false}
        messageIds="settings-messages"
        onChange={() => undefined}
      />,
    );
    expect(html).toContain('Pre-fills new expenses; never changes saved ones.');
    expect(html).toContain('Missing from the default: Jimi');
    expect(html).toContain('They start at 0%');
    expect(html).not.toContain('placeholder="0"');
    expect(html).not.toContain('value="0"');
  });

  const defaultMarkup = (shares: Record<string, string>) => renderToStaticMarkup(
    <DefaultSplitSection
      participants={participants}
      shares={shares}
      readOnly={false}
      messageIds="settings-messages"
      onChange={() => undefined}
    />,
  );

  it('excludes orphan shares from the displayed total and missing-traveler warning', () => {
    const html = defaultMarkup({ a: '40', b: '30', gone: '30' });
    expect(html).toContain('Total: 70.00% / 100%');
    expect(html).not.toContain('Total: 100.00%');
    expect(defaultMarkup({ gone: '100' })).not.toContain('Missing from the default:');
    expect(defaultMarkup({ gone: 'nope' })).not.toContain('Enter percentages as numbers.');
    expect(defaultMarkup({ a: '100', gone: '30' })).toContain('Missing from the default: Jimi');
  });

  it('uses the legacy 0.1% tolerance for the total warning colour', () => {
    expect(defaultMarkup({ a: '49.95', b: '49.95' }))
      .toMatch(/class="text-sm text-text-3">Total: 99.90%/);
    expect(defaultMarkup({ a: '49.9', b: '49.9' }))
      .toMatch(/class="text-sm text-warning">Total: 99.80%/);
  });
});
