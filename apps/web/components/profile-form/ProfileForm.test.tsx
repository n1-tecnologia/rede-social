// @vitest-environment happy-dom

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemberForm } from '@rede-social/contracts/profile-form';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { form, options, question, uuid } from '@/lib/profile-form/test-fixtures';
import { ProfileForm, type ProfileFormProps } from './ProfileForm';

/**
 * 12-12 (D-582, D-583, UI-D-580, UI-D-582..UI-D-588, UI-D-596; PFORM-13, PFORM-14, PFORM-26; T-12-29, T-12-30) —
 * the completion form and every state the UI-SPEC defines, against the REAL pt-BR catalog. Stubbed: the save
 * action (the API boundary: plan 18's Playwright run proves the real path), the router and `flashToast`.
 */

const mocks = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn(), flash: vi.fn(), reduced: true }));

vi.mock('@/app/(auth)/completar-perfil/actions', () => ({
  saveProfileFormAction: (...args: unknown[]) => mocks.save(...args),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn(), replace: vi.fn() }),
}));
// `prefers-reduced-motion` is a switch of the test: reduced (instant) unless a case turns the animation on.
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => mocks.reduced,
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
  mocks.reduced = true;
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

const S1 = uuid(701);
const S2 = uuid(702);
const S3 = uuid(703);
const steps = (...titles: string[]) =>
  [S1, S2, S3].slice(0, titles.length).map((id, index) => ({ id, title: titles[index] as string }));

