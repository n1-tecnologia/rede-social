// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { adminStep } from '@/lib/profile-form/test-fixtures';

/**
 * 12.1-16 Task 2 (D-627, UI-D-645; PFORM-27, PFORM-42): the step sheet against the REAL catalog. The three
 * step actions, the router and the toast are stubbed. Asserted: create and rename, the disabled save, the
 * counter and the bounds, the pending state and the not-closable-while-saving rule, the dirty guard, a stale
 * revision, the delete block in its three states and the delete confirmation.
 */

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  show: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('./actions', () => ({
  createStepAction: (...args: unknown[]) => mocks.create(...args),
  renameStepAction: (...args: unknown[]) => mocks.rename(...args),
  deleteStepAction: (...args: unknown[]) => mocks.remove(...args),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock('@rede-social/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/ui')>()),
  useToast: () => ({ show: mocks.show, dismiss: vi.fn() }),
}));

const { StepSheet } = await import('./StepSheet');

const STEP = adminStep({ title: 'Sobre a sua clínica', revision: 4 });

function show(props: Partial<React.ComponentProps<typeof StepSheet>> = {}) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <StepSheet open mode="create" onClose={onClose} {...props} />
    </NextIntlClientProvider>,
  );
  return onClose;
}

const field = () => screen.getByLabelText('Título da etapa') as HTMLInputElement;
const save = () => screen.getByRole('button', { name: /^(Salvar etapa|Salvando…)$/ });
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const dialog = (name: string) => screen.getByRole('dialog', { name });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});
afterEach(cleanup);

