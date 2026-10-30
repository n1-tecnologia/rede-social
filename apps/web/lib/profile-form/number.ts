/**
 * The pt-BR number helpers of the member's completion screen (12-13, D-590, UI-D-585).
 *
 * The rule for what a Brazilian member means by `1.234,5`, `1234,5`, `1.234` or `1.5` is written down
 * once, here, and an ambiguous text is parsed by that rule or refused, never guessed (T-12-31):
 *
 *  - a comma is the decimal mark when it is present, and dots are then thousands separators, which must
 *    be well formed (`1.234,5` is 1234.5; `1.2,5` is refused);
 *  - with no comma, a dot is a thousands separator only when the text is a well-formed group of three
 *    (`1.234`, `12.345.678`, first group 1 to 3 digits and not starting with a zero); otherwise it is the
 *    decimal mark (`1.5` is 1.5, `1.23` is 1.23, `0.500` is 0.5);
 *  - an optional leading minus; anything else (letters, an exponent, two commas, spaces inside, a lone
 *    mark at the end, an empty string) is refused.
 */

const WITH_COMMA = /^-?(?:[1-9]\d{0,2}(?:\.\d{3})+|\d+),\d+$/;
const THOUSANDS_ONLY = /^-?[1-9]\d{0,2}(?:\.\d{3})+$/;
const PLAIN = /^-?\d+(?:\.\d+)?$/;

/** The number the text names under the rule above, or `null` when the text is not a number. */
export function parseNumberPtBr(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  let normalised: string;
  if (text.includes(',')) {
    if (!WITH_COMMA.test(text)) return null;
    normalised = text.replace(/\./g, '').replace(',', '.');
  } else if (THOUSANDS_ONLY.test(text)) {
    normalised = text.replace(/\./g, '');
  } else if (PLAIN.test(text)) {
    normalised = text;
  } else {
    return null;
  }
  const value = Number(normalised);
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return null;
  // `-0 + 0` is `+0`: one form for zero.
  return value + 0;
}

/** A number as the member sees it back: the comma is the decimal mark and there is no thousands mark. */
export function formatNumberPtBr(value: number): string {
  return value.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 20 });
}
