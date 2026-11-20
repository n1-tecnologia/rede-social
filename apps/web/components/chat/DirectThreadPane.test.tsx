// @vitest-environment happy-dom

import { join } from 'node:path';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type {
  ChatMessageView,
  ComposerStateView,
  ComposerStripView,
  DirectOtherView,
} from '@/lib/chat-view';
import type { DirectThreadPaneProps } from './DirectThreadPane';

/**
 * 11-22 Task 1, the tracer (CHAT-06, D-720, UI-D-864; UC E2): a member opens a conversation from another member,
 * sends the first message and lands in the thread in place. The server action is mocked and answers the shape the
 * action types (`{ ok, conversationId, created, view }`); the catalog is the real pt-BR one; Realtime is a no-op.
 * The path under test: the empty thread, the first send, the swap in place (history replace, focus kept, NO
 * toast), the failed first send that keeps the draft, the catch-up through the shipped BFF read, and the shapes of
 * the edges (a departed account, text that is only text).
 */

// The toast animates in happy-dom, which cancels it on cleanup: skip it, as the report sheet's tests do.
MotionGlobalConfig.skipAnimations = true;

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  unblock: vi.fn(),
  report: vi.fn(),
  block: vi.fn(),
  refresh: vi.fn(),
  realtime: vi.fn(),
}));

