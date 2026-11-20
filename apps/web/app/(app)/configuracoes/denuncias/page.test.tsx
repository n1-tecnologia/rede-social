// @vitest-environment node

import { join } from 'node:path';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 11-25 (MODER-05, D-616, UI-D-637): the queue page answers `notFound()` without `moderation.manage` and on the
 * platform host AT ZERO API COST, parses `?estado=` with the closed list, and hands page 1 to the queue FINISHED.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
const mocks = vi.hoisted(() => ({
  mode: 'tenant' as 'tenant' | 'platform',
  permissions: ['moderation.manage'] as string[],
  requireBootstrap: vi.fn(),
  fetchReports: vi.fn(),
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
  requireBootstrap: () => mocks.requireBootstrap(),
  ApiClientError: class ApiClientError extends Error {},
}));
vi.mock('@/lib/reports', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reports')>()),
  fetchReports: (...args: unknown[]) => mocks.fetchReports(...args),
}));
vi.mock('./ReportsQueue', () => ({ ReportsQueue: () => null }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

const { default: ReportsPage } = await import('./page');

const ID = '0b000000-0000-4000-8000-000000000001';
const item = (over: Record<string, unknown> = {}) => ({
  id: ID,
  createdAt: '2026-11-19T17:00:00.000000Z',
  subjectType: 'story',
  subjectId: ID,
  reason: 'spam',
  note: null,
  excerpt: 'Compre agora',
  status: 'open',
  resolvedAt: null,
  contentAvailable: true,
  reporter: { displayName: 'Larissa Souza', avatarAssetId: null },
  author: { displayName: 'Carla Nunes', avatarAssetId: null, isMember: true },
  ref: { storyId: ID },
  ...over,
});

type QueueProps = {
  initialItems: { id: string; typePill: string }[];
  initialCursor: string | null;
  estado: string;
  initialError: boolean;
  tenantName: string;
};

/** The `ReportsQueue` element's props inside the page's tree (the page is a server component). */
function queueProps(tree: ReactElement): QueueProps {
  const children = (tree.props as { children: ReactElement[] }).children;
  return (children[1] as ReactElement<QueueProps>).props;
}

const search = (estado?: string | string[]) =>
  Promise.resolve(estado === undefined ? {} : { estado });

beforeEach(() => {
  mocks.mode = 'tenant';
  mocks.permissions = ['moderation.manage'];
  mocks.requireBootstrap.mockReset();
  mocks.requireBootstrap.mockImplementation(async () => ({
    permissions: mocks.permissions,
    tenant: { timezone: 'America/Sao_Paulo', displayName: 'Ana Mentoria' },
  }));
  mocks.fetchReports.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('/configuracoes/denuncias: access', () => {
  it('is notFound() on the platform host, with no bootstrap and no API call', async () => {
    mocks.mode = 'platform';
    await expect(ReportsPage({ searchParams: search() })).rejects.toBeInstanceOf(NotFound);
    expect(mocks.requireBootstrap).not.toHaveBeenCalled();
    expect(mocks.fetchReports).not.toHaveBeenCalled();
  });

  it.each([[[]], [['members.manage']], [['tenant.manage']]])(
    'is notFound() without moderation.manage (%j), with no API call',
    async (permissions) => {
      mocks.permissions = permissions;
      await expect(ReportsPage({ searchParams: search() })).rejects.toBeInstanceOf(NotFound);
      expect(mocks.fetchReports).not.toHaveBeenCalled();
    },
  );
});

describe('/configuracoes/denuncias: the first page', () => {
  it('hands page 1 FINISHED to the queue, the open queue by default', async () => {
    mocks.fetchReports.mockResolvedValue({ items: [item()], nextCursor: 'c2' });
    const props = queueProps((await ReportsPage({ searchParams: search() })) as ReactElement);
    expect(mocks.fetchReports).toHaveBeenCalledWith({ estado: 'abertas' });
    expect(props.estado).toBe('abertas');
    expect(props.initialCursor).toBe('c2');
    expect(props.initialError).toBe(false);
    expect(props.tenantName).toBe('Ana Mentoria');
    expect(props.initialItems[0]?.typePill).toBe('Story');
  });

  it.each([
    ['resolvidas', 'resolvidas'],
    ['todas', 'todas'],
    ['bogus', 'abertas'],
    [['todas', 'resolvidas'], 'abertas'],
  ])('parses ?estado=%j with the closed list as %s', async (raw, expected) => {
    mocks.fetchReports.mockResolvedValue({ items: [], nextCursor: null });
    const props = queueProps((await ReportsPage({ searchParams: search(raw) })) as ReactElement);
    expect(props.estado).toBe(expected);
    expect(mocks.fetchReports).toHaveBeenCalledWith({ estado: expected });
  });

  it('an API failure is the queue failure state, never an empty queue', async () => {
    mocks.fetchReports.mockRejectedValue(new Error('down'));
    const props = queueProps((await ReportsPage({ searchParams: search() })) as ReactElement);
    expect(props.initialError).toBe(true);
    expect(props.initialItems).toEqual([]);
  });
});
