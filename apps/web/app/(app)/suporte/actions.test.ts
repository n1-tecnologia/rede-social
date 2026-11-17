import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import {
  editCaseAction,
  loadMoreInboxAction,
  loadMoreMyCasesAction,
  runCaseActionAction,
  sendSupportMessageAction,
} from './actions';

/**
 * 12.4-20 — the server actions of the support cases (D-845, CASE-14, CASE-16; T-12.4-53, T-12.4-87).
 *
 * A server action is a public endpoint, so the claims worth a test are: the input is validated by the
 * SAME strict Zod the API uses BEFORE any request; the argument objects sent to the API are exactly the
 * intent plus the expected state and owner and nothing else (T-12.4-53); every API refusal becomes ONE
 * closed result the screens map to the toasts of UI-D-827; the new case facts (`case` of a send, the
 * whole "Meus chamados" page) reach the caller finished.
 *
 * What is stubbed: `lib/env`, the transport (`apiFetch`), `getBootstrap` (the tenant zone),
 * `next/navigation` and the translator (the REAL pt-BR catalog). What is real: the actions, the
 * fetchers, the contracts and the view functions.
 */

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

vi.mock('@/lib/bootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bootstrap')>()),
  getBootstrap: vi.fn(async () => ({
    tenant: { timezone: 'America/Sao_Paulo' },
    permissions: ['chat.support'],
  })),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const { loadMessages } = await import('@/i18n/messages');
  const messages = loadMessages();
  return {
    getTranslations: vi.fn(async (namespace: string) =>
      createTranslator({ locale: 'pt-BR', messages, namespace } as never),
    ),
  };
});

const CONVERSATION = '0c000000-0000-4000-8000-0000000000c1';
const OWNER = '0a000000-0000-4000-8000-0000000000a1';
const ASSIGNEE = '0a000000-0000-4000-8000-0000000000a2';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refusal = (status: number, code: string, chat?: string): Response =>
  json(status, { error: { code, ...(chat ? { details: { chat } } : {}) } });

/** The JSON body of the n-th call to the API. */
function sentBody(n = 0): unknown {
  const init = vi.mocked(apiFetch).mock.calls[n]?.[1] as RequestInit | undefined;
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}
const calledPath = (n = 0) => vi.mocked(apiFetch).mock.calls[n]?.[0];
const calledMethod = (n = 0) => (vi.mocked(apiFetch).mock.calls[n]?.[1] as RequestInit)?.method;

const staffCase = (over: Record<string, unknown> = {}) => ({
  id: CONVERSATION,
  number: 42,
  state: 'in_progress',
  subject: 'Cobrança duplicada',
  subjectLabel: 'Cobrança duplicada',
  category: 'payment',
  openedAt: '2026-11-16T17:02:00.000Z',
  priority: 'normal',
  ownerUserId: OWNER,
  ownerName: 'Carla Souza',
  ownerIsViewer: true,
  resolvedAt: null,
  closedAt: null,
  actions: ['resolve', 'close', 'edit'],
  ...over,
});

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
});

