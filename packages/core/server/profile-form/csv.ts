import type { ProfileFormType } from '@rede-social/contracts/profile-form';

/**
 * The CSV writer of the profile-form export (Phase 12, D-595, PFORM-21): PURE, no database, no clock.
 *
 * pt-BR SPREADSHEETS (PU-9 default, assumption A1 of the research). The delimiter is `;` (Excel in a
 * pt-BR locale splits on it, because the comma is the decimal separator there), the file starts with a
 * UTF-8 byte-order mark so Excel reads accents as UTF-8, and every record ends with CRLF (RFC 4180).
 * Whether Excel and Google Sheets open the file cleanly is a manual row; the tests pin the bytes.
 *
 * FORMULA INJECTION (T-12-24, OWASP CSV Injection). Names, e-mails, question titles (the HEADER cells)
 * and text answers are attacker-controlled text that a spreadsheet may execute. A cell whose text begins
 * with `=`, `+`, `-`, `@`, a tab, a carriage return or a line feed, or with their full-width forms, is
 * prefixed with a single quote INSIDE the quoted field, on EVERY cell including the header. The one
 * exception is `numeric`: a value written from the stored JSON number of a `number` question is data
 * (`-3` is minus three), and is written untouched, but only when its text really is a plain pt-BR
 * number; anything else that claims to be numeric is neutralised like text.
 */

/** The byte-order mark (U+FEFF), written as an escape so no invisible character lives in the source. */
export const CSV_BOM = '\uFEFF';

/** The field delimiter of a pt-BR spreadsheet. */
export const CSV_DELIMITER = ';';

/** The record terminator. */
export const CSV_EOL = '\r\n';

/**
 * Characters that make a spreadsheet read a cell as a formula (OWASP): `=`, `+`, `-`, `@`, TAB, CR, LF
 * and the full-width `＝` (U+FF1D), `＋` (U+FF0B), `－` (U+FF0D), `＠` (U+FF20), written as escapes.
 */
const TRIGGER = /^[=+\-@\t\r\n＝＋－＠]/;

/** What a number cell looks like once written: an optional minus, digits, an optional comma decimal. */
const PLAIN_NUMBER = /^-?\d+(,\d+)?$/;

/** A cell that must be quoted: it holds the delimiter, a quote, a CR or a LF. */
const NEEDS_QUOTES = /[;"\r\n]/;

/**
 * One cell: neutralise first, then RFC 4180 quoting. A quote inside is doubled. A neutralised cell is
 * always quoted so the leading `'` sits inside the quoted field, as OWASP advises.
 */
export function csvCell(text: string, opts: { numeric?: boolean } = {}): string {
  const plainNumber = opts.numeric === true && PLAIN_NUMBER.test(text);
  const neutralised = !plainNumber && TRIGGER.test(text);
  const safe = neutralised ? `'${text}` : text;
  if (neutralised || NEEDS_QUOTES.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

/** One record: the cells joined with the delimiter, CRLF terminated. */
export function csvRow(cells: readonly string[]): string {
  return `${cells.join(CSV_DELIMITER)}${CSV_EOL}`;
}

/** What `answerText` needs of a question: its type and the labels of its options. */
export type ExportQuestion = {
  type: ProfileFormType;
  options: readonly { id: string; label: string }[];
};

export type AnswerCell = {
  /** The text of the cell BEFORE `csvCell`. */
  text: string;
  /** True only for the stored JSON number of a `number` question. */
  numeric: boolean;
};

const EMPTY: AnswerCell = { text: '', numeric: false };
const text = (value: string): AnswerCell => ({ text: value, numeric: false });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `(11) 91234-5678` for eleven digits, `(11) 1234-5678` for ten; anything else as stored. */
function phoneText(digits: string): string {
  if (/^\d{11}$/.test(digits))
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (/^\d{10}$/.test(digits))
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits;
}

/** `2026-10-29` to `29/10/2026`; anything that is not an ISO day stays as stored. */
function dateText(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

/** A number with a comma decimal and no thousands separator. */
function numberText(value: number): string {
  return (value + 0).toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 20 });
}

/** The chosen labels, in the question's own option order, plus `Outro: <text>`. */
function choiceText(
  question: ExportQuestion,
  ids: readonly unknown[],
  otherText: unknown,
): AnswerCell {
  const picked = new Set(ids.filter((id): id is string => typeof id === 'string'));
  const labels = question.options.filter((option) => picked.has(option.id)).map((o) => o.label);
  if (typeof otherText === 'string' && otherText !== '') labels.push(`Outro: ${otherText}`);
  return text(labels.join(', '));
}

/**
 * The text of one stored answer for the export, per type. A missing answer, or a stored shape that does
 * not match the question's type, is an empty cell: the writer never throws on stored data.
 *
 * `numeric` is true ONLY for a `number` question's value, so `csvCell` can leave a negative number alone.
 */
export function answerText(question: ExportQuestion, value: unknown): AnswerCell {
  if (value === null || value === undefined) return EMPTY;
  switch (question.type) {
    case 'short_text':
    case 'long_text':
    case 'email':
    case 'link':
    case 'professional_id':
      return typeof value === 'string' ? text(value) : EMPTY;
    case 'dropdown':
    case 'single_choice': {
      if (!isRecord(value)) return EMPTY;
      const id = value.optionId;
      return choiceText(question, typeof id === 'string' ? [id] : [], value.otherText);
    }
    case 'multiple_choice': {
      if (!isRecord(value)) return EMPTY;
      const ids = Array.isArray(value.optionIds) ? value.optionIds : [];
      return choiceText(question, ids, value.otherText);
    }
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? { text: numberText(value), numeric: true }
        : EMPTY;
    case 'date':
      return typeof value === 'string' ? text(dateText(value)) : EMPTY;
    case 'phone':
      return typeof value === 'string' ? text(phoneText(value)) : EMPTY;
    case 'yes_no':
      return typeof value === 'boolean' ? text(value ? 'Sim' : 'Não') : EMPTY;
    case 'acceptance':
      return value === true ? text('Aceito') : EMPTY;
    case 'rating':
      return typeof value === 'number' && Number.isInteger(value) ? text(String(value)) : EMPTY;
  }
}
