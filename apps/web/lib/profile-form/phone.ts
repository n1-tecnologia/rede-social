/**
 * The Brazilian phone helpers of the member's completion screen (12-13, D-590, UI-D-585).
 *
 * The member sees a mask, `(11) 91234-5678`; what is stored is the national number, digits only. These
 * functions only move between the two: they never judge validity (the contract's `parseAnswer` is the
 * one judge, on the client and on the server) and they never drop a digit the member typed (T-12-31).
 */

/** The longest national number: DDD plus a nine-digit mobile line. */
export const PHONE_MAX_DIGITS = 11;

/** Digits only: spaces, brackets, hyphens, a plus sign and letters are all dropped. */
export function onlyDigits(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * A pasted or typed phone as the national number it names. A leading country code `55` is removed only
 * when 12 or 13 digits remain, i.e. when what is left is the length of a national number: that is the
 * one case where the `55` cannot be a DDD (the DDD 55 exists, and `55912345678` is a complete mobile
 * number). Any other length is returned as the digits that were typed (and fails validation), never
 * truncated and never "fixed".
 */
export function parseBrazilianPhone(raw: string): string {
  const digits = onlyDigits(raw);
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return digits.slice(2);
  }
  return digits;
}

/**
 * The mask of a digit string, progressively: `1` is `(1`, `11` is `(11`, `119` is `(11) 9`, ten digits
 * are `(11) 1234-5678` and eleven are `(11) 91234-5678`. More than eleven digits are cut at eleven (the
 * control refuses a change that would need the cut, so the cut never loses what a member typed).
 */
export function phoneMask(digits: string): string {
  const d = onlyDigits(digits).slice(0, PHONE_MAX_DIGITS);
  if (d === '') return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const head = d.length === PHONE_MAX_DIGITS ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, head)}-${rest.slice(head)}`;
}

/** Where the caret goes in `masked` once `count` digits are to its left (the mask characters follow). */
export function caretAfterDigits(masked: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < masked.length; index += 1) {
    if (/\d/.test(masked.charAt(index))) {
      seen += 1;
      if (seen === count) return index + 1;
    }
  }
  return masked.length;
}