vi.mock('@/app/(app)/conversas/actions', () => ({
  sendDirectMessage: (...args: unknown[]) => mocks.send(...args),
}));
vi.mock('@/components/feed/safety-actions', () => ({
  unblockMember: (...args: unknown[]) => mocks.unblock(...args),
  reportContent: (...args: unknown[]) => mocks.report(...args),
  blockMember: (...args: unknown[]) => mocks.block(...args),
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

/** The shipped toast surface (`role="status"`, fixed): any toast on screen. */
const toasts = () => [...document.querySelectorAll('[role="status"].fixed')];

const field = () => screen.getByLabelText('Mensagem') as HTMLTextAreaElement;
const write = (text: string) => fireEvent.change(field(), { target: { value: text } });
const sendButton = () => screen.getByRole('button', { name: 'Enviar mensagem' });

beforeEach(() => {
  mocks.send.mockReset();
  mocks.unblock.mockReset();
  mocks.report.mockReset();
  mocks.block.mockReset();
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
    expect(toasts()).toHaveLength(0);
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

/* ── Task 2: the composer slot's five states (UI-D-865, D-722, D-723) ───────────────────────────────── */

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

const CLOSED_TEXT = 'Esta conversa não aceita novas mensagens.';
const REMOVED_TEXT = 'Este membro não está mais na comunidade. A conversa fica só para leitura.';

const strip = (kind: 'closed' | 'blocker' | 'removed'): ComposerStripView => ({
  kind,
  glyph: kind === 'blocker' ? 'Ban' : 'Lock',
  role: 'status',
  text:
    kind === 'closed'
      ? CLOSED_TEXT
      : kind === 'removed'
        ? REMOVED_TEXT
        : 'Você bloqueou Carla Nunes',
  label:
    kind === 'closed'
      ? CLOSED_TEXT
      : kind === 'removed'
        ? REMOVED_TEXT
        : 'Você bloqueou Carla Nunes',
  unblock:
    kind === 'blocker'
      ? {
          label: 'Desbloquear',
          pendingLabel: 'Desbloqueando…',
          toast: 'Carla Nunes foi desbloqueada.',
        }
      : null,
});

const composerOf = (kind: 'open' | 'closed' | 'blocker' | 'removed'): ComposerStateView =>
  kind === 'open' ? OPEN : { state: kind, strip: strip(kind) };

/** What `GET /api/chat/direct/{id}` answers: the finished view the BFF returns. */
const detailAnswer = (kind: 'open' | 'closed' | 'blocker' | 'removed', canBlock = true) => ({
  conversationId: CONVERSATION,
  other: carla,
  state: kind,
  strip: kind === 'open' ? null : strip(kind),
  canBlock,
  lastSeq: 2,
  lastReadSeq: 2,
});

/** Stubs `fetch` so the detail read answers `answer` (a status or a body), the page reads as before. */
function stubDetail(answer: () => Response) {
  vi.mocked(fetch).mockImplementation(async (url) => {
    const target = String(url);
    if (target.includes('/api/chat/direct/')) return answer();
    if (target.includes('/messages?')) {
      return Response.json({
        items: [],
        hasMore: false,
        todayKey: '2026-11-19',
        yesterdayKey: '2026-11-18',
      });
    }
    return new Response(null, { status: 204 });
  });
}

const paneProps = (kind: 'open' | 'closed' | 'blocker' | 'removed') => ({
  initialConversationId: CONVERSATION,
  initialViews: history,
  initialComposer: composerOf(kind),
});

const lastRealtime = () =>
  mocks.realtime.mock.calls.at(-1) as [
    string,
    string[],
    (event: string, payload: unknown) => void,
    { onSubscribed: () => void },
  ];

describe('the composer slot (UI-D-865)', () => {
  it('(1) open: the shipped composer with the placeholder, no strip', () => {
    const { container } = renderPane(paneProps('open'));
    expect(field().placeholder).toBe('Escreva uma mensagem');
    expect(container.querySelector('[data-composer-strip]')).toBeNull();
  });

  it('(2) closed: the composer AND its field are gone, the strip is the one sentence, nothing else', () => {
    const { container } = renderPane(paneProps('closed'));
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enviar mensagem' })).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    const strip = container.querySelector('[data-composer-strip="closed"]') as HTMLElement;
    expect(strip.getAttribute('role')).toBe('status');
    expect(strip.textContent).toBe(CLOSED_TEXT);
    expect(strip.querySelector('button')).toBeNull();
    // The history stays readable above it.
    expect(screen.getByText('Oi, tudo bem?')).toBeTruthy();
  });

  it('(3) blocker: the strip names who, Desbloquear is one tap, and the history stays readable', () => {
    renderPane(paneProps('blocker'));
    expect(screen.getByText('Você bloqueou Carla Nunes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Desbloquear' })).toBeTruthy();
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
    expect(screen.getByText('Tudo!')).toBeTruthy();
  });

  it('(4) removed: the read-only sentence and no button', () => {
    const { container } = renderPane({ ...paneProps('removed') });
    expect(container.querySelector('[data-composer-strip="removed"]')?.textContent).toBe(
      REMOVED_TEXT,
    );
    expect(screen.queryByRole('button', { name: 'Desbloquear' })).toBeNull();
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
  });
});

describe('the unblock (UI-D-865 state 3)', () => {
  it('one tap: Desbloqueando…, then the composer returns, the field has focus and the toast names the person', async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.unblock.mockReturnValue(new Promise((r) => (resolve = r)));
    stubDetail(() => Response.json(detailAnswer('open')));
    renderPane(paneProps('blocker'));

    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    expect(mocks.unblock).toHaveBeenCalledWith(OTHER_ID);
    expect(screen.getByRole('button', { name: 'Desbloqueando…' }).hasAttribute('disabled')).toBe(
      true,
    );
    // No confirmation step of any kind.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await act(async () => {
      resolve({ ok: true, code: 'ok', changed: true });
    });
    await waitFor(() => expect(field()).toBeTruthy());
    expect(screen.queryByText('Você bloqueou Carla Nunes')).toBeNull();
    expect(document.activeElement).toBe(field());
    expect(screen.getByText('Carla Nunes foi desbloqueada.')).toBeTruthy();
    // Exactly one unblock was sent, never a second.
    expect(mocks.unblock).toHaveBeenCalledTimes(1);
  });

  it('when the other side also blocked, the strip swaps for the closed one and no field is focused', async () => {
    mocks.unblock.mockResolvedValue({ ok: true, code: 'ok', changed: true });
    stubDetail(() => Response.json(detailAnswer('closed', true)));
    const { container } = renderPane(paneProps('blocker'));
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    await waitFor(() =>
      expect(container.querySelector('[data-composer-strip="closed"]')).not.toBeNull(),
    );
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
    expect(screen.getByText('Carla Nunes foi desbloqueada.')).toBeTruthy();
  });

  it('a failed unblock keeps the strip, offers the button again and fires the generic error toast', async () => {
    mocks.unblock.mockResolvedValue({ ok: false, code: 'failed', changed: false });
    renderPane(paneProps('blocker'));
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    await waitFor(() => expect(screen.getByText('Algo deu errado. Tente novamente.')).toBeTruthy());
    expect(screen.getByText('Você bloqueou Carla Nunes')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Desbloquear' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
  });

  it('a lost network on the unblock is the same toast, not an exception', async () => {
    mocks.unblock.mockRejectedValue(new Error('offline'));
    renderPane(paneProps('blocker'));
    fireEvent.click(screen.getByRole('button', { name: 'Desbloquear' }));
    await waitFor(() => expect(screen.getByText('Algo deu errado. Tente novamente.')).toBeTruthy());
  });
});

describe('a live change (UI-D-865: no toast, no announcement, no scroll, no focus)', () => {
  it('a conversation signal re-reads the state and swaps the strip silently', async () => {
    stubDetail(() => Response.json(detailAnswer('closed')));
    const { container } = renderPane(paneProps('open'));
    const scroller = container.querySelector('[data-chat-scroller]') as HTMLElement;
    scroller.scrollTop = 40;
    const heading = screen.getByText('Oi, tudo bem?');
    heading.setAttribute('tabindex', '-1');
    heading.focus();

    act(() => lastRealtime()[2]('chat.message', { seq: 2 }));
    await waitFor(() =>
      expect(container.querySelector('[data-composer-strip="closed"]')).not.toBeNull(),
    );
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
    // No toast of any kind, the scroll and the focus did not move.
    expect(screen.getAllByText(CLOSED_TEXT)).toHaveLength(1);
    expect(toasts()).toHaveLength(0);
    expect(container.querySelectorAll('[data-composer-strip]')).toHaveLength(1);
    expect(scroller.scrollTop).toBe(40);
    expect(document.activeElement).toBe(heading);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('a (re)subscribe and a refocus re-read it too; a blocker strip back to open swaps without a toast', async () => {
    stubDetail(() => Response.json(detailAnswer('open')));
    const { container } = renderPane(paneProps('blocker'));
    const reads = () =>
      vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).includes('/api/chat/direct/')).length;
    expect(reads()).toBe(0);

    act(() => lastRealtime()[3].onSubscribed());
    await waitFor(() => expect(reads()).toBe(1));
    await waitFor(() => expect(field()).toBeTruthy());
    expect(container.querySelector('[data-composer-strip]')).toBeNull();
    expect(screen.queryByText('Carla Nunes foi desbloqueada.')).toBeNull();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(reads()).toBe(2));
    // A live change never moves the focus into the field.
    expect(document.activeElement).not.toBe(field());
  });

  it('a read that answers 404 (the conversation is gone for this reader) re-renders into the not-found screen', async () => {
    stubDetail(() => new Response(null, { status: 404 }));
    renderPane(paneProps('open'));
    act(() => lastRealtime()[2]('chat.message', { seq: 9 }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it('a failed or malformed read keeps what is shown; a strip that does not match its state is refused', async () => {
    renderPane(paneProps('open'));
    for (const answer of [
      () => new Response(null, { status: 500 }),
      () => Response.json({ state: 'closed', strip: null, canBlock: true }),
      () =>
        Response.json({
          ...detailAnswer('blocker'),
          strip: { ...strip('blocker'), unblock: null },
        }),
      () => Response.json({ state: 'invented', strip: null, canBlock: true }),
      () => Response.json({ ...detailAnswer('closed'), canBlock: 'yes' }),
    ]) {
      stubDetail(answer);
      act(() => lastRealtime()[2]('chat.message', { seq: 2 }));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(field()).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe('a refused send (D-722: silent and neutral)', () => {
  it('"closed" mid-session: the optimistic bubble is removed, the neutral toast shows and the strip appears', async () => {
    stubDetail(() => Response.json(detailAnswer('closed')));
    mocks.send.mockResolvedValue({ ok: false, error: 'closed' });
    const { container } = renderPane(paneProps('open'));
    write('Ainda aí?');
    fireEvent.click(sendButton());

    await waitFor(() =>
      expect(container.querySelector('[data-composer-strip="closed"]')).not.toBeNull(),
    );
    // The bubble is gone: only the two shipped bubbles of the history remain.
    expect(container.querySelectorAll('[data-chat-bubble="own"]')).toHaveLength(1);
    expect(container.querySelector('[data-pending]')).toBeNull();
    expect(screen.getAllByText(CLOSED_TEXT).length).toBeGreaterThanOrEqual(2);
    // Nothing on screen names a block or the person who could have blocked.
    const everything = container.ownerDocument.body.innerHTML.toLowerCase();
    expect(everything).not.toContain('bloqueou você');
    expect(everything).not.toContain('foi bloqueado');
  });

  it('"closed" on the FIRST send (the person blocked the sender): the strip replaces the empty thread\'s composer', async () => {
    mocks.send.mockResolvedValue({ ok: false, error: 'closed' });
    const { container } = renderPane({ initialConversationId: null, initialViews: [] });
    write('Oi');
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect(container.querySelector('[data-composer-strip="closed"]')).not.toBeNull(),
    );
    expect(window.location.pathname).toBe(`/conversas/com/${OTHER_ID}`);
    expect(screen.getByRole('heading', { name: 'Escreva para Carla Nunes' })).toBeTruthy();
  });

  it('"not_found" mid-session: the generic toast and a page refresh, never a reason', async () => {
    mocks.send.mockResolvedValue({ ok: false, error: 'not_found' });
    renderPane(paneProps('open'));
    write('Oi');
    fireEvent.click(sendButton());
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Algo deu errado. Tente novamente.')).toBeTruthy();
  });

  it('any other refusal keeps the draft with the shipped inline error and no toast', async () => {
    mocks.send.mockResolvedValue({ ok: false, error: 'rate_limited' });
    renderPane(paneProps('open'));
    write('Oi de novo');
    fireEvent.click(sendButton());
    await waitFor(() => expect(field().value).toBe('Oi de novo'));
    expect(screen.queryByText('Algo deu errado. Tente novamente.')).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

/* ── Task 3: the message menu (D-733, UI-D-870) ─────────────────────────────────────────────────────── */

describe('the message menu', () => {
  const triggers = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-chat-message] [data-message-menu]')] as HTMLElement[];

  it('draws a trigger beside each message of the OTHER member only, named "Mais ações da mensagem"', () => {
    const { container } = renderPane(paneProps('open'));
    const found = triggers(container);
    expect(found).toHaveLength(1);
    expect(found[0]?.getAttribute('aria-label')).toBe('Mais ações da mensagem');
    // It sits in the gutter row of the incoming bubble, never beside the viewer's own.
    expect(
      found[0]?.closest('[data-chat-gutter]')?.querySelector('[data-chat-bubble="other"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-chat-bubble="own"]')?.closest('[data-chat-gutter]'),
    ).toBeNull();
  });

  it('draws no trigger on an optimistic bubble or in the empty thread', () => {
    const { container } = renderPane({ initialConversationId: null, initialViews: [] });
    expect(triggers(container)).toHaveLength(0);
  });

  it('opens "Opções da mensagem" with Denunciar and "Bloquear Carla Nunes", and no other row', async () => {
    const { container } = renderPane(paneProps('open'));
    fireEvent.click(triggers(container)[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Opções da mensagem' });
    expect([...dialog.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Denunciar mensagem',
      'Bloquear Carla Nunes',
    ]);
  });

  it('the blocked member (closed strip) and the blocker (blocker strip) can still report; the blocker is not offered Bloquear', async () => {
    const closed = renderPane({ ...paneProps('closed'), canBlock: true });
    fireEvent.click(triggers(closed.container)[0] as HTMLElement);
    let dialog = await screen.findByRole('dialog', { name: 'Opções da mensagem' });
    expect(screen.getByRole('button', { name: 'Denunciar mensagem' })).toBeTruthy();
    expect(dialog).toBeTruthy();
    cleanup();

    const blocker = renderPane({ ...paneProps('blocker'), canBlock: false });
    fireEvent.click(triggers(blocker.container)[0] as HTMLElement);
    dialog = await screen.findByRole('dialog', { name: 'Opções da mensagem' });
    expect([...dialog.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Denunciar mensagem',
    ]);
  });

  it('a removed account (or canBlock false from the server, as for staff) drops Bloquear and keeps Denunciar', async () => {
    const gone: DirectOtherView = {
      membershipId: null,
      name: 'Membro removido',
      avatar: null,
      removed: true,
      profileHref: null,
    };
    const { container } = renderPane({ ...paneProps('removed'), other: gone, canBlock: true });
    fireEvent.click(triggers(container)[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Opções da mensagem' });
    expect([...dialog.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Denunciar mensagem',
    ]);
  });

  it('Denunciar opens the shared report sheet for a direct_message and sends the message id once', async () => {
    mocks.report.mockResolvedValue({ ok: true, code: 'ok' });
    const { container } = renderPane(paneProps('open'));
    fireEvent.click(triggers(container)[0] as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Denunciar mensagem' }));
    await screen.findByRole('dialog', { name: 'Denunciar mensagem' });
    // The privacy line of a message names who will NOT see it; the five reasons are the shared ones.
    fireEvent.click(screen.getByRole('radio', { name: /spam/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }));
    await waitFor(() => expect(mocks.report).toHaveBeenCalledTimes(1));
    expect(mocks.report).toHaveBeenCalledWith({
      subjectType: 'direct_message',
      subjectId: '33333333-3333-4333-8333-333333333331',
      reason: 'spam',
    });
  });

  it("Bloquear opens the shared dialog with the other member's MEMBERSHIP id; a block swaps the composer for the strip", async () => {
    mocks.block.mockResolvedValue({ ok: true, code: 'ok', changed: true });
    stubDetail(() => Response.json(detailAnswer('blocker', false)));
    const { container } = renderPane(paneProps('open'));
    fireEvent.click(triggers(container)[0] as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Bloquear Carla Nunes' }));
    const confirm = await screen.findByRole('button', { name: 'Bloquear' });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.block).toHaveBeenCalledWith(OTHER_ID));
    await waitFor(() =>
      expect(container.querySelector('[data-composer-strip="blocker"]')).not.toBeNull(),
    );
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
  });
});
