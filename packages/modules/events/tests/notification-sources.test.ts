import type { Tx } from '@rede-social/core/db/tenant-tx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENTS_NOTIFICATION_KINDS } from '../contracts/index';
import { eventsPushCopy, eventTime, eventWhen } from '../server/notification-copy';
import {
  EVENTS_BROADCAST_TTL_SECONDS,
  eventsNotificationSources,
  reminderTagAndTopic,
} from '../server/notifications';

/**
 * The events module's notification sources (07-05, D-201/D-214/D-226/D-229/D-235/D-236), pinned with
 * a fake `tx` answering a scripted row per statement: kinds, dedupe keys, audiences, exclusions, the
 * push hints and tags, and the tenant-clock formatting. The SQL itself is proved end to end by the
 * API integration suites (`events-reminders.test.ts`, `notifications.test.ts` "notifications
 * eventos").
 */

const T = '22222222-2222-4222-8222-222222222222';
const E = '0e000000-0000-4000-8000-000000000e01';
const CREATOR = '33333333-3333-4333-8333-333333333333';
const REACTIVATOR = '44444444-4444-4444-8444-444444444444';
const A = '55555555-5555-4555-8555-555555555555';
const B = '66666666-6666-4666-8666-666666666666';
const COVER = '77777777-7777-4777-8777-777777777777';
/** 19:00 in São Paulo (UTC−3), 18:00 in Manaus (UTC−4), on Monday 12 October 2026. */
const STARTS_AT = '2026-10-12T22:00:00.000000Z';
const NOW = Date.parse('2026-10-01T12:00:00.000Z');

/** A fake `tx` answering one scripted result per statement, in order. */
function fakeTx(...results: unknown[][]): Tx {
  const queue = [...results];
  return { execute: async () => queue.shift() ?? [] } as unknown as Tx;
}

function sourceFor(event: string) {
  const found = eventsNotificationSources.find((s) => s.event === event);
  if (!found) throw new Error(`no ${event} source`);
  return found;
}

