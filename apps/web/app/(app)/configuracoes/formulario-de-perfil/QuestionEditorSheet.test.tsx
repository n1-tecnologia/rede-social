// @vitest-environment happy-dom

import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { adminQuestion } from '@/lib/profile-form/test-fixtures';
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
  impact: vi.fn(),
  refresh: vi.fn(),
  show: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('./actions', () => ({
  createQuestionAction: (body: unknown, options: unknown) => mocks.create(body, options),
  readImpactAction: (input: unknown) => mocks.impact(input),
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

function mount(
  props: { mode?: EditorMode; question?: ReturnType<typeof adminQuestion> | null } = {},
) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <QuestionEditorSheet
        open
        mode={props.mode ?? 'create'}
        tenantName="Ana Mentoria"
        limit={30}
        onClose={onClose}
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
