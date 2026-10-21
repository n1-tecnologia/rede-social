import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removePaymentIntegrations,
  removePaymentMappings,
  setPaymentsRow,
  signInAs,
} from './setup';

/**
 * 09.1-09 (D-491, D-492, D-494, D-501, D-502, D-338; PAY-04, PAY-08, PAY-11, PAY-19, PAY-20, PAY-31)
 * against the live local stack: the admin API of the `payments` module. The tracer is the whole setup
 * an admin does (connect, register an access product, preview, switch the gate on with the release) and
 * its effect on real requests.
 *
 * EVERY identity is a THROWAWAY built with `createSharedIdentity` (never a seed user), because the
 * release cases need members with NO access row and plan 03's seed gives the seed identities one.
 * Fixtures are removed by prefix in `beforeAll` (a crashed run) and `afterAll`; the manual rows a release
 * wrote are removed by the admin that wrote them. The tenant's `payments` row is written by the cases
 * and put back in a `finally`.
 */

const PREFIX = 'pay0919';
let labTenantId = '';

type Person = { userId: string; email: string; token: string };
type Role = 'member' | 'admin_tenant' | 'support_tenant';

async function person(host: keyof typeof HOSTS, role: Role = 'member'): Promise<Person> {
  const identity = await createSharedIdentity({ prefix: PREFIX, memberships: [{ host, role }] });
  return {
    userId: identity.userId,
    email: identity.email,
    token: await signInAs(identity.email, identity.password),
  };
}

/** Every response body the run read, so the secrecy assertions can walk all of them. */
const seenBodies: string[] = [];

