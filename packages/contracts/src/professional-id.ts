/**
 * The professional registry / CNPJ mask engine (quick 261110-ij7, D-591). Pure, no Node imports, linear time:
 * the web runs `layoutProfessionalId` on every keystroke and `parseAnswer` runs `canonicalizeProfessionalId`,
 * so the mask a member sees and the judge that stores the answer are the same engine (T-12-05).
 *
 * Format only, never a registry lookup: the councils are not consulted. The canonical text is the masked,
 * upper-case text exactly as the mask displays it, and it is what is stored.
 */

/** The eight formats, in the order of the builder list and the catalog. */
export const PROFESSIONAL_ID_FORMATS = [
  'cro',
  'crm',
  'crbm',
  'crf',
  'coren',
  'crefito',
  'crbio',
  'cnpj',
] as const;
export type ProfessionalIdFormat = (typeof PROFESSIONAL_ID_FORMATS)[number];

/** The 27 real Brazilian UF codes. */
export const BRAZILIAN_UF_CODES = [
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

/**
 * One example per format (a `Record`, so a new format is a compile error until it has one). Each one passes
 * its own judge. The CNPJ example ends in 95: the check digits of 12.345.678/0001 are 95, not 90.
 */
export const PROFESSIONAL_ID_EXAMPLES: Record<ProfessionalIdFormat, string> = {
  cro: 'CRO-SP 123456',
  crm: 'CRM-SP 123456',
  crbm: 'CRBM-1 12345',
  crf: 'CRF-SP 123456',
  coren: 'COREN-SP 123456',
  crefito: 'CREFITO-3/123456-F',
  crbio: '003566/01-D',
  cnpj: '12.345.678/0001-95',
};

/** Only the first 64 UTF-16 units of a raw value are read; a longer one is refused by the judge. */
export const PROFESSIONAL_ID_MAX_INPUT = 64;

export type ProfessionalIdLayout = {
  /** The masked, upper-case text. */
  text: string;
  /** How many characters were placed in a slot. */
  consumed: number;
  /** How many significant characters there were (the council tag and the crefito suffix excluded). */
  total: number;
  /** For each placed character, the index in `text` just after it (the web keeps the caret with it). */
  ends: number[];
};

const TAGS: Record<ProfessionalIdFormat, string> = {
  cro: 'CRO',
  crm: 'CRM',
  crbm: 'CRBM',
  crf: 'CRF',
  coren: 'COREN',
  crefito: 'CREFITO',
  crbio: 'CRBIO',
  cnpj: '',
};

const MAX_NUMBER_DIGITS = 9;

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isLetter = (c: string): boolean => c >= 'A' && c <= 'Z';

/**
 * ASCII letters and digits only, upper-cased. The filter runs BEFORE the upper-casing, so a character such
 * as the German sharp s can never turn into letters. `keepSlash` keeps "/" (crefito: it ends the region).
 */
function significant(raw: string, keepSlash: boolean): string {
  const limit = Math.min(raw.length, PROFESSIONAL_ID_MAX_INPUT);
  let out = '';
  for (let i = 0; i < limit; i += 1) {
    const code = raw.charCodeAt(i);
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90)) out += raw[i];
    else if (code >= 97 && code <= 122) out += String.fromCharCode(code - 32);
    else if (keepSlash && code === 47) out += '/';
  }
  return out;
}

type Kind = 'd' | 'l' | 'a';

const repeat = (kind: Kind, n: number): Kind[] => Array.from({ length: n }, () => kind);

const SLOT_KINDS: Record<Exclude<ProfessionalIdFormat, 'crefito'>, Kind[]> = {
  cro: [...repeat('l', 2), ...repeat('d', MAX_NUMBER_DIGITS)],
  crm: [...repeat('l', 2), ...repeat('d', MAX_NUMBER_DIGITS)],
  crf: [...repeat('l', 2), ...repeat('d', MAX_NUMBER_DIGITS)],
  coren: [...repeat('l', 2), ...repeat('d', MAX_NUMBER_DIGITS)],
  crbm: repeat('d', 1 + MAX_NUMBER_DIGITS),
  crbio: [...repeat('d', 8), 'l'],
  cnpj: [...repeat('a', 12), ...repeat('d', 2)],
};

