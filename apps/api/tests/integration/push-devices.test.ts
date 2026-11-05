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

const send = async (
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

const saveDevice = (
  who: 'a1' | 'a2' | 'b1',
  body: { token: string; [key: string]: unknown },
): Promise<Response> => {
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
    expect(
      (await rowsOf(ids.lab, ids.b1)).filter((r) => r.endpoint === apns || r.endpoint === fcm),
    ).toEqual([]);
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

/** The body of an error answer: `{ error: { code } }`. */
const codeOf = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: { code: string } }).error.code;

/** A browser-shaped web body (real key lengths) so the web arm can be compared with the native one. */
function webBody(endpoint: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
    userAgent: 'vitest',
  };
}

describe('NATIVE-09 edges over HTTP: refusals write nothing and never echo the token', () => {
  const refused = async (who: 'a1' | 'b1', body: unknown, label: string) => {
    const before = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.push_subscriptions where kind <> 'webpush'`;
    const res = await send('POST', tokens[who], who === 'b1' ? HOSTS.lab : HOSTS.demo, body);
    const text = await res.text();
    expect(res.status, `${label}: ${text}`).toBe(400);
    expect(JSON.parse(text).error.code, label).toBe('VALIDATION_FAILED');
    const after = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.push_subscriptions where kind <> 'webpush'`;
    expect(after[0]?.n, `${label}: nothing written`).toBe(before[0]?.n);
    return text;
  };

  it('3. the empty cases answer 400 VALIDATION_FAILED: {}, empty, whitespace, missing platform, missing environment', async () => {
    await refused('a1', {}, '{}');
    await refused('a1', apnsBody(''), 'empty token');
    await refused('a1', apnsBody(' '.repeat(64)), 'whitespace-only token');
    const { platform: _p, ...noPlatform } = apnsBody(apnsToken());
    await refused('a1', noPlatform, 'missing platform');
    const { environment: _e, ...noEnvironment } = apnsBody(apnsToken());
    await refused('a1', noEnvironment, 'missing environment');
    // A body that is not JSON is the framework's own 400 (the same for the web arm), and writes nothing.
    expect((await send('POST', tokens.a1, HOSTS.demo, 'not json')).status).toBe(400);
  });

  it('4. the boundary and adjacency cases are refused at the route, and no refusal echoes the token', async () => {
    const secret = 'ab'.repeat(15); // 30 hex characters: one short of the minimum
    const text = await refused('a1', apnsBody(secret), 'apns of 30 characters');
    expect(text.includes(secret), 'the token is never echoed').toBe(false);
    await refused('a1', apnsBody('a'.repeat(31)), 'apns 31');
    await refused('a1', apnsBody('a'.repeat(201)), 'apns 201');
    await refused('a1', fcmBody('A'.repeat(99)), 'fcm 99');
    await refused('a1', fcmBody('A'.repeat(4097)), 'fcm 4097');
    await refused('a1', { ...fcmBody(fcmToken()), environment: 'sandbox' }, 'fcm sandbox');
    await refused('a1', { ...apnsBody(apnsToken()), appVersion: '' }, 'appVersion 0');
    await refused(
      'a1',
      { ...apnsBody(apnsToken()), appVersion: `1.0.${'0'.repeat(29)}` },
      'appVersion 33',
    );
    await refused(
      'a1',
      apnsBody('https://web.push.apple.com/'.padEnd(64, 'a')),
      'a web endpoint URL sent as apns',
    );
    await refused('a1', apnsBody(fcmToken()), 'an fcm-style token sent as apns');
    await refused('a1', { ...apnsBody(apnsToken()), platform: 'android' }, 'apns with android');
    await refused(
      'a1',
      { ...webBody('https://fcm.googleapis.com/fcm/send/x'), kind: 'apns' },
      'both',
    );
    await refused('a1', { ...fcmBody(fcmToken()), kind: 'webpush' }, 'a client-sent webpush kind');
  });

  it('5. the encoding cases are refused: non-ASCII, NUL, percent-encoded, padded, trailing newline', async () => {
    const hex = apnsToken();
    await refused('a1', apnsBody(`${hex.slice(0, -1)}é`), 'non-ASCII');
    await refused('a1', apnsBody(`${hex.slice(0, -1)}\u0000`), 'NUL');
    await refused('a1', apnsBody(`${hex.slice(0, -3)}%41%`), 'percent-encoded');
    await refused('a1', apnsBody(` ${hex}`), 'leading space');
    await refused('a1', apnsBody(`${hex} `), 'trailing space');
    await refused('a1', apnsBody(`${hex}\n`), 'trailing newline');
  });

  it('6. precision: a 64-digit token sent as a JSON number is refused, the same digits as a string are stored byte-exact', async () => {
    const digits = '0123456789'.repeat(7).slice(0, 64);
    const asNumber = `{"kind":"apns","token":${digits.replace(/^0+/, '1')},"platform":"ios","environment":"production","appVersion":"1.0.0"}`;
    await refused('a1', asNumber, 'a JSON number');
    written.add(digits);
    expect((await saveDevice('a1', apnsBody(digits))).status).toBe(204);
    const [row] = await rowsOfToken(digits);
    expect(row?.endpoint).toBe(digits);
    expect(row?.user_id).toBe(ids.a1);
    expect((await forget('a1', digits)).status).toBe(204);
  });

  it('7. the answer for a refused body is the same wherever the body is wrong, and a wrong host or no session is refused before any write', async () => {
    const res = await send('POST', tokens.a1, HOSTS.lab, apnsBody(apnsToken()));
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('TENANT_HOST_MISMATCH');
    const anonymous = await api.request(PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-host': HOSTS.demo },
      body: JSON.stringify(apnsBody(apnsToken())),
    });
    expect(anonymous.status).toBe(401);
    const unknownKind = await send('POST', tokens.a1, HOSTS.demo, {
      ...apnsBody(apnsToken()),
      kind: 'gcm',
    });
    expect(unknownKind.status).toBe(400);
    expect(await codeOf(unknownKind)).toBe('VALIDATION_FAILED');
  });
});

