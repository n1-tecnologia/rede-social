import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import { emit, flush } from '@rede-social/core/server/events/bus';
import { enqueueInTx } from '@rede-social/core/server/jobs/boss';
import { moduleLogger } from '@rede-social/core/server/logging';
import type { JobDefinition } from '@rede-social/core/server/modules/manifest';
import { sql } from 'drizzle-orm';
import {
  EVENT_REMINDER_LATE_TOLERANCE_MINUTES,
  EVENT_REMINDER_OFFSET_MS,
  EVENT_REMINDER_WINDOWS,
  EVENTS_QUEUES,
  type EventReminderJob,
  type EventReminderWindow,
  type EventStatus,
  eventReminderPayloadSchema,
} from '../contracts/index';
import { eventsSystemCtx } from './system-context';

const log = moduleLogger('module-events');

/**
 * EVENT-07 (07-05, RESEARCH Pattern 8): durable reminders, armed where the truth about times,
 * cancels and RSVPs lives, and checked again when they fire.
 *
 * 1. **Arm in the producer's transaction.** `createEvent`, `updateEvent` (when an instant moved) and
 *    `setEventStatus` (cancelled -> active) call `armEventReminders(tx, …)` INSIDE their own
 *    `withTenantTx`. `enqueueInTx` writes the deferred `events.reminder` job through that
 *    transaction, so a rolled-back write arms nothing, and there is no cross-tenant scan anywhere.
 * 2. **Never late.** A window whose fire time is already past when the event is written is SKIPPED
 *    (an event created 30 minutes before it starts arms nothing; one created 2 hours before arms
 *    only the 1 h job).
 * 3. **Check at fire time.** The job acts only when the event still exists, is active, still starts
 *    at the payload's `startsAt`, has not started, and the worker is at most
 *    `EVENT_REMINDER_LATE_TOLERANCE_MINUTES` late. A moved start makes the old job a no-op (the move
 *    armed new ones), and a cancel needs no cleanup at all.
 * 4. **One seam.** A passing job emits `event.reminder_due` (ids and instants only) and FLUSHES before
 *    it returns, so the notification sink enqueues the fan-out; the source reads the `Vou` list at
 *    that moment. The per-recipient dedupe key `events.reminder_{window}:{eventId}` makes a retried
 *    or re-armed job insert nothing twice: at most one 24 h and one 1 h reminder per member, ever.
 *
 * Idempotency of the ARMING is the queue's `short` policy: the singleton key carries the start in
 * epoch seconds, so re-arming the same start while its job still waits is dropped, and a moved start
 * gets new keys.
 */

/** One window's arming decision, shared by the in-transaction arm and the backfill script. */
export interface ReminderArm {
  window: EventReminderWindow;
  fireAt: Date;
  singletonKey: string;
  payload: EventReminderJob;
}

/** `{eventId}:{window}:{startsAtEpochSeconds}`: a moved start is a new key, a re-arm the same one. */
export function reminderSingletonKey(
  eventId: string,
  window: EventReminderWindow,
  startsAtMs: number,
): string {
  return `${eventId}:${window}:${Math.floor(startsAtMs / 1000)}`;
}

/** `starts_at − 24 h` or `− 1 h`, in epoch milliseconds. */
export function reminderFireAtMs(startsAtMs: number, window: EventReminderWindow): number {
  return startsAtMs - EVENT_REMINDER_OFFSET_MS[window];
}

/**
 * The windows to arm for an event starting at `startsAt`, as seen at `nowMs`: every window whose fire
 * time is still in the future, in firing order. A past window is skipped, never sent late.
 */
export function planEventReminders(
  input: { tenantId: string; eventId: string; startsAt: string },
  nowMs: number,
): ReminderArm[] {
  const startsAtMs = Date.parse(input.startsAt);
  if (!Number.isFinite(startsAtMs)) return [];
  const arms: ReminderArm[] = [];
  for (const window of EVENT_REMINDER_WINDOWS) {
    const fireAtMs = reminderFireAtMs(startsAtMs, window);
    if (fireAtMs <= nowMs) continue;
    arms.push({
      window,
      fireAt: new Date(fireAtMs),
      singletonKey: reminderSingletonKey(input.eventId, window, startsAtMs),
      payload: {
        tenantId: input.tenantId,
        eventId: input.eventId,
        window,
        startsAt: input.startsAt,
      },
    });
  }
  return arms;
}

