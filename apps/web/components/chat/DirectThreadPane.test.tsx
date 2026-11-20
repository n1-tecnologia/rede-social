// @vitest-environment happy-dom

import { join } from 'node:path';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { ChatMessageView, ComposerStateView, DirectOtherView } from '@/lib/chat-view';
import type { DirectThreadPaneProps } from './DirectThreadPane';

/**
 * 11-22 Task 1, the tracer (CHAT-06, D-720, UI-D-864; UC E2): a member opens a conversation from another member,
 * sends the first message and lands in the thread in place. The server action is mocked and answers the shape the
 * action types (`{ ok, conversationId, created, view }`); the catalog is the real pt-BR one; Realtime is a no-op.
 * The path under test: the empty thread, the first send, the swap in place (history replace, focus kept, NO
 * toast), the failed first send that keeps the draft, the catch-up through the shipped BFF read, and the shapes of
 * the edges (a departed account, text that is only text).
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn(), realtime: vi.fn() }));

vi.mock('@/app/(app)/conversas/actions', () => ({
  sendDirectMessage: (...args: unknown[]) => mocks.send(...args),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock('@rede-social/core/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/core/ui')>()),
  useRealtimeTopic: (...args: unknown[]) => mocks.realtime(...args),
}));

const { DirectThreadError, DirectThreadPane } = await import('./DirectThreadPane');

const TENANT_ID = '99999999-9999-4999-8999-999999999999';
const CONVERSATION = '0c000000-0000-4000-8000-0000000000c1';
const OTHER_ID = '0e000000-0000-4000-8000-0000000000e1';

const carla: DirectOtherView = {
  membershipId: OTHER_ID,
  name: 'Carla Nunes',
  avatar: null,
  removed: false,
  profileHref: `/membros/${OTHER_ID}`,
};

const OPEN: ComposerStateView = { state: 'open', strip: null };

const view = (over: Partial<ChatMessageView> & { id: string; seq: number }): ChatMessageView => ({
  side: 'own',
  authorKey: 'member',
  body: 'Oi',
  label: null,
  time: '10:00',
  dayKey: '2026-11-19',
  createdAtMs: Date.parse('2026-11-19T10:00:00Z'),
  ...over,
});

const sent = (body: string, seq = 1) => ({
  ok: true as const,
  conversationId: CONVERSATION,
  created: seq === 1,
  view: view({ id: `22222222-2222-4222-8222-22222222222${seq}`, seq, body }),
});

function renderPane(over: Partial<DirectThreadPaneProps> = {}) {
  const props: DirectThreadPaneProps = {
    tenantId: TENANT_ID,
    tenantName: 'Rede Demo',
    other: carla,
    initialConversationId: null,
    initialViews: [],
    initialHasOlder: false,
    initialKeys: { todayKey: '2026-11-19', yesterdayKey: '2026-11-18' },
    initialComposer: OPEN,
    canBlock: true,
    ...over,
  };
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <ToastProvider>
        <DirectThreadPane {...props} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

const field = () => screen.getByLabelText('Mensagem') as HTMLTextAreaElement;
const write = (text: string) => fireEvent.change(field(), { target: { value: text } });
const sendButton = () => screen.getByRole('button', { name: 'Enviar mensagem' });

beforeEach(() => {
  mocks.send.mockReset();
  mocks.refresh.mockReset();
  mocks.realtime.mockReset();
  window.history.replaceState(null, '', `/conversas/com/${OTHER_ID}`);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/messages?')) {
        return Response.json({
          items: [],
          hasMore: false,
          todayKey: '2026-11-19',
          yesterdayKey: '2026-11-18',
        });
      }
      return new Response(null, { status: 204 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the lazy start (D-720, UI-D-864) — tracer', () => {
  it('draws the empty thread and an enabled composer, and joins no topic yet', () => {
    const { container } = renderPane();
    expect(screen.getByRole('heading', { name: 'Escreva para Carla Nunes' })).toBeTruthy();
    expect(
      screen.getByText('A conversa aparece na sua lista depois da primeira mensagem.'),
    ).toBeTruthy();
    expect(field().placeholder).toBe('Escreva uma mensagem');
    expect(field().disabled).toBe(false);
    expect(container.querySelector('[data-direct-empty]')).not.toBeNull();
    // No conversation, no topic: the realtime hook is handed a null topic.
    expect(mocks.realtime.mock.calls[0]?.[0]).toBeNull();
  });

  it('the first send creates the conversation in place: bubble, history replace, focus kept, no toast', async () => {
    mocks.send.mockResolvedValue(sent('Oi'));
    const { container } = renderPane();
    field().focus();
    write('Oi');
    fireEvent.click(sendButton());

    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send).toHaveBeenCalledWith(OTHER_ID, 'Oi');
    await waitFor(() => expect(container.querySelector('[data-direct-empty]')).toBeNull());

    // The thread: one own bubble, the log, and the address became the conversation's.
    expect(screen.getByRole('log', { name: 'Mensagens' })).toBeTruthy();
    const bubbles = container.querySelectorAll('[data-chat-bubble="own"]');
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]?.textContent).toContain('Oi');
    await waitFor(() => expect(window.location.pathname).toBe(`/conversas/${CONVERSATION}`));
    // Focus stays in the composer; NO toast and NO confirmation row (unlike the support case).
    expect(document.activeElement).toBe(field());
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('[data-case-opened]')).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
    // The pane now listens on the conversation's topic.
    const lastTopic = mocks.realtime.mock.calls.at(-1)?.[0];
    expect(lastTopic).toBe(`tenant:${TENANT_ID}:conv:${CONVERSATION}`);
  });

  it('shows the optimistic bubble while the first send is in flight, then the server view', async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.send.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = renderPane();
    write('Já vou');
    fireEvent.click(sendButton());
    await waitFor(() => expect(container.querySelector('[data-pending]')).not.toBeNull());
    expect(screen.getByText('Enviando…')).toBeTruthy();
    await act(async () => {
      resolve(sent('Já vou'));
    });
    await waitFor(() => expect(container.querySelector('[data-pending]')).toBeNull());
    expect(container.querySelectorAll('[data-chat-bubble="own"]')).toHaveLength(1);
  });

  it('a failed first send keeps the draft with the shipped inline error, and leaves the address alone', async () => {
    mocks.send.mockResolvedValue({ ok: false, error: 'failed' });
    renderPane();
    write('Preciso conversar');
    fireEvent.click(sendButton());
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(field().value).toBe('Preciso conversar'));
    expect(
      screen.getByText('Não foi possível enviar. Sua mensagem continua no campo. Tente de novo.'),
    ).toBeTruthy();
    expect(window.location.pathname).toBe(`/conversas/com/${OTHER_ID}`);
    expect(screen.getByRole('heading', { name: 'Escreva para Carla Nunes' })).toBeTruthy();
  });

  it('a send answered "not_found" (the person is gone) re-renders the page into the not-found screen', async () => {
    mocks.send.mockResolvedValue({ ok: false, error: 'not_found' });
    renderPane();
    write('Oi');
    fireEvent.click(sendButton());
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(field().value).toBe('Oi');
  });
});

describe('the thread (UI-D-864, D-240)', () => {
  const history = [
    view({
      id: '33333333-3333-4333-8333-333333333331',
      seq: 1,
      side: 'other',
      authorKey: 'member:other',
      body: 'Oi, tudo bem?',
    }),
    view({ id: '33333333-3333-4333-8333-333333333332', seq: 2, side: 'own', body: 'Tudo!' }),
  ];

  it('draws the log with day separators, the other left and own right, and NO sender label', () => {
    const { container } = renderPane({
      initialConversationId: CONVERSATION,
      initialViews: history,
    });
    expect(screen.getByRole('log', { name: 'Mensagens' })).toBeTruthy();
    expect(screen.getByText('Hoje')).toBeTruthy();
    expect(container.querySelectorAll('[data-chat-bubble="other"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-chat-bubble="own"]')).toHaveLength(1);
    expect(container.querySelector('[data-chat-sender]')).toBeNull();
    // No case bar, opener or "Meus chamados" anywhere in a direct conversation (D-800).
    expect(container.querySelector('[data-case-bar]')).toBeNull();
    expect(screen.queryByText('Meus chamados')).toBeNull();
    expect(container.querySelector('[data-direct-empty]')).toBeNull();
  });

  it('joins the conversation topic, and a signal above the cursor catches up through the BFF read', async () => {
    renderPane({ initialConversationId: CONVERSATION, initialViews: history });
    const [topic, events, onSignal] = mocks.realtime.mock.calls.at(-1) as [
      string,
      string[],
      (event: string, payload: unknown) => void,
    ];
    expect(topic).toBe(`tenant:${TENANT_ID}:conv:${CONVERSATION}`);
    expect(events).toEqual(['chat.message']);

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/messages?')) {
        return Response.json({
          items: [
            view({
              id: '33333333-3333-4333-8333-333333333333',
              seq: 3,
              side: 'other',
              authorKey: 'member:other',
              body: 'Combinado!',
            }),
          ],
          hasMore: false,
          todayKey: '2026-11-19',
          yesterdayKey: '2026-11-18',
        });
      }
      return new Response(null, { status: 204 });
    });

    // A replayed signal (seq 2, at the cursor) fetches nothing.
    const before = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/messages?')).length;
    act(() => onSignal('chat.message', { seq: 2 }));
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/messages?')).length).toBe(
      before,
    );

    act(() => onSignal('chat.message', { seq: 3 }));
    await waitFor(() => expect(screen.getByText('Combinado!')).toBeTruthy());
    const pages = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('afterSeq'));
    expect(pages.at(-1)).toBe(`/api/chat/conversations/${CONVERSATION}/messages?afterSeq=2`);
  });

  it('marks the thread read with keepalive after mount, once per seq', async () => {
    renderPane({ initialConversationId: CONVERSATION, initialViews: history });
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some((c) => String(c[0]).endsWith(`/${CONVERSATION}/read`)),
      ).toBe(true),
    );
    const call = vi.mocked(fetch).mock.calls.find((c) => String(c[0]).endsWith('/read'));
    const init = (call?.[1] ?? {}) as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ seq: 2 });
    expect(init.keepalive).toBe(true);
  });

  it('a conversation with no message of its own draws the empty thread and an enabled composer', () => {
    const { container } = renderPane({ initialConversationId: CONVERSATION, initialViews: [] });
    expect(container.querySelector('[data-direct-empty]')).not.toBeNull();
    expect(field().disabled).toBe(false);
  });

  it('draws text as text: markup, a long unbroken string and RTL stay React text in the bubble', () => {
    const hostile = view({
      id: '33333333-3333-4333-8333-333333333334',
      seq: 3,
      side: 'other',
      authorKey: 'member:other',
      body: `<img src=x onerror=alert(1)> ${'a'.repeat(600)} שלום 👨‍👩‍👧‍👦 é`,
    });
    const { container } = renderPane({
      initialConversationId: CONVERSATION,
      initialViews: [...history, hostile],
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    const bubble = container.querySelectorAll('[data-chat-bubble="other"]')[1];
    expect(bubble?.querySelector('div')?.className).toContain('[overflow-wrap:anywhere]');
  });

  it('a departed account keeps the thread readable and carries no name of a person', () => {
    const gone: DirectOtherView = {
      membershipId: null,
      name: 'Membro removido',
      avatar: null,
      removed: true,
      profileHref: null,
    };
    renderPane({
      other: gone,
      initialConversationId: CONVERSATION,
      initialViews: history,
      initialComposer: { state: 'removed', strip: null },
    });
    expect(screen.getByText('Oi, tudo bem?')).toBeTruthy();
    expect(screen.queryByText('Carla Nunes')).toBeNull();
  });
});

describe('the error card (UI-D-878)', () => {
  it('names the failure with the shipped words and retries by re-rendering the page', () => {
    render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <DirectThreadError />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Não foi possível carregar a conversa.')).toBeTruthy();
    expect(screen.getByText('Verifique sua conexão e tente de novo.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
