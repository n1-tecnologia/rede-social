// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { adminBranch, adminQuestion, adminStep, uuid } from '@/lib/profile-form/test-fixtures';

/**
 * 12.2-16 Task 2 (D-640, D-642, D-644, D-651; UI-D-671, UI-D-682, UI-D-683, UI-D-684; PFORM-57): the branch sheet
 * in create mode against the REAL catalog. The action, the router and the toast are stubbed. Asserted: the
 * read-only opener (with the step pill from two steps), the answers picker, the optional name counted in code
 * points, "Salvar ramo" disabled until one answer is ticked, a blank name sent as no name, the validation lines
 * (`role="alert"`, `aria-invalid`, `aria-describedby`), the limit and depth lines, the transport failure, the
 * dirty guard and discard dialog, the pending state and the not-closable-while-saving rule.
 */

const mocks = vi.hoisted(() => ({ create: vi.fn(), refresh: vi.fn(), show: vi.fn() }));

MotionGlobalConfig.skipAnimations = true;
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('./actions', () => ({
  createBranchAction: (...args: unknown[]) => mocks.create(...args),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock('@rede-social/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/ui')>()),
  useToast: () => ({ show: mocks.show, dismiss: vi.fn() }),
}));

const { BranchSheet } = await import('./BranchSheet');

const A = uuid(9601);
const B = uuid(9602);
const C = uuid(9603);
const S1 = adminStep({ title: 'Informações gerais' });
const S2 = adminStep({ title: 'Sobre a sua clínica' });
const OPENER = adminQuestion('single_choice', {
  title: 'Você tem clínica, trabalha em clínica ou está aprendendo?',
  stepId: S2.id,
  options: [
    { id: A, label: 'Tenho uma clínica', answerCount: 0 },
    { id: B, label: 'Trabalho em uma clínica', answerCount: 0 },
    { id: C, label: 'Estou aprendendo', answerCount: 0 },
  ],
});
const YESNO = adminQuestion('yes_no', { title: 'A clínica tem equipe?', stepId: S1.id });
const SAVED = adminBranch({ openerQuestionId: OPENER.id, values: [A], name: 'Quem tem clínica' });

function show(props: Partial<React.ComponentProps<typeof BranchSheet>> = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <BranchSheet
        open
        opener={OPENER}
        steps={[S1, S2]}
        onClose={onClose}
        onSaved={onSaved}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onClose, onSaved };
}

const nameField = () => screen.getByLabelText('Nome do ramo (opcional)') as HTMLInputElement;
const save = () => screen.getByRole('button', { name: /^(Salvar ramo|Salvando…)$/ });
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (value: string) => fireEvent.change(nameField(), { target: { value } });
const dialog = (name: string) => screen.getByRole('dialog', { name });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.create.mockResolvedValue({ ok: true, branch: SAVED });
});
afterEach(cleanup);

