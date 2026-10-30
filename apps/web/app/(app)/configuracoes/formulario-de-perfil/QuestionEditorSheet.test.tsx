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
  refresh: vi.fn(),
  show: vi.fn(),
}));

MotionGlobalConfig.skipAnimations = true;
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('./actions', () => ({
  createQuestionAction: (body: unknown, options: unknown) => mocks.create(body, options),
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
