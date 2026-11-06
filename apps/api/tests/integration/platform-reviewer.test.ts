import { appTabSchema, reviewerCreatedAnswerSchema } from '@rede-social/contracts/native';
import { sqlClient } from '@rede-social/core/db';
import { createReviewer, readAppCredential } from '@rede-social/core/server/apps/index';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminSql,
  api,
  authAdmin,
  deleteProfileFormTenantData,
  SEED_PASSWORD,
  signInAs,
} from './setup';

/**
 * Every line any logger writes in this file is captured, so the sentinel scan reads what a person tailing the
 * logs would see (T-13-55). The mock replaces the ONE root logger every kernel and API logger derives from.
 */
const captured = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock('@rede-social/core/server/logging', async (importOriginal) => {
  const real = await importOriginal<typeof import('@rede-social/core/server/logging')>();
  const text = (value: unknown) =>
    JSON.stringify(value, (_key, item) =>
      item instanceof Error ? { name: item.name, message: item.message, stack: item.stack } : item,
    );
  const make = (bindings: Record<string, unknown>): unknown => {
    const record = (...args: unknown[]) => {
      captured.lines.push(text([bindings, ...args]));
    };
    return {
      info: record,
      warn: record,
      error: record,
      debug: record,
      trace: record,
      fatal: record,
      level: 'trace',
      bindings: () => bindings,
      child: (extra: Record<string, unknown>) => make({ ...bindings, ...extra }),
    };
  };
  const rootLogger = make({});
  return {
    ...real,
    rootLogger,
    moduleLogger: (name: string) =>
      (rootLogger as { child: (b: object) => unknown }).child({ name }),
  };
});

/**
 * Phase 13-31 (D-607, Apple 2.1(a), NATIVE-29, T-13-55): the reviewer account through the real platform routes
 * against the real stack. The tracer creates the account, proves it is a plain `member`, that the password is
 * sealed (and in no response, header, log line or plain column), then rotates it and proves the old password no
 * longer signs in. Concurrency, the refusals and the two gate warnings follow.
 */

const RUN = Date.now().toString(36);
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

let superAdmin = '';
let tenantAdmin = '';
let tenantMember = '';