describe('the stepper: Avançar saves the step, Concluir finishes (D-629, UI-D-653, UI-D-654)', () => {
  const twoSteps = () => {
    const name = question('short_text', { title: 'Nome', required: true, stepId: S1 });
    const city = question('short_text', { title: 'Cidade', stepId: S1 });
    const phone = question('short_text', { title: 'Telefone', required: true, stepId: S2 });
    return {
      name,
      city,
      phone,
      read: form([name, city, phone], { steps: steps('Sobre você', 'Contato') }),
    };
  };

  it('shows the first step only, with progress, the step heading and Avançar (no Voltar)', () => {
    const { read } = twoSteps();
    show(read, { title: 'Complete seu perfil' });
    expect(screen.getByText('Etapa 1 de 2')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Sobre você' })).toBeTruthy();
    expect(screen.getByLabelText('Nome')).toBeTruthy();
    expect(screen.queryByLabelText('Telefone')).toBeNull();
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(
      screen.getByText('Suas respostas de cada etapa ficam salvas quando você avança.'),
    ).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Sobre você' })).toBeTruthy();
  });

  it('Avançar validates only the visible questions of this step and saves nothing when one is wrong', async () => {
    const { read } = twoSteps();
    const { container } = show(read);
    await save(container);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByText('Revise 1 campo antes de salvar.')).toBeTruthy();
    expect(screen.getAllByText('Falta responder')).toHaveLength(1);
    // The step after is still not shown and the member stays here.
    expect(screen.getByText('Etapa 1 de 2')).toBeTruthy();
  });

  it('Avançar sends the stepId and only the answers of this step, then the next step takes focus on its h2', async () => {
    const { name, city, read } = twoSteps();
    mocks.save.mockResolvedValue({ ok: true, destination: null, missingQuestionIds: [] });
    const { container } = show(read, { next: '/post/abc' });
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ana' } });
    await save(container);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0]?.[0]).toEqual({
      formEtag: 'etag-1',
      stepId: S1,
      answers: { [name.id]: 'Ana', [city.id]: null },
      next: '/post/abc',
      mode: 'first',
    });
    // No toast, no navigation: the member moves to the next step.
    expect(mocks.flash).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    const heading = screen.getByRole('heading', { level: 2, name: 'Contato' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText('Etapa 2 de 2')).toBeTruthy();
    expect(screen.getByLabelText('Telefone')).toBeTruthy();
    expect(screen.queryByLabelText('Nome')).toBeNull();
  });

  it('the last step reads Concluir, shows Voltar, hides the saved hint and runs the success path', async () => {
    const { phone, read } = twoSteps();
    mocks.save.mockResolvedValueOnce({ ok: true, destination: null, missingQuestionIds: [] });
    const { container } = show(read);
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ana' } });
    await save(container);
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Avançar' })).toBeNull();
    expect(screen.queryByText(/ficam salvas quando você avança/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '1199999' } });
    mocks.save.mockResolvedValueOnce({ ok: true, destination: '/inicio' });
    await save(container);
    expect(mocks.save.mock.calls[1]?.[0]).toMatchObject({
      stepId: S2,
      answers: { [phone.id]: '1199999' },
    });
    expect(mocks.flash).toHaveBeenCalledWith(
      { tone: 'success', message: 'Respostas salvas.' },
      '/inicio',
    );
    expect(mocks.push).toHaveBeenCalledWith('/inicio');
  });

  it('a middle step is saved and advanced even when the gate already reports a destination', async () => {
    const a = question('short_text', { title: 'A', stepId: S1 });
    const b = question('short_text', { title: 'B', stepId: S2 });
    const c = question('short_text', { title: 'C', stepId: S3 });
    mocks.save.mockResolvedValue({ ok: true, destination: '/inicio' });
    const { container } = show(form([a, b, c], { steps: steps('Um', 'Dois', 'Três') }));
    await save(container);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByText('Etapa 2 de 3')).toBeTruthy();
  });

  it('Voltar never validates or saves, and brings back the unsaved draft', async () => {
    const { read } = twoSteps();
    mocks.save.mockResolvedValue({ ok: true, destination: null, missingQuestionIds: [] });
    const { container } = show(read);
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ana' } });
    await save(container);
    fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: 'rascunho' } });
    mocks.save.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 2, name: 'Sobre você' })).toBeTruthy();
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Ana');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 }));
    // The draft typed on the step the member left is still in state, and in no store.
    await save(container);
    expect((screen.getByLabelText('Telefone') as HTMLInputElement).value).toBe('rascunho');
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it('a form with one step renders exactly as Phase 12: one card, one Salvar, no progress, no step title', async () => {
    const a = question('short_text', { title: 'Única', required: true });
    mocks.save.mockResolvedValue({ ok: true, destination: '/inicio' });
    const { container } = show(form([a]));
    expect(screen.queryByText(/Etapa \d de/)).toBeNull();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull();
    expect(screen.queryByText(/ficam salvas quando você avança/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Salvar' })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Única'), { target: { value: 'x' } });
    await save(container);
    expect(mocks.save.mock.calls[0]?.[0]).not.toHaveProperty('stepId');
    expect(mocks.push).toHaveBeenCalledWith('/inicio');
  });

  it('several configured steps with a path of one: the heading shows, progress does not, the button is Salvar', async () => {
    const a = question('short_text', { title: 'A', stepId: S1 });
    const opener = question('yes_no', { title: 'Abre?', stepId: S1 });
    const hidden = question('short_text', {
      title: 'Escondida',
      stepId: S2,
      condition: { questionId: opener.id, values: ['true'] },
    });
    mocks.save.mockResolvedValue({ ok: true, destination: '/inicio' });
    const { container } = show(form([a, opener, hidden], { steps: steps('Um', 'Dois') }));
    expect(screen.getByRole('heading', { level: 2, name: 'Um' })).toBeTruthy();
    expect(screen.queryByText(/Etapa \d de/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeTruthy();
    await save(container);
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({ stepId: S1 });
    expect(mocks.push).toHaveBeenCalledWith('/inicio');
  });

  it('edit mode keeps the one-card layout until plan 15: every question, one Salvar, no stepper', () => {
    const a = question('short_text', { title: 'A', stepId: S1, answer: 'x' });
    const b = question('short_text', { title: 'B', stepId: S2, answer: 'y' });
    show(form([a, b], { mode: 'edit', missingRequired: 0, steps: steps('Um', 'Dois') }));
    expect(screen.getByLabelText('A')).toBeTruthy();
    expect(screen.getByLabelText('B')).toBeTruthy();
    expect(screen.queryByText(/Etapa \d de/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Salvar' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Avançar' })).toBeNull();
  });
});

const liveRegion = () => document.querySelector('[aria-live="polite"]') as HTMLElement;

