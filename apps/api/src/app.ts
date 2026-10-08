import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { flushEventsAfterHandler } from '@rede-social/core/server/events/bus';
import { ApiError, errorEnvelope } from '@rede-social/core/server/http/api-error';
import { chatRoutes } from '@rede-social/module-chat/server';
import { communitiesRoutes } from '@rede-social/module-communities/server';
import { eventsRoutes } from '@rede-social/module-events/server';
import { feedRoutes } from '@rede-social/module-feed/server';
import { notificationsRoutes } from '@rede-social/module-notifications/server';
import { storeRoutes } from '@rede-social/module-store/server';
import { storiesRoutes } from '@rede-social/module-stories/server';
import { logger } from './http/logger';
import { requestIdMiddleware } from './http/request-id';
import { adminRoutes } from './routes/admin';
import { healthRoutes } from './routes/health';
import { hookRoutes } from './routes/hooks';
import { joinRoutes } from './routes/join';
import { meRoutes } from './routes/me';
import { mediaRoutes } from './routes/media';
import { membersRoutes } from './routes/members';
import { platformRoutes } from './routes/platform';
import { publicRoutes } from './routes/public';
import { muxWebhookRoutes } from './routes/webhooks/mux';

const app = new OpenAPIHono<AppEnv>();

app.use(requestIdMiddleware());
app.use(logger());
// Domain events emitted by a handler are delivered AFTER it returns, i.e. after its transaction
// committed — and dropped when the handler threw (`c.error`), since then nothing committed.
// Mounted here so every route group gets it without remembering to.
app.use(flushEventsAfterHandler);

/** Stable envelope every client switches on: `{ error: { code, message, details?, requestId } }`. */
app.onError((err, c) => {
  const requestId = c.get('requestId');
  const { body, status } = errorEnvelope(err, requestId);
  if (!(err instanceof ApiError) || status >= 500) {
    c.get('logger').error({ err, requestId, code: body.error.code }, 'unhandled');
  }
  return c.json(body, status);
});

app.doc('/v1/openapi.json', {
  openapi: '3.0.0',
  info: { title: 'Rede Social API', version: '1' },
});

// Keep the chained `.route()` style: `AppType` must carry every mounted route for `hc<AppType>()`.
// `/v1/public` is mounted BEFORE `/v1/me` and carries no auth middleware (D-20 public host lookup).
// `/v1/hooks` is called by GoTrue (server-to-server), carries no auth middleware and authenticates
// each call by its standard-webhooks signature (D-37, routes/hooks.ts).
// `/v1/platform` carries `requireSuperAdmin()` (applied inside the route group) and deliberately NOT
// `requireAuth`: a super_admin has no membership, so requireAuth would 403 NO_MEMBERSHIP first (ROLE-01).
const routes = app
  .route('/v1/health', healthRoutes)
  .route('/v1/public', publicRoutes)
  .route('/v1/hooks', hookRoutes)
  // `/v1/webhooks` is called by the video provider (server-to-server), carries no auth middleware
  // and authenticates each call by the provider's own HMAC signature over the RAW body (MEDIA-03,
  // R-03, routes/webhooks/mux.ts) — the same posture as `/v1/hooks`.
  .route('/v1/webhooks', muxWebhookRoutes)
  .route('/v1/me', meRoutes)
  // `/v1/join` is the IDENTITY lane (08.1, D-305): `requireIdentity` only (applied inside the group) —
  // a verified Bearer and the resolved host, never a membership and never a tenant-lane transaction,
  // because a session with no membership on the host joins through here. Its writes run in the admin
  // lane behind the explicit guards of `core/server/tenancy/join.ts`.
  .route('/v1/join', joinRoutes)
  // `/v1/media` is the tenant-lane media broker (03-01): it carries its own `requireAuth`, so
  // `ctx.tenantId` (the membership of record) is the ONLY source of a Storage key prefix.
  .route('/v1/media', mediaRoutes)
  // `/v1/members` is the tenant-lane member directory (03-03): it carries its own `requireAuth`, so
  // the community whose members are listed is always the membership of record, never a path or query
  // value, and the RLS select policy makes another community's rows invisible rather than refused.
  .route('/v1/members', membersRoutes)
  // `/v1/admin` is the tenant admin panel (Phase 8, D-338/D-339): tenant lane only — every sub-router
  // carries its own `requireAuth`, so `ctx.tenantId` is the only tenant a handler can act on — and
  // every route is guarded by a PERMISSION (`moderation.manage`, …), never a role. 08-01 mounts the
  // read-only moderation log; the log itself is written only inside each moderator action's own
  // transaction (`recordModerationAction`), never through a route.
  .route('/v1/admin', adminRoutes)
  .route('/v1/platform', platformRoutes)
  // The module carries its own `requireAuth` + `requireModule('feed')` chain plus a per-route
  // `requirePermission('feed.post.create')` on the write (packages/modules/feed/server/routes.ts),
  // so the mount cannot forget a guard and V1's posting rule is a tenant setting, not a route edit.
  .route('/v1/feed', feedRoutes)
  // Same shape, one phase later: the communities module carries its own
  // `requireAuth` + `requireModule('communities')` chain plus a per-route
  // `requirePermission('communities.community.manage')` on the write
  // (packages/modules/communities/server/routes.ts). Turning the module off 404s every route below
  // and removes the Comunidades tab from the bootstrap — no migration, no edit here (MOD-04, D-40).
  .route('/v1/communities', communitiesRoutes)
  // Same shape again (05-05): the stories module carries its own
  // `requireAuth` + `requireModule('stories')` chain plus per-route
  // `requirePermission('stories.story.publish')` / `…manage` on the writes
  // (packages/modules/stories/server/routes.ts). Turning the module off 404s every route below and
  // removes the order-5 home slot from the bootstrap, so `/inicio` closes up — no migration, no
  // edit here (MOD-04, UI-D-25). It declares NO nav entry: the publish door is the strip's own
  // circle (D-80), not a fourth tab.
  .route('/v1/stories', storiesRoutes)
  // Same shape once more (06-01): the events module carries its own
  // `requireAuth` + `requireModule('events')` chain plus a per-route
  // `requirePermission('events.event.manage')` on the write
  // (packages/modules/events/server/routes.ts). Turning the module off 404s every route below and
  // removes the Eventos tab from the bootstrap — no migration, no edit here (MOD-04, D-55).
  .route('/v1/events', eventsRoutes)
  // Same shape (07-01): the notifications module carries its own `requireAuth` +
  // `requireModule('notifications')` chain and no permission: every member reads and marks only
  // their OWN rows, which the owner-only policies enforce in the database. Turning the module off
  // 404s every route below and removes the bell slot from the bootstrap (D-40).
  .route('/v1/notifications', notificationsRoutes)
  // Same shape (07-08): the chat module carries its own `requireAuth` + `requireModule('chat')` chain
  // plus a per-route PERMISSION: `chat.support.contact` on the member's own thread, `chat.support` on
  // the staff reply (packages/modules/chat/server/routes.ts). Turning the module off 404s every route
  // below, removes the Suporte slot from the bootstrap and revokes `chat.support` (D-223).
  .route('/v1/chat', chatRoutes)
  // Same shape (08.2-01): the store module carries its own `requireAuth` + `requireModule('store')`
  // chain plus `requirePermission('store.product.manage')` on the product writes; buying takes none.
  // `store` is OFF by default (STORE-01), so every route below 404s until a tenant turns it on.
  .route('/v1/store', storeRoutes);

export type AppType = typeof routes;
export { app };
export default app;
