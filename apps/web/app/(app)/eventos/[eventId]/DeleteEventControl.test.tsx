// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.3-07 — the live "Excluir evento" (D-548, D-552, PEND-07).
 *
 * The catalog is the REAL `events.json`, so an assertion here fails when the pt-BR copy drifts. What
 * is stubbed: the server action, the router and the toast. What is real: the trigger, the brand
 * `ConfirmDialog` and its pending state.
 *
 *  1. One `type="button"` trigger inside `[data-delete-control="event"]`, enabled, and no dialog.
 *  2. The tap opens the explained confirmation, nothing is sent before the confirm.
 *  3. Confirming calls the action once, toasts success and REPLACES the history with `/eventos`.
 *  4. A failure toasts the generic error, does not navigate and leaves the trigger there.
 *  5. The 404 race toasts the `info` line and lands on `/eventos` like a success.
 *  6. A second confirm tap while pending is inert and the confirm button is `aria-busy`.
 *  7. "Manter evento" closes without calling the action.
 *  8. No event title anywhere: the dialog text is catalog-only and a thrown action logs a shape.
 */

const { catalog, toast, replace, remove } = await vi.hoisted(async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalog: read('events').events as Record<string, unknown>,
    toast: { show: vi.fn(), dismiss: vi.fn() },
    replace: vi.fn(),
    remove: vi.fn(),
  };
});

// The dialog animates in and out; a cancelled spring rejects AFTER the run ends under happy-dom.
MotionGlobalConfig.skipAnimations = true;

const lookup = (key: string, values?: Record<string, unknown>) => {
  const raw = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog);
  return String(raw ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(values?.[name] ?? ''),
  );
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => lookup(key, values),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace }),
}));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('../actions', () => ({ deleteEventAction: remove }));

const { DeleteEventControl } = await import('./DeleteEventControl');

const E = catalog as {
  delete: { action: string };
  toasts: { deleted: string };
  confirm: { delete: { title: string; body: string; confirm: string; dismiss: string } };
  errors: { delete: string; deleteGone: string };
};
const ID = '44444444-4444-4444-8444-4444444444e7';
const LONG_TITLE = 'Título muito longo de um evento '.repeat(4).slice(0, 120);

beforeEach(() => {
  toast.show.mockReset();
  replace.mockReset();
  remove.mockReset();
});
afterEach(cleanup);

const trigger = () => screen.getByRole('button', { name: E.delete.action });
const confirmButton = () => screen.getByRole('button', { name: E.confirm.delete.confirm });

describe('DeleteEventControl — the live "Excluir evento" (09.3-07, D-548, D-552)', () => {
  it('1. renders one enabled type=button trigger inside [data-delete-control="event"] and no dialog', () => {
    const { container } = render(<DeleteEventControl eventId={ID} />);

    const wrapper = container.querySelector('[data-delete-control="event"]');
    expect(wrapper).not.toBeNull();
    const button = trigger();
    expect(wrapper?.contains(button)).toBe(true);
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(button.className).not.toContain('opacity-60');
    expect(container.querySelectorAll('[data-delete-control]').length).toBe(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('2. tapping opens the explained confirmation and sends nothing before the confirm', () => {
    render(<DeleteEventControl eventId={ID} />);
    fireEvent.click(trigger());

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain(E.confirm.delete.title);
    expect(dialog.textContent).toContain(E.confirm.delete.body);
    expect(confirmButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: E.confirm.delete.dismiss })).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
  });

  it('3. confirming calls the action once with the id, toasts success and replaces with /eventos', async () => {
    remove.mockResolvedValue({ ok: true, eventId: ID });
    render(<DeleteEventControl eventId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/eventos');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(ID);
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: E.toasts.deleted });
  });

  it('4. a failure toasts the generic error, does not navigate and keeps the trigger', async () => {
    remove.mockResolvedValue({ ok: false, code: 'generic' });
    render(<DeleteEventControl eventId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: E.errors.delete }),
    );
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger().hasAttribute('aria-disabled')).toBe(false);
  });

  it('5. the 404 race toasts the info line and lands on /eventos like a success', async () => {
    remove.mockResolvedValue({ ok: false, code: 'not_found' });
    render(<DeleteEventControl eventId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/eventos'));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'info', message: E.errors.deleteGone });
    expect(toast.show).not.toHaveBeenCalledWith({ tone: 'success', message: E.toasts.deleted });
  });

  it('6. a second confirm tap while the first is pending calls the action once', async () => {
    let settle: (value: unknown) => void = () => {};
    remove.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    render(<DeleteEventControl eventId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmButton().getAttribute('aria-busy')).toBe('true'));
    fireEvent.click(confirmButton());

    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle({ ok: true, eventId: ID });
    });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('7. "Manter evento" closes the dialog without calling the action', async () => {
    render(<DeleteEventControl eventId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: E.confirm.delete.dismiss }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('8. the dialog is catalog-only and a thrown action logs a shape, never a title', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    remove.mockRejectedValue(new Error('boom'));
    render(
      <section data-title={LONG_TITLE}>
        <DeleteEventControl eventId={ID} />
      </section>,
    );
    fireEvent.click(trigger());

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toContain(LONG_TITLE.slice(0, 20));
    const catalogText = [
      E.confirm.delete.title,
      E.confirm.delete.body,
      E.confirm.delete.confirm,
      E.confirm.delete.dismiss,
    ];
    for (const line of catalogText) expect(dialog.textContent).toContain(line);

    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: E.errors.delete }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe('events.delete_failed');
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(LONG_TITLE.slice(0, 20));
    for (const call of toast.show.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(LONG_TITLE.slice(0, 20));
    }
    expect(replace).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
