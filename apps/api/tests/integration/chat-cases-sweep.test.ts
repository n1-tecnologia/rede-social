import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { registeredSweepFunctions } from '@rede-social/core/server/jobs/sweep-functions';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin } from './setup';

/**
 * Phase 12.4 plan 04 (CASE-13, CASE-12, CASE-18, CASE-23; D-807, D-844, D-810): a support case left
 * `resolved` for 7 days is closed by the kernel's EXISTING hourly sweeper (`kernel.media-sweep-orphans`),
 * which runs `app.chat_cases_auto_close(500)` through the admin lane for every function a module manifest
 * declares in `sweepFunctions`. Proved here with the REAL handler, against the live local stack and the
 * real seed:
 *
 *  - the app registry registered the chat module's `chat_cases_auto_close`;
 *  - one sweep closes the case resolved 7 days + 1 minute ago in BOTH seed tenants, writes the history
 *    row with no actor and leaves the case resolved 6 days 23 hours ago untouched (the tracer);
 *  - the race at the close boundary (RESEARCH Pitfall 4), with two real connections and a promise
 *    handshake instead of a sleep: a row someone else holds is skipped, a member message reopens a
 *    resolved case and takes it out of the sweep's reach, and a message that waits behind the sweep is
 *    refused CS004 once it closed (the API retries into a new case, plan 02);
 *  - the 7 days are ONE literal in the SQL function, pinned here against a constant of this file.
 *
 * The sweeper and its imports load INSIDE the tests (the media-sweeper precedent's heavy-import rule),
 * after `api` pulled in the registry. Every fixture is namespaced `case12.4:` and swept in `afterAll`.
 */

const MEDIA_SWEEP_QUEUE = 'kernel.media-sweep-orphans';
const PREFIX = 'case12.4:';
const PASSWORD = 'Segredo123';
/** D-807: the 7 days live in the SQL function only; this constant exists to pin them, nowhere else. */
const CHAT_AUTO_CLOSE_DAYS = 7;
const DB_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const tenants = { demo: '', lab: '' };
const throwaways: string[] = [];
let counter = 0;

async function loadSweeper() {
  // `api` is referenced so the app (and its module registry) is imported before the sweeper runs.
  expect(api).toBeDefined();
  return (await import('@rede-social/core/server/media/sweep-job')).sweepOrphansJob;
}

/** A fresh live `member` of `tenantId` with no conversation (a resolved case still counts as ACTIVE per member). */
async function freshMember(tenantId: string, label: string): Promise<string> {
  counter += 1;
  const email = `case124-${label}-${counter}-${Date.now()}@rede-demo.local`;
  const created = await authAdmin().createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: `${PREFIX}${label}` },
  });
  const id = created.data.user?.id ?? '';
  if (!id) throw new Error(`could not create ${email}: ${created.error?.message}`);
  throwaways.push(id);
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${tenantId}::uuid, ${id}::uuid, 'member', 'active')`;
  return id;
}

/** A support case of a fresh member, moved to `resolved` with `resolved_at = now() - interval`. */
async function resolvedCase(
  tenantId: string,
  label: string,
  interval: string,
): Promise<{ id: string; memberId: string }> {
  const memberId = await freshMember(tenantId, label);
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
    values (${tenantId}::uuid, 'support', ${memberId}::uuid)
    returning id::text as id`;
  const id = row?.id ?? '';
  await adminSql`
    update public.chat_conversations
       set state = 'resolved', resolved_at = now() - ${interval}::interval
     where id = ${id}::uuid`;
  return { id, memberId };
}

type CaseState = { state: string; resolved: boolean; closed: boolean };

async function caseState(id: string): Promise<CaseState> {
  const [row] = await adminSql<{ state: string; resolved: boolean; closed: boolean }[]>`
    select state, resolved_at is not null as resolved, closed_at is not null as closed
      from public.chat_conversations where id = ${id}::uuid`;
  if (!row) throw new Error(`case ${id} is gone`);
  return row;
}

async function closedEvents(id: string) {
  return adminSql<
    { tenant_id: string; actor: string | null; from_state: string; to_state: string }[]
  >`
    select tenant_id::text as tenant_id, actor_user_id::text as actor, from_state, to_state
      from public.chat_case_events where conversation_id = ${id}::uuid and kind = 'closed'`;
}

