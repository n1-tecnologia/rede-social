/**
 * 2026-10-06 — an event's "Informações úteis" (the REINE prototype's "Bom saber": the dress code,
 * what the ticket includes, what to bring, and the certificate), stored in the ONE `description`
 * string the events contract already carries (`EVENT_MAX_DESCRIPTION`, 4000). Front-only on purpose,
 * the `event-address.ts` precedent: the API, the contract and the column stay a free string, so this
 * module IS the whole convention. Pure (no `'use client'`): the form composes with it, the server
 * readers (`events-view`) parse with it.
 *
 * **The block is human-readable**, so every surface that prints the description raw (the `.ics`
 * file, the Google Calendar link) still reads well. It closes the description, after a blank line:
 *
 *   {the description}
 *
 *   Informações úteis
 *   Traje: Casual + scrub
 *   Incluso no ingresso: Coffee break · Material de apoio
 *   O que levar: Documento com foto · Notebook
 *   Certificado: 16 horas            (or `Certificado: sim`, with no workload)
 *
 * Each line is present only when it has a value, always in this order.
 *
 * **Parsing is an exact round trip.** `splitEventDescription` accepts the block only when composing
 * what it read gives the SAME string back; anything else is plain description, which is what every
 * event written before this format holds. A value never carries a line break (whitespace is
 * collapsed) and a list item never carries ` · ` (its middots become commas), so the format holds.
 *
 * The heading and the labels are a STORAGE format, so they live here and never in the catalog: a
 * copy edit must not orphan the blocks already stored.
 */

export type EventExtras = {
  /** "Casual + scrub"; null for none. */
  dressCode: string | null;
  /** What the ticket includes, in order. */
  included: string[];
  /** What to bring, in order. */
  bring: string[];
  /** Null: no certificate. `hours` null: a certificate with no stated workload. */
  certificate: { hours: number | null } | null;
};

export const EMPTY_EVENT_EXTRAS: EventExtras = {
  dressCode: null,
  included: [],
  bring: [],
  certificate: null,
};

/** The form's caps (UTF-16 units), and the most items one list may hold. */
export const EXTRAS_CAPS = { dressCode: 80, item: 60, items: 12, hours: 999 } as const;

const HEADING = 'Informações úteis';
const LABEL = {
  dressCode: 'Traje',
  included: 'Incluso no ingresso',
  bring: 'O que levar',
  certificate: 'Certificado',
} as const;
const LIST_SEPARATOR = ' · ';
const CERTIFICATE_YES = 'sim';
const HOURS_RE = /^(\d{1,3}) horas?$/;

/** One line of text: whitespace (line breaks included) collapsed, trimmed. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** A list item: one line, its middots turned into commas (the separator stays unambiguous). */
function item(value: string): string {
  return oneLine(value.replace(/\s*·\s*/g, ', ')).replace(/^,\s*|,$/g, '');
}

/** The extras with every value normalised the way the block stores it; empties dropped. */
export function normaliseEventExtras(extras: EventExtras): EventExtras {
  const dressCode = extras.dressCode === null ? '' : oneLine(extras.dressCode);
  const hours = extras.certificate?.hours ?? null;
  return {
    dressCode: dressCode === '' ? null : dressCode,
    included: extras.included.map(item).filter((value) => value !== ''),
    bring: extras.bring.map(item).filter((value) => value !== ''),
    certificate:
      extras.certificate === null
        ? null
        : {
            hours:
              hours !== null && Number.isInteger(hours) && hours > 0 && hours <= EXTRAS_CAPS.hours
                ? hours
                : null,
          },
  };
}

/** Whether there is anything to store or to show. */
export function hasEventExtras(extras: EventExtras | null): extras is EventExtras {
  if (extras === null) return false;
  return (
    extras.dressCode !== null ||
    extras.included.length > 0 ||
    extras.bring.length > 0 ||
    extras.certificate !== null
  );
}

/** `16 horas`, `1 hora`, or `sim`. */
function certificateValue(hours: number | null): string {
  if (hours === null) return CERTIFICATE_YES;
  return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
}

/** The block's lines (heading included), or `[]` when the extras hold nothing. */
function blockLines(extras: EventExtras): string[] {
  const normalised = normaliseEventExtras(extras);
  if (!hasEventExtras(normalised)) return [];
  const lines = [HEADING];
  if (normalised.dressCode) lines.push(`${LABEL.dressCode}: ${normalised.dressCode}`);
  if (normalised.included.length > 0) {
    lines.push(`${LABEL.included}: ${normalised.included.join(LIST_SEPARATOR)}`);
  }
  if (normalised.bring.length > 0) {
    lines.push(`${LABEL.bring}: ${normalised.bring.join(LIST_SEPARATOR)}`);
  }
  if (normalised.certificate) {
    lines.push(`${LABEL.certificate}: ${certificateValue(normalised.certificate.hours)}`);
  }
  return lines;
}

/** The description as stored: the text, then the block after a blank line (none without extras). */
export function composeEventDescription(text: string, extras: EventExtras): string {
  const body = text.trim();
  const lines = blockLines(extras);
  if (lines.length === 0) return body;
  const block = lines.join('\n');
  return body === '' ? block : `${body}\n\n${block}`;
}

/** Reads one label line into `extras`, or returns false when the line is not one. */
function readLine(line: string, extras: EventExtras): boolean {
  const at = line.indexOf(': ');
  if (at <= 0) return false;
  const label = line.slice(0, at);
  const value = line.slice(at + 2);
  if (value === '') return false;
  if (label === LABEL.dressCode) {
    extras.dressCode = value;
    return true;
  }
  if (label === LABEL.included) {
    extras.included = value.split(LIST_SEPARATOR);
    return true;
  }
  if (label === LABEL.bring) {
    extras.bring = value.split(LIST_SEPARATOR);
    return true;
  }
  if (label === LABEL.certificate) {
    if (value === CERTIFICATE_YES) {
      extras.certificate = { hours: null };
      return true;
    }
    const match = HOURS_RE.exec(value);
    if (!match) return false;
    extras.certificate = { hours: Number(match[1]) };
    return true;
  }
  return false;
}

/**
 * The stored description → the text the page shows and the extras, or `extras: null` when there is
 * no block (or what looks like one is not an exact round trip: then it all stays text).
 */
export function splitEventDescription(stored: string): {
  text: string;
  extras: EventExtras | null;
} {
  const plain = { text: stored, extras: null };
  let text: string;
  let block: string;
  if (stored.startsWith(`${HEADING}\n`)) {
    // No description at all: the block is the whole string.
    text = '';
    block = stored;
  } else {
    const at = stored.lastIndexOf(`\n\n${HEADING}\n`);
    if (at < 0) return plain;
    text = stored.slice(0, at);
    block = stored.slice(at + 2);
  }
  const lines = block.split('\n');
  if (lines[0] !== HEADING || lines.length < 2) return plain;
  const extras: EventExtras = { ...EMPTY_EVENT_EXTRAS, included: [], bring: [] };
  for (const line of lines.slice(1)) {
    if (!readLine(line, extras)) return plain;
  }
  // Exact round trip, or it is not ours.
  if (composeEventDescription(text, extras) !== stored) return plain;
  return { text, extras };
}
