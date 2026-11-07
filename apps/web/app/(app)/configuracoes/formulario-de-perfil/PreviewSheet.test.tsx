// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memberBranchSchema } from '@rede-social/contracts/profile-form';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { Answers } from '@/lib/profile-form/form-state';
import { stepPath } from '@/lib/profile-form/steps';
import { adminBranch, adminQuestion, adminStep, uuid } from '@/lib/profile-form/test-fixtures';
import { visibleQuestionIds } from '@/lib/profile-form/visibility';

/**
 * 12.2-19 (D-651, UI-D-678; PFORM-59, PFORM-60; T-12.2-03): the preview is the member component and follows
 * BRANCHES, not the retired per-question condition, and the branch name never reaches it.
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
const BR = adminBranch({
  openerQuestionId: opener.id,
  values: [OWN.id],
  name: 'Quem tem clínica',
  questionCount: 1,
});
const clinic = adminQuestion('short_text', {
  title: 'Nome da clínica',
  required: true,
  stepId: S2.id,
  branchId: BR.id,
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
  branches = [BR],
) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <PreviewSheet
        open
        questions={questions}
        steps={steps}
        branches={branches}
        onClose={onClose}
      />
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
    const gate = adminBranch({ openerQuestionId: opening.id, values: [OWN.id], questionCount: 1 });
    const gated = adminQuestion('short_text', {
      title: 'Só depois',
      stepId: S3.id,
      branchId: gate.id,
    });
    open([opening, gated], [S1, S3], vi.fn(), [gate]);
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

/* ------------------------------------------------------------------------------------------------ */
/* 12.2-19 Task 3: the preview follows branches with the member rules and no branch name (D-651).     */
/* ------------------------------------------------------------------------------------------------ */

const { previewForm } = await import('./PreviewSheet');

const choice = (id: string): Answers[string] => ({ optionIds: [id], other: false, otherText: '' });

/** Three steps: O1 and N in step 1; a branch of O1 holds CN (step 1) and Y (step 2); Y opens TEAM (step 3). */
const T1 = adminStep({ title: 'Geral', questionCount: 3 });
const T2 = adminStep({ title: 'Equipe', questionCount: 1 });
const T3 = adminStep({ title: 'Fim', questionCount: 2 });
const O1 = adminQuestion('single_choice', {
  title: 'Você tem clínica?',
  required: true,
  stepId: T1.id,
  options: [OWN, WORK, LEARN],
});
const N1 = adminQuestion('short_text', { title: 'Nome profissional', stepId: T1.id });
const BR1 = adminBranch({
  openerQuestionId: O1.id,
  values: [OWN.id],
  name: 'Quem tem clínica',
  questionCount: 2,
});
const CN = adminQuestion('short_text', {
  title: 'Nome da clínica',
  required: true,
  stepId: T1.id,
  branchId: BR1.id,
});
const Y = adminQuestion('yes_no', {
  title: 'A clínica tem equipe?',
  stepId: T2.id,
  branchId: BR1.id,
});
const BR2 = adminBranch({
  openerQuestionId: Y.id,
  values: ['true'],
  name: 'Clínica com equipe',
  questionCount: 1,
});
const TEAM = adminQuestion('number', {
  title: 'Quantas pessoas trabalham aí?',
  stepId: T3.id,
  branchId: BR2.id,
});
const P1 = adminQuestion('phone', { title: 'Telefone para contato', stepId: T3.id });
const NESTED = [O1, N1, CN, Y, TEAM, P1];
const NESTED_STEPS = [T1, T2, T3];
const NESTED_BRANCHES = [BR1, BR2];
const openNested = () => open(NESTED, NESTED_STEPS, vi.fn(), NESTED_BRANCHES);
const summary = (steps: string, questions: string) =>
  `Com estas respostas, o membro vê ${steps} e ${questions}.`;

describe('12.2-19 Task 3: previewForm hands the member component branches, never a name (D-651, T-12.2-03)', () => {
  it('returns the branches in the member shape: id, opener and values, nothing else', () => {
    const form = previewForm(NESTED, NESTED_STEPS, NESTED_BRANCHES);
    expect(form.branches).toEqual([
      { id: BR1.id, openerQuestionId: O1.id, values: [OWN.id] },
      { id: BR2.id, openerQuestionId: Y.id, values: ['true'] },
    ]);
    for (const member of form.branches ?? []) {
      expect(Object.keys(member).sort()).toEqual(['id', 'openerQuestionId', 'values']);
      expect(memberBranchSchema.safeParse(member).success).toBe(true);
    }
  });

  it('never carries a branch name anywhere in the serialized form', () => {
    const text = JSON.stringify(previewForm(NESTED, NESTED_STEPS, NESTED_BRANCHES));
    expect(text).not.toContain('Quem tem clínica');
    expect(text).not.toContain('Clínica com equipe');
    expect(text).not.toContain('"name"');
    expect(text).not.toContain('answerCount');
    expect(text).not.toContain('revision');
  });

  it('copies the branch of each question and leaves nobody under the retired condition', () => {
    const form = previewForm(NESTED, NESTED_STEPS, NESTED_BRANCHES);
    const byTitle = new Map(form.questions.map((question) => [question.title, question]));
    expect(byTitle.get('Nome da clínica')?.branchId).toBe(BR1.id);
    expect(byTitle.get('A clínica tem equipe?')?.branchId).toBe(BR1.id);
    expect(byTitle.get('Quantas pessoas trabalham aí?')?.branchId).toBe(BR2.id);
    expect(byTitle.get('Nome profissional')?.branchId).toBeNull();
    for (const question of form.questions) expect(question.condition).toBeNull();
  });

  it('asks for no branch at all when the form has none: an unconditional form, as in Phase 12', () => {
    const form = previewForm([N1, P1], [T1, T3]);
    expect(form.branches).toEqual([]);
    expect(form.questions.every((question) => question.branchId === null)).toBe(true);
  });

  it('does not hand over an archived branch: its questions read as unconditional, as in the Lista', () => {
    const gone = { ...BR1, archivedAt: '2026-11-01T10:00:00.000Z' };
    const form = previewForm([O1, CN], [T1], [gone]);
    expect(form.branches).toEqual([]);
    expect(form.questions.find((question) => question.id === CN.id)?.branchId).toBeNull();
  });
});

