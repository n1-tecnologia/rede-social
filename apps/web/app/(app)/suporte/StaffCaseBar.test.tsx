// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { StaffCaseHeaderView } from '@/lib/chat-view';
import type { StaffSheetKind } from './CaseActionSheet';

/**
 * 12.4-15 (UI-D-825, UI-D-826, UI-D-827, D-806, D-845; UC S09, S10, S12): the team's case bar and its action
 * sheet. The bar is controlled by the finished staff header (plans 11 and 20); the server action is a stub,
 * the toast is a spy and the catalog is the real pt-BR one. The tracer ("the team takes an unowned case")
 * runs through a stateful harness so the bar follows what the server answered, exactly like the thread.
 * The web workspace has no jest-dom: plain DOM assertions only.
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

const { StaffCaseBar } = await import('./StaffCaseBar');

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const CASE_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_ID = '44444444-4444-4444-8444-444444444444';

type CaseState = 'open' | 'in_progress' | 'resolved' | 'closed';

const STATE_VIEW: Record<CaseState, StaffCaseHeaderView['state']> = {
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

const staffHeader = (
  state: CaseState,
  over: Partial<StaffCaseHeaderView> = {},
): StaffCaseHeaderView => ({
  viewer: 'staff',
  id: CASE_ID,
  number: 42,
  title: 'Chamado #42',
  state: STATE_VIEW[state],
  subject: 'Meu ingresso não chegou',
  subjectLine: '#42 · Meu ingresso não chegou',
  meta: 'Pagamento · Normal · Sem responsável',
  actions: [],
  ownerUserId: null,
  ownerName: null,
  ownerIsViewer: false,
  ...over,
});

const OPEN = staffHeader('open', { actions: ['take', 'assign', 'resolve', 'close', 'edit'] });
const MINE = staffHeader('in_progress', {
  meta: 'Pagamento · Normal · Com você',
  actions: ['assign', 'resolve', 'close', 'edit'],
  ownerUserId: OWNER_ID,
  ownerName: 'Carla Souza',
  ownerIsViewer: true,
});
const THEIRS = staffHeader('in_progress', {
  meta: 'Pagamento · Normal · Com Carla',
  actions: ['take', 'assign', 'resolve', 'close', 'edit'],
  ownerUserId: OWNER_ID,
  ownerName: 'Carla Souza',
});
const RESOLVED = staffHeader('resolved', { actions: ['reopen', 'close', 'edit'] });
const CLOSED = staffHeader('closed', { actions: [] });

interface Calls {
  onHeader: Mock<(header: StaffCaseHeaderView) => void>;
  onRefresh: Mock<() => void>;
  onOpenSheet: Mock<(kind: StaffSheetKind) => void>;
}

function renderBar(header: StaffCaseHeaderView, calls?: Partial<Calls>) {
  const all: Calls = {
    onHeader: vi.fn<(header: StaffCaseHeaderView) => void>(),
    onRefresh: vi.fn<() => void>(),
    onOpenSheet: vi.fn<(kind: StaffSheetKind) => void>(),
    ...calls,
  };
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <StaffCaseBar
        conversationId={CONVERSATION_ID}
        header={header}
        onHeader={all.onHeader}
        onRefresh={all.onRefresh}
        onOpenSheet={all.onOpenSheet}
      />
    </NextIntlClientProvider>,
  );
  return all;
}

/** The bar held in state, so an answered header redraws it like the thread pane does. */
function Harness({ initial, onRefresh }: { initial: StaffCaseHeaderView; onRefresh: () => void }) {
  const [header, setHeader] = useState(initial);
  return (
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <StaffCaseBar
        conversationId={CONVERSATION_ID}
        header={header}
        onHeader={setHeader}
        onRefresh={onRefresh}
        onOpenSheet={vi.fn()}
      />
    </NextIntlClientProvider>
  );
}

const menu = () => screen.getByRole('button', { name: 'Mais ações' });

function openMenu() {
  fireEvent.click(menu());
  return screen.getByRole('dialog');
}