describe('create mode', () => {
  it('opens "Nova etapa" with the one field, the placeholder and no description', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Nova etapa' })).toBeTruthy();
    expect(field().placeholder).toBe('Ex.: Sobre a sua clínica');
    expect(field().maxLength).toBe(60);
    expect(screen.getByText('0/60')).toBeTruthy();
    expect(document.querySelectorAll('input, textarea')).toHaveLength(1);
    // delete exists only in rename mode
    expect(screen.queryByRole('button', { name: 'Excluir etapa' })).toBeNull();
  });

  it('keeps "Salvar etapa" disabled until the title is not empty, and counts code points', () => {
    show();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    type('Sobre a sua clínica');
    expect((save() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('19/60')).toBeTruthy();
    type('');
    expect((save() as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the trimmed title, toasts, refreshes and closes', async () => {
    mocks.create.mockResolvedValue({ ok: true, step: STEP });
    const onClose = show();
    type('  Sobre a sua clínica  ');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.create).toHaveBeenCalledWith({ title: 'Sobre a sua clínica' });
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Etapa adicionada.' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says "Escreva o título da etapa." for a title of only spaces and sends nothing', async () => {
    show();
    type('   ');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(screen.getByText('Escreva o título da etapa.')).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('shows the server title issues under the field', async () => {
    mocks.create.mockResolvedValue({ ok: false, code: 'invalid', issue: 'too_long' });
    show();
    type('Etapa');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(screen.getByText('Use até 60 caracteres.')).toBeTruthy();
  });

  it('keeps the draft and shows the transport failure inside the sheet', async () => {
    mocks.create.mockResolvedValue({ ok: false, code: 'failed' });
    const onClose = show();
    type('Contato');
    await act(async () => {
      fireEvent.click(save());
    });
    const alert = document.querySelector('[data-step-failed]') as HTMLElement;
    expect(alert.textContent).toBe('Não foi possível salvar a etapa agora. Tente de novo.');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(field().value).toBe('Contato');
    expect(onClose).not.toHaveBeenCalled();
    // a thrown action reads the same
    mocks.create.mockRejectedValue(new Error('network'));
    await act(async () => {
      fireEvent.click(save());
    });
    expect(document.querySelector('[data-step-failed]')).toBeTruthy();
    expect(field().value).toBe('Contato');
  });

  it('answers the step limit refusal with the limit sentence, taking the number from the limits', async () => {
    mocks.create.mockResolvedValue({ ok: false, code: 'limit_reached' });
    const onClose = show();
    type('Contato');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Você chegou ao limite de 10 etapas. Exclua uma etapa vazia para adicionar outra.',
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends a lost permission and a module turned off to a refresh with their own toast', async () => {
    mocks.create.mockResolvedValue({ ok: false, code: 'forbidden' });
    const onClose = show();
    type('Contato');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Você não tem mais permissão para esta ação.',
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    mocks.show.mockReset();
    mocks.create.mockResolvedValue({ ok: false, code: 'moduleOff' });
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'O Formulário de perfil foi desativado para esta comunidade.',
    });
  });
});

describe('saving: the pending state and the close guard', () => {
  it('shows "Salvando…" and cannot be closed while the write runs', async () => {
    let release: (value: unknown) => void = () => {};
    mocks.create.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const onClose = show();
    type('Contato');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(save().textContent).toContain('Salvando…');
    expect((field().closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    // Escape and the backdrop reach requestClose, which refuses while saving
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Descartar as alterações?')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      release({ ok: true, step: STEP });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes at once when nothing was typed', () => {
    const onClose = show();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Descartar as alterações?')).toBeNull();
  });

  it('asks before discarding a typed title, with the step wording, and keeps the draft on "Continuar editando"', () => {
    const onClose = show();
    type('Contato');
    fireEvent.keyDown(document, { key: 'Escape' });
    const ask = dialog('Descartar as alterações?');
    expect(ask.textContent).toContain('As mudanças desta etapa ainda não foram salvas.');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Continuar editando' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(field().value).toBe('Contato');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(
      within(dialog('Descartar as alterações?')).getByRole('button', { name: 'Descartar' }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('rename mode', () => {
  it('opens "Renomear etapa" prefilled and saves with the stored revision', async () => {
    mocks.rename.mockResolvedValue({ ok: true, step: { ...STEP, revision: 5, title: 'Rotina' } });
    const onClose = show({ mode: 'rename', step: STEP, questionCount: 2, stepCount: 3 });
    expect(screen.getByRole('heading', { name: 'Renomear etapa' })).toBeTruthy();
    expect(field().value).toBe('Sobre a sua clínica');
    type('Rotina');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.rename).toHaveBeenCalledWith({ id: STEP.id, revision: 4, title: 'Rotina' });
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Etapa renomeada.' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without a write when the title did not change', async () => {
    const onClose = show({ mode: 'rename', step: STEP, questionCount: 1, stepCount: 3 });
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a stale revision refreshes and keeps the typed title in the open sheet, with the failure line', async () => {
    mocks.rename.mockResolvedValue({ ok: false, code: 'stale_revision' });
    const onClose = show({ mode: 'rename', step: STEP, questionCount: 1, stepCount: 3 });
    type('Rotina nova');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(field().value).toBe('Rotina nova');
    expect(document.querySelector('[data-step-failed]')?.textContent).toBe(
      'Não foi possível salvar a etapa agora. Tente de novo.',
    );
  });

  it('a stale revision retried after the page refreshed sends the newest revision', async () => {
    mocks.rename.mockResolvedValueOnce({ ok: false, code: 'stale_revision' });
    mocks.rename.mockResolvedValueOnce({ ok: true, step: STEP });
    const view = render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <StepSheet
          open
          mode="rename"
          step={STEP}
          questionCount={1}
          stepCount={3}
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    type('Rotina nova');
    await act(async () => {
      fireEvent.click(save());
    });
    // the page re-read: the host passes the step in its newest revision
    view.rerender(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <StepSheet
          open
          mode="rename"
          step={{ ...STEP, revision: 9 }}
          questionCount={1}
          stepCount={3}
          onClose={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.rename).toHaveBeenLastCalledWith({
      id: STEP.id,
      revision: 9,
      title: 'Rotina nova',
    });
  });
});

describe('the delete block (UI-D-645, T-12.1-09 prohibition: never delete a step with questions)', () => {
  it('offers "Excluir etapa" only for an empty step, and confirms with the danger dialog', async () => {
    mocks.remove.mockResolvedValue({ ok: true });
    const onClose = show({ mode: 'rename', step: STEP, questionCount: 0, stepCount: 3 });
    expect(screen.queryByText(/^Para excluir esta etapa/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir etapa' }));
    const ask = dialog('Excluir esta etapa?');
    expect(ask.textContent).toContain('Ela está vazia. A exclusão não pode ser desfeita.');
    expect(mocks.remove).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(within(ask).getByRole('button', { name: 'Excluir' }));
    });
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(STEP.id));
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Etapa excluída.' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the admin keeps the step', async () => {
    show({ mode: 'rename', step: STEP, questionCount: 0, stepCount: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir etapa' }));
    await act(async () => {
      fireEvent.click(
        within(dialog('Excluir esta etapa?')).getByRole('button', { name: 'Manter etapa' }),
      );
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('delete is absent for a step that holds questions: the sheet says what to do first', () => {
    show({ mode: 'rename', step: STEP, questionCount: 2, stepCount: 3 });
    expect(screen.queryByRole('button', { name: 'Excluir etapa' })).toBeNull();
    expect(
      screen.getByText('Para excluir esta etapa, mova ou arquive as perguntas dela primeiro.'),
    ).toBeTruthy();
  });

  it('delete is absent for the only step: a form needs at least one', () => {
    show({ mode: 'rename', step: STEP, questionCount: 0, stepCount: 1 });
    expect(screen.queryByRole('button', { name: 'Excluir etapa' })).toBeNull();
    expect(screen.getByText('Todo formulário precisa de pelo menos uma etapa.')).toBeTruthy();
  });

  it('a 409 because questions arrived toasts the sentence, refreshes and closes', async () => {
    mocks.remove.mockResolvedValue({ ok: false, code: 'step_not_empty' });
    const onClose = show({ mode: 'rename', step: STEP, questionCount: 0, stepCount: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir etapa' }));
    await act(async () => {
      fireEvent.click(
        within(dialog('Excluir esta etapa?')).getByRole('button', { name: 'Excluir' }),
      );
    });
    await waitFor(() =>
      expect(mocks.show).toHaveBeenCalledWith({
        tone: 'error',
        message: 'Esta etapa recebeu perguntas. Mova ou arquive antes de excluir.',
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a transport failure on delete toasts and keeps the sheet open', async () => {
    mocks.remove.mockRejectedValue(new Error('network'));
    const onClose = show({ mode: 'rename', step: STEP, questionCount: 0, stepCount: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir etapa' }));
    await act(async () => {
      fireEvent.click(
        within(dialog('Excluir esta etapa?')).getByRole('button', { name: 'Excluir' }),
      );
    });
    await waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1));
    expect(mocks.show.mock.calls[0]?.[0]).toMatchObject({
      tone: 'error',
      message: 'Não foi possível salvar a etapa agora. Tente de novo.',
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