describe('the layout of create mode (UI-D-671)', () => {
  it('opens "Novo ramo" with the opener read-only, the answers and the optional name, in that order', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Novo ramo' })).toBeTruthy();
    const form = dialog('Novo ramo').querySelector('form') as HTMLFormElement;
    const opener = form.querySelector('[data-branch-opener]') as HTMLElement;
    const picker = screen.getByRole('group', { name: 'Mostrar quando a resposta for' });
    expect(opener.textContent).toContain(
      'Você tem clínica, trabalha em clínica ou está aprendendo?',
    );
    expect(opener.textContent).toContain('Pergunta que decide');
    expect(form.querySelector('select')).toBeNull();
    expect(opener.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      picker.compareDocumentPosition(nameField()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Desfazer ramo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Arquivar ramo' })).toBeNull();
  });

  it('names the step of the opener in a neutral pill only with two or more steps', () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <BranchSheet open opener={OPENER} steps={[S1, S2]} onClose={vi.fn()} onSaved={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Etapa 2')).toBeTruthy();
    unmount();
    cleanup();
    render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <BranchSheet open opener={OPENER} steps={[S2]} onClose={vi.fn()} onSaved={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(/^Etapa \d/)).toBeNull();
  });

  it('shows the name field with its placeholder, helper, 60 limit and a 0/60 counter', () => {
    show();
    expect(nameField().placeholder).toBe('Ex.: Quem tem clínica');
    expect(nameField().maxLength).toBe(60);
    expect(screen.getByText('0/60')).toBeTruthy();
    expect(
      screen.getByText(
        'O nome só aparece para você, no construtor e no Fluxo. Os membros não o veem.',
      ),
    ).toBeTruthy();
  });

  it('uses the yes/no control with one value for a Sim ou não opener', () => {
    show({ opener: YESNO });
    const group = screen.getByRole('group', { name: 'Mostrar quando a resposta for' });
    expect(within(group).getByRole('button', { name: 'Sim' })).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('renders a hostile opener title and name as text, long titles wrapping', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    show({ opener: { ...OPENER, title: `${hostile} ${'palavra'.repeat(20)}` } });
    expect(document.querySelector('img')).toBeNull();
    const opener = document.querySelector('[data-branch-opener] .break-words') as HTMLElement;
    expect(opener.textContent).toContain(hostile);
  });
});

describe('"Salvar ramo" and the body (PFORM-57 empty)', () => {
  it('is disabled until one answer is ticked, and enabled after', () => {
    show();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(box('Tenho uma clínica'));
    expect((save() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(box('Tenho uma clínica'));
    expect((save() as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends the opener, the answers in the opener order and the trimmed name, then toasts and hands the branch on', async () => {
    const { onSaved, onClose } = show();
    fireEvent.click(box('Estou aprendendo'));
    fireEvent.click(box('Tenho uma clínica'));
    type('  Quem tem clínica  ');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith({
      openerQuestionId: OPENER.id,
      values: [A, C],
      name: 'Quem tem clínica',
    });
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Ramo criado.' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(SAVED);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends no name at all for a blank or whitespace name', async () => {
    show();
    fireEvent.click(box('Trabalho em uma clínica'));
    type('     ');
    await act(async () => {
      fireEvent.click(save());
    });
    const body = mocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toEqual({ openerQuestionId: OPENER.id, values: [B] });
    expect('name' in body).toBe(false);
  });

  it('sends a yes/no answer as the literal token', async () => {
    show({ opener: YESNO });
    fireEvent.click(screen.getByRole('button', { name: 'Não' }));
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.create).toHaveBeenCalledWith({ openerQuestionId: YESNO.id, values: ['false'] });
  });

  it('lists every option of an opener with 20 of them, ticks run from 1 to 20', async () => {
    const wide = adminQuestion('multiple_choice', {
      title: 'Muitas opções',
      options: Array.from({ length: 20 }, (_, at) => ({
        id: uuid(9700 + at),
        label: `Opção ${at + 1}`,
        answerCount: 0,
      })),
    });
    show({ opener: wide });
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(20);
    for (const each of boxes) fireEvent.click(each);
    await act(async () => {
      fireEvent.click(save());
    });
    const sent = mocks.create.mock.calls[0]?.[0] as { values: string[] };
    expect(sent.values).toHaveLength(20);
  });
});

describe('the name is counted in code points (PFORM-57 encoding)', () => {
  it('counts the emoji one by one and accepts exactly 60', async () => {
    show();
    fireEvent.click(box('Tenho uma clínica'));
    type('😀'.repeat(60));
    expect(screen.getByText('60/60')).toBeTruthy();
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const sent = mocks.create.mock.calls[0]?.[0] as { name: string };
    expect(sent.name).toBe('😀'.repeat(60));
  });

  it('refuses 61 under the field with the sentence, wired by aria, and sends nothing', async () => {
    show();
    fireEvent.click(box('Tenho uma clínica'));
    type('😀'.repeat(61));
    expect(screen.getByText('61/60')).toBeTruthy();
    await act(async () => {
      fireEvent.click(save());
    });
    const line = screen.getByText('Use até 60 caracteres.');
    expect(line.getAttribute('role')).toBe('alert');
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
    expect(nameField().getAttribute('aria-describedby')).toContain(line.id);
    expect(mocks.create).not.toHaveBeenCalled();
    // The line goes away as soon as the name is edited.
    type('😀'.repeat(10));
    expect(screen.queryByText('Use até 60 caracteres.')).toBeNull();
  });

  it('puts a control character the server refuses under the name field too', async () => {
    mocks.create.mockResolvedValue({ ok: false, code: 'invalid', fields: { name: 'invalid' } });
    show();
    fireEvent.click(box('Tenho uma clínica'));
    type('Nome\u0007');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(screen.getByRole('alert').textContent).toBe('Use até 60 caracteres.');
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
  });

  it('puts a refused answer list under the picker', async () => {
    mocks.create.mockResolvedValue({
      ok: false,
      code: 'invalid',
      fields: { values: 'condition_invalid' },
    });
    show();
    fireEvent.click(box('Tenho uma clínica'));
    await act(async () => {
      fireEvent.click(save());
    });
    const line = screen.getByText('Escolha pelo menos uma resposta que abre este ramo.');
    expect(line.getAttribute('role')).toBe('alert');
    const group = screen.getByRole('group', { name: 'Mostrar quando a resposta for' });
    expect(group.getAttribute('aria-describedby')).toBe(line.id);
  });
});

describe('what the server answers (E4 error)', () => {
  async function submitWith(result: unknown) {
    mocks.create.mockResolvedValue(result);
    const hooks = show();
    fireEvent.click(box('Tenho uma clínica'));
    await act(async () => {
      fireEvent.click(save());
    });
    return hooks;
  }

  it('keeps the draft and shows the transport failure in the sheet', async () => {
    const { onClose, onSaved } = await submitWith({ ok: false, code: 'failed' });
    const alert = document.querySelector('[data-branch-failed]') as HTMLElement;
    expect(alert.textContent).toBe('Não foi possível salvar o ramo agora. Tente de novo.');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(box('Tenho uma clínica').checked).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    // A thrown action reads the same.
    mocks.create.mockRejectedValue(new Error('network'));
    await act(async () => {
      fireEvent.click(save());
    });
    expect(document.querySelector('[data-branch-failed]')).toBeTruthy();
  });

  it('answers the branch limit with the limit line, the number from the limits, and refreshes', async () => {
    const { onClose } = await submitWith({ ok: false, code: 'limit' });
    const line = screen.getByText(
      'Você chegou ao limite de 15 ramos. Desfaça ou arquive um ramo para criar outro.',
    );
    expect(line.closest('[role="alert"]')).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('answers a third level too deep with the depth line, the number from the limits', async () => {
    await submitWith({ ok: false, code: 'conflict', issue: 'branch_depth' });
    expect(
      screen
        .getByText(
          'Esta pergunta já está dentro de 3 níveis de ramo, o máximo. Ela não pode abrir outro ramo.',
        )
        .closest('[role="alert"]'),
    ).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('reads any other conflict as the failure line and refreshes the page', async () => {
    await submitWith({ ok: false, code: 'conflict', issue: 'condition_invalid' });
    expect(document.querySelector('[data-branch-failed]')).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('sends a lost permission and a module turned off to a refresh with their own toast', async () => {
    const { onClose } = await submitWith({ ok: false, code: 'forbidden' });
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
  it('shows "Salvando…", locks the fields and cannot be closed while the write runs', async () => {
    let release: (value: unknown) => void = () => {};
    mocks.create.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { onClose, onSaved } = show();
    fireEvent.click(box('Tenho uma clínica'));
    await act(async () => {
      fireEvent.click(save());
    });
    expect(save().textContent).toContain('Salvando…');
    expect((nameField().closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Descartar as alterações?')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      release({ ok: true, branch: SAVED });
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('closes at once when nothing was changed', () => {
    const { onClose } = show();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Descartar as alterações?')).toBeNull();
  });

  it('asks before discarding a ticked answer, with the branch wording, and keeps it on "Continuar editando"', () => {
    const { onClose } = show();
    fireEvent.click(box('Tenho uma clínica'));
    fireEvent.keyDown(document, { key: 'Escape' });
    const ask = dialog('Descartar as alterações?');
    expect(ask.textContent).toContain('As mudanças deste ramo ainda não foram salvas.');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Continuar editando' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(box('Tenho uma clínica').checked).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(
      within(dialog('Descartar as alterações?')).getByRole('button', { name: 'Descartar' }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('counts a typed name as an unsaved change too', () => {
    const { onClose } = show();
    type('Nome');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog('Descartar as alterações?')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('the floor: no half-step spacing and 44px targets (UI-D-682, UI-D-684)', () => {
  it('writes no half-step spacing class in its sources', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['BranchSheet.tsx', 'BranchValuesPicker.tsx']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(/(^|[^a-z])(gap|p|m|px|py|mt|mb|ml|mr)-(0\.5|1\.5|2\.5|3\.5)/);
    }
  });
});
