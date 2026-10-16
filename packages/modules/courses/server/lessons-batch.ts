import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import { emit, flush } from '@rede-social/core/server/events/bus';
import { enqueueInTx } from '@rede-social/core/server/jobs/boss';
import { moduleLogger } from '@rede-social/core/server/logging';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import type { JobDefinition } from '@rede-social/core/server/modules/manifest';
import { sql } from 'drizzle-orm';
import {
  COURSES_QUEUES,
  LESSONS_BATCH_MAX_AGE_HOURS,
  LESSONS_BATCH_WINDOW_MINUTES,
  type LessonsBatchJob,
  lessonsBatchPayloadSchema,
} from '../contracts/index';
import { coursesSystemCtx } from './system-context';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-courses');

/**
 * The lessons batch (08.6-07, D-450, COURSE-45; RESEARCH Pattern 7, Assumption A5, Pitfall 6): new
 * lessons in a published course reach members as ONE grouped notice per course and window, never one
 * per lesson.
 *
 * 1. **Arm in the writer's transaction.** `createLesson` on a published course calls
 *    `armLessonsBatch(tx, …)` INSIDE its `withTenantTx`; `enqueueInTx` writes a deferred
 *    `courses.lessons_batch` job 30 minutes ahead with the COURSE id as the singleton key. Every
 *    queue runs the `short` policy, so while that job waits (`created`) every later lesson's enqueue
 *    is dropped: the waiting job absorbs them (EP-56). A rolled-back lesson arms nothing.
 * 2. **A watermark, not a time window** (R-Pitfall 6). The job does not read "lessons created in the
 *    last 30 minutes"; it runs `app.course_lessons_claim_batch(course)`, which flips `announced_at`
 *    on every unannounced live lesson of the published course whose video is absent or `ready`, and
 *    answers how many it flipped. The notice's count is exactly that number (EP-57), and a lesson is
 *    announced at most once. The residual: a lesson whose transaction straddles the claim (enqueued
 *    while the job was still `created`, committed after the claim read) is not lost, it waits for
 *    the next lesson's batch.
 * 3. **Ready videos only, re-armed for 24 hours** (R-A5). Lessons whose video is still processing
 *    stay unannounced; while the oldest of them is younger than `LESSONS_BATCH_MAX_AGE_HOURS` the job
 *    re-arms itself one window later in the same transaction (the running job is `active`, so its
 *    own key is free again). After that the lesson is left unannounced; its course page lists it.
 * 4. **Check at run time.** The school flag is read first: with `courses` off the job ends without
 *    claiming (the lessons stay unannounced for a later batch). A draft or archived course claims 0.
 *    When the claim flipped at least one lesson the job emits `course.lessons_added` (ids, the count
 *    and the claim instant) and FLUSHES before it returns; the source re-reads the course and asks
 *    `app.course_audience_user_ids(course)`, so only members with access hear of it (D-449).
 */

export type LessonsBatchClaim = {
  claimed: number;
  pending: number;
  oldestPendingAt: string | null;
};

/**
 * The decision from one claim, pure so its table is unit-tested without a database: emit when the
 * claim flipped at least one lesson; re-arm while lessons whose video is not ready remain and the
 * oldest of them is younger than `LESSONS_BATCH_MAX_AGE_HOURS` at `nowMs`.
 */
export function lessonsBatchPlan(
  claim: LessonsBatchClaim,
  nowMs: number,
): { emit: boolean; rearm: boolean } {
  const oldestMs = claim.oldestPendingAt === null ? Number.NaN : Date.parse(claim.oldestPendingAt);
  const young =
    Number.isFinite(oldestMs) && nowMs - oldestMs < LESSONS_BATCH_MAX_AGE_HOURS * 3_600_000;
  return { emit: claim.claimed > 0, rearm: claim.pending > 0 && young };
}

/**
 * Arms the course's batch INSIDE the caller's transaction (see the file docblock): one deferred job
 * `LESSONS_BATCH_WINDOW_MINUTES` after `nowMs`, keyed by the course, so a job already waiting for
 * the course absorbs this call (the queue drops the duplicate).
 */
