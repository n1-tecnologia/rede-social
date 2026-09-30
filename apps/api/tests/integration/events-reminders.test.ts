import type { EventSummary } from '@rede-social/module-events/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  type EventReminderJobRow,
  eventReminderJobsOf,
  HOSTS,
  notificationJobsOf,
  runEventReminderJobs,
  runNotificationJobs,
  SEED_PASSWORD,
  signInAs,
} from './setup';

/**
 * EVENT-07 end to end against the live local stack and the real seed (07-05, RESEARCH Pattern 8,
 * Pitfall 14): the `events.reminder` jobs armed INSIDE the events module's own write transactions,
 * read back from the real pg-boss job table, and played through the real `runEventReminder` with an
 * injected fire-time clock (`runEventReminderJobs`), then through the real notification fan-out.
 *
 * What is proved here:
 *  - arming: a start 25 h away arms two jobs with the exact `start_after` and singleton keys; 2 h
 *    away only the 1 h job; 30 minutes away none (never late);
 *  - a moved start arms two NEW keys, the OLD 24 h job fired at its time emits nothing, the new one
 *    emits;
 *  - a cancel makes a waiting job a no-op, and a reactivation re-arms (the `short` policy keeps a
 *    still-waiting job for the same start) and fires;
 *  - the audience is the `Vou` list read at fire time: A (`going`) gets exactly one
 *    `events.reminder_24h` row, B (`not_going`) and C (no answer) nothing; running both again adds
 *    nothing; A blocked before the 1 h job gets no 1 h row;
 *  - a worker 31 minutes late sends nothing.
 *
 * Every event this file writes carries `TEST_TITLE_PREFIX`; both hooks sweep those events, their
 * reminder jobs and the notification rows about them, and close any `events.reminder` or
 * `notifications.fanout` job other files left waiting, so the counts here are exact. Test ORDER is
 * load-bearing (`fileParallelism: false`, declaration order).
 */

const TEST_TITLE_PREFIX = 'Lembrete de teste';
const TZ = 'America/Sao_Paulo';
const HOUR = 3_600_000;
const MINUTE = 60_000;

const tokens = { admin: '', a: '', b: '', c: '' };
const ids = { demo: '', a: '', b: '', c: '' };
const created: string[] = [];

