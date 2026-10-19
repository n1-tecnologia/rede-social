import { encodeCursor } from '@rede-social/core/server/paging';
import { describe, expect, it } from 'vitest';
import {
  OWNER_BAND_PAGE_SIZE,
  OWNER_LIST_MAX_PAGE_SIZE,
  OWNER_MEMBER_LIST_PAGE_SIZE,
} from '../contracts/member-lists';
import { NEVER_ACTIVE, pageInput, pageOf } from '../server/paging';

/**
 * The owner lists' paging helper (08.7-04, planning decision 2, EP-21, EP-24, T-08.7-13,
 * T-08.7-15): the limit clamp and the cursor's `n` check, wrapped around the repo's one keyset
 * envelope. Pure: no database.
 */

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

const rawCursor = (value: unknown) =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

describe('pageInput: the limit (EP-21)', () => {
  it('limit=0 reads 1 row', () => {
    expect(pageInput({ limit: '0' }, OWNER_BAND_PAGE_SIZE).limit).toBe(1);
  });

  it('limit=500 reads 50 rows (OWNER_LIST_MAX_PAGE_SIZE)', () => {
    expect(OWNER_LIST_MAX_PAGE_SIZE).toBe(50);
    expect(pageInput({ limit: '500' }, OWNER_BAND_PAGE_SIZE).limit).toBe(50);
  });

  it('an absent limit is the route default: 10 for band lists, 20 for member lists', () => {
    expect(OWNER_BAND_PAGE_SIZE).toBe(10);
    expect(OWNER_MEMBER_LIST_PAGE_SIZE).toBe(20);
    expect(pageInput({}, OWNER_BAND_PAGE_SIZE).limit).toBe(10);
    expect(pageInput({}, OWNER_MEMBER_LIST_PAGE_SIZE).limit).toBe(20);
  });

  it('a non-numeric or fractional limit degrades to the default, a negative one to 1', () => {
    expect(pageInput({ limit: 'abc' }, OWNER_MEMBER_LIST_PAGE_SIZE).limit).toBe(20);
    expect(pageInput({ limit: '2.5' }, OWNER_MEMBER_LIST_PAGE_SIZE).limit).toBe(20);
    expect(pageInput({ limit: '-3' }, OWNER_MEMBER_LIST_PAGE_SIZE).limit).toBe(1);
    expect(pageInput({ limit: '7' }, OWNER_MEMBER_LIST_PAGE_SIZE).limit).toBe(7);
  });
});

