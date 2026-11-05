import { generateKeyPairSync } from 'node:crypto';
import { appTabSchema } from '@rede-social/contracts/native';
import { sqlClient } from '@rede-social/core/db';
import { readAppCredential } from '@rede-social/core/server/apps/index';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

/**
 * Every line any logger writes in this file is captured, so the sentinel scan reads what a person tailing the
 * logs would see (T-13-16). The mock replaces the ONE root logger every kernel and API logger derives from.
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

/** Counts every call to the one function that unseals, so a route that opens a credential is caught (T-13-16). */
const unsealed = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@rede-social/core/server/secrets/sealed', async (importOriginal) => {
  const real = await importOriginal<typeof import('@rede-social/core/server/secrets/sealed')>();
  return {
    ...real,
    open: (...args: Parameters<typeof real.open>) => {
      unsealed.calls += 1;
      return real.open(...args);
    },
  };
});

/**
 * Phase 13-09 (D-605, D-539, D-615, D-617, NATIVE-24, NATIVE-26, T-13-16, T-13-17, T-13-18): the App tab's
 * platform routes against the real stack. The tracer saves an Apple push key through the real route as a
 * `super_admin` and proves the sentinel appears in no response, no log line and no row except as the sealed
 * value; the later cases cover the other writes, the refusals and the sweep.
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
const code = async (res: Response) => ((await res.json()) as Envelope).error.code;

// --- The sentinel material ------------------------------------------------------------------------------

const KEY_ID = `SX${RUN.toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .slice(-8)
  .padStart(8, '0')}`;
const ISSUER_ID = '5e17e1a1-aaaa-4bbb-8ccc-0123456789ab';
const ecPem = () =>
  generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
const rsaPem = () =>
  generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();

const bodyOf = (pem: string) =>
  pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');

/** The sentinel and every fragment of it that must never appear outside the sealed column. */
const fragmentsOf = (pem: string, extra: string[] = []): string[] => {
  const body = bodyOf(pem);
  return [pem.trim(), body, body.slice(0, 8), body.slice(-8), body.slice(40, 56), ...extra];
};

/** Everything a person could see: the log lines, plus both tables read as text except the sealed column. */
async function visibleText(tenantId: string): Promise<string> {
  const apps =
    await adminSql`select * from platform.tenant_apps where tenant_id = ${tenantId}::uuid`;
  const creds = await adminSql`
    select id, tenant_id, kind, held_at from platform.tenant_app_credentials
     where tenant_id = ${tenantId}::uuid`;
  return JSON.stringify([captured.lines, apps, creds]);
}

// --- Fixtures --------------------------------------------------------------------------------------------

const SLUG = `pa-${RUN}`.slice(0, 40);
const HOST = `pa-${RUN}.cliente.test`;
let tenantId = '';

async function cleanup(): Promise<void> {
  await adminSql`delete from public.tenants where slug like 'pa-%'`;
}

beforeAll(async () => {
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }
  await cleanup();
  superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  tenantAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tenantMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);

  const [tenant] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name)
    values (${SLUG}, ${'Comunidade Aplicativo Sentinela de Teste Longa'})
    returning id::text as id`;
  tenantId = tenant?.id ?? '';
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
    values (${tenantId}::uuid, ${HOST}, true, now(), 'verified')`;
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

