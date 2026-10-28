// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.3-08 — the live "Excluir comunidade" and its refusal dialog (D-553, D-554, D-557, PEND-07).
 *
 * The catalog is the REAL merged pt-BR catalog and the ICU plurals are FORMATTED (`createTranslator`,
 * as `CommunityForm.test.tsx` does), so an assertion here fails when the copy or a plural drifts.
 * What is stubbed: the server action, the router and the toast. What is real: the trigger, both
 * `ConfirmDialog`s and their pending state.
 *
 *  1. One `type="button"` trigger inside `[data-delete-control="community"]`, enabled, and no dialog.
 *  2. The tap opens the explained confirmation, nothing is sent before the confirm.
 *  3. Confirming calls the action once, toasts success and REPLACES the history with `/comunidades`.
 *  4. A failure toasts the generic error, does not navigate and leaves the trigger there.
 *  5. The 404 race toasts the `info` line and lands on `/comunidades`.
 *  6. A community that is no longer archived toasts its line and refreshes, never replaces.
 *  7. A second confirm tap while pending calls the action once.
 *  8. "Cancelar" closes without calling the action.
 *  9. The refusal: the delete dialog closes, the refusal dialog lists the products, plural body.
 * 10. Five names and a total of nine: five items and "e mais 4 produtos".
 * 11. One name and a total of one (P23): the singular body and NO "e mais" line.
 * 12. Long and markup names render whole, as text.
 * 13. The refusal body scrolls, "Ver produtos" goes to /loja, "Fechar" closes it.
 * 14. No product name in a toast or a console call.
 */

const { toast, push, replace, refresh, remove } = await vi.hoisted(async () => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  remove: vi.fn(),
}));

// The dialog animates in and out; a cancelled spring rejects AFTER the run ends under happy-dom.
MotionGlobalConfig.skipAnimations = true;

vi.mock('next-intl', async (orig) => {
  const actual = await orig<typeof import('next-intl')>();
  const { join } = await import('node:path');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
  return {
    ...actual,
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh }),
}));

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('../actions', () => ({ deleteCommunityAction: remove }));

const { DeleteCommunityControl } = await import('./DeleteCommunityControl');
const { default: catalog } = await import('../../../../messages/pt-BR/communities.json');

