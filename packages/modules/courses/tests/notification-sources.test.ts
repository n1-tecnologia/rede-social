import type { Tx } from '@rede-social/core/db/tenant-tx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COURSES_NOTIFICATION_KINDS } from '../contracts/index';
import {
  COURSES_REMINDER_TTL_MIN_SECONDS,
  coursesNotificationSources,
  liveReminderTagAndTopic,
} from '../server/notifications';

/**
 * The courses module's notification sources (08.6-05, D-446, D-451, COURSE-48; 08.6-06, D-447,
 * COURSE-42), pinned with a fake `tx` answering one scripted result per statement: the declared set,
 * the school check (planning decision 5 of 08.6-06: every source first reads the tenant's `courses`
 * row in the fan-out transaction), the kind, the audience (the recipients definer's ids, never a
 * lane select of the own-row table), the dedupe key, the facts allow-list (EP-65), the push hint and
 * the tenant clock. The SQL itself is proved end to end by
 * `apps/api/tests/integration/courses-notifications.test.ts`.
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
const ADMIN = '88888888-8888-4888-8888-888888888888';
/** The school row of the fan-out transaction: on, or off. */
const ON = [{ enabled: true }];
const OFF = [{ enabled: false }];

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

  it('declares the reminder, cancel, scheduled and replay sources (08.6-05, 08.6-06)', () => {
    expect(coursesNotificationSources.map((s) => s.event)).toEqual([
      'course.live_reminder_due',
      'course.live_cancelled',
      'course.live_scheduled',
      'course.replay_available',
    ]);
  });
});

