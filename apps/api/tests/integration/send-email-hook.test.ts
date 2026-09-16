import { createHmac, randomUUID } from 'node:crypto';
import { parseHookSecrets } from '@tria/core/server/mail/hook-schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS } from './setup';

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

function recoveryPayload(user: { id: string; email: string }, redirectTo: string): HookPayload {
  return {
    user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated' },
    email_data: {
      token: '123456',
      token_hash: `hook-test-${randomUUID()}`,
      redirect_to: redirectTo,
      email_action_type: 'recovery',
      site_url: 'http://localhost:3000',
      token_new: '',
      token_hash_new: '',
    },
  };
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

async function mailpitExpectNone(to: string, marker: string, windowMs = 3_000): Promise<void> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const found = await mailpitAll(to, marker);
    if (found.length > 0) throw new Error(`a message carrying ${marker} reached ${to}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

let demoMember: { id: string; email: string };

beforeAll(async () => {
  const [row] = await adminSql<{ id: string; email: string }[]>`
    select u.id, u.email from public.users u
      join public.memberships m on m.user_id = u.id
      join public.tenants t on t.id = m.tenant_id
     where t.slug = 'tria-demo' and m.role = 'member'
     order by u.email limit 1`;
  if (!row) throw new Error('seed tenant tria-demo has no member (run pnpm db:seed)');
  demoMember = row;
});

afterAll(async () => {
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
});
