import { rootLogger } from '@rede-social/core/server/logging';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { deterministicIntegrationId } from '@rede-social/core/server/payments/ids';
import { openSecret } from '@rede-social/core/server/payments/secret';
import { setModuleEnabled } from '@rede-social/core/server/platform/modules';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removePaymentIntegrations,
  removePaymentMappings,
  setPaymentsRow,
  signedWebhook,
  signInAs,
  withModuleEnabled,
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
  let json: Record<string, unknown> = {};
  try {
    json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    // A non-JSON body (an unmounted route answers plain text): the status and raw text still tell.
  }
  return { status: res.status, json, raw };
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
  // The bulk members of the P72 case are inserted straight into auth.users (thirty GoTrue sign-ups would
  // dominate the run); GoTrue cannot load such rows, so they are deleted the same way (public.users,
  // memberships and profiles cascade).
  await adminSql`delete from auth.users where email like ${`${PREFIX}-bulk-%`}`;
  await removeIdentitiesByPrefix(PREFIX);
}

beforeAll(async () => {
  const [tenant] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-lab'`;
  if (!tenant) throw new Error('tenant rede-lab is not seeded — run pnpm db:seed first');
  labTenantId = tenant.id;
  await sweep();
});

// Every case starts from an empty tenant: no integration, no mapping (a failed case never leaks).
beforeEach(async () => {
  await removePaymentMappings(labTenantId);
  await removePaymentIntegrations(labTenantId);
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

// ── Task 2: access products and the store mapping ─────────────────────────────────────────────

type Product = {
  id: string;
  name: string;
  externalProductId: string;
  checkoutUrl: string | null;
  feedsSubscribeButton: boolean;
  createdAt: string;
};
type Overview = {
  integration: { connected: boolean; webhookUrl: string };
  accessProducts: Product[];
  gate: { required: boolean; canEnable: boolean };
};

const uniq = (label: string) => `${label}-${crypto.randomUUID().slice(0, 12)}`;
const details = (res: { json: Record<string, unknown> }) =>
  (res.json as { error?: { code?: string; details?: Record<string, unknown> } }).error;

async function overviewOf(who: Person): Promise<Overview> {
  return (await call(who, 'GET', '/overview')).json as unknown as Overview;
}

async function createProduct(
  who: Person,
  body: Record<string, unknown>,
): Promise<{ status: number; product: Product; raw: string }> {
  const res = await call(who, 'POST', '/access-products', body);
  return { status: res.status, product: res.json as unknown as Product, raw: res.raw };
}

describe('09.1 access products', () => {
  it('creates, lists in creation order, patches, and moves the Assinar marker with the oldest linked product', async () => {
    const admin = await person('lab', 'admin_tenant');
    await withPaymentsOn(async () => {
      const a = await createProduct(admin, { name: 'Sem link', externalProductId: uniq('a') });
      expect(a.status).toBe(201);
      expect(a.product).toMatchObject({
        name: 'Sem link',
        checkoutUrl: null,
        feedsSubscribeButton: false,
      });
      const b = await createProduct(admin, {
        name: 'Com link B',
        externalProductId: uniq('b'),
        checkoutUrl: 'https://pay.example.com/b',
      });
      const c = await createProduct(admin, {
        name: 'Com link C',
        externalProductId: uniq('c'),
        checkoutUrl: 'https://pay.example.com/c',
      });
      expect([b.status, c.status]).toEqual([201, 201]);

      // Creation order, and the OLDEST product that has a link feeds the button (A-UI-7).
      let overview = await overviewOf(admin);
      expect(overview.accessProducts.map((p) => p.id)).toEqual([
        a.product.id,
        b.product.id,
        c.product.id,
      ]);
      expect(overview.accessProducts.map((p) => p.feedsSubscribeButton)).toEqual([
        false,
        true,
        false,
      ]);

      // B loses its link: the marker moves to C. B gets one back: it returns to B.
      const unlinked = await call(admin, 'PATCH', `/access-products/${b.product.id}`, {
        checkoutUrl: null,
      });
      expect(unlinked.status).toBe(200);
      expect(unlinked.json).toMatchObject({ checkoutUrl: null, feedsSubscribeButton: false });
      overview = await overviewOf(admin);
      expect(overview.accessProducts.map((p) => p.feedsSubscribeButton)).toEqual([
        false,
        false,
        true,
      ]);
      await call(admin, 'PATCH', `/access-products/${b.product.id}`, {
        checkoutUrl: 'https://pay.example.com/b2',
      });
      overview = await overviewOf(admin);
      expect(overview.accessProducts.map((p) => p.feedsSubscribeButton)).toEqual([
        false,
        true,
        false,
      ]);

      // A single key changes only that key.
      const renamed = await call(admin, 'PATCH', `/access-products/${a.product.id}`, {
        name: 'Renomeado',
      });
      expect(renamed.json).toMatchObject({
        id: a.product.id,
        name: 'Renomeado',
        externalProductId: a.product.externalProductId,
      });

      // Removing the oldest linked product (gate off) moves the marker on.
      expect((await call(admin, 'DELETE', `/access-products/${b.product.id}`)).status).toBe(200);
      overview = await overviewOf(admin);
      expect(overview.accessProducts.map((p) => p.id)).toEqual([a.product.id, c.product.id]);
      expect(overview.accessProducts.map((p) => p.feedsSubscribeButton)).toEqual([false, true]);
    });
  }, 60_000);

  it('P44: the same PATCH twice answers the same body; a second DELETE is the bare 404; the same id twice is gateway_product_taken', async () => {
    const admin = await person('lab', 'admin_tenant');
    await withPaymentsOn(async () => {
      const ext = uniq('idem');
      const made = await createProduct(admin, { name: 'Idempotente', externalProductId: ext });
      expect(made.status).toBe(201);
      const id = made.product.id;

      const first = await call(admin, 'PATCH', `/access-products/${id}`, {
        name: 'Mesmo',
        checkoutUrl: 'https://pay.example.com/i',
      });
      const second = await call(admin, 'PATCH', `/access-products/${id}`, {
        name: 'Mesmo',
        checkoutUrl: 'https://pay.example.com/i',
      });
      expect([first.status, second.status]).toEqual([200, 200]);
      expect(second.json).toEqual(first.json);
      // An unchanged value is accepted, not a clash with itself.
      const same = await call(admin, 'PATCH', `/access-products/${id}`, { externalProductId: ext });
      expect(same.status).toBe(200);

      const dup = await createProduct(admin, { name: 'Outra', externalProductId: ext });
      expect(dup.status).toBe(409);
      expect(JSON.parse(dup.raw)).toMatchObject({
        error: { code: 'CONFLICT', details: { payments: 'gateway_product_taken' } },
      });

      expect((await call(admin, 'DELETE', `/access-products/${id}`)).status).toBe(200);
      const gone = await call(admin, 'DELETE', `/access-products/${id}`);
      expect(gone.status).toBe(404);
      expect(details(gone)).toMatchObject({ code: 'NOT_FOUND' });
      expect(details(gone)).not.toHaveProperty('details');
      // A patch of a removed product is the same bare 404.
      expect((await call(admin, 'PATCH', `/access-products/${id}`, { name: 'x' })).status).toBe(
        404,
      );
    });
  }, 60_000);

  it('PATCH: a clash with another product, an empty patch and a patch of undefined keys are refused and change nothing', async () => {
    const admin = await person('lab', 'admin_tenant');
    await withPaymentsOn(async () => {
      const one = await createProduct(admin, { name: 'Um', externalProductId: uniq('one') });
      const two = await createProduct(admin, { name: 'Dois', externalProductId: uniq('two') });
      const clash = await call(admin, 'PATCH', `/access-products/${two.product.id}`, {
        externalProductId: one.product.externalProductId,
      });
      expect(clash.status).toBe(409);
      expect(details(clash)?.details).toEqual({ payments: 'gateway_product_taken' });

      const empty = await call(admin, 'PATCH', `/access-products/${two.product.id}`, {});
      expect(empty.status).toBe(400);
      expect(details(empty)?.details).toEqual({ payments: 'nothing_to_update' });

      const after = (await overviewOf(admin)).accessProducts.find((p) => p.id === two.product.id);
      expect(after).toMatchObject({
        name: 'Dois',
        externalProductId: two.product.externalProductId,
      });
    });
  }, 60_000);

  it('P42/P43: every refusal carries its code, lengths count code points on the trimmed value, the id is stored trimmed and compared case-sensitively', async () => {
    const admin = await person('lab', 'admin_tenant');
    await withPaymentsOn(async () => {
      const refused = async (body: Record<string, unknown>, code: string) => {
        const res = await call(admin, 'POST', '/access-products', body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(details(res)?.details, JSON.stringify(body)).toEqual({ payments: code });
      };
      const good = { name: 'Valido', externalProductId: uniq('enc') };
      await refused({ ...good, name: '' }, 'name_required');
      await refused({ ...good, name: ' \t ' }, 'name_required');
      await refused({ ...good, name: 'a'.repeat(81) }, 'name_too_long');
      await refused({ ...good, name: '😀'.repeat(81) }, 'name_too_long');
      await refused({ ...good, externalProductId: '' }, 'product_id_required');
      await refused({ ...good, externalProductId: '   ' }, 'product_id_required');
      await refused({ ...good, externalProductId: 'x'.repeat(129) }, 'product_id_too_long');
      for (const link of [
        'javascript:alert(1)',
        'http://pay.example.com/x',
        'https://user:pw@pay.example.com/x',
        'https://pay.example.com/a b',
        'https://',
        'data:text/html;base64,AAAA',
      ]) {
        await refused({ ...good, checkoutUrl: link }, 'link_invalid');
      }
      // Nothing was written by any refusal.
      expect((await overviewOf(admin)).accessProducts).toEqual([]);

      // 80 code points pass (an emoji is one), the name is stored trimmed, an empty link is no link.
      const emoji = await createProduct(admin, {
        name: `  ${'😀'.repeat(80)}  `,
        externalProductId: `  ${uniq('Case')}  `,
        checkoutUrl: '',
      });
      expect(emoji.status).toBe(201);
      expect(emoji.product.name).toBe('😀'.repeat(80));
      expect(emoji.product.checkoutUrl).toBeNull();
      expect(emoji.product.externalProductId).toBe(emoji.product.externalProductId.trim());
      // The id is case-sensitive: the same letters in another case are a different id.
      const swapped = emoji.product.externalProductId.toLowerCase();
      expect(swapped).not.toBe(emoji.product.externalProductId);
      const other = await createProduct(admin, { name: 'Caso', externalProductId: swapped });
      expect(other.status).toBe(201);
      // A 2048-character link is accepted, 2049 is not.
      const base = 'https://pay.example.com/';
      const longest = await createProduct(admin, {
        name: 'Link longo',
        externalProductId: uniq('long'),
        checkoutUrl: base + 'a'.repeat(2048 - base.length),
      });
      expect(longest.status).toBe(201);
      await refused(
        {
          name: 'Link maior',
          externalProductId: uniq('longer'),
          checkoutUrl: base + 'a'.repeat(2049 - base.length),
        },
        'link_invalid',
      );
    });
  }, 90_000);

  it('removal: allowed with the gate off; the LAST product is refused while the gate is on, nothing deleted, and goes once the gate is off', async () => {
    const admin = await person('lab', 'admin_tenant');
    await withPaymentsOn(async () => {
      expect((await call(admin, 'PUT', '/integration', { token: uniq('tok') })).status).toBe(200);
      const one = await createProduct(admin, { name: 'Primeiro', externalProductId: uniq('r1') });
      const two = await createProduct(admin, { name: 'Segundo', externalProductId: uniq('r2') });
      expect((await call(admin, 'PUT', '/gate', { required: true })).status).toBe(200);

      // Not the last: allowed while the gate is on.
      expect((await call(admin, 'DELETE', `/access-products/${one.product.id}`)).status).toBe(200);
      // The last one: refused, and still there.
      const last = await call(admin, 'DELETE', `/access-products/${two.product.id}`);
      expect(last.status).toBe(409);
      expect(details(last)).toMatchObject({
        code: 'CONFLICT',
        details: { payments: 'last_access_product' },
      });
      expect((await overviewOf(admin)).accessProducts.map((p) => p.id)).toEqual([two.product.id]);

      // The gate can always be turned off, and then the last product goes.
      expect((await call(admin, 'PUT', '/gate', { required: false })).status).toBe(200);
      expect((await call(admin, 'DELETE', `/access-products/${two.product.id}`)).status).toBe(200);
      expect((await overviewOf(admin)).accessProducts).toEqual([]);
    });
  }, 60_000);

  it('P45: two tenants registering one gateway id at the same instant leave one row and one gateway_product_taken that names nobody', async () => {
    const labAdmin = await person('lab', 'admin_tenant');
    const demoAdmin = await person('demo', 'admin_tenant');
    const [demo] = await adminSql<{ id: string }[]>`
      select id::text as id from public.tenants where slug = 'rede-demo'`;
    const demoId = demo?.id ?? '';
    const [previous] = await adminSql<{ enabled: boolean; settings: Record<string, unknown> }[]>`
      select enabled, settings from public.tenant_modules
       where tenant_id = ${demoId}::uuid and module_key = 'payments'`;
    await setPaymentsRow(demoId, { enabled: true, settings: {} });
    moduleFlags.invalidate(demoId);
    try {
      await withPaymentsOn(async () => {
        const ext = uniq('race');
        const answers = await Promise.all([
          call(labAdmin, 'POST', '/access-products', { name: 'Lab', externalProductId: ext }),
          call(
            demoAdmin,
            'POST',
            '/access-products',
            { name: 'Demo', externalProductId: ext },
            HOSTS.demo,
          ),
        ]);
        expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
        const loser = answers.find((a) => a.status === 409);
        expect(loser?.json).toMatchObject({
          error: { code: 'CONFLICT', details: { payments: 'gateway_product_taken' } },
        });
        // The refusal names no tenant: neither slug, nor id, nor display name.
        expect(loser?.raw ?? '').not.toMatch(/rede-(demo|lab)|payment_products|provider_ext/i);
        const [rows] = await adminSql<{ n: number }[]>`
          select count(*)::int as n from public.payment_products where external_product_id = ${ext}`;
        expect(rows?.n).toBe(1);
      });
    } finally {
      await adminSql`delete from public.payment_products where tenant_id = ${demoId}::uuid`;
      if (previous) {
        await setPaymentsRow(demoId, { enabled: previous.enabled, settings: previous.settings });
      } else {
        await adminSql`
          delete from public.tenant_modules
           where tenant_id = ${demoId}::uuid and module_key = 'payments'`;
      }
      moduleFlags.invalidate(demoId);
    }
  }, 60_000);
});

describe('09.1 store mapping', () => {
  const STORE_NAME = `${PREFIX}-store`;
  let restoreStoreLab: (() => Promise<void>) | undefined;
  let restoreStoreDemo: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    restoreStoreLab = await withModuleEnabled('lab', 'store');
    restoreStoreDemo = await withModuleEnabled('demo', 'store');
  });

  afterAll(async () => {
    await adminSql`delete from public.store_products where name like ${`${STORE_NAME}%`}`;
    await restoreStoreLab?.();
    await restoreStoreDemo?.();
  });

  async function storeProduct(who: Person, host: string, label: string): Promise<string> {
    const res = await api.request('/v1/store/products', {
      method: 'POST',
      headers: {
        'x-tenant-host': host,
        authorization: `Bearer ${who.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: `${STORE_NAME}-${label}`, priceCents: 1990, communityIds: [] }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  const mappingRows = async (productId: string) =>
    adminSql<{ tenant_id: string; external_product_id: string; checkout_url: string | null }[]>`
      select tenant_id::text as tenant_id, external_product_id, checkout_url
        from public.payment_products
       where kind = 'store_product' and target_id = ${productId}::uuid`;

  it('GET: an unmapped product is mapping null and connected follows the integration; PUT, PUT again and DELETE round-trip', async () => {
    const admin = await person('lab', 'admin_tenant');
    await withPaymentsOn(async () => {
      const productId = await storeProduct(admin, HOSTS.lab, 'a');
      const empty = await call(admin, 'GET', `/store-products/${productId}`);
      expect(empty.status).toBe(200);
      expect(empty.json).toEqual({ connected: false, mapping: null });

      const ext = uniq('map');
      const idOnly = await call(admin, 'PUT', `/store-products/${productId}`, {
        externalProductId: ext,
      });
      expect(idOnly.status).toBe(200);
      expect(idOnly.json).toEqual({
        connected: false,
        mapping: { externalProductId: ext, checkoutUrl: null },
      });

      await call(admin, 'PUT', '/integration', { token: uniq('tok') });
      const linked = await call(admin, 'PUT', `/store-products/${productId}`, {
        externalProductId: ext,
        checkoutUrl: 'https://pay.example.com/map',
      });
      expect(linked.json).toEqual({
        connected: true,
        mapping: { externalProductId: ext, checkoutUrl: 'https://pay.example.com/map' },
      });
      // P44: the same PUT again leaves the same row and answers the same body.
      const again = await call(admin, 'PUT', `/store-products/${productId}`, {
        externalProductId: ext,
        checkoutUrl: 'https://pay.example.com/map',
      });
      expect(again.json).toEqual(linked.json);
      expect(await mappingRows(productId)).toHaveLength(1);

      // Replacing the id replaces the same row.
      const ext2 = uniq('map2');
      await call(admin, 'PUT', `/store-products/${productId}`, { externalProductId: ext2 });
      const rows = await mappingRows(productId);
      expect(rows).toEqual([
        { tenant_id: labTenantId, external_product_id: ext2, checkout_url: null },
      ]);

      const read = await call(admin, 'GET', `/store-products/${productId}`);
      expect(read.json).toEqual({
        connected: true,
        mapping: { externalProductId: ext2, checkoutUrl: null },
      });

      const removed = await call(admin, 'DELETE', `/store-products/${productId}`);
      expect(removed.status).toBe(200);
      expect(removed.json).toEqual({ connected: true, mapping: null });
      expect(await mappingRows(productId)).toHaveLength(0);
      // Deleting what is not mapped is idempotent.
      expect((await call(admin, 'DELETE', `/store-products/${productId}`)).json).toEqual({
        connected: true,
        mapping: null,
      });
      expect((await call(admin, 'GET', `/store-products/${productId}`)).json).toEqual({
        connected: true,
        mapping: null,
      });
    });
  }, 90_000);

  it('refuses a link without a gateway id, an empty body and a bad link; a clash with an access product or another mapping is gateway_product_taken', async () => {
    const admin = await person('lab', 'admin_tenant');
    await withPaymentsOn(async () => {
      const productId = await storeProduct(admin, HOSTS.lab, 'b');
      const otherId = await storeProduct(admin, HOSTS.lab, 'c');
      const refused = async (body: Record<string, unknown>, code: string) => {
        const res = await call(admin, 'PUT', `/store-products/${productId}`, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(details(res)?.details, JSON.stringify(body)).toEqual({ payments: code });
      };
      await refused({ checkoutUrl: 'https://pay.example.com/x' }, 'gateway_product_id_required');
      await refused({}, 'gateway_product_id_required');
      await refused({ externalProductId: '  ' }, 'gateway_product_id_required');
      await refused(
        { externalProductId: 'p', checkoutUrl: 'http://pay.example.com/x' },
        'link_invalid',
      );
      await refused({ externalProductId: 'x'.repeat(129) }, 'product_id_too_long');
      expect(await mappingRows(productId)).toHaveLength(0);

      // The gateway id of an access product cannot also sell a store product.
      const access = await createProduct(admin, { name: 'Acesso', externalProductId: uniq('acc') });
      const vsAccess = await call(admin, 'PUT', `/store-products/${productId}`, {
        externalProductId: access.product.externalProductId,
      });
      expect(vsAccess.status).toBe(409);
      expect(details(vsAccess)?.details).toEqual({ payments: 'gateway_product_taken' });
      // Neither can two store products share one.
      const ext = uniq('shared');
      expect(
        (await call(admin, 'PUT', `/store-products/${productId}`, { externalProductId: ext }))
          .status,
      ).toBe(200);
      const vsMapping = await call(admin, 'PUT', `/store-products/${otherId}`, {
        externalProductId: ext,
      });
      expect(vsMapping.status).toBe(409);
      expect(details(vsMapping)?.details).toEqual({ payments: 'gateway_product_taken' });
      expect(await mappingRows(otherId)).toHaveLength(0);
      expect(await mappingRows(productId)).toHaveLength(1);
    });
  }, 90_000);

  it('a foreign tenant’s product, an unknown uuid and a non-uuid are the bare 404 on GET, PUT and DELETE, and write nothing', async () => {
    const admin = await person('lab', 'admin_tenant');
    const demoAdmin = await person('demo', 'admin_tenant');
    await withPaymentsOn(async () => {
      const foreign = await storeProduct(demoAdmin, HOSTS.demo, 'foreign');
      const own = await storeProduct(admin, HOSTS.lab, 'own');
      for (const id of [foreign, crypto.randomUUID(), 'not-a-uuid', '12345']) {
        for (const method of ['GET', 'PUT', 'DELETE']) {
          const res = await call(
            admin,
            method,
            `/store-products/${id}`,
            method === 'PUT' ? { externalProductId: uniq('nope') } : undefined,
          );
          expect(res.status, `${method} ${id}`).toBe(404);
          expect(details(res), `${method} ${id}`).toMatchObject({ code: 'NOT_FOUND' });
          expect(details(res), `${method} ${id}`).not.toHaveProperty('details');
        }
      }
      expect(await mappingRows(foreign)).toHaveLength(0);
      // The positive control beside the negatives: the lab admin's own product maps.
      const ok = await call(admin, 'PUT', `/store-products/${own}`, {
        externalProductId: uniq('own'),
      });
      expect(ok.status).toBe(200);
    });
  }, 90_000);

  it('the mapping survives an archive of the store product', async () => {
    const admin = await person('lab', 'admin_tenant');
    await withPaymentsOn(async () => {
      const productId = await storeProduct(admin, HOSTS.lab, 'archive');
      const ext = uniq('arch');
      await call(admin, 'PUT', `/store-products/${productId}`, { externalProductId: ext });
      const archived = await api.request(`/v1/store/products/${productId}/status`, {
        method: 'PUT',
        headers: {
          'x-tenant-host': HOSTS.lab,
          authorization: `Bearer ${admin.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'archived' }),
      });
      expect(archived.status).toBe(200);
      const read = await call(admin, 'GET', `/store-products/${productId}`);
      expect(read.json).toMatchObject({ mapping: { externalProductId: ext } });
    });
  }, 60_000);

  it('P45: two concurrent PUTs of one product’s mapping leave exactly one row', async () => {
    const admin = await person('lab', 'admin_tenant');
    await withPaymentsOn(async () => {
      const productId = await storeProduct(admin, HOSTS.lab, 'race');
      const a = uniq('raceA');
      const b = uniq('raceB');
      const answers = await Promise.all([
        call(admin, 'PUT', `/store-products/${productId}`, { externalProductId: a }),
        call(admin, 'PUT', `/store-products/${productId}`, { externalProductId: b }),
      ]);
      expect(answers.map((r) => r.status)).toEqual([200, 200]);
      const rows = await mappingRows(productId);
      expect(rows).toHaveLength(1);
      expect([a, b]).toContain(rows[0]?.external_product_id);
    });
  }, 60_000);
});