describe('a question that opens appears in place, announced, unflagged and calm (D-621, UI-D-655)', () => {
  const clinic = () => {
    const opts = options('Tenho uma clínica', 'Estou aprendendo');
    const opener = question('single_choice', {
      title: 'Qual é o seu caso?',
      required: true,
      options: opts,
    });
    const name = question('short_text', {
      title: 'Nome da clínica',
      required: true,
      condition: { questionId: opener.id, values: [opts[0]?.id as string] },
    });
    const size = question('short_text', {
      title: 'Quantas pessoas?',
      condition: { questionId: opener.id, values: [opts[0]?.id as string] },
    });
    return { opener, name, size, read: form([opener, name, size]) };
  };

  it('hides the follow-ups until the opener is answered, then shows them below it, and focus stays on the opener', () => {
    const { read } = clinic();
    show(read);
    expect(screen.queryByLabelText('Nome da clínica')).toBeNull();
    const radio = screen.getByRole('radio', { name: 'Tenho uma clínica' });
    radio.focus();
    fireEvent.click(radio);
    expect(screen.getByLabelText('Nome da clínica')).toBeTruthy();
    expect(screen.getByLabelText('Quantas pessoas?')).toBeTruthy();
    expect(document.activeElement).toBe(radio);
    // At its own position: after the opener, in the admin's order.
    expect(
      [...document.querySelectorAll('[data-question]')].map((el) => el.textContent),
    ).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Estou aprendendo' })).toBeTruthy();
  });

  it('announces the title of one question, the count of many, and what left, through one polite region', () => {
    const { read } = clinic();
    show(read);
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(liveRegion().className).toContain('sr-only');
    expect(liveRegion().textContent).toBe('');
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect(liveRegion().textContent).toBe('Apareceram 2 novas perguntas.');
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    expect(liveRegion().textContent).toBe('2 perguntas saíram da lista.');
  });

  it('names the title when exactly one question appears, and says one left in the singular', () => {
    const opts = options('Sim, uso', 'Não uso');
    const opener = question('single_choice', { title: 'Usa sistema?', options: opts });
    const follow = question('short_text', {
      title: 'Qual sistema?',
      condition: { questionId: opener.id, values: [opts[0]?.id as string] },
    });
    show(form([opener, follow]));
    fireEvent.click(screen.getByRole('radio', { name: 'Sim, uso' }));
    expect(liveRegion().textContent).toBe('Apareceu uma nova pergunta: Qual sistema?.');
    fireEvent.click(screen.getByRole('radio', { name: 'Não uso' }));
    expect(liveRegion().textContent).toBe('Uma pergunta saiu da lista.');
  });

  it('an announcement carries titles and counts, never an answer value (T-12.1-11)', () => {
    const { read, name } = clinic();
    show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    const secret = 'segredo-do-membro-123';
    fireEvent.change(screen.getByLabelText('Nome da clínica'), { target: { value: secret } });
    expect(liveRegion().textContent).not.toContain(secret);
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    expect(liveRegion().textContent).not.toContain(secret);
    expect(JSON.stringify(mocks.flash.mock.calls)).not.toContain(secret);
    expect(read.questions.some((q) => q.id === name.id)).toBe(true);
  });

  it('enters unflagged and wears the neutral rule; a failed Avançar flags it and drops the rule', async () => {
    const { read, name } = clinic();
    const { container } = show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect(screen.queryByText('Falta responder')).toBeNull();
    const wrapper = () =>
      document.querySelector(`#pf-q-${name.id}`)?.closest('[data-revealed]') as HTMLElement;
    expect(wrapper().className).toContain('border-l-2 border-border pl-3');
    await save(container);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(document.querySelector(`#pf-q-${name.id}`)?.getAttribute('data-flagged')).not.toBeNull();
    expect(wrapper().className).not.toContain('border-l-2');
  });

  it('a draft typed into a question that later closes is kept, not sent, and comes back when it reopens', async () => {
    const { read, opener, name } = clinic();
    mocks.save.mockResolvedValue({ ok: true, destination: '/inicio' });
    const { container } = show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    fireEvent.change(screen.getByLabelText('Nome da clínica'), {
      target: { value: 'Clínica Sol' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    expect(screen.queryByLabelText('Nome da clínica')).toBeNull();
    await save(container);
    const sent = mocks.save.mock.calls[0]?.[0] as { answers: Record<string, unknown> };
    expect(Object.keys(sent.answers)).toEqual([opener.id]);
    expect(sent.answers).not.toHaveProperty(name.id);
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect((screen.getByLabelText('Nome da clínica') as HTMLInputElement).value).toBe(
      'Clínica Sol',
    );
  });

  it('with the animation on, the question mounts at once and leaves after its exit', async () => {
    mocks.reduced = false;
    const { read } = clinic();
    show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect(screen.getByLabelText('Nome da clínica')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    await waitFor(() => expect(screen.queryByLabelText('Nome da clínica')).toBeNull(), {
      timeout: 3000,
    });
  });
});

describe('the path follows the answers: a step with no visible question drops out (D-628, E4 empty)', () => {
  it('revealing and hiding the only question of step 2 changes the path and the Etapa x de y count', async () => {
    const opts = options('Tenho', 'Não tenho');
    const opener = question('single_choice', { title: 'Tem clínica?', options: opts, stepId: S1 });
    const only = question('short_text', {
      title: 'Nome da clínica',
      stepId: S2,
      condition: { questionId: opener.id, values: [opts[0]?.id as string] },
    });
    const last = question('short_text', { title: 'Contato', stepId: S3 });
    mocks.save.mockResolvedValue({ ok: true, destination: null, missingQuestionIds: [] });
    const { container } = show(form([opener, only, last], { steps: steps('Um', 'Dois', 'Três') }));
    expect(screen.getByText('Etapa 1 de 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho' }));
    expect(screen.getByText('Etapa 1 de 3')).toBeTruthy();
    // Announced only for what is on screen: the question that opened sits on a later step.
    expect(liveRegion().textContent).toBe('');
    fireEvent.click(screen.getByRole('radio', { name: 'Não tenho' }));
    expect(screen.getByText('Etapa 1 de 2')).toBeTruthy();
    // Avançar skips the empty step and goes straight to Três.
    await save(container);
    expect(screen.getByRole('heading', { level: 2, name: 'Três' })).toBeTruthy();
    expect(screen.getByText('Etapa 2 de 2')).toBeTruthy();
  });
});

describe('the states of a step save (UI-D-654, E4 loading, error)', () => {
  const twoSteps = () => {
    const a = question('short_text', { title: 'Nome', stepId: S1 });
    const b = question('short_text', { title: 'Telefone', stepId: S2 });
    return { a, b, read: form([a, b], { steps: steps('Sobre você', 'Contato') }) };
  };

  it('pending: Salvando… on the brand button, every control and Voltar disabled, aria-busy on the form', async () => {
    const { read } = twoSteps();
    mocks.save.mockResolvedValueOnce({ ok: true, destination: null, missingQuestionIds: [] });
    const { container } = show(read);
    await save(container);
    let resolve: (value: unknown) => void = () => {};
    mocks.save.mockImplementation(() => new Promise((r) => (resolve = r)));
    await save(container);
    expect(formEl(container).getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button', { name: /Salvando…/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Voltar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText('Telefone') as HTMLInputElement).disabled).toBe(true);
    await act(async () => resolve({ ok: true, destination: '/inicio' }));
  });

  it('offline disables Avançar and Concluir with the shipped notice while Voltar stays enabled', async () => {
    const { read } = twoSteps();
    mocks.save.mockResolvedValue({ ok: true, destination: null, missingQuestionIds: [] });
    const { container } = show(read);
    setOnline(false);
    expect((screen.getByRole('button', { name: 'Avançar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/Você está sem conexão/)).toBeTruthy();
    setOnline(true);
    await save(container);
    setOnline(false);
    expect((screen.getByRole('button', { name: 'Concluir' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Voltar' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    mocks.save.mockClear();
    await save(container);
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Sobre você' })).toBeTruthy();
  });

  it('a save failure shows the shipped alert and keeps the member on the step with the answers', async () => {
    const { read } = twoSteps();
    mocks.save.mockResolvedValue({ ok: false, code: 'failed' });
    const { container } = show(read);
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ana' } });
    await save(container);
    expect(
      screen
        .getByText('Não foi possível salvar agora. Suas respostas continuam aqui. Tente de novo.')
        .getAttribute('role'),
    ).toBe('alert');
    expect(screen.getByText('Etapa 1 de 2')).toBeTruthy();
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Ana');
    expect((screen.getByRole('button', { name: 'Avançar' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('a 409 form_changed refreshes the steps in place, keeps typed answers and stays on the step', async () => {
    const { a, b, read } = twoSteps();
    const extra = question('short_text', { title: 'Nova', stepId: S3 });
    mocks.save.mockResolvedValue({
      ok: false,
      code: 'changed',
      form: form([a, b, extra], {
        formEtag: 'etag-2',
        steps: steps('Sobre você', 'Contato', 'Extra'),
      }),
    });
    const { container } = show(read);
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ana' } });
    await save(container);
    expect(screen.getByText(/O formulário mudou enquanto você respondia/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Sobre você' })).toBeTruthy();
    expect(screen.getByText('Etapa 1 de 3')).toBeTruthy();
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Ana');
    mocks.save.mockResolvedValue({ ok: true, destination: null, missingQuestionIds: [] });
    await save(container);
    expect(mocks.save.mock.calls.at(-1)?.[0]).toMatchObject({ formEtag: 'etag-2', stepId: S1 });
  });

  it('a 409 that leaves the current step with nothing visible moves to the next step of the path', async () => {
    const a = question('short_text', { title: 'Nome', stepId: S1 });
    const b = question('short_text', { title: 'Telefone', stepId: S2 });
    const c = question('short_text', { title: 'Cargo', stepId: S3 });
    mocks.save.mockResolvedValue({
      ok: false,
      code: 'changed',
      form: form([b, c], { formEtag: 'etag-2', steps: steps('Um', 'Dois', 'Três').slice(1) }),
    });
    const { container } = show(form([a, b, c], { steps: steps('Um', 'Dois', 'Três') }));
    await save(container);
    expect(screen.getByRole('heading', { level: 2, name: 'Dois' })).toBeTruthy();
    expect(screen.getByText('Etapa 1 de 2')).toBeTruthy();
    expect(screen.queryByLabelText('Nome')).toBeNull();
    expect(screen.getByLabelText('Telefone')).toBeTruthy();
  });

  it('Concluir with missing ids jumps to the first step that holds one and says so, with no toast and no navigation', async () => {
    const a = question('short_text', { title: 'Nome', required: true, stepId: S1 });
    const b = question('short_text', { title: 'Telefone', stepId: S2 });
    mocks.save.mockResolvedValueOnce({ ok: true, destination: null, missingQuestionIds: [] });
    const { container } = show(form([a, b], { steps: steps('Sobre você', 'Contato') }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ana' } });
    await save(container);
    mocks.save.mockResolvedValueOnce({ ok: true, destination: null, missingQuestionIds: [a.id] });
    await save(container);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.flash).not.toHaveBeenCalled();
    const heading = screen.getByRole('heading', { level: 2, name: 'Sobre você' });
    expect(document.activeElement).toBe(heading);
    const notice = screen.getByText(
      'Falta responder uma pergunta obrigatória na etapa “Sobre você”. Levamos você até lá.',
    );
    expect(notice.closest('[role="status"]')).not.toBeNull();
    // The pending question carries the danger block (the member typed it, then the server still says missing).
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: '' } });
    expect(screen.getAllByText('Falta responder')).toHaveLength(1);
  });

  it('missing ids the form does not hold are a plain failure, never a navigation', async () => {
    const { read } = twoSteps();
    mocks.save.mockResolvedValueOnce({ ok: true, destination: null, missingQuestionIds: [] });
    const { container } = show(read);
    await save(container);
    mocks.save.mockResolvedValueOnce({
      ok: true,
      destination: null,
      missingQuestionIds: [uuid(99999)],
    });
    await save(container);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByText(/Não foi possível salvar agora/)).toBeTruthy();
  });
});

describe('returning: a stepper over the steps with something missing (D-630, UI-D-657, E4 partial)', () => {
  it('walks only the steps that owe an answer, pre-filled, flagging only the missing required ones, with no jump link', () => {
    const done = question('short_text', {
      title: 'Nome',
      required: true,
      stepId: S1,
      answer: 'Ana',
    });
    const missing = question('short_text', { title: 'Telefone', required: true, stepId: S2 });
    const filled = question('short_text', { title: 'Cargo', stepId: S2, answer: 'Dev' });
    const other = question('short_text', { title: 'Cidade', stepId: S3, answer: 'Recife' });
    show(
      form([done, missing, filled, other], {
        mode: 'returning',
        missingRequired: 1,
        steps: steps('Um', 'Dois', 'Três'),
      }),
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Dois' })).toBeTruthy();
    expect(screen.queryByText(/Etapa \d de/)).toBeNull();
    expect(screen.queryByLabelText('Nome')).toBeNull();
    expect((screen.getByLabelText('Cargo') as HTMLInputElement).value).toBe('Dev');
    expect(document.querySelectorAll('[data-flagged]')).toHaveLength(1);
    const notice = screen.getByText(/Falta 1 pergunta obrigatória/).closest('[role="status"]');
    expect(notice).not.toBeNull();
    expect(within(notice as HTMLElement).queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeTruthy();
  });

  it('keeps the count of the path while the member answers what was missing', async () => {
    const m1 = question('short_text', { title: 'Nome', required: true, stepId: S1 });
    const m2 = question('short_text', { title: 'Telefone', required: true, stepId: S2 });
    mocks.save.mockResolvedValue({ ok: true, destination: null, missingQuestionIds: [m2.id] });
    const { container } = show(
      form([m1, m2], { mode: 'returning', missingRequired: 2, steps: steps('Um', 'Dois') }),
    );
    expect(screen.getByText('Etapa 1 de 2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ana' } });
    expect(screen.getByText('Etapa 1 de 2')).toBeTruthy();
    await save(container);
    expect(screen.getByText('Etapa 2 de 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeTruthy();
  });
});
