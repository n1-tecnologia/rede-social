import { createECDH, randomBytes } from 'node:crypto';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs } from './setup';

/**
 * Native device tokens through the EXISTING save route (13-11, NATIVE-09, D-603, D-606): the body without
 * `kind` stays the web shape, a body with `kind: 'apns' | 'fcm'` is a device token written by
 * `app.push_device_upsert` (plan 13-06) inside the caller's own tenant transaction. The delete door is the
 * unchanged `DELETE /v1/notifications/push-subscriptions`. Runs with `PUSH_TRANSPORT=fake` (pinned by
 * `vitest.config.ts`); nothing here ever sends a push.
 *
 * Two tenants: the demo tenant and the lab tenant (notifications is OFF there in the seed, so the suite
 * turns it on and restores it). Every token carries a per-run random part and the suite deletes exactly
 * the endpoints it wrote, so no other file's rows are touched.
 */

const PATH = '/v1/notifications/push-subscriptions';

const tokens = { a1: '', a2: '', b1: '' };
const ids = { demo: '', lab: '', a1: '', a2: '', b1: '' };
const written = new Set<string>();
let labFlag: boolean | undefined;

const send = (
  method: 'POST' | 'DELETE',
  token: string,
  host: string,
  body: unknown,
): Promise<Response> =>
  api.request(PATH, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-tenant-host': host,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const apnsToken = () => randomBytes(32).toString('hex');
const fcmToken = () => randomBytes(75).toString('base64url');

const apnsBody = (token: string) => ({
  kind: 'apns',
  token,
  platform: 'ios',
  environment: 'production',
  appVersion: '1.2.3',
});
const fcmBody = (token: string) => ({
  kind: 'fcm',
  token,
  platform: 'android',
  environment: 'production',
  appVersion: '1.2.3',
});

const saveDevice = (who: 'a1' | 'a2' | 'b1', body: { token: string }): Promise<Response> => {
  written.add(body.token);
  return send('POST', tokens[who], who === 'b1' ? HOSTS.lab : HOSTS.demo, body);
};
const forget = (who: 'a1' | 'a2' | 'b1', endpoint: string): Promise<Response> =>
  send('DELETE', tokens[who], who === 'b1' ? HOSTS.lab : HOSTS.demo, { endpoint });

type DeviceRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  endpoint: string;
  kind: string;
  platform: string | null;
  app_environment: string | null;
  app_version: string | null;
};

/** The owner's read: one member's rows in one tenant, in the stable `created_at, id` order. */
const rowsOf = (tenantId: string, userId: string) =>
  adminSql<DeviceRow[]>`
    select id::text as id, tenant_id::text as tenant_id, user_id::text as user_id, endpoint, kind,
           platform, app_environment, app_version
      from public.push_subscriptions
     where tenant_id = ${tenantId}::uuid and user_id = ${userId}::uuid
     order by created_at, id`;

const rowsOfToken = (endpoint: string) =>
  adminSql<DeviceRow[]>`
    select id::text as id, tenant_id::text as tenant_id, user_id::text as user_id, endpoint, kind,
           platform, app_environment, app_version
      from public.push_subscriptions where endpoint = ${endpoint} order by tenant_id`;

