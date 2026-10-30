// @vitest-environment happy-dom

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemberForm } from '@rede-social/contracts/profile-form';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { form, options, question } from '@/lib/profile-form/test-fixtures';
import { ProfileForm, type ProfileFormProps } from './ProfileForm';

/**
 * 12-12 (D-582, D-583, UI-D-580, UI-D-582..UI-D-588, UI-D-596; PFORM-13, PFORM-14, PFORM-26; T-12-29, T-12-30) —
 * the completion form and every state the UI-SPEC defines, against the REAL pt-BR catalog. Stubbed: the save
 * action (the API boundary: plan 18's Playwright run proves the real path), the router and `flashToast`.
 */

const mocks = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn(), flash: vi.fn() }));

vi.mock('@/app/(auth)/completar-perfil/actions', () => ({
  saveProfileFormAction: (...args: unknown[]) => mocks.save(...args),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@rede-social/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@rede-social/ui')>()),
  flashToast: (...args: unknown[]) => mocks.flash(...args),
}));

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

function show(read: MemberForm, props: Partial<ProfileFormProps> = {}) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <ProfileForm form={read} {...props} />
    </NextIntlClientProvider>,
  );
}

const formEl = (container: HTMLElement) => container.querySelector('form') as HTMLFormElement;
const save = async (container: HTMLElement) => {
  await act(async () => {
    fireEvent.submit(formEl(container));
  });
};
const setOnline = (online: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
};

beforeEach(() => {
  mocks.save.mockReset();
  mocks.push.mockReset();
  mocks.flash.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  setOnline(true);
});
afterEach(() => cleanup());