describe('runCaseActionAction (D-845, T-12.4-53)', () => {
  it('a take sends the intent with the expected state and nothing else, and answers the fresh header', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { case: staffCase() }));
    const result = await runCaseActionAction(CONVERSATION, {
      action: 'take',
      expectedState: 'open',
    });

    expect(calledPath()).toBe(`/v1/chat/conversations/${CONVERSATION}/case/take`);
    expect(calledMethod()).toBe('POST');
    expect(sentBody()).toEqual({ expectedState: 'open' });
    expect(result).toMatchObject({
      ok: true,
      header: {
        viewer: 'staff',
        number: 42,
        title: 'Chamado #42',
        state: { state: 'in_progress', label: 'Em atendimento' },
        meta: 'Pagamento · Normal · Com você',
        actions: ['resolve', 'close', 'edit'],
      },
    });
  });

  it('a take-over sends the expected owner id and nothing more', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { case: staffCase() }));
    await runCaseActionAction(CONVERSATION, {
      action: 'take',
      expectedState: 'in_progress',
      expectedOwnerId: OWNER,
    });
    expect(sentBody()).toEqual({ expectedState: 'in_progress', expectedOwnerId: OWNER });
  });

  it.each(['resolve', 'close', 'reopen'] as const)(
    '%s goes to its own route with the expected state',
    async (action) => {
      vi.mocked(apiFetch).mockResolvedValue(json(200, { case: staffCase() }));
      await runCaseActionAction(CONVERSATION, { action, expectedState: 'resolved' });
      expect(calledPath()).toBe(`/v1/chat/conversations/${CONVERSATION}/case/${action}`);
      expect(sentBody()).toEqual({ expectedState: 'resolved' });
    },
  );

  it('an assign sends the assignee beside the expected state', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { case: staffCase() }));
    await runCaseActionAction(CONVERSATION, {
      action: 'assign',
      expectedState: 'open',
      assigneeUserId: ASSIGNEE,
    });
    expect(calledPath()).toBe(`/v1/chat/conversations/${CONVERSATION}/case/assign`);
    expect(sentBody()).toEqual({ expectedState: 'open', assigneeUserId: ASSIGNEE });
  });

  it.each([
    [409, 'CONFLICT', 'case_stale', 'stale'],
    [409, 'CONFLICT', 'case_closed', 'closed'],
    [409, 'CONFLICT', 'transition_not_allowed', 'not_allowed'],
    [409, 'CONFLICT', undefined, 'failed'],
    [400, 'VALIDATION_FAILED', 'assignee_invalid', 'invalid'],
    [400, 'VALIDATION_FAILED', undefined, 'invalid'],
    [403, 'FORBIDDEN', undefined, 'failed'],
    [404, 'NOT_FOUND', undefined, 'failed'],
    [500, 'INTERNAL', undefined, 'failed'],
  ] as const)('maps %s %s (%s) to %s', async (status, code, chat, expected) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiFetch).mockResolvedValue(refusal(status, code, chat));
    const result = await runCaseActionAction(CONVERSATION, {
      action: 'resolve',
      expectedState: 'open',
    });
    expect(result).toEqual({ ok: false, error: expected });
    spy.mockRestore();
  });

  it('a transport failure is failed and logs the shape only', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiFetch).mockRejectedValue(new Error(`boom ${CONVERSATION} private subject`));
    const result = await runCaseActionAction(CONVERSATION, {
      action: 'close',
      expectedState: 'open',
    });
    expect(result).toEqual({ ok: false, error: 'failed' });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(CONVERSATION);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('private');
    spy.mockRestore();
  });

  it('a 401 is a navigation to the sign-in, outside the try', async () => {
    vi.mocked(apiFetch).mockResolvedValue(refusal(401, 'UNAUTHENTICATED'));
    await expect(
      runCaseActionAction(CONVERSATION, { action: 'take', expectedState: 'open' }),
    ).rejects.toThrow('redirect:/entrar');
  });

  it.each([
    ['a path id that is not a uuid', 'nope', { action: 'take', expectedState: 'open' }],
    ['an unknown action', CONVERSATION, { action: 'delete', expectedState: 'open' }],
    [
      'an edit smuggled through the action',
      CONVERSATION,
      { action: 'edit', expectedState: 'open' },
    ],
    ['an unknown state', CONVERSATION, { action: 'take', expectedState: 'banana' }],
    [
      'a forged owner key',
      CONVERSATION,
      { action: 'take', expectedState: 'open', ownerUserId: OWNER },
    ],
    [
      'a forged state key',
      CONVERSATION,
      { action: 'take', expectedState: 'open', state: 'closed' },
    ],
    ['an assign with no assignee', CONVERSATION, { action: 'assign', expectedState: 'open' }],
    [
      'an assignee on a take',
      CONVERSATION,
      { action: 'take', expectedState: 'open', assigneeUserId: ASSIGNEE },
    ],
    ['a null input', CONVERSATION, null],
  ])('%s is invalid with zero API calls', async (_label, id, input) => {
    const result = await runCaseActionAction(id, input);
    expect(result).toEqual({ ok: false, error: 'invalid' });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('editCaseAction (D-812)', () => {
  it('sends only the changed fields and answers the fresh header', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { case: staffCase({ priority: 'high' }) }));
    const result = await editCaseAction(CONVERSATION, { expectedState: 'open', priority: 'high' });
    expect(calledPath()).toBe(`/v1/chat/conversations/${CONVERSATION}/case`);
    expect(calledMethod()).toBe('PATCH');
    expect(sentBody()).toEqual({ expectedState: 'open', priority: 'high' });
    expect(result).toMatchObject({ ok: true, header: { meta: 'Pagamento · Alta · Com você' } });
  });

  it('a blank subject is sent as null and a category alone as itself', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { case: staffCase() }));
    await editCaseAction(CONVERSATION, { expectedState: 'open', subject: '   ' });
    expect(sentBody(0)).toEqual({ expectedState: 'open', subject: null });
    await editCaseAction(CONVERSATION, { expectedState: 'open', category: 'events' });
    expect(sentBody(1)).toEqual({ expectedState: 'open', category: 'events' });
  });

  it('an edit with no field, a subject over 80 characters and a forged key are invalid with zero API calls', async () => {
    expect(await editCaseAction(CONVERSATION, { expectedState: 'open' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(
      await editCaseAction(CONVERSATION, { expectedState: 'open', subject: 'x'.repeat(81) }),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(
      await editCaseAction(CONVERSATION, {
        expectedState: 'open',
        priority: 'high',
        state: 'closed',
      }),
    ).toEqual({ ok: false, error: 'invalid' });
    expect(await editCaseAction('nope', { expectedState: 'open', priority: 'high' })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'CONFLICT', 'case_stale', 'stale'],
    [409, 'CONFLICT', 'case_closed', 'closed'],
    [400, 'VALIDATION_FAILED', 'subject_too_long', 'invalid'],
    [500, 'INTERNAL', undefined, 'failed'],
  ] as const)('maps %s %s (%s) to %s', async (status, code, chat, expected) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiFetch).mockResolvedValue(refusal(status, code, chat));
    const result = await editCaseAction(CONVERSATION, { expectedState: 'open', priority: 'low' });
    expect(result).toEqual({ ok: false, error: expected });
    spy.mockRestore();
  });
});

