// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { adminBranch } from '@/lib/profile-form/test-fixtures';
import { BranchBlock, type BranchBlockProps } from './BranchBlock';

/**
 * 12.2-15 Task 1 (D-640, D-642, UI-D-666, UI-D-682..684): the block of one branch in the Lista against the REAL
 * catalog: the rail, the strip (label, optional name with the answers beneath, count, the cross-step line, the
 * pencil), the rows slot named by the strip, the empty line and the footer. The tree and the rows around it
 * are tested through the list in `builder.test.tsx`.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));
afterEach(cleanup);

const SENTENCE = 'Se “Você tem clínica?” for “Tenho”';

function block(props: Partial<BranchBlockProps> = {}, rows: React.ReactNode = <li>linha</li>) {
  const branch = props.branch ?? adminBranch();
  const all: BranchBlockProps = {
    branch,
    parts: { label: SENTENCE, sentence: SENTENCE, name: null },
    count: 2,
    empty: false,
    openerStepTitle: null,
    reordering: false,
    busy: false,
    place: null,
    addDisabled: false,
    focusKey: `branch:${branch.id}`,
    register: vi.fn(),
    onMove: vi.fn(),
    ...props,
  };
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <BranchBlock {...all}>{rows}</BranchBlock>
    </NextIntlClientProvider>,
  );
}

const strip = (container: HTMLElement) => container.querySelector('[data-branch-strip]');

describe('the rail and the rows slot (UI-D-666, UI-D-682)', () => {
  it('is the rail of the contract: ml-1 border-l-2 border-border-secondary pl-3, a flex column of gap-3', () => {
    const { container } = block();
    const rail = container.firstElementChild as HTMLElement;
    expect(rail.className).toContain(
      'flex flex-col gap-3 ml-1 border-l-2 border-border-secondary pl-3',
    );
  });

  it('holds the strip, the rows and the footer in that order', () => {
    const { container } = block({ onAddQuestion: vi.fn() });
    const rail = container.firstElementChild as HTMLElement;
    const kids = Array.from(rail.children).map((el) => el.tagName);
    expect(kids).toEqual(['DIV', 'UL', 'DIV']);
    expect(strip(container)).toBe(rail.children[0]);
  });

  it('names the rows list by its strip: aria-labelledby points at the label', () => {
    const { container } = block();
    const list = container.querySelector('ul') as HTMLElement;
    const labelledBy = list.getAttribute('aria-labelledby') ?? '';
    expect(labelledBy).not.toBe('');
    const target = document.getElementById(labelledBy);
    expect(target?.textContent).toBe(SENTENCE);
    expect(list.getAttribute('aria-label')).toBeNull();
    expect(within(list).getByText('linha')).toBeTruthy();
  });
});

describe('the strip (UI-D-666)', () => {
  it('a branch with no name: the sentence is line 1 and there is no second line', () => {
    const { container } = block();
    const lines = strip(container)?.querySelectorAll('.line-clamp-2') ?? [];
    expect(lines).toHaveLength(1);
    expect(lines[0]?.textContent).toBe(SENTENCE);
    expect(lines[0]?.className).toContain('font-bold');
    expect(lines[0]?.className).toContain('text-text-secondary');
    expect(lines[0]?.textContent?.endsWith('.')).toBe(false);
  });

  it('a branch with a name: the name is line 1 and the same sentence is line 2, so the answers stay', () => {
    const { container } = block({
      parts: { label: 'Quem tem clínica', sentence: SENTENCE, name: 'Quem tem clínica' },
    });
    const lines = Array.from(strip(container)?.querySelectorAll('.line-clamp-2') ?? []);
    expect(lines.map((line) => line.textContent)).toEqual(['Quem tem clínica', SENTENCE]);
    expect(lines[0]?.className).toContain('font-bold');
    expect(lines[1]?.className).toContain('font-normal');
    expect(lines[1]?.className).toContain('text-text-tertiary');
  });

  it('wraps a very long label inside two lines and renders a hostile name as text, never as markup', () => {
    const hostile = `<b>x</b> ${'ramo'.repeat(30)}`;
    const { container } = block({ parts: { label: hostile, sentence: SENTENCE, name: hostile } });
    const label = strip(container)?.querySelector('.line-clamp-2') as HTMLElement;
    expect(label.className).toContain('break-words');
    expect(label.textContent).toBe(hostile);
    expect(label.querySelector('b')).toBeNull();
  });

  it('says how many questions it holds, as an ICU plural', () => {
    block({ count: 0, empty: true });
    expect(screen.getByText('Sem perguntas')).toBeTruthy();
    cleanup();
    block({ count: 1 });
    expect(screen.getByText('1 pergunta')).toBeTruthy();
    cleanup();
    block({ count: 3 });
    expect(screen.getByText('3 perguntas')).toBeTruthy();
  });

  it('says where the deciding question is only when it sits in another step', () => {
    block({ openerStepTitle: 'Informações gerais' });
    expect(
      screen.getByText('A pergunta que decide está na etapa “Informações gerais”.'),
    ).toBeTruthy();
    cleanup();
    block();
    expect(screen.queryByText(/A pergunta que decide está na etapa/)).toBeNull();
  });

  it('has a 44px pencil named with the label that calls onEdit with the branch', () => {
    const onEdit = vi.fn();
    const branch = adminBranch();
    block({ branch, onEdit });
    const pencil = screen.getByRole('button', { name: `Editar ramo: ${SENTENCE}` });
    expect(pencil.className).toContain('min-h-[44px]');
    expect(pencil.className).toContain('min-w-[44px]');
    fireEvent.click(pencil);
    expect(onEdit).toHaveBeenCalledWith(branch);
  });

  it('has no pencil without onEdit, and none in reorder mode', () => {
    block();
    expect(screen.queryByRole('button', { name: /^Editar ramo/ })).toBeNull();
    cleanup();
    block({ onEdit: vi.fn(), reordering: true });
    expect(screen.queryByRole('button', { name: /^Editar ramo/ })).toBeNull();
  });
});

describe('the empty state and the footer (D-641, UI-D-666)', () => {
  it('an empty branch shows the line in place of rows: no list, no row', () => {
    const { container } = block({ empty: true, count: 0 }, null);
    expect(
      screen.getByText(
        'Este ramo está vazio. Ele só muda algo para os membros quando tiver uma pergunta.',
      ),
    ).toBeTruthy();
    expect(container.querySelector('ul')).toBeNull();
    expect(container.querySelectorAll('li')).toHaveLength(0);
    const line = container.querySelector('[data-branch-empty]') as HTMLElement;
    expect(line.className).toContain('text-text-tertiary');
    expect(line.querySelector('svg')).toBeTruthy();
  });

  it('shows the footer only when the list gives it a handler, named with the label', () => {
    block();
    expect(screen.queryByRole('button', { name: /^Adicionar pergunta ao ramo/ })).toBeNull();
    cleanup();
    const onAdd = vi.fn();
    block({ onAddQuestion: onAdd });
    const footer = screen.getByRole('button', { name: `Adicionar pergunta ao ramo: ${SENTENCE}` });
    expect(footer.textContent).toBe('Adicionar pergunta ao ramo');
    fireEvent.click(footer);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('disables the footer at the question limit', () => {
    block({ onAddQuestion: vi.fn(), addDisabled: true });
    const footer = screen.getByRole('button', { name: /^Adicionar pergunta ao ramo:/ });
    expect((footer as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the floor (UI-D-682..684)', () => {
  it('writes no half-step spacing class and no hard-coded colour in the block', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/(app)/configuracoes/formulario-de-perfil/BranchBlock.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/(^|[^a-z])(gap|p|m|px|py|mt|mb|ml|mr)-(0\.5|1\.5|2\.5|3\.5)/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toContain('dangerouslySetInnerHTML');
  });
});
