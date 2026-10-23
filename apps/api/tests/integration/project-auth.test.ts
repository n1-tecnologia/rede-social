import { sqlClient } from '@rede-social/core/db';
import {
  closeAllPools,
  invalidateProject,
} from '@rede-social/core/server/tenancy/project-registry';
import { invalidateTenantHost } from '@rede-social/core/server/tenancy/tenant-host';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type JwksServer, startJwksServer } from './jwks-server';
import { adminSql, adminSqlB, api, HOSTS, provisionTenantOnB, type TenantOnB } from './setup';

/**
 * Phase 09.2-08 (DBT-10, DBT-11, DBT-19, DBT-25; D-538, D-542, D-545, D-537): the project a request belongs to
 * is decided by the HOST, before the token is parsed, and the token is verified only against that project's
 * keys and issuer. Two in-process Auth stand-ins (each with its own ES256 key pair) play two projects; the
 * registry row of tenant B points at the first, an unrelated project row at the second, and a real GoTrue
 * bearer of project 0 is the third kind of token.
 */

const RUN = Date.now().toString(36);
const SLUG = `proj-auth-${RUN}`.slice(0, 40);

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

let a1: JwksServer;
let a2: JwksServer;
let b: TenantOnB;
let otherProjectId = '';

const me = (token: string, host?: string) =>
  api.request('/v1/me/bootstrap', {
    headers: { authorization: `Bearer ${token}`, ...(host ? { 'x-tenant-host': host } : {}) },
  });

const codeOf = async (res: Response) => ((await res.json()) as Envelope).error.code;

beforeAll(async () => {
  a1 = await startJwksServer();
  a2 = await startJwksServer();
  b = await provisionTenantOnB({ slug: SLUG });
  // Tenant B's project answers at the first stand-in; an unrelated project row answers at the second.
  await adminSql`update platform.projects set api_url = ${a1.url} where id = ${b.projectId}::uuid`;
  otherProjectId = crypto.randomUUID();
  await adminSql`
    insert into platform.projects (id, ref, provider, credential_source, state, api_url, secret_key_id)
    values (${otherProjectId}::uuid, ${`fk-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`},
            'fake', 'sealed', 'ready', ${a2.url}, 1)`;
  invalidateProject(b.tenantId);
  invalidateTenantHost(b.host);
});

afterAll(async () => {
  await b?.cleanup();
  if (otherProjectId) {
    await adminSql`delete from platform.projects where id = ${otherProjectId}::uuid`;
  }
  invalidateTenantHost(b?.host ?? '');
  await a1?.stop();
  await a2?.stop();
  await closeAllPools();
  await adminSqlB.end();
  await adminSql.end();
  await sqlClient.end();
});

describe("the tracer: a bearer is verified against the host's project (DBT-10, D-538)", () => {
  it("tracer: the host's project verifies a bearer signed by its own key", async () => {
    const token = await a1.signBearer({ sub: b.userId, email: b.email });
    const res = await me(token, b.host);
    expect(res.status).toBe(200);
  });

  it("another project's key is refused on B's host: 401 INVALID_TOKEN", async () => {
    const token = await a2.signBearer({ sub: b.userId, email: b.email });
    const res = await me(token, b.host);
    expect(res.status).toBe(401);
    expect(await codeOf(res)).toBe('INVALID_TOKEN');
  });

  it("a real GoTrue bearer of project 0 is refused on B's host", async () => {
    const res = await me(b.token, b.host);
    expect(res.status).toBe(401);
    expect(await codeOf(res)).toBe('INVALID_TOKEN');
  });

  it("B's bearer is refused on a project-0 tenant's host", async () => {
    const token = await a1.signBearer({ sub: b.userId, email: b.email });
    const res = await me(token, HOSTS.lab);
    expect(res.status).toBe(401);
    expect(await codeOf(res)).toBe('INVALID_TOKEN');
  });

  it('keys and issuer are pinned to the selected project: a token of A2 claiming A1 as issuer is refused', async () => {
    const forged = await a2.signBearer({ sub: b.userId, email: b.email, iss: a1.issuer });
    expect((await me(forged, b.host)).status).toBe(401);
    // ...and a token signed by A1's key but claiming A2 as issuer is refused too.
    const wrongIssuer = await a1.signBearer({ sub: b.userId, email: b.email, iss: a2.issuer });
    expect((await me(wrongIssuer, b.host)).status).toBe(401);
  });

  it('an expired token of the right project and a wrong audience are refused', async () => {
    const expired = await a1.signBearer({ sub: b.userId, email: b.email, expiresInSeconds: -60 });
    expect((await me(expired, b.host)).status).toBe(401);
    const aud = await a1.signBearer({ sub: b.userId, email: b.email, aud: 'anon' });
    expect((await me(aud, b.host)).status).toBe(401);
  });

  it('no bearer at all is 401 UNAUTHENTICATED before any key lookup', async () => {
    a1.resetFetches();
    const res = await api.request('/v1/me/bootstrap', { headers: { 'x-tenant-host': b.host } });
    expect(res.status).toBe(401);
    expect(await codeOf(res)).toBe('UNAUTHENTICATED');
    expect(a1.fetches).toBe(0);
  });
});
