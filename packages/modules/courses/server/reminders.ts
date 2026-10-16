import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import { emit, flush } from '@rede-social/core/server/events/bus';
import { enqueueInTx } from '@rede-social/core/server/jobs/boss';
import { moduleLogger } from '@rede-social/core/server/logging';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type { JobDefinition } from '@rede-social/core/server/modules/manifest';
import { sql } from 'drizzle-orm';
import {
  COURSES_QUEUES,
  LIVE_JOIN_LEAD_MINUTES,
  LIVE_REMINDER_LATE_TOLERANCE_MINUTES,
  type LiveReminderJob,
  liveReminderPayloadSchema,
} from '../contracts/index';
import { coursesSystemCtx } from './system-context';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-courses');

/**
 * The live reminder (08.6-05, D-444..D-447, COURSE-41), the events module's reminder pattern with
 * one window (RESEARCH Pattern 5):
 *
 * 1. **Arm in the writer's transaction.** The member's opt-in `PUT` inserts its own row and calls
 *    `armLiveReminder(tx, …)` INSIDE the same `withTenantTx`; `enqueueInTx` writes the deferred
 *    `courses.live_reminder` job through that transaction (switching to `api_user` for the pg-boss
 *    insert only), so a rolled-back opt-in arms nothing. Plan 06 arms the same way on a start change
 *    and a reactivation.
 * 2. **One job per live and start.** The singleton key is `{liveId}:{startsAtEpochSeconds}` and every
 *    queue runs the `short` policy, so 100 opt-ins for one live arm ONE waiting job, and a moved
 *    start gets a new key (the old job's stale check makes it a no-op).
 * 3. **Never late.** The job fires at `starts_at − LIVE_JOIN_LEAD_MINUTES` (the join window's
 *    opening, D-432); a fire instant that is already now or past arms nothing (a live five minutes
 *    away still accepts the opt-in, EP-39).
 * 4. **Check at fire time** (D-446, D-447). The job acts only when the live still exists, is not
 *    cancelled, still starts at the payload's `startsAt`, the school is on, the live has not started
 *    and the worker is at most `LIVE_REMINDER_LATE_TOLERANCE_MINUTES` late; a cancel or a move needs
 *    no cleanup. A passing job emits `course.live_reminder_due` (ids and one instant) and FLUSHES
 *    before it returns; the notification source then re-reads the live and asks
 *    `app.course_live_reminder_user_ids(live, true)`, which drops every member who lost access.
 */

/** `starts_at − 15 min`, in epoch milliseconds (D-445). */
export function liveReminderFireAtMs(startsAtMs: number): number {
  return startsAtMs - LIVE_JOIN_LEAD_MINUTES * 60_000;
}

/** `{liveId}:{floor(startsAtMs / 1000)}`: a moved start is a new key, a re-arm the same one. */
export function liveReminderSingletonKey(liveId: string, startsAtMs: number): string {
  return `${liveId}:${Math.floor(startsAtMs / 1000)}`;
}

/**
 * The arming decision for a live starting at `startsAtMs`, as seen at `nowMs`: the job's
 * `startAfter` when the fire instant is still in the future, otherwise `null` (EP-44: the fire
 * instant itself arms nothing).
 */
export function planLiveReminder(startsAtMs: number, nowMs: number): { startAfter: Date } | null {
  if (!Number.isFinite(startsAtMs)) return null;
  const fireAtMs = liveReminderFireAtMs(startsAtMs);
  if (fireAtMs <= nowMs) return null;
  return { startAfter: new Date(fireAtMs) };
}

/**
 * Arms the live's reminder INSIDE the caller's transaction (see the file docblock). `startsAt` is
 * the live's STORED instant read back in that same transaction, in this module's microsecond ISO
 * shape, so the fire-time comparison is exact (EP-48). Answers whether a job was enqueued (a
 * duplicate key is dropped by the queue, which still counts as armed).
 */
export async function armLiveReminder(
  tx: Tx,
  input: { tenantId: string; liveId: string; startsAt: string },
  nowMs: number = Date.now(),
): Promise<boolean> {
  const startsAtMs = Date.parse(input.startsAt);
  const plan = planLiveReminder(startsAtMs, nowMs);
  if (!plan) return false;
  const payload: LiveReminderJob = {
    tenantId: input.tenantId,
    liveId: input.liveId,
    startsAt: input.startsAt,
  };
  await enqueueInTx(tx, COURSES_QUEUES.liveReminder, payload, {
    startAfter: plan.startAfter,
    singletonKey: liveReminderSingletonKey(input.liveId, startsAtMs),
  });
  return true;
}

