// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { StaffCaseHeaderView } from '@/lib/chat-view';

/**
 * 12.4-19 tracer (UI-D-827, D-806, CASE-08; UC S11 populated, zero-one-many, A02): the assign sheet over the
 * shared staff roster. The server action is stubbed, the roster read is a `fetch` mock and the catalog is the
 * real pt-BR one.
 *
 * Pinned here: the radiogroup with `aria-checked` rows, the current owner marked "responsável hoje", the
 * "Atribuir" footer disabled until a DIFFERENT person is picked (also with one eligible person), three
 * skeleton rows while the roster loads and the retry line when it fails, the exact argument of the action
 * (assign, the expected state, the assignee id, no owner field), the success toast, a stale or failed answer
 * keeping the picked row, and the focus coming back to the opener.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  toast: { show: vi.fn(), dismiss: vi.fn() },
}));

MotionGlobalConfig.skipAnimations = true;

vi.mock('./actions', () => ({
  runCaseActionAction: (...args: unknown[]) => mocks.run(...args),
}));
vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => mocks.toast,
}));

const { AssignSheet } = await import('./AssignSheet');

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const CASE_ID = '33333333-3333-4333-8333-333333333333';
const CARLA = '44444444-4444-4444-8444-444444444444';
const ANA = '55555555-5555-4555-8555-555555555555';
const BRUNO = '66666666-6666-4666-8666-666666666666';

const header = (over: Partial<StaffCaseHeaderView> = {}): StaffCaseHeaderView => ({
  viewer: 'staff',
  id: CASE_ID,
  number: 42,
  title: 'Chamado #42',
  state: { state: 'in_progress', label: 'Em atendimento', tone: 'brand', glyph: 'UserCheck' },
  subject: 'Meu ingresso',
  subjectLine: '#42 · Meu ingresso',
  meta: 'Pagamento · Normal · Com Carla',
  actions: ['take', 'assign', 'resolve', 'close', 'edit'],
  ownerUserId: CARLA,
  ownerName: 'Carla Souza',
  ownerIsViewer: false,
  category: 'payment',
  priority: 'normal',
  typedSubject: 'Meu ingresso',
  openedAt: '2026-11-17T14:02:00.000Z',
  ...over,
});

const fetchMock = vi.fn();
let rosterAnswer: () => Promise<Response> | Response = () =>
  Response.json({
    items: [
      { userId: CARLA, name: 'Carla Souza' },
      { userId: ANA, name: 'Ana' },
      { userId: BRUNO, name: 'Bruno Lima' },
    ],
  });

const rosterCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url) === '/api/chat/staff').length;

function renderSheet(over: { header?: StaffCaseHeaderView; open?: boolean } = {}) {
  const calls = {
    onClose: vi.fn<() => void>(),
    onHeader: vi.fn<(next: StaffCaseHeaderView) => void>(),
    onStale: vi.fn<() => void>(),
  };
  const tree = (open: boolean, current: StaffCaseHeaderView) => (
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <button type="button">opener</button>
      <AssignSheet
        open={open}
        conversationId={CONVERSATION_ID}
        header={current}
        onClose={calls.onClose}
        onHeader={calls.onHeader}
        onStale={calls.onStale}
      />
    </NextIntlClientProvider>
  );
  const utils = render(tree(over.open ?? true, over.header ?? header()));
  return { ...calls, ...utils, tree };
}

const radios = () => within(screen.getByRole('radiogroup')).getAllByRole('radio');
const confirm = () => screen.getByRole('button', { name: 'Atribuir' }) as HTMLButtonElement;

async function ready() {
  await waitFor(() => expect(screen.getByRole('radio', { name: /Ana/ })).toBeTruthy());
}

beforeEach(() => {
  mocks.run.mockReset();
  mocks.toast.show.mockReset();
  fetchMock.mockReset();
  rosterAnswer = () =>
    Response.json({
      items: [
        { userId: CARLA, name: 'Carla Souza' },
        { userId: ANA, name: 'Ana' },
        { userId: BRUNO, name: 'Bruno Lima' },
      ],
    });
  fetchMock.mockImplementation(async () => rosterAnswer());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the assign sheet (UI-D-827)', () => {
  it('is titled with the case number and lists the live staff in a radiogroup with aria-checked rows', async () => {
    renderSheet();
    expect(screen.getByRole('dialog', { name: 'Atribuir chamado #42' })).toBeTruthy();
    await ready();
    expect(radios().map((radio) => radio.textContent)).toEqual([
      expect.stringContaining('Carla Souza'),
      expect.stringContaining('Ana'),
      expect.stringContaining('Bruno Lima'),
    ]);
    for (const radio of radios()) expect(radio.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('A pessoa escolhida recebe um aviso.')).toBeTruthy();
  });

  it('reads the roster when it opens, and not before', async () => {
    const { rerender, tree } = renderSheet({ open: false });
    expect(rosterCalls()).toBe(0);
    rerender(tree(true, header()));
    await ready();
    expect(rosterCalls()).toBe(1);
  });

  it('marks the current owner "responsável hoje" and keeps the footer disabled for that person', async () => {
    renderSheet();
    await ready();
    const owner = screen.getByRole('radio', { name: /Carla Souza/ });
    expect(within(owner).getByText('responsável hoje')).toBeTruthy();
    expect(screen.queryAllByText('responsável hoje')).toHaveLength(1);
    expect(confirm().disabled).toBe(true);
    fireEvent.click(owner);
    expect(owner.getAttribute('aria-checked')).toBe('true');
    expect(confirm().disabled).toBe(true);
  });

  it('enables "Atribuir" once a different person is picked, and the pick moves between rows', async () => {
    renderSheet();
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: /Ana/ }));
    expect(confirm().disabled).toBe(false);
    fireEvent.click(screen.getByRole('radio', { name: /Bruno Lima/ }));
    expect(screen.getByRole('radio', { name: /Ana/ }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('radio', { name: /Bruno Lima/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('one eligible person: the list shows that person and the footer stays disabled for the owner (S11 zero-one-many)', async () => {
    rosterAnswer = () => Response.json({ items: [{ userId: CARLA, name: 'Carla Souza' }] });
    renderSheet();
    await waitFor(() => expect(radios()).toHaveLength(1));
    expect(confirm().disabled).toBe(true);
    fireEvent.click(radios()[0] as HTMLElement);
    expect(confirm().disabled).toBe(true);
  });

  it('an unowned case marks nobody and any pick enables the footer', async () => {
    renderSheet({
      header: header({ state: { ...header().state, state: 'open' }, ownerUserId: null }),
    });
    await ready();
    expect(screen.queryByText('responsável hoje')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Carla Souza/ }));
    expect(confirm().disabled).toBe(false);
  });

  it('shows three skeleton rows while the roster loads', async () => {
    let release: (response: Response) => void = () => {};
    rosterAnswer = () => new Promise<Response>((resolve) => (release = resolve));
    renderSheet();
    await waitFor(() =>
      expect(document.querySelectorAll('[data-roster-skeleton]')).toHaveLength(3),
    );
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(confirm().disabled).toBe(true);
    await act(async () => release(Response.json({ items: [{ userId: ANA, name: 'Ana' }] })));
    expect(document.querySelectorAll('[data-roster-skeleton]')).toHaveLength(0);
    expect(radios()).toHaveLength(1);
  });

  it('a failed roster read shows the inline line and a retry that reads it again', async () => {
    rosterAnswer = () => new Response(null, { status: 500 });
    renderSheet();
    await waitFor(() =>
      expect(screen.getByText('Não foi possível carregar a equipe.')).toBeTruthy(),
    );
    rosterAnswer = () => Response.json({ items: [{ userId: ANA, name: 'Ana' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Ana/ })).toBeTruthy());
    expect(screen.queryByText('Não foi possível carregar a equipe.')).toBeNull();
  });

  it('scrolls the list inside the sheet and keeps the footer outside the scroller (A02 backstop, classes)', async () => {
    renderSheet();
    await ready();
    const list = screen.getByRole('radiogroup').closest('[data-assign-scroll]') as HTMLElement;
    expect(list.className).toContain('overflow-y-auto');
    expect(list.className).toContain('min-h-0');
    expect(list.contains(confirm())).toBe(false);
  });

  it('"Cancelar" closes the sheet without calling the action', async () => {
    const { onClose } = renderSheet();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

describe('the tracer: the admin assigns from the sheet (CASE-08)', () => {
  it('sends assign with the expected state and the picked id, toasts the name, hands the fresh header back and closes', async () => {
    const answered = header({
      ownerUserId: ANA,
      ownerName: 'Ana',
      meta: 'Pagamento · Normal · Com Ana',
    });
    mocks.run.mockResolvedValue({ ok: true, header: answered });
    const { onHeader, onClose, onStale } = renderSheet();
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: /Ana/ }));
    await act(async () => {
      fireEvent.click(confirm());
    });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith(CONVERSATION_ID, {
      action: 'assign',
      expectedState: 'in_progress',
      expectedOwnerId: CARLA,
      assigneeUserId: ANA,
    });
    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Chamado #42 atribuído a Ana.',
    });
    expect(onHeader).toHaveBeenCalledWith(answered);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onStale).not.toHaveBeenCalled();
  });

  it('shows the spinner and blocks a second tap while the call is in flight', async () => {
    let release: (value: unknown) => void = () => {};
    mocks.run.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    renderSheet();
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: /Bruno Lima/ }));
    fireEvent.click(confirm());
    expect(confirm().disabled).toBe(true);
    expect(confirm().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(confirm());
    expect(mocks.run).toHaveBeenCalledTimes(1);
    await act(async () => release({ ok: false, error: 'failed' }));
  });

  it.each(['stale', 'closed', 'not_allowed'] as const)(
    'a %s answer toasts the stale sentence, re-reads the case and keeps the picked row',
    async (error) => {
      mocks.run.mockResolvedValue({ ok: false, error });
      const { onStale, onHeader, onClose } = renderSheet();
      await ready();
      fireEvent.click(screen.getByRole('radio', { name: /Ana/ }));
      await act(async () => {
        fireEvent.click(confirm());
      });
      expect(mocks.toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Este chamado mudou enquanto você olhava. A tela foi atualizada.',
      });
      expect(onStale).toHaveBeenCalledTimes(1);
      expect(onHeader).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('radio', { name: /Ana/ }).getAttribute('aria-checked')).toBe('true');
      expect(confirm().disabled).toBe(false);
    },
  );

  it.each(['invalid', 'failed'] as const)(
    'a %s answer toasts the generic failure and keeps the picked row',
    async (error) => {
      mocks.run.mockResolvedValue({ ok: false, error });
      const { onStale, onClose } = renderSheet();
      await ready();
      fireEvent.click(screen.getByRole('radio', { name: /Ana/ }));
      await act(async () => {
        fireEvent.click(confirm());
      });
      expect(mocks.toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não foi possível concluir. Tente de novo.',
      });
      expect(onStale).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('radio', { name: /Ana/ }).getAttribute('aria-checked')).toBe('true');
    },
  );

  it('a thrown action is the generic failure and the pick is kept', async () => {
    mocks.run.mockRejectedValue(new Error('boom'));
    renderSheet();
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: /Ana/ }));
    await act(async () => {
      fireEvent.click(confirm());
    });
    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível concluir. Tente de novo.',
    });
    expect(screen.getByRole('radio', { name: /Ana/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('the state sent is the one the sheet opened on, so a case that moved meanwhile is refused as stale', async () => {
    mocks.run.mockResolvedValue({ ok: false, error: 'stale' });
    const { rerender, tree } = renderSheet({
      header: header({ state: { ...header().state, state: 'open' }, ownerUserId: null }),
    });
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: /Ana/ }));
    // The live re-read says another person took it while the sheet was open.
    rerender(tree(true, header()));
    await act(async () => {
      fireEvent.click(confirm());
    });
    expect(mocks.run).toHaveBeenCalledWith(CONVERSATION_ID, {
      action: 'assign',
      expectedState: 'open',
      assigneeUserId: ANA,
    });
    // An unowned case sends no owner key at all, never null (WR-04).
    const sent = mocks.run.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.hasOwn(sent, 'expectedOwnerId')).toBe(false);
  });

  it('WR-04: the owner sent is the one the sheet opened on, so a live re-read that moves the owner is refused as stale', async () => {
    mocks.run.mockResolvedValue({ ok: false, error: 'stale' });
    const { rerender, tree, onStale, onClose } = renderSheet({
      header: header({ ownerUserId: CARLA }),
    });
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: /Ana/ }));
    // The live re-read says Bruno took the case while the sheet was open.
    rerender(tree(true, header({ ownerUserId: BRUNO, ownerName: 'Bruno Lima' })));
    await act(async () => {
      fireEvent.click(confirm());
    });
    expect(mocks.run).toHaveBeenCalledWith(CONVERSATION_ID, {
      action: 'assign',
      expectedState: 'in_progress',
      expectedOwnerId: CARLA,
      assigneeUserId: ANA,
    });
    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Este chamado mudou enquanto você olhava. A tela foi atualizada.',
    });
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: /Ana/ }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('the sheet closes and the draft goes (S11)', () => {
  it('hands the focus back to the control that opened it (UI-D-833)', async () => {
    const { rerender, tree } = renderSheet({ open: false });
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    rerender(tree(true, header()));
    await ready();
    expect(document.activeElement).not.toBe(opener);
    rerender(tree(false, header()));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('a reopened sheet starts with nothing picked', async () => {
    const { rerender, tree } = renderSheet();
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: /Ana/ }));
    rerender(tree(false, header()));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    rerender(tree(true, header()));
    await ready();
    expect(screen.getByRole('radio', { name: /Ana/ }).getAttribute('aria-checked')).toBe('false');
    expect(confirm().disabled).toBe(true);
  });
});