const eventRow = {
  id: E,
  title: 'Encontro anual',
  created_by_user_id: CREATOR,
  cover_asset_id: COVER,
  starts_at: STARTS_AT,
  timezone: 'America/Sao_Paulo',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('events sources: the declared set (D-201, D-214)', () => {
  it('declares published, reactivated and reminder_due, and NO source for edits or cancels', () => {
    expect(eventsNotificationSources.map((s) => s.event)).toEqual([
      'event.published',
      'event.reactivated',
      'event.reminder_due',
    ]);
    const events = eventsNotificationSources.map((s) => s.event as string);
    expect(events).not.toContain('event.updated');
    expect(events).not.toContain('event.cancelled');
  });
});

describe('event.published source (broadcast, D-226/D-229)', () => {
  const published = sourceFor('event.published');
  const payload = {
    tenantId: T,
    eventId: E,
    actorUserId: CREATOR,
    format: 'online' as const,
    startsAt: STARTS_AT,
    endsAt: '2026-10-13T00:00:00.000000Z',
  };

  it('yields ONE events.event intent to members, the creator excluded and named', async () => {
    const intents = await published.resolve(fakeTx([eventRow]), payload, { sinkAt: 's' });
    expect(intents).toHaveLength(1);
    const [intent] = intents;
    expect(intent?.kind).toBe(EVENTS_NOTIFICATION_KINDS.event);
    expect(intent?.audience).toEqual({ type: 'members' });
    expect(intent?.excludeUserIds).toEqual([CREATOR]);
    expect(intent?.dedupeKey).toBe(`events.event:${E}`);
    expect(intent?.subject).toEqual({ type: 'event', id: E });
    expect(intent?.object).toBeNull();
    expect(intent?.actorUserId).toBe(CREATOR);
    expect(intent?.facts).toEqual({
      eventId: E,
      title: 'Encontro anual',
      startsAt: STARTS_AT,
      previewAssetId: COVER,
    });
    expect(intent?.channels).toEqual(['in_app', 'push']);
    expect(intent?.push).toEqual({
      title: 'tenant',
      body: 'Novo evento: Encontro anual · seg., 12 de out. · 19:00',
      url: `/eventos/${E}`,
      tag: 'events-event',
      topic: 'events-event',
      ttlSeconds: EVENTS_BROADCAST_TTL_SECONDS,
      urgency: 'normal',
      renotify: false,
    });
  });

  it('a cancelled or removed event (no row) yields nothing', async () => {
    expect(await published.resolve(fakeTx([]), payload, { sinkAt: 's' })).toEqual([]);
  });
});

describe('event.reactivated source (the Reativar exception to D-214)', () => {
  const reactivated = sourceFor('event.reactivated');
  const payload = {
    tenantId: T,
    eventId: E,
    actorUserId: REACTIVATOR,
    startsAt: STARTS_AT,
    endsAt: '2026-10-13T00:00:00.000000Z',
  };

  it('names and excludes the REACTIVATING admin; the dedupe key carries sinkAt', async () => {
    const [first] = await reactivated.resolve(fakeTx([eventRow]), payload, { sinkAt: 'at-1' });
    const [second] = await reactivated.resolve(fakeTx([eventRow]), payload, { sinkAt: 'at-2' });
    expect(first?.kind).toBe(EVENTS_NOTIFICATION_KINDS.reactivated);
    expect(first?.audience).toEqual({ type: 'members' });
    expect(first?.excludeUserIds).toEqual([REACTIVATOR]);
    expect(first?.actorUserId).toBe(REACTIVATOR);
    // Two reactivations are two notifications; a retry of ONE reuses its sinkAt.
    expect(first?.dedupeKey).toBe(`events.event_reactivated:${E}:at-1`);
    expect(second?.dedupeKey).toBe(`events.event_reactivated:${E}:at-2`);
    expect(first?.push).toMatchObject({
      body: 'Evento reativado: Encontro anual · seg., 12 de out. · 19:00',
      tag: 'events-reactivated',
      topic: 'events-reactivated',
      ttlSeconds: 86_400,
      urgency: 'normal',
      renotify: false,
    });
  });

  it('re-cancelled before the worker ran (no active row) yields nothing', async () => {
    expect(await reactivated.resolve(fakeTx([]), payload, { sinkAt: 'x' })).toEqual([]);
  });
});

describe('event.reminder_due source (EVENT-07)', () => {
  const due = sourceFor('event.reminder_due');
  const reminderRow = {
    id: E,
    title: 'Encontro anual',
    starts_at: STARTS_AT,
    timezone: 'America/Sao_Paulo',
    seconds_left: 3_590,
  };

  it('24 h: ONE actor-less events.reminder_24h intent to exactly the Vou list', async () => {
    const intents = await due.resolve(
      fakeTx([reminderRow], [{ user_id: A }, { user_id: B }]),
      { tenantId: T, eventId: E, window: '24h', startsAt: STARTS_AT },
      { sinkAt: 's' },
    );
    expect(intents).toHaveLength(1);
    const [intent] = intents;
    expect(intent?.kind).toBe(EVENTS_NOTIFICATION_KINDS.reminder24h);
    expect(intent?.audience).toEqual({ type: 'users', userIds: [A, B] });
    expect(intent?.excludeUserIds).toEqual([]);
    expect(intent?.dedupeKey).toBe(`events.reminder_24h:${E}`);
    expect(intent?.subject).toEqual({ type: 'event', id: E });
    expect(intent?.actorUserId).toBeNull();
    expect(intent?.facts).toEqual({ eventId: E, title: 'Encontro anual', startsAt: STARTS_AT });
    const hex = E.replaceAll('-', '');
    expect(intent?.push).toEqual({
      title: 'tenant',
      body: 'Amanhã às 19:00: Encontro anual',
      url: `/eventos/${E}`,
      tag: `events-reminder-${hex}`,
      topic: hex,
      ttlSeconds: 3_590,
      urgency: 'high',
      renotify: true,
    });
  });

  it('1 h: the 1 h kind, its own dedupe key, the same per-event tag, and a TTL of at least 60 s', async () => {
    const [intent] = await due.resolve(
      fakeTx([{ ...reminderRow, seconds_left: 12 }], [{ user_id: A }]),
      { tenantId: T, eventId: E, window: '1h', startsAt: STARTS_AT },
      { sinkAt: 's' },
    );
    expect(intent?.kind).toBe(EVENTS_NOTIFICATION_KINDS.reminder1h);
    expect(intent?.dedupeKey).toBe(`events.reminder_1h:${E}`);
    expect(intent?.push?.body).toBe('Em 1 hora: Encontro anual começa às 19:00');
    expect(intent?.push?.tag).toBe(reminderTagAndTopic(E).tag);
    expect(intent?.push?.ttlSeconds).toBe(60);
  });

  it('nobody said Vou, or the event moved, was cancelled or removed: nothing', async () => {
    const payload = { tenantId: T, eventId: E, window: '24h' as const, startsAt: STARTS_AT };
    expect(await due.resolve(fakeTx([reminderRow], []), payload, { sinkAt: 's' })).toEqual([]);
    expect(await due.resolve(fakeTx([]), payload, { sinkAt: 's' })).toEqual([]);
  });

  it('the reminder Topic is exactly 32 hex characters (a valid Web Push Topic)', () => {
    const { tag, topic } = reminderTagAndTopic(E);
    expect(topic).toMatch(/^[0-9a-f]{32}$/);
    expect(tag).toBe(`events-reminder-${topic}`);
  });
});

describe('tenant-clock formatting (never the server zone)', () => {
  it('São Paulo and Manaus read the same instant as their own wall clock', () => {
    expect(eventTime(STARTS_AT, 'America/Sao_Paulo')).toBe('19:00');
    expect(eventTime(STARTS_AT, 'America/Manaus')).toBe('18:00');
    expect(eventWhen(STARTS_AT, 'America/Sao_Paulo', NOW)).toBe('seg., 12 de out. · 19:00');
    expect(eventWhen(STARTS_AT, 'America/Manaus', NOW)).toBe('seg., 12 de out. · 18:00');
    expect(
      eventsPushCopy({
        kind: EVENTS_NOTIFICATION_KINDS.reminder1h,
        title: 'Encontro anual',
        startsAt: STARTS_AT,
        timeZone: 'America/Manaus',
        nowMs: NOW,
      }),
    ).toBe('Em 1 hora: Encontro anual começa às 18:00');
  });

  it('a start in another tenant-local year carries the year; a local-midnight crossing moves the day', () => {
    expect(eventWhen('2027-01-15T22:00:00.000000Z', 'America/Sao_Paulo', NOW)).toBe(
      'sex., 15 de jan. de 2027 · 19:00',
    );
    // 02:30Z on the 13th is still the 12th, 23:30, in São Paulo.
    expect(eventWhen('2026-10-13T02:30:00.000000Z', 'America/Sao_Paulo', NOW)).toBe(
      'seg., 12 de out. · 23:30',
    );
  });

  it('a long title is cut on a word to 100 characters with an ellipsis', () => {
    const body = eventsPushCopy({
      kind: EVENTS_NOTIFICATION_KINDS.reminder24h,
      title: 'palavra '.repeat(20).trim(),
      startsAt: STARTS_AT,
      timeZone: 'America/Sao_Paulo',
      nowMs: NOW,
    });
    expect([...body].length).toBeLessThanOrEqual(100);
    expect(body.endsWith('…')).toBe(true);
    expect(body.startsWith('Amanhã às 19:00: palavra')).toBe(true);
  });
});
