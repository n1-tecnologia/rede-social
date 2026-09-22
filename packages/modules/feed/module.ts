import { moduleLogger } from '@tria/core/server/logging';
import { defineModule } from '@tria/core/server/modules/manifest';
import { FEED_PERMISSIONS } from './contracts/index';

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
  jobs: [],
  events: [
    {
      event: 'post.published',
      handler: async (payload) => {
        // Shape only — a caption never reaches a log line (T-04-05).
        log.info({ event: 'post.published', ...payload }, 'post published');
      },
    },
  ],
  defaultRolePermissions: {
    admin_tenant: [FEED_PERMISSIONS.create, FEED_PERMISSIONS.manage],
  },
});
