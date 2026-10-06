import { signupBodySchema } from '@rede-social/contracts';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { sessionCookieOptions } from '@/lib/supabase/cookie-options';

/**
 * The sign-up draft that carries a person from a 409 on `/cadastro` to the "já tem conta" state
 * (08.1, D-301, D-302; UI-SPEC UI-D-321).
 *
 * **What it holds.** The e-mail and the name typed in the sign-up form, and nothing else. Never the
 * password: the type has no such field and the decoder is `.strict()`, so a cookie carrying a
 * `password` key (or any other extra key) is refused as a whole (T-08.1-13). The "já tem conta" form
 * asks for the EXISTING password explicitly (RESEARCH A2).
 *
 * **Why a cookie and not the URL.** The e-mail must never appear in a URL, a referrer or a log line
 * (T-08.1-12); the redirect after the 409 carries `estado=ja-tem-conta` only. The cookie is HttpOnly,
 * SameSite=Lax, `Secure` on production builds (the session cookie policy) and lives ten minutes, per
 * origin (the `CONTINUE_COOKIE` precedent in `continue-path.ts`).
 *
 * **Why forging it gains nothing (T-08.1-17).** The draft only names which identity the typed password
 * must match; nothing is written before GoTrue accepts that password, and the name is the person's own
 * input for the community they are joining.
 */
export const JOIN_DRAFT_COOKIE = 'join_draft';

/** Ten minutes: long enough to find the password, short enough that a stale draft cannot resurface. */
export const JOIN_DRAFT_MAX_AGE_S = 600;

export type JoinDraft = { email: string; name: string };

const joinDraftSchema = z.object({ email: z.email(), name: signupBodySchema.shape.name }).strict();

/** base64url of the JSON. Pure. */
export function encodeJoinDraft(draft: JoinDraft): string {
  return Buffer.from(JSON.stringify({ email: draft.email, name: draft.name }), 'utf8').toString(
    'base64url',
  );
}

/**
 * The draft a cookie value stands for, or `null`. Total: garbage, an empty value, non-JSON, a shape
 * mismatch, an invalid e-mail or any extra key (a `password` above all) all answer `null`.
 */
export function decodeJoinDraft(raw: string | null | undefined): JoinDraft | null {
  if (!raw || raw.length > 2048) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = joinDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const draftCookieOptions = { ...sessionCookieOptions, maxAge: JOIN_DRAFT_MAX_AGE_S };

/** Server actions only: remembers the draft on THIS origin for ten minutes. */
export async function writeJoinDraft(draft: JoinDraft): Promise<void> {
  (await cookies()).set(JOIN_DRAFT_COOKIE, encodeJoinDraft(draft), draftCookieOptions);
}

/** Pages and server actions: the draft of this origin, or `null` when absent or unreadable. */
export async function readJoinDraft(): Promise<JoinDraft | null> {
  return decodeJoinDraft((await cookies()).get(JOIN_DRAFT_COOKIE)?.value);
}

/** Server actions only: forgets the draft (after a successful join). */
export async function clearJoinDraft(): Promise<void> {
  (await cookies()).set(JOIN_DRAFT_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
}
