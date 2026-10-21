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
  'GET /v1/webhooks/:provider/:integrationId': {
    exempt:
      "payment gateway liveness probe: answers a static { status: 'ok' } and reads no row (payments-webhook.test.ts)",
  },
  'POST /v1/webhooks/:provider/:integrationId': {
    exempt:
      "payment gateway webhook: server-to-server, authenticated by the integration's own token as an HMAC over the raw bytes; the tenant comes from the integration row and no tenant session exists; payments-webhook.test.ts and payments-apply.test.ts pin the wrong-signature, wrong-integration and cross-tenant-product cases",
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
  'GET /v1/platform/tenants/:id/modules/social/settings': { exempt: PLATFORM_LANE },
  'PUT /v1/platform/tenants/:id/modules/social/settings': { exempt: PLATFORM_LANE },
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
  'POST /v1/store/products/lock-preview': { case: 'phase 08.2 sweep: store' },
  'PATCH /v1/store/products/:productId': { case: 'phase 08.2 sweep: store' },
  'PUT /v1/store/products/:productId/status': { case: 'phase 08.2 sweep: store' },
  'POST /v1/store/products/:productId/purchase': { case: 'phase 08.2 sweep: store' },
  'GET /v1/store/products/:productId/buyers': { case: 'phase 08.2 sweep: store' },
  'POST /v1/store/products/:productId/grants': { case: 'phase 08.2 sweep: store' },
  'DELETE /v1/store/products/:productId/entitlements/:entitlementId': {
    case: 'phase 08.2 sweep: store',
  },
  // Course and live access reads (08.5-05, STORE-23): a rede-lab member's lists name no rede-demo
  // course or live and its single reads of rede-demo ids are the bare 404; a rede-demo session on
  // the lab host is refused; beside each tenant's own lists and reads.
  'GET /v1/store/course-access': { case: 'phase 08.5 sweep: store course and live access' },
  'GET /v1/store/courses/:courseId/access': {
    case: 'phase 08.5 sweep: store course and live access',
  },
  'GET /v1/store/live-access': { case: 'phase 08.5 sweep: store course and live access' },
  'GET /v1/store/lives/:liveId/access': { case: 'phase 08.5 sweep: store course and live access' },

  // ── /v1/courses (08.3) ──────────────────────────────────────────────────────────────────────
  'GET /v1/courses/categories': { case: 'phase 08.3 sweep: courses' },
  'POST /v1/courses/categories': { case: 'phase 08.3 sweep: courses' },
  'PATCH /v1/courses/categories/:categoryId': { case: 'phase 08.3 sweep: courses' },
  'DELETE /v1/courses/categories/:categoryId': { case: 'phase 08.3 sweep: courses' },
  'GET /v1/courses': { case: 'phase 08.3 sweep: courses' },
  'POST /v1/courses': { case: 'phase 08.3 sweep: courses' },
  'GET /v1/courses/:courseId': { case: 'phase 08.3 sweep: courses' },
  'PATCH /v1/courses/:courseId': { case: 'phase 08.3 sweep: courses' },
  'POST /v1/courses/:courseId/modules': { case: 'phase 08.3 sweep: courses' },
  'POST /v1/courses/modules/:moduleId/lessons': { case: 'phase 08.3 sweep: courses' },
  'PUT /v1/courses/:courseId/status': { case: 'phase 08.3 sweep: courses' },
  'PATCH /v1/courses/modules/:moduleId': { case: 'phase 08.3 sweep: courses' },
  'DELETE /v1/courses/modules/:moduleId': { case: 'phase 08.3 sweep: courses' },
  'PUT /v1/courses/:courseId/modules/order': { case: 'phase 08.3 sweep: courses' },
  'GET /v1/courses/lessons/:lessonId': { case: 'phase 08.3 sweep: courses' },
  'PATCH /v1/courses/lessons/:lessonId': { case: 'phase 08.3 sweep: courses' },
  'DELETE /v1/courses/lessons/:lessonId': { case: 'phase 08.3 sweep: courses' },
  'PUT /v1/courses/modules/:moduleId/lessons/order': { case: 'phase 08.3 sweep: courses' },
  'PUT /v1/courses/lessons/:lessonId/materials': { case: 'phase 08.3 sweep: courses' },
  'GET /v1/courses/lessons/:lessonId/materials/:materialId/url': {
    case: 'phase 08.3 sweep: courses',
  },
  // Tracks (08.3-10, D-415): the sweep's lab admin cannot read, edit, archive or order a demo track
  // (bare 404) and cannot link a demo course to its own track (400 course_invalid, by name).
  'GET /v1/courses/tracks': { case: 'phase 08.3 sweep: courses' },
  'POST /v1/courses/tracks': { case: 'phase 08.3 sweep: courses' },
  'GET /v1/courses/tracks/:trackId': { case: 'phase 08.3 sweep: courses' },
  'PATCH /v1/courses/tracks/:trackId': { case: 'phase 08.3 sweep: courses' },
  'PUT /v1/courses/tracks/:trackId/status': { case: 'phase 08.3 sweep: courses' },
  'PUT /v1/courses/tracks/:trackId/order': { case: 'phase 08.3 sweep: courses' },
  // Lives (08.3-11, D-416, COURSE-11): the sweep's lab admin cannot read, edit or cancel a demo live
  // (bare 404) and cannot gate its own live with a demo product or replay it with a demo lesson (400
  // by name); the picker list never names a demo lesson.
  'GET /v1/courses/lives': { case: 'phase 08.3 sweep: courses' },
  'POST /v1/courses/lives': { case: 'phase 08.3 sweep: courses' },
  'GET /v1/courses/lives/:liveId': { case: 'phase 08.3 sweep: courses' },
  'PATCH /v1/courses/lives/:liveId': { case: 'phase 08.3 sweep: courses' },
  'POST /v1/courses/lives/:liveId/cancel': { case: 'phase 08.3 sweep: courses' },
  'GET /v1/courses/lessons': { case: 'phase 08.3 sweep: courses' },
  // Member lane (08.5-01, COURSE-26): a rede-lab member gets the bare 404 for a rede-demo course
  // and lesson id, a rede-demo session on the lab host is refused, beside the demo member's read.
  'GET /v1/courses/learn/courses/:courseId': { case: 'phase 08.5 sweep: courses learn' },
  'GET /v1/courses/learn/lessons/:lessonId': { case: 'phase 08.5 sweep: courses learn' },
  // Member writes (08.5-03, EP-37): a rede-lab member's progress write and material URL on rede-demo
  // ids are the bare 404 and write nothing; a rede-demo session on the lab host is refused; beside
  // the demo member's own write and URL.
  'PUT /v1/courses/learn/lessons/:lessonId/progress': { case: 'phase 08.5 sweep: courses learn' },
  'GET /v1/courses/learn/lessons/:lessonId/materials/:materialId/url': {
    case: 'phase 08.5 sweep: courses learn',
  },
  // Member catalogue and lives (08.5-04): a rede-lab member's catalogue and agenda list nothing of
  // rede-demo and its read of a rede-demo live id is the bare 404 with no join link; a rede-demo
  // session on the lab host is refused; beside the demo member's own catalogue, agenda and live.
  'GET /v1/courses/learn/courses': { case: 'phase 08.5 sweep: courses learn' },
  'GET /v1/courses/learn/lives': { case: 'phase 08.5 sweep: courses learn' },
  'GET /v1/courses/learn/lives/:liveId': { case: 'phase 08.5 sweep: courses learn' },
  // Member area (08.6-01, COURSE-51): a rede-lab member's overview names no rede-demo course or
  // lesson id, a rede-demo session on the lab host is refused, beside the demo member's own read.
  'GET /v1/courses/learn/overview': { case: 'phase 08.6 sweep: courses member area' },
  // 08.6-04 (COURSE-51): the lab member's Trilhas name no rede-demo track or course id, and a
  // rede-demo session on the lab host is refused, beside the demo member's own tracks.
  'GET /v1/courses/learn/tracks': { case: 'phase 08.6 sweep: courses member area' },
  // 08.6-04 (COURSE-51): the lab member's own progress names no rede-demo course id, and a
  // rede-demo session on the lab host is refused, beside the demo member's own progress.
  'GET /v1/courses/learn/progress': { case: 'phase 08.6 sweep: courses member area' },
  // 08.6-05 (COURSE-51, EP-70): a rede-lab member's reminder read, opt-in and opt-out on a rede-demo
  // live id are the bare 404 and write nothing; a rede-demo session on the lab host is refused;
  // beside the rede-demo member's own 200s.
  'GET /v1/courses/learn/lives/:liveId/reminder': { case: 'phase 08.6 sweep: courses member area' },
  'PUT /v1/courses/learn/lives/:liveId/reminder': { case: 'phase 08.6 sweep: courses member area' },
  'DELETE /v1/courses/learn/lives/:liveId/reminder': {
    case: 'phase 08.6 sweep: courses member area',
  },
  // 08.6-06 (D-452, COURSE-43, COURSE-51): a rede-lab admin's reactivation read and write on a
  // rede-demo live id are the bare 404 and change nothing; a rede-demo admin on the lab host is
  // refused; beside the rede-demo admin's own read and reactivation.
  'POST /v1/courses/lives/:liveId/reactivate': {
    case: 'phase 08.6 sweep: courses live reactivation',
  },
  'GET /v1/courses/lives/:liveId/reactivation': {
    case: 'phase 08.6 sweep: courses live reactivation',
  },
  // 08.7-01 (D-462, INSIGHT-06, INSIGHT-18): the lab admin's overview names no rede-demo membership
  // or tenant id and counts only lab members; a rede-demo session on the lab host is refused; beside
  // the demo admin's own overview.
  'GET /v1/dashboard/owner/overview': { case: 'phase 08.7 sweep: dashboard owner' },
  // 08.7-02 (D-462, INSIGHT-08, INSIGHT-18): the lab admin's Membros answer names no rede-demo
  // community or event id; a rede-demo session on the lab host is refused; beside the demo admin's
  // own answer.
  'GET /v1/dashboard/owner/members': { case: 'phase 08.7 sweep: dashboard owner' },
  // 08.7-04 (D-462, INSIGHT-06, INSIGHT-09, T-08.7-12): a rede-lab admin's band list on a rede-demo
  // community or event scopeId and its member detail on a rede-demo membership id are the bare 404;
  // a rede-demo session on the lab host is refused; beside the demo admin's own 200s.
  'GET /v1/dashboard/owner/members/bands/:band': { case: 'phase 08.7 sweep: dashboard owner' },
  'GET /v1/dashboard/owner/members/:membershipId': { case: 'phase 08.7 sweep: dashboard owner' },
  // 08.7-04 Task 2 (D-461, D-462, PD-9): a rede-lab admin's member list on a rede-demo membership id
  // is the bare 404; a rede-demo session on the lab host is refused; beside the demo admin's 200.
  'GET /v1/dashboard/owner/members/:membershipId/lists/:list': {
    case: 'phase 08.7 sweep: dashboard owner',
  },
  // 08.7-06 (D-462, INSIGHT-10, INSIGHT-18): the lab admin's Conteúdo answer names no rede-demo
  // post, story or tenant id; a rede-demo session on the lab host is refused; beside the demo
  // admin's own answer.
  'GET /v1/dashboard/owner/content': { case: 'phase 08.7 sweep: dashboard owner' },
  // 08.7-06 Task 2 (D-462, T-08.7-12, P4): a rede-lab admin's detail and people list on a rede-demo
  // post or story id are the bare 404; its interactions and unanswered lists name no rede-demo id; a
  // rede-demo session on the lab host is refused; beside the demo admin's own 200s.
  'GET /v1/dashboard/owner/content/items/:itemId': { case: 'phase 08.7 sweep: dashboard owner' },
  'GET /v1/dashboard/owner/content/items/:itemId/people/:who': {
    case: 'phase 08.7 sweep: dashboard owner',
  },
  'GET /v1/dashboard/owner/content/interactions': { case: 'phase 08.7 sweep: dashboard owner' },
  'GET /v1/dashboard/owner/content/unanswered': { case: 'phase 08.7 sweep: dashboard owner' },
  // 08.7-08 (D-460, INSIGHT-11, INSIGHT-18, T-08.7-01): the lab admin's Eventos answer names no
  // rede-demo event or tenant id; a rede-demo session on the lab host is refused; beside the demo
  // admin's own answer (the module and role gates live in dashboard-owner-events.test.ts).
  'GET /v1/dashboard/owner/events': { case: 'phase 08.7 sweep: dashboard owner' },
  // 08.7-09 (D-460, D-462, INSIGHT-12, INSIGHT-18, T-08.7-12): the lab admin's Financeiro answer
  // (store on for the call) names no rede-demo product, post, event, membership or tenant id; a
  // rede-demo session on the lab host is refused; beside the demo admin's own answer (the store and
  // role gates live in dashboard-owner-finance.test.ts).
  'GET /v1/dashboard/owner/finance': { case: 'phase 08.7 sweep: dashboard owner' },
  // 08.7-09 Task 2 (D-462, T-08.7-12, T-08.7-21): the lab admin (store on for the call) on a
  // rede-demo product id gets the bare 404 for the detail and the product's buyers list, and its
  // own buyers list names no rede-demo id; a rede-demo session on the lab host is refused; beside
  // the demo admin's own 200s.
  'GET /v1/dashboard/owner/finance/products/:productId': {
    case: 'phase 08.7 sweep: dashboard owner',
  },
  'GET /v1/dashboard/owner/finance/buyers/:list': { case: 'phase 08.7 sweep: dashboard owner' },
  // 08.7-11 (D-460, INSIGHT-13, INSIGHT-18, T-08.7-01, T-08.7-23): the lab admin's Atendimento
  // answer (chat on for the call) names no rede-demo staff, conversation, membership or tenant id; a
  // rede-demo session on the lab host is refused; beside the demo admin's own answer (the chat and
  // role gates and EP-43 live in dashboard-owner-support.test.ts).
  'GET /v1/dashboard/owner/support': { case: 'phase 08.7 sweep: dashboard owner' },
  // 08.7-03 (D-463, T-08.7-09, INSIGHT-18): a rede-lab member's activity is its own row only and
  // names no rede-demo id; a rede-demo session on the lab host is refused; beside the demo member's
  // own read. The route takes no parameter (staff 403 lives in dashboard-member.test.ts).
  'GET /v1/dashboard/activity': { case: 'phase 08.7 sweep: dashboard activity' },
  // 09-02 (FOLLOW-01..04, SOCIAL-10, T-09-03, T-09-04): the six `/v1/social` routes. Enabled on BOTH
  // tenants for the case: a rede-lab member follows within rede-lab (200) and names a rede-demo
  // membership (bare 404 on PUT and the social read, 200 `following: false` on DELETE, `false` in the
  // batch state), the lists and the counts name nothing of the other tenant in either direction, and
  // a session of the other tenant on this host is refused with 403 TENANT_HOST_MISMATCH on all six
  // routes. The pgTAP side (the own-row policies, the seam, the definer, the shared identity) lives in
  // `200-social.sql`, `020-tenant-isolation.sql` and `160-shared-identity.sql` fact 9.
  'PUT /v1/social/follows/:membershipId': { case: 'phase 09 sweep: social follows' },
  'DELETE /v1/social/follows/:membershipId': { case: 'phase 09 sweep: social follows' },
  'POST /v1/social/follows/state': { case: 'phase 09 sweep: social follows' },
  'GET /v1/social/me/followers': { case: 'phase 09 sweep: social follows' },
  'GET /v1/social/me/following': { case: 'phase 09 sweep: social follows' },
  'GET /v1/social/members/:membershipId': { case: 'phase 09 sweep: social follows' },
  // ── /v1/payments (09.1, the Pagamentos admin API) ────────────────────────────────────────────
  // 09.1-09 (PAY-01, PAY-29, T-09.1-40): the overview names nothing of the other tenant, the preview
  // counts only this tenant's members and a session of the other tenant on this host is refused with
  // TENANT_HOST_MISMATCH. Every route takes the tenant from the session, never from the path or body.
  'GET /v1/payments/overview': { case: 'phase 09.1 sweep: payments admin' },
  'PUT /v1/payments/integration': { case: 'phase 09.1 sweep: payments admin' },
  'POST /v1/payments/access-products': { case: 'phase 09.1 sweep: payments admin' },
  'GET /v1/payments/gate/preview': { case: 'phase 09.1 sweep: payments admin' },
  'PUT /v1/payments/gate': { case: 'phase 09.1 sweep: payments admin' },
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
