// @vitest-environment happy-dom

import { join } from 'node:path';
import { convTopic, REALTIME_EVENTS } from '@rede-social/contracts/realtime';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { ChatMessageView, MemberCaseHeaderView } from '@/lib/chat-view';
import type { ThreadPaneProps } from './ThreadPane';

/**
 * 12.4-12 Task 2 (UI-D-820, UI-D-830, UI-D-833, D-807, D-808; UC M05 to M09; T-12.4-57, T-12.4-59): the
 * member's thread follows the case live. The API is the BFF handler of plan 20 (`fetch` mocked), Realtime
 * is a recorder whose handler the test fires by hand, the catalog is the real pt-BR one.
 *
 * The rules pinned here: the case header is re-read on every `chat.message` and `chat.case` signal, on
 * every (re)subscribe and on a refocus, coalesced (one in flight, one queued, the T-07-71 rule); the
 * state shown is ONLY what the server answered; a reply that reopens toasts once; a live close swaps the
 * composer for the strip with no toast and no focus move; a blocked or removed notice wins over the
 * closed strip (A-UI-4); the staff pane never draws the member's bar (the team's bar is `ThreadPane.staff.test.tsx`).
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn(), realtime: vi.fn() }));

vi.mock('./actions', () => ({
  sendSupportMessageAction: (...args: unknown[]) => mocks.send(...args),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock('@rede-social/core/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/core/ui')>()),
  useRealtimeTopic: (...args: unknown[]) => mocks.realtime(...args),
}));

const { ThreadPane } = await import('./ThreadPane');

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '99999999-9999-4999-8999-999999999999';
const HEADER_URL = `/api/chat/conversations/${CASE_ID}`;

type CaseState = 'open' | 'in_progress' | 'resolved' | 'closed';

const STATE_VIEW: Record<CaseState, MemberCaseHeaderView['state']> = {
  open: { state: 'open', label: 'Aberto', tone: 'warning', glyph: 'CircleDot' },
  in_progress: {
    state: 'in_progress',
    label: 'Em atendimento',
    tone: 'brand',
    glyph: 'UserCheck',
  },
  resolved: { state: 'resolved', label: 'Resolvido', tone: 'success', glyph: 'CircleCheck' },
  closed: { state: 'closed', label: 'Fechado', tone: 'neutral', glyph: 'Lock' },
};

const header = (state: CaseState): MemberCaseHeaderView => ({
  viewer: 'member',
  id: CASE_ID,
  number: 42,
  title: 'Chamado #42',
  state: STATE_VIEW[state],
  subject: 'Meu ingresso',
  subjectLine: '#42 · Meu ingresso',
});

const answer = (state: CaseState) => ({ viewer: 'member', header: header(state) });

const ownView = (seq: number, body: string, id: string): ChatMessageView => ({
  id,
  seq,
  side: 'own',
  authorKey: 'member',
  body,
  label: null,
  time: '10:00',
  dayKey: '2026-11-17',
  createdAtMs: Date.parse('2026-11-17T10:00:00Z'),
});

const fetchMock = vi.fn();
let headerAnswer: () => Promise<Response> | Response = () => Response.json(answer('open'));

const headerCalls = () => fetchMock.mock.calls.filter(([url]) => url === HEADER_URL).length;

function renderPane(over: Partial<ThreadPaneProps> = {}) {
  const props: ThreadPaneProps = {
    tenantId: TENANT_ID,
    tenantName: 'Rede Demo',
    logoUrl: null,
    initialConversationId: CASE_ID,
    initialViews: [ownView(1, 'Oi, preciso de ajuda', '22222222-2222-4222-8222-222222222222')],
    initialHasOlder: false,
    initialKeys: { todayKey: '2026-11-17', yesterdayKey: '2026-11-16' },
    initialError: false,
    initialCase: header('open'),
    hasAnyCase: true,
    ...over,
  };
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <ToastProvider>
        <ThreadPane {...props} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

/** What the pane last handed to `useRealtimeTopic`. */
function realtime() {
  const call = mocks.realtime.mock.calls.at(-1) as unknown[];
  return {
    topic: call[0] as string | null,
    events: call[1] as string[],
    onSignal: call[2] as (event: string, payload: unknown) => void,
    options: call[3] as { onSubscribed?: () => void },
  };
}

