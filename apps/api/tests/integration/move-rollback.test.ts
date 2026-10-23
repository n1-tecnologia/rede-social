import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sqlClient } from '@rede-social/core/db';
import { createQueues, stopBoss } from '@rede-social/core/server/jobs/boss';
import {
  centralResidue,
  defaultBossFor,
  eventsOf,
  latestMoveOf,
  type MoveDeps,
  MoveError,
  type MoveOptions,
  runMove,
} from '@rede-social/core/server/projects/move/index';
import { isTenantMoving } from '@rede-social/core/server/projects/moving';
import {
  closeAllPools,
  resolveProjectById,
} from '@rede-social/core/server/tenancy/project-registry';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeHelperClients,
  connect,
  createMoveTenant,
  footprint,
  type Harness,
  harness,
  type MoveTenant,
  ROOT,
  removeTargetProject,
  resetB,
  SRC_URL,
  SUPABASE_URL,
  TGT_URL,
} from './move-helpers';
import { adminSql } from './setup';

/**
 * Phase 09.2-23 (DBT-34, DBT-49, D-534, D-535, D-536, T-09.2-104, T-09.2-107, T-09.2-108): the way back and the
 * way out. Every case moves a throwaway tenant of project 0 to a freshly bootstrapped `rede_tenant_b` with the
 * REAL tool (waits of 0), then rolls back, recopies, deletes the source or inspects the central project.
 * Storage is in memory (the local stack has one Storage for both "projects"); nothing touches a hosted
 * project. The only case that deletes from the source is 'confirm-delete', on its own throwaway tenant.
 */

const RUN = Date.now().toString(36);
let counter = 0;
const ACTOR = 'cli:test';

let h: Harness;
let t: MoveTenant;
let extra: { tenantId: string; userId: string } | null = null;

const slug = () => {
  counter += 1;
  return `mvrb-${RUN}-${counter}`.slice(0, 40);
};

async function setup(options: { targetApiUrl?: string; extraMember?: boolean } = {}) {
  resetB('bare');
  h = harness(options.targetApiUrl ? { targetApiUrl: options.targetApiUrl } : {});
  t = await createMoveTenant(slug(), options.extraMember ? { extraMember: true } : {});
}

const opts = (mode: MoveOptions['mode'], more: Partial<MoveOptions> = {}): MoveOptions => ({
  mode,
  tenantSlug: t.slug,
  toRef: h.ref,
  actor: ACTOR,
  quiesceMs: 0,
  registryWaitMs: 0,
  ...more,
});

const crashAfter = (state: string): MoveDeps => ({
  ...h.deps,
  afterState: async (reached) => {
    if (reached === state) throw new Error('simulated crash');
  },
});

async function moveFully(): Promise<string> {
  const result = await runMove(opts('start'), h.deps);
  expect(result.state).toBe('done');
  return result.moveId ?? '';
}

async function binding() {
  const [row] = await adminSql<{ project_id: string; previous_project_id: string | null }[]>`
    select project_id, previous_project_id from platform.tenant_projects
     where tenant_id = ${t.tenantId}::uuid`;
  return row;
}

async function centralId(): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`select id from platform.projects where is_central`;
  return row?.id ?? '';
}

async function statusOf(): Promise<string | undefined> {
  const [row] = await adminSql<{ status: string }[]>`
    select status from public.tenants where id = ${t.tenantId}::uuid`;
  return row?.status;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof MoveError ? error.code : `other:${String(error)}`;
  }
}

afterEach(async () => {
  if (extra) {
    await adminSql`delete from public.memberships where user_id = ${extra.userId}::uuid and tenant_id = ${extra.tenantId}::uuid`;
    extra = null;
  }
  await t?.cleanup();
  await removeTargetProject(h?.ref ?? 'none').catch(() => undefined);
  await closeAllPools();
});

afterAll(async () => {
  await stopBoss();
  await closeAllPools();
  await closeHelperClients();
  await adminSql.end();
  await sqlClient.end();
  resetB('migrated');
});

