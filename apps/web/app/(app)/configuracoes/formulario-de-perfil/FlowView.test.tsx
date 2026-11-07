// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { buildBranchTree } from '@/lib/profile-form/branch-tree';
import {
  type adminBranch,
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
