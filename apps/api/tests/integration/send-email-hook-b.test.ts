import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { rootLogger } from '@rede-social/core/server/logging';
import { parseHookSecrets } from '@rede-social/core/server/mail/hook-schema';
import { invalidateHookProject } from '@rede-social/core/server/mail/project-hook';
import { seal } from '@rede-social/core/server/secrets/sealed';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminSql, api, HOSTS, provisionTenantOnB, type TenantOnB } from './setup';

/**
 * Phase 09.2-11 (DBT-14, D-542, D-37): `POST /v1/hooks/auth/send-email/{hookRef}` — the Send Email Hook of
 * ONE Supabase project. The reference in the path selects the project, that project's own sealed secret
 * authenticates, and the tenant the mail is branded for is resolved INSIDE that project (a tenant of another
 * project is refused `wrong_project`).
 *
 * The tenant lives ONLY in `rede_tenant_b` (the central project holds a mirror under a different display
 * name, so a brand read from the wrong place is visible in the mail). A second `platform.projects` row,
 * whose reference differs from B's in its last character, is the foil: its secret must verify at its own
 * URL and nowhere else. Standard Webhooks signing is re-implemented with `node:crypto`, as in
 * `send-email-hook.test.ts`.
 */

const verifyCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('@rede-social/core/server/mail/hook-schema', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@rede-social/core/server/mail/hook-schema')>();
  return {
    ...original,
    verifyHookRequest: ((...args: Parameters<typeof original.verifyHookRequest>) => {
      verifyCalls.count += 1;
      return original.verifyHookRequest(...args);
    }) as typeof original.verifyHookRequest,
  };
});

const MAILPIT_URL = (process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324').replace(/\/$/, '');
const REF_PATH = '/v1/hooks/auth/send-email';
const B_NAME = 'Tenant B (central mirror)';

type Payload = {
  user: { id: string; email: string | null };
  email_data: Record<string, string>;
};

/** A fresh 32-byte secret: `[stored form `v1,whsec_<b64>`, bare base64 used to sign]`. */
function newSecret(): { stored: string; b64: string } {
  const b64 = randomBytes(32).toString('base64');
  return { stored: `v1,whsec_${b64}`, b64 };
}

function sign(secretB64: string, id: string, timestamp: string, raw: string): string {
  const mac = createHmac('sha256', Buffer.from(secretB64, 'base64'))
    .update(`${id}.${timestamp}.${raw}`)
    .digest('base64');
  return `v1,${mac}`;
}

function payloadFor(
  user: { id: string; email: string | null },
  redirectTo: string,
  actionType = 'recovery',
): Payload {
  return {
    user,
    email_data: {
      token: '123456',
      token_hash: `hook-b-${randomUUID()}`,
      redirect_to: redirectTo,
      email_action_type: actionType,
      site_url: 'http://localhost:3000',
      token_new: '',
      token_hash_new: '',
    },
  };
}

async function post(
  path: string,
  payload: Payload | string,
  secretB64: string | null,
  options: { id?: string } = {},
) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const id = options.id ?? `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secretB64 !== null) {
    headers['webhook-id'] = id;
    headers['webhook-timestamp'] = timestamp;
    headers['webhook-signature'] = sign(secretB64, id, timestamp, raw);
  }
  return api.request(path, { method: 'POST', headers, body: raw });
}

type MailpitMessage = { ID: string; From: { Name: string }; Subject: string; HTML: string };

async function mailpitFor(to: string, marker: string): Promise<MailpitMessage[]> {
  const list = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=20`,
  );
  if (!list.ok) throw new Error(`mailpit search answered ${list.status}`);
  const { messages } = (await list.json()) as { messages?: Array<{ ID: string }> };
  const found: MailpitMessage[] = [];
  for (const { ID } of messages ?? []) {
    const full = await fetch(`${MAILPIT_URL}/api/v1/message/${ID}`);
    if (!full.ok) continue;
    const message = (await full.json()) as MailpitMessage;
    if (message.HTML.includes(marker)) found.push(message);
  }
  return found;
}

