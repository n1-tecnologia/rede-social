import type { Tx } from '@rede-social/core/db/tenant-tx';
import type {
  NotificationIntent,
  NotificationRetraction,
  NotificationSource,
} from '@rede-social/core/server/notifications/source';
import { type SQL, sql } from 'drizzle-orm';
import {
  COURSES_NOTIFICATION_KINDS,
  type CourseLessonsAdded,
  type CourseLiveCancelled,
  type CourseLiveReminderDue,
  type CourseLiveScheduled,
  type CoursePublished,
  type CourseReplayAvailable,
} from '../contracts/index';
import { coursesPushCopy } from './notification-copy';

/**
 * The courses module's notification sources (08.6-05, D-448, D-451; RESEARCH Pattern 6): the
 * module DECLARES who is notified of its own events, reading its OWN tables plus the tenant's
 * timezone, and the notifications module never imports it (MOD-02). The app registry registers this
 * list on the kernel seam and subscribes the sink once per event name.
 *
 * `resolve` runs in the WORKER, inside the fan-out's tenant lane of the payload's tenant (the zero
 * user under the `support_tenant` claim; RLS scopes every read), and returns intents: data, never a
 * stored sentence. The payloads carry ids and instants only, so the TITLE is read here.
 *
 * **Recipients never come from a lane select of `course_live_reminders`** (R-Pitfall 2): that table
 * has own-row policies only, so the zero user would read nobody. They come from the tenant-pinned
 * definer `app.course_live_reminder_user_ids(live, check_access)`.
 *
 * 08.6-05 shipped the reminder; 08.6-06 adds the live cancelled, live scheduled and replay sources;
 * 08.6-07 adds the course-published and lessons-added sources and the unpublish retraction. **Every source first reads the tenant's `courses`
 * row in its own transaction** (08.6-06 planning decision 5) and answers nothing while it is off.
 */

/** Microseconds, UTC: the module's own instant format. */
const ISO_MICROSECONDS = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/** A reminder push never lives past the start, and never below a minute. */
export const COURSES_REMINDER_TTL_MIN_SECONDS = 60;

/** The lifecycle notices' push lifetime (08.6-06): a day, the events broadcasts' rule. */
export const COURSES_NOTICE_TTL_SECONDS = 86_400;

/**
 * Whether the tenant's `courses` row is on, read IN the fan-out transaction (08.6-06 planning
 * decision 5): no second connection, and never the flag cache inside a transaction (the
 * `feed/server/service.ts` one-connection rule). A missing row reads as off (COURSE-01), so every
 * source answers nothing for a tenant without the school.
 */
async function coursesOn(tx: Tx, tenantId: string): Promise<boolean> {
  const rows = await tx.execute<{ enabled: boolean }>(sql`
    select enabled
      from tenant_modules
     where tenant_id = ${tenantId}::uuid
       and module_key = 'courses'`);
  return rows[0]?.enabled === true;
}

/** The `user_id` column of a definer's answer, as text. */
async function usersOf(tx: Tx, query: SQL): Promise<string[]> {
  const rows = await tx.execute<{ user_id: string }>(query);
  return rows.map((row) => row.user_id);
}

type ReminderLiveRow = {
  id: string;
  title: string;
  cover_asset_id: string | null;
  starts_at: string;
  timezone: string;
  /** Whole seconds until `starts_at`, by the database clock (never negative). */
  seconds_left: number;
};

/**
 * A live reminder's device `tag` and Web Push `Topic`. The Topic header allows at most 32 characters
 * of the URL-safe base64 alphabet (RFC 8030 §5.4), which the live id without its hyphens is exactly;
 * the tag keeps a readable prefix. One pair per LIVE, with `renotify: true`, so a re-reminder for a
 * moved start replaces the earlier banner and still alerts.
 */
export function liveReminderTagAndTopic(liveId: string): { tag: string; topic: string } {
  const hex = liveId.replaceAll('-', '').toLowerCase();
  return { tag: `courses-live-reminder-${hex}`, topic: hex };
}

