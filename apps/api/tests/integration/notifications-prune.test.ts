import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import {
  registeredSweepFunctions,
  registerSweepFunctions,
  unregisterSweepFunction,
} from '@rede-social/core/server/jobs/sweep-functions';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminSql, api } from './setup';

/**
 * D-231 (07-04): notification rows older than 90 days are deleted by the kernel's EXISTING hourly
 * sweeper (`kernel.media-sweep-orphans`), which now also runs every function a module manifest
 * declares in `sweepFunctions` through the admin lane. Proved here with the REAL handler, against the
 * live local stack and the real seed:
 *
 *  - the app registry registered the notifications module's `notifications_prune`;
 *  - one sweep deletes the rows created 90 days + 1 minute ago in BOTH seed tenants, and keeps the
 *    89-days-23-hours and 2-days rows (NOTIF-02 boundary, prune half);
 *  - the media passes still ran in the same run (an abandoned 25 h `pending` asset is collected);
 *  - a registered function that throws stops neither the prune, nor the media pass, nor the re-arm.
 *
 * The sweeper and its imports load INSIDE the tests (the media-sweeper precedent's heavy-import rule),
 * after `api` pulled in the registry. Every fixture row carries the `prune07:` dedupe prefix.
 */

const MEDIA_SWEEP_QUEUE = 'kernel.media-sweep-orphans';
const PREFIX = 'prune07:';
const tenants = { demo: '', lab: '' };
const createdAssets: string[] = [];

async function loadSweeper() {
  // `api` is referenced so the app (and its module registry) is imported before the sweeper runs.
  expect(api).toBeDefined();
  return (await import('@rede-social/core/server/media/sweep-job')).sweepOrphansJob;
}

/** One fixture row per tenant per age: 90 d + 1 min, 89 d 23 h and 2 d. */
async function seedRows(): Promise<void> {
  for (const [slug, tenantId] of Object.entries(tenants)) {
    const [member] = await adminSql<{ user_id: string }[]>`
      select user_id::text as user_id from public.memberships
       where tenant_id = ${tenantId}::uuid and status = 'active' and deleted_at is null
       order by joined_at limit 1`;
    for (const [age, interval] of [
      ['90d1m', '90 days 1 minute'],
      ['89d23h', '89 days 23 hours'],
      ['2d', '2 days'],
    ] as const) {
      await adminSql`
        insert into public.notifications
          (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id, created_at)
        values (${tenantId}::uuid, ${member?.user_id ?? ''}::uuid, 'feed.post',
                ${`${PREFIX}${slug}:${age}`}, 'post', gen_random_uuid(),
                now() - ${interval}::interval)`;
    }
  }
}

async function remainingKeys(): Promise<string[]> {
  const rows = await adminSql<{ dedupe_key: string }[]>`
    select dedupe_key from public.notifications where dedupe_key like ${`${PREFIX}%`}
     order by dedupe_key`;
  return rows.map((row) => row.dedupe_key);
}

/** An abandoned upload (25 h `pending`, no bytes): the media pass must collect it. */
async function seedAbandonedAsset(): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, created_at)
    select ${tenants.demo}::uuid, m.user_id, 'image', 'avatar', 'pending', 'supabase', 'image/jpeg',
           1024, now() - interval '25 hours'
      from public.memberships m
     where m.tenant_id = ${tenants.demo}::uuid and m.status = 'active' and m.deleted_at is null
     order by m.joined_at limit 1
    returning id::text as id`;
  const id = row?.id ?? '';
  createdAssets.push(id);
  return id;
}

async function assetExists(id: string): Promise<boolean> {
  const rows = await adminSql`select 1 from public.media_assets where id = ${id}::uuid`;
  return rows.length > 0;
}

async function queuedSweeps(): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from pgboss.job_common
     where name = ${MEDIA_SWEEP_QUEUE} and state = 'created'`;
  return row?.n ?? 0;
}

async function cleanup(): Promise<void> {
  await adminSql`delete from public.notifications where dedupe_key like ${`${PREFIX}%`}`;
  if (createdAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${createdAssets}::uuid[])`;
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

describe('notifications prune through the hourly sweeper (D-231)', () => {
  it('the app registry registered notifications_prune from the module manifest', () => {
    expect(api).toBeDefined();
    expect(registeredSweepFunctions()).toContain('notifications_prune');
  });

  it('one sweep deletes the 90 d + 1 min rows in both tenants, keeps the younger ones, and the media pass and re-arm still run', async () => {
    const sweepOrphansJob = await loadSweeper();
    await seedRows();
    const asset = await seedAbandonedAsset();

    await sweepOrphansJob.handler({});

    expect(await remainingKeys()).toEqual([
      `${PREFIX}demo:2d`,
      `${PREFIX}demo:89d23h`,
      `${PREFIX}lab:2d`,
      `${PREFIX}lab:89d23h`,
    ]);
    expect(await assetExists(asset), 'the media pass collected the abandoned upload').toBe(false);
    expect(await queuedSweeps(), 'the sweeper re-armed itself').toBe(1);
  });

  it('a registered function that throws stops neither the prune, nor the media pass, nor the re-arm', async () => {
    const sweepOrphansJob = await loadSweeper();
    const bogus = 'sweep_function_that_does_not_exist';
    // Registration order is run order, so here the bogus name runs AFTER notifications_prune (the
    // next case puts it first).
    registerSweepFunctions([bogus]);
    try {
      expect(registeredSweepFunctions()).toContain(bogus);
      await seedRows();
      const asset = await seedAbandonedAsset();

      await expect(sweepOrphansJob.handler({})).resolves.toBeUndefined();

      expect(await remainingKeys()).toHaveLength(4);
      expect(await assetExists(asset)).toBe(false);
      expect(await queuedSweeps()).toBe(1);
    } finally {
      unregisterSweepFunction(bogus);
    }
    expect(registeredSweepFunctions()).not.toContain(bogus);
  });

  it('a failing function registered BEFORE the prune does not stop it either', async () => {
    const sweepOrphansJob = await loadSweeper();
    const bogus = 'sweep_function_that_fails_first';
    // Put the bogus name ahead of the real one for this case, then restore the manifest order.
    unregisterSweepFunction('notifications_prune');
    registerSweepFunctions([bogus, 'notifications_prune']);
    try {
      await seedRows();
      await expect(sweepOrphansJob.handler({})).resolves.toBeUndefined();
      expect(await remainingKeys()).toHaveLength(4);
      expect(await queuedSweeps()).toBe(1);
    } finally {
      unregisterSweepFunction(bogus);
    }
    expect(registeredSweepFunctions()).toEqual(['notifications_prune']);
  });

  it('a sweep-function name outside ^[a-z_]+$ is refused at registration (T-07-24)', () => {
    expect(() => registerSweepFunctions(['notifications_prune; drop table x'])).toThrow(
      /invalid sweep function name/,
    );
    expect(() => registerSweepFunctions(['Notifications'])).toThrow(/invalid sweep function name/);
    expect(registeredSweepFunctions()).toEqual(['notifications_prune']);
  });
});