describe('pageInput: the cursor (EP-24, planning decision 2)', () => {
  it('a cursor whose n is "abc" decodes to null (page 1)', () => {
    const cursor = encodeCursor({ n: 'abc', id: ID_A });
    expect(pageInput({ cursor }, OWNER_BAND_PAGE_SIZE).after).toBeNull();
  });

  it('a well-formed instant cursor is read back exactly', () => {
    const cursor = encodeCursor({ n: '2026-10-17T15:00:00.123456Z', id: ID_A });
    expect(pageInput({ cursor }, OWNER_MEMBER_LIST_PAGE_SIZE).after).toEqual({
      n: '2026-10-17T15:00:00.123456Z',
      id: ID_A,
    });
  });

  it('an impossible calendar instant is refused', () => {
    const cursor = encodeCursor({ n: '2026-02-30T10:00:00Z', id: ID_A });
    expect(pageInput({ cursor }, OWNER_MEMBER_LIST_PAGE_SIZE).after).toBeNull();
  });

  it('malformed, tampered, wrong-version and oversized cursors all read page 1', () => {
    for (const cursor of [
      'not-a-cursor',
      '%%%',
      rawCursor({ v: 2, n: '2026-10-17T15:00:00Z', id: ID_A }),
      rawCursor({ v: 1, n: '2026-10-17T15:00:00Z', id: 'not-a-uuid' }),
      rawCursor({ v: 1, n: 17, id: ID_A }),
      `${encodeCursor({ n: '2026-10-17T15:00:00Z', id: ID_A })}${'A'.repeat(600)}`,
    ]) {
      expect(pageInput({ cursor }, OWNER_BAND_PAGE_SIZE).after).toBeNull();
    }
  });

  it('a date cursor (active days) takes a calendar date and refuses an instant', () => {
    const day = encodeCursor({ n: '2026-10-01', id: ID_A });
    expect(pageInput({ cursor: day }, OWNER_MEMBER_LIST_PAGE_SIZE, 'date').after).toEqual({
      n: '2026-10-01',
      id: ID_A,
    });
    const instant = encodeCursor({ n: '2026-10-01T00:00:00Z', id: ID_A });
    expect(pageInput({ cursor: instant }, OWNER_MEMBER_LIST_PAGE_SIZE, 'date').after).toBeNull();
    const impossible = encodeCursor({ n: '2026-13-01', id: ID_A });
    expect(pageInput({ cursor: impossible }, OWNER_MEMBER_LIST_PAGE_SIZE, 'date').after).toBeNull();
  });

  it('a band cursor takes an instant or the never-active sentinel, and nothing else', () => {
    const never = encodeCursor({ n: NEVER_ACTIVE, id: ID_A });
    expect(pageInput({ cursor: never }, OWNER_BAND_PAGE_SIZE, 'last-active').after).toEqual({
      n: NEVER_ACTIVE,
      id: ID_A,
    });
    const instant = encodeCursor({ n: '2026-10-17T15:00:00Z', id: ID_A });
    expect(pageInput({ cursor: instant }, OWNER_BAND_PAGE_SIZE, 'last-active').after?.n).toBe(
      '2026-10-17T15:00:00Z',
    );
    const junk = encodeCursor({ n: 'yesterday', id: ID_A });
    expect(pageInput({ cursor: junk }, OWNER_BAND_PAGE_SIZE, 'last-active').after).toBeNull();
    // The sentinel is a band-list value only: an instant list refuses it.
    expect(pageInput({ cursor: never }, OWNER_MEMBER_LIST_PAGE_SIZE).after).toBeNull();
  });

  it('an integer cursor (08.7-09: lifetime cents, days to the second purchase) takes a whole number and nothing else', () => {
    const cents = encodeCursor({ n: '6980', id: ID_A });
    expect(pageInput({ cursor: cents }, 20, 'integer').after).toEqual({ n: '6980', id: ID_A });
    expect(pageInput({ cursor: encodeCursor({ n: '0', id: ID_B }) }, 20, 'integer').after?.n).toBe(
      '0',
    );
    for (const n of ['-5', '3.5', '1e3', '', '2026-10-17T15:00:00Z', '1234567890123456']) {
      expect(pageInput({ cursor: encodeCursor({ n, id: ID_A }) }, 20, 'integer').after).toBeNull();
    }
    // An instant list refuses a bare number.
    expect(pageInput({ cursor: cents }, 20).after).toBeNull();
  });
});

describe('pageOf: the page and its continuation', () => {
  const rows = [
    { at: '2026-10-17T15:00:00Z', id: ID_C },
    { at: '2026-10-17T15:00:00Z', id: ID_B },
    { at: '2026-10-16T09:00:00Z', id: ID_A },
  ];
  const keyOf = (row: { at: string; id: string }) => ({ n: row.at, id: row.id });

  it('an over-fetched page keeps `limit` rows and points past the last one', () => {
    const page = pageOf(rows, 2, keyOf);
    expect(page.rows).toEqual(rows.slice(0, 2));
    expect(page.nextCursor).not.toBeNull();
    expect(pageInput({ cursor: page.nextCursor ?? '' }, 2).after).toEqual({
      n: '2026-10-17T15:00:00Z',
      id: ID_B,
    });
  });

  it('exactly `limit` rows is the last page: nextCursor null (EP-21)', () => {
    const page = pageOf(rows, 3, keyOf);
    expect(page.rows).toEqual(rows);
    expect(page.nextCursor).toBeNull();
  });

  it('no row is an empty last page (EP-23)', () => {
    expect(pageOf([], 10, keyOf)).toEqual({ rows: [], nextCursor: null });
  });
});
