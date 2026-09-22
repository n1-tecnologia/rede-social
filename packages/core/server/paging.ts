import { z } from 'zod';

/**
 * The repo's ONE keyset cursor encoder (R-11), lifted verbatim out of
 * `packages/core/server/profiles/search.ts` when 03-07's admin media list needed the same envelope.
 * `profiles/search.ts` now re-exports these, so 03-03's call sites and its unit suite keep working
 * unchanged and exactly one implementation exists in the tree — two copies would drift on the first
 * change to the envelope, and a cursor is the one value that MUST mean the same thing to every
 * endpoint that hands one out.
 *
 * PURE MODULE: no database, no `env`, no logger — the `branding/upload.ts` posture, so every rule
 * here is unit-testable without a stack.
 *
 * THIS MODULE IS TOTAL: no function here has a failure path that raises. A tampered, truncated or
 * stale cursor degrades to "first page", because a 500 on a link somebody shared would be a far
 * worse outcome than a re-read from the top — and because a cursor is attacker-controlled input
 * that must never reach SQL unvalidated (T-03-21, T-03-52).
 *
 * The convention Phase 4's feed inherits: an opaque base64url `{ v, n, id }` envelope whose `n` is
 * the SAME ordered expression the index is built on, over-fetch `limit + 1` to decide `nextCursor`,
 * and clamp `limit` server-side.
 */

/**
 * The envelope version. It exists so a future ordering change can retire old cursors by bumping it:
 * an unrecognised version fails validation and the caller simply starts from the top.
 */
export const CURSOR_VERSION = 1;

const cursorSchema = z.object({ v: z.literal(CURSOR_VERSION), n: z.string(), id: z.uuid() });

/**
 * `n` is the value the rows were ORDERED by, read back from the projection rather than re-derived in
 * JavaScript (the member directory's accent-folded name, the media list's `created_at`), and `id` is
 * the tiebreaker column of the index the order is built on — so the comparison stays index-ordered.
 */
export type KeysetCursor = { n: string; id: string };

/** Opaque to every consumer: base64url of `{ v: 1, n, id }`. Never parsed outside this module. */
export function encodeCursor({ n, id }: KeysetCursor): string {
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, n, id })).toString('base64url');
}

/**
 * The inverse, and TOTAL: not base64url, not JSON, a wrong version, a missing key or an `id` that is
 * not a uuid all answer `null`, which every page query reads as "no cursor" — the first page.
 * Nothing from this string reaches SQL until it has passed `cursorSchema`.
 */
export function decodeCursor(raw: string | undefined): KeysetCursor | null {
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
