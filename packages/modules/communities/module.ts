import { moduleLogger } from '@tria/core/server/logging';
import { defineModule } from '@tria/core/server/modules/manifest';
import { COMMUNITY_PERMISSIONS } from './contracts/index';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-communities');

/**
 * The manifest: everything the kernel needs to know about this module, as data (MOD-01).
 *
 * `routes` is a lazy import so the manifest itself stays cheap to load. The mount in
 * `apps/api/src/app.ts` uses the eager export for the chained `AppType`; both point at the same
 * router.
 *
 * **D-40: this module SPENDS the navigation tab the feed deliberately left unspent.** The feed
 * contributes a home slot and declares no `nav` precisely so Phases 5 and 6 can each take one of the
 * remaining BottomNav/rail slots; `order: 20` puts Comunidades after the kernel's Início and before
 * Phase 6's Eventos. `icon: 'users'` is already resolved by `ICONS` in `packages/core/ui/nav.ts`, so
 * the tab needs no icon-map change, and the pt-BR label comes from the catalog's `communities.nav`
 * key, which wins over the fallback string below (PWA-03).
 *
 * **D-77: the tab is driven by the module FLAG, never by data.** A tenant with zero communities
 * still sees the tab and lands on the empty state — which for an admin is also the creation entry
 * point. Hiding a tab because a list is empty would make the product's own emptiness unreachable.
 *
 * No `home` key and no `jobs` key: this module contributes no `/inicio` widget and enqueues nothing.
 * Both are OMITTED rather than set to an empty array, so "declares none" and "declares an empty one"
 * stay two different statements in the manifest.
 */
export const communitiesModule = defineModule({
  key: 'communities',
  nav: { placement: 'tab', label: 'Comunidades', icon: 'users', href: '/comunidades', order: 20 },
  routes: () => import('./server/routes').then((m) => m.communitiesRoutes),
  events: [
    {
      event: 'community.created',
      handler: async (payload) => {
        // Shape only — a community name never reaches a log line (T-05-06).
        log.info({ event: 'community.created', ...payload }, 'community created');
      },
    },
    {
      event: 'community.updated',
      handler: async (payload) => {
        // Shape only — and there is deliberately no diff in the payload to spread here.
        log.info({ event: 'community.updated', ...payload }, 'community updated');
      },
    },
    {
      event: 'community.archived',
      handler: async (payload) => {
        // The TRANSITION into `archived`, announced once. A repeat archive emits nothing at all.
        log.info({ event: 'community.archived', ...payload }, 'community archived');
      },
    },
  ],
  defaultRolePermissions: {
    admin_tenant: [COMMUNITY_PERMISSIONS.manage],
  },
});
