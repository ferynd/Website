import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Dialog from '../../components/ui/Dialog';

// Exercise the Dialog's dismissal handlers in the existing node environment.
const { effects } = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
  useRef: (current: unknown) => ({ current }),
  useId: () => 'dialog-title',
}));

afterEach(() => {
  effects.length = 0;
  vi.unstubAllGlobals();
});

describe('Dialog dismissal', () => {
  it.each([false, undefined])('dismissible=%s controls close button, Escape, and backdrop', (dismissible) => {
    const onClose = vi.fn();
    const addEventListener = vi.fn();
    vi.stubGlobal('HTMLElement', class {});
    vi.stubGlobal('document', {
      body: { style: { overflow: '' } },
      activeElement: null,
      addEventListener,
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });

    const dialog = Dialog({ open: true, title: 'Expense', onClose, children: null, dismissible });
    if (!dialog) throw new Error('Expected an open dialog');
    const cleanup = effects[0]();
    try {
      const section = dialog.props.children;
      const header = section.props.children[0];
      const closeButton = header.props.children[1];
      expect(closeButton.props.disabled).toBe(dismissible === false);

      const backdrop = {};
      dialog.props.onMouseDown({ target: backdrop, currentTarget: backdrop } as React.MouseEvent<HTMLDivElement>);
      expect(onClose).toHaveBeenCalledTimes(dismissible === false ? 0 : 1);

      // Clicking inside the panel must never count as a backdrop click.
      dialog.props.onMouseDown({ target: {}, currentTarget: backdrop } as React.MouseEvent<HTMLDivElement>);
      expect(onClose).toHaveBeenCalledTimes(dismissible === false ? 0 : 1);

      const keydown = addEventListener.mock.calls[0][1] as (event: KeyboardEvent) => void;
      const preventDefault = vi.fn();
      keydown({ key: 'Escape', defaultPrevented: false, preventDefault } as unknown as KeyboardEvent);
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledTimes(dismissible === false ? 0 : 2);
    } finally {
      cleanup?.();
    }
  });

  it('ignores backdrop taps on phone-width screens so forms are not discarded', () => {
    const onClose = vi.fn();
    vi.stubGlobal('HTMLElement', class {});
    vi.stubGlobal('document', {
      body: { style: { overflow: '' } },
      activeElement: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });

    const dialog = Dialog({ open: true, title: 'Expense', onClose, children: null });
    if (!dialog) throw new Error('Expected an open dialog');
    const backdrop = {};
    dialog.props.onMouseDown({ target: backdrop, currentTarget: backdrop } as React.MouseEvent<HTMLDivElement>);
    expect(onClose).not.toHaveBeenCalled();
  });
});
