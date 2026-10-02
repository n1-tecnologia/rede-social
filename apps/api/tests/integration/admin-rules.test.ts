import { type AdminRules, adminRulesSchema, PLATFORM_TERMS_VERSION } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * 08-07 — the community rules on the tenant lane (ADMIN-03, D-341) against the live local stack:
 * `GET` and `PUT /v1/admin/rules`.
 *
 * `rules tracer`: `admin@rede-demo.local` saves new rules (no tenant id anywhere in the request);
 * `rules_version` rises by exactly one, `GET /v1/public/tenants/rede-demo` (what `/cadastro` reads)
 * publishes the new text and version, the next sign-up records its `tenant_rules` consent at the new
 * version, a sign-up still holding the old version is refused `{ consents: 'stale' }`, and a consent
 * recorded BEFORE the save keeps its old version (no consent is ever rewritten). Identical text —
 * including the same text pasted with CRLF and surrounding whitespace — keeps the version. Empty and
 * over-cap texts are refused with `details.rulesText`. Support and member get 403, rede-lab's rules
 * never move, and a rede-demo session on the rede-lab host is 403 `TENANT_HOST_MISMATCH`.
 *
 * The SEEDED tenants are the subjects because the truths name them, so `afterAll` puts both rules
 * rows back exactly as the seed wrote them (text AND version: other suites present version 1 as the
 * current one and version 2 as stale) and deletes every identity this run signed up.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
type RulesRow = { rules_text: string; rules_version: number };

const tokens = { admin: '', member: '', support: '', labAdmin: '' };
const ids = { demo: '', lab: '' };
const snapshot: Record<'demo' | 'lab', RulesRow | null> = { demo: null, lab: null };

const emails: string[] = [];
let counter = 0;
function uniqueEmail(prefix: string): string {
  counter += 1;
  const email = `e2e-rules-${prefix}-${Date.now()}-${counter}@rules-test.local`;
  emails.push(email);
  return email;
}

const request = (
  path: string,
  token: string,
  init: { method?: string; body?: unknown; host?: string } = {},
) =>
  api.request(path, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': init.host ?? HOSTS.demo,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

const getRules = (token: string, host?: string) => request('/v1/admin/rules', token, { host });
const putRules = (token: string, body: unknown, host?: string) =>
  request('/v1/admin/rules', token, { method: 'PUT', body, host });

async function envelope(res: Response): Promise<Envelope> {
  return (await res.json()) as Envelope;
}

async function rules(res: Response): Promise<AdminRules> {
  return adminRulesSchema.parse(await res.json());
}

async function rulesRow(tenantId: string): Promise<RulesRow> {
  const [row] = await adminSql<RulesRow[]>`
    select rules_text, rules_version from public.tenants where id = ${tenantId}::uuid`;
  if (!row) throw new Error(`tenant ${tenantId} not found`);
  return row;
}

/** The public sign-up `/cadastro` posts, holding the given rules version. */
const signup = (email: string, rulesVersion: number) =>
  api.request('/v1/public/signup/rede-demo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest-admin-rules/1.0' },
    body: JSON.stringify({
      name: 'Pessoa Nova',
      email,
      password: 'Segredo123',
      consents: { tenantRulesVersion: rulesVersion, platformTermsVersion: PLATFORM_TERMS_VERSION },
    }),
  });