/**
 * `course.live_reminder_due` → one `courses.live_reminder` intent (D-445, D-446, D-451) to the users
 * of `app.course_live_reminder_user_ids(liveId, true)`, read NOW: only members who opted in and
 * still hold a live membership, minus everyone for whom `app.live_locked_ids_for(user)` holds the
 * live (a revoked buyer receives nothing, T-08.6-04). The live is re-checked (not cancelled, still
 * starting at `startsAt`) because the fan-out runs after the job's own check.
 *
 * Actor-less: the row renders the clock disc, with the live's cover as its preview when there is
 * one. The facts are an allow-list (EP-65: `liveId`, `previewAssetId`, `startsAt`, `title`; never a
 * lesson field and never the room link, T-08.6-23). The dedupe key carries the start in epoch
 * seconds (08.6-05 planning decision 3): a re-run inserts nothing, while a live moved after its
 * reminder fired may remind again for the new start. The push opens the live page.
 */
async function resolveLiveReminderDue(
  tx: Tx,
  payload: CourseLiveReminderDue,
): Promise<NotificationIntent[]> {
  if (!(await coursesOn(tx, payload.tenantId))) return [];
  const lives = await tx.execute<ReminderLiveRow>(sql`
    select v.id,
           v.title,
           v.cover_asset_id,
           to_char(v.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
           t.timezone,
           greatest(0, floor(extract(epoch from (v.starts_at - now()))))::int as seconds_left
      from course_lives v
      join tenants t on t.id = v.tenant_id
     where v.tenant_id = ${payload.tenantId}::uuid
       and v.id = ${payload.liveId}::uuid
       and v.cancelled_at is null
       and v.starts_at = ${payload.startsAt}::timestamptz`);
  const row = lives[0];
  if (!row) return [];

  const userIds = await usersOf(
    tx,
    sql`select x.user_id::text as user_id
          from app.course_live_reminder_user_ids(${payload.liveId}::uuid, true) x`,
  );
  if (userIds.length === 0) return [];

  const { tag, topic } = liveReminderTagAndTopic(row.id);
  const secondsLeft = Number.isFinite(row.seconds_left) ? Math.floor(row.seconds_left) : 0;
  const startsEpochSeconds = Math.floor(Date.parse(row.starts_at) / 1000);

  return [
    {
      kind: COURSES_NOTIFICATION_KINDS.liveReminder,
      audience: { type: 'users', userIds },
      excludeUserIds: [],
      dedupeKey: `${COURSES_NOTIFICATION_KINDS.liveReminder}:${row.id}:${startsEpochSeconds}`,
      subject: { type: 'live', id: row.id },
      object: null,
      actorUserId: null,
      facts: {
        liveId: row.id,
        title: row.title,
        startsAt: row.starts_at,
        previewAssetId: row.cover_asset_id,
      },
      channels: ['in_app', 'push'],
      push: {
        title: 'tenant',
        body: coursesPushCopy.liveReminder(row.title, row.starts_at, row.timezone),
        url: `/cursos/lives/${row.id}`,
        tag,
        topic,
        ttlSeconds: Math.max(COURSES_REMINDER_TTL_MIN_SECONDS, secondsLeft),
        urgency: 'high',
        renotify: true,
      },
    },
  ];
}

type CancelledLiveRow = {
  id: string;
  title: string;
  cover_asset_id: string | null;
  starts_at: string;
  timezone: string;
  /** Null when the live was reactivated since the cancel (08.6-06, D-452). */
  cancelled_at: string | null;
  /** `starts_at + duration_min <= cancelled_at`: the live had already ended when it was cancelled. */
  ended_before_cancel: boolean | null;
};

