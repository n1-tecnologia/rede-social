import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATIONS_QUEUES,
  PUSH_MAX_ATTEMPTS,
  PUSH_SEND_JOB_CONCURRENCY,
  PUSH_SEND_JOB_KEEP,
  PUSH_SEND_PARALLELISM,
  type PushSendJob,
} from '../contracts/index';

/**
 * quick 261006-fs9: the push send job's bounded-parallel send, with no database and no network.
 *
 * The lane, the enqueue, the counters resolver and the logger are mocked at the module boundary; the
 * transport is the REAL fake transport (outbox and status mapping) behind a wrapper that counts the
 * sends in flight. Every job gets its own tenant id, so a lane, a count and a send are attributable to
 * the job that opened it.
 *
 * - 5,000 subscriptions over 50 jobs, run `PUSH_SEND_JOB_CONCURRENCY` at a time (as the worker does):
 *   each sent once, outcomes reported exactly, the retry ids re-enqueued exactly, the log totals match.
 * - One job alone never holds more than ONE lane at a time (step 1, every flags-miss lane, every
 *   counters lane and the report lane are strictly sequential): the worker pool-fit proof.
 */

type Row = {
  id: string;
  user_id: string;
  role: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};
type Enqueued = { name: string; payload: PushSendJob; opts: Record<string, unknown> };

const h = vi.hoisted(() => {
  const macrotask = () => new Promise<void>((resolve) => setImmediate(resolve));
  const state = {
    /** Lanes open right now, overall and per tenant (= per job), and their maxima. */
    open: 0,
    maxOpen: 0,
    openByTenant: new Map<string, number>(),
    maxOpenByTenant: new Map<string, number>(),
    /** The fake tx's router, set once the dialect exists (module scope, below). */
    execute: null as null | ((ctx: RequestContext, query: unknown) => Promise<unknown[]>),
    enqueued: [] as { name: string; payload: unknown; opts: Record<string, unknown> }[],
    /** resolveCounters bookkeeping. */
    countersCalls: 0,
    countersPendingByTenant: new Map<string, number>(),
    countersMaxPendingByTenant: new Map<string, number>(),
    countersLaneViolations: 0,
    countersFail: false,
    userIndex: new Map<string, number>(),
    /** Send bookkeeping. */
    sendsInFlight: 0,
    maxSendsInFlight: 0,
    sendInFlightByTenant: new Map<string, number>(),
    maxSendInFlightByTenant: new Map<string, number>(),
    sendWhileCountersPending: 0,
    tenantOfEndpoint: new Map<string, string>(),
    throwEndpoints: new Set<string>(),
  };

  const bump = (map: Map<string, number>, max: Map<string, number>, key: string, by: number) => {
    const value = (map.get(key) ?? 0) + by;
    map.set(key, value);
    if (value > (max.get(key) ?? 0)) max.set(key, value);
  };

  async function lane<T>(ctx: RequestContext, fn: (tx: unknown) => Promise<T>): Promise<T> {
    state.open += 1;
    state.maxOpen = Math.max(state.maxOpen, state.open);
    bump(state.openByTenant, state.maxOpenByTenant, ctx.tenantId, 1);
    try {
      await macrotask();
      const tx = {
        execute: (query: unknown) => {
          if (!state.execute) throw new Error('router not set');
          return state.execute(ctx, query);
        },
      };
      return await fn(tx);
    } finally {
      state.open -= 1;
      bump(state.openByTenant, state.maxOpenByTenant, ctx.tenantId, -1);
    }
  }

  /** The real resolver's shape: flags-miss lane, released, then the counters lane. */
  async function resolveCounters(ctx: RequestContext) {
    state.countersCalls += 1;
    if ((state.openByTenant.get(ctx.tenantId) ?? 0) !== 0) state.countersLaneViolations += 1;
    bump(state.countersPendingByTenant, state.countersMaxPendingByTenant, ctx.tenantId, 1);
    try {
      if (state.countersFail) throw new Error('counters down');
      await lane(ctx, async () => undefined); // moduleFlags.flags cache miss
      await lane(ctx, async () => undefined); // countersFor in its own lane
      const i = state.userIndex.get(ctx.userId) ?? 0;
      return {
        unreadNotifications: i % 7,
        unreadConversations: i % 2,
        conversationsBadge: 'count' as const,
      };
    } finally {
      bump(state.countersPendingByTenant, state.countersMaxPendingByTenant, ctx.tenantId, -1);
    }
  }

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  return { state, lane, resolveCounters, logger, macrotask, bump };
});