const C = catalog.communities;
const ID = '55555555-5555-4555-8555-5555555555c8';
const product = (i: number, name = `Produto ${i}`) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0${i}`,
  name,
});
const refusal = (products: { id: string; name: string }[], count: number) => ({
  ok: false as const,
  code: 'unlock_active' as const,
  products,
  count,
});

const SINGULAR_BODY =
  'Este produto da Loja ainda dá acesso a esta comunidade. Tire a comunidade dele primeiro.';
const PLURAL_BODY =
  'Estes produtos da Loja ainda dão acesso a esta comunidade. Tire a comunidade deles primeiro.';

beforeEach(() => {
  for (const fn of [toast.show, push, replace, refresh, remove]) fn.mockReset();
});
afterEach(cleanup);

const trigger = () => screen.getByRole('button', { name: C.delete.action });
const confirmButton = () => screen.getByRole('button', { name: C.confirm.delete.confirm });

/** Taps the trigger and the confirm, and waits for the refusal dialog to be the open one. */
async function openRefusal() {
  render(<DeleteCommunityControl communityId={ID} />);
  fireEvent.click(trigger());
  fireEvent.click(confirmButton());
  return await screen.findByRole('dialog', { name: C.blocked.title });
}

describe('DeleteCommunityControl — the live "Excluir comunidade" (09.3-08, D-553)', () => {
  it('1. renders one enabled type=button trigger inside [data-delete-control="community"] and no dialog', () => {
    const { container } = render(<DeleteCommunityControl communityId={ID} />);

    const wrapper = container.querySelector('[data-delete-control="community"]');
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
    render(<DeleteCommunityControl communityId={ID} />);
    fireEvent.click(trigger());

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain(C.confirm.delete.title);
    expect(dialog.textContent).toContain(C.confirm.delete.body);
    expect(confirmButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: C.confirm.delete.cancel })).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
  });

  it('3. confirming calls the action once with the id, toasts success and replaces with /comunidades', async () => {
    remove.mockResolvedValue({ ok: true, communityId: ID });
    render(<DeleteCommunityControl communityId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/comunidades');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(ID);
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: C.toasts.deleted });
    expect(push).not.toHaveBeenCalled();
  });

  it('4. a failure toasts the generic error, does not navigate and keeps the trigger', async () => {
    remove.mockResolvedValue({ ok: false, code: 'generic' });
    render(<DeleteCommunityControl communityId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.errors.delete }),
    );
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger().hasAttribute('aria-disabled')).toBe(false);
  });

  it('5. the 404 race toasts the info line and lands on /comunidades like a success', async () => {
    remove.mockResolvedValue({ ok: false, code: 'not_found' });
    render(<DeleteCommunityControl communityId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/comunidades'));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'info', message: C.errors.deleteGone });
    expect(toast.show).not.toHaveBeenCalledWith({ tone: 'success', message: C.toasts.deleted });
  });

  it('6. a community that is no longer archived toasts its line and refreshes, not replaces', async () => {
    remove.mockResolvedValue({ ok: false, code: 'not_archived' });
    render(<DeleteCommunityControl communityId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.errors.deleteNotArchived });
    expect(replace).not.toHaveBeenCalled();
  });

  it('7. a second confirm tap while the first is pending calls the action once', async () => {
    let settle: (value: unknown) => void = () => {};
    remove.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    render(<DeleteCommunityControl communityId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmButton().getAttribute('aria-busy')).toBe('true'));
    fireEvent.click(confirmButton());

    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle({ ok: true, communityId: ID });
    });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('8. "Cancelar" closes the dialog without calling the action', async () => {
    render(<DeleteCommunityControl communityId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: C.confirm.delete.cancel }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('DeleteCommunityControl — the refusal dialog (D-554)', () => {
  it('9. closes the delete dialog and lists the products in order with the plural body', async () => {
    remove.mockResolvedValue(refusal([product(0), product(1), product(2)], 3));
    const dialog = await openRefusal();

    // The delete dialog leaves with an exit animation; a slower runner still has it mounted on the first read.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: C.confirm.delete.title })).toBeNull(),
    );
    expect(dialog.textContent).toContain('Não é possível excluir');
    expect(dialog.textContent).toContain(PLURAL_BODY);
    const items = [...dialog.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['Produto 0', 'Produto 1', 'Produto 2']);
    expect(dialog.querySelector('ul')?.className).toContain('list-disc');
    expect(dialog.textContent).not.toContain('e mais');
    expect(screen.getByRole('button', { name: 'Ver produtos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy();
    expect(toast.show).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('10. five names and a total of nine: five items and "e mais 4 produtos"', async () => {
    remove.mockResolvedValue(
      refusal(
        [0, 1, 2, 3, 4].map((i) => product(i)),
        9,
      ),
    );
    const dialog = await openRefusal();

    expect(dialog.querySelectorAll('li').length).toBe(5);
    expect(dialog.textContent).toContain('e mais 4 produtos');
    expect(dialog.textContent).toContain(PLURAL_BODY);
  });

  it('11. one name and a total of one: the singular body and no "e mais" line (P23)', async () => {
    remove.mockResolvedValue(refusal([product(0)], 1));
    const dialog = await openRefusal();

    expect(dialog.querySelectorAll('li').length).toBe(1);
    expect(dialog.textContent).toContain(SINGULAR_BODY);
    expect(dialog.textContent).not.toContain(PLURAL_BODY);
    expect(dialog.textContent).not.toContain('e mais');
  });

  it('11b. five names and a total of six: the line reads "e mais 1 produto"', async () => {
    remove.mockResolvedValue(
      refusal(
        [0, 1, 2, 3, 4].map((i) => product(i)),
        6,
      ),
    );
    const dialog = await openRefusal();

    expect(dialog.textContent).toContain('e mais 1 produto');
    expect(dialog.textContent).not.toContain('e mais 1 produtos');
  });

  it('12. a 120-character name and a name with markup render whole, as text', async () => {
    const long = `${'Longuíssimo'.repeat(11)}`.slice(0, 120);
    const markup = '<b>x</b> & "q"';
    remove.mockResolvedValue(refusal([product(0, long), product(1, markup)], 2));
    const dialog = await openRefusal();

    const items = [...dialog.querySelectorAll('li')];
    expect(items.map((li) => li.textContent)).toEqual([long, markup]);
    expect(long.length).toBe(120);
    expect(dialog.querySelector('b')).toBeNull();
    for (const li of items) expect(li.className).toContain('break-words');
  });

  it('13. the body scrolls, "Ver produtos" goes to /loja and "Fechar" closes without an action', async () => {
    remove.mockResolvedValue(refusal([product(0), product(1)], 2));
    const dialog = await openRefusal();

    expect(dialog.querySelector('[data-confirm-body-scroll="true"]')).not.toBeNull();
    // No control that changes the Loja: only the two footer buttons.
    expect([...dialog.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Fechar',
      'Ver produtos',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Ver produtos' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/loja'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).toHaveBeenCalledTimes(1);

    cleanup();
    remove.mockReset();
    push.mockReset();
    remove.mockResolvedValue(refusal([product(0)], 1));
    await openRefusal();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(push).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('14. no product name reaches a toast or a console call', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const names = ['Curso Premium Ouro', 'Mentoria Secreta'];
    remove.mockResolvedValueOnce(
      refusal(
        names.map((n, i) => product(i, n)),
        2,
      ),
    );
    await openRefusal();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    remove.mockRejectedValueOnce(new Error(`boom ${ID}`));
    fireEvent.click(trigger());
    fireEvent.click(confirmButton());
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.errors.delete }),
    );

    const toasted = JSON.stringify(toast.show.mock.calls);
    const logged = JSON.stringify(spy.mock.calls);
    for (const name of names) {
      expect(toasted).not.toContain(name);
      expect(logged).not.toContain(name);
    }
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe('communities.delete_failed');
    spy.mockRestore();
  });
});
