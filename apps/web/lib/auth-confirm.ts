import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * Pure helpers of the mail-link confirmation (`/auth/confirm` and its interstitial
 * `/auth/continuar`, quick 261117-kkx). They live here, not in the route file, because a Next route
 * file may only export HTTP methods, and the page, the install gate and the route all need them.
 * Server and client safe: no server-only import, no logging (the token must never reach a log).
 */

/** Where a successful confirmation lands when `next` is absent or unsafe. */
export const DEFAULT_NEXT = '/inicio';

/** The route that consumes the token (POST) and receives the mail link (GET, inert). */
export const CONFIRM_POST_PATH = '/auth/confirm';

/** The interstitial a mail link is handed to: one button that POSTs the token back. */
export const CONFIRM_CONTINUE_PATH = '/auth/continuar';

/**
 * Open-redirect guard (T-05-01, phase-1 review WR-10). `next` is honoured ONLY as a same-origin
 * path. The check is done by the URL parser, not by a regex: `new URL(next, origin)` resolves
 * `next` exactly the way the browser will resolve the `Location` header, so every spelling of an
 * absolute or scheme-relative URL — `https://evil.example`, `//evil.example`, and the WHATWG
 * backslash form `/\evil.example` that a `^\/(?!\/)` regex let through — lands on a different
 * origin and falls back. What survives is re-emitted as `pathname + search` (never the raw input),
 * so the redirect can only ever be a path on this origin.
 */
export function sameOriginPath(next: string, origin: string): string {
  if (!next.startsWith('/')) return DEFAULT_NEXT;
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return DEFAULT_NEXT;
    return `${url.pathname}${url.search}`;
  } catch {
    return DEFAULT_NEXT;
  }
}

/**
 * The same guard for callers with no request origin (the interstitial page): `next` is resolved
 * against a fixed reference origin that is only the URL parser's base and never leaves this
 * function.
 */
const REFERENCE_ORIGIN = 'http://confirm.invalid';

export function sanitizeNext(raw: string | null | undefined): string {
  return sameOriginPath(raw ?? '', REFERENCE_ORIGIN);
}

/** The invite's landing path; a failed link aimed there is an invite, whatever its `type`. */
const ACCEPT_INVITE_PATH = '/aceitar-convite';

export function isAcceptInvitePath(safeNext: string): boolean {
  return safeNext.split('?')[0] === ACCEPT_INVITE_PATH;
}

/** The OTP types this flow accepts; anything else is treated as an invalid link. */
export const OTP_TYPES: readonly EmailOtpType[] = [
  'recovery',
  'email',
  'signup',
  'invite',
  'magiclink',
];

export function isOtpType(value: string | null | undefined): value is EmailOtpType {
  return typeof value === 'string' && (OTP_TYPES as readonly string[]).includes(value);
}

/**
 * Where a link that cannot be (or was not) exchanged lands:
 * - an invite (`type=invite`, or a `next` that is exactly the invite landing: the WR-04 resend
 *   fallback mails a recovery-type link there, 02-REVIEW IN-03) -> the expired-invite screen;
 * - a sign-up confirmation -> the verification screen, where a new mail can be asked for;
 * - everything else (missing params, unknown type, expired or used token) -> ask for a fresh link.
 */
export function failureDestination(type: string | null, safeNext: string): string {
  if (type === 'invite' || isAcceptInvitePath(safeNext)) return '/convite-expirado';
  if (type === 'signup') return '/verifique-seu-email?erro=link-invalido';
  return '/esqueci-senha?erro=link-invalido';
}

/** The interstitial URL for a valid-shaped link: token_hash, type, then the sanitised next. */
export function continueHref(tokenHash: string, type: string, safeNext: string): string {
  const params = new URLSearchParams();
  params.set('token_hash', tokenHash);
  params.set('type', type);
  params.set('next', safeNext);
  return `${CONFIRM_CONTINUE_PATH}?${params.toString()}`;
}

/**
 * Positive evidence that a POST to `/auth/confirm` was triggered by another site. Evidence only,
 * on purpose, so a real member is never refused for a header a browser or privacy setting hides:
 * - `Sec-Fetch-Site: cross-site` is refused. `same-site` is NOT refused on its own (older Safari
 *   sends no Sec-Fetch-Site, and a sibling subdomain is caught by the Origin host check below).
 * - An `Origin` that is present, is not the literal `null` and does not parse, or whose host
 *   (port included) is none of the request's own `hosts`, is refused.
 * - `Origin: null` is accepted: browsers send it on same-origin form POSTs from pages with a
 *   no-referrer policy and from some privacy contexts, and the token is the credential, so a
 *   missing proof of origin is not proof of an attack.
 * - No `hosts` to compare with: nothing to judge, so accepted (fails open).
 */
export function isCrossSiteSubmission(
  headers: { get(name: string): string | null },
  hosts: readonly string[],
): boolean {
  if (hosts.length === 0) return false;
  if (headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = headers.get('origin');
  if (origin === null || origin === 'null') return false;
  try {
    return !hosts.includes(new URL(origin).host);
  } catch {
    return true;
  }
}