const matches = (kind: Kind, c: string): boolean =>
  kind === 'd' ? isDigit(c) : kind === 'l' ? isLetter(c) : isDigit(c) || isLetter(c);

/** The literal written just before the i-th placed character (lazy: never a dangling separator). */
function literalBefore(format: ProfessionalIdFormat, i: number): string {
  switch (format) {
    case 'cro':
    case 'crm':
    case 'crf':
    case 'coren':
      return i === 0 ? `${TAGS[format]}-` : i === 2 ? ' ' : '';
    case 'crbm':
      return i === 0 ? 'CRBM-' : i === 1 ? ' ' : '';
    case 'crbio':
      return i === 6 ? '/' : i === 8 ? '-' : '';
    case 'cnpj':
      return i === 2 || i === 5 ? '.' : i === 8 ? '/' : i === 12 ? '-' : '';
    case 'crefito':
      return '';
  }
}

type Analysis = {
  placed: string[];
  /** How many of the placed characters belong to the head (UF letters, region digits). */
  headLength: number;
  total: number;
  /** crefito only: the member typed the "/" that ends the region. */
  slashTyped: boolean;
};

function analyzeSlots(format: Exclude<ProfessionalIdFormat, 'crefito'>, raw: string): Analysis {
  let sig = significant(raw, false);
  const tag = TAGS[format];
  if (tag !== '' && sig.startsWith(tag)) sig = sig.slice(tag.length);
  const kinds = SLOT_KINDS[format];
  const placed: string[] = [];
  for (const c of sig) {
    const kind = kinds[placed.length];
    if (kind !== undefined && matches(kind, c)) placed.push(c);
  }
  const headLength = format === 'crbm' ? 1 : 2;
  return { placed, headLength, total: sig.length, slashTyped: false };
}

/**
 * crefito: CREFITO-R/NUMERO-F. With a "/" typed after at least one digit, the region is the digits before
 * it (two placed at most) and the number the digits after it. Without one, the region closes by itself after
 * one digit that is not 1 or after two digits (a first 1 stays open so 12 can be typed). One trailing F that
 * follows the number digits is the suffix, not data.
 */
function analyzeCrefito(raw: string): Analysis {
  let sig = significant(raw, true);
  if (sig.startsWith(TAGS.crefito)) sig = sig.slice(TAGS.crefito.length);
  const region: string[] = [];
  const number: string[] = [];
  let total = 0;

  let slashAt = -1;
  let sawDigit = false;
  for (let i = 0; i < sig.length; i += 1) {
    const c = sig[i] as string;
    if (c === '/' && sawDigit) {
      slashAt = i;
      break;
    }
    if (isDigit(c)) sawDigit = true;
  }

  let regionClosed = false;
  for (let i = 0; i < sig.length; i += 1) {
    const c = sig[i] as string;
    if (i === slashAt) continue; // the terminator: neither placed nor counted
    const inRegion = slashAt >= 0 ? i < slashAt : !regionClosed;
    if (inRegion) {
      total += 1;
      if (isDigit(c) && region.length < 2) {
        region.push(c);
        if (slashAt < 0 && (c !== '1' || region.length === 2)) regionClosed = true;
      }
      continue;
    }
    if (isDigit(c)) {
      total += 1;
      if (number.length < MAX_NUMBER_DIGITS) number.push(c);
      continue;
    }
    if (c === 'F' && i === sig.length - 1 && number.length > 0) continue; // the suffix
    total += 1;
  }
  return {
    placed: [...region, ...number],
    headLength: region.length,
    total,
    slashTyped: slashAt >= 0,
  };
}

