/**
 * The deep link a session-less visitor was reaching for, remembered across the login (FEED-07).
 *
 * **Why this exists.** D-56 makes `/post/{postId}` a link members SEND each other, so the common
 * way to meet it is logged out on a device that has never opened the app. `proxy.ts` bounces every
 * private path to `/entrar` and deliberately clears the query while doing it, and the login action
 * has always landed on `/inicio` — which means, without this, a shared post link routes through
 * login and drops the member on the home feed, one navigation short of the post they were sent.
 *
 * **Why it is a cookie and not a query parameter.** The destination never appears in a URL, in a
 * form field or in the DOM, so nothing a page renders can be steered by it and no referrer carries
 * it. It is `HttpOnly` and `SameSite=Lax`, read exactly once by the login action, and cleared on
 * use.
 *
 * **Why it is scoped to `/post/` and the two event shapes.** These are the only routes in the
 * product meant to travel outside it: `/post/{id}` is the link members send each other (D-56), and
 * `/eventos/{id}` and `/eventos/{id}/entrar` are the links an exported calendar entry carries
 * (06-06, D-211). A member who taps the calendar's `Entrar` while logged out must land back on
 * `/entrar` after the login, or the check-in the tap was meant to record is lost. Remembering EVERY
 * private path would silently change where an ordinary login lands (a member who once bounced off
 * `/configuracoes` would later be teleported there), which is a behaviour change nobody asked for.
 * The event shapes are EXACT: a lowercase uuid, optionally followed by `/entrar` and nothing else
 * (`/eventos/novo`, `…/editar`, `…/entrar/aviso` and an uppercase id are all refused).
 *
 * **The open-redirect rule.** The value is validated at USE, never at write: it must be a path on
 * THIS origin — one leading slash, no second slash or backslash (`//evil.com` and `/\evil.com` are
 * both protocol-relative URLs in a browser), no scheme, no control characters. Anything else is
 * discarded and the login lands on `/inicio` as it always did.
 */
export const CONTINUE_COOKIE = 'tria_continue';

/** Ten minutes: long enough to type a password, short enough that a stale bounce cannot resurface. */
export const CONTINUE_MAX_AGE_S = 600;

/**
 * Which private paths are worth remembering — the shareable post link (D-56) and the two calendar
 * link shapes of an event (D-211), and nothing else.
 */
export function isContinuablePath(path: string): boolean {
  return /^\/post\/[^/]+$/.test(path) || /^\/eventos\/[0-9a-f-]{36}(\/entrar)?$/.test(path);
}

/**
 * The stored value as a path this app may navigate to, or `null`.
 *
 * Deliberately total and deliberately paranoid: it re-runs `isContinuablePath` as well, so a cookie
 * forged with some other private path (an attacker who can set a cookie on this origin) still
 * cannot choose where a login lands beyond the one route this feature is about.
 */
export function safeContinuePath(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (raw.length > 512) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: a header-splitting byte is exactly what must be refused here.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  if (!raw.startsWith('/')) return null;
  // `//host` and `/\host` are protocol-relative URLs, not paths.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  return isContinuablePath(raw) ? raw : null;
}
