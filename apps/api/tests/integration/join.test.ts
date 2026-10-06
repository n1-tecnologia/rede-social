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
});

afterAll(async () => {
  await removeIdentitiesByPrefix(TRACER);
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
