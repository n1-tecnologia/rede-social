// @vitest-environment node

import { join } from 'node:path';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 11-20 (CHAT-07, UI-D-635): the blocked page reads page 1 of the CALLER's own blocks, answers `notFound()` on the
 * platform host and draws the list's own failure state when the API cannot answer.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const mocks = vi.hoisted(() => ({
  mode: 'tenant' as 'tenant' | 'platform',
  fetchBlocks: vi.fn(),
}));

class NotFound extends Error {}
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFound('notFound');
  },
}));
vi.mock('@/lib/tenant-host', () => ({
  getHostTenant: async () => ({ mode: mocks.mode, host: 'comunidade.exemplo.com.br' }),
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/bootstrap', () => ({
  requireBootstrap: async () => ({}),
  ApiClientError: class ApiClientError extends Error {},
}));
vi.mock('@/lib/blocks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/blocks')>()),
  fetchBlocks: (...args: unknown[]) => mocks.fetchBlocks(...args),
}));
vi.mock('@/components/feed/safety-actions', () => ({
  loadMoreBlocked: vi.fn(),
  unblockBlocked: vi.fn(),
}));
vi.mock('./BlockedList', () => ({ BlockedList: () => null }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

const { default: BlockedPage } = await import('./page');

type ListProps = {
  initialItems: { userId: string; name: string | null; avatarUrl: string | null }[];
  initialCursor: string | null;
  initialError: boolean;
};

/** The `BlockedList` element's props inside the page's tree (the page is a server component). */
function listProps(tree: ReactElement): ListProps {
  const children = (tree.props as { children: ReactElement[] }).children;
  return (children[1] as ReactElement<ListProps>).props;
}

beforeEach(() => {
  mocks.mode = 'tenant';
  mocks.fetchBlocks.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('/configuracoes/bloqueados', () => {
  it('answers notFound() on the platform host, with no API call', async () => {
    mocks.mode = 'platform';
    await expect(BlockedPage()).rejects.toBeInstanceOf(NotFound);
    expect(mocks.fetchBlocks).not.toHaveBeenCalled();
  });

  it('hands the first page, finished, to the list', async () => {
    mocks.fetchBlocks.mockResolvedValueOnce({
      items: [
        {
          userId: '00000000-0000-4000-8000-000000000001',
          displayName: 'Carla Nunes',
          avatarAssetId: null,
          blockedAt: '2026-11-19T10:00:00.000Z',
        },
      ],
      nextCursor: 'c2',
    });
    const props = listProps((await BlockedPage()) as ReactElement);
    expect(props.initialItems).toEqual([
      { userId: '00000000-0000-4000-8000-000000000001', name: 'Carla Nunes', avatarUrl: null },
    ]);
    expect(props.initialCursor).toBe('c2');
    expect(props.initialError).toBe(false);
  });

  it('an API failure is the list failure state, never an empty list', async () => {
    mocks.fetchBlocks.mockRejectedValueOnce(new Error('down'));
    const props = listProps((await BlockedPage()) as ReactElement);
    expect(props.initialError).toBe(true);
    expect(props.initialItems).toEqual([]);
  });
});