describe('sendSupportMessageAction (the opener, D-811)', () => {
  const sent = (caseFacts?: unknown) => ({
    conversationId: CONVERSATION,
    message: {
      id: '0b000000-0000-4000-8000-0000000000b1',
      seq: 1,
      side: 'member',
      body: 'Oi',
      createdAt: '2026-11-16T17:02:00.000Z',
      author: null,
      authorIsViewer: true,
    },
    ...(caseFacts ? { case: caseFacts } : {}),
  });

  it('carries the optional category and subject to the API and the API case object back, unchanged', async () => {
    const caseFacts = { id: CONVERSATION, number: 7, state: 'open', opened: true, reopened: false };
    vi.mocked(apiFetch).mockResolvedValue(json(200, sent(caseFacts)));
    const result = await sendSupportMessageAction('Oi', 'payment', '  Cobrança  ');

    expect(sentBody()).toEqual({ body: 'Oi', category: 'payment', subject: 'Cobrança' });
    expect(result).toMatchObject({ ok: true, conversationId: CONVERSATION, case: caseFacts });
    expect((result as { case: unknown }).case).toEqual(caseFacts);
  });

  it('a plain message still goes out as the shipped { body } and an answer without case is ok with no case', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, sent()));
    const result = await sendSupportMessageAction('Oi');
    expect(sentBody()).toEqual({ body: 'Oi' });
    expect(result).toMatchObject({ ok: true, conversationId: CONVERSATION });
    expect(result).not.toHaveProperty('case');
  });

  it('a blank subject is dropped and an unknown category, an over-long subject or an empty body never reach the API', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, sent()));
    await sendSupportMessageAction('Oi', 'other', '   ');
    expect(sentBody()).toEqual({ body: 'Oi', category: 'other' });

    vi.mocked(apiFetch).mockClear();
    const failed = { ok: false, error: 'composer.errors.failed' };
    expect(await sendSupportMessageAction('Oi', 'banana')).toEqual(failed);
    expect(await sendSupportMessageAction('Oi', 'other', 'x'.repeat(81))).toEqual(failed);
    expect(await sendSupportMessageAction('   ')).toEqual(failed);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('loadMoreMyCasesAction (checker W11)', () => {
  const card = (n: number, state: 'in_progress' | 'closed') => ({
    id: `0c000000-0000-4000-8000-00000000000${n}`,
    number: n,
    state,
    subject: 'Cobrança duplicada',
    subjectLabel: 'Cobrança duplicada',
    category: 'payment',
    openedAt: '2026-11-16T17:02:00.000Z',
    lastMessage: { preview: 'Oi', side: 'member' },
    lastMessageAt: '2026-11-16T17:30:00.000Z',
  });
  const page = (over: Record<string, unknown> = {}) => ({
    current: card(3, 'in_progress'),
    items: [card(2, 'closed')],
    total: 3,
    nextCursor: 'next',
    ...over,
  });

  it('a null cursor answers the WHOLE finished page: current and total are present', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, page()));
    const result = await loadMoreMyCasesAction(null);

    expect(calledPath()).toBe('/v1/chat/support/cases');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.current).toMatchObject({ number: 3, title: 'Chamado #3', preview: 'Você: Oi' });
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe('next');
  });

  it('a cursor answers the next items in the same shape, current and total included', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(200, page({ items: [card(1, 'closed')], nextCursor: null })),
    );
    const result = await loadMoreMyCasesAction('next');

    expect(calledPath()).toBe('/v1/chat/support/cases?cursor=next');
    expect(result).toMatchObject({ ok: true, total: 3, nextCursor: null });
    if (result.ok) {
      expect(result.current).not.toBeNull();
      expect(result.items.map((item) => item.number)).toEqual([1]);
    }
  });

  it('a cursor that is not a string or is over the ceiling never reaches the API', async () => {
    expect(await loadMoreMyCasesAction(7)).toEqual({ ok: false });
    expect(await loadMoreMyCasesAction('')).toEqual({ ok: false });
    expect(await loadMoreMyCasesAction('x'.repeat(513))).toEqual({ ok: false });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('an API failure is { ok: false }', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiFetch).mockResolvedValue(refusal(500, 'INTERNAL'));
    expect(await loadMoreMyCasesAction(null)).toEqual({ ok: false });
    spy.mockRestore();
  });
});

