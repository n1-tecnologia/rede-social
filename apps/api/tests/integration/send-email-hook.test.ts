import { createHmac, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { deriveBrandColors } from '@tria/contracts';
import { parseHookSecrets } from '@tria/core/server/mail/hook-schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, HOSTS } from './setup';

/**
 * `POST /v1/hooks/auth/send-email` against the live local stack (D-37/D-38, TENANT-06): a correctly
 * signed GoTrue payload must travel route → tenancy → template → local transport and land in Mailpit
 * branded for the recipient's tenant; anything not signed by a configured secret is refused with
 * GoTrue's 401 shape and sends nothing.
 *
 * The signature helper re-implements the Standard Webhooks algorithm with `node:crypto` because
 * apps/api deliberately has no `standardwebhooks` dependency (it is a kernel dependency).
 */

const MAILPIT_URL = (process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324').replace(/\/$/, '');
const MAIL_DOMAIN = process.env.MAIL_DOMAIN ?? 'mail.tria.localhost';
const HOOK_PATH = '/v1/hooks/auth/send-email';

type HookPayload = {
  user: { id: string; email: string; aud?: string; role?: string };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new: string;
    token_hash_new: string;
  };
};

type MailpitMessage = {
  ID: string;
  From: { Name: string; Address: string };
  To: Array<{ Name: string; Address: string }>;
  Subject: string;
  Text: string;
  HTML: string;
};

function secrets(): string[] {
  const list = parseHookSecrets(process.env.SEND_EMAIL_HOOK_SECRETS);
  if (list.length === 0) {
    throw new Error('SEND_EMAIL_HOOK_SECRETS is required (bash scripts/local-env.sh --write)');
  }
  return list;
}

/** `v1,<base64(HMAC-SHA256(secret, "{id}.{timestamp}.{body}"))>` — the Standard Webhooks spec. */
function signHook(secretB64: string, id: string, timestampSec: string, raw: string): string {
  const mac = createHmac('sha256', Buffer.from(secretB64, 'base64'))
    .update(`${id}.${timestampSec}.${raw}`)
    .digest('base64');
  return `v1,${mac}`;
}

type PostOptions = {
  secret?: string;
  id?: string;
  timestamp?: string;
  headers?: Record<string, string>;
  /** Alter the body AFTER signing (tamper case). */
  tamper?: (raw: string) => string;
};

async function postHook(payload: HookPayload, options: PostOptions = {}) {
  const raw = JSON.stringify(payload);
  const id = options.id ?? `msg_${randomUUID()}`;
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const secret = options.secret ?? secrets()[0] ?? '';
  const signature = signHook(secret, id, timestamp, raw);
  const headers: Record<string, string> = options.headers ?? {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': signature,
  };
  const started = performance.now();
  const response = await api.request(HOOK_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: options.tamper ? options.tamper(raw) : raw,
  });
  return { response, id, timestamp, signature, elapsedMs: performance.now() - started };
}

function hookPayload(
  user: { id: string; email: string },
  redirectTo: string,
  actionType: string,
): HookPayload {
  return {
    user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated' },
    email_data: {
      token: '123456',
      token_hash: `hook-test-${randomUUID()}`,
      redirect_to: redirectTo,
      email_action_type: actionType,
      site_url: 'http://localhost:3000',
      token_new: '',
      token_hash_new: '',
    },
  };
}

function recoveryPayload(user: { id: string; email: string }, redirectTo: string): HookPayload {
  return hookPayload(user, redirectTo, 'recovery');
}

async function mailpitSearch(to: string): Promise<Array<{ ID: string }>> {
  const query = encodeURIComponent(`to:${to}`);
  const list = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=20`);
  if (!list.ok) throw new Error(`mailpit search answered ${list.status}`);
  const { messages } = (await list.json()) as { messages?: Array<{ ID: string }> };
  return messages ?? [];
}

async function mailpitMessage(id: string): Promise<MailpitMessage> {
  const full = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  if (!full.ok) throw new Error(`mailpit message answered ${full.status}`);
  return (await full.json()) as MailpitMessage;
}

/** Every stored message to `to` whose HTML carries `marker`. */
async function mailpitAll(to: string, marker: string): Promise<MailpitMessage[]> {
  const found: MailpitMessage[] = [];
  for (const { ID } of await mailpitSearch(to)) {
    const message = await mailpitMessage(ID);
    if (message.HTML.includes(marker)) found.push(message);
  }
  return found;
}

/** Polls Mailpit until a message to `to` carries `marker` in its HTML. */
async function mailpitFind(
  to: string,
  marker: string,
  timeoutMs = 10_000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [first] = await mailpitAll(to, marker);
    if (first) return first;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no Mailpit message to ${to} carrying ${marker} within ${timeoutMs}ms`);
}