/**
 * A cancel notice's device `tag` and Web Push `Topic` (08.6-06, D-447): one pair per LIVE. The Topic
 * is the live's hex id, the reminder's own Topic, so a push service holding an undelivered reminder
 * for the live replaces it with the cancel (RFC 8030 §5.4); the tag keeps its own prefix.
 */
export function liveCancelledTagAndTopic(liveId: string): { tag: string; topic: string } {
  const hex = liveId.replaceAll('-', '').toLowerCase();
  return { tag: `courses-live-cancelled-${hex}`, topic: hex };
}

/**
 * `course.live_cancelled` → one `courses.live_cancelled` intent (08.6-06, D-447, D-451, COURSE-42)
 * to the users of `app.course_live_reminder_user_ids(liveId, false)`: the members who turned the
 * reminder on and still hold a live membership, WITHOUT an access check (08.6-06 planning decision
 * 4: they chose the live, and its title is already visible to them, D-431).
 *
 * The live is re-read NOW: a live reactivated before the worker ran (`cancelled_at` null again)
 * notifies nobody, and neither does a live whose planned end (`starts_at + duration_min`) was already
 * past when it was cancelled (R-A9: telling members a finished live is cancelled is noise).
 *
 * Actor-less (the clock disc, the cover as preview). The facts are the reminder's allow-list (never
 * a lesson field, a description or the room link). The dedupe key carries the stored cancel instant
 * in epoch seconds, so a retried job inserts nothing while a later cancel (after a reactivation) is a
 * new notice. The push opens the live page.
 */
async function resolveLiveCancelled(
  tx: Tx,
  payload: CourseLiveCancelled,
): Promise<NotificationIntent[]> {
  if (!(await coursesOn(tx, payload.tenantId))) return [];
  const lives = await tx.execute<CancelledLiveRow>(sql`
    select v.id,
           v.title,
           v.cover_asset_id,
           to_char(v.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
           t.timezone,
           to_char(v.cancelled_at at time zone 'utc', ${ISO_MICROSECONDS}) as cancelled_at,
           (v.starts_at + make_interval(mins => v.duration_min)) <= v.cancelled_at
             as ended_before_cancel
      from course_lives v
      join tenants t on t.id = v.tenant_id
     where v.tenant_id = ${payload.tenantId}::uuid
       and v.id = ${payload.liveId}::uuid`);
  const row = lives[0];
  if (!row || row.cancelled_at === null || row.ended_before_cancel !== false) return [];

  const userIds = await usersOf(
    tx,
    sql`select x.user_id::text as user_id
          from app.course_live_reminder_user_ids(${payload.liveId}::uuid, false) x`,
  );
  if (userIds.length === 0) return [];

  const { tag, topic } = liveCancelledTagAndTopic(row.id);
  const cancelledEpochSeconds = Math.floor(Date.parse(row.cancelled_at) / 1000);
  return [
    {
      kind: COURSES_NOTIFICATION_KINDS.liveCancelled,
      audience: { type: 'users', userIds },
      excludeUserIds: [payload.actorUserId],
      dedupeKey: `${COURSES_NOTIFICATION_KINDS.liveCancelled}:${row.id}:${cancelledEpochSeconds}`,
      subject: { type: 'live', id: row.id },
      object: null,
      actorUserId: null,
      facts: {
        liveId: row.id,
        title: row.title,
        startsAt: row.starts_at,
        previewAssetId: row.cover_asset_id,
      },
      channels: ['in_app', 'push'],
      push: {
        title: 'tenant',
        body: coursesPushCopy.liveCancelled(row.title, row.starts_at, row.timezone, Date.now()),
        url: `/cursos/lives/${row.id}`,
        tag,
        topic,
        ttlSeconds: COURSES_NOTICE_TTL_SECONDS,
        urgency: 'normal',
        renotify: false,
      },
    },
  ];
}

type NoticeLiveRow = {
  id: string;
  title: string;
  cover_asset_id: string | null;
  starts_at: string;
  timezone: string;
};

