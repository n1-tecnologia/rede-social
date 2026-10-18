import { decodeCursor, encodeCursor, type KeysetCursor } from '@rede-social/core/server/paging';
import { OWNER_LIST_MAX_CURSOR_LENGTH, OWNER_LIST_MAX_PAGE_SIZE } from '../contracts/index';

/**
 * The owner lists' paging (08.7-04, planning decision 2, EP-21, EP-24, T-08.7-13, T-08.7-15): the
 * repo's ONE keyset envelope (`@rede-social/core/server/paging`), plus the two rules every owner
 * list shares — the `limit` clamp and a check of the cursor's `n` against what the list is ordered
 * by. `decodeCursor` only proves `n` is a string; a non-date `n` spliced into a `timestamptz`
 * comparison would answer 500, so here it degrades to page 1 like any other bad cursor.
 *
 * TOTAL, like the module it wraps: nothing here raises.
 */

/** What a list is ordered by, so what its cursor's `n` must be. */
export type CursorKind = 'instant' | 'date' | 'last-active';

/**
 * A band list orders `last_active_at desc nulls last`: a member who never acted sorts after every
 * instant. The cursor of such a row carries this sentinel; the query reads it as `-infinity`.
 */
export const NEVER_ACTIVE = 'never';

const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?Z$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day (Feb 30 is not one): the components survive a UTC round trip. */
function realDay(year: number, month: number, day: number): boolean {
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
}

function isInstant(value: string): boolean {
  const match = INSTANT.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return realDay(year, month, day) && hour < 24 && minute < 60 && second < 60;
}

function isDate(value: string): boolean {
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1, 4).map(Number) as [number, number, number];
  return realDay(year, month, day);
}

function acceptsN(kind: CursorKind, n: string): boolean {
  if (kind === 'date') return isDate(n);
  if (kind === 'last-active') return n === NEVER_ACTIVE || isInstant(n);
  return isInstant(n);
}

/**
 * The `limit` coerced and clamped to `1..OWNER_LIST_MAX_PAGE_SIZE` (absent, non-numeric or
 * fractional → `defaultLimit`; `0` or negative → 1), and the cursor decoded and checked against
 * `kind` (anything malformed, tampered, oversized or of the wrong kind → `null`, page 1).
 */
export function pageInput(
  raw: { limit?: string | number | undefined; cursor?: string | undefined },
  defaultLimit: number,
  kind: CursorKind = 'instant',
): { limit: number; after: KeysetCursor | null } {
  const asNumber = raw.limit === undefined || raw.limit === '' ? Number.NaN : Number(raw.limit);
  const wanted = Number.isInteger(asNumber) ? asNumber : defaultLimit;
  const limit = Math.min(Math.max(wanted, 1), OWNER_LIST_MAX_PAGE_SIZE);

  const cursor = raw.cursor;
  if (cursor === undefined || cursor.length > OWNER_LIST_MAX_CURSOR_LENGTH) {
    return { limit, after: null };
  }
  const decoded = decodeCursor(cursor);
  return { limit, after: decoded && acceptsN(kind, decoded.n) ? decoded : null };
}

/**
 * One page out of rows over-fetched by one (`limit + 1`): the first `limit` rows, and a cursor past
 * the last of them exactly when another row exists (a list of exactly `limit` rows has none).
 */
export function pageOf<T>(
  rows: readonly T[],
  limit: number,
  keyOf: (row: T) => KeysetCursor,
): { rows: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(keyOf(last)) : null,
  };
}