/**
 * Arms the event's reminders INSIDE the caller's transaction (see the file docblock). `startsAt` is
 * the row's STORED instant read back in that same transaction, in this module's microsecond ISO
 * format, so the fire-time comparison is exact. Returns the windows it enqueued.
 */
export async function armEventReminders(
  tx: Tx,
  input: { tenantId: string; eventId: string; startsAt: string },
  nowMs: number = Date.now(),
): Promise<EventReminderWindow[]> {
  const armed: EventReminderWindow[] = [];
  for (const arm of planEventReminders(input, nowMs)) {
    await enqueueInTx(tx, EVENTS_QUEUES.reminder, arm.payload, {
      startAfter: arm.fireAt,
      singletonKey: arm.singletonKey,
    });
    armed.push(arm.window);
  }
  return armed;
}

/** The one row the fire-time check reads (formatted by Postgres, the `ISO_MICROSECONDS` rule). */
export type ReminderEventRow = {
  status: EventStatus;
  deleted: boolean;
  starts_at: string;
  /** `starts_at = payload.startsAt::timestamptz`, compared by the database at full precision. */
  starts_match: boolean;
};

/** Why a reminder did not fire, as logged (shape only). */
export type ReminderSkipReason =
  | 'not_found'
  | 'deleted'
  | 'cancelled'
  | 'moved'
  | 'started'
  | 'late';

/**
 * The fire-time decision (must-haves truth 4), pure so its table is unit-tested without a database:
 * `null` means fire.
 */
export function reminderSkipReason(
  row: ReminderEventRow | null,
  payload: Pick<EventReminderJob, 'window' | 'startsAt'>,
  nowMs: number,
): ReminderSkipReason | null {
  if (!row) return 'not_found';
  if (row.deleted) return 'deleted';
  if (row.status !== 'active') return 'cancelled';
  if (!row.starts_match) return 'moved';
  const startsAtMs = Date.parse(row.starts_at);
  if (!(nowMs < startsAtMs)) return 'started';
  const fireAtMs = reminderFireAtMs(Date.parse(payload.startsAt), payload.window);
  if (nowMs > fireAtMs + EVENT_REMINDER_LATE_TOLERANCE_MINUTES * 60_000) return 'late';
  return null;
}

/**
 * The `events.reminder` handler body, with `now` injected (07-05 planning decision 3) so the
 * integration suite drives moved, late and cancelled cases without waiting.
 *
 * A malformed payload is DROPPED with a shape-only warning, never raised: pg-boss would retry a
 * raise forever against a shape that can never become valid. A read failure DOES raise, so pg-boss
 * retries the job; a retry stays idempotent through the fan-out's dedupe key.
 */
export async function runEventReminder(
  raw: unknown,
  nowMs: number,
): Promise<'emitted' | 'skipped' | 'dropped'> {
  const parsed = eventReminderPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn({ event: 'events.reminder.bad_payload' }, 'reminder payload rejected');
    return 'dropped';
  }
  const payload = parsed.data;

  const rows = await withTenantTx(eventsSystemCtx(payload.tenantId), (tx) =>
    tx.execute<ReminderEventRow>(sql`
      select status,
             deleted_at is not null as deleted,
             to_char(starts_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as starts_at,
             starts_at = ${payload.startsAt}::timestamptz as starts_match
        from events
       where tenant_id = ${payload.tenantId}::uuid
         and id = ${payload.eventId}::uuid
       limit 1`),
  );

  const reason = reminderSkipReason(rows[0] ?? null, payload, nowMs);
  const shape = {
    tenantId: payload.tenantId,
    eventId: payload.eventId,
    window: payload.window,
  };
  if (reason) {
    log.info({ event: 'events.reminder.skipped', ...shape, reason }, 'event reminder skipped');
    return 'skipped';
  }

  const ctx = eventsSystemCtx(payload.tenantId);
  emit(ctx, 'event.reminder_due', {
    tenantId: payload.tenantId,
    eventId: payload.eventId,
    window: payload.window,
    startsAt: payload.startsAt,
  });
  // BEFORE returning: the sink enqueues the fan-out now, while the job is still ours.
  await flush(ctx);
  log.info({ event: 'events.reminder.emitted', ...shape }, 'event reminder due');
  return 'emitted';
}

/** `events.reminder` (07-05), registered in `eventsModule.jobs`; the worker passes the real clock. */
export const eventReminderJob: JobDefinition<EventReminderJob> = {
  name: EVENTS_QUEUES.reminder,
  handler: (payload) => runEventReminder(payload, Date.now()).then(() => undefined),
};