/** The broadcast tag and Topic of the new / reactivated live notice: one pair per KIND (D-236). */
export const COURSES_LIVE_SCHEDULED_TAG = 'courses-live-scheduled';
/** The broadcast tag and Topic of the replay notice: one pair per KIND (D-236). */
export const COURSES_REPLAY_TAG = 'courses-replay';

/**
 * `course.live_scheduled` → one `courses.live_scheduled` intent (08.6-06, D-448, D-449, D-452,
 * D-453, COURSE-46) to the users of `app.course_notice_user_ids()`: every live `member` and
 * `support_tenant` membership, WITH or WITHOUT access (D-449: a shop window; the titles of locked
 * lives are already visible, D-431), the actor excluded and named on the row (avatar).
 *
 * The live is re-read NOW: cancelled before the worker ran, or already started, it notifies nobody
 * (EP-60). The dedupe key is once per live for a creation; a reactivation carries the sink's
 * `sinkAt` (the events module's 07-01 planning decision 7), so each reactivation is its own notice
 * while a retried job for the SAME reactivation inserts nothing. The push reads "Nova live" or
 * "Live reativada" in the tenant clock and opens the live page. The facts are ids, the instant, the
 * title and `reactivated` only (D-451).
 */
async function resolveLiveScheduled(
  tx: Tx,
  payload: CourseLiveScheduled,
  sinkAt: string,
): Promise<NotificationIntent[]> {
  if (!(await coursesOn(tx, payload.tenantId))) return [];
  const lives = await tx.execute<NoticeLiveRow>(sql`
    select v.id,
           v.title,
           v.cover_asset_id,
           to_char(v.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
           t.timezone
      from course_lives v
      join tenants t on t.id = v.tenant_id
     where v.tenant_id = ${payload.tenantId}::uuid
       and v.id = ${payload.liveId}::uuid
       and v.cancelled_at is null
       and v.starts_at > now()`);
  const row = lives[0];
  if (!row) return [];

  const userIds = await usersOf(
    tx,
    sql`select x.user_id::text as user_id from app.course_notice_user_ids() x`,
  );
  if (userIds.length === 0) return [];

  const kind = COURSES_NOTIFICATION_KINDS.liveScheduled;
  const body = payload.reactivated
    ? coursesPushCopy.liveReactivated(row.title, row.starts_at, row.timezone, Date.now())
    : coursesPushCopy.liveScheduled(row.title, row.starts_at, row.timezone, Date.now());
  return [
    {
      kind,
      audience: { type: 'users', userIds },
      excludeUserIds: [payload.actorUserId],
      dedupeKey: payload.reactivated ? `${kind}:${row.id}:${sinkAt}` : `${kind}:${row.id}`,
      subject: { type: 'live', id: row.id },
      object: null,
      actorUserId: payload.actorUserId,
      facts: {
        liveId: row.id,
        title: row.title,
        startsAt: row.starts_at,
        previewAssetId: row.cover_asset_id,
        reactivated: payload.reactivated,
      },
      channels: ['in_app', 'push'],
      push: {
        title: 'tenant',
        body,
        url: `/cursos/lives/${row.id}`,
        tag: COURSES_LIVE_SCHEDULED_TAG,
        topic: COURSES_LIVE_SCHEDULED_TAG,
        ttlSeconds: COURSES_NOTICE_TTL_SECONDS,
        urgency: 'normal',
        renotify: false,
      },
    },
  ];
}

/**
 * `course.replay_available` → one `courses.replay_available` intent (08.6-06, D-448, D-433, D-449,
 * COURSE-47) to the users of `app.live_replay_audience_user_ids(liveId)`: only the live memberships
 * that open the live door or the course door (T-08.6-03; the sequence lock ignored, R-A7).
 *
 * The live is re-read NOW: it must not be cancelled and must still replay the payload's lesson (a
 * replay changed or cleared before the worker ran notifies nobody). Actor-less (the clock disc, the
 * cover as preview). **The notice names the LIVE, never the lesson**: the facts are exactly
 * `liveId`, `previewAssetId` and `title` (EP-62), and the lesson id appears only in the dedupe key
 * (`courses.replay_available:{liveId}:{lessonId}`, so the same replay set again inserts nothing).
 */