const fire = (event: string, payload: unknown = { id: CASE_ID, conversationId: CASE_ID }) =>
  act(async () => {
    realtime().onSignal(event, payload);
  });

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  mocks.send.mockReset();
  mocks.refresh.mockReset();
  mocks.realtime.mockReset();
  fetchMock.mockReset();
  headerAnswer = () => Response.json(answer('open'));
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('/messages?')) {
      return Response.json({
        items: [],
        hasMore: false,
        todayKey: '2026-11-17',
        yesterdayKey: '2026-11-16',
      });
    }
    if (String(url).endsWith('/read')) return new Response(null, { status: 204 });
    return headerAnswer();
  });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the case follows the server (UI-D-830)', () => {
  it('joins the conversation topic for both signals', () => {
    renderPane();
    const { topic, events } = realtime();
    expect(topic).toBe(convTopic(TENANT_ID, CASE_ID));
    expect(events).toEqual(
      expect.arrayContaining([REALTIME_EVENTS.chatMessage, REALTIME_EVENTS.chatCase]),
    );
  });

  it('re-reads the header on a chat.case signal and draws what the server says', async () => {
    renderPane();
    expect(screen.getByText('Aberto')).toBeTruthy();
    headerAnswer = () => Response.json(answer('in_progress'));
    await fire(REALTIME_EVENTS.chatCase);
    await waitFor(() => expect(screen.getByText('Em atendimento')).toBeTruthy());
    expect(headerCalls()).toBe(1);
  });

  it('re-reads the header on a chat.message signal even when its seq is a replay', async () => {
    renderPane();
    headerAnswer = () => Response.json(answer('resolved'));
    await fire(REALTIME_EVENTS.chatMessage, { seq: 1 });
    await waitFor(() => expect(screen.getByText('Resolvido')).toBeTruthy());
    expect(headerCalls()).toBe(1);
  });

  it('coalesces: signals during a read produce exactly one more read (one in flight, one queued)', async () => {
    renderPane();
    const gates: Array<(response: Response) => void> = [];
    headerAnswer = () => new Promise<Response>((resolve) => gates.push(resolve));

    await fire(REALTIME_EVENTS.chatCase);
    await waitFor(() => expect(headerCalls()).toBe(1));
    await fire(REALTIME_EVENTS.chatCase);
    await fire(REALTIME_EVENTS.chatMessage, { seq: 1 });
    await fire(REALTIME_EVENTS.chatCase);
    expect(headerCalls()).toBe(1);

    await act(async () => {
      gates[0]?.(Response.json(answer('in_progress')));
    });
    await waitFor(() => expect(headerCalls()).toBe(2));
    await act(async () => {
      gates[1]?.(Response.json(answer('in_progress')));
    });
    await waitFor(() => expect(screen.getByText('Em atendimento')).toBeTruthy());
    expect(headerCalls()).toBe(2);
  });

  it('re-reads on every (re)subscribe', async () => {
    renderPane();
    await act(async () => {
      realtime().options.onSubscribed?.();
    });
    await waitFor(() => expect(headerCalls()).toBe(1));
    await act(async () => {
      realtime().options.onSubscribed?.();
    });
    await waitFor(() => expect(headerCalls()).toBe(2));
  });

  it('re-reads when the page becomes visible and not when it becomes hidden', async () => {
    renderPane();
    setVisibility('hidden');
    await act(async () => {});
    expect(headerCalls()).toBe(0);
    setVisibility('visible');
    await waitFor(() => expect(headerCalls()).toBe(1));
  });

  it('keeps the bar when the read fails and never polls', async () => {
    renderPane();
    headerAnswer = () => new Response(null, { status: 502 });
    await fire(REALTIME_EVENTS.chatCase);
    await waitFor(() => expect(headerCalls()).toBe(1));
    expect(screen.getByText('Aberto')).toBeTruthy();
    await act(async () => {
      await new Promise((done) => setTimeout(done, 50));
    });
    expect(headerCalls()).toBe(1);
  });

  it('ignores a header answered for the staff side', async () => {
    renderPane();
    headerAnswer = () =>
      Response.json({
        viewer: 'staff',
        header: { ...header('closed'), viewer: 'staff', meta: 'x', actions: [] },
      });
    await fire(REALTIME_EVENTS.chatCase);
    await waitFor(() => expect(headerCalls()).toBe(1));
    expect(screen.getByText('Aberto')).toBeTruthy();
    expect(screen.queryByText('Fechado')).toBeNull();
  });
});

