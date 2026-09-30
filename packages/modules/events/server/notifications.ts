import type { Tx } from '@rede-social/core/db/tenant-tx';
import type {
  NotificationIntent,
  NotificationSource,
} from '@rede-social/core/server/notifications/source';
import { sql } from 'drizzle-orm';
import {
  EVENTS_NOTIFICATION_KINDS,
  type EventReminderWindow,
  type EventsNotificationKind,
} from '../contracts/index';
import { eventsPushCopy } from './notification-copy';

/**
 * The events module's notification sources (07-05, D-226, RESEARCH Pattern 1 and 8): the module
 * DECLARES who is notified of its own events, reading its OWN tables (`events`,
 * `event_attendances`) plus the tenant's timezone, and the notifications module never imports it
 * (MOD-02). The app registry registers this list on the kernel seam.
 *
 * `resolve` runs in the WORKER, inside the tenant lane of the payload's tenant (RLS scopes every
 * read), and returns intents: data, never a stored sentence. The payloads carry ids and instants
 * only, so the TITLE is read here (Phase 6 open question 2, closed: the producer reads its own
 * table; no payload gains a title).
 *
 * **Exactly three sources.** The edit and the cancel are SILENT (D-201, D-214): an edit only re-arms
 * reminders in the service's transaction, and a cancel makes the waiting reminder jobs no-ops at fire
 * time. The `Reativar` transition is the one exception to D-214 and notifies again.
 */

/** Microseconds, UTC: the list's own instant format. */
const ISO_MICROSECONDS = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/** The broadcast kinds' push TTL: one day, like the other broadcast kinds. */
export const EVENTS_BROADCAST_TTL_SECONDS = 86_400;

/** A reminder push never lives past the start, and never below a minute. */
export const EVENTS_REMINDER_TTL_MIN_SECONDS = 60;

type EventFactsRow = {
  id: string;
  title: string;
  created_by_user_id: string;
  cover_asset_id: string | null;
  starts_at: string;
  timezone: string;
};

/** The live, active event with the tenant's timezone, or nothing. */
async function readActiveEvent(
  tx: Tx,
  tenantId: string,
  eventId: string,
): Promise<EventFactsRow | null> {
  const rows = await tx.execute<EventFactsRow>(sql`
    select e.id,
           e.title,
           e.created_by_user_id,
           e.cover_asset_id,
           to_char(e.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
           t.timezone
      from events e
      join tenants t on t.id = e.tenant_id
     where e.tenant_id = ${tenantId}::uuid
       and e.id = ${eventId}::uuid
       and e.status = 'active'
       and e.deleted_at is null
     limit 1`);
  return rows[0] ?? null;
}

/**
 * The broadcast intent both `event.published` and `event.reactivated` produce: every live `member`
 * (D-229: staff never get a broadcast kind), the actor excluded, the creator's or reactivator's
 * avatar on the row, and the tenant-clock `{when}` in the banner.
 */
function broadcastIntent(
  row: EventFactsRow,
  opts: {
    kind: typeof EVENTS_NOTIFICATION_KINDS.event | typeof EVENTS_NOTIFICATION_KINDS.reactivated;
    actorUserId: string;
    dedupeKey: string;
    tag: string;
  },
): NotificationIntent {
  return {
    kind: opts.kind,
    audience: { type: 'members' },
    excludeUserIds: [opts.actorUserId],
    dedupeKey: opts.dedupeKey,
    subject: { type: 'event', id: row.id },
    object: null,
    actorUserId: opts.actorUserId,
    facts: {
      eventId: row.id,
      title: row.title,
      startsAt: row.starts_at,
      previewAssetId: row.cover_asset_id,
    },
    channels: ['in_app', 'push'],
    push: {
      title: 'tenant',
      body: eventsPushCopy({
        kind: opts.kind,
        title: row.title,
        startsAt: row.starts_at,
        timeZone: row.timezone,
        nowMs: Date.now(),
      }),
      url: `/eventos/${row.id}`,
      tag: opts.tag,
      topic: opts.tag,
      ttlSeconds: EVENTS_BROADCAST_TTL_SECONDS,
      urgency: 'normal',
      renotify: false,
    },
  };
}

/**
 * `event.published` → one `events.event` intent to every live member, the creator excluded. An event
 * cancelled or removed before the worker runs yields `[]`. The creator read from the ROW is the
 * authority in this lane (it equals the payload's actor by construction).
 */
async function resolveEventPublished(
  tx: Tx,
  payload: { tenantId: string; eventId: string },
): Promise<NotificationIntent[]> {
  const row = await readActiveEvent(tx, payload.tenantId, payload.eventId);
  if (!row) return [];
  return [
    broadcastIntent(row, {
      kind: EVENTS_NOTIFICATION_KINDS.event,
      actorUserId: row.created_by_user_id,
      dedupeKey: `events.event:${row.id}`,
      tag: 'events-event',
    }),
  ];
}

/**
 * `event.reactivated` → one `events.event_reactivated` intent to every live member, the reactivating
 * admin excluded and named on the row. The dedupe key carries the sink's `sinkAt` (07-01 planning
 * decision 7): two reactivations of one event are two notifications, while a retried job for the
 * SAME reactivation reuses its `sinkAt` and inserts nothing. Re-cancelled before the worker ran →
 * `[]`.
 */