/** A promise whose resolution is triggered by the test: the handshake of the race tests (no sleep). */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Thrown inside a held transaction to roll it back. */
class RollBack extends Error {}

/** One sweep call through the admin connection: how many cases it closed. */
async function sweepOnce(sql: typeof adminSql = adminSql): Promise<number> {
  const [row] = await sql<{ n: number }[]>`select app.chat_cases_auto_close(500)::int as n`;
  return row?.n ?? -1;
}

/** Polls `pg_stat_activity` (its own connection) until a session is waiting on a lock for `queryLike`. */
async function waitForLockWaiter(probe: typeof adminSql, queryLike: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const [row] = await probe<{ n: number }[]>`
      select count(*)::int as n, pg_sleep(0.02) is not null as slept
        from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock' and query like ${queryLike}`;
    if ((row?.n ?? 0) > 0) return;
  }
  throw new Error(`no session ever waited on a lock for ${queryLike}`);
}

async function cleanup(): Promise<void> {
  const ids = throwaways.splice(0);
  if (ids.length > 0) {
    await adminSql`delete from public.chat_messages where author_user_id = any(${ids}::uuid[])`;
    await adminSql`delete from public.chat_conversations where created_by_user_id = any(${ids}::uuid[])`;
    await adminSql`
      delete from public.member_profiles
       where membership_id in (select id from public.memberships where user_id = any(${ids}::uuid[]))`;
    await adminSql`delete from public.memberships where user_id = any(${ids}::uuid[])`;
    for (const id of ids) await authAdmin().deleteUser(id);
  }
  await adminSql`delete from pgboss.job_common where name = ${MEDIA_SWEEP_QUEUE}`;
}

beforeAll(async () => {
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id::text as id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  for (const row of rows) {
    if (row.slug === 'rede-demo') tenants.demo = row.id;
    if (row.slug === 'rede-lab') tenants.lab = row.id;
  }
  if (!tenants.demo || !tenants.lab) throw new Error('both seed tenants are required');
});

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('the chat case auto-close through the hourly sweeper (D-807, D-844)', () => {
  it('the app registry registered chat_cases_auto_close from the module manifest', () => {
    expect(api).toBeDefined();
    expect(registeredSweepFunctions()).toContain('chat_cases_auto_close');
  });

  it('one sweep closes the case resolved 7 days and a minute ago in BOTH seed tenants and leaves the 6 d 23 h one', async () => {
    const sweepOrphansJob = await loadSweeper();
    const oldDemo = await resolvedCase(tenants.demo, 'old-demo', '7 days 1 minute');
    const oldLab = await resolvedCase(tenants.lab, 'old-lab', '7 days 1 minute');
    const recent = await resolvedCase(tenants.demo, 'recent-demo', '6 days 23 hours');

    await sweepOrphansJob.handler({});

    expect(await caseState(oldDemo.id)).toEqual({ state: 'closed', resolved: false, closed: true });
    expect(await caseState(oldLab.id)).toEqual({ state: 'closed', resolved: false, closed: true });
    expect(await caseState(recent.id)).toEqual({
      state: 'resolved',
      resolved: true,
      closed: false,
    });

    expect(await closedEvents(oldDemo.id)).toEqual([
      { tenant_id: tenants.demo, actor: null, from_state: 'resolved', to_state: 'closed' },
    ]);
    expect(await closedEvents(oldLab.id)).toEqual([
      { tenant_id: tenants.lab, actor: null, from_state: 'resolved', to_state: 'closed' },
    ]);
    expect(await closedEvents(recent.id)).toEqual([]);
  });
});

