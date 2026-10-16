import type { Tx } from '@rede-social/core/db/tenant-tx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COURSES_NOTIFICATION_KINDS } from '../contracts/index';
import {
  COURSES_REMINDER_TTL_MIN_SECONDS,
  coursesNotificationSources,
  liveReminderTagAndTopic,
} from '../server/notifications';

/**
 * The courses module's notification sources (08.6-05, D-446, D-451, COURSE-48), pinned with a fake
 * `tx` answering one scripted result per statement: the declared set, the kind, the audience (the
 * recipients definer's ids, never a lane select of the own-row table), the dedupe key, the facts
 * allow-list (EP-65), the push hint and the tenant clock. The SQL itself is proved end to end by
 * `apps/api/tests/integration/courses-notifications.test.ts` (`08.6 live reminder`).
 */

const T = '22222222-2222-4222-8222-222222222222';
const L = '0e000000-0000-4000-8000-0000000000e5';
const M = '55555555-5555-4555-8555-555555555555';
const H = '66666666-6666-4666-8666-666666666666';
const COVER = '77777777-7777-4777-8777-777777777777';
/** 19:00 in São Paulo (UTC−3), on Monday 12 October 2026. */
const STARTS_AT = '2026-10-12T22:00:00.000000Z';
const STARTS_EPOCH = Date.parse(STARTS_AT) / 1000;
const NOW = Date.parse('2026-10-12T21:45:00.000Z');
const payload = { tenantId: T, liveId: L, startsAt: STARTS_AT };

/** A fake `tx` answering one scripted result per statement, in order, recording each statement. */
function fakeTx(statements: string[], ...results: unknown[][]): Tx {
  const queue = [...results];
  return {
    execute: async (query: unknown) => {
      statements.push(JSON.stringify(query));
      return queue.shift() ?? [];
    },
  } as unknown as Tx;
}

function sourceFor(event: string) {
  const found = coursesNotificationSources.find((s) => s.event === event);
  if (!found) throw new Error(`no ${event} source`);
  return found;
}

const liveRow = {
  id: L,
  title: 'Tira-dúvidas',
  cover_asset_id: COVER,
  starts_at: STARTS_AT,
  timezone: 'America/Sao_Paulo',
  seconds_left: 900,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('courses notification kinds (D-448, planning decision 5)', () => {
  it('declares exactly the six stored kinds', () => {
    expect(COURSES_NOTIFICATION_KINDS).toEqual({
      coursePublished: 'courses.course_published',
      lessonsAdded: 'courses.lessons_added',
      liveScheduled: 'courses.live_scheduled',
      liveReminder: 'courses.live_reminder',
      liveCancelled: 'courses.live_cancelled',
      replayAvailable: 'courses.replay_available',
    });
  });

  it('this plan declares the reminder source only', () => {
    expect(coursesNotificationSources.map((s) => s.event)).toEqual(['course.live_reminder_due']);
  });
});

describe('course.live_reminder_due source (D-446, D-451, COURSE-48)', () => {
  const due = sourceFor('course.live_reminder_due');
  const meta = { sinkAt: '2026-10-12T21:45:00.000000Z' };

  it('a live cancelled or moved since the job (the re-read finds nothing) → no intent, and no recipient read', async () => {
    const statements: string[] = [];
    expect(await due.resolve(fakeTx(statements, []), payload, meta)).toEqual([]);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('cancelled_at is null');
    expect(statements[0]).toContain('starts_at = ');
  });

  it('EP-46: the definer answers no user → no intent', async () => {
    const statements: string[] = [];
    expect(await due.resolve(fakeTx(statements, [liveRow], []), payload, meta)).toEqual([]);
    expect(statements).toHaveLength(2);
  });

  it('recipients come from app.course_live_reminder_user_ids(live, true), never a lane select of the own-row table', async () => {
    const statements: string[] = [];
    await due.resolve(fakeTx(statements, [liveRow], [{ user_id: M }]), payload, meta);
    expect(statements[1]).toContain('app.course_live_reminder_user_ids(');
    expect(statements[1]).toContain('true');
    expect(statements.join('\n')).not.toContain('from course_live_reminders');
  });

  it('one actor-less in_app + push intent to the definer’s users, with the D-451 hint', async () => {
    const intents = await due.resolve(
      fakeTx([], [liveRow], [{ user_id: M }, { user_id: H }]),
      payload,
      meta,
    );
    const { tag, topic } = liveReminderTagAndTopic(L);
    expect(intents).toEqual([
      {
        kind: 'courses.live_reminder',
        audience: { type: 'users', userIds: [M, H] },
        excludeUserIds: [],
        dedupeKey: `courses.live_reminder:${L}:${STARTS_EPOCH}`,
        subject: { type: 'live', id: L },
        object: null,
        actorUserId: null,
        facts: { liveId: L, title: 'Tira-dúvidas', startsAt: STARTS_AT, previewAssetId: COVER },
        channels: ['in_app', 'push'],
        push: {
          title: 'tenant',
          body: 'Em 15 minutos: Tira-dúvidas começa às 19:00',
          url: `/cursos/lives/${L}`,
          tag,
          topic,
          ttlSeconds: 900,
          urgency: 'high',
          renotify: true,
        },
      },
    ]);
  });

  it('EP-65: the facts key set, sorted, is exactly liveId, previewAssetId, startsAt, title — no lesson, no room link', async () => {
    const [intent] = await due.resolve(
      fakeTx([], [{ ...liveRow, external_url: 'https://meet.example.com/sala' }], [{ user_id: M }]),
      payload,
      meta,
    );
    expect(Object.keys(intent?.facts ?? {}).sort()).toEqual([
      'liveId',
      'previewAssetId',
      'startsAt',
      'title',
    ]);
    expect(JSON.stringify(intent)).not.toContain('meet.example.com');
  });

  it('the push TTL never drops below a minute, and a live without a cover previews nothing', async () => {
    const [intent] = await due.resolve(
      fakeTx([], [{ ...liveRow, cover_asset_id: null, seconds_left: 5 }], [{ user_id: M }]),
      payload,
      meta,
    );
    expect(intent?.push?.ttlSeconds).toBe(COURSES_REMINDER_TTL_MIN_SECONDS);
    expect(intent?.facts.previewAssetId).toBeNull();
  });

  it('the device tag and the Web Push Topic come from the live id (Topic: at most 32 URL-safe characters)', () => {
    const { tag, topic } = liveReminderTagAndTopic(L);
    expect(topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(topic).toBe(L.replaceAll('-', ''));
    expect(tag).toBe(`courses-live-reminder-${topic}`);
  });
});