/** Messages to `to` whose `X-Tria-Idempotency-Key` header (set by the local transport) is `webhookId`. */
async function mailpitByWebhookId(to: string, webhookId: string): Promise<MailpitMessage[]> {
  const found: MailpitMessage[] = [];
  for (const { ID } of await mailpitSearch(to)) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/message/${ID}/headers`);
    if (!res.ok) continue;
    const headers = (await res.json()) as Record<string, string[] | undefined>;
    if (headers['X-Tria-Idempotency-Key']?.includes(webhookId))
      found.push(await mailpitMessage(ID));
  }
  return found;
}

async function mailpitFindByWebhookId(
  to: string,
  webhookId: string,
  timeoutMs = 10_000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [first] = await mailpitByWebhookId(to, webhookId);
    if (first) return first;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no Mailpit message to ${to} for webhook ${webhookId} within ${timeoutMs}ms`);
}

async function mailpitExpectNone(to: string, marker: string, windowMs = 3_000): Promise<void> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const found = await mailpitAll(to, marker);
    if (found.length > 0) throw new Error(`a message carrying ${marker} reached ${to}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

type Fixture = { id: string; email: string };

let demoMember: Fixture;
let superAdmin: Fixture;

/** Throwaway tenant with an accented name, NO logo and its own verified primary host (cases 5-9). */
const RUN = randomUUID().slice(0, 8);
const SJ_SLUG = `mail-test-${RUN}`;
const SJ_HOST = `${SJ_SLUG}.localhost`;
const SJ_NAME = 'Associação São José';
let sjTenantId: string;
let sjMember: Fixture;
let memberless: Fixture;
const createdAuthUsers: string[] = [];

/** The `public.users` mirror is written by a trigger; wait for it before inserting a membership. */
async function createThrowawayUser(email: string): Promise<Fixture> {
  const created = await authAdmin().createUser({
    email,
    password: 'Segredo123',
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw new Error(created.error?.message);
  const id = created.data.user.id;
  createdAuthUsers.push(id);
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = await adminSql`select id from public.users where id = ${id}::uuid`;
    if (rows.length > 0) return { id, email };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`public.users row missing for ${email}`);
}

beforeAll(async () => {
  const [row] = await adminSql<Fixture[]>`
    select u.id, u.email from public.users u
      join public.memberships m on m.user_id = u.id
      join public.tenants t on t.id = m.tenant_id
     where t.slug = 'tria-demo' and m.role = 'member'
     order by u.email limit 1`;
  if (!row) throw new Error('seed tenant tria-demo has no member (run pnpm db:seed)');
  demoMember = row;

  const [admin] = await adminSql<Fixture[]>`
    select u.id, u.email from public.platform_admins p
      join public.users u on u.id = p.user_id
     order by u.email limit 1`;
  if (!admin) throw new Error('no platform_admins row (run pnpm db:seed)');
  superAdmin = admin;

  const branding = {
    logoUrl: null,
    faviconUrl: null,
    iconUrl: null,
    iconUrls: null,
    iconVersion: 0,
    colors: deriveBrandColors({ primary: '#b45309', secondary: '#f59e0b' }),
  };
  const [tenant] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, branding)
    values (${SJ_SLUG}, ${SJ_NAME}, ${adminSql.json(branding)})
    returning id`;
  if (!tenant) throw new Error('could not create the throwaway tenant');
  sjTenantId = tenant.id;
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
    values (${sjTenantId}::uuid, ${SJ_HOST}, true, now(), 'verified')`;

  sjMember = await createThrowawayUser(`member-${RUN}@mail-test.local`);
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${sjTenantId}::uuid, ${sjMember.id}::uuid, 'member', 'active')`;
  memberless = await createThrowawayUser(`invitee-${RUN}@mail-test.local`);
});

afterAll(async () => {
  // auth.users -> public.users -> memberships cascade; the tenant cascades its domains.
  for (const id of createdAuthUsers) await authAdmin().deleteUser(id);
  if (sjTenantId) await adminSql`delete from public.tenants where id = ${sjTenantId}::uuid`;
  await adminSql.end();
});

