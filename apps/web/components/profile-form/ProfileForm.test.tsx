// @vitest-environment happy-dom

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
