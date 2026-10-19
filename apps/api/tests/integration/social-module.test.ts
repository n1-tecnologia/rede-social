import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

/**
 * 09-01 (SOCIAL-01, SOCIAL-02, D-482, D-121) against the live local stack and the real seed: the
 * `social` module is the ONE switch that turns a member into an author, composed in
 * `permissionsFor` and read by the bootstrap and the route guards alike.
 *
 * The seed turns `social` ON for rede-lab and leaves it OFF for rede-demo (planning decision 5), so
 * the tracer reads one tenant of each. Every case that changes a row puts it back in `finally`, and
 * invalidates the per-instance flags cache, the `communities.test.ts` precedent.
 */

type BootstrapBody = {
  tenant: { id: string; slug: string };
  modules: { key: string; nav?: unknown }[];
  permissions: string[];
};

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

const AUTHORING = ['feed.post.create', 'feed.post.manage', 'social.participate'] as const;

const tokens = {
  demoMember: '',
  labMember: '',
  labAdmin: '',
  labSupport: '',
  superAdmin: '',
};
const tenantIds = { demo: '', lab: '' };

const bootstrap = async (token: string): Promise<BootstrapBody> => {
  const res = await api.request('/v1/me/bootstrap', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as BootstrapBody;
};

const platformToggle = (tenantId: string, key: string, enabled: boolean) =>
  api.request(`/v1/platform/tenants/${tenantId}/modules/${key}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${tokens.superAdmin}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ enabled }),
  });

const rowOf = async (tenantId: string, key: string) => {
  const [row] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${tenantId}::uuid and module_key = ${key}`;
  return row;
};

/** Puts a module row back exactly as it was (an upsert, or a delete when there was none). */
async function restoreRow(
  tenantId: string,
  key: string,
  previous: { enabled: boolean } | undefined,
) {
  if (previous) {
    await adminSql`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${tenantId}::uuid, ${key}, ${previous.enabled})
      on conflict (tenant_id, module_key)
      do update set enabled = ${previous.enabled}, updated_at = now()`;
  } else {
    await adminSql`
      delete from public.tenant_modules
       where tenant_id = ${tenantId}::uuid and module_key = ${key}`;
  }
  moduleFlags.invalidate(tenantId);
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  tokens.labSupport = await signInAs('support@rede-lab.local', SEED_PASSWORD);
  tokens.superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  for (const row of rows) {
    if (row.slug === 'rede-demo') tenantIds.demo = row.id;
    if (row.slug === 'rede-lab') tenantIds.lab = row.id;
  }
  moduleFlags.invalidate(tenantIds.demo);
  moduleFlags.invalidate(tenantIds.lab);
});

afterAll(async () => {
  await adminSql.end();
});