describe('12.2-19 Task 3: ticking an opener opens the whole block, through the chain (D-651, UI-D-678)', () => {
  it('opens ONE wrapper with every question of the branch when the opener is ticked', async () => {
    open([O1, N1, CN], [T1], vi.fn(), [BR1]);
    expect(document.querySelector('[data-revealed-branch]')).toBeNull();
    expect(screen.queryByLabelText('Nome da clínica')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    const blocks = document.querySelectorAll('[data-revealed-branch]');
    expect(blocks).toHaveLength(1);
    expect(within(blocks[0] as HTMLElement).getByLabelText('Nome da clínica')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    await waitFor(() => expect(document.querySelector('[data-revealed-branch]')).toBeNull());
  });

  it('opens the nested block inside the first one when the nested opener is answered', () => {
    const one = adminStep({ title: 'Única', questionCount: 4 });
    const o = adminQuestion('single_choice', {
      title: 'Você tem clínica?',
      stepId: one.id,
      options: [OWN, WORK, LEARN],
    });
    const b1 = adminBranch({ openerQuestionId: o.id, values: [OWN.id], questionCount: 2 });
    const y = adminQuestion('yes_no', {
      title: 'A clínica tem equipe?',
      stepId: one.id,
      branchId: b1.id,
    });
    const b2 = adminBranch({ openerQuestionId: y.id, values: ['true'], questionCount: 1 });
    const team = adminQuestion('number', {
      title: 'Quantas pessoas?',
      stepId: one.id,
      branchId: b2.id,
    });
    open([o, y, team], [one], vi.fn(), [b1, b2]);
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect(document.querySelectorAll('[data-revealed-branch]')).toHaveLength(1);
    expect(screen.queryByLabelText('Quantas pessoas?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sim' }));
    const blocks = document.querySelectorAll('[data-revealed-branch]');
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as HTMLElement).contains(blocks[1] as HTMLElement)).toBe(true);
    expect(within(blocks[1] as HTMLElement).getByLabelText('Quantas pessoas?')).toBeTruthy();
  });

  it('counts steps and questions through the branch chain, and the chain closes with its opener', () => {
    openNested();
    expect(status().textContent).toBe(summary('2 etapas', '3 perguntas'));
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect(status().textContent).toBe(summary('3 etapas', '5 perguntas'));
    expect(eyebrow()).toBe('Etapa 1 de 3');
    advance();
    expect(screen.getByRole('heading', { level: 2, name: 'Equipe' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sim' }));
    expect(status().textContent).toBe(summary('3 etapas', '6 perguntas'));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Estou aprendendo' }));
    // Y is still answered "Sim" in the draft, but it sits in a closed branch: the whole chain is closed.
    expect(status().textContent).toBe(summary('2 etapas', '3 perguntas'));
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('the status line equals what the shared visibility function returns for the same answers', () => {
    openNested();
    const form = previewForm(NESTED, NESTED_STEPS, NESTED_BRANCHES);
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const expected = (drafts: Answers) =>
      summary(
        plural(stepPath(form, drafts, 'first').length, 'etapa', 'etapas'),
        plural(visibleQuestionIds(form, drafts).size, 'pergunta', 'perguntas'),
      );
    expect(status().textContent).toBe(expected({}));
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect(status().textContent).toBe(expected({ [O1.id]: choice(OWN.id) }));
    advance();
    fireEvent.click(screen.getByRole('button', { name: 'Sim' }));
    expect(status().textContent).toBe(expected({ [O1.id]: choice(OWN.id), [Y.id]: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Trabalho em uma clínica' }));
    expect(status().textContent).toBe(expected({ [O1.id]: choice(WORK.id), [Y.id]: true }));
  });

  it('Recomeçar clears every answer and closes the blocks', async () => {
    openNested();
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    expect(document.querySelectorAll('[data-revealed-branch]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Recomeçar' }));
    await waitFor(() => expect(document.querySelector('[data-revealed-branch]')).toBeNull());
    expect(status().textContent).toBe(summary('2 etapas', '3 perguntas'));
    expect(
      (screen.getByRole('radio', { name: 'Tenho uma clínica' }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('shows no branch name in the sheet, the block or the announcements', () => {
    openNested();
    fireEvent.click(screen.getByRole('radio', { name: 'Tenho uma clínica' }));
    advance();
    fireEvent.click(screen.getByRole('button', { name: 'Sim' }));
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Quem tem clínica');
    expect(text).not.toContain('Clínica com equipe');
    const live = Array.from(document.querySelectorAll('[aria-live]')).map((el) => el.textContent);
    for (const line of live) expect(line ?? '').not.toMatch(/Quem tem clínica|Clínica com equipe/);
  });
});

describe('12.2-19 Task 3: the source of the preview no longer reads the retired condition', () => {
  it('names no per-question condition except the null the member shape still requires', () => {
    const source = readFileSync(join(__dirname, 'PreviewSheet.tsx'), 'utf8');
    const hits = source.split('\n').filter((line) => /condition/.test(line));
    // The member question still has a `condition` key (null) until plan 20 removes the deprecated shape.
    expect(hits.filter((line) => !/^\s*(\*|\/\/|condition: null)/.test(line))).toEqual([]);
  });
});
