/**
 * The isolation inventory (08-10, TENANT-05, ROADMAP Phase 8 SC 4, D-344): every route the API
 * mounts, classified. The route table (`app.routes` from `src/app.ts`) is the source of truth for
 * "every endpoint"; this map only annotates it.
 *
 * Each key is `"<METHOD> <path>"` exactly as Hono reports it (with `:param` placeholders, `ALL`
 * middleware rows skipped). Each value is ONE of:
 *
 *   - `{ case: '<id>' }` — the cross-tenant case that proves the route. The id is the PREFIX of an
 *     `it(...)` title in `tests/integration/isolation.test.ts` or `tests/integration/realtime.test.ts`
 *     (`'b10'`, `'phase 7 sweep'`, `'inventory sweep: feed'`, …). That case asks the route the
 *     isolation question with a session of tenant A against tenant B's ids or host, and asserts the
 *     positive control beside the negative (T-03-56);
 *   - `{ exempt: '<reason>' }` — the route has no tenant data to leak, or authenticates by a means
 *     other than a tenant session. Exemptions are deliberately few, and each carries its reason.
 *
 * `tests/unit/isolation-inventory.test.ts` (no database, part of `pnpm turbo test`) fails when:
 *   - a mounted route has no entry here (a NEW route shipped without an isolation case);
 *   - an entry names a route that no longer exists (a stale entry hiding a rename);
 *   - a case id matches no `it(` title in the two suites (a deleted or renamed case);
 *   - an exemption's reason is shorter than 10 characters.
 *
 * HOW TO ADD A ROUTE: write its cross-tenant case first (a new `it()` or a new block inside the
 * sweep of its phase, negative beside positive control, plus the wrong-host 403), then add its
 * entry here pointing at that case. Only then does the unit check go green again.
 *
 * WHY CHECKED IN, NOT GENERATED: a generated map would classify a new route automatically, which
 * is exactly the decision this file exists to force on a person. Writing the entry is the moment
 * someone answers "which test proves tenant B cannot reach this?" — and a reviewer sees the answer
 * in the diff.
 */
export type IsolationEntry = { case: string } | { exempt: string };

/** Shared reason for the super_admin lane: no membership, no tenant lane, its own guard. */
const PLATFORM_LANE =
  'super_admin lane behind requireSuperAdmin: no membership and no tenant lane; covered by g, g2 and p';