vi.mock('@rede-social/core/db/tenant-tx', () => ({ withTenantTx: h.lane }));
vi.mock('@rede-social/core/server/jobs/boss', () => ({
  enqueueInTx: async (
    _tx: unknown,
    name: string,
    payload: unknown,
    opts: Record<string, unknown>,
  ) => {
    h.state.enqueued.push({ name, payload, opts });
    return `job-${h.state.enqueued.length}`;
  },
}));
vi.mock('@rede-social/core/server/modules/counters', () => ({
  resolveCounters: h.resolveCounters,
}));
vi.mock('@rede-social/core/server/logging', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  moduleLogger: () => h.logger,
}));
vi.mock('../server/push/transport', async (importOriginal) => {
  const real = (await importOriginal()) as typeof import('../server/push/transport');
  const wrapper: import('../server/push/transport').PushTransport = {
    async send(target, payload, opts) {
      const { state, bump, macrotask } = h;
      const tenant = state.tenantOfEndpoint.get(target.endpoint) ?? 'unknown';
      if ((state.countersPendingByTenant.get(tenant) ?? 0) > 0) state.sendWhileCountersPending += 1;
      state.sendsInFlight += 1;
      state.maxSendsInFlight = Math.max(state.maxSendsInFlight, state.sendsInFlight);
      bump(state.sendInFlightByTenant, state.maxSendInFlightByTenant, tenant, 1);
      try {
        await macrotask();
        if (state.throwEndpoints.has(target.endpoint)) throw new Error('socket hang up');
        return await real.fakePushTransport.send(target, payload, opts);
      } finally {
        state.sendsInFlight -= 1;
        bump(state.sendInFlightByTenant, state.maxSendInFlightByTenant, tenant, -1);
      }
    },
  };
  return { ...real, pushTransport: () => wrapper };
});

const { runPushSend, pushSendJob } = await import('../server/push/send-job');
const { fakePushOutbox, resetFakePushOutbox } = await import('../server/push/transport');

/* ── the fake database ─────────────────────────────────────────────────────────────────────────── */

const dialect = new PgDialect();
/** userId → that user's subscription rows, in generation order. */
const rowsByUser = new Map<string, Row[]>();
/** [tenantId, subscriptionId, outcome] for every report call, in call order. */
const reports: { tenantId: string; id: string; outcome: string }[] = [];

const parseUuidArray = (value: unknown) =>
  String(value)
    .replace(/^\{|\}$/g, '')
    .split(',')
    .filter(Boolean);

h.state.execute = async (ctx, query) => {
  const { sql, params } = dialect.sqlToQuery(query as SQL);
  if (sql.includes('app.notifications_withdrawn')) return [{ withdrawn: false }];
  if (sql.includes('app.push_subscriptions_delete_dead')) return [];
  if (sql.includes('app.push_subscriptions_for')) {
    return parseUuidArray(params[0]).flatMap((userId) => rowsByUser.get(userId) ?? []);
  }
  if (sql.includes('public.tenants')) return [{ display_name: 'Rede Demo', branding: {} }];
  if (sql.includes('app.push_subscription_report')) {
    reports.push({ tenantId: ctx.tenantId, id: String(params[0]), outcome: String(params[1]) });
    return [];
  }
  throw new Error(`unexpected sql: ${sql}`);
};

/* ── data ──────────────────────────────────────────────────────────────────────────────────────── */

const HINT: PushSendJob['push'] = {
  title: 'tenant',
  body: 'Nova publicação na comunidade',
  url: '/feed',
  tag: 'feed-post',
  topic: 'feed',
  ttlSeconds: 3600,
  urgency: 'normal',
  renotify: false,
};

/** The status an endpoint `n` answers (the 5,000 run's matrix). */
const statusFor = (n: number) =>
  n % 20 === 0 ? 410 : n % 25 === 1 ? 503 : n % 100 === 2 ? 400 : 201;