describe('returning mode: a notice and only the missing required ones flagged (UI-D-582)', () => {
  it('opens with the plural count and an in-page link, and flags only the missing question', () => {
    const answered = question('short_text', { title: 'Telefone', required: true, answer: 'ok' });
    const missing = question('short_text', { title: 'Telefone da empresa', required: true });
    const optional = question('short_text', { title: 'Telefone da empresa (opcional)' });
    show(form([answered, missing, optional], { mode: 'returning', missingRequired: 1 }));
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('Falta 1 pergunta obrigatória.');
    expect(notice.textContent).toContain('O que você já respondeu continua guardado.');
    const jump = within(notice).getByRole('link', { name: 'Ir para a primeira' });
    expect(jump.getAttribute('href')).toBe(`#pf-q-${missing.id}`);
    // Similar titles: only the missing required one carries the danger tint and the words.
    expect(document.querySelectorAll('[data-flagged]')).toHaveLength(1);
    expect(
      document.querySelector(`#pf-q-${missing.id}`)?.getAttribute('data-flagged'),
    ).not.toBeNull();
    expect(document.querySelector(`#pf-q-${answered.id}`)?.getAttribute('data-flagged')).toBeNull();
    expect(screen.getAllByText('Obrigatória')).toHaveLength(2);
    expect(screen.getAllByText('Opcional')).toHaveLength(1);
    expect(screen.getAllByText('Falta responder')).toHaveLength(1);
  });

  it('pluralises the notice and pre-fills the stored answers in the admin order', () => {
    const a = question('short_text', { title: 'A', required: true });
    const b = question('short_text', { title: 'B', required: true });
    const c = question('short_text', { title: 'C', answer: 'guardado' });
    show(form([a, b, c], { mode: 'returning', missingRequired: 2 }));
    expect(screen.getByRole('status').textContent).toContain('Faltam 2 perguntas obrigatórias.');
    expect((screen.getByLabelText('C') as HTMLInputElement).value).toBe('guardado');
    expect([...document.querySelectorAll('label')].map((l) => l.textContent)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('clears the flag once the member answers the question', () => {
    const missing = question('short_text', { title: 'Cargo', required: true });
    show(form([missing], { mode: 'returning', missingRequired: 1 }));
    expect(screen.getByText('Falta responder')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: 'Designer' } });
    expect(screen.queryByText('Falta responder')).toBeNull();
  });
});

describe('first and edit modes flag nothing up front', () => {
  it('first: a blank form has no notice and no flags until Salvar fails', async () => {
    const a = question('short_text', { title: 'Cargo', required: true });
    const b = question('short_text', { title: 'Cidade', required: true });
    const { container } = show(form([a, b]));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Falta responder')).toBeNull();
    await save(container);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getAllByText('Falta responder')).toHaveLength(2);
  });

  it('edit: an optional-only form is pre-filled, flags nothing and has the same single Salvar', () => {
    const a = question('short_text', { title: 'Bio', answer: 'Oi' });
    show(form([a], { mode: 'edit', missingRequired: 0 }));
    expect(screen.queryByText('Falta responder')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Salvar' })).toHaveLength(1);
  });
});

describe('the error summary and the field errors (UI-D-586)', () => {
  it('summarises the count (plural), focuses the summary and lists the errors under the fields', async () => {
    const a = question('short_text', { title: 'Cargo', required: true });
    const b = question('acceptance', { title: 'Aceito o regulamento', required: true });
    const { container } = show(form([a, b]));
    await save(container);
    const summary = screen.getByText('Revise 2 campos antes de salvar.').closest('[role="alert"]');
    expect(summary).not.toBeNull();
    expect(document.activeElement).toBe(summary);
    expect((summary as HTMLElement).tabIndex).toBe(-1);
    expect(screen.getByText('Responda esta pergunta.')).toBeTruthy();
    expect(screen.getByText('Marque a caixa para continuar.')).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('the link moves focus to the first invalid control; an edit clears that field error', async () => {
    const a = question('short_text', { title: 'Cargo', required: true });
    const b = question('short_text', { title: 'Cidade', required: true });
    const { container } = show(form([a, b]));
    await save(container);
    fireEvent.click(screen.getByRole('link', { name: 'Ir para o primeiro' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Cargo'));
    expect(screen.getByText('Revise 2 campos antes de salvar.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: 'Designer' } });
    expect(screen.getByText('Revise 1 campo antes de salvar.')).toBeTruthy();
    expect(screen.getAllByText('Responda esta pergunta.')).toHaveLength(1);
    expect(screen.getByLabelText('Cargo').getAttribute('aria-invalid')).toBeNull();
  });

  it("shows the server's keyed errors (400 answers_invalid) under the same fields", async () => {
    const a = question('short_text', { title: 'Cargo' });
    const b = question('short_text', { title: 'Cidade' });
    mocks.save.mockResolvedValue({ ok: false, code: 'invalid', errors: { [b.id]: 'too_long' } });
    const { container } = show(form([a, b]));
    fireEvent.change(screen.getByLabelText('Cidade'), { target: { value: 'x' } });
    await save(container);
    expect(screen.getByText('Use até 120 caracteres.')).toBeTruthy();
    expect(screen.getByLabelText('Cidade').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Revise 1 campo antes de salvar.')).toBeTruthy();
  });
});

describe('saving (UI-D-587)', () => {
  it('locks every control with Salvando… and aria-busy while it runs, then navigates to the destination', async () => {
    const a = question('short_text', { title: 'Cargo', required: true });
    const b = question('single_choice', { title: 'Origem', options: options('A', 'B') });
    let resolve: (value: unknown) => void = () => {};
    mocks.save.mockImplementation(() => new Promise((r) => (resolve = r)));
    const { container } = show(form([a, b]), { next: '/post/abc' });
    fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: 'Designer' } });
    await save(container);
    expect(formEl(container).getAttribute('aria-busy')).toBe('true');
    const button = screen.getByRole('button', { name: /Salvando…/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect((screen.getByLabelText('Cargo') as HTMLInputElement).disabled).toBe(true);
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLInputElement).disabled).toBe(true);
    }
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0]?.[0]).toEqual({
      formEtag: 'etag-1',
      answers: { [a.id]: 'Designer', [b.id]: null },
      next: '/post/abc',
      mode: 'first',
    });
    await act(async () => resolve({ ok: true, destination: '/post/abc' }));
    expect(mocks.flash).toHaveBeenCalledWith(
      { tone: 'success', message: 'Respostas salvas.' },
      '/post/abc',
    );
    expect(mocks.push).toHaveBeenCalledWith('/post/abc');
  });

  it('the client goes only where the action says, never to its own next prop', async () => {
    const a = question('short_text', { title: 'Cargo' });
    mocks.save.mockResolvedValue({ ok: true, destination: '/inicio' });
    const { container } = show(form([a]), { next: '//evil.com' });
    await save(container);
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/inicio');
  });

  it('sends a blank optional answer as null so it can be cleared, and keeps the edit mode', async () => {
    const a = question('short_text', { title: 'Bio', answer: 'Oi' });
    mocks.save.mockResolvedValue({ ok: true, destination: '/perfil' });
    const { container } = show(form([a], { mode: 'edit', missingRequired: 0 }));
    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: '' } });
    await save(container);
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
      answers: { [a.id]: null },
      mode: 'edit',
    });
  });

  it('offline disables Salvar and shows the notice; online brings it back', async () => {
    const a = question('short_text', { title: 'Cargo' });
    const { container } = show(form([a]));
    setOnline(false);
    expect(screen.getByText(/Você está sem conexão/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await save(container);
    expect(mocks.save).not.toHaveBeenCalled();
    setOnline(true);
    expect(screen.queryByText(/Você está sem conexão/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('a save failure shows the alert and keeps every answer', async () => {
    const a = question('short_text', { title: 'Cargo' });
    const b = question('multiple_choice', { title: 'Interesses', options: options('A', 'B') });
    mocks.save.mockResolvedValue({ ok: false, code: 'failed' });
    const { container } = show(form([a, b]));
    fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: 'Designer' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'B' }));
    await save(container);
    expect(
      screen
        .getByText('Não foi possível salvar agora. Suas respostas continuam aqui. Tente de novo.')
        .getAttribute('role'),
    ).toBe('alert');
    expect((screen.getByLabelText('Cargo') as HTMLInputElement).value).toBe('Designer');
    expect((screen.getByRole('checkbox', { name: 'B' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe('the form changed while the member typed: 409 form_changed (UI-D-587)', () => {
  it('refreshes the list in place, keeps typed values and order, flags a newly required question', async () => {
    const a = question('short_text', { title: 'Cargo' });
    const b = question('short_text', { title: 'Cidade' });
    const removed = question('short_text', { title: 'Removida' });
    const added = question('short_text', { title: 'Nova obrigatória', required: true });
    mocks.save.mockResolvedValue({
      ok: false,
      code: 'changed',
      form: form([b, added, a], { formEtag: 'etag-2', missingRequired: 1 }),
    });
    const { container } = show(form([a, removed, b]));
    fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: 'Designer' } });
    fireEvent.change(screen.getByLabelText('Removida'), { target: { value: 'sumiu' } });
    fireEvent.change(screen.getByLabelText('Cidade'), { target: { value: 'Recife' } });
    await save(container);
    expect(
      screen.getByText(
        'O formulário mudou enquanto você respondia. Atualizamos a lista; confira e salve de novo.',
      ),
    ).toBeTruthy();
    expect([...document.querySelectorAll('label')].map((l) => l.textContent)).toEqual([
      'Cidade',
      'Nova obrigatória',
      'Cargo',
    ]);
    expect((screen.getByLabelText('Cargo') as HTMLInputElement).value).toBe('Designer');
    expect((screen.getByLabelText('Cidade') as HTMLInputElement).value).toBe('Recife');
    expect(screen.queryByLabelText('Removida')).toBeNull();
    expect(
      document.querySelector(`#pf-q-${added.id}`)?.getAttribute('data-flagged'),
    ).not.toBeNull();
    expect(screen.getAllByText('Falta responder')).toHaveLength(1);
    // The next save carries the fresh etag.
    mocks.save.mockResolvedValue({ ok: true, destination: '/inicio' });
    fireEvent.change(screen.getByLabelText('Nova obrigatória'), { target: { value: 'ok' } });
    await save(container);
    expect(mocks.save.mock.calls.at(-1)?.[0]).toMatchObject({ formEtag: 'etag-2' });
  });
});

describe('how many questions render', () => {
  it('one question renders the same single card with its one Salvar', () => {
    show(form([question('short_text', { title: 'Única' })]));
    expect(screen.getByLabelText('Única')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Salvar' })).toHaveLength(1);
  });

  it('thirty questions render in one card, in order, with one Salvar at the end', () => {
    const questions = Array.from({ length: 30 }, (_, i) =>
      question('short_text', { title: `Pergunta número ${i + 1}` }),
    );
    const { container } = show(form(questions));
    expect(container.querySelectorAll('[data-question]')).toHaveLength(30);
    expect(container.querySelectorAll('form > div')).toHaveLength(1);
    const buttons = screen.getAllByRole('button', { name: 'Salvar' });
    expect(buttons).toHaveLength(1);
    const last = container.querySelectorAll('[data-question]')[29] as HTMLElement;
    expect(
      last.compareDocumentPosition(buttons[0] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('no active question shows the empty state, never a blank card or a lone Salvar', () => {
    show(form([], { mode: 'edit', missingRequired: 0 }));
    expect(screen.getByText('Não há perguntas para responder')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Ir para o início' }).getAttribute('href')).toBe(
      '/inicio',
    );
  });
});

describe('answers never leave component state (T-12-30)', () => {
  it('keeps the typed text out of both browser stores and the URL, even after a failed and a good save', async () => {
    const secret = 'segredo-do-membro-123';
    const a = question('short_text', { title: 'Cargo' });
    const { container } = show(form([a]));
    const href = window.location.href;
    fireEvent.change(screen.getByLabelText('Cargo'), { target: { value: secret } });
    mocks.save.mockResolvedValueOnce({ ok: false, code: 'failed' });
    await save(container);
    mocks.save.mockResolvedValueOnce({ ok: true, destination: '/inicio' });
    await save(container);
    const stored = JSON.stringify([
      ...Object.entries(window.localStorage),
      ...Object.entries(window.sessionStorage),
    ]);
    expect(stored).not.toContain(secret);
    expect(window.location.href).toBe(href);
    expect(JSON.stringify(mocks.flash.mock.calls)).not.toContain(secret);
  });
});

describe('the preview sends nothing (UI-D-580)', () => {
  const everyKind = () => {
    const opts = options('A', 'B');
    return [
      question('short_text', { title: 'Texto curto', answer: 'guardado' }),
      question('long_text', { title: 'Texto longo' }),
      question('dropdown', { title: 'Lista', options: opts, allowOther: true }),
      question('multiple_choice', { title: 'Várias', options: opts }),
      question('single_choice', { title: 'Uma', options: opts }),
      question('number', { title: 'Número' }),
      question('date', { title: 'Data' }),
      question('phone', { title: 'Telefone' }),
      question('email', { title: 'E-mail' }),
      question('link', { title: 'Link' }),
      question('yes_no', { title: 'Sim ou não' }),
      question('acceptance', { title: 'Aceite', required: true }),
      question('rating', { title: 'Nota', required: true }),
    ];
  };

  it('every control is live, the action is never called, and Fechar closes', async () => {
    const onClose = vi.fn();
    const { container } = show(form(everyKind(), { mode: 'returning', missingRequired: 2 }), {
      preview: true,
      onClose,
    });
    fireEvent.change(screen.getByLabelText('Texto curto'), { target: { value: 'novo' } });
    fireEvent.change(screen.getByLabelText('Texto longo'), { target: { value: 'longo' } });
    fireEvent.change(screen.getByLabelText('Lista'), { target: { value: '__other__' } });
    fireEvent.change(screen.getByLabelText('Qual?'), { target: { value: 'outra' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    fireEvent.change(screen.getByLabelText('Número'), { target: { value: '12,5' } });
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-05-01' } });
    fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '11912345678' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'https://x.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sim' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Aceite' }));
    fireEvent.click(screen.getByRole('radio', { name: '4 estrelas' }));
    expect((screen.getByLabelText('Texto curto') as HTMLInputElement).value).toBe('novo');
    await act(async () => {
      fireEvent.submit(formEl(container));
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.flash).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the banner, no Salvar, no heading, nothing pre-filled and nothing flagged', () => {
    show(form(everyKind(), { mode: 'returning', missingRequired: 2 }), { preview: true });
    expect(screen.getByText('Prévia: nada do que você preencher aqui é salvo.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Falta responder')).toBeNull();
    expect((screen.getByLabelText('Texto curto') as HTMLInputElement).value).toBe('');
  });

  it('the required rule and the errors still read as the member sees them, and Fechar is the only button action', () => {
    show(form(everyKind()), { preview: true });
    expect(screen.getAllByText('Obrigatória')).toHaveLength(2);
    expect(screen.getAllByText('Opcional').length).toBeGreaterThan(5);
    expect(screen.getByRole('button', { name: 'Fechar' }).getAttribute('type')).toBe('button');
  });
});

describe('the accessibility floor (UI-D-596, PFORM-26)', () => {
  it('the page heading takes focus on mount', () => {
    show(form([question('short_text')]), { title: 'Complete seu perfil', intro: 'Introdução' });
    const heading = screen.getByRole('heading', { level: 1, name: 'Complete seu perfil' });
    expect(heading.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(heading);
  });

  it('every control has an accessible name from a label or a legend', () => {
    const opts = options('A', 'B');
    const questions = [
      question('short_text', { title: 'Q texto' }),
      question('long_text', { title: 'Q longo' }),
      question('dropdown', { title: 'Q lista', options: opts }),
      question('multiple_choice', { title: 'Q várias', options: opts }),
      question('single_choice', { title: 'Q uma', options: opts }),
      question('number', { title: 'Q número' }),
      question('date', { title: 'Q data' }),
      question('phone', { title: 'Q telefone' }),
      question('email', { title: 'Q email' }),
      question('link', { title: 'Q link' }),
      question('yes_no', { title: 'Q simnao' }),
      question('acceptance', { title: 'Q aceite' }),
      question('rating', { title: 'Q nota' }),
    ];
    const { container } = show(form(questions));
    for (const title of [
      'Q texto',
      'Q longo',
      'Q número',
      'Q data',
      'Q telefone',
      'Q email',
      'Q link',
    ]) {
      expect(screen.getByLabelText(title)).toBeTruthy();
    }
    expect(screen.getByRole('combobox', { name: /Q lista/ })).toBeTruthy();
    expect(screen.getByRole('group', { name: /Q várias/ })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: /Q uma/ })).toBeTruthy();
    expect(screen.getAllByRole('group', { name: /Q simnao/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('checkbox', { name: 'Q aceite' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: /Q nota/ })).toBeTruthy();
    // No control is left without a name: every input, select and textarea resolves one.
    for (const control of container.querySelectorAll('input, select, textarea')) {
      const named =
        control.getAttribute('aria-label') ||
        control.getAttribute('aria-labelledby') ||
        (control.id && container.querySelector(`label[for="${control.id}"]`)) ||
        control.closest('label') ||
        control.closest('fieldset');
      expect(named, control.outerHTML).toBeTruthy();
    }
  });

  it('aria-invalid and aria-describedby point at the error line, on a single field and on a group', async () => {
    const a = question('short_text', { title: 'Cargo', required: true });
    const b = question('single_choice', {
      title: 'Origem',
      required: true,
      options: options('A', 'B'),
    });
    const { container } = show(form([a, b]));
    await save(container);
    const input = screen.getByLabelText('Cargo');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const inputError = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(inputError?.textContent).toBe('Responda esta pergunta.');
    const group = screen.getByRole('radiogroup', { name: /Origem/ });
    expect(group.getAttribute('aria-invalid')).toBe('true');
    const groupError = document.getElementById(group.getAttribute('aria-describedby') ?? '');
    expect(groupError?.textContent).toBe('Escolha uma opção.');
  });

  it('renders everything a person typed or an admin wrote as React text, never as HTML (UI-D-598)', () => {
    const hostile = '<img src=x onerror=alert(1)><b>negrito</b>';
    const q = question('short_text', { title: hostile, helpText: hostile, answer: hostile });
    const { container } = show(form([q], { mode: 'edit', missingRequired: 0 }), {
      title: hostile,
      intro: hostile,
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain(hostile);
    expect((container.querySelector('input') as HTMLInputElement).value).toBe(hostile);
  });

  it('no profile-form component injects raw HTML or touches the browser storage', () => {
    const dir = join(__dirname);
    const sources = readdirSync(dir).filter(
      (file) => file.endsWith('.tsx') && !file.includes('.test.'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(3);
    for (const file of sources) {
      const text = readFileSync(join(dir, file), 'utf8');
      expect(text, file).not.toContain(['dangerously', 'SetInnerHTML'].join(''));
      expect(text, file).not.toMatch(/local(Storage)|session(Storage)/);
    }
  });
});
