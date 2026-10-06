import { bootstrapSchema, TENANT_HOST_HEADER } from '@rede-social/contracts';
import { joinResponseSchema, joinStateSchema } from '@rede-social/contracts/join';
import { sqlClient } from '@rede-social/core/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  SEED_PASSWORD,
  signInAs,
} from './setup';

/**
 * 08.1-01 (V2-PLAT-07, D-305, D-306, D-307, D-311) — `/v1/join`, the identity lane, against the live
 * local stack. Every case runs on THROWAWAY identities (`createSharedIdentity`), never on a seed user:
 * joining a seed user to a second tenant would drift the count-based suites.
 */

const TRACER = 'jt';
/** The guard matrix (cases a-l) builds its throwaway identities with this e-mail prefix. */
const MATRIX = 'jn';
const STAMP = Date.now().toString(36);
const SUSPENDED_SLUG = `jn-susp-${STAMP}`.slice(0, 40);
const SUSPENDED_HOST = `${SUSPENDED_SLUG}.localhost`;

type JoinBody = {
  name: string;
  consents: { tenantRulesVersion: number; platformTermsVersion: number };
};

const request = (
  path: string,
  token: string | null,
  host: string | null,
  init: { method?: string; body?: unknown } = {},
) =>
  api.request(path, {
    method: init.method ?? 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(host ? { [TENANT_HOST_HEADER]: host } : {}),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

async function rulesVersionOf(host: string): Promise<number> {
  const [row] = await adminSql<{ rules_version: number }[]>`
    select t.rules_version from public.tenants t
      join public.tenant_domains d on d.tenant_id = t.id
     where d.host = ${host} and d.verified_at is not null`;
  if (!row) throw new Error(`no tenant behind ${host}`);
  return row.rules_version;
}

async function joinBody(host: string, name: string): Promise<JoinBody> {
  return {
    name,
    consents: { tenantRulesVersion: await rulesVersionOf(host), platformTermsVersion: 1 },
  };
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  await removeIdentitiesByPrefix(TRACER);
  await removeIdentitiesByPrefix(MATRIX);
});

afterAll(async () => {
  await removeIdentitiesByPrefix(TRACER);
  await removeIdentitiesByPrefix(MATRIX);
  await adminSql`delete from public.tenants where slug = ${SUSPENDED_SLUG}`;
  await adminSql.end();
  await sqlClient.end();
});

describe('join tracer', () => {
  it('a member of rede-demo signs in on rede-lab, joins it with a typed name, and stays a member of rede-demo', async () => {
    const shared = await createSharedIdentity({
      prefix: TRACER,
      memberships: [{ host: 'demo', displayName: 'Nome na Demo' }],
    });
    const token = await signInAs(shared.email, shared.password);

    // Before: the lab host knows no membership of this identity — the tenant lane refuses...
    const refused = await request('/v1/me/bootstrap', token, HOSTS.lab);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'TENANT_HOST_MISMATCH',
    );
    // ...and the identity lane says the lab community is joinable.
    const state = await request('/v1/join/state', token, HOSTS.lab);
    expect(state.status).toBe(200);
    expect(joinStateSchema.parse(await state.json())).toEqual({ state: 'joinable' });

    const typed = 'Nome no Lab';
    const joined = await request('/v1/join', token, HOSTS.lab, {
      method: 'POST',
      body: await joinBody(HOSTS.lab, typed),
    });
    expect(joined.status).toBe(200);
    expect(joinResponseSchema.parse(await joined.json())).toEqual({
      outcome: 'joined',
      tenantSlug: 'rede-lab',
    });

    // After: the SAME token bootstraps into rede-lab on the lab host, as a member, with the typed name.
    const lab = await request('/v1/me/bootstrap', token, HOSTS.lab);
    expect(lab.status).toBe(200);
    const labBody = bootstrapSchema.parse(await lab.json());
    expect(labBody.tenant.slug).toBe('rede-lab');
    expect(labBody.membership.role).toBe('member');
    expect(labBody.membership.profile.displayName).toBe(typed);

    // ...and still into rede-demo on the demo host, with the demo name untouched.
    const demo = await request('/v1/me/bootstrap', token, HOSTS.demo);
    expect(demo.status).toBe(200);
    const demoBody = bootstrapSchema.parse(await demo.json());
    expect(demoBody.tenant.slug).toBe('rede-demo');
    expect(demoBody.membership.profile.displayName).toBe('Nome na Demo');

    // Exactly two live memberships and exactly the two lab consents for this identity.
    const [counts] = await adminSql<{ memberships: number; lab_consents: number }[]>`
      select
        (select count(*)::int from public.memberships m
          where m.user_id = ${shared.userId}::uuid and m.deleted_at is null) as memberships,
        (select count(*)::int from public.consent_records c
           join public.tenants t on t.id = c.tenant_id
          where c.user_id = ${shared.userId}::uuid and t.slug = 'rede-lab') as lab_consents`;
    expect(counts).toEqual({ memberships: 2, lab_consents: 2 });
  });
});

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

