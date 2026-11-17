// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { StaffCaseHeaderView } from '@/lib/chat-view';

/**
 * 12.4-19 Task 2 (UI-D-827, D-811, D-812, CASE-10; UC S11 populated): the edit sheet. The server action is
 * stubbed and the catalog is the real pt-BR one.
 *
 * Pinned here: the five category chips with exactly one pressed, the subject prefilled with the TYPED subject
 * only, the priority group, "Salvar alterações" disabled until something changed, ONLY the changed fields sent
 * (a blanked subject as null), the success toast, a stale or failed answer keeping every draft value, and the
 * focus going back to the opener.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const mocks = vi.hoisted(() => ({
  edit: vi.fn(),
  toast: { show: vi.fn(), dismiss: vi.fn() },
}));

MotionGlobalConfig.skipAnimations = true;

vi.mock('./actions', () => ({
  editCaseAction: (...args: unknown[]) => mocks.edit(...args),
}));
vi.mock('@rede-social/ui', async (orig) => ({
  ...(await orig<typeof import('@rede-social/ui')>()),
  useToast: () => mocks.toast,
}));

const { EditCaseSheet } = await import('./EditCaseSheet');

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const CASE_ID = '33333333-3333-4333-8333-333333333333';

const header = (over: Partial<StaffCaseHeaderView> = {}): StaffCaseHeaderView => ({
  viewer: 'staff',
  id: CASE_ID,
  number: 42,
  title: 'Chamado #42',
  state: { state: 'in_progress', label: 'Em atendimento', tone: 'brand', glyph: 'UserCheck' },
  subject: 'Cobrança duplicada',
  subjectLine: '#42 · Cobrança duplicada',
  meta: 'Pagamento · Normal · Com Carla',
  actions: ['take', 'resolve', 'close', 'edit'],
  ownerUserId: null,
  ownerName: null,
  ownerIsViewer: false,
  category: 'payment',
  priority: 'normal',
  typedSubject: 'Cobrança duplicada',
  openedAt: '2026-11-17T14:02:00.000Z',
  ...over,
});

function renderSheet(over: { header?: StaffCaseHeaderView; open?: boolean } = {}) {
  const calls = {
    onClose: vi.fn<() => void>(),
    onHeader: vi.fn<(next: StaffCaseHeaderView) => void>(),
    onStale: vi.fn<() => void>(),
  };
  const tree = (open: boolean, current: StaffCaseHeaderView) => (
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <button type="button">opener</button>
      <EditCaseSheet
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

const save = () => screen.getByRole('button', { name: 'Salvar alterações' }) as HTMLButtonElement;
const subject = () => screen.getByLabelText('Assunto') as HTMLInputElement;
const categoryGroup = () => screen.getByRole('group', { name: 'Categoria' });
const priorityGroup = () => screen.getByRole('group', { name: 'Prioridade' });
const chip = (group: HTMLElement, name: string) => within(group).getByRole('button', { name });
const pressed = (group: HTMLElement) =>
  within(group)
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent);

beforeEach(() => {
  mocks.edit.mockReset();
  mocks.toast.show.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('the edit sheet (UI-D-827)', () => {
  it('is titled with the case number and has Cancelar next to "Salvar alterações"', () => {
    renderSheet();
    expect(screen.getByRole('dialog', { name: 'Editar chamado #42' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });

  it('draws the five category chips in the fixed order with the current one pressed (and only it)', () => {
    renderSheet({ header: header({ category: 'events' }) });
    expect(
      within(categoryGroup())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Check-in', 'Eventos', 'Pagamento', 'Conta', 'Outro']);
    expect(pressed(categoryGroup())).toEqual(['Eventos']);
  });

  it('keeps exactly one category pressed: a tap moves it and a tap on the pressed one keeps it', () => {
    renderSheet();
    expect(pressed(categoryGroup())).toEqual(['Pagamento']);
    fireEvent.click(chip(categoryGroup(), 'Conta'));
    expect(pressed(categoryGroup())).toEqual(['Conta']);
    fireEvent.click(chip(categoryGroup(), 'Conta'));
    expect(pressed(categoryGroup())).toEqual(['Conta']);
  });

  it('draws the three priority chips in a group labelled "Prioridade" with the current one selected', () => {
    renderSheet({ header: header({ priority: 'high' }) });
    expect(
      within(priorityGroup())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Baixa', 'Normal', 'Alta']);
    expect(pressed(priorityGroup())).toEqual(['Alta']);
    fireEvent.click(chip(priorityGroup(), 'Baixa'));
    expect(pressed(priorityGroup())).toEqual(['Baixa']);
    fireEvent.click(chip(priorityGroup(), 'Baixa'));
    expect(pressed(priorityGroup())).toEqual(['Baixa']);
  });

  it('prefills the TYPED subject, with the placeholder, the 80-character cap and the helper line', () => {
    renderSheet();
    expect(subject().value).toBe('Cobrança duplicada');
    expect(subject().maxLength).toBe(80);
    expect(subject().placeholder).toBe('Resuma em uma frase');
    expect(screen.getByText('Em branco, usamos o começo da primeira mensagem.')).toBeTruthy();
    expect(subject().getAttribute('aria-describedby')).toBeTruthy();
  });

  it('prefills nothing for a case that shows only the first-message fallback', () => {
    renderSheet({
      header: header({ typedSubject: null, subject: 'Meu ingresso não chegou' }),
    });
    expect(subject().value).toBe('');
    expect(save().disabled).toBe(true);
  });

  it('keeps "Salvar alterações" disabled until something changed, and again when it is put back', () => {
    renderSheet();
    expect(save().disabled).toBe(true);
    fireEvent.click(chip(priorityGroup(), 'Alta'));
    expect(save().disabled).toBe(false);
    fireEvent.click(chip(priorityGroup(), 'Normal'));
    expect(save().disabled).toBe(true);
    fireEvent.change(subject(), { target: { value: 'Outro assunto' } });
    expect(save().disabled).toBe(false);
    fireEvent.change(subject(), { target: { value: 'Cobrança duplicada' } });
    expect(save().disabled).toBe(true);
  });

  it('"Cancelar" closes the sheet without calling the action', () => {
    const { onClose } = renderSheet();
    fireEvent.click(chip(priorityGroup(), 'Alta'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.edit).not.toHaveBeenCalled();
  });
});

describe('what the edit sends (D-812, T-12.4-90)', () => {
  beforeEach(() => {
    mocks.edit.mockResolvedValue({ ok: true, header: header({ category: 'events' }) });
  });

  it('a category-only change sends the expected state and the category, nothing else', async () => {
    renderSheet();
    fireEvent.click(chip(categoryGroup(), 'Eventos'));
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.edit).toHaveBeenCalledTimes(1);
    expect(mocks.edit).toHaveBeenCalledWith(CONVERSATION_ID, {
      expectedState: 'in_progress',
      category: 'events',
    });
  });

  it('a blanked subject is sent as null and nothing else', async () => {
    renderSheet();
    fireEvent.change(subject(), { target: { value: '' } });
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.edit).toHaveBeenCalledWith(CONVERSATION_ID, {
      expectedState: 'in_progress',
      subject: null,
    });
  });

  it('a subject made of spaces only counts as blank', async () => {
    renderSheet();
    fireEvent.change(subject(), { target: { value: '   ' } });
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.edit).toHaveBeenCalledWith(CONVERSATION_ID, {
      expectedState: 'in_progress',
      subject: null,
    });
  });

  it('a priority-only change sends the priority alone', async () => {
    renderSheet();
    fireEvent.click(chip(priorityGroup(), 'Alta'));
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.edit).toHaveBeenCalledWith(CONVERSATION_ID, {
      expectedState: 'in_progress',
      priority: 'high',
    });
  });

  it('a new subject is sent trimmed, together with the other fields that changed', async () => {
    renderSheet();
    fireEvent.change(subject(), { target: { value: '  Reembolso  ' } });
    fireEvent.click(chip(categoryGroup(), 'Conta'));
    fireEvent.click(chip(priorityGroup(), 'Baixa'));
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.edit).toHaveBeenCalledWith(CONVERSATION_ID, {
      expectedState: 'in_progress',
      category: 'account',
      subject: 'Reembolso',
      priority: 'low',
    });
  });

  it('typing a subject on a case that had none sends it', async () => {
    renderSheet({ header: header({ typedSubject: null, subject: 'Meu ingresso não chegou' }) });
    fireEvent.change(subject(), { target: { value: 'Ingresso' } });
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.edit).toHaveBeenCalledWith(CONVERSATION_ID, {
      expectedState: 'in_progress',
      subject: 'Ingresso',
    });
  });

  it('sends the state the sheet opened on, so a case that moved meanwhile is refused as stale', async () => {
    const { rerender, tree } = renderSheet({
      header: header({ state: { ...header().state, state: 'resolved' } }),
    });
    fireEvent.click(chip(priorityGroup(), 'Alta'));
    rerender(tree(true, header()));
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.edit).toHaveBeenCalledWith(CONVERSATION_ID, {
      expectedState: 'resolved',
      priority: 'high',
    });
  });
});

describe('the answers (UI-D-827)', () => {
  it('success toasts "Alterações salvas.", hands the fresh header back and closes', async () => {
    const answered = header({ priority: 'high', meta: 'Pagamento · Alta · Com Carla' });
    mocks.edit.mockResolvedValue({ ok: true, header: answered });
    const { onHeader, onClose, onStale } = renderSheet();
    fireEvent.click(chip(priorityGroup(), 'Alta'));
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Alterações salvas.',
    });
    expect(onHeader).toHaveBeenCalledWith(answered);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onStale).not.toHaveBeenCalled();
  });

  it('shows the spinner and blocks a second tap while the call is in flight', async () => {
    let release: (value: unknown) => void = () => {};
    mocks.edit.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    renderSheet();
    fireEvent.click(chip(priorityGroup(), 'Alta'));
    fireEvent.click(save());
    expect(save().disabled).toBe(true);
    expect(save().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(save());
    expect(mocks.edit).toHaveBeenCalledTimes(1);
    await act(async () => release({ ok: false, error: 'failed' }));
  });

  it.each(['stale', 'closed', 'not_allowed'] as const)(
    'a %s answer toasts the stale sentence, re-reads the case and keeps every draft value',
    async (error) => {
      mocks.edit.mockResolvedValue({ ok: false, error });
      const { onStale, onHeader, onClose } = renderSheet();
      fireEvent.click(chip(categoryGroup(), 'Conta'));
      fireEvent.change(subject(), { target: { value: 'Novo assunto' } });
      fireEvent.click(chip(priorityGroup(), 'Alta'));
      await act(async () => {
        fireEvent.click(save());
      });
      expect(mocks.toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Este chamado mudou enquanto você olhava. A tela foi atualizada.',
      });
      expect(onStale).toHaveBeenCalledTimes(1);
      expect(onHeader).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(pressed(categoryGroup())).toEqual(['Conta']);
      expect(pressed(priorityGroup())).toEqual(['Alta']);
      expect(subject().value).toBe('Novo assunto');
      expect(save().disabled).toBe(false);
    },
  );

  it.each(['invalid', 'failed'] as const)(
    'a %s answer toasts the generic failure and keeps every draft value',
    async (error) => {
      mocks.edit.mockResolvedValue({ ok: false, error });
      const { onStale, onClose } = renderSheet();
      fireEvent.change(subject(), { target: { value: 'Novo assunto' } });
      await act(async () => {
        fireEvent.click(save());
      });
      expect(mocks.toast.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Não foi possível concluir. Tente de novo.',
      });
      expect(onStale).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(subject().value).toBe('Novo assunto');
    },
  );

  it('a thrown action is the generic failure and the draft is kept', async () => {
    mocks.edit.mockRejectedValue(new Error('boom'));
    renderSheet();
    fireEvent.click(chip(priorityGroup(), 'Alta'));
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.toast.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível concluir. Tente de novo.',
    });
    expect(pressed(priorityGroup())).toEqual(['Alta']);
  });
});

describe('the sheet closes and the draft goes (S11)', () => {
  it('a reopened sheet starts from the case again, not from the abandoned draft', async () => {
    const { rerender, tree } = renderSheet();
    fireEvent.click(chip(priorityGroup(), 'Alta'));
    fireEvent.change(subject(), { target: { value: 'Rascunho' } });
    rerender(tree(false, header()));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    rerender(tree(true, header()));
    expect(pressed(priorityGroup())).toEqual(['Normal']);
    expect(subject().value).toBe('Cobrança duplicada');
    expect(save().disabled).toBe(true);
  });

  it('hands the focus back to the control that opened it (UI-D-833)', async () => {
    const { rerender, tree } = renderSheet({ open: false });
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    rerender(tree(true, header()));
    expect(document.activeElement).not.toBe(opener);
    rerender(tree(false, header()));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('scrolls its body inside the sheet and keeps the footer outside the scroller', () => {
    renderSheet();
    const scroller = subject().closest('[data-edit-scroll]') as HTMLElement;
    expect(scroller.className).toContain('overflow-y-auto');
    expect(scroller.contains(save())).toBe(false);
  });
});
