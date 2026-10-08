// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuyerRowView } from '@/lib/store-view';

/**
 * 08.2-11 — the "Compradores" list (UI-D-380, D-359, D-360), against the REAL merged pt-BR catalogs
 * through next-intl's own `createTranslator` (ICU plurals included), so a copy drift fails here.
 * Stubbed: the server actions and the toast. Real: the list, `ConfirmDialog`, `IconButton`,
 * `StatusPill` and the focus trap.
 *
 * The web workspace has no jest-dom: plain DOM assertions only.
 */

const { toast, loadMore, revoke } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  loadMore: vi.fn(),
  revoke: vi.fn(),
}));

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

vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => toast,
}));

vi.mock('./actions', () => ({
  loadMoreBuyersAction: loadMore,
  revokeAccessAction: revoke,
}));

const { BuyersList } = await import('./BuyersList');

const P = '11111111-1111-4111-8111-111111111111';
const E1 = '00000000-0000-4000-8000-0000000000e1';
const E2 = '00000000-0000-4000-8000-0000000000e2';
const E3 = '00000000-0000-4000-8000-0000000000e3';

function row(id: string, overrides: Partial<BuyerRowView> = {}): BuyerRowView {
  const name = overrides.name ?? 'Ana Souza';
  return {
    id,
    membershipId: '00000000-0000-4000-8000-0000000000aa',
    name,
    removed: false,
    avatarUrl: null,
    meta: 'Comprou em 08/10/2026',
    source: 'purchase',
    tag: { label: 'Comprado', tone: 'success' },
    revokeLabel: `Revogar acesso de ${name}`,
    ...overrides,
  };
}

const ANA = row(E1, { name: 'Ana Souza' });
const BRUNO = row(E2, {
  name: 'Bruno Lima',
  source: 'grant',
  meta: 'Acesso concedido em 07/10/2026',
  tag: { label: 'Concedido', tone: 'neutral' },
  revokeLabel: 'Revogar acesso de Bruno Lima',
});
const REMOVED = row(E3, {
  name: 'Membro removido',
  membershipId: null,
  removed: true,
  meta: 'Comprou em 30/09/2026',
  revokeLabel: 'Revogar acesso de Membro removido',
});

