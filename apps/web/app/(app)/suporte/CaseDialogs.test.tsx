// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { StaffCaseHeaderView } from '@/lib/chat-view';
import type { StaffSheetKind } from './CaseActionSheet';
import type { CaseDialogRequest } from './useCaseActions';

/**
 * 12.4-15 (UI-D-827, D-843; UC S11 populated, S12): the four confirm dialogs of the team's bar. The bar, the
 * hook and the dialogs run together with the server action stubbed: resolve and reopen are brand, close is
 * the ONE danger dialog, a take-over of a live owner asks while an unowned case and one whose owner left the
 * staff are taken at once (the stored owner is still sent), every success and refusal toasts its sentence,
 * the dialog closes when the call settles and the focus goes back to the control that opened it.
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

const { CaseDialogs } = await import('./CaseDialogs');
const { StaffCaseBar } = await import('./StaffCaseBar');

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '44444444-4444-4444-8444-444444444444';

const STATE_VIEW = {
  open: { state: 'open', label: 'Aberto', tone: 'warning', glyph: 'CircleDot' },
  in_progress: { state: 'in_progress', label: 'Em atendimento', tone: 'brand', glyph: 'UserCheck' },
  resolved: { state: 'resolved', label: 'Resolvido', tone: 'success', glyph: 'CircleCheck' },
  closed: { state: 'closed', label: 'Fechado', tone: 'neutral', glyph: 'Lock' },
} as const;

const staffHeader = (
  state: keyof typeof STATE_VIEW,
  over: Partial<StaffCaseHeaderView> = {},
): StaffCaseHeaderView => ({
  viewer: 'staff',
  id: '33333333-3333-4333-8333-333333333333',
  number: 42,
  title: 'Chamado #42',
  state: STATE_VIEW[state],
  subject: 'Meu ingresso',
  subjectLine: '#42 · Meu ingresso',
  meta: 'Pagamento · Normal · Sem responsável',
  actions: [],
  ownerUserId: null,
  ownerName: null,
  ownerIsViewer: false,
  category: 'payment',
  priority: 'normal',
  typedSubject: 'Meu ingresso',
  openedAt: '2026-11-17T14:02:00.000Z',
  ...over,
});

const MINE = staffHeader('in_progress', {
  actions: ['assign', 'resolve', 'close', 'edit'],
  ownerUserId: OWNER_ID,
  ownerName: 'Carla Souza',
  ownerIsViewer: true,
});
const THEIRS = staffHeader('in_progress', {
  actions: ['take', 'assign', 'resolve', 'close', 'edit'],
  ownerUserId: OWNER_ID,
  ownerName: 'Carla Souza',
});
const OWNER_LEFT = staffHeader('in_progress', {
  actions: ['take', 'resolve', 'close'],
  ownerUserId: OWNER_ID,
  ownerName: null,
});
const RESOLVED = staffHeader('resolved', { actions: ['reopen', 'close', 'edit'] });

function renderBar(header: StaffCaseHeaderView) {
  const calls = {
    onHeader: vi.fn<(header: StaffCaseHeaderView) => void>(),
    onRefresh: vi.fn<() => void>(),
  };
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <StaffCaseBar
        conversationId={CONVERSATION_ID}
        header={header}
        onHeader={calls.onHeader}
        onRefresh={calls.onRefresh}
        onOpenSheet={vi.fn<(kind: StaffSheetKind) => void>()}
      />
    </NextIntlClientProvider>,
  );
  return calls;
}

const menu = () => screen.getByRole('button', { name: 'Mais ações' });

/** Opens the "Mais ações" sheet and taps one of its rows. */
function pickFromMenu(label: string) {
  fireEvent.click(menu());
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: label }));
}

/** The dialog on top: the sheet that opened it may still be animating out underneath. */
const dialog = () => screen.getAllByRole('dialog').at(-1) as HTMLElement;
const confirmButton = (name: string) => within(dialog()).getByRole('button', { name });

