// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { buildBranchTree } from '@/lib/profile-form/branch-tree';
import {
  adminBranch,
  adminQuestion,
  adminStep,
  clinicAdminList,
  clinicId,
  uuid,
} from '@/lib/profile-form/test-fixtures';
import { FlowView } from './FlowView';

/**
 * 12.2-19 (D-647, D-648, D-649; UI-D-676, UI-D-677, UI-D-682, UI-D-684; PFORM-58): the Fluxo, the read-only
 * vertical tree by branch, against the REAL catalog and the real tree. Nothing is stubbed: the view takes the
 * tree and two callbacks and issues no request of its own, so the tests also pin that.
 * The pixel reading at 390px and 320px is plan 21's Playwright backstop; here the structure, the classes and
 * the text are asserted.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

type Draw = {
  questions: ReturnType<typeof adminQuestion>[];
  steps: ReturnType<typeof adminStep>[];
  branches: ReturnType<typeof adminBranch>[];
};

function draw(input: Draw) {
  const onOpenQuestion = vi.fn();
  const onOpenBranch = vi.fn();
  const tree = buildBranchTree(input);
  const element = (next: AdminBranchTreeInput) => (
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <FlowView
        tree={next.tree}
        steps={next.steps}
        onOpenQuestion={onOpenQuestion}
        onOpenBranch={onOpenBranch}
      />
    </NextIntlClientProvider>
  );
  const view = render(element({ tree, steps: input.steps }));
  return {
    ...view,
    onOpenQuestion,
    onOpenBranch,
    again: (next: Draw) =>
      view.rerender(element({ tree: buildBranchTree(next), steps: next.steps })),
  };
}
type AdminBranchTreeInput = { tree: ReturnType<typeof buildBranchTree>; steps: Draw['steps'] };

function clinic(): Draw {
  const list = clinicAdminList();
  return { questions: list.questions, steps: list.steps, branches: list.branches ?? [] };
}

const node = (title: string) => screen.getByRole('button', { name: `Editar pergunta: ${title}` });
const Q1 = 'Você tem clínica, trabalha em clínica ou está aprendendo?';

afterEach(() => cleanup());

describe('12.2-19 Task 1: the Fluxo is a read-only vertical tree by branch (D-649, UI-D-676, UI-D-682)', () => {
  it('is a section named by an sr-only h3, with the note and the eyebrow on top', () => {
    draw(clinic());
    const section = screen.getByRole('region', { name: 'Fluxo do formulário' });
    expect(section.tagName).toBe('SECTION');
    const heading = within(section).getByRole('heading', { level: 3, name: 'Fluxo do formulário' });
    expect(heading.className).toContain('sr-only');
    expect(
      within(section).getByText(
        'O Fluxo mostra quem vê cada pergunta. Toque numa pergunta ou num ramo para editar. Para mover perguntas, volte para a Lista.',
      ),
    ).toBeTruthy();
    expect(within(section).getByText('Todos os membros veem')).toBeTruthy();
  });

  it('draws the root questions, the edges under their opener and the questions under each edge', () => {
    draw(clinic());
    expect(node(Q1)).toBeTruthy();
    expect(node('A clínica tem equipe?')).toBeTruthy();
    expect(node('Nome da clínica')).toBeTruthy();
    expect(node('Quantos profissionais?')).toBeTruthy();
    expect(node('Tem sócio?')).toBeTruthy();
    expect(node('Nome do sócio')).toBeTruthy();
    expect(node('Onde estuda?')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Se for “Tenho uma clínica” · 2 perguntas' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Se for “Estou aprendendo” · 1 pergunta' }),
    ).toBeTruthy();
    // Two yes/no edges: the plain word Sim, never quoted.
    expect(screen.getAllByRole('button', { name: /^Se for Sim · \d+ perguntas?$/ })).toHaveLength(
      2,
    );
  });

  it('puts the edges of an opener right under it, in the rail of its level', () => {
    draw(clinic());
    const q1 = node(Q1).closest('li') as HTMLElement;
    const edge = within(q1).getByRole('button', {
      name: 'Se for “Tenho uma clínica” · 2 perguntas',
    });
    const rail = edge.parentElement as HTMLElement;
    expect(rail.className).toContain('ml-1');
    expect(rail.className).toContain('border-l-2');
    expect(rail.className).toContain('border-border-secondary');
    expect(rail.className).toContain('pl-3');
    // The root questions sit on the page ground: no rail around the root list.
    const roots = node(Q1).closest('ul') as HTMLElement;
    expect(roots.parentElement?.className ?? '').not.toContain('border-l-2');
  });

  it('names every child list "Perguntas do ramo: {label}" with the label of the branch', () => {
    draw(clinic());
    const lists = screen.getAllByRole('list').map((list) => list.getAttribute('aria-label'));
    expect(lists).toContain(
      'Perguntas do ramo: Se “Você tem clínica, trabalha em clínica ou está aprendendo?” for “Tenho uma clínica”',
    );
    expect(lists).toContain('Perguntas do ramo: Se “A clínica tem equipe?” for Sim');
  });

  it('every node and every edge is a native button of 44px, and no ARIA tree role exists', () => {
    const { container } = draw(clinic());
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(7 + 4);
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('w-full');
    }
    expect(container.querySelector('[role="tree"], [role="treeitem"], [role="group"]')).toBeNull();
    const source = readFileSync(join(__dirname, 'FlowView.tsx'), 'utf8');
    expect(source).not.toMatch(/role="tree"|role="treeitem"/);
  });

  it('a node tap hands over the question and the element that was tapped', () => {
    const { onOpenQuestion, onOpenBranch } = draw(clinic());
    fireEvent.click(node('Nome da clínica'));
    expect(onOpenQuestion).toHaveBeenCalledTimes(1);
    const [question, trigger] = onOpenQuestion.mock.calls[0] as [{ id: string }, HTMLElement];
    expect(question.id).toBe(clinicId('Q3'));
    expect(trigger).toBe(node('Nome da clínica'));
    expect(onOpenBranch).not.toHaveBeenCalled();
  });

  it('an edge tap hands over the branch and the element that was tapped', () => {
    const { onOpenQuestion, onOpenBranch } = draw(clinic());
    const edge = screen.getByRole('button', { name: 'Se for “Estou aprendendo” · 1 pergunta' });
    fireEvent.click(edge);
    expect(onOpenBranch).toHaveBeenCalledTimes(1);
    const [branch, trigger] = onOpenBranch.mock.calls[0] as [{ id: string }, HTMLElement];
    expect(branch.id).toBe(clinicId('B4'));
    expect(trigger).toBe(edge);
    expect(onOpenQuestion).not.toHaveBeenCalled();
  });

  it('issues no write of its own: the source has no router, fetch or action', () => {
    const source = readFileSync(join(__dirname, 'FlowView.tsx'), 'utf8');
    expect(source).not.toMatch(/useRouter|fetch\(|Action\(|dangerouslySetInnerHTML/);
  });

  it('shows a branch name on the first line of its edge and the answers below it', () => {
    const list = clinic();
    const named = list.branches.map((branch) =>
      branch.id === clinicId('B1') ? { ...branch, name: 'Quem tem clínica' } : branch,
    );
    draw({ ...list, branches: named });
    const edge = screen.getByRole('button', {
      name: 'Quem tem clínica Se for “Tenho uma clínica” · 2 perguntas',
    });
    expect(within(edge).getByText('Quem tem clínica').className).toContain('font-bold');
    expect(
      screen
        .getAllByRole('list')
        .map((item) => item.getAttribute('aria-label'))
        .includes('Perguntas do ramo: Quem tem clínica'),
    ).toBe(true);
  });

  it('draws one root and no edge for a form with a question and no branch', () => {
    const only = adminQuestion('short_text', { title: 'Cargo', stepId: uuid(7001) });
    draw({ questions: [only], steps: [adminStep({ id: uuid(7001) })], branches: [] });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByText(/Se for/)).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* 12.2-19 Task 2: every state of the drawing, from the one tree (D-649, UI-D-676, UI-D-677).         */
