import { bootstrapSchema, hostTenantSchema } from '@rede-social/contracts';
import { appVersionAnswerSchema, NATIVE_PLATFORM_HEADER } from '@rede-social/contracts/native';
import { sqlClient } from '@rede-social/core/db';
import { invalidatePurchaseSwitch } from '@rede-social/core/server/apps/index';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, SEED_PASSWORD, signInAs } from './setup';

/**
 * 13-10 (D-615, D-617, D-603, D-611; NATIVE-07, NATIVE-24, T-13-24, T-13-25): the two public / low-privilege reads
 * the native app depends on, against the real stack. The tracer is the fail-closed purchase answer of the
 * bootstrap, driven by the real switch route of plan 09; the by-host `app` block and the minimum-version read
 * hang off the same stored row.
 */

type Envelope = { error: { code: string } };

const RUN = Date.now().toString(36);
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';
const MEMBER = 'member@rede-demo.local';
const PLATFORM_HEADER = NATIVE_PLATFORM_HEADER;

const FINGERPRINT = Array.from({ length: 32 }, (_, i) => (i * 5 + 1).toString(16).padStart(2, '0'))
  .join(':')
  .toUpperCase();

let superAdmin = '';
let member = '';
let demoId = '';

// Two throwaway tenants of their own for the by-host and version reads: one with app data, one without.
const WITH_SLUG = `pubapp-w-${RUN}`.slice(0, 40);
const NONE_SLUG = `pubapp-n-${RUN}`.slice(0, 40);
const SUSP_SLUG = `pubapp-s-${RUN}`.slice(0, 40);
const host = (tag: string) => `pubapp-${tag}-${RUN}.localhost`;
const ids: Record<string, string> = {};