const request = (path: string, token?: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': HOSTS.demo,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

/** The tenant-local `{ date, time }` wall clock of an instant (the form's own input shape). */
function wallClock(ms: number): { date: string; time: string } {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
  return { date, time };
}

/** An online event whose start is `offsetMs` from now (to the minute), two hours long. */
function body(suffix: string, startMs: number) {
  return {
    title: `${TEST_TITLE_PREFIX} ${suffix}`,
    description: '',
    format: 'online' as const,
    meetingUrl: 'https://meet.example.test/lembrete',
    start: wallClock(startMs),
    end: wallClock(startMs + 2 * HOUR),
  };
}

async function createIn(suffix: string, offsetMs: number): Promise<EventSummary> {
  const res = await request('/v1/events', tokens.admin, {
    method: 'POST',
    body: JSON.stringify(body(suffix, Date.now() + offsetMs)),
  });
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  const event = (await res.json()) as EventSummary;
  created.push(event.id);
  return event;
}

const jobsFor = async (eventId: string): Promise<EventReminderJobRow[]> =>
  (await eventReminderJobsOf(ids.demo)).filter((job) => job.data.eventId === eventId);

const waiting = async (eventId: string) =>
  (await jobsFor(eventId)).filter((job) => job.state === 'created');

const fireAt = (startsAt: string, window: '24h' | '1h') =>
  Date.parse(startsAt) - (window === '24h' ? 24 * HOUR : HOUR);

/** Runs `eventId`'s waiting jobs of one window (and, optionally, one armed start) at `nowMs`. */
function runWindow(eventId: string, window: '24h' | '1h', nowMs: number, startsAt?: string) {
  return runEventReminderJobs(
    ids.demo,
    nowMs,
    (job) =>
      job.data.eventId === eventId &&
      job.data.window === window &&
      (startsAt === undefined || job.data.startsAt === startsAt),
  );
}

async function rsvp(token: string, eventId: string, answer: 'going' | 'not_going') {
  const res = await request(`/v1/events/${eventId}/rsvp`, token, {
    method: 'PUT',
    body: JSON.stringify({ answer }),
  });
  expect(res.status).toBe(200);
}

async function reminderRows(eventId: string, kind: string) {
  return adminSql<{ user_id: string; dedupe_key: string; actor_user_id: string | null }[]>`
    select user_id::text as user_id, dedupe_key, actor_user_id::text as actor_user_id
      from public.notifications
     where tenant_id = ${ids.demo}::uuid and subject_id = ${eventId}::uuid and kind = ${kind}
     order by user_id`;
}

/** Closes the fan-out jobs other steps left waiting (event.published, …), not the reminders. */
async function closeFanouts(): Promise<void> {
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name = 'notifications.fanout' and state = 'created'`;
}

async function closeWaiting(): Promise<void> {
  await adminSql`
    update pgboss.job_common set state = 'completed', completed_on = now()
     where name in ('events.reminder', 'notifications.fanout') and state = 'created'`;
}

async function sweep(): Promise<void> {
  const rows = await adminSql<{ id: string }[]>`
    select id::text as id from public.events where title like ${`${TEST_TITLE_PREFIX}%`}`;
  const eventIds = rows.map((row) => row.id);
  if (eventIds.length > 0) {
    await adminSql`delete from public.notifications where subject_id = any(${eventIds}::uuid[])`;
    await adminSql`
      delete from pgboss.job_common
       where name = 'events.reminder' and data->>'eventId' = any(${eventIds}::text[])`;
  }
  await adminSql`delete from public.events where title like ${`${TEST_TITLE_PREFIX}%`}`;
  await closeWaiting();
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  const [tenant] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  ids.demo = tenant?.id ?? '';
  tokens.admin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  // Three live demo members other than the shared `member@` account (A is blocked in one case).
  const members = await adminSql<{ email: string; id: string }[]>`
    select u.email, u.id::text as id from public.users u
      join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${ids.demo}::uuid and m.role = 'member' and m.status = 'active'
       and m.blocked_at is null and m.deleted_at is null
       and u.email <> 'member@rede-demo.local' and u.email not like '%removid%'
     order by u.email limit 3`;
  if (members.length < 3) throw new Error('the seed must provide three more demo members');
  const [a, b, c] = members as unknown as [
    { email: string; id: string },
    { email: string; id: string },
    { email: string; id: string },
  ];
  ids.a = a.id;
  ids.b = b.id;
  ids.c = c.id;
  tokens.a = await signInAs(a.email, SEED_PASSWORD);
  tokens.b = await signInAs(b.email, SEED_PASSWORD);
  tokens.c = await signInAs(c.email, SEED_PASSWORD);
  await sweep();
});

afterAll(async () => {
  await adminSql`
    update public.memberships set blocked_at = null
     where tenant_id = ${ids.demo}::uuid and user_id = ${ids.a}::uuid`;
  await sweep();
});

describe('events-reminders: arming in the write transaction', () => {
  it('25 h away arms both windows with the exact start_after and singleton keys', async () => {
    const event = await createIn('25h', 25 * HOUR);
    const jobs = await jobsFor(event.id);
    expect(jobs.map((job) => job.data.window).sort()).toEqual(['1h', '24h']);
    const seconds = Math.floor(Date.parse(event.startsAt) / 1000);
    for (const job of jobs) {
      expect(job.state).toBe('created');
      expect(job.data).toEqual({
        tenantId: ids.demo,
        eventId: event.id,
        window: job.data.window,
        startsAt: event.startsAt,
      });
      expect(job.singleton_key).toBe(`${event.id}:${job.data.window}:${seconds}`);
      expect(job.start_after.getTime()).toBe(fireAt(event.startsAt, job.data.window));
    }
  });

  it('2 h away arms only the 1 h job; 30 minutes away arms none (never late)', async () => {
    const soon = await createIn('2h', 2 * HOUR);
    expect((await jobsFor(soon.id)).map((job) => job.data.window)).toEqual(['1h']);
    const sooner = await createIn('30min', 30 * MINUTE);
    expect(await jobsFor(sooner.id)).toEqual([]);
  });
});

describe('events-reminders: the job follows moves and skips cancels', () => {
  it('a moved start arms two NEW keys; the old 24 h job is a no-op and the new one emits', async () => {
    const event = await createIn('mover', 30 * HOUR);
    const moved = Date.parse(event.startsAt) + 3 * HOUR;
    const res = await request(`/v1/events/${event.id}`, tokens.admin, {
      method: 'PUT',
      body: JSON.stringify(body('mover', moved)),
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as EventSummary;
    expect(after.startsAt).not.toBe(event.startsAt);

    const keys = (await waiting(event.id)).map((job) => job.singleton_key);
    expect(keys).toHaveLength(4);
    const newSeconds = Math.floor(Date.parse(after.startsAt) / 1000);
    expect(keys).toContain(`${event.id}:24h:${newSeconds}`);
    expect(keys).toContain(`${event.id}:1h:${newSeconds}`);

    expect(await runWindow(event.id, '24h', fireAt(event.startsAt, '24h'), event.startsAt)).toEqual(
      ['skipped'],
    );
    expect(await runWindow(event.id, '24h', fireAt(after.startsAt, '24h'), after.startsAt)).toEqual(
      ['emitted'],
    );
  });

  it('cancelled: a waiting job does nothing; reactivated: re-armed and fires', async () => {
    const event = await createIn('cancelar', 30 * HOUR);
    const patch = (status: 'cancelled' | 'active') =>
      request(`/v1/events/${event.id}`, tokens.admin, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    expect((await patch('cancelled')).status).toBe(200);
    expect(await runWindow(event.id, '24h', fireAt(event.startsAt, '24h'))).toEqual(['skipped']);

    expect((await patch('active')).status).toBe(200);
    // The 24 h job ran (completed), so its key is re-armed; the 1 h job still waited with the SAME
    // key, so the `short` policy kept exactly that one.
    const again = await waiting(event.id);
    expect(again.map((job) => job.data.window).sort()).toEqual(['1h', '24h']);
    expect(await runWindow(event.id, '24h', fireAt(event.startsAt, '24h'))).toEqual(['emitted']);
  });

  it('a worker 31 minutes late sends nothing, and enqueues no fan-out', async () => {
    const event = await createIn('atrasado', 26 * HOUR);
    await closeFanouts();
    const before = (await notificationJobsOf(ids.demo)).length;
    expect(await runWindow(event.id, '24h', fireAt(event.startsAt, '24h') + 31 * MINUTE)).toEqual([
      'skipped',
    ]);
    expect((await notificationJobsOf(ids.demo)).length).toBe(before);
  });
});

describe('events-reminders: the audience is the Vou list, once per window', () => {
  it('A (going) gets ONE 24 h row; B (not going) and C (no answer) none; A blocked gets no 1 h row', async () => {
    const event = await createIn('publico', 27 * HOUR);
    await rsvp(tokens.a, event.id, 'going');
    await rsvp(tokens.b, event.id, 'not_going');
    await closeFanouts();

    const fire24 = fireAt(event.startsAt, '24h');
    expect(await runWindow(event.id, '24h', fire24)).toEqual(['emitted']);
    expect(await runNotificationJobs(ids.demo)).toBe(1);
    const rows = await reminderRows(event.id, 'events.reminder_24h');
    expect(rows).toEqual([
      { user_id: ids.a, dedupe_key: `events.reminder_24h:${event.id}`, actor_user_id: null },
    ]);

    // Running the same reminder again (a retry, or a re-arm of the same window) adds nothing.
    const { runEventReminder } = await import('@rede-social/module-events/server');
    const payload = {
      tenantId: ids.demo,
      eventId: event.id,
      window: '24h',
      startsAt: event.startsAt,
    };
    expect(await runEventReminder(payload, fire24)).toBe('emitted');
    await runNotificationJobs(ids.demo);
    expect(await reminderRows(event.id, 'events.reminder_24h')).toHaveLength(1);

    // A is blocked before the 1 h job: nobody live said Vou, so no 1 h row at all.
    try {
      await adminSql`
        update public.memberships set blocked_at = now()
         where tenant_id = ${ids.demo}::uuid and user_id = ${ids.a}::uuid`;
      expect(await runWindow(event.id, '1h', fireAt(event.startsAt, '1h'))).toEqual(['emitted']);
      await runNotificationJobs(ids.demo);
      expect(await reminderRows(event.id, 'events.reminder_1h')).toEqual([]);
    } finally {
      await adminSql`
        update public.memberships set blocked_at = null
         where tenant_id = ${ids.demo}::uuid and user_id = ${ids.a}::uuid`;
    }
    // Neither B nor C ever got a reminder of either window.
    for (const kind of ['events.reminder_24h', 'events.reminder_1h']) {
      const users = (await reminderRows(event.id, kind)).map((row) => row.user_id);
      expect(users).not.toContain(ids.b);
      expect(users).not.toContain(ids.c);
    }
  });

  it('the member reads the reminder through the list, actor-less, with title and instant facts', async () => {
    const event = await createIn('lista', 28 * HOUR);
    await rsvp(tokens.c, event.id, 'going');
    await closeFanouts();
    expect(await runWindow(event.id, '1h', fireAt(event.startsAt, '1h'))).toEqual(['emitted']);
    await runNotificationJobs(ids.demo);
    const res = await request('/v1/notifications?section=unread&limit=50', tokens.c);
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      items: {
        kind: string;
        actor: unknown;
        subject: { id: string };
        facts: Record<string, unknown>;
      }[];
    };
    const mine = page.items.filter((row) => row.subject.id === event.id);
    expect(mine.map((row) => row.kind)).toEqual(['events.reminder_1h']);
    expect(mine[0]?.actor).toBeNull();
    expect(mine[0]?.facts).toEqual({
      eventId: event.id,
      title: `${TEST_TITLE_PREFIX} lista`,
      startsAt: event.startsAt,
    });
  });
});
