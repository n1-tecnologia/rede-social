import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 08.6-05 (D-445, D-447, COURSE-41): the live reminder's arming rules, without a database.
 *
 * - `liveReminderFireAtMs(start)` is `start − 15 min` (`LIVE_JOIN_LEAD_MINUTES`, the join window's
 *   opening, D-432).
 * - `liveReminderSingletonKey(liveId, startMs)` is `{liveId}:{floor(startMs / 1000)}`: one waiting
 *   job per live and start (100 opt-ins arm one job), a moved start a new key, sub-second starts the
 *   same key (EP-48).
 * - `planLiveReminder(start, now)` arms when the fire instant is still in the future and NOTHING
 *   when it is now or past (a live five minutes away accepts the opt-in and arms no job, EP-39/44).
 * - `armLiveReminder` enqueues `courses.live_reminder` through `enqueueInTx` (the mocked seam) with
 *   `startAfter` = the fire instant and the singleton key.
 *
 * The SQL path (the row, the job in `pgboss.job_common`) is proved end to end by
 * `apps/api/tests/integration/courses-member-area.test.ts` (`08.6 reminder opt-in`).
 */

const TENANT = '22222222-2222-4222-8222-222222222222';
const LIVE = '0e000000-0000-4000-8000-0000000000e5';
const STARTS_AT = '2026-10-12T22:00:00.000000Z';
const STARTS_MS = Date.parse(STARTS_AT);
const MINUTE = 60_000;

const enqueued = vi.hoisted(() => [] as { name: string; payload: unknown; opts: unknown }[]);
vi.mock('@rede-social/core/server/jobs/boss', () => ({
  enqueueInTx: async (_tx: unknown, name: string, payload: unknown, opts: unknown) => {
    enqueued.push({ name, payload, opts });
    return 'job-id';
  },
}));

const { armLiveReminder, liveReminderFireAtMs, liveReminderSingletonKey, planLiveReminder } =
  await import('../server/reminders');

const fakeTx = {} as Parameters<typeof armLiveReminder>[0];
const input = { tenantId: TENANT, liveId: LIVE, startsAt: STARTS_AT };

beforeEach(() => {
  enqueued.length = 0;
});

describe('liveReminderFireAtMs and liveReminderSingletonKey (D-445)', () => {
  it('the fire instant is exactly 15 minutes before the start (the join window opens)', () => {
    expect(liveReminderFireAtMs(STARTS_MS)).toBe(STARTS_MS - 15 * MINUTE);
  });

  it('the key is {liveId}:{startsAtEpochSeconds}', () => {
    expect(liveReminderSingletonKey(LIVE, STARTS_MS)).toBe(`${LIVE}:${STARTS_MS / 1000}`);
  });

  it('EP-48: the key floors to whole seconds (999 ms later is the same key); a moved start is a new key', () => {
    expect(liveReminderSingletonKey(LIVE, STARTS_MS + 999)).toBe(`${LIVE}:${STARTS_MS / 1000}`);
    expect(liveReminderSingletonKey(LIVE, STARTS_MS + 1000)).toBe(
      `${LIVE}:${STARTS_MS / 1000 + 1}`,
    );
    expect(liveReminderSingletonKey(LIVE, STARTS_MS + 60 * MINUTE)).not.toBe(
      liveReminderSingletonKey(LIVE, STARTS_MS),
    );
  });
});

describe('planLiveReminder (D-445, EP-39, EP-44)', () => {
  it('two hours ahead: one arm whose startAfter is the fire instant', () => {
    expect(planLiveReminder(STARTS_MS, STARTS_MS - 120 * MINUTE)).toEqual({
      startAfter: new Date(STARTS_MS - 15 * MINUTE),
    });
  });

  it('one millisecond before the fire instant still arms', () => {
    expect(planLiveReminder(STARTS_MS, STARTS_MS - 15 * MINUTE - 1)).toEqual({
      startAfter: new Date(STARTS_MS - 15 * MINUTE),
    });
  });

  it('EP-44: at the fire instant itself, nothing', () => {
    expect(planLiveReminder(STARTS_MS, STARTS_MS - 15 * MINUTE)).toBeNull();
  });

  it('EP-39: five minutes before the start (fire instant past), nothing', () => {
    expect(planLiveReminder(STARTS_MS, STARTS_MS - 5 * MINUTE)).toBeNull();
  });

  it('after the start, nothing', () => {
    expect(planLiveReminder(STARTS_MS, STARTS_MS + MINUTE)).toBeNull();
  });

  it('an unparseable start plans nothing', () => {
    expect(planLiveReminder(Number.NaN, 0)).toBeNull();
  });
});

describe('armLiveReminder (D-445, D-447)', () => {
  it('two hours ahead enqueues one courses.live_reminder job with the exact payload and options', async () => {
    expect(await armLiveReminder(fakeTx, input, STARTS_MS - 120 * MINUTE)).toBe(true);
    expect(enqueued).toEqual([
      {
        name: 'courses.live_reminder',
        payload: { tenantId: TENANT, liveId: LIVE, startsAt: STARTS_AT },
        opts: {
          startAfter: new Date(STARTS_MS - 15 * MINUTE),
          singletonKey: `${LIVE}:${STARTS_MS / 1000}`,
        },
      },
    ]);
  });

  it('EP-44: the fire instant now or past arms nothing and enqueues nothing', async () => {
    expect(await armLiveReminder(fakeTx, input, STARTS_MS - 15 * MINUTE)).toBe(false);
    expect(await armLiveReminder(fakeTx, input, STARTS_MS - 5 * MINUTE)).toBe(false);
    expect(enqueued).toEqual([]);
  });

  it('an unparseable stored start arms nothing', async () => {
    expect(await armLiveReminder(fakeTx, { ...input, startsAt: 'amanhã' }, 0)).toBe(false);
    expect(enqueued).toEqual([]);
  });
});