async function resolveEventReactivated(
  tx: Tx,
  payload: { tenantId: string; eventId: string; actorUserId: string },
  sinkAt: string,
): Promise<NotificationIntent[]> {
  const row = await readActiveEvent(tx, payload.tenantId, payload.eventId);
  if (!row) return [];
  return [
    broadcastIntent(row, {
      kind: EVENTS_NOTIFICATION_KINDS.reactivated,
      actorUserId: payload.actorUserId,
      dedupeKey: `events.event_reactivated:${row.id}:${sinkAt}`,
      tag: 'events-reactivated',
    }),
  ];
}

type ReminderEventRow = {
  id: string;
  title: string;
  cover_asset_id: string | null;
  starts_at: string;
  timezone: string;
  /** Whole seconds until `starts_at`, by the database clock (never negative). */
  seconds_left: number;
};

/** The reminder kind of a window. */
export function reminderKind(window: EventReminderWindow): EventsNotificationKind {
  return window === '24h'
    ? EVENTS_NOTIFICATION_KINDS.reminder24h
    : EVENTS_NOTIFICATION_KINDS.reminder1h;
}

/**
 * A reminder's device `tag` and Web Push `Topic`. The Topic header allows at most 32 characters of
 * the URL-safe base64 alphabet (RFC 8030 §5.4), which the event id without its hyphens is exactly;
 * the tag keeps a readable prefix. One pair per EVENT, with `renotify: true`, so the 1 h reminder
 * replaces the 24 h banner and still alerts (D-236).
 */
export function reminderTagAndTopic(eventId: string): { tag: string; topic: string } {
  const hex = eventId.replaceAll('-', '').toLowerCase();
  return { tag: `events-reminder-${hex}`, topic: hex };
}

/**
 * `event.reminder_due` → one `events.reminder_24h` / `_1h` intent to the members whose answer is
 * `Vou`, read NOW (EVENT-07): an answer changed after the 24 h job fired shows up in the 1 h one, and
 * `Não vou`, no answer, `checked_in` and `walk_in` get nothing. The event is re-checked (active, not
 * removed, still starting at `startsAt`) because the fan-out runs after the job's own check.
 *
 * Actor-less (UI-D-251): the row renders the clock disc, with the event's cover as its preview when
 * there is one (sketch 007 surface 7). The dedupe key is per window and event, so
 * at most one 24 h and one 1 h reminder per member per event, ever: a re-run inserts nothing, and a
 * later start move does not re-remind a member already reminded for that window (V2-EVENT-02).
 */
async function resolveReminderDue(
  tx: Tx,
  payload: { tenantId: string; eventId: string; window: EventReminderWindow; startsAt: string },
): Promise<NotificationIntent[]> {
  const events = await tx.execute<ReminderEventRow>(sql`
    select e.id,
           e.title,
           e.cover_asset_id,
           to_char(e.starts_at at time zone 'utc', ${ISO_MICROSECONDS}) as starts_at,
           t.timezone,
           greatest(0, floor(extract(epoch from (e.starts_at - now()))))::int as seconds_left
      from events e
      join tenants t on t.id = e.tenant_id
     where e.tenant_id = ${payload.tenantId}::uuid
       and e.id = ${payload.eventId}::uuid
       and e.status = 'active'
       and e.deleted_at is null
       and e.starts_at = ${payload.startsAt}::timestamptz
     limit 1`);
  const row = events[0];
  if (!row) return [];

  const going = await tx.execute<{ user_id: string }>(sql`
    select a.user_id::text as user_id
      from event_attendances a
     where a.tenant_id = ${payload.tenantId}::uuid
       and a.event_id = ${payload.eventId}::uuid
       and a.status = 'going'
     order by a.user_id`);
  const userIds = going.map((attendee) => attendee.user_id);
  if (userIds.length === 0) return [];

  const kind = reminderKind(payload.window);
  const { tag, topic } = reminderTagAndTopic(row.id);
  const secondsLeft = Number.isFinite(row.seconds_left) ? Math.floor(row.seconds_left) : 0;

  return [
    {
      kind,
      audience: { type: 'users', userIds },
      excludeUserIds: [],
      dedupeKey: `events.reminder_${payload.window}:${row.id}`,
      subject: { type: 'event', id: row.id },
      object: null,
      actorUserId: null,
      facts: {
        eventId: row.id,
        title: row.title,
        startsAt: row.starts_at,
        previewAssetId: row.cover_asset_id,
      },
      channels: ['in_app', 'push'],
      push: {
        title: 'tenant',
        body: eventsPushCopy({
          kind,
          title: row.title,
          startsAt: row.starts_at,
          timeZone: row.timezone,
          nowMs: Date.now(),
        }),
        url: `/eventos/${row.id}`,
        tag,
        topic,
        ttlSeconds: Math.max(EVENTS_REMINDER_TTL_MIN_SECONDS, secondsLeft),
        urgency: 'high',
        renotify: true,
      },
    },
  ];
}

export const eventsNotificationSources = [
  {
    event: 'event.published',
    resolve: (tx, payload) => resolveEventPublished(tx, payload),
  } satisfies NotificationSource<'event.published'>,
  {
    event: 'event.reactivated',
    resolve: (tx, payload, meta) => resolveEventReactivated(tx, payload, meta.sinkAt),
  } satisfies NotificationSource<'event.reactivated'>,
  {
    event: 'event.reminder_due',
    resolve: (tx, payload) => resolveReminderDue(tx, payload),
  } satisfies NotificationSource<'event.reminder_due'>,
] as NotificationSource[];