// ── Task 3: authorisation, secrecy, the module toggle and concurrency ─────────────────────────

describe('09.1 authorisation', () => {
  const someId = crypto.randomUUID();
  /** Every route of the module, with a body that would be valid for an admin. */
  const ROUTES: [string, string, unknown?][] = [
    ['GET', '/overview'],
    ['PUT', '/integration', { token: 'tok-authz' }],
    ['POST', '/access-products', { name: 'Autz', externalProductId: 'authz-ext' }],
    ['PATCH', `/access-products/${someId}`, { name: 'Autz' }],
    ['DELETE', `/access-products/${someId}`],
    ['GET', `/store-products/${someId}`],
    ['PUT', `/store-products/${someId}`, { externalProductId: 'authz-ext' }],
    ['DELETE', `/store-products/${someId}`],
    ['GET', '/gate/preview'],
    ['PUT', '/gate', { required: false }],
  ];

  it('a member and a support_tenant are 403 FORBIDDEN on every route and nothing is written', async () => {
    const member = await person('lab');
    const support = await person('lab', 'support_tenant');
    await withPaymentsOn(async () => {
      for (const who of [member, support]) {
        for (const [method, path, body] of ROUTES) {
          const res = await call(who, method, path, body);
          expect(res.status, `${method} ${path}`).toBe(403);
          expect(details(res), `${method} ${path}`).toMatchObject({ code: 'FORBIDDEN' });
        }
      }
      const [writes] = await adminSql<{ n: number }[]>`
        select (select count(*) from public.payment_integrations where tenant_id = ${labTenantId}::uuid)::int
             + (select count(*) from public.payment_products where tenant_id = ${labTenantId}::uuid)::int as n`;
      expect(writes?.n).toBe(0);
    });
  }, 60_000);

  it('no token is 401 UNAUTHENTICATED on every route', async () => {
    await withPaymentsOn(async () => {
      for (const [method, path, body] of ROUTES) {
        const res = await api.request(`/v1/payments${path}`, {
          method,
          headers: {
            'x-tenant-host': HOSTS.lab,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        expect(res.status, `${method} ${path}`).toBe(401);
        expect(await codeOf(res), `${method} ${path}`).toBe('UNAUTHENTICATED');
      }
    });
  }, 60_000);

  it('a tenant with the module off, or no row at all, answers 404 MODULE_DISABLED to its admin on every route', async () => {
    const admin = await person('lab', 'admin_tenant');
    const member = await person('lab');
    const run = async () => {
      for (const who of [admin, member]) {
        for (const [method, path, body] of ROUTES) {
          const res = await call(who, method, path, body);
          expect(res.status, `${method} ${path}`).toBe(404);
          expect(details(res), `${method} ${path}`).toMatchObject({ code: 'MODULE_DISABLED' });
        }
      }
    };
    // A disabled row.
    await adminSql`
      delete from public.tenant_modules where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
    await setPaymentsRow(labTenantId, { enabled: false, settings: {} });
    moduleFlags.invalidate(labTenantId);
    await run();
    // No row at all.
    await adminSql`
      delete from public.tenant_modules where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
    moduleFlags.invalidate(labTenantId);
    await run();
  }, 60_000);

  it('an admin_tenant of ANOTHER tenant reads and writes only its own: the same body cannot touch tenant A’s rows, and a body naming a tenant is refused', async () => {
    const labAdmin = await person('lab', 'admin_tenant');
    const demoAdmin = await person('demo', 'admin_tenant');
    const [demo] = await adminSql<{ id: string }[]>`
      select id::text as id from public.tenants where slug = 'rede-demo'`;
    const demoId = demo?.id ?? '';
    const [previous] = await adminSql<{ enabled: boolean; settings: Record<string, unknown> }[]>`
      select enabled, settings from public.tenant_modules
       where tenant_id = ${demoId}::uuid and module_key = 'payments'`;
    await setPaymentsRow(demoId, { enabled: true, settings: {} });
    moduleFlags.invalidate(demoId);
    try {
      await withPaymentsOn(async () => {
        await call(labAdmin, 'PUT', '/integration', { token: uniq('lab-tok'), provider: 'fake' });
        const labProduct = await createProduct(labAdmin, {
          name: 'Do lab',
          externalProductId: uniq('lab-prod'),
        });
        const [labSealed] = await adminSql<{ secret_sealed: string }[]>`
          select secret_sealed from public.payment_integrations where tenant_id = ${labTenantId}::uuid`;

        // The demo admin sees nothing of the lab on its own host…
        const demoView = await call(demoAdmin, 'GET', '/overview', undefined, HOSTS.demo);
        expect(demoView.status).toBe(200);
        expect(demoView.raw).not.toContain(labProduct.product.id);
        expect((demoView.json as unknown as Overview).integration.connected).toBe(false);
        // …cannot patch or delete the lab's product…
        for (const method of ['PATCH', 'DELETE']) {
          const res = await call(
            demoAdmin,
            method,
            `/access-products/${labProduct.product.id}`,
            method === 'PATCH' ? { name: 'Invadido' } : undefined,
            HOSTS.demo,
          );
          expect(res.status, method).toBe(404);
        }
        // …a save by the demo admin lands in the DEMO only…
        const saved = await call(
          demoAdmin,
          'PUT',
          '/integration',
          { token: uniq('demo-tok'), provider: 'fake' },
          HOSTS.demo,
        );
        expect(saved.status).toBe(200);
        const [labAfter] = await adminSql<{ secret_sealed: string }[]>`
          select secret_sealed from public.payment_integrations where tenant_id = ${labTenantId}::uuid`;
        expect(labAfter?.secret_sealed).toBe(labSealed?.secret_sealed);
        // …a body that names a tenant is refused (unknown key) and writes nothing…
        const smuggled = await call(
          demoAdmin,
          'POST',
          '/access-products',
          { name: 'Contrabando', externalProductId: uniq('smug'), tenantId: labTenantId },
          HOSTS.demo,
        );
        expect(smuggled.status).toBe(400);
        // …and cannot turn the lab's gate on or release the lab's members.
        const gate = await call(
          demoAdmin,
          'PUT',
          '/gate',
          { required: true, releaseExisting: true },
          HOSTS.demo,
        );
        expect(gate.status).toBe(409);
        const labGate = (await overviewOf(labAdmin)).gate;
        expect(labGate.required).toBe(false);
        const [released] = await adminSql<{ n: number }[]>`
          select count(*)::int as n from public.access_grants
           where tenant_id = ${labTenantId}::uuid and created_by_user_id = ${demoAdmin.userId}::uuid`;
        expect(released?.n).toBe(0);
      });
    } finally {
      await removePaymentIntegrations(demoId);
      await adminSql`delete from public.payment_products where tenant_id = ${demoId}::uuid`;
      if (previous) {
        await setPaymentsRow(demoId, { enabled: previous.enabled, settings: previous.settings });
      } else {
        await adminSql`
          delete from public.tenant_modules where tenant_id = ${demoId}::uuid and module_key = 'payments'`;
      }
      moduleFlags.invalidate(demoId);
    }
  }, 90_000);
});

describe('09.1 secrecy', () => {
  /** Everything the API process writes through the root logger's destination while `run` executes. */
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

  it('the token is in no response, no log line and no column; a second save changes the stored string; the old signature stops verifying and the new one verifies on the real webhook route', async () => {
    const admin = await person('lab', 'admin_tenant');
    const first = `secret-one-${crypto.randomUUID()}`;
    const second = `secret-two-${crypto.randomUUID()}`;
    const from = seenBodies.length;
    const lines = await captureLogs(async () => {
      await withPaymentsOn(async () => {
        expect(
          (await call(admin, 'PUT', '/integration', { token: first, provider: 'fake' })).json,
        ).toEqual({
          connected: true,
        });
        // Every GET and every write answer after the save.
        await call(admin, 'GET', '/overview');
        await call(admin, 'GET', '/gate/preview');
        await createProduct(admin, { name: 'Segredo', externalProductId: uniq('sec') });
        await call(admin, 'PUT', '/gate', { required: true });
        await call(admin, 'PUT', '/gate', { required: false });
        // Refusals carry no token either.
        await call(admin, 'PUT', '/integration', { token: '' });
        await call(admin, 'PUT', '/integration', { token: 'x'.repeat(513) });

        const [one] = await adminSql<{ id: string; secret_sealed: string; secret_set_at: Date }[]>`
          select id::text as id, secret_sealed, secret_set_at from public.payment_integrations
           where tenant_id = ${labTenantId}::uuid`;
        expect(one?.secret_sealed).not.toBe(first);
        expect(one?.secret_sealed).not.toContain(first);
        expect(one?.secret_sealed).not.toContain(Buffer.from(first).toString('base64'));
        expect(one?.id).toBe(deterministicIntegrationId(labTenantId, 'fake'));
        const integration = {
          id: one?.id ?? '',
          tenantId: labTenantId,
          provider: 'fake',
          token: first,
        };
        const body = { type: 'purchase_approved', externalRef: `ord-${crypto.randomUUID()}` };
        expect((await signedWebhook(integration, body)).status).toBe(200);

        // A second save replaces the sealed string (a fresh IV) and advances `secret_set_at`.
        expect(
          (await call(admin, 'PUT', '/integration', { token: second, provider: 'fake' })).status,
        ).toBe(200);
        const [two] = await adminSql<{ id: string; secret_sealed: string; secret_set_at: Date }[]>`
          select id::text as id, secret_sealed, secret_set_at from public.payment_integrations
           where tenant_id = ${labTenantId}::uuid`;
        expect(two?.id).toBe(one?.id);
        expect(two?.secret_sealed).not.toBe(one?.secret_sealed);
        expect(two?.secret_sealed).not.toContain(second);
        expect(two?.secret_set_at.getTime() ?? 0).toBeGreaterThanOrEqual(
          one?.secret_set_at.getTime() ?? Number.POSITIVE_INFINITY,
        );
        // The same token saved again is sealed again with another IV.
        await call(admin, 'PUT', '/integration', { token: second, provider: 'fake' });
        const [three] = await adminSql<{ secret_sealed: string }[]>`
          select secret_sealed from public.payment_integrations where tenant_id = ${labTenantId}::uuid`;
        expect(three?.secret_sealed).not.toBe(two?.secret_sealed);
        expect(openSecret(three?.secret_sealed ?? '', two?.id ?? '')).toBe(second);

        // The old token no longer verifies; the new one does, against the real route.
        const body2 = { type: 'purchase_approved', externalRef: `ord-${crypto.randomUUID()}` };
        expect((await signedWebhook(integration, body2)).status).toBe(403);
        expect((await signedWebhook({ ...integration, token: second }, body2)).status).toBe(200);
      });
    });

    for (const secret of [
      first,
      second,
      Buffer.from(first).toString('base64'),
      Buffer.from(second).toString('base64'),
    ]) {
      for (const body of seenBodies.slice(from)) expect(body).not.toContain(secret);
      for (const line of lines) expect(line).not.toContain(secret);
    }
    // Non-vacuous: the capture saw this module's own log lines.
    expect(lines.join('')).toContain('payments.integration.saved');
  }, 90_000);

  it('an empty and a 513-character token are refused, and no route removes the integration', async () => {
    const admin = await person('lab', 'admin_tenant');
    await withPaymentsOn(async () => {
      const empty = await call(admin, 'PUT', '/integration', { token: '   ' });
      expect(empty.status).toBe(400);
      expect(details(empty)?.details).toEqual({ payments: 'token_required' });
      expect((await call(admin, 'PUT', '/integration', { token: 'x'.repeat(513) })).status).toBe(
        400,
      );
      // WR-04: a token under 8 characters, or with whitespace inside, is refused with its own code.
      for (const token of ['1234', 'senha', 'abcd efgh']) {
        const weak = await call(admin, 'PUT', '/integration', { token });
        expect(weak.status, token).toBe(400);
        expect(details(weak)?.details, token).toEqual({ payments: 'token_invalid' });
      }
      // ...while a short vendor-issued token of ten characters is accepted.
      expect(
        (await call(admin, 'PUT', '/integration', { token: 'k7x9q2m4zp', provider: 'fake' }))
          .status,
      ).toBe(200);
      expect(
        (await call(admin, 'PUT', '/integration', { token: 'x'.repeat(512), provider: 'fake' }))
          .status,
      ).toBe(200);
      // No DELETE (or any other verb) removes it.
      for (const method of ['DELETE', 'PATCH', 'POST']) {
        const res = await call(admin, method, '/integration', method === 'DELETE' ? undefined : {});
        expect(res.status, method).toBe(404);
      }
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.payment_integrations where tenant_id = ${labTenantId}::uuid`;
      expect(row?.n).toBe(1);
      // A provider that is not enabled in this process is refused with its own code.
      const unknown = await call(admin, 'PUT', '/integration', {
        token: 'abcd1234',
        provider: 'nope',
      });
      expect(unknown.status).toBe(400);
      expect(details(unknown)?.details).toEqual({ payments: 'provider_unavailable' });
    });
  }, 60_000);
});

describe('09.1 module toggle', () => {
  const actor = { userId: '' };

  async function prepare(admin: Person) {
    expect(
      (await call(admin, 'PUT', '/integration', { token: uniq('tok'), provider: 'fake' })).status,
    ).toBe(200);
    const product = await createProduct(admin, {
      name: 'Persistente',
      externalProductId: uniq('persist'),
      checkoutUrl: 'https://pay.example.com/persist',
    });
    expect((await call(admin, 'PUT', '/gate', { required: true })).status).toBe(200);
    return product.product;
  }

  it('P40: enabling twice leaves one row; disabling and re-enabling restores the integration, the products and the gate switch exactly', async () => {
    const admin = await person('lab', 'admin_tenant');
    const member = await person('lab');
    await withPaymentsOn(async () => {
      const product = await prepare(admin);
      const before = await overviewOf(admin);
      expect(before.gate.required).toBe(true);

      await setModuleEnabled(labTenantId, 'payments', true, actor);
      await setModuleEnabled(labTenantId, 'payments', true, actor);
      const [rows] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.tenant_modules
         where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
      expect(rows?.n).toBe(1);

      // On: the gate is on and a member without access is cut.
      expect(await codeOf(await bootstrap(member))).toBe('SUBSCRIPTION_PENDING');

      // Off: the routes 404, the gate reads OFF at once (the SQL follows the row), the switch is stored.
      await setModuleEnabled(labTenantId, 'payments', false, actor);
      expect((await call(admin, 'GET', '/overview')).status).toBe(404);
      expect((await bootstrap(member)).status).toBe(200);
      const [stored] = await adminSql<{ enabled: boolean; settings: Record<string, unknown> }[]>`
        select enabled, settings from public.tenant_modules
         where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
      expect(stored).toEqual({ enabled: false, settings: { gate: true } });

      // Back on: everything is exactly as it was.
      await setModuleEnabled(labTenantId, 'payments', true, actor);
      const after = await overviewOf(admin);
      expect(after.integration).toEqual(before.integration);
      expect(after.accessProducts).toEqual(before.accessProducts);
      expect(after.accessProducts[0]?.id).toBe(product.id);
      expect(after.gate).toEqual(before.gate);
      expect(await codeOf(await bootstrap(member))).toBe('SUBSCRIPTION_PENDING');
      // The platform toggle never overwrites settings.gate.
      const [kept] = await adminSql<{ settings: Record<string, unknown> }[]>`
        select settings from public.tenant_modules
         where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
      expect(kept?.settings).toEqual({ gate: true });
    });
  }, 90_000);

  it('P41: requireModule may serve a stale flag until the cache is invalidated, while the SQL gate follows the row on the next statement', async () => {
    const admin = await person('lab', 'admin_tenant');
    const member = await person('lab');
    await withPaymentsOn(async () => {
      await prepare(admin);
      // Prime the cache with the module ON.
      expect((await call(admin, 'GET', '/overview')).status).toBe(200);
      expect(await codeOf(await bootstrap(member))).toBe('SUBSCRIPTION_PENDING');

      // Disable behind the cache's back (no invalidation): the route is still served (stale flag)…
      await adminSql`
        update public.tenant_modules set enabled = false
         where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
      expect((await call(admin, 'GET', '/overview')).status).toBe(200);
      // …while the SQL gate already follows the row: the member passes.
      expect((await bootstrap(member)).status).toBe(200);
      // After the invalidation both sides agree.
      moduleFlags.invalidate(labTenantId);
      expect((await call(admin, 'GET', '/overview')).status).toBe(404);

      // The other direction: the cache holds OFF, the row turns ON; the gate cuts at once.
      await adminSql`
        update public.tenant_modules set enabled = true
         where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
      expect((await call(admin, 'GET', '/overview')).status).toBe(404);
      expect(await codeOf(await bootstrap(member))).toBe('SUBSCRIPTION_PENDING');
      moduleFlags.invalidate(labTenantId);
      expect((await call(admin, 'GET', '/overview')).status).toBe(200);
    });
  }, 90_000);

  it('setGate on a module that is disabled in the row is 404 MODULE_DISABLED even when the cache still says on', async () => {
    const admin = await person('lab', 'admin_tenant');
    await withPaymentsOn(async () => {
      expect((await call(admin, 'GET', '/overview')).status).toBe(200);
      await adminSql`
        update public.tenant_modules set enabled = false
         where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
      const res = await call(admin, 'PUT', '/gate', { required: false });
      expect(res.status).toBe(404);
      expect(details(res)).toMatchObject({ code: 'MODULE_DISABLED' });
    });
  }, 60_000);
});

describe('09.1 concurrency', () => {
  async function ready(admin: Person) {
    await call(admin, 'PUT', '/integration', { token: uniq('tok'), provider: 'fake' });
    return createProduct(admin, { name: 'Concorrente', externalProductId: uniq('conc') });
  }

  it('P45: two concurrent gate writes with the release leave no lost and no duplicated row', async () => {
    const admin = await person('lab', 'admin_tenant');
    await person('lab');
    await person('lab');
    await withPaymentsOn(async () => {
      await ready(admin);
      const expected = await membersWithoutAnyRow();
      expect(expected).toBeGreaterThanOrEqual(2);
      const answers = await Promise.all([
        call(admin, 'PUT', '/gate', { required: true, releaseExisting: true }),
        call(admin, 'PUT', '/gate', { required: true, releaseExisting: true }),
      ]);
      expect(answers.map((a) => a.status)).toEqual([200, 200]);
      const released = answers.map((a) => (a.json as { released: number }).released);
      // The setup lock serialises them: one releases everyone, the other nobody.
      expect(released.sort((a, b) => a - b)).toEqual([0, expected]);
      const [rows] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.access_grants
         where tenant_id = ${labTenantId}::uuid and created_by_user_id = ${admin.userId}::uuid`;
      expect(rows?.n).toBe(expected);
      expect((await overviewOf(admin)).gate.required).toBe(true);
    });
  }, 90_000);

  it('P45: a gate ON racing a gate OFF leaves the last committed value and the rows its response reported', async () => {
    const admin = await person('lab', 'admin_tenant');
    await person('lab');
    await withPaymentsOn(async () => {
      await ready(admin);
      const [on, off] = await Promise.all([
        call(admin, 'PUT', '/gate', { required: true, releaseExisting: true }),
        call(admin, 'PUT', '/gate', { required: false }),
      ]);
      expect([on.status, off.status]).toEqual([200, 200]);
      const [rows] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.access_grants
         where tenant_id = ${labTenantId}::uuid and created_by_user_id = ${admin.userId}::uuid`;
      expect(rows?.n).toBe((on.json as { released: number }).released);
      // The stored value is one of the two, and the overview reads exactly it.
      const stored = await overviewOf(admin);
      const [row] = await adminSql<{ gate: boolean }[]>`
        select (settings -> 'gate') = 'true'::jsonb as gate from public.tenant_modules
         where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
      expect(stored.gate.required).toBe(row?.gate);
    });
  }, 90_000);

  it('the gate is never left on with no access product: a removal of the last product racing the switch', async () => {
    const admin = await person('lab', 'admin_tenant');
    await withPaymentsOn(async () => {
      for (let round = 0; round < 12; round += 1) {
        await removePaymentMappings(labTenantId);
        await adminSql`
          update public.tenant_modules set settings = '{"gate": false}'::jsonb
           where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
        const made = await ready(admin);
        await Promise.all([
          call(admin, 'PUT', '/gate', { required: true }),
          call(admin, 'DELETE', `/access-products/${made.product.id}`),
        ]);
        const [state] = await adminSql<{ gate: boolean; products: number }[]>`
          select (select (settings -> 'gate') = 'true'::jsonb from public.tenant_modules
                   where tenant_id = ${labTenantId}::uuid and module_key = 'payments') as gate,
                 (select count(*)::int from public.payment_products
                   where tenant_id = ${labTenantId}::uuid and kind = 'access') as products`;
        expect(state?.gate === true && state.products === 0, `round ${round}`).toBe(false);
      }
    });
  }, 120_000);

  it('P45: two concurrent first saves of the integration leave one row with the derived id and a token that opens', async () => {
    const admin = await person('lab', 'admin_tenant');
    await withPaymentsOn(async () => {
      const a = uniq('first-a');
      const b = uniq('first-b');
      const answers = await Promise.all([
        call(admin, 'PUT', '/integration', { token: a, provider: 'fake' }),
        call(admin, 'PUT', '/integration', { token: b, provider: 'fake' }),
      ]);
      expect(answers.map((r) => r.status)).toEqual([200, 200]);
      const rows = await adminSql<{ id: string; secret_sealed: string }[]>`
        select id::text as id, secret_sealed from public.payment_integrations
         where tenant_id = ${labTenantId}::uuid`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(deterministicIntegrationId(labTenantId, 'fake'));
      expect([a, b]).toContain(openSecret(rows[0]?.secret_sealed ?? '', rows[0]?.id ?? ''));
    });
  }, 60_000);

  it('P72: the release is one set-based statement over many members and agrees with the preview', async () => {
    const admin = await person('lab', 'admin_tenant');
    const staff = await person('lab', 'support_tenant');
    // Thirty extra members in one statement: the preview and the release both see them all.
    const added = await adminSql<{ id: string }[]>`
      with new_users as (
        select gen_random_uuid() as id, ${`${PREFIX}-bulk-`} || g || '@rede-demo.local' as email
          from generate_series(1, 30) g
      ), au as (
        insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                                created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
        select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '',
               now(), now(), now(), '{}'::jsonb, '{}'::jsonb
          from new_users
        returning id
      )
      insert into public.memberships (tenant_id, user_id, role, status)
      select ${labTenantId}::uuid, id, 'member', 'active' from au
      returning id::text as id`;
    expect(added).toHaveLength(30);
    await withPaymentsOn(async () => {
      await ready(admin);
      const expected = await membersWithoutAnyRow();
      expect(expected).toBeGreaterThanOrEqual(30);
      const preview = await call(admin, 'GET', '/gate/preview');
      expect(preview.json).toEqual({ count: expected });
      const on = await call(admin, 'PUT', '/gate', { required: true, releaseExisting: true });
      expect(on.json).toEqual({ required: true, released: expected });
      // Nothing is left to release, staff never were, and a repeat releases 0.
      expect((await call(admin, 'GET', '/gate/preview')).json).toEqual({ count: 0 });
      expect(
        (await call(admin, 'PUT', '/gate', { required: true, releaseExisting: true })).json,
      ).toEqual({
        required: true,
        released: 0,
      });
      const [staffRows] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.access_grants
         where tenant_id = ${labTenantId}::uuid and email = ${staff.email}`;
      expect(staffRows?.n).toBe(0);
    });
  }, 120_000);
});