describe('POST /v1/hooks/auth/send-email', () => {
  it('1. tracer: a signed recovery payload for a demo member lands in Mailpit branded for TRIA Demo', async () => {
    const payload = recoveryPayload(
      demoMember,
      `http://${HOSTS.demo}:3000/auth/confirm?next=/redefinir-senha`,
    );
    const marker = payload.email_data.token_hash;

    const { response, elapsedMs } = await postHook(payload);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
    expect(elapsedMs).toBeLessThan(1000);

    const mail = await mailpitFind(demoMember.email, marker);
    expect(mail.Subject).toBe('Redefina sua senha — TRIA Demo');
    expect(mail.From.Name).toBe('TRIA Demo');
    expect(mail.From.Address).toBe(`no-reply@${MAIL_DOMAIN}`);
    for (const fragment of [
      '#7c3aed',
      'color:#ffffff',
      'seed-logos/tria-demo.svg',
      'alt="TRIA Demo"',
      'Enviado pela plataforma TRIA',
      'token_hash=hook-test-',
      'type=recovery',
      '<meta charset="utf-8">',
    ]) {
      expect(mail.HTML, fragment).toContain(fragment);
    }
    expect(mail.HTML).not.toContain('#0f766e');
    expect(mail.Text).toContain('/auth/confirm?next=/redefinir-senha');
    expect(mail.Text).toContain(marker);
  });

  it('2. a payload signed with the wrong secret is refused with GoTrue’s 401 shape and sends nothing', async () => {
    const payload = recoveryPayload(
      demoMember,
      `http://${HOSTS.demo}:3000/auth/confirm?next=/redefinir-senha`,
    );
    const wrongSecret = Buffer.from('definitely-not-the-configured-secret').toString('base64');
    const { response } = await postHook(payload, { secret: wrongSecret });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { http_code: number; message: string } };
    expect(body.error.http_code).toBe(401);
    expect(typeof body.error.message).toBe('string');
    await mailpitExpectNone(demoMember.email, payload.email_data.token_hash);
  });

  it('3. a body altered after signing is refused with 401', async () => {
    const payload = recoveryPayload(
      demoMember,
      `http://${HOSTS.demo}:3000/auth/confirm?next=/redefinir-senha`,
    );
    const { response } = await postHook(payload, {
      tamper: (raw) => raw.replace('"recovery"', '"invite"'),
    });
    expect(response.status).toBe(401);
    await mailpitExpectNone(demoMember.email, payload.email_data.token_hash, 1_000);
  });

  it('4. a request without the webhook headers is refused with 401', async () => {
    const payload = recoveryPayload(
      demoMember,
      `http://${HOSTS.demo}:3000/auth/confirm?next=/redefinir-senha`,
    );
    const { response } = await postHook(payload, { headers: {} });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { http_code: number } }).error.http_code).toBe(401);
  });

  it('5. TENANT-06/empty + encoding: a tenant with no logo and an accented name renders the name as text, UTF-8 verbatim', async () => {
    const payload = recoveryPayload(
      sjMember,
      `http://${SJ_HOST}:3000/auth/confirm?next=/redefinir-senha`,
    );
    const { response } = await postHook(payload);
    expect(response.status).toBe(200);

    const mail = await mailpitFind(sjMember.email, payload.email_data.token_hash);
    expect(mail.Subject).toBe(`Redefina sua senha — ${SJ_NAME}`);
    expect(mail.From.Name).toBe(SJ_NAME);
    expect(mail.HTML).not.toContain('<img');
    expect(mail.HTML).toContain(`>${SJ_NAME}<`);
    expect(mail.HTML).toContain('#b45309');
    expect(mail.HTML).toContain('<meta charset="utf-8">');
    expect(mail.HTML).not.toContain('&atilde;');
    expect(mail.HTML).not.toContain('&ccedil;');
    expect(mail.Text).toContain(SJ_NAME);
  });

  it('6. invite by VERIFIED redirect host: a user with no membership yet gets the host tenant’s brand (D-29/D-30)', async () => {
    const payload = hookPayload(
      memberless,
      `http://${SJ_HOST}:3000/auth/confirm?next=/aceitar-convite`,
      'invite',
    );
    const { response } = await postHook(payload);
    expect(response.status).toBe(200);

    const mail = await mailpitFind(memberless.email, payload.email_data.token_hash);
    expect(mail.Subject).toBe(`Convite para administrar ${SJ_NAME}`);
    expect(mail.HTML).toContain(`Você foi convidado(a) a administrar ${SJ_NAME}`);
    expect(mail.HTML).toContain('type=invite');
    expect(mail.HTML).toContain('next=/aceitar-convite');
    expect(mail.HTML).toContain('#b45309');
  });

  it('7. no membership + unresolved host (localhost) → neutral TRIA, never another tenant’s brand', async () => {
    const payload = recoveryPayload(
      memberless,
      'http://localhost:3000/auth/confirm?next=/redefinir-senha',
    );
    const { response } = await postHook(payload);
    expect(response.status).toBe(200);

    const mail = await mailpitFind(memberless.email, payload.email_data.token_hash);
    expect(mail.Subject).toBe('Redefina sua senha — TRIA');
    expect(mail.From.Name).toBe('TRIA');
    expect(mail.HTML).toContain('#2e6fd0');
    for (const hex of ['#7c3aed', '#0f766e', '#b45309']) expect(mail.HTML).not.toContain(hex);
    expect(mail.HTML).not.toContain('<img');
  });

  it('8. a platform admin (no membership) on the platform host → neutral TRIA', async () => {
    const platformHost = process.env.PLATFORM_HOST ?? 'tria.localhost';
    const payload = recoveryPayload(
      superAdmin,
      `http://${platformHost}:3000/auth/confirm?next=/redefinir-senha`,
    );
    const { response } = await postHook(payload);
    expect(response.status).toBe(200);

    const mail = await mailpitFind(superAdmin.email, payload.email_data.token_hash);
    expect(mail.Subject).toBe('Redefina sua senha — TRIA');
    expect(mail.From.Name).toBe('TRIA');
    expect(mail.HTML).not.toContain('<img');
    for (const hex of ['#7c3aed', '#0f766e', '#b45309']) expect(mail.HTML).not.toContain(hex);
  });

  it('9. membership tenant ≠ verified tenant of the redirect host → 500 and nothing sent (D-23/D-37)', async () => {
    const payload = recoveryPayload(
      demoMember,
      `http://${HOSTS.lab}:3000/auth/confirm?next=/redefinir-senha`,
    );
    const { response } = await postHook(payload);
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { http_code: number; message: string } };
    expect(body.error.http_code).toBe(500);
    expect(body.error.message).toBe('tenant_host_mismatch');
    await mailpitExpectNone(demoMember.email, payload.email_data.token_hash);
  });

  it('10. a notification type renders the neutral fallback in the tenant brand without a link', async () => {
    const payload = hookPayload(
      demoMember,
      `http://${HOSTS.demo}:3000/auth/confirm`,
      'password_changed_notification',
    );
    const { response, id } = await postHook(payload);
    expect(response.status).toBe(200);

    const mail = await mailpitFindByWebhookId(demoMember.email, id);
    expect(mail.Subject).toBe('Sua senha foi alterada — TRIA Demo');
    expect(mail.HTML).not.toContain('/auth/confirm');
    expect(mail.HTML).toContain('#7c3aed');
  });

  it('11. replay: the identical request twice answers 200 twice and produces exactly ONE message', async () => {
    const payload = recoveryPayload(
      demoMember,
      `http://${HOSTS.demo}:3000/auth/confirm?next=/redefinir-senha`,
    );
    const first = await postHook(payload);
    expect(first.response.status).toBe(200);
    const second = await postHook(payload, { id: first.id, timestamp: first.timestamp });
    expect(second.response.status).toBe(200);
    expect(second.signature).toBe(first.signature);

    await mailpitFind(demoMember.email, payload.email_data.token_hash);
    // Give a hypothetical second delivery time to land, then count.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await mailpitAll(demoMember.email, payload.email_data.token_hash)).toHaveLength(1);
  });

  it.skipIf(!process.env.SEND_EMAIL_HOOK_SECRETS)(
    '12. GoTrue-originated: resetPasswordForEmail on the local stack travels GoTrue → host.docker.internal:8787 → this route → Mailpit, branded (D-37)',
    async () => {
      // A throwaway demo member so the address is unique to this run (GoTrue throttles recovery per user).
      const member = await createThrowawayUser(`gotrue-${RUN}@mail-test.local`);
      const [demo] = await adminSql<{ id: string }[]>`
        select id from public.tenants where slug = 'tria-demo'`;
      if (!demo) throw new Error('seed tenant tria-demo missing');
      await adminSql`
        insert into public.memberships (tenant_id, user_id, role, status)
        values (${demo.id}::uuid, ${member.id}::uuid, 'member', 'active')`;

      const supabaseUrl = process.env.SUPABASE_URL ?? '';
      const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? '';
      const client = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.auth.resetPasswordForEmail(member.email, {
        redirectTo: `http://${HOSTS.demo}:3000/auth/confirm?next=/redefinir-senha`,
      });
      expect(error).toBeNull();

      const deadline = Date.now() + 15_000;
      let mail: MailpitMessage | null = null;
      while (Date.now() < deadline && !mail) {
        for (const { ID } of await mailpitSearch(member.email)) {
          const message = await mailpitMessage(ID);
          if (message.Subject === 'Redefina sua senha — TRIA Demo') {
            mail = message;
            break;
          }
        }
        if (!mail) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!mail) throw new Error('GoTrue-originated recovery mail did not reach Mailpit');
      for (const fragment of [
        '/auth/confirm?next=/redefinir-senha',
        'token_hash=',
        'type=recovery',
        '#7c3aed',
        'seed-logos/tria-demo.svg',
      ]) {
        expect(mail.HTML, fragment).toContain(fragment);
      }
      expect(mail.From.Name).toBe('TRIA Demo');
    },
  );
});
