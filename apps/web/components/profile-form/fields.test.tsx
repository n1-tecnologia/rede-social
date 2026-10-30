// @vitest-environment happy-dom

import { join } from 'node:path';
import type { MemberQuestion, ProfileFormIssue } from '@rede-social/contracts/profile-form';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { type Draft, draftFromStored } from '@/lib/profile-form/form-state';
import { options, question } from '@/lib/profile-form/test-fixtures';
import { QuestionField } from './QuestionField';

/**
 * 12-12 (D-590, UI-D-583, UI-D-584, UI-D-585, UI-D-596; PFORM-14, PFORM-26) — the thirteen controls against
 * the REAL pt-BR catalog: accessible name and role, the required rule on every kind, the 44px floor, the
 * "Outro" reveal, "Limpar resposta" only where it belongs, the rating and the pressed yes/no.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

function Harness({
  q,
  issue = null,
  flagged = false,
  disabled = false,
}: {
  q: MemberQuestion;
  issue?: ProfileFormIssue | null;
  flagged?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFromStored(q));
  return (
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <QuestionField
        question={q}
        draft={draft}
        onChange={setDraft}
        disabled={disabled}
        issue={issue}
        flagged={flagged}
      />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
    </NextIntlClientProvider>
  );
}

const show = (q: MemberQuestion, extra: Partial<Parameters<typeof Harness>[0]> = {}) =>
  render(<Harness q={q} {...extra} />);
const draftNow = () => JSON.parse(screen.getByTestId('draft').textContent ?? 'null');

afterEach(() => cleanup());

describe('the thirteen controls: name, role and the 44px floor', () => {
  it('short text is a textbox named by its title, 16px text, capped at 120', () => {
    show(question('short_text', { title: 'Cargo' }));
    const input = screen.getByRole('textbox', { name: /Cargo/ }) as HTMLInputElement;
    expect(input.maxLength).toBe(120);
    expect(input.className).toContain('text-base');
    expect(input.className).toContain('py-3');
    fireEvent.change(input, { target: { value: 'Designer' } });
    expect(draftNow()).toBe('Designer');
  });

  it('long text is a textarea with a live counter out of 1000', () => {
    show(question('long_text', { title: 'Sobre você' }));
    const area = screen.getByRole('textbox', { name: /Sobre você/ }) as HTMLTextAreaElement;
    expect(area.maxLength).toBe(1000);
    fireEvent.change(area, { target: { value: 'olá' } });
    expect(screen.getByText('3/1000')).toBeTruthy();
  });

  it('dropdown is a native select: Selecione first and disabled, the options in order, then Outro', () => {
    const opts = options('Instagram', 'Indicação');
    show(question('dropdown', { title: 'Como conheceu?', options: opts, allowOther: true }));
    const select = screen.getByRole('combobox', { name: /Como conheceu/ }) as HTMLSelectElement;
    expect(select.className).toContain('min-h-11');
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).toEqual(['Selecione', 'Instagram', 'Indicação', 'Outro']);
    expect(select.options[0]?.disabled).toBe(true);
    expect(select.options[0]?.value).toBe('');
    fireEvent.change(select, { target: { value: opts[1]?.id } });
    expect(draftNow()).toEqual({ optionIds: [opts[1]?.id], other: false, otherText: '' });
  });

  it('single choice is a radiogroup of 44px rows; arrow keys are the browser radio behaviour', () => {
    const opts = options('A', 'B');
    show(question('single_choice', { title: 'Escolha', options: opts }));
    const group = screen.getByRole('radiogroup', { name: /Escolha/ });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      expect(radio.closest('div')?.className).toContain('min-h-11');
    }
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    expect(draftNow().optionIds).toEqual([opts[1]?.id]);
  });

  it('multiple choice is a named group of checkboxes that toggle', () => {
    const opts = options('A', 'B', 'C');
    show(question('multiple_choice', { title: 'Interesses', options: opts }));
    const group = screen.getByRole('group', { name: /Interesses/ });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(3);
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'C' }));
    expect(draftNow().optionIds).toEqual([opts[0]?.id, opts[2]?.id]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    expect(draftNow().optionIds).toEqual([opts[2]?.id]);
  });

  it('yes/no is a pressed-button group named by the question; nothing is pressed until chosen', () => {
    show(question('yes_no', { title: 'Tem filhos?' }));
    // The fieldset names the question for assistive tech; the segmented control is the pressed-button group.
    expect(screen.getAllByRole('group', { name: /Tem filhos/ })).toHaveLength(2);
    const group = screen.getAllByRole('group', { name: /Tem filhos/ }).at(-1) as HTMLElement;
    const [yes, no] = within(group).getAllByRole('button') as HTMLButtonElement[];
    expect(yes?.getAttribute('aria-pressed')).toBe('false');
    expect(no?.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(no as HTMLButtonElement);
    expect(no?.getAttribute('aria-pressed')).toBe('true');
    expect(yes?.getAttribute('aria-pressed')).toBe('false');
    expect(draftNow()).toBe(false);
    fireEvent.click(yes as HTMLButtonElement);
    expect(draftNow()).toBe(true);
  });

  it('acceptance is one checkbox whose label IS the title; unticked is not an answer', () => {
    show(question('acceptance', { title: 'Li e aceito o regulamento' }));
    const box = screen.getByRole('checkbox', { name: 'Li e aceito o regulamento' });
    expect((box as HTMLInputElement).checked).toBe(false);
    fireEvent.click(box);
    expect(draftNow()).toBe(true);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('rating is five stars named 1 estrela / N estrelas, filled up to the choice, with "N de 5"', () => {
    show(question('rating', { title: 'Sua nota' }));
    const group = screen.getByRole('radiogroup', { name: /Sua nota/ });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.parentElement?.textContent),
    ).toEqual(['1 estrela', '2 estrelas', '3 estrelas', '4 estrelas', '5 estrelas']);
    for (const label of group.querySelectorAll('label')) {
      expect(label.className).toContain('size-11');
    }
    expect(screen.queryByText(/de 5/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '3 estrelas' }));
    expect(draftNow()).toBe(3);
    expect(screen.getByText('3 de 5')).toBeTruthy();
    const stars = [...group.querySelectorAll('svg')].map((svg) =>
      svg.getAttribute('class')?.includes('fill-brand'),
    );
    expect(stars).toEqual([true, true, true, false, false]);
  });

  it('the five format types are text controls with the right type and inputMode', () => {
    const cases: [Parameters<typeof question>[0], string, string | null, string | null][] = [
      ['number', 'text', 'decimal', 'off'],
      ['date', 'date', null, null],
      ['phone', 'tel', 'tel', 'tel-national'],
      ['email', 'email', 'email', 'email'],
      ['link', 'url', 'url', null],
    ];
    for (const [type, inputType, inputMode, autoComplete] of cases) {
      const { container, unmount } = show(question(type, { title: `Campo ${type}` }));
      const input = container.querySelector('input') as HTMLInputElement;
      expect(input.type).toBe(inputType);
      expect(input.getAttribute('inputmode')).toBe(inputMode);
      expect(input.getAttribute('autocomplete')).toBe(autoComplete);
      unmount();
    }
  });

  it('a number question shows its limits as the helper and a date question passes min and max', () => {
    show(question('number', { title: 'Idade', limits: { min: 18, max: 99 } }));
    expect(screen.getByText('Entre 18 e 99.')).toBeTruthy();
    cleanup();
    const { container } = show(
      question('date', { title: 'Quando', limits: { min: '2026-01-01', max: '2026-12-31' } }),
    );
    const date = container.querySelector('input') as HTMLInputElement;
    expect(date.min).toBe('2026-01-01');
    expect(date.max).toBe('2026-12-31');
  });
});

describe('the required rule is a caption AND aria-required on every kind (UI-D-596)', () => {
  const kinds = [
    () => question('short_text', { required: true }),
    () => question('long_text', { required: true }),
    () => question('dropdown', { required: true, options: options('A', 'B') }),
    () => question('multiple_choice', { required: true, options: options('A', 'B') }),
    () => question('single_choice', { required: true, options: options('A', 'B') }),
    () => question('number', { required: true }),
    () => question('date', { required: true }),
    () => question('phone', { required: true }),
    () => question('email', { required: true }),
    () => question('link', { required: true }),
    () => question('yes_no', { required: true }),
    () => question('acceptance', { required: true }),
    () => question('rating', { required: true }),
  ];

  it.each(kinds.map((make) => [make().type, make] as const))(
    '%s: Obrigatória is visible and aria-required is set',
    (_type, make) => {
      const { container } = show(make());
      expect(screen.getByText('Obrigatória')).toBeTruthy();
      expect(screen.queryByText('Opcional')).toBeNull();
      expect(container.querySelector('[aria-required="true"]')).not.toBeNull();
    },
  );

  it('an optional question reads Opcional and sets no aria-required', () => {
    const { container } = show(question('short_text'));
    expect(screen.getByText('Opcional')).toBeTruthy();
    expect(container.querySelector('[aria-required]')).toBeNull();
  });
});

describe('"Outro" (UI-D-585)', () => {
  it('choosing Outro in a dropdown reveals "Qual?", required, focused, and an option hides it', () => {
    const opts = options('A', 'B');
    show(question('dropdown', { title: 'Origem', options: opts, allowOther: true }));
    expect(screen.queryByLabelText('Qual?')).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__other__' } });
    const other = screen.getByLabelText('Qual?') as HTMLInputElement;
    expect(other.getAttribute('aria-required')).toBe('true');
    expect(other.maxLength).toBe(120);
    expect(document.activeElement).toBe(other);
    fireEvent.change(other, { target: { value: 'Podcast' } });
    expect(draftNow()).toEqual({ optionIds: [], other: true, otherText: 'Podcast' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: opts[0]?.id } });
    expect(screen.queryByLabelText('Qual?')).toBeNull();
    expect(draftNow()).toEqual({ optionIds: [opts[0]?.id], other: false, otherText: '' });
  });

  it('Outro is the LAST row of a single and a multiple choice and reveals the same input', () => {
    const opts = options('A', 'B');
    show(question('single_choice', { title: 'Origem', options: opts, allowOther: true }));
    const radios = screen.getAllByRole('radio');
    expect(radios.at(-1)?.id).toContain('other-option');
    fireEvent.click(screen.getByRole('radio', { name: 'Outro' }));
    expect(screen.getByLabelText('Qual?')).toBeTruthy();
    expect(draftNow().other).toBe(true);
    cleanup();

    show(question('multiple_choice', { title: 'Origem', options: opts, allowOther: true }));
    expect(screen.getAllByRole('checkbox').at(-1)?.id).toContain('other-option');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Outro' }));
    expect(screen.getByLabelText('Qual?')).toBeTruthy();
  });

  it('a question without allowOther offers no Outro', () => {
    show(question('dropdown', { options: options('A', 'B') }));
    expect(screen.queryByRole('option', { name: 'Outro' })).toBeNull();
  });
});

describe('"Limpar resposta" (UI-D-584)', () => {
  const clear = () => screen.queryByRole('button', { name: 'Limpar resposta' });

  it('appears on an answered OPTIONAL dropdown, single choice, yes/no and rating, and clears', () => {
    const opts = options('A', 'B');
    const answered = [
      question('dropdown', {
        options: opts,
        answer: { optionId: opts[0]?.id ?? '', otherText: null },
      }),
      question('single_choice', {
        options: opts,
        answer: { optionId: opts[0]?.id ?? '', otherText: null },
      }),
      question('yes_no', { answer: true }),
      question('rating', { answer: 4 }),
    ];
    for (const q of answered) {
      const { unmount } = show(q);
      const button = clear() as HTMLButtonElement;
      expect(button).not.toBeNull();
      expect(button.className).toContain('min-h-11');
      fireEvent.click(button);
      expect(clear()).toBeNull();
      unmount();
    }
  });

  it('is absent when the question is unanswered, required, multiple choice, acceptance or text', () => {
    const opts = options('A', 'B');
    const answer = { optionId: opts[0]?.id ?? '', otherText: null };
    const absent = [
      question('dropdown', { options: opts }),
      question('dropdown', { options: opts, required: true, answer }),
      question('single_choice', { options: opts, required: true, answer }),
      question('yes_no', { required: true, answer: true }),
      question('rating', { required: true, answer: 2 }),
      question('multiple_choice', {
        options: opts,
        answer: { optionIds: [opts[0]?.id ?? ''], otherText: null },
      }),
      question('acceptance', { answer: true }),
      question('short_text', { answer: 'x' }),
    ];
    for (const q of absent) {
      const { unmount } = show(q);
      expect(clear()).toBeNull();
      unmount();
    }
  });
});

describe('errors, hints and the public notice', () => {
  it('an Input error is tied by aria-invalid and aria-describedby', () => {
    show(question('short_text', { title: 'Cargo' }), { issue: 'required' });
    const input = screen.getByRole('textbox', { name: /Cargo/ });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const error = screen.getByText('Responda esta pergunta.');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
  });

  it('a group error is tied to its fieldset', () => {
    show(question('multiple_choice', { title: 'Interesses', options: options('A', 'B') }), {
      issue: 'required',
    });
    const group = screen.getByRole('group', { name: /Interesses/ });
    const error = screen.getByText('Escolha pelo menos uma opção.');
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(group.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
  });

  it('shows the help text and the public notice only when the question has them', () => {
    show(question('short_text', { helpText: 'Como aparece no crachá', showOnProfile: true }));
    expect(screen.getByText('Como aparece no crachá')).toBeTruthy();
    expect(screen.getByText('Esta resposta aparece no seu perfil.')).toBeTruthy();
    cleanup();
    show(question('short_text'));
    expect(screen.queryByText('Esta resposta aparece no seu perfil.')).toBeNull();
  });

  it('a flagged question carries the danger block, the shape and the words', () => {
    const { container } = show(question('short_text', { required: true }), { flagged: true });
    expect(screen.getByText('Falta responder')).toBeTruthy();
    expect(container.querySelector('[data-flagged]')?.className).toContain('border-danger/40');
    expect(container.querySelector('[data-flagged] svg')).not.toBeNull();
  });

  it('every control is locked while a save runs', () => {
    const opts = options('A', 'B');
    show(question('single_choice', { options: opts }), { disabled: true });
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLInputElement).disabled).toBe(true);
    }
  });

  it('a long title and a long option label wrap inside the card with the caption beside', () => {
    const title = 'T'.repeat(120);
    const opts = [
      { id: options('x')[0]?.id ?? '', label: 'Opção '.repeat(30).trim() },
      ...options('B'),
    ];
    const { container } = show(question('single_choice', { title, required: true, options: opts }));
    expect(container.querySelector('legend')?.textContent).toContain(title);
    const label = screen.getByText(opts[0]?.label ?? '');
    expect(label.className).toContain('break-words');
    expect(label.className).toContain('min-w-0');
    act(() => {});
  });
});