export const ISOLATION_INVENTORY: Record<string, IsolationEntry> = {
  // ── Infrastructure and public lanes (no tenant session) ────────────────────────────────────
  'GET /v1/openapi.json': {
    exempt: 'the OpenAPI document: static route metadata, reads no tenant row',
  },
  'GET /v1/health': { exempt: 'liveness probe: answers { ok } and reads no tenant row' },
  'GET /v1/public/tenants/by-host': { case: 'i' },
  'GET /v1/public/tenants/:slug': {
    exempt:
      "public pre-login lookup by slug: unauthenticated, answers the one named tenant's public brand only (the case i shape; hosts.test.ts pins the key set)",
  },
  'POST /v1/public/signup/:slug': {
    exempt:
      "public sign-up: unauthenticated, writes one membership into the slug's own tenant only; signup.test.ts proves the refusals",
  },
  'POST /v1/hooks/auth/send-email': {
    exempt:
      'GoTrue Send Email Hook: server-to-server, authenticated by its standard-webhooks signature, no tenant session (send-email-hook.test.ts)',
  },
  'POST /v1/webhooks/mux': {
    exempt:
      "video provider webhook: server-to-server, authenticated by the provider's HMAC over the raw body, no tenant session (mux-webhook.test.ts)",
  },

  // ── /v1/me ──────────────────────────────────────────────────────────────────────────────────
  'GET /v1/me/bootstrap': { case: 'f' },
  'GET /v1/me/counters': { case: 'phase 7 sweep' },
  'GET /v1/me/profile': { case: 'inventory sweep: me and media' },
  'PATCH /v1/me/profile': { case: 'o' },
  'POST /v1/me/profile/dismiss-nudge': { case: 'inventory sweep: me and media' },
  'POST /v1/me/accept-invite': { case: 'inventory sweep: me and media' },
  'GET /v1/me/invite': { case: 'inventory sweep: me and media' },

  // ── /v1/join (08.1 identity lane: requireIdentity, no membership, no tenant lane) ──────────────
  // The full guard matrix and D-302 byte checks live in join.test.ts; 08.1-07 adds the
  // shared-identity cases.
  'GET /v1/join/state': { case: '08.1 join sweep' },
  'GET /v1/join/communities': { case: '08.1 join sweep' },
  'POST /v1/join': { case: '08.1 join sweep' },

  // ── /v1/media (the private bucket's broker) ─────────────────────────────────────────────────
  'GET /v1/media': { case: 'inventory sweep: me and media' },
  'GET /v1/media/:assetId': { case: 'inventory sweep: me and media' },
  // The storage-minting routes: each has a cross-tenant 404 beside the OWNER's positive control in
  // `storage sweep` (T-03-56); the older single-direction cases j, k, l, m and p still run too.
  'GET /v1/media/:assetId/playback': { case: 'storage sweep' },
  'POST /v1/media/uploads': { case: 'storage sweep' },
  'POST /v1/media/uploads/:assetId/complete': { case: 'storage sweep' },
  'GET /v1/media/:assetId/:variant': { case: 'storage sweep' },
  'DELETE /v1/media/:assetId': { case: 'storage sweep' },

  // ── /v1/members (the member directory) ──────────────────────────────────────────────────────
  'GET /v1/members': { case: 'n' },
  'GET /v1/members/:membershipId': { case: 'n' },

  // ── /v1/admin (Phase 8, the tenant admin panel) ─────────────────────────────────────────────
  'GET /v1/admin/moderation-log': { case: 'phase 8 sweep' },
  'GET /v1/admin/members': { case: 'phase 8 sweep' },
  'GET /v1/admin/members/:membershipId': { case: 'phase 8 sweep' },
  'POST /v1/admin/members/:membershipId/block': { case: 'phase 8 sweep' },
  'POST /v1/admin/members/:membershipId/unblock': { case: 'phase 8 sweep' },
  'PUT /v1/admin/members/:membershipId/role': { case: 'phase 8 sweep' },
  'GET /v1/admin/branding': { case: 'phase 8 sweep' },
  'PUT /v1/admin/branding/colors': { case: 'phase 8 sweep' },
  // Storage-minting: `storage sweep` holds the lab admin's own complete as the positive control;
  // the phase 8 sweep also refuses the super-admin-started lab upload.
  'POST /v1/admin/branding/uploads': { case: 'storage sweep' },
  'POST /v1/admin/branding/uploads/:uploadId/complete': { case: 'storage sweep' },
  'DELETE /v1/admin/branding/icon': { case: 'phase 8 sweep' },
  'PATCH /v1/admin/tenant': { case: 'phase 8 sweep' },
  'GET /v1/admin/rules': { case: 'phase 8 sweep' },
  'PUT /v1/admin/rules': { case: 'phase 8 sweep' },

  // ── /v1/platform (the super_admin's lane) ───────────────────────────────────────────────────
  'GET /v1/platform/tenants': { exempt: PLATFORM_LANE },
  'POST /v1/platform/tenants': { exempt: PLATFORM_LANE },
  'GET /v1/platform/tenants/:id': { exempt: PLATFORM_LANE },
  'PATCH /v1/platform/tenants/:id': { exempt: PLATFORM_LANE },
  'POST /v1/platform/tenants/:id/status': { exempt: PLATFORM_LANE },
  'PUT /v1/platform/tenants/:id/modules/:key': { exempt: PLATFORM_LANE },
  'GET /v1/platform/tenants/:id/invites': { exempt: PLATFORM_LANE },
  'POST /v1/platform/tenants/:id/invites/:inviteId/resend': { exempt: PLATFORM_LANE },
  'GET /v1/platform/tenants/:id/domains': { exempt: PLATFORM_LANE },
  'POST /v1/platform/tenants/:id/domains': { exempt: PLATFORM_LANE },
  'POST /v1/platform/tenants/:id/domains/:domainId/verify': { exempt: PLATFORM_LANE },
  'POST /v1/platform/tenants/:id/domains/:domainId/restart': { exempt: PLATFORM_LANE },
  'POST /v1/platform/tenants/:id/domains/:domainId/primary': { exempt: PLATFORM_LANE },
  'DELETE /v1/platform/tenants/:id/domains/:domainId': { exempt: PLATFORM_LANE },
  // The two platform routes that MINT a Storage URL are not exempted: the path tenant is the
  // prefix, and a lab upload completed under the demo id is the unknown-id 404 (`storage sweep`).
  'POST /v1/platform/tenants/:id/branding/uploads': { case: 'storage sweep' },
  'POST /v1/platform/tenants/:id/branding/uploads/:uploadId/complete': { case: 'storage sweep' },
  'PUT /v1/platform/tenants/:id/branding/colors': { exempt: PLATFORM_LANE },
  'DELETE /v1/platform/tenants/:id/branding/icon': { exempt: PLATFORM_LANE },
  'PUT /v1/platform/tenants/:id/branding/look': { exempt: PLATFORM_LANE },

  // ── /v1/feed ────────────────────────────────────────────────────────────────────────────────
  'GET /v1/feed': { case: 'a' },
  'GET /v1/feed/video-communities': { case: 'b9' },
  'GET /v1/feed/posts/:postId': { case: 'b' },
  'POST /v1/feed/posts': { case: 'inventory sweep: feed' },
  'PATCH /v1/feed/posts/:postId': { case: 'inventory sweep: feed' },
  'DELETE /v1/feed/posts/:postId': { case: 'inventory sweep: feed' },
  'POST /v1/feed/posts/:postId/like': { case: 'inventory sweep: feed' },
  'DELETE /v1/feed/posts/:postId/like': { case: 'inventory sweep: feed' },
  'GET /v1/feed/posts/:postId/comments': { case: 'inventory sweep: feed' },
  'POST /v1/feed/posts/:postId/comments': { case: 'inventory sweep: feed' },
  'DELETE /v1/feed/comments/:commentId': { case: 'phase 8 sweep' },
  'POST /v1/feed/comments/:commentId/like': { case: 'inventory sweep: feed' },
  'DELETE /v1/feed/comments/:commentId/like': { case: 'inventory sweep: feed' },
  'GET /v1/feed/comments/:commentId/replies': { case: 'inventory sweep: feed' },
  'GET /v1/feed/comments/:commentId/thread': { case: 'phase 7 sweep' },

  // ── /v1/communities ─────────────────────────────────────────────────────────────────────────
  'GET /v1/communities': { case: 'b2' },
  'GET /v1/communities/:communityId': { case: 'b2' },
  'POST /v1/communities': { case: 'b5' },
  'PUT /v1/communities/order': { case: 'inventory sweep: event photos and community order' },
  'PATCH /v1/communities/:communityId': { case: 'inventory sweep: stories and communities' },

  // ── /v1/stories ─────────────────────────────────────────────────────────────────────────────
  'GET /v1/stories/mine': { case: 'inventory sweep: stories and communities' },
  'GET /v1/stories/highlights': { case: 'b7' },
  'GET /v1/stories/highlights/catalog': { case: 'inventory sweep: stories and communities' },
  'PUT /v1/stories/highlights/order': { case: 'inventory sweep: stories and communities' },
  'GET /v1/stories/highlights/:highlightId': { case: 'b7' },
  'POST /v1/stories/highlights': { case: 'b7' },
  'PUT /v1/stories/highlights/:highlightId/stories/:storyId': { case: 'b7' },
  'PATCH /v1/stories/highlights/:highlightId': { case: 'inventory sweep: stories and communities' },
  'DELETE /v1/stories/highlights/:highlightId': {
    case: 'inventory sweep: stories and communities',
  },
  'DELETE /v1/stories/highlights/:highlightId/stories/:storyId': {
    case: 'inventory sweep: stories and communities',
  },
  'POST /v1/stories/views': { case: 'b8' },
  'GET /v1/stories': { case: 'b3' },
  'GET /v1/stories/:storyId': { case: 'b3' },
  'POST /v1/stories': { case: 'b6' },
  'DELETE /v1/stories/:storyId': { case: 'inventory sweep: stories and communities' },
  'POST /v1/stories/:storyId/likes': { case: 'inventory sweep: stories and communities' },
  'DELETE /v1/stories/:storyId/likes': { case: 'inventory sweep: stories and communities' },
  'GET /v1/stories/:storyId/comments': { case: 'inventory sweep: stories and communities' },
  'POST /v1/stories/:storyId/comments': { case: 'inventory sweep: stories and communities' },
  'DELETE /v1/stories/:storyId/comments/:commentId': { case: 'phase 8 sweep' },
  'GET /v1/stories/:storyId/highlights': { case: 'inventory sweep: stories and communities' },

  // ── /v1/events ──────────────────────────────────────────────────────────────────────────────
  'GET /v1/events': { case: 'b4' },
  'POST /v1/events': { case: 'inventory sweep: events' },
  'GET /v1/events/next': { case: 'inventory sweep: events' },
  'GET /v1/events/:eventId': { case: 'b4' },
  'PUT /v1/events/:eventId/rsvp': { case: 'b4' },
  'GET /v1/events/:eventId/edit': { case: 'inventory sweep: events' },
  'GET /v1/events/:eventId/photos': { case: 'inventory sweep: event photos and community order' },
  'POST /v1/events/:eventId/photos': { case: 'inventory sweep: event photos and community order' },
  'DELETE /v1/events/:eventId/photos/:photoId': {
    case: 'inventory sweep: event photos and community order',
  },
  'PUT /v1/events/:eventId': { case: 'inventory sweep: events' },
  'PATCH /v1/events/:eventId': { case: 'inventory sweep: events' },
  'POST /v1/events/:eventId/check-in': { case: 'b4' },
  'POST /v1/events/:eventId/enter': { case: 'b4' },
  'GET /v1/events/:eventId/attendance/summary': { case: 'inventory sweep: events' },
  'GET /v1/events/:eventId/attendance': { case: 'inventory sweep: events' },
  'POST /v1/events/:eventId/checkin-code': { case: 'inventory sweep: events' },

  // ── /v1/notifications ───────────────────────────────────────────────────────────────────────
  'GET /v1/notifications': { case: 'b10' },
  'POST /v1/notifications/seen': { case: 'phase 7 sweep' },
  'POST /v1/notifications/read-all': { case: 'phase 7 sweep' },
  'POST /v1/notifications/:notificationId/read': { case: 'phase 7 sweep' },
  'POST /v1/notifications/push-subscriptions': { case: 'b11' },
  'DELETE /v1/notifications/push-subscriptions': { case: 'b11' },

  // ── /v1/chat ────────────────────────────────────────────────────────────────────────────────
  'GET /v1/chat/support': { case: 'phase 7 sweep' },
  'POST /v1/chat/support/messages': { case: 'phase 7 sweep' },
  'GET /v1/chat/conversations/:conversationId/messages': { case: 'b12' },
  'POST /v1/chat/conversations/:conversationId/messages': { case: 'phase 7 sweep' },
  'GET /v1/chat/conversations/:conversationId': { case: 'phase 7 sweep' },
  'POST /v1/chat/conversations/:conversationId/read': { case: 'phase 7 sweep' },
  'GET /v1/chat/inbox': { case: 'phase 7 sweep' },
  // ── /v1/store (08.2) ────────────────────────────────────────────────────────────────────────
  'GET /v1/store/products': { case: 'phase 08.2 sweep: store' },
  'GET /v1/store/products/:productId': { case: 'phase 08.2 sweep: store' },
  'GET /v1/store/community-access': { case: 'phase 08.2 sweep: store' },
  'GET /v1/store/communities/:communityId/access': { case: 'phase 08.2 sweep: store' },
  'POST /v1/store/products': { case: 'phase 08.2 sweep: store' },
  'POST /v1/store/products/:productId/purchase': { case: 'phase 08.2 sweep: store' },
};

/**
 * Every Realtime topic KIND of `REALTIME_TOPIC_PATTERN` (`@rede-social/contracts/realtime`), mapped to
 * the live cross-tenant case that joins tenant B's topic of that kind with a tenant-A session. The
 * unit check parses the kinds out of the pattern itself, so a fifth kind added to the contract fails
 * until it has an entry here (and a join in that case).
 */
export const REALTIME_TOPIC_INVENTORY: Record<string, { case: string }> = {
  all: { case: 'cross-tenant' },
  user: { case: 'cross-tenant' },
  'support-inbox': { case: 'cross-tenant' },
  conv: { case: 'cross-tenant' },
};

/**
 * Every Storage bucket a migration creates, mapped to the API case that proves its minting routes
 * across tenants and to the pgTAP file that pins its `storage.objects` policies inside Postgres. The
 * unit check reads the bucket ids from `supabase/migrations`, so a new bucket fails until it is here.
 */
export const STORAGE_BUCKET_INVENTORY: Record<string, { case: string; pgtap: string }> = {
  branding: { case: 'storage sweep', pgtap: '060-branding-bucket.sql' },
  media: { case: 'storage sweep', pgtap: '070-media-bucket.sql' },
};
