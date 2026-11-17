// @vitest-environment happy-dom

import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { CaseOpener, type CaseOpenerValue } from './CaseOpener';

/**
 * 12.4-12 Task 1 (UI-D-819, D-812, D-803; UC M03): the first-message opener. A CONTROLLED component:
 * the thread pane owns the two values and the composer's send closes over them, so the opener holds no
 * send logic of its own. The real pt-BR catalog runs through next-intl's own provider.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

afterEach(cleanup);

const CHIP_ORDER = ['Check-in', 'Eventos', 'Pagamento', 'Conta', 'Outro'];

function Harness({ onChange }: { onChange?: (next: CaseOpenerValue) => void }) {
  const [value, setValue] = useState<CaseOpenerValue>({ category: 'other' });
  return (
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <CaseOpener
        category={value.category}
        subject={value.subject}
        onChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
      />
    </NextIntlClientProvider>
  );
}

const pressed = () =>
  screen
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent);

describe('CaseOpener (UI-D-819)', () => {
  it('draws the caption, the five chips in their fixed order in a group named by the caption', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Sobre o que é?' });
    const chips = Array.from(group.querySelectorAll('button')).map((chip) => chip.textContent);
    expect(chips).toEqual(CHIP_ORDER);
    expect(screen.getByText('Sobre o que é?')).toBeTruthy();
  });

  it('preselects Outro, and exactly one chip is pressed after every interaction', () => {
    render(<Harness />);
    expect(pressed()).toEqual(['Outro']);

    fireEvent.click(screen.getByRole('button', { name: 'Pagamento' }));
    expect(pressed()).toEqual(['Pagamento']);

    fireEvent.click(screen.getByRole('button', { name: 'Check-in' }));
    expect(pressed()).toEqual(['Check-in']);
  });

  it('keeps the selection when the pressed chip is tapped again', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Conta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conta' }));
    expect(pressed()).toEqual(['Conta']);
  });

  it('reports a chip tap as the new pair, with the subject absent when empty', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Eventos' }));
    expect(onChange).toHaveBeenLastCalledWith({ category: 'events', subject: undefined });
  });

  it('reports typing as the new pair and drops the subject again when it is emptied', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('Assunto (opcional)') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Meu ingresso' } });
    expect(onChange).toHaveBeenLastCalledWith({ category: 'other', subject: 'Meu ingresso' });
    expect(input.value).toBe('Meu ingresso');

    // A chip tap after typing keeps the typed subject.
    fireEvent.click(screen.getByRole('button', { name: 'Pagamento' }));
    expect(onChange).toHaveBeenLastCalledWith({ category: 'payment', subject: 'Meu ingresso' });

    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ category: 'payment', subject: undefined });
  });

  it('draws the optional subject at 16px, capped at 80 characters, with no counter', () => {
    const { container } = render(<Harness />);
    const input = screen.getByLabelText('Assunto (opcional)') as HTMLInputElement;
    expect(input.maxLength).toBe(80);
    expect(input.placeholder).toBe('Resuma em uma frase');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.className).toContain('text-base');
    // No counter and no growth: the opener has no element reading a length.
    expect(container.textContent).not.toMatch(/\d+\s*\/\s*80/);
  });

  it('wraps the chips and never scrolls sideways', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Sobre o que é?' });
    expect(group.className).toContain('flex-wrap');
    expect(group.className).not.toContain('overflow-x-auto');
  });

  it('is the controlled value that shows: a parent value wins over local taps', () => {
    render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <CaseOpener category="account" subject="Já digitado" onChange={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(pressed()).toEqual(['Conta']);
    expect((screen.getByLabelText('Assunto (opcional)') as HTMLInputElement).value).toBe(
      'Já digitado',
    );
  });
});
