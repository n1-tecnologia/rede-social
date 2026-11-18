// @vitest-environment node

import { join } from 'node:path';
import { CHAT_PERMISSIONS } from '@rede-social/module-chat/contracts';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';

/**
 * 12.4-12 Task 3 (D-803, D-804, UI-D-821, UI-D-832, CASE-27; T-12.4-56): `/suporte/{id}` has two
 * readers now. The first gate is a three-way split by PERMISSION: a holder of `chat.support` takes the
 * shipped staff path untouched, a holder of `chat.support.contact` reads their OWN case, anyone else gets
 * the one not-found screen. The member's active case redirects to `/suporte` (one canonical address), a
 * closed one renders read-only, and an id that is not theirs, another tenant's or unknown is `notFound()`
 * with no oracle (the API answers all three with the same bare 404). The server component is called
 * directly; `ThreadPane` is a stub so the props the page hands it can be read.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({
  requireBootstrap: vi.fn(),
  getConversation: vi.fn(),
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
vi.mock('@/lib/bootstrap', () => ({ requireBootstrap: () => mocks.requireBootstrap() }));
vi.mock('@/lib/chat', () => ({
  getConversation: (id: string) => mocks.getConversation(id),
  getMessages: (id: string, cursor: unknown) => mocks.getMessages(id, cursor),
}));
vi.mock('../actions', () => ({
  replyToConversationAction: vi.fn(),
  replyVoiceToConversationAction: vi.fn(),
}));
vi.mock('../ThreadPane', () => ({
  ThreadPane: function ThreadPane() {
    return null;
  },
}));

const { default: Page } = await import('./page');
const { ThreadPane } = await import('../ThreadPane');

const ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '99999999-9999-4999-8999-999999999999';

const bootstrapWith = (permissions: string[]) => ({
  permissions,
  tenant: {
    id: TENANT_ID,
    displayName: 'Rede Demo',
    timezone: 'America/Sao_Paulo',
    branding: {},
  },
});

const MEMBER = [CHAT_PERMISSIONS.contact];
const STAFF = [CHAT_PERMISSIONS.answer];

const memberCase = (state: 'open' | 'in_progress' | 'resolved' | 'closed') => ({
  id: ID,
  number: 42,
  state,
  subject: 'Meu ingresso',
  subjectLabel: 'Meu ingresso',
  category: 'payment',
  openedAt: '2026-11-10T12:00:00.000Z',
});

const memberDetail = (state?: 'open' | 'in_progress' | 'resolved' | 'closed') => ({
  status: 'ok' as const,
  detail: {
    viewer: 'member' as const,
    id: ID,
    lastSeq: 1,
    lastReadSeq: 1,
    lastStaffSeq: 0,
    ...(state ? { case: memberCase(state) } : {}),
  },
});

const staffDetail = {
  status: 'ok' as const,
  detail: {
    viewer: 'staff' as const,
    id: ID,
    member: {
      membershipId: null,
      displayName: 'Ana',
      avatarAssetId: null,
      state: 'active' as const,
    },
    lastSeq: 1,
    staffLastReadSeq: 0,
  },
};

const row = {
  id: '22222222-2222-4222-8222-222222222222',
  seq: 1,
  side: 'member' as const,
  body: 'Oi, preciso de ajuda',
  createdAt: '2026-11-10T12:00:00.000Z',
  author: null,
  authorIsViewer: true,
};

const params = (id: string) => ({ params: Promise.resolve({ conversationId: id }) });

/** Every element of `node` whose type is `type`, depth first. */
function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((child) => find(child, type));
  const element = node as ReactElement<{ children?: ReactNode }>;
  const here = element.type === type ? [element as ReactElement<Record<string, unknown>>] : [];
  return [...here, ...find(element.props?.children, type)];
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getMessages.mockResolvedValue({ items: [row], hasMore: false });
});

describe('the first gate: a three-way split by permission (T-12.4-56)', () => {
  it('keeps the shipped staff path for a holder of chat.support (positive control)', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapWith(STAFF));
    mocks.getConversation.mockResolvedValue(staffDetail);
    const tree = await Page(params(ID));
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    const [pane] = find(tree, ThreadPane);
    expect(pane?.props.viewer).toBe('staff');
    expect(pane?.props.initialConversationId).toBe(ID);
    // 12.5-15 (D-847): the team's recordings go through the voice reply action, bound by the page.
    expect(typeof pane?.props.onSendVoiceAction).toBe('function');
  });

  it('gives a user with neither permission the one not-found screen, with zero API calls', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapWith([]));
    await expect(Page(params(ID))).rejects.toThrow('NOT_FOUND');
    expect(mocks.getConversation).not.toHaveBeenCalled();
    expect(mocks.getMessages).not.toHaveBeenCalled();
  });

  it('gives a malformed id the not-found screen before any request, for both readers', async () => {
    for (const permissions of [MEMBER, STAFF]) {
      mocks.requireBootstrap.mockResolvedValue(bootstrapWith(permissions));
      await expect(Page(params('not-a-uuid'))).rejects.toThrow('NOT_FOUND');
    }
    expect(mocks.getConversation).not.toHaveBeenCalled();
  });
});

