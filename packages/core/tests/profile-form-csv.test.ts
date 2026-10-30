import { PROFILE_FORM_TYPES } from '@rede-social/contracts/profile-form';
import { describe, expect, it } from 'vitest';
import {
  answerText,
  CSV_BOM,
  CSV_DELIMITER,
  csvCell,
  csvRow,
  type ExportQuestion,
} from '../server/profile-form/csv';

/**
 * 12-10 (D-595, PFORM-21, T-12-24): the export's CSV writer, with no database and no mocks. The OWASP
 * payload list is the proof that no cell, header included, can start a formula.
 */

/** The characters a spreadsheet reads as the start of a formula (OWASP), full-width forms included. */
const TRIGGERS = ['=', '+', '-', '@', '\t', '\r', '\n', '＝', '＋', '－', '＠'];

/** The text of a field with its RFC 4180 quoting removed, as a spreadsheet would read it. */
function unquote(cell: string): string {
  return cell.startsWith('"') && cell.endsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
}

describe('csvCell: neutralisation (T-12-24)', () => {
  it.each([
    ['=', '=1+1'],
    ['+', '+1+1'],
    ['-', '-2+3'],
    ['@', '@SUM(A1)'],
    ['tab', '\t=1+1'],
    ['carriage return', '\r=1+1'],
    ['line feed', '\n=1+1'],
    ['full-width equals', '＝1+1'],
    ['full-width plus', '＋1+1'],
    ['full-width minus', '－1+1'],
    ['full-width at', '＠SUM(A1)'],
  ])(
    'prefixes a single quote inside the quoted field when the text begins with %s',
    (_name, input) => {
      const cell = csvCell(input);
      expect(cell.startsWith('"\'')).toBe(true);
      expect(cell.endsWith('"')).toBe(true);
      expect(unquote(cell)).toBe(`'${input}`);
    },
  );

  it('leaves a cell that merely CONTAINS a trigger later in the text alone (adjacency)', () => {
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('1+1')).toBe('1+1');
    expect(csvCell('ana@exemplo.com')).toBe('ana@exemplo.com');
    expect(csvCell('x-y')).toBe('x-y');
    expect(csvCell(' =1')).toBe(' =1');
  });

  it('doubles an inner quote and quotes a cell holding the delimiter, a quote, CR or LF', () => {
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('linha 1\nlinha 2')).toBe('"linha 1\nlinha 2"');
    expect(csvCell('linha 1\r\nlinha 2')).toBe('"linha 1\r\nlinha 2"');
    expect(csvCell('a,b')).toBe('a,b');
    expect(csvCell('')).toBe('');
    expect(csvCell('Ana Souza')).toBe('Ana Souza');
  });

  it('with numeric: true writes a plain negative number untouched', () => {
    expect(csvCell('-3', { numeric: true })).toBe('-3');
    expect(csvCell('-3,5', { numeric: true })).toBe('-3,5');
    expect(csvCell('42', { numeric: true })).toBe('42');
  });

  it('numeric is not a bypass: text that is not a plain number is neutralised even when flagged', () => {
    expect(csvCell('-2+3', { numeric: true })).toBe('"\'-2+3"');
    expect(csvCell('=1+1', { numeric: true })).toBe('"\'=1+1"');
    expect(csvCell('-3', { numeric: false })).toBe('"\'-3"');
    expect(csvCell('-3')).toBe('"\'-3"');
  });
});

describe('csvCell: the OWASP payload suite', () => {
  const PAYLOADS = [
    "=cmd|' /C calc'!A0",
    '+1+1',
    '-2+3',
    '@SUM(A1)',
    '\t=1+1',
    '=HYPERLINK("http://evil","x")',
    '＝1+1',
    '\r=1+1',
    '\n@A1',
    '=1+1;=2+2',
    '＋SUM(A1)',
    '＠SUM(A1)',
  ];

  it('has at least seven payloads', () => {
    expect(PAYLOADS.length).toBeGreaterThanOrEqual(7);
  });

  it.each(PAYLOADS)(
    'payload %j never produces a cell whose first character is a trigger',
    (payload) => {
      const cell = csvCell(payload);
      const text = unquote(cell);
      expect(TRIGGERS.includes(text.charAt(0))).toBe(false);
      expect(text.charAt(0)).toBe("'");
      // The cell itself starts with the opening quote, never with a trigger either.
      expect(TRIGGERS.includes(cell.charAt(0))).toBe(false);
      // Nothing is lost: the original text follows the prefix.
      expect(text.slice(1)).toBe(payload);
    },
  );

  it('the same payloads are neutralised as HEADER cells (a question title is admin text)', () => {
    const header = csvRow(['Nome', 'E-mail', ...PAYLOADS.map((p) => csvCell(p))]);
    const body = header.slice(0, -2);
    expect(body.startsWith('Nome;E-mail;')).toBe(true);
    for (const payload of PAYLOADS) {
      expect(body).toContain(`'${payload.replace(/"/g, '""')}`);
    }
  });
});