async function mailpitFind(to: string, marker: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [first] = await mailpitFor(to, marker);
    if (first) return first;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no Mailpit message to ${to} carrying ${marker} within ${timeoutMs}ms`);
}

async function expectNoMail(to: string, marker: string, windowMs = 1_500) {
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  expect(await mailpitFor(to, marker)).toHaveLength(0);
}

/** Everything the process writes through the root logger's destination while `run` executes. */
async function captureLogs(run: () => Promise<void>): Promise<string[]> {
  const streamKey = Object.getOwnPropertySymbols(rootLogger).find(
    (symbol) => symbol.description === 'pino.stream',
  );
  if (!streamKey) throw new Error('pino stream symbol not found');
  const stream = (rootLogger as unknown as Record<symbol, { write: (chunk: string) => unknown }>)[
    streamKey
  ];
  if (!stream) throw new Error('pino stream not found');
  const lines: string[] = [];
  const original = stream.write.bind(stream);
  const spy = vi.spyOn(stream, 'write').mockImplementation((chunk: string) => {
    lines.push(String(chunk));
    return original(chunk);
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return lines;
}

const RUN = randomUUID().slice(0, 8);
let b: TenantOnB;
let bRef = '';
let foilRef = '';
let foilId = '';
const bSecret = newSecret();
const foilSecret = newSecret();
/** A third project, with a reference of its own and NO stored secret. */
let bareRef = '';
let bareId = '';
/** A fourth project whose field holds two secrets: a rotation window. */
let rotRef = '';
let rotId = '';
const rotOld = newSecret();
const rotNew = newSecret();
let demoMember: { id: string; email: string };

/** 16 random bytes in base64url: what the bootstrap makes (22 characters). */
const newRef = () => randomBytes(16).toString('base64url');
/** Same length, last character changed to another base64url character: an ADJACENT reference. */
function adjacentOf(ref: string): string {
  const last = ref.slice(-1);
  return ref.slice(0, -1) + (last === 'A' ? 'B' : 'A');
}

async function insertProject(
  hookRef: string,
  secret: { stored: string } | string | null,
): Promise<string> {
  const id = randomUUID();
  const ref = `fk-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const stored = typeof secret === 'string' ? secret : (secret?.stored ?? null);
  await adminSql`
    insert into platform.projects
           (id, ref, provider, credential_source, state, api_url, secret_key_id, hook_ref,
            hook_secret_sealed)
    values (${id}::uuid, ${ref}, 'fake', 'sealed', 'preparing', 'http://127.0.0.1:54321', 1, ${hookRef},
            ${stored === null ? null : seal(stored, `${id}:hook_secret`)})`;
  return id;
}

beforeAll(async () => {
  b = await provisionTenantOnB({ slug: `hook-b-${RUN}` });
  bRef = newRef();
  await adminSql`
    update platform.projects
       set hook_ref = ${bRef}, hook_secret_sealed = ${seal(bSecret.stored, `${b.projectId}:hook_secret`)}
     where id = ${b.projectId}::uuid`;
  foilRef = adjacentOf(bRef);
  foilId = await insertProject(foilRef, foilSecret);
  bareRef = newRef();
  bareId = await insertProject(bareRef, null);
  rotRef = newRef();
  rotId = await insertProject(rotRef, `${rotOld.stored}|${rotNew.b64}`);
  invalidateHookProject();

  const [member] = await adminSql<{ id: string; email: string }[]>`
    select u.id, u.email from public.users u
      join public.memberships m on m.user_id = u.id
      join public.tenants t on t.id = m.tenant_id
     where t.slug = 'rede-demo' and m.role = 'member'
     order by u.email limit 1`;
  if (!member) throw new Error('seed tenant rede-demo has no member (run pnpm db:seed)');
  demoMember = member;
}, 60_000);

afterAll(async () => {
  invalidateHookProject();
  await b?.cleanup();
  for (const id of [foilId, bareId, rotId]) {
    if (id) await adminSql`delete from platform.projects where id = ${id}::uuid`;
  }
});

const redirectToB = () => `http://${b.host}:3000/auth/confirm?next=/redefinir-senha`;

