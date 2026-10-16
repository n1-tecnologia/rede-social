import type { Tx } from '@rede-social/core/db/tenant-tx';
import { enqueueInTx } from '@rede-social/core/server/jobs/boss';
import type { JobDefinition } from '@rede-social/core/server/modules/manifest';
import { COURSES_QUEUES, LIVE_JOIN_LEAD_MINUTES, type LiveReminderJob } from '../contracts/index';

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

/**
 * `courses.live_reminder`, registered in `coursesModule.jobs` so the queue exists for the opt-in's
 * `enqueueInTx` (pg-boss refuses an unknown queue). INTERIM (08.6-05 Task 1): the fire-time handler
 * lands in Task 3 of the same plan; until then the handler throws, so pg-boss retries and fails the
 * job instead of silently completing it.
 */
export const liveReminderJob: JobDefinition<LiveReminderJob> = {
  name: COURSES_QUEUES.liveReminder,
  handler: async () => {
    throw new Error('courses.live_reminder: the fire-time handler lands in 08.6-05 Task 3');
  },
};

/** The one row the fire-time check reads (formatted by Postgres). */
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

/** INERT STUB (08.6-05 Task 3 RED): replaced in the GREEN commit. */
export function liveReminderSkipReason(
  _row: LiveReminderRow | null,
  _payload: Pick<LiveReminderJob, 'startsAt'>,
  _nowMs: number,
  _coursesOn: boolean,
): LiveReminderSkipReason | null {
  return null;
}

/** INERT STUB (08.6-05 Task 3 RED): replaced in the GREEN commit. */
export async function runLiveReminder(
  _raw: unknown,
  _nowMs: number,
): Promise<'emitted' | 'skipped' | 'dropped'> {
  return 'dropped';
}
