// @vitest-environment happy-dom

import { join } from 'node:path';
import type { MemberQuestion } from '@rede-social/contracts/profile-form';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { type Draft, draftFromStored } from '@/lib/profile-form/form-state';
import { question } from '@/lib/profile-form/test-fixtures';
import { QuestionField } from './QuestionField';

/**
 * 12-13 (D-590, UI-D-584, UI-D-585, UI-D-586; PFORM-14, PFORM-26; T-12-31) — the five format controls
 * against the REAL pt-BR catalog: the phone mask and paste forms, the limit helpers, the link
 * normalisation and the blur validation, which never runs while the member types.
 */

const messages = loadMessages(join(process.cwd(), 'messages', 'pt-BR'));

function Harness({ q, serverError = null }: { q: MemberQuestion; serverError?: 'invalid' | null }) {
  const [draft, setDraft] = useState<Draft>(() => draftFromStored(q));
  return (
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <QuestionField
        question={q}
        draft={draft}
        onChange={setDraft}
        disabled={false}
        issue={serverError}
        flagged={false}
      />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
    </NextIntlClientProvider>
  );
}

const show = (q: MemberQuestion, extra: { serverError?: 'invalid' | null } = {}) => {
  const view = render(<Harness q={q} {...extra} />);
  return { ...view, input: view.container.querySelector('input') as HTMLInputElement };
};
const draftNow = () => JSON.parse(screen.getByTestId('draft').textContent ?? 'null');
const type = (input: HTMLInputElement, value: string) =>
  fireEvent.change(input, { target: { value } });
const paste = (input: HTMLInputElement, text: string) =>
  fireEvent.paste(input, { clipboardData: { getData: () => text } });

afterEach(() => cleanup());

const PHONE_ERROR = 'Informe um telefone com DDD, como (11) 91234-5678.';

