// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { CaseHistoryView, StaffCaseHeaderView } from '@/lib/chat-view';
import { CaseDetailsSheet } from './CaseDetailsSheet';

/**
 * 12.4-19 Task 3 (UI-D-829, CASE-12, CASE-18; UC S14 populated, partial and overflow, S15, S16, S17): the
 * read-only details sheet. The history read is a `fetch` mock answering what the BFF handler of plan 20
 * answers (finished sentences, in the API's order) and the catalog is the real pt-BR one.
 *
 * Pinned here: the "Dados" rows, the history loading lazily when the sheet opens (three skeleton rows, then
 * one row per event oldest first with the actor in bold, then the inline retry on a failure), the automatic
 * close with no actor, the earlier cases (up to five anchors, the "Mostrando os 5 mais recentes." line only
 * when more exist, the section absent when there are none), and a read-only body.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

MotionGlobalConfig.skipAnimations = true;

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const CASE_ID = '33333333-3333-4333-8333-333333333333';
const HISTORY_URL = `/api/chat/conversations/${CONVERSATION_ID}/case/history`;
const SP = 'America/Sao_Paulo';
const KEYS = { todayKey: '2026-11-17', yesterdayKey: '2026-11-16' };

const header = (over: Partial<StaffCaseHeaderView> = {}): StaffCaseHeaderView => ({
  viewer: 'staff',
  id: CASE_ID,
  number: 42,
  title: 'Chamado #42',
  state: { state: 'in_progress', label: 'Em atendimento', tone: 'brand', glyph: 'UserCheck' },
  subject: 'Cobrança duplicada',
  subjectLine: '#42 · Cobrança duplicada',
  meta: 'Pagamento · Alta · Com Carla',
  actions: ['take', 'resolve', 'close', 'edit'],
  ownerUserId: '44444444-4444-4444-8444-444444444444',
  ownerName: 'Carla Souza',
  ownerIsViewer: false,
  category: 'payment',
  priority: 'high',
  typedSubject: 'Cobrança duplicada',
  // 14:02 UTC is 11:02 in São Paulo.
  openedAt: '2026-11-17T14:02:00.000Z',
  ...over,
});

const event = (
  kind: CaseHistoryView['events'][number]['kind'],
  text: string,
  strong: string | null,
  time: string,
): CaseHistoryView['events'][number] => ({
  kind,
  text,
  parts: strong
    ? [
        { text: strong, strong: true },
        { text: text.slice(strong.length), strong: false },
      ]
    : [{ text, strong: false }],
  time,
});

const EVENTS: CaseHistoryView['events'] = [
  event('opened', 'Ana Lima abriu o chamado.', 'Ana Lima', 'Hoje · 11:02'),
  event('taken', 'Carla Souza assumiu o chamado.', 'Carla Souza', 'Hoje · 11:10'),
  event(
    'closed',
    'O chamado foi fechado automaticamente após 7 dias resolvido.',
    null,
    'Hoje · 12:00',
  ),
];

const earlierCase = (n: number): CaseHistoryView['earlier'][number] => ({
  id: `0000000${n}-0000-4000-8000-000000000000`,
  href: `/suporte/0000000${n}-0000-4000-8000-000000000000`,
  subjectLine: `#${30 + n} · Assunto ${n}`,
  state: { state: 'closed', label: 'Fechado', tone: 'neutral', glyph: 'Lock' },
  date: '12/10',
});

const fetchMock = vi.fn();
let answer: () => Promise<Response> | Response = () =>
  Response.json({ events: EVENTS, earlier: [], hasMoreEarlier: false });

const historyCalls = () => fetchMock.mock.calls.filter(([url]) => url === HISTORY_URL).length;

function renderSheet(
  over: { header?: StaffCaseHeaderView; open?: boolean; keys?: typeof KEYS } = {},
) {
  const onClose = vi.fn<() => void>();
  const tree = (open: boolean) => (
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <CaseDetailsSheet
        open={open}
        onClose={onClose}
        conversationId={CONVERSATION_ID}
        header={over.header ?? header()}
        keys={over.keys ?? KEYS}
        timeZone={SP}
      />
    </NextIntlClientProvider>
  );
  const utils = render(tree(over.open ?? true));
  return { onClose, tree, ...utils };
}

const dialog = () => screen.getByRole('dialog', { name: 'Chamado #42' });
const dataList = () => within(dialog()).getByText('Estado').closest('dl') as HTMLElement;

beforeEach(() => {
  fetchMock.mockReset();
  answer = () => Response.json({ events: EVENTS, earlier: [], hasMoreEarlier: false });
  fetchMock.mockImplementation(async () => answer());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the details sheet: Dados (UI-D-829)', () => {
  it('is titled "Chamado #N" and lists Estado, Categoria, Prioridade, Responsável and Aberto em', async () => {
    renderSheet();
    expect(dialog()).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Dados' })).toBeTruthy();
    const terms = within(dataList())
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(terms).toEqual(['Estado', 'Categoria', 'Prioridade', 'Responsável', 'Aberto em']);
    const value = (term: string) =>
      (within(dataList()).getByText(term).nextElementSibling as HTMLElement).textContent;
    expect(value('Estado')).toContain('Em atendimento');
    expect(value('Categoria')).toBe('Pagamento');
    expect(value('Prioridade')).toBe('Alta');
    expect(value('Responsável')).toBe('Carla Souza');
    expect(value('Aberto em')).toBe('Hoje · 11:02');
    await waitFor(() => expect(historyCalls()).toBe(1));
  });

  it('says "Sem responsável" for an unowned case and the Resolvido pill for its state', () => {
    renderSheet({
      header: header({
        ownerUserId: null,
        ownerName: null,
        state: { state: 'resolved', label: 'Resolvido', tone: 'success', glyph: 'CircleCheck' },
      }),
    });
    const value = (term: string) =>
      (within(dataList()).getByText(term).nextElementSibling as HTMLElement).textContent;
    expect(value('Responsável')).toBe('Sem responsável');
    expect(value('Estado')).toContain('Resolvido');
  });

  it("words 'Aberto em' with the thread's day rule in the tenant clock", () => {
    const { unmount } = renderSheet({
      header: header({ openedAt: '2026-11-16T12:40:00.000Z' }),
    });
    const value = () =>
      (within(dataList()).getByText('Aberto em').nextElementSibling as HTMLElement).textContent;
    expect(value()).toBe('Ontem · 09:40');
    unmount();
    renderSheet({ header: header({ openedAt: '2026-10-12T19:40:00.000Z' }) });
    expect(value()).toBe('12/10 · 16:40');
  });

  it('is read-only: no field, no action button, only the close affordances and the retry when it fails', () => {
    renderSheet();
    expect(within(dialog()).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(dialog()).queryByRole('button', { name: 'Resolver' })).toBeNull();
    expect(within(dialog()).queryByRole('button', { name: 'Assumir' })).toBeNull();
  });

  it('never prints an id of the case, the owner or an actor', () => {
    renderSheet();
    expect(dialog().textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe('the history loads lazily (UI-D-829, S16)', () => {
  it('reads nothing while the sheet is closed and reads once when it opens', async () => {
    const { rerender, tree } = renderSheet({ open: false });
    expect(historyCalls()).toBe(0);
    rerender(tree(true));
    await waitFor(() => expect(screen.getByText('Ana Lima')).toBeTruthy());
    expect(historyCalls()).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      HISTORY_URL,
      expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }),
    );
  });

  it('shows three skeleton rows while it loads, then the events', async () => {
    let release: (response: Response) => void = () => {};
    answer = () => new Promise<Response>((resolve) => (release = resolve));
    renderSheet();
    expect(document.querySelectorAll('[data-history-skeleton]')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Histórico' })).toBeTruthy();
    await act(async () =>
      release(Response.json({ events: EVENTS, earlier: [], hasMoreEarlier: false })),
    );
    expect(document.querySelectorAll('[data-history-skeleton]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-history-row]')).toHaveLength(3);
  });

  it('draws one row per event in the API order (oldest first) with the actor in bold and the time under it', async () => {
    renderSheet();
    await waitFor(() => expect(document.querySelectorAll('[data-history-row]')).toHaveLength(3));
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-history-row]'));
    expect(rows.map((row) => row.getAttribute('data-history-row'))).toEqual([
      'opened',
      'taken',
      'closed',
    ]);
    const first = rows[0] as HTMLElement;
    expect(first.textContent).toContain('Ana Lima abriu o chamado.');
    const bold = first.querySelector('strong, [data-strong]') as HTMLElement;
    expect(bold.textContent).toBe('Ana Lima');
    expect(bold.className).toContain('font-bold');
    expect(first.textContent).toContain('Hoje · 11:02');
    // The disc is a 32px neutral circle with a 16px glyph.
    const disc = first.querySelector('[data-history-disc]') as HTMLElement;
    expect(disc.className).toContain('size-8');
    expect(disc.className).toContain('rounded-full');
    expect(disc.querySelector('svg')?.getAttribute('width')).toBe('16');
  });

  it('draws the automatic close as its own sentence with no bold actor', async () => {
    renderSheet();
    await waitFor(() => expect(document.querySelectorAll('[data-history-row]')).toHaveLength(3));
    const closed = document.querySelector('[data-history-row="closed"]') as HTMLElement;
    expect(closed.textContent).toContain(
      'O chamado foi fechado automaticamente após 7 dias resolvido.',
    );
    expect(closed.querySelector('strong, [data-strong]')).toBeNull();
  });

  it('a case with only "abriu o chamado" shows that one row (S17)', async () => {
    answer = () => Response.json({ events: [EVENTS[0]], earlier: [], hasMoreEarlier: false });
    renderSheet();
    await waitFor(() => expect(document.querySelectorAll('[data-history-row]')).toHaveLength(1));
  });

  it('an actor who left reads through the finished sentence the handler built', async () => {
    answer = () =>
      Response.json({
        events: [
          event('taken', 'Alguém da equipe assumiu o chamado.', 'Alguém da equipe', 'Hoje · 11:10'),
        ],
        earlier: [],
        hasMoreEarlier: false,
      });
    renderSheet();
    await waitFor(() => expect(screen.getByText('Alguém da equipe')).toBeTruthy());
  });

  it('a failed read shows the inline line with "Tentar novamente", which reads it again', async () => {
    answer = () => new Response(null, { status: 502 });
    renderSheet();
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar o histórico.')).toBeTruthy(),
    );
    expect(document.querySelectorAll('[data-history-skeleton]')).toHaveLength(0);
    answer = () => Response.json({ events: EVENTS, earlier: [], hasMoreEarlier: false });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(document.querySelectorAll('[data-history-row]')).toHaveLength(3));
    expect(screen.queryByText('Não foi possível carregar o histórico.')).toBeNull();
    expect(historyCalls()).toBe(2);
  });

  it('a malformed answer is the same failure, never a crash', async () => {
    answer = () => Response.json({ nothing: true });
    renderSheet();
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar o histórico.')).toBeTruthy(),
    );
  });

  it('a thrown fetch is the same failure', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('offline');
    });
    renderSheet();
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar o histórico.')).toBeTruthy(),
    );
  });
});

describe("the member's earlier cases (UI-D-829, S15)", () => {
  it('draws no section at all when there are none', async () => {
    renderSheet();
    await waitFor(() => expect(document.querySelectorAll('[data-history-row]')).toHaveLength(3));
    expect(screen.queryByText('Chamados anteriores deste membro')).toBeNull();
    expect(screen.queryByText('Mostrando os 5 mais recentes.')).toBeNull();
  });

  it('lists up to five anchors to the case with the pill and the opening date, and no "more" line when there are five', async () => {
    answer = () =>
      Response.json({
        events: EVENTS,
        earlier: [1, 2, 3, 4, 5].map(earlierCase),
        hasMoreEarlier: false,
      });
    renderSheet();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Chamados anteriores deste membro' }),
      ).toBeTruthy(),
    );
    const links = within(dialog()).getAllByRole('link');
    expect(links).toHaveLength(5);
    expect(links[0]?.getAttribute('href')).toBe('/suporte/00000001-0000-4000-8000-000000000000');
    expect(links[0]?.textContent).toContain('#31 · Assunto 1');
    expect(links[0]?.textContent).toContain('Fechado');
    expect(links[0]?.textContent).toContain('12/10');
    expect(screen.queryByText('Mostrando os 5 mais recentes.')).toBeNull();
  });

  it('closes the section with "Mostrando os 5 mais recentes." when more exist', async () => {
    answer = () =>
      Response.json({
        events: EVENTS,
        earlier: [1, 2, 3, 4, 5].map(earlierCase),
        hasMoreEarlier: true,
      });
    renderSheet();
    await waitFor(() => expect(screen.getByText('Mostrando os 5 mais recentes.')).toBeTruthy());
  });
});

describe('the sheet scrolls and closes (overflow S14)', () => {
  it('is the scrolling sheet: the title stays and the body scrolls', async () => {
    renderSheet();
    const body = within(dialog())
      .getByRole('heading', { name: 'Dados' })
      .closest('.overflow-y-auto');
    expect(body).not.toBeNull();
    expect(body?.contains(within(dialog()).getByRole('heading', { name: 'Chamado #42' }))).toBe(
      false,
    );
    await waitFor(() => expect(historyCalls()).toBe(1));
  });

  it('closing and reopening reads the history again', async () => {
    const { rerender, tree } = renderSheet();
    await waitFor(() => expect(historyCalls()).toBe(1));
    rerender(tree(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    rerender(tree(true));
    await waitFor(() => expect(historyCalls()).toBe(2));
  });
});