async function resolveReplayAvailable(
  tx: Tx,
  payload: CourseReplayAvailable,
): Promise<NotificationIntent[]> {
  if (!(await coursesOn(tx, payload.tenantId))) return [];
  const lives = await tx.execute<{ id: string; title: string; cover_asset_id: string | null }>(sql`
    select v.id, v.title, v.cover_asset_id
      from course_lives v
     where v.tenant_id = ${payload.tenantId}::uuid
       and v.id = ${payload.liveId}::uuid
       and v.cancelled_at is null
       and v.replay_lesson_id = ${payload.lessonId}::uuid`);
  const row = lives[0];
  if (!row) return [];

  const userIds = await usersOf(
    tx,
    sql`select x.user_id::text as user_id
          from app.live_replay_audience_user_ids(${payload.liveId}::uuid) x`,
  );
  if (userIds.length === 0) return [];

  const kind = COURSES_NOTIFICATION_KINDS.replayAvailable;
  return [
    {
      kind,
      audience: { type: 'users', userIds },
      excludeUserIds: [payload.actorUserId],
      dedupeKey: `${kind}:${row.id}:${payload.lessonId}`,
      subject: { type: 'live', id: row.id },
      object: null,
      actorUserId: null,
      facts: { liveId: row.id, title: row.title, previewAssetId: row.cover_asset_id },
      channels: ['in_app', 'push'],
      push: {
        title: 'tenant',
        body: coursesPushCopy.replayAvailable(row.title),
        url: `/cursos/lives/${row.id}`,
        tag: COURSES_REPLAY_TAG,
        topic: COURSES_REPLAY_TAG,
        ttlSeconds: COURSES_NOTICE_TTL_SECONDS,
        urgency: 'normal',
        renotify: false,
      },
    },
  ];
}

/** The broadcast tag and Topic of the new-course notice: one pair per KIND (D-236). */
export const COURSES_COURSE_PUBLISHED_TAG = 'courses-course-published';

/**
 * `course.published` → one `courses.course_published` intent (08.6-07, D-448, D-449, D-453,
 * COURSE-44) to the users of `app.course_notice_user_ids()`: every live `member` and
 * `support_tenant` membership, WITH or WITHOUT access (D-449: a shop window; the titles of locked
 * courses are already in the catalogue, D-421), the actor excluded and named on the row (avatar).
 *
 * The course is re-read NOW: unpublished or archived before the worker ran, it notifies nobody
 * (EP-55; the `course.unpublished` retraction then has nothing to mark). The write path emits only
 * when its guarded 24-hour stamp was written, and the dedupe key carries that stamp in epoch
 * seconds, so a retried job inserts nothing while a republish a day later is a new notice. The push
 * reads "Novo curso: {title}" and opens the course page. The facts are the course id, its title and
 * its cover as the preview: never a description, a lesson or a product (D-451, PR-2).
 *
 * The fan-out and the retraction are separate jobs. The feed locks its retractable targets `for
 * share` (07 review B-WR-01), but the zero-user `support_tenant` lane holds no update policy on
 * `courses`, so a row lock would hide the course from this read. The order instead comes from the
 * status re-read plus the serial fan-out queue (one consumer, `localConcurrency` 1): the
 * `course.unpublished` fan-out is enqueued after the publication's and runs after it.
 */
