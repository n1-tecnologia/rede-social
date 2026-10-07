import { Writable } from 'node:stream';
import { PLATFORM_TERMS_VERSION, TENANT_HOST_HEADER } from '@rede-social/contracts';
import { joinResponseSchema } from '@rede-social/contracts/join';
import { sqlClient } from '@rede-social/core/db';
import {
  existingIdentityForEmail,
  signupInternals,
  signupMember,
} from '@rede-social/core/server/tenancy/signup';
import { createClient } from '@supabase/supabase-js';
import pino from 'pino';
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
    consents: { tenantRulesVersion: rulesVersion, platformTermsVersion: PLATFORM_TERMS_VERSION },
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

/** 08.1 shared-identity fixtures of this file (`createSharedIdentity` e-mail prefix). */
const SHARED = 'su81';

const tenantIdOf = async (slug: string): Promise<string> => {
  const [row] = await adminSql<
    { id: string }[]
  >`select id from public.tenants where slug = ${slug}`;
  if (!row) throw new Error(`no tenant ${slug}`);
  return row.id;
};

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
    select rules_version from public.tenants where slug = 'rede-demo'`;
  const [lab] = await adminSql<{ rules_version: number }[]>`
    select rules_version from public.tenants where slug = 'rede-lab'`;
  demoRulesVersion = demo?.rules_version ?? 1;
  labRulesVersion = lab?.rules_version ?? 1;
  await removeIdentitiesByPrefix(SHARED);

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
  await removeIdentitiesByPrefix(SHARED);
  await adminSql`delete from public.tenants where slug = any(${[SLUG_MIN, SLUG_MAX]})`;
  await adminSql.end();
  await sqlClient.end();
});

const MAILPIT_URL = (process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324').replace(/\/$/, '');

type MailpitMessage = {
  ID: string;
  Subject: string;
  From: { Name: string; Address: string };
  HTML: string;
  Text: string;
};

/** Every Mailpit message for `to`, newest first (search + per-message fetch). */
async function mailpitMessages(to: string): Promise<MailpitMessage[]> {
  const list = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=20`,
  );
  if (!list.ok) return [];
  const { messages } = (await list.json()) as { messages?: Array<{ ID: string }> };
  const out: MailpitMessage[] = [];
  for (const m of messages ?? []) {
    const full = await fetch(`${MAILPIT_URL}/api/v1/message/${m.ID}`);
    if (full.ok) out.push((await full.json()) as MailpitMessage);
  }
  return out;
}

async function waitForMail(to: string, timeoutMs = 20_000): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await mailpitMessages(to);
    if (found[0]) return found[0];
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`no mail for ${to} within ${timeoutMs} ms`);
}

/** The first `/auth/confirm` href of an HTML body (`&amp;` unescaped). */
function confirmLink(html: string): URL {
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = (match[1] ?? '').replace(/&amp;/g, '&');
    if (href.includes('/auth/confirm')) return new URL(href);
  }
  throw new Error('no /auth/confirm link in the mail');
}

const publishableClient = () =>
  createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_PUBLISHABLE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** GoTrue's public resend, the call the web tier makes for the signup confirmation mail. */