describe('course.live_reminder_due source (D-446, D-451, COURSE-48)', () => {
  const due = sourceFor('course.live_reminder_due');
  const meta = { sinkAt: '2026-10-12T21:45:00.000000Z' };

  it('08.6-06 planning decision 5: the school off (read from tenant_modules in the fan-out transaction) → no intent, and no live read', async () => {
    const statements: string[] = [];
    expect(await due.resolve(fakeTx(statements, OFF), payload, meta)).toEqual([]);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('tenant_modules');
    expect(statements[0]).toContain("'courses'");
  });

  it('a live cancelled or moved since the job (the re-read finds nothing) → no intent, and no recipient read', async () => {
    const statements: string[] = [];
    expect(await due.resolve(fakeTx(statements, ON, []), payload, meta)).toEqual([]);
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain('cancelled_at is null');
    expect(statements[1]).toContain('starts_at = ');
  });

  it('EP-46: the definer answers no user → no intent', async () => {
    const statements: string[] = [];
    expect(await due.resolve(fakeTx(statements, ON, [liveRow], []), payload, meta)).toEqual([]);
    expect(statements).toHaveLength(3);
  });

  it('recipients come from app.course_live_reminder_user_ids(live, true), never a lane select of the own-row table', async () => {
    const statements: string[] = [];
    await due.resolve(fakeTx(statements, ON, [liveRow], [{ user_id: M }]), payload, meta);
    expect(statements[2]).toContain('app.course_live_reminder_user_ids(');
    expect(statements[2]).toContain('true');
    expect(statements.join('\n')).not.toContain('from course_live_reminders');
  });

  it('one actor-less in_app + push intent to the definer’s users, with the D-451 hint', async () => {
    const intents = await due.resolve(
      fakeTx([], ON, [liveRow], [{ user_id: M }, { user_id: H }]),
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
      fakeTx(
        [],
        ON,
        [{ ...liveRow, external_url: 'https://meet.example.com/sala' }],
        [{ user_id: M }],
      ),
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
      fakeTx([], ON, [{ ...liveRow, cover_asset_id: null, seconds_left: 5 }], [{ user_id: M }]),
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

describe('course.live_cancelled source (D-447, D-451, COURSE-42)', () => {
  const meta = { sinkAt: '2026-10-12T21:45:00.000000Z' };
  /** Cancelled at 18:30 São Paulo, half an hour before the 19:00 start. */
  const CANCELLED_AT = '2026-10-12T21:30:00.123456Z';
  const CANCELLED_EPOCH = Math.floor(Date.parse(CANCELLED_AT) / 1000);
  const cancelPayload = { tenantId: T, liveId: L, actorUserId: ADMIN, cancelledAt: CANCELLED_AT };
  const cancelledRow = {
    id: L,
    title: 'Tira-dúvidas',
    cover_asset_id: COVER,
    starts_at: STARTS_AT,
    timezone: 'America/Sao_Paulo',
    cancelled_at: CANCELLED_AT,
    ended_before_cancel: false,
  };
  const cancelled = () => sourceFor('course.live_cancelled');

  it('the school off → no intent, and no live read', async () => {
    const statements: string[] = [];
    expect(await cancelled().resolve(fakeTx(statements, OFF), cancelPayload, meta)).toEqual([]);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('tenant_modules');
  });

  it('a live that no longer exists → no intent, and no recipient read', async () => {
    const statements: string[] = [];
    expect(await cancelled().resolve(fakeTx(statements, ON, []), cancelPayload, meta)).toEqual([]);
    expect(statements).toHaveLength(2);
  });

  it('D-447: a live reactivated since the cancel (cancelled_at null) → no intent, and no recipient read', async () => {
    const statements: string[] = [];
    expect(
      await cancelled().resolve(
        fakeTx(statements, ON, [{ ...cancelledRow, cancelled_at: null }]),
        cancelPayload,
        meta,
      ),
    ).toEqual([]);
    expect(statements).toHaveLength(2);
  });

  it('R-A9: a live whose planned end was already past at the cancel → no intent, and no recipient read', async () => {
    const statements: string[] = [];
    expect(
      await cancelled().resolve(
        fakeTx(statements, ON, [{ ...cancelledRow, ended_before_cancel: true }]),
        cancelPayload,
        meta,
      ),
    ).toEqual([]);
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain('make_interval(mins => v.duration_min)');
  });

  it('EP-50: the definer answers no user → no intent', async () => {
    const statements: string[] = [];
    expect(
      await cancelled().resolve(fakeTx(statements, ON, [cancelledRow], []), cancelPayload, meta),
    ).toEqual([]);
    expect(statements).toHaveLength(3);
  });

  it('recipients come from app.course_live_reminder_user_ids(live, false): the opted-in, without an access check', async () => {
    const statements: string[] = [];
    await cancelled().resolve(
      fakeTx(statements, ON, [cancelledRow], [{ user_id: M }]),
      cancelPayload,
      meta,
    );
    expect(statements[2]).toContain('app.course_live_reminder_user_ids(');
    expect(statements[2]).toContain('false');
    expect(statements.join('\n')).not.toContain('from course_live_reminders');
  });

  it('one actor-less in_app + push intent to the definer’s users, opening the live page, deduped per cancel', async () => {
    const intents = await cancelled().resolve(
      fakeTx([], ON, [cancelledRow], [{ user_id: M }, { user_id: H }]),
      cancelPayload,
      meta,
    );
    const hex = L.replaceAll('-', '');
    expect(intents).toEqual([
      {
        kind: 'courses.live_cancelled',
        audience: { type: 'users', userIds: [M, H] },
        excludeUserIds: [ADMIN],
        dedupeKey: `courses.live_cancelled:${L}:${CANCELLED_EPOCH}`,
        subject: { type: 'live', id: L },
        object: null,
        actorUserId: null,
        facts: { liveId: L, title: 'Tira-dúvidas', startsAt: STARTS_AT, previewAssetId: COVER },
        channels: ['in_app', 'push'],
        push: {
          title: 'tenant',
          body: 'Live cancelada: Tira-dúvidas · seg., 12 de out. · 19:00',
          url: `/cursos/lives/${L}`,
          tag: `courses-live-cancelled-${hex}`,
          topic: hex,
          ttlSeconds: 86_400,
          urgency: 'normal',
          renotify: false,
        },
      },
    ]);
  });

  it('D-451: the facts key set, sorted, is exactly liveId, previewAssetId, startsAt, title', async () => {
    const [intent] = await cancelled().resolve(
      fakeTx(
        [],
        ON,
        [{ ...cancelledRow, external_url: 'https://meet.example.com/sala', description: 'x' }],
        [{ user_id: M }],
      ),
      cancelPayload,
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
});

describe('course.live_scheduled source (D-448, D-449, D-452, D-453, COURSE-46)', () => {
  const SINK_AT = '2026-10-12T21:40:00.000Z';
  const meta = { sinkAt: SINK_AT };
  const scheduledPayload = {
    tenantId: T,
    liveId: L,
    actorUserId: ADMIN,
    startsAt: STARTS_AT,
    reactivated: false,
  };
  const scheduledRow = {
    id: L,
    title: 'Tira-dúvidas',
    cover_asset_id: COVER,
    starts_at: STARTS_AT,
    timezone: 'America/Sao_Paulo',
  };
  const scheduled = () => sourceFor('course.live_scheduled');

  it('the school off → no intent, and no live read', async () => {
    const statements: string[] = [];
    expect(await scheduled().resolve(fakeTx(statements, OFF), scheduledPayload, meta)).toEqual([]);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('tenant_modules');
  });

  it('EP-60: a live cancelled, or whose start passed, before the fan-out (the re-read finds nothing) → no intent, and no audience read', async () => {
    const statements: string[] = [];
    expect(await scheduled().resolve(fakeTx(statements, ON, []), scheduledPayload, meta)).toEqual(
      [],
    );
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain('cancelled_at is null');
    expect(statements[1]).toContain('starts_at > now()');
  });

  it('EP-59: the definer answers no user → no intent', async () => {
    const statements: string[] = [];
    expect(
      await scheduled().resolve(fakeTx(statements, ON, [scheduledRow], []), scheduledPayload, meta),
    ).toEqual([]);
    expect(statements).toHaveLength(3);
  });

  it('D-449 / D-453: the audience is app.course_notice_user_ids() (members and support, with or without access)', async () => {
    const statements: string[] = [];
    await scheduled().resolve(
      fakeTx(statements, ON, [scheduledRow], [{ user_id: M }]),
      scheduledPayload,
      meta,
    );
    expect(statements[2]).toContain('app.course_notice_user_ids()');
  });

  it('a new live: one in_app + push intent with the actor, the actor excluded, deduped once per live, "Nova live: …"', async () => {
    const intents = await scheduled().resolve(
      fakeTx([], ON, [scheduledRow], [{ user_id: M }, { user_id: H }]),
      scheduledPayload,
      meta,
    );
    expect(intents).toEqual([
      {
        kind: 'courses.live_scheduled',
        audience: { type: 'users', userIds: [M, H] },
        excludeUserIds: [ADMIN],
        dedupeKey: `courses.live_scheduled:${L}`,
        subject: { type: 'live', id: L },
        object: null,
        actorUserId: ADMIN,
        facts: {
          liveId: L,
          title: 'Tira-dúvidas',
          startsAt: STARTS_AT,
          previewAssetId: COVER,
          reactivated: false,
        },
        channels: ['in_app', 'push'],
        push: {
          title: 'tenant',
          body: 'Nova live: Tira-dúvidas · seg., 12 de out. · 19:00',
          url: `/cursos/lives/${L}`,
          tag: 'courses-live-scheduled',
          topic: 'courses-live-scheduled',
          ttlSeconds: 86_400,
          urgency: 'normal',
          renotify: false,
        },
      },
    ]);
  });

  it('D-452: a reactivated live → the dedupe key carries meta.sinkAt and the push says "Live reativada: …"', async () => {
    const [intent] = await scheduled().resolve(
      fakeTx([], ON, [scheduledRow], [{ user_id: M }]),
      { ...scheduledPayload, reactivated: true },
      meta,
    );
    expect(intent?.dedupeKey).toBe(`courses.live_scheduled:${L}:${SINK_AT}`);
    expect(intent?.push?.body).toBe('Live reativada: Tira-dúvidas · seg., 12 de out. · 19:00');
    expect(intent?.facts.reactivated).toBe(true);
  });

  it('D-451: the facts key set, sorted, is exactly liveId, previewAssetId, reactivated, startsAt, title', async () => {
    const [intent] = await scheduled().resolve(
      fakeTx(
        [],
        ON,
        [{ ...scheduledRow, external_url: 'https://meet.example.com/sala', description: 'x' }],
        [{ user_id: M }],
      ),
      scheduledPayload,
      meta,
    );
    expect(Object.keys(intent?.facts ?? {}).sort()).toEqual([
      'liveId',
      'previewAssetId',
      'reactivated',
      'startsAt',
      'title',
    ]);
    expect(JSON.stringify(intent)).not.toContain('meet.example.com');
  });
});

describe('course.replay_available source (D-448, D-433, D-449, COURSE-47)', () => {
  const LESSON = '99999999-9999-4999-8999-999999999999';
  const meta = { sinkAt: '2026-10-13T12:00:00.000Z' };
  const replayPayload = { tenantId: T, liveId: L, lessonId: LESSON, actorUserId: ADMIN };
  const replayRow = { id: L, title: 'Tira-dúvidas', cover_asset_id: COVER };
  const replay = () => sourceFor('course.replay_available');

  it('the school off → no intent, and no live read', async () => {
    const statements: string[] = [];
    expect(await replay().resolve(fakeTx(statements, OFF), replayPayload, meta)).toEqual([]);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('tenant_modules');
  });

  it('the replay lesson changed (or the live was cancelled) since the write → no intent, and no audience read', async () => {
    const statements: string[] = [];
    expect(await replay().resolve(fakeTx(statements, ON, []), replayPayload, meta)).toEqual([]);
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain('replay_lesson_id = ');
    expect(statements[1]).toContain('cancelled_at is null');
  });

  it('EP-61: the two-door definer answers no user → no intent', async () => {
    const statements: string[] = [];
    expect(
      await replay().resolve(fakeTx(statements, ON, [replayRow], []), replayPayload, meta),
    ).toEqual([]);
    expect(statements).toHaveLength(3);
  });

  it('T-08.6-03: the audience is app.live_replay_audience_user_ids(live) (the two doors of D-433)', async () => {
    const statements: string[] = [];
    await replay().resolve(
      fakeTx(statements, ON, [replayRow], [{ user_id: M }]),
      replayPayload,
      meta,
    );
    expect(statements[2]).toContain('app.live_replay_audience_user_ids(');
  });

  it('one actor-less in_app + push intent naming the live, deduped per live and lesson, "Gravação disponível: …"', async () => {
    const intents = await replay().resolve(
      fakeTx([], ON, [replayRow], [{ user_id: M }, { user_id: H }]),
      replayPayload,
      meta,
    );
    expect(intents).toEqual([
      {
        kind: 'courses.replay_available',
        audience: { type: 'users', userIds: [M, H] },
        excludeUserIds: [ADMIN],
        dedupeKey: `courses.replay_available:${L}:${LESSON}`,
        subject: { type: 'live', id: L },
        object: null,
        actorUserId: null,
        facts: { liveId: L, title: 'Tira-dúvidas', previewAssetId: COVER },
        channels: ['in_app', 'push'],
        push: {
          title: 'tenant',
          body: 'Gravação disponível: Tira-dúvidas',
          url: `/cursos/lives/${L}`,
          tag: 'courses-replay',
          topic: 'courses-replay',
          ttlSeconds: 86_400,
          urgency: 'normal',
          renotify: false,
        },
      },
    ]);
  });

  it('EP-62: the facts key set, sorted, is exactly liveId, previewAssetId, title — never the lesson — and an emoji title round-trips byte-identical', async () => {
    const title = 'Aula "ao vivo" de revisão — ação 🎬';
    const [intent] = await replay().resolve(
      fakeTx(
        [],
        ON,
        [{ ...replayRow, title, lesson_title: 'Segredo da aula', replay_lesson_id: LESSON }],
        [{ user_id: M }],
      ),
      replayPayload,
      meta,
    );
    expect(Object.keys(intent?.facts ?? {}).sort()).toEqual(['liveId', 'previewAssetId', 'title']);
    expect(intent?.facts.title).toBe(title);
    expect(JSON.stringify(intent?.facts)).not.toContain(LESSON);
    expect(JSON.stringify(intent)).not.toContain('Segredo da aula');
  });
});
