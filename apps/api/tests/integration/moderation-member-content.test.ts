import { sqlClient } from '@rede-social/core/db';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { communityCreateLimiter } from '@rede-social/core/server/safety/limits';
import type { CommunitySummary } from '@rede-social/module-communities/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  HOSTS,
  SEED_PASSWORD,
  signInAs,
  withCommunitiesEnabled,
  withSocialEnabled,
  withStoriesEnabled,
} from './setup';

/**
 * 10-05 (D-711, MCOMM-10; A8; EP-24, EP-25, EP-35, EP-36, EP-37) against the live local stack and the real
 * seed: the COMMUNITY half of the member-content moderation, in the shape of `moderation-posts.test.ts`.
 *
 * A moderator (a holder of `communities.community.manage`, the lab admin) who is NOT the creator moves a
 * `kind = 'member'` community to `archived` or deletes it: ONE `moderation_log` row per action, written in
 * the SAME transaction as the community write (a log failure rolls the write back), naming the creator as
 * the target and the community NAME as the excerpt. The creator's own archive or delete, any action on an
 * organization community, a no-op repeat and an admin's edit of text write no row, and nobody is notified.
 *
 * The moderation log is APPEND-ONLY, so this suite never deletes log rows: every assertion is scoped by
 * the subject id it created. Fixture communities carry `PREFIX` and the test members' member communities
 * are swept in `beforeAll` and `afterAll`. Test ORDER inside a describe is load-bearing.
 */

type Envelope = { error: { code: string; message?: string; details?: Record<string, unknown> } };

const PREFIX = 'Teste 10-05 mod ';
const tokens = { helena: '', marcos: '', labAdmin: '' };
const userIds = { helena: '', marcos: '', labAdmin: '' };
let labTenantId = '';
let restoreSocial: () => Promise<void> = async () => {};
let restoreCommunities: () => Promise<void> = async () => {};
let restoreStories: () => Promise<void> = async () => {};
let restoreNotifications: () => Promise<void> = async () => {};

const request = (path: string, token: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': HOSTS.lab,
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const patch = (body: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(body) });
const errorOf = async (res: Response) => ((await res.json()) as Envelope).error;

