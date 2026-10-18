// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OwnerListPage, OwnerListRowView } from '@/lib/owner-list-view';

/**
 * UI-D-477 "Ver todos" continues the list in place (08.7-05): the island keeps the server's first
 * rows, owns the "e mais N" line and the enabled ghost "Ver todos"; pressing it calls the server
 * action with the list's own params and cursor, removes the line and the button, appends the rows,
 * moves focus to the first appended row and hands the rest to `InfiniteScroll`. A failed page shows
 * the retry line, and retrying asks for the SAME cursor again. `InfiniteScroll` is swapped for a
 * button (happy-dom has no scrolling IntersectionObserver), the `NotificationsSurface` precedent.
 */

const action = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/app/(app)/perfil/dashboard-actions', () => ({
  loadMoreOwnerListAction: (input: unknown) => action.fn(input),
}));

vi.mock('@rede-social/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rede-social/ui')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    InfiniteScroll: ({
      hasMore,
      enabled = true,
      onLoadMore,
    }: {
      hasMore: boolean;
      enabled?: boolean;
      onLoadMore: () => void | Promise<void>;
    }) =>
      hasMore && enabled
        ? createElement(
            'button',
            { type: 'button', 'data-testid': 'load-more', onClick: () => void onLoadMore() },
            'load-more',
          )
        : null,
  };
});

const { OwnerListMore } = await import('./OwnerListMore');

afterEach(() => {
  cleanup();
  action.fn.mockReset();
});

const LABELS = {
  seeAll: 'Ver todos',
  error: 'Não foi possível carregar o restante da lista.',
  retry: 'Tentar novamente',
};

function member(n: number): OwnerListRowView {
  return {
    type: 'member',
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    href: `/perfil?area=membros&faixa=em-risco&membro=m${n}`,
    name: `Membro ${n}`,
    initials: `M${n}`,
    lines: [
      { label: 'Membro desde:', value: 'set. de 2026' },
      { label: 'Tempo médio diário:', value: 'Em breve', comingSoon: true },
    ],
  };
}

function page(from: number, count: number, nextCursor: string | null): OwnerListPage {
  return { rows: Array.from({ length: count }, (_, i) => member(from + i)), nextCursor };
}

function renderMore() {
  return render(
    <OwnerListMore
      request={{ kind: 'band', band: 'at_risk', scope: 'base' }}
      cursor="cursor-1"
      layout="cards-wide"
      more="e mais 30 membros"
      labels={LABELS}
    />,
  );
}

describe('OwnerListMore (UI-D-477)', () => {
  it('starts with the "e mais N" line and an enabled ghost "Ver todos", calling nothing', () => {
    renderMore();
    expect(screen.getByText('e mais 30 membros')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Ver todos' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(action.fn).not.toHaveBeenCalled();
  });

  it('appends the next rows, removes the line and the button, and focuses the first new row', async () => {
    action.fn.mockResolvedValueOnce(page(11, 20, 'cursor-2'));
    renderMore();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ver todos' }));
    });
    expect(action.fn).toHaveBeenCalledWith({
      kind: 'band',
      band: 'at_risk',
      scope: 'base',
      cursor: 'cursor-1',
    });
    expect(screen.queryByText('e mais 30 membros')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ver todos' })).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(20);
    expect(links[0]?.textContent).toContain('Membro 11');
    expect(document.activeElement).toBe(links[0]);
    // The "Em breve" line is the neutral pill, not a number.
    expect(links[0]?.querySelector('[data-coming-soon]')?.textContent).toBe('Em breve');
  });

  it('continues by pages with the next cursor, and renders nothing at the end', async () => {
    action.fn
      .mockResolvedValueOnce(page(11, 20, 'cursor-2'))
      .mockResolvedValueOnce(page(31, 10, null));
    renderMore();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ver todos' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('load-more'));
    });
    expect(action.fn).toHaveBeenLastCalledWith({
      kind: 'band',
      band: 'at_risk',
      scope: 'base',
      cursor: 'cursor-2',
    });
    expect(screen.getAllByRole('link')).toHaveLength(30);
    expect(screen.queryByTestId('load-more')).toBeNull();
  });

  it('shows the retry line on a failed page, and retrying asks for the same cursor', async () => {
    action.fn.mockResolvedValueOnce({ error: true }).mockResolvedValueOnce(page(11, 5, null));
    renderMore();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ver todos' }));
    });
    expect(screen.getByText(LABELS.error)).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: LABELS.retry }));
    });
    expect(action.fn).toHaveBeenCalledTimes(2);
    expect(action.fn).toHaveBeenLastCalledWith({
      kind: 'band',
      band: 'at_risk',
      scope: 'base',
      cursor: 'cursor-1',
    });
    expect(screen.queryByText(LABELS.error)).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(5);
  });

  it('treats a rejected action as a failed page, never a crash', async () => {
    action.fn.mockRejectedValueOnce(new Error('network'));
    renderMore();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ver todos' }));
    });
    expect(screen.getByText(LABELS.error)).toBeTruthy();
  });
});
