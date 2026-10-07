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
 * **2026-10-07 (quick 261007-n1g): the programme ("Cronograma") now lives in its own column,
 * `events.schedule`, and is no longer written into the description.** The `Programação` lines
 * (`{HH:MM} · {what happens}`, or `Dia 2 · 09:00 · Abertura` once any moment falls after the first
 * day) are a READ-ONLY legacy format, kept so that events written between 2026-10-06 and that change
 * still show their schedule: `splitEventDescription` still parses them, `effectiveSchedule` picks the
 * stored list over the legacy one, and the first save of such an event from the form moves the
 * programme into the column and drops the lines. There is no bulk data migration.
 *
 * **Parsing is an exact round trip.** `splitEventDescription` accepts the block only when composing
 * what it read gives the SAME string back; anything else is plain description, which is what every
 * event written before this format holds. A value never carries a line break (whitespace is
 * collapsed) and a list item never carries ` · ` (its middots become commas), so the format holds.
 *
 * The heading and the labels are a STORAGE format, so they live here and never in the catalog: a
 * copy edit must not orphan the blocks already stored.
 */

import {
  EVENT_SCHEDULE_MAX_DAY,
  EVENT_SCHEDULE_MAX_ITEMS,
  EVENT_SCHEDULE_MAX_TITLE,
  EVENT_SCHEDULE_TIME_RE,
  type EventScheduleItem,
  normaliseEventSchedule,
} from '@rede-social/module-events/contracts';

/** One moment of the programme: the event's day (1 = the first), the time, what happens. */
export type ScheduleItem = EventScheduleItem;

export type EventExtras = {
  /** "Casual + scrub"; null for none. */
  dressCode: string | null;
  /** What the ticket includes, in order. */
  included: string[];
  /** What to bring, in order. */
  bring: string[];
  /** Null: no certificate. `hours` null: a certificate with no stated workload. */
  certificate: { hours: number | null } | null;
  /**
   * LEGACY (read-only): the programme parsed out of an old description's `Programação` lines. Filled
   * only by `splitEventDescription`; the form's schedule is its own field and `composeEventDescription`
   * ignores this one. Empty for none.
   */
  schedule: ScheduleItem[];
};

export const EMPTY_EVENT_EXTRAS: EventExtras = {
  dressCode: null,
  included: [],
  bring: [],
  certificate: null,
  schedule: [],
};

/**
 * The form's caps (UTF-16 units), the most items one list may hold, and the programme's: what one
 * moment may say, how many moments, and the last day a moment may fall on. The programme's three come
 * from the events contract, so the editor, the API and the database CHECK share ONE definition.
 */
export const EXTRAS_CAPS = {
  dressCode: 80,
  item: 60,
  items: 12,
  hours: 999,
  scheduleTitle: EVENT_SCHEDULE_MAX_TITLE,
  scheduleItems: EVENT_SCHEDULE_MAX_ITEMS,
  scheduleDays: EVENT_SCHEDULE_MAX_DAY,
} as const;

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
const SCHEDULE_HEADING = 'Programação';
/** One programme line: an optional `Dia N · `, the time, ` · `, what happens. */
const SCHEDULE_LINE_RE = /^(?:Dia (\d{1,2}) · )?(\d{2}:\d{2}) · (.+)$/;

/** A valid programme time (`08:00`, `23:59`). */
export const isScheduleTime = (value: string): boolean => EVENT_SCHEDULE_TIME_RE.test(value);

/** One line of text: whitespace (line breaks included) collapsed, trimmed. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** A list item: one line, its middots turned into commas (the separator stays unambiguous). */
function item(value: string): string {
  return oneLine(value.replace(/\s*·\s*/g, ', ')).replace(/^,\s*|,$/g, '');
}

/**
 * The programme as stored: the events contract's own normaliser (what happens on one line, invalid and
 * repeated moments dropped, sorted by day then time, at most `scheduleItems`), so the editor, the
 * service and this module cannot drift apart.
 */
export function normaliseSchedule(schedule: readonly ScheduleItem[]): ScheduleItem[] {
  return normaliseEventSchedule(schedule);
}

/**
 * The programme to show or to edit: the event's own stored list (`events.schedule`) when it has
 * items, else the LEGACY one read out of the description, else none. `stored` is undefined for an
 * API that predates the column. Both are normalised.
 */
export function effectiveSchedule(
  stored: readonly ScheduleItem[] | undefined,
  legacy: readonly ScheduleItem[],
): ScheduleItem[] {
  const own = normaliseSchedule(stored ?? []);
  return own.length > 0 ? own : normaliseSchedule(legacy);
}

/** The extras with every value normalised the way the block stores it; empties dropped. */
export function normaliseEventExtras(extras: EventExtras): EventExtras {
  const dressCode = extras.dressCode === null ? '' : oneLine(extras.dressCode);
  const hours = extras.certificate?.hours ?? null;
  return {
    schedule: normaliseSchedule(extras.schedule ?? []),
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
  return hasGoodToKnow(extras) || extras.schedule.length > 0;
}

/** Whether the "Bom saber" card has anything to list (the programme has its own section). */
export function hasGoodToKnow(extras: EventExtras | null): boolean {
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

/**
 * The block's lines (heading included), or `[]` when there is nothing to list. The programme's lines
 * are written only when `withProgramme` is set, which is the LEGACY format: `composeEventDescription`
 * never sets it, `splitEventDescription` does, for its exact round-trip check of old strings.
 */
function blockLines(extras: EventExtras, withProgramme: boolean): string[] {
  const normalised = normaliseEventExtras(extras);
  const schedule = withProgramme ? normalised.schedule : [];
  if (!hasGoodToKnow(normalised) && schedule.length === 0) return [];
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
  if (schedule.length > 0) {
    lines.push(SCHEDULE_HEADING);
    const days = schedule.some((moment) => moment.day > 1);
    for (const moment of schedule) {
      lines.push(`${days ? `Dia ${moment.day} · ` : ''}${moment.time} · ${moment.title}`);
    }
  }
  return lines;
}

/** The description joined with its block after a blank line (none without lines). */
function join(text: string, lines: string[]): string {
  const body = text.trim();
  if (lines.length === 0) return body;
  const block = lines.join('\n');
  return body === '' ? block : `${body}\n\n${block}`;
}

/**
 * The description as stored: the text, then the "Informações úteis" block after a blank line (none
 * without anything to list). `extras.schedule` is IGNORED: the programme is its own field now.
 */
export function composeEventDescription(text: string, extras: EventExtras): string {
  return join(text, blockLines(extras, false));
}

/** The LEGACY composition, programme included: only `splitEventDescription`'s round-trip check. */
function composeLegacyDescription(text: string, extras: EventExtras): string {
  return join(text, blockLines(extras, true));
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
  const extras: EventExtras = { ...EMPTY_EVENT_EXTRAS, included: [], bring: [], schedule: [] };
  let inSchedule = false;
  for (const line of lines.slice(1)) {
    if (inSchedule) {
      // Past the sub-heading every line is a moment of the programme.
      const match = SCHEDULE_LINE_RE.exec(line);
      if (!match) return plain;
      extras.schedule.push({
        day: match[1] === undefined ? 1 : Number(match[1]),
        time: match[2] ?? '',
        title: match[3] ?? '',
      });
    } else if (line === SCHEDULE_HEADING) {
      inSchedule = true;
    } else if (!readLine(line, extras)) {
      return plain;
    }
  }
  // Exact round trip, or it is not ours.
  if (composeLegacyDescription(text, extras) !== stored) return plain;
  return { text, extras };
}
