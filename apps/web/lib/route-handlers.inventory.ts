/**
 * The web route-handler inventory (08-10, TENANT-05, D-344): every `apps/web/app/** /route.ts`,
 * classified. The API's isolation gate (`apps/api/tests/isolation-inventory.ts`) proves every API
 * route across tenants; a Next route handler is the browser-facing door to some of those routes, so
 * each one must either name the API route it forwards to — which must itself be in the API inventory
 * — or say why it reaches no tenant data at all.
 *
 * Keys are the handler's path relative to `apps/web/app` (route groups and dynamic segments as they
 * are on disk). Values:
 *
 *   - `{ proxies: '<METHOD> <api path>' | [...] }` — the API route(s) the handler forwards to with the
 *     caller's own Bearer (`apiFetch`); the API re-applies the membership and host checks;
 *   - `{ exempt: '<reason>' }` — host-scoped assets, auth redirects and the CSP report sink.
 *
 * `route-handlers.inventory.test.ts` walks `app/` with `node:fs`, so a NEW handler with no entry here
 * fails `pnpm turbo test`, and so does an entry whose proxied route is not in the API inventory.
 */
export type RouteHandlerEntry = { proxies: string | readonly string[] } | { exempt: string };

export const ROUTE_HANDLER_INVENTORY: Record<string, RouteHandlerEntry> = {
  // ── BFF forwards (the caller's own Bearer, one API call) ────────────────────────────────────
  // The calendar file serialises the event detail the page itself reads (`loadEvent`), so it is
  // classified by the route it forwards to rather than as a host-scoped asset.
  '(app)/eventos/[eventId]/agenda.ics/route.ts': { proxies: 'GET /v1/events/:eventId' },
  '(app)/eventos/[eventId]/entrar/route.ts': { proxies: 'POST /v1/events/:eventId/enter' },
  'api/chat/conversations/[conversationId]/messages/route.ts': {
    proxies: 'GET /v1/chat/conversations/:conversationId/messages',
  },
  'api/chat/conversations/[conversationId]/read/route.ts': {
    proxies: 'POST /v1/chat/conversations/:conversationId/read',
  },
  'api/chat/inbox/route.ts': { proxies: 'GET /v1/chat/inbox' },
  'api/me/counters/route.ts': { proxies: 'GET /v1/me/counters' },
  'api/notifications/[notificationId]/read/route.ts': {
    proxies: 'POST /v1/notifications/:notificationId/read',
  },
  'api/notifications/read-all/route.ts': { proxies: 'POST /v1/notifications/read-all' },
  'api/notifications/seen/route.ts': { proxies: 'POST /v1/notifications/seen' },
  'api/push/subscriptions/route.ts': {
    proxies: [
      'POST /v1/notifications/push-subscriptions',
      'DELETE /v1/notifications/push-subscriptions',
    ],
  },
  'api/stories/views/route.ts': { proxies: 'POST /v1/stories/views' },
  'v1/media/[assetId]/[variant]/route.ts': { proxies: 'GET /v1/media/:assetId/:variant' },

  // ── Exemptions ──────────────────────────────────────────────────────────────────────────────
  'api/csp-report/route.ts': {
    exempt:
      'CSP violation sink (08-08): POST-only, 16 KB cap, logs one bounded csp.violation line and answers 204; reads no session and no tenant row',
  },
  'api/realtime/token/route.ts': {
    exempt:
      "hands the caller's OWN Supabase access token to the browser Realtime client (same-origin GET); calls no API route, and every join is authorised by app.realtime_topic_allowed, proven across tenants by realtime.test.ts 'cross-tenant'",
  },
  'auth/blocked/route.ts': {
    exempt: 'auth redirect: sends a blocked session to /acesso-suspenso; reads no tenant data',
  },
  'auth/confirm/route.ts': {
    exempt:
      'auth redirect: exchanges a GoTrue e-mail link for a session and redirects same-origin only (open-redirect guard); calls no API route',
  },
  'auth/host-mismatch/route.ts': {
    exempt: 'auth redirect to /endereco-invalido; reads no session data and no tenant row',
  },
  'auth/suspended/route.ts': {
    exempt: 'auth redirect to /comunidade-indisponivel; reads no session data and no tenant row',
  },
  'm/[slug]/manifest.webmanifest/route.ts': {
    exempt:
      'host-scoped asset: the per-tenant manifest, decided by the HOST through the public by-host lookup (API case i), never by the path slug; unauthenticated and brand-only',
  },
  'serwist/[path]/route.ts': {
    exempt:
      'the service worker build route (Serwist): the static app shell, no session and no tenant data',
  },
};