describe('every format control keeps its keyboard attributes, 16px text and a 44px target (UI-D-584)', () => {
  const rows: [Parameters<typeof question>[0], string, string | null, string | null, string][] = [
    ['number', 'text', 'decimal', 'off', ''],
    ['date', 'date', null, null, ''],
    ['phone', 'tel', 'tel', 'tel-national', '(11) 91234-5678'],
    ['email', 'email', 'email', 'email', 'nome@exemplo.com.br'],
    ['link', 'url', 'url', 'off', 'https://'],
  ];
  it.each(rows)('%s', (kind, inputType, inputMode, autoComplete, placeholder) => {
    const { input } = show(question(kind, { title: `Campo ${kind}` }));
    expect(input.type).toBe(inputType);
    expect(input.getAttribute('inputmode')).toBe(inputMode);
    expect(input.getAttribute('autocomplete')).toBe(autoComplete);
    expect(input.getAttribute('placeholder') ?? '').toBe(placeholder);
    expect(input.className).toContain('text-base');
    expect(input.className).toContain('min-h-11');
    expect(input.className).toContain('py-3');
  });

  it('e-mail and link do not capitalise, and the link is not spell-checked', () => {
    expect(show(question('email')).input.getAttribute('autocapitalize')).toBe('off');
    cleanup();
    const { input } = show(question('link'));
    expect(input.getAttribute('autocapitalize')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
  });

  it('the text formats ask for the next field on the keyboard', () => {
    for (const kind of ['number', 'phone', 'email', 'link'] as const) {
      const { input, unmount } = show(question(kind));
      expect(input.getAttribute('enterkeyhint')).toBe('next');
      unmount();
    }
  });
});

describe('the phone control masks what the member types and stores the digits', () => {
  it('shows the mask progressively and hands the digits to the form', () => {
    const { input } = show(question('phone', { title: 'Celular' }));
    type(input, '1');
    expect(input.value).toBe('(1');
    expect(draftNow()).toBe('1');
    type(input, '(11) 9');
    expect(input.value).toBe('(11) 9');
    type(input, '(11) 91234-5678');
    expect(input.value).toBe('(11) 91234-5678');
    expect(draftNow()).toBe('11912345678');
  });

  it('shows a stored number masked, ten digits as 4-4', () => {
    expect(show(question('phone', { answer: '11912345678' })).input.value).toBe('(11) 91234-5678');
    cleanup();
    expect(show(question('phone', { answer: '1112345678' })).input.value).toBe('(11) 1234-5678');
  });

  it.each([
    ['+55 11 91234-5678', '11912345678', '(11) 91234-5678'],
    ['5511912345678', '11912345678', '(11) 91234-5678'],
    ['(11) 91234-5678', '11912345678', '(11) 91234-5678'],
    ['+55 11 1234-5678', '1112345678', '(11) 1234-5678'],
  ])('a paste of %s becomes the national number', (pasted, digits, masked) => {
    const { input } = show(question('phone'));
    paste(input, pasted);
    expect(draftNow()).toBe(digits);
    expect(input.value).toBe(masked);
  });

  it('a country code typed into an empty field in one go (autofill) is removed the same way', () => {
    const { input } = show(question('phone'));
    type(input, '+5511912345678');
    expect(draftNow()).toBe('11912345678');
  });

  it('a DDD 55 typed digit by digit is never mistaken for a country code', () => {
    const { input } = show(question('phone'));
    for (const typed of ['5', '55', '559', '5591', '55912', '559123', '5591234', '55912345']) {
      type(input, typed);
    }
    type(input, '559123456');
    type(input, '5591234567');
    type(input, '55912345678');
    expect(draftNow()).toBe('55912345678');
    expect(input.value).toBe('(55) 91234-5678');
  });

  it('refuses a twelfth digit instead of dropping one the member typed', () => {
    const { input } = show(question('phone', { answer: '11912345678' }));
    type(input, '(11) 91234-56789');
    expect(draftNow()).toBe('11912345678');
    expect(input.value).toBe('(11) 91234-5678');
    paste(input, '99');
    expect(draftNow()).toBe('11912345678');
  });

  it('ignores letters and symbols typed in the field', () => {
    const { input } = show(question('phone'));
    type(input, '11a');
    expect(draftNow()).toBe('11');
    expect(input.value).toBe('(11');
  });

  it('keeps the caret next to the digit being edited when typing in the middle', () => {
    const { input } = show(question('phone', { answer: '1191234567' }));
    expect(input.value).toBe('(11) 9123-4567');
    input.focus();
    // The member puts the caret after the "9" and types an "8": the caret is then at index 7.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(input, '(11) 98123-4567');
    input.setSelectionRange(7, 7);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(draftNow()).toBe('11981234567');
    expect(input.value).toBe('(11) 98123-4567');
    expect(input.selectionStart).toBe(7);
    expect(input.selectionEnd).toBe(7);
  });

  it('replaces only the selected digits on a paste in the middle', () => {
    const { input } = show(question('phone', { answer: '11912345678' }));
    input.focus();
    input.setSelectionRange(1, 4); // "11" -> "1", ")" and " " are mask: digits 0..2 selected
    paste(input, '21');
    expect(draftNow()).toBe('21912345678');
  });
});

describe('blur validation of the phone', () => {
  it('shows the phone error on blur for a DDD 01 and for 11 digits without the 9', () => {
    const { input } = show(question('phone'));
    type(input, '0198765432');
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toBe(PHONE_ERROR);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    cleanup();
    const second = show(question('phone'));
    type(second.input, '11887654321');
    fireEvent.blur(second.input);
    expect(screen.getByRole('alert').textContent).toBe(PHONE_ERROR);
  });

  it('shows nothing for a half-typed mask before blur, nothing for an empty optional field and nothing for a good number', () => {
    const { input } = show(question('phone'));
    type(input, '(11) 9123');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toBe(PHONE_ERROR);
    type(input, '(11) 91234-5678');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(input);
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
    const empty = show(question('phone'));
    fireEvent.blur(empty.input);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ties the error to the control and clears it on the next edit', () => {
    const { input } = show(question('phone'));
    type(input, '123');
    fireEvent.blur(input);
    const alert = screen.getByRole('alert');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
    type(input, '1234');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('lets the server or save error win over the one found on blur', () => {
    const { input } = show(question('phone'), { serverError: 'invalid' });
    expect(screen.getByRole('alert').textContent).toBe(PHONE_ERROR);
    type(input, '123');
    fireEvent.blur(input);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});

describe('the number control (UI-D-584, UI-D-585)', () => {
  it('shows its limits as the helper in the three shapes', () => {
    show(question('number', { limits: { min: 18, max: 99 } }));
    expect(screen.getByText('Entre 18 e 99.')).toBeTruthy();
    cleanup();
    show(question('number', { limits: { min: 1000 } }));
    expect(screen.getByText('A partir de 1.000.')).toBeTruthy();
    cleanup();
    show(question('number', { limits: { max: 5 } }));
    expect(screen.getByText('Até 5.')).toBeTruthy();
    cleanup();
    show(question('number'));
    expect(screen.queryByText(/Entre|A partir|Até/)).toBeNull();
  });

  it('stores a JSON number and shows it back with the comma on blur', () => {
    const { input } = show(question('number'));
    type(input, '1.234,5');
    expect(draftNow()).toBe('1.234,5');
    fireEvent.blur(input);
    expect(input.value).toBe('1234,5');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a stored number with the pt-BR comma', () => {
    expect(show(question('number', { answer: 12.5 })).input.value).toBe('12,5');
  });

  it('refuses text that is not a number and an out-of-range value, only on blur', () => {
    const { input } = show(question('number', { limits: { min: 1, max: 10 } }));
    type(input, '1,2,3');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toBe('Informe um número.');
    expect(input.value).toBe('1,2,3');
    type(input, '11');
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toBe('Informe um valor entre 1 e 10.');
  });

  it('uses the "a partir de" and "até" sentences when only one limit is set', () => {
    const { input } = show(question('number', { limits: { min: 5 } }));
    type(input, '1');
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toBe('Informe um valor a partir de 5.');
    cleanup();
    const max = show(question('number', { limits: { max: 5 } }));
    type(max.input, '9');
    fireEvent.blur(max.input);
    expect(screen.getByRole('alert').textContent).toBe('Informe um valor até 5.');
  });
});

describe('the date control (UI-D-584, UI-D-586)', () => {
  it('passes min and max to the native control and shows them as dd/MM/yyyy', () => {
    const { input } = show(question('date', { limits: { min: '2026-01-01', max: '2026-12-31' } }));
    expect(input.min).toBe('2026-01-01');
    expect(input.max).toBe('2026-12-31');
    expect(screen.getByText('Entre 01/01/2026 e 31/12/2026.')).toBeTruthy();
    cleanup();
    show(question('date', { limits: { min: '2026-01-31' } }));
    expect(screen.getByText('A partir de 31/01/2026.')).toBeTruthy();
    cleanup();
    show(question('date', { limits: { max: '2026-12-31' } }));
    expect(screen.getByText('Até 31/12/2026.')).toBeTruthy();
  });

  it('refuses a day outside the limits on blur, with the matching sentence', () => {
    const { input } = show(question('date', { limits: { min: '2026-01-01', max: '2026-12-31' } }));
    type(input, '2027-01-01');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toBe(
      'Informe uma data entre 01/01/2026 e 31/12/2026.',
    );
    type(input, '2026-06-15');
    fireEvent.blur(input);
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
    const min = show(question('date', { limits: { min: '2026-01-31' } }));
    type(min.input, '2025-01-01');
    fireEvent.blur(min.input);
    expect(screen.getByRole('alert').textContent).toBe('Informe uma data a partir de 31/01/2026.');
    cleanup();
    const max = show(question('date', { limits: { max: '2026-12-31' } }));
    type(max.input, '2027-01-01');
    fireEvent.blur(max.input);
    expect(screen.getByRole('alert').textContent).toBe('Informe uma data até 31/12/2026.');
  });
});

describe('the e-mail control', () => {
  it('judges on blur only, with the e-mail sentence, and clears on edit', () => {
    const { input } = show(question('email', { title: 'E-mail' }));
    type(input, 'nome@');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toBe(
      'Informe um e-mail válido, como nome@exemplo.com.br.',
    );
    type(input, 'nome@exemplo.com.br');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(input);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(draftNow()).toBe('nome@exemplo.com.br');
  });
});

describe('the link control', () => {
  it('adds https:// on blur and accepts the result', () => {
    const { input } = show(question('link'));
    type(input, 'exemplo.com.br');
    expect(input.value).toBe('exemplo.com.br');
    fireEvent.blur(input);
    expect(input.value).toBe('https://exemplo.com.br');
    expect(draftNow()).toBe('https://exemplo.com.br');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaves http, https and every other scheme alone, and refuses the others with the link sentence', () => {
    const { input } = show(question('link'));
    type(input, 'http://exemplo.com.br');
    fireEvent.blur(input);
    expect(input.value).toBe('http://exemplo.com.br');
    expect(screen.queryByRole('alert')).toBeNull();
    for (const bad of ['javascript:alert(1)', 'ftp://exemplo.com', 'data:text/html,x']) {
      type(input, bad);
      fireEvent.blur(input);
      expect(input.value).toBe(bad);
      expect(screen.getByRole('alert').textContent).toBe(
        'Informe um link válido, como https://exemplo.com.br.',
      );
    }
  });

  it('refuses a link with a space inside on blur', () => {
    const { input } = show(question('link'));
    type(input, 'exemplo .com');
    fireEvent.blur(input);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('no validation while the member types', () => {
  it('shows no error after any change event of any format control until blur', () => {
    for (const [kind, text] of [
      ['phone', '1'],
      ['email', 'x'],
      ['link', 'x y'],
      ['number', 'abc'],
      ['date', '2026-02-31'],
    ] as const) {
      const { input, unmount } = show(question(kind));
      type(input, text);
      expect(screen.queryByRole('alert')).toBeNull();
      unmount();
    }
  });
});

describe('the professional_id control: the mask appears while typing (quick 261110-ij7)', () => {
  const cro = (extra: Partial<MemberQuestion> = {}) =>
    question('professional_id', { title: 'Registro', limits: { format: 'cro' }, ...extra });
  const cnpj = (extra: Partial<MemberQuestion> = {}) =>
    question('professional_id', { title: 'CNPJ', limits: { format: 'cnpj' }, ...extra });
  const crefito = (extra: Partial<MemberQuestion> = {}) =>
    question('professional_id', { title: 'CREFITO', limits: { format: 'crefito' }, ...extra });
  const CRO_ERROR = 'Informe um registro válido, como CRO-SP 123456.';

  it('keeps the text keyboard attributes, 16px text and a 44px target, with the example as placeholder', () => {
    const { input } = show(cro());
    expect(input.type).toBe('text');
    expect(input.getAttribute('autocapitalize')).toBe('characters');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('enterkeyhint')).toBe('next');
    expect(input.getAttribute('placeholder')).toBe('CRO-SP 123456');
    expect(input.className).toContain('text-base');
    expect(input.className).toContain('min-h-11');
  });

  it('shows the example as a helper line', () => {
    show(cro());
    expect(screen.getByText('Exemplo: CRO-SP 123456')).toBeTruthy();
  });

  it('typing sp123456 into a cro question shows CRO-SP 123456 and stores that text', () => {
    const { input } = show(cro());
    type(input, 's');
    expect(input.value).toBe('CRO-S');
    type(input, 'sp123456');
    expect(input.value).toBe('CRO-SP 123456');
    expect(draftNow()).toBe('CRO-SP 123456');
  });

  it('a tenth digit that does not fit leaves the value unchanged', () => {
    const { input } = show(cro({ answer: 'CRO-SP 123456789' }));
    expect(input.value).toBe('CRO-SP 123456789');
    type(input, 'CRO-SP 1234567890');
    expect(input.value).toBe('CRO-SP 123456789');
    expect(draftNow()).toBe('CRO-SP 123456789');
  });

  it('typing 12ABC into a cnpj question shows 12.ABC', () => {
    const { input } = show(cnpj());
    type(input, '12abc');
    expect(input.value).toBe('12.ABC');
    expect(draftNow()).toBe('12.ABC');
  });

  it('a pasted 12345678000195 shows 12.345.678/0001-95', () => {
    const { input } = show(cnpj());
    type(input, '12345678000195');
    expect(input.value).toBe('12.345.678/0001-95');
    expect(draftNow()).toBe('12.345.678/0001-95');
  });

  it('a crefito question typed digit by digit ends in CREFITO-3/123456-F', () => {
    const { input } = show(crefito());
    let shown = '';
    for (const digit of '3123456') {
      type(input, shown + digit);
      shown = input.value;
    }
    expect(input.value).toBe('CREFITO-3/123456-F');
    expect(draftNow()).toBe('CREFITO-3/123456-F');
  });

  it('shows a stored value as stored', () => {
    expect(show(cnpj({ answer: '12.345.678/0001-95' })).input.value).toBe('12.345.678/0001-95');
  });

  it('judges on blur only, with the catalog sentence, and clears the error on the next edit', () => {
    const { input } = show(cro());
    type(input, 'sp12x');
    expect(screen.queryByRole('alert')).toBeNull();
    type(input, 'xx12');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toBe(CRO_ERROR);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    type(input, 'CRO-XX 123');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a valid value shows no error, and neither does an empty optional field', () => {
    const { input } = show(cro());
    type(input, 'sp123456');
    fireEvent.blur(input);
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
    const empty = show(cro());
    fireEvent.blur(empty.input);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a wrong CNPJ says so with both examples', () => {
    const { input } = show(cnpj());
    type(input, '12.345.678/0001-90');
    fireEvent.blur(input);
    expect(screen.getByRole('alert').textContent).toBe(
      'Informe um CNPJ válido, como 12.345.678/0001-95 ou 12.ABC.345/01DE-35.',
    );
  });

  it('keeps the caret next to the edited character when typing in the middle', () => {
    const { input } = show(cro({ answer: 'CRO-SP 1234' }));
    input.focus();
    // The caret is after the "2" (index 9) and the member types an "8": the new text is CRO-SP 12834.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(input, 'CRO-SP 12834');
    input.setSelectionRange(10, 10);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.value).toBe('CRO-SP 12834');
    expect(input.selectionStart).toBe(10);
    expect(input.selectionEnd).toBe(10);
  });

  it('keeps the caret after a character typed in the middle of a cnpj, across a separator', () => {
    const { input } = show(cnpj({ answer: '12.345' }));
    input.focus();
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    // The caret is after the "1" and the member types a "7": 172.345 re-masks to 17.234.5, caret after the "7".
    setValue?.call(input, '172.345');
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.value).toBe('17.234.5');
    expect(input.selectionStart).toBe(2);
  });

  it('a question with no format falls back to a plain text line', () => {
    const { input } = show(question('professional_id', { title: 'Sem formato' }));
    type(input, 'abc');
    expect(input.value).toBe('abc');
  });
});
