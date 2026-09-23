import { moduleLogger } from '@tria/core/server/logging';
import { defineModule } from '@tria/core/server/modules/manifest';
import { STORY_PERMISSIONS } from './contracts/index';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-stories');

/**
 * The manifest: everything the kernel needs to know about this module, as data (MOD-01).
 *
 * `routes` is a lazy import so the manifest itself stays cheap to load. The mount in
 * `apps/api/src/app.ts` uses the eager export for the chained `AppType`; both point at the same
 * router.
 *
 * **UI-D-25: this module contributes a HOME SLOT at order 5 and NO navigation tab.** The feed keeps
 * `order: 10`, so `/inicio` reads top to bottom as welcome block -> D-02 profile nudge -> stories
 * strip -> feed: a story is the most time-bounded thing on the screen (it is gone in 24 h), so it
 * sits above the durable feed. The `nav` key is ABSENT rather than set to `undefined` — D-40's tab
 * budget is spent by `communities` and by Phase 6's `events`, and the strip's own publish door is
 * the own-circle (D-80), not a fourth tab.
 *
 * With `stories` disabled for the tenant the slot is absent, `/inicio` closes up and every route
 * here 404s — no migration, no route edit, both directions asserted.
 *
 * No `jobs` key either: **expiry is a predicate, not a job** (STORY-03). There is nothing to
 * schedule, and an empty array here would suggest there might be one day.
 */
export const storiesModule = defineModule({
  key: 'stories',
  home: [{ order: 5 }],
  routes: () => import('./server/routes').then((m) => m.storiesRoutes),
  events: [
    {
      event: 'story.published',
      handler: async (payload) => {
        // Shape only — a story caption never reaches a log line (T-05-29).
        log.info({ event: 'story.published', ...payload }, 'story published');
      },
    },
    {
      event: 'story.deleted',
      handler: async (payload) => {
        log.info({ event: 'story.deleted', ...payload }, 'story soft-deleted');
      },
    },
  ],
  defaultRolePermissions: {
    admin_tenant: [STORY_PERMISSIONS.publish, STORY_PERMISSIONS.manage],
  },
});
