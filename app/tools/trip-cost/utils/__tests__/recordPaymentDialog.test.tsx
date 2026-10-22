import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RecordPaymentDialog from '../../components/TripDetail/RecordPaymentDialog';
import type { TripParticipant, UserProfile } from '../../pageTypes';
import type { PaymentDraft } from '../settlementView';

// Exercise real submit closures and lifecycle cleanup in the existing node
// environment. No DOM library or configuration change is needed.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[], index: 0, cleanups: [] as (() => void)[], useTrip: vi.fn(),
}));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useId: () => 'record-payment',
  useRef: (current: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current };
    return hooks.slots[index];
  },
  useState: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index] as T, (next: T) => { hooks.slots[index] = next; }];
  },
  useEffect: (effect: () => (() => void)) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) {
      hooks.slots[index] = true;
      hooks.cleanups.push(effect());
    }
  },
}));
vi.mock('../../TripContext', () => ({ useTrip: hooks.useTrip }));
vi.mock('@/components/Input', () => ({ default: 'input' }));
vi.mock('@/components/Select', () => ({ default: 'select' }));
vi.mock('@/components/Button', () => ({
  default: ({ loading, ...props }: React.ComponentProps<'button'> & { loading?: boolean }) =>
    React.createElement('button', { ...props, disabled: props.disabled || loading }),
}));

const participants: TripParticipant[] = ['a', 'b', 'c'].map((id) => ({
  id, name: id.toUpperCase(), userId: id === 'a' ? 'user' : undefined, isRegistered: id === 'a', addedBy: 'admin',
}));
const profile: UserProfile = { uid: 'user', email: '', displayName: 'A', firstName: 'A', lastInitial: '', isAdmin: false };
const initial: PaymentDraft = { payerId: 'a', payeeId: 'b', amount: '25.01', note: ' Cash ' };

beforeEach(() => {
  hooks.slots.length = 0;
  hooks.cleanups.length = 0;
  hooks.index = 0;
  hooks.useTrip.mockReset();
});

function session(draft = initial) {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  const addPayment = vi.fn(() => pending);
  hooks.useTrip.mockReturnValue({ participants, ledger: { remaining: { a: 2000, b: -2000, c: 0 } }, addPayment });
  const onClose = vi.fn();
  const render = () => {
    hooks.index = 0;
    return RecordPaymentDialog({ initial: draft, userProfile: profile, onClose });
  };
  const markup = (dialog: ReturnType<typeof render>) => renderToStaticMarkup(<>{dialog.props.children}{dialog.props.footer}</>);
  return { render, markup, onClose, addPayment, pending, resolve, reject };
}

describe('RecordPaymentDialog save session', () => {
  it.each(['success', 'failure'] as const)('%s disables duplicates and fields while saving', async (outcome) => {
    const test = session();
    const dialog = test.render();
    expect(test.markup(dialog)).toContain('Logs a reimbursement that already happened');
    expect(test.markup(dialog)).toContain('A owes $20.00 in total; this records $25.01.');
    dialog.props.children.props.onSubmit({ preventDefault: vi.fn() });
    dialog.props.children.props.onSubmit({ preventDefault: vi.fn() });
    expect(test.addPayment).toHaveBeenCalledOnce();
    expect(test.addPayment).toHaveBeenCalledWith('a', 'b', 25.01, 'Cash', 'user');
    const inFlight = test.render();
    const saving = test.markup(inFlight);
    expect(inFlight.props.dismissible).toBe(false);
    expect(saving).toContain('disabled="">Cancel</button>');
    expect(saving).toContain('<fieldset disabled=""');
    expect(saving).toContain('Saving payment…');
    expect(saving).toContain('aria-describedby="record-payment-reason record-payment-warning record-payment-error"');
    if (outcome === 'success') test.resolve();
    else test.reject(new Error('Payment save failed'));
    await test.pending.catch(() => {});
    if (outcome === 'success') expect(test.onClose).toHaveBeenCalledOnce();
    else {
      expect(test.onClose).not.toHaveBeenCalled();
      const failed = test.markup(test.render());
      expect(failed).toContain('role="alert"');
      expect(failed).toContain('Payment save failed');
      expect(failed).not.toContain('<fieldset disabled');
    }
  });

  it.each(['success', 'failure'] as const)('ignores dismissal during a save, preserving %s feedback', async (outcome) => {
    const test = session();
    const dialog = test.render();
    dialog.props.children.props.onSubmit({ preventDefault: vi.fn() });
    // A handler retained from before the saving rerender must also respect busy.
    dialog.props.onClose();
    const inFlight = test.render();
    expect(inFlight.props.dismissible).toBe(false);
    inFlight.props.onClose();
    expect(test.onClose).not.toHaveBeenCalled();
    if (outcome === 'success') test.resolve();
    else test.reject(new Error('Late failure'));
    await test.pending.catch(() => {});
    if (outcome === 'success') expect(test.onClose).toHaveBeenCalledOnce();
    else {
      const failed = test.render();
      expect(test.onClose).not.toHaveBeenCalled();
      expect(test.markup(failed)).toContain('Late failure');
      expect(failed.props.dismissible).toBe(true);
      expect(test.markup(failed)).not.toContain('disabled="">Cancel</button>');
      failed.props.onClose();
      expect(test.onClose).toHaveBeenCalledOnce();
    }
  });

  it('allows dismissal before saving', () => {
    const test = session();
    const dialog = test.render();
    expect(dialog.props.dismissible).toBe(true);
    dialog.props.onClose();
    expect(test.onClose).toHaveBeenCalledOnce();
    expect(test.addPayment).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('ignores a %s after unmount', async (outcome) => {
    const test = session();
    test.render().props.children.props.onSubmit({ preventDefault: vi.fn() });
    hooks.cleanups.forEach((cleanup) => cleanup());
    const statesAtUnmount = [...hooks.slots];
    if (outcome === 'success') test.resolve();
    else test.reject(new Error('Failure after unmount'));
    await test.pending.catch(() => {});
    expect(test.onClose).not.toHaveBeenCalled();
    expect(hooks.slots).toEqual(statesAtUnmount);
  });

  it('prevents a disallowed pair even if submit is called directly', () => {
    const test = session({ ...initial, payerId: 'b', payeeId: 'c' });
    const dialog = test.render();
    expect(test.markup(dialog)).toContain('You can record payments you sent or received.');
    dialog.props.children.props.onSubmit({ preventDefault: vi.fn() });
    expect(test.addPayment).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '1.001'])('blocks invalid amount %s with a described reason', (amount) => {
    const test = session({ ...initial, amount });
    const dialog = test.render();
    expect(test.markup(dialog)).toContain('aria-invalid="true"');
    expect(test.markup(dialog)).toContain('id="record-payment-reason"');
    dialog.props.children.props.onSubmit({ preventDefault: vi.fn() });
    expect(test.addPayment).not.toHaveBeenCalled();
  });
});