export async function armLessonsBatch(
  tx: Tx,
  input: LessonsBatchJob,
  nowMs: number = Date.now(),
): Promise<void> {
  const payload: LessonsBatchJob = { tenantId: input.tenantId, courseId: input.courseId };
  await enqueueInTx(tx, COURSES_QUEUES.lessonsBatch, payload, {
    startAfter: new Date(nowMs + LESSONS_BATCH_WINDOW_MINUTES * 60_000),
    singletonKey: input.courseId,
  });
}

type ClaimRow = {
  claimed: number;
  pending: number;
  oldest_pending_at: string | null;
  /** The claim's instant (the transaction's `now()`), the event's `batchAt`. */
  batch_at: string;
};

/**
 * The `courses.lessons_batch` handler body, with `now` injected so the integration suite drives the
 * re-arm and the 24-hour limit without waiting.
 *
 * A malformed payload is DROPPED with a shape-only warning, never raised (pg-boss would retry it
 * forever). The school flag is read BEFORE the transaction (the flag cache); the claim runs in
 * `coursesSystemCtx(tenantId)` (T-08.6-06: the payload's tenant is data; the definer pins
 * `app.tenant_id()`), and a planned re-arm is written in that same transaction. A failure raises, so
 * pg-boss retries; a retry after a committed claim claims 0, and the fan-out's dedupe key (the claim
 * instant) keeps an emitted notice single. Log lines carry ids and counts only, never a title.
 */
export async function runLessonsBatch(
  raw: unknown,
  nowMs: number,
): Promise<'emitted' | 'skipped' | 'dropped'> {
  const parsed = lessonsBatchPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    log.warn({ event: 'courses.lessons_batch.bad_payload' }, 'lessons batch payload rejected');
    return 'dropped';
  }
  const payload = parsed.data;
  const shape = { tenantId: payload.tenantId, courseId: payload.courseId };

  if (!(await moduleFlags.isEnabled(coursesSystemCtx(payload.tenantId), 'courses'))) {
    log.info(
      { event: 'courses.lessons_batch.skipped', ...shape, reason: 'module_off' },
      'lessons batch skipped',
    );
    return 'skipped';
  }

  const outcome = await withTenantTx(coursesSystemCtx(payload.tenantId), async (tx) => {
    const rows = await tx.execute<ClaimRow>(sql`
      select b.claimed,
             b.pending,
             to_char(b.oldest_pending_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               as oldest_pending_at,
             to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as batch_at
        from app.course_lessons_claim_batch(${payload.courseId}::uuid) b`);
    const row = rows[0];
    const claim: LessonsBatchClaim = {
      claimed: Number(row?.claimed ?? 0),
      pending: Number(row?.pending ?? 0),
      oldestPendingAt: row?.oldest_pending_at ?? null,
    };
    const plan = lessonsBatchPlan(claim, nowMs);
    if (plan.rearm) await armLessonsBatch(tx, payload, nowMs);
    return { claim, plan, batchAt: row?.batch_at ?? new Date(nowMs).toISOString() };
  });

  const counts = {
    claimed: outcome.claim.claimed,
    pending: outcome.claim.pending,
    rearmed: outcome.plan.rearm,
  };
  if (!outcome.plan.emit) {
    log.info({ event: 'courses.lessons_batch.idle', ...shape, ...counts }, 'lessons batch idle');
    return 'skipped';
  }

  const ctx = coursesSystemCtx(payload.tenantId);
  emit(ctx, 'course.lessons_added', {
    tenantId: payload.tenantId,
    courseId: payload.courseId,
    count: outcome.claim.claimed,
    batchAt: outcome.batchAt,
  });
  // BEFORE returning: the sink enqueues the fan-out now, while the job is still ours.
  await flush(ctx);
  log.info({ event: 'courses.lessons_batch.emitted', ...shape, ...counts }, 'lessons announced');
  return 'emitted';
}

/** `courses.lessons_batch` (08.6-07), registered in `coursesModule.jobs`; the worker passes the real clock. */
export const lessonsBatchJob: JobDefinition<LessonsBatchJob> = {
  name: COURSES_QUEUES.lessonsBatch,
  handler: (payload) => runLessonsBatch(payload, Date.now()).then(() => undefined),
};
