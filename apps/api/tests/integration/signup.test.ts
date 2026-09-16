import { TRIA_TERMS_VERSION } from '@tria/contracts';
import { sqlClient } from '@tria/core/db';
import { signupInternals } from '@tria/core/server/tenancy/signup';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api } from './setup';

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };
type Created = { userId: string; tenantSlug: string };

const CLIENT_IP = '203.0.113.42';
const USER_AGENT = 'vitest-signup/1.0';

/** Slug boundaries (AUTH-01): exactly 3 and exactly 40 characters are valid, 2 and 41 are not. */
const SLUG_MIN = 'abc';
const SLUG_MAX = 'a'.repeat(40);
const SLUG_TOO_SHORT = 'ab';
const SLUG_TOO_LONG = 'a'.repeat(41);

const emails: string[] = [];
let counter = 0;
function uniqueEmail(prefix: string): string {
  counter += 1;
  const email = `e2e-${prefix}-${Date.now()}-${counter}@signup-test.local`;
  emails.push(email);
  return email;
}

let demoRulesVersion = 1;
let labRulesVersion = 1;

function body(overrides: Record<string, unknown> = {}, rulesVersion = demoRulesVersion) {
  return {
    name: 'Maria Teste',
    email: uniqueEmail('happy'),
    password: 'Segredo123',
    consents: { tenantRulesVersion: rulesVersion, triaTermsVersion: TRIA_TERMS_VERSION },
    ...overrides,
  };
}