/**
 * The join guard matrix (08.1-01 Task 3): every refusal of `joinTenant`, in the order the service
 * checks them, plus idempotency, the race, the generic-host slug, D-311 and the D-302 byte check.
 */
describe('join guard matrix', () => {
  const tenants = {
    demo: { id: '', slug: 'rede-demo', name: '' },
    lab: { id: '', slug: 'rede-lab', name: '' },
  };
  const platformHost = process.env.PLATFORM_HOST ?? '';
  /** Every response body read while acting on each tenant host (case k checks them byte by byte). */
  const bodies: Record<'demo' | 'lab', string[]> = { demo: [], lab: [] };

  /** A request whose body is recorded under the tenant host it acted on. */
  async function call(
    path: string,
    token: string | null,
    host: string | null,
    init: { method?: string; body?: unknown } = {},
  ): Promise<{ status: number; json: unknown }> {
    const res = await request(path, token, host, init);
    const text = await res.text();
    if (host === HOSTS.demo) bodies.demo.push(text);
    if (host === HOSTS.lab) bodies.lab.push(text);
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  const stateOf = async (token: string, host: string | null) => call('/v1/join/state', token, host);
  const joinOn = async (token: string, host: string | null, body: unknown) =>
    call('/v1/join', token, host, { method: 'POST', body });

  /** A throwaway identity with `memberships`, signed in. */
  async function identity(memberships: Parameters<typeof createSharedIdentity>[0]['memberships']) {
    const created = await createSharedIdentity({ prefix: MATRIX, memberships });
    return { ...created, token: await signInAs(created.email, created.password) };
  }

  /** Rows the identity owns: every membership (deleted ones too), profile and consent. */
  async function countsOf(userId: string) {
    const [row] = await adminSql<{ memberships: number; profiles: number; consents: number }[]>`
      select
        (select count(*)::int from public.memberships where user_id = ${userId}::uuid) as memberships,
        (select count(*)::int from public.member_profiles where user_id = ${userId}::uuid) as profiles,
        (select count(*)::int from public.consent_records where user_id = ${userId}::uuid) as consents`;
    return row;
  }

  async function labRowsOf(userId: string) {
    const [row] = await adminSql<{ memberships: number; consents: number }[]>`
      select
        (select count(*)::int from public.memberships
          where user_id = ${userId}::uuid and tenant_id = ${tenants.lab.id}::uuid) as memberships,
        (select count(*)::int from public.consent_records
          where user_id = ${userId}::uuid and tenant_id = ${tenants.lab.id}::uuid) as consents`;
    return row;
  }

  const code = (json: unknown) => (json as Envelope).error.code;
  const details = (json: unknown) => (json as Envelope).error.details;
  const setLab = (userId: string, set: 'blocked' | 'deleted') =>
    set === 'blocked'
      ? adminSql`update public.memberships set blocked_at = now()
                  where user_id = ${userId}::uuid and tenant_id = ${tenants.lab.id}::uuid`
      : adminSql`update public.memberships set deleted_at = now()
                  where user_id = ${userId}::uuid and tenant_id = ${tenants.lab.id}::uuid`;

  beforeAll(async () => {
    if (!platformHost) throw new Error('PLATFORM_HOST is required (see scripts/local-env.sh)');
    for (const key of ['demo', 'lab'] as const) {
      const [row] = await adminSql<{ id: string; display_name: string }[]>`
        select id::text as id, display_name from public.tenants where slug = ${tenants[key].slug}`;
      if (!row) throw new Error(`tenant ${tenants[key].slug} is not seeded`);
      tenants[key].id = row.id;
      tenants[key].name = row.display_name;
    }
    // A suspended community with a verified host, where the identities below hold no membership.
    const [suspended] = await adminSql<{ id: string }[]>`
      insert into public.tenants (slug, display_name, rules_text, rules_version, status)
      values (${SUSPENDED_SLUG}, 'Comunidade Suspensa JN', 'Regras de teste.', 1, 'suspended')
      returning id`;
    await adminSql`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
      values (${suspended?.id ?? ''}::uuid, ${SUSPENDED_HOST}, true, now())`;
  });

  it('a. no community to ask about: state on a generic host is 404; state and join on the platform host are 404', async () => {
    const s = await identity([{ host: 'demo' }]);
    expect((await stateOf(s.token, 'localhost')).status).toBe(404);
    const platformState = await stateOf(s.token, platformHost);
    expect(platformState.status).toBe(404);
    expect(code(platformState.json)).toBe('NOT_FOUND');
    // Even naming a real community in the body, the platform host joins nothing (D-21).
    const platformJoin = await joinOn(s.token, platformHost, {
      ...(await joinBody(HOSTS.lab, 'Plataforma')),
      slug: 'rede-lab',
    });
    expect(platformJoin.status).toBe(404);
    expect(code(platformJoin.json)).toBe('NOT_FOUND');
    expect(await labRowsOf(s.userId)).toEqual({ memberships: 0, consents: 0 });
  });

  it('b. state names exactly one fact about the host community: member, invited, blocked, removed, platform_admin, suspended', async () => {
    const member = await identity([{ host: 'lab' }]);
    expect((await stateOf(member.token, HOSTS.lab)).json).toEqual({ state: 'member' });

    const invited = await identity([{ host: 'lab', status: 'invited' }]);
    expect((await stateOf(invited.token, HOSTS.lab)).json).toEqual({ state: 'invited' });

    const blocked = await identity([{ host: 'lab' }]);
    await setLab(blocked.userId, 'blocked');
    expect((await stateOf(blocked.token, HOSTS.lab)).json).toEqual({ state: 'blocked' });

    const removed = await identity([{ host: 'lab' }]);
    await setLab(removed.userId, 'deleted');
    expect((await stateOf(removed.token, HOSTS.lab)).json).toEqual({ state: 'removed' });

    const admin = await identity([]);
    await adminSql`insert into public.platform_admins (user_id) values (${admin.userId}::uuid)`;
    expect((await stateOf(admin.token, HOSTS.lab)).json).toEqual({ state: 'platform_admin' });

    const outsider = await identity([]);
    expect((await stateOf(outsider.token, SUSPENDED_HOST)).json).toEqual({ state: 'suspended' });
  });

  it('c. D-304: blocked in rede-lab -> joining rede-lab is MEMBERSHIP_BLOCKED { Rede Lab } and writes nothing; blocked in rede-demo -> joining rede-lab succeeds', async () => {
    const blockedHere = await identity([{ host: 'lab' }]);
    await setLab(blockedHere.userId, 'blocked');
    const before = await countsOf(blockedHere.userId);
    const refused = await joinOn(
      blockedHere.token,
      HOSTS.lab,
      await joinBody(HOSTS.lab, 'Tentativa'),
    );
    expect(refused.status).toBe(403);
    expect(code(refused.json)).toBe('MEMBERSHIP_BLOCKED');
    expect(details(refused.json)?.tenantName).toBe(tenants.lab.name);
    expect(await countsOf(blockedHere.userId)).toEqual(before);

    const blockedElsewhere = await identity([{ host: 'demo', status: 'blocked' }]);
    const joined = await joinOn(
      blockedElsewhere.token,
      HOSTS.lab,
      await joinBody(HOSTS.lab, 'Bloqueado na Demo'),
    );
    expect(joined.status).toBe(200);
    expect(joined.json).toEqual({ outcome: 'joined', tenantSlug: 'rede-lab' });
  });

  it('d. D-29: invited in rede-lab -> 409 invite_pending; Pitfall 9: soft-deleted in rede-lab -> 403 FORBIDDEN and the row stays deleted', async () => {
    const invited = await identity([{ host: 'lab', status: 'invited' }]);
    const pending = await joinOn(invited.token, HOSTS.lab, await joinBody(HOSTS.lab, 'Convidado'));
    expect(pending.status).toBe(409);
    expect(code(pending.json)).toBe('INVITE_STATE_INVALID');
    expect(details(pending.json)).toEqual({ reason: 'invite_pending' });

    const removed = await identity([{ host: 'lab' }]);
    await setLab(removed.userId, 'deleted');
    const refused = await joinOn(removed.token, HOSTS.lab, await joinBody(HOSTS.lab, 'Removido'));
    expect(refused.status).toBe(403);
    expect(code(refused.json)).toBe('FORBIDDEN');
    expect((refused.json as Envelope).error).not.toHaveProperty('details');
    const [row] = await adminSql<{ deleted: boolean }[]>`
      select deleted_at is not null as deleted from public.memberships
       where user_id = ${removed.userId}::uuid and tenant_id = ${tenants.lab.id}::uuid`;
    expect(row?.deleted).toBe(true);
  });

  it('e. D-316: a platform account -> 403 FORBIDDEN and zero rows written', async () => {
    const admin = await identity([]);
    await adminSql`insert into public.platform_admins (user_id) values (${admin.userId}::uuid)`;
    const refused = await joinOn(admin.token, HOSTS.lab, await joinBody(HOSTS.lab, 'Plataforma'));
    expect(refused.status).toBe(403);
    expect(code(refused.json)).toBe('FORBIDDEN');
    expect(await countsOf(admin.userId)).toEqual({ memberships: 0, profiles: 0, consents: 0 });
  });

  it('f. stale consents -> 400 { consents: "stale" } and zero rows written', async () => {
    const s = await identity([{ host: 'demo' }]);
    const before = await countsOf(s.userId);
    const body = await joinBody(HOSTS.lab, 'Desatualizado');
    const stale = await joinOn(s.token, HOSTS.lab, {
      ...body,
      consents: { ...body.consents, tenantRulesVersion: body.consents.tenantRulesVersion + 1 },
    });
    expect(stale.status).toBe(400);
    expect(details(stale.json)).toEqual({ consents: 'stale' });
    expect(await countsOf(s.userId)).toEqual(before);
  });

  it('g. idempotency: joining twice answers joined then already_member, and the second call writes nothing', async () => {
    const s = await identity([{ host: 'demo' }]);
    const body = await joinBody(HOSTS.lab, 'Duas Vezes');
    expect((await joinOn(s.token, HOSTS.lab, body)).json).toEqual({
      outcome: 'joined',
      tenantSlug: 'rede-lab',
    });
    const afterFirst = await countsOf(s.userId);
    expect(afterFirst).toEqual({ memberships: 2, profiles: 2, consents: 2 });
    const replay = await joinOn(s.token, HOSTS.lab, body);
    expect(replay.status).toBe(200);
    expect(replay.json).toEqual({ outcome: 'already_member', tenantSlug: 'rede-lab' });
    expect(await countsOf(s.userId)).toEqual(afterFirst);
  });

  it('h. concurrency: two joins at once both answer 200, and exactly one membership and two consents exist', async () => {
    const s = await identity([{ host: 'demo' }]);
    const body = await joinBody(HOSTS.lab, 'Ao Mesmo Tempo');
    const [first, second] = await Promise.all([
      joinOn(s.token, HOSTS.lab, body),
      joinOn(s.token, HOSTS.lab, body),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const outcomes = [first.json, second.json].map((j) => (j as { outcome: string }).outcome);
    expect(outcomes.sort()).toEqual(['already_member', 'joined']);
    expect(await labRowsOf(s.userId)).toEqual({ memberships: 1, consents: 2 });
  });

  it('i. a generic host joins the community body.slug names; a tenant host ignores a foreign body.slug', async () => {
    const generic = await identity([{ host: 'demo' }]);
    const viaSlug = await joinOn(generic.token, 'localhost', {
      ...(await joinBody(HOSTS.lab, 'Pelo Slug')),
      slug: 'rede-lab',
    });
    expect(viaSlug.status).toBe(200);
    expect(viaSlug.json).toEqual({ outcome: 'joined', tenantSlug: 'rede-lab' });
    expect(await labRowsOf(generic.userId)).toEqual({ memberships: 1, consents: 2 });

    const missingSlug = await joinOn(
      generic.token,
      'localhost',
      await joinBody(HOSTS.lab, 'Sem Slug'),
    );
    expect(missingSlug.status).toBe(404);
    expect(code(missingSlug.json)).toBe('TENANT_NOT_FOUND');

    const hosted = await identity([]);
    const foreignSlug = await joinOn(hosted.token, HOSTS.lab, {
      ...(await joinBody(HOSTS.lab, 'Slug Ignorado')),
      slug: 'rede-demo',
    });
    expect(foreignSlug.status).toBe(200);
    expect(foreignSlug.json).toEqual({ outcome: 'joined', tenantSlug: 'rede-lab' });
    const [demoRows] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.memberships
       where user_id = ${hosted.userId}::uuid and tenant_id = ${tenants.demo.id}::uuid`;
    expect(demoRows?.n).toBe(0);
  });

  it('j. D-311: the new profile holds the typed name, and the rede-demo profile keeps its own', async () => {
    const s = await identity([{ host: 'demo', displayName: 'Nome Demo Original' }]);
    await joinOn(s.token, HOSTS.lab, await joinBody(HOSTS.lab, 'Nome Digitado no Lab'));
    const rows = await adminSql<{ tenant_id: string; display_name: string }[]>`
      select tenant_id::text as tenant_id, display_name from public.member_profiles
       where user_id = ${s.userId}::uuid`;
    const byTenant = Object.fromEntries(rows.map((r) => [r.tenant_id, r.display_name]));
    expect(byTenant[tenants.lab.id]).toBe('Nome Digitado no Lab');
    expect(byTenant[tenants.demo.id]).toBe('Nome Demo Original');
  });

  it("k. D-302: no body read on one host carries the other community's id, slug or name", async () => {
    // The reverse direction: a rede-lab identity asks about and joins rede-demo.
    const labOnly = await identity([{ host: 'lab' }]);
    expect((await stateOf(labOnly.token, HOSTS.demo)).json).toEqual({ state: 'joinable' });
    expect(
      (await joinOn(labOnly.token, HOSTS.demo, await joinBody(HOSTS.demo, 'Do Lab'))).status,
    ).toBe(200);

    expect(bodies.lab.length).toBeGreaterThan(10);
    expect(bodies.demo.length).toBeGreaterThan(1);
    for (const text of bodies.lab) {
      for (const secret of [tenants.demo.id, tenants.demo.slug, tenants.demo.name]) {
        expect(text).not.toContain(secret);
      }
    }
    for (const text of bodies.demo) {
      for (const secret of [tenants.lab.id, tenants.lab.slug, tenants.lab.name]) {
        expect(text).not.toContain(secret);
      }
    }
  });

  it('l. no Bearer -> 401 UNAUTHENTICATED on both routes', async () => {
    const state = await call('/v1/join/state', null, HOSTS.lab);
    expect(state.status).toBe(401);
    expect(code(state.json)).toBe('UNAUTHENTICATED');
    const join = await call('/v1/join', null, HOSTS.lab, {
      method: 'POST',
      body: await joinBody(HOSTS.lab, 'Anonimo'),
    });
    expect(join.status).toBe(401);
    expect(code(join.json)).toBe('UNAUTHENTICATED');
  });
});
