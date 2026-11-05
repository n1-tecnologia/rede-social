// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { adminQuestion, adminStep, uuid } from '@/lib/profile-form/test-fixtures';

/**
 * 12.1-18 (D-627, D-628; UI-D-652, UI-D-660, UI-D-661; PFORM-37, PFORM-42; T-12.1-09, T-12.1-11) — the
 * admin's "Como o membro vê" as the member's own stepper: it advances with no answers, counts what a member
 * would see under the answers ticked, restarts, closes through "Fechar", and never reaches an action. The
 * real catalog and the real `ProfileForm`; stubbed: the save action (it must stay uncalled), the router.
 * The 320px pixel reading is plan 19's Playwright backstop; here the wrapping classes are asserted.
 */

const mocks = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn(), refresh: vi.fn() }));

MotionGlobalConfig.skipAnimations = true;
const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

vi.mock('@/app/(auth)/completar-perfil/actions', () => ({
  saveProfileFormAction: (...args: unknown[]) => mocks.save(...args),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh, replace: vi.fn() }),
}));

const { PreviewSheet } = await import('./PreviewSheet');

const S1 = adminStep({ title: 'Informações gerais', questionCount: 2 });
const S2 = adminStep({ title: 'Sobre a sua clínica', questionCount: 1 });
const S3 = adminStep({ title: 'Contato', questionCount: 1 });

const OWN = { id: uuid(9601), label: 'Tenho uma clínica', answerCount: 0 };
const WORK = { id: uuid(9602), label: 'Trabalho em uma clínica', answerCount: 0 };
const LEARN = { id: uuid(9603), label: 'Estou aprendendo', answerCount: 0 };

const opener = adminQuestion('single_choice', {
  title: 'Você tem clínica?',
  required: true,
  stepId: S1.id,
  options: [OWN, WORK, LEARN],
});
const name = adminQuestion('short_text', {
  title: 'Nome profissional',
  required: true,
  stepId: S1.id,
});
const clinic = adminQuestion('short_text', {
  title: 'Nome da clínica',
  required: true,
  stepId: S2.id,
  condition: { questionId: opener.id, values: [OWN.id] },
});
const phone = adminQuestion('short_text', {
  title: 'Telefone para contato',
  required: true,
  stepId: S3.id,
});

function open(
  questions = [opener, name, clinic, phone],
  steps = [S1, S2, S3],
  onClose: () => void = vi.fn(),
) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <PreviewSheet open questions={questions} steps={steps} onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

const status = () => screen.getByRole('status');
const eyebrow = () => screen.getByText(/^Etapa \d+ de \d+$/).textContent;
const advance = () => fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));

beforeEach(() => {
  mocks.save.mockReset();
  mocks.push.mockReset();
  mocks.refresh.mockReset();
});
afterEach(() => cleanup());

