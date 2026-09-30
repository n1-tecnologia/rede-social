import { moduleLogger } from '@rede-social/core/server/logging';
import { defineModule } from '@rede-social/core/server/modules/manifest';
import { STORY_PERMISSIONS } from './contracts/index';
import { storiesNotificationRetractions, storiesNotificationSources } from './server/notifications';

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
/**
 * One ids-only log handler (05.2's highlight events). The payloads are IDS ONLY — never a highlight
 * title or a story caption (T-05.2-17) — and this handler logging them verbatim is exactly why their
 * key sets are asserted in `story-highlights.test.ts` rather than trusted.
 */
function logIds(event: string, message: string) {
  return async (payload: object) => {
    log.info({ event, ...payload }, message);
  };
}

export const storiesModule = defineModule({
  key: 'stories',
  home: [{ order: 5 }],
  routes: () => import('./server/routes').then((m) => m.storiesRoutes),
  // 07-04 (RESEARCH Pattern 1): the module DECLARES who is notified of its own events, reading its
  // own tables in the worker; the notifications module never imports it (MOD-02). No source on the
  // highlight event (Pitfall 11): `story.published` alone announces a story.
  notificationSources: storiesNotificationSources,
  notificationRetractions: storiesNotificationRetractions,
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
    {
      // STORY-05. Both payloads are ids only, so Phase 7's notification consumer can be written
      // against them without ever re-reading the story — and without a caption reaching a log line.
      event: 'story.liked',
      handler: async (payload) => {
        log.info({ event: 'story.liked', ...payload }, 'story liked');
      },
    },
    {
      event: 'story.unliked',
      handler: async (payload) => {
        log.info({ event: 'story.unliked', ...payload }, 'story unliked');
      },
    },
    {
      // STORY-05's other half. The payload is ids only — a comment BODY must never reach a log
      // line (T-05-43), and this handler logging the payload verbatim is exactly why the shape is
      // asserted in `story-comments-contract.test.ts` rather than trusted.
      event: 'story.commented',
      handler: async (payload) => {
        log.info({ event: 'story.commented', ...payload }, 'story commented');
      },
    },
    {
      event: 'story.comment_deleted',
      handler: async (payload) => {
        log.info({ event: 'story.comment_deleted', ...payload }, 'story comment soft-deleted');
      },
    },
    // 05.2 highlights (R-D-L). They count TRANSITIONS, not requests: a repeat add, a PATCH identical
    // to the stored row, a reorder equal to the current order and a removal of a pair that is not
    // there all answer 200 and announce nothing.
    { event: 'highlight.created', handler: logIds('highlight.created', 'story highlight created') },
    { event: 'highlight.updated', handler: logIds('highlight.updated', 'story highlight updated') },
    {
      event: 'highlight.reordered',
      handler: logIds('highlight.reordered', 'story highlights reordered'),
    },
    { event: 'highlight.deleted', handler: logIds('highlight.deleted', 'story highlight deleted') },
    {
      event: 'story.highlighted',
      handler: logIds('story.highlighted', 'story added to a highlight'),
    },
    {
      event: 'story.unhighlighted',
      handler: logIds('story.unhighlighted', 'story removed from a highlight'),
    },
  ],
  defaultRolePermissions: {
    admin_tenant: [STORY_PERMISSIONS.publish, STORY_PERMISSIONS.manage],
  },
});