describe('tracer: an Apple push key is saved write-only and read back as held (NATIVE-26, D-605, D-539)', () => {
  const FORBIDDEN_KEYS = ['p8', 'keyId', 'issuerId', 'sealed', 'json', 'fileKeyId'];
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

  it('a super_admin saves the key, the read answers held with a date, and the sentinel is nowhere but in the sealed value', async () => {
    const pem = ecPem();
    const sentinels = fragmentsOf(pem, [KEY_ID]);

    const saved = await platform(`/tenants/${tenantId}/app/credentials/apns_key`, {
      method: 'PUT',
      body: { keyId: KEY_ID, p8: pem },
    });
    expect(saved.status).toBe(200);
    expect(saved.headers.get('cache-control')).toBe('no-store');
    const savedText = await saved.text();
    expect(JSON.parse(savedText)).toEqual({ ok: true });

    const read = await platform(`/tenants/${tenantId}/app`);
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toBe('no-store');
    const readText = await read.text();
    const tab = appTabSchema.parse(JSON.parse(readText));
    expect(tab.credentials).toEqual([
      { kind: 'asc_key', held: false, heldAt: null },
      { kind: 'play_service_account', held: false, heldAt: null },
      { kind: 'apns_key', held: true, heldAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
    ]);
    for (const key of keysOf(JSON.parse(readText))) expect(FORBIDDEN_KEYS).not.toContain(key);

    const headers = JSON.stringify([...saved.headers, ...read.headers]);
    const visible = await visibleText(tenantId);
    for (const sentinel of sentinels) {
      expect(savedText, 'save body').not.toContain(sentinel);
      expect(readText, 'read body').not.toContain(sentinel);
      expect(headers, 'headers').not.toContain(sentinel);
      expect(visible, 'logs and plain columns').not.toContain(sentinel);
    }

    // The sealed column holds a sealed string, not the plaintext.
    const [row] = await adminSql<{ sealed: string }[]>`
      select sealed from platform.tenant_app_credentials
       where tenant_id = ${tenantId}::uuid and kind = 'apns_key'`;
    expect(row?.sealed.startsWith('v1:')).toBe(true);
    for (const sentinel of sentinels) expect(row?.sealed).not.toContain(sentinel);

    // The release worker's door opens it: the key and the Key ID travel inside the sealed string.
    const opened = JSON.parse((await readAppCredential(tenantId, 'apns_key')) ?? 'null');
    // The body schema trims the pasted text, so what was sealed is the trimmed PEM.
    expect(opened).toEqual({ keyId: KEY_ID, p8: pem.trim() });
  });

  it('a tenant admin, a tenant member and an anonymous caller are refused on both routes', async () => {
    const pem = ecPem();
    for (const [token, status, refusal] of [
      [tenantAdmin, 403, 'FORBIDDEN'],
      [tenantMember, 403, 'FORBIDDEN'],
      [null, 401, null],
    ] as const) {
      const read = await platform(`/tenants/${tenantId}/app`, { token });
      expect(read.status, 'read').toBe(status);
      const write = await platform(`/tenants/${tenantId}/app/credentials/apns_key`, {
        method: 'PUT',
        token,
        body: { keyId: KEY_ID, p8: pem },
      });
      expect(write.status, 'write').toBe(status);
      if (refusal) expect(await code(write)).toBe(refusal);
    }
    expect(JSON.stringify(captured.lines)).not.toContain(bodyOf(pem).slice(0, 12));
  });

  it('no route of the sub-router unseals a credential', async () => {
    unsealed.calls = 0;
    const pem = ecPem();
    const put = await platform(`/tenants/${tenantId}/app/credentials/asc_key`, {
      method: 'PUT',
      body: { issuerId: ISSUER_ID, keyId: KEY_ID, p8: pem },
    });
    expect(put.status).toBe(200);
    expect((await platform(`/tenants/${tenantId}/app`)).status).toBe(200);
    expect(unsealed.calls).toBe(0);
    // The one legitimate door still works.
    expect(await readAppCredential(tenantId, 'asc_key')).not.toBeNull();
    expect(unsealed.calls).toBe(1);
  });

  it('a wrong file changes nothing: the previously held key still opens and the answer is a closed code', async () => {
    const before = await readAppCredential(tenantId, 'apns_key');
    const [rowBefore] = await adminSql<{ id: string; sealed: string }[]>`
      select id::text as id, sealed from platform.tenant_app_credentials
       where tenant_id = ${tenantId}::uuid and kind = 'apns_key'`;

    const rsa = rsaPem();
    const refused = await platform(`/tenants/${tenantId}/app/credentials/apns_key`, {
      method: 'PUT',
      body: { keyId: KEY_ID, p8: rsa },
    });
    expect(refused.status).toBe(400);
    const text = await refused.clone().text();
    expect(await code(refused)).toBe('CREDENTIAL_NOT_P8');
    expect(text).not.toContain(bodyOf(rsa).slice(0, 12));

    const mismatch = await platform(`/tenants/${tenantId}/app/credentials/apns_key`, {
      method: 'PUT',
      body: { keyId: KEY_ID, p8: ecPem(), fileKeyId: 'ZZZZZ99999' },
    });
    expect(mismatch.status).toBe(400);
    expect(await code(mismatch)).toBe('CREDENTIAL_KEY_ID_MISMATCH');

    const notAccount = await platform(`/tenants/${tenantId}/app/credentials/play_service_account`, {
      method: 'PUT',
      body: { json: JSON.stringify({ type: 'authorized_user' }) },
    });
    expect(await code(notAccount)).toBe('CREDENTIAL_NOT_SERVICE_ACCOUNT');

    const [rowAfter] = await adminSql<{ id: string; sealed: string }[]>`
      select id::text as id, sealed from platform.tenant_app_credentials
       where tenant_id = ${tenantId}::uuid and kind = 'apns_key'`;
    expect(rowAfter).toEqual(rowBefore);
    expect(await readAppCredential(tenantId, 'apns_key')).toBe(before);
  });

  it('replacing the same credential twice answers 200 both times and keeps ONE row with the same id (NATIVE-26)', async () => {
    const send = () =>
      platform(`/tenants/${tenantId}/app/credentials/apns_key`, {
        method: 'PUT',
        body: { keyId: KEY_ID, p8: ecPem() },
      });
    const [first] = await adminSql<{ id: string }[]>`
      select id::text as id from platform.tenant_app_credentials
       where tenant_id = ${tenantId}::uuid and kind = 'apns_key'`;

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);

    const rows = await adminSql<{ id: string }[]>`
      select id::text as id from platform.tenant_app_credentials
       where tenant_id = ${tenantId}::uuid and kind = 'apns_key'`;
    expect(rows).toEqual([first]);
    // The value still opens under the kept row id.
    expect(await readAppCredential(tenantId, 'apns_key')).not.toBeNull();
  });

  it('two concurrent first saves of a kind both answer 200, leave one row and the value opens', async () => {
    await adminSql`
      delete from platform.tenant_app_credentials
       where tenant_id = ${tenantId}::uuid and kind = 'play_service_account'`;
    const json = JSON.stringify({
      type: 'service_account',
      client_email: `race-${RUN}@sentinel.iam.gserviceaccount.com`,
      private_key: rsaPem(),
    });
    const send = () =>
      platform(`/tenants/${tenantId}/app/credentials/play_service_account`, {
        method: 'PUT',
        body: { json },
      });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const rows = await adminSql`
      select id from platform.tenant_app_credentials
       where tenant_id = ${tenantId}::uuid and kind = 'play_service_account'`;
    expect(rows).toHaveLength(1);
    expect(await readAppCredential(tenantId, 'play_service_account')).toBe(json);
  });

  it('an unknown tenant is 404 NOT_FOUND on both routes', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await platform(`/tenants/${unknown}/app`)).status).toBe(404);
    const write = await platform(`/tenants/${unknown}/app/credentials/apns_key`, {
      method: 'PUT',
      body: { keyId: KEY_ID, p8: ecPem() },
    });
    expect(write.status).toBe(404);
    expect(await code(write)).toBe('NOT_FOUND');
  });

  it('a body for the wrong kind, an unknown kind and an unknown key are 400 VALIDATION_FAILED without the value', async () => {
    const pem = ecPem();
    const wrongKind = await platform(`/tenants/${tenantId}/app/credentials/play_service_account`, {
      method: 'PUT',
      body: { keyId: KEY_ID, p8: pem },
    });
    expect(wrongKind.status).toBe(400);
    const wrongKindText = await wrongKind.text();
    expect((JSON.parse(wrongKindText) as Envelope).error.code).toBe('VALIDATION_FAILED');

    const unknownKind = await platform(`/tenants/${tenantId}/app/credentials/ios_distribution`, {
      method: 'PUT',
      body: { keyId: KEY_ID, p8: pem },
    });
    expect(unknownKind.status).toBe(400);
    const unknownKindText = await unknownKind.text();

    const extra = await platform(`/tenants/${tenantId}/app/credentials/apns_key`, {
      method: 'PUT',
      body: { keyId: KEY_ID, p8: pem, extra: 'x' },
    });
    expect(extra.status).toBe(400);
    const extraText = await extra.text();
    for (const text of [wrongKindText, unknownKindText, extraText]) {
      for (const sentinel of fragmentsOf(pem, [KEY_ID])) expect(text).not.toContain(sentinel);
    }
  });
});