describe('loadMoreInboxAction(cursor, filters) (checker R-I8)', () => {
  const empty = { items: [], nextCursor: null };

  it('forwards the cursor and the filters in the API vocabulary', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, empty));
    const result = await loadMoreInboxAction('cur', {
      tab: 'resolved',
      owner: 'me',
      priority: 'high',
      awaiting: true,
    });
    expect(result).toEqual({ ok: true, items: [], nextCursor: null });
    const url = new URL(`http://x${calledPath()}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      cursor: 'cur',
      tab: 'resolved',
      owner: 'me',
      priority: 'high',
      awaiting: '1',
    });
  });

  it('drops unknown filter values before the forward and accepts a null cursor as page 1', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, empty));
    await loadMoreInboxAction(null, {
      tab: 'trash',
      owner: 'everyone',
      priority: 'urgent',
      awaiting: false,
    });
    expect(calledPath()).toBe('/v1/chat/inbox');
  });

  it('a missing or non-object filters argument is the unfiltered call, and a bad cursor is refused', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, empty));
    await loadMoreInboxAction('cur', undefined);
    expect(calledPath(0)).toBe('/v1/chat/inbox?cursor=cur');
    vi.mocked(apiFetch).mockClear();
    expect(await loadMoreInboxAction(5, {})).toEqual({ ok: false });
    expect(await loadMoreInboxAction('x'.repeat(513), {})).toEqual({ ok: false });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
