// @vitest-environment happy-dom

import { join } from 'node:path';
import { convTopic, REALTIME_EVENTS } from '@rede-social/contracts/realtime';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { ChatMessageView, MemberCaseHeaderView, StaffCaseHeaderView } from '@/lib/chat-view';
import type { ThreadPaneProps } from './ThreadPane';

/**
 * 12.4-15 (UI-D-825, UI-D-828, UI-D-830, D-806; UC S13, S18; checker W10, T-12.4-72): the team's thread with a
 * case. The BFF header handler is `fetch` mocked, Realtime is a recorder whose handler the test fires by
 * hand and the catalog is the real pt-BR one.
 *
 * Pinned here: the reply-takes hint on an unowned `Aberto` case only; the closed strip replacing the
 * composer with a blocked or removed notice winning over it; an enabled composer on `Resolvido`; ONE
 * coalesced re-read of the header per burst of `chat.case` and `chat.message` signals; the bar following
 * the server after a reply; and the member viewer, handed a staff-shaped case, drawing none of it.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({
  sendStaff: vi.fn(),
  sendMember: vi.fn(),
  run: vi.fn(),
  edit: vi.fn(),
  refresh: vi.fn(),
  realtime: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;

vi.mock('./actions', () => ({
  sendSupportMessageAction: (...args: unknown[]) => mocks.sendMember(...args),
  runCaseActionAction: (...args: unknown[]) => mocks.run(...args),
  editCaseAction: (...args: unknown[]) => mocks.edit(...args),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock('@rede-social/core/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/core/ui')>()),
  useRealtimeTopic: (...args: unknown[]) => mocks.realtime(...args),
}));

const { ThreadPane } = await import('./ThreadPane');

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const CASE_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_ID = '44444444-4444-4444-8444-444444444444';
const TENANT_ID = '99999999-9999-4999-8999-999999999999';
const HEADER_URL = `/api/chat/conversations/${CONVERSATION_ID}`;
const HISTORY_URL = `${HEADER_URL}/case/history`;

type CaseState = 'open' | 'in_progress' | 'resolved' | 'closed';

const STATE_VIEW: Record<CaseState, StaffCaseHeaderView['state']> = {
  open: { state: 'open', label: 'Aberto', tone: 'warning', glyph: 'CircleDot' },
  in_progress: { state: 'in_progress', label: 'Em atendimento', tone: 'brand', glyph: 'UserCheck' },
  resolved: { state: 'resolved', label: 'Resolvido', tone: 'success', glyph: 'CircleCheck' },
  closed: { state: 'closed', label: 'Fechado', tone: 'neutral', glyph: 'Lock' },
};

const ACTIONS: Record<CaseState, StaffCaseHeaderView['actions']> = {
  open: ['take', 'assign', 'resolve', 'close', 'edit'],
  in_progress: ['assign', 'resolve', 'close', 'edit'],
  resolved: ['reopen', 'close', 'edit'],
  closed: [],
};

const staffHeader = (
  state: CaseState,
  over: Partial<StaffCaseHeaderView> = {},
): StaffCaseHeaderView => ({
  viewer: 'staff',
  id: CASE_ID,
  number: 42,
  title: 'Chamado #42',
  state: STATE_VIEW[state],
  subject: 'Meu ingresso',
  subjectLine: '#42 · Meu ingresso',
  meta: 'Pagamento · Normal · Sem responsável',
  actions: ACTIONS[state],
  ownerUserId: null,
  ownerName: null,
  ownerIsViewer: false,
  category: 'payment',
  priority: 'normal',
  typedSubject: 'Meu ingresso',
  openedAt: '2026-11-17T14:02:00.000Z',
  ...over,
});

const mine = (state: CaseState = 'in_progress') =>
  staffHeader(state, {
    meta: 'Pagamento · Normal · Com você',
    ownerUserId: OWNER_ID,
    ownerName: 'Carla Souza',
    ownerIsViewer: true,
  });

const message = (seq: number, body: string, id: string): ChatMessageView => ({
  id,
  seq,
  side: 'other',
  authorKey: 'member',
  body,
  label: null,
  time: '10:00',
  dayKey: '2026-11-17',
  createdAtMs: Date.parse('2026-11-17T10:00:00Z'),
});

const fetchMock = vi.fn();
let headerAnswer: () => Promise<Response> | Response = () =>
  Response.json({ viewer: 'staff', header: staffHeader('open') });

const headerCalls = () => fetchMock.mock.calls.filter(([url]) => url === HEADER_URL).length;
const staffCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/chat/staff').length;
const historyCalls = () => fetchMock.mock.calls.filter(([url]) => url === HISTORY_URL).length;

const ANA_ID = '55555555-5555-4555-8555-555555555555';

function renderPane(over: Partial<ThreadPaneProps> = {}) {
  const props: ThreadPaneProps = {
    tenantId: TENANT_ID,
    tenantName: 'Rede Demo',
    logoUrl: null,
    initialConversationId: CONVERSATION_ID,
    initialViews: [message(1, 'Meu ingresso não chegou', '22222222-2222-4222-8222-222222222222')],
    initialHasOlder: false,
    initialKeys: { todayKey: '2026-11-17', yesterdayKey: '2026-11-16' },
    initialError: false,
    viewer: 'staff',
    onSendAction: (...args: [string, string]) => mocks.sendStaff(...args),
    initialStaffCase: staffHeader('open'),
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

function realtime() {
  const call = mocks.realtime.mock.calls.at(-1) as unknown[];
  return {
    topic: call[0] as string | null,
    events: call[1] as string[],
    onSignal: call[2] as (event: string, payload: unknown) => void,
    options: call[3] as { onSubscribed?: () => void },
  };
}

const fire = (event: string, payload: unknown = { id: CASE_ID }) =>
  act(async () => {
    realtime().onSignal(event, payload);
  });

beforeEach(() => {
  mocks.sendStaff.mockReset();
  mocks.sendMember.mockReset();
  mocks.run.mockReset();
  mocks.edit.mockReset();
  mocks.refresh.mockReset();
  mocks.realtime.mockReset();
  fetchMock.mockReset();
  headerAnswer = () => Response.json({ viewer: 'staff', header: staffHeader('open') });
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
    if (String(url) === '/api/chat/staff') {
      return Response.json({
        items: [
          { userId: OWNER_ID, name: 'Carla Souza' },
          { userId: ANA_ID, name: 'Ana' },
        ],
      });
    }
    if (String(url) === HISTORY_URL) {
      return Response.json({ events: [], earlier: [], hasMoreEarlier: false });
    }
    return headerAnswer();
  });
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const HINT = 'Ao responder, você assume este chamado.';
const CLOSED = 'Este chamado está fechado. A conversa fica disponível só para leitura.';

describe('the staff bar and the composer rules (UI-D-825, UI-D-828)', () => {
  it('draws the bar under the header with the composer below', () => {
    renderPane();
    expect(document.querySelector('[data-case-staff]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Ver detalhes do chamado #42' })).toBeTruthy();
    expect(screen.getByLabelText('Mensagem')).toBeTruthy();
  });

  it('shows the reply-takes hint on an unowned open case only (a)', () => {
    renderPane();
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('shows no hint on a case owned by someone else, and the composer stays enabled (b)', () => {
    renderPane({
      initialStaffCase: staffHeader('in_progress', {
        ownerUserId: OWNER_ID,
        ownerName: 'Carla Souza',
        actions: ACTIONS.open,
      }),
    });
    expect(screen.queryByText(HINT)).toBeNull();
    const field = screen.getByLabelText('Mensagem') as HTMLTextAreaElement;
    expect(field.disabled).toBe(false);
  });

  it('keeps the composer enabled on a resolved case with no hint (c)', () => {
    renderPane({ initialStaffCase: staffHeader('resolved') });
    expect(screen.queryByText(HINT)).toBeNull();
    expect((screen.getByLabelText('Mensagem') as HTMLTextAreaElement).disabled).toBe(false);
    // The member's resolved strip is the member's: the team gets no such row.
    expect(document.querySelector('[data-case-resolved]')).toBeNull();
  });

  it('replaces the composer with the read-only strip on a closed case (d)', () => {
    renderPane({ initialStaffCase: staffHeader('closed') });
    const strip = document.querySelector('[data-case-closed]') as HTMLElement;
    expect(strip.getAttribute('role')).toBe('status');
    expect(within(strip).getByText(CLOSED)).toBeTruthy();
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
    // The team is never offered a case of its own.
    expect(screen.queryByRole('link', { name: 'Novo chamado' })).toBeNull();
  });

  it('lets a blocked or removed member notice win over the closed strip (e)', () => {
    renderPane({
      initialStaffCase: staffHeader('closed'),
      readOnlyNotice: 'Ana está bloqueada. A conversa fica só para leitura.',
    });
    expect(document.querySelector('[data-chat-readonly]')).not.toBeNull();
    expect(document.querySelector('[data-case-closed]')).toBeNull();
  });

  it('draws no hint when a notice replaces the composer', () => {
    renderPane({ readOnlyNotice: 'Ana saiu da comunidade.' });
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
  });

  it('a thread with no case draws no bar, no hint and a plain composer', () => {
    renderPane({ initialStaffCase: null });
    expect(document.querySelector('[data-case-bar]')).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.getByLabelText('Mensagem')).toBeTruthy();
  });

  it('after a reply the bar follows the server: Em atendimento owned by the replier', async () => {
    mocks.sendStaff.mockResolvedValue({
      ok: true,
      conversationId: CONVERSATION_ID,
      view: { ...message(2, 'Já resolvo', '55555555-5555-4555-8555-555555555555'), side: 'own' },
    });
    renderPane();
    headerAnswer = () => Response.json({ viewer: 'staff', header: mine() });

    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Já resolvo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    await waitFor(() => expect(screen.getByText('Em atendimento')).toBeTruthy());
    expect(screen.getByText('Pagamento · Normal · Com você')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resolver' })).toBeTruthy();
    expect(screen.queryByText(HINT)).toBeNull();
    expect(mocks.sendStaff).toHaveBeenCalledWith(CONVERSATION_ID, 'Já resolvo');
  });

  it('a reply on a resolved case does not reopen it: the bar keeps what the server says', async () => {
    mocks.sendStaff.mockResolvedValue({
      ok: true,
      conversationId: CONVERSATION_ID,
      view: { ...message(2, 'De nada', '55555555-5555-4555-8555-555555555555'), side: 'own' },
    });
    renderPane({ initialStaffCase: staffHeader('resolved') });
    headerAnswer = () => Response.json({ viewer: 'staff', header: staffHeader('resolved') });

    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'De nada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));

    await waitFor(() => expect(mocks.sendStaff).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.getByText('Resolvido')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reabrir' })).toBeTruthy();
  });
});

describe('the bar follows the case live (UI-D-830, UC S18)', () => {
  it('joins the conversation topic for both signals', () => {
    renderPane();
    const { topic, events } = realtime();
    expect(topic).toBe(convTopic(TENANT_ID, CONVERSATION_ID));
    expect(events).toEqual(
      expect.arrayContaining([REALTIME_EVENTS.chatMessage, REALTIME_EVENTS.chatCase]),
    );
  });

  it('re-reads on a chat.case signal and shows another team member action', async () => {
    renderPane();
    headerAnswer = () =>
      Response.json({
        viewer: 'staff',
        header: staffHeader('in_progress', {
          meta: 'Pagamento · Normal · Com Carla',
          ownerUserId: OWNER_ID,
          ownerName: 'Carla Souza',
          actions: ACTIONS.open,
        }),
      });
    await fire(REALTIME_EVENTS.chatCase);
    await waitFor(() => expect(screen.getByText('Em atendimento')).toBeTruthy());
    expect(screen.getByText('Pagamento · Normal · Com Carla')).toBeTruthy();
    expect(screen.queryByText(HINT)).toBeNull();
    expect(headerCalls()).toBe(1);
  });

  it('re-reads on a chat.message signal even when its seq is a replay', async () => {
    renderPane();
    headerAnswer = () => Response.json({ viewer: 'staff', header: staffHeader('resolved') });
    await fire(REALTIME_EVENTS.chatMessage, { seq: 1 });
    await waitFor(() => expect(screen.getByText('Resolvido')).toBeTruthy());
    expect(headerCalls()).toBe(1);
  });

  it('re-reads on subscribe and on a refocus', async () => {
    renderPane();
    await act(async () => {
      realtime().options.onSubscribed?.();
    });
    await waitFor(() => expect(headerCalls()).toBe(1));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(headerCalls()).toBe(2));
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
      gates[0]?.(Response.json({ viewer: 'staff', header: staffHeader('open') }));
    });
    await waitFor(() => expect(headerCalls()).toBe(2));
    await act(async () => {
      gates[1]?.(Response.json({ viewer: 'staff', header: staffHeader('open') }));
    });
    await act(async () => {
      await new Promise((done) => setTimeout(done, 50));
    });
    expect(headerCalls()).toBe(2);
  });

  it('a live close swaps the composer for the strip with no toast and no focus move', async () => {
    renderPane();
    const field = screen.getByLabelText('Mensagem') as HTMLTextAreaElement;
    field.focus();
    headerAnswer = () => Response.json({ viewer: 'staff', header: staffHeader('closed') });
    await fire(REALTIME_EVENTS.chatCase);
    await waitFor(() => expect(document.querySelector('[data-case-closed]')).not.toBeNull());
    expect(screen.queryByLabelText('Mensagem')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores an answer that is not a staff header and keeps the bar as it is', async () => {
    renderPane();
    headerAnswer = () =>
      Response.json({
        viewer: 'member',
        header: {
          viewer: 'member',
          id: CASE_ID,
          number: 42,
          title: 'Chamado #42',
          state: STATE_VIEW.closed,
          subject: 'x',
          subjectLine: 'x',
        },
      });
    await fire(REALTIME_EVENTS.chatCase);
    await waitFor(() => expect(headerCalls()).toBe(1));
    expect(screen.getByText('Aberto')).toBeTruthy();
    expect(screen.queryByText('Fechado')).toBeNull();
  });

  it('a stale action re-reads the case through the same handler', async () => {
    mocks.run.mockResolvedValue({ ok: false, error: 'stale' });
    renderPane();
    headerAnswer = () =>
      Response.json({
        viewer: 'staff',
        header: staffHeader('in_progress', {
          ownerUserId: OWNER_ID,
          ownerName: 'Carla Souza',
          actions: ACTIONS.open,
        }),
      });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Assumir' }));
    });
    await waitFor(() => expect(screen.getByText('Em atendimento')).toBeTruthy());
    expect(headerCalls()).toBe(1);
  });

  it('no stub attribute is left on the bar wrapper (plan 19 mounts the real sheets)', () => {
    renderPane();
    const pane = document.querySelector('[data-case-staff]')?.parentElement as HTMLElement;
    expect(pane.hasAttribute('data-staff-sheet')).toBe(false);
  });
});

describe('the assign sheet is mounted from the menu (12.4-19 tracer, key link onOpenSheet, UI-D-827)', () => {
  const openMenuRow = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));
  };

  it('a tap on "Atribuir a…" mounts the assign sheet and reads the roster on open', async () => {
    renderPane({ initialStaffCase: mine() });
    expect(staffCalls()).toBe(0);
    openMenuRow('Atribuir a…');
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Atribuir chamado #42' })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByRole('radio', { name: /Ana/ })).toBeTruthy());
    expect(staffCalls()).toBe(1);
    expect(screen.getByText('responsável hoje')).toBeTruthy();
  });

  it('assigning from the thread calls the action and the bar takes the answered header', async () => {
    mocks.run.mockResolvedValue({
      ok: true,
      header: staffHeader('in_progress', {
        meta: 'Pagamento · Normal · Com Ana',
        ownerUserId: ANA_ID,
        ownerName: 'Ana',
        actions: ACTIONS.in_progress,
      }),
    });
    renderPane({ initialStaffCase: mine() });
    openMenuRow('Atribuir a…');
    await waitFor(() => expect(screen.getByRole('radio', { name: /Ana/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /Ana/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Atribuir' }));
    });
    expect(mocks.run).toHaveBeenCalledWith(CONVERSATION_ID, {
      action: 'assign',
      expectedState: 'in_progress',
      assigneeUserId: ANA_ID,
    });
    await waitFor(() => expect(screen.getByText('Pagamento · Normal · Com Ana')).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Atribuir/ })).toBeNull());
  });

  it('a case whose actions[] omit assign draws no such row and mounts no sheet', async () => {
    renderPane({
      initialStaffCase: staffHeader('in_progress', { actions: ['resolve', 'close', 'edit'] }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    expect(
      within(screen.getByRole('dialog')).queryByRole('button', { name: 'Atribuir a…' }),
    ).toBeNull();
    expect(screen.queryByRole('dialog', { name: /Atribuir chamado/ })).toBeNull();
    expect(staffCalls()).toBe(0);
  });
});

describe('the edit sheet is mounted from the menu (12.4-19, key link onOpenSheet, UI-D-827)', () => {
  const openMenuRow = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));
  };

  it('a tap on "Editar categoria, assunto e prioridade" mounts the edit sheet on the typed subject', async () => {
    renderPane({ initialStaffCase: mine() });
    openMenuRow('Editar categoria, assunto e prioridade');
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Editar chamado #42' })).toBeTruthy(),
    );
    expect((screen.getByLabelText('Assunto') as HTMLInputElement).value).toBe('Meu ingresso');
  });

  it('saving from the thread calls the edit action and the bar takes the answered header', async () => {
    mocks.edit.mockResolvedValue({
      ok: true,
      header: staffHeader('in_progress', {
        meta: 'Pagamento · Alta · Com você',
        priority: 'high',
        ownerUserId: OWNER_ID,
        ownerName: 'Carla Souza',
        ownerIsViewer: true,
        actions: ACTIONS.in_progress,
      }),
    });
    renderPane({ initialStaffCase: mine() });
    openMenuRow('Editar categoria, assunto e prioridade');
    const group = await screen.findByRole('group', { name: 'Prioridade' });
    fireEvent.click(within(group).getByRole('button', { name: 'Alta' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    });
    expect(mocks.edit).toHaveBeenCalledWith(CONVERSATION_ID, {
      expectedState: 'in_progress',
      priority: 'high',
    });
    await waitFor(() => expect(screen.getByText('Pagamento · Alta · Com você')).toBeTruthy());
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Editar chamado/ })).toBeNull(),
    );
  });

  it('a closed case lists no edit row and mounts no edit sheet', () => {
    renderPane({ initialStaffCase: staffHeader('closed') });
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    expect(
      within(screen.getByRole('dialog')).queryByRole('button', {
        name: 'Editar categoria, assunto e prioridade',
      }),
    ).toBeNull();
    expect(screen.queryByRole('dialog', { name: /Editar chamado/ })).toBeNull();
  });
});

describe('a member viewer never renders the team surfaces (checker W10, T-12.4-72)', () => {
  const staffShapedAsMember = (): MemberCaseHeaderView =>
    staffHeader('open', {
      actions: ['take', 'assign', 'close', 'edit'],
    }) as unknown as MemberCaseHeaderView;

  it('draws no staff bar, menu, priority, owner, roster call or history', async () => {
    renderPane({
      viewer: 'member',
      onSendAction: undefined,
      initialCase: staffShapedAsMember(),
      initialStaffCase: staffHeader('open'),
      hasAnyCase: true,
    });
    // The member's own bar is there, with member facts only.
    expect(document.querySelector('[data-case-bar]')).not.toBeNull();
    expect(document.querySelector('[data-case-staff]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mais ações' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ver detalhes do chamado/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assumir' })).toBeNull();
    expect(screen.queryByText(/Normal/)).toBeNull();
    expect(screen.queryByText(/Sem responsável/)).toBeNull();
    expect(screen.queryByText(HINT)).toBeNull();

    await fire(REALTIME_EVENTS.chatCase);
    await act(async () => {});
    expect(staffCalls()).toBe(0);
    expect(historyCalls()).toBe(0);
    expect(screen.queryByRole('button', { name: 'Mais ações' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a staff-shaped answer to a member re-read is ignored', async () => {
    renderPane({
      viewer: 'member',
      onSendAction: undefined,
      initialCase: staffShapedAsMember(),
      initialStaffCase: null,
      hasAnyCase: true,
    });
    await fire(REALTIME_EVENTS.chatCase);
    await waitFor(() => expect(headerCalls()).toBe(1));
    expect(document.querySelector('[data-case-staff]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mais ações' })).toBeNull();
  });
});
