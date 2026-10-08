// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PurchaseDialog, type PurchaseDialogProps } from '../ui';

/**
 * UI-D-370 / UI-D-371 / UI-D-386 — the purchase pop-up as an observable contract, not pixels.
 *
 * The dialog ships NO words (PWA-03): every string is a prop, sentinel ASCII here so a copy change
 * cannot turn this file red. The host owns the request and the step; the dialog only draws it, so a
 * fresh purchase and an `owned` replay (the same props) render the same markup (P27).
 */

/**
 * `motion/react`, replaced by plain elements (happy-dom's `Animation.cancel()` rejects a promise
 * motion never catches), the `comment-sheet-focus` precedent. ONE component per tag, cached, so the
 * panel never remounts between renders.
 */
vi.mock('motion/react', async () => {
  const { createElement, forwardRef } = await import('react');
  const MOTION_ONLY = new Set(['initial', 'animate', 'exit', 'transition']);
  const cache = new Map<string, unknown>();
  const proxy = new Proxy(
    {},
    {
      get: (_target, tag: string) => {
        const cached = cache.get(tag);
        if (cached) return cached;
        const component = forwardRef((props: Record<string, unknown>, ref: unknown) => {
          const plain: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(props)) {
            if (!MOTION_ONLY.has(key)) plain[key] = value;
          }
          return createElement(tag, { ...plain, ref });
        });
        cache.set(tag, component);
        return component;
      },
    },
  );
  return {
    motion: proxy,
    AnimatePresence: ({ children }: { children?: unknown }) => children,
    useReducedMotion: () => true,
  };
});

afterEach(cleanup);

const CONFIRM = {
  title: 'confirm-title',
  body: 'confirm-body',
  confirmLabel: 'confirm-label',
  pendingLabel: 'pending-label',
  cancelLabel: 'cancel-label',
};

