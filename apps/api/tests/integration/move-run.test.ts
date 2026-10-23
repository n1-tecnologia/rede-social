import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { eventsOf, latestMoveOf, runMove } from '@rede-social/core/server/projects/move/index';
import { isTenantMoving } from '@rede-social/core/server/projects/moving';
import { closeAllPools } from '@rede-social/core/server/tenancy/project-registry';
import {
  invalidateTenantHost,
  resolveTenantHost,
} from '@rede-social/core/server/tenancy/tenant-host';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeHelperClients,
  connect,
  createMoveTenant,
  footprint,
  harness,
  type MoveTenant,
  removeTargetProject,
  resetB,
  SRC_URL,
  TGT_URL,
} from './move-helpers';
import { adminSql, api, HOSTS } from './setup';

/**
 * Phase 09.2-23, the tracer (DBT-34, DBT-48, D-535, D-536): a throwaway tenant of project 0 is moved to a
 * freshly bootstrapped second database by the REAL tool (state machine, suspension, quiescence, the plan 22
 * copy, verification, the one-transaction repoint, cache invalidation, queue re-sync, branding mirror and
 * reactivation) and is then served from there, while the source still holds every row. The waits are 0 (the
 * real cache-expiry behaviour across instances is hosted proof H6). Nothing touches a hosted project.
 */

const RUN = Date.now().toString(36);
const SLUG = `mv-run-${RUN}`.slice(0, 40);
const ACTOR = 'cli:test';

let tenant: MoveTenant;
let h: ReturnType<typeof harness>;
let moveId = '';

beforeAll(async () => {
  resetB('bare');
  h = harness();
  tenant = await createMoveTenant(SLUG);
});

afterAll(async () => {
  await tenant?.cleanup();
  await removeTargetProject(h.ref).catch(() => undefined);
  await stopBoss();
  await closeAllPools();
  await closeHelperClients();
  await adminSql.end();
  await sqlClient.end();
  resetB('migrated');
});

const options = (mode: 'start' | 'resume' | 'status' | 'dry-run' = 'start') =>
  ({
    mode,
    tenantSlug: SLUG,
    toRef: h.ref,
    actor: ACTOR,
    quiesceMs: 0,
    registryWaitMs: 0,
  }) as const;

describe('the tracer: one command moves a tenant to its own database', () => {
  it('moves a tenant end to end', async () => {
    const source = connect(SRC_URL);
    const before = await footprint(source, tenant.tenantId);
    expect(before.feed_posts).toBe(1);
    expect(before.events).toBe(1);
    expect(before.event_secrets).toBe(1);
    const [demoBefore] = await adminSql<{ project_id: string }[]>`
      select tp.project_id from platform.tenant_projects tp
        join public.tenants t on t.id = tp.tenant_id where t.slug = 'rede-demo'`;

    const result = await runMove(options(), h.deps);
    expect(result.outcome).toBe('moved');
    expect(result.state).toBe('done');
    moveId = result.moveId ?? '';

    // The trail, in order.
    const events = await eventsOf(moveId);
    expect(events.map((e) => e.kind)).toEqual([
      'started',
      'target_ready',
      'suspended',
      'quiesced',
      'copied',
      'verified',
      'cutover',
      'reactivated',
      'done',
    ]);

    // The pointer: the target now, project 0 remembered.
    const [target] = await adminSql<{ id: string; state: string; publishable_key: string }[]>`
      select id, state, publishable_key from platform.projects where ref = ${h.ref}`;
    expect(target?.state).toBe('ready');
    const [binding] = await adminSql<{ project_id: string; previous_project_id: string | null }[]>`
      select project_id, previous_project_id from platform.tenant_projects
       where tenant_id = ${tenant.tenantId}::uuid`;
    expect(binding?.project_id).toBe(target?.id);
    const [central] = await adminSql<{ id: string }[]>`
      select id from platform.projects where is_central`;
    expect(binding?.previous_project_id).toBe(central?.id);

    // The host answers active, with the target's coordinates.
    invalidateTenantHost(tenant.host);
    const host = await resolveTenantHost(tenant.host);
    expect(host.kind).toBe('tenant');
    if (host.kind === 'tenant') {
      expect(host.status).toBe('active');
      expect(host.projectId).toBe(target?.id);
      expect(host.publishableKey).toBe(target?.publishable_key);
      expect(host.supabaseUrl).toBeTruthy();
    }

    // A session minted for a copied member is served FROM THE TARGET: B's own tenant row is the one read.
    const targetDb = connect(TGT_URL);
    await targetDb`update public.tenants set display_name = 'Movel (B)' where id = ${tenant.tenantId}::uuid`;
    const res = await api.request('/v1/me/bootstrap', {
      headers: { authorization: `Bearer ${await tenant.token()}`, 'x-tenant-host': tenant.host },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenant: { id: string; displayName: string } };
    expect(body.tenant.id).toBe(tenant.tenantId);
    expect(body.tenant.displayName).toBe('Movel (B)');

    // The copy holds every row; the source is untouched.
    expect(await footprint(targetDb, tenant.tenantId)).toEqual(before);
    expect(await footprint(source, tenant.tenantId)).toEqual(before);

    // Another tenant of project 0 is unaffected.
    const [demoAfter] = await adminSql<{ project_id: string }[]>`
      select tp.project_id from platform.tenant_projects tp
        join public.tenants t on t.id = tp.tenant_id where t.slug = 'rede-demo'`;
    expect(demoAfter?.project_id).toBe(demoBefore?.project_id);
    const demo = await resolveTenantHost(HOSTS.demo);
    expect(demo.kind === 'tenant' && demo.status).toBe('active');
    if (demo.kind === 'tenant') expect(demo.projectId).toBe(central?.id);

    expect(await isTenantMoving(tenant.tenantId)).toBe(false);
    const [row] = await adminSql<{ status: string }[]>`
      select status from public.tenants where id = ${tenant.tenantId}::uuid`;
    expect(row?.status).toBe('active');
  });

  it('answers already_done for a finished move and writes nothing', async () => {
    const countEvents = async () => {
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from platform.tenant_move_events where move_id = ${moveId}::uuid`;
      return row?.n ?? -1;
    };
    const eventsBefore = await countEvents();
    const again = await runMove(options('start'), h.deps);
    expect(again.outcome).toBe('already_done');
    const resumed = await runMove(options('resume'), h.deps);
    expect(resumed.outcome).toBe('already_done');
    expect(await countEvents()).toBe(eventsBefore);
    const last = await latestMoveOf(tenant.tenantId);
    expect(last?.state).toBe('done');
  });

  it('keeps every report and event free of e-mails, hashes, tokens and connection strings', async () => {
    const status = await runMove(options('status'), h.deps);
    const text = JSON.stringify([status.lines, await eventsOf(moveId)]);
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\$2[ab]\$/);
    expect(text).not.toContain('eyJ');
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('sb_secret_');
  });
});
