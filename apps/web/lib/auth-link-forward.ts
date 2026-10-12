/**
 * The forward rule for a token link that reached `/` instead of `/auth/confirm` (quick 261012-s0v).
 *
 * **Why this exists.** GoTrue honours `redirect_to` only when its host is in the hosted
 * `uri_allow_list`, and every `supabase config push` re-applies `[auth] additional_redirect_urls`
 * from `config.toml`, wiping the per-domain entries the API added at verification (docs/DEPLOY.md,
 * WR-09). While an entry is missing GoTrue falls back to `site_url` and mails
 * `https://<site_url>?token_hash=…&type=…` — no path at all. `proxy.ts` used to treat that `/` as an
 * ordinary private path and bounce it to `/entrar` with the query cleared, so the token was lost
 * and the e-mail was never confirmed.
 *
 * **Why forwarding adds no new trust.** `app/auth/confirm/route.ts` already validates the OTP
 * `type` against `OTP_TYPES`, honours `next` only as a same-origin path and routes every failure.
 * The forward keeps the request's own origin (scheme, host, port) and query and rewrites ONLY the
 * pathname, so it cannot leave the origin and cannot widen what `/auth/confirm` accepts; a visitor
 * who types `/?token_hash=x&type=signup` by hand just reaches the same route they could reach
 * directly.
 *
 * **What it does not change.** Where the session lands AFTER a confirmation on the platform host
 * (no `next` → `/inicio` → the Phase 1 host/membership handling) is unchanged; Task 1 of the same
 * quick makes the common case land on the tenant host in the first place.
 */
export function authLinkForwardTarget(url: URL): URL | null {
  if (url.pathname !== '/') return null;
  if (!url.searchParams.has('token_hash') || !url.searchParams.has('type')) return null;
  const target = new URL(url.href);
  target.pathname = '/auth/confirm';
  return target;
}
