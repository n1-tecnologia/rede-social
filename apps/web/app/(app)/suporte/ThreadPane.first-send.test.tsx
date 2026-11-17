// @vitest-environment happy-dom

import { join } from 'node:path';
import { ToastProvider } from '@rede-social/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { ChatMessageView, MemberCaseHeaderView } from '@/lib/chat-view';
import type { ThreadPaneProps } from './ThreadPane';

/**
 * 12.4-12 Task 1, the tracer (UI-D-818, UI-D-819, UI-D-820a, D-812, D-803; UC M01, M03, M04, M05): a
 * member with no case opens one from the thread. The server action is mocked and answers the shape plan
 * 20 typed (`{ ok, conversationId, view, case }`); the catalog is the real pt-BR one; Realtime is a
 * no-op. The path under test: the opener, the send with the chosen category and subject, the swap to
 * the case bar with the real number, the confirmation row on this client, the failed send that keeps
 * everything, and the optimistic bubble while the first send is in flight.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({ send: vi.fn(), refresh: vi.fn() }));

vi.mock('./actions', () => ({
  sendSupportMessageAction: (...args: unknown[]) => mocks.send(...args),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock('@rede-social/core/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/core/ui')>()),
  useRealtimeTopic: vi.fn(),
}));

const { ThreadPane } = await import('./ThreadPane');

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '99999999-9999-4999-8999-999999999999';

const serverHeader: MemberCaseHeaderView = {
  viewer: 'member',
  id: CASE_ID,
  number: 42,
  title: 'Chamado #42',
  state: { state: 'open', label: 'Aberto', tone: 'warning', glyph: 'CircleDot' },
  subject: 'Meu ingresso',
  subjectLine: '#42 · Meu ingresso',
};

const sentView = (id: string, body: string, seq: number): ChatMessageView => ({
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

function opened(body: string) {
  return {
    ok: true as const,
    conversationId: CASE_ID,
    view: sentView('22222222-2222-4222-8222-222222222222', body, 1),
    case: { id: CASE_ID, number: 42, state: 'open' as const, opened: true, reopened: false },
  };
}

function renderPane(over: Partial<ThreadPaneProps> = {}) {
  const props: ThreadPaneProps = {
    tenantId: TENANT_ID,
    tenantName: 'Rede Demo',
    logoUrl: null,
    initialConversationId: null,
    initialViews: [],
    initialHasOlder: false,
    initialKeys: { todayKey: '2026-11-17', yesterdayKey: '2026-11-16' },
    initialError: false,
    initialCase: null,
    hasAnyCase: false,
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

const field = () => screen.getByLabelText('Mensagem') as HTMLTextAreaElement;
const subjectField = () => screen.getByLabelText('Assunto (opcional)') as HTMLInputElement;

function write(text: string) {
  fireEvent.change(field(), { target: { value: text } });
}

beforeEach(() => {
  mocks.send.mockReset();
  mocks.refresh.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/messages?')) {
        return Response.json({
          items: [],
          hasMore: false,
          todayKey: '2026-11-17',
          yesterdayKey: '2026-11-16',
        });
      }
      if (String(url).endsWith('/read')) return new Response(null, { status: 204 });
      return Response.json({ viewer: 'member', header: serverHeader });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the first send from the opener (tracer)', () => {
  it('shows the greeting, the opener with Outro preselected, and the composer named Abrir chamado', () => {
    const { container } = renderPane();
    expect(screen.getByText('Fale com a equipe de Rede Demo')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Sobre o que é?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Outro' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Abrir chamado' })).toBeTruthy();
    expect(field().placeholder).toBe('Conte o que você precisa');
    // No case yet: no bar, and the opener lives INSIDE the scroller (UI-D-819).
    expect(container.querySelector('[data-case-bar]')).toBeNull();
    const scroller = container.querySelector('[data-chat-scroller]');
    expect(scroller?.contains(screen.getByRole('group', { name: 'Sobre o que é?' }))).toBe(true);
  });

  it('sends the body, the chosen category and the typed subject, then swaps the opener for the case bar with the real number', async () => {
    mocks.send.mockResolvedValue(opened('Meu ingresso não chegou'));
    const { container } = renderPane();

    fireEvent.click(screen.getByRole('button', { name: 'Pagamento' }));
    fireEvent.change(subjectField(), { target: { value: 'Meu ingresso' } });
    write('Meu ingresso não chegou');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chamado' }));

    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send).toHaveBeenCalledWith('Meu ingresso não chegou', 'payment', 'Meu ingresso');

    await waitFor(() => expect(screen.queryByRole('group', { name: 'Sobre o que é?' })).toBeNull());
    expect(container.querySelector('[data-case-bar]')).not.toBeNull();
    expect(screen.getAllByText('Chamado #42').length).toBeGreaterThan(0);
    expect(screen.getByText('Aberto')).toBeTruthy();
    // The opener's send name goes back to the shipped one for every later message.
    expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeTruthy();
    expect(field().placeholder).toBe('Escreva uma mensagem');
    // The bar's row 2 is the server's label once the header refetch lands.
    await waitFor(() => expect(screen.getByText('Meu ingresso')).toBeTruthy());
  });

  it('shows the one-time confirmation row on this client, as a status, with the number', async () => {
    mocks.send.mockResolvedValue(opened('Oi'));
    renderPane();
    write('Oi');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chamado' }));

    const row = await screen.findByText('Chamado #42 aberto.');
    expect(row.closest('[role="status"]')).not.toBeNull();
    expect(
      screen.getByText('A equipe responde por aqui. Avisamos quando houver resposta.'),
    ).toBeTruthy();
  });

  it('sends Outro and no subject when the member chose nothing', async () => {
    mocks.send.mockResolvedValue(opened('Oi'));
    renderPane();
    write('Oi');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chamado' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send).toHaveBeenCalledWith('Oi', 'other', undefined);
  });

  it('keeps the draft, the chosen chip and the subject when the first send fails (M03 error)', async () => {
    mocks.send.mockResolvedValue({ ok: false, error: 'composer.errors.failed' });
    renderPane();

    fireEvent.click(screen.getByRole('button', { name: 'Conta' }));
    fireEvent.change(subjectField(), { target: { value: 'Minha senha' } });
    write('Não consigo entrar');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chamado' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(field().value).toBe('Não consigo entrar');
    expect(subjectField().value).toBe('Minha senha');
    expect(screen.getByRole('button', { name: 'Conta' }).getAttribute('aria-pressed')).toBe('true');
    // The opener is still there and no bar was drawn.
    expect(screen.getByRole('group', { name: 'Sobre o que é?' })).toBeTruthy();
    expect(screen.queryByText('Chamado #42 aberto.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir chamado' })).toBeTruthy();
  });

  it('shows the optimistic Enviando bubble while the first send is in flight, and the opener stays until the answer', async () => {
    let resolve: (value: ReturnType<typeof opened>) => void = () => {};
    mocks.send.mockReturnValue(new Promise((done) => (resolve = done)));
    renderPane();
    write('Oi');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chamado' }));

    await waitFor(() => expect(screen.getByText('Enviando…')).toBeTruthy());
    expect(screen.getByRole('group', { name: 'Sobre o que é?' })).toBeTruthy();

    await act(async () => {
      resolve(opened('Oi'));
    });
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Sobre o que é?' })).toBeNull());
    expect(screen.queryByText('Enviando…')).toBeNull();
  });

  it('keeps focus in the composer after the first send is accepted', async () => {
    mocks.send.mockResolvedValue(opened('Oi'));
    renderPane();
    write('Oi');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chamado' }));
    await screen.findByText('Chamado #42 aberto.');
    expect(document.activeElement).toBe(field());
  });

  it('sends a reply of the open case with the body only, never the category or the subject', async () => {
    mocks.send.mockResolvedValueOnce(opened('Oi')).mockResolvedValueOnce({
      ok: true,
      conversationId: CASE_ID,
      view: sentView('33333333-3333-4333-8333-333333333333', 'Segue o print', 2),
      case: { id: CASE_ID, number: 42, state: 'open', opened: false, reopened: false },
    });
    renderPane();
    write('Oi');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chamado' }));
    await screen.findByText('Chamado #42 aberto.');

    write('Segue o print');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[1]).toEqual(['Segue o print']);
  });
});