describe('09 tracer', () => {
  it('1. a lab member (social on) is an author with a social entry; a demo member (social off) is not', async () => {
    const lab = await bootstrap(tokens.labMember);
    expect(lab.modules.map((m) => m.key)).toContain('social');
    for (const permission of AUTHORING) expect(lab.permissions, permission).toContain(permission);

    const demo = await bootstrap(tokens.demoMember);
    expect(demo.modules.map((m) => m.key)).not.toContain('social');
    for (const permission of AUTHORING) {
      expect(demo.permissions, permission).not.toContain(permission);
    }
  });

  it('2. EP-03: the entry has no nav and sorts after every navigable module', async () => {
    const lab = await bootstrap(tokens.labMember);
    const entry = lab.modules.find((m) => m.key === 'social');
    expect(entry).toBeDefined();
    expect(entry?.nav).toBeUndefined();
    expect(lab.modules.map((m) => m.key)).toEqual(['reels', 'events', 'feed', 'social']);
  });

  it('3. EP-04: neither the lab admin nor the lab support account holds social.participate', async () => {
    for (const token of [tokens.labAdmin, tokens.labSupport]) {
      const body = await bootstrap(token);
      expect(body.permissions).not.toContain('social.participate');
    }
    // The admin keeps the authoring pair the feed manifest gives it, social or not.
    const admin = await bootstrap(tokens.labAdmin);
    expect(admin.permissions).toContain('feed.post.create');
    expect(admin.permissions).toContain('feed.post.manage');
  });

  it('4. EP-01 / D-121: with feed off, social contributes no entry and no permission; feed back on restores both', async () => {
    const previous = await rowOf(tenantIds.lab, 'feed');
    try {
      await adminSql`
        update public.tenant_modules set enabled = false, updated_at = now()
         where tenant_id = ${tenantIds.lab}::uuid and module_key = 'feed'`;
      moduleFlags.invalidate(tenantIds.lab);
      const off = await bootstrap(tokens.labMember);
      expect(off.modules.map((m) => m.key)).not.toContain('social');
      for (const permission of AUTHORING) {
        expect(off.permissions, permission).not.toContain(permission);
      }
    } finally {
      await restoreRow(tenantIds.lab, 'feed', previous);
    }
    const back = await bootstrap(tokens.labMember);
    expect(back.modules.map((m) => m.key)).toContain('social');
    for (const permission of AUTHORING) expect(back.permissions, permission).toContain(permission);
  });

  it('5. T-09-45: a legacy posting-policy blob on the feed row grants a demo member nothing', async () => {
    const [before] = await adminSql<{ settings: unknown }[]>`
      select settings from public.tenant_modules
       where tenant_id = ${tenantIds.demo}::uuid and module_key = 'feed'`;
    try {
      await adminSql`
        update public.tenant_modules
           set settings = settings || '{"postingPolicy":"members"}'::jsonb, updated_at = now()
         where tenant_id = ${tenantIds.demo}::uuid and module_key = 'feed'`;
      moduleFlags.invalidate(tenantIds.demo);
      const body = await bootstrap(tokens.demoMember);
      for (const permission of AUTHORING) {
        expect(body.permissions, permission).not.toContain(permission);
      }
    } finally {
      await adminSql`
        update public.tenant_modules set settings = ${adminSql.json(
          (before?.settings ?? {}) as Parameters<typeof adminSql.json>[0],
        )}, updated_at = now()
         where tenant_id = ${tenantIds.demo}::uuid and module_key = 'feed'`;
      moduleFlags.invalidate(tenantIds.demo);
    }
  });
});

describe('09 toggle', () => {
  it('6. PUT …/modules/social flips the composed permissions on the very next request', async () => {
    const previous = await rowOf(tenantIds.lab, 'social');
    try {
      const off = await platformToggle(tenantIds.lab, 'social', false);
      expect(off.status).toBe(200);
      const offBody = await bootstrap(tokens.labMember);
      expect(offBody.modules.map((m) => m.key)).not.toContain('social');
      for (const permission of AUTHORING) {
        expect(offBody.permissions, permission).not.toContain(permission);
      }

      const on = await platformToggle(tenantIds.lab, 'social', true);
      expect(on.status).toBe(200);
      const onBody = await bootstrap(tokens.labMember);
      expect(onBody.modules.map((m) => m.key)).toContain('social');
      for (const permission of AUTHORING) {
        expect(onBody.permissions, permission).toContain(permission);
      }
    } finally {
      await restoreRow(tenantIds.lab, 'social', previous);
    }
  });

  it('7. the toggle accepts the new key at validation and at the database CHECK', async () => {
    const previous = await rowOf(tenantIds.demo, 'social');
    try {
      const res = await platformToggle(tenantIds.demo, 'social', true);
      expect(res.status).toBe(200);
      const [row] = await adminSql<{ enabled: boolean }[]>`
        select enabled from public.tenant_modules
         where tenant_id = ${tenantIds.demo}::uuid and module_key = 'social'`;
      expect(row?.enabled).toBe(true);
    } finally {
      await restoreRow(tenantIds.demo, 'social', previous);
    }
    // A key outside the vocabulary is still refused.
    const unknown = await platformToggle(tenantIds.demo, 'nao-existe', true);
    expect(unknown.status).toBe(400);
  });

  it('8. EP-02: a tenant with no social row reads as off, and the row can come back', async () => {
    const previous = await rowOf(tenantIds.lab, 'social');
    try {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${tenantIds.lab}::uuid and module_key = 'social'`;
      moduleFlags.invalidate(tenantIds.lab);
      const body = await bootstrap(tokens.labMember);
      expect(body.modules.map((m) => m.key)).not.toContain('social');
      for (const permission of AUTHORING) {
        expect(body.permissions, permission).not.toContain(permission);
      }
    } finally {
      await restoreRow(tenantIds.lab, 'social', previous);
    }
    const back = await bootstrap(tokens.labMember);
    expect(back.modules.map((m) => m.key)).toContain('social');
  });
});
