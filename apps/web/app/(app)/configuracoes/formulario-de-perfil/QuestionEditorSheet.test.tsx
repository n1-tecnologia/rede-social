// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { adminBranch, adminQuestion, adminStep, uuid } from '@/lib/profile-form/test-fixtures';
import type { SaveQuestionResult } from './actions';
import type { EditorMode } from './editor-state';

/**
 * 12-16 Task 1 (PFORM-02, PFORM-22, D-594, UI-D-569, UI-D-570, UI-D-573): the editor sheet against the REAL
 * catalog and the shipped `BottomSheet` and `ConfirmDialog`. Stubbed: the server actions, the router and
 * the toast. Asserted: nothing below the grid until a tile is chosen, the collapse and "Trocar tipo", the
 * LGPD warning first and never dismissible with no purpose field, the counters, the save button's gate,
 * the contract body, the invalid, failed, limit and forbidden paths, the dirty guard and that the sheet
 * cannot be closed while it saves.
 */

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  replace: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
  impact: vi.fn(),
  refresh: vi.fn(),
  show: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('./actions', () => ({
  createQuestionAction: (body: unknown, options: unknown) => mocks.create(body, options),
  readImpactAction: (input: unknown) => mocks.impact(input),
  updateQuestionAction: (id: string, body: unknown, options: unknown) =>
    mocks.update(id, body, options),
  replaceQuestionAction: (body: unknown, options: unknown) => mocks.replace(body, options),
  archiveQuestionAction: (id: string) => mocks.archive(id),
  deleteQuestionAction: (id: string) => mocks.remove(id),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));
vi.mock('@rede-social/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/ui')>()),
  useToast: () => ({ show: mocks.show, dismiss: vi.fn() }),
}));

const { QuestionEditorSheet } = await import('./QuestionEditorSheet');

const onClose = vi.fn();
const onReplace = vi.fn();

function mount(
  props: {
    mode?: EditorMode;
    question?: ReturnType<typeof adminQuestion> | null;
    /** 12.1-17: the active list and the steps the builder holds. Absent: the sheet shows no condition block. */
    questions?: ReturnType<typeof adminQuestion>[];
    steps?: ReturnType<typeof adminStep>[];
    stepId?: string;
    /** 12.2-16: the branches of the form, and the branch a new question starts in. */
    branches?: ReturnType<typeof adminBranch>[];
    initialBranchId?: string;
    /** 12.2-16 Task 2: the host's two handlers for "Ramos desta pergunta". */
    onCreateBranch?: (question: ReturnType<typeof adminQuestion>) => void;
    onOpenBranch?: (branch: ReturnType<typeof adminBranch>) => void;
  } = {},
) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <QuestionEditorSheet
        open
        mode={props.mode ?? 'create'}
        question={props.question ?? null}
        questions={props.questions}
        steps={props.steps}
        stepId={props.stepId}
        branches={props.branches}
        initialBranchId={props.initialBranchId}
        onCreateBranch={props.onCreateBranch}
        onOpenBranch={props.onOpenBranch}
        tenantName="Ana Mentoria"
        limit={30}
        onClose={onClose}
        onReplace={onReplace}
      />
    </NextIntlClientProvider>,
  );
}

const dialog = () => screen.getAllByRole('dialog')[0] as HTMLElement;
const tile = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) });
const saveButton = () => screen.getByRole('button', { name: /^(Salvar pergunta|Salvando…)$/ });
const titleField = () => screen.getByLabelText(/^(Pergunta|Texto do aceite)$/) as HTMLInputElement;

/** A tap on the backdrop: the way out on the desktop card, which has no handle. */
function closeSheet() {
  fireEvent.click(dialog().previousElementSibling as HTMLElement);
}

function pick(name: string) {
  fireEvent.click(tile(name));
}
function typeTitle(value: string) {
  fireEvent.change(titleField(), { target: { value } });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  onClose.mockReset();
  onReplace.mockReset();
  mocks.impact.mockResolvedValue({ ok: true, members: 0 });
  mocks.create.mockResolvedValue({
    ok: true,
    question: adminQuestion('short_text'),
    pending: null,
  } satisfies SaveQuestionResult);
});
afterEach(cleanup);

