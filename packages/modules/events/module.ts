import { moduleLogger } from '@tria/core/server/logging';
import { defineModule } from '@tria/core/server/modules/manifest';
import { EVENT_PERMISSIONS } from './contracts/index';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-events');

/**
 * The manifest: everything the kernel needs to know about this module, as data (MOD-01).
 *
 * **D-55 / UI-D-215: Eventos is a TAB at order 40**, after Comunidades (20) and Reels (30), with
 * room left below it. `calendar-days` is already in `ICONS` (`packages/core/ui/nav.ts`) and the pt-BR
 * label comes from the catalog's `events.nav`, which wins over the fallback string below (PWA-03).
 * The tab is driven by the module FLAG, never by data (D-77): a tenant with no events still sees it
 * and lands on the empty state.
 *
 * No `home` key yet: the "Próximo evento" slot lands with its renderer in 06-08, because a slot
 * declared without a renderer would reach the bootstrap with nothing behind it.
 *
 * `defaultRolePermissions`: only `admin_tenant` manages events and reads attendance (with the
 * check-in code, D-208); every role may answer and check in.
 */
export const eventsModule = defineModule({
  key: 'events',
  nav: { placement: 'tab', label: 'Eventos', icon: 'calendar-days', href: '/eventos', order: 40 },
  routes: () => import('./server/routes').then((m) => m.eventsRoutes),
  events: [
    {
      event: 'event.published',
      handler: async (payload) => {
        // Shape only: the payload is ids and instants by contract (T-06-06), never a title or URL.
        log.info({ event: 'event.published', ...payload }, 'event published');
      },
    },
  ],
  defaultRolePermissions: {
    admin_tenant: [
      EVENT_PERMISSIONS.manage,
      EVENT_PERMISSIONS.attendanceRead,
      EVENT_PERMISSIONS.respond,
    ],
    support_tenant: [EVENT_PERMISSIONS.respond],
    member: [EVENT_PERMISSIONS.respond],
  },
});
