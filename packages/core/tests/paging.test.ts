import {
  CURSOR_VERSION,
  decodeCursor,
  encodeCursor,
  type KeysetDirection,
  keysetComparison,
} from '@tria/core/server/paging';
import { describe, expect, it } from 'vitest';

/**
 * `packages/core/server/paging.ts` — THE keyset envelope, and (05-07) the one place the READING
 * DIRECTION is decided.
 *
 * D-83 puts a story's flat comment list oldest→newest while D-62 puts a post's root comments
 * newest→oldest. Those are two directions over one envelope, and Pitfall 8 is what happens when
 * that is fudged: reusing a `DESC` index for an `ASC` order gives a backward scan the existing
 * `<` comparison cannot keyset-page, so page 2 silently repeats or skips rows.
 *
 * The rule this file pins hardest is that the direction is a PARAMETER, not a second envelope. The
 * cursor payload (`{ v, n, id }`) and its version are identical in both directions — a cursor is
 * the one value that must mean the same thing to every endpoint that hands one out — and the only
 * thing that differs is the comparison operator and the `order by` direction the caller splices
 * into its own statement.
 *
 * And because those two strings ARE spliced raw into SQL, `keysetComparison` must be TOTAL in the
 * same way `decodeCursor` is: an unrecognised direction degrades to the repo's default (`desc`)
 * rather than returning `undefined` and putting the word "undefined" into a query.
 */

const UUID = '3f1d0f6a-5c54-4a61-9a24-0f6a5c544a61';

describe('keysetComparison — one envelope, two directions (D-83 / Pitfall 8)', () => {
  it('1. the DESCENDING direction is `<` ordered `desc` — the feed, the strip and the root comments', () => {
    expect(keysetComparison('desc')).toEqual({ operator: '<', order: 'desc' });
  });

  it('2. the ASCENDING direction is `>` ordered `asc` — a story’s flat conversation (D-83)', () => {
    expect(keysetComparison('asc')).toEqual({ operator: '>', order: 'asc' });
  });

  it('3. the operator and the order always AGREE — a mismatched pair is the Pitfall-8 bug', () => {
    for (const direction of ['desc', 'asc'] as const) {
      const { operator, order } = keysetComparison(direction);
      expect(operator === '<' ? 'desc' : 'asc').toBe(order);
    }
  });

  it('4. it is TOTAL: an unrecognised direction degrades to `desc`, never to undefined', () => {
    // Both values are spliced RAW into SQL by the caller, so "no answer" is not an option here.
    expect(keysetComparison('sideways' as KeysetDirection)).toEqual({
      operator: '<',
      order: 'desc',
    });
  });

  it('5. the answer is drawn from a CLOSED pair of vocabularies — nothing else can reach SQL', () => {
    const seen = new Set<string>();
    for (const direction of ['desc', 'asc', '', 'DESC', '; drop table feed_comments'] as string[]) {
      const { operator, order } = keysetComparison(direction as KeysetDirection);
      seen.add(operator);
      seen.add(order);
    }
    expect([...seen].sort()).toEqual(['<', '>', 'asc', 'desc'].sort());
  });
});

describe('the envelope is UNCHANGED by the direction (one cursor, not two)', () => {
  it('6. a cursor encoded for either direction decodes to the same payload and the same version', () => {
    const cursor = encodeCursor({ n: '2026-09-24T00:00:00.000001Z', id: UUID });
    expect(decodeCursor(cursor)).toEqual({ n: '2026-09-24T00:00:00.000001Z', id: UUID });
    expect(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))).toMatchObject({
      v: CURSOR_VERSION,
    });
  });

  it('7. decodeCursor stays TOTAL — a tampered envelope is still page 1, in both directions', () => {
    expect(decodeCursor('not-base64url-json')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});
