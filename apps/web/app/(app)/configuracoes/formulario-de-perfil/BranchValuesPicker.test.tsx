// @vitest-environment happy-dom

import { join } from 'node:path';
import type { AdminQuestion } from '@rede-social/contracts/profile-form';
import { PROFILE_FORM_LIMITS } from '@rede-social/contracts/profile-form';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { adminQuestion, uuid } from '@/lib/profile-form/test-fixtures';
import { BranchValuesPicker } from './BranchValuesPicker';

/**
 * 12.2-16 Task 2 (D-640, UI-D-671): the value controls extracted from the 12.1 condition editor, against the
 * REAL catalog. A tiny stateful host stands in for the branch sheet. Asserted: the shipped Sim / Não control with
 * one value for yes/no, a fieldset of 44px checkbox rows in the opener's own order for a choice type, the tokens
 * kept in that order, the line for "Outro", the error wiring (`aria-invalid`, `aria-describedby`, `role="alert"`)
 * and the 320px classes with 20 options and 80-character labels.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

const choiceOpener = adminQuestion('single_choice', {
  title: 'Você tem clínica?',
  options: [
    { id: uuid(9101), label: 'Tenho uma clínica', answerCount: 0 },
    { id: uuid(9102), label: 'Trabalho em uma clínica', answerCount: 0 },
    { id: uuid(9103), label: 'Estou aprendendo', answerCount: 0 },
  ],
});
const yesNoOpener = adminQuestion('yes_no', { title: 'Você já tem equipe?' });

function Host({
  opener,
  initial = [],
  error,
  onChange,
}: {
  opener: AdminQuestion;
  initial?: string[];
  error?: string;
  onChange?: (values: string[]) => void;
}) {
  const [values, setValues] = useState<string[]>(initial);
  return (
    <BranchValuesPicker
      opener={opener}
      values={values}
      error={error}
      onChange={(next) => {
        setValues(next);
        onChange?.(next);
      }}
    />
  );
}

function mount(props: Parameters<typeof Host>[0]) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <Host {...props} />
    </NextIntlClientProvider>,
  );
}

const group = () => screen.getByRole('group', { name: 'Mostrar quando a resposta for' });

afterEach(cleanup);

describe('a yes/no opener: the shipped Sim / Não control, one value', () => {
  it('sets one token at a time and shows which is pressed', () => {
    const seen = vi.fn();
    mount({ opener: yesNoOpener, onChange: seen });
    const yes = within(group()).getByRole('button', { name: 'Sim' });
    const no = within(group()).getByRole('button', { name: 'Não' });
    expect(yes.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(yes);
    expect(seen).toHaveBeenLastCalledWith(['true']);
    fireEvent.click(no);
    expect(seen).toHaveBeenLastCalledWith(['false']);
    expect(no.getAttribute('aria-pressed')).toBe('true');
    expect(yes.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('wires the missing-answer error under the control', () => {
    mount({ opener: yesNoOpener, error: 'Escolha pelo menos uma resposta que abre este ramo.' });
    expect(screen.getByRole('alert').textContent).toBe(
      'Escolha pelo menos uma resposta que abre este ramo.',
    );
  });
});

describe('a choice opener: a fieldset of checkbox rows in the opener order (any one opens)', () => {
  it('lists every option, 44px rows, 20px brand-accented boxes, wrapping labels', () => {
    mount({ opener: choiceOpener });
    const boxes = within(group()).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.labels?.[0]?.textContent)).toEqual([
      'Tenho uma clínica',
      'Trabalho em uma clínica',
      'Estou aprendendo',
    ]);
    expect(boxes[0]?.className).toContain('size-5');
    expect(boxes[0]?.className).toContain('accent-brand');
    expect(boxes[0]?.parentElement?.className).toContain('min-h-11');
    expect(boxes[0]?.labels?.[0]?.className).toContain('break-words');
    expect(screen.getByText('Basta uma das opções marcadas para o ramo abrir.')).toBeTruthy();
    expect(group().tagName).toBe('FIELDSET');
    expect(group().querySelector('legend')?.textContent).toBe('Mostrar quando a resposta for');
  });

  it('keeps the tokens in the opener order whatever order they were ticked in', () => {
    const seen = vi.fn();
    mount({ opener: choiceOpener, onChange: seen });
    const boxes = within(group()).getAllByRole('checkbox');
    fireEvent.click(boxes[2] as HTMLInputElement);
    fireEvent.click(boxes[0] as HTMLInputElement);
    expect(seen).toHaveBeenLastCalledWith([uuid(9101), uuid(9103)]);
    fireEvent.click(boxes[2] as HTMLInputElement);
    expect(seen).toHaveBeenLastCalledWith([uuid(9101)]);
  });

  it('says "Outro" does not open branches, only when the opener has it', () => {
    const withOther = { ...choiceOpener, allowOther: true };
    const { unmount } = mount({ opener: withOther });
    expect(screen.getByText('A opção “Outro” não abre ramos.')).toBeTruthy();
    unmount();
    mount({ opener: choiceOpener });
    expect(screen.queryByText('A opção “Outro” não abre ramos.')).toBeNull();
  });

  it('wires the missing-answer error on the fieldset', () => {
    mount({ opener: choiceOpener, error: 'Escolha pelo menos uma resposta que abre este ramo.' });
    const alert = within(group()).getByRole('alert');
    expect(group().getAttribute('aria-describedby')).toBe(alert.id);
    expect(alert.textContent).toBe('Escolha pelo menos uma resposta que abre este ramo.');
    expect(within(group()).getAllByRole('checkbox')[0]?.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the ticked tokens as checked', () => {
    mount({ opener: choiceOpener, initial: [uuid(9102)] });
    const boxes = within(group()).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([false, true, false]);
  });
});

describe('320px: 20 options and long labels (E3/E4 overflow and long-text, asserted by classes)', () => {
  it('keeps 20 checkbox rows inside the fieldset (min-w-0) and wraps 80-character labels', () => {
    const max = PROFILE_FORM_LIMITS.options;
    const long =
      'Uma opção com um rótulo longuíssimo de oitenta caracteres para quebrar a linha ok';
    const wide: AdminQuestion = adminQuestion('multiple_choice', {
      options: Array.from({ length: max }, (_, at) => ({
        id: uuid(9200 + at),
        label: `${long} ${at}`.slice(0, 80),
        answerCount: 0,
      })),
    });
    mount({ opener: wide });
    const boxes = within(group()).getAllByRole('checkbox');
    expect(boxes).toHaveLength(20);
    expect(group().className).toContain('min-w-0');
    for (const box of boxes) {
      const label = (box as HTMLInputElement).labels?.[0] as HTMLElement;
      expect(label.className).toContain('break-words');
      expect(label.className).toContain('min-w-0');
    }
  });
});
