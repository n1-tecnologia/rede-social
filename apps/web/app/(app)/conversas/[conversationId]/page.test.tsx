// @vitest-environment node

import { join } from 'node:path';
import { CHAT_PERMISSIONS } from '@rede-social/module-chat/contracts';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 11-22 Task 1 (CHAT-06, D-720, UI-D-864; T-11-02, T-11-06): `/conversas/{id}` is decided by the composed
 * PERMISSION `chat.direct`, never by a role, and EVERY miss is the one not-found screen: staff, a member with
 * `social` off, a malformed id, an unknown id, another pair's or another tenant's conversation and one the
 * administrator's block took away. The page draws exactly what the API answered, finished here, and a transport
 * failure is the thread's error card. The server component is called directly; the frame and the pane are stubs
 * so the props the page hands them can be read.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  fetchDirectDetail: vi.fn(),
  getMessages: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    mocks.notFound();
    throw new Error('NOT_FOUND');
  },
  redirect: (path: string) => {
    mocks.redirect(path);
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
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
  fetchDirectDetail: (id: string) => mocks.fetchDirectDetail(id),
  getMessages: (id: string, cursor: unknown) => mocks.getMessages(id, cursor),
}));
vi.mock('@/components/chat/DirectThreadFrame', () => ({
  DirectThreadFrame: function DirectThreadFrame() {
    return null;
  },
}));
vi.mock('@/components/chat/DirectThreadPane', () => ({
  DirectThreadPane: function DirectThreadPane() {
    return null;
  },
  DirectThreadError: function DirectThreadError() {
    return null;
  },
}));

const { default: Page } = await import('./page');
const { DirectThreadFrame } = await import('@/components/chat/DirectThreadFrame');
const { DirectThreadPane, DirectThreadError } = await import('@/components/chat/DirectThreadPane');
const { ApiClientError } = await import('@/lib/bootstrap');

const ID = '0c000000-0000-4000-8000-0000000000c1';
const OTHER = '0e000000-0000-4000-8000-0000000000e1';
const TENANT_ID = '99999999-9999-4999-8999-999999999999';

const detail = (over: Record<string, unknown> = {}) => ({
  conversationId: ID,
  other: { membershipId: OTHER, displayName: 'Carla Nunes', avatarAssetId: null, removed: false },
  composer: 'open',
  canBlock: true,
  lastSeq: 2,
  lastReadSeq: 1,
  ...over,
});

const row = (seq: number, authorIsViewer: boolean) => ({
  id: `00000000-0000-4000-8000-00000000000${seq}`,
  seq,
  side: 'member' as const,
  body: authorIsViewer ? 'Tudo!' : 'Oi, tudo bem?',
  createdAt: '2026-11-19T17:00:00.000000Z',
  author: null,
  authorIsViewer,
});

const params = (id: string) => ({ params: Promise.resolve({ conversationId: id }) });

/** Every element of `node` whose type is `type`, depth first. */
function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((child) => find(child, type));
  const element = node as ReactElement<{ children?: ReactNode }>;
  const here = element.type === type ? [element as ReactElement<Record<string, unknown>>] : [];
  return [...here, ...find(element.props?.children, type)];
}

/** The props of an element found in the tree, or an empty object when it is absent. */
const propsOf = (element: ReactElement<Record<string, unknown>> | undefined) =>
  (element?.props ?? {}) as Record<string, unknown>;

