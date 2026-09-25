// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 05.1-05 — the one-tap Reativar on an archived community's own page (D-90, UI-D-52).
 *
 * The catalog is the REAL `communities.json`, so an assertion here fails when the pt-BR copy drifts
 * (the `StoryComposer.test.tsx` pattern). What is stubbed: the server action, the router and the
 * toast. What is real: the button, the brand `ConfirmDialog` and its pending state.
 *
 * The six claims worth a test are the six a later edit could quietly break:
 *
 *  1. The island is ONE outline button carrying `data-community-page-reactivate` — and no dialog
 *     until it is tapped.
 *  2. The tap opens the explained confirmation (the prohibition: a community is never republished
 *     to every member's list without a deliberate, explained confirm).
 *  3. Confirming calls the action once with the id, toasts success and REFRESHES (Pitfall 8) — the
 *     page re-renders as active in place rather than navigating.
 *  4. A refusal (including `not_found`) toasts the error and does not refresh.
 *  5. A second confirm tap while the first is pending is inert (T-05.1-41).
 *  6. Cancel closes without calling the action.
 */

const { catalog, toast, refresh, reactivate } = await vi.hoisted(async () => {
  // `vi.hoisted` runs BEFORE the imports it feeds, so `node:fs` is loaded here rather than above.
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), 'messages', 'pt-BR', `${name}.json`), 'utf8'));
  return {
    catalog: read('communities').communities as Record<string, unknown>,
    toast: { show: vi.fn(), dismiss: vi.fn() },
    refresh: vi.fn(),
    reactivate: vi.fn(),
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

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

vi.mock('@tria/ui', async (orig) => ({
  ...(await orig<typeof import('@tria/ui')>()),
  useToast: () => toast,
}));

vi.mock('../actions', () => ({ reactivateCommunityAction: reactivate }));

const { ReactivateCommunity } = await import('./ReactivateCommunity');

const C = catalog as {
  archived: { reactivate: string };
  toasts: { reactivated: string };
  confirm: { reactivate: { title: string; body: string; confirm: string; cancel: string } };
  errors: { reactivate: string };
};
const ID = '33333333-3333-4333-8333-3333333333c5';

beforeEach(() => {
  toast.show.mockReset();
  refresh.mockReset();
  reactivate.mockReset();
});
afterEach(cleanup);

const trigger = () => screen.getByRole('button', { name: C.archived.reactivate });
const confirmButton = () => screen.getByRole('button', { name: C.confirm.reactivate.confirm });

describe('ReactivateCommunity — the archived page’s one-tap Reativar (05.1-05, D-90, UI-D-52)', () => {
  it('1. renders one outline "Reativar comunidade" button with data-community-page-reactivate and no dialog', () => {
    const { container } = render(<ReactivateCommunity communityId={ID} />);

    const button = trigger();
    expect(button.hasAttribute('data-community-page-reactivate')).toBe(true);
    expect(container.querySelectorAll('[data-community-page-reactivate]').length).toBe(1);
    expect(button.className).toContain('border-border-secondary');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('2. tapping opens the explained "Reativar comunidade?" confirmation with Reativar and Cancelar', () => {
    render(<ReactivateCommunity communityId={ID} />);
    fireEvent.click(trigger());

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain(C.confirm.reactivate.title);
    expect(dialog.textContent).toContain(C.confirm.reactivate.body);
    expect(confirmButton()).toBeTruthy();
    expect(screen.getByRole('button', { name: C.confirm.reactivate.cancel })).toBeTruthy();
  });

  it('3. confirming calls the action once with the id, toasts success and refreshes in place', async () => {
    reactivate.mockResolvedValue({ ok: true, communityId: ID });
    render(<ReactivateCommunity communityId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(confirmButton());

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(reactivate).toHaveBeenCalledTimes(1);
    expect(reactivate).toHaveBeenCalledWith(ID);
    expect(toast.show).toHaveBeenCalledWith({ tone: 'success', message: C.toasts.reactivated });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('4. a refusal (not_found included) toasts the error and does not refresh', async () => {
    reactivate.mockResolvedValue({ ok: false, code: 'not_found' });
    render(<ReactivateCommunity communityId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message: C.errors.reactivate }),
    );
    expect(refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The page stays archived with the button still there for a retry (UI E04/error).
    expect(trigger()).toBeTruthy();
  });

  it('5. a second confirm tap while the first is pending does not call the action again', async () => {
    let settle: (value: unknown) => void = () => {};
    reactivate.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    render(<ReactivateCommunity communityId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(confirmButton().getAttribute('aria-busy')).toBe('true'));
    fireEvent.click(confirmButton());

    expect(reactivate).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle({ ok: true, communityId: ID });
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(reactivate).toHaveBeenCalledTimes(1);
  });

  it('6. Cancelar closes the dialog without calling the action', async () => {
    render(<ReactivateCommunity communityId={ID} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: C.confirm.reactivate.cancel }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(reactivate).not.toHaveBeenCalled();
    expect(toast.show).not.toHaveBeenCalled();
  });
});
