// @vitest-environment node

import { join } from 'node:path';
import { CHAT_PERMISSIONS } from '@rede-social/module-chat/contracts';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 11-22 Task 1 (CHAT-06, D-720, D-722, UI-D-864; T-11-06): `/conversas/com/{membershipId}` is the lazy start.
 * A pair has at most ONE conversation, so an existing one REDIRECTS to its own address; the caller's own
 * membership redirects to `/conversas` without asking the API; and every miss (no `chat.direct`, a malformed id,
 * a target that is staff, removed, another tenant's or unknown) is the one not-found screen that never says why.
 * A member who opened someone who blocked them gets the closed strip with the ONE sentence.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  fetchDirectWith: vi.fn(),
  loadOwnProfile: vi.fn(),
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
  fetchDirectWith: (id: string) => mocks.fetchDirectWith(id),
}));
vi.mock('@/lib/profile', () => ({ loadOwnProfile: () => mocks.loadOwnProfile() }));
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

const OTHER = '0e000000-0000-4000-8000-0000000000e1';
const OWN = '0a000000-0000-4000-8000-0000000000a1';
const CONVERSATION = '0c000000-0000-4000-8000-0000000000c1';

const answer = (over: Record<string, unknown> = {}) => ({
  conversationId: null,
  other: { membershipId: OTHER, displayName: 'Carla Nunes', avatarAssetId: null, removed: false },
  composer: 'open',
  ...over,
});

const params = (id: string) => ({ params: Promise.resolve({ membershipId: id }) });

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
  mocks.loadOwnProfile.mockResolvedValue({ membershipId: OWN });
  mocks.fetchDirectWith.mockResolvedValue(answer());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/conversas/com/{membershipId} — the lazy start (D-720)', () => {
  it('renders the empty thread for a pair with no conversation: no conversation id, no views, an open composer', async () => {
    const tree = (await Page(params(OTHER.toUpperCase()))) as ReactElement;
    expect(mocks.fetchDirectWith).toHaveBeenCalledWith(OTHER);
    const [frame] = find(tree, DirectThreadFrame);
    expect(frame?.props.other).toMatchObject({ membershipId: OTHER, name: 'Carla Nunes' });
    const [pane] = find(tree, DirectThreadPane);
    const props = propsOf(pane);
    expect(props.initialConversationId).toBeNull();
    expect(props.initialViews).toEqual([]);
    expect(props.initialComposer).toEqual({ state: 'open', strip: null });
    expect(props.canBlock).toBe(true);
  });

  it('REDIRECTS to the existing conversation of the pair (never two)', async () => {
    mocks.fetchDirectWith.mockResolvedValue(answer({ conversationId: CONVERSATION }));
    await expect(Page(params(OTHER))).rejects.toThrow(`REDIRECT /conversas/${CONVERSATION}`);
  });

  it("the caller's own membership redirects to /conversas without asking the API", async () => {
    await expect(Page(params(OWN))).rejects.toThrow('REDIRECT /conversas');
    expect(mocks.fetchDirectWith).not.toHaveBeenCalled();
  });

  it('someone who blocked the viewer: the closed strip, the one sentence, nothing else', async () => {
    mocks.fetchDirectWith.mockResolvedValue(answer({ composer: 'closed' }));
    const tree = (await Page(params(OTHER))) as ReactElement;
    const [pane] = find(tree, DirectThreadPane);
    const props = propsOf(pane);
    const composer = props.initialComposer as { state: string; strip: { text: string } };
    expect(composer.state).toBe('closed');
    expect(composer.strip.text).toBe('Esta conversa não aceita novas mensagens.');
    expect(JSON.stringify(composer).toLowerCase()).not.toContain('bloque');
  });

  it('the blocker who opens the person they blocked gets their own strip (and cannot block twice)', async () => {
    mocks.fetchDirectWith.mockResolvedValue(answer({ composer: 'blocker' }));
    const tree = (await Page(params(OTHER))) as ReactElement;
    const [pane] = find(tree, DirectThreadPane);
    const props = propsOf(pane);
    expect((props.initialComposer as { state: string }).state).toBe('blocker');
    expect(props.canBlock).toBe(false);
  });
});

describe('/conversas/com/{membershipId} — every miss is ONE screen (T-11-06)', () => {
  it('a viewer without chat.direct and a malformed id are not-found before any read', async () => {
    mocks.permissions = [CHAT_PERMISSIONS.answer];
    await expect(Page(params(OTHER))).rejects.toThrow('NOT_FOUND');
    mocks.permissions = [CHAT_PERMISSIONS.direct];
    await expect(Page(params('nao-e-uuid'))).rejects.toThrow('NOT_FOUND');
    expect(mocks.fetchDirectWith).not.toHaveBeenCalled();
    expect(mocks.loadOwnProfile).not.toHaveBeenCalled();
  });

  it('a bare 404 (staff, removed, another tenant, unknown) is not-found', async () => {
    mocks.fetchDirectWith.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND'));
    await expect(Page(params(OTHER))).rejects.toThrow('NOT_FOUND');
  });

  it('a refusal the bootstrap knows is a navigation; a transport failure is the error card', async () => {
    mocks.fetchDirectWith.mockRejectedValue(new ApiClientError(401, 'UNAUTHENTICATED'));
    await expect(Page(params(OTHER))).rejects.toThrow(/^REDIRECT /);

    mocks.fetchDirectWith.mockRejectedValue(new Error('boom'));
    const tree = (await Page(params(OTHER))) as ReactElement;
    expect(find(tree, DirectThreadError)).toHaveLength(1);
    expect(find(tree, DirectThreadPane)).toHaveLength(0);
  });
});
