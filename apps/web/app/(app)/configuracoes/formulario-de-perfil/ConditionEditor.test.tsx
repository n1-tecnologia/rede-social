// @vitest-environment happy-dom

import { join } from 'node:path';
import type { AdminQuestion } from '@rede-social/contracts/profile-form';
import { PROFILE_FORM_LIMITS } from '@rede-social/contracts/profile-form';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { adminQuestion, adminStep, uuid } from '@/lib/profile-form/test-fixtures';
import { ConditionEditor } from './ConditionEditor';
import type { DraftCondition } from './editor-state';

/**
 * 12.1-17 Task 1 (D-620..D-623, UI-D-647, UI-D-648): the condition editor against the REAL catalog. A tiny
 * stateful host stands in for the sheet, so the focus move, the cleared values and the status note are the
 * component's own behaviour. Asserted: the switch and its disabled "no opener" state with the note row, only the
 * offered openers listed (grouped by step from two steps), the value picker following the opener's type, the
 * order of the ticked tokens, the polite note on a changed opener, the line for "Outro", the required line and the
 * error wiring (`aria-invalid`, `aria-describedby`, `role="alert"`).
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

interface HostProps {
  openers: AdminQuestion[];
  steps?: ReturnType<typeof adminStep>[];
  initial?: DraftCondition | null;
  required?: boolean;
  openerError?: string;
  valuesError?: string;
  stale?: boolean;
  onChange?: (condition: DraftCondition | null) => void;
}

function Host({ openers, steps = [], initial = null, required = false, ...rest }: HostProps) {
  const [condition, setCondition] = useState<DraftCondition | null>(initial);
  const [reset, setReset] = useState(false);
  return (
    <ConditionEditor
      condition={condition}
      openers={openers}
      steps={steps}
      required={required}
      openerError={rest.openerError}
      valuesError={rest.valuesError}
      stale={rest.stale}
      resetNote={reset}
      onChange={(next, didReset) => {
        setCondition(next);
        setReset(didReset === true);
        rest.onChange?.(next);
      }}
    />
  );
}

function mount(props: HostProps) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <Host {...props} />
    </NextIntlClientProvider>,
  );
}

const sw = () => screen.getByRole('switch', { name: 'Mostrar só em alguns casos' });
const opener = () => screen.getByLabelText('Pergunta que decide') as HTMLSelectElement;

afterEach(cleanup);

describe('the switch row (UI-D-648)', () => {
  it('is off by default, with its helper, and renders nothing else', () => {
    mount({ openers: [choiceOpener] });
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(sw().hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('Sem condição, todos os membros veem esta pergunta.')).toBeTruthy();
    expect(screen.queryByLabelText('Pergunta que decide')).toBeNull();
    expect(screen.queryByText('Mostrar quando a resposta for')).toBeNull();
  });

  it('with NO eligible opener is disabled and a note row says what to create first', () => {
    mount({ openers: [] });
    expect(sw().hasAttribute('disabled')).toBe(true);
    const note = screen.getByText(
      'Para usar uma condição, crie antes uma pergunta de escolha ou de Sim ou não, sem condição, que venha antes desta.',
    );
    expect(note.closest('[role="status"]')).toBeTruthy();
  });

  it('turning it on shows the opener select and moves focus into it', () => {
    mount({ openers: [choiceOpener] });
    fireEvent.click(sw());
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(opener());
    expect(opener().value).toBe('');
    expect(
      screen.getByText(
        'Só aparecem aqui perguntas de escolha ou de Sim ou não, sem condição, que vêm antes desta.',
      ),
    ).toBeTruthy();
  });

  it('turning it off discards the draft condition', () => {
    const seen = vi.fn();
    mount({
      openers: [choiceOpener],
      initial: { questionId: choiceOpener.id, values: [uuid(9101)] },
      onChange: seen,
    });
    fireEvent.click(sw());
    expect(seen).toHaveBeenLastCalledWith(null);
    expect(screen.queryByLabelText('Pergunta que decide')).toBeNull();
  });
});

describe('the opener select (D-620, D-622, D-623)', () => {
  it('lists "Selecione" disabled first, then ONLY the offered openers', () => {
    mount({ openers: [choiceOpener, yesNoOpener], initial: { questionId: '', values: [] } });
    const options = within(opener()).getAllByRole('option') as HTMLOptionElement[];
    expect(options.map((o) => o.textContent)).toEqual([
      'Selecione',
      'Você tem clínica?',
      'Você já tem equipe?',
    ]);
    expect(options[0]?.disabled).toBe(true);
    expect(options[0]?.value).toBe('');
  });

  it('is a native select, not a custom combobox', () => {
    mount({ openers: [choiceOpener], initial: { questionId: '', values: [] } });
    expect(opener().tagName).toBe('SELECT');
    expect(screen.queryByRole('combobox', { name: /decide/ })?.tagName).toBe('SELECT');
  });

  it('groups the options by step from two steps on, and not with one', () => {
    const s1 = adminStep({ title: 'Geral' });
    const s2 = adminStep({ title: 'Clínica' });
    const inS1 = { ...choiceOpener, stepId: s1.id };
    const inS2 = { ...yesNoOpener, stepId: s2.id };
    const { unmount } = mount({
      openers: [inS1, inS2],
      steps: [s1, s2],
      initial: { questionId: '', values: [] },
    });
    const groups = opener().querySelectorAll('optgroup');
    expect([...groups].map((g) => g.label)).toEqual(['Geral', 'Clínica']);
    expect(within(groups[1] as HTMLElement).getAllByRole('option')[0]?.textContent).toBe(
      'Você já tem equipe?',
    );
    unmount();

    mount({ openers: [inS1], steps: [s1], initial: { questionId: '', values: [] } });
    expect(opener().querySelectorAll('optgroup')).toHaveLength(0);
  });

  it('wires the error: aria-invalid, aria-describedby and a role=alert line', () => {
    mount({
      openers: [choiceOpener],
      initial: { questionId: '', values: [] },
      openerError: 'Escolha a pergunta que decide.',
    });
    expect(opener().getAttribute('aria-invalid')).toBe('true');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Escolha a pergunta que decide.');
    expect(opener().getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('shows the 409 line when the opener changed meanwhile', () => {
    mount({ openers: [choiceOpener], initial: { questionId: '', values: [] }, stale: true });
    expect(
      screen
        .getByText('Esta condição não vale mais. Escolha a pergunta e a resposta de novo.')
        .closest('[role="alert"]'),
    ).toBeTruthy();
  });
});

describe('the value picker follows the opener type (UI-D-648)', () => {
  it('yes/no: the shipped Sim / Não control under the legend, one value', () => {
    const seen = vi.fn();
    mount({
      openers: [yesNoOpener],
      initial: { questionId: yesNoOpener.id, values: [] },
      onChange: seen,
    });
    const group = screen.getByRole('group', { name: 'Mostrar quando a resposta for' });
    const yes = within(group).getByRole('button', { name: 'Sim' });
    const no = within(group).getByRole('button', { name: 'Não' });
    expect(yes.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(yes);
    expect(seen).toHaveBeenLastCalledWith({ questionId: yesNoOpener.id, values: ['true'] });
    fireEvent.click(no);
    expect(seen).toHaveBeenLastCalledWith({ questionId: yesNoOpener.id, values: ['false'] });
    expect(no.getAttribute('aria-pressed')).toBe('true');
    expect(yes.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('a choice type: a fieldset of checkbox rows in the opener order, any one opens', () => {
    const seen = vi.fn();
    mount({
      openers: [choiceOpener],
      initial: { questionId: choiceOpener.id, values: [] },
      onChange: seen,
    });
    const group = screen.getByRole('group', { name: 'Mostrar quando a resposta for' });
    const boxes = within(group).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.labels?.[0]?.textContent)).toEqual([
      'Tenho uma clínica',
      'Trabalho em uma clínica',
      'Estou aprendendo',
    ]);
    // 44px rows, 20px brand-accented boxes, wrapping labels.
    expect(boxes[0]?.className).toContain('size-5');
    expect(boxes[0]?.className).toContain('accent-brand');
    expect(boxes[0]?.parentElement?.className).toContain('min-h-11');
    expect(boxes[0]?.labels?.[0]?.className).toContain('break-words');
    expect(
      screen.getByText('Basta uma das opções marcadas para a pergunta aparecer.'),
    ).toBeTruthy();
    // Ticked out of order, the tokens keep the opener's order.
    fireEvent.click(boxes[2] as HTMLInputElement);
    fireEvent.click(boxes[0] as HTMLInputElement);
    expect(seen).toHaveBeenLastCalledWith({
      questionId: choiceOpener.id,
      values: [uuid(9101), uuid(9103)],
    });
    fireEvent.click(boxes[2] as HTMLInputElement);
    expect(seen).toHaveBeenLastCalledWith({ questionId: choiceOpener.id, values: [uuid(9101)] });
  });

  it('says "Outro" does not open questions, only when the opener has it', () => {
    const withOther = { ...choiceOpener, allowOther: true };
    const { unmount } = mount({
      openers: [withOther],
      initial: { questionId: withOther.id, values: [] },
    });
    expect(screen.getByText('A opção “Outro” não abre perguntas.')).toBeTruthy();
    unmount();
    mount({ openers: [choiceOpener], initial: { questionId: choiceOpener.id, values: [] } });
    expect(screen.queryByText('A opção “Outro” não abre perguntas.')).toBeNull();
  });

  it('wires the missing-answer error on the fieldset', () => {
    mount({
      openers: [choiceOpener],
      initial: { questionId: choiceOpener.id, values: [] },
      valuesError: 'Escolha pelo menos uma resposta que abre esta pergunta.',
    });
    const group = screen.getByRole('group', { name: 'Mostrar quando a resposta for' });
    const alert = within(group).getByRole('alert');
    expect(group.getAttribute('aria-describedby')).toBe(alert.id);
    expect(alert.textContent).toBe('Escolha pelo menos uma resposta que abre esta pergunta.');
    expect(within(group).getAllByRole('checkbox')[0]?.getAttribute('aria-invalid')).toBe('true');
  });

  it('changing the opener clears the values and says so in a polite status line', () => {
    mount({
      openers: [choiceOpener, yesNoOpener],
      initial: { questionId: choiceOpener.id, values: [uuid(9101)] },
    });
    expect(screen.queryByText(/foram limpas/)).toBeNull();
    fireEvent.change(opener(), { target: { value: yesNoOpener.id } });
    const note = screen.getByText(
      'A pergunta que decide mudou, então as respostas escolhidas foram limpas.',
    );
    expect(note.closest('[role="status"]')).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: 'Mostrar quando a resposta for' }))
        .getAllByRole('button')
        .every((button) => button.getAttribute('aria-pressed') === 'false'),
    ).toBe(true);
  });

  it('choosing the FIRST opener says nothing about cleared answers', () => {
    mount({ openers: [choiceOpener], initial: { questionId: '', values: [] } });
    fireEvent.change(opener(), { target: { value: choiceOpener.id } });
    expect(screen.queryByText(/foram limpas/)).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('a required question adds the "só quem a vê" line', () => {
    const { unmount } = mount({
      openers: [choiceOpener],
      initial: { questionId: choiceOpener.id, values: [] },
      required: true,
    });
    expect(
      screen.getByText('Como esta pergunta é obrigatória, só quem a vê precisa responder.'),
    ).toBeTruthy();
    unmount();
    mount({ openers: [choiceOpener], initial: { questionId: choiceOpener.id, values: [] } });
    expect(screen.queryByText(/só quem a vê precisa responder/)).toBeNull();
  });
});

describe('320px: 20 options and long labels (E3 overflow and long-text, asserted by classes)', () => {
  it('keeps 20 checkbox rows inside the fieldset (min-w-0) and wraps 80-character labels', () => {
    const max = PROFILE_FORM_LIMITS.options;
    const long =
      'Uma opção com um rótulo longuíssimo de oitenta caracteres para quebrar a linha ok';
    const wide: AdminQuestion = adminQuestion('multiple_choice', {
      title: 'Um título de abridora muito longo que também precisa quebrar a linha no aparelho',
      options: Array.from({ length: max }, (_, at) => ({
        id: uuid(9200 + at),
        label: `${long} ${at}`.slice(0, 80),
        answerCount: 0,
      })),
    });
    mount({ openers: [wide], initial: { questionId: wide.id, values: [] } });
    const group = screen.getByRole('group', { name: 'Mostrar quando a resposta for' });
    const boxes = within(group).getAllByRole('checkbox');
    expect(boxes).toHaveLength(20);
    expect(group.className).toContain('min-w-0');
    for (const box of boxes) {
      const label = (box as HTMLInputElement).labels?.[0] as HTMLElement;
      expect(label.className).toContain('break-words');
      expect(label.className).toContain('min-w-0');
      expect((label.textContent ?? '').length).toBeLessThanOrEqual(80);
    }
    // The select keeps its width too, however long the opener title is.
    expect(opener().className).toContain('min-w-0');
    expect(opener().className).toContain('w-full');
  });
});
