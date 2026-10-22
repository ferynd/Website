import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExpenseEditor from '../../components/TripDetail/ExpenseEditor';
import type { Expense } from '../../pageTypes';

// Keep the existing node environment; exercise submit and rerender with a pending save.
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, useTrip: vi.fn() }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: () => {},
  useId: () => 'expense-editor',
  useRef: (current: unknown) => ({ current }),
  useState: <T,>(initial: T | (() => T)) => {
    const index = hooks.index++;
    if (!(index in hooks.states)) {
      hooks.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    }
    return [hooks.states[index] as T, (next: React.SetStateAction<T>) => {
      hooks.states[index] = typeof next === 'function'
        ? (next as (previous: T) => T)(hooks.states[index] as T)
        : next;
    }];
  },
}));
vi.mock('../../TripContext', () => ({ useTrip: hooks.useTrip }));
vi.mock('@/components/Button', () => ({
  default: ({ loading, ...props }: React.ComponentProps<'button'> & { loading?: boolean }) =>
    React.createElement('button', { ...props, disabled: props.disabled || loading }),
}));
vi.mock('@/components/Input', () => ({ default: 'input' }));
vi.mock('@/components/Select', () => ({ default: 'select' }));

const original: Expense = {
  id: 'expense', createdBy: 'user', category: 'Food', description: 'Dinner',
  totalAmount: 10, paidBy: { a: 10 }, splitType: 'even',
  splitParticipants: ['a', 'b'], manualSplit: {},
};

beforeEach(() => {
  hooks.states.length = 0;
  hooks.index = 0;
  hooks.useTrip.mockReset();
});

describe('ExpenseEditor pending save', () => {
  it.each(['success', 'failure'] as const)(
    '%s: freezes fields and suppresses optimistic-write warnings only while saving', async (outcome) => {
      let resolveSave!: () => void;
      let rejectSave!: (error: Error) => void;
      const pending = new Promise<void>((resolve, reject) => {
        resolveSave = resolve;
        rejectSave = reject;
      });
      const updateExpense = vi.fn(() => pending);
      const context = {
        trip: {}, expenses: [original],
        participants: ['a', 'b'].map((id) => ({ id, name: id })),
        addExpense: vi.fn(), updateExpense,
      };
      hooks.useTrip.mockReturnValue(context);
      const onSaved = vi.fn();
      const props = { original, userProfile: null, onClose: vi.fn(), onSaved };
      const render = () => {
        hooks.index = 0;
        return ExpenseEditor(props);
      };
      const markup = (editor: ReturnType<typeof render>) => renderToStaticMarkup(<>
        {editor.props.children}{editor.props.footer}
      </>);
      const initial = render();
      expect(markup(initial)).not.toContain('<fieldset disabled=""');

      // Submit a real draft, then simulate Firestore's optimistic local snapshot.
      const fields = initial.props.children.props.children;
      const descriptionLabel = fields.props.children[2].props.children[0];
      const descriptionInput = descriptionLabel.props.children[1];
      descriptionInput.props.onChange({ target: { value: 'Updated dinner' } });
      const edited = render();
      edited.props.children.props.onSubmit({ preventDefault: vi.fn() });
      expect(updateExpense).toHaveBeenCalledWith(original.id, expect.objectContaining({ description: 'Updated dinner' }));
      context.expenses = [{ ...original, description: 'Updated dinner' }];
      const inFlight = render();
      const savingMarkup = markup(inFlight);
      expect(savingMarkup).toContain('<fieldset disabled=""');
      expect(savingMarkup).toContain('Saving expense…');
      expect(savingMarkup).not.toContain('changed while you were editing');
      expect(savingMarkup).not.toContain('Save anyway');
      expect(inFlight.props.dismissible).toBe(false);
      expect(onSaved).not.toHaveBeenCalled();

      if (outcome === 'success') resolveSave();
      else rejectSave(new Error('Save failed'));
      await pending.catch(() => {});
      const completed = render();
      expect(markup(completed)).not.toContain('<fieldset disabled=""');
      if (outcome === 'success') {
        expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ description: 'Updated dinner' }));
      } else {
        expect(onSaved).not.toHaveBeenCalled();
        expect(markup(completed)).toContain('Save failed');
        expect(markup(completed)).toContain('changed while you were editing');
      }
    },
  );

  it('passes the editor snapshot when saving over a concurrent change', () => {
    const travelers = ['a', 'b', 'c'];
    const baseline: Expense = {
      id: 'expense', createdBy: 'user', category: 'Food', description: 'Dinner',
      totalAmount: 100, paidBy: { a: 100 }, splitType: 'manual', splitParticipants: travelers,
      manualSplit: {
        a: { type: 'percent', value: 33.33 },
        b: { type: 'percent', value: 33.33 },
        c: { type: 'percent', value: 33.33 },
      },
    };
    const live: Expense = { ...baseline, description: 'Updated elsewhere', splitType: 'even', manualSplit: {} };
    const updateExpense = vi.fn(() => Promise.resolve());
    hooks.useTrip.mockReturnValue({
      trip: {},
      expenses: [live],
      participants: travelers.map((id) => ({ id, name: id })),
      addExpense: vi.fn(),
      updateExpense,
    });
    const props = { original: baseline, userProfile: null, onClose: vi.fn(), onSaved: vi.fn() };
    const render = () => {
      hooks.index = 0;
      return ExpenseEditor(props);
    };
    const textOf = (node: React.ReactNode): string => {
      if (typeof node === 'string' || typeof node === 'number') return String(node);
      if (Array.isArray(node)) return node.map(textOf).join('');
      if (!React.isValidElement(node)) return '';
      return textOf((node.props as { children?: React.ReactNode }).children);
    };
    const elements = (node: React.ReactNode): React.ReactElement[] => {
      if (Array.isArray(node)) return node.flatMap(elements);
      if (!React.isValidElement(node)) return [];
      return [node, ...elements((node.props as { children?: React.ReactNode }).children)];
    };
    const first = render();
    const label = elements(first).find((element) => element.type === 'label' && textOf(element).includes('Save anyway'));
    const checkbox = label && elements(label).find((element) => element.type === 'input');
    const onChange = checkbox && (checkbox.props as { onChange?: (event: { target: { checked: boolean } }) => void }).onChange;
    if (!onChange) throw new Error('missing overwrite checkbox');
    onChange({ target: { checked: true } });
    const ready = render();
    ready.props.children.props.onSubmit({ preventDefault: vi.fn() });
    expect(updateExpense).toHaveBeenCalledWith(
      baseline.id,
      expect.objectContaining({ description: 'Dinner', manualSplitMode: 'percent' }),
      baseline,
    );
  });
});
