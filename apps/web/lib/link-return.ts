import { sessionCookieOptions } from '@/lib/supabase/cookie-options';

/**
 * The "link return" marker (quick 261007-kyp): a small cookie `/auth/confirm` writes after it
 * successfully exchanged a one-time mail link, so the install gate can tell a phone that just came
 * back from a confirmation, recovery or invite mail from one that never installed anything.
 *
 * Server and client safe on purpose: it imports nothing but the cookie policy (never `lib/push`,
 * never a UI package), because the route handler and the root layout both import it and a
 * `'use client'` module graph must not leak into a route handler.
 *
 * Why the password forms are exempt (`linkReturnScreen` answers `pass`): the one-time session that
 * `verifyOtp` created exists only in the browser that opened the link, and an iOS home-screen app
 * has its own cookie jar. So a recovery or invite link opened in a phone browser cannot be finished
 * in the installed app: `/redefinir-senha` and `/aceitar-convite` must run right there, while the
 * matching marker stands. Sign-up confirmation is finished in the browser, so it only needs the
 * "E-mail confirmado, abra o app" screen.
 *
 * Why HttpOnly and host-only (no `Domain`): it stays on the origin that served the link, so one
 * tenant's marker never reaches another origin, and no script can read it. Forging it gains nothing
 * (T-kyp-02): the value is parsed against a three-word allow-list and never echoed, and all it can do
 * is change which screen a gated device shows or exempt a password form that is already a public,
 * session-gated page. It authorizes nothing.
 */
export const LINK_RETURN_COOKIE = 'link_return';

export const LINK_RETURN_MAX_AGE_S = 600;

export type LinkReturn = 'signup' | 'recovery' | 'invite';

export const linkReturnCookieOptions = {
  ...sessionCookieOptions,
  maxAge: LINK_RETURN_MAX_AGE_S,
};

const INVITE_PATH = '/aceitar-convite';
const RECOVERY_PATH = '/redefinir-senha';

function pathOf(safeNext: string): string {
  return safeNext.split('?')[0] ?? '';
}

/**
 * The marker a successful exchange of `type` that redirects to `safeNext` stands for, or `null`
 * (magic links and unknown types write nothing). An invite is `type=invite` OR a `next` that is
 * exactly the invite landing (the invite mail's recovery-type fallback, the same rule the route's
 * failure branch uses), checked first.
 */
export function linkReturnFor(type: string, safeNext: string): LinkReturn | null {
  if (type === 'invite' || pathOf(safeNext) === INVITE_PATH) return 'invite';
  if (type === 'recovery') return 'recovery';
  if (type === 'signup' || type === 'email') return 'signup';
  return null;
}

/** Strict allow-list read of the cookie value; unknown input is never echoed. */
export function parseLinkReturn(raw: string | null | undefined): LinkReturn | null {
  if (raw === 'signup' || raw === 'recovery' || raw === 'invite') return raw;
  return null;
}

function underPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * What a gated device shows for the marker on `pathname`: `show` the link-return screen, `pass`
 * (the matching password form runs in this browser) or `null` (no marker, no special screen).
 */
export function linkReturnScreen(
  marker: LinkReturn | null,
  pathname: string,
): 'show' | 'pass' | null {
  if (marker === null) return null;
  if (marker === 'recovery') return underPath(pathname, RECOVERY_PATH) ? 'pass' : 'show';
  if (marker === 'invite') return underPath(pathname, INVITE_PATH) ? 'pass' : 'show';
  return 'show';
}
