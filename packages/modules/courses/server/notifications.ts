import type { Tx } from '@rede-social/core/db/tenant-tx';
import type {
  NotificationIntent,
  NotificationSource,
} from '@rede-social/core/server/notifications/source';
import { sql } from 'drizzle-orm';
import {
  COURSES_NOTIFICATION_KINDS,
  type CourseLiveCancelled,
  type CourseLiveReminderDue,
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
 * This plan ships the reminder; plans 06 and 07 add the course, lessons, live scheduled, live
 * cancelled and replay sources to this list.
 */

/** Microseconds, UTC: the module's own instant format. */
const ISO_MICROSECONDS = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/** A reminder push never lives past the start, and never below a minute. */
export const COURSES_REMINDER_TTL_MIN_SECONDS = 60;

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

  const recipients = await tx.execute<{ user_id: string }>(sql`
    select x.user_id::text as user_id
      from app.course_live_reminder_user_ids(${payload.liveId}::uuid, true) x`);
  const userIds = recipients.map((recipient) => recipient.user_id);
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

/**
 * `course.live_cancelled` → the cancel notice (08.6-06, D-447). INERT RED STUB (Task 1): answers no
 * intent until the GREEN commit re-reads the live and asks the recipients definer.
 */
async function resolveLiveCancelled(
  _tx: Tx,
  _payload: CourseLiveCancelled,
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
] as NotificationSource[];