function analyze(format: ProfessionalIdFormat, raw: string): Analysis {
  return format === 'crefito' ? analyzeCrefito(raw) : analyzeSlots(format, raw);
}

function layoutOf(format: ProfessionalIdFormat, analysis: Analysis): ProfessionalIdLayout {
  const { placed } = analysis;
  let text = '';
  const ends: number[] = [];
  placed.forEach((c, i) => {
    if (format === 'crefito') {
      if (i === 0) text += 'CREFITO-';
      else if (i === analysis.headLength) text += '/';
    } else {
      text += literalBefore(format, i);
    }
    text += c;
    ends.push(text.length);
  });
  if (format === 'crefito' && placed.length > 0) {
    if (placed.length > analysis.headLength) text += '-F';
    else if (analysis.slashTyped) text += '/';
  }
  return { text, consumed: placed.length, total: analysis.total, ends };
}

/** The masked text for `raw` plus what the web needs to keep the caret. Never throws. */
export function layoutProfessionalId(
  format: ProfessionalIdFormat,
  raw: string,
): ProfessionalIdLayout {
  return layoutOf(format, analyze(format, raw));
}

/** The masked text only. */
export function formatProfessionalId(format: ProfessionalIdFormat, raw: string): string {
  return layoutProfessionalId(format, raw).text;
}

const UF_SET: ReadonlySet<string> = new Set(BRAZILIAN_UF_CODES);

/**
 * The two CNPJ check digits of the first 12 upper-case base characters. The value of a character is its
 * ASCII code minus 48 (digits 0 to 9, letters A=17 to Z=42), so the traditional all-digit CNPJ is the
 * same rule. Weights 5,4,3,2,9,8,7,6,5,4,3,2 then 6,5,4,3,2,9,8,7,6,5,4,3,2; a remainder below 2 gives 0.
 */
export function cnpjCheckDigits(base: string): string {
  const values = Array.from(base.slice(0, 12), (c) => c.charCodeAt(0) - 48);
  const digit = (weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i += 1) {
      sum += (values[i] as number) * (weights[i] as number);
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = digit([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  values.push(first);
  const second = digit([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${first}${second}`;
}

function semanticOk(format: ProfessionalIdFormat, analysis: Analysis): boolean {
  const { placed, headLength } = analysis;
  const head = placed.slice(0, headLength).join('');
  switch (format) {
    case 'cro':
    case 'crm':
    case 'crf':
    case 'coren':
      return placed.length >= 3 && UF_SET.has(head);
    case 'crbm':
      return placed.length >= 2 && head >= '1' && head <= '9';
    case 'crefito': {
      if (placed.length <= headLength || head === '' || head.startsWith('0')) return false;
      const region = Number(head);
      return region >= 1 && region <= 19;
    }
    case 'crbio':
      return placed.length === 9;
    case 'cnpj': {
      if (placed.length !== 14) return false;
      if (new Set(placed).size === 1) return false;
      return cnpjCheckDigits(placed.slice(0, 12).join('')) === placed.slice(12).join('');
    }
  }
}

/**
 * The judge: the canonical masked text for `raw`, or `null` when `raw` is not a valid registry of `format`.
 * Null for an input longer than 64 units, for anything that would have to be dropped, for an incomplete
 * slot and for a failed rule (UF, region range, CNPJ check digits). Idempotent.
 */
export function canonicalizeProfessionalId(
  format: ProfessionalIdFormat,
  raw: string,
): string | null {
  if (raw.length > PROFESSIONAL_ID_MAX_INPUT) return null;
  const analysis = analyze(format, raw);
  if (analysis.placed.length < analysis.total) return null;
  if (!semanticOk(format, analysis)) return null;
  return layoutOf(format, analysis).text;
}

/** True when `text` is already the canonical text of at least one format (the loose answer variant). */
export function isProfessionalIdText(text: string): boolean {
  return PROFESSIONAL_ID_FORMATS.some(
    (format) => canonicalizeProfessionalId(format, text) === text,
  );
}
