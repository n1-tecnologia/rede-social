/**
 * The event form's "Abertura das inscrições" helpers (Phase 10.2-12, D-792, D-793, D-794, D-781,
 * OPEN-03, OPEN-04, OPEN-17, OPEN-19, UI-D-790).
 *
 * **Pure.** The opening is a wall-clock pair in the TENANT's zone, `{ date: 'YYYY-MM-DD', time:
 * 'HH:mm' }`, exactly like the event's own start: the API converts it in SQL, so nothing here converts a
 * zone, builds a date object for the pair or reads the clock. "Now" is an argument: the page computes
 * the tenant's wall-clock now on the SERVER (`tenantWallClockNow`) and the form only compares strings.
 *
 * **One place for the key rule** (`openingKey`): the PUT carries `registrationOpens` only when the value
 * CHANGED (an omitted key keeps the stored one, so an older client or a web that is ahead of the API
 * never wipes a date it cannot see), an explicit `null` only when the admin cleared it and no mapping
 * removal will follow (the removal clears the date atomically inside the same database transaction,
 * so a sale landing between two writes can never leave a paid event with no date), and never for a
 * host that predates the section.
 */

/** The form's pair; both halves are strings so a half-typed field is representable. */
export type OpeningPair = { date: string; time: string };

export const EMPTY_OPENING: OpeningPair = { date: '', time: '' };

/** The stored pair as the edit read hands it (`null` or absent is "no opening"). */
export function storedOpeningPair(value: OpeningPair | null | undefined): OpeningPair | null {
  return value ? { date: value.date, time: value.time } : null;
}

/** The form's pair for a stored one: empty inputs when nothing is stored. */
export function openingPairOrEmpty(value: OpeningPair | null | undefined): OpeningPair {
  return value ? { date: value.date, time: value.time } : { ...EMPTY_OPENING };
}

const isEmpty = (pair: OpeningPair) => pair.date === '' && pair.time === '';
const isComplete = (pair: OpeningPair) => pair.date !== '' && pair.time !== '';
const sameInstant = (a: OpeningPair, b: OpeningPair) => a.date === b.date && a.time === b.time;

/** `'2026-11-29T10:00'`: fixed width, so a string comparison IS a chronological one (the schema's rule). */
const wallKey = (pair: OpeningPair) => `${pair.date}T${pair.time}`;

/** Both halves empty. */
export const openingIsEmpty = isEmpty;
/** Both halves typed. */
export const openingIsComplete = isComplete;

export type OpeningKeyInput = {
  /** The form got the section (`ticket` prop present); a host that predates it sends no key. */
  host: boolean;
  /** A paid presence exists: the date cannot change, so nothing is sent. */
  locked: boolean;
  /** The "Cobrar ingresso" switch. */
  switchOn: boolean;
  /** A product mapping is saved: turning the switch off deletes it, and the deletion clears the date. */
  hasMapping: boolean;
  /** What the server holds now, or `null`. */
  stored: OpeningPair | null;
  /** What the inputs hold. */
  typed: OpeningPair;
};

/**
 * The payload fragment for the opening: `{}` (no key), `{ registrationOpens: pair }` or
 * `{ registrationOpens: null }`. Spread into the event body next to the price field.
 */
export function openingKey(input: OpeningKeyInput): { registrationOpens?: OpeningPair | null } {
  if (!input.host || input.locked) return {};

  if (input.switchOn) {
    if (isComplete(input.typed)) {
      if (input.stored && sameInstant(input.stored, input.typed)) return {};
      return { registrationOpens: { date: input.typed.date, time: input.typed.time } };
    }
    // Cleared by the admin: only an explicit null removes a stored date.
    if (isEmpty(input.typed)) return input.stored ? { registrationOpens: null } : {};
    // A half pair is refused by the form before any write.
    return {};
  }

  // Switch off with a saved mapping: the later mapping DELETE clears the date atomically.
  if (input.hasMapping) return {};
  // Switch off, no mapping: nothing will clear a stored or typed date, so the event save does.
  const anyTyped = !isEmpty(input.typed);
  return input.stored || anyTyped ? { registrationOpens: null } : {};
}

export type OpeningErrorKey = 'incomplete' | 'afterStart';

/**
 * The field's error, judged against the TYPED start (EP-38): one half filled is `incomplete`; a pair at
 * or after the start is `afterStart`, the same `wallKey` comparison the schema's `opening_after_start`
 * issue makes. Both empty, or a start that is not a whole pair yet, is no error.
 */
export function openingErrors(input: {
  typed: OpeningPair;
  start: OpeningPair;
}): OpeningErrorKey | null {
  if (isEmpty(input.typed)) return null;
  if (!isComplete(input.typed)) return 'incomplete';
  if (!isComplete(input.start)) return null;
  return wallKey(input.typed) >= wallKey(input.start) ? 'afterStart' : null;
}

export type OpeningFieldState = 'locked' | 'empty' | 'filled' | 'past';

/**
 * UI-D-790, first match wins: (a) `locked` (a paid presence exists), (b) `empty`, (d) `past` (a complete
 * pair at or before the tenant's wall-clock now: accepted, never an error), (c) `filled`. Without a
 * wall-clock now (a host that does not pass one) the form never guesses: the pair is simply `filled`.
 */
export function openingFieldState(input: {
  typed: OpeningPair;
  nowWallClock?: OpeningPair;
  soldCount: number;
}): OpeningFieldState {
  if (input.soldCount > 0) return 'locked';
  if (!isComplete(input.typed)) return 'empty';
  if (input.nowWallClock && wallKey(input.typed) <= wallKey(input.nowWallClock)) return 'past';
  return 'filled';
}

/* ── the server's wall-clock now (never computed in a browser) ─────────────────────────────────── */

/** Cached per zone: `Intl.DateTimeFormat` construction is the expensive part (events-view's style). */
const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/**
 * The request instant (`nowMs`, read ONCE by the page on the server) as the tenant's wall-clock pair,
 * minute precision. `formatToParts` takes the number itself, so no date object is built here. An
 * unknown zone falls back to UTC rather than throwing: the pair only drives an informational row.
 */
export function tenantWallClockNow(nowMs: number, timeZone: string): OpeningPair {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = wallClockFormatter(timeZone).formatToParts(nowMs);
  } catch {
    parts = wallClockFormatter('UTC').formatToParts(nowMs);
  }
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  // `h23` prints 00..23, but some engines still answer "24" at midnight: fold it to 00.
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    time: `${hour}:${pick('minute')}`,
  };
}
