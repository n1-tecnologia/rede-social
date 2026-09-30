import { flush, subscribe } from '@rede-social/core/server/events/bus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventReminderDue } from '../contracts/index';

/**
 * EVENT-07 (07-05): the reminder arming rules and the fire-time decision table, without a database.
 *
 * - `armEventReminders` enqueues one `events.reminder` job per window whose fire time is still in the
 *   future, with `startAfter = starts_at − 24 h / − 1 h` and the singleton key
 *   `{eventId}:{window}:{startsAtEpochSeconds}`; a past window is SKIPPED, never sent late.
 * - `runEventReminder` emits `event.reminder_due` only when the event exists, is not removed, is
 *   active, still starts at the payload's instant, has not started, and the worker is at most 30
 *   minutes late (`fireAt + 30 min` inclusive).
 *
 * `enqueueInTx` (the kernel's pg-boss wrapper) and `withTenantTx` are the mocked seams; the bus is
 * the real one. The SQL is proved end to end by `apps/api/tests/integration/events-reminders.test.ts`.
 */

const TENANT = '22222222-2222-4222-8222-222222222222';
const EVENT = '11111111-1111-4111-8111-111111111111';
const STARTS_AT = '2026-10-12T22:00:00.000000Z';
const STARTS_MS = Date.parse(STARTS_AT);
const HOUR = 3_600_000;
const MINUTE = 60_000;

const enqueued = vi.hoisted(() => [] as { name: string; payload: unknown; opts: unknown }[]);
vi.mock('@rede-social/core/server/jobs/boss', () => ({
  enqueueInTx: async (_tx: unknown, name: string, payload: unknown, opts: unknown) => {
    enqueued.push({ name, payload, opts });
    return 'job-id';
  },
}));

/** What the fire-time read answers next (one row or none). */
const fire = vi.hoisted(() => ({ rows: [] as unknown[], statements: [] as string[] }));
vi.mock('@rede-social/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> =>
    fn({
      execute: async (query: unknown) => {
        fire.statements.push(JSON.stringify(query));
        return fire.rows;
      },
    }),
}));

const {
  armEventReminders,
  planEventReminders,
  reminderSingletonKey,
  reminderSkipReason,
  runEventReminder,
} = await import('../server/reminders');

const fakeTx = {} as Parameters<typeof armEventReminders>[0];
const input = { tenantId: TENANT, eventId: EVENT, startsAt: STARTS_AT };

beforeEach(() => {
  enqueued.length = 0;
  fire.rows = [];
  fire.statements.length = 0;
});

describe('armEventReminders: skip rules and the key format', () => {
  it('more than 24 h ahead arms both windows, in firing order, with the exact options', async () => {
    const armed = await armEventReminders(fakeTx, input, STARTS_MS - 25 * HOUR);
    expect(armed).toEqual(['24h', '1h']);
    const seconds = STARTS_MS / 1000;
    expect(enqueued).toEqual([
      {
        name: 'events.reminder',
        payload: { tenantId: TENANT, eventId: EVENT, window: '24h', startsAt: STARTS_AT },
        opts: {
          startAfter: new Date(STARTS_MS - 24 * HOUR),
          singletonKey: `${EVENT}:24h:${seconds}`,
        },
      },
      {
        name: 'events.reminder',
        payload: { tenantId: TENANT, eventId: EVENT, window: '1h', startsAt: STARTS_AT },
        opts: { startAfter: new Date(STARTS_MS - HOUR), singletonKey: `${EVENT}:1h:${seconds}` },
      },
    ]);
  });

  it('2 h ahead arms only the 1 h job; 30 min ahead arms none; at the fire instant itself, none', async () => {
    expect(await armEventReminders(fakeTx, input, STARTS_MS - 2 * HOUR)).toEqual(['1h']);
    expect(await armEventReminders(fakeTx, input, STARTS_MS - 30 * MINUTE)).toEqual([]);
    expect(await armEventReminders(fakeTx, input, STARTS_MS - 24 * HOUR)).toEqual(['1h']);
    expect(await armEventReminders(fakeTx, input, STARTS_MS - HOUR)).toEqual([]);
    expect(enqueued.map((job) => (job.payload as { window: string }).window)).toEqual(['1h', '1h']);
  });

  it('the singleton key changes with the start (a move arms new keys) and floors to seconds', () => {
    expect(reminderSingletonKey(EVENT, '24h', STARTS_MS + 999)).toBe(
      `${EVENT}:24h:${STARTS_MS / 1000}`,
    );
    expect(reminderSingletonKey(EVENT, '24h', STARTS_MS + 3 * HOUR)).not.toBe(
      reminderSingletonKey(EVENT, '24h', STARTS_MS),
    );
  });

  it('an unparseable start plans nothing', () => {
    expect(planEventReminders({ ...input, startsAt: 'amanhã' }, 0)).toEqual([]);
  });
});

