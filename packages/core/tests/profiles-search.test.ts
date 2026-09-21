import {
  MEMBERS_MAX_PAGE_SIZE,
  MEMBERS_MAX_QUERY_LENGTH,
  MEMBERS_PAGE_SIZE,
  memberListQuerySchema,
  memberListSchema,
} from '@tria/contracts/profiles';
import {
  decodeCursor,
  encodeCursor,
  likeEscape,
  normaliseQuery,
} from '@tria/core/server/profiles/search';
import { describe, expect, it } from 'vitest';

/**
 * PROF-03 — the PURE half of the member directory: query normalisation, `like` escaping, the opaque
 * keyset cursor and the query contract's clamps. No database, no `env`, no service import.
 *
 * The rule this file pins hardest is TOTALITY: `decodeCursor` has no failure path that raises. A
 * cursor is attacker-controlled input that arrives in a shared link; turning a tampered one into a
 * 500 would be a worse outcome than silently starting from the top, and — more importantly — the
 * value must be proven well-formed before any part of it reaches SQL (T-03-21).
 */

const UUID = '3f1d0f6a-5c54-4a61-9a24-0f6a5c544a61';
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('normaliseQuery — absent, empty and blank are the SAME request (PROF-03 / edge: empty)', () => {
  it('1. undefined, an empty string and whitespace-only all become null', () => {
    expect(normaliseQuery(undefined)).toBeNull();
    expect(normaliseQuery('')).toBeNull();
    expect(normaliseQuery('   ')).toBeNull();
    expect(normaliseQuery('\t\n ')).toBeNull();
  });

  it('2. trims and collapses internal whitespace runs to exactly one space', () => {
    expect(normaliseQuery('  joão   gonçalves ')).toBe('joão gonçalves');
    expect(normaliseQuery('ana\tpaula')).toBe('ana paula');
  });

  it('3. truncates rather than refuses at the cap (T-03-23: no pathological term reaches the index)', () => {
    expect(normaliseQuery('x'.repeat(200))).toHaveLength(MEMBERS_MAX_QUERY_LENGTH);
    expect(MEMBERS_MAX_QUERY_LENGTH).toBe(80);
  });

  it("4. accents are NOT stripped here — the fold is the database's job, on both sides at once", () => {
    // `app.imm_unaccent(lower(x))` is applied to the column AND to the term inside the statement,
    // so folding in JavaScript too would risk the two sides disagreeing.
    expect(normaliseQuery('Íris')).toBe('Íris');
  });
});

describe('likeEscape — a search term is a literal, never a pattern (T-03-21)', () => {
  it('5. a percent sign is escaped, so `100%` cannot widen the result set', () => {
    expect(likeEscape('100%')).toBe('100\\%');
  });

  it("6. an underscore — `like`'s single-character wildcard — is escaped too", () => {
    expect(likeEscape('a_b')).toBe('a\\_b');
  });

  it('7. a backslash is doubled exactly once (a single pass, not a cascade)', () => {
    expect(likeEscape('a\\b')).toBe('a\\\\b');
    expect(likeEscape('%_\\')).toBe('\\%\\_\\\\');
  });

  it('8. an ordinary term — accents included — is returned unchanged', () => {
    expect(likeEscape('João Gonçalves')).toBe('João Gonçalves');
    expect(likeEscape('')).toBe('');
  });
});

describe('the keyset cursor is opaque, versioned and TOTAL (R-11)', () => {
  it('9. encode/decode round-trips the ordered name and the id exactly', () => {
    const cursor = encodeCursor({ n: 'ana paula ferreira', id: UUID });
    // Opaque by construction: base64url of a JSON envelope, never a readable "name:id" pair.
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual({ n: 'ana paula ferreira', id: UUID });
  });

  it('10. an absent or empty cursor is null — the first page, not an error', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('11. garbage that is not base64url JSON is null WITHOUT raising', () => {
    expect(() => decodeCursor('not-base64!!')).not.toThrow();
    expect(decodeCursor('not-base64!!')).toBeNull();
    expect(decodeCursor('garbage')).toBeNull();
  });

  it('12. a well-formed envelope missing its keys is null', () => {
    expect(decodeCursor(Buffer.from('{}').toString('base64url'))).toBeNull();
    expect(decodeCursor(b64({ n: 'a', id: UUID }))).toBeNull();
    expect(decodeCursor(b64(['a', UUID]))).toBeNull();
  });

  it('13. an UNRECOGNISED version is null — this is how a future ordering retires old cursors', () => {
    expect(decodeCursor(b64({ v: 2, n: 'a', id: UUID }))).toBeNull();
  });

  it('14. an id that is not a uuid is null — nothing reaches SQL uncast (T-03-21)', () => {
    expect(decodeCursor(b64({ v: 1, n: 'a', id: 'not-a-uuid' }))).toBeNull();
    expect(decodeCursor(b64({ v: 1, n: 42, id: UUID }))).toBeNull();
  });
});

describe('memberListQuerySchema — the page is clamped server-side (T-03-23)', () => {
  it('15. limit defaults to the R-11 page size and is clamped to 1..50', () => {
    expect(memberListQuerySchema.parse({}).limit).toBe(MEMBERS_PAGE_SIZE);
    expect(MEMBERS_PAGE_SIZE).toBe(25);
    expect(memberListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(
      memberListQuerySchema.safeParse({ limit: String(MEMBERS_MAX_PAGE_SIZE + 1) }).success,
    ).toBe(false);
    expect(memberListQuerySchema.parse({ limit: '3' }).limit).toBe(3);
    expect(memberListQuerySchema.parse({ limit: String(MEMBERS_MAX_PAGE_SIZE) }).limit).toBe(
      MEMBERS_MAX_PAGE_SIZE,
    );
  });

  it('16. an over-long q and an unknown query key are both refused', () => {
    expect(memberListQuerySchema.safeParse({ q: 'x'.repeat(81) }).success).toBe(false);
    // `.strict()`: `?role=admin_tenant` must fail loudly rather than be ignored (D-47).
    expect(memberListQuerySchema.safeParse({ role: 'admin_tenant' }).success).toBe(false);
  });
});

describe('memberListSchema — D-45 holds in the LIST, not just on the profile screen', () => {
  it('17. a row carrying a role is refused, because items are the strict member profile', () => {
    const row = {
      membershipId: UUID,
      displayName: 'Ana',
      bio: null,
      avatarAssetId: null,
      avatarUrl: null,
    };
    expect(memberListSchema.safeParse({ items: [row], nextCursor: null }).success).toBe(true);
    expect(
      memberListSchema.safeParse({ items: [{ ...row, role: 'admin_tenant' }], nextCursor: null })
        .success,
    ).toBe(false);
    // `nextCursor` is nullable but never absent — the UI switches on it.
    expect(memberListSchema.safeParse({ items: [] }).success).toBe(false);
  });
});
