// @vitest-environment node

import { join } from 'node:path';
import { CHAT_PERMISSIONS } from '@rede-social/module-chat/contracts';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 12.4-14 Task 2 (T-12.4-66; UC S04): the shared `/suporte` layout decides by PERMISSION. A caller without
 * `chat.support` (a member) gets its children alone: no split, no inbox read, no roster read. A holder of
 * `chat.support` gets the split with page 1 of the DEFAULT view rendered on the server (the layout cannot
 * read the query; the client list reconciles from the URL). The server components are called directly.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({ requireBootstrap: vi.fn(), getInbox: vi.fn(), fetch: vi.fn() }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace: namespace as never }),
  };
});
vi.mock('@/lib/bootstrap', () => ({ requireBootstrap: () => mocks.requireBootstrap() }));
vi.mock('@/lib/chat', () => ({ getInbox: (args: unknown) => mocks.getInbox(args) }));
vi.mock('./SupportInbox', () => ({
  SupportInbox: () => null,
  InboxSkeleton: () => null,
}));
vi.mock('./SupportSplit', () => ({ SupportSplit: () => null }));

const { default: SupportLayout } = await import('./layout');
const { SupportInbox } = await import('./SupportInbox');
const { SupportSplit } = await import('./SupportSplit');

const bootstrap = (permissions: string[]) => ({
  permissions,
  tenant: { id: '99999999-9999-4999-8999-999999999999', timezone: 'America/Sao_Paulo' },
});

const CHILD = <p>child</p>;

beforeEach(() => {
  mocks.requireBootstrap.mockReset();
  mocks.getInbox.mockReset();
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});

describe('the layout gate (T-12.4-66)', () => {
  it('a member (chat.support.contact, no chat.support) gets the children alone: no split, no inbox, no roster', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrap([CHAT_PERMISSIONS.contact]));
    const out = (await SupportLayout({ children: CHILD })) as ReactNode;
    expect(out).toBe(CHILD);
    expect(isValidElement(out) && (out as ReactElement).type === SupportSplit).toBe(false);
    expect(mocks.getInbox).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('a caller with no chat permission at all gets the children alone too', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrap([]));
    expect(await SupportLayout({ children: CHILD })).toBe(CHILD);
    expect(mocks.getInbox).not.toHaveBeenCalled();
  });

  it('holding chat.support.assign alone is not chat.support: still the children alone', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrap([CHAT_PERMISSIONS.assign]));
    expect(await SupportLayout({ children: CHILD })).toBe(CHILD);
  });

  it('positive control: chat.support gets the split with the default first page', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrap([CHAT_PERMISSIONS.answer]));
    mocks.getInbox.mockResolvedValue({
      items: [
        {
          conversationId: '11111111-1111-4111-8111-111111111111',
          member: { displayName: 'Ana', state: 'active', avatarAssetId: null },
          lastMessage: null,
          lastMessageAt: null,
          awaiting: false,
          case: null,
        },
      ],
      nextCursor: 'cursor-2',
    });
    const split = (await SupportLayout({ children: CHILD })) as ReactElement<{
      list: ReactElement<{ children: ReactElement<Record<string, unknown>> }>;
      children: ReactNode;
    }>;
    expect(split.type).toBe(SupportSplit);
    expect(split.props.children).toBe(CHILD);

    // The list is a Suspense around the async first page: resolve that server component by hand.
    const firstPage = split.props.list.props.children;
    const inbox = await (
      firstPage.type as (
        props: Record<string, unknown>,
      ) => Promise<ReactElement<Record<string, unknown>>>
    )(firstPage.props);
    expect(inbox.type).toBe(SupportInbox);
    expect(mocks.getInbox).toHaveBeenCalledWith({ cursor: null });
    expect(inbox.props.initialCursor).toBe('cursor-2');
    expect(inbox.props.initialError).toBe(false);
    expect(inbox.props.tenantId).toBe('99999999-9999-4999-8999-999999999999');
    expect((inbox.props.initialItems as Array<{ name: string }>).map((row) => row.name)).toEqual([
      'Ana',
    ]);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('an inbox the API could not read becomes the list error, not a crash', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrap([CHAT_PERMISSIONS.answer]));
    mocks.getInbox.mockResolvedValue(null);
    const split = (await SupportLayout({ children: CHILD })) as ReactElement<{
      list: ReactElement<{ children: ReactElement<Record<string, unknown>> }>;
    }>;
    const firstPage = split.props.list.props.children;
    const inbox = await (
      firstPage.type as (
        props: Record<string, unknown>,
      ) => Promise<ReactElement<Record<string, unknown>>>
    )(firstPage.props);
    expect(inbox.props.initialError).toBe(true);
    expect(inbox.props.initialItems).toEqual([]);
  });
});