describe('reminderSkipReason: the fire-time decision table', () => {
  const active = {
    status: 'active' as const,
    deleted: false,
    starts_at: STARTS_AT,
    starts_match: true,
  };
  const p24 = { window: '24h' as const, startsAt: STARTS_AT };
  const p1 = { window: '1h' as const, startsAt: STARTS_AT };
  const fire24 = STARTS_MS - 24 * HOUR;

  it('active and matching fires, at the fire time and up to 30 minutes late (inclusive)', () => {
    expect(reminderSkipReason(active, p24, fire24)).toBeNull();
    expect(reminderSkipReason(active, p24, fire24 + 30 * MINUTE)).toBeNull();
    expect(reminderSkipReason(active, p1, STARTS_MS - HOUR + 30 * MINUTE)).toBeNull();
  });

  it('31 minutes late sends nothing', () => {
    expect(reminderSkipReason(active, p24, fire24 + 31 * MINUTE)).toBe('late');
    expect(reminderSkipReason(active, p1, STARTS_MS - HOUR + 31 * MINUTE)).toBe('late');
  });

  it('moved, cancelled, deleted and missing events are skipped', () => {
    expect(reminderSkipReason({ ...active, starts_match: false }, p24, fire24)).toBe('moved');
    expect(reminderSkipReason({ ...active, status: 'cancelled' }, p24, fire24)).toBe('cancelled');
    expect(reminderSkipReason({ ...active, deleted: true }, p24, fire24)).toBe('deleted');
    expect(reminderSkipReason(null, p24, fire24)).toBe('not_found');
  });

  it('now at or after starts_at is skipped, whatever the window', () => {
    expect(reminderSkipReason(active, p1, STARTS_MS)).toBe('started');
    expect(reminderSkipReason(active, p1, STARTS_MS + MINUTE)).toBe('started');
  });
});

describe('runEventReminder: emits event.reminder_due only when every check passes', () => {
  let due: EventReminderDue[] = [];
  let stop: () => void = () => {};
  beforeEach(() => {
    due = [];
    stop = subscribe('event.reminder_due', async (payload) => {
      due.push(payload);
    });
  });
  afterEach(() => stop());

  const row = { status: 'active', deleted: false, starts_at: STARTS_AT, starts_match: true };
  const payload = { tenantId: TENANT, eventId: EVENT, window: '24h', startsAt: STARTS_AT };
  const fire24 = STARTS_MS - 24 * HOUR;

  it.each([
    ['active and matching', row, fire24, 'emitted', 1],
    ['moved', { ...row, starts_match: false }, fire24, 'skipped', 0],
    ['cancelled', { ...row, status: 'cancelled' }, fire24, 'skipped', 0],
    ['deleted', { ...row, deleted: true }, fire24, 'skipped', 0],
    ['fireAt + 30 min', row, fire24 + 30 * MINUTE, 'emitted', 1],
    ['fireAt + 31 min', row, fire24 + 31 * MINUTE, 'skipped', 0],
    ['at starts_at', row, STARTS_MS, 'skipped', 0],
  ] as const)('%s → %s', async (_label, current, nowMs, outcome, count) => {
    fire.rows = [current];
    expect(await runEventReminder(payload, nowMs)).toBe(outcome);
    expect(due).toHaveLength(count);
    if (count === 1) expect(due[0]).toEqual(payload);
  });

  it('a missing event is skipped; the read carries the payload instant for the database comparison', async () => {
    fire.rows = [];
    expect(await runEventReminder(payload, fire24)).toBe('skipped');
    expect(fire.statements[0]).toContain('starts_at = ');
    expect(due).toHaveLength(0);
  });

  it('a malformed payload is dropped without a read (never retried forever)', async () => {
    for (const bad of [
      null,
      { ...payload, window: '2h' },
      { ...payload, tenantId: 'x' },
      { ...payload, startsAt: '2026-10-12' },
      { ...payload, title: 'Encontro' },
    ]) {
      expect(await runEventReminder(bad, fire24)).toBe('dropped');
    }
    expect(fire.statements).toHaveLength(0);
    await flush({ userId: '', tenantId: TENANT, role: 'member', requestId: 't', events: [] });
    expect(due).toHaveLength(0);
  });
});
