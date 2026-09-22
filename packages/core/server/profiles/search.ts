import { MEMBERS_MAX_QUERY_LENGTH } from '@tria/contracts/profiles';
import type { KeysetCursor } from '../paging';

/**
 * The PURE half of the member directory (PROF-03, R-10/R-11): query normalisation, `like` escaping
 * and the opaque keyset cursor. No database, no `env`, no logger — the pure-module posture of
 * `branding/upload.ts`, so every rule below is unit-testable without a stack.
 *
 * THIS MODULE IS TOTAL: no function here has a failure path that raises. A tampered, truncated or
 * stale cursor degrades to "first page", because a 500 on a link somebody shared would be a far
 * worse outcome than a re-read from the top — and because a cursor is attacker-controlled input
 * that must never reach SQL unvalidated (T-03-21).
 *
 * This is also the keyset convention Phase 4's feed inherits: an opaque base64url `{ v, n, id }`
 * envelope whose `n` is the SAME ordered expression the index is built on, over-fetch `limit + 1`
 * to decide `nextCursor`, and clamp `limit` server-side.
 */

/** Re-exported so the directory's server half has one import for every cap it enforces. */
export { MEMBERS_MAX_QUERY_LENGTH };

/**
 * `q` absent, `q=''` and `q='   '` are provably the SAME request: all three become `null`, which the
 * page query reads as "no filter". Internal whitespace runs collapse to one space so `"joão
 * gonçalves"` typed with a double space still matches, and the value is truncated — not refused — to
 * `MEMBERS_MAX_QUERY_LENGTH` (T-03-23: a pathological term never reaches the trigram index at full
 * length). The HTTP schema refuses anything longer first; this truncation is the second line of
 * defence for a caller that never passed it.
 */
export function normaliseQuery(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const collapsed = raw.trim().replace(/\s+/g, ' ').slice(0, MEMBERS_MAX_QUERY_LENGTH);
  return collapsed === '' ? null : collapsed;
}

/**
 * `%`, `_` and `\` in a member's search term are LITERAL characters, not `like` wildcards — the same
 * rule `likeContains` applies in `packages/core/server/platform/tenants.ts`. Re-derived here rather
 * than imported because that helper is a private const in the kernel's PRIVILEGED lane, and
 * `profiles/**` may not import from it at all (Biome, "Admin lane is kernel-only").
 *
 * The backslash is escaped FIRST by the single-pass character class, so `a\b` becomes `a\\b` and not
 * `a\\\\b`. The statement that consumes this must declare `escape '\'` or the doubled backslashes
 * are meaningless.
 */
export function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * The keyset cursor envelope. `n` is the NORMALISED name the row was ordered by
 * (`app.imm_unaccent(lower(display_name))`, read back from the projection, never re-folded in
 * JavaScript) and `id` is `member_profiles.id` — the exact tiebreaker column of
 * `member_profiles_tenant_name_idx`, so the comparison stays index-ordered.
 *
 * THE IMPLEMENTATION MOVED (03-07): 03-07's admin media list needs the SAME `{ v: 1, n, id }`
 * envelope, so `encodeCursor`/`decodeCursor` now live in `../paging.ts` and are re-exported here.
 * Two copies would drift on the first change to the envelope; one module with two callers cannot.
 * Every 03-03 call site and `packages/core/tests/profiles-search.test.ts` keep importing them from
 * this file unchanged, and exactly ONE implementation exists in the repo.
 */
export { CURSOR_VERSION, decodeCursor, encodeCursor } from '../paging';

/** The directory's name of the shared envelope — `{ n: <folded display name>, id: <profile id> }`. */
export type MemberCursor = KeysetCursor;
