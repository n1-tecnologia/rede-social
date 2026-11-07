// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  impact: vi.fn(),
  undo: vi.fn(),
  refresh: vi.fn(),
  show: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('./actions', () => ({
  createBranchAction: (...args: unknown[]) => mocks.create(...args),
  updateBranchAction: (...args: unknown[]) => mocks.update(...args),
  readImpactAction: (...args: unknown[]) => mocks.impact(...args),
  undoBranchAction: (...args: unknown[]) => mocks.undo(...args),
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

function show(props: Partial<import('./BranchSheet').BranchSheetCreateProps> = {}) {
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

describe('the width floor with 20 options at 320px (E4 overflow and long-text, asserted by classes)', () => {
  const wide = adminQuestion('multiple_choice', {
    title:
      'Um título de abridora muito longo que também precisa quebrar a linha no aparelho de 320px',
    options: Array.from({ length: 20 }, (_, at) => ({
      id: uuid(9800 + at),
      label:
        `Uma opção com um rótulo longuíssimo de oitenta caracteres para quebrar a linha ${at}`.slice(
          0,
          80,
        ),
      answerCount: 0,
    })),
  });

  it('keeps the opener title wrapping and the 20 rows inside a shrinkable fieldset', () => {
    show({ opener: wide });
    const title = document.querySelector('[data-branch-opener] .break-words') as HTMLElement;
    expect(title.className).toContain('min-w-0');
    const picker = screen.getByRole('group', { name: 'Mostrar quando a resposta for' });
    expect(picker.className).toContain('min-w-0');
    expect(within(picker).getAllByRole('checkbox')).toHaveLength(20);
    for (const each of within(picker).getAllByRole('checkbox')) {
      expect((each as HTMLInputElement).labels?.[0]?.className).toContain('break-words');
    }
  });

  it('keeps "Salvar ramo" and the name in the scrolling body of the sheet, never outside it', () => {
    show({ opener: wide });
    const body = dialog('Novo ramo').querySelector('.overflow-y-auto') as HTMLElement;
    expect(body.className).toContain('min-h-0');
    expect(body.contains(save())).toBe(true);
    expect(body.contains(nameField())).toBe(true);
    expect((nameField().closest('fieldset') as HTMLElement).className).toContain('min-w-0');
  });

  it('gives a 60-character name room: the field is full width and shrinkable', () => {
    show();
    type('N'.repeat(60));
    expect(nameField().className).toContain('w-full');
    expect(nameField().className).toContain('min-w-0');
    expect(screen.getByText('60/60')).toBeTruthy();
  });

  it('puts the failure and the limit lines in an alert with an icon and words, not colour alone', async () => {
    mocks.create.mockResolvedValue({ ok: false, code: 'limit' });
    show();
    fireEvent.click(box('Tenho uma clínica'));
    await act(async () => {
      fireEvent.click(save());
    });
    const alert = document.querySelector('[data-branch-refusal]') as HTMLElement;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.querySelector('svg')).toBeTruthy();
    expect(alert.textContent?.length).toBeGreaterThan(10);
  });
});

// ── 12.2-17 Task 1: edit mode, the tracer (D-640, D-642, UI-D-671, UI-D-682) ───────────────────────────

describe('12.2-17 Task 1: edit mode', () => {
  const QA = adminQuestion('single_choice', {
    title: 'Qual é a sua área de atuação?',
    stepId: S1.id,
    options: [
      { id: uuid(9611), label: 'Estética', answerCount: 0 },
      { id: uuid(9612), label: 'Odontologia', answerCount: 0 },
    ],
  });
  const BR = adminBranch({
    openerQuestionId: OPENER.id,
    values: [A],
    name: 'Quem tem clínica',
    revision: 3,
  });
  const members = (count: number, overrides: Partial<ReturnType<typeof adminQuestion>> = {}) =>
    Array.from({ length: count }, (_, at) =>
      adminQuestion('short_text', {
        title: `Pergunta do ramo ${at + 1}`,
        stepId: S2.id,
        branchId: BR.id,
        ...overrides,
      }),
    );

  function showEdit(
    props: Partial<import('./BranchSheet').BranchSheetEditProps> = {},
    memberCount = 3,
  ) {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const onAddQuestion = vi.fn();
    const questions = props.questions ?? [QA, OPENER, ...members(memberCount)];
    const view = render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <BranchSheet
          open
          branch={BR}
          questions={questions}
          branches={[BR]}
          steps={[S1, S2]}
          onClose={onClose}
          onSaved={onSaved}
          onAddQuestion={onAddQuestion}
          {...props}
        />
      </NextIntlClientProvider>,
    );
    return { onClose, onSaved, onAddQuestion, ...view };
  }

  const openerSelect = () => screen.getByLabelText('Pergunta que decide') as HTMLSelectElement;
  const listItems = () => {
    const list = document.querySelector('[data-branch-questions] ul') as HTMLElement | null;
    return list ? Array.from(list.querySelectorAll('li')) : [];
  };

  beforeEach(() => {
    mocks.update.mockResolvedValue({ ok: true, branch: { ...BR, revision: 4 } });
  });

  it('opens "Editar ramo" with the opener select grouped by step, the ticked answers and the name', () => {
    showEdit();
    expect(screen.getByRole('heading', { name: 'Editar ramo' })).toBeTruthy();
    expect(openerSelect().value).toBe(OPENER.id);
    const groups = Array.from(openerSelect().querySelectorAll('optgroup')).map((group) => [
      group.label,
      Array.from(group.querySelectorAll('option')).map((option) => option.textContent),
    ]);
    expect(groups).toEqual([
      ['Informações gerais', ['Qual é a sua área de atuação?']],
      ['Sobre a sua clínica', ['Você tem clínica, trabalha em clínica ou está aprendendo?']],
    ]);
    expect(box('Tenho uma clínica').checked).toBe(true);
    expect(box('Trabalho em uma clínica').checked).toBe(false);
    expect(nameField().value).toBe('Quem tem clínica');
    expect(screen.getByText('16/60')).toBeTruthy();
    expect(screen.queryByText('Novo ramo')).toBeNull();
  });

  it('never offers an opener that comes after a question of the branch or sits inside it', () => {
    const later = adminQuestion('yes_no', { title: 'Depois do ramo', stepId: S2.id });
    const inside = adminQuestion('yes_no', {
      title: 'Dentro do ramo',
      stepId: S2.id,
      branchId: BR.id,
    });
    showEdit({ questions: [QA, OPENER, ...members(2), inside, later] });
    const labels = Array.from(openerSelect().querySelectorAll('option')).map((o) => o.textContent);
    expect(labels).not.toContain('Depois do ramo');
    expect(labels).not.toContain('Dentro do ramo');
    expect(labels).toContain('Qual é a sua área de atuação?');
  });

  it('clears the ticked answers when the opener changes and says so in a polite status line', () => {
    showEdit();
    expect(document.querySelector('[data-branch-reset]')?.textContent ?? '').toBe('');
    fireEvent.change(openerSelect(), { target: { value: QA.id } });
    expect(openerSelect().value).toBe(QA.id);
    const note = document.querySelector('[data-branch-reset]') as HTMLElement;
    expect(note.getAttribute('role')).toBe('status');
    expect(note.getAttribute('aria-live')).toBe('polite');
    expect(note.textContent).toBe(
      'A pergunta que decide mudou, então as respostas escolhidas foram limpas.',
    );
    expect(box('Estética').checked).toBe(false);
    expect(save().hasAttribute('disabled')).toBe(true);
    fireEvent.click(box('Odontologia'));
    expect(save().hasAttribute('disabled')).toBe(false);
  });

  it('puts the original answers back, and removes the note, when the original opener is picked again', () => {
    showEdit();
    fireEvent.change(openerSelect(), { target: { value: QA.id } });
    fireEvent.change(openerSelect(), { target: { value: OPENER.id } });
    expect(box('Tenho uma clínica').checked).toBe(true);
    expect(document.querySelector('[data-branch-reset]')?.textContent ?? '').toBe('');
    expect(save().hasAttribute('disabled')).toBe(true);
  });

  it('lists up to 5 questions of the branch, then "e mais N", with the step pill from two steps', () => {
    showEdit({}, 7);
    expect(screen.getByText('Perguntas deste ramo')).toBeTruthy();
    expect(listItems()).toHaveLength(5);
    expect(listItems()[0]?.textContent).toContain('Pergunta do ramo 1');
    expect(listItems()[0]?.textContent).toContain('Etapa 2');
    expect(screen.getByText('e mais 2 perguntas')).toBeTruthy();
  });

  it('reads "e mais 1 pergunta" for six and no "e mais" line for five or fewer', () => {
    const { unmount } = showEdit({}, 6);
    expect(screen.getByText('e mais 1 pergunta')).toBeTruthy();
    unmount();
    cleanup();
    showEdit({}, 5);
    expect(listItems()).toHaveLength(5);
    expect(screen.queryByText(/^e mais/)).toBeNull();
  });

  it('draws no step pill when the form has a single step', () => {
    showEdit({ steps: [S2], questions: [OPENER, ...members(2)] });
    expect(listItems()).toHaveLength(2);
    expect(listItems()[0]?.textContent).not.toContain('Etapa');
  });

  it('shows the empty line instead of a list for a branch with no question, and still offers to add one', () => {
    const { onAddQuestion } = showEdit({ questions: [QA, OPENER] });
    expect(listItems()).toHaveLength(0);
    expect(
      screen.getByText(
        'Este ramo está vazio. Ele só muda algo para os membros quando tiver uma pergunta.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar pergunta ao ramo' }));
    // An empty branch goes to the last step of the form.
    expect(onAddQuestion).toHaveBeenCalledWith(BR, S2.id);
  });

  it('says the required questions of the branch only need an answer from who sees them, only when one exists', () => {
    const sentence = 'As perguntas obrigatórias deste ramo só precisam de resposta de quem as vê.';
    const { unmount } = showEdit();
    expect(screen.queryByText(sentence)).toBeNull();
    unmount();
    cleanup();
    showEdit({ questions: [QA, OPENER, ...members(2, { required: true })] });
    expect(screen.getByText(sentence)).toBeTruthy();
  });

  it('hands the question sheet the branch and the step of its last question', () => {
    const { onAddQuestion } = showEdit({}, 3);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar pergunta ao ramo' }));
    expect(onAddQuestion).toHaveBeenCalledWith(BR, S2.id);
  });

  it('asks before leaving through "Adicionar pergunta ao ramo" with an unsaved change', () => {
    const { onAddQuestion } = showEdit();
    type('Outro nome');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar pergunta ao ramo' }));
    expect(onAddQuestion).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog('Descartar as alterações?')).getByRole('button', { name: 'Descartar' }),
    );
    expect(onAddQuestion).toHaveBeenCalledWith(BR, S2.id);
  });

  it('hides "Adicionar pergunta ao ramo" when the host gives no way to add', () => {
    showEdit({ onAddQuestion: undefined });
    expect(screen.queryByRole('button', { name: 'Adicionar pergunta ao ramo' })).toBeNull();
  });

  it('keeps "Salvar ramo" disabled until something changed, and while no answer is ticked', () => {
    showEdit();
    expect(save().hasAttribute('disabled')).toBe(true);
    fireEvent.click(box('Tenho uma clínica'));
    expect(save().hasAttribute('disabled')).toBe(true);
    fireEvent.click(box('Trabalho em uma clínica'));
    expect(save().hasAttribute('disabled')).toBe(false);
  });

  it('sends only the name, under the revision, when only the name changed', async () => {
    const { onSaved } = showEdit();
    type('  Quem trabalha em clínica  ');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(BR.id, {
      revision: 3,
      name: 'Quem trabalha em clínica',
    });
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Ramo salvo.' });
    expect(mocks.refresh).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith({ ...BR, revision: 4 });
  });

  it('sends only the answers, in the opener order, when only the answers changed', async () => {
    showEdit();
    fireEvent.click(box('Estou aprendendo'));
    fireEvent.click(box('Trabalho em uma clínica'));
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.update).toHaveBeenCalledWith(BR.id, { revision: 3, values: [A, B, C] });
  });

  it('sends the new opener together with its new answers, and a cleared name as null', async () => {
    showEdit();
    fireEvent.change(openerSelect(), { target: { value: QA.id } });
    fireEvent.click(box('Odontologia'));
    type('');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.update).toHaveBeenCalledWith(BR.id, {
      revision: 3,
      openerQuestionId: QA.id,
      values: [uuid(9612)],
      name: null,
    });
  });

  it('does not treat the same answers in another tick order as a change', () => {
    showEdit({ branch: { ...BR, values: [A, B] } });
    fireEvent.click(box('Tenho uma clínica'));
    fireEvent.click(box('Tenho uma clínica'));
    expect(save().hasAttribute('disabled')).toBe(true);
  });

  it('shows a stale revision in the sheet, refreshes, and keeps what the admin typed', async () => {
    mocks.update.mockResolvedValue({ ok: false, code: 'stale_revision' });
    const { onSaved } = showEdit();
    type('Meu nome');
    await act(async () => {
      fireEvent.click(save());
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(
      'Este ramo mudou enquanto você editava. Atualizamos a lista; confira e tente de novo.',
    );
    expect(mocks.refresh).toHaveBeenCalled();
    expect(nameField().value).toBe('Meu nome');
    expect(onSaved).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
  });

  it('retries under the newest revision once the page has re-read the branch', async () => {
    mocks.update.mockResolvedValueOnce({ ok: false, code: 'stale_revision' });
    const { rerender } = showEdit();
    type('Meu nome');
    await act(async () => {
      fireEvent.click(save());
    });
    rerender(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <BranchSheet
          open
          branch={{ ...BR, revision: 5 }}
          questions={[QA, OPENER]}
          branches={[{ ...BR, revision: 5 }]}
          steps={[S1, S2]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    await act(async () => {
      fireEvent.click(save());
    });
    expect(mocks.update).toHaveBeenLastCalledWith(BR.id, { revision: 5, name: 'Meu nome' });
  });

  it('shows the depth line and keeps the draft for a 409 branch_depth', async () => {
    mocks.update.mockResolvedValue({ ok: false, code: 'conflict', issue: 'branch_depth' });
    showEdit();
    type('Meu nome');
    await act(async () => {
      fireEvent.click(save());
    });
    expect(screen.getByRole('alert').textContent).toContain('3');
    expect(nameField().value).toBe('Meu nome');
  });

  it('refuses a 61-character name under the field and sends nothing', async () => {
    showEdit();
    type('x'.repeat(61));
    await act(async () => {
      fireEvent.submit(nameField().closest('form') as HTMLFormElement);
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByText('Use até 60 caracteres.')).toBeTruthy();
  });

  it('asks before closing with an unsaved change, and closes at once when nothing changed', () => {
    const { onClose } = showEdit();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const second = showEdit();
    type('Outro');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(second.onClose).not.toHaveBeenCalled();
    expect(dialog('Descartar as alterações?')).toBeTruthy();
  });

  it('renders a hostile opener title, branch name and question title as text', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    showEdit({
      branch: { ...BR, name: hostile },
      questions: [QA, OPENER, ...members(1, { title: hostile })],
    });
    expect(nameField().value).toBe(hostile);
    expect(document.querySelector('[data-branch-questions] img')).toBeNull();
    expect(listItems()[0]?.textContent).toContain(hostile);
  });

  // ── Task 2: a branch with answers is locked (D-646) ───────────────────────────────────────────────
  describe('a branch with answers is locked (D-646, UI-D-671)', () => {
    const answered = (count: number) =>
      members(3).map((member, at) => (at < count ? { ...member, answerCount: 2 } : member));
    const lockedProps = (answeredCount = 2) => ({
      branch: { ...BR, answerCount: 5 },
      questions: [QA, OPENER, ...answered(answeredCount)],
    });
    const lockedSentence = (n: string) =>
      `Este ramo já tem respostas em ${n}, então a pergunta que decide e as respostas que o abrem não podem mudar. Para mudar, crie um novo ramo e arquive este.`;

    it('replaces the opener select and the answers picker by ONE read-only row with the lock', () => {
      showEdit(lockedProps());
      const row = document.querySelector('[data-branch-locked]') as HTMLElement;
      expect(row).toBeTruthy();
      expect(row.querySelector('svg')?.getAttribute('class') ?? '').toContain('lock');
      expect(row.textContent).toContain(lockedSentence('2 perguntas'));
      expect(row.textContent).toContain(
        'Se “Você tem clínica, trabalha em clínica ou está aprendendo?” for “Tenho uma clínica”',
      );
      expect(row.textContent).toContain('Você ainda pode dar um nome a ele ou desfazê-lo.');
      expect(screen.queryByLabelText('Pergunta que decide')).toBeNull();
      expect(dialog('Editar ramo').querySelector('select')).toBeNull();
      expect(screen.queryByRole('group', { name: 'Mostrar quando a resposta for' })).toBeNull();
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(document.querySelector('[data-branch-reset]')).toBeNull();
    });

    it('reads the singular for one question and never zero for a branch whose answers are archived', () => {
      const { unmount } = showEdit(lockedProps(1));
      expect(screen.getByText(/respostas em 1 pergunta,/)).toBeTruthy();
      unmount();
      cleanup();
      showEdit(lockedProps(0));
      expect(screen.getByText(/respostas em 1 pergunta,/)).toBeTruthy();
    });

    it('renders none of it for a branch without answers: the select and the picker are there', () => {
      showEdit();
      expect(document.querySelector('[data-branch-locked]')).toBeNull();
      expect(screen.queryByText(/Este ramo já tem respostas/)).toBeNull();
      expect(openerSelect()).toBeTruthy();
      expect(screen.getByRole('group', { name: 'Mostrar quando a resposta for' })).toBeTruthy();
    });

    it('keeps the name editable and the footer: only the name travels, under the revision', async () => {
      showEdit(lockedProps());
      expect(save().hasAttribute('disabled')).toBe(true);
      type('Outro nome');
      expect(save().hasAttribute('disabled')).toBe(false);
      await act(async () => {
        fireEvent.click(save());
      });
      expect(mocks.update).toHaveBeenCalledWith(BR.id, { revision: 3, name: 'Outro nome' });
    });

    it('shows a coded condition_locked (an answer arrived meanwhile) in the sheet and refreshes', async () => {
      mocks.update.mockResolvedValue({ ok: false, code: 'conflict', issue: 'condition_locked' });
      showEdit();
      fireEvent.click(box('Trabalho em uma clínica'));
      await act(async () => {
        fireEvent.click(save());
      });
      expect(screen.getByRole('alert').textContent).toContain('Este ramo já tem respostas em');
      expect(screen.getByRole('alert').textContent).toContain('crie um novo ramo e arquive este.');
      expect(mocks.refresh).toHaveBeenCalled();
    });

    it('keeps the long sentence and a long condition inside the width (break-words, min-w-0)', () => {
      showEdit(lockedProps());
      const row = document.querySelector('[data-branch-locked]') as HTMLElement;
      expect(row.className).toContain('min-w-0');
      expect(row.innerHTML).toContain('break-words');
    });
  });

  // ── Task 2: "Desfazer ramo" reads the member impact before it confirms (D-653, UI-D-672) ─────────────
  describe('"Desfazer ramo" (D-653, UI-D-672)', () => {
    const undoButton = () => screen.getByRole('button', { name: 'Desfazer ramo' });
    const undoDialog = () => screen.getByRole('dialog', { name: 'Desfazer este ramo?' });
    const nested = () => {
      const inside = adminQuestion('yes_no', {
        title: 'Tem equipe?',
        stepId: S2.id,
        branchId: BR.id,
      });
      const inner = adminBranch({ openerQuestionId: inside.id, values: ['true'] });
      return { questions: [QA, OPENER, inside], branches: [BR, inner] };
    };
    const press = async () => {
      await act(async () => {
        fireEvent.click(undoButton());
      });
    };

    beforeEach(() => {
      mocks.impact.mockResolvedValue({ ok: true, members: 0 });
      mocks.undo.mockResolvedValue({ ok: true });
    });

    it('sits in a divided block under the save button, outside the save form', () => {
      showEdit();
      const form = dialog('Editar ramo').querySelector('form') as HTMLFormElement;
      expect(form.contains(undoButton())).toBe(false);
      const block = undoButton().closest('[data-branch-manage]') as HTMLElement;
      expect(block).toBeTruthy();
      expect(block.className).toContain('border-t');
      expect(
        save().compareDocumentPosition(undoButton()) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(undoButton().className).toContain('min-h-11');
      expect(undoButton().className).toContain('w-full');
    });

    it('is not on the create sheet', () => {
      show();
      expect(screen.queryByRole('button', { name: 'Desfazer ramo' })).toBeNull();
    });

    it('reads the impact of THIS branch first and opens the dialog only when the read returns', async () => {
      let release: (value: unknown) => void = () => {};
      mocks.impact.mockReturnValue(new Promise((resolve) => (release = resolve)));
      showEdit();
      await press();
      expect(mocks.impact).toHaveBeenCalledWith({ change: 'undo_branch', branchId: BR.id });
      expect(screen.queryByRole('dialog', { name: 'Desfazer este ramo?' })).toBeNull();
      expect(mocks.undo).not.toHaveBeenCalled();
      await act(async () => {
        release({ ok: true, members: 0 });
      });
      expect(undoDialog()).toBeTruthy();
      expect(mocks.undo).not.toHaveBeenCalled();
    });

    it('opens nothing and saves nothing when the read fails, and says so', async () => {
      mocks.impact.mockResolvedValue({ ok: false, code: 'failed' });
      showEdit();
      await press();
      expect(screen.queryByRole('dialog', { name: 'Desfazer este ramo?' })).toBeNull();
      expect(mocks.undo).not.toHaveBeenCalled();
      expect(mocks.show).toHaveBeenCalledWith({
        tone: 'error',
        message:
          'Não foi possível calcular quantos membros serão afetados. Nada foi salvo. Tente de novo.',
      });
    });

    it('treats a thrown read like a failed one', async () => {
      mocks.impact.mockRejectedValue(new Error('network'));
      showEdit();
      await press();
      expect(screen.queryByRole('dialog', { name: 'Desfazer este ramo?' })).toBeNull();
      expect(mocks.undo).not.toHaveBeenCalled();
      expect(mocks.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    });

    it('sends a lost permission to a refresh with its own toast, without a dialog', async () => {
      mocks.impact.mockResolvedValue({ ok: false, code: 'forbidden' });
      const { onClose } = showEdit();
      await press();
      expect(screen.queryByRole('dialog', { name: 'Desfazer este ramo?' })).toBeNull();
      expect(mocks.refresh).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(mocks.undo).not.toHaveBeenCalled();
    });

    it('uses the brand tone with the Undo2 icon, and "Manter ramo" (never Cancelar) to dismiss', async () => {
      showEdit();
      await press();
      const box = undoDialog();
      expect(box.querySelector('svg')?.getAttribute('class') ?? '').toContain('undo');
      expect(within(box).getByRole('button', { name: 'Manter ramo' })).toBeTruthy();
      expect(within(box).queryByRole('button', { name: 'Cancelar' })).toBeNull();
      fireEvent.click(within(box).getByRole('button', { name: 'Manter ramo' }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Desfazer este ramo?' })).toBeNull(),
      );
      expect(mocks.undo).not.toHaveBeenCalled();
    });

    it('reads the body by the number of questions of the branch: none, one, many', async () => {
      const cases: [number, string][] = [
        [0, 'O ramo está vazio e será removido.'],
        [1, 'A pergunta dele continua no formulário e passa a aparecer para todos os membros.'],
        [
          3,
          'As 3 perguntas dele continuam no formulário e passam a aparecer para todos os membros.',
        ],
      ];
      for (const [count, sentence] of cases) {
        cleanup();
        showEdit({ questions: [QA, OPENER, ...members(count)] });
        await press();
        expect(undoDialog().textContent).toContain(sentence);
        expect(undoDialog().textContent).not.toContain('Os ramos dentro dele');
      }
    });

    it('confirms with "Desfazer ramo" when no member will have to answer, and adds no member sentence', async () => {
      showEdit();
      await press();
      const box = undoDialog();
      expect(within(box).getByRole('button', { name: 'Desfazer ramo' })).toBeTruthy();
      expect(within(box).queryByRole('button', { name: 'Desfazer e exigir' })).toBeNull();
      expect(box.textContent).not.toContain('vai precisar respondê-las');
      expect(box.textContent).not.toContain('vão precisar respondê-las');
    });

    it('adds the member sentence and confirms with "Desfazer e exigir" when members will have to answer', async () => {
      mocks.impact.mockResolvedValue({ ok: true, members: 1 });
      showEdit();
      await press();
      const box = undoDialog();
      expect(box.textContent).toContain(
        '1 membro que hoje não vê estas perguntas vai precisar respondê-las antes de continuar usando a comunidade. Quem já respondeu mantém a resposta.',
      );
      expect(within(box).getByRole('button', { name: 'Desfazer e exigir' })).toBeTruthy();
      cleanup();
      mocks.impact.mockResolvedValue({ ok: true, members: 12 });
      showEdit();
      await press();
      expect(undoDialog().textContent).toContain(
        '12 membros que hoje não veem estas perguntas vão precisar respondê-las antes de continuar usando a comunidade.',
      );
    });

    it('says the branches inside it keep working only when branches hang inside it', async () => {
      showEdit(nested());
      await press();
      expect(undoDialog().textContent).toContain('Os ramos dentro dele continuam valendo.');
      cleanup();
      showEdit();
      await press();
      expect(undoDialog().textContent).not.toContain('Os ramos dentro dele continuam valendo.');
    });

    it('never puts a branch name or an opener title in the dialog', async () => {
      showEdit();
      await press();
      expect(undoDialog().textContent).not.toContain('Quem tem clínica');
      expect(undoDialog().textContent).not.toContain('Você tem clínica');
    });

    it('undoes the branch on confirm, toasts, refreshes and closes the sheet', async () => {
      const { onClose } = showEdit();
      await press();
      await act(async () => {
        fireEvent.click(within(undoDialog()).getByRole('button', { name: 'Desfazer ramo' }));
      });
      expect(mocks.undo).toHaveBeenCalledTimes(1);
      expect(mocks.undo).toHaveBeenCalledWith(BR.id);
      expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Ramo desfeito.' });
      expect(mocks.refresh).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('keeps the sheet open with the failure line when the undo fails, and never toasts a success', async () => {
      mocks.undo.mockResolvedValue({ ok: false, code: 'failed' });
      const { onClose } = showEdit();
      await press();
      await act(async () => {
        fireEvent.click(within(undoDialog()).getByRole('button', { name: 'Desfazer ramo' }));
      });
      expect(onClose).not.toHaveBeenCalled();
      expect(mocks.show).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
      expect(screen.getByRole('alert').textContent).toContain(
        'Não foi possível salvar o ramo agora. Tente de novo.',
      );
    });

    it('closes the sheet and refreshes when the branch is gone already', async () => {
      mocks.undo.mockResolvedValue({ ok: false, code: 'gone' });
      const { onClose } = showEdit();
      await press();
      await act(async () => {
        fireEvent.click(within(undoDialog()).getByRole('button', { name: 'Desfazer ramo' }));
      });
      expect(mocks.refresh).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
      expect(mocks.show).not.toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
    });

    it('sends a lost permission on the undo itself to a refresh with its toast', async () => {
      mocks.undo.mockResolvedValue({ ok: false, code: 'forbidden' });
      const { onClose } = showEdit();
      await press();
      await act(async () => {
        fireEvent.click(within(undoDialog()).getByRole('button', { name: 'Desfazer ramo' }));
      });
      expect(mocks.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
      expect(onClose).toHaveBeenCalled();
    });
  });
});
