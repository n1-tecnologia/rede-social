import { flush, subscribe } from '@rede-social/core/server/events/bus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CourseLiveReminderDue } from '../contracts/index';

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
 * - `liveReminderSkipReason` (D-446, D-447) decides at fire time, in the order not_found, cancelled,
 *   moved, module_off, started, late (EP-47): `started` (`now >= starts_at`) before `late` (`now >
 *   fireAt + 10 min`, R-Pitfall 7), the edges pinned to the millisecond (EP-44).
 * - `runLiveReminder` emits `course.live_reminder_due` only when every check passes and flushes it
 *   before returning; a malformed payload is dropped without a read.
 *
 * `enqueueInTx`, `withTenantTx` and the module flag cache are the mocked seams; the bus is the real
 * one. The SQL path (the row, the job in `pgboss.job_common`, the fire-time read) is proved end to
 * end by `apps/api/tests/integration/courses-member-area.test.ts` (`08.6 reminder opt-in`) and
 * `courses-notifications.test.ts` (`08.6 live reminder`).
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

/** What the fire-time read answers next (one row or none), and what the flag cache says. */
const fire = vi.hoisted(() => ({
  rows: [] as unknown[],
  statements: [] as string[],
  coursesOn: true,
  flagReads: 0,
}));
vi.mock('@rede-social/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> =>
    fn({
      execute: async (query: unknown) => {
        fire.statements.push(JSON.stringify(query));
        return fire.rows;
      },
    }),
}));
vi.mock('@rede-social/core/server/modules/flags-cache', () => ({
  moduleFlags: {
    isEnabled: async (_ctx: unknown, key: string) => {
      fire.flagReads += 1;
      return key === 'courses' ? fire.coursesOn : false;
    },
  },
}));

const {
  armLiveReminder,
  liveReminderFireAtMs,
  liveReminderSingletonKey,
  liveReminderSkipReason,
  planLiveReminder,
  runLiveReminder,
} = await import('../server/reminders');

const fakeTx = {} as Parameters<typeof armLiveReminder>[0];
const input = { tenantId: TENANT, liveId: LIVE, startsAt: STARTS_AT };

