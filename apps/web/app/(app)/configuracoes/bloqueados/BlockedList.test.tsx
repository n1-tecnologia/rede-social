// @vitest-environment happy-dom

import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockedMemberView } from '@/lib/blocks';
import type { BlockedListProps } from './BlockedList';

/**
 * 11-20 (CHAT-07, D-723, D-724, UI-D-635): the Membros bloqueados list on the shipped `BlockedList`, with the REAL
 * pt-BR catalog through next-intl's own translator. `InfiniteScroll` is a button (happy-dom has no scrolling
 * IntersectionObserver), the `AdminMembersList` precedent. The two server actions arrive as props, so nothing here
 * needs a mock of a module.
 */

const { messages } = await vi.hoisted(async () => {
  const { loadMessages } = await import('@/i18n/messages');
  const { join } = await import('node:path');
  return { messages: loadMessages(join(process.cwd(), 'messages', 'pt-BR')) };
});

MotionGlobalConfig.skipAnimations = true;

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh }) }));

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
      onLoadMore: () => void;
      skeleton?: ReactNode;
    }) =>
      hasMore && enabled
        ? createElement(
            'button',
            { type: 'button', 'data-load-more': true, onClick: onLoadMore },
            'mais',
          )
        : null,
  };
});

vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const byNamespace = new Map<string, ReturnType<typeof actual.createTranslator>>();
  return {
    ...actual,
    useTranslations: (namespace: string) => {
      let tr = byNamespace.get(namespace);
      if (!tr) {
        tr = actual.createTranslator({ locale: 'pt-BR', messages, namespace });
        byNamespace.set(namespace, tr);
      }
      return tr;
    },
  };
});

const { BlockedList } = await import('./BlockedList');

