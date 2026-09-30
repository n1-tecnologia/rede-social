import { moduleLogger } from '@rede-social/core/server/logging';
import { defineModule } from '@rede-social/core/server/modules/manifest';
import { FEED_PERMISSIONS } from './contracts/index';
import { feedUnfurlJob } from './server/jobs';
import { feedNotificationSources } from './server/notifications';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-feed');

/**
 * The manifest: everything the kernel needs to know about this module, as data (MOD-01).
 *
 * `routes` is a lazy import so the manifest itself stays cheap to load (the worker reads `jobs`
 * without ever building the HTTP router). The mount in `apps/api/src/app.ts` uses the eager export
 * for the chained `AppType`; both point at the same router.
 *
 * **D-55 (amends D-40): the feed contributes a HOME SLOT and no navigation tab.** The `home` array
 * below is the whole placement story — `apps/web/lib/registry.tsx` maps `feed` → `home[0]` to the
 * `FeedList` widget, which renders on `/inicio` below the welcome block and the D-02 nudge. A
 * navigation entry here would silently spend the BottomNav/rail tab budget Phases 5 (Comunidades)
 * and 6 (Eventos) are planning against, which is why the key is absent rather than set to `undefined`.
 *
 * `defaultRolePermissions` grants the admin both feed permissions; a MEMBER gets
 * `feed.post.create` only when the tenant's `settings.postingPolicy` is `'members'`, which is
 * composed in `apps/api/src/modules/registry.ts` (FEED-08). A disabled module contributes nothing,
 * so turning `feed` off also revokes what it granted.
 */
export const feedModule = defineModule({
  key: 'feed',
  home: [{ order: 10 }],
  routes: () => import('./server/routes').then((m) => m.feedRoutes),
  // MEDIA-04: the link unfurl runs in the WORKER, never in a request. The kernel creates the queue
  // from this array and the worker binds the handler through MODULE_REGISTRY.
  jobs: [feedUnfurlJob],
  // 07-01 (RESEARCH Pattern 1): the feed DECLARES who is notified of its own events, reading its own
  // tables in the worker. The app registry registers these on the kernel seam; the notifications
  // module never imports the feed (MOD-02).
  notificationSources: feedNotificationSources,
  events: [
    {
      event: 'post.published',
      handler: async (payload) => {
        // Shape only — a caption never reaches a log line (T-04-05).
        log.info({ event: 'post.published', ...payload }, 'post published');
      },
    },
    // 04-09's two FEED-03 write events. Ids and flags only, exactly like every payload above.
    {
      event: 'post.edited',
      handler: async (payload) => {
        log.info({ event: 'post.edited', ...payload }, 'post edited');
      },
    },
    {
      event: 'post.deleted',
      handler: async (payload) => {
        log.info({ event: 'post.deleted', ...payload }, 'post soft-deleted');
      },
    },
    // 04-03's five interaction events. Every payload is ids and flags only: a comment BODY never
    // reaches a log line either (T-04-19), which is why the payloads carry none.
    {
      event: 'post.liked',
      handler: async (payload) => {
        log.info({ event: 'post.liked', ...payload }, 'post liked');
      },
    },
    {
      event: 'post.unliked',
      handler: async (payload) => {
        log.info({ event: 'post.unliked', ...payload }, 'post unliked');
      },
    },
    {
      event: 'comment.created',
      handler: async (payload) => {
        log.info({ event: 'comment.created', ...payload }, 'comment created');
      },
    },
    {
      event: 'comment.deleted',
      handler: async (payload) => {
        log.info({ event: 'comment.deleted', ...payload }, 'comment deleted');
      },
    },
    {
      event: 'comment.liked',
      handler: async (payload) => {
        log.info({ event: 'comment.liked', ...payload }, 'comment liked');
      },
    },
    {
      event: 'comment.unliked',
      handler: async (payload) => {
        log.info({ event: 'comment.unliked', ...payload }, 'comment unliked');
      },
    },
  ],
  defaultRolePermissions: {
    admin_tenant: [FEED_PERMISSIONS.create, FEED_PERMISSIONS.manage],
  },
});