/* ------------------------------------------------------------------------------------------------ */

/** A choice opener with `count` options named "Opção 1".."Opção N", in one step. */
function opener(stepId: string, count: number, overrides = {}) {
  const options = Array.from({ length: count }, (_, at) => ({
    id: uuid(8100 + at),
    label: `Opção ${at + 1}`,
    answerCount: 0,
  }));
  return {
    options,
    question: adminQuestion('single_choice', {
      title: 'Qual opção?',
      stepId,
      options,
      opensCount: 1,
      ...overrides,
    }),
  };
}

const rails = (element: HTMLElement) => {
  let count = 0;
  for (let at = element.parentElement; at; at = at.parentElement) {
    if (at.className?.toString().includes('border-l-2')) count += 1;
  }
  return count;
};

describe('12.2-19 Task 2: the nodes say the type, whether it is required, and "No perfil" (UI-D-676)', () => {
  it('line 2 reads the type name, Obrigatória or Opcional and, when public, No perfil', () => {
    const step = adminStep();
    const a = adminQuestion('short_text', {
      title: 'Nome',
      stepId: step.id,
      required: true,
      showOnProfile: true,
    });
    const b = adminQuestion('single_choice', { title: 'Origem', stepId: step.id });
    draw({ questions: [a, b], steps: [step], branches: [] });
    const first = node('Nome');
    expect(
      document.getElementById(first.getAttribute('aria-describedby') as string)?.textContent,
    ).toBe('Texto curto·Obrigatória·No perfil');
    const second = node('Origem');
    expect(
      document.getElementById(second.getAttribute('aria-describedby') as string)?.textContent,
    ).toBe('Escolha única·Opcional');
  });

  it('has no number badge on a node and a trailing chevron only', () => {
    draw(clinic());
    const q1 = node(Q1);
    expect(q1.querySelectorAll('svg')).toHaveLength(1);
    expect(q1.textContent).not.toMatch(/^\d/);
  });
});

