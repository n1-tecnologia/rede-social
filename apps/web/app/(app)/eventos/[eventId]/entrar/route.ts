import { enterEvent } from '@/lib/events';
import {
  ENTER_NOTICE_FOR,
  ENTER_NOTICE_REASONS,
  type EnterNoticeReason,
  EVENT_ID_RE,
} from '@/lib/events-view';

/**
 * `GET /eventos/{eventId}/entrar` (06-06, EVENT-04 online, D-207, D-210, D-211, D-218) — the online
 * `Entrar`. For an online event, following this link IS the check-in: it is the URL every `Entrar`
 * anchor points at, in the app and in exported calendars (D-211), so its shape and its GET semantics
 * are effectively permanent (the D-56 lesson).
 *
 * **The gate is the database's, at the instant of the tap.** This handler calls
 * `POST /v1/events/{id}/enter` (`app.events_enter`, SECURITY DEFINER), which decides the window, the
 * member's answer, the online check-in and whether the meeting URL may leave the database at all:
 *  - `forward` / `recorded` / `already` → **303 to the stored meeting URL** — the ONLY moment the URL
 *    reaches the member's browser, and only as this `Location` header (D-207, T-06-35);
 *  - `ended` / `cancelled` / `confirm_first` → 303 to the ONE refusal layout,
 *    `/eventos/{id}/entrar/aviso?motivo=encerrado|cancelado|confirmar` (UI-D-209);
 *  - not found (unknown, another tenant's, removed or in person) → 303 to the detail, whose not-found
 *    screen answers (D-23); a bootstrap refusal → its own path (login, blocked, host mismatch…); a
 *    failure → the detail, which renders its retry screen.
 *
 * **D-218, the recorded mechanism: a plain GET that records only inside the window**, with no
 * interstitial and no POST bounce, because a calendar click must count in one tap (D-210/D-211). The
 * defences are layered:
 *  1. every `Entrar` is a plain `<a target="_blank" rel="noopener noreferrer" data-no-prefetch>`,
 *     never a framework link (nothing prefetches it);
 *  2. the Serwist SW sends every navigation `NetworkOnly` (no warm-up);
 *  3. session cookies are `SameSite=Lax` and `HttpOnly`, so an unfurler or a cross-site subresource
 *     carries no session and `proxy.ts` bounces it to login before this runs;
 *  4. a request announcing itself as a prefetch (`Sec-Purpose` / `Purpose` / Next's own
 *     `Next-Router-Prefetch`) gets `204 no-store` and records nothing — a belt, not the brace;
 *     and so does ANY framework data fetch (the `RSC` header). This one is load-bearing: after the
 *     login of a logged-out calendar tap, the login action's `redirect()` makes the Next SERVER fetch
 *     the destination with `RSC: 1` to inline its payload, and that fetch follows redirects. Without
 *     this, the server itself would record the check-in and then GET the admin-supplied meeting URL
 *     from inside the deployment (a blind server-side request). With it, the framework gets a
 *     non-flight answer and falls back to a real document navigation, and ONLY the browser's own
 *     top-level GET reaches the gate and follows the 303;
 *  5. the side effect lives behind a POST at the API tier.
 * `events-prefetch.spec.ts` proves on a PRODUCTION build that rendering the detail records nothing.
 * The residual — a cross-site top-level navigation carrying the Lax cookie during the window checks a
 * member in on their own row — is accepted risk T-06-39 (planning decision 3).
 *
 * **No open redirect (D-217, T-06-36).** The destination comes ONLY from the database's answer; this
 * handler reads no query parameter, no header and no path segment as a destination. The URL is
 * re-checked to be `https:` before redirecting (the third check, after Zod and the CHECK), and a
 * failed check answers like not-found. The 303 carries `Cache-Control: no-store` and
 * `Referrer-Policy: no-referrer` (T-06-40: the event id never reaches the meeting provider). The URL
 * is never logged.
 */
export const dynamic = 'force-dynamic';

const NO_STORE = 'no-store';

/** A 303 to a path on THIS origin (relative `Location`, so the tenant's own host is kept). */
function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': NO_STORE, 'Referrer-Policy': 'no-referrer' },
  });
}

/**
 * Anything that is not a person's top-level navigation: the prefetch families a browser, a
 * speculation rule or Next's router announce, and every Next data fetch (`RSC`), including the one the
 * server itself issues to inline a server action's redirect target.
 */
function isNotANavigation(request: Request): boolean {
  const purpose = [
    request.headers.get('sec-purpose'),
    request.headers.get('purpose'),
    request.headers.get('x-purpose'),
  ]
    .filter((value): value is string => value !== null)
    .join(' ');
  return (
    /prefetch/i.test(purpose) ||
    request.headers.get('next-router-prefetch') !== null ||
    request.headers.get('rsc') !== null
  );
}

/** The stored URL as an absolute `https:` href, or null (then the tap answers like not-found). */
function httpsTarget(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The refusal layout's path for one reason; the reason is one of three literals, never input. */
function noticePath(eventId: string, reason: EnterNoticeReason): string {
  if (!ENTER_NOTICE_REASONS.includes(reason)) return `/eventos/${eventId}`;
  return `/eventos/${eventId}/entrar/aviso?motivo=${reason}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  // 1. A prefetch or a framework data fetch records nothing and learns nothing (D-218, T-06-37).
  if (isNotANavigation(request)) {
    return new Response(null, { status: 204, headers: { 'Cache-Control': NO_STORE } });
  }

  // 2. Only a well-formed id reaches the API; anything else lands on the detail's not-found.
  const { eventId } = await params;
  if (!EVENT_ID_RE.test(eventId)) return seeOther(`/eventos/${encodeURIComponent(eventId)}`);
  const id = eventId.toLowerCase();
  const detail = `/eventos/${id}`;

  // 3. The gate, decided by the database at this instant.
  const answer = await enterEvent(id);
  if (answer.status === 'redirect') return seeOther(answer.path);
  if (answer.status !== 'ok') return seeOther(detail);

  const { outcome, meetingUrl } = answer.result;
  switch (outcome) {
    case 'forward':
    case 'recorded':
    case 'already': {
      // 4. The ONLY destination is the one the database returned, re-checked to be https.
      const target = httpsTarget(meetingUrl);
      return seeOther(target ?? detail);
    }
    case 'ended':
    case 'cancelled':
    case 'confirm_first':
      // 5. The refusal names its reason on the one layout (UI-D-209).
      return seeOther(noticePath(id, ENTER_NOTICE_FOR[outcome]));
    default:
      return seeOther(detail);
  }
}