describe('NATIVE-09 edges over HTTP: idempotency, ordering, concurrency', () => {
  it('8. saving the same token twice answers 204 both times and leaves one row; the second updates app_version only', async () => {
    const token = apnsToken();
    expect((await saveDevice('a1', { ...apnsBody(token) })).status).toBe(204);
    const [first] = await rowsOfToken(token);
    const [created] = await adminSql<{ created_at: Date }[]>`
      select created_at from public.push_subscriptions where id = ${first?.id ?? ''}::uuid`;
    expect((await saveDevice('a1', { ...apnsBody(token), appVersion: '1.2.4' })).status).toBe(204);
    const rows = await rowsOfToken(token);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id, 'the id is kept').toBe(first?.id);
    expect(rows[0]).toMatchObject({ app_version: '1.2.4', user_id: ids.a1, platform: 'ios' });
    const [again] = await adminSql<{ created_at: Date }[]>`
      select created_at from public.push_subscriptions where id = ${first?.id ?? ''}::uuid`;
    expect(again?.created_at.getTime(), 'created_at is left alone').toBe(
      created?.created_at.getTime(),
    );

    // Deleting the same token twice answers the same both times (and an unknown token the same again).
    expect((await forget('a1', token)).status).toBe(204);
    expect((await forget('a1', token)).status).toBe(204);
    expect((await forget('a1', apnsToken())).status).toBe(204);
    expect(await rowsOfToken(token)).toEqual([]);
  });

  it("9. deleting another member's token, or another tenant's, is the same 204 and deletes nothing", async () => {
    const token = apnsToken();
    expect((await saveDevice('a1', apnsBody(token))).status).toBe(204);
    expect((await forget('a2', token)).status, 'a foreign member').toBe(204);
    expect((await forget('b1', token)).status, 'a foreign tenant').toBe(204);
    expect(await rowsOfToken(token)).toHaveLength(1);
    expect((await forget('a1', token)).status).toBe(204);
  });

  it('10. a member holding a PWA subscription and an app token keeps BOTH rows, in a stable created_at, id order', async () => {
    const web = `https://push.fake.test/13-11/${randomBytes(8).toString('hex')}`;
    const token = fcmToken();
    written.add(web);
    expect((await send('POST', tokens.a2, HOSTS.demo, webBody(web))).status).toBe(204);
    expect((await saveDevice('a2', fcmBody(token))).status).toBe(204);
    const first = (await rowsOf(ids.demo, ids.a2)).filter(
      (r) => r.endpoint === web || r.endpoint === token,
    );
    const second = (await rowsOf(ids.demo, ids.a2)).filter(
      (r) => r.endpoint === web || r.endpoint === token,
    );
    expect(first.map((r) => [r.kind, r.endpoint])).toEqual([
      ['webpush', web],
      ['fcm', token],
    ]);
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
    expect((await forget('a2', token)).status).toBe(204);
    expect((await forget('a2', web)).status).toBe(204);
  });

  it('11. two members of ONE tenant saving the same token at once leave exactly one row and no 500', async () => {
    const token = apnsToken();
    for (let round = 0; round < 3; round += 1) {
      const answers = await Promise.all([
        saveDevice('a1', apnsBody(token)),
        saveDevice('a2', apnsBody(token)),
      ]);
      expect(answers.map((r) => r.status)).toEqual([204, 204]);
      const rows = await rowsOfToken(token);
      expect(rows, `round ${round}`).toHaveLength(1);
      expect([ids.a1, ids.a2]).toContain(rows[0]?.user_id);
    }
    await adminSql`delete from public.push_subscriptions where endpoint = ${token}`;
  });

  it('12. two tenants saving the same token at once leave one row in each', async () => {
    const token = fcmToken();
    const answers = await Promise.all([
      saveDevice('a1', fcmBody(token)),
      saveDevice('b1', fcmBody(token)),
    ]);
    expect(answers.map((r) => r.status)).toEqual([204, 204]);
    const rows = await rowsOfToken(token);
    expect(rows.map((r) => r.tenant_id).sort()).toEqual([ids.demo, ids.lab].sort());
    expect(rows.map((r) => r.user_id).sort()).toEqual([ids.a1, ids.b1].sort());
    await adminSql`delete from public.push_subscriptions where endpoint = ${token}`;
  });
});

