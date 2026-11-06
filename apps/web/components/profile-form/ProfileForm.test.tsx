// @vitest-environment happy-dom

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemberForm } from '@rede-social/contracts/profile-form';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import {
  branch,
  CLINIC_OPTION_IDS,
  clinicForm,
  clinicId,
  form,
  options,
  question,
  uuid,
} from '@/lib/profile-form/test-fixtures';
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

/** A branch the opener opens on `values` (12.2): the questions that name its id sit in it, the form lists it. */
const gate = (opener: { id: string }, ...values: string[]) =>
  branch({ openerQuestionId: opener.id, values });

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

describe('the preview as a stepper: nothing validated, saved or confirmed (12.1-18, UI-D-652)', () => {
  const threeSteps = () => {
    const opts = options('Sim', 'Não');
    const opener = question('single_choice', {
      title: 'Abre',
      required: true,
      options: opts,
      stepId: S1,
    });
    const opens = gate(opener, opts[0]?.id as string);
    const gated = question('short_text', {
      title: 'Depois',
      required: true,
      stepId: S2,
      branchId: opens.id,
    });
    const last = question('short_text', { title: 'Fim', required: true, stepId: S3 });
    return form([opener, gated, last], {
      steps: steps('Um', 'Dois', 'Três'),
      branches: [opens],
    });
  };

  it('uses the stepper when the form has two or more steps and the one card otherwise', () => {
    show(threeSteps(), { preview: true, onClose: vi.fn() });
    expect(screen.getByText('Etapa 1 de 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeTruthy();
    cleanup();
    show(form([question('short_text', { title: 'Só' })]), { preview: true });
    expect(screen.queryByText(/Etapa \d de \d/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Avançar' })).toBeNull();
  });

  it('Avançar walks a required, untouched form: no error, no flag, no erase dialog, no action', async () => {
    const { container } = show(threeSteps(), { preview: true, onClose: vi.fn() });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    });
    expect(screen.getByRole('heading', { level: 2, name: 'Três' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('[data-flagged]')).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('ending the last step offers the outline Fechar and no Concluir, calling onClose only', async () => {
    const onClose = vi.fn();
    show(threeSteps(), { preview: true, onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    expect(screen.queryByRole('button', { name: 'Concluir' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('hands the sheet the counts and a restart, and adds the banner sentence only in the stepper', () => {
    const seen: { steps: number; questions: number }[] = [];
    show(threeSteps(), {
      preview: true,
      previewNote: 'Nota extra.',
      previewStatus: (info) => {
        seen.push({ steps: info.steps, questions: info.questions });
        return (
          <button type="button" onClick={info.restart}>
            reiniciar
          </button>
        );
      },
    });
    expect(
      screen.getByText('Prévia: nada do que você preencher aqui é salvo. Nota extra.'),
    ).toBeTruthy();
    expect(seen.at(-1)).toEqual({ steps: 2, questions: 2 });
    fireEvent.click(screen.getByRole('radio', { name: 'Sim' }));
    expect(seen.at(-1)).toEqual({ steps: 3, questions: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'reiniciar' }));
    expect(seen.at(-1)).toEqual({ steps: 2, questions: 2 });
    expect((screen.getByRole('radio', { name: 'Sim' }) as HTMLInputElement).checked).toBe(false);
    cleanup();
    show(form([question('short_text')]), {
      preview: true,
      previewNote: 'Nota extra.',
      previewStatus: () => <p>linha</p>,
    });
    expect(screen.queryByText(/Nota extra/)).toBeNull();
    expect(screen.queryByText('linha')).toBeNull();
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
    const opens = gate(opener, 'true');
    const hidden = question('short_text', {
      title: 'Escondida',
      stepId: S2,
      branchId: opens.id,
    });
    mocks.save.mockResolvedValue({ ok: true, destination: '/inicio' });
    const { container } = show(
      form([a, opener, hidden], { steps: steps('Um', 'Dois'), branches: [opens] }),
    );
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
    const opens = gate(opener, opts[0]?.id as string);
    const name = question('short_text', {
      title: 'Nome da clínica',
      required: true,
      branchId: opens.id,
    });
    const size = question('short_text', { title: 'Quantas pessoas?', branchId: opens.id });
    return { opener, name, size, read: form([opener, name, size], { branches: [opens] }) };
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
    const opens = gate(opener, opts[0]?.id as string);
    const follow = question('short_text', { title: 'Qual sistema?', branchId: opens.id });
    show(form([opener, follow], { branches: [opens] }));
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

  it('enters unflagged under the shared rail; a failed Avançar flags it and the block KEEPS its rail (UI-D-679)', async () => {
    const { read, name } = clinic();
    const { container } = show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect(screen.queryByText('Falta responder')).toBeNull();
    const rail = () =>
      document.querySelector(`#pf-q-${name.id}`)?.closest('[data-revealed-branch]') as HTMLElement;
    expect(rail().className).toContain('border-l-2 border-border pl-3');
    await save(container);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(document.querySelector(`#pf-q-${name.id}`)?.getAttribute('data-flagged')).not.toBeNull();
    // 12.1 dropped the rule of a flagged question; with several questions on one rail it stays.
    expect(rail().className).toContain('border-l-2 border-border pl-3');
    expect(screen.getByText('Falta responder')).toBeTruthy();
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

describe('a branch opens as ONE block under one rail (12.2-14, D-641, D-644; UI-D-679)', () => {
  const block = () => {
    const opts = options('Tenho uma clínica', 'Estou aprendendo');
    const opener = question('single_choice', { title: 'Qual é o seu caso?', options: opts });
    const opens = gate(opener, opts[0]?.id as string);
    const a = question('short_text', { title: 'Nome da clínica', branchId: opens.id });
    const b = question('short_text', { title: 'Quantas pessoas?', branchId: opens.id });
    const c = question('short_text', { title: 'Cidade da clínica', branchId: opens.id });
    const tail = question('short_text', { title: 'Contato' });
    return {
      opener,
      tail,
      read: form([opener, a, b, c, tail], { branches: [opens] }),
    };
  };

  it('three questions open inside ONE wrapper, the opener keeps focus and a root question stays outside', () => {
    const { read } = block();
    show(read);
    expect(document.querySelector('[data-revealed-branch]')).toBeNull();
    const radio = screen.getByRole('radio', { name: 'Tenho uma clínica' });
    radio.focus();
    fireEvent.click(radio);
    const wrappers = document.querySelectorAll('[data-revealed-branch]');
    expect(wrappers).toHaveLength(1);
    const wrapper = wrappers[0] as HTMLElement;
    for (const label of ['Nome da clínica', 'Quantas pessoas?', 'Cidade da clínica']) {
      expect(within(wrapper).getByLabelText(label)).toBeTruthy();
    }
    expect(wrapper.querySelectorAll('[data-question]')).toHaveLength(3);
    // The opener and the root question sit outside any wrapper.
    expect(wrapper.contains(radio)).toBe(false);
    expect(wrapper.contains(screen.getByLabelText('Contato'))).toBe(false);
    expect(screen.getByLabelText('Contato').closest('[data-revealed-branch]')).toBeNull();
    // WCAG 3.2.2: nothing took focus from the opener.
    expect(document.activeElement).toBe(radio);
    // The wrapper is a plain group: no landmark.
    expect(wrapper.getAttribute('role')).toBeNull();
  });

  it('the block is announced ONCE through the single polite region: the count of several', () => {
    const { read } = block();
    show(read);
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect(liveRegion().textContent).toBe('Apareceram 3 novas perguntas.');
    expect(liveRegion().textContent).not.toContain('Nome da clínica');
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    expect(liveRegion().textContent).toBe('3 perguntas saíram da lista.');
    expect(document.querySelector('[data-revealed-branch]')).toBeNull();
  });
});

describe('the path follows the answers: a step with no visible question drops out (D-628, E4 empty)', () => {
  it('revealing and hiding the only question of step 2 changes the path and the Etapa x de y count', async () => {
    const opts = options('Tenho', 'Não tenho');
    const opener = question('single_choice', { title: 'Tem clínica?', options: opts, stepId: S1 });
    const opens = gate(opener, opts[0]?.id as string);
    const only = question('short_text', {
      title: 'Nome da clínica',
      stepId: S2,
      branchId: opens.id,
    });
    const last = question('short_text', { title: 'Contato', stepId: S3 });
    mocks.save.mockResolvedValue({ ok: true, destination: null, missingQuestionIds: [] });
    const { container } = show(
      form([opener, only, last], { steps: steps('Um', 'Dois', 'Três'), branches: [opens] }),
    );
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

describe('the accessibility and 320px floor of the stepper (UI-D-660, UI-D-661, PFORM-42)', () => {
  const walk = () => {
    const ids = [S1, S2, S3];
    const qs = ids.map((stepId, index) =>
      question('short_text', { title: `Pergunta ${index + 1}`, stepId }),
    );
    return form(qs, {
      steps: steps('Um título de etapa bem longo para quebrar linha', 'Dois', 'Três'),
    });
  };

  it('the step is a section named by its h2, and the form is busy only while saving', async () => {
    const { container } = show(walk());
    const heading = screen.getByRole('heading', { level: 2 });
    const section = screen.getByRole('region', { name: heading.textContent as string });
    expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(section.contains(heading)).toBe(true);
    expect(formEl(container).getAttribute('aria-busy')).toBeNull();
  });

  it('the progress bar is decorative and the meaning is in the text', () => {
    const { container } = show(walk());
    const bar = container.querySelector('[data-step-bar]') as HTMLElement;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect(bar.querySelectorAll('[data-segment]')).toHaveLength(3);
    expect(screen.getByText('Etapa 1 de 3')).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 2 }).getAttribute('aria-describedby'),
    ).not.toBeNull();
  });

  it('Voltar and Avançar are real buttons in the form, so Enter in a text field submits the step', async () => {
    const { container } = show(walk());
    mocks.save.mockResolvedValue({ ok: true, destination: null, missingQuestionIds: [] });
    fireEvent.change(screen.getByLabelText('Pergunta 1'), { target: { value: 'x' } });
    const input = screen.getByLabelText('Pergunta 1') as HTMLInputElement;
    expect(input.form).toBe(formEl(container));
    const submits = [...formEl(container).querySelectorAll('button')].filter(
      (button) => button.type === 'submit',
    );
    expect(submits).toHaveLength(1);
    expect(submits[0]?.textContent).toContain('Avançar');
    await save(container);
    const back = screen.getByRole('button', { name: 'Voltar' }) as HTMLButtonElement;
    expect(back.type).toBe('button');
    expect(formEl(container).contains(back)).toBe(true);
  });

  it('at 320px Voltar keeps its content width and Avançar takes the rest, on 44px targets', async () => {
    const { container } = show(walk());
    mocks.save.mockResolvedValue({ ok: true, destination: null, missingQuestionIds: [] });
    await save(container);
    const back = screen.getByRole('button', { name: 'Voltar' });
    const forward = screen.getByRole('button', { name: 'Avançar' });
    expect(back.className).toContain('shrink-0');
    expect(back.className).not.toContain('flex-1');
    expect(forward.className).toContain('flex-1');
    expect(forward.className).toContain('min-w-0');
    expect(back.parentElement?.className).toContain('flex gap-3');
    // `size="lg"` is the 52px button of the system; no target in the row falls below 44px.
    for (const button of [back, forward]) expect(button.className).toContain('h-13');
  });

  it('a long step title wraps instead of clipping or scrolling sideways', () => {
    show(walk());
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toContain('bem longo');
    expect(heading.className).toContain('break-words');
    expect(heading.className).toContain('scroll-mt-4');
  });

  it('a long revealed title and long option labels sit inside the neutral rule and wrap (E5 long-text)', () => {
    const long = 'Uma opção com um rótulo extremamente longo que precisa quebrar linha sem rolagem';
    const opts = options(long, 'Curta');
    const opener = question('single_choice', { title: 'Abre?', options: opts });
    const opens = gate(opener, opts[0]?.id as string);
    const follow = question('short_text', { title: `${long} ${long}`, branchId: opens.id });
    show(form([opener, follow], { branches: [opens] }));
    fireEvent.click(screen.getByRole('radio', { name: long }));
    const rule = document.querySelector('[data-revealed-branch]') as HTMLElement;
    expect(rule.className).toBe('flex flex-col gap-6 border-l-2 border-border pl-3');
    expect(rule.querySelector('label')?.textContent).toContain(long);
  });

  it('no markup of the stepper writes a half-step spacing class (UI-SPEC Spacing Scale)', () => {
    const half = /(^|[^a-z])(gap|p|m|px|py|mt|mb|ml|mr)-(0\.5|1\.5|2\.5|3\.5)/;
    for (const file of ['ProfileForm.tsx', 'StepProgress.tsx', 'RevealedBranch.tsx']) {
      expect(readFileSync(join(__dirname, file), 'utf8'), file).not.toMatch(half);
    }
  });
});

describe('the erase warning before a save that deletes a stored answer (D-624, D-626, UI-D-656; PFORM-36)', () => {
  const SECRET = 'segredo-guardado-987';
  const caseForm = (mode: 'first' | 'returning' | 'edit' = 'first') => {
    const opts = options('Tenho uma clínica', 'Estou aprendendo');
    const opener = question('single_choice', {
      title: 'Qual é o seu caso?',
      options: opts,
      stepId: S1,
      answer: { optionIds: [opts[0]?.id as string], otherText: null },
    });
    const opens = gate(opener, opts[0]?.id as string);
    const name = question('short_text', {
      title: 'Nome da clínica',
      stepId: S1,
      branchId: opens.id,
      answer: SECRET,
    });
    const phone = question('short_text', { title: 'Telefone', stepId: S2 });
    return {
      opener,
      name,
      phone,
      read: form([opener, name, phone], {
        mode,
        steps: steps('Sobre você', 'Contato'),
        branches: [opens],
      }),
    };
  };
  const dialog = () => screen.queryByRole('dialog');

  it('a changed opener with a stored dependent answer opens the dialog and calls nothing until confirmed', async () => {
    const { read } = caseForm();
    mocks.save.mockResolvedValue({ ok: true, destination: null, missingQuestionIds: [] });
    const { container } = show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    await save(container);
    expect(dialog()).not.toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(
      within(dialog() as HTMLElement).getByRole('heading', {
        name: 'Apagar respostas que deixaram de valer?',
      }),
    ).toBeTruthy();
    // Titles only: the closed question's TITLE is listed, its stored answer never reaches the DOM.
    expect(within(dialog() as HTMLElement).getByText('Nome da clínica')).toBeTruthy();
    expect(document.body.textContent).not.toContain(SECRET);
    // Avançar on a non-last step confirms with "Apagar e continuar".
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apagar e continuar' }));
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({ stepId: S1 });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(screen.getByRole('heading', { level: 2, name: 'Contato' })).toBeTruthy();
  });

  it('cancel ("Rever respostas") saves nothing and the changed opener stays changed', async () => {
    const { read } = caseForm();
    const { container } = show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    await save(container);
    fireEvent.click(screen.getByRole('button', { name: 'Rever respostas' }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(mocks.save).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('radio', { name: 'Estou aprendendo' }) as HTMLInputElement).checked,
    ).toBe(true);
    // Still on the same step, and pressing the button again reopens the dialog.
    expect(screen.getByText('Etapa 1 de 2')).toBeTruthy();
    await save(container);
    expect(dialog()).not.toBeNull();
  });

  it('a draft that closes only a never-saved answer opens nothing and saves straight away', async () => {
    const opts = options('Tenho uma clínica', 'Estou aprendendo');
    const opener = question('single_choice', { title: 'Qual é o seu caso?', options: opts });
    const opens = gate(opener, opts[0]?.id as string);
    const name = question('short_text', { title: 'Nome da clínica', branchId: opens.id });
    mocks.save.mockResolvedValue({ ok: true, destination: '/inicio' });
    const { container } = show(form([opener, name], { branches: [opens] }));
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    fireEvent.change(screen.getByLabelText('Nome da clínica'), { target: { value: 'rascunho' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    await save(container);
    expect(dialog()).toBeNull();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.save.mock.calls[0]?.[0])).not.toContain('rascunho');
  });

  it('Concluir and the one-card Salvar confirm with "Apagar e salvar"', async () => {
    const { read } = caseForm();
    mocks.save.mockResolvedValue({ ok: true, destination: null, missingQuestionIds: [] });
    // Last step of a two-step path: walk to it first, then close nothing there (the dialog opened on step 1).
    const single = form(
      read.questions.filter((q) => q.stepId === S1),
      {
        mode: 'first',
        steps: steps('Sobre você'),
        branches: read.branches ?? [],
      },
    );
    const { container } = show(single);
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    await save(container);
    expect(screen.getByRole('button', { name: 'Apagar e salvar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apagar e continuar' })).toBeNull();
  });

  it('PFORM-36 idempotency: a double press on the confirm button sends ONE save', async () => {
    const { read } = caseForm();
    let finish: (value: unknown) => void = () => {};
    mocks.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    await save(container);
    const confirm = screen.getByRole('button', { name: 'Apagar e continuar' });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    // FA-UI-1: the dialog stays open, both buttons disabled, the confirm button reads "Salvando…".
    const saving = within(dialog() as HTMLElement).getByRole('button', { name: 'Salvando…' });
    expect((saving as HTMLButtonElement).disabled).toBe(true);
    expect(
      (
        within(dialog() as HTMLElement).getByRole('button', {
          name: 'Rever respostas',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () => {
      finish({ ok: true, destination: null, missingQuestionIds: [] });
    });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('PFORM-36 concurrency: a `changed` answer refreshes the form, keeps the typed answers and asks again from the fresh read', async () => {
    const { opener, name, read } = caseForm();
    const fresh = form(read.questions, {
      mode: 'first',
      steps: steps('Sobre você', 'Contato'),
      formEtag: 'etag-2',
      branches: read.branches ?? [],
    });
    mocks.save.mockResolvedValueOnce({ ok: false, code: 'changed', form: fresh });
    const { container } = show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    await save(container);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apagar e continuar' }));
    });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(
      screen.getByText(
        'O formulário mudou enquanto você respondia. Atualizamos a lista; confira e salve de novo.',
      ),
    ).toBeTruthy();
    // The typed opener survives the refresh, and pressing the button asks again from the fresh read.
    expect(
      (screen.getByRole('radio', { name: 'Estou aprendendo' }) as HTMLInputElement).checked,
    ).toBe(true);
    await save(container);
    expect(dialog()).not.toBeNull();
    mocks.save.mockResolvedValueOnce({ ok: true, destination: null, missingQuestionIds: [] });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apagar e continuar' }));
    });
    expect(mocks.save.mock.calls.at(-1)?.[0]).toMatchObject({ formEtag: 'etag-2' });
    expect(opener.id).not.toBe(name.id);
  });

  it('FA-UI-2: a failed save closes the dialog, shows the shipped alert and nothing is lost', async () => {
    const { read } = caseForm();
    mocks.save.mockResolvedValue({ ok: false, code: 'unavailable' });
    const { container } = show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    await save(container);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apagar e continuar' }));
    });
    await waitFor(() => expect(dialog()).toBeNull());
    expect(
      screen.getByText(
        'Não foi possível salvar agora. Suas respostas continuam aqui. Tente de novo.',
      ),
    ).toBeTruthy();
    expect(
      (screen.getByRole('radio', { name: 'Estou aprendendo' }) as HTMLInputElement).checked,
    ).toBe(true);
    // The button reopens the dialog on the next attempt.
    await save(container);
    expect(dialog()).not.toBeNull();
  });

  it('a step saved earlier in the session is still warned about when a later change would close it (D-626)', async () => {
    // The opener sits on step 1 and its dependent on step 2: the dependent's answer is saved on the way.
    const opts = options('Tenho uma clínica', 'Estou aprendendo');
    const opener = question('single_choice', {
      title: 'Qual é o seu caso?',
      options: opts,
      stepId: S1,
    });
    const opens = gate(opener, opts[0]?.id as string);
    const dependent = question('short_text', {
      title: 'Nome da clínica',
      stepId: S2,
      branchId: opens.id,
    });
    const tail = question('short_text', { title: 'Telefone', stepId: S2 });
    mocks.save.mockResolvedValue({ ok: true, destination: null, missingQuestionIds: [] });
    const { container } = show(
      form([opener, dependent, tail], { steps: steps('Sobre você', 'Contato'), branches: [opens] }),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    await save(container);
    fireEvent.change(screen.getByLabelText('Nome da clínica'), {
      target: { value: 'Clínica Sol' },
    });
    await save(container);
    // Back on step 1 the member changes the opener: the answer saved a moment ago would go.
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    mocks.save.mockClear();
    await save(container);
    expect(dialog()).not.toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(within(dialog() as HTMLElement).getByText('Nome da clínica')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Clínica Sol');
  });
});

describe('edit from the profile is ONE scroll with every step under its title (D-630, UI-D-658; PFORM-35)', () => {
  const editForm = () => {
    const opts = options('Tenho uma clínica', 'Estou aprendendo');
    const opener = question('single_choice', {
      title: 'Qual é o seu caso?',
      options: opts,
      stepId: S1,
      answer: { optionIds: [opts[1]?.id as string], otherText: null },
    });
    const opens = gate(opener, opts[0]?.id as string);
    const clinic = question('short_text', {
      title: 'Nome da clínica',
      stepId: S2,
      branchId: opens.id,
    });
    const phone = question('short_text', { title: 'Telefone', stepId: S3, answer: '11999990000' });
    return {
      opener,
      clinic,
      phone,
      opts,
      read: form([opener, clinic, phone], {
        mode: 'edit',
        steps: steps('Informações gerais', 'Sobre a sua clínica', 'Contato'),
        branches: [opens],
      }),
    };
  };
  const sectionHeadings = () =>
    screen.queryAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

  it('PFORM-35 ordering: a titled section per step that holds a visible question, in step order, one Salvar', () => {
    const { read } = editForm();
    show(read, { title: 'Minhas respostas' });
    // The clinic step is closed for this member (Estou aprendendo): no heading and no card for it.
    expect(sectionHeadings()).toEqual(['Informações gerais', 'Contato']);
    expect(screen.queryByRole('region', { name: 'Sobre a sua clínica' })).toBeNull();
    const first = screen.getByRole('region', { name: 'Informações gerais' });
    const second = screen.getByRole('region', { name: 'Contato' });
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(second).getByLabelText('Telefone')).toBeTruthy();
    expect(within(first).queryByLabelText('Telefone')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Salvar' })).toHaveLength(1);
    // No stepper chrome: no progress, no Avançar, no Voltar.
    expect(screen.queryByText(/Etapa \d de \d/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Avançar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull();
  });

  it('the h2 is 16/700 above its own card (p-4, gap-6) and the sections are gap-6 apart', () => {
    const { read } = editForm();
    show(read);
    const heading = screen.getByRole('heading', { level: 2, name: 'Informações gerais' });
    expect(heading.className).toContain('text-base');
    expect(heading.className).toContain('font-bold');
    expect(heading.className).toContain('break-words');
    const section = heading.closest('section') as HTMLElement;
    const card = section.querySelector('.p-4') as HTMLElement;
    expect(card.className).toContain('flex flex-col gap-6');
    expect(heading.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.parentElement?.className).toContain('gap-6');
    expect(section.parentElement?.querySelectorAll(':scope > section')).toHaveLength(2);
  });

  it('with one configured step there is no h2 and one card: exactly Phase 12', () => {
    const a = question('short_text', { title: 'Bio', answer: 'Oi' });
    const b = question('short_text', { title: 'Cidade' });
    const { container } = show(form([a, b], { mode: 'edit' }));
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
    expect(container.querySelectorAll('section')).toHaveLength(0);
    expect(container.querySelectorAll('.p-4')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Salvar' })).toHaveLength(1);
  });

  it('PFORM-35 adjacency: two steps with the same title are two distinct sections', () => {
    const a = question('short_text', { title: 'Cargo', stepId: S1 });
    const b = question('short_text', { title: 'Cidade', stepId: S2 });
    const { container } = show(form([a, b], { mode: 'edit', steps: steps('Dados', 'Dados') }));
    expect(sectionHeadings()).toEqual(['Dados', 'Dados']);
    const sections = container.querySelectorAll('section');
    expect(sections).toHaveLength(2);
    expect(sections[0]?.parentElement).toBe(sections[1]?.parentElement);
    expect(sections[0]?.parentElement?.className).toContain('gap-6');
    expect(sections[0]?.getAttribute('aria-labelledby')).not.toBe(
      sections[1]?.getAttribute('aria-labelledby'),
    );
    expect(within(sections[0] as HTMLElement).getByLabelText('Cargo')).toBeTruthy();
    expect(within(sections[1] as HTMLElement).getByLabelText('Cidade')).toBeTruthy();
  });

  it('conditions work live in place: a step opens with its h2 and card, and drops them when its last question closes', () => {
    const { read } = editForm();
    const { container } = show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect(sectionHeadings()).toEqual(['Informações gerais', 'Sobre a sua clínica', 'Contato']);
    expect(screen.getByLabelText('Nome da clínica')).toBeTruthy();
    // Section order, with the neighbours keeping their spacing.
    const sections = [...container.querySelectorAll('section')];
    expect(sections.map((s) => s.querySelector('h2')?.textContent)).toEqual([
      'Informações gerais',
      'Sobre a sua clínica',
      'Contato',
    ]);
    expect(sections[0]?.parentElement?.className).toContain('gap-6');
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    expect(sectionHeadings()).toEqual(['Informações gerais', 'Contato']);
    expect(container.querySelectorAll('section')).toHaveLength(2);
    expect(screen.queryByLabelText('Nome da clínica')).toBeNull();
    // One polite announcement says what changed; the question sat in ANOTHER step, so it names the step (12.2).
    expect(liveRegion().textContent).toBe('Uma pergunta saiu da etapa “Sobre a sua clínica”.');
  });

  it('PFORM-35 empty: no visible question shows the none state, never an empty card or a bare heading', () => {
    // Its opener is not in the form: the chain fails closed and the question is never shown.
    const lost = branch({ openerQuestionId: uuid(99999), values: ['x'] });
    const ghost = question('short_text', {
      title: 'Fantasma',
      stepId: S1,
      branchId: lost.id,
    });
    const { container } = show(
      form([ghost], { mode: 'edit', steps: steps('Dados', 'Mais'), branches: [lost] }),
    );
    expect(screen.getByText('Não há perguntas para responder')).toBeTruthy();
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
    expect(container.querySelectorAll('section')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
  });

  it('a step with no question at all gets no heading and no card', () => {
    const a = question('short_text', { title: 'Cargo', stepId: S2 });
    show(form([a], { mode: 'edit', steps: steps('Vazia', 'Dados') }));
    expect(sectionHeadings()).toEqual(['Dados']);
  });

  it('Salvar sends the whole form at once with NO stepId key, and goes where the server says', async () => {
    const { opener, phone, read } = editForm();
    mocks.save.mockResolvedValue({ ok: true, destination: '/perfil' });
    const { container } = show(read, { next: '/perfil' });
    fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '11888880000' } });
    await save(container);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const body = mocks.save.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('stepId' in body).toBe(false);
    expect(body).toMatchObject({ formEtag: 'etag-1', mode: 'edit', next: '/perfil' });
    expect(Object.keys(body.answers as object).sort()).toEqual([opener.id, phone.id].sort());
    expect(mocks.push).toHaveBeenCalledWith('/perfil');
  });

  it('Salvar validates every visible question of every section before sending', async () => {
    const a = question('short_text', { title: 'Cargo', required: true, stepId: S1 });
    const b = question('short_text', { title: 'Cidade', required: true, stepId: S2 });
    const { container } = show(form([a, b], { mode: 'edit', steps: steps('Um', 'Dois') }));
    await save(container);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByText('Revise 2 campos antes de salvar.')).toBeTruthy();
  });

  it('Salvar runs the erase warning with "Apagar e salvar" and lists the closed question title only', async () => {
    const opts = options('Tenho uma clínica', 'Estou aprendendo');
    const opener = question('single_choice', {
      title: 'Qual é o seu caso?',
      options: opts,
      stepId: S1,
      answer: { optionIds: [opts[0]?.id as string], otherText: null },
    });
    const opens = gate(opener, opts[0]?.id as string);
    const clinic = question('short_text', {
      title: 'Nome da clínica',
      stepId: S2,
      answer: 'Clínica Sol',
      branchId: opens.id,
    });
    mocks.save.mockResolvedValue({ ok: true, destination: '/perfil' });
    const { container } = show(
      form([opener, clinic], { mode: 'edit', steps: steps('Caso', 'Clínica'), branches: [opens] }),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    await save(container);
    expect(mocks.save).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Nome da clínica')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Clínica Sol');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Apagar e salvar' }));
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(Object.keys(mocks.save.mock.calls[0]?.[0] ?? {})).not.toContain('stepId');
    expect(mocks.push).toHaveBeenCalledWith('/perfil');
  });
});

/** The clinic form with the questions in TREE order, as the server always stores them (D-652). */
const TREE_ORDER = ['Q1', 'Q2', 'Q4', 'Q5', 'Q6', 'Q3', 'Q7'];
const treeClinic = (stored: Record<string, unknown> = {}): MemberForm => {
  const read = clinicForm(stored);
  return {
    ...read,
    questions: TREE_ORDER.map((key) => read.questions.find((q) => q.id === clinicId(key))).filter(
      (q): q is MemberForm['questions'][number] => q !== undefined,
    ),
  };
};

describe('nested blocks: closing a branch closes everything below it in one pass (12.2-14, D-645; UI-D-679)', () => {
  /** The clinic tree with every level open: Q1 tem -> B1 (Q2 sim -> B2 (Q4, Q5 sim -> B3 (Q6)), Q3). */
  const openClinic = (extra: Record<string, unknown> = {}, mode: 'first' | 'edit' = 'first') => {
    const read = treeClinic({
      Q1: { optionIds: [CLINIC_OPTION_IDS.tem], otherText: null },
      Q2: true,
      Q5: true,
      ...extra,
    });
    return { ...read, mode };
  };
  const wrappers = () => document.querySelectorAll('[data-revealed-branch]');

  it('draws three nested rails, each block inside its parent right after its opener', () => {
    show(openClinic());
    expect(wrappers()).toHaveLength(3);
    const outer = wrappers()[0] as HTMLElement;
    expect(outer.querySelectorAll('[data-revealed-branch]')).toHaveLength(2);
    // B1 holds Q2, then B2 right after its opener, then Q3 after the nested block.
    const direct = [...outer.children].map((child) =>
      child.hasAttribute('data-revealed-branch') ? 'bloco' : (child.textContent ?? ''),
    );
    expect(direct[0]).toContain('A clínica tem equipe?');
    expect(direct[1]).toBe('bloco');
    expect(direct[2]).toContain('Nome da clínica');
    const middle = outer.querySelector('[data-revealed-branch]') as HTMLElement;
    expect(middle.querySelectorAll('[data-revealed-branch]')).toHaveLength(1);
  });

  it('closing the top branch removes every nested block at once and announces the count ONCE', () => {
    show(openClinic());
    expect(liveRegion().textContent).toBe('');
    fireEvent.click(screen.getByRole('radio', { name: 'Trabalho em uma clínica' }));
    expect(wrappers()).toHaveLength(0);
    for (const title of ['A clínica tem equipe?', 'Quantos profissionais?', 'Nome do sócio']) {
      expect(screen.queryByText(title)).toBeNull();
    }
    expect(liveRegion().textContent).toBe('5 perguntas saíram da lista.');
  });

  it('with the motion on, the whole tree leaves as ONE block and nothing remains', async () => {
    mocks.reduced = false;
    show(openClinic());
    fireEvent.click(screen.getByRole('radio', { name: 'Trabalho em uma clínica' }));
    await waitFor(() => expect(wrappers()).toHaveLength(0), { timeout: 3000 });
    expect(screen.queryByLabelText('Nome da clínica')).toBeNull();
  });

  it('closing a middle branch closes the ones below it and keeps the ones above', () => {
    show(openClinic());
    // Q2 -> Não closes B2 and B3 but B1 (Q2, Q3) stays open.
    const q2 = document.querySelector(`#pf-q-${clinicId('Q2')}`) as HTMLElement;
    fireEvent.click(within(q2).getByRole('button', { name: 'Não' }));
    expect(wrappers()).toHaveLength(1);
    expect(screen.getByLabelText('Nome da clínica')).toBeTruthy();
    expect(screen.queryByLabelText('Quantos profissionais?')).toBeNull();
    expect(liveRegion().textContent).toBe('3 perguntas saíram da lista.');
  });

  it('a draft typed under a closed nested block returns when it reopens and is absent from the wire answers', async () => {
    mocks.save.mockResolvedValue({ ok: true, destination: '/inicio' });
    const { container } = show(openClinic());
    fireEvent.change(screen.getByLabelText('Nome do sócio'), { target: { value: 'Ana Souza' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Trabalho em uma clínica' }));
    expect(screen.queryByLabelText('Nome do sócio')).toBeNull();
    await save(container);
    expect(mocks.save).not.toHaveBeenCalled();
    // The erase dialog guards the stored answers that close; the typed draft is never part of the body.
    const dialog = screen.getByRole('dialog');
    expect(JSON.stringify(mocks.save.mock.calls)).not.toContain('Ana Souza');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rever respostas' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect((screen.getByLabelText('Nome do sócio') as HTMLInputElement).value).toBe('Ana Souza');
  });

  it('what is sent never holds a closed question, whatever its draft (the wire follows the chain)', async () => {
    mocks.save.mockResolvedValue({ ok: true, destination: '/inicio' });
    // Nothing is stored here, so closing the branch erases nothing and the save goes straight out.
    const read = { ...treeClinic(), mode: 'first' as const };
    const { container } = show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    fireEvent.change(screen.getByLabelText('Nome da clínica'), {
      target: { value: 'Clínica Sol' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Trabalho em uma clínica' }));
    await save(container);
    const body = mocks.save.mock.calls[0]?.[0] as { answers: Record<string, unknown> };
    const sent = body.answers;
    expect(Object.keys(sent)).toEqual([clinicId('Q1')]);
  });

  it('a flagged question inside a block keeps the danger block AND the rail', () => {
    // Returning: Q3 ("Nome da clínica") is required, visible and unanswered, so it is flagged on arrival.
    const read = { ...openClinic(), mode: 'returning' as const, missingRequired: 3 };
    show(read);
    const q3 = document.querySelector(`#pf-q-${clinicId('Q3')}`) as HTMLElement;
    expect(q3.getAttribute('data-flagged')).not.toBeNull();
    expect(q3.className).toContain('border-danger/40');
    expect(q3.closest('[data-revealed-branch]')?.className).toContain(
      'border-l-2 border-border pl-3',
    );
    // The rail is the block's, not the question's: the question wrapper has no rule of its own.
    expect(q3.className).not.toContain('border-l-2');
  });

  it('no markup of the block writes a half-step spacing class, a landmark or a state by colour alone', () => {
    show({ ...openClinic(), mode: 'returning' as const, missingRequired: 3 });
    const half = /(^|[^a-z])(gap|p|m|px|py|mt|mb|ml|mr)-(0\.5|1\.5|2\.5|3\.5)/;
    for (const wrapper of wrappers()) {
      expect(wrapper.className).not.toMatch(half);
      expect(wrapper.getAttribute('role')).toBeNull();
    }
    // "Falta responder" is words, never colour alone.
    expect(screen.getAllByText('Falta responder').length).toBeGreaterThan(0);
  });
});

describe('a block whose opener is in another step is simply there on arrival (12.2-14, D-643; UI-D-679)', () => {
  const crossStep = () => {
    const opts = options('Tenho uma clínica', 'Não tenho');
    const opener = question('single_choice', {
      title: 'Tem clínica?',
      options: opts,
      stepId: S1,
      answer: { optionIds: [opts[0]?.id as string], otherText: null },
    });
    const opens = gate(opener, opts[0]?.id as string);
    const a = question('short_text', { title: 'Nome da clínica', stepId: S2, branchId: opens.id });
    const b = question('short_text', {
      title: 'Cidade da clínica',
      stepId: S2,
      branchId: opens.id,
    });
    return form([opener, a, b], { steps: steps('Um', 'Dois'), branches: [opens] });
  };

  it('arrives with the block present and no motion wrapper holding it back', async () => {
    mocks.reduced = false;
    mocks.save.mockResolvedValue({ ok: true, destination: null, missingQuestionIds: [] });
    const { container } = show(crossStep());
    expect(screen.queryByLabelText('Nome da clínica')).toBeNull();
    await save(container);
    expect(screen.getByRole('heading', { level: 2, name: 'Dois' })).toBeTruthy();
    // Present at once, in ONE wrapper, not faded in from zero.
    const wrapper = document.querySelector('[data-revealed-branch]') as HTMLElement;
    expect(wrapper.querySelectorAll('[data-question]')).toHaveLength(2);
    const motion = wrapper.parentElement as HTMLElement;
    expect(motion.style.opacity).not.toBe('0');
    expect(motion.style.height).not.toBe('0px');
    // The change on the other step never announced anything on this one.
    expect(liveRegion().textContent).toBe('');
  });

  it('under the stepper a change in another step moves the count silently', () => {
    const opts = options('Tenho', 'Não tenho');
    const opener = question('single_choice', { title: 'Tem?', options: opts, stepId: S1 });
    const opens = gate(opener, opts[0]?.id as string);
    const far = question('short_text', { title: 'Longe', stepId: S3, branchId: opens.id });
    const mid = question('short_text', { title: 'Meio', stepId: S2 });
    show(form([opener, mid, far], { steps: steps('Um', 'Dois', 'Três'), branches: [opens] }));
    expect(screen.getByText('Etapa 1 de 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho' }));
    expect(screen.getByText('Etapa 1 de 3')).toBeTruthy();
    expect(liveRegion().textContent).toBe('');
  });
});

describe('the one-scroll edit announces a block that opens in another step (12.2-14, UI-D-679)', () => {
  const SECRET_VALUE = 'valor-secreto-do-membro-42';
  const editClinic = () => {
    const opts = options('Tenho', 'Não tenho');
    const opener = question('single_choice', {
      title: 'Tem clínica?',
      options: opts,
      stepId: S1,
      answer: { optionIds: [opts[1]?.id as string], otherText: null },
    });
    const opens = gate(opener, opts[0]?.id as string);
    const same = question('short_text', { title: 'Apelido', stepId: S1, branchId: opens.id });
    const one = question('short_text', {
      title: 'Nome da clínica',
      stepId: S2,
      branchId: opens.id,
    });
    const two = question('short_text', { title: 'Cidade', stepId: S3, branchId: opens.id });
    const three = question('short_text', { title: 'Bairro', stepId: S3, branchId: opens.id });
    // A hostile branch name never reaches the member read; if one did, nothing may draw it.
    const hostile = { ...opens, name: 'Ramo SECRETO' } as typeof opens;
    return form([opener, same, one, two, three], {
      mode: 'edit',
      steps: steps('Geral', 'Clínica', 'Contato'),
      branches: [hostile],
    });
  };

  it('same-step questions keep the 12.1 strings and other steps announce their step title', () => {
    show(editClinic());
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho' }));
    expect(liveRegion().textContent).toBe(
      'Apareceu uma nova pergunta: Apelido. Apareceu uma nova pergunta na etapa “Clínica”. Apareceram 2 novas perguntas na etapa “Contato”.',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Não tenho' }));
    expect(liveRegion().textContent).toBe(
      'Uma pergunta saiu da lista. Uma pergunta saiu da etapa “Clínica”. 2 perguntas saíram da etapa “Contato”.',
    );
  });

  it('exactly one polite region exists and it never holds an answer value or a branch name', () => {
    show(editClinic());
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho' }));
    fireEvent.change(screen.getByLabelText('Cidade'), { target: { value: SECRET_VALUE } });
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('radio', { name: 'Não tenho' }));
    expect(liveRegion().textContent).not.toContain(SECRET_VALUE);
    expect(liveRegion().textContent).not.toContain('SECRETO');
    expect(document.body.textContent).not.toContain('SECRETO');
    expect(JSON.stringify(mocks.flash.mock.calls)).not.toContain(SECRET_VALUE);
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it('a step whose last visible question closes loses its section', () => {
    show(editClinic());
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho' }));
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Geral',
      'Clínica',
      'Contato',
    ]);
    fireEvent.click(screen.getByRole('radio', { name: 'Não tenho' }));
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Geral',
    ]);
    expect(document.querySelector('[data-revealed-branch]')).toBeNull();
  });
});

describe('the erase dialog over a tree lists, flat and in form order, the active titles that had an answer (12.2-14, D-645; UI-D-680)', () => {
  const stored = {
    Q1: { optionIds: [CLINIC_OPTION_IDS.tem], otherText: null },
    Q2: true,
    Q3: 'Clínica Sol',
    Q4: 7,
    Q5: true,
    Q6: 'Ana Souza',
  };
  const dialog = () => screen.queryByRole('dialog') as HTMLElement;

  it('closing the top branch lists the stored titles of every level, flat, in form order', async () => {
    mocks.save.mockResolvedValue({ ok: true, destination: '/perfil' });
    const { container } = show({ ...treeClinic(stored), mode: 'edit' as const });
    fireEvent.click(screen.getByRole('radio', { name: 'Trabalho em uma clínica' }));
    await save(container);
    expect(mocks.save).not.toHaveBeenCalled();
    const items = within(within(dialog()).getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'A clínica tem equipe?',
      'Quantos profissionais?',
      'Tem sócio?',
      'Nome do sócio',
      'Nome da clínica',
    ]);
    // No branch vocabulary, no grouping, no answer value.
    expect(dialog().textContent).not.toMatch(/ramo|grupo/i);
    expect(dialog().textContent).not.toContain('Clínica Sol');
    expect(dialog().textContent).not.toContain('Ana Souza');
    expect(dialog().querySelectorAll('ul ul')).toHaveLength(0);
  });

  it('a closed question WITHOUT a stored answer is not listed', async () => {
    const { container } = show({
      ...treeClinic({ ...stored, Q3: undefined, Q6: undefined }),
      mode: 'edit' as const,
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Trabalho em uma clínica' }));
    await save(container);
    const items = within(within(dialog()).getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'A clínica tem equipe?',
      'Quantos profissionais?',
      'Tem sócio?',
    ]);
  });

  it('closing only a middle branch lists only what sat below it', async () => {
    const { container } = show({ ...treeClinic(stored), mode: 'edit' as const });
    const q2 = document.querySelector(`#pf-q-${clinicId('Q2')}`) as HTMLElement;
    fireEvent.click(within(q2).getByRole('button', { name: 'Não' }));
    await save(container);
    const items = within(within(dialog()).getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Quantos profissionais?',
      'Tem sócio?',
      'Nome do sócio',
    ]);
  });

  const sevenForm = () => {
    const opts = options('Tenho', 'Não tenho');
    const opener = question('single_choice', {
      title: 'Abre?',
      options: opts,
      answer: { optionIds: [opts[0]?.id as string], otherText: null },
    });
    const opens = gate(opener, opts[0]?.id as string);
    // Deliberately NOT alphabetical: the list follows the form, not the titles.
    const titles = ['Zeta', 'Alfa', 'Ômega', 'Beta', 'Delta', 'Gama', 'Épsilon'];
    const followers = titles.map((title) =>
      question('short_text', { title, branchId: opens.id, answer: `resposta ${title}` }),
    );
    return { opener, form: form([opener, ...followers], { mode: 'edit', branches: [opens] }) };
  };

  it('seven titles show five and "e mais 2 perguntas", in the order of the form (not typed, not sorted)', async () => {
    const { form: read } = sevenForm();
    const { container } = show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Não tenho' }));
    await save(container);
    const items = within(within(dialog()).getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Zeta',
      'Alfa',
      'Ômega',
      'Beta',
      'Delta',
      'e mais 2 perguntas',
    ]);
    expect(dialog().textContent).toContain('7 perguntas abaixo deixaram de se aplicar');
  });

  it('the dialog body keeps the capped scrolling region with seven titles, the title and both buttons outside it', async () => {
    const { form: read } = sevenForm();
    const { container } = show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Não tenho' }));
    await save(container);
    const region = document.querySelector('[data-confirm-body-scroll]') as HTMLElement;
    expect(region.className).toContain('max-h-60');
    expect(region.className).toContain('overflow-y-auto');
    expect(region.contains(within(dialog()).getByRole('heading'))).toBe(false);
    for (const name of ['Rever respostas', 'Apagar e salvar']) {
      expect(region.contains(within(dialog()).getByRole('button', { name }))).toBe(false);
    }
  });

  it('the dialog, its failure alert and its buttons are the 12.1 ones', async () => {
    const { form: read } = sevenForm();
    mocks.save.mockResolvedValue({ ok: false, code: 'unavailable' });
    const { container } = show(read);
    fireEvent.click(screen.getByRole('radio', { name: 'Não tenho' }));
    await save(container);
    await act(async () => {
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Apagar e salvar' }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      screen.getByText(
        'Não foi possível salvar agora. Suas respostas continuam aqui. Tente de novo.',
      ),
    ).toBeTruthy();
  });
});
