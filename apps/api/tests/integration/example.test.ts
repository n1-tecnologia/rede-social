import { sqlClient } from '@tria/core/db';
import { subscribe } from '@tria/core/server/events/bus';
import { stopBoss } from '@tria/core/server/jobs/boss';
import {
  EXAMPLE_PROCESS_QUEUE,
  type ExampleItem,
  type ExampleItemCreated,
} from '@tria/module-example/contracts';
import { exampleProcessJob } from '@tria/module-example/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * `@tria/module-example` end to end against the live local stack and the real seed (D-17/D-19):
 * the guard chain, tenant isolation, the transactional enqueue, the domain event, and the worker
 * handler running under RLS. This is the test that would fail if the module contract were only
 * documented rather than enforced.
 */

type Envelope = { error: { code: string } };

const tokens = { demoAdmin: '', demoMember: '', labAdmin: '' };
const tenantIds = { demo: '', lab: '' };
const created: string[] = [];
const events: ExampleItemCreated[] = [];
let unsubscribe: () => void = () => {};

const request = (path: string, token?: string, init: RequestInit = {}) =>
  api.request(path, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });

const code = async (res: Response) => ((await res.json()) as Envelope).error.code;

/** Insert straight through the admin connection: a row this tenant's lane must never return. */
async function seedItem(tenantId: string, title: string, createdAt?: string): Promise<string> {
  const [user] = await adminSql<{ id: string }[]>`
    select u.id from public.users u
      join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${tenantId}::uuid limit 1`;
  const rows = await adminSql<{ id: string }[]>`
    insert into public.example_items (tenant_id, title, created_by_user_id, created_at)
    values (
      ${tenantId}::uuid,
      ${title},
      ${user?.id ?? null}::uuid,
      ${createdAt ?? new Date().toISOString()}::timestamptz
    )
    returning id`;
  const id = rows[0]?.id ?? '';
  created.push(id);
  return id;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');

  tokens.demoAdmin = await signInAs('admin@tria-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@tria-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@tria-lab.local', SEED_PASSWORD);

  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('tria-demo', 'tria-lab')`;
  for (const row of rows) {
    if (row.slug === 'tria-demo') tenantIds.demo = row.id;
    if (row.slug === 'tria-lab') tenantIds.lab = row.id;
  }

  unsubscribe = subscribe('example.item.created', async (payload) => {
    events.push(payload);
  });
});

afterAll(async () => {
  unsubscribe();
  if (created.length > 0) {
    await adminSql`delete from public.example_items where id = any(${created}::uuid[])`;
  }
  await adminSql`delete from public.example_items where title like 'Item de teste%'`;
  await adminSql`delete from pgboss.job_common where name = ${EXAMPLE_PROCESS_QUEUE}`;
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('@tria/module-example — routes, isolation, jobs and events', () => {
  it('1. the admin creates an item, the job is enqueued in the SAME transaction, the event fires', async () => {
    const title = `Item de teste ${Date.now()}`;
    const res = await request('/v1/example/items', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ title }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(201);

    const item = (await res.json()) as ExampleItem;
    created.push(item.id);
    expect(item.title).toBe(title);
    expect(item.tenantId).toBe(tenantIds.demo);
    expect(item.processedAt).toBeNull();
    // T-07-01: authorship comes from the session, never from the body.
    expect(item.createdByUserId).toMatch(/^[0-9a-f-]{36}$/);

    const jobs = await adminSql<{ data: { itemId: string; tenantId: string } }[]>`
      select data from pgboss.job_common
       where name = ${EXAMPLE_PROCESS_QUEUE} and data->>'itemId' = ${item.id}`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data.tenantId).toBe(tenantIds.demo);

    // Delivered by `flushEventsAfterHandler`, i.e. after the handler's transaction committed.
    expect(events.filter((e) => e.itemId === item.id)).toHaveLength(1);
  });

  it('2. a member may read but not create (403 FORBIDDEN), and the item is in the list', async () => {
    const forbidden = await request('/v1/example/items', tokens.demoMember, {
      method: 'POST',
      body: JSON.stringify({ title: 'Item de teste membro' }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(forbidden.status).toBe(403);
    expect(await code(forbidden)).toBe('FORBIDDEN');

    const list = await request('/v1/example/items', tokens.demoMember, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(list.status).toBe(200);
    const { items } = (await list.json()) as { items: ExampleItem[] };
    expect(items.map((i) => i.id)).toContain(created[0]);
  });

  it('3. a tenant without the module gets 404 MODULE_DISABLED, and no token gets 401', async () => {
    const disabled = await request('/v1/example/items', tokens.labAdmin, {
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(disabled.status).toBe(404);
    expect(await code(disabled)).toBe('MODULE_DISABLED');

    const anonymous = await request('/v1/example/items');
    expect(anonymous.status).toBe(401);
    // 401 before 404: an anonymous probe never learns whether the module exists here.
    expect(await code(anonymous)).toBe('UNAUTHENTICATED');
  });

  it('4. cross-tenant: tria-lab rows are invisible to tria-demo, by list and by id (T-07-02)', async () => {
    const labItemId = await seedItem(tenantIds.lab, 'Item de teste lab');

    const list = await request('/v1/example/items', tokens.demoAdmin, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    const { items } = (await list.json()) as { items: ExampleItem[] };
    expect(items.map((i) => i.id)).not.toContain(labItemId);
    expect(items.every((i) => i.tenantId === tenantIds.demo)).toBe(true);

    // The other tenant's row is NOT FOUND, not FORBIDDEN: the 404 does not confirm it exists.
    const byId = await request(`/v1/example/items/${labItemId}`, tokens.demoAdmin, {
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(byId.status).toBe(404);
    expect(await code(byId)).toBe('NOT_FOUND');
  });

  it('5. TENANT-03 ordering is stable when created_at ties (created_at desc, id desc)', async () => {
    const sameInstant = new Date().toISOString();
    const a = await seedItem(tenantIds.demo, 'Item de teste tie A', sameInstant);
    const b = await seedItem(tenantIds.demo, 'Item de teste tie B', sameInstant);
    const expected = [a, b].sort((x, y) => (x > y ? -1 : 1));

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await request('/v1/example/items', tokens.demoAdmin, {
        headers: { 'x-tenant-host': HOSTS.demo },
      });
      const { items } = (await res.json()) as { items: ExampleItem[] };
      const tie = items.filter((i) => i.id === a || i.id === b).map((i) => i.id);
      expect(tie).toEqual(expected);
    }
  });

  it('6. the worker handler marks the item processed through the tenant lane', async () => {
    const itemId = created[0] ?? '';
    await exampleProcessJob.handler({ tenantId: tenantIds.demo, itemId });

    const [row] = await adminSql<{ processed_at: Date | null }[]>`
      select processed_at from public.example_items where id = ${itemId}::uuid`;
    expect(row?.processed_at).not.toBeNull();
  });

  it('7. a job payload naming the wrong tenant updates zero rows (T-07-03)', async () => {
    const itemId = await seedItem(tenantIds.demo, 'Item de teste rls');
    await exampleProcessJob.handler({ tenantId: tenantIds.lab, itemId });

    const [row] = await adminSql<{ processed_at: Date | null }[]>`
      select processed_at from public.example_items where id = ${itemId}::uuid`;
    // RLS filtered the row out entirely: the job neither failed loudly nor touched another tenant.
    expect(row?.processed_at).toBeNull();
  });

  it('8. the body is validated: an empty title is 400 VALIDATION_FAILED', async () => {
    const res = await request('/v1/example/items', tokens.demoAdmin, {
      method: 'POST',
      body: JSON.stringify({ title: '   ' }),
      headers: { 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(400);
    expect(await code(res)).toBe('VALIDATION_FAILED');
  });
});
