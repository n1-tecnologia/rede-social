// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 10.1-14 (UI-D-755, A-UI-5, A-UI-6, T-10.1-16) — the toolbar door and the member search sheet of
 * "Liberar presença", against the REAL merged pt-BR catalog through next-intl's own translator. Stubbed:
 * the server actions, the toast host and the router. Real: the sheet, `BottomSheet`, `SearchBar`,
 * `ConfirmDialog`, `StatusPill` and the focus trap. `InfiniteScroll` is swapped for a stub that exposes its
 * props (happy-dom has no scrolling IntersectionObserver), the `AdminMembersList` precedent.
 */

const { toast, router, actions } = vi.hoisted(() => ({
  toast: { show: vi.fn(), dismiss: vi.fn() },
  router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() },
  actions: {
    search: vi.fn(),
    holders: vi.fn(),
    grant: vi.fn(),
  },
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

vi.mock('@rede-social/ui', async (orig) => {
  const actual = await orig<typeof import('@rede-social/ui')>();
  return {
    ...actual,
    useToast: () => toast,
    InfiniteScroll: ({
      hasMore,
      enabled,
      onLoadMore,
      skeleton,
    }: {
      hasMore: boolean;
      enabled?: boolean;
      onLoadMore: () => void;
      skeleton: ReactNode;
    }) =>
      hasMore ? (
        <div data-sentinel data-enabled={String(enabled !== false)}>
          <button type="button" data-sentinel-fire onClick={() => onLoadMore()}>
            sentinel
          </button>
          <div data-sentinel-skeleton>{skeleton}</div>
        </div>
      ) : null,
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => router }));

vi.mock('../../actions', () => ({
  searchCourtesyMembersAction: (...args: unknown[]) => actions.search(...args),
  courtesyHoldersAction: (...args: unknown[]) => actions.holders(...args),
  grantCourtesyAction: (...args: unknown[]) => actions.grant(...args),
}));

const { ReleasePresenceSheet, ReleasePresenceToolbar } = await import('./ReleasePresenceSheet');

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const M1 = '00000000-0000-4000-8000-0000000000a1';
const M2 = '00000000-0000-4000-8000-0000000000a2';
const M3 = '00000000-0000-4000-8000-0000000000a3';

const CARLA = {
  membershipId: M1,
  name: 'Carla Menezes',
  email: 'carla.menezes@email.com',
  avatarAssetId: null,
};
const CARLOS = {
  membershipId: M2,
  name: 'Carlos Eduardo Pereira',
  email: 'carlos.pereira@email.com',
  avatarAssetId: null,
};
const CAIO = {
  membershipId: M3,
  name: 'Caio Lima',
  email: 'caio@email.com',
  avatarAssetId: null,
};

const searchField = () => document.getElementById('release-presence-search') as HTMLInputElement;
const sheet = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find((node) =>
    node.querySelector('[data-release-sheet]'),
  );
const confirm = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(
    (node) => !node.querySelector('[data-release-sheet]'),
  );
const candidates = () => Array.from(document.querySelectorAll('[data-release-candidate]'));
const candidate = (id: string) =>
  document.querySelector(`[data-release-candidate="${id}"]`) as HTMLElement;

beforeEach(() => {
  toast.show.mockReset();
  router.refresh.mockReset();
  actions.search.mockReset();
  actions.holders.mockReset();
  actions.grant.mockReset();
  actions.holders.mockResolvedValue({ ok: true, holders: [] });
});

afterEach(cleanup);

async function openSheet() {
  render(<ReleasePresenceToolbar eventId={EVENT_ID} />);
  fireEvent.click(screen.getByRole('button', { name: 'Liberar presença' }));
  await waitFor(() => expect(sheet()).toBeTruthy());
}

async function search(q: string) {
  fireEvent.change(searchField(), { target: { value: q } });
  await waitFor(() => expect(actions.search).toHaveBeenCalledWith(q, null), { timeout: 2000 });
}

async function releaseOf(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Liberar presença de ${name}` }));
  return waitFor(() => {
    const found = confirm();
    if (!found) throw new Error('no confirm');
    return found;
  });
}

describe('the toolbar door (UI-D-755)', () => {
  it('1. an outline md button with the UserPlus glyph, full width below 360px, in a px-4 pt-4 row', () => {
    render(<ReleasePresenceToolbar eventId={EVENT_ID} />);
    const button = screen.getByRole('button', { name: 'Liberar presença' });
    expect(button.querySelector('svg')).not.toBeNull();
    for (const token of ['border', 'h-11', 'max-[359px]:w-full']) {
      expect(button.className).toContain(token);
    }
    const row = document.querySelector('[data-release-toolbar]') as HTMLElement;
    expect(row.className).toContain('px-4');
    expect(row.className).toContain('pt-4');
    expect(sheet()).toBeUndefined();
  });

  it('2. the sheet opens on the prompt ONLY: no member request, no holders request (T-10.1-16)', async () => {
    await openSheet();
    expect(screen.getByText('Digite o nome ou o e-mail do membro.')).toBeTruthy();
    expect(candidates()).toHaveLength(0);
    expect(searchField().getAttribute('aria-label')).toBe('Buscar membro');
    expect(document.activeElement).toBe(searchField());
    // Let any stray debounce fire: still nothing asked.
    await act(async () => {
      await new Promise((done) => setTimeout(done, 400));
    });
    expect(actions.search).not.toHaveBeenCalled();
    expect(actions.holders).not.toHaveBeenCalled();
  });

  it('3. whitespace is still no query: the prompt stays', async () => {
    await openSheet();
    fireEvent.change(searchField(), { target: { value: '   ' } });
    await act(async () => {
      await new Promise((done) => setTimeout(done, 400));
    });
    expect(actions.search).not.toHaveBeenCalled();
    expect(screen.getByText('Digite o nome ou o e-mail do membro.')).toBeTruthy();
  });
});

describe('the search (A-UI-6, UI-D-755)', () => {
  it('4. typing is debounced 300 ms into ONE request for the settled text', async () => {
    actions.search.mockResolvedValue({ ok: true, items: [CARLA], nextCursor: null });
    await openSheet();
    fireEvent.change(searchField(), { target: { value: 'ca' } });
    fireEvent.change(searchField(), { target: { value: 'car' } });
    fireEvent.change(searchField(), { target: { value: 'carl' } });
    expect(actions.search).not.toHaveBeenCalled();
    await waitFor(() => expect(actions.search).toHaveBeenCalledWith('carl', null), {
      timeout: 2000,
    });
    expect(actions.search).toHaveBeenCalledTimes(1);
  });

  it('5. a pending search shows 5 row skeletons, then the rows with avatar, name and e-mail', async () => {
    let resolve: (value: unknown) => void = () => {};
    actions.search.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await openSheet();
    fireEvent.change(searchField(), { target: { value: 'car' } });
    expect(document.querySelectorAll('[data-testid="release-skeleton"] > div')).toHaveLength(5);
    await waitFor(() => expect(actions.search).toHaveBeenCalledWith('car', null), {
      timeout: 2000,
    });
    await act(async () => {
      resolve({ ok: true, items: [CARLA, CARLOS], nextCursor: null });
    });
    await waitFor(() => expect(candidates()).toHaveLength(2));
    const first = candidate(M1);
    expect(first.querySelector('[data-release-name]')?.className).toContain('truncate');
    expect(first.querySelector('[data-release-name]')?.className).toContain('font-bold');
    expect(first.querySelector('[data-release-email]')?.textContent).toBe(
      'carla.menezes@email.com',
    );
    expect(first.querySelector('[data-release-email]')?.className).toContain('truncate');
    expect(first.querySelector('[role="img"], img, svg')).not.toBeNull();
    const button = within(first).getByRole('button', { name: 'Liberar presença de Carla Menezes' });
    expect(button.textContent).toBe('Liberar');
    expect(document.querySelectorAll('[data-testid="release-skeleton"]')).toHaveLength(0);
  });

  it('6. the holders read marks "Já inscrito" instead of the button, asked once per page with the page ids', async () => {
    actions.search.mockResolvedValue({ ok: true, items: [CARLA, CARLOS], nextCursor: null });
    actions.holders.mockResolvedValue({ ok: true, holders: [M2] });
    await openSheet();
    await search('car');
    await waitFor(() => expect(candidates()).toHaveLength(2));
    expect(actions.holders).toHaveBeenCalledTimes(1);
    expect(actions.holders).toHaveBeenCalledWith(EVENT_ID, [M1, M2]);
    expect(within(candidate(M2)).getByText('Já inscrito')).toBeTruthy();
    expect(within(candidate(M2)).queryByRole('button')).toBeNull();
    expect(within(candidate(M1)).getByRole('button', { name: /Liberar presença de/ })).toBeTruthy();
  });

  it('7. an unreadable holders answer offers every row (the write refuses already_in itself)', async () => {
    actions.search.mockResolvedValue({ ok: true, items: [CARLA], nextCursor: null });
    actions.holders.mockResolvedValue({ ok: false });
    await openSheet();
    await search('car');
    await waitFor(() => expect(candidates()).toHaveLength(1));
    expect(within(candidate(M1)).getByRole('button', { name: /Liberar presença de/ })).toBeTruthy();
    expect(screen.queryByText('Já inscrito')).toBeNull();
  });

  it('8. no match: "Nenhum membro encontrado" with its hint', async () => {
    actions.search.mockResolvedValue({ ok: true, items: [], nextCursor: null });
    await openSheet();
    await search('zzz');
    await waitFor(() => expect(screen.getByTestId('release-no-match')).toBeTruthy());
    expect(screen.getByText('Nenhum membro encontrado')).toBeTruthy();
    expect(screen.getByText('Tente outro nome ou e-mail.')).toBeTruthy();
    // An empty page asks no holders.
    expect(actions.holders).not.toHaveBeenCalled();
  });

  it('9. a failed search shows the inline line and its retry asks again', async () => {
    actions.search.mockResolvedValueOnce({ ok: false, code: 'generic' });
    actions.search.mockResolvedValueOnce({ ok: true, items: [CARLA], nextCursor: null });
    await openSheet();
    await search('car');
    const line = await waitFor(() => {
      const found = document.querySelector('[data-release-error]');
      if (!found) throw new Error('no error');
      return found as HTMLElement;
    });
    expect(line.textContent).toContain('Não foi possível buscar membros.');
    fireEvent.click(within(line).getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(candidates()).toHaveLength(1));
    expect(actions.search).toHaveBeenCalledTimes(2);
  });

  it('10. a rejected search is the same error line', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    actions.search.mockRejectedValue(new Error('network'));
    await openSheet();
    await search('car');
    await waitFor(() => expect(document.querySelector('[data-release-error]')).toBeTruthy());
    spy.mockRestore();
  });

  it('11. paging: the sentinel carries 3 skeleton rows, the next page appends and asks its own holders', async () => {
    actions.search.mockResolvedValueOnce({ ok: true, items: [CARLA, CARLOS], nextCursor: 'c2' });
    actions.search.mockResolvedValueOnce({ ok: true, items: [CARLOS, CAIO], nextCursor: null });
    actions.holders.mockResolvedValueOnce({ ok: true, holders: [] });
    actions.holders.mockResolvedValueOnce({ ok: true, holders: [M3] });
    await openSheet();
    await search('ca');
    await waitFor(() => expect(candidates()).toHaveLength(2));
    expect(
      document.querySelectorAll('[data-sentinel-skeleton] [data-testid="release-skeleton"] > div'),
    ).toHaveLength(3);
    await act(async () => {
      fireEvent.click(document.querySelector('[data-sentinel-fire]') as HTMLElement);
    });
    await waitFor(() => expect(candidates()).toHaveLength(3));
    expect(actions.search).toHaveBeenLastCalledWith('ca', 'c2');
    // The overlap row is not drawn twice.
    expect(candidates().map((node) => node.getAttribute('data-release-candidate'))).toEqual([
      M1,
      M2,
      M3,
    ]);
    expect(actions.holders).toHaveBeenLastCalledWith(EVENT_ID, [M2, M3]);
    expect(within(candidate(M3)).getByText('Já inscrito')).toBeTruthy();
    expect(document.querySelector('[data-sentinel]')).toBeNull();
  });

  it('12. a failed page parks the sentinel and offers a retry that re-arms it', async () => {
    actions.search.mockResolvedValueOnce({ ok: true, items: [CARLA], nextCursor: 'c2' });
    actions.search.mockResolvedValueOnce({ ok: false, code: 'generic' });
    await openSheet();
    await search('ca');
    await waitFor(() => expect(candidates()).toHaveLength(1));
    await act(async () => {
      fireEvent.click(document.querySelector('[data-sentinel-fire]') as HTMLElement);
    });
    await waitFor(() =>
      expect(document.querySelector('[data-sentinel]')?.getAttribute('data-enabled')).toBe('false'),
    );
    expect(candidates()).toHaveLength(1);
    const dialog = sheet() as HTMLElement;
    expect(dialog.textContent).toContain('Não foi possível buscar membros.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() =>
      expect(document.querySelector('[data-sentinel]')?.getAttribute('data-enabled')).toBe('true'),
    );
  });

  it('13. an older, slower answer never paints over a newer query', async () => {
    let resolveOld: (value: unknown) => void = () => {};
    actions.search.mockImplementation((q: string) =>
      q === 'ca'
        ? new Promise((done) => {
            resolveOld = done;
          })
        : Promise.resolve({ ok: true, items: [CAIO], nextCursor: null }),
    );
    await openSheet();
    await search('ca');
    fireEvent.change(searchField(), { target: { value: 'cai' } });
    await waitFor(() => expect(actions.search).toHaveBeenCalledWith('cai', null), {
      timeout: 2000,
    });
    await waitFor(() => expect(candidates()).toHaveLength(1));
    await act(async () => {
      resolveOld({ ok: true, items: [CARLA, CARLOS], nextCursor: null });
    });
    expect(candidates().map((node) => node.getAttribute('data-release-candidate'))).toEqual([M3]);
  });
});

describe('the release (D-743, UI-D-755)', () => {
  async function withCarla() {
    actions.search.mockResolvedValue({ ok: true, items: [CARLA], nextCursor: null });
    await openSheet();
    await search('car');
    await waitFor(() => expect(candidates()).toHaveLength(1));
  }

  it('14. the row opens the brand confirm naming the person, and nothing is sent until it is confirmed', async () => {
    await withCarla();
    const dialog = await releaseOf('Carla Menezes');
    expect(within(dialog).getByText('Liberar presença de Carla Menezes?')).toBeTruthy();
    expect(
      within(dialog).getByText(
        'A presença é confirmada agora, sem cobrança. Ela aparece como Cortesia.',
      ),
    ).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Liberar presença' })).toBeTruthy();
    expect(actions.grant).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Não liberar' }));
    await waitFor(() => expect(confirm()).toBeUndefined());
    expect(actions.grant).not.toHaveBeenCalled();
    expect(within(candidate(M1)).getByRole('button', { name: /Liberar presença de/ })).toBeTruthy();
  });

  it('15. the row becomes "Já inscrito" ONLY after the action resolves; the counts refresh once', async () => {
    let resolve: (value: unknown) => void = () => {};
    actions.grant.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await withCarla();
    const dialog = await releaseOf('Carla Menezes');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar presença' }));
    });
    expect(actions.grant).toHaveBeenCalledTimes(1);
    expect(actions.grant).toHaveBeenCalledWith(EVENT_ID, { membershipId: M1 });
    // Pending: the row is exactly as it was, nothing is optimistic.
    expect(screen.queryByText('Já inscrito')).toBeNull();
    expect(toast.show).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => {
      resolve({ status: 'granted' });
    });
    await waitFor(() => expect(within(candidate(M1)).getByText('Já inscrito')).toBeTruthy());
    expect(within(candidate(M1)).queryByRole('button')).toBeNull();
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Presença de Carla Menezes liberada.',
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('16. already_in: the info toast, the row turns "Já inscrito", and nothing new was written', async () => {
    actions.grant.mockResolvedValue({ status: 'already_in' });
    await withCarla();
    const dialog = await releaseOf('Carla Menezes');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar presença' }));
    });
    await waitFor(() => expect(within(candidate(M1)).getByText('Já inscrito')).toBeTruthy());
    expect(toast.show).toHaveBeenCalledWith({
      tone: 'info',
      message: 'Carla Menezes já está inscrito neste evento.',
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['event_ended', 'Este evento já terminou.'],
    ['event_cancelled', 'Este evento foi cancelado.'],
    ['event_not_paid', 'Algo deu errado. Tente novamente.'],
    ['not_found', 'Algo deu errado. Tente novamente.'],
    ['generic', 'Algo deu errado. Tente novamente.'],
  ] as const)(
    '17. a refusal (%s) toasts its sentence and leaves the row as it was',
    async (status, message) => {
      actions.grant.mockResolvedValue({ status });
      await withCarla();
      const dialog = await releaseOf('Carla Menezes');
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar presença' }));
      });
      await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ tone: 'error', message }));
      expect(screen.queryByText('Já inscrito')).toBeNull();
      expect(
        within(candidate(M1)).getByRole('button', { name: /Liberar presença de/ }),
      ).toBeTruthy();
      expect(router.refresh).not.toHaveBeenCalled();
    },
  );

  it('18. a rejected action is the generic toast and the row stays', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    actions.grant.mockRejectedValue(new Error('network'));
    await withCarla();
    const dialog = await releaseOf('Carla Menezes');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar presença' }));
    });
    await waitFor(() =>
      expect(toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Algo deu errado. Tente novamente.',
      }),
    );
    expect(screen.queryByText('Já inscrito')).toBeNull();
    spy.mockRestore();
  });

  it('19. reopening the sheet starts from an empty field and the prompt', async () => {
    actions.search.mockResolvedValue({ ok: true, items: [CARLA], nextCursor: null });
    render(
      <ReleasePresenceSheet open onClose={() => {}} eventId={EVENT_ID} onReleased={() => {}} />,
    );
    await search('car');
    await waitFor(() => expect(candidates()).toHaveLength(1));
    cleanup();
    actions.search.mockClear();
    render(
      <ReleasePresenceSheet open onClose={() => {}} eventId={EVENT_ID} onReleased={() => {}} />,
    );
    expect(searchField().value).toBe('');
    expect(candidates()).toHaveLength(0);
    expect(screen.getByText('Digite o nome ou o e-mail do membro.')).toBeTruthy();
    expect(actions.search).not.toHaveBeenCalled();
  });

  it('20. names and e-mails are plain text, never markup (T-10.1-17)', async () => {
    actions.search.mockResolvedValue({
      ok: true,
      items: [{ ...CARLA, name: '<img src=x onerror=alert(1)>', email: '<b>x</b>@y.test' }],
      nextCursor: null,
    });
    await openSheet();
    await search('x');
    await waitFor(() => expect(candidates()).toHaveLength(1));
    expect(candidate(M1).querySelector('img[src="x"]')).toBeNull();
    expect(candidate(M1).querySelector('b')).toBeNull();
    expect(candidate(M1).querySelector('[data-release-name]')?.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});
