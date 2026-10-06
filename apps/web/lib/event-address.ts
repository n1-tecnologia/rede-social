/**
 * PDF item #10: the in-person address as SEPARATE parts (CEP, rua, número, complemento, bairro,
 * cidade, UF), stored in the ONE `address` string the events contract already carries
 * (`EVENT_MAX_ADDRESS`, 300). Front-only on purpose: the API, the contract and the column stay a
 * free string, so this module IS the whole convention. It is pure (no `'use client'`): the form
 * composes with it, and the server readers (`events-view`, `events-calendar`) parse with it.
 *
 * **The canonical format**, one group per line, so the detail page's `whitespace-pre-line` prints
 * the block a Brazilian envelope reads:
 *
 *   Avenida Paulista, 1578        `{rua}, {número}`, an empty número stored as `s/n`
 *   Sala 12, bloco B              `{complemento}`, only when there is one
 *   Bela Vista, São Paulo - SP    `[{bairro}, ]{cidade} - {UF}`
 *   CEP 01310-200
 *
 * **Parsing is an exact round trip.** `parseEventAddress` accepts a string only when composing the
 * parts it read gives the SAME string back; anything else is `null`: the legacy free text every
 * event written before this format holds, and whatever another writer (the seed, the API directly)
 * stores. That is what lets the edit form tell the two apart, and what keeps a hand-typed address
 * from being misread as parts.
 *
 * Why the format holds: a part never carries a line break (whitespace is collapsed), the número
 * never carries `, ` (so the LAST `, ` of line 1 splits rua from número), the cidade never carries
 * a comma (so the LAST `, ` of the place line ends the bairro, which may itself hold `, ` and
 * ` - `), and the UF is one of the 27, anchored at the end.
 *
 * The tokens `CEP `, ` - ` and `s/n` are a STORAGE format, so they live here and never in the
 * catalog: a copy edit must not orphan the addresses already stored.
 *
 * Worst case under `ADDRESS_CAPS`: 112 + 1 + 60 + 1 + 107 + 1 + 13 = 295 UTF-16 units, inside
 * `EVENT_MAX_ADDRESS` (the unit `maxLength` and the contract's `.max()` both count).
 */

/** The 27 federative units (26 states and the DF), as ViaCEP and the Correios spell them. */
export const UFS = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;
export type Uf = (typeof UFS)[number];

/** Per-part caps in UTF-16 units (the form's `maxLength`); the UF is 2 letters, the CEP 8 digits. */
export const ADDRESS_CAPS = {
  street: 100,
  number: 10,
  complement: 60,
  district: 60,
  city: 40,
} as const;

/** The form's parts. `cep` holds DIGITS only; `number` is `''` for "sem número". */
export type AddressParts = {
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
};

export const EMPTY_ADDRESS_PARTS: AddressParts = {
  cep: '',
  street: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
};

/** A required part that is missing or invalid. */
export type AddressIssue = 'cep' | 'street' | 'city' | 'state';

/** How an empty número is stored, and how it reads back. */
const NO_NUMBER = 's/n';
/** "s/n", "S/N", "sn", "s/n.": the admin's own spelling of "sem número" is stored the one way. */
const NO_NUMBER_RE = /^s\/?n\.?$/i;
const CEP_RE = /^\d{8}$/;
const CEP_LINE_RE = /^CEP (\d{5})-(\d{3})$/;
const PLACE_LINE_RE = new RegExp(`^(?:(.+), )?([^,]+) - (${UFS.join('|')})$`);

export const isUf = (value: string): value is Uf => (UFS as readonly string[]).includes(value);

/** Exactly 8 digits, the only CEP the lookup and the format accept. */
export const isCep = (value: string): boolean => CEP_RE.test(value);

/** The digits of whatever was typed or pasted, at most 8 (`01310-200` and `01.310-200` alike). */
export const cepDigits = (value: string): string => value.replace(/\D/g, '').slice(0, 8);

