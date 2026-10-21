import { fireEvent, render, screen, within } from '@testing-library/react';
import { Sparkles } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../src/index';

/**
 * 09.1-13 (UI-D-516): the optional `children` slot of `ConfirmDialog`, between the body and the footer
 * and INSIDE the `scrollBody` region when that is on, so a control the dialog hosts (the gate's
 * release checkbox) never pushes the footer off a 320px screen. The dialog's own behaviour is pinned
 * in `overlays.test.tsx`, which this file leaves untouched; here the point is that WITHOUT children
 * nothing changes.
 */

const base = {
  open: true,
  title: 'Exigir assinatura em Rede Demo?',
  body: '12 membros estão sem acesso registrado.',
  confirmLabel: 'Exigir assinatura',
  cancelLabel: 'Cancelar',
  onConfirm: () => {},
  onClose: () => {},
};

/** The dialog's markup with the `useId` values (different on every render) normalised. */
function markup(root: HTMLElement): string {
  return root.innerHTML.replace(/_r_\d+_/g, '_r_');
}

describe('ConfirmDialog children slot (UI-D-516)', () => {
  it('renders without children exactly as before: no extra wrapper, the scroll classes on the body itself', () => {
    const { container, unmount } = render(<ConfirmDialog {...base} scrollBody icon={Sparkles} />);
    const withoutSlot = markup(container);
    const body = screen.getByText(base.body);
    expect(body.tagName).toBe('P');
    expect(body.className).toContain('max-h-60');
    expect(body.className).toContain('overflow-y-auto');
    expect(body.getAttribute('data-confirm-body-scroll')).toBe('true');
    expect(body.parentElement?.className).toContain('items-center');
    unmount();

    // `undefined` children are the same as none.
    const again = render(
      <ConfirmDialog {...base} scrollBody icon={Sparkles}>
        {undefined}
      </ConfirmDialog>,
    );
    expect(markup(again.container)).toBe(withoutSlot);
  });

  it('renders the children between the body and the footer, both buttons still there and focusable', () => {
    render(
      <ConfirmDialog {...base}>
        <label>
          <input type="checkbox" defaultChecked />
          Liberar o acesso dos 12 membros atuais
        </label>
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole('dialog');
    const body = within(dialog).getByText(base.body);
    const box = within(dialog).getByRole('checkbox');
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement;
    const confirm = within(dialog).getByRole('button', {
      name: 'Exigir assinatura',
    }) as HTMLButtonElement;

    // Document order: body, then the slot, then the footer.
    expect(body.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cancel.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cancel.disabled).toBe(false);
    expect(confirm.disabled).toBe(false);
    // Still the dialog's description.
    expect(dialog.getAttribute('aria-describedby')).toBe(body.id);
  });

  it('with scrollBody the body AND the children share one capped, scrolling region; the footer stays outside it', () => {
    render(
      <ConfirmDialog {...base} scrollBody>
        <input type="checkbox" aria-label="Liberar" />
      </ConfirmDialog>,
    );
    const body = screen.getByText(base.body);
    const box = screen.getByRole('checkbox', { name: 'Liberar' });
    const region = body.closest('[data-confirm-body-scroll]') as HTMLElement;
    expect(region).toBeTruthy();
    expect(region.className).toContain('max-h-60');
    expect(region.className).toContain('overflow-y-auto');
    expect(region.className).toContain('overscroll-contain');
    expect(region.contains(box)).toBe(true);
    // The title and the two footer buttons are NOT inside the scroll region.
    expect(region.contains(screen.getByRole('heading', { name: base.title }))).toBe(false);
    expect(region.contains(screen.getByRole('button', { name: 'Cancelar' }))).toBe(false);
    expect(region.contains(screen.getByRole('button', { name: 'Exigir assinatura' }))).toBe(false);
  });

  it('without scrollBody the children flow in the dialog with no scroll cap', () => {
    render(
      <ConfirmDialog {...base}>
        <input type="checkbox" aria-label="Liberar" />
      </ConfirmDialog>,
    );
    const box = screen.getByRole('checkbox', { name: 'Liberar' });
    expect(box.closest('[data-confirm-body-scroll]')).toBeNull();
    expect(screen.getByText(base.body).className).not.toContain('overflow-y-auto');
  });

  it('keeps the confirmation working with children: the confirmed action runs and the dialog closes', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog {...base} onConfirm={onConfirm} onClose={onClose}>
        <input type="checkbox" aria-label="Liberar" />
      </ConfirmDialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Exigir assinatura' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('left-aligns the slot inside the centred dialog', () => {
    render(
      <ConfirmDialog {...base}>
        <input type="checkbox" aria-label="Liberar" />
      </ConfirmDialog>,
    );
    const slot = screen.getByRole('checkbox', { name: 'Liberar' }).parentElement as HTMLElement;
    expect(slot.className).toContain('text-left');
  });
});