beforeEach(() => {
  mocks.run.mockReset();
  mocks.toast.show.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('the bar: two rows, one details button and the primary action (UI-D-825)', () => {
  it('row 1 is ONE button naming the case that opens the details sheet', () => {
    const { onOpenSheet } = renderBar(OPEN);
    const button = screen.getByRole('button', { name: 'Ver detalhes do chamado #42' });
    expect(button.textContent).toContain('#42');
    expect(button.textContent).toContain('Meu ingresso não chegou');
    expect(button.textContent).toContain('Aberto');
    expect(button.className).toContain('min-h-11');
    fireEvent.click(button);
    expect(onOpenSheet).toHaveBeenCalledWith('details');
  });

  it('row 2 holds the meta text, the primary action and the 44px "Mais ações" button', () => {
    renderBar(OPEN);
    const bar = document.querySelector('[data-case-bar]') as HTMLElement;
    expect(bar.getAttribute('data-case-staff')).not.toBeNull();
    expect(within(bar).getByText('Pagamento · Normal · Sem responsável')).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Assumir' })).toBeTruthy();
    expect(menu().className).toContain('min-w-[44px]');
  });

  it('truncates the subject and the meta on one line each while the controls keep their size', () => {
    renderBar(OPEN);
    const subject = screen.getByText('Meu ingresso não chegou');
    expect(subject.className).toContain('truncate');
    const meta = screen.getByText('Pagamento · Normal · Sem responsável');
    expect(meta.className).toContain('truncate');
    expect(menu().className).toContain('shrink-0');
    expect(screen.getByRole('button', { name: 'Assumir' }).className).toContain('shrink-0');
  });

  it.each([
    ['an unowned open case', OPEN, 'Assumir', 'brand'],
    ['a case the viewer owns', MINE, 'Resolver', 'outline'],
    ['a case owned by someone else', THEIRS, 'Assumir', 'outline'],
    ['a resolved case', RESOLVED, 'Reabrir', 'outline'],
  ])('draws the primary action for %s', (_name, header, label, variant) => {
    renderBar(header);
    const primary = screen.getByRole('button', { name: label });
    // The shipped button carries its variant as a class hook: `brand` is the filled one.
    expect(primary.className).toContain(`ui-btn-${variant}`);
  });

  it('a closed case keeps both rows with no primary action', () => {
    renderBar(CLOSED);
    expect(document.querySelector('[data-case-bar]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Ver detalhes do chamado #42' })).toBeTruthy();
    for (const label of ['Assumir', 'Resolver', 'Reabrir', 'Fechar']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    expect(menu()).toBeTruthy();
  });

  it('draws no primary when the server did not list the verb (nothing is decided here)', () => {
    renderBar(staffHeader('open', { actions: [] }));
    expect(screen.queryByRole('button', { name: 'Assumir' })).toBeNull();
    expect(screen.getByText('Pagamento · Normal · Sem responsável')).toBeTruthy();
  });
});

describe('the action sheet draws only what the server listed (UI-D-826, T-12.4-69)', () => {
  const rows = () =>
    within(screen.getByRole('dialog'))
      .getAllByRole('button')
      .map((button) => button.textContent);

  it('lists the server actions in its order plus the details row, nothing else', () => {
    renderBar(OPEN);
    openMenu();
    expect(rows()).toEqual([
      'Assumir',
      'Atribuir a…',
      'Resolver',
      'Fechar',
      'Editar categoria, assunto e prioridade',
      'Ver detalhes e histórico',
    ]);
  });

  it('omits "Atribuir a…" when the server did not list assign', () => {
    renderBar(staffHeader('open', { actions: ['take', 'resolve', 'close', 'edit'] }));
    openMenu();
    expect(rows()).not.toContain('Atribuir a…');
    expect(rows()).toContain('Assumir');
  });

  it('omits "Editar…" when the server did not list edit', () => {
    renderBar(staffHeader('open', { actions: ['take', 'resolve', 'close'] }));
    openMenu();
    expect(rows().some((row) => row?.startsWith('Editar'))).toBe(false);
  });

  it('a resolved case lists Reabrir, never Assumir or Resolver', () => {
    renderBar(RESOLVED);
    openMenu();
    expect(rows()).toEqual([
      'Reabrir',
      'Fechar',
      'Editar categoria, assunto e prioridade',
      'Ver detalhes e histórico',
    ]);
  });

  it('a closed case holds the details row alone', () => {
    renderBar(CLOSED);
    openMenu();
    expect(rows()).toEqual(['Ver detalhes e histórico']);
  });

  it('"Fechar" carries the danger class, no row is disabled and nothing hands a case back (A-UI-10)', () => {
    renderBar(MINE);
    const dialog = openMenu();
    const close = within(dialog).getByRole('button', { name: 'Fechar' });
    expect(close.className).toContain('text-danger');
    for (const row of within(dialog).getAllByRole('button')) {
      expect((row as HTMLButtonElement).disabled).toBe(false);
    }
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((row) => row.textContent),
    ).toEqual([
      'Atribuir a…',
      'Resolver',
      'Fechar',
      'Editar categoria, assunto e prioridade',
      'Ver detalhes e histórico',
    ]);
  });

  it.each([
    ['Atribuir a…', 'assign'],
    ['Editar categoria, assunto e prioridade', 'edit'],
    ['Ver detalhes e histórico', 'details'],
  ])('the row "%s" closes the sheet and calls onOpenSheet(%s)', async (label, kind) => {
    const { onOpenSheet } = renderBar(OPEN);
    const dialog = openMenu();
    fireEvent.click(within(dialog).getByRole('button', { name: label }));
    expect(onOpenSheet).toHaveBeenCalledWith(kind);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('tracer: the team takes an unowned case from the bar (UI-D-826, UI-D-827, D-845)', () => {
  it('taps Assumir with no dialog, shows the spinner, then Em atendimento owned by the viewer', async () => {
    let release: (value: unknown) => void = () => {};
    mocks.run.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    render(<Harness initial={OPEN} onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Assumir' }));

    // No confirm dialog for an unowned case, and the server hears the intent plus the screen's state only.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0]).toEqual([
      CONVERSATION_ID,
      { action: 'take', expectedState: 'open' },
    ]);
    // The shipped spinner is on the primary button, which is disabled with the menu.
    const busy = screen.getByRole('button', { name: 'Assumir' }) as HTMLButtonElement;
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.disabled).toBe(true);
    expect((menu() as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      release({ ok: true, header: staffHeader('in_progress', { ...MINE, actions: MINE.actions }) });
    });

    expect(screen.getByText('Em atendimento')).toBeTruthy();
    expect(screen.getByText('Pagamento · Normal · Com você')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resolver' })).toBeTruthy();
    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Chamado #42 assumido.',
    });
  });

  it('the same tap answered stale shows the stale toast and re-reads the case', async () => {
    mocks.run.mockResolvedValue({ ok: false, error: 'stale' });
    const onRefresh = vi.fn();
    render(<Harness initial={OPEN} onRefresh={onRefresh} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Assumir' }));
    });

    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Este chamado mudou enquanto você olhava. A tela foi atualizada.',
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    // The bar is not left spinning and keeps what the screen showed until the re-read lands.
    expect((screen.getByRole('button', { name: 'Assumir' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
