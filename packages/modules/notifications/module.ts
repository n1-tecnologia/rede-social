import { defineModule } from '@rede-social/core/server/modules/manifest';
import { notificationsFanoutJob } from './server/fanout-job';
import { pushSendJob } from './server/push/send-job';
import { countUnseen } from './server/service';

/**
 * The manifest: everything the kernel needs to know about this module, as data (MOD-01).
 *
 * **D-40 / UI-D-268: the bell is a TOPBAR slot at order 10**, before the support chat (20), badged by
 * `bootstrap.counters.unreadNotifications`. `bell` is already in `ICONS` (`packages/core/ui/nav.ts`),
 * and the pt-BR label comes from the catalog's `notifications.nav`, which wins over the fallback
 * below (PWA-03). The slot is driven by the module FLAG: a tenant with notifications off gets no bell
 * and every `/v1/notifications` route answers 404 `MODULE_DISABLED`.
 *
 * `jobs`: the fan-out runs in the WORKER (`notifications.fanout`); the bus subscriber only enqueues.
 * `notifications.push-send` (07-06) delivers the Web Push the fan-out's push channel enqueued.
 * `counters`: this module's share of the bootstrap counters, computed inside the caller's tenant
 * lane; only an EFFECTIVE module contributes, so a disabled one reads zero.
 * `sweepFunctions`: the 90-day prune (D-231), run by the kernel's hourly sweeper for EVERY tenant,
 * enabled or not (a disabled tenant's old rows still expire).
 *
 * No `defaultRolePermissions`: every member reads and marks only their own rows, and the database's
 * owner-only policies are what enforce it.
 *
 * No producer is named here (MOD-02): producers declare `notificationSources` in THEIR manifests and
 * the app registry wires both halves through the kernel seam.
 */
export const notificationsModule = defineModule({
  key: 'notifications',
  nav: {
    placement: 'topbar',
    label: 'Notificações',
    icon: 'bell',
    badge: 'unreadNotifications',
    href: '/notificacoes',
    order: 10,
  },
  routes: () => import('./server/routes').then((m) => m.notificationsRoutes),
  jobs: [notificationsFanoutJob, pushSendJob],
  counters: async (tx, ctx) => ({ unreadNotifications: await countUnseen(tx, ctx) }),
  // D-231 (07-04): rows older than 90 days are deleted by the kernel's EXISTING hourly sweeper, which
  // runs `app.notifications_prune(batch)` through the admin lane. The kernel never names this table.
  sweepFunctions: ['notifications_prune'],
});
