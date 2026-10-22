import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import SettlementsSection from '../../components/TripDetail/SettlementsSection';
import type { Expense, TripParticipant, UserProfile } from '../../pageTypes';
import { buildLedger } from '../ledger';

const { useTrip } = vi.hoisted(() => ({ useTrip: vi.fn() }));
vi.mock('../../TripContext', () => ({ useTrip }));
vi.mock('@/components/Button', () => ({
  default: ({ loading, variant, size, ...props }: React.ComponentProps<'button'> & {
    loading?: boolean; variant?: string; size?: string;
  }) => {
    void variant;
    void size;
    return React.createElement('button', { ...props, disabled: props.disabled || loading });
  },
}));
vi.mock('@/components/Input', () => ({ default: 'input' }));
vi.mock('@/components/Select', () => ({ default: 'select' }));

const participants: TripParticipant[] = ['a', 'b', 'c'].map((id) => ({
  id, name: id.toUpperCase(), userId: id === 'a' ? 'user' : undefined, isRegistered: id === 'a', addedBy: 'admin',
}));
const expense: Expense = {
  id: 'e', category: 'Food', description: 'Dinner', totalAmount: 90, paidBy: { b: 90 },
  splitType: 'even', splitParticipants: ['a', 'b', 'c'], manualSplit: {}, createdBy: 'user',
};
const profile: UserProfile = { uid: 'user', email: '', displayName: 'A', firstName: 'A', lastInitial: '', isAdmin: true };
const input = { participants, expenses: [expense], payments: [] };
const render = (userProfile = profile) => renderToStaticMarkup(
  <SettlementsSection userProfile={userProfile} onDeletePayment={() => {}} />,
);

describe('SettlementsSection markup', () => {
  it('renders one contained semantic balance table in ledger traveler order', () => {
    useTrip.mockReturnValue({ ...input, ledger: buildLedger(input) });
    const html = render();
    expect(html).toContain('<caption');
    expect(html.match(/scope="col"/g)).toHaveLength(4);
    expect(html.match(/scope="row"/g)).toHaveLength(5);
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('sticky left-0');
    expect(html.indexOf('>A</th>')).toBeLessThan(html.indexOf('>B</th>'));
    expect(html).toContain('Owes $30.00');
    expect(html).toContain('Is owed $60.00');
    expect(html.match(/>Record payment</g)).toHaveLength(1);
  });

  it.each(['unallocated', 'non-conserving'] as const)('shows the %s pause reason and no suggestion Record actions', (paused) => {
    const ledger = buildLedger(input);
    ledger.settlement = { settlements: [], paused };
    ledger.unallocatedCents = paused === 'unallocated' ? 100 : 0;
    useTrip.mockReturnValue({ ...input, ledger });
    const html = render();
    expect(html).toContain('Settlement suggestions are paused');
    expect(html).not.toContain('>Record</button>');
    expect(html).not.toContain('Everyone is settled.');
  });

  it('explains a disabled general entry point when the member has no unique link', () => {
    useTrip.mockReturnValue({ ...input, ledger: buildLedger(input) });
    const html = render({ ...profile, isAdmin: false, uid: 'unlinked' });
    expect(html).toContain('Your account must be linked to exactly one traveler');
    const button = html.match(/<button[^>]*>Record payment<\/button>/)?.[0];
    expect(button).toContain('disabled=""');
    expect(button).toContain('aria-describedby=');
  });

  it('shows the settled empty state and admin-only history deletion', () => {
    const payments = [{ id: 'p', payerId: 'a', payeeId: 'removed', amount: 10, description: 'Long note', date: '2026-10-22' }];
    const ledger = buildLedger({ participants, expenses: [], payments: [] });
    useTrip.mockReturnValue({ participants, payments, ledger });
    const html = render();
    expect(html).toContain('Everyone is settled.');
    expect(html).toContain('Unknown traveler');
    expect(html).toContain('Long note');
    expect(html).toContain('shrink-0 text-error');
    expect(html).toContain('>Delete</button>');
    expect(render({ ...profile, isAdmin: false })).not.toContain('>Delete</button>');
  });
});
