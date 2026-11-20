// @vitest-environment node

import { join } from 'node:path';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 11-19 Task 1 (CHAT-06, D-719, UI-D-862, UI-D-863, T-11-35): `/conversas` is decided by the composed PERMISSION
 * `chat.direct`, never by a role. A viewer without it (staff, a member with `social` off) gets the not-found
 * screen and the API is not read; a holder gets the first page through `fetchDirectList`, finished by the view
 * functions. A refusal `bootstrapRedirectPath` knows is a navigation; a failed read is the list's own error card
 * (the page passes `null`); an API 404 is the not-found screen.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  fetchDirectList: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  requireBootstrap: async () => ({
    permissions: mocks.permissions,
    tenant: {
      id: '99999999-9999-4999-8999-999999999999',
      displayName: 'Rede Lab',
      timezone: 'America/Sao_Paulo',
      branding: {},
    },
    user: { id: '88888888-8888-4888-8888-888888888888' },
    membership: { role: 'member' },
  }),
}));
vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/chat', () => ({
  fetchDirectList: (...args: unknown[]) => mocks.fetchDirectList(...args),
}));
vi.mock('next/navigation', () => ({
  notFound: () => mocks.notFound(),
  redirect: (path: string) => mocks.redirect(path),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});

const { default: ConversationsPage } = await import('./page');
const { ApiClientError } = await import('@/lib/bootstrap');

const OTHER = '0e000000-0000-4000-8000-0000000000e1';
const CONVERSATION = '0c000000-0000-4000-8000-0000000000c1';

const answer = (over: Record<string, unknown> = {}) => ({
  support: { lastPreview: null, unread: false },
  rows: [
    {
      conversationId: CONVERSATION,
      other: {
        membershipId: OTHER,
        displayName: 'Carla Nunes',
        avatarAssetId: null,
        removed: false,
      },
      lastPreview: { kind: 'text', text: 'Combinado!', own: false },
      lastMessageAt: '2026-11-19T17:12:00.000000Z',
      unreadCount: 2,
    },
  ],
  nextCursor: null,
  ...over,
});

type ListProps = {
  initial: { support?: { name: string }; rows: Array<{ name: string }> } | null;
  tenantId: string;
  userId: string;
};
const listProps = (element: ReactElement): ListProps => {
  // The page returns <div><PageHeader/><ConversationsList .../></div>: find the list by its `initial` prop.
  const children = (element.props as { children?: unknown }).children;
  const found = (Array.isArray(children) ? children : [children]).find(
    (child) =>
      child &&
      typeof child === 'object' &&
      'initial' in ((child as ReactElement).props as Record<string, unknown>),
  ) as ReactElement | undefined;
  if (!found) throw new Error('ConversationsList not found in the page tree');
  return found.props as ListProps;
};

beforeEach(() => {
  mocks.permissions = ['chat.support.contact', 'chat.direct'];
  mocks.fetchDirectList.mockReset();
  mocks.notFound.mockClear();
  mocks.redirect.mockClear();
});

describe('/conversas page (UI-D-862, T-11-35)', () => {
  it('loads page 1 through fetchDirectList and hands the finished views to the list', async () => {
    mocks.fetchDirectList.mockResolvedValue(answer());
    const element = (await ConversationsPage()) as ReactElement;
    expect(mocks.fetchDirectList).toHaveBeenCalledWith({ cursor: null });
    const { initial } = listProps(element);
    expect(initial?.support?.name).toBe('Equipe Rede Lab');
    expect(initial?.rows.map((row) => row.name)).toEqual(['Carla Nunes']);
  });

  it('hands the list the tenant and the member of the bootstrap, the topic of the live signal (never the host)', async () => {
    mocks.fetchDirectList.mockResolvedValue(answer());
    const props = listProps((await ConversationsPage()) as ReactElement);
    expect(props.tenantId).toBe('99999999-9999-4999-8999-999999999999');
    expect(props.userId).toBe('88888888-8888-4888-8888-888888888888');
  });

  it.each([
    ['a member with social off', ['chat.support.contact']],
    ['staff', ['chat.support', 'chat.support.assign']],
    ['nobody', []],
  ])('%s gets the not-found screen and the API is not read', async (_label, permissions) => {
    mocks.permissions = permissions;
    await expect(ConversationsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.fetchDirectList).not.toHaveBeenCalled();
  });

  it('an API 404 (social turned off meanwhile) is the not-found screen', async () => {
    mocks.fetchDirectList.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND'));
    await expect(ConversationsPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('a failed read hands the list a null first page, so it draws its own error card', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.fetchDirectList.mockRejectedValue(new Error('network'));
    const element = (await ConversationsPage()) as ReactElement;
    expect(listProps(element).initial).toBeNull();
  });

  it('a refusal the app knows is a navigation, not an error card', async () => {
    mocks.fetchDirectList.mockRejectedValue(new ApiClientError(401, 'UNAUTHENTICATED'));
    await expect(ConversationsPage()).rejects.toThrow('REDIRECT:/entrar');
  });
});