const platform = (path: string, method: string, body?: unknown) =>
  api.request(`/v1/platform${path}`, {
    method,
    headers: {
      authorization: `Bearer ${superAdmin}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const setSwitch = async (tenantId: string, platformName: 'ios' | 'android', visible: boolean) => {
  const res = await platform(`/tenants/${tenantId}/app/purchase`, 'PUT', {
    platform: platformName,
    visible,
  });
  expect(res.status).toBe(200);
};
const bootstrap = (headers: Record<string, string> = {}) =>
  api.request('/v1/me/bootstrap', { headers: { authorization: `Bearer ${member}`, ...headers } });
const byHost = (h: string) =>
  api.request(`/v1/public/tenants/by-host?host=${encodeURIComponent(h)}`);
const version = (slug: string) => api.request(`/v1/public/tenants/${slug}/app-version`);
const visibleOf = async (headers: Record<string, string> = {}) => {
  const res = await bootstrap(headers);
  expect(res.status).toBe(200);
  return bootstrapSchema.parse(await res.json()).purchaseVisible;
};

async function makeTenant(slug: string, tag: string, status: 'active' | 'suspended') {
  const [tenant] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version, status)
    values (${slug}, ${`Teste ${tag}`}, 'Regras de teste.', 1, ${status})
    returning id::text as id`;
  const id = tenant?.id ?? '';
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at, verification_status)
    values (${id}::uuid, ${host(tag)}, true, now(), 'verified')`;
  ids[tag] = id;
}

async function cleanup() {
  await adminSql`delete from public.tenants where slug like 'pubapp-%'`;
  if (demoId) {
    await adminSql`delete from platform.tenant_apps where tenant_id = ${demoId}::uuid`;
    invalidatePurchaseSwitch(demoId);
  }
}

beforeAll(async () => {
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }
  superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  member = await signInAs(MEMBER, SEED_PASSWORD);
  const [demo] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  demoId = demo?.id ?? '';
  if (!demoId) throw new Error('seed missing: run pnpm db:seed');
  await adminSql`delete from public.tenants where slug like 'pubapp-%'`;
  await adminSql`delete from platform.tenant_apps where tenant_id = ${demoId}::uuid`;
  invalidatePurchaseSwitch(demoId);
  await makeTenant(WITH_SLUG, 'w', 'active');
  await makeTenant(NONE_SLUG, 'n', 'active');
  await makeTenant(SUSP_SLUG, 's', 'suspended');
});

afterAll(async () => {
  await cleanup();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer: the bootstrap answers purchase visibility per store and fails closed (D-615, D-617, NATIVE-24)', () => {
  it('with the switches at their default: native iOS false, a browser true; then iOS on shows iOS only', async () => {
    // No tenant_apps row yet: a native request fails closed, a browser is unchanged.
    expect(await visibleOf({ [PLATFORM_HEADER]: 'ios' })).toBe(false);
    expect(await visibleOf({ [PLATFORM_HEADER]: 'android' })).toBe(false);
    expect(await visibleOf()).toBe(true);

    await setSwitch(demoId, 'ios', true);

    expect(await visibleOf({ [PLATFORM_HEADER]: 'ios' })).toBe(true);
    expect(await visibleOf({ [PLATFORM_HEADER]: 'android' })).toBe(false);
    expect(await visibleOf()).toBe(true);

    // Reading twice and writing the same value twice change nothing (idempotency).
    expect(await visibleOf({ [PLATFORM_HEADER]: 'ios' })).toBe(true);
    await setSwitch(demoId, 'ios', true);
    expect(await visibleOf({ [PLATFORM_HEADER]: 'ios' })).toBe(true);
    const rows = await adminSql`select 1 from platform.tenant_apps where tenant_id = ${demoId}::uuid`;
    expect(rows.length).toBe(1);

    await setSwitch(demoId, 'ios', false);
    expect(await visibleOf({ [PLATFORM_HEADER]: 'ios' })).toBe(false);
  });

  it('every header value outside ios / android is native with no platform and gets false, even with both switches on', async () => {
    await setSwitch(demoId, 'ios', true);
    await setSwitch(demoId, 'android', true);
    for (const value of ['', 'IOS', 'Android', 'windows', 'ios,android', 'ios android', 'ios;']) {
      expect(await visibleOf({ [PLATFORM_HEADER]: value }), `header ${JSON.stringify(value)}`).toBe(
        false,
      );
    }
    expect(await visibleOf({ [PLATFORM_HEADER]: 'ios' })).toBe(true);
    expect(await visibleOf({ [PLATFORM_HEADER]: 'android' })).toBe(true);
    await setSwitch(demoId, 'ios', false);
    await setSwitch(demoId, 'android', false);
  });

  it('the answer is a strict boolean on the wire, never a string or a number', async () => {
    const raw = (await (await bootstrap({ [PLATFORM_HEADER]: 'ios' })).json()) as {
      purchaseVisible: unknown;
    };
    expect(raw.purchaseVisible).toBe(false);
    const browser = (await (await bootstrap()).json()) as { purchaseVisible: unknown };
    expect(browser.purchaseVisible).toBe(true);
  });

  it('two concurrent bootstrap reads during a switch write each return the old or the new value, never an error', async () => {
    const results = await Promise.all([
      bootstrap({ [PLATFORM_HEADER]: 'android' }),
      setSwitch(demoId, 'android', true),
      bootstrap({ [PLATFORM_HEADER]: 'android' }),
    ]);
    for (const res of [results[0], results[2]]) {
      expect(res.status).toBe(200);
      expect([false, true]).toContain(bootstrapSchema.parse(await res.json()).purchaseVisible);
    }
    await setSwitch(demoId, 'android', false);
  });
});

describe('GET /v1/public/tenants/by-host carries the additive app block (D-603, D-611, T-13-24)', () => {
  it('a tenant with no app row answers app: null, and the answer parses with the strict schema', async () => {
    const res = await byHost(host('n'));
    expect(res.status).toBe(200);
    const raw = (await res.json()) as Record<string, unknown>;
    expect(raw.app).toBeNull();
    expect(hostTenantSchema.safeParse(raw).success).toBe(true);
    // Every field an older consumer required is still there, unchanged.
    for (const key of ['slug', 'displayName', 'status', 'isPrimary', 'primaryHost', 'branding']) {
      expect(raw).toHaveProperty(key);
    }
  });

  it('a tenant with data carries both sides and the switches, with no key beyond the strict block', async () => {
    const id = ids.w as string;
    await adminSql`
      insert into platform.tenant_apps (tenant_id, team_id, bundle_id, application_id, android_sha256, purchase_android, reviewer_email, privacy_url)
      values (${id}::uuid, 'ABCDE12345', 'test.pubapp.w', 'test.pubapp.w',
              ${adminSql.array([FINGERPRINT])}, true, 'revisor@exemplo.com', 'https://exemplo.com/privacidade')`;
    const res = await byHost(host('w'));
    expect(res.status).toBe(200);
    const raw = (await res.json()) as { app: Record<string, unknown> };
    const parsed = hostTenantSchema.parse(raw);
    expect(parsed.app).toEqual({
      ios: { appId: 'ABCDE12345.test.pubapp.w' },
      android: { applicationId: 'test.pubapp.w', sha256: [FINGERPRINT] },
      purchase: { ios: false, android: true },
    });
    expect(Object.keys(raw.app).sort()).toEqual(['android', 'ios', 'purchase']);
    const text = JSON.stringify(raw);
    expect(text).not.toContain('revisor@exemplo.com');
    expect(text).not.toContain('privacidade');
  });

  it('a platform with partial data is null while the other answers (D-611)', async () => {
    const id = ids.w as string;
    await adminSql`update platform.tenant_apps set android_sha256 = '{}' where tenant_id = ${id}::uuid`;
    const body = hostTenantSchema.parse(await (await byHost(host('w'))).json());
    expect(body.app?.android).toBeNull();
    expect(body.app?.ios).toEqual({ appId: 'ABCDE12345.test.pubapp.w' });
  });
});

describe('GET /v1/public/tenants/{slug}/app-version (NATIVE-07)', () => {
  it('a tenant with no row answers 0.0.0 and no store links; unauthenticated, cacheable 60 s, no cookie', async () => {
    const res = await version(NONE_SLUG);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(appVersionAnswerSchema.parse(await res.json())).toEqual({
      ios: { minVersion: '0.0.0', storeUrl: null },
      android: { minVersion: '0.0.0', storeUrl: null },
    });
  });

  it('answers the stored floors and links', async () => {
    const id = ids.w as string;
    await adminSql`
      update platform.tenant_apps
         set min_version_ios = '1.4.0', store_url_ios = 'https://apps.apple.com/app/id123',
             min_version_android = '1.5.2'
       where tenant_id = ${id}::uuid`;
    const body = appVersionAnswerSchema.parse(await (await version(WITH_SLUG)).json());
    expect(body).toEqual({
      ios: { minVersion: '1.4.0', storeUrl: 'https://apps.apple.com/app/id123' },
      android: { minVersion: '1.5.2', storeUrl: null },
    });
  });

  it('an unknown slug and a malformed slug are 404 TENANT_NOT_FOUND', async () => {
    for (const slug of ['nao-existe-nenhum', 'Rede-Demo']) {
      const res = await version(slug);
      expect(res.status).toBe(404);
      expect(((await res.json()) as Envelope).error.code).toBe('TENANT_NOT_FOUND');
    }
  });

  it('a suspended tenant still answers (no more information than the by-host answer)', async () => {
    const res = await version(SUSP_SLUG);
    expect(res.status).toBe(200);
    appVersionAnswerSchema.parse(await res.json());
  });

  it('carries the same middleware posture as the by-host route: no CORS grant, a request id, no session needed', async () => {
    // There is no rate limiter or CORS middleware on /v1/public (app.ts), so "the same chain" is the same
    // observable headers: both routes add the request id and neither grants a cross-origin read.
    const a = await version(NONE_SLUG);
    const b = await byHost(host('n'));
    expect(a.headers.get('access-control-allow-origin')).toBeNull();
    expect(b.headers.get('access-control-allow-origin')).toBeNull();
    expect(Boolean(a.headers.get('x-request-id'))).toBe(Boolean(b.headers.get('x-request-id')));
  });
});