function props(overrides: Partial<PurchaseDialogProps> = {}): PurchaseDialogProps {
  return {
    open: true,
    step: 'confirm',
    confirm: CONFIRM,
    success: { title: 'success-title', body: 'success-body', closeLabel: 'close-label' },
    pending: false,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

const THREE = [
  { href: '/c/1', name: 'community-1', thumb: <span data-testid="thumb-1" /> },
  { href: '/c/2', name: 'community-2' },
  { href: '/c/3', name: 'community-3' },
];

describe('PurchaseDialog — confirm step (UI-D-370 a)', () => {
  it('1. renders the given strings and nothing else, on the ConfirmDialog shell', () => {
    render(<PurchaseDialog {...props()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.className).toContain('max-w-[300px]');
    expect(dialog.className).toContain('rounded-2xl');
    expect(screen.getByRole('heading', { name: 'confirm-title' })).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName('confirm-title');
    expect(dialog).toHaveAccessibleDescription('confirm-body');
    expect(screen.getByRole('button', { name: 'cancel-label' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'confirm-label' })).toBeEnabled();
    // No word of its own: the visible text is exactly the five props.
    expect(dialog.textContent).toBe('confirm-titleconfirm-bodycancel-labelconfirm-label');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(dialog.querySelector('.bg-brand\\/10.text-brand')).not.toBeNull();
  });

  it('2. opens with the focus on "Confirmar" (UI-D-386)', () => {
    render(<PurchaseDialog {...props()} />);
    expect(screen.getByRole('button', { name: 'confirm-label' })).toHaveFocus();
  });

  it('3. confirm and cancel reach the host', () => {
    const p = props();
    render(<PurchaseDialog {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'confirm-label' }));
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'cancel-label' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('4. pending disables both buttons, swaps to the pending label and ignores Escape and the overlay', () => {
    const p = props({ pending: true });
    const { container } = render(<PurchaseDialog {...p} />);
    const confirm = screen.getByRole('button', { name: 'pending-label' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(confirm.querySelector('svg.animate-spin')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'cancel-label' })).toBeDisabled();
    expect(screen.queryByText('confirm-label')).toBeNull();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    const overlay = container.ownerDocument.querySelector('[data-purchase-overlay]');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay as Element);
    fireEvent.click(confirm);
    expect(p.onClose).not.toHaveBeenCalled();
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it('5. not pending: Escape and the overlay close', () => {
    const p = props();
    const { container } = render(<PurchaseDialog {...p} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.ownerDocument.querySelector('[data-purchase-overlay]') as Element);
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });

  it('6. errorText renders as an inline role="alert" danger line and keeps the step', () => {
    render(<PurchaseDialog {...props({ errorText: 'error-sentinel' })} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('error-sentinel');
    expect(alert.className).toContain('text-danger');
    expect(screen.getByRole('button', { name: 'confirm-label' })).toBeEnabled();
  });

  it('7. long names wrap inside the title and the body (E05 long-text)', () => {
    render(<PurchaseDialog {...props()} />);
    expect(screen.getByRole('heading').className).toContain('break-words');
    expect(screen.getByText('confirm-body').className).toContain('break-words');
  });
});

describe('PurchaseDialog — success step (UI-D-370 b, E05 zero-one-many)', () => {
  it('8. none (P28): the body and ONE full-width close, no list, no link', () => {
    const p = props({ step: 'success' });
    render(<PurchaseDialog {...p} />);
    const dialog = screen.getByRole('dialog');
    expect(screen.getByRole('heading', { name: 'success-title' })).toBeInTheDocument();
    expect(screen.getByText('success-body')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(dialog.querySelector('.bg-success\\/10.text-success')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'close-label' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('9. one: close │ the brand link to the community', () => {
    render(
      <PurchaseDialog
        {...props({
          step: 'success',
          success: {
            title: 'success-title',
            body: 'one-body',
            primary: { href: '/c/1', label: 'go-label' },
            closeLabel: 'close-label',
          },
        })}
      />,
    );
    const link = screen.getByRole('link', { name: 'go-label' });
    expect(link).toHaveAttribute('href', '/c/1');
    expect(link.className).toContain('text-brand');
    expect(screen.getByRole('button', { name: 'close-label' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('10. several: the capped scrolling list of links and ONE close (E05 overflow)', () => {
    render(
      <PurchaseDialog
        {...props({
          step: 'success',
          success: {
            title: 'success-title',
            body: 'several-body',
            communities: THREE,
            primary: { href: '/c/1', label: 'go-label' },
            closeLabel: 'close-label',
          },
        })}
      />,
    );
    const list = screen.getByRole('list');
    expect(list.className).toContain('max-h-60');
    expect(list.className).toContain('overflow-y-auto');
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/c/1', '/c/2', '/c/3']);
    expect(links[0]).toHaveTextContent('community-1');
    expect(links[0]?.className).toContain('min-h-11');
    expect(screen.getByText('community-3').className).toContain('truncate');
    expect(screen.getByTestId('thumb-1')).toBeInTheDocument();
    // The primary link is never drawn beside the list: the rows ARE the links.
    expect(screen.queryByRole('link', { name: 'go-label' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('11. focus lands on the success title, announced by the polite step container', () => {
    const p = props();
    const { rerender } = render(<PurchaseDialog {...p} />);
    expect(screen.getByRole('button', { name: 'confirm-label' })).toHaveFocus();
    rerender(<PurchaseDialog {...p} step="success" />);
    const title = screen.getByRole('heading', { name: 'success-title' });
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute('tabindex', '-1');
    expect(title.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('12. P27: two consecutive renders fed the same props draw the same success markup', () => {
    const success = {
      title: 'success-title',
      body: 'several-body',
      communities: THREE,
      closeLabel: 'close-label',
    };
    const first = render(<PurchaseDialog {...props({ step: 'success', success })} />);
    const purchased = first.container.innerHTML;
    first.unmount();
    const second = render(<PurchaseDialog {...props({ step: 'success', success })} />);
    expect(second.container.innerHTML.replace(/_r_\w+_/g, 'ID')).toBe(
      purchased.replace(/_r_\w+_/g, 'ID'),
    );
  });

  it('13. closed renders nothing', () => {
    render(<PurchaseDialog {...props({ open: false })} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