describe('POST /v1/hooks/auth/send-email/{hookRef}', () => {
  it('1. tracer: B’s own secret at B’s own URL sends the recovery mail of a tenant that lives only in database B', async () => {
    const payload = payloadFor({ id: b.userId, email: b.email }, redirectToB());
    const marker = payload.email_data.token_hash ?? '';

    const response = await post(`${REF_PATH}/${bRef}`, payload, bSecret.b64);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});

    const mail = await mailpitFind(b.email, marker);
    expect(mail.From.Name).toBe(B_NAME);
    expect(mail.Subject).toBe(`Redefina sua senha — ${B_NAME}`);
    expect(mail.HTML).toContain('type=recovery');
  });

  it('2. the foil project’s secret at B’s URL is a 401 and sends nothing; it verifies only at its own adjacent URL', async () => {
    const payload = payloadFor({ id: b.userId, email: b.email }, redirectToB());
    const marker = payload.email_data.token_hash ?? '';

    const wrong = await post(`${REF_PATH}/${bRef}`, payload, foilSecret.b64);
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: { http_code: 401, message: 'invalid signature' } });
    // And B's secret at the foil's URL (the reference differs by one character) is a 401 too.
    const reverse = await post(`${REF_PATH}/${foilRef}`, payload, bSecret.b64);
    expect(reverse.status).toBe(401);
    await expectNoMail(b.email, marker);
  });

  it('3. a project’s own secret still cannot brand another project’s tenant: wrong_project, GoTrue 500 shape, no mail', async () => {
    // The foil signs correctly at its own URL, but the tenant behind redirect_to belongs to project B.
    const foilPayload = payloadFor({ id: b.userId, email: b.email }, redirectToB());
    const foil = await post(`${REF_PATH}/${foilRef}`, foilPayload, foilSecret.b64);
    expect(foil.status).toBe(500);
    expect(await foil.json()).toEqual({ error: { http_code: 500, message: 'wrong_project' } });
    await expectNoMail(b.email, foilPayload.email_data.token_hash ?? '');

    // B signs correctly at its own URL, but redirect_to is the host of a tenant of project 0.
    const other = payloadFor(
      { id: b.userId, email: b.email },
      `http://${HOSTS.demo}:3000/auth/confirm?next=/redefinir-senha`,
    );
    const crossed = await post(`${REF_PATH}/${bRef}`, other, bSecret.b64);
    expect(crossed.status).toBe(500);
    expect(await crossed.json()).toEqual({ error: { http_code: 500, message: 'wrong_project' } });
    await expectNoMail(b.email, other.email_data.token_hash ?? '');
  });

  it('4. an unknown reference, a prefix, a one-character-off and an upper-cased one are 404 BEFORE any signature work', async () => {
    const payload = payloadFor({ id: b.userId, email: b.email }, redirectToB());
    const upper = bRef.toUpperCase();
    const first = bRef.charAt(0) === 'A' ? 'B' : 'A';
    const candidates = [
      newRef(),
      bRef.slice(0, 21),
      `${bRef}x`,
      first + bRef.slice(1),
      ...(upper === bRef ? [] : [upper]),
      encodeURIComponent('é'.repeat(22)),
    ];
    for (const candidate of candidates) {
      // Only an exact match of an existing reference may reach the signature check.
      if (candidate === bRef || candidate === foilRef || candidate === rotRef) continue;
      verifyCalls.count = 0;
      const response = await post(`${REF_PATH}/${candidate}`, payload, bSecret.b64);
      expect(response.status, candidate).toBe(404);
      expect(await response.json()).toEqual({ error: { http_code: 404, message: 'not found' } });
      expect(verifyCalls.count, candidate).toBe(0);
    }
    // An empty segment is no route at all (not the legacy route either).
    verifyCalls.count = 0;
    const empty = await post(`${REF_PATH}/`, payload, bSecret.b64);
    expect(empty.status).toBe(404);
    expect(verifyCalls.count).toBe(0);
  });

  it('5. a project with no stored secret answers 401, and an empty or unsigned body answers 401 without mail', async () => {
    const payload = payloadFor({ id: b.userId, email: b.email }, redirectToB());
    const noSecret = await post(`${REF_PATH}/${bareRef}`, payload, bSecret.b64);
    expect(noSecret.status).toBe(401);

    // An empty body that does not verify is a 401; one SIGNED by the right secret is a verified payload
    // that is not a hook payload, which is GoTrue's 500 shape, exactly as on the legacy route.
    const emptyUnsigned = await post(`${REF_PATH}/${bRef}`, '', null);
    expect(emptyUnsigned.status).toBe(401);
    const emptySigned = await post(`${REF_PATH}/${bRef}`, '', bSecret.b64);
    expect(emptySigned.status).toBe(500);
    expect(await emptySigned.json()).toEqual({
      error: { http_code: 500, message: 'invalid_payload' },
    });
    const unsigned = await post(`${REF_PATH}/${bRef}`, payload, null);
    expect(unsigned.status).toBe(401);
    await expectNoMail(b.email, payload.email_data.token_hash ?? '');
  });

  it('6. a verified payload without a recipient answers GoTrue’s 500 shape', async () => {
    const payload = payloadFor({ id: b.userId, email: null }, redirectToB());
    const response = await post(`${REF_PATH}/${bRef}`, payload, bSecret.b64);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { http_code: 500, message: 'no_recipient' } });
  });

  it('7. a rotation window verifies with either secret, and a replay with the other one is suppressed', async () => {
    // Re-point B's field at two secrets for the window; restore it afterwards.
    const stored = `${bSecret.stored}|${rotNew.b64}`;
    await adminSql`
      update platform.projects set hook_secret_sealed = ${seal(stored, `${b.projectId}:hook_secret`)}
       where id = ${b.projectId}::uuid`;
    invalidateHookProject();
    try {
      const payload = payloadFor({ id: b.userId, email: b.email }, redirectToB());
      const marker = payload.email_data.token_hash ?? '';
      const id = `msg_${randomUUID()}`;
      const first = await post(`${REF_PATH}/${bRef}`, payload, bSecret.b64, { id });
      expect(first.status).toBe(200);
      await mailpitFind(b.email, marker);
      // Same webhook-id, signed with the second secret: verified, but suppressed as a duplicate.
      const replay = await post(`${REF_PATH}/${bRef}`, payload, rotNew.b64, { id });
      expect(replay.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(await mailpitFor(b.email, marker)).toHaveLength(1);

      // A fresh payload signed with the second secret alone also sends.
      const second = payloadFor({ id: b.userId, email: b.email }, redirectToB());
      const viaSecond = await post(`${REF_PATH}/${bRef}`, second, rotNew.b64);
      expect(viaSecond.status).toBe(200);
      await mailpitFind(b.email, second.email_data.token_hash ?? '');
    } finally {
      await adminSql`
        update platform.projects set hook_secret_sealed = ${seal(bSecret.stored, `${b.projectId}:hook_secret`)}
         where id = ${b.projectId}::uuid`;
      invalidateHookProject();
    }
  });

  it('8. the rotation project’s two secrets are both its own: the old one and the new one verify at its URL only', async () => {
    const payload = payloadFor({ id: demoMember.id, email: demoMember.email }, redirectToB());
    // wrong_project for these (the tenant is B's), but the SIGNATURE passed: 500 rather than 401.
    const viaOld = await post(`${REF_PATH}/${rotRef}`, payload, rotOld.b64);
    const viaNew = await post(`${REF_PATH}/${rotRef}`, payload, rotNew.b64);
    expect(viaOld.status).toBe(500);
    expect(viaNew.status).toBe(500);
    const atB = await post(`${REF_PATH}/${bRef}`, payload, rotOld.b64);
    expect(atB.status).toBe(401);
  });

  it('9. the legacy path keeps serving project 0 with SEND_EMAIL_HOOK_SECRETS and never accepts a project secret', async () => {
    const legacy = parseHookSecrets(process.env.SEND_EMAIL_HOOK_SECRETS)[0];
    if (!legacy) throw new Error('SEND_EMAIL_HOOK_SECRETS is required');
    const payload = payloadFor(
      demoMember,
      `http://${HOSTS.demo}:3000/auth/confirm?next=/redefinir-senha`,
    );
    const ok = await post(REF_PATH, payload, legacy);
    expect(ok.status).toBe(200);
    const mail = await mailpitFind(demoMember.email, payload.email_data.token_hash ?? '');
    expect(mail.From.Name).toBe('Rede Demo');

    // B's secret at the legacy path, and the legacy secret at B's reference: both 401.
    const projectSecretAtLegacy = await post(REF_PATH, payload, bSecret.b64);
    expect(projectSecretAtLegacy.status).toBe(401);
    const legacyAtRef = await post(`${REF_PATH}/${bRef}`, payload, legacy);
    expect(legacyAtRef.status).toBe(401);
  });

  it('10. nothing secret or reference-shaped is logged, and the log line names the project', async () => {
    const payload = payloadFor({ id: b.userId, email: b.email }, redirectToB());
    const lines = await captureLogs(async () => {
      await post(`${REF_PATH}/${bRef}`, payload, bSecret.b64);
      await post(`${REF_PATH}/${bRef}`, payload, foilSecret.b64);
      await post(`${REF_PATH}/${newRef()}`, payload, foilSecret.b64);
    });
    const text = lines.join('\n');
    expect(text).not.toContain(bSecret.b64);
    expect(text).not.toContain(foilSecret.b64);
    expect(text).not.toContain(bRef);
    expect(text).toContain(b.projectId);
    expect(text).toContain('mail.signature_rejected');
    expect(text).toContain('mail.unknown_hook_ref');
  });
});
