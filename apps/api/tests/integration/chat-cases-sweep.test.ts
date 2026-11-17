import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { registeredSweepFunctions } from '@rede-social/core/server/jobs/sweep-functions';
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
 *    row with no actor and leaves the case resolved 6 days 23 hours ago untouched (the tracer).
 *
 * The sweeper and its imports load INSIDE the tests (the media-sweeper precedent's heavy-import rule),
 * after `api` pulled in the registry. Every fixture is namespaced `case12.4:` and swept in `afterAll`.
 */

const MEDIA_SWEEP_QUEUE = 'kernel.media-sweep-orphans';
const PREFIX = 'case12.4:';
const PASSWORD = 'Segredo123';
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
    user_metadata: { name: `Caso ${label}` },
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
    expect(await caseState(recent.id)).toEqual({ state: 'resolved', resolved: true, closed: false });

    expect(await closedEvents(oldDemo.id)).toEqual([
      { tenant_id: tenants.demo, actor: null, from_state: 'resolved', to_state: 'closed' },
    ]);
    expect(await closedEvents(oldLab.id)).toEqual([
      { tenant_id: tenants.lab, actor: null, from_state: 'resolved', to_state: 'closed' },
    ]);
    expect(await closedEvents(recent.id)).toEqual([]);
  });
});