/** The one row the fire-time check reads (formatted by Postgres, the microsecond ISO rule). */
export type LiveReminderRow = {
  cancelled: boolean;
  starts_at: string;
  /** `starts_at = payload.startsAt::timestamptz`, compared by the database at full precision. */
  starts_match: boolean;
};

/** Why a live reminder did not fire, as logged (shape only). */
export type LiveReminderSkipReason =
  | 'not_found'
  | 'cancelled'
  | 'moved'
  | 'module_off'
  | 'started'
  | 'late';

/**
 * The fire-time decision, pure so its table is unit-tested without a database: `null` means fire.
 * The order is EP-47's — not_found, cancelled, moved, module_off, started, late — so a cancelled job
 * that is also late reports `cancelled`, and `started` (`now >= starts_at`) is checked BEFORE
 * `late` (`now > fireAt + 10 min`, inclusive edge), R-Pitfall 7.
 */
export function liveReminderSkipReason(
  row: LiveReminderRow | null,
  payload: Pick<LiveReminderJob, 'startsAt'>,
  nowMs: number,
  coursesOn: boolean,
): LiveReminderSkipReason | null {
  if (!row) return 'not_found';
  if (row.cancelled) return 'cancelled';
  if (!row.starts_match) return 'moved';
  if (!coursesOn) return 'module_off';
  if (!(nowMs < Date.parse(row.starts_at))) return 'started';
  const fireAtMs = liveReminderFireAtMs(Date.parse(payload.startsAt));
  if (nowMs > fireAtMs + LIVE_REMINDER_LATE_TOLERANCE_MINUTES * 60_000) return 'late';
  return null;
}

/**
 * The `courses.live_reminder` handler body, with `now` injected so the integration suite drives the
 * moved, late, started and cancelled cases without waiting.
 *
 * A malformed payload is DROPPED with a shape-only warning, never raised: pg-boss would retry a
 * raise forever against a shape that can never become valid. The school flag is read BEFORE the
 * transaction (the flag cache, `moduleFlags.isEnabled`), the live in `coursesSystemCtx(tenantId)`
 * (T-08.6-06: the payload's tenant is data; RLS and the explicit predicate pin the read). A read
 * failure DOES raise, so pg-boss retries; a retry stays idempotent through the fan-out's dedupe key.
 * Log lines carry ids and the reason only, never a title (T-08.6-23).
 */
export async function runLiveReminder(
  raw: unknown,
  nowMs: number,
): Promise<'emitted' | 'skipped' | 'dropped'> {
  const parsed = liveReminderPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn({ event: 'courses.live_reminder.bad_payload' }, 'live reminder payload rejected');
    return 'dropped';
  }
  const payload = parsed.data;

  const coursesOn = await moduleFlags.isEnabled(coursesSystemCtx(payload.tenantId), 'courses');
  const rows = await withTenantTx(coursesSystemCtx(payload.tenantId), (tx) =>
    tx.execute<LiveReminderRow>(sql`
      select cancelled_at is not null as cancelled,
             to_char(starts_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as starts_at,
             starts_at = ${payload.startsAt}::timestamptz as starts_match
        from course_lives
       where tenant_id = ${payload.tenantId}::uuid
         and id = ${payload.liveId}::uuid`),
  );

  const reason = liveReminderSkipReason(rows[0] ?? null, payload, nowMs, coursesOn);
  const shape = { tenantId: payload.tenantId, liveId: payload.liveId };
  if (reason) {
    log.info({ event: 'courses.live_reminder.skipped', ...shape, reason }, 'live reminder skipped');
    return 'skipped';
  }

  const ctx = coursesSystemCtx(payload.tenantId);
  emit(ctx, 'course.live_reminder_due', {
    tenantId: payload.tenantId,
    liveId: payload.liveId,
    startsAt: payload.startsAt,
  });
  // BEFORE returning: the sink enqueues the fan-out now, while the job is still ours.
  await flush(ctx);
  log.info({ event: 'courses.live_reminder.emitted', ...shape }, 'live reminder due');
  return 'emitted';
}

/** `courses.live_reminder` (08.6-05), registered in `coursesModule.jobs`; the worker passes the real clock. */
export const liveReminderJob: JobDefinition<LiveReminderJob> = {
  name: COURSES_QUEUES.liveReminder,
  handler: (payload) => runLiveReminder(payload, Date.now()).then(() => undefined),
};