describe('NATIVE-09 member state: a blocked or removed member is refused exactly as the web save refuses them', () => {
  const statusAndCode = async (res: Response) => ({
    status: res.status,
    code: res.status >= 400 ? await codeOf(res) : null,
  });

  it('13. a blocked member and a soft-deleted member get the same status and code on a native save as on a web save', async () => {
    const column = (name: 'blocked_at' | 'deleted_at', on: boolean) =>
      name === 'blocked_at'
        ? adminSql`update public.memberships set blocked_at = ${on ? new Date() : null}
                    where tenant_id = ${ids.demo}::uuid and user_id = ${ids.a2}::uuid`
        : adminSql`update public.memberships set deleted_at = ${on ? new Date() : null}
                    where tenant_id = ${ids.demo}::uuid and user_id = ${ids.a2}::uuid`;
    try {
      for (const name of ['blocked_at', 'deleted_at'] as const) {
        await column(name, true);
        const web = await statusAndCode(
          await send(
            'POST',
            tokens.a2,
            HOSTS.demo,
            webBody(`https://push.fake.test/13-11/${name}`),
          ),
        );
        const native = await statusAndCode(await saveDevice('a2', apnsBody(apnsToken())));
        expect(web.status, `${name}: the web save refuses`).toBeGreaterThanOrEqual(400);
        expect(native, `${name}: same status and code`).toEqual(web);
        await column(name, false);
      }
    } finally {
      await column('blocked_at', false);
      await column('deleted_at', false);
    }
    // Positive control: restored, the same member saves again.
    expect((await saveDevice('a2', apnsBody(apnsToken()))).status).toBe(204);
  });
});