async function sweep(): Promise<void> {
  for (const endpoint of written) {
    await adminSql`delete from public.push_subscriptions where endpoint = ${endpoint}`;
  }
  await adminSql`
    delete from public.push_subscriptions
     where user_id in (${ids.a1}::uuid, ${ids.a2}::uuid, ${ids.b1}::uuid) and kind <> 'webpush'`;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  const [demo] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-demo'`;
  const [lab] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-lab'`;
  ids.demo = demo?.id ?? '';
  ids.lab = lab?.id ?? '';
  const [a1] = await adminSql<{ id: string }[]>`
    select id::text as id from auth.users where email = 'member@rede-demo.local'`;
  const [b1] = await adminSql<{ id: string }[]>`
    select id::text as id from auth.users where email = 'member@rede-lab.local'`;
  ids.a1 = a1?.id ?? '';
  ids.b1 = b1?.id ?? '';
  const [second] = await adminSql<{ email: string; id: string }[]>`
    select u.email, u.id::text as id from public.users u
      join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${ids.demo}::uuid and m.role = 'member' and m.status = 'active'
       and m.blocked_at is null and m.deleted_at is null
       and u.email <> 'member@rede-demo.local' and u.email not like '%removid%'
     order by u.email limit 1`;
  if (!second) throw new Error('the seed must provide a second demo member');
  ids.a2 = second.id;
  tokens.a1 = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.a2 = await signInAs(second.email, SEED_PASSWORD);
  tokens.b1 = await signInAs('member@rede-lab.local', SEED_PASSWORD);

  const [flag] = await adminSql<{ enabled: boolean }[]>`
    select enabled from public.tenant_modules
     where tenant_id = ${ids.lab}::uuid and module_key = 'notifications'`;
  labFlag = flag?.enabled;
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${ids.lab}::uuid, 'notifications', true)
    on conflict (tenant_id, module_key) do update set enabled = true`;
  moduleFlags.invalidate(ids.lab);
});

afterAll(async () => {
  await sweep();
  if (labFlag === undefined) {
    await adminSql`
      delete from public.tenant_modules
       where tenant_id = ${ids.lab}::uuid and module_key = 'notifications'`;
  } else {
    await adminSql`
      update public.tenant_modules set enabled = ${labFlag}
       where tenant_id = ${ids.lab}::uuid and module_key = 'notifications'`;
  }
  moduleFlags.invalidate(ids.lab);
});

describe('tracer: a native token through the existing route, isolated per tenant (NATIVE-09)', () => {
  it('1. a member saves an apns and an fcm token, reads both back byte-exact, and another tenant sees none', async () => {
    const apns = apnsToken();
    const fcm = fcmToken();
    expect((await saveDevice('a1', apnsBody(apns))).status).toBe(204);
    expect((await saveDevice('a1', fcmBody(fcm))).status).toBe(204);

    const mine = await rowsOf(ids.demo, ids.a1);
    const native = mine.filter((row) => row.kind !== 'webpush');
    expect(native.map((row) => row.endpoint).sort()).toEqual([apns, fcm].sort());
    const apnsRow = native.find((row) => row.endpoint === apns);
    expect(apnsRow).toMatchObject({
      kind: 'apns',
      platform: 'ios',
      app_environment: 'production',
      app_version: '1.2.3',
      tenant_id: ids.demo,
      user_id: ids.a1,
    });
    expect(native.find((row) => row.endpoint === fcm)).toMatchObject({
      kind: 'fcm',
      platform: 'android',
      app_environment: 'production',
    });

    // The member of the OTHER tenant and the other member of THIS tenant hold none of it.
    expect((await rowsOf(ids.lab, ids.b1)).filter((r) => r.endpoint === apns || r.endpoint === fcm))
      .toEqual([]);
    expect((await rowsOf(ids.demo, ids.a2)).filter((r) => r.endpoint === apns)).toEqual([]);

    // The lab member saves the SAME strings: separate rows, the demo rows are untouched (per-tenant key).
    expect((await saveDevice('b1', apnsBody(apns))).status).toBe(204);
    expect((await saveDevice('b1', fcmBody(fcm))).status).toBe(204);
    expect((await rowsOfToken(apns)).map((row) => row.tenant_id).sort()).toEqual(
      [ids.demo, ids.lab].sort(),
    );
    expect((await rowsOfToken(fcm)).map((row) => row.user_id).sort()).toEqual(
      [ids.a1, ids.b1].sort(),
    );

    // Delete through the existing owner-scoped DELETE: only the demo member's apns row goes.
    expect((await forget('a1', apns)).status).toBe(204);
    expect((await rowsOfToken(apns)).map((row) => row.tenant_id)).toEqual([ids.lab]);
    expect((await rowsOfToken(fcm)).length).toBe(2);
  });

  it('2. a body without kind still saves a web subscription, and the answer is the same 204', async () => {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const endpoint = `https://push.fake.test/13-11/${randomBytes(8).toString('hex')}`;
    written.add(endpoint);
    const res = await send('POST', tokens.a1, HOSTS.demo, {
      endpoint,
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
      userAgent: 'vitest',
    });
    expect(res.status).toBe(204);
    const [row] = await rowsOfToken(endpoint);
    expect(row).toMatchObject({ kind: 'webpush', user_id: ids.a1, platform: null });
    expect((await forget('a1', endpoint)).status).toBe(204);
    expect(await rowsOfToken(endpoint)).toEqual([]);
  });
});