const gotrueResend = (email: string, redirectTo: string) =>
  fetch(
    `${process.env.SUPABASE_URL}/auth/v1/resend?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
      },
      body: JSON.stringify({ type: 'signup', email }),
    },
  );

describe('AUTH-01/AUTH-04 — public sign-up', () => {
  it('1. happy path: 201, member of the tenant, two timestamped consent rows', async () => {
    const payload = body();
    const before = Date.now();
    const res = await signup('rede-demo', payload);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const created = (await res.json()) as Created;
    expect(created.tenantSlug).toBe('rede-demo');
    expect(created.userId).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await membershipsOf(created.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('member');
    expect(rows[0]?.status).toBe('active');

    const consents = await consentsOf(created.userId);
    // `order by kind`: alphabetical, so platform_terms sorts first. Assert by kind, never by index.
    expect(consents.map((c) => c.kind)).toEqual(['platform_terms', 'tenant_rules']);
    expect(consents.find((c) => c.kind === 'tenant_rules')?.text_version).toBe(demoRulesVersion);
    expect(consents.find((c) => c.kind === 'platform_terms')?.text_version).toBe(
      PLATFORM_TERMS_VERSION,
    );
    for (const consent of consents) {
      expect(consent.accepted_at).toBeInstanceOf(Date);
      // The DB clock inside the transaction, never a client timestamp.
      expect(consent.accepted_at.getTime()).toBeGreaterThanOrEqual(before - 60_000);
      expect(consent.ip).toBe(CLIENT_IP);
      expect(consent.user_agent).toBe(USER_AGENT);
    }
  });

  it('2. GET /v1/public/tenants/{slug} publishes name, rules and both versions (by-host still wins)', async () => {
    const res = await api.request('/v1/public/tenants/rede-demo');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const tenant = (await res.json()) as {
      slug: string;
      displayName: string;
      rulesText: string;
      rulesVersion: number;
      termsVersion: number;
    };
    expect(tenant.slug).toBe('rede-demo');
    expect(tenant.displayName).toBe('Rede Demo');
    expect(tenant.rulesText.length).toBeGreaterThan(0);
    expect(tenant.termsVersion).toBe(PLATFORM_TERMS_VERSION);

    // Registration order: the literal path must not be swallowed by `/tenants/{slug}`.
    const byHost = await api.request('/v1/public/tenants/by-host?host=rede-demo.localhost');
    expect(byHost.status).toBe(200);
    expect(await byHost.json()).toMatchObject({ slug: 'rede-demo', displayName: 'Rede Demo' });
  });

  it('3. boundary: a 7-character password is 400, exactly 8 is 201', async () => {
    const short = await signup('rede-demo', body({ password: '1234567' }));
    expect(short.status).toBe(400);
    expect(((await short.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');

    const exact = await signup('rede-demo', body({ password: '12345678' }));
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

  it('5. adjacency: `Rede-Demo` is a miss, not an alias of `rede-demo`', async () => {
    const get = await api.request('/v1/public/tenants/Rede-Demo');
    expect(get.status).toBe(404);
    const post = await signup('Rede-Demo', body());
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
      const res = await signup('rede-demo', payload);
      expect(res.status, label).toBe(400);
      const envelope = (await res.json()) as Envelope;
      expect(envelope.error.code, label).toBe('VALIDATION_FAILED');
      expect(envelope.error.details, label).toBeDefined();
    }

    const staleRules = await signup(
      'rede-demo',
      body({ consents: { tenantRulesVersion: 99, platformTermsVersion: PLATFORM_TERMS_VERSION } }),
    );
    expect(staleRules.status).toBe(400);
    expect(((await staleRules.json()) as Envelope).error.details).toEqual({ consents: 'stale' });

    const staleTerms = await signup(
      'rede-demo',
      body({ consents: { tenantRulesVersion: demoRulesVersion, platformTermsVersion: 99 } }),
    );
    expect(staleTerms.status).toBe(400);
    expect(((await staleTerms.json()) as Envelope).error.details).toEqual({ consents: 'stale' });
  });

  it('7. idempotency: the same sign-up twice is 201 then 409, with one membership and two consents', async () => {
    const payload = body();
    const first = await signup('rede-demo', payload);
    expect(first.status).toBe(201);
    const { userId } = (await first.json()) as Created;

    const second = await signup('rede-demo', payload);
    expect(second.status).toBe(409);
    expect(((await second.json()) as Envelope).error.code).toBe('EMAIL_ALREADY_REGISTERED');

    expect(await membershipsOf(userId)).toHaveLength(1);
    expect(await consentsOf(userId)).toHaveLength(2);
  });

  it('8. D-302 (+ D-04, T-04-01): a duplicate on another tenant is 409 with no details and never names the first tenant', async () => {
    const payload = body();
    expect((await signup('rede-demo', payload)).status).toBe(201);

    const cross = await signup('rede-lab', {
      ...payload,
      consents: {
        tenantRulesVersion: labRulesVersion,
        platformTermsVersion: PLATFORM_TERMS_VERSION,
      },
    });
    expect(cross.status).toBe(409);
    const raw = await cross.text();
    expect(raw).not.toContain('rede-demo');
    expect(raw).not.toContain('Rede Demo');
    expect((JSON.parse(raw) as Envelope).error.details).toBeUndefined();
    expect((JSON.parse(raw) as Envelope).error.message).toBe(
      'Este e-mail já está cadastrado. Entre com sua senha.',
    );

    const [user] = await adminSql<{ id: string }[]>`
      select id from auth.users where email = ${payload.email}`;
    expect(await membershipsOf(user?.id ?? '')).toHaveLength(1);
  });

  it('8b. D-301 API half: the 409 on rede-lab, then the existing password and POST /v1/join on rede-lab -> joined', async () => {
    const shared = await createSharedIdentity({ prefix: SHARED, memberships: [{ host: 'demo' }] });

    // The sign-up on rede-lab with the existing e-mail: 409, detail-less (D-302), nothing written.
    const attempt = await signup('rede-lab', {
      name: 'Nome no Lab',
      email: shared.email,
      password: 'OutraSenha123',
      consents: {
        tenantRulesVersion: labRulesVersion,
        platformTermsVersion: PLATFORM_TERMS_VERSION,
      },
    });
    expect(attempt.status).toBe(409);
    expect(((await attempt.json()) as Envelope).error.details).toBeUndefined();
    expect(await membershipsOf(shared.userId)).toHaveLength(1);

    // What the web does next (joinFromSignup): sign in with the EXISTING password, then join.
    const token = await signInAs(shared.email, SEED_PASSWORD);
    const joined = await api.request('/v1/join', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        [TENANT_HOST_HEADER]: HOSTS.lab,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Nome no Lab',
        consents: {
          tenantRulesVersion: labRulesVersion,
          platformTermsVersion: PLATFORM_TERMS_VERSION,
        },
      }),
    });
    expect(joined.status).toBe(200);
    expect(joinResponseSchema.parse(await joined.json())).toEqual({
      outcome: 'joined',
      tenantSlug: 'rede-lab',
    });

    expect(await membershipsOf(shared.userId)).toHaveLength(2);
    const labId = await tenantIdOf('rede-lab');
    const [labConsents] = await adminSql<{ count: number }[]>`
      select count(*)::int as count from public.consent_records
       where user_id = ${shared.userId}::uuid and tenant_id = ${labId}::uuid`;
    expect(labConsents?.count).toBe(2);
  });

  it('8c. D-302 log: the duplicate line speaks about the attempted tenant only (alreadyMemberHere, never another tenant id)', async () => {
    const shared = await createSharedIdentity({ prefix: SHARED, memberships: [{ host: 'demo' }] });
    const demoId = await tenantIdOf('rede-demo');
    const labId = await tenantIdOf('rede-lab');

    // The request logger's destination, captured: the same `logger` parameter the route passes.
    const lines: Record<string, unknown>[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        for (const line of String(chunk).split('\n')) if (line) lines.push(JSON.parse(line));
        done();
      },
    });
    const logger = pino({ level: 'info' }, sink);

    const attemptOn = async (slug: string, rulesVersion: number) => {
      lines.length = 0;
      await expect(
        signupMember({
          slug,
          body: {
            name: 'Nome no Lab',
            email: shared.email,
            password: 'OutraSenha123',
            consents: {
              tenantRulesVersion: rulesVersion,
              platformTermsVersion: PLATFORM_TERMS_VERSION,
            },
          },
          ip: CLIENT_IP,
          userAgent: USER_AGENT,
          logger,
        }),
      ).rejects.toMatchObject({ status: 409, code: 'EMAIL_ALREADY_REGISTERED' });
      const line = lines.find((l) => l.event === 'signup.duplicate_email');
      expect(line).toBeDefined();
      return line as Record<string, unknown>;
    };

    // On rede-lab (no membership there): the line names rede-lab only.
    const onLab = await attemptOn('rede-lab', labRulesVersion);
    expect(onLab.attemptedTenantId).toBe(labId);
    expect(onLab.alreadyMemberHere).toBe(false);
    expect(onLab.raced).toBe(false);
    expect(onLab).not.toHaveProperty('existingTenantId');
    expect(Object.values(onLab)).not.toContain(demoId);
    expect(JSON.stringify(onLab)).not.toContain(demoId);

    // On rede-demo (a member there): `alreadyMemberHere` is about rede-demo itself.
    const onDemo = await attemptOn('rede-demo', demoRulesVersion);
    expect(onDemo.attemptedTenantId).toBe(demoId);
    expect(onDemo.alreadyMemberHere).toBe(true);

    // The lookup itself answers only `{ userId, alreadyMemberHere }`.
    const lookup = await existingIdentityForEmail(shared.email, labId);
    expect(lookup).toEqual({ userId: shared.userId, alreadyMemberHere: false });
    expect(Object.keys(lookup ?? {}).sort()).toEqual(['alreadyMemberHere', 'userId']);
    expect(await existingIdentityForEmail(shared.email, demoId)).toEqual({
      userId: shared.userId,
      alreadyMemberHere: true,
    });
  });

  it('9. compensation: a failing consent insert deletes the auth user, leaving no orphan identity', async () => {
    const payload = body();
    const original = signupInternals.consentInsert;
    signupInternals.consentInsert = async () => {
      throw new Error('forced consent insert failure');
    };
    try {
      const res = await signup('rede-demo', payload);
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
      Array.from({ length: 5 }, () => signup('rede-demo', payload)),
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

  it('11. the new identity is UNCONFIRMED: right password -> email_not_confirmed, wrong password -> invalid_credentials (no oracle)', async () => {
    const payload = body({}, demoRulesVersion);
    const res = await signup('rede-demo', payload);
    expect(res.status).toBe(201);
    const created = (await res.json()) as Created;

    const [row] = await adminSql<{ email_confirmed_at: Date | null }[]>`
      select email_confirmed_at from auth.users where id = ${created.userId}`;
    expect(row?.email_confirmed_at).toBeNull();
    expect(await membershipsOf(created.userId)).toHaveLength(1);
    expect(await consentsOf(created.userId)).toHaveLength(2);

    const client = publishableClient();
    const right = await client.auth.signInWithPassword({
      email: payload.email,
      password: payload.password,
    });
    expect(right.data.session).toBeNull();
    expect(right.error?.code).toBe('email_not_confirmed');

    const wrong = await client.auth.signInWithPassword({
      email: payload.email,
      password: 'SenhaErrada999',
    });
    expect(wrong.data.session).toBeNull();
    expect(wrong.error?.code).toBe('invalid_credentials');
  });

  it('12. GoTrue resend -> Send Email Hook -> Mailpit: the branded pt-BR mail whose link confirms and signs in', async () => {
    const payload = body({}, demoRulesVersion);
    expect((await signup('rede-demo', payload)).status).toBe(201);

    const redirect = `http://${HOSTS.demo}:3000/auth/confirm?next=/inicio`;
    const resent = await gotrueResend(payload.email, redirect);
    expect(resent.status).toBe(200);

    const mail = await waitForMail(payload.email);
    expect(mail.From.Name).toBe('Rede Demo');
    expect(mail.Subject).toBe('Confirme seu e-mail — Rede Demo');
    const link = confirmLink(mail.HTML);
    expect(link.href.startsWith(`http://${HOSTS.demo}:3000/auth/confirm?next=/inicio`)).toBe(true);
    expect(link.searchParams.get('type')).toBe('signup');
    const tokenHash = link.searchParams.get('token_hash');
    expect(tokenHash).toBeTruthy();

    const client = publishableClient();
    const verified = await client.auth.verifyOtp({ type: 'signup', token_hash: tokenHash ?? '' });
    expect(verified.error).toBeNull();
    expect(verified.data.session).not.toBeNull();
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);

    const [row] = await adminSql<{ email_confirmed_at: Date | null }[]>`
      select email_confirmed_at from auth.users where email = ${payload.email}`;
    expect(row?.email_confirmed_at).not.toBeNull();

    const signedIn = await publishableClient().auth.signInWithPassword({
      email: payload.email,
      password: payload.password,
    });
    expect(signedIn.error).toBeNull();
    expect(signedIn.data.session).not.toBeNull();
  });

  it('13. row 6a: a hostless redirect (generic host) still delivers the Rede Demo branded mail, not a refusal', async () => {
    const payload = body({}, demoRulesVersion);
    expect((await signup('rede-demo', payload)).status).toBe(201);

    const resent = await gotrueResend(
      payload.email,
      'http://localhost:3000/auth/confirm?next=/inicio',
    );
    expect(resent.status).toBe(200);

    const mail = await waitForMail(payload.email);
    expect(mail.From.Name).toBe('Rede Demo');
    expect(mail.Subject).toBe('Confirme seu e-mail — Rede Demo');
    expect(confirmLink(mail.HTML).origin).toBe('http://localhost:3000');
  });
});
