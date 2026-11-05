// @vitest-environment happy-dom

import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { adminStep } from '@/lib/profile-form/test-fixtures';
import { StepWell, type StepWellProps } from './StepWell';

/**
 * 12.1-16 (D-627, UI-D-643, UI-D-646; PFORM-37): the step well on its own, against the REAL catalog. The
 * header, the meta plural, the rename button, the reorder arrows, the empty step and the footer button.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

function show(overrides: Partial<StepWellProps> = {}) {
  const props: StepWellProps = {
    step: adminStep({ title: 'Sobre a sua clínica' }),
    number: 2,
    total: 3,
    count: 2,
    reordering: false,
    busy: false,
    addDisabled: false,
    onRename: vi.fn(),
    onAddQuestion: vi.fn(),
    onMove: vi.fn(),
    register: vi.fn(),
    ...overrides,
  };
  const view = render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <StepWell {...props}>
        <ul>
          <li>linha</li>
        </ul>
      </StepWell>
    </NextIntlClientProvider>,
  );
  return { props, ...view };
}

afterEach(cleanup);

describe('StepWell: the geometry of UI-D-643', () => {
  it('is a tinted section labelled by its title, with the eyebrow, the title and the meta line', () => {
    show();
    const well = screen.getByRole('region', { name: 'Sobre a sua clínica' });
    expect(well.tagName).toBe('SECTION');
    expect(well.className).toContain('bg-bg-tertiary');
    expect(well.className).toContain('rounded-xl');
    expect(well.className).toContain('p-3');
    expect(within(well).getByText('Etapa 2')).toBeTruthy();
    const title = within(well).getByRole('heading', { name: 'Sobre a sua clínica' });
    expect(title.className).toContain('break-words');
    expect(title.className).toContain('line-clamp-2');
    expect(within(well).getByText('2 perguntas')).toBeTruthy();
  });

  it('pluralises the meta line: none, one, many', () => {
    for (const [count, text] of [
      [0, 'Sem perguntas'],
      [1, '1 pergunta'],
      [5, '5 perguntas'],
    ] as const) {
      show({ count });
      expect(screen.getByText(text)).toBeTruthy();
      cleanup();
    }
  });

  it('renders the title as text, never as markup (T-12.1-12)', () => {
    show({ step: adminStep({ title: '<img src=x onerror=alert(1)>' }) });
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('StepWell: the header buttons', () => {
  it('shows the 44px rename button outside reorder mode and calls onRename with the step', () => {
    const { props } = show();
    const rename = screen.getByRole('button', { name: 'Renomear etapa: Sobre a sua clínica' });
    expect(rename.className).toContain('min-h-[44px]');
    expect(rename.className).toContain('min-w-[44px]');
    fireEvent.click(rename);
    expect(props.onRename).toHaveBeenCalledWith(props.step);
    expect(screen.queryByRole('button', { name: /^Subir etapa/ })).toBeNull();
  });

  it('swaps the rename button for the two arrows in reorder mode', () => {
    const { props } = show({ reordering: true });
    expect(screen.queryByRole('button', { name: /^Renomear etapa/ })).toBeNull();
    const up = screen.getByRole('button', { name: 'Subir etapa “Sobre a sua clínica”' });
    const down = screen.getByRole('button', { name: 'Descer etapa “Sobre a sua clínica”' });
    expect(up.className).toContain('min-h-[44px]');
    expect(down.className).toContain('min-w-[44px]');
    fireEvent.click(down);
    expect(props.onMove).toHaveBeenCalledWith(props.step.id, 1);
    fireEvent.click(up);
    expect(props.onMove).toHaveBeenCalledWith(props.step.id, -1);
  });

  it('PFORM-37 adjacency: the up arrow is disabled on the first step and the down arrow on the last', () => {
    show({ reordering: true, number: 1, total: 3 });
    expect(
      (screen.getByRole('button', { name: /^Subir etapa/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: /^Descer etapa/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
    cleanup();
    show({ reordering: true, number: 3, total: 3 });
    expect(
      (screen.getByRole('button', { name: /^Descer etapa/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    cleanup();
    // a form with a single step has both disabled
    show({ reordering: true, number: 1, total: 1 });
    expect(
      (screen.getByRole('button', { name: /^Subir etapa/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: /^Descer etapa/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('marks the arrows busy while a write runs, without disabling them', () => {
    show({ reordering: true, busy: true, number: 2, total: 3 });
    const up = screen.getByRole('button', { name: /^Subir etapa/ });
    expect(up.getAttribute('aria-busy')).toBe('true');
    expect((up as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('StepWell: the rows slot, the empty step and the footer', () => {
  it('renders the rows it is given and no empty line when the step holds questions', () => {
    show();
    expect(screen.getByText('linha')).toBeTruthy();
    expect(document.querySelector('[data-step-empty]')).toBeNull();
  });

  it('PFORM-37 empty: an empty step shows its line and the footer button, and is not collapsed', () => {
    show({ count: 0 });
    expect(screen.queryByText('linha')).toBeNull();
    const line = document.querySelector('[data-step-empty]') as HTMLElement;
    expect(line.textContent).toBe(
      'Esta etapa está vazia. Enquanto estiver vazia, os membros não a veem.',
    );
    expect(screen.getByText('Sem perguntas')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Adicionar pergunta à etapa:/ })).toBeTruthy();
  });

  it('opens the editor for THIS step from the ghost footer, named after the step', () => {
    const { props } = show();
    const add = screen.getByRole('button', {
      name: 'Adicionar pergunta à etapa: Sobre a sua clínica',
    });
    expect(add.textContent).toBe('Adicionar pergunta');
    fireEvent.click(add);
    expect(props.onAddQuestion).toHaveBeenCalledWith(props.step);
  });

  it('disables the footer button at the question limit', () => {
    show({ addDisabled: true });
    expect(
      (screen.getByRole('button', { name: /^Adicionar pergunta à etapa:/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('writes no spacing class with a half step in the well markup', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(join(__dirname, 'StepWell.tsx'), 'utf8');
    expect(source).not.toMatch(/(^|[^a-z])(gap|p|m|px|py|mt|mb|ml|mr)-(0\.5|1\.5|2\.5|3\.5)/);
  });
});