beforeEach(() => {
  enqueued.length = 0;
  fire.rows = [];
  fire.statements.length = 0;
  fire.coursesOn = true;
  fire.flagReads = 0;
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

describe('liveReminderSkipReason: the fire-time decision table (D-446, D-447, EP-44, EP-47)', () => {
  const row = { cancelled: false, starts_at: STARTS_AT, starts_match: true };
  const payload = { startsAt: STARTS_AT };
  const fireAt = STARTS_MS - 15 * MINUTE;

  it('a null row → not_found', () => {
    expect(liveReminderSkipReason(null, payload, fireAt, true)).toBe('not_found');
  });

  it('a cancelled live → cancelled', () => {
    expect(liveReminderSkipReason({ ...row, cancelled: true }, payload, fireAt, true)).toBe(
      'cancelled',
    );
  });

  it('starts_match false → moved', () => {
    expect(liveReminderSkipReason({ ...row, starts_match: false }, payload, fireAt, true)).toBe(
      'moved',
    );
  });

  it('courses off → module_off', () => {
    expect(liveReminderSkipReason(row, payload, fireAt, false)).toBe('module_off');
  });

  it('EP-44: exactly at fireAt fires', () => {
    expect(liveReminderSkipReason(row, payload, fireAt, true)).toBeNull();
  });

  it('EP-44: exactly at fireAt + 10 min fires (inclusive)', () => {
    expect(liveReminderSkipReason(row, payload, fireAt + 10 * MINUTE, true)).toBeNull();
  });

  it('EP-44: fireAt + 10 min + 1 ms → late', () => {
    expect(liveReminderSkipReason(row, payload, fireAt + 10 * MINUTE + 1, true)).toBe('late');
  });

  it('EP-44: now = starts_at and later → started (checked before late)', () => {
    expect(liveReminderSkipReason(row, payload, STARTS_MS, true)).toBe('started');
    expect(liveReminderSkipReason(row, payload, STARTS_MS + MINUTE, true)).toBe('started');
  });

  it('EP-47: a cancelled job that is also late reports cancelled', () => {
    expect(
      liveReminderSkipReason({ ...row, cancelled: true }, payload, fireAt + 11 * MINUTE, true),
    ).toBe('cancelled');
  });

  it('EP-47: the order is not_found, cancelled, moved, module_off, started, late', () => {
    const late = fireAt + 11 * MINUTE;
    expect(liveReminderSkipReason(null, payload, STARTS_MS, false)).toBe('not_found');
    expect(
      liveReminderSkipReason(
        { ...row, cancelled: true, starts_match: false },
        payload,
        late,
        false,
      ),
    ).toBe('cancelled');
    expect(liveReminderSkipReason({ ...row, starts_match: false }, payload, late, false)).toBe(
      'moved',
    );
    expect(liveReminderSkipReason(row, payload, STARTS_MS, false)).toBe('module_off');
    expect(liveReminderSkipReason(row, payload, STARTS_MS, true)).toBe('started');
    expect(liveReminderSkipReason(row, payload, late, true)).toBe('late');
  });
});

describe('runLiveReminder: emits course.live_reminder_due only when every check passes', () => {
  let due: CourseLiveReminderDue[] = [];
  let stop: () => void = () => {};
  beforeEach(() => {
    due = [];
    stop = subscribe('course.live_reminder_due', async (payload) => {
      due.push(payload);
    });
  });
  afterEach(() => stop());

  const row = { cancelled: false, starts_at: STARTS_AT, starts_match: true };
  const payload = { tenantId: TENANT, liveId: LIVE, startsAt: STARTS_AT };
  const fireAt = STARTS_MS - 15 * MINUTE;

  it.each([
    ['open and matching, at fireAt', 'emitted', row, true, fireAt, 1],
    ['fireAt + 10 min', 'emitted', row, true, fireAt + 10 * MINUTE, 1],
    ['fireAt + 10 min + 1 ms', 'skipped', row, true, fireAt + 10 * MINUTE + 1, 0],
    ['moved', 'skipped', { ...row, starts_match: false }, true, fireAt, 0],
    ['cancelled', 'skipped', { ...row, cancelled: true }, true, fireAt, 0],
    ['courses off', 'skipped', row, false, fireAt, 0],
    ['at starts_at', 'skipped', row, true, STARTS_MS, 0],
  ] as const)('%s → %s', async (_label, outcome, current, coursesOn, nowMs, count) => {
    fire.rows = [current];
    fire.coursesOn = coursesOn;
    expect(await runLiveReminder(payload, nowMs)).toBe(outcome);
    // Delivered by the job's own flush, before it returned.
    expect(due).toHaveLength(count);
    if (count === 1) expect(due[0]).toEqual(payload);
  });

  it('EP-46: a live id that no longer exists skips; the read carries the payload instant for the database comparison', async () => {
    fire.rows = [];
    expect(await runLiveReminder(payload, fireAt)).toBe('skipped');
    expect(fire.statements[0]).toContain('starts_at = ');
    expect(fire.flagReads).toBe(1);
    expect(due).toHaveLength(0);
  });

  it('a malformed payload is dropped without a read or a flag lookup (never retried forever)', async () => {
    for (const bad of [
      null,
      { ...payload, liveId: 'x' },
      { ...payload, tenantId: 'x' },
      { ...payload, startsAt: '2026-10-12' },
      { ...payload, title: 'Tira-dúvidas' },
    ]) {
      expect(await runLiveReminder(bad, fireAt)).toBe('dropped');
    }
    expect(fire.statements).toHaveLength(0);
    expect(fire.flagReads).toBe(0);
    await flush({ userId: '', tenantId: TENANT, role: 'member', requestId: 't', events: [] });
    expect(due).toHaveLength(0);
  });
});