async function tenantRulesConsentVersion(userId: string): Promise<number | undefined> {
  const [row] = await adminSql<{ text_version: number }[]>`
    select text_version from public.consent_records
     where user_id = ${userId}::uuid and kind = 'tenant_rules'`;
  return row?.text_version;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  const tenants = await adminSql<{ id: string; slug: string }[]>`
    select id::text, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  ids.demo = tenants.find((t) => t.slug === 'rede-demo')?.id ?? '';
  ids.lab = tenants.find((t) => t.slug === 'rede-lab')?.id ?? '';
  snapshot.demo = await rulesRow(ids.demo);
  snapshot.lab = await rulesRow(ids.lab);

  tokens.admin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.member = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.support = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
});

afterAll(async () => {
  // auth.users -> public.users -> memberships / consent_records cascade, so one delete is enough.
  if (emails.length > 0) await adminSql`delete from auth.users where email = any(${emails})`;
  for (const key of ['demo', 'lab'] as const) {
    const row = snapshot[key];
    if (!row) continue;
    await adminSql`
      update public.tenants
         set rules_text = ${row.rules_text}, rules_version = ${row.rules_version}
       where id = ${ids[key]}::uuid`;
  }
  await adminSql.end();
  await sqlClient.end();
});

describe('rules tracer', () => {
  /** Shared across the ordered cases below: the version before the first change and after it. */
  let before = 0;
  let after = 0;
  let earlierUserId = '';
  const NEW_RULES =
    'Regras novas da Rede Demo.\nUm: respeite.\nDois: sem spam.\n\nSegundo parágrafo.';

  it('GET answers the stored text and version, no-store', async () => {
    const res = await getRules(tokens.admin);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await rules(res);
    expect(body).toEqual({
      rulesText: snapshot.demo?.rules_text,
      rulesVersion: snapshot.demo?.rules_version,
    });
    before = body.rulesVersion;
  });

  it('a change answers 200 with the version plus one; rede-lab does not move; /cadastro reads the new text', async () => {
    // A member who joined BEFORE the save, at the version then in force.
    const earlier = await signup(uniqueEmail('earlier'), before);
    expect(earlier.status).toBe(201);
    earlierUserId = ((await earlier.json()) as { userId: string }).userId;
    expect(await tenantRulesConsentVersion(earlierUserId)).toBe(before);

    const labBefore = await rulesRow(ids.lab);
    const res = await putRules(tokens.admin, { rulesText: NEW_RULES });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await rules(res);
    expect(body).toEqual({ rulesText: NEW_RULES, rulesVersion: before + 1 });
    after = body.rulesVersion;

    expect(await rulesRow(ids.demo)).toEqual({ rules_text: NEW_RULES, rules_version: after });
    expect(await rulesRow(ids.lab)).toEqual(labBefore);

    // What the public sign-up page reads, per request.
    const pub = await api.request('/v1/public/tenants/rede-demo');
    expect(pub.status).toBe(200);
    const tenant = (await pub.json()) as { rulesText: string; rulesVersion: number };
    expect(tenant.rulesText).toBe(NEW_RULES);
    expect(tenant.rulesVersion).toBe(after);
  });

  it("an existing member's tenant_rules consent keeps the version it was accepted at", async () => {
    expect(await tenantRulesConsentVersion(earlierUserId)).toBe(before);
  });

  it('the same text again keeps the version, and so does the same text pasted with CRLF and padding', async () => {
    const same = await putRules(tokens.admin, { rulesText: NEW_RULES });
    expect(same.status).toBe(200);
    expect((await rules(same)).rulesVersion).toBe(after);

    const windows = `  \r\n${NEW_RULES.replace(/\n/g, '\r\n')}\r\n\r\n  `;
    const crlf = await putRules(tokens.admin, { rulesText: windows });
    expect(crlf.status).toBe(200);
    expect(await rules(crlf)).toEqual({ rulesText: NEW_RULES, rulesVersion: after });
    expect(await rulesRow(ids.demo)).toEqual({ rules_text: NEW_RULES, rules_version: after });
  });

  it('empty and whitespace-only text answer 400 { rulesText: "required" } and change nothing', async () => {
    for (const rulesText of ['', '   \r\n\t \n']) {
      const res = await putRules(tokens.admin, { rulesText });
      expect(res.status).toBe(400);
      const body = await envelope(res);
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details).toEqual({ rulesText: 'required' });
    }
    expect((await rulesRow(ids.demo)).rules_version).toBe(after);
  });

  it('10,001 code units answer 400 { rulesText: "too_long" }; exactly 10,000 is accepted', async () => {
    const over = await putRules(tokens.admin, { rulesText: 'a'.repeat(10_001) });
    expect(over.status).toBe(400);
    expect((await envelope(over)).error.details).toEqual({ rulesText: 'too_long' });
    // An emoji is two code units: 9,999 + 🎉 is 10,001.
    const emoji = await putRules(tokens.admin, { rulesText: `${'a'.repeat(9_999)}🎉` });
    expect(emoji.status).toBe(400);
    expect((await envelope(emoji)).error.details).toEqual({ rulesText: 'too_long' });
    expect((await rulesRow(ids.demo)).rules_version).toBe(after);

    const max = await putRules(tokens.admin, { rulesText: 'b'.repeat(10_000) });
    expect(max.status).toBe(200);
    expect((await rules(max)).rulesVersion).toBe(after + 1);
    // Put the tracer's text back so the sign-up cases below run against a known version.
    const back = await putRules(tokens.admin, { rulesText: NEW_RULES });
    expect((await rules(back)).rulesVersion).toBe(after + 2);
    after += 2;
  });

  it('a body carrying anything else (a tenant id, a version) is a 400 with the issue list', async () => {
    const res = await putRules(tokens.admin, {
      rulesText: 'Outra regra.',
      tenantId: ids.lab,
      rulesVersion: 99,
    });
    expect(res.status).toBe(400);
    const body = await envelope(res);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details?.issues).toBeDefined();
    expect(await rulesRow(ids.demo)).toEqual({ rules_text: NEW_RULES, rules_version: after });
    expect(await rulesRow(ids.lab)).toEqual(snapshot.lab);
  });

  it('a new sign-up presenting the new version records its tenant_rules consent at it', async () => {
    const res = await signup(uniqueEmail('after'), after);
    expect(res.status).toBe(201);
    const { userId } = (await res.json()) as { userId: string };
    expect(await tenantRulesConsentVersion(userId)).toBe(after);
  });

  it('a sign-up still holding the old version gets 400 { consents: "stale" } and nothing is created', async () => {
    const email = uniqueEmail('stale');
    const res = await signup(email, before);
    expect(res.status).toBe(400);
    const body = await envelope(res);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual({ consents: 'stale' });
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from auth.users where email = ${email}`;
    expect(count?.n).toBe(0);
  });

  it('support and member get 403 FORBIDDEN on both routes, and nothing changes', async () => {
    for (const token of [tokens.support, tokens.member]) {
      const read = await getRules(token);
      expect(read.status).toBe(403);
      expect((await envelope(read)).error.code).toBe('FORBIDDEN');
      const write = await putRules(token, { rulesText: 'Tentativa sem permissão.' });
      expect(write.status).toBe(403);
      expect((await envelope(write)).error.code).toBe('FORBIDDEN');
    }
    expect(await rulesRow(ids.demo)).toEqual({ rules_text: NEW_RULES, rules_version: after });
  });

  it("rede-lab's admin edits rede-lab only, and rede-demo's rules stay put", async () => {
    const labText = 'Regras da Rede Lab, revisadas.';
    const res = await putRules(tokens.labAdmin, { rulesText: labText }, HOSTS.lab);
    expect(res.status).toBe(200);
    expect(await rules(res)).toEqual({
      rulesText: labText,
      rulesVersion: (snapshot.lab?.rules_version ?? 1) + 1,
    });
    expect(await rulesRow(ids.demo)).toEqual({ rules_text: NEW_RULES, rules_version: after });
  });

  it('a rede-demo session on the rede-lab host gets 403 TENANT_HOST_MISMATCH on both routes', async () => {
    const labBefore = await rulesRow(ids.lab);
    const read = await getRules(tokens.admin, HOSTS.lab);
    expect(read.status).toBe(403);
    expect((await envelope(read)).error.code).toBe('TENANT_HOST_MISMATCH');
    const write = await putRules(tokens.admin, { rulesText: 'Invasão.' }, HOSTS.lab);
    expect(write.status).toBe(403);
    expect((await envelope(write)).error.code).toBe('TENANT_HOST_MISMATCH');
    expect(await rulesRow(ids.lab)).toEqual(labBefore);
    expect(await rulesRow(ids.demo)).toEqual({ rules_text: NEW_RULES, rules_version: after });
  });
});
