import { flush, subscribe } from '@rede-social/core/server/events/bus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseLessonsAdded } from '../contracts/index';

/**
 * 08.6-07 (D-450, COURSE-45, R-Pattern 7, R-A5, R-Pitfall 6): the lessons batch, without a database.
 *
 * - `armLessonsBatch` enqueues `courses.lessons_batch` through `enqueueInTx` (the mocked seam) with
 *   `startAfter` = now + 30 minutes and the course id as the singleton key, so one waiting job per
 *   course absorbs every later lesson (EP-56).
 * - `lessonsBatchPlan` decides from the claim: emit when it flipped at least one lesson (the notice's
 *   count is exactly that number, EP-57), re-arm while lessons whose video is still processing
 *   remain and the oldest of them is younger than 24 hours.
 * - `runLessonsBatch` ends WITHOUT claiming while the school is off, runs the claim definer in the
 *   tenant lane, re-arms in that same transaction when planned, and emits `course.lessons_added`
 *   (flushed before it returns) only when something was claimed; a malformed payload is dropped.
 *
 * `enqueueInTx`, `withTenantTx` and the flag cache are the mocked seams; the bus is the real one.
 * The SQL path is proved by pgTAP 197 section 5 and `courses-notifications.test.ts`
 * (`08.6 lessons batch`).
 */

const TENANT = '22222222-2222-4222-8222-222222222222';
const COURSE = 'c0000000-0000-4000-8000-0000000000c1';
const NOW = Date.parse('2026-10-12T21:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const BATCH_AT = '2026-10-12T21:00:00.123456Z';

const enqueued = vi.hoisted(() => [] as { name: string; payload: unknown; opts: unknown }[]);
vi.mock('@rede-social/core/server/jobs/boss', () => ({
  enqueueInTx: async (_tx: unknown, name: string, payload: unknown, opts: unknown) => {
    enqueued.push({ name, payload, opts });
    return 'job-id';
  },
}));

/** What the claim answers next, and what the flag cache says. */
const claim = vi.hoisted(() => ({
  rows: [] as unknown[],
  statements: [] as string[],
  coursesOn: true,
  flagReads: 0,
}));
vi.mock('@rede-social/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> =>
    fn({
      execute: async (query: unknown) => {
        claim.statements.push(JSON.stringify(query));
        return claim.rows;
      },
    }),
}));
vi.mock('@rede-social/core/server/modules/flags-cache', () => ({
  moduleFlags: {
    isEnabled: async (_ctx: unknown, key: string) => {
      claim.flagReads += 1;
      return key === 'courses' ? claim.coursesOn : false;
    },
  },
}));

const { armLessonsBatch, lessonsBatchJob, lessonsBatchPlan, runLessonsBatch } = await import(
  '../server/lessons-batch'
);

const fakeTx = {} as Parameters<typeof armLessonsBatch>[0];
const payload = { tenantId: TENANT, courseId: COURSE };
const claimRow = (claimed: number, pending: number, oldestPendingAt: string | null) => ({
  claimed,
  pending,
  oldest_pending_at: oldestPendingAt,
  batch_at: BATCH_AT,
});

beforeEach(() => {
  enqueued.length = 0;
  claim.rows = [];
  claim.statements.length = 0;
  claim.coursesOn = true;
  claim.flagReads = 0;
});

describe('armLessonsBatch (D-450, EP-56)', () => {
  it('enqueues one courses.lessons_batch job 30 minutes ahead, keyed by the course (later lessons are absorbed)', async () => {
    await armLessonsBatch(fakeTx, payload, NOW);
    expect(enqueued).toEqual([
      {
        name: 'courses.lessons_batch',
        payload: { tenantId: TENANT, courseId: COURSE },
        opts: { startAfter: new Date(NOW + 30 * MINUTE), singletonKey: COURSE },
      },
    ]);
  });

  it('the job definition is the courses.lessons_batch queue', () => {
    expect(lessonsBatchJob.name).toBe('courses.lessons_batch');
  });
});

describe('lessonsBatchPlan (D-450, R-A5, EP-57)', () => {
  const young = new Date(NOW - 2 * HOUR).toISOString();
  const old = new Date(NOW - 24 * HOUR - 1).toISOString();

  it.each([
    ['claimed 3, nothing pending → emit, no re-arm', 3, 0, null, { emit: true, rearm: false }],
    ['claimed 0, one young pending → no emit, re-arm', 0, 1, young, { emit: false, rearm: true }],
    ['claimed 2, one young pending → emit and re-arm', 2, 1, young, { emit: true, rearm: true }],
    [
      'claimed 0, the oldest pending older than 24 h → nothing',
      0,
      1,
      old,
      { emit: false, rearm: false },
    ],
    ['claimed 0, nothing pending → nothing', 0, 0, null, { emit: false, rearm: false }],
  ] as const)('%s', (_label, claimed, pending, oldestPendingAt, expected) => {
    expect(lessonsBatchPlan({ claimed, pending, oldestPendingAt }, NOW)).toEqual(expected);
  });
});

describe('runLessonsBatch: claims, re-arms and emits course.lessons_added', () => {
  let added: CourseLessonsAdded[] = [];
  let stop: () => void = () => {};
  beforeEach(() => {
    added = [];
    stop = subscribe('course.lessons_added', async (event) => {
      added.push(event);
    });
  });
  afterEach(() => stop());

  it('EP-57: three lessons claimed → one course.lessons_added with count 3 and the claim instant, flushed before returning, no re-arm', async () => {
    claim.rows = [claimRow(3, 0, null)];
    expect(await runLessonsBatch(payload, NOW)).toBe('emitted');
    expect(claim.statements[0]).toContain('app.course_lessons_claim_batch(');
    expect(added).toEqual([{ tenantId: TENANT, courseId: COURSE, count: 3, batchAt: BATCH_AT }]);
    expect(enqueued).toEqual([]);
  });

  it('R-A5: nothing claimed and a young pending lesson → no emit, and the batch re-arms itself 30 minutes later in the same lane', async () => {
    claim.rows = [claimRow(0, 1, new Date(NOW - HOUR).toISOString())];
    expect(await runLessonsBatch(payload, NOW)).toBe('skipped');
    expect(added).toEqual([]);
    expect(enqueued).toEqual([
      {
        name: 'courses.lessons_batch',
        payload,
        opts: { startAfter: new Date(NOW + 30 * MINUTE), singletonKey: COURSE },
      },
    ]);
  });

  it('the school off → ends without claiming, emitting or re-arming', async () => {
    claim.coursesOn = false;
    claim.rows = [claimRow(3, 1, new Date(NOW - HOUR).toISOString())];
    expect(await runLessonsBatch(payload, NOW)).toBe('skipped');
    expect(claim.statements).toHaveLength(0);
    expect(added).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it('a malformed payload is dropped without a read or a flag lookup (never retried forever)', async () => {
    for (const bad of [
      null,
      { ...payload, courseId: 'x' },
      { ...payload, tenantId: 'x' },
      { ...payload, title: 'Olhar do zero' },
    ]) {
      expect(await runLessonsBatch(bad, NOW)).toBe('dropped');
    }
    expect(claim.statements).toHaveLength(0);
    expect(claim.flagReads).toBe(0);
    await flush({ userId: '', tenantId: TENANT, role: 'member', requestId: 't', events: [] });
    expect(added).toEqual([]);
  });
});