async function resolveCoursePublished(
  tx: Tx,
  payload: CoursePublished,
): Promise<NotificationIntent[]> {
  if (!(await coursesOn(tx, payload.tenantId))) return [];
  const courses = await tx.execute<{ id: string; title: string; cover_asset_id: string | null }>(
    sql`
    select c.id, c.title, c.cover_asset_id
      from courses c
     where c.tenant_id = ${payload.tenantId}::uuid
       and c.id = ${payload.courseId}::uuid
       and c.status = 'published'`,
  );
  const row = courses[0];
  if (!row) return [];

  const userIds = await usersOf(
    tx,
    sql`select x.user_id::text as user_id from app.course_notice_user_ids() x`,
  );
  if (userIds.length === 0) return [];

  const kind = COURSES_NOTIFICATION_KINDS.coursePublished;
  const notifiedEpochSeconds = Math.floor(Date.parse(payload.notifiedAt) / 1000);
  return [
    {
      kind,
      audience: { type: 'users', userIds },
      excludeUserIds: [payload.actorUserId],
      dedupeKey: `${kind}:${row.id}:${notifiedEpochSeconds}`,
      subject: { type: 'course', id: row.id },
      object: null,
      actorUserId: payload.actorUserId,
      facts: { courseId: row.id, title: row.title, previewAssetId: row.cover_asset_id },
      channels: ['in_app', 'push'],
      push: {
        title: 'tenant',
        body: coursesPushCopy.coursePublished(row.title),
        url: `/cursos/${row.id}`,
        tag: COURSES_COURSE_PUBLISHED_TAG,
        topic: COURSES_COURSE_PUBLISHED_TAG,
        ttlSeconds: COURSES_NOTICE_TTL_SECONDS,
        urgency: 'normal',
        renotify: false,
      },
    },
  ];
}

/** RED STUB (08.6-07 Task 3, TDD): the `course.lessons_added` source lands in the GREEN commit. */
async function resolveLessonsAdded(
  _tx: Tx,
  _payload: CourseLessonsAdded,
): Promise<NotificationIntent[]> {
  return [];
}

export const coursesNotificationSources = [
  {
    event: 'course.live_reminder_due',
    resolve: (tx, payload) => resolveLiveReminderDue(tx, payload),
  } satisfies NotificationSource<'course.live_reminder_due'>,
  {
    event: 'course.live_cancelled',
    resolve: (tx, payload) => resolveLiveCancelled(tx, payload),
  } satisfies NotificationSource<'course.live_cancelled'>,
  {
    event: 'course.live_scheduled',
    resolve: (tx, payload, meta) => resolveLiveScheduled(tx, payload, meta.sinkAt),
  } satisfies NotificationSource<'course.live_scheduled'>,
  {
    event: 'course.replay_available',
    resolve: (tx, payload) => resolveReplayAvailable(tx, payload),
  } satisfies NotificationSource<'course.replay_available'>,
  {
    event: 'course.published',
    resolve: (tx, payload) => resolveCoursePublished(tx, payload),
  } satisfies NotificationSource<'course.published'>,
  {
    event: 'course.lessons_added',
    resolve: (tx, payload) => resolveLessonsAdded(tx, payload),
  } satisfies NotificationSource<'course.lessons_added'>,
] as NotificationSource[];

/**
 * Retractions (08.6-07, D-454, COURSE-49; the feed's 07-04 keep-and-mark). Unpublishing or archiving
 * a course emits `course.unpublished`, and every notification whose SUBJECT is that course (the
 * `courses.course_published` and `courses.lessons_added` rows alike) loses its payload to
 * `{"removed": true}` (`app.notifications_retract`, in the payload's tenant only), so a withdrawn
 * course is never named in anyone's bell after the fact (D-449); the bell renders "Este conteúdo foi
 * removido.". Live notices use subject `live` and are untouched. The retraction runs even while the
 * tenant's `notifications` module is off (the sink still enqueues events with a retraction).
 */
export const coursesNotificationRetractions = [
  {
    event: 'course.unpublished',
    match: (payload) => ({ on: 'subject', type: 'course', id: payload.courseId }),
  } satisfies NotificationRetraction<'course.unpublished'>,
] as NotificationRetraction[];