describe('12.2-19 Task 2: steps are not headings, the pill is the only step cue (D-643, UI-D-676)', () => {
  const s1 = adminStep({ title: 'Geral' });
  const s2 = adminStep({ title: 'Clínica' });
  const s3 = adminStep({ title: 'Contato' });
  const { question: o, options } = opener(s1.id, 2);
  const inBranch = adminBranch({ openerQuestionId: o.id, values: [options[0]?.id as string] });
  const c = adminQuestion('short_text', {
    title: 'Nome da clínica',
    stepId: s2.id,
    branchId: inBranch.id,
  });
  const d = adminQuestion('phone', { title: 'Telefone', stepId: s3.id });
  const form = (): Draw => ({
    questions: [o, c, d],
    steps: [s1, s2, s3],
    branches: [{ ...inBranch, questionCount: 1 }],
  });

  it('shows "Etapa {n}" on every node with three steps, the branch question in its own step', () => {
    draw(form());
    expect(within(node('Qual opção?')).getByText('Etapa 1')).toBeTruthy();
    expect(within(node('Nome da clínica')).getByText('Etapa 2')).toBeTruthy();
    expect(within(node('Telefone')).getByText('Etapa 3')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Geral|Clínica|Contato/ })).toBeNull();
    expect(screen.queryByText('Geral')).toBeNull();
  });

  it('shows no pill with one step or with none', () => {
    const single = adminStep();
    const q = adminQuestion('short_text', { title: 'Cargo', stepId: single.id });
    draw({ questions: [q], steps: [single], branches: [] });
    expect(screen.queryByText(/^Etapa \d+$/)).toBeNull();
    cleanup();
    const lone = adminQuestion('short_text', { title: 'Cargo' });
    draw({ questions: [lone], steps: [], branches: [] });
    expect(screen.queryByText(/^Etapa \d+$/)).toBeNull();
    expect(node('Cargo')).toBeTruthy();
  });
});