describe('rollback', () => {
  beforeEach(async () => {
    await setup({ targetApiUrl: 'http://localhost:54321' });
  });

  it('rollback before the flip restores the status, keeps the pointer and leaves the target rows', async () => {
    const crashed = codeOf(runMove(opts('start'), crashAfter('copied')));
    expect(await crashed).toBe('other:Error: simulated crash');
    const move = await latestMoveOf(t.tenantId);
    expect(move?.state).toBe('copied');
    expect(await statusOf()).toBe('suspended');
    expect(await isTenantMoving(t.tenantId)).toBe(true);

    const result = await runMove(opts('rollback'), h.deps);
    expect(result.outcome).toBe('rolled_back');
    expect((await latestMoveOf(t.tenantId))?.state).toBe('rolled_back');
    expect(await statusOf()).toBe('active');
    expect((await binding())?.project_id).toBe(await centralId());
    expect(await isTenantMoving(t.tenantId)).toBe(false);
    // The target keeps what the copy wrote: a rollback never cleans it.
    const target = connect(TGT_URL);
    expect((await footprint(target, t.tenantId)).feed_posts).toBe(1);
  });

  it('rollback after the flip without writes puts the pointer, the branding, the jobs and the status back', async () => {
    const moveId = await moveFully();
    const central = await centralId();
    const target = await resolveProjectById((await latestMoveOf(t.tenantId))?.toProjectId ?? '');
    expect((await binding())?.project_id).toBe(target?.id);

    // The central mirror took the target's origin; a job now waits in the target.
    const [moved] = await adminSql<{ logo: string }[]>`
      select branding ->> 'logoUrl' as logo from public.tenants where id = ${t.tenantId}::uuid`;
    expect(moved?.logo.startsWith('http://localhost:54321/')).toBe(true);
    const QUEUE = 'kernel.branding-derive-icons';
    if (!target) throw new Error('no target project');
    const boss = await defaultBossFor(target);
    try {
      await createQueues(boss, [QUEUE]);
      await boss.send(QUEUE, { tenantId: t.tenantId }, { startAfter: 3600 });
    } finally {
      await boss.stop({ graceful: false });
    }

    const result = await runMove(opts('rollback'), h.deps);
    expect(result.outcome).toBe('rolled_back');
    const row = await binding();
    expect(row?.project_id).toBe(central);
    expect(row?.previous_project_id).toBe(target.id);
    expect(await statusOf()).toBe('active');
    expect(await isTenantMoving(t.tenantId)).toBe(false);

    const [back] = await adminSql<{ logo: string }[]>`
      select branding ->> 'logoUrl' as logo from public.tenants where id = ${t.tenantId}::uuid`;
    expect(back?.logo.startsWith(`${SUPABASE_URL}/`)).toBe(true);

    // The job went back to the source and was cancelled in the target.
    const [waiting] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from pgboss.job
       where name = ${QUEUE} and data ->> 'tenantId' = ${t.tenantId} and state = 'created'`;
    expect(waiting?.n).toBe(1);
    const targetDb = connect(TGT_URL);
    const [gone] = await targetDb<{ n: number }[]>`
      select count(*)::int as n from pgboss.job
       where name = ${QUEUE} and data ->> 'tenantId' = ${t.tenantId} and state = 'created'`;
    expect(gone?.n).toBe(0);
    // The target rows are untouched, and the trail says so.
    expect((await footprint(targetDb, t.tenantId)).feed_posts).toBe(1);
    const kinds = (await eventsOf(moveId)).map((e) => e.kind);
    expect(kinds.at(-1)).toBe('rolled_back');
  });

  it('rollback refuses to drop writes made since the cutover, and accepts the loss on request', async () => {
    await moveFully();
    const targetDb = connect(TGT_URL);
    await targetDb`
      insert into public.feed_posts (tenant_id, author_user_id, caption)
      values (${t.tenantId}::uuid, ${t.userId}::uuid, 'Escrito depois da mudanca')`;

    const refused = await runMove(opts('rollback'), h.deps).then(
      () => null,
      (e: unknown) => e as MoveError,
    );
    expect(refused).toBeInstanceOf(MoveError);
    expect(refused?.code).toBe('writes_since_cutover');
    expect(refused?.tables).toContain('feed_posts');
    // Nothing changed.
    const target = (await binding())?.project_id;
    expect(target).not.toBe(await centralId());
    expect((await latestMoveOf(t.tenantId))?.state).toBe('done');
    expect(await statusOf()).toBe('active');
    expect((await footprint(targetDb, t.tenantId)).feed_posts).toBe(2);

    const accepted = await runMove(opts('rollback', { acceptLoss: true }), h.deps);
    expect(accepted.outcome).toBe('rolled_back');
    expect((await binding())?.project_id).toBe(await centralId());
    const lines = JSON.stringify(accepted.lines);
    expect(lines).toContain('"lost":');
  });

  it('a second rollback is a no-op', async () => {
    const moveId = await moveFully();
    await runMove(opts('rollback'), h.deps);
    const before = await binding();
    const events = (await eventsOf(moveId)).length;
    const again = await runMove(opts('rollback'), h.deps);
    expect(again.outcome).toBe('already_rolled_back');
    expect(await binding()).toEqual(before);
    expect((await eventsOf(moveId)).length).toBe(events);
  });

  it('rollback after confirm-delete is refused', async () => {
    await moveFully();
    await runMove(opts('confirm-delete', { confirmSlug: t.slug }), h.deps);
    await expect(runMove(opts('rollback'), h.deps)).rejects.toMatchObject({
      code: 'source_deleted',
    });
    expect((await binding())?.project_id).not.toBe(await centralId());
  });
});

describe('recopy', () => {
  beforeEach(async () => {
    await setup();
  });

  it('recopy wipes the target, keeps the accounts, recopies and passes the verification', async () => {
    expect(await codeOf(runMove(opts('start'), crashAfter('copied')))).toBe(
      'other:Error: simulated crash',
    );
    // A source row changes after the copy: the verification must fail.
    await adminSql`update public.feed_posts set caption = 'Editada' where id = ${t.postId}::uuid`;
    expect(await codeOf(runMove(opts('resume'), h.deps))).toBe('verify_failed');
    const failed = await latestMoveOf(t.tenantId);
    expect(failed?.state).toBe('copied');
    expect(failed?.errorCode).toBe('verify_failed');
    expect(await statusOf()).toBe('suspended');

    const targetDb = connect(TGT_URL);
    const [accounts] = await targetDb<{ n: number }[]>`
      select count(*)::int as n from auth.users where id = ${t.userId}::uuid`;
    expect(accounts?.n).toBe(1);
    const sourceBefore = await footprint(connect(SRC_URL), t.tenantId);

    const result = await runMove(opts('recopy'), h.deps);
    expect(result.state).toBe('done');
    const kinds = (await eventsOf(result.moveId ?? '')).map((e) => e.kind);
    expect(kinds).toContain('recopy_wiped');
    const [after] = await targetDb<{ caption: string }[]>`
      select caption from public.feed_posts where id = ${t.postId}::uuid`;
    expect(after?.caption).toBe('Editada');
    const [kept] = await targetDb<{ n: number }[]>`
      select count(*)::int as n from auth.users where id = ${t.userId}::uuid`;
    expect(kept?.n).toBe(1);
    // The recopy never wrote to the source.
    expect(await footprint(connect(SRC_URL), t.tenantId)).toEqual(sourceBefore);
  });

  it('recopy is refused after the flip', async () => {
    await moveFully();
    expect(await codeOf(runMove(opts('recopy'), h.deps))).toBe('not_done');
    expect((await latestMoveOf(t.tenantId))?.state).toBe('done');
  });
});

describe('confirm-delete', () => {
  beforeEach(async () => {
    await setup({ extraMember: true });
  });

  it('needs the matching slug, and deletes nothing without it', async () => {
    await moveFully();
    const before = await footprint(connect(SRC_URL), t.tenantId);
    expect(
      await codeOf(runMove(opts('confirm-delete', { confirmSlug: 'outro-slug' }), h.deps)),
    ).toBe('confirm_mismatch');
    expect(await codeOf(runMove(opts('confirm-delete'), h.deps))).toBe('confirm_mismatch');
    expect(await footprint(connect(SRC_URL), t.tenantId)).toEqual(before);
    expect((await latestMoveOf(t.tenantId))?.sourceDeletedAt).toBeNull();
  });

  it('refuses a move that is not done', async () => {
    expect(await codeOf(runMove(opts('start'), crashAfter('copied')))).toBe(
      'other:Error: simulated crash',
    );
    const before = await footprint(connect(SRC_URL), t.tenantId);
    expect(await codeOf(runMove(opts('confirm-delete', { confirmSlug: t.slug }), h.deps))).toBe(
      'not_done',
    );
    expect(await footprint(connect(SRC_URL), t.tenantId)).toEqual(before);
  });

  it('removes the tenant from the source and nothing else', async () => {
    // A file and a second tenant that shares one of the accounts.
    const central = await centralId();
    const [demo] = await adminSql<
      { id: string }[]
    >`select id from public.tenants where slug = 'rede-demo'`;
    const shared = (
      await adminSql<{ id: string }[]>`
        select id from auth.users where email = ${`x-${t.email}`}`
    )[0]?.id;
    if (!demo || !shared) throw new Error('fixture');
    await adminSql`
      insert into public.memberships (tenant_id, user_id, role, status)
      values (${demo.id}::uuid, ${shared}::uuid, 'member', 'active')`;
    extra = { tenantId: demo.id, userId: shared };
    h.storageOf(central).put('media', `${t.tenantId}/nota.txt`, 'um arquivo pequeno');

    await moveFully();
    const target = connect(TGT_URL);
    const targetBefore = await footprint(target, t.tenantId);
    expect(targetBefore.feed_posts).toBe(1);

    const result = await runMove(opts('confirm-delete', { confirmSlug: t.slug }), h.deps);
    expect(result.outcome).toBe('source_deleted');
    // The plan was printed first.
    expect(result.lines[0]?.kind).toBe('delete_plan');

    const source = connect(SRC_URL);
    const left = await footprint(source, t.tenantId);
    for (const [table, rows] of Object.entries(left)) {
      // `tenant_modules` is the mirror: it stays.
      if (table === 'tenant_modules') expect(rows).toBe(3);
      else expect(rows, table).toBe(0);
    }
    const [tenantRow] = await source<{ n: number }[]>`
      select count(*)::int as n from public.tenants where id = ${t.tenantId}::uuid`;
    expect(tenantRow?.n).toBe(1);
    const [domain] = await source<{ n: number }[]>`
      select count(*)::int as n from public.tenant_domains where tenant_id = ${t.tenantId}::uuid`;
    expect(domain?.n).toBe(1);

    // The exclusive account is gone from the source, the shared one is still there.
    const [exclusive] = await source<{ n: number }[]>`
      select count(*)::int as n from auth.users where id = ${t.userId}::uuid`;
    expect(exclusive?.n).toBe(0);
    const [stillShared] = await source<{ n: number }[]>`
      select count(*)::int as n from auth.users where id = ${shared}::uuid`;
    expect(stillShared?.n).toBe(1);

    // The files of the source are gone; the target's copy is not.
    expect(
      h
        .storageOf(central)
        .keys()
        .filter((k) => k.includes(t.tenantId)),
    ).toEqual([]);
    const targetProject = await resolveProjectById(
      (await latestMoveOf(t.tenantId))?.toProjectId ?? '',
    );
    expect(
      h
        .storageOf(targetProject?.id ?? '')
        .keys()
        .some((k) => k.includes(t.tenantId)),
    ).toBe(true);

    // The target is untouched and the move can no longer be undone.
    expect(await footprint(target, t.tenantId)).toEqual(targetBefore);
    const move = await latestMoveOf(t.tenantId);
    expect(move?.sourceDeletedAt).not.toBeNull();
    expect(move?.state).toBe('done');
    const kinds = (await eventsOf(move?.id ?? '')).map((e) => e.kind);
    expect(kinds.slice(-2)).toEqual(['delete_planned', 'source_deleted']);
  });
});

describe('only one file deletes from the source', () => {
  const dir = join(ROOT, 'packages/core/server/projects/move');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  it('contains a delete statement only in delete-source.ts, and in rollback.ts only against the target', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8');
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const deletes = [...code.matchAll(/delete\s+from/gi)];
      if (deletes.length === 0) continue;
      if (file === 'delete-source.ts') continue;
      if (file === 'rollback.ts') {
        // The recopy: every delete statement goes through the target transaction (`tgt`).
        for (const hit of deletes) {
          const before = code.slice(Math.max(0, (hit.index ?? 0) - 40), hit.index);
          if (!before.includes('tgt.unsafe(')) offenders.push(`${file}: delete outside tgt`);
        }
        continue;
      }
      offenders.push(file);
    }
    expect(offenders).toEqual([]);
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8');
      expect(/\btruncate\s+(table\s+)?(public\.|")/i.test(text), `${file} truncates`).toBe(false);
    }
    // Only delete-source.ts opens a writable client on the source side.
    const writable = files.filter((f) =>
      /sourceProject,\s*\{\s*readOnly:\s*false/.test(readFileSync(join(dir, f), 'utf8')),
    );
    expect(writable).toEqual(['delete-source.ts']);
  });
});

describe('central residue (DBT-49)', () => {
  beforeEach(async () => {
    await setup();
  });

  it('P106: with no tenant moved the report is empty and the exit code 0', async () => {
    const central = connect(SRC_URL);
    const result = await centralResidue({ sql: central });
    expect(result.exitCode).toBe(0);
    const summary = result.lines.at(-1);
    expect(summary).toMatchObject({ clean: true, residualRows: 0, foreignAccounts: 0, objects: 0 });
  });

  it('reports the moved tenant until its source is deleted, then is clean (P107: byte-identical runs)', async () => {
    await moveFully();
    const central = connect(SRC_URL);
    const dirty = await centralResidue({ sql: central });
    expect(dirty.exitCode).toBe(1);
    const tables = dirty.lines.filter((l) => l.kind === 'table').map((l) => String(l.table));
    expect(tables).toContain('feed_posts');
    expect([...tables].sort()).toEqual(tables);
    expect(dirty.lines.at(-1)).toMatchObject({ clean: false });
    expect(Number(dirty.lines.at(-1)?.foreignAccounts)).toBeGreaterThanOrEqual(1);

    const again = await centralResidue({ sql: central });
    expect(JSON.stringify(again.lines)).toBe(JSON.stringify(dirty.lines));

    await runMove(opts('confirm-delete', { confirmSlug: t.slug }), h.deps);
    const clean = await centralResidue({ sql: central });
    expect(clean.exitCode).toBe(0);
    expect(JSON.stringify((await centralResidue({ sql: central })).lines)).toBe(
      JSON.stringify(clean.lines),
    );
  });

  it('--strict-empty fails while any table outside the mirror and the platform tables holds a row', async () => {
    const central = connect(SRC_URL);
    const strict = await centralResidue({ sql: central, strictEmpty: true });
    expect(strict.exitCode).toBe(1);
    const strictTables = strict.lines
      .filter((l) => l.kind === 'strict')
      .map((l) => String(l.table));
    expect(strictTables).toContain('memberships');
    expect(strictTables).not.toContain('tenants');
    expect(strictTables).not.toContain('platform_admins');
    expect([...strictTables].sort()).toEqual(strictTables);
  });
});