describe('csvRow and the file frame', () => {
  it('joins with the semicolon and ends with CRLF', () => {
    expect(CSV_DELIMITER).toBe(';');
    expect(csvRow(['a', 'b', 'c'])).toBe('a;b;c\r\n');
    expect(csvRow([])).toBe('\r\n');
    expect(csvRow([csvCell('a;b'), csvCell('c')])).toBe('"a;b";c\r\n');
  });

  it('the byte-order mark is U+FEFF and encodes to EF BB BF in UTF-8', () => {
    expect(CSV_BOM).toBe('﻿');
    expect(Array.from(new TextEncoder().encode(CSV_BOM))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('a header-only file is the BOM and one CRLF-terminated header record', () => {
    const file = CSV_BOM + csvRow(['Nome', 'E-mail']);
    expect(file).toBe('﻿Nome;E-mail\r\n');
  });
});

describe('answerText: the thirteen types', () => {
  const options = [
    { id: 'o1', label: 'Azul' },
    { id: 'o2', label: 'Verde' },
    { id: 'o3', label: 'Vermelho, escuro' },
  ];
  const q = (type: ExportQuestion['type']): ExportQuestion => ({ type, options });

  it('covers every one of the thirteen types', () => {
    expect(PROFILE_FORM_TYPES).toHaveLength(13);
    for (const type of PROFILE_FORM_TYPES) {
      expect(() => answerText(q(type), null)).not.toThrow();
      expect(answerText(q(type), null).text).toBe('');
    }
  });

  it('renders text types as stored', () => {
    expect(answerText(q('short_text'), 'Ana').text).toBe('Ana');
    expect(answerText(q('long_text'), 'linha 1\nlinha 2').text).toBe('linha 1\nlinha 2');
    expect(answerText(q('email'), 'ana@exemplo.com').text).toBe('ana@exemplo.com');
    expect(answerText(q('link'), 'https://exemplo.com/a?b=1').text).toBe(
      'https://exemplo.com/a?b=1',
    );
  });

  it('renders a single choice and a dropdown as the label, or Outro: text', () => {
    expect(answerText(q('single_choice'), { optionId: 'o2', otherText: null }).text).toBe('Verde');
    expect(answerText(q('dropdown'), { optionId: 'o1', otherText: null }).text).toBe('Azul');
    expect(answerText(q('single_choice'), { optionId: null, otherText: 'Roxo' }).text).toBe(
      'Outro: Roxo',
    );
  });

  it('renders a multiple choice as the labels joined with ", " in the question order, plus Outro', () => {
    expect(
      answerText(q('multiple_choice'), { optionIds: ['o2', 'o1'], otherText: null }).text,
    ).toBe('Azul, Verde');
    expect(answerText(q('multiple_choice'), { optionIds: ['o1'], otherText: 'Roxo' }).text).toBe(
      'Azul, Outro: Roxo',
    );
    expect(answerText(q('multiple_choice'), { optionIds: [], otherText: 'Roxo' }).text).toBe(
      'Outro: Roxo',
    );
  });

  it('a stored option id the question no longer lists reads as an empty cell, not a crash', () => {
    expect(answerText(q('single_choice'), { optionId: 'gone', otherText: null }).text).toBe('');
    expect(answerText(q('multiple_choice'), { optionIds: ['gone'], otherText: null }).text).toBe(
      '',
    );
  });

  it('renders a date as dd/MM/yyyy', () => {
    expect(answerText(q('date'), '2026-10-29').text).toBe('29/10/2026');
  });

  it('renders yes/no as Sim/Não, acceptance as Aceito and rating as the integer', () => {
    expect(answerText(q('yes_no'), true).text).toBe('Sim');
    expect(answerText(q('yes_no'), false).text).toBe('Não');
    expect(answerText(q('acceptance'), true).text).toBe('Aceito');
    expect(answerText(q('rating'), 4).text).toBe('4');
  });

  it('renders a number with a comma decimal, no thousands separator, and flags only it as numeric', () => {
    expect(answerText(q('number'), 3.5)).toEqual({ text: '3,5', numeric: true });
    expect(answerText(q('number'), -3)).toEqual({ text: '-3', numeric: true });
    expect(answerText(q('number'), 1234567.25)).toEqual({ text: '1234567,25', numeric: true });
    expect(answerText(q('number'), -0)).toEqual({ text: '0', numeric: true });
    for (const type of PROFILE_FORM_TYPES) {
      if (type === 'number') continue;
      const sample = answerText(q(type), type === 'rating' ? 3 : 'x');
      expect(sample.numeric).toBe(false);
    }
  });

  it('renders a phone as (11) 91234-5678, a landline as (11) 1234-5678', () => {
    expect(answerText(q('phone'), '11912345678').text).toBe('(11) 91234-5678');
    expect(answerText(q('phone'), '1112345678').text).toBe('(11) 1234-5678');
  });

  it('an answer whose shape does not match the type is an empty cell, never an exception', () => {
    expect(answerText(q('number'), 'abc').text).toBe('');
    expect(answerText(q('single_choice'), 'o1').text).toBe('');
    expect(answerText(q('yes_no'), 'sim').text).toBe('');
    expect(answerText(q('rating'), 2.5).text).toBe('');
  });

  it('a negative number answer survives the writer, a text answer that looks like one does not', () => {
    const number = answerText(q('number'), -3);
    expect(csvCell(number.text, { numeric: number.numeric })).toBe('-3');
    const typed = answerText(q('short_text'), '-3');
    expect(csvCell(typed.text, { numeric: typed.numeric })).toBe('"\'-3"');
  });
});

describe('encoding and determinism', () => {
  it('accents and emoji survive the writer and a UTF-8 round trip', () => {
    const row = csvRow([csvCell('José Conceição'), csvCell('olá 🎉 mundo'), csvCell('日本語')]);
    expect(row).toBe('José Conceição;olá 🎉 mundo;日本語\r\n');
    const bytes = new TextEncoder().encode(CSV_BOM + row);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(CSV_BOM + row);
  });

  it('the same input twice yields identical output', () => {
    const build = () =>
      CSV_BOM +
      csvRow(['Nome', 'E-mail', csvCell('=título')]) +
      csvRow([csvCell('Ana; "A"'), csvCell('ana@exemplo.com'), csvCell('-3', { numeric: true })]);
    expect(build()).toBe(build());
  });
});
