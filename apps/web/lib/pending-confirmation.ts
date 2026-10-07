import { cookies } from 'next/headers';
import { z } from 'zod';
import { sessionCookieOptions } from '@/lib/supabase/cookie-options';

/**
 * The address a sign-up confirmation mail was (or is to be) sent to, remembered between the form and
 * `/verifique-seu-email` (quick 261007-gbk).
 *
 * **What it holds.** The e-mail and, once a mail was requested, the epoch milliseconds of that
 * request (`sentAt`, for the resend cooldown). Never a password: the type has no such field and the
 * decoder is `.strict()`, so a cookie carrying a `password` key (or any other extra key) is refused as
 * a whole.
 *
 * **Why a cookie and not the URL.** The e-mail must never appear in a URL, a referrer or a log line
 * (same reasoning as T-08.1-12 for the join draft); the redirects carry fixed tokens only
 * (`?erro=nao-confirmado`). HttpOnly, SameSite=Lax, `Secure` on production builds, one hour.
 *
 * **Why forging it gains nothing (T-gbk-06).** It only names the address a resend is requested for,
 * which GoTrue's public resend endpoint already accepts from anyone holding the browser key; the
 * answer to a resend is constant (T-gbk-01), so a forged cookie cannot be used to probe accounts.
 */
export const PENDING_CONFIRMATION_COOKIE = 'pending_confirmation';

export const PENDING_CONFIRMATION_MAX_AGE_S = 3600;

/** Mirrors the production `auth.email.max_frequency` (supabase/config.toml, `[remotes.production]`). */
export const RESEND_COOLDOWN_MS = 60_000;

export type PendingConfirmation = { email: string; sentAt?: number };

const pendingSchema = z
  .object({ email: z.email(), sentAt: z.number().int().nonnegative().optional() })
  .strict();

/** base64url of the JSON. Pure. */
export function encodePendingConfirmation(pending: PendingConfirmation): string {
  const value: PendingConfirmation = { email: pending.email };
  if (pending.sentAt !== undefined) value.sentAt = pending.sentAt;
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * The pending confirmation a cookie value stands for, or `null`. Total: garbage, an empty value,
 * non-JSON, a shape mismatch, an invalid e-mail, a bad `sentAt` or any extra key all answer `null`.
 */
export function decodePendingConfirmation(
  raw: string | null | undefined,
): PendingConfirmation | null {
  if (!raw || raw.length > 2048) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = pendingSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * True while a resend must be short-circuited: `sentAt` exists and is less than 60 s old. A `sentAt`
 * in the future (clock skew, a tampered cookie) counts as within the cooldown, so skew never opens
 * the gate.
 */
export function withinResendCooldown(pending: PendingConfirmation, nowMs: number): boolean {
  if (pending.sentAt === undefined) return false;
  return nowMs - pending.sentAt < RESEND_COOLDOWN_MS;
}

/** GoTrue's "right password, unconfirmed e-mail" answer (code `email_not_confirmed`). */
export function isEmailNotConfirmed(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  if (error.code === 'email_not_confirmed') return true;
  return (error.message ?? '').toLowerCase().includes('email not confirmed');
}

const pendingCookieOptions = { ...sessionCookieOptions, maxAge: PENDING_CONFIRMATION_MAX_AGE_S };

/** Server actions only: remembers the address on THIS origin for one hour. */
export async function writePendingConfirmation(pending: PendingConfirmation): Promise<void> {
  (await cookies()).set(
    PENDING_CONFIRMATION_COOKIE,
    encodePendingConfirmation(pending),
    pendingCookieOptions,
  );
}

/** Pages and server actions: the pending confirmation of this origin, or `null`. */
export async function readPendingConfirmation(): Promise<PendingConfirmation | null> {
  return decodePendingConfirmation((await cookies()).get(PENDING_CONFIRMATION_COOKIE)?.value);
}

/** Server actions only: forgets the pending confirmation. */
export async function clearPendingConfirmation(): Promise<void> {
  (await cookies()).set(PENDING_CONFIRMATION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 });
}