function renderList(overrides: Record<string, unknown> = {}) {
  return render(
    <BuyersList
      productId={P}
      productName="Mentoria em grupo"
      hasCommunities
      tenantName="Rede Demo"
      initialItems={[ANA, BRUNO, REMOVED]}
      initialCursor={null}
      initialTotal={3}
      {...overrides}
    />,
  );
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-buyer-row]'));
const count = () => document.querySelector('[data-buyers-count]')?.textContent;
const revokeButton = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-buyer-revoke="${id}"]`) as HTMLButtonElement;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

async function confirmRevokeOf(id: string) {
  fireEvent.click(revokeButton(id));
  const open = await waitFor(() => {
    const found = dialog();
    if (!found) throw new Error('no dialog');
    return found;
  });
  await act(async () => {
    fireEvent.click(within(open).getByRole('button', { name: 'Revogar' }));
  });
  await waitFor(() => expect(dialog()).toBeNull());
}

beforeEach(() => {
  toast.show.mockReset();
  loadMore.mockReset();
  revoke.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('BuyersList (08.2-11, UI-D-380)', () => {
  it('1 toolbar: the product name, the holder count and "Conceder acesso"', () => {
    renderList();
    expect(document.querySelector('[data-buyers-product]')?.textContent).toBe('Mentoria em grupo');
    expect(count()).toBe('3 pessoas com acesso');
    expect(screen.getByRole('button', { name: 'Conceder acesso' })).toBeTruthy();
    expect(
      screen.getByRole('list', { name: 'Pessoas com acesso a Mentoria em grupo' }),
    ).toBeTruthy();
  });

  it('2 rows in the API order with the source tags: "Comprado" for a purchase, "Concedido" for a grant', () => {
    renderList();
    expect(rows().map((item) => item.dataset.buyerRow)).toEqual([E1, E2, E3]);
    const [ana, bruno] = rows() as [HTMLElement, HTMLElement];
    expect(ana.querySelector('[data-buyer-tag]')?.textContent).toBe('Comprado');
    expect(ana.textContent).toContain('Comprou em 08/10/2026');
    expect(bruno.querySelector('[data-buyer-tag]')?.textContent).toBe('Concedido');
    expect(bruno.textContent).toContain('Acesso concedido em 07/10/2026');
    // The tag and the control sit in a shrink-0 group, so a long name truncates first (E14 overflow).
    expect(ana.querySelector('[data-buyer-tag]')?.parentElement?.className).toContain('shrink-0');
    expect(ana.querySelector('[data-buyer-name]')?.className).toContain('truncate');
  });

  it('3 a removed member reads "Membro removido", tertiary, with the neutral avatar, and keeps revoke', () => {
    renderList();
    const removed = rows()[2] as HTMLElement;
    expect(removed.dataset.removed).toBe('true');
    const name = removed.querySelector('[data-buyer-name]') as HTMLElement;
    expect(name.textContent).toBe('Membro removido');
    expect(name.className).toContain('text-text-tertiary');
    expect(removed.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Revogar acesso de Membro removido' })).toBeTruthy();
  });

  it('4 the revoke dialog names the person and carries the body for the source and the communities', async () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Revogar acesso de Ana Souza' }));
    let open = await waitFor(() => dialog() as HTMLElement);
    expect(open.textContent).toContain('Revogar o acesso de Ana Souza?');
    expect(open.textContent).toContain(
      'Ana Souza perde o acesso a Mentoria em grupo e às comunidades que ele libera. A compra fica no histórico como revogada, e Ana Souza pode comprar de novo.',
    );
    fireEvent.click(within(open).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(revoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Revogar acesso de Bruno Lima' }));
    open = await waitFor(() => dialog() as HTMLElement);
    expect(open.textContent).toContain(
      'Bruno Lima perde o acesso a Mentoria em grupo e às comunidades que ele libera. Bruno Lima pode comprar o produto se quiser.',
    );
  });

  it('5 without communities the two short bodies are used', async () => {
    renderList({ hasCommunities: false });
    fireEvent.click(screen.getByRole('button', { name: 'Revogar acesso de Ana Souza' }));
    let open = await waitFor(() => dialog() as HTMLElement);
    expect(open.textContent).toContain(
      'Ana Souza perde o acesso a Mentoria em grupo. A compra fica no histórico como revogada, e Ana Souza pode comprar de novo.',
    );
    fireEvent.click(within(open).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(dialog()).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Revogar acesso de Bruno Lima' }));
    open = await waitFor(() => dialog() as HTMLElement);
    expect(open.textContent).toContain(
      'Bruno Lima perde o acesso a Mentoria em grupo e pode comprá-lo se quiser.',
    );
  });

  it('6 revoke success: the row leaves, the count drops, the toast names the person, focus moves to the next row', async () => {
    revoke.mockResolvedValue({ status: 'revoked' });
    renderList();
    await confirmRevokeOf(E1);
    expect(revoke).toHaveBeenCalledWith(P, E1);
    expect(rows().map((item) => item.dataset.buyerRow)).toEqual([E2, E3]);
    expect(count()).toBe('2 pessoas com acesso');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Acesso de Ana Souza revogado.',
    });
    await waitFor(() => expect(document.activeElement).toBe(revokeButton(E2)));
  });

  it('7 revoking the last row of the list moves focus to the previous row', async () => {
    revoke.mockResolvedValue({ status: 'revoked' });
    renderList();
    await confirmRevokeOf(E3);
    await waitFor(() => expect(document.activeElement).toBe(revokeButton(E2)));
  });

  it('8 a 404 (already revoked) removes the row with its own toast', async () => {
    revoke.mockResolvedValue({ status: 'gone' });
    renderList();
    await confirmRevokeOf(E2);
    expect(rows().map((item) => item.dataset.buyerRow)).toEqual([E1, E3]);
    expect(count()).toBe('2 pessoas com acesso');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'info',
      message: 'Este acesso já tinha sido revogado.',
    });
  });

  it('9 a failure keeps the row and the count and toasts the error', async () => {
    revoke.mockResolvedValue({ status: 'error' });
    renderList();
    await confirmRevokeOf(E1);
    expect(rows()).toHaveLength(3);
    expect(count()).toBe('3 pessoas com acesso');
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível revogar o acesso. Tente novamente.',
    });
  });

  it('10 a thrown action is the same failure', async () => {
    revoke.mockRejectedValue(new Error('network'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderList();
    await confirmRevokeOf(E1);
    expect(rows()).toHaveLength(3);
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    error.mockRestore();
  });

  it('11 revoking the only holder shows the empty state, "Ninguém com acesso", and focuses "Conceder acesso"', async () => {
    revoke.mockResolvedValue({ status: 'revoked' });
    renderList({ initialItems: [ANA], initialTotal: 1 });
    expect(count()).toBe('1 pessoa com acesso');
    await confirmRevokeOf(E1);
    expect(document.querySelector('[data-testid="buyers-empty"]')?.textContent).toContain(
      'Ninguém tem acesso ainda',
    );
    expect(count()).toBe('Ninguém com acesso');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Conceder acesso' })),
    );
  });

  it('12 no holder at all: the empty copy and the zero count', () => {
    renderList({ initialItems: [], initialTotal: 0 });
    expect(document.querySelector('[data-testid="buyers-empty"]')?.textContent).toContain(
      'Quem comprar ou receber acesso aparece aqui.',
    );
    expect(count()).toBe('Ninguém com acesso');
  });

  it('13 a first-load failure is the error card, and its retry reads page 1', async () => {
    loadMore.mockResolvedValue({ ok: true, items: [ANA], nextCursor: null, total: 1 });
    renderList({ initialItems: [], initialTotal: 0, initialError: true });
    const card = document.querySelector('[data-testid="buyers-error"]') as HTMLElement;
    expect(card.textContent).toContain(
      'Não foi possível carregar os compradores. Tente novamente.',
    );
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Tentar novamente' }));
    });
    expect(loadMore).toHaveBeenCalledWith(P, null);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(count()).toBe('1 pessoa com acesso');
  });
});