describe('the preview runs the member stepper over the admin questions (UI-D-652)', () => {
  it('opens on step 1 with the banner sentence, the status line and Recomeçar', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Como o membro vê' })).toBeTruthy();
    expect(
      screen.getByText(
        'Prévia: nada do que você preencher aqui é salvo. Aqui você avança sem precisar responder.',
      ),
    ).toBeTruthy();
    // The conditional clinic question is closed for a blank viewer: 2 steps on the path, 3 questions.
    expect(status().textContent).toBe('Com estas respostas, o membro vê 2 etapas e 3 perguntas.');
    expect(eyebrow()).toBe('Etapa 1 de 2');
    expect(screen.getByRole('heading', { level: 2, name: 'Informações gerais' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recomeçar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull();
  });

  it('Avançar and Voltar work on an untouched form, with no validation and no action', () => {
    open();
    advance();
    expect(eyebrow()).toBe('Etapa 2 de 2');
    expect(screen.getByRole('heading', { level: 2, name: 'Contato' })).toBeTruthy();
    // Nothing was flagged and no error summary appeared for the unanswered required questions.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Falta responder')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(eyebrow()).toBe('Etapa 1 de 2');
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('Enter in a field advances too (the submit is the same no-validation move)', () => {
    const { container } = open();
    act(() => {
      fireEvent.submit(container.ownerDocument.querySelector('form') as HTMLFormElement);
    });
    expect(eyebrow()).toBe('Etapa 2 de 2');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('ticking the opener adds the step to the count and to "Etapa x de y"', () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect(status().textContent).toBe('Com estas respostas, o membro vê 3 etapas e 4 perguntas.');
    expect(eyebrow()).toBe('Etapa 1 de 3');
    advance();
    expect(eyebrow()).toBe('Etapa 2 de 3');
    expect(screen.getByRole('heading', { level: 2, name: 'Sobre a sua clínica' })).toBeTruthy();
    expect(screen.getByLabelText('Nome da clínica')).toBeTruthy();
  });

  it('going back to another option removes the step again, and a step with only a hidden question is absent', () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect(eyebrow()).toBe('Etapa 1 de 3');
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    expect(status().textContent).toBe('Com estas respostas, o membro vê 2 etapas e 3 perguntas.');
    expect(eyebrow()).toBe('Etapa 1 de 2');
    advance();
    // The clinic step is skipped: the next step is Contato.
    expect(screen.getByRole('heading', { level: 2, name: 'Contato' })).toBeTruthy();
    expect(screen.queryByText('Sobre a sua clínica')).toBeNull();
  });

  it('uses the singular in the count', () => {
    const only = adminQuestion('short_text', { title: 'Cidade', stepId: S1.id });
    const other = adminQuestion('short_text', { title: 'Estado', stepId: S3.id });
    open([only, other], [S1, S3]);
    expect(status().textContent).toBe('Com estas respostas, o membro vê 2 etapas e 2 perguntas.');
    cleanup();
    // Two steps configured, but the member sees only one of them: one step, one question.
    const opening = adminQuestion('single_choice', {
      title: 'Abre',
      stepId: S1.id,
      options: [OWN, WORK],
    });
    const gated = adminQuestion('short_text', {
      title: 'Só depois',
      stepId: S3.id,
      condition: { questionId: opening.id, values: [OWN.id] },
    });
    open([opening, gated], [S1, S3]);
    expect(status().textContent).toBe('Com estas respostas, o membro vê 1 etapa e 1 pergunta.');
  });

  it('the last step ends in the outline Fechar (never Concluir) and it closes the sheet', () => {
    const onClose = vi.fn();
    open([opener, name, clinic, phone], [S1, S2, S3], onClose);
    advance();
    expect(screen.queryByRole('button', { name: 'Avançar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Concluir' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull();
    const close = within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Fechar' });
    const last = close.find((button) => button.textContent === 'Fechar') as HTMLElement;
    expect(last.className).toContain('border-border-secondary');
    expect(last.getAttribute('type')).toBe('button');
    fireEvent.click(last);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('Recomeçar clears every answer and returns to step 1, calling nothing', () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    fireEvent.change(screen.getByLabelText('Nome profissional'), { target: { value: 'Ana' } });
    advance();
    expect(eyebrow()).toBe('Etapa 2 de 3');
    fireEvent.click(screen.getByRole('button', { name: 'Recomeçar' }));
    expect(eyebrow()).toBe('Etapa 1 de 2');
    expect(status().textContent).toBe('Com estas respostas, o membro vê 2 etapas e 3 perguntas.');
    expect(
      (screen.getByRole('radio', { name: 'Tenho uma clínica' }) as HTMLInputElement).checked,
    ).toBe(false);
    expect((screen.getByLabelText('Nome profissional') as HTMLInputElement).value).toBe('');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('moves focus to the new step heading on Avançar', () => {
    open();
    advance();
    const heading = screen.getByRole('heading', { level: 2, name: 'Contato' });
    expect(heading.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(heading);
  });
});

describe('a form the member sees as one step is exactly Phase 12 (UI-D-652)', () => {
  it('has no status line, no Recomeçar, no banner sentence and no stepper chrome', () => {
    const a = adminQuestion('short_text', { title: 'Cargo', stepId: S1.id });
    const b = adminQuestion('short_text', { title: 'Cidade', stepId: S1.id });
    open([a, b], [S1]);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recomeçar' })).toBeNull();
    expect(screen.queryByText(/Aqui você avança/)).toBeNull();
    expect(screen.getByText('Prévia: nada do que você preencher aqui é salvo.')).toBeTruthy();
    expect(screen.queryByText(/Etapa \d+ de \d+/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Avançar' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Fechar' }).length).toBeGreaterThan(0);
  });

  it('a form with no steps at all keeps the one card', () => {
    const a = adminQuestion('short_text', { title: 'Cargo' });
    open([a], []);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Avançar' })).toBeNull();
  });
});

describe('the accessibility and 320px floor of the preview (UI-D-660, UI-D-661, PFORM-42)', () => {
  it('the status line is a polite role=status and the restart target is 44px', () => {
    open();
    const line = status();
    expect(line.tagName).toBe('P');
    expect(line.getAttribute('aria-live')).not.toBe('assertive');
    const restart = screen.getByRole('button', { name: 'Recomeçar' });
    expect(restart.className).toContain('after:h-11');
    expect(restart.className).toContain('text-text');
    expect(restart.className).not.toContain('text-brand');
  });

  it('the banner, the status line and a long step title wrap (no overflow classes)', () => {
    const longStep = adminStep({
      title: 'Um título de etapa bem longo que precisa quebrar linha em 320 pixels de largura',
      questionCount: 1,
    });
    const first = adminQuestion('short_text', { title: 'Cargo', stepId: longStep.id });
    const second = adminQuestion('short_text', { title: 'Cidade', stepId: S3.id });
    open([first, second], [longStep, S3]);
    expect(status().className).toContain('break-words');
    expect(status().className).toContain('min-w-0');
    expect(status().parentElement?.className).toContain('flex-wrap');
    const banner = screen.getByText(/^Prévia: nada do que você preencher aqui é salvo\./);
    expect(banner.className).toContain('break-words');
    const heading = screen.getByRole('heading', { level: 2, name: /^Um título de etapa/ });
    expect(heading.className).toMatch(/break-words|wrap-anywhere/);
    const dialog = screen.getByRole('dialog');
    expect(dialog.innerHTML).not.toMatch(/overflow-x-(scroll|auto)|whitespace-nowrap/);
  });

  it('the back and next buttons are the shipped 52px size and sit beside each other', () => {
    open();
    advance();
    const back = screen.getByRole('button', { name: 'Voltar' });
    expect(back.className).toContain('h-13');
    expect((back.parentElement as HTMLElement).className).toContain('flex');
  });

  it('closes through Escape; the handle is pointer-only, so no control repeats Fechar before the last step', () => {
    const onClose = vi.fn();
    open([opener, name, clinic, phone], [S1, S2, S3], onClose);
    const dialog = screen.getByRole('dialog', { name: 'Como o membro vê' });
    expect(within(dialog).queryAllByRole('button', { name: 'Fechar' })).toHaveLength(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('writes no half-step spacing class in the preview source (the shipped Button sm keeps its own)', () => {
    const source = readFileSync(join(__dirname, 'PreviewSheet.tsx'), 'utf8');
    expect(source).not.toMatch(/(^|[^a-z])(gap|p|m|px|py|mt|mb|ml|mr)-(0\.5|1\.5|2\.5|3\.5)/);
  });
});

describe('the preview never reaches an action or shows a stored answer (T-12.1-11)', () => {
  it('every walk, tick, restart and close leaves the save action with zero calls', () => {
    const onClose = vi.fn();
    open([opener, name, clinic, phone], [S1, S2, S3], onClose);
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    advance();
    advance();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recomeçar' }));
    advance();
    const last = screen
      .getAllByRole('button', { name: 'Fechar' })
      .find((button) => button.textContent === 'Fechar') as HTMLElement;
    fireEvent.click(last);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