describe('12.2-19 Task 2: several branches of one opener, an empty branch and archived ones (D-649)', () => {
  const step = adminStep();
  const { question: o, options } = opener(step.id, 3);
  const [a, b, c] = options as unknown as [{ id: string }, { id: string }, { id: string }];

  it('draws the edges of an opener one after the other, in the order members meet them', () => {
    const bB = adminBranch({ openerQuestionId: o.id, values: [b.id], name: 'Segundo' });
    const bA = adminBranch({ openerQuestionId: o.id, values: [a.id], name: 'Primeiro' });
    const qA = adminQuestion('short_text', {
      title: 'Da primeira',
      stepId: step.id,
      branchId: bA.id,
    });
    const qB = adminQuestion('short_text', {
      title: 'Da segunda',
      stepId: step.id,
      branchId: bB.id,
    });
    // Stored order puts bA's question first, so bA is the first edge although it is the second branch in the list.
    draw({
      questions: [o, qA, qB],
      steps: [step],
      branches: [
        { ...bB, questionCount: 1 },
        { ...bA, questionCount: 1 },
      ],
    });
    const edges = within(node('Qual opção?').closest('li') as HTMLElement)
      .getAllByRole('button')
      .filter((button) => /^(Primeiro|Segundo)/.test(button.textContent ?? ''))
      .map((button) => button.textContent);
    expect(edges).toEqual([
      'Primeiro Se for “Opção 1” · 1 pergunta',
      'Segundo Se for “Opção 2” · 1 pergunta',
    ]);
  });

  it('answers of different branches may overlap: both edges name the shared answer', () => {
    const one = adminBranch({ openerQuestionId: o.id, values: [a.id, b.id] });
    const two = adminBranch({ openerQuestionId: o.id, values: [b.id, c.id] });
    const q1 = adminQuestion('short_text', { title: 'Um', stepId: step.id, branchId: one.id });
    const q2 = adminQuestion('short_text', { title: 'Dois', stepId: step.id, branchId: two.id });
    draw({ questions: [o, q1, q2], steps: [step], branches: [one, two] });
    expect(
      screen.getByRole('button', { name: 'Se for “Opção 1” ou “Opção 2” · 1 pergunta' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Se for “Opção 2” ou “Opção 3” · 1 pergunta' }),
    ).toBeTruthy();
  });

  it('an empty branch is an edge reading "sem perguntas" with no list of children', () => {
    const empty = adminBranch({ openerQuestionId: o.id, values: [a.id], questionCount: 0 });
    draw({ questions: [o], steps: [step], branches: [empty] });
    const edge = screen.getByRole('button', { name: 'Se for “Opção 1” · sem perguntas' });
    expect(edge.parentElement?.querySelector('ul')).toBeNull();
    expect(screen.queryAllByRole('list', { name: /Perguntas do ramo/ })).toHaveLength(0);
  });

  it('a branch whose questions are all archived reads like an empty one, whatever the server count says', () => {
    const gone = adminBranch({ openerQuestionId: o.id, values: [b.id], questionCount: 3 });
    draw({ questions: [o], steps: [step], branches: [gone] });
    expect(screen.getByRole('button', { name: 'Se for “Opção 2” · sem perguntas' })).toBeTruthy();
  });

  it('draws neither an archived branch nor a question outside the active list; its questions are roots', () => {
    const archived = adminBranch({
      openerQuestionId: o.id,
      values: [a.id],
      archivedAt: '2026-11-01T10:00:00.000Z',
    });
    const orphan = adminQuestion('short_text', {
      title: 'Solta',
      stepId: step.id,
      branchId: archived.id,
    });
    draw({ questions: [o, orphan], steps: [step], branches: [archived] });
    expect(screen.queryByText(/Se for/)).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Editar pergunta: Pergunta arquivada' }),
    ).toBeNull();
    expect(rails(node('Solta'))).toBe(0);
  });

  it('falls back to the count alone when the opener no longer names any option of the branch', () => {
    const stale = adminBranch({ openerQuestionId: o.id, values: [uuid(7999)], questionCount: 1 });
    const q = adminQuestion('short_text', { title: 'Filha', stepId: step.id, branchId: stale.id });
    draw({ questions: [o, q], steps: [step], branches: [stale] });
    expect(screen.queryByText(/^Se for/)).toBeNull();
    expect(screen.getByText('1 pergunta')).toBeTruthy();
  });
});

describe('12.2-19 Task 2: the answers are capped at four, then "e mais N" (UI-D-676, frame fluxo-longo)', () => {
  const step = adminStep();

  function edgeFor(optionCount: number, picked: number) {
    const { question: o, options } = opener(step.id, optionCount);
    const br = adminBranch({
      openerQuestionId: o.id,
      values: options.slice(0, picked).map((option) => option.id),
    });
    const q = adminQuestion('short_text', { title: 'Filha', stepId: step.id, branchId: br.id });
    draw({ questions: [o, q], steps: [step], branches: [{ ...br, questionCount: 1 }] });
    return screen.getAllByRole('button').find((button) => /^Se for/.test(button.textContent ?? ''));
  }

  it('20 answers show exactly 4 quoted and "e mais 16"', () => {
    const edge = edgeFor(20, 20);
    expect(edge?.textContent).toBe(
      'Se for “Opção 1”, “Opção 2”, “Opção 3”, “Opção 4” e mais 16 · 1 pergunta',
    );
    expect(edge?.textContent?.match(/“/g)).toHaveLength(4);
  });

  it('exactly 4 answers keep the pt-BR disjunction, and 5 show 4 and "e mais 1"', () => {
    expect(edgeFor(5, 4)?.textContent).toBe(
      'Se for “Opção 1”, “Opção 2”, “Opção 3” ou “Opção 4” · 1 pergunta',
    );
    cleanup();
    expect(edgeFor(6, 5)?.textContent).toBe(
      'Se for “Opção 1”, “Opção 2”, “Opção 3”, “Opção 4” e mais 1 · 1 pergunta',
    );
  });

  it('yes/no edges say the plain words Sim, Não or Sim ou Não, never quoted', () => {
    const yn = adminQuestion('yes_no', { title: 'Tem equipe?', stepId: step.id });
    const both = adminBranch({ openerQuestionId: yn.id, values: ['true', 'false'] });
    const q = adminQuestion('short_text', { title: 'Filha', stepId: step.id, branchId: both.id });
    draw({ questions: [yn, q], steps: [step], branches: [{ ...both, questionCount: 1 }] });
    expect(screen.getByRole('button', { name: 'Se for Sim ou Não · 1 pergunta' })).toBeTruthy();
    cleanup();
    const no = adminBranch({ openerQuestionId: yn.id, values: ['false'] });
    const q2 = adminQuestion('short_text', { title: 'Filha', stepId: step.id, branchId: no.id });
    draw({ questions: [yn, q2], steps: [step], branches: [{ ...no, questionCount: 1 }] });
    expect(screen.getByRole('button', { name: 'Se for Não · 1 pergunta' })).toBeTruthy();
  });
});

describe('12.2-19 Task 2: three levels, long text, the ceiling and the floor (UI-D-677, UI-D-684)', () => {
  it('draws three rails on the path to the deepest question, and one level uses the same node', () => {
    draw(clinic());
    expect(rails(node('Nome do sócio'))).toBe(3);
    expect(rails(node('Quantos profissionais?'))).toBe(2);
    expect(rails(node('Nome da clínica'))).toBe(1);
    expect(rails(node(Q1))).toBe(0);
    const deep = node('Nome do sócio');
    const top = node('Nome da clínica');
    expect(deep.className).toBe(top.className);
  });

  it('clamps a very long title to two lines, wraps an edge in full and names a 60-character branch', () => {
    const step = adminStep();
    const { question: o, options } = opener(step.id, 2);
    const long = 'Descreva com o máximo de detalhes como é o seu dia a dia de atendimento '.repeat(
      5,
    );
    const name = 'Atendimento nas capitais e grandes centros urbanos do país todo';
    const br = adminBranch({ openerQuestionId: o.id, values: [options[0]?.id as string], name });
    const q = adminQuestion('long_text', { title: long, stepId: step.id, branchId: br.id });
    draw({ questions: [o, q], steps: [step], branches: [{ ...br, questionCount: 1 }] });
    const title = within(node(long.trim())).getByText(long.trim());
    expect(title.className).toContain('line-clamp-2');
    expect(title.className).toContain('break-words');
    const edge = screen.getByRole('button', { name: new RegExp(`^${name}`) });
    const sentence = within(edge).getByText(/^Se for/);
    expect(sentence.className).toContain('break-words');
    expect(sentence.className).not.toMatch(/truncate|line-clamp|whitespace-nowrap/);
    expect(within(edge).getByText(name).className).toContain('break-words');
  });

  it('never scrolls sideways and never uses a half-step spacing class', () => {
    const { container } = draw(clinic());
    expect(container.innerHTML).not.toMatch(/overflow-x-(auto|scroll)|whitespace-nowrap|truncate/);
    const classes = Array.from(container.querySelectorAll('[class]')).map((el) =>
      el.getAttribute('class'),
    );
    for (const value of classes) {
      expect(value).not.toMatch(/(^|[^a-z])(gap|p|m|px|py|mt|mb|ml|mr)-(0\.5|1\.5|2\.5|3\.5)/);
    }
    const source = readFileSync(join(__dirname, 'FlowView.tsx'), 'utf8');
    expect(source).not.toMatch(/overflow-x/);
    expect(source).not.toMatch(/(^|[^a-z])(gap|p|m|px|py|mt|mb|ml|mr)-(0\.5|1\.5|2\.5|3\.5)/);
  });

  it('draws the whole tree at the ceiling: 30 questions and 15 branches, no collapse', () => {
    const step = adminStep();
    const { question: o, options } = opener(step.id, 15);
    const branches: ReturnType<typeof adminBranch>[] = [];
    const questions = [o];
    for (let at = 0; at < 15; at += 1) {
      const br = adminBranch({
        openerQuestionId: o.id,
        values: [options[at]?.id as string],
        questionCount: 2,
      });
      branches.push(br);
      questions.push(
        adminQuestion('short_text', {
          title: `Ramo ${at + 1} A`,
          stepId: step.id,
          branchId: br.id,
        }),
        adminQuestion('short_text', {
          title: `Ramo ${at + 1} B`,
          stepId: step.id,
          branchId: br.id,
        }),
      );
    }
    draw({ questions, steps: [step], branches });
    expect(screen.getAllByRole('button', { name: /^Editar pergunta:/ })).toHaveLength(31);
    expect(screen.getAllByRole('button', { name: /^Se for/ })).toHaveLength(15);
    expect(screen.queryByRole('button', { name: /Expandir|Recolher/ })).toBeNull();
  });

  it('renders a hostile title, branch name and answer as text, never as markup', () => {
    const step = adminStep();
    const hostile = '<img src=x onerror="alert(1)">';
    const { question: base, options } = opener(step.id, 2);
    const o = {
      ...base,
      options: base.options.map((option, at) =>
        at === 0 ? { ...option, label: hostile } : option,
      ),
    };
    const br = adminBranch({
      openerQuestionId: o.id,
      values: [options[0]?.id as string],
      name: hostile,
    });
    const q = adminQuestion('short_text', { title: hostile, stepId: step.id, branchId: br.id });
    const { container } = draw({
      questions: [o, q],
      steps: [step],
      branches: [{ ...br, questionCount: 1 }],
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain(hostile);
  });

  it('draws the same output for the same tree twice', () => {
    const normalise = (html: string) => html.replace(/_r_[a-z0-9]+_/g, '_id_');
    const first = draw(clinic());
    const one = normalise(first.container.innerHTML);
    cleanup();
    const second = draw(clinic());
    expect(normalise(second.container.innerHTML)).toBe(one);
  });
});