describe('the type picker (D-590, UI-D-570)', () => {
  it('shows a radiogroup "Tipo de resposta" of the 13 tiles in the order of the contract', () => {
    mount();
    const group = screen.getByRole('group', { name: 'Tipo de resposta' });
    const names = within(group)
      .getAllByRole('radio')
      .map(
        (radio) =>
          (radio as HTMLInputElement).labels?.[0]?.querySelector('.font-bold')?.textContent,
      );
    expect(names).toEqual([
      'Texto curto',
      'Texto longo',
      'Lista suspensa',
      'Múltipla escolha',
      'Escolha única',
      'Sim ou não',
      'Aceite',
      'Número',
      'Avaliação',
      'Data',
      'Telefone',
      'E-mail',
      'Link',
    ]);
  });

  it('shows each tile with its one-line hint and the 14px-bold name, 56px high', () => {
    mount();
    const label = (tile('Texto curto') as HTMLInputElement).labels?.[0] as HTMLElement;
    expect(label.textContent).toContain('Uma linha');
    expect(label.className).toContain('min-h-14');
  });

  it('renders nothing below the grid until a tile is chosen', () => {
    mount();
    expect(screen.queryByLabelText('Pergunta')).toBeNull();
    expect(screen.queryByLabelText('Texto de apoio (opcional)')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(saveButton().hasAttribute('disabled')).toBe(true);
  });

  it('collapses into "Tipo: {name}" with "Trocar tipo" once a tile is chosen, and re-opens', () => {
    mount();
    pick('Escolha única');
    expect(screen.getByText('Tipo: Escolha única')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Tipo de resposta' })).toBeNull();
    expect(screen.getByLabelText('Pergunta')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Trocar tipo' }));
    expect(screen.getByRole('group', { name: 'Tipo de resposta' })).toBeTruthy();
    expect((tile('Escolha única') as HTMLInputElement).checked).toBe(true);
    expect((tile('Escolha única') as HTMLInputElement).labels?.[0]?.className).toContain(
      'border-brand',
    );
  });
});

describe('the LGPD warning (D-594, UI-D-573, PFORM-22)', () => {
  it('is the first element of the sheet, names the tenant and cannot be dismissed', () => {
    mount();
    const form = dialog().querySelector('form') as HTMLFormElement;
    const first = (form.querySelector('fieldset') as HTMLElement).firstElementChild as HTMLElement;
    expect(first.hasAttribute('data-lgpd-notice')).toBe(true);
    expect(first.textContent).toBe(
      'Peça só o que precisa. Ana Mentoria responde pelos dados que coletar, conforme a LGPD.',
    );
    expect(first.className).toContain('bg-warning/10');
    expect(first.querySelector('button')).toBeNull();
  });

  it('offers no purpose field and does not block any title or type', () => {
    mount();
    pick('Número');
    typeTitle('CPF');
    expect(screen.queryByLabelText(/finalidade|propósito|motivo/i)).toBeNull();
    expect(saveButton().hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/LGPD/, { selector: 'p, li' })).toBeNull();
  });
});

describe('the fields and their counters (UI-D-569)', () => {
  it('counts the title and the help text live', () => {
    mount();
    pick('Texto curto');
    expect(screen.getByText('0/120')).toBeTruthy();
    expect(screen.getByText('0/300')).toBeTruthy();
    typeTitle('Cargo');
    fireEvent.change(screen.getByLabelText('Texto de apoio (opcional)'), {
      target: { value: 'Seu cargo atual' },
    });
    expect(screen.getByText('5/120')).toBeTruthy();
    expect(screen.getByText('15/300')).toBeTruthy();
    expect(titleField().maxLength).toBe(120);
    expect(
      (screen.getByLabelText('Texto de apoio (opcional)') as HTMLTextAreaElement).maxLength,
    ).toBe(300);
  });

  it('calls the title "Texto do aceite" for an acceptance question', () => {
    mount();
    pick('Aceite');
    expect(screen.getByLabelText('Texto do aceite')).toBeTruthy();
    expect(titleField().placeholder).toBe('Ex.: Li e aceito o regulamento do grupo');
  });

  it('shows the two switch rows with their helper texts, both off', () => {
    mount();
    pick('Texto curto');
    const required = screen.getByRole('switch', { name: 'Obrigatória' });
    const open = screen.getByRole('switch', { name: 'Mostrar no perfil do membro' });
    expect(required.getAttribute('aria-checked')).toBe('false');
    expect(open.getAttribute('aria-checked')).toBe('false');
    expect(
      screen.getByText('Quem ainda não respondeu precisa responder antes de usar a comunidade.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Os outros membros veem esta resposta no perfil de quem respondeu. O membro é avisado no formulário.',
      ),
    ).toBeTruthy();
  });
});

describe('saving', () => {
  it('enables "Salvar pergunta" only with a type and a title', () => {
    mount();
    pick('Texto curto');
    expect(saveButton().hasAttribute('disabled')).toBe(true);
    typeTitle('   ');
    expect(saveButton().hasAttribute('disabled')).toBe(true);
    typeTitle('Cargo');
    expect(saveButton().hasAttribute('disabled')).toBe(false);
  });

  it('calls the action once with the contract body, toasts, refreshes and closes', async () => {
    mount();
    pick('Texto curto');
    typeTitle('  Qual é o seu cargo? ');
    fireEvent.click(screen.getByRole('switch', { name: 'Obrigatória' }));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.impact).toHaveBeenCalledWith({ change: 'create_required' });
    expect(mocks.create.mock.calls[0]?.[0]).toEqual({
      type: 'short_text',
      title: 'Qual é o seu cargo?',
      helpText: null,
      required: true,
      showOnProfile: false,
      allowOther: false,
      options: [],
      limits: {},
    });
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Pergunta adicionada.' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call the action for an over-long title and shows the error under the field', async () => {
    mount();
    pick('Texto curto');
    typeTitle('x'.repeat(121));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Use até 120 caracteres.');
    expect(document.activeElement).toBe(titleField());
  });

  it('puts a server "invalid" under its field and focuses it', async () => {
    mocks.create.mockResolvedValue({ ok: false, code: 'invalid', fields: { title: 'required' } });
    mount();
    pick('Texto curto');
    typeTitle('Cargo');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(screen.getByRole('alert').textContent).toBe('Escreva a pergunta.');
    expect(document.activeElement).toBe(titleField());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the draft and toasts the saved-nothing sentence when the write fails', async () => {
    mocks.create.mockResolvedValue({ ok: false, code: 'failed' });
    mount();
    pick('Texto curto');
    typeTitle('Cargo');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message:
        'Não foi possível salvar a pergunta agora. Suas alterações continuam aqui. Tente de novo.',
    });
    expect(titleField().value).toBe('Cargo');
    expect(onClose).not.toHaveBeenCalled();
    expect(saveButton().hasAttribute('disabled')).toBe(false);
  });

  it('keeps the draft when the request throws', async () => {
    mocks.create.mockRejectedValue(new Error('network'));
    mount();
    pick('Texto curto');
    typeTitle('Cargo');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    expect(titleField().value).toBe('Cargo');
  });

  it('toasts the limit sentence at 30 active questions and keeps the sheet', async () => {
    mocks.create.mockResolvedValue({ ok: false, code: 'limit' });
    mount();
    pick('Texto curto');
    typeTitle('Cargo');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Você chegou ao limite de 30 perguntas ativas. Arquive uma para adicionar outra.',
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refreshes into the not-found page and closes when the permission was lost', async () => {
    mocks.create.mockResolvedValue({ ok: false, code: 'forbidden' });
    mount();
    pick('Texto curto');
    typeTitle('Cargo');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks the fields, says "Salvando…" and cannot be closed while the write runs', async () => {
    let finish: (value: SaveQuestionResult) => void = () => {};
    mocks.create.mockReturnValue(
      new Promise<SaveQuestionResult>((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    pick('Texto curto');
    typeTitle('Cargo');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(saveButton().textContent).toContain('Salvando…');
    expect(titleField().closest('fieldset')?.disabled).toBe(true);

    closeSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('Descartar as alterações?')).toBeNull();

    await act(async () => {
      finish({ ok: true, question: adminQuestion('short_text'), pending: null });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the dirty guard (UI-D-569)', () => {
  it('closes a clean sheet at once', () => {
    mount();
    closeSheet();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Descartar as alterações?')).toBeNull();
  });

  it('asks before closing a sheet with unsaved edits, and "Continuar editando" keeps it open', async () => {
    mount();
    pick('Texto curto');
    typeTitle('Cargo');
    closeSheet();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Descartar as alterações?')).toBeTruthy();
    expect(screen.getByText('As mudanças desta pergunta ainda não foram salvas.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
    });
    await waitFor(() => expect(screen.queryByText('Descartar as alterações?')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(titleField().value).toBe('Cargo');
  });

  it('closes without saving on "Descartar"', async () => {
    mount();
    pick('Texto curto');
    typeTitle('Cargo');
    closeSheet();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('closes through the handle on a phone: the handle is the close control and has a name', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      window.matchMedia = original;
    }
  });

  it('asks on Escape as well', () => {
    mount();
    pick('Texto curto');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('Descartar as alterações?')).toBeTruthy();
  });
});

describe('no raw markup (T-12-35)', () => {
  it('renders a typed title as text, never as markup', async () => {
    mount();
    pick('Texto curto');
    typeTitle('<img src=x onerror=alert(1)>');
    expect(dialog().querySelector('img')).toBeNull();
    expect(titleField().value).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('the options editor (D-592, UI-D-571, UI-D-572)', () => {
  const optionInput = (n: number) => screen.getByLabelText(`Opção ${n}`) as HTMLInputElement;
  const rows = () => screen.queryAllByLabelText(/^Opção \d+$/) as HTMLInputElement[];

  function chooseWithOptions(labels: string[], type = 'Escolha única') {
    mount();
    pick(type);
    typeTitle('Como conheceu?');
    labels.forEach((label, index) => {
      if (index >= rows().length)
        fireEvent.click(screen.getByRole('button', { name: 'Adicionar opção' }));
      fireEvent.change(optionInput(index + 1), { target: { value: label } });
    });
  }

  it('starts a choice question with two empty rows, a legend and the "Outro" switch off', () => {
    mount();
    pick('Lista suspensa');
    expect(screen.getByRole('group', { name: 'Opções' })).toBeTruthy();
    expect(rows()).toHaveLength(2);
    expect(rows().every((input) => input.value === '' && input.maxLength === 80)).toBe(true);
    expect(rows()[0]?.placeholder).toBe('Nome da opção');
    const other = screen.getByRole('switch', { name: 'Incluir a opção “Outro”' });
    expect(other.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('O membro escreve a própria resposta.')).toBeTruthy();
  });

  it('shows the options block for the three choice types and for no other', () => {
    for (const choice of ['Lista suspensa', 'Múltipla escolha', 'Escolha única']) {
      mount();
      pick(choice);
      expect(screen.queryByRole('group', { name: 'Opções' })).not.toBeNull();
      cleanup();
    }
    for (const other of ['Texto curto', 'Número', 'Sim ou não']) {
      mount();
      pick(other);
      expect(screen.queryByRole('group', { name: 'Opções' })).toBeNull();
      expect(screen.queryByRole('switch', { name: 'Incluir a opção “Outro”' })).toBeNull();
      cleanup();
    }
  });

  it('names every row and button by its position, each icon button 44px', () => {
    mount();
    pick('Escolha única');
    expect(screen.getByLabelText('Opção 1')).toBeTruthy();
    for (const name of [
      'Subir opção 1',
      'Descer opção 1',
      'Remover opção 1',
      'Subir opção 2',
      'Descer opção 2',
      'Remover opção 2',
    ]) {
      const button = screen.getByRole('button', { name });
      expect(button.className, name).toContain('min-h-[44px]');
      expect(button.className, name).toContain('min-w-[44px]');
    }
  });

  it('disables remove at two options and up/down at the edges', () => {
    mount();
    pick('Escolha única');
    expect(
      (screen.getByRole('button', { name: 'Remover opção 1' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Remover opção 2' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Subir opção 1' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Descer opção 2' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('adds a row and moves focus into it', () => {
    mount();
    pick('Escolha única');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar opção' }));
    expect(rows()).toHaveLength(3);
    expect(document.activeElement).toBe(optionInput(3));
    expect(
      (screen.getByRole('button', { name: 'Remover opção 3' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('removes a row and reorders rows, keeping focus on the pressed button', () => {
    chooseWithOptions(['A', 'B', 'C']);
    fireEvent.click(screen.getByRole('button', { name: 'Subir opção 3' }));
    expect(rows().map((input) => input.value)).toEqual(['A', 'C', 'B']);
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe(
      'Subir opção 2',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remover opção 1' }));
    expect(rows().map((input) => input.value)).toEqual(['C', 'B']);
  });

  it('shows "Máximo de 20 opções." and disables "Adicionar opção" at twenty rows', () => {
    mount();
    pick('Escolha única');
    for (let i = 0; i < 18; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar opção' }));
    }
    expect(rows()).toHaveLength(20);
    expect(
      (screen.getByRole('button', { name: 'Adicionar opção' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('Máximo de 20 opções.')).toBeTruthy();
  });

  it('refuses empty rows with the sentence under the list and focuses the first empty row', async () => {
    mount();
    pick('Escolha única');
    typeTitle('Origem');
    fireEvent.change(optionInput(1), { target: { value: 'Instagram' } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.create).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole('alert').map((node) => node.textContent);
    expect(alerts).toContain('Preencha ou remova as opções vazias.');
    expect(document.activeElement).toBe(optionInput(2));
    expect(optionInput(2).getAttribute('aria-invalid')).toBe('true');
  });

  it('refuses a repeated label with its sentence', async () => {
    chooseWithOptions(['Indicação', ' indicação ']);
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toContain(
      'Já existe uma opção com este nome.',
    );
  });

  it('clears the options error as soon as the list is edited', async () => {
    mount();
    pick('Escolha única');
    typeTitle('Origem');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(screen.queryAllByRole('alert').length).toBeGreaterThan(0);
    fireEvent.change(optionInput(1), { target: { value: 'A' } });
    expect(screen.queryByText('Preencha ou remova as opções vazias.')).toBeNull();
  });

  it('sends the labels trimmed, no id for a new option and "Outro" when it is on', async () => {
    chooseWithOptions([' Instagram ', 'Indicação']);
    fireEvent.click(screen.getByRole('switch', { name: 'Incluir a opção “Outro”' }));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const body = mocks.create.mock.calls[0]?.[0];
    expect(body).toMatchObject({
      type: 'single_choice',
      allowOther: true,
      options: [{ label: 'Instagram' }, { label: 'Indicação' }],
    });
    expect(JSON.stringify(body)).not.toContain('"id"');
  });

  it('keeps the rows between two choice types and drops them for another type', () => {
    chooseWithOptions(['A', 'B']);
    fireEvent.click(screen.getByRole('button', { name: 'Trocar tipo' }));
    pick('Lista suspensa');
    expect(rows().map((input) => input.value)).toEqual(['A', 'B']);
    fireEvent.click(screen.getByRole('button', { name: 'Trocar tipo' }));
    pick('Texto curto');
    expect(rows()).toHaveLength(0);
  });

  it('locks the rows while the sheet saves', async () => {
    mocks.create.mockReturnValue(new Promise(() => {}));
    chooseWithOptions(['A', 'B']);
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(optionInput(1).closest('form')?.querySelector('fieldset')?.disabled).toBe(true);
  });
});

describe('the number and date limits and the type notes (UI-D-572)', () => {
  it('shows the number pair with a decimal keyboard and parses it with the pt-BR rule', async () => {
    mount();
    pick('Número');
    typeTitle('Idade');
    const min = screen.getByLabelText('Valor mínimo (opcional)') as HTMLInputElement;
    const max = screen.getByLabelText('Valor máximo (opcional)') as HTMLInputElement;
    expect(min.inputMode).toBe('decimal');
    fireEvent.change(min, { target: { value: '1.000,5' } });
    fireEvent.change(max, { target: { value: '2000' } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({
      type: 'number',
      limits: { min: 1000.5, max: 2000 },
    });
  });

  it('refuses a minimum above the maximum for numbers and for dates', async () => {
    mount();
    pick('Número');
    typeTitle('Idade');
    fireEvent.change(screen.getByLabelText('Valor mínimo (opcional)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Valor máximo (opcional)'), { target: { value: '2' } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('O mínimo não pode ser maior que o máximo.');
    cleanup();

    mount();
    pick('Data');
    typeTitle('Início');
    const min = screen.getByLabelText('Data mínima (opcional)') as HTMLInputElement;
    expect(min.type).toBe('date');
    fireEvent.change(min, { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText('Data máxima (opcional)'), {
      target: { value: '2026-01-01' },
    });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      'A data mínima não pode ser depois da máxima.',
    );
  });

  it('flags a limit text that is not a number under its field', async () => {
    mount();
    pick('Número');
    typeTitle('Idade');
    fireEvent.change(screen.getByLabelText('Valor mínimo (opcional)'), {
      target: { value: 'abc' },
    });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(screen.getByRole('alert').textContent).toBe('Informe um número.');
    expect(document.activeElement).toBe(screen.getByLabelText('Valor mínimo (opcional)'));
  });

  it('gives rating, yes/no and acceptance their one-line note and no extra field', () => {
    const notes: [string, string][] = [
      ['Avaliação', 'O membro escolhe de 1 a 5 estrelas.'],
      ['Sim ou não', 'O membro responde Sim ou Não.'],
      [
        'Aceite',
        'O membro marca uma caixa. Se a pergunta for obrigatória, só conta como respondida quando a caixa está marcada.',
      ],
    ];
    for (const [type, note] of notes) {
      mount();
      pick(type);
      expect(screen.getByText(note), type).toBeTruthy();
      expect(screen.queryByLabelText(/mínim|máxim/i), type).toBeNull();
      cleanup();
    }
  });

  it('gives text, phone, e-mail and link a format note and never a mask, placeholder or cap field', () => {
    const notes: [string, string][] = [
      ['Telefone', 'O telefone é validado com DDD.'],
      ['E-mail', 'O endereço de e-mail é validado.'],
      ['Link', 'O link precisa começar com http:// ou https://.'],
      ['Texto curto', 'O membro escreve uma linha, com até 120 caracteres.'],
    ];
    for (const [type, note] of notes) {
      mount();
      pick(type);
      expect(screen.getByText(note), type).toBeTruthy();
      expect(screen.queryByLabelText(/máscara|placeholder|limite de caracteres/i), type).toBeNull();
      cleanup();
    }
  });
});

describe('the impact before a reopening save (D-585, UI-D-576, T-12-34)', () => {
  async function fillRequired(required = true) {
    mount();
    pick('Texto curto');
    typeTitle('Cargo');
    if (required) fireEvent.click(screen.getByRole('switch', { name: 'Obrigatória' }));
    await act(async () => {
      fireEvent.click(saveButton());
    });
  }

  it('writes NOTHING when the impact read fails, and says so', async () => {
    mocks.impact.mockResolvedValue({ ok: false, code: 'failed' });
    await fillRequired();
    expect(mocks.impact).toHaveBeenCalledWith({ change: 'create_required' });
    expect(mocks.create).toHaveBeenCalledTimes(0);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message:
        'Não foi possível calcular quantos membros serão afetados. Nada foi salvo. Tente de novo.',
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Adicionar e exigir' })).toBeNull();
  });

  it('writes nothing when the impact read throws', async () => {
    mocks.impact.mockRejectedValue(new Error('network'));
    await fillRequired();
    expect(mocks.create).toHaveBeenCalledTimes(0);
    expect(mocks.show).toHaveBeenCalledTimes(1);
  });

  it('writes directly, with no dialog, when the impact is zero', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 0 });
    mocks.create.mockResolvedValue({ ok: true, question: adminQuestion('short_text'), pending: 0 });
    await fillRequired();
    expect(screen.queryByText('Adicionar pergunta obrigatória?')).toBeNull();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]?.[1]).toEqual({ reopens: true });
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Pergunta adicionada.' });
  });

  it('opens the dialog above zero and writes only when the admin confirms', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 12 });
    mocks.create.mockResolvedValue({ ok: true, question: adminQuestion('short_text'), pending: 9 });
    await fillRequired();
    expect(screen.getByText('Adicionar pergunta obrigatória?')).toBeTruthy();
    expect(
      screen.getByText(/12 membros vão precisar responder antes de continuar usando a comunidade/),
    ).toBeTruthy();
    expect(mocks.create).toHaveBeenCalledTimes(0);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar e exigir' }));
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    // the toast reports the SERVER's count after the write (9), not the preview's (12)
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Pergunta adicionada. 9 membros vão precisar responder.',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the admin goes back from the dialog, and keeps the draft', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 3 });
    await fillRequired();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    });
    expect(mocks.create).toHaveBeenCalledTimes(0);
    expect(titleField().value).toBe('Cargo');
  });

  it('reports one member in the singular', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 1 });
    mocks.create.mockResolvedValue({ ok: true, question: adminQuestion('short_text'), pending: 1 });
    await fillRequired();
    expect(screen.getByText(/^1 membro vai precisar responder antes/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar e exigir' }));
    });
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Pergunta adicionada. 1 membro vai precisar responder.',
    });
  });

  it('never reads the impact for an optional question', async () => {
    await fillRequired(false);
    expect(mocks.impact).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]?.[1]).toEqual({ reopens: false });
  });

  it('ends in the not-found refresh when the read says the permission was lost', async () => {
    mocks.impact.mockResolvedValue({ ok: false, code: 'forbidden' });
    await fillRequired();
    expect(mocks.create).toHaveBeenCalledTimes(0);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ── Task 3: edit mode, the locks, replace, archive and delete ─────────────────────────────────────

const OPT_A = { id: uuid(9101), label: 'Instagram', answerCount: 8 };
const OPT_B = { id: uuid(9102), label: 'Indicação', answerCount: 4 };
const OPT_C = { id: uuid(9103), label: 'Evento', answerCount: 0 };

function answered(over: Partial<ReturnType<typeof adminQuestion>> = {}) {
  return adminQuestion('single_choice', {
    title: 'Como conheceu?',
    helpText: 'Escolha uma',
    revision: 3,
    answerCount: 12,
    options: [OPT_A, OPT_B, OPT_C],
    ...over,
  });
}
function unanswered(over: Partial<ReturnType<typeof adminQuestion>> = {}) {
  return adminQuestion('short_text', {
    title: 'Cargo',
    revision: 2,
    answerCount: 0,
    options: [],
    ...over,
  });
}
const edit = (question: ReturnType<typeof adminQuestion>) => mount({ mode: 'edit', question });
const replaceButtons = () =>
  screen.queryAllByRole('button', { name: 'Criar nova pergunta e arquivar esta' });

describe('edit mode, nothing locked (UI-D-569)', () => {
  it('opens "Editar pergunta" with the stored data, no LGPD notice, the collapsed type and "Trocar tipo"', () => {
    edit(unanswered({ helpText: 'Seu cargo' }));
    expect(screen.getByRole('heading', { name: 'Editar pergunta' })).toBeTruthy();
    expect(dialog().querySelector('[data-lgpd-notice]')).toBeNull();
    expect(screen.getByText('Tipo: Texto curto')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Trocar tipo' })).toBeTruthy();
    expect(titleField().value).toBe('Cargo');
    expect((screen.getByLabelText('Texto de apoio (opcional)') as HTMLTextAreaElement).value).toBe(
      'Seu cargo',
    );
    expect(screen.getByText('5/120')).toBeTruthy();
  });

  it('is clean until something changes, then asks before closing', () => {
    edit(unanswered());
    closeSheet();
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockReset();
    typeTitle('Cargo atual');
    closeSheet();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Descartar as alterações?')).toBeTruthy();
  });

  it('closes without a request when nothing changed', async () => {
    edit(unanswered());
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends the revision and only the changed keys, then toasts "Pergunta atualizada."', async () => {
    const question = unanswered();
    mocks.update.mockResolvedValue({ ok: true, question, pending: null });
    edit(question);
    typeTitle('Cargo atual');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0]?.[0]).toBe(question.id);
    expect(mocks.update.mock.calls[0]?.[1]).toEqual({ revision: 2, title: 'Cargo atual' });
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Pergunta atualizada.' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('lets a never-answered question change type, keeping choice options between choice types', async () => {
    const question = unanswered({
      type: 'dropdown',
      options: [OPT_C, { ...OPT_C, id: uuid(9104), label: 'Feira' }],
    });
    edit(question);
    fireEvent.click(screen.getByRole('button', { name: 'Trocar tipo' }));
    pick('Múltipla escolha');
    expect(screen.getAllByLabelText(/^Opção \d+$/)).toHaveLength(2);
    expect(screen.queryByText('As opções serão removidas ao trocar para este tipo.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Trocar tipo' }));
    pick('Texto curto');
    expect(screen.getByText('As opções serão removidas ao trocar para este tipo.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Opções' })).toBeNull();
    mocks.update.mockResolvedValue({ ok: true, question, pending: null });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.update.mock.calls[0]?.[1]).toMatchObject({ revision: 2, type: 'short_text' });
  });

  it('reads the impact for an optional question turned required, and only then writes', async () => {
    const question = unanswered();
    mocks.impact.mockResolvedValue({ ok: true, members: 5 });
    mocks.update.mockResolvedValue({ ok: true, question, pending: 4 });
    edit(question);
    fireEvent.click(screen.getByRole('switch', { name: 'Obrigatória' }));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.impact).toHaveBeenCalledWith({ change: 'make_required', questionId: question.id });
    expect(screen.getByText('Tornar a pergunta obrigatória?')).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tornar obrigatória' }));
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Pergunta atualizada. 4 membros vão precisar responder.',
    });
  });

  it('does not read the impact when a required question stays required or becomes optional', async () => {
    const question = unanswered({ required: true });
    mocks.update.mockResolvedValue({ ok: true, question, pending: null });
    edit(question);
    typeTitle('Outro cargo');
    fireEvent.click(screen.getByRole('switch', { name: 'Obrigatória' }));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.impact).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});

describe('a question WITH answers: every lock shows its reason and its way out (D-587, UI-D-574)', () => {
  it('replaces the type picker by a read-only row with the plural explanation and the outline replace button', () => {
    edit(answered());
    expect(screen.getByText('Tipo: Escolha única')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Tipo de resposta' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Trocar tipo' })).toBeNull();
    expect(
      screen.getByText(
        'Esta pergunta já tem 12 respostas, então o tipo não pode mudar. Para usar outro tipo, crie uma nova pergunta e arquive esta.',
      ),
    ).toBeTruthy();
    const button = replaceButtons()[0] as HTMLElement;
    expect(button.className).toContain('border-border-secondary');
  });

  it('says "1 resposta" in the singular', () => {
    edit(answered({ answerCount: 1 }));
    expect(screen.getByText(/^Esta pergunta já tem 1 resposta, então/)).toBeTruthy();
  });

  it('keeps the title and help text free', async () => {
    const question = answered();
    mocks.update.mockResolvedValue({ ok: true, question, pending: null });
    edit(question);
    expect(titleField().disabled).toBe(false);
    typeTitle('Como nos conheceu?');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.update.mock.calls[0]?.[1]).toEqual({ revision: 3, title: 'Como nos conheceu?' });
  });

  it('shows answered options read-only with a lock, a count and no remove, unanswered ones editable', () => {
    edit(answered());
    expect(
      screen.getByText(
        'As opções que já têm respostas não podem ser removidas nem renomeadas. Você pode adicionar novas e mudar a ordem.',
      ),
    ).toBeTruthy();
    const locked = document.querySelectorAll('[data-option-locked]');
    expect(locked).toHaveLength(2);
    expect(locked[0]?.textContent).toContain('Instagram');
    expect(locked[0]?.textContent).toContain('8 respostas');
    expect(locked[0]?.textContent).toContain('Opção bloqueada: já tem respostas');
    expect(locked[1]?.textContent).toContain('4 respostas');
    // the unanswered third option is an ordinary row
    expect((screen.getByLabelText('Opção 3') as HTMLInputElement).value).toBe('Evento');
    expect(screen.queryByLabelText('Opção 1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remover opção 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remover opção 2' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remover opção 3' })).toBeTruthy();
  });

  it('keeps the reorder buttons of a locked option working, and sends the ids in the new order', async () => {
    const question = answered();
    mocks.update.mockResolvedValue({ ok: true, question, pending: null });
    edit(question);
    fireEvent.click(screen.getByRole('button', { name: 'Descer opção 1' }));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.update.mock.calls[0]?.[1]).toEqual({
      revision: 3,
      options: [
        { id: OPT_B.id, label: 'Indicação' },
        { id: OPT_A.id, label: 'Instagram' },
        { id: OPT_C.id, label: 'Evento' },
      ],
    });
  });

  it('lets the admin add new options and remove an unanswered one', async () => {
    const question = answered();
    mocks.update.mockResolvedValue({ ok: true, question, pending: null });
    edit(question);
    fireEvent.click(screen.getByRole('button', { name: 'Remover opção 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar opção' }));
    fireEvent.change(screen.getByLabelText('Opção 3'), { target: { value: 'Feira' } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.update.mock.calls[0]?.[1]).toEqual({
      revision: 3,
      options: [
        { id: OPT_A.id, label: 'Instagram' },
        { id: OPT_B.id, label: 'Indicação' },
        { label: 'Feira' },
      ],
    });
  });

  it('locks "Outro" on with its reason when the question allows it', () => {
    edit(answered({ allowOther: true }));
    const other = screen.getByRole('switch', {
      name: 'Incluir a opção “Outro”',
    }) as HTMLButtonElement;
    expect(other.getAttribute('aria-checked')).toBe('true');
    expect(other.disabled).toBe(true);
    expect(screen.getByText('Já existem respostas “Outro”. Não dá para desligar.')).toBeTruthy();
  });

  it('leaves "Outro" free to turn on when the question does not allow it yet', () => {
    edit(answered({ allowOther: false }));
    const other = screen.getByRole('switch', {
      name: 'Incluir a opção “Outro”',
    }) as HTMLButtonElement;
    expect(other.disabled).toBe(false);
  });

  it('shows the widen-only note and refuses a narrowed number pair before any request', async () => {
    const question = adminQuestion('number', {
      title: 'Idade',
      answerCount: 3,
      options: [],
      revision: 1,
      limits: { min: 1, max: 10 },
    });
    edit(question);
    expect(screen.getByText('Como já há respostas, só dá para ampliar o intervalo.')).toBeTruthy();
    expect((screen.getByLabelText('Valor mínimo (opcional)') as HTMLInputElement).value).toBe('1');
    fireEvent.change(screen.getByLabelText('Valor máximo (opcional)'), { target: { value: '9' } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      'Esse intervalo deixaria respostas fora do limite. Só é possível ampliar.',
    );
  });

  it('lets a widened pair through', async () => {
    const question = adminQuestion('number', {
      title: 'Idade',
      answerCount: 3,
      options: [],
      revision: 1,
      limits: { min: 1, max: 10 },
    });
    mocks.update.mockResolvedValue({ ok: true, question, pending: null });
    edit(question);
    fireEvent.change(screen.getByLabelText('Valor máximo (opcional)'), { target: { value: '20' } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.update.mock.calls[0]?.[1]).toEqual({ revision: 1, limits: { min: 1, max: 20 } });
  });

  it('freezes a PRIVATE question: the switch is disabled and off, with the reason and the replace button', () => {
    edit(answered({ showOnProfile: false }));
    const open = screen.getByRole('switch', {
      name: 'Mostrar no perfil do membro',
    }) as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    expect(open.getAttribute('aria-checked')).toBe('false');
    expect(
      screen.getByText(
        'Esta pergunta já tem respostas privadas, então não pode passar a ser pública. Para mostrar no perfil, crie uma nova pergunta e arquive esta.',
      ),
    ).toBeTruthy();
    expect(replaceButtons()).toHaveLength(2);
  });

  it('lets a PUBLIC question be turned off and warns it cannot be turned on again', async () => {
    const question = answered({ showOnProfile: true });
    mocks.update.mockResolvedValue({ ok: true, question, pending: null });
    edit(question);
    const open = screen.getByRole('switch', {
      name: 'Mostrar no perfil do membro',
    }) as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    expect(open.getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByText('Se você desligar, não poderá ligar de novo enquanto houver respostas.'),
    ).toBeTruthy();
    fireEvent.click(open);
    expect(
      screen.queryByText('Se você desligar, não poderá ligar de novo enquanto houver respostas.'),
    ).toBeNull();
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.update.mock.calls[0]?.[1]).toEqual({ revision: 3, showOnProfile: false });
  });

  it('leaves the visibility switch free both ways when nobody answered', () => {
    edit(unanswered({ showOnProfile: false }));
    const open = screen.getByRole('switch', {
      name: 'Mostrar no perfil do membro',
    }) as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    expect(
      screen.queryByText('Se você desligar, não poderá ligar de novo enquanto houver respostas.'),
    ).toBeNull();
  });

  it('keeps "Obrigatória" free on a question with answers', () => {
    edit(answered());
    expect(
      (screen.getByRole('switch', { name: 'Obrigatória' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('the 409 of the truth: the sheet explains it and saves nothing (PFORM-17 web half)', () => {
  it.each([
    'stale_revision',
    'type_locked',
    'option_locked',
    'other_locked',
    'visibility_locked',
    'limits_locked',
  ])('shows the in-sheet alert for %s, keeps the draft and refreshes the list', async (issue) => {
    mocks.update.mockResolvedValue({ ok: false, code: 'conflict', issue });
    edit(unanswered());
    typeTitle('Cargo atual');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    const alert = dialog().querySelector('[data-conflict-alert]') as HTMLElement;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toBe(
      'Esta pergunta foi alterada enquanto você editava. Feche e abra de novo para ver a versão atual.',
    );
    expect(alert.className).toContain('border-danger/40');
    expect(titleField().value).toBe('Cargo atual');
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('replace (UI-D-574)', () => {
  it('leaves the edit sheet for the replace flow straight away when nothing was edited', () => {
    const question = answered();
    edit(question);
    fireEvent.click(replaceButtons()[0] as HTMLElement);
    expect(onReplace).toHaveBeenCalledWith(question);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks before discarding unsaved edits, then leaves for the replace flow', async () => {
    const question = answered();
    edit(question);
    typeTitle('Mudei');
    fireEvent.click(replaceButtons()[0] as HTMLElement);
    expect(onReplace).not.toHaveBeenCalled();
    expect(screen.getByText('Descartar as alterações?')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    });
    expect(onReplace).toHaveBeenCalledWith(question);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('opens "Substituir pergunta" with the old data copied, the grid open, the banner and the LGPD notice', () => {
    const question = answered({ required: true, showOnProfile: true });
    mount({ mode: 'replace', question });
    expect(screen.getByRole('heading', { name: 'Substituir pergunta' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Tipo de resposta' })).toBeTruthy();
    const form = dialog().querySelector('form') as HTMLFormElement;
    const first = (form.querySelector('fieldset') as HTMLElement).firstElementChild as HTMLElement;
    expect(first.hasAttribute('data-lgpd-notice')).toBe(true);
    const banner = dialog().querySelector('[data-replace-banner]') as HTMLElement;
    expect(banner.textContent).toBe(
      '“Como conheceu?” será arquivada quando você salvar esta. As respostas dela continuam guardadas.',
    );
    pick('Texto curto');
    expect(titleField().value).toBe('Como conheceu?');
    expect((screen.getByLabelText('Texto de apoio (opcional)') as HTMLTextAreaElement).value).toBe(
      'Escolha uma',
    );
    expect(screen.getByRole('switch', { name: 'Obrigatória' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(
      screen
        .getByRole('switch', { name: 'Mostrar no perfil do membro' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    // nothing is locked on a replacement: it is a new question
    expect(
      (screen.getByRole('switch', { name: 'Mostrar no perfil do membro' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('saves a REQUIRED replacement after the impact confirmation, through ONE atomic action call', async () => {
    const question = answered({ required: true });
    mocks.impact.mockResolvedValue({ ok: true, members: 7 });
    mocks.replace.mockResolvedValue({ ok: true, question: adminQuestion('email'), pending: 7 });
    mount({ mode: 'replace', question });
    pick('E-mail');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.impact).toHaveBeenCalledWith({ change: 'replace', questionId: question.id });
    expect(screen.getByText('Substituir a pergunta?')).toBeTruthy();
    expect(
      screen.getByText(
        /“Como conheceu\?” será arquivada, com as respostas guardadas, e a nova entra no formulário\./,
      ),
    ).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Substituir' }));
    });
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace.mock.calls[0]?.[0]).toMatchObject({
      type: 'email',
      title: 'Como conheceu?',
      required: true,
      replaces: question.id,
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'success',
      message: 'Pergunta substituída. 7 membros vão precisar responder.',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves an OPTIONAL replacement with no impact read', async () => {
    const question = answered({ required: false });
    mocks.replace.mockResolvedValue({ ok: true, question: adminQuestion('email'), pending: null });
    mount({ mode: 'replace', question });
    pick('E-mail');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.impact).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Pergunta substituída.' });
  });

  it('keeps the old question and the draft when the atomic write fails', async () => {
    const question = answered();
    mocks.replace.mockResolvedValue({ ok: false, code: 'failed' });
    mount({ mode: 'replace', question });
    pick('E-mail');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.show).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(titleField().value).toBe('Como conheceu?');
  });
});

describe('archive and delete (D-588, UI-D-577)', () => {
  const removeBlock = () => dialog().querySelector('[data-remove-block]') as HTMLElement | null;

  it('offers "Arquivar pergunta" for a question with answers and never "Excluir pergunta"', () => {
    edit(answered());
    expect(
      within(removeBlock() as HTMLElement).getByRole('button', { name: 'Arquivar pergunta' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Excluir pergunta' })).toBeNull();
  });

  it('offers "Excluir pergunta" (ghost, danger) for a never-answered question and never "Arquivar"', () => {
    edit(unanswered());
    const button = within(removeBlock() as HTMLElement).getByRole('button', {
      name: 'Excluir pergunta',
    });
    expect(button.className).toContain('text-danger');
    expect(screen.queryByRole('button', { name: 'Arquivar pergunta' })).toBeNull();
  });

  it('offers neither in create or replace mode', () => {
    mount();
    expect(removeBlock()).toBeNull();
    cleanup();
    mount({ mode: 'replace', question: answered() });
    expect(removeBlock()).toBeNull();
  });

  it('archives after a brand confirmation that says how many answers are kept', async () => {
    const question = answered({ required: true });
    mocks.archive.mockResolvedValue({ ok: true });
    edit(question);
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar pergunta' }));
    expect(screen.getByText('Arquivar esta pergunta?')).toBeTruthy();
    expect(
      screen.getByText(
        'Ela deixa de ser feita aos membros. As 12 respostas continuam guardadas e entram na exportação. Você pode reativar depois. Quem ainda não respondeu deixa de precisar.',
      ),
    ).toBeTruthy();
    expect(mocks.archive).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    });
    expect(mocks.archive).toHaveBeenCalledWith(question.id);
    expect(mocks.impact).not.toHaveBeenCalled();
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Pergunta arquivada.' });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('omits the required sentence for an optional question and uses the singular for one answer', () => {
    edit(answered({ required: false, answerCount: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar pergunta' }));
    expect(
      screen.getByText(
        'Ela deixa de ser feita aos membros. A 1 resposta continua guardada e entra na exportação. Você pode reativar depois.',
      ),
    ).toBeTruthy();
  });

  it('deletes after a danger confirmation', async () => {
    const question = unanswered();
    mocks.remove.mockResolvedValue({ ok: true });
    edit(question);
    fireEvent.click(screen.getByRole('button', { name: 'Excluir pergunta' }));
    expect(screen.getByText('Excluir esta pergunta?')).toBeTruthy();
    expect(
      screen.getByText('Ninguém respondeu esta pergunta ainda. A exclusão não pode ser desfeita.'),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    });
    expect(mocks.remove).toHaveBeenCalledWith(question.id);
    expect(mocks.show).toHaveBeenCalledWith({ tone: 'success', message: 'Pergunta excluída.' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('answers the race "an answer arrived" with the archive-instead toast and a refresh', async () => {
    mocks.remove.mockResolvedValue({ ok: false, code: 'hasAnswers' });
    edit(unanswered());
    fireEvent.click(screen.getByRole('button', { name: 'Excluir pergunta' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    });
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Esta pergunta recebeu respostas. Arquive em vez de excluir.',
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('cancels without a request', async () => {
    edit(answered());
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar pergunta' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    });
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('toasts a failure and keeps the sheet', async () => {
    mocks.archive.mockResolvedValue({ ok: false, code: 'failed' });
    edit(answered());
    fireEvent.click(screen.getByRole('button', { name: 'Arquivar pergunta' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Arquivar' }));
    });
    expect(mocks.show).toHaveBeenCalledWith({
      tone: 'error',
      message: 'Não foi possível arquivar agora. Tente de novo.',
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('no raw HTML anywhere in the editor (T-12-35)', () => {
  it('renders an admin-typed title, option label and help text as text', () => {
    edit(
      answered({
        title: '<script>alert(1)</script>',
        helpText: '<b>x</b>',
        options: [{ ...OPT_A, label: '<img src=x onerror=alert(1)>' }, OPT_B],
      }),
    );
    expect(dialog().querySelector('script, img, b')).toBeNull();
    expect(titleField().value).toBe('<script>alert(1)</script>');
    expect(dialog().textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

// ── 12.1-17 Task 1: the step field and the condition editor inside the sheet (UI-D-647, UI-D-648) ──

describe('12.1-17: "Onde e quando aparece", the Etapa field (D-623, UI-D-647)', () => {
  const s1 = adminStep({ title: 'Informações gerais' });
  const s2 = adminStep({ title: 'Sobre a sua clínica' });
  const steps = [s1, s2];
  const plain = adminQuestion('short_text', { stepId: s1.id, title: 'Nome profissional' });
  const target = adminQuestion('short_text', { stepId: s2.id, title: 'Telefone da clínica' });
  const active = [plain, target];

  const stepSelect = () => screen.getByLabelText('Etapa') as HTMLSelectElement;

  it('shows the block after the two switch rows, before the footer', () => {
    mount({ questions: active, steps });
    pick('Texto curto');
    expect(screen.queryByText('Onde e quando aparece')).toBeTruthy();
    const form = dialog().querySelector('form') as HTMLFormElement;
    const block = form.querySelector('[data-where-block]') as HTMLElement;
    const switches = screen.getByRole('switch', { name: 'Mostrar no perfil do membro' });
    expect(switches.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      block.compareDocumentPosition(saveButton()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(block.querySelector('h3')?.textContent).toBe('Onde e quando aparece');
  });

  it('shows no block when the caller does not hold the question list', () => {
    mount();
    pick('Texto curto');
    expect(screen.queryByText('Onde e quando aparece')).toBeNull();
  });

  it('offers the "Etapa" select only with two or more steps, defaulting to the last', () => {
    const { unmount } = mount({ questions: active, steps });
    pick('Texto curto');
    expect(stepSelect().tagName).toBe('SELECT');
    expect(
      within(stepSelect())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Informações gerais', 'Sobre a sua clínica']);
    expect(stepSelect().value).toBe(s2.id);
    expect(
      screen.getByText(
        'Os membros respondem as etapas em ordem. Ao mudar de etapa, a pergunta vai para o fim da nova etapa.',
      ),
    ).toBeTruthy();
    unmount();

    // One step and no branch: nothing to decide, so no block at all (the condition left the sheet).
    mount({ questions: active, steps: [s1] });
    pick('Texto curto');
    expect(screen.queryByLabelText('Etapa')).toBeNull();
    expect(screen.queryByText('Onde e quando aparece')).toBeNull();
  });

  it('opens on the step the sheet was opened from', () => {
    mount({ questions: active, steps, stepId: s1.id });
    pick('Texto curto');
    expect(stepSelect().value).toBe(s1.id);
  });

  it('saves the step through the create action, with no branch and no condition key', async () => {
    mount({ questions: active, steps, stepId: s2.id });
    pick('Texto curto');
    typeTitle('Telefone');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const body = mocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.stepId).toBe(s2.id);
    expect(Object.keys(body)).not.toContain('branchId');
    expect(Object.keys(body)).not.toContain('condition');
    expect(onClose).toHaveBeenCalled();
  });

  it('an edit sends the new step and only it', async () => {
    mocks.update.mockResolvedValue({
      ok: true,
      question: adminQuestion('short_text'),
      pending: null,
    });
    mount({ mode: 'edit', question: target, questions: active, steps });
    fireEvent.change(stepSelect(), { target: { value: s1.id } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.update.mock.calls[0]?.[1]).toEqual({ revision: target.revision, stepId: s1.id });
  });
});

describe('12.2-16: every impact dialog of a required question in a branch (D-634, D-646)', () => {
  const ids = [uuid(9421), uuid(9422)];
  const clinic = adminQuestion('single_choice', {
    title: 'Você tem clínica?',
    options: [
      { id: ids[0] as string, label: 'Tenho uma clínica', answerCount: 0 },
      { id: ids[1] as string, label: 'Trabalho em uma clínica', answerCount: 0 },
    ],
  });
  const team = adminQuestion('yes_no', { title: 'Você já tem equipe?' });
  const clinicBranch = adminBranch({
    openerQuestionId: clinic.id,
    values: [ids[0] as string, ids[1] as string],
  });
  const teamBranch = adminBranch({ openerQuestionId: team.id, values: ['true'] });
  const branches = [clinicBranch, teamBranch];
  const SENTENCE =
    'Só conta quem vê esta pergunta: quem respondeu “Você tem clínica?” com “Tenho uma clínica” ou “Trabalho em uma clínica”.';
  const ramo = () => screen.getByLabelText('Ramo') as HTMLSelectElement;

  async function createRequiredIn(branchId: string, title = 'Nome da clínica') {
    mount({ questions: [clinic, team], steps: [], branches });
    pick('Texto curto');
    typeTitle(title);
    fireEvent.click(screen.getByRole('switch', { name: 'Obrigatória' }));
    fireEvent.change(ramo(), { target: { value: branchId } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
  }

  it('ADD: the impact request carries the branch, and the dialog ends with the sentence', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 5 });
    await createRequiredIn(clinicBranch.id);
    expect(mocks.impact).toHaveBeenCalledWith({
      change: 'create_required',
      branchId: clinicBranch.id,
    });
    const confirm = await screen.findByRole('dialog', { name: 'Adicionar pergunta obrigatória?' });
    expect(confirm.textContent).toContain(
      '5 membros vão precisar responder antes de continuar usando a comunidade. Quem já respondeu as outras perguntas responde só esta. ' +
        SENTENCE,
    );
  });

  it('ADD with a yes/no opener names the plain word, unquoted', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 2 });
    await createRequiredIn(teamBranch.id, 'Quantas pessoas?');
    expect(mocks.impact).toHaveBeenCalledWith({
      change: 'create_required',
      branchId: teamBranch.id,
    });
    const confirm = await screen.findByRole('dialog', { name: 'Adicionar pergunta obrigatória?' });
    expect(confirm.textContent).toContain(
      'Só conta quem vê esta pergunta: quem respondeu “Você já tem equipe?” com Sim.',
    );
  });

  it('adds no sentence for a required question with no branch', async () => {
    mocks.impact.mockResolvedValue({ ok: true, members: 5 });
    mount({ questions: [clinic, team], steps: [], branches });
    pick('Texto curto');
    typeTitle('Cargo');
    fireEvent.click(screen.getByRole('switch', { name: 'Obrigatória' }));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.impact).toHaveBeenCalledWith({ change: 'create_required' });
    const confirm = await screen.findByRole('dialog', { name: 'Adicionar pergunta obrigatória?' });
    expect(confirm.textContent).not.toContain('Só conta quem vê');
  });

  it('MAKE REQUIRED on a question in a branch ends with the sentence', async () => {
    const shown = adminQuestion('short_text', {
      title: 'Nome da clínica',
      branchId: clinicBranch.id,
    });
    mocks.impact.mockResolvedValue({ ok: true, members: 3 });
    mount({ mode: 'edit', question: shown, questions: [clinic, shown], steps: [], branches });
    fireEvent.click(screen.getByRole('switch', { name: 'Obrigatória' }));
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.impact).toHaveBeenCalledWith({ change: 'make_required', questionId: shown.id });
    const confirm = await screen.findByRole('dialog', { name: 'Tornar a pergunta obrigatória?' });
    expect(confirm.textContent).toContain(SENTENCE);
  });

  it('REPLACE: the request carries the copied branch, and the dialog has both notes', async () => {
    const old = adminQuestion('short_text', {
      title: 'Nome da clínica',
      required: true,
      answerCount: 4,
      branchId: clinicBranch.id,
    });
    mocks.impact.mockResolvedValue({ ok: true, members: 2 });
    mount({ mode: 'replace', question: old, questions: [clinic, old], steps: [], branches });
    pick('Texto curto');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.impact).toHaveBeenCalledWith({
      change: 'replace',
      questionId: old.id,
      branchId: clinicBranch.id,
    });
    const confirm = await screen.findByRole('dialog', { name: 'Substituir a pergunta?' });
    expect(confirm.textContent).toContain('“Nome da clínica” será arquivada');
    expect(confirm.textContent).toContain(SENTENCE);
  });

  describe('a REQUIRED question leaving its branch reads the impact BEFORE the write', () => {
    const inBranch = (overrides = {}) =>
      adminQuestion('short_text', {
        title: 'Nome da clínica',
        required: true,
        branchId: clinicBranch.id,
        ...overrides,
      });

    async function leaveAndSave(question: ReturnType<typeof adminQuestion>) {
      mount({ mode: 'edit', question, questions: [clinic, question], steps: [], branches });
      fireEvent.change(ramo(), { target: { value: '' } });
      await act(async () => {
        fireEvent.click(saveButton());
      });
    }

    it('opens "Remover a condição?" when members would newly owe an answer, and writes only on confirm', async () => {
      const question = inBranch();
      mocks.impact.mockResolvedValue({ ok: true, members: 4 });
      mocks.update.mockResolvedValue({ ok: true, question, pending: 4 });
      await leaveAndSave(question);
      expect(mocks.impact).toHaveBeenCalledWith({
        change: 'remove_condition',
        questionId: question.id,
      });
      const confirm = await screen.findByRole('dialog', { name: 'Remover a condição?' });
      expect(confirm.textContent).toContain(
        '4 membros que hoje não veem esta pergunta vão precisar respondê-la antes de continuar usando a comunidade.',
      );
      expect(mocks.update).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(within(confirm).getByRole('button', { name: 'Remover e exigir' }));
      });
      expect(mocks.update.mock.calls[0]?.[1]).toEqual({
        revision: question.revision,
        branchId: null,
      });
      expect(mocks.impact.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.update.mock.invocationCallOrder[0] as number,
      );
    });

    it('writes directly, with no dialog, when no member is affected', async () => {
      const question = inBranch();
      mocks.impact.mockResolvedValue({ ok: true, members: 0 });
      mocks.update.mockResolvedValue({ ok: true, question, pending: 0 });
      await leaveAndSave(question);
      expect(screen.queryByRole('dialog', { name: 'Remover a condição?' })).toBeNull();
      expect(mocks.update.mock.calls[0]?.[1]).toEqual({
        revision: question.revision,
        branchId: null,
      });
    });

    it('saves NOTHING when the impact cannot be read, and says so', async () => {
      mocks.impact.mockResolvedValue({ ok: false, code: 'failed' });
      await leaveAndSave(inBranch());
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.show).toHaveBeenCalledWith({
        tone: 'error',
        message:
          'Não foi possível calcular quantos membros serão afetados. Nada foi salvo. Tente de novo.',
      });
      expect(onClose).not.toHaveBeenCalled();
    });

    it('reads no impact for an OPTIONAL question that leaves its branch', async () => {
      const question = inBranch({ required: false });
      mocks.update.mockResolvedValue({ ok: true, question, pending: null });
      await leaveAndSave(question);
      expect(mocks.impact).not.toHaveBeenCalled();
      expect(mocks.update.mock.calls[0]?.[1]).toEqual({
        revision: question.revision,
        branchId: null,
      });
    });
  });
});

// ── 12.2-16 Task 1: the "Ramo" field (D-640, D-641, D-644, D-646, D-651, UI-D-669) ───────────────────

describe('12.2-16: the "Ramo" field of "Onde e quando aparece" (UI-D-669)', () => {
  const s1 = adminStep({ title: 'Informações gerais' });
  const s2 = adminStep({ title: 'Sobre a sua clínica' });
  const steps = [s1, s2];
  const A = uuid(9401);
  const B = uuid(9402);
  const C = uuid(9403);
  const opts = [
    { id: A, label: 'Tenho uma clínica', answerCount: 0 },
    { id: B, label: 'Trabalho em uma clínica', answerCount: 0 },
    { id: C, label: 'Estou aprendendo', answerCount: 0 },
  ];
  const clinic = adminQuestion('single_choice', {
    stepId: s1.id,
    title: 'Você tem clínica?',
    options: opts,
    showOnProfile: true,
  });
  const named = adminBranch({ openerQuestionId: clinic.id, values: [A], name: 'Quem tem clínica' });
  const unnamed = adminBranch({ openerQuestionId: clinic.id, values: [C], name: null });
  const inBranch = adminQuestion('short_text', {
    stepId: s1.id,
    title: 'Nome da clínica',
    branchId: named.id,
  });
  const second = adminQuestion('dropdown', {
    stepId: s2.id,
    title: 'Segunda abridora',
    options: opts,
    showOnProfile: true,
  });
  const secondBranch = adminBranch({ openerQuestionId: second.id, values: [A], name: 'Ramo dois' });
  const free = adminQuestion('short_text', { stepId: s2.id, title: 'Telefone' });
  const active = [clinic, inBranch, second, free];
  const branches = [named, unnamed, secondBranch];

  const ramo = () => screen.getByLabelText('Ramo') as HTMLSelectElement;

  beforeEach(() => {
    mocks.update.mockResolvedValue({ ok: true, question: inBranch, pending: null });
  });

  const optionTexts = () =>
    within(ramo())
      .getAllByRole('option')
      .map((o) => o.textContent);

  it('renders the select only when the form has at least one branch', () => {
    const { unmount } = mount({ questions: active, steps, branches: [] });
    pick('Texto curto');
    expect(screen.queryByLabelText('Ramo')).toBeNull();
    unmount();

    mount({ questions: active, steps, branches });
    pick('Texto curto');
    expect(ramo().tagName).toBe('SELECT');
    expect(screen.getByText('Onde e quando aparece')).toBeTruthy();
  });

  it('puts "Nenhum: todos os membros veem" first (value empty), then one optgroup per opener', () => {
    mount({ questions: active, steps, branches, stepId: s2.id });
    pick('Texto curto');
    const first = ramo().options[0] as HTMLOptionElement;
    expect(first.value).toBe('');
    expect(first.textContent).toBe('Nenhum: todos os membros veem');
    const groups = [...ramo().querySelectorAll('optgroup')];
    expect(groups.map((group) => group.label)).toEqual(['Você tem clínica?', 'Segunda abridora']);
    expect(optionTexts()).toEqual([
      'Nenhum: todos os membros veem',
      'Quem tem clínica',
      'Se “Você tem clínica?” for “Estou aprendendo”',
      'Ramo dois',
    ]);
    expect(ramo().value).toBe('');
  });

  it('shows the helper with the depth limit, linked to the field', () => {
    mount({ questions: active, steps, branches });
    pick('Texto curto');
    const helper = screen.getByText(
      'Aparecem aqui os ramos cuja pergunta que decide vem antes desta e que não passam de 3 níveis. Ao mudar de ramo, a pergunta continua na mesma etapa e vai para o fim do ramo.',
    );
    expect(ramo().getAttribute('aria-describedby')).toContain(helper.id);
  });

  it('leaves out a branch whose opener comes after the question', () => {
    mount({ questions: active, steps, branches, stepId: s1.id });
    pick('Texto curto');
    expect(optionTexts()).toEqual([
      'Nenhum: todos os membros veem',
      'Quem tem clínica',
      'Se “Você tem clínica?” for “Estou aprendendo”',
    ]);
  });

  it('for a public question leaves out the branches of a private opener and says why', () => {
    const hidden = adminQuestion('single_choice', {
      stepId: s1.id,
      title: 'Opinião privada',
      options: opts,
      showOnProfile: false,
    });
    const hiddenBranch = adminBranch({ openerQuestionId: hidden.id, values: [A], name: 'Privado' });
    mount({
      questions: [hidden, ...active],
      steps,
      branches: [...branches, hiddenBranch],
      stepId: s2.id,
    });
    pick('Texto curto');
    const second2 =
      'Ramos que dependem de perguntas que não aparecem no perfil ficam de fora porque esta pergunta aparece.';
    expect(screen.queryByText(second2)).toBeNull();
    expect(optionTexts()).toContain('Privado');

    fireEvent.click(screen.getByRole('switch', { name: 'Mostrar no perfil do membro' }));
    expect(optionTexts()).not.toContain('Privado');
    expect(screen.getByText(second2)).toBeTruthy();
  });

  it('says in a polite status line that only who sees a required question must answer it', () => {
    mount({ questions: active, steps, branches });
    pick('Texto curto');
    const note = 'Como esta pergunta é obrigatória, só quem a vê precisa responder.';
    fireEvent.change(ramo(), { target: { value: named.id } });
    expect(screen.queryByText(note)).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Obrigatória' }));
    expect(screen.getByText(note).closest('[role="status"]')).toBeTruthy();
    fireEvent.change(ramo(), { target: { value: '' } });
    expect(screen.queryByText(note)).toBeNull();
  });

  it('no longer holds the 12.1 condition editor', () => {
    mount({ questions: active, steps, branches });
    pick('Texto curto');
    expect(screen.queryByRole('switch', { name: 'Mostrar só em alguns casos' })).toBeNull();
    expect(screen.queryByLabelText('Pergunta que decide')).toBeNull();
  });

  it('creates with the chosen branch: branchId in the body and no condition key', async () => {
    mount({ questions: active, steps, branches, stepId: s1.id });
    pick('Texto curto');
    typeTitle('Telefone da clínica');
    fireEvent.change(ramo(), { target: { value: named.id } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const body = mocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.branchId).toBe(named.id);
    expect(body.stepId).toBe(s1.id);
    expect('condition' in body).toBe(false);
  });

  it('starts on the branch and the step it is given (the Lista footer)', async () => {
    mount({ questions: active, steps, branches, stepId: s1.id, initialBranchId: named.id });
    pick('Texto curto');
    expect(ramo().value).toBe(named.id);
    typeTitle('Equipe');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    const body = mocks.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.branchId).toBe(named.id);
    expect(body.stepId).toBe(s1.id);
  });

  it('an edit sends only the branch it changed, and null when the question leaves it', async () => {
    mount({ mode: 'edit', question: inBranch, questions: active, steps, branches });
    expect(ramo().value).toBe(named.id);
    fireEvent.change(ramo(), { target: { value: unnamed.id } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.update.mock.calls[0]?.[1]).toEqual({
      revision: inBranch.revision,
      branchId: unnamed.id,
    });
  });

  it('an edit that leaves its branch sends branchId null', async () => {
    mount({ mode: 'edit', question: inBranch, questions: active, steps, branches });
    fireEvent.change(ramo(), { target: { value: '' } });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(mocks.update.mock.calls[0]?.[1]).toEqual({
      revision: inBranch.revision,
      branchId: null,
    });
  });

  it('a question WITH answers shows a read-only lock row and the way out instead of the select', () => {
    const answered = adminQuestion('short_text', {
      stepId: s1.id,
      title: 'Respondida',
      answerCount: 3,
      branchId: named.id,
    });
    mount({ mode: 'edit', question: answered, questions: [...active, answered], steps, branches });
    expect(screen.queryByLabelText('Ramo')).toBeNull();
    const row = screen.getByText(
      'Esta pergunta já tem 3 respostas, então não pode entrar nem sair de um ramo. Para mudar, crie uma nova pergunta e arquive esta.',
    );
    expect(row.parentElement?.querySelector('svg')).toBeTruthy();
    const replace = screen
      .getAllByRole('button', { name: 'Criar nova pergunta e arquivar esta' })
      .at(-1) as HTMLElement;
    fireEvent.click(replace);
    expect(onReplace).toHaveBeenCalledWith(answered);
  });

  it('says "1 resposta" in the singular on the lock row', () => {
    const answered = adminQuestion('short_text', { stepId: s1.id, answerCount: 1 });
    mount({ mode: 'edit', question: answered, questions: [...active, answered], steps, branches });
    expect(
      screen.getByText(/^Esta pergunta já tem 1 resposta, então não pode entrar/),
    ).toBeTruthy();
  });

  it('a replacement copies the step and the branch of the replaced question', () => {
    mount({ mode: 'replace', question: inBranch, questions: active, steps, branches });
    pick('Texto curto');
    expect(ramo().value).toBe(named.id);
    expect((screen.getByLabelText('Etapa') as HTMLSelectElement).value).toBe(s1.id);
  });

  it('snaps the step back when it would put a question above the step of its branch opener', () => {
    const lateOpener = adminQuestion('single_choice', {
      stepId: s2.id,
      title: 'Abridora tardia',
      options: opts,
    });
    const lateBranch = adminBranch({ openerQuestionId: lateOpener.id, values: [A] });
    const dependent = adminQuestion('short_text', {
      stepId: s2.id,
      title: 'Dependente',
      branchId: lateBranch.id,
    });
    mount({
      mode: 'edit',
      question: dependent,
      questions: [lateOpener, dependent],
      steps,
      branches: [lateBranch],
    });
    const stepSelect = screen.getByLabelText('Etapa') as HTMLSelectElement;
    fireEvent.change(stepSelect, { target: { value: s1.id } });
    expect(stepSelect.value).toBe(s2.id);
    const alert = screen.getByText(
      'Esta pergunta depende de “Abridora tardia”, então precisa ficar na etapa dela ou em uma depois.',
    );
    expect(alert.getAttribute('role')).toBe('alert');
  });

  it('snaps an opener back when the step would put it at or after a question of its branch', () => {
    const opener = adminQuestion('single_choice', {
      stepId: s1.id,
      title: 'Abridora',
      options: opts,
    });
    const openerBranch = adminBranch({ openerQuestionId: opener.id, values: [A] });
    const dependent = adminQuestion('short_text', {
      stepId: s2.id,
      title: 'Dependente',
      branchId: openerBranch.id,
    });
    mount({
      mode: 'edit',
      question: opener,
      questions: [opener, dependent],
      steps,
      branches: [openerBranch],
    });
    const stepSelect = screen.getByLabelText('Etapa') as HTMLSelectElement;
    fireEvent.change(stepSelect, { target: { value: s2.id } });
    expect(stepSelect.value).toBe(s1.id);
    expect(
      screen
        .getByText(
          '“Dependente” depende desta pergunta, então ela precisa ficar na etapa de “Dependente” ou em uma antes.',
        )
        .getAttribute('role'),
    ).toBe('alert');
  });

  it('clears a draft branch the new step no longer allows, with no refusal', () => {
    mount({ questions: active, steps, branches, stepId: s2.id });
    pick('Texto curto');
    fireEvent.change(ramo(), { target: { value: secondBranch.id } });
    fireEvent.change(screen.getByLabelText('Etapa'), { target: { value: s1.id } });
    expect(ramo().value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  describe('a refused write lands under the field (E3 error)', () => {
    async function saveWith(result: unknown, branch = named.id) {
      mocks.update.mockResolvedValue(result);
      mount({ mode: 'edit', question: free, questions: active, steps, branches });
      fireEvent.change(ramo(), { target: { value: branch } });
      await act(async () => {
        fireEvent.click(saveButton());
      });
    }

    it('condition_order names the opener the question must follow', async () => {
      await saveWith({ ok: false, code: 'conflict', issue: 'condition_order' });
      const line = screen.getByText(
        'Esta pergunta depende de “Você tem clínica?”, então precisa ficar na etapa dela ou em uma depois.',
      );
      expect(line.getAttribute('role')).toBe('alert');
      expect(ramo().getAttribute('aria-invalid')).toBe('true');
      expect(onClose).not.toHaveBeenCalled();
    });

    it('branch_depth explains the level limit and keeps the draft', async () => {
      await saveWith({ ok: false, code: 'conflict', issue: 'branch_depth' });
      const line = screen
        .getAllByText(/não passam de 3 níveis/)
        .find((node) => node.getAttribute('role') === 'alert');
      expect(line).toBeTruthy();
      expect(ramo().value).toBe(named.id);
    });

    it('condition_locked says an answer arrived, in the lock sentence of the field', async () => {
      await saveWith({ ok: false, code: 'conflict', issue: 'condition_locked' });
      const line = screen.getByText(
        'Esta pergunta já tem 1 resposta, então não pode entrar nem sair de um ramo. Para mudar, crie uma nova pergunta e arquive esta.',
      );
      expect(line.getAttribute('role')).toBe('alert');
      expect(ramo().getAttribute('aria-invalid')).toBe('true');
    });

    it('a branch that vanished (unknown or archived) is the conflict alert and a refresh', async () => {
      await saveWith({ ok: false, code: 'conflict', issue: 'branch_archived' });
      expect(document.querySelector('[data-conflict-alert]')).toBeTruthy();
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });
});

// ── 12.2-16 Task 2: "Ramos desta pergunta" and "Criar ramo" (D-651, D-644, UI-D-670) ────────────────

describe('12.2-16: "Ramos desta pergunta" and "Criar ramo" (UI-D-670)', () => {
  const s1 = adminStep({ title: 'Informações gerais' });
  const A = uuid(9801);
  const B = uuid(9802);
  const opener = adminQuestion('single_choice', {
    stepId: s1.id,
    title: 'Você tem clínica?',
    options: [
      { id: A, label: 'Tenho uma clínica', answerCount: 0 },
      { id: B, label: 'Trabalho em uma clínica', answerCount: 0 },
    ],
  });
  const withName = adminBranch({
    openerQuestionId: opener.id,
    values: [A],
    name: 'Quem tem clínica',
  });
  const noName = adminBranch({ openerQuestionId: opener.id, values: [B], name: null });
  const m1 = adminQuestion('short_text', { stepId: s1.id, branchId: withName.id });
  const m2 = adminQuestion('short_text', { stepId: s1.id, branchId: withName.id });
  const m3 = adminQuestion('short_text', { stepId: s1.id, branchId: noName.id });
  const active = [opener, m1, m2, m3];

  const create = vi.fn();
  const openBranch = vi.fn();
  beforeEach(() => {
    create.mockReset();
    openBranch.mockReset();
  });

  const block = () => document.querySelector('[data-branches-block]') as HTMLElement | null;
  const createButton = () =>
    screen.getByRole('button', { name: 'Criar ramo' }) as HTMLButtonElement;
  const edit = (props: Parameters<typeof mount>[0] = {}) =>
    mount({
      mode: 'edit',
      question: opener,
      questions: active,
      steps: [s1],
      branches: [withName, noName],
      onCreateBranch: create,
      onOpenBranch: openBranch,
      ...props,
    });

  it('appears for the four opener types and for no other', () => {
    for (const type of ['dropdown', 'multiple_choice', 'single_choice', 'yes_no'] as const) {
      const q = adminQuestion(type, { stepId: s1.id });
      const { unmount } = mount({
        mode: 'edit',
        question: q,
        questions: [q],
        steps: [s1],
        onCreateBranch: create,
      });
      expect(block(), type).toBeTruthy();
      unmount();
    }
    for (const type of ['short_text', 'long_text', 'rating', 'number', 'date', 'email'] as const) {
      const q = adminQuestion(type, { stepId: s1.id });
      const { unmount } = mount({
        mode: 'edit',
        question: q,
        questions: [q],
        steps: [s1],
        onCreateBranch: create,
      });
      expect(block(), type).toBeNull();
      unmount();
    }
  });

  it('follows the type the draft has now, for a question nobody answered', () => {
    const q = adminQuestion('short_text', { stepId: s1.id });
    mount({ mode: 'edit', question: q, questions: [q], steps: [s1], onCreateBranch: create });
    expect(block()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Trocar tipo' }));
    pick('Escolha única');
    expect(block()).toBeTruthy();
  });

  it('comes after "Onde e quando aparece", with the micro title, the hint and the button', () => {
    edit();
    const where = document.querySelector('[data-where-block]') as HTMLElement;
    expect(block()?.querySelector('h3')?.textContent).toBe('Ramos desta pergunta');
    expect(
      screen.getByText(
        'Um ramo abre um grupo de perguntas só para quem responder como você definir.',
      ),
    ).toBeTruthy();
    expect(
      where.compareDocumentPosition(block() as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(createButton().className).toContain('border-border-secondary');
    expect(createButton().querySelector('svg')).toBeTruthy();
  });

  it('is gone as the 12.1 "Esta pergunta abre N perguntas" block', () => {
    edit({ question: { ...opener, opensCount: 3 } });
    expect(document.querySelector('[data-opens-block]')).toBeNull();
    expect(screen.queryByText(/^Esta pergunta abre \d/)).toBeNull();
  });

  describe('zero, one and many branches', () => {
    it('with none says so, and still offers "Criar ramo"', () => {
      edit({ branches: [] });
      expect(screen.getByText('Esta pergunta ainda não abre nenhum ramo.')).toBeTruthy();
      expect(block()?.querySelector('ul')).toBeNull();
      expect(createButton().disabled).toBe(false);
    });

    it('with one draws one row; with two, a list of two, in the layout order', () => {
      const { unmount } = edit({ branches: [withName] });
      expect(block()?.querySelectorAll('li')).toHaveLength(1);
      unmount();
      edit();
      const rows = [...(block()?.querySelectorAll('li button') ?? [])] as HTMLElement[];
      expect(rows).toHaveLength(2);
      expect(rows[0]?.textContent).toContain('Quem tem clínica');
      expect(rows[0]?.textContent).toContain('2 perguntas');
      expect(rows[1]?.textContent).toContain(
        'Se “Você tem clínica?” for “Trabalho em uma clínica”',
      );
      expect(rows[1]?.textContent).toContain('1 pergunta');
    });

    it('draws a row as a 44px rounded button with a clamped label, a Split and a chevron', () => {
      edit();
      const row = block()?.querySelector('li button') as HTMLElement;
      expect(row.className).toContain('min-h-11');
      expect(row.className).toContain('rounded-xl');
      expect(row.className).toContain('bg-bg-tertiary');
      expect(row.className).toContain('w-full');
      expect(row.querySelectorAll('svg')).toHaveLength(2);
      expect((row.querySelector('.line-clamp-2') as HTMLElement).textContent).toBe(
        'Quem tem clínica',
      );
    });

    it('draws no row when the host cannot open a branch, so no row does nothing', () => {
      edit({ onOpenBranch: undefined });
      expect(block()?.querySelector('li')).toBeNull();
      expect(createButton()).toBeTruthy();
    });

    it('draws a 60-character name and a long title clamped, and renders markup as text', () => {
      const long = adminBranch({
        openerQuestionId: opener.id,
        values: [A],
        name: `<b>${'n'.repeat(57)}`,
      });
      edit({ branches: [long] });
      expect(document.querySelector('[data-branches-block] b')).toBeNull();
      expect(block()?.querySelector('.line-clamp-2')?.textContent).toBe(`<b>${'n'.repeat(57)}`);
    });
  });

  describe('"Criar ramo" and the rows close this sheet first (D-651)', () => {
    it('hands the question to the host at once when nothing was edited', () => {
      edit();
      fireEvent.click(createButton());
      expect(create).toHaveBeenCalledWith(opener);
      expect(screen.queryByText('Descartar as alterações?')).toBeNull();
    });

    it('asks before leaving with unsaved edits, and leaves only on "Descartar"', () => {
      edit();
      typeTitle('Outro título');
      fireEvent.click(createButton());
      const ask = screen.getByRole('dialog', { name: 'Descartar as alterações?' });
      expect(create).not.toHaveBeenCalled();
      fireEvent.click(within(ask).getByRole('button', { name: 'Continuar editando' }));
      expect(create).not.toHaveBeenCalled();
      expect(titleField().value).toBe('Outro título');
      fireEvent.click(createButton());
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Descartar as alterações?' })).getByRole(
          'button',
          {
            name: 'Descartar',
          },
        ),
      );
      expect(create).toHaveBeenCalledWith(opener);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('opens a branch through the same guard', () => {
      edit();
      const row = block()?.querySelector('li button') as HTMLElement;
      fireEvent.click(row);
      expect(openBranch).toHaveBeenCalledWith(withName);
      openBranch.mockReset();
      typeTitle('Mudou');
      fireEvent.click(block()?.querySelector('li button') as HTMLElement);
      expect(openBranch).not.toHaveBeenCalled();
      fireEvent.click(
        within(screen.getByRole('dialog', { name: 'Descartar as alterações?' })).getByRole(
          'button',
          {
            name: 'Descartar',
          },
        ),
      );
      expect(openBranch).toHaveBeenCalledWith(withName);
    });

    it('is not offered without a host handler', () => {
      edit({ onCreateBranch: undefined });
      expect(screen.queryByRole('button', { name: 'Criar ramo' })).toBeNull();
    });
  });

  describe('a NEW, unsaved question cannot create branches yet (E3 partial)', () => {
    it('disables the button and says to save first, in create and in replace mode', () => {
      mount({
        questions: active,
        steps: [s1],
        branches: [withName],
        onCreateBranch: create,
      });
      pick('Escolha única');
      expect(createButton().disabled).toBe(true);
      expect(
        screen.getByText('Salve a pergunta para poder criar ramos a partir dela.'),
      ).toBeTruthy();
      fireEvent.click(createButton());
      expect(create).not.toHaveBeenCalled();
      cleanup();

      mount({
        mode: 'replace',
        question: opener,
        questions: active,
        steps: [s1],
        branches: [withName],
        onCreateBranch: create,
      });
      pick('Escolha única');
      expect(createButton().disabled).toBe(true);
    });
  });

  describe('depth and limit (UI-D-683, the numbers come from the limits)', () => {
    const r = adminQuestion('single_choice', { stepId: s1.id, title: 'R', options: [] });
    const b1 = adminBranch({ openerQuestionId: r.id, values: ['x'] });
    const q1 = adminQuestion('single_choice', { stepId: s1.id, title: 'Q1', branchId: b1.id });
    const b2 = adminBranch({ openerQuestionId: q1.id, values: ['x'] });
    const q2 = adminQuestion('single_choice', { stepId: s1.id, title: 'Q2', branchId: b2.id });
    const b3 = adminBranch({ openerQuestionId: q2.id, values: ['x'] });
    const q3 = adminQuestion('single_choice', { stepId: s1.id, title: 'Q3', branchId: b3.id });

    it('replaces the list and the button by the depth sentence when the question sits 3 levels deep', () => {
      mount({
        mode: 'edit',
        question: q3,
        questions: [r, q1, q2, q3],
        steps: [s1],
        branches: [b1, b2, b3],
        onCreateBranch: create,
        onOpenBranch: openBranch,
      });
      const line = screen.getByText(
        'Esta pergunta já está dentro de 3 níveis de ramo, o máximo. Ela não pode abrir outro ramo.',
      );
      expect(line.closest('[data-branches-block]')).toBeTruthy();
      expect(line.parentElement?.querySelector('svg')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Criar ramo' })).toBeNull();
      expect(block()?.querySelector('ul')).toBeNull();
    });

    it('still offers the button two levels deep', () => {
      mount({
        mode: 'edit',
        question: q2,
        questions: [r, q1, q2, q3],
        steps: [s1],
        branches: [b1, b2, b3],
        onCreateBranch: create,
      });
      expect(createButton().disabled).toBe(false);
    });

    const many = (count: number, archived = 0) =>
      Array.from({ length: count }, (_, at) =>
        adminBranch({
          openerQuestionId: opener.id,
          values: [A],
          archivedAt: at < archived ? '2026-10-01T12:00:00.000Z' : null,
        }),
      );

    it('disables the button at 15 active branches and shows the limit line', () => {
      edit({ branches: many(15) });
      expect(createButton().disabled).toBe(true);
      expect(
        screen.getByText(
          'Você chegou ao limite de 15 ramos. Desfaça ou arquive um ramo para criar outro.',
        ),
      ).toBeTruthy();
    });

    it('does not count archived branches, and still offers the button at 14 active ones', () => {
      edit({ branches: many(16, 2) });
      expect(createButton().disabled).toBe(false);
      expect(screen.queryByText(/^Você chegou ao limite de 15 ramos/)).toBeNull();
    });
  });
});