const create = async (token: string, name: string, description = ''): Promise<string> => {
  const res = await request('/v1/communities', token, {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
  expect(res.status, `POST /v1/communities ${name}`).toBe(201);
  return ((await res.json()) as CommunitySummary).id;
};
const archive = (token: string, id: string) =>
  request(`/v1/communities/${id}`, token, patch({ status: 'archived' }));
const remove = (token: string, id: string) =>
  request(`/v1/communities/${id}`, token, { method: 'DELETE' });

async function userOf(email: string): Promise<string> {
  const [row] = await adminSql<{ user_id: string }[]>`
    select m.user_id from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return row.user_id;
}

type LogRow = {
  action: string;
  actor_user_id: string;
  target_user_id: string;
  subject_type: string | null;
  subject_id: string | null;
  excerpt: string | null;
  reason: string | null;
};

const logRowsFor = (subjectId: string) =>
  adminSql<LogRow[]>`
    select action, actor_user_id::text, target_user_id::text, subject_type, subject_id::text,
           excerpt, reason
      from public.moderation_log
     where tenant_id = ${labTenantId}::uuid and subject_id = ${subjectId}::uuid
     order by created_at, id`;

const stateOf = async (id: string) => {
  const [row] = await adminSql<{ status: string; deleted_at: string | null; name: string }[]>`
    select status, deleted_at::text, name from public.communities where id = ${id}::uuid`;
  return row;
};

async function sweep(): Promise<void> {
  await adminSql`
    delete from public.feed_posts
     where community_id in (select id from public.communities where name like ${`${PREFIX}%`})`;
  await adminSql`delete from public.communities where name like ${`${PREFIX}%`}`;
}

async function withNotificationsEnabled(): Promise<() => Promise<void>> {
  const [previous] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${labTenantId}::uuid and module_key = 'notifications'`;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${labTenantId}::uuid, 'notifications', true)
    on conflict (tenant_id, module_key) do update set enabled = true, updated_at = now()`;
  moduleFlags.invalidate(labTenantId);
  return async () => {
    if (previous) {
      await adminSql`
        update public.tenant_modules set enabled = ${previous.enabled}, updated_at = now()
         where tenant_id = ${labTenantId}::uuid and module_key = 'notifications'`;
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${labTenantId}::uuid and module_key = 'notifications'`;
    }
    moduleFlags.invalidate(labTenantId);
  };
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  restoreSocial = await withSocialEnabled('lab');
  restoreCommunities = await withCommunitiesEnabled('lab');
  restoreStories = await withStoriesEnabled('lab');
  tokens.helena = await signInAs('helena.kuster@rede-lab.local', SEED_PASSWORD);
  tokens.marcos = await signInAs('marcos.vinicius@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  userIds.helena = await userOf('helena.kuster@rede-lab.local');
  userIds.marcos = await userOf('marcos.vinicius@rede-lab.local');
  userIds.labAdmin = await userOf('admin@rede-lab.local');
  const [lab] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = 'rede-lab'`;
  labTenantId = lab?.id ?? '';
  restoreNotifications = await withNotificationsEnabled();
  await sweep();
});

beforeEach(() => {
  communityCreateLimiter.reset();
});

afterAll(async () => {
  await sweep();
  await restoreNotifications();
  await restoreStories();
  await restoreCommunities();
  await restoreSocial();
  await adminSql.end();
  await sqlClient.end();
});

describe('10 moderation of member communities', () => {
  beforeEach(async () => {
    await sweep();
  });

  it('EP-35 adjacency: a moderator’s archive then delete of a member community writes exactly two rows in that order, naming the creator and the community', async () => {
    const id = await create(tokens.helena, `${PREFIX}Corrida`, 'descrição que não vai ao log');
    expect((await archive(tokens.labAdmin, id)).status).toBe(200);
    expect((await remove(tokens.labAdmin, id)).status).toBe(204);
    const rows = await logRowsFor(id);
    expect(rows.map((row) => row.action)).toEqual(['community_archived', 'community_removed']);
    for (const row of rows) {
      expect(row.subject_type).toBe('community');
      expect(row.actor_user_id).toBe(userIds.labAdmin);
      expect(row.target_user_id).toBe(userIds.helena);
      expect(row.excerpt).toBe(`${PREFIX}Corrida`);
      expect(row.reason).toBeNull();
    }
  });

  it('EP-35: the creator’s own archive and delete write no row; an organization community’s archive and delete write none either', async () => {
    const own = await create(tokens.helena, `${PREFIX}própria`);
    expect((await archive(tokens.helena, own)).status).toBe(200);
    expect((await remove(tokens.helena, own)).status).toBe(204);
    expect(await logRowsFor(own)).toHaveLength(0);

    const org = await create(tokens.labAdmin, `${PREFIX}da organização`);
    expect((await archive(tokens.labAdmin, org)).status).toBe(200);
    expect((await remove(tokens.labAdmin, org)).status).toBe(204);
    expect(await logRowsFor(org)).toHaveLength(0);
  });

  it('EP-36: a member community with an empty description and no cover logs the capped name as the excerpt; the description never reaches the log', async () => {
    const empty = await create(tokens.helena, `${PREFIX}sem descrição`);
    expect((await archive(tokens.labAdmin, empty)).status).toBe(200);
    expect((await logRowsFor(empty))[0]?.excerpt).toBe(`${PREFIX}sem descrição`);

    const secret = 'SEGREDO-DA-DESCRICAO-10-05';
    const withText = await create(tokens.helena, `${PREFIX}com descrição`, secret);
    expect((await archive(tokens.labAdmin, withText)).status).toBe(200);
    const rows = await logRowsFor(withText);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it('A8: an admin editing a member community’s name, description or cover is allowed and NOT logged', async () => {
    const id = await create(tokens.helena, `${PREFIX}editada pelo admin`);
    const edit = await request(
      `/v1/communities/${id}`,
      tokens.labAdmin,
      patch({ description: 'ajustada' }),
    );
    expect(edit.status).toBe(200);
    expect(await logRowsFor(id)).toHaveLength(0);
  });

  it('EP-24 idempotency: archiving an already archived community writes no second row; deleting twice answers the bare 404 the second time', async () => {
    const id = await create(tokens.helena, `${PREFIX}repetida`);
    expect((await archive(tokens.labAdmin, id)).status).toBe(200);
    expect((await archive(tokens.labAdmin, id)).status).toBe(200);
    expect(await logRowsFor(id)).toHaveLength(1);
    expect((await remove(tokens.labAdmin, id)).status).toBe(204);
    const second = await remove(tokens.labAdmin, id);
    expect(second.status).toBe(404);
    expect((await errorOf(second)).details).toBeUndefined();
    expect((await logRowsFor(id)).map((row) => row.action)).toEqual([
      'community_archived',
      'community_removed',
    ]);
  });

  it('EP-25 concurrency: the creator and a moderator archiving at the same time produce one transition and at most one row', async () => {
    const id = await create(tokens.helena, `${PREFIX}corrida de arquivos`);
    const [a, b] = await Promise.all([archive(tokens.helena, id), archive(tokens.labAdmin, id)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await stateOf(id))?.status).toBe('archived');
    expect((await logRowsFor(id)).length).toBeLessThanOrEqual(1);
  });

  it('EP-37 ordering: the two rows list newest first through the moderation log, and nobody is notified', async () => {
    // The log is append-only and rows survive a rerun: a name unique to this run scopes the listing.
    const name = `${PREFIX}ordem do log ${Date.now()}`;
    const id = await create(tokens.helena, name);
    expect((await archive(tokens.labAdmin, id)).status).toBe(200);
    expect((await remove(tokens.labAdmin, id)).status).toBe(204);
    const res = await request('/v1/admin/moderation-log?limit=50', tokens.labAdmin);
    expect(res.status).toBe(200);
    const items = (
      (await res.json()) as {
        items: { action: string; subjectType: string | null; excerpt: string | null }[];
      }
    ).items.filter((item) => item.excerpt === name);
    expect(items.map((item) => item.action)).toEqual(['community_removed', 'community_archived']);
    expect(items.every((item) => item.subjectType === 'community')).toBe(true);
    const [notified] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.notifications
       where tenant_id = ${labTenantId}::uuid and subject_id = ${id}::uuid`;
    expect(notified?.n).toBe(0);
  });

  it('EP-37 / T-10-17: the log insert is in the community write’s transaction - a forced log failure leaves the community unchanged', async () => {
    const id = await create(tokens.helena, `${PREFIX}atomicidade`);
    await adminSql.unsafe(`
      create or replace function public.test_moderation_log_fail() returns trigger
        language plpgsql as $$ begin raise exception 'forced log failure'; end $$;
      create trigger test_moderation_log_fail before insert on public.moderation_log
        for each row execute function public.test_moderation_log_fail();`);
    try {
      const res = await archive(tokens.labAdmin, id);
      expect(res.status).toBe(500);
      expect((await stateOf(id))?.status).toBe('active');
      expect(await logRowsFor(id)).toHaveLength(0);
      // Archived by the creator (no row needed), then the moderator's DELETE fails the same way.
      expect((await archive(tokens.helena, id)).status).toBe(200);
      const del = await remove(tokens.labAdmin, id);
      expect(del.status).toBe(500);
      expect((await stateOf(id))?.deleted_at).toBeNull();
    } finally {
      await adminSql.unsafe(`
        drop trigger if exists test_moderation_log_fail on public.moderation_log;
        drop function if exists public.test_moderation_log_fail();`);
    }
    // Positive control: with the log working again the removal commits with its row.
    expect((await remove(tokens.labAdmin, id)).status).toBe(204);
    expect((await logRowsFor(id)).map((row) => row.action)).toEqual(['community_removed']);
  });

  it('D-718 / MPUB-05: with social off the moderator’s archive and delete still work (and log) while the creator’s write is 403', async () => {
    const id = await create(tokens.helena, `${PREFIX}social desligado`);
    await adminSql`
      update public.tenant_modules set enabled = false
       where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
    moduleFlags.invalidate(labTenantId);
    try {
      const own = await request(
        `/v1/communities/${id}`,
        tokens.helena,
        patch({ name: `${PREFIX}renomeada` }),
      );
      expect(own.status).toBe(403);
      expect((await remove(tokens.helena, id)).status).toBe(403);
      expect((await archive(tokens.labAdmin, id)).status).toBe(200);
      expect((await remove(tokens.labAdmin, id)).status).toBe(204);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${labTenantId}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(labTenantId);
    }
    expect((await logRowsFor(id)).map((row) => row.action)).toEqual([
      'community_archived',
      'community_removed',
    ]);
  });
});