describe('the strips and the composer (UI-D-820, A-UI-4)', () => {
  it('draws the resolved strip above an ENABLED composer', () => {
    renderPane({ initialCase: header('resolved') });
    const strip = document.querySelector('[data-case-resolved]');
    expect(strip).not.toBeNull();
    expect(strip?.getAttribute('role')).toBe('status');
    const field = screen.getByLabelText('Mensagem') as HTMLTextAreaElement;
    expect(field.disabled).toBe(false);
    // The strip sits directly above the composer.
    expect(strip?.nextElementSibling?.hasAttribute('data-chat-composer')).toBe(true);
  });

  it('replaces the composer by the closed strip for a Fechado case, with Novo chamado to /suporte', () => {
    renderPane({ initialCase: header('closed') });
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
    const strip = document.querySelector('[data-case-closed]');
    expect(strip?.getAttribute('role')).toBe('status');
    expect(screen.getByRole('link', { name: 'Novo chamado' }).getAttribute('href')).toBe(
      '/suporte',
    );
  });

  it('lets a blocked or removed notice win over the closed strip', () => {
    renderPane({ initialCase: header('closed'), readOnlyNotice: 'Sua conta está bloqueada.' });
    expect(screen.getByText('Sua conta está bloqueada.')).toBeTruthy();
    expect(document.querySelector('[data-case-closed]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Novo chamado' })).toBeNull();
  });

  it('swaps the composer for the closed strip on a live close, with no toast and no focus move', async () => {
    renderPane();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();

    headerAnswer = () => Response.json(answer('closed'));
    await fire(REALTIME_EVENTS.chatCase);
    await waitFor(() => expect(document.querySelector('[data-case-closed]')).not.toBeNull());
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
    expect(document.activeElement).toBe(outside);
    // Closing is silent (D-808): the only status regions are the strip and the hidden live one.
    expect(screen.queryByText(/reaberto\./)).toBeNull();
    outside.remove();
  });

  it('speaks the change politely only while the page is open', async () => {
    renderPane();
    const region = document.querySelector('[aria-live="polite"][data-case-live]');
    expect(region?.textContent).toBe('');
    headerAnswer = () => Response.json(answer('resolved'));
    await fire(REALTIME_EVENTS.chatCase);
    await waitFor(() => expect(region?.textContent).toBe('Seu chamado #42 foi resolvido.'));
    expect(document.querySelectorAll('[aria-live=assertive]')).toHaveLength(0);
  });
});

describe('the reply that reopens (UI-D-820d)', () => {
  const reply = (reopened: boolean) => ({
    ok: true as const,
    conversationId: CASE_ID,
    view: ownView(2, 'Ainda preciso de ajuda', '33333333-3333-4333-8333-333333333333'),
    case: {
      id: CASE_ID,
      number: 42,
      state: reopened ? ('open' as const) : ('resolved' as const),
      opened: false,
      reopened,
    },
  });

  it('moves the pill back to Aberto, removes the strip and toasts the reopening once', async () => {
    mocks.send.mockResolvedValue(reply(true));
    headerAnswer = () => Response.json(answer('open'));
    renderPane({ initialCase: header('resolved') });
    expect(screen.getByText('Resolvido')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Mensagem'), {
      target: { value: 'Ainda preciso de ajuda' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    await waitFor(() => expect(screen.getByText('Chamado #42 reaberto.')).toBeTruthy());
    expect(mocks.send.mock.calls[0]).toEqual(['Ainda preciso de ajuda']);
    expect(screen.getByText('Aberto')).toBeTruthy();
    expect(document.querySelector('[data-case-resolved]')).toBeNull();
    expect(screen.getAllByText('Chamado #42 reaberto.')).toHaveLength(1);
  });

  it('shows no toast for a reply that did not reopen anything', async () => {
    mocks.send.mockResolvedValue(reply(false));
    headerAnswer = () => Response.json(answer('resolved'));
    renderPane({ initialCase: header('resolved') });
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Obrigado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByText(/reaberto\./)).toBeNull();
  });
});

describe('the staff pane never draws the member bar', () => {
  it('re-reads the header for the team (12.4-15) but a member-shaped answer draws no bar', async () => {
    renderPane({ viewer: 'staff', initialCase: null, hasAnyCase: false });
    expect(document.querySelector('[data-case-bar]')).toBeNull();
    await fire(REALTIME_EVENTS.chatCase);
    await act(async () => {});
    expect(headerCalls()).toBe(1);
    expect(document.querySelector('[data-case-bar]')).toBeNull();
    expect(screen.queryByText('Aberto')).toBeNull();
  });
});
