import { moduleLogger } from '@rede-social/core/server/logging';
import { defineModule } from '@rede-social/core/server/modules/manifest';
import { EVENT_PERMISSIONS } from './contracts/index';
import { eventsNotificationSources } from './server/notifications';
import { eventReminderJob } from './server/reminders';

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
 * **D-202 / UI-D-214: one home slot at order 7** (06-08), the Início "Próximo evento" card: after the
 * stories row (5) and before the feed (10), both re-checked against the current manifests. Its
 * renderer is `apps/web/lib/registry.tsx` `eventsHome` at index 0, so the kernel imports no module UI.
 *
 * `defaultRolePermissions`: only `admin_tenant` manages events and reads attendance (with the
 * check-in code, D-208); every role may answer and check in.
 */
export const eventsModule = defineModule({
  key: 'events',
  nav: { placement: 'tab', label: 'Eventos', icon: 'calendar-days', href: '/eventos', order: 40 },
  home: [{ order: 7 }],
  routes: () => import('./server/routes').then((m) => m.eventsRoutes),
  // 07-05 (EVENT-07, RESEARCH Pattern 8): the deferred per-event reminder job, armed inside the
  // module's own write transactions and checked again when it fires. No cron, no cross-tenant scan.
  jobs: [eventReminderJob],
  // 07-05 (D-226): new and reactivated events, and the reminders, through the kernel seam. No source
  // on `event.updated` or `event.cancelled` (D-201, D-214): edits and cancels are silent.
  notificationSources: eventsNotificationSources,
  events: [
    {
      event: 'event.published',
      handler: async (payload) => {
        // Shape only: the payload is ids and instants by contract (T-06-06), never a title or URL.
        log.info({ event: 'event.published', ...payload }, 'event published');
      },
    },
    {
      event: 'event.rsvp',
      handler: async (payload) => {
        // Shape only (06-03): ids, statuses and `startsAt`, which Phase 7's reminders schedule from.
        log.info({ event: 'event.rsvp', ...payload }, 'event rsvp');
      },
    },
    {
      event: 'event.updated',
      handler: async (payload) => {
        // Shape only (06-04): `timesChanged` is what Phase 7 re-arms its reminders on.
        log.info({ event: 'event.updated', ...payload }, 'event updated');
      },
    },
    {
      event: 'event.cancelled',
      handler: async (payload) => {
        // Shape only (06-04): one per active -> cancelled transition.
        log.info({ event: 'event.cancelled', ...payload }, 'event cancelled');
      },
    },
    {
      event: 'event.reactivated',
      handler: async (payload) => {
        // Shape only (06-04): one per cancelled -> active transition.
        log.info({ event: 'event.reactivated', ...payload }, 'event reactivated');
      },
    },
    {
      event: 'event.checked_in',
      handler: async (payload) => {
        // Shape only (06-05): once per member per event, on the FIRST check-in; never the code.
        log.info({ event: 'event.checked_in', ...payload }, 'event checked in');
      },
    },
    {
      event: 'event.reminder_due',
      handler: async (payload) => {
        // Shape only (07-05): ids, the window and one instant; never a title (T-07-31).
        log.info({ event: 'event.reminder_due', ...payload }, 'event reminder due');
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