const platform = (
  path: string,
  init: { method?: string; body?: unknown; token?: string | null } = {},
) => {
  const token = init.token === undefined ? superAdmin : init.token;
  return api.request(`/v1/platform${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
};
const envelopeOf = async (res: Response) => ((await res.json()) as Envelope).error;

// --- Fixtures --------------------------------------------------------------------------------------------

const SLUG = `pr-${RUN}`.slice(0, 40);
const HOST = `pr-${RUN}.cliente.test`;
const RACE_SLUG = `pr-race-${RUN}`.slice(0, 40);
const RACE_HOST = `pr-race-${RUN}.cliente.test`;
const NOHOST_SLUG = `pr-nohost-${RUN}`.slice(0, 40);
const GATE_SLUG = `pr-gate-${RUN}`.slice(0, 40);
const GATE_HOST = `pr-gate-${RUN}.cliente.test`;
const tenantIds: Record<string, string> = {};

async function cleanup(): Promise<void> {
  const reviewers = await adminSql<{ id: string }[]>`
    select id from auth.users where email like 'app-review+%@pr-%'`;
  for (const { id } of reviewers) await authAdmin().deleteUser(id);
  // 12.1: the default-step trigger gives a tenant a step with its first question, and the steps table
  // references `tenants`, so the form goes before the tenants. 12.2: a branch and its opener question
  // reference each other, so the answers, questions, branches and steps go in one deferred transaction.
  const tenants = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug like 'pr-%'`;
  for (const { id } of tenants) await deleteProfileFormTenantData(id);
  await adminSql`delete from public.tenants where slug like 'pr-%'`;
}

async function makeTenant(slug: string, host: string | null): Promise<string> {
  const [tenant] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name)
    values (${slug}, ${`Comunidade Revisor ${slug}`})
    returning id::text as id`;
  const id = tenant?.id ?? '';
  if (host) {
    await adminSql`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
      values (${id}::uuid, ${host}, true, now(), 'verified')`;
  }
  tenantIds[slug] = id;
  return id;
}

/** Everything a person could see: the log lines, plus both tables read as text except the sealed column. */
async function visibleText(tenantId: string): Promise<string> {
  const apps =
    await adminSql`select * from platform.tenant_apps where tenant_id = ${tenantId}::uuid`;
  const creds = await adminSql`
    select id, tenant_id, kind, held_at from platform.tenant_app_credentials
     where tenant_id = ${tenantId}::uuid`;
  return JSON.stringify([captured.lines, apps, creds]);
}

const keysOf = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      found.push(key);
      keysOf(inner, found);
    }
  }
  return found;
};

const sealedRow = async (tenantId: string) => {
  const [row] = await adminSql<{ id: string; sealed: string; n: number }[]>`
    select id::text as id, sealed, count(*) over ()::int as n
      from platform.tenant_app_credentials
     where tenant_id = ${tenantId}::uuid and kind = 'reviewer_password'`;
  return row ?? null;
};

const canSignIn = async (email: string, password: string): Promise<boolean> => {
  try {
    await signInAs(email, password);
    return true;
  } catch {
    return false;
  }
};

beforeAll(async () => {
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }
  await cleanup();
  superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  tenantAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tenantMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  await makeTenant(SLUG, HOST);
  await makeTenant(RACE_SLUG, RACE_HOST);
  await makeTenant(NOHOST_SLUG, null);
  await makeTenant(GATE_SLUG, GATE_HOST);
});

beforeEach(() => {
  captured.lines.length = 0;
});

afterAll(async () => {
  await cleanup();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer: a reviewer member is created with a sealed password, idempotently, and rotated (NATIVE-29, D-607)', () => {
  let email = '';
  let password = '';
  let rowId = '';

  it('creates one confirmed plain member on the tenant host and seals the password; no response, header, log or plain column holds it', async () => {
    const tenantId = tenantIds[SLUG] ?? '';
    const created = await platform(`/tenants/${tenantId}/app/reviewer`, { method: 'POST' });
    expect(created.status).toBe(200);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const createdText = await created.text();
    expect(reviewerCreatedAnswerSchema.parse(JSON.parse(createdText))).toEqual({
      ok: true,
      warnings: [],
    });

    const read = await platform(`/tenants/${tenantId}/app`);
    expect(read.status).toBe(200);
    const readText = await read.text();
    const tab = appTabSchema.parse(JSON.parse(readText));
    expect(tab.listing.reviewerHeld).toBe(true);
    email = tab.listing.reviewerEmail ?? '';
    expect(email).toMatch(new RegExp(`^app-review\\+[0-9a-f]{8}@${HOST.replace(/\./g, '\\.')}$`));
    expect(tab.checklist.auto.reviewer).toBe(true);
    // The listing stub is closed (13-31): the standard text and the template age rating.
    expect(tab.listing.ageRating).toBe('13+');
    expect(tab.listing.description).toContain(`Comunidade Revisor ${SLUG}`);
    expect(tab.listing.description).not.toMatch(/loja|compra|preço|pagamento/i);

    // The account: confirmed, a `member` of this tenant only, no staff role, named 'Revisor do app'.
    const members = await adminSql<
      { role: string; status: string; tenant_id: string; name: string; confirmed: boolean }[]
    >`
      select m.role, m.status, m.tenant_id::text as tenant_id, p.display_name as name,
             u.email_confirmed_at is not null as confirmed
        from auth.users u
        join public.memberships m on m.user_id = u.id
        join public.member_profiles p on p.membership_id = m.id
       where u.email = ${email}`;
    expect(members).toEqual([
      {
        role: 'member',
        status: 'active',
        tenant_id: tenantId,
        name: 'Revisor do app',
        confirmed: true,
      },
    ]);
    const staff = await adminSql`
      select 1 from public.memberships m join auth.users u on u.id = m.user_id
       where u.email = ${email} and m.role <> 'member'`;
    expect(staff).toHaveLength(0);
    const platformAdmin = await adminSql`
      select 1 from public.platform_admins pa join auth.users u on u.id = pa.user_id
       where u.email = ${email}`;
    expect(platformAdmin).toHaveLength(0);

    // The password opens only through the release script's door, and nothing else shows it.
    password = (await readAppCredential(tenantId, 'reviewer_password')) ?? '';
    expect(password).toHaveLength(24);
    const row = await sealedRow(tenantId);
    rowId = row?.id ?? '';
    expect(row?.sealed.startsWith('v1:')).toBe(true);
    expect(row?.sealed).not.toContain(password);
    const headers = JSON.stringify([...created.headers, ...read.headers]);
    const visible = await visibleText(tenantId);
    for (const [place, text] of [
      ['create body', createdText],
      ['read body', readText],
      ['headers', headers],
      ['logs and plain columns', visible],
    ] as const) {
      expect(text, place).not.toContain(password);
    }
    for (const key of keysOf(JSON.parse(readText))) {
      expect(['password', 'reviewerPassword', 'sealed']).not.toContain(key);
    }
    // The address stays out of every log line too (T-13-55: the log names the tenant, nothing else).
    expect(JSON.stringify(captured.lines)).not.toContain(email);

    // And the password is real: it signs in.
    expect(await canSignIn(email, password)).toBe(true);
  });

  it('creating again changes nothing: the same address, one Auth user, one sealed row', async () => {
    const tenantId = tenantIds[SLUG] ?? '';
    const again = await platform(`/tenants/${tenantId}/app/reviewer`, { method: 'POST' });
    expect(again.status).toBe(200);
    const tab = appTabSchema.parse(await (await platform(`/tenants/${tenantId}/app`)).json());
    expect(tab.listing.reviewerEmail).toBe(email);
    const users =
      await adminSql`select 1 from auth.users where email like ${`app-review+%@${HOST}`}`;
    expect(users).toHaveLength(1);
    const row = await sealedRow(tenantId);
    expect(row?.n).toBe(1);
    expect(row?.id).toBe(rowId);
    expect(await readAppCredential(tenantId, 'reviewer_password')).toBe(password);
  });

  it('rotating replaces the password in Auth and in the sealed row: same user, same row id; the old one stops signing in', async () => {
    const tenantId = tenantIds[SLUG] ?? '';
    const [userBefore] = await adminSql<{ id: string }[]>`
      select id::text as id from auth.users where email = ${email}`;

    const rotated = await platform(`/tenants/${tenantId}/app/reviewer/rotate`, { method: 'POST' });
    expect(rotated.status).toBe(200);
    expect(rotated.headers.get('cache-control')).toBe('no-store');
    const rotatedText = await rotated.text();
    expect(JSON.parse(rotatedText)).toEqual({ ok: true });

    const fresh = (await readAppCredential(tenantId, 'reviewer_password')) ?? '';
    expect(fresh).toHaveLength(24);
    expect(fresh).not.toBe(password);
    const row = await sealedRow(tenantId);
    expect(row?.id).toBe(rowId);
    expect(row?.n).toBe(1);
    const [userAfter] = await adminSql<{ id: string }[]>`
      select id::text as id from auth.users where email = ${email}`;
    expect(userAfter?.id).toBe(userBefore?.id);

    expect(await canSignIn(email, password)).toBe(false);
    expect(await canSignIn(email, fresh)).toBe(true);

    const visible = await visibleText(tenantId);
    for (const secret of [password, fresh]) {
      expect(rotatedText).not.toContain(secret);
      expect(visible).not.toContain(secret);
    }
  });
});

describe('the reviewer routes: refusals and closed reasons (T-13-55)', () => {
  it('a tenant admin, a tenant member and an anonymous caller are refused on both routes', async () => {
    const tenantId = tenantIds[SLUG] ?? '';
    for (const [token, status] of [
      [tenantAdmin, 403],
      [tenantMember, 403],
      [null, 401],
    ] as const) {
      for (const path of ['/app/reviewer', '/app/reviewer/rotate']) {
        const res = await platform(`/tenants/${tenantId}${path}`, { method: 'POST', token });
        expect(res.status, `${path} ${token ? 'with a token' : 'anonymous'}`).toBe(status);
      }
    }
  });

  it('a tenant with no verified primary host answers the closed reason no_primary_host and creates nothing', async () => {
    const tenantId = tenantIds[NOHOST_SLUG] ?? '';
    const res = await platform(`/tenants/${tenantId}/app/reviewer`, { method: 'POST' });
    expect(res.status).toBe(409);
    const error = await envelopeOf(res);
    expect(error.code).toBe('CONFLICT');
    expect(error.details).toEqual({ reason: 'no_primary_host' });
    expect(await sealedRow(tenantId)).toBeNull();
  });

  it('rotating before an account exists is the closed reason reviewer_missing', async () => {
    const tenantId = tenantIds[NOHOST_SLUG] ?? '';
    const res = await platform(`/tenants/${tenantId}/app/reviewer/rotate`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect((await envelopeOf(res)).details).toEqual({ reason: 'reviewer_missing' });
  });

  it('an unknown tenant is 404', async () => {
    const res = await platform('/tenants/99999999-9999-4999-8999-999999999999/app/reviewer', {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });
});

describe('concurrency: two simultaneous creations leave exactly one user and one sealed row (NATIVE-29)', () => {
  it('the loser returns the winner address', async () => {
    const tenantId = tenantIds[RACE_SLUG] ?? '';
    const [a, b] = await Promise.all([createReviewer(tenantId), createReviewer(tenantId)]);
    expect(a.email).toBe(b.email);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    const users =
      await adminSql`select 1 from auth.users where email like ${`app-review+%@${RACE_HOST}`}`;
    expect(users).toHaveLength(1);
    expect((await sealedRow(tenantId))?.n).toBe(1);
    const members = await adminSql`
      select 1 from public.memberships where tenant_id = ${tenantId}::uuid and role = 'member'`;
    expect(members).toHaveLength(1);
  });

  it('two simultaneous requests through the route are both answered ok', async () => {
    const tenantId = tenantIds[RACE_SLUG] ?? '';
    const answers = await Promise.all([
      platform(`/tenants/${tenantId}/app/reviewer`, { method: 'POST' }),
      platform(`/tenants/${tenantId}/app/reviewer`, { method: 'POST' }),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    const users =
      await adminSql`select 1 from auth.users where email like ${`app-review+%@${RACE_HOST}`}`;
    expect(users).toHaveLength(1);
  });
});

describe('the two gates are reported, not bypassed (A-13-09)', () => {
  it('a required profile-form question and the payment gate show as closed warnings and the reviewer is granted nothing', async () => {
    const tenantId = tenantIds[GATE_SLUG] ?? '';
    const [adminUser] = await adminSql<{ id: string }[]>`
      select id::text as id from public.users where email = 'admin@rede-demo.local'`;
    await adminSql`
      insert into public.tenant_modules (tenant_id, module_key, enabled, settings)
      values (${tenantId}::uuid, 'profile_form', true, '{}'::jsonb),
             (${tenantId}::uuid, 'payments', true, '{"gate": true}'::jsonb)
      on conflict (tenant_id, module_key) do update set enabled = true, settings = excluded.settings`;
    await adminSql`
      insert into public.profile_form_questions (tenant_id, type, title, required, position, created_by_user_id)
      values (${tenantId}::uuid, 'short_text', 'Qual é o seu nome de guerra?', true, 1, ${adminUser?.id ?? ''}::uuid)`;

    const res = await platform(`/tenants/${tenantId}/app/reviewer`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(reviewerCreatedAnswerSchema.parse(await res.json()).warnings.sort()).toEqual([
      'access_grant_required',
      'profile_form_required',
    ]);

    // Nothing was bypassed: the reviewer has no access grant and no answer.
    const reviewer = await adminSql<{ email: string }[]>`
      select email from auth.users where email like ${`app-review+%@${GATE_HOST}`}`;
    const reviewerEmail = reviewer[0]?.email ?? '';
    const grants = await adminSql`
      select 1 from public.access_grants where tenant_id = ${tenantId}::uuid and email = ${reviewerEmail}`;
    expect(grants).toHaveLength(0);
    const answers = await adminSql`
      select 1 from public.profile_form_answers where tenant_id = ${tenantId}::uuid`;
    expect(answers).toHaveLength(0);
  });
});