afterEach(cleanup);
beforeEach(() => {
  nav.refresh.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function member(n: number, over: Partial<BlockedMemberView> = {}): BlockedMemberView {
  return {
    userId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    name: `Membro ${n}`,
    avatarUrl: null,
    ...over,
  };
}

function mount({
  items = [member(1), member(2)],
  cursor = null,
  initialError = false,
  unblock = vi.fn().mockResolvedValue({ ok: true, code: 'ok', changed: true }),
  loadMore = vi.fn(),
}: {
  items?: BlockedMemberView[];
  cursor?: string | null;
  initialError?: boolean;
  unblock?: ReturnType<typeof vi.fn>;
  loadMore?: ReturnType<typeof vi.fn>;
} = {}) {
  render(
    <ToastProvider>
      <BlockedList
        initialItems={items}
        initialCursor={cursor}
        initialError={initialError}
        unblockAction={unblock as unknown as BlockedListProps['unblockAction']}
        loadMoreAction={loadMore as unknown as BlockedListProps['loadMoreAction']}
      />
    </ToastProvider>,
  );
  return { unblock, loadMore };
}

const rows = () => document.querySelectorAll('[data-blocked-row]');

describe('rows', () => {
  it('draws the name and an outline Desbloquear per blocked member', () => {
    mount();
    expect(rows()).toHaveLength(2);
    expect(screen.getByText('Membro 1')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Desbloquear' })).toHaveLength(2);
  });

  it('a departed member reads Membro removido, as plain text', () => {
    mount({ items: [member(1, { name: null })] });
    expect(screen.getByText('Membro removido')).toBeTruthy();
  });

  it('a name that looks like markup is plain text (T-11-16)', () => {
    mount({ items: [member(1, { name: '<img src=x onerror=alert(1)>' })] });
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(document.querySelector('[data-blocked-row] img[src="x"]')).toBeNull();
  });

  it('the name truncates visually and keeps its full text', () => {
    const long = 'Maria '.repeat(12).trim();
    mount({ items: [member(1, { name: long })] });
    const label = screen.getByText(long);
    expect(label.className).toContain('truncate');
    expect(label.textContent).toBe(long);
  });
});

describe('unblock', () => {
  it('one tap, no dialog: Desbloqueando… while pending, a double tap sends one request, the row leaves with its toast', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const unblock = vi.fn().mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    mount({ unblock });

    const first = screen.getAllByRole('button', { name: 'Desbloquear' })[0] as HTMLButtonElement;
    fireEvent.click(first);
    fireEvent.click(first);

    const pending = screen.getByRole('button', { name: 'Desbloqueando…' }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => finish({ ok: true, code: 'ok', changed: true }));

    expect(unblock).toHaveBeenCalledTimes(1);
    expect(unblock).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001');
    expect(rows()).toHaveLength(1);
    expect(screen.queryByText('Membro 1')).toBeNull();
    expect(await screen.findByText('Membro 1 foi desbloqueado.')).toBeTruthy();
  });

  it('a repeat answered changed:false drops the row all the same', async () => {
    mount({ unblock: vi.fn().mockResolvedValue({ ok: true, code: 'ok', changed: false }) });
    await act(async () =>
      fireEvent.click(screen.getAllByRole('button', { name: 'Desbloquear' })[1] as HTMLElement),
    );
    expect(rows()).toHaveLength(1);
  });

  it.each(['rejected', 'refused'])(
    'a %s unblock keeps the row and raises the shipped error toast',
    async (how) => {
      const unblock =
        how === 'rejected'
          ? vi.fn().mockRejectedValue(new Error('offline'))
          : vi.fn().mockResolvedValue({ ok: false, code: 'failed', changed: false });
      mount({ unblock });
      await act(async () =>
        fireEvent.click(screen.getAllByRole('button', { name: 'Desbloquear' })[0] as HTMLElement),
      );
      expect(rows()).toHaveLength(2);
      expect(await screen.findByText('Algo deu errado. Tente novamente.')).toBeTruthy();
      // The button is released for another try.
      expect(
        (screen.getAllByRole('button', { name: 'Desbloquear' })[0] as HTMLButtonElement).disabled,
      ).toBe(false);
    },
  );

  it('never claims a follow comes back (D-724)', () => {
    mount();
    expect(document.body.textContent ?? '').not.toMatch(/volta|restaur|seguir/i);
  });
});

describe('empty and paging', () => {
  it('nobody blocked draws the empty state, never an empty column', () => {
    mount({ items: [] });
    expect(screen.getByText('Você não bloqueou ninguém')).toBeTruthy();
    expect(
      screen.getByText('Quando você bloquear alguém, a pessoa aparece aqui para você desbloquear.'),
    ).toBeTruthy();
    expect(document.querySelector('[data-blocked-list]')).toBeNull();
  });

  it('the last unblock leaves the empty state', async () => {
    mount({ items: [member(1)] });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' })));
    expect(screen.getByText('Você não bloqueou ninguém')).toBeTruthy();
  });

  it('keyset paging: the next page appends, the cursor moves, no row is drawn twice', async () => {
    const loadMore = vi.fn().mockResolvedValue({
      ok: true,
      items: [member(2), member(3)],
      nextCursor: null,
    });
    mount({ items: [member(1), member(2)], cursor: 'c1', loadMore });
    await act(async () =>
      fireEvent.click(document.querySelector('[data-load-more]') as HTMLElement),
    );
    expect(loadMore).toHaveBeenCalledWith('c1');
    expect(rows()).toHaveLength(3);
    expect(document.querySelector('[data-load-more]')).toBeNull();
  });

  it('a failed later page keeps the rows, stands the sentinel down and offers a retry', async () => {
    const loadMore = vi.fn().mockResolvedValue({ ok: false });
    mount({ items: [member(1)], cursor: 'c1', loadMore });
    await act(async () =>
      fireEvent.click(document.querySelector('[data-load-more]') as HTMLElement),
    );
    expect(rows()).toHaveLength(1);
    expect(document.querySelector('[data-blocked-page-error]')).not.toBeNull();
    expect(document.querySelector('[data-load-more]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(document.querySelector('[data-load-more]')).not.toBeNull();
  });

  it('a thrown page is the same failure state', async () => {
    mount({
      items: [member(1)],
      cursor: 'c1',
      loadMore: vi.fn().mockRejectedValue(new Error('x')),
    });
    await act(async () =>
      fireEvent.click(document.querySelector('[data-load-more]') as HTMLElement),
    );
    expect(document.querySelector('[data-blocked-page-error]')).not.toBeNull();
  });

  it('a first page that could not be read is a retry card, not the empty state', () => {
    mount({ items: [], initialError: true });
    expect(screen.queryByText('Você não bloqueou ninguém')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });
});