const REPORT_FOR: Record<number, string> = {
  201: 'sent',
  410: 'gone',
  400: 'failed',
  503: 'failed',
};

let serial = 0;

/** One job over `users` users with `perUser` subscriptions each; `status(n)` picks each endpoint. */
function makeJob(users: number, perUser: number, status: (n: number) => number, attempt = 0) {
  const tenantId = randomUUID();
  const userIds: string[] = [];
  const rows: Row[] = [];
  for (let u = 0; u < users; u += 1) {
    const userId = randomUUID();
    userIds.push(userId);
    const userRows: Row[] = [];
    for (let s = 0; s < perUser; s += 1) {
      const n = serial;
      serial += 1;
      const endpoint = `https://push.fake.test/status/${status(n)}/sub-${n}`;
      h.state.tenantOfEndpoint.set(endpoint, tenantId);
      userRows.push({
        id: randomUUID(),
        user_id: userId,
        role: 'member',
        endpoint,
        p256dh: `p256dh-${n}`,
        auth: `auth-${n}`,
      });
    }
    h.state.userIndex.set(userId, h.state.userIndex.size);
    rowsByUser.set(userId, userRows);
    rows.push(...userRows);
  }
  const job: PushSendJob = {
    tenantId,
    kind: 'feed.post_published',
    dedupeKey: `feed.post_published:${tenantId}`,
    userIds,
    push: HINT,
    attempt,
  };
  return {
    job,
    rows,
    statusOf: (row: Row) => Number(/\/status\/(\d{3})\//.exec(row.endpoint)?.[1]),
  };
}

const expectedBadge = (userId: string) => {
  const i = h.state.userIndex.get(userId) ?? -1;
  return (i % 7) + (i % 2);
};

const pushSentLogs = () =>
  h.logger.info.mock.calls
    .map(([fields]) => fields as Record<string, unknown>)
    .filter((fields) => fields?.event === 'push.sent');

beforeEach(() => {
  const { state } = h;
  state.open = 0;
  state.maxOpen = 0;
  state.openByTenant.clear();
  state.maxOpenByTenant.clear();
  state.enqueued.length = 0;
  state.countersCalls = 0;
  state.countersPendingByTenant.clear();
  state.countersMaxPendingByTenant.clear();
  state.countersLaneViolations = 0;
  state.countersFail = false;
  state.sendsInFlight = 0;
  state.maxSendsInFlight = 0;
  state.sendInFlightByTenant.clear();
  state.maxSendInFlightByTenant.clear();
  state.sendWhileCountersPending = 0;
  state.throwEndpoints.clear();
  reports.length = 0;
  resetFakePushOutbox();
  h.logger.info.mockClear();
  h.logger.warn.mockClear();
  h.logger.error.mockClear();
});

describe('notifications.push-send, bounded-parallel send', () => {
  it('is the notifications.push-send job definition, run PUSH_SEND_JOB_CONCURRENCY at a time', () => {
    expect(pushSendJob.name).toBe(NOTIFICATIONS_QUEUES.pushSend);
    expect(pushSendJob.concurrency).toBe(PUSH_SEND_JOB_CONCURRENCY);
  });

  it('5_000 subscriptions over 50 jobs, 4 at a time: each sent once, outcomes and retries exact', async () => {
    const jobs = Array.from({ length: 50 }, () => makeJob(100, 1, statusFor));
    const allRows = jobs.flatMap((j) => j.rows);
    expect(allRows).toHaveLength(5_000);

    for (let w = 0; w < jobs.length; w += PUSH_SEND_JOB_CONCURRENCY) {
      await Promise.all(
        jobs.slice(w, w + PUSH_SEND_JOB_CONCURRENCY).map(({ job }) => runPushSend(job)),
      );
    }

    // Each endpoint sent exactly once.
    const outbox = fakePushOutbox();
    expect(outbox).toHaveLength(5_000);
    const sentEndpoints = new Set(outbox.map((entry) => entry.endpoint));
    expect(sentEndpoints.size).toBe(5_000);
    expect(sentEndpoints).toEqual(new Set(allRows.map((row) => row.endpoint)));

    // Every payload's badge is that recipient's own mocked counters.
    const ownerOf = new Map(allRows.map((row) => [row.endpoint, row.user_id]));
    for (const entry of outbox) {
      const owner = ownerOf.get(entry.endpoint) ?? '';
      expect(JSON.parse(entry.payload).badge).toBe(expectedBadge(owner));
    }

    // 5,000 reports, each id once, with the outcome its status maps to, in subscription order per job.
    expect(reports).toHaveLength(5_000);
    expect(new Set(reports.map((r) => r.id)).size).toBe(5_000);
    const outcomeById = new Map(reports.map((r) => [r.id, r.outcome]));
    for (const { job, rows, statusOf } of jobs) {
      for (const row of rows) {
        expect(outcomeById.get(row.id)).toBe(REPORT_FOR[statusOf(row)]);
      }
      expect(reports.filter((r) => r.tenantId === job.tenantId).map((r) => r.id)).toEqual(
        rows.map((row) => row.id),
      );
    }

    // Exactly one re-enqueue per job with a 503, carrying exactly its 503 ids.
    const jobsWith503 = jobs.filter(({ rows, statusOf }) => rows.some((r) => statusOf(r) === 503));
    expect(h.state.enqueued).toHaveLength(jobsWith503.length);
    for (const { job, rows, statusOf } of jobsWith503) {
      const mine = (h.state.enqueued as Enqueued[]).filter(
        (e) => e.payload.tenantId === job.tenantId,
      );
      expect(mine).toHaveLength(1);
      const [enqueued] = mine;
      const retryRows = rows.filter((r) => statusOf(r) === 503);
      expect(enqueued?.name).toBe(NOTIFICATIONS_QUEUES.pushSend);
      expect(enqueued?.payload.subscriptionIds).toEqual(retryRows.map((r) => r.id));
      expect(enqueued?.payload.attempt).toBe(1);
      expect(new Set(enqueued?.payload.userIds)).toEqual(new Set(retryRows.map((r) => r.user_id)));
      expect(enqueued?.opts.startAfter).toBe(30);
      expect(String(enqueued?.opts.singletonKey)).toMatch(
        new RegExp(`^push:${job.dedupeKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:retry:1:`),
      );
      expect(enqueued?.opts).toMatchObject(PUSH_SEND_JOB_KEEP);
    }

    // The push.sent totals match the endpoint matrix.
    const statusOfRow = jobs[0]?.statusOf ?? (() => 0);
    const statuses = allRows.map((row) => statusOfRow(row));
    const expected = {
      sent: statuses.filter((s) => s === 201).length,
      gone: statuses.filter((s) => s === 410).length,
      dropped: statuses.filter((s) => s === 400).length,
      retried: statuses.filter((s) => s === 503).length,
    };
    const logs = pushSentLogs();
    expect(logs).toHaveLength(50);
    const totals = { sent: 0, gone: 0, dropped: 0, retried: 0 };
    for (const fields of logs) {
      expect(Object.keys(fields).sort()).toEqual(
        ['dropped', 'event', 'gone', 'kind', 'retried', 'sent'].sort(),
      );
      totals.sent += Number(fields.sent);
      totals.gone += Number(fields.gone);
      totals.dropped += Number(fields.dropped);
      totals.retried += Number(fields.retried);
    }
    expect(totals).toEqual(expected);
    expect(expected.sent + expected.gone + expected.dropped + expected.retried).toBe(5_000);

    // push.dropped carries the shape only.
    const dropped = h.logger.warn.mock.calls
      .map(([fields]) => fields as Record<string, unknown>)
      .filter((fields) => fields?.event === 'push.dropped');
    expect(dropped.length).toBeGreaterThan(0);
    for (const fields of dropped) {
      expect(Object.keys(fields).sort()).toEqual(['dropped', 'event', 'kind']);
    }
    expect(h.logger.error).not.toHaveBeenCalled();

    // One count per distinct recipient per job, none inside a lane of its own job.
    expect(h.state.countersCalls).toBe(5_000);
    expect(h.state.countersLaneViolations).toBe(0);
    expect(h.state.sendWhileCountersPending).toBe(0);

    // Ceilings.
    expect(h.state.maxSendsInFlight).toBeLessThanOrEqual(
      PUSH_SEND_JOB_CONCURRENCY * PUSH_SEND_PARALLELISM,
    );
    expect(h.state.maxSendsInFlight).toBeGreaterThan(PUSH_SEND_PARALLELISM);
    expect(h.state.maxOpen).toBeLessThanOrEqual(PUSH_SEND_JOB_CONCURRENCY);
    for (const max of h.state.maxOpenByTenant.values()) expect(max).toBe(1);
    for (const max of h.state.maxSendInFlightByTenant.values()) {
      expect(max).toBeLessThanOrEqual(PUSH_SEND_PARALLELISM);
    }
  });

  it('one job alone holds at most ONE lane at a time and sends in parallel only after every count', async () => {
    const { job, rows } = makeJob(100, 3, () => 201);
    await runPushSend(job);

    expect(fakePushOutbox()).toHaveLength(300);
    expect(reports.filter((r) => r.outcome === 'sent')).toHaveLength(300);
    expect(reports.map((r) => r.id)).toEqual(rows.map((row) => row.id));
    expect(h.state.enqueued).toHaveLength(0);

    expect(h.state.maxSendsInFlight).toBeGreaterThan(1);
    expect(h.state.maxSendsInFlight).toBeLessThanOrEqual(PUSH_SEND_PARALLELISM);
    // Step 1, 100 flags lanes, 100 counters lanes and the report lane: never two at once.
    expect(h.state.maxOpen).toBe(1);
    expect(h.state.maxOpenByTenant.get(job.tenantId)).toBe(1);
    expect(h.state.countersCalls).toBe(100);
    expect(h.state.countersMaxPendingByTenant.get(job.tenantId)).toBe(1);
    expect(h.state.countersLaneViolations).toBe(0);
    expect(h.state.sendWhileCountersPending).toBe(0);
  });

  it(`at attempt PUSH_MAX_ATTEMPTS (${PUSH_MAX_ATTEMPTS}) the 503s are not re-enqueued and retried is 0`, async () => {
    const { job } = makeJob(10, 1, (n) => (n % 2 === 0 ? 503 : 201), PUSH_MAX_ATTEMPTS);
    await runPushSend(job);

    expect(fakePushOutbox()).toHaveLength(10);
    expect(h.state.enqueued).toHaveLength(0);
    const [fields] = pushSentLogs();
    expect(fields).toMatchObject({ event: 'push.sent', retried: 0 });
    expect(Number(fields?.sent)).toBe(fakePushOutbox().filter((e) => e.status === 201).length);
    expect(reports.filter((r) => r.outcome === 'failed').length).toBe(
      fakePushOutbox().filter((e) => e.status === 503).length,
    );
  });

  it('a failing counters resolver sends every subscription with badge 0', async () => {
    h.state.countersFail = true;
    const { job } = makeJob(20, 2, () => 201);
    await runPushSend(job);

    const outbox = fakePushOutbox();
    expect(outbox).toHaveLength(40);
    for (const entry of outbox) expect(JSON.parse(entry.payload).badge).toBe(0);
    expect(reports.every((r) => r.outcome === 'sent')).toBe(true);
  });

  it('a thrown send is reported failed and re-enqueued alone', async () => {
    const { job, rows } = makeJob(8, 1, () => 201);
    const broken = rows[5] as Row;
    h.state.throwEndpoints.add(broken.endpoint);
    await runPushSend(job);

    expect(fakePushOutbox()).toHaveLength(7);
    expect(reports.find((r) => r.id === broken.id)?.outcome).toBe('failed');
    expect(reports.filter((r) => r.outcome === 'sent')).toHaveLength(7);
    expect(h.state.enqueued).toHaveLength(1);
    const [enqueued] = h.state.enqueued as Enqueued[];
    expect(enqueued?.payload.subscriptionIds).toEqual([broken.id]);
    expect(enqueued?.payload.userIds).toEqual([broken.user_id]);
    expect(enqueued?.payload.attempt).toBe(1);
    expect(pushSentLogs()[0]).toMatchObject({ sent: 7, retried: 1 });
  });
});