const signup = (slug: string, payload: unknown) =>
  api.request(`/v1/public/signup/${slug}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-client-ip': CLIENT_IP,
      'user-agent': USER_AGENT,
    },
    body: JSON.stringify(payload),
  });

const membershipsOf = (userId: string) =>
  adminSql<{ tenant_id: string; role: string; status: string }[]>`
    select tenant_id, role, status from public.memberships where user_id = ${userId}`;

const consentsOf = (userId: string) =>
  adminSql<
    {
      kind: string;
      text_version: number;
      accepted_at: Date;
      ip: string | null;
      user_agent: string;
    }[]
  >`select kind, text_version, accepted_at, host(ip) as ip, user_agent
      from public.consent_records where user_id = ${userId} order by kind`;

beforeAll(async () => {
  const [demo] = await adminSql<{ rules_version: number }[]>`
    select rules_version from public.tenants where slug = 'tria-demo'`;
  const [lab] = await adminSql<{ rules_version: number }[]>`
    select rules_version from public.tenants where slug = 'tria-lab'`;
  demoRulesVersion = demo?.rules_version ?? 1;
  labRulesVersion = lab?.rules_version ?? 1;

  for (const slug of [SLUG_MIN, SLUG_MAX]) {
    await adminSql`
      insert into public.tenants (slug, display_name, rules_text, rules_version)
      values (${slug}, ${`Boundary ${slug}`}, 'Regras de teste.', 1)
      on conflict (slug) do nothing`;
  }
});

afterAll(async () => {
  // auth.users -> public.users -> memberships / consent_records all cascade, so one delete is enough.
  if (emails.length > 0) await adminSql`delete from auth.users where email = any(${emails})`;
  await adminSql`delete from public.tenants where slug = any(${[SLUG_MIN, SLUG_MAX]})`;
  await adminSql.end();
  await sqlClient.end();
});

describe('AUTH-01/AUTH-04 — public sign-up', () => {
  it('1. happy path: 201, member of the tenant, two timestamped consent rows', async () => {
    const payload = body();
    const before = Date.now();
    const res = await signup('tria-demo', payload);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const created = (await res.json()) as Created;
    expect(created.tenantSlug).toBe('tria-demo');
    expect(created.userId).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await membershipsOf(created.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('member');
    expect(rows[0]?.status).toBe('active');

    const consents = await consentsOf(created.userId);
    expect(consents.map((c) => c.kind)).toEqual(['tenant_rules', 'tria_terms']);
    expect(consents[0]?.text_version).toBe(demoRulesVersion);
    expect(consents[1]?.text_version).toBe(TRIA_TERMS_VERSION);
    for (const consent of consents) {
      expect(consent.accepted_at).toBeInstanceOf(Date);
      // The DB clock inside the transaction, never a client timestamp.
      expect(consent.accepted_at.getTime()).toBeGreaterThanOrEqual(before - 60_000);
      expect(consent.ip).toBe(CLIENT_IP);
      expect(consent.user_agent).toBe(USER_AGENT);
    }
  });

  it('2. GET /v1/public/tenants/{slug} publishes name, rules and both versions (by-host still wins)', async () => {
    const res = await api.request('/v1/public/tenants/tria-demo');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const tenant = (await res.json()) as {
      slug: string;
      displayName: string;
      rulesText: string;
      rulesVersion: number;
      termsVersion: number;
    };
    expect(tenant.slug).toBe('tria-demo');
    expect(tenant.displayName).toBe('TRIA Demo');
    expect(tenant.rulesText.length).toBeGreaterThan(0);
    expect(tenant.termsVersion).toBe(TRIA_TERMS_VERSION);

    // Registration order: the literal path must not be swallowed by `/tenants/{slug}`.
    const byHost = await api.request('/v1/public/tenants/by-host?host=tria-demo.localhost');
    expect(byHost.status).toBe(200);
    expect(await byHost.json()).toMatchObject({ slug: 'tria-demo', displayName: 'TRIA Demo' });
  });

  it('3. boundary: a 7-character password is 400, exactly 8 is 201', async () => {
    const short = await signup('tria-demo', body({ password: '1234567' }));
    expect(short.status).toBe(400);
    expect(((await short.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');

    const exact = await signup('tria-demo', body({ password: '12345678' }));
    expect(exact.status).toBe(201);
  });

  it('4. boundary: slugs of 3 and 40 chars resolve; 2 and 41 are 404 TENANT_NOT_FOUND', async () => {
    for (const slug of [SLUG_MIN, SLUG_MAX]) {
      expect((await api.request(`/v1/public/tenants/${slug}`)).status).toBe(200);
      const res = await signup(slug, body({}, 1));
      expect(res.status, `signup on ${slug}`).toBe(201);
    }
    for (const slug of [SLUG_TOO_SHORT, SLUG_TOO_LONG]) {
      const get = await api.request(`/v1/public/tenants/${slug}`);
      expect(get.status, `GET ${slug}`).toBe(404);
      expect(((await get.json()) as Envelope).error.code).toBe('TENANT_NOT_FOUND');
      const post = await signup(slug, body());
      expect(post.status, `POST ${slug}`).toBe(404);
    }
  });

  it('5. adjacency: `Tria-Demo` is a miss, not an alias of `tria-demo`', async () => {
    const get = await api.request('/v1/public/tenants/Tria-Demo');
    expect(get.status).toBe(404);
    const post = await signup('Tria-Demo', body());
    expect(post.status).toBe(404);
    expect(((await post.json()) as Envelope).error.code).toBe('TENANT_NOT_FOUND');
  });

  it('6. empty/invalid: name, e-mail, missing consents and stale versions are 400 with details', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['empty name', { name: '' }],
      ['empty e-mail', { email: '' }],
      ['missing consents', { consents: undefined }],
    ];
    for (const [label, overrides] of cases) {
      const payload = body(overrides);
      if (overrides.consents === undefined) delete (payload as Record<string, unknown>).consents;
      const res = await signup('tria-demo', payload);
      expect(res.status, label).toBe(400);
      const envelope = (await res.json()) as Envelope;
      expect(envelope.error.code, label).toBe('VALIDATION_FAILED');
      expect(envelope.error.details, label).toBeDefined();
    }

    const staleRules = await signup(
      'tria-demo',
      body({ consents: { tenantRulesVersion: 99, triaTermsVersion: TRIA_TERMS_VERSION } }),
    );
    expect(staleRules.status).toBe(400);
    expect(((await staleRules.json()) as Envelope).error.details).toEqual({ consents: 'stale' });

    const staleTerms = await signup(
      'tria-demo',
      body({ consents: { tenantRulesVersion: demoRulesVersion, triaTermsVersion: 99 } }),
    );
    expect(staleTerms.status).toBe(400);
    expect(((await staleTerms.json()) as Envelope).error.details).toEqual({ consents: 'stale' });
  });

  it('7. idempotency: the same sign-up twice is 201 then 409, with one membership and two consents', async () => {
    const payload = body();
    const first = await signup('tria-demo', payload);
    expect(first.status).toBe(201);
    const { userId } = (await first.json()) as Created;

    const second = await signup('tria-demo', payload);
    expect(second.status).toBe(409);
    expect(((await second.json()) as Envelope).error.code).toBe('EMAIL_ALREADY_REGISTERED');

    expect(await membershipsOf(userId)).toHaveLength(1);
    expect(await consentsOf(userId)).toHaveLength(2);
  });

  it('8. ROLE-02 + T-04-01: a duplicate on another tenant is 409 and never names the first tenant', async () => {
    const payload = body();
    expect((await signup('tria-demo', payload)).status).toBe(201);

    const cross = await signup('tria-lab', {
      ...payload,
      consents: { tenantRulesVersion: labRulesVersion, triaTermsVersion: TRIA_TERMS_VERSION },
    });
    expect(cross.status).toBe(409);
    const raw = await cross.text();
    expect(raw).not.toContain('tria-demo');
    expect(raw).not.toContain('TRIA Demo');
    expect((JSON.parse(raw) as Envelope).error.details).toBeUndefined();
    expect((JSON.parse(raw) as Envelope).error.message).toBe(
      'Este e-mail já está cadastrado. Entre com sua senha.',
    );

    const [user] = await adminSql<{ id: string }[]>`
      select id from auth.users where email = ${payload.email}`;
    expect(await membershipsOf(user?.id ?? '')).toHaveLength(1);
  });

  it('9. compensation: a failing consent insert deletes the auth user, leaving no orphan identity', async () => {
    const payload = body();
    const original = signupInternals.consentInsert;
    signupInternals.consentInsert = async () => {
      throw new Error('forced consent insert failure');
    };
    try {
      const res = await signup('tria-demo', payload);
      expect(res.status).toBe(500);
      expect(((await res.json()) as Envelope).error.code).toBe('INTERNAL');
    } finally {
      signupInternals.consentInsert = original;
    }

    const authRows = await adminSql`select id from auth.users where email = ${payload.email}`;
    expect(authRows).toHaveLength(0);
    const publicRows = await adminSql`select id from public.users where email = ${payload.email}`;
    expect(publicRows).toHaveLength(0);
  });

  it('10. concurrency: five identical sign-ups yield exactly one 201 and one membership', async () => {
    const payload = body();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => signup('tria-demo', payload)),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);

    const [user] = await adminSql<{ id: string }[]>`
      select id from auth.users where email = ${payload.email}`;
    expect(user).toBeDefined();
    expect(await membershipsOf(user?.id ?? '')).toHaveLength(1);
    expect(await consentsOf(user?.id ?? '')).toHaveLength(2);
  });
});