async function call(
  who: Person,
  method: string,
  path: string,
  body?: unknown,
  host = HOSTS.lab,
): Promise<{ status: number; json: Record<string, unknown>; raw: string }> {
  const res = await api.request(`/v1/payments${path}`, {
    method,
    headers: {
      'x-tenant-host': host,
      authorization: `Bearer ${who.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await res.text();
  seenBodies.push(raw);
  return { status: res.status, json: raw ? (JSON.parse(raw) as Record<string, unknown>) : {}, raw };
}

const bootstrap = (who: Person, host = HOSTS.lab) =>
  api.request('/v1/me/bootstrap', {
    headers: { 'x-tenant-host': host, authorization: `Bearer ${who.token}` },
  });

const codeOf = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as { error?: { code?: string } }).error?.code;

/** Runs `fn` with the lab `payments` module ENABLED and the gate stored off, then restores the row. */
async function withPaymentsOn<T>(fn: () => Promise<T>, settings: Record<string, unknown> = {}) {
  const [previous] = await adminSql<{ enabled: boolean; settings: Record<string, unknown> }[]>`
    select enabled, settings from public.tenant_modules
     where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
  await setPaymentsRow(labTenantId, { enabled: true, settings });
  moduleFlags.invalidate(labTenantId);
  try {
    return await fn();
  } finally {
    if (previous) {
      await setPaymentsRow(labTenantId, { enabled: previous.enabled, settings: previous.settings });
    } else {
      await adminSql`
        delete from public.tenant_modules
         where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
    }
    moduleFlags.invalidate(labTenantId);
  }
}

async function sweep(): Promise<void> {
  // Rows a release wrote carry the writing admin as `created_by_user_id`; the throwaway admins are
  // identified by their e-mail prefix. Gateway rows of the fixtures are removed with the e-mail sweep.
  await adminSql`
    delete from public.access_grants
     where created_by_user_id in (select id from public.users where email like ${`${PREFIX}-%`})
        or email like ${`${PREFIX}-%`}`;
  await removePaymentMappings(labTenantId);
  await removePaymentIntegrations(labTenantId);
  await removeIdentitiesByPrefix(PREFIX);
}

beforeAll(async () => {
  const [tenant] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-lab'`;
  if (!tenant) throw new Error('tenant rede-lab is not seeded — run pnpm db:seed first');
  labTenantId = tenant.id;
  await sweep();
});

afterAll(async () => {
  await sweep();
  // The seed has no `payments` row for rede-lab; none must remain.
  await adminSql`
    delete from public.tenant_modules
     where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
  moduleFlags.invalidate(labTenantId);
});

/** The members the preview must count, computed WITHOUT `app.access_effective` (no row of any kind). */
async function membersWithoutAnyRow(): Promise<number> {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n
      from public.memberships m
      join public.users u on u.id = m.user_id
     where m.tenant_id = ${labTenantId}::uuid
       and m.role = 'member' and m.status = 'active'
       and m.blocked_at is null and m.deleted_at is null
       and not exists (
         select 1 from public.access_grants g
          where g.tenant_id = m.tenant_id and g.email = lower(btrim(u.email)))`;
  return row?.n ?? -1;
}

describe('09.1 tracer', () => {
  it('an admin connects, registers an access product, previews and turns the gate on with the release; the effect is real on the next request', async () => {
    const admin = await person('lab', 'admin_tenant');
    const support = await person('lab', 'support_tenant');
    const memberA = await person('lab');
    const blocked = await person('lab');
    await adminSql`
      insert into public.access_grants (tenant_id, email, source, status)
      values (${labTenantId}::uuid, ${blocked.email}, 'manual', 'blocked')`;
    const secret = `tracer-token-${crypto.randomUUID()}`;

    await withPaymentsOn(async () => {
      // Empty overview (P42): nothing connected, nothing registered, the gate cannot be enabled yet.
      const before = await call(admin, 'GET', '/overview');
      expect(before.status).toBe(200);
      const beforeOverview = before.json as {
        integration: {
          provider: string;
          gatewayName: string;
          connected: boolean;
          webhookUrl: string;
          lastEventAt: string | null;
        };
        accessProducts: unknown[];
        gate: { required: boolean; canEnable: boolean };
        serverNow: string;
      };
      expect(beforeOverview.integration.connected).toBe(false);
      expect(beforeOverview.integration.lastEventAt).toBeNull();
      expect(beforeOverview.integration.gatewayName.length).toBeGreaterThan(0);
      expect(beforeOverview.integration.webhookUrl).toMatch(
        new RegExp(`/v1/webhooks/${beforeOverview.integration.provider}/[0-9a-f-]{36}$`),
      );
      expect(beforeOverview.accessProducts).toEqual([]);
      expect(beforeOverview.gate).toEqual({ required: false, canEnable: false });
      expect(Number.isNaN(Date.parse(beforeOverview.serverNow))).toBe(false);

      // D-491: the gate cannot be turned on without an integration and an access product.
      const early = await call(admin, 'PUT', '/gate', { required: true });
      expect(early.status).toBe(409);
      expect(early.json).toMatchObject({
        error: { code: 'CONFLICT', details: { payments: 'gate_requires_setup' } },
      });

      // PAY-04: save the token. It is write-only: the answer says only that it is connected.
      const saved = await call(admin, 'PUT', '/integration', { token: secret });
      expect(saved.status).toBe(200);
      expect(saved.json).toEqual({ connected: true });
      const afterSave = await call(admin, 'GET', '/overview');
      const afterOverview = afterSave.json as typeof beforeOverview;
      expect(afterOverview.integration.connected).toBe(true);
      // The handle shown BEFORE the token existed is the handle of the row the save created.
      expect(afterOverview.integration.webhookUrl).toBe(beforeOverview.integration.webhookUrl);
      expect(afterOverview.gate.canEnable).toBe(false);
      const early2 = await call(admin, 'PUT', '/gate', { required: true });
      expect(early2.status).toBe(409);

      // D-502: an access product (with a checkout link).
      const created = await call(admin, 'POST', '/access-products', {
        name: 'Assinatura',
        externalProductId: `ext-${crypto.randomUUID()}`,
        checkoutUrl: 'https://pay.example.com/checkout/abc',
      });
      expect(created.status).toBe(201);
      expect(created.json).toMatchObject({
        name: 'Assinatura',
        checkoutUrl: 'https://pay.example.com/checkout/abc',
        feedsSubscribeButton: true,
      });
      const ready = (await call(admin, 'GET', '/overview')).json as typeof beforeOverview;
      expect(ready.accessProducts).toHaveLength(1);
      expect(ready.gate).toEqual({ required: false, canEnable: true });

      // PAY-31: the preview counts the live members with no access; staff and the manually blocked
      // e-mail are never counted.
      const expected = await membersWithoutAnyRow();
      expect(expected).toBeGreaterThanOrEqual(1);
      const preview = await call(admin, 'GET', '/gate/preview');
      expect(preview.status).toBe(200);
      expect(preview.json).toEqual({ count: expected });

      // Before the switch: no gate, member A passes.
      expect((await bootstrap(memberA)).status).toBe(200);

      // The switch with the release: `released` is what the server created in the same transaction.
      const on = await call(admin, 'PUT', '/gate', { required: true, releaseExisting: true });
      expect(on.status).toBe(200);
      expect(on.json).toEqual({ required: true, released: expected });
      const [written] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.access_grants
         where tenant_id = ${labTenantId}::uuid and created_by_user_id = ${admin.userId}::uuid
           and source = 'manual' and status = 'active'`;
      expect(written?.n).toBe(expected);

      // The released member passes; staff are exempt; the manual block is untouched.
      expect((await bootstrap(memberA)).status).toBe(200);
      expect((await bootstrap(support)).status).toBe(200);
      expect(await codeOf(await bootstrap(blocked))).toBe('MEMBERSHIP_BLOCKED');
      const [stillBlocked] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.access_grants
         where tenant_id = ${labTenantId}::uuid and email = ${blocked.email}
           and status = 'active'`;
      expect(stillBlocked?.n).toBe(0);

      // A member who arrives AFTER the release has no access: 403 SUBSCRIPTION_PENDING.
      const memberB = await person('lab');
      const cut = await bootstrap(memberB);
      expect(cut.status).toBe(403);
      expect(await codeOf(cut)).toBe('SUBSCRIPTION_PENDING');

      // Repeating the release releases nobody new for the already released (idempotent), and the
      // late arrival is the only one it can release now.
      const again = await call(admin, 'PUT', '/gate', { required: true, releaseExisting: true });
      expect(again.status).toBe(200);
      expect(again.json).toEqual({ required: true, released: 1 });
      expect((await bootstrap(memberB)).status).toBe(200);
      const thirdTime = await call(admin, 'PUT', '/gate', {
        required: true,
        releaseExisting: true,
      });
      expect(thirdTime.json).toEqual({ required: true, released: 0 });

      // Turning it off always works and reopens the tenant.
      const memberC = await person('lab');
      expect(await codeOf(await bootstrap(memberC))).toBe('SUBSCRIPTION_PENDING');
      const off = await call(admin, 'PUT', '/gate', { required: false });
      expect(off.status).toBe(200);
      expect(off.json).toEqual({ required: false, released: 0 });
      expect((await bootstrap(memberC)).status).toBe(200);
      const offOverview = (await call(admin, 'GET', '/overview')).json as typeof beforeOverview;
      expect(offOverview.gate).toEqual({ required: false, canEnable: true });
    });

    // PAY-04 / D-486: the token is in no body the run read.
    for (const body of seenBodies) {
      expect(body).not.toContain(secret);
      expect(body).not.toContain(Buffer.from(secret).toString('base64'));
    }
  }, 120_000);
});
