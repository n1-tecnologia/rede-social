import { MEMBERS_MAX_QUERY_LENGTH } from '@tria/contracts/profiles';
import { z } from 'zod';

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
 * `v` is the envelope version. It exists so a future ordering change can retire old cursors by
 * bumping it: an unrecognised version fails validation and the caller simply starts from the top.
 */
const cursorSchema = z.object({ v: z.literal(1), n: z.string(), id: z.uuid() });

export type MemberCursor = { n: string; id: string };

/** Opaque to every consumer: base64url of `{ v: 1, n, id }`. Never parsed outside this module. */
export function encodeCursor({ n, id }: MemberCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, n, id })).toString('base64url');
}

/**
 * The inverse, and TOTAL: not base64url, not JSON, a wrong version, a missing key or an `id` that is
 * not a uuid all answer `null`, which the page query reads as "no cursor" — the first page. Nothing
 * from this string reaches SQL until it has passed `cursorSchema`.
 */
export function decodeCursor(raw: string | undefined): MemberCursor | null {
  if (typeof raw !== 'string' || raw === '') return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = cursorSchema.safeParse(candidate);
  return parsed.success ? { n: parsed.data.n, id: parsed.data.id } : null;
}