beforeEach(() => {
  mocks.run.mockReset();
  mocks.toast.show.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('the dialog words and tones (UI-D-827)', () => {
  const request = (
    kind: CaseDialogRequest['kind'],
    ownerName: string | null = null,
  ): CaseDialogRequest => ({
    kind,
    number: 42,
    ownerName,
    expectedState: 'open',
    expectedOwnerId: null,
  });

  function renderDialogs(dialogRequest: CaseDialogRequest | null) {
    return render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <CaseDialogs
          dialog={dialogRequest}
          onConfirm={vi.fn<() => void>()}
          onClose={vi.fn<() => void>()}
        />
      </NextIntlClientProvider>,
    );
  }

  it.each([
    [
      'resolve',
      'Marcar o chamado #42 como resolvido?',
      'O membro recebe um aviso. Se ele responder, o chamado volta a ficar aberto.',
      'Sim, resolver',
    ],
    [
      'close',
      'Fechar o chamado #42?',
      'A conversa fica só para leitura e ninguém poderá reabri-la. Se o membro escrever de novo, abre um novo chamado.',
      'Sim, fechar',
    ],
    [
      'reopen',
      'Reabrir o chamado #42?',
      'Ele volta para Em aberto, sem responsável. O membro não é avisado.',
      'Sim, reabrir',
    ],
  ] as const)('%s shows its title, body and confirm word', (kind, title, body, confirm) => {
    renderDialogs(request(kind));
    expect(within(dialog()).getByText(title)).toBeTruthy();
    expect(within(dialog()).getByText(body)).toBeTruthy();
    expect(confirmButton(confirm)).toBeTruthy();
    expect(confirmButton('Cancelar')).toBeTruthy();
  });

  it('the take-over names the owner in its body', () => {
    renderDialogs(request('take', 'Carla Souza'));
    expect(within(dialog()).getByText('Assumir o chamado #42?')).toBeTruthy();
    expect(
      within(dialog()).getByText('Hoje ele está com Carla Souza. Ele deixa de ser responsável.'),
    ).toBeTruthy();
  });

  it('only the close dialog is the danger tone', () => {
    const danger = (kind: CaseDialogRequest['kind'], confirm: string) => {
      const view = renderDialogs(request(kind, 'Carla'));
      const className = confirmButton(confirm).className;
      view.unmount();
      return className.includes('text-danger');
    };
    expect(danger('close', 'Sim, fechar')).toBe(true);
    expect(danger('resolve', 'Sim, resolver')).toBe(false);
    expect(danger('reopen', 'Sim, reabrir')).toBe(false);
    expect(danger('take', 'Sim, assumir')).toBe(false);
  });

  it('draws nothing while there is no request', () => {
    renderDialogs(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('resolve, close and reopen always ask first', () => {
  it('Resolver asks, sends the intent with the state shown, toasts and closes', async () => {
    mocks.run.mockResolvedValue({ ok: true, header: staffHeader('resolved') });
    const { onHeader } = renderBar(MINE);

    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    expect(within(dialog()).getByText('Marcar o chamado #42 como resolvido?')).toBeTruthy();
    expect(mocks.run).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(confirmButton('Sim, resolver'));
    });

    expect(mocks.run.mock.calls[0]).toEqual([
      CONVERSATION_ID,
      { action: 'resolve', expectedState: 'in_progress' },
    ]);
    expect(onHeader).toHaveBeenCalledTimes(1);
    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Chamado #42 resolvido.',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Fechar from the menu asks in the danger tone and toasts "fechado"', async () => {
    mocks.run.mockResolvedValue({ ok: true, header: staffHeader('closed') });
    renderBar(MINE);

    pickFromMenu('Fechar');
    expect(within(dialog()).getByText('Fechar o chamado #42?')).toBeTruthy();
    await act(async () => {
      fireEvent.click(confirmButton('Sim, fechar'));
    });

    expect(mocks.run.mock.calls[0]).toEqual([
      CONVERSATION_ID,
      { action: 'close', expectedState: 'in_progress' },
    ]);
    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Chamado #42 fechado.',
    });
  });

  it('Reabrir asks, sends the intent and toasts "reaberto"', async () => {
    mocks.run.mockResolvedValue({ ok: true, header: staffHeader('open') });
    renderBar(RESOLVED);

    fireEvent.click(screen.getByRole('button', { name: 'Reabrir' }));
    expect(within(dialog()).getByText('Reabrir o chamado #42?')).toBeTruthy();
    await act(async () => {
      fireEvent.click(confirmButton('Sim, reabrir'));
    });

    expect(mocks.run.mock.calls[0]).toEqual([
      CONVERSATION_ID,
      { action: 'reopen', expectedState: 'resolved' },
    ]);
    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Chamado #42 reaberto.',
    });
  });

  it('Cancelar sends nothing and closes', async () => {
    renderBar(MINE);
    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    fireEvent.click(confirmButton('Cancelar'));
    expect(mocks.run).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('the take-over (UI-D-827, A-UI-14, D-843, T-12.4-88)', () => {
  it('a live owner is named in a brand dialog and the stored owner is the expected one', async () => {
    mocks.run.mockResolvedValue({ ok: true, header: MINE });
    renderBar(THEIRS);

    fireEvent.click(screen.getByRole('button', { name: 'Assumir' }));
    expect(
      within(dialog()).getByText('Hoje ele está com Carla Souza. Ele deixa de ser responsável.'),
    ).toBeTruthy();
    expect(mocks.run).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(confirmButton('Sim, assumir'));
    });

    expect(mocks.run.mock.calls[0]).toEqual([
      CONVERSATION_ID,
      { action: 'take', expectedState: 'in_progress', expectedOwnerId: OWNER_ID },
    ]);
    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Chamado #42 assumido.',
    });
  });

  it('an owner who left the staff reads as unowned: no dialog, the stored owner still sent', async () => {
    mocks.run.mockResolvedValue({ ok: false, error: 'failed' });
    renderBar(OWNER_LEFT);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Assumir' }));
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.run.mock.calls[0]).toEqual([
      CONVERSATION_ID,
      { action: 'take', expectedState: 'in_progress', expectedOwnerId: OWNER_ID },
    ]);
  });

  it('an unowned case asks nothing', async () => {
    mocks.run.mockResolvedValue({ ok: false, error: 'failed' });
    renderBar(staffHeader('open', { actions: ['take', 'resolve', 'close'] }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Assumir' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
});

describe('refusals and focus', () => {
  it('a stale answer toasts the stale text, re-reads and closes the dialog', async () => {
    mocks.run.mockResolvedValue({ ok: false, error: 'stale' });
    const { onRefresh, onHeader } = renderBar(MINE);

    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    await act(async () => {
      fireEvent.click(confirmButton('Sim, resolver'));
    });

    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Este chamado mudou enquanto você olhava. A tela foi atualizada.',
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onHeader).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('any other failure toasts the generic sentence and keeps the state', async () => {
    mocks.run.mockResolvedValue({ ok: false, error: 'failed' });
    const { onRefresh, onHeader } = renderBar(MINE);

    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    await act(async () => {
      fireEvent.click(confirmButton('Sim, resolver'));
    });

    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível concluir. Tente de novo.',
    });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onHeader).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('both footer buttons are disabled while the call is pending', async () => {
    let release: (value: unknown) => void = () => {};
    mocks.run.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    renderBar(MINE);

    fireEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    await act(async () => {
      fireEvent.click(confirmButton('Sim, resolver'));
    });
    expect((confirmButton('Cancelar') as HTMLButtonElement).disabled).toBe(true);
    expect((confirmButton('Sim, resolver') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      release({ ok: false, error: 'failed' });
    });
  });

  it('focus returns to the primary button that opened the dialog', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderBar(MINE);
      const primary = screen.getByRole('button', { name: 'Resolver' });
      primary.focus();
      fireEvent.click(primary);
      fireEvent.click(confirmButton('Cancelar'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(document.activeElement).toBe(primary);
    } finally {
      vi.useRealTimers();
    }
  });

  it('focus returns to "Mais ações" when the dialog was opened from a menu row that left', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderBar(MINE);
      pickFromMenu('Fechar');
      fireEvent.click(confirmButton('Cancelar'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(document.activeElement).toBe(menu());
    } finally {
      vi.useRealTimers();
    }
  });
});
