import { defineModule } from '@rede-social/core/server/modules/manifest';
import { COURSE_PERMISSIONS } from './contracts/index';
import { coursesNotificationRetractions, coursesNotificationSources } from './server/notifications';
import { liveReminderJob } from './server/reminders';

/**
 * The manifest: everything the kernel needs to know about this module, as data (MOD-01).
 *
 * **The Cursos tab ships in 08.5 (D-419, D-401, UI-D-423).** 08.3 declared no `nav` (the school was
 * admin-only); now that members have `/cursos` (the catalogue, the course page, the player), the
 * manifest spends a BottomNav tab at `order: 30` with `icon: 'graduation-cap'`, labelled by the web
 * catalog's `courses.nav` "Cursos" (PWA-03). With the school on, rede-demo's bar reads Início ·
 * Comunidades · Cursos · Eventos · Perfil. Reels shares order 30 and yields its tab to this one
 * (`yieldsTabTo: ['courses']` in `reels/module.ts`): the kernel's `buildNav` moves it to the TopBar
 * as data, never by naming either module. With the school off nothing here reaches the bootstrap,
 * so the bar is exactly as before and Reels stays a tab. The admin still reaches the hub through
 * the same tab (`/cursos` splits by role) and the Cursos row in Configurações.
 *
 * **No `requires` (D-405).** A school without the store still teaches: every course is open, and
 * product links already stored stay dormant until the store is turned on. A `requires` list naming
 * the store would silently drop this module's permission whenever the store is off (the
 * composition enforces `requires`), turning every course into an unreachable row.
 *
 * `courses` is OFF by default for every tenant (COURSE-01): it is not in
 * `REAL_TENANT_DEFAULT_MODULES`, and no migration backfills a row for it.
 *
 * **`courses.manage` is admin-only BY CONSTRUCTION** (D-403, the store's WR-03 lesson). The routes
 * authorise by this permission, but the database authorises the school by the `admin_tenant` claim:
 * every write policy of the eleven course tables (`*_insert_admin`, `*_update_admin`,
 * `*_delete_admin`), the draft-visibility branch of `courses_select_published_or_admin` and the
 * admin branch of the restrictive lesson gate. The two agree only while the permission is composed
 * for `admin_tenant` and nobody else; granting it to another role (through settings or any other
 * composition) would make that role's writes fail under RLS and its reads silently miss drafts.
 * Widen the SQL in the same change, or do not compose it elsewhere:
 * `apps/api/tests/unit/registry.test.ts` (case '08.3 D-403') fails first.
 */
export const coursesModule = defineModule({
  key: 'courses',
  nav: {
    placement: 'tab',
    label: 'Cursos',
    icon: 'graduation-cap',
    href: '/cursos',
    order: 30,
  },
  routes: () => import('./server/routes').then((m) => m.coursesRoutes),
  // 08.6-05 (D-445..D-447, RESEARCH Pattern 5): the deferred live reminder, armed inside the
  // member's opt-in transaction (plan 06 also arms it on a start change and a reactivation) and
  // checked again when it fires: not cancelled, same start, school on, not started, at most 10
  // minutes late. No cron, no cross-tenant scan.
  jobs: [liveReminderJob],
  // 08.6-05 (D-451): the courses producers on the Phase 7 notification seam, the reminder first
  // (plans 06 and 07 add theirs to the same list). The registry subscribes the sink from this list
  // alone; no logging `events` subscriptions are declared (planning decision 4: the service and the
  // job log ids-only lines themselves).
  notificationSources: coursesNotificationSources,
  // 08.6-07 (D-454): unpublishing or archiving a course (`course.unpublished`) marks its course and
  // lessons notices removed (subject `course`); live notices are never touched.
  notificationRetractions: coursesNotificationRetractions,
  defaultRolePermissions: {
    admin_tenant: [COURSE_PERMISSIONS.manage],
  },
});