describe('the sweep under a race at the close boundary (RESEARCH Pitfall 4, T-12.4-19)', () => {
  const holderSql = postgres(DB_URL, { prepare: false, max: 1 });
  const probeSql = postgres(DB_URL, { prepare: false, max: 1 });

  beforeAll(async () => {
    // Anything already eligible in this database is drained first (the hourly job would do the same), so the
    // counts below are about THIS file's cases only.
    await sweepOnce();
  });

  afterAll(async () => {
    await holderSql.end();
    await probeSql.end();
  });

  it('a row another transaction holds FOR UPDATE is skipped (0), untouched, then closed once released by a rollback', async () => {
    const { id } = await resolvedCase(tenants.demo, 'race-a', '7 days 1 minute');
    const locked = gate();
    const release = gate();
    const holding = holderSql
      .begin(async (tx) => {
        await tx`select 1 from public.chat_conversations where id = ${id}::uuid for update`;
        locked.open();
        await release.promise;
        throw new RollBack('release');
      })
      .catch((error: unknown) => {
        if (!(error instanceof RollBack)) throw error;
      });
    await locked.promise;

    expect(await sweepOnce(), 'a locked row is skipped, never waited for').toBe(0);
    expect(await caseState(id)).toEqual({ state: 'resolved', resolved: true, closed: false });
    expect(await closedEvents(id)).toEqual([]);

    release.open();
    await holding;
    expect(await sweepOnce(), 'the next run closes it').toBe(1);
    expect(await caseState(id)).toEqual({ state: 'closed', resolved: false, closed: true });
    expect(await closedEvents(id)).toHaveLength(1);
  });

  it('a member message holding the row reopens the case; the sweep skips it, then leaves it alone because it is open', async () => {
    const { id, memberId } = await resolvedCase(tenants.demo, 'race-b', '7 days 1 minute');
    const locked = gate();
    const release = gate();
    const holding = holderSql.begin(async (tx) => {
      await tx`
        insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
        values (${tenants.demo}::uuid, ${id}::uuid, ${memberId}::uuid, 'member', 'ainda preciso de ajuda')`;
      locked.open();
      await release.promise;
    });
    await locked.promise;

    expect(await sweepOnce(), 'the row the message is updating is skipped').toBe(0);

    release.open();
    await holding;
    expect(
      await sweepOnce(),
      'the message committed first: the case is open, out of the sweep',
    ).toBe(0);
    expect(await caseState(id)).toEqual({ state: 'open', resolved: false, closed: false });
    expect(await closedEvents(id)).toEqual([]);
  });

  it('a member message that waits behind the sweep is refused CS004 once the case closed, and the member gets a new case', async () => {
    const { id, memberId } = await resolvedCase(tenants.demo, 'race-c', '7 days 1 minute');
    const locked = gate();
    const release = gate();
    const holding = holderSql.begin(async (tx) => {
      const [row] = await tx<{ n: number }[]>`select app.chat_cases_auto_close(500)::int as n`;
      expect(row?.n).toBe(1);
      locked.open();
      await release.promise;
    });
    await locked.promise;

    const message = adminSql`
      insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
      values (${tenants.demo}::uuid, ${id}::uuid, ${memberId}::uuid, 'member', 'chegou tarde')`;
    // The insert reaches the row lock and WAITS: it is visible in pg_stat_activity, no sleep guesses it.
    const settled = message.then(
      () => 'written',
      (error: { code?: string }) => error.code ?? 'failed',
    );
    await waitForLockWaiter(probeSql, '%chat_messages%');

    release.open();
    await holding;
    expect(await settled, 'the closed case refuses every writer').toBe('CS004');
    expect(await caseState(id)).toEqual({ state: 'closed', resolved: false, closed: true });
    const [{ n } = { n: -1 }] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.chat_messages where conversation_id = ${id}::uuid`;
    expect(n, 'nothing was written into the closed case').toBe(0);

    // The API retries the open path in a new transaction (plan 02): a closed case is not active, so a new one fits.
    const [fresh] = await adminSql<{ id: string }[]>`
      insert into public.chat_conversations (tenant_id, kind, created_by_user_id)
      values (${tenants.demo}::uuid, 'support', ${memberId}::uuid)
      returning id::text as id`;
    expect(fresh?.id).toBeTruthy();
    expect(await caseState(fresh?.id ?? '')).toEqual({
      state: 'open',
      resolved: false,
      closed: false,
    });
  });
});

describe('the 7 days are one literal in the SQL function (D-807)', () => {
  it('pg_get_functiondef carries exactly one interval of days and it equals the constant of this file', async () => {
    const [row] = await adminSql<{ def: string }[]>`
      select pg_get_functiondef('app.chat_cases_auto_close(int)'::regprocedure) as def`;
    const days = [...(row?.def ?? '').matchAll(/interval '(\d+) days?'/g)].map((m) => Number(m[1]));
    expect(days).toEqual([CHAT_AUTO_CLOSE_DAYS]);
  });
});