describe("the member's own case", () => {
  it('renders a CLOSED case read-only: the thread with the closed header, no redirect', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapWith(MEMBER));
    mocks.getConversation.mockResolvedValue(memberDetail('closed'));
    const tree = await Page(params(ID.toUpperCase()));
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.getConversation).toHaveBeenCalledWith(ID);
    expect(mocks.getMessages).toHaveBeenCalledWith(ID, null);

    const [pane] = find(tree, ThreadPane);
    expect(pane?.props.viewer ?? 'member').toBe('member');
    expect(pane?.props.initialConversationId).toBe(ID);
    expect(pane?.props.initialError).toBe(false);
    expect(pane?.props.hasAnyCase).toBe(true);
    // The member pane sends its own recordings: the page hands it no team action.
    expect(pane?.props.onSendVoiceAction).toBeUndefined();
    const header = pane?.props.initialCase as Record<string, unknown>;
    expect(header.viewer).toBe('member');
    expect(header.number).toBe(42);
    expect((header.state as { state: string }).state).toBe('closed');
    // The member's header carries no staff fact whatever the API sent.
    expect(Object.keys(header).sort()).toEqual(
      ['id', 'number', 'state', 'subject', 'subjectLine', 'title', 'viewer'].sort(),
    );
    expect(pane?.props.initialViews as unknown[]).toHaveLength(1);
  });

  it.each(['open', 'in_progress', 'resolved'] as const)(
    'redirects the ACTIVE case (%s) to /suporte, its one canonical address',
    async (state) => {
      mocks.requireBootstrap.mockResolvedValue(bootstrapWith(MEMBER));
      mocks.getConversation.mockResolvedValue(memberDetail(state));
      await expect(Page(params(ID))).rejects.toThrow('REDIRECT /suporte');
      expect(mocks.redirect).toHaveBeenCalledWith('/suporte');
      expect(mocks.getMessages).not.toHaveBeenCalled();
    },
  );

  it('redirects a conversation the API describes with no case to /suporte (never a thread with no bar)', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapWith(MEMBER));
    mocks.getConversation.mockResolvedValue(memberDetail());
    await expect(Page(params(ID))).rejects.toThrow('REDIRECT /suporte');
  });

  it("is not-found for an id that is not theirs, another tenant's or unknown (the API's bare 404)", async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapWith(MEMBER));
    mocks.getConversation.mockResolvedValue({ status: 'not-found' });
    await expect(Page(params(ID))).rejects.toThrow('NOT_FOUND');
    expect(mocks.getMessages).not.toHaveBeenCalled();
  });

  it('is not-found when the API answers a member with the staff shape (no oracle, no thread)', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapWith(MEMBER));
    mocks.getConversation.mockResolvedValue(staffDetail);
    await expect(Page(params(ID))).rejects.toThrow('NOT_FOUND');
  });

  it("shows the pane's load error, never not-found, when the read itself failed (M11)", async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapWith(MEMBER));
    mocks.getConversation.mockResolvedValue({ status: 'error' });
    const tree = await Page(params(ID));
    expect(mocks.notFound).not.toHaveBeenCalled();
    const [pane] = find(tree, ThreadPane);
    expect(pane?.props.initialError).toBe(true);
  });

  it('shows the load error when the messages could not be read', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapWith(MEMBER));
    mocks.getConversation.mockResolvedValue(memberDetail('closed'));
    mocks.getMessages.mockResolvedValue(null);
    const tree = await Page(params(ID));
    const [pane] = find(tree, ThreadPane);
    expect(pane?.props.initialError).toBe(true);
  });

  it('sends a staff user probing the member route logic nowhere new: a staff reader never takes the member path', async () => {
    mocks.requireBootstrap.mockResolvedValue(bootstrapWith([...STAFF, ...MEMBER]));
    mocks.getConversation.mockResolvedValue(memberDetail('closed'));
    // chat.support wins the split, and a member-shaped answer on the staff path is not-found (shipped).
    await expect(Page(params(ID))).rejects.toThrow('NOT_FOUND');
  });
});