/** `01310-200` as the admin types: the hyphen appears with the 6th digit. */
export function formatCep(value: string): string {
  const digits = cepDigits(value);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

/** The first CEP in a free text (`01310-200`, `01310200` or `01.310-200`) as digits, or `''`. */
export function extractCep(text: string): string {
  const match = /\b(\d{2})\.?(\d{3})-?(\d{3})\b/.exec(text);
  return match ? `${match[1] ?? ''}${match[2] ?? ''}${match[3] ?? ''}` : '';
}

/** Collapses every run of whitespace (line breaks included) and trims. */
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

/** The parts as they are stored: collapsed, the número spelled once, the cidade comma-free. */
function normalized(parts: AddressParts): AddressParts {
  const number = clean(parts.number).replace(/,\s+/g, ',');
  return {
    cep: cepDigits(parts.cep),
    street: clean(parts.street),
    number: number === '' || NO_NUMBER_RE.test(number) ? NO_NUMBER : number,
    complement: clean(parts.complement),
    district: clean(parts.district),
    city: clean(parts.city.replace(/,/g, ' ')),
    state: clean(parts.state).toUpperCase(),
  };
}

/** The required parts that are missing or invalid: CEP (8 digits), rua, cidade and UF. */
export function addressIssues(parts: AddressParts): AddressIssue[] {
  const value = normalized(parts);
  const issues: AddressIssue[] = [];
  if (!isCep(value.cep)) issues.push('cep');
  if (value.street === '') issues.push('street');
  if (value.city === '') issues.push('city');
  if (!isUf(value.state)) issues.push('state');
  return issues;
}

/** The canonical multi-line string (module docblock). Meant for parts with no `addressIssues`. */
export function composeEventAddress(parts: AddressParts): string {
  const value = normalized(parts);
  return [
    `${value.street}, ${value.number}`,
    ...(value.complement === '' ? [] : [value.complement]),
    `${value.district === '' ? '' : `${value.district}, `}${value.city} - ${value.state}`,
    `CEP ${formatCep(value.cep)}`,
  ].join('\n');
}

/** The parts of a canonical string, or `null` for anything else (legacy free text). */
export function parseEventAddress(value: string): AddressParts | null {
  const lines = value.split('\n');
  if (lines.length !== 3 && lines.length !== 4) return null;
  const cep = CEP_LINE_RE.exec(lines[lines.length - 1] ?? '');
  const place = PLACE_LINE_RE.exec(lines[lines.length - 2] ?? '');
  const first = lines[0] ?? '';
  const comma = first.lastIndexOf(', ');
  if (!cep || !place || comma <= 0) return null;
  const number = first.slice(comma + 2);
  const parts: AddressParts = {
    cep: `${cep[1] ?? ''}${cep[2] ?? ''}`,
    street: first.slice(0, comma),
    number: number === NO_NUMBER ? '' : number,
    complement: lines.length === 4 ? (lines[1] ?? '') : '',
    district: place[1] ?? '',
    city: place[2] ?? '',
    state: place[3] ?? '',
  };
  return composeEventAddress(parts) === value ? parts : null;
}

/** `{rua}, {número}[, {complemento}][ - {bairro}], {cidade} - {UF}, 00000-000`. */
function oneLine(parts: AddressParts, withComplement: boolean): string {
  const value = normalized(parts);
  const complement = withComplement && value.complement !== '' ? `, ${value.complement}` : '';
  const district = value.district === '' ? '' : ` - ${value.district}`;
  const place = `${value.city} - ${value.state}, ${formatCep(value.cep)}`;
  return `${value.street}, ${value.number}${complement}${district}, ${place}`;
}

/**
 * The Google Maps search query, in Google's Brazilian order and without the complemento (a room
 * number only blurs the match): `Avenida Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200`.
 */
export const addressMapsQuery = (parts: AddressParts): string => oneLine(parts, false);

/** The same line WITH the complemento after the número, for a calendar's LOCATION. */
export const addressOneLine = (parts: AddressParts): string => oneLine(parts, true);