beforeEach(() => {
  for (const mock of Object.values(mocks)) if (typeof mock === 'function') mock.mockReset();
  mocks.permissions = [CHAT_PERMISSIONS.direct];
  mocks.fetchDirectDetail.mockResolvedValue(detail());
  mocks.getMessages.mockResolvedValue({
    conversationId: ID,
    items: [row(1, false), row(2, true)],
    hasMore: false,
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/conversas/{conversationId} — every miss is ONE screen (T-11-06)', () => {
  it('a viewer without chat.direct (staff, social off) gets not-found before any read', async () => {
    for (const permissions of [[], [CHAT_PERMISSIONS.answer], [CHAT_PERMISSIONS.contact]]) {
      mocks.permissions = permissions;
      await expect(Page(params(ID))).rejects.toThrow('NOT_FOUND');
    }
    expect(mocks.fetchDirectDetail).not.toHaveBeenCalled();
    expect(mocks.getMessages).not.toHaveBeenCalled();
  });

  it('a malformed id is not-found before any request', async () => {
    await expect(Page(params('nao-e-uuid'))).rejects.toThrow('NOT_FOUND');
    await expect(Page(params('../etc/passwd'))).rejects.toThrow('NOT_FOUND');
    expect(mocks.fetchDirectDetail).not.toHaveBeenCalled();
  });

  it('an API 404 (unknown, another pair, another tenant, hidden by the administrator) is not-found', async () => {
    mocks.fetchDirectDetail.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND'));
    await expect(Page(params(ID))).rejects.toThrow('NOT_FOUND');
    expect(mocks.getMessages).not.toHaveBeenCalled();
  });

  it('a refusal the bootstrap knows is a navigation, not a not-found', async () => {
    mocks.fetchDirectDetail.mockRejectedValue(new ApiClientError(401, 'UNAUTHENTICATED'));
    await expect(Page(params(ID))).rejects.toThrow(/^REDIRECT /);
  });
});

describe('/conversas/{conversationId} — the thread', () => {
  it('hands the frame the contact and the pane the finished thread: views by side, composer, positions', async () => {
    const tree = (await Page(params(ID.toUpperCase()))) as ReactElement;
    expect(mocks.fetchDirectDetail).toHaveBeenCalledWith(ID);
    expect(mocks.getMessages).toHaveBeenCalledWith(ID, null);

    const [frame] = find(tree, DirectThreadFrame);
    expect(frame?.props.other).toMatchObject({
      membershipId: OTHER,
      name: 'Carla Nunes',
      profileHref: `/membros/${OTHER}`,
      removed: false,
    });

    const [pane] = find(tree, DirectThreadPane);
    const props = propsOf(pane);
    expect(props.tenantId).toBe(TENANT_ID);
    expect(props.tenantName).toBe('Rede Lab');
    expect(props.initialConversationId).toBe(ID);
    expect(props.initialHasOlder).toBe(false);
    expect(props.initialComposer).toEqual({ state: 'open', strip: null });
    expect(props.canBlock).toBe(true);
    const views = props.initialViews as { side: string; body: string; label: unknown }[];
    expect(views.map((v) => [v.side, v.body, v.label])).toEqual([
      ['other', 'Oi, tudo bem?', null],
      ['own', 'Tudo!', null],
    ]);
  });

  it('a removed account has the neutral name and NO profile link, and the removed strip', async () => {
    mocks.fetchDirectDetail.mockResolvedValue(
      detail({
        other: { membershipId: null, displayName: null, avatarAssetId: null, removed: true },
        composer: 'removed',
        canBlock: false,
      }),
    );
    const tree = (await Page(params(ID))) as ReactElement;
    const [frame] = find(tree, DirectThreadFrame);
    expect(frame?.props.other).toMatchObject({
      name: 'Membro removido',
      profileHref: null,
      avatar: null,
    });
    const [pane] = find(tree, DirectThreadPane);
    const composer = propsOf(pane).initialComposer as {
      state: string;
      strip: { text: string };
    };
    expect(composer.state).toBe('removed');
    expect(composer.strip.text).toBe(
      'Este membro não está mais na comunidade. A conversa fica só para leitura.',
    );
  });

  it('the closed strip is the ONE sentence: no name, no reason, nothing about a block', async () => {
    mocks.fetchDirectDetail.mockResolvedValue(detail({ composer: 'closed' }));
    const tree = (await Page(params(ID))) as ReactElement;
    const [pane] = find(tree, DirectThreadPane);
    const composer = propsOf(pane).initialComposer as {
      strip: Record<string, unknown>;
    };
    expect(composer.strip.text).toBe('Esta conversa não aceita novas mensagens.');
    const flat = JSON.stringify(composer);
    expect(flat).not.toContain('Carla');
    expect(flat.toLowerCase()).not.toContain('bloque');
  });

  it('a conversation with no message of its own is the empty thread, never an error', async () => {
    mocks.getMessages.mockResolvedValue({ conversationId: ID, items: [], hasMore: false });
    const tree = (await Page(params(ID))) as ReactElement;
    const [pane] = find(tree, DirectThreadPane);
    expect(propsOf(pane).initialViews).toEqual([]);
    expect(find(tree, DirectThreadError)).toHaveLength(0);
  });

  it('a failed first read is the thread error card with no contact in the header', async () => {
    mocks.fetchDirectDetail.mockRejectedValue(new Error('boom'));
    let tree = (await Page(params(ID))) as ReactElement;
    expect(find(tree, DirectThreadError)).toHaveLength(1);
    expect(find(tree, DirectThreadFrame)[0]?.props.other).toBeNull();
    expect(find(tree, DirectThreadPane)).toHaveLength(0);

    mocks.fetchDirectDetail.mockResolvedValue(detail());
    mocks.getMessages.mockResolvedValue(null);
    tree = (await Page(params(ID))) as ReactElement;
    expect(find(tree, DirectThreadError)).toHaveLength(1);
  });
});
