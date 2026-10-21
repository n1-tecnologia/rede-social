import { PLATFORM_TERMS_VERSION, TENANT_HOST_HEADER } from '@rede-social/contracts';
import { joinStateSchema } from '@rede-social/contracts/join';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshEmail, type Person, personWithEmail } from './payments-apply-fixtures';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removePaymentMappings,
  seedPaymentMapping,
  signInAs,
  withPaymentsGate,
} from './setup';

/**
 * 09.1-10 (D-302, D-493, D-497, UI-D-521, UI-D-522, UI-D-532; PAY-10, PAY-15) against the live local stack:
 * the three reads a person OUTSIDE the admin panel needs.
 *
 *  - `GET /v1/me/subscription`: the cut screen's data, reachable while the member is cut;
 *  - the public tenant record's `accessCheckoutUrl`: the sign-up and login notice;
 *  - `GET /v1/join/state`'s new state `access_required`: the join screen's notice.
 *
 * All three read ONE stored `https:` link through ONE reader (`accessCheckoutUrl`), only while the
 * `payments` module is on and the gate is on, and none of them names another community. Every identity is
 * a throwaway with the prefix below.
 */

const PREFIX = 'paymem';
let labTenantId = '';
let demoTenantId = '';
let labName = '';
let labRulesVersion = 1;
let staff: Person;

type Json = Record<string, unknown>;
const LINK_ONE = 'https://pay.example.com/first';
const LINK_TWO = 'https://pay.example.com/second';
const DEMO_LINK = 'https://pay.example.com/demo-only';

async function get(path: string, token: string | null, host: string | null = HOSTS.lab) {
  const res = await api.request(path, {
    headers: {
      ...(host ? { [TENANT_HOST_HEADER]: host } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const raw = await res.text();
  let json: Json = {};
  try {
    json = raw ? (JSON.parse(raw) as Json) : {};
  } catch {
    // not JSON
  }
  return { status: res.status, json, raw, headers: res.headers };
}

const subscription = (who: Person, host = HOSTS.lab) => get('/v1/me/subscription', who.token, host);
const joinState = (token: string, host = HOSTS.lab) => get('/v1/join/state', token, host);

const codeOf = (json: Json) => (json.error as { code?: string } | undefined)?.code;

/** Access products of the lab tenant: oldest first, with the links given (null = none). */
async function products(links: (string | null)[]): Promise<string[]> {
  await removePaymentMappings(labTenantId);
  const ids: string[] = [];
  for (const [index, link] of links.entries()) {
    const mapping = await seedPaymentMapping(labTenantId, {
      kind: 'access',
      name: `Plano ${index + 1}`,
      externalProductId: `mem-${crypto.randomUUID()}`,
      checkoutUrl: link,
    });
    // Distinct, ordered creation instants (two inserts in one test can share a millisecond).
    await adminSql`
      update public.payment_products
         set created_at = now() - make_interval(hours => ${links.length - index})
       where id = ${mapping.id}::uuid`;
    ids.push(mapping.id);
  }
  return ids;
}

async function gated<T>(
  fn: () => Promise<T>,
  options: Parameters<typeof withPaymentsGate>[2] = {},
): Promise<T> {
  moduleFlags.invalidate(labTenantId);
  try {
    return await withPaymentsGate(labTenantId, fn, options);
  } finally {
    moduleFlags.invalidate(labTenantId);
  }
}

async function sweep(): Promise<void> {
  await adminSql`delete from public.access_grants where email like ${`${PREFIX}-%`}`;
  await removePaymentMappings(labTenantId);
  await removePaymentMappings(demoTenantId);
  await removeIdentitiesByPrefix(PREFIX);
}

/** A person with NO membership in the lab, signed in. */
async function outsider(
  memberships: Parameters<typeof createSharedIdentity>[0]['memberships'] = [],
) {
  const created = await createSharedIdentity({ prefix: PREFIX, memberships });
  return { ...created, token: await signInAs(created.email, created.password) };
}

const grantRow = (email: string, source: 'manual' | 'gateway', status: string) =>
  source === 'manual'
    ? adminSql`
        insert into public.access_grants (tenant_id, email, source, status)
        values (${labTenantId}::uuid, ${email}, 'manual', ${status})
        on conflict (tenant_id, email, status) where source = 'manual' do nothing`
    : adminSql`
        insert into public.access_grants (tenant_id, email, source, status, provider, external_ref)
        values (${labTenantId}::uuid, ${email}, 'gateway', ${status}, 'fake', ${`ref-${crypto.randomUUID()}`})`;

beforeAll(async () => {
  const rows = await adminSql<
    { id: string; slug: string; display_name: string; rules_version: number }[]
  >`select id::text as id, slug, display_name, rules_version from public.tenants
     where slug in ('rede-lab', 'rede-demo')`;
  const lab = rows.find((row) => row.slug === 'rede-lab');
  const demo = rows.find((row) => row.slug === 'rede-demo');
  if (!lab || !demo) throw new Error('seed tenants missing: run pnpm db:seed');
  labTenantId = lab.id;
  demoTenantId = demo.id;
  labName = lab.display_name;
  labRulesVersion = lab.rules_version;
  await sweep();
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role: 'admin_tenant' }],
  });
  staff = {
    userId: identity.userId,
    membershipId: '',
    email: identity.email,
    token: await signInAs(identity.email, identity.password),
  };
}, 60_000);

afterAll(async () => {
  moduleFlags.invalidate(labTenantId);
  await sweep();
}, 60_000);

describe('09.1 member reads', () => {
  it('GET /v1/me/subscription is reachable while CUT (every other route is 403 SUBSCRIPTION_PENDING), for a member with access and for staff, uncached', async () => {
    await products([LINK_ONE, LINK_TWO]);
    await gated(async () => {
      const cutEmail = freshEmail(PREFIX, 'cut');
      await grantRow(cutEmail, 'gateway', 'inactive');
      const cut = await personWithEmail(cutEmail, 'lab');
      const boot = await get('/v1/me/bootstrap', cut.token);
      expect(boot.status).toBe(403);
      expect(codeOf(boot.json)).toBe('SUBSCRIPTION_PENDING');

      const own = await subscription(cut);
      expect(own.status).toBe(200);
      expect(own.json).toEqual({ tenantName: labName, checkoutUrl: LINK_ONE });
      expect(own.headers.get('cache-control')).toBe('no-store');

      const okEmail = freshEmail(PREFIX, 'ok');
      await grantRow(okEmail, 'manual', 'active');
      const withAccess = await personWithEmail(okEmail, 'lab');
      expect((await get('/v1/me/bootstrap', withAccess.token)).status).toBe(200);
      expect((await subscription(withAccess)).json).toEqual({
        tenantName: labName,
        checkoutUrl: LINK_ONE,
      });
      expect((await subscription(staff)).json).toEqual({
        tenantName: labName,
        checkoutUrl: LINK_ONE,
      });

      // No token is 401; a session of another tenant on this host is the host mismatch.
      expect((await get('/v1/me/subscription', null)).status).toBe(401);
      const stranger = await outsider([{ host: 'demo' }]);
      const mismatch = await get('/v1/me/subscription', stranger.token, HOSTS.lab);
      expect(mismatch.status).toBe(403);
      expect(codeOf(mismatch.json)).toBe('TENANT_HOST_MISMATCH');
    });
  }, 60_000);

  it('the link is the stored https: link of the OLDEST access product that has one; none, a gate off or a disabled module read null', async () => {
    await gated(async () => {
      const cutEmail = freshEmail(PREFIX, 'link');
      await grantRow(cutEmail, 'gateway', 'inactive');
      const cut = await personWithEmail(cutEmail, 'lab');

      const [first, second] = await products([null, LINK_ONE, LINK_TWO]).then((ids) => [
        ids[1] ?? '',
        ids[2] ?? '',
      ]);
      expect((await subscription(cut)).json.checkoutUrl).toBe(LINK_ONE);
      await adminSql`update public.payment_products set checkout_url = null where id = ${first}::uuid`;
      expect((await subscription(cut)).json.checkoutUrl).toBe(LINK_TWO);
      await adminSql`update public.payment_products set checkout_url = null where id = ${second}::uuid`;
      expect((await subscription(cut)).json).toEqual({ tenantName: labName, checkoutUrl: null });

      // The table CHECK is the second line: a non-https link cannot be stored at all.
      await expect(
        adminSql`update public.payment_products set checkout_url = 'http://pay.example.com/x' where id = ${first}::uuid`,
      ).rejects.toThrow();
      await expect(
        adminSql`update public.payment_products set checkout_url = 'javascript:alert(1)' where id = ${first}::uuid`,
      ).rejects.toThrow();
    });

    // Gate off, or module disabled with the gate stored on: the link is null (an ungated tenant has no cut).
    await products([LINK_ONE]);
    const member = await personWithEmail(freshEmail(PREFIX, 'off'), 'lab');
    await gated(
      async () => {
        expect((await subscription(member)).json).toEqual({
          tenantName: labName,
          checkoutUrl: null,
        });
      },
      { gate: false },
    );
    await gated(
      async () => {
        expect((await subscription(member)).json).toEqual({
          tenantName: labName,
          checkoutUrl: null,
        });
      },
      { enabled: false },
    );
    // No payments row at all.
    expect((await subscription(member)).json).toEqual({ tenantName: labName, checkoutUrl: null });
  }, 60_000);

  it('never carries another tenant’s data: a demo link and a demo name stay out of the lab answers', async () => {
    await products([LINK_ONE]);
    await seedPaymentMapping(demoTenantId, {
      kind: 'access',
      name: 'Plano da demo',
      externalProductId: `mem-demo-${crypto.randomUUID()}`,
      checkoutUrl: DEMO_LINK,
    });
    await gated(async () => {
      const cutEmail = freshEmail(PREFIX, 'iso');
      await grantRow(cutEmail, 'gateway', 'inactive');
      const cut = await personWithEmail(cutEmail, 'lab');
      const own = await subscription(cut);
      expect(own.raw).not.toContain(DEMO_LINK);
      expect(own.raw).not.toContain('Plano da demo');
      expect(own.raw).not.toMatch(/rede-demo|Rede Demo/i);
      const tenant = await get('/v1/public/tenants/rede-lab', null, null);
      expect(tenant.raw).not.toContain(DEMO_LINK);
      const out = await outsider([]);
      expect((await joinState(out.token)).raw).not.toContain(DEMO_LINK);
    });
    await removePaymentMappings(demoTenantId);
  }, 60_000);

  it('the public tenant record carries the same link under the same condition (D-493)', async () => {
    await products([LINK_ONE, LINK_TWO]);
    const ungated = await get('/v1/public/tenants/rede-lab', null, null);
    expect(ungated.status).toBe(200);
    expect(ungated.json).not.toHaveProperty('accessCheckoutUrl');
    await gated(async () => {
      const gatedRecord = await get('/v1/public/tenants/rede-lab', null, null);
      expect(gatedRecord.status).toBe(200);
      expect(gatedRecord.json).toMatchObject({
        slug: 'rede-lab',
        displayName: labName,
        accessCheckoutUrl: LINK_ONE,
      });
    });
    await removePaymentMappings(labTenantId);
    await gated(async () => {
      const noLink = await get('/v1/public/tenants/rede-lab', null, null);
      expect(noLink.status).toBe(200);
      expect(noLink.json).not.toHaveProperty('accessCheckoutUrl');
    });
    // The demo tenant is not gated: no link, whatever the lab holds.
    const demo = await get('/v1/public/tenants/rede-demo', null, null);
    expect(demo.json).not.toHaveProperty('accessCheckoutUrl');
  }, 60_000);

  it('GET /v1/join/state answers access_required (with the link) to a person with no membership and no active access, joinable otherwise, and every old state unchanged', async () => {
    await products([LINK_ONE]);
    const none = await outsider([]);
    const released = await outsider([]);
    const blocked = await outsider([]);
    const late = await outsider([]);
    const elsewhere = await outsider([{ host: 'demo' }]);
    await grantRow(released.email, 'manual', 'active');
    await grantRow(blocked.email, 'manual', 'blocked');
    await grantRow(blocked.email, 'manual', 'active');
    await grantRow(late.email, 'gateway', 'inactive');

    // Gate off: everyone is joinable and no key carries a link.
    expect((await joinState(none.token)).json).toEqual({ state: 'joinable' });

    await gated(async () => {
      const refused = [none, blocked, late, elsewhere];
      const bodies: string[] = [];
      for (const who of refused) {
        const res = await joinState(who.token);
        expect(res.status).toBe(200);
        expect(joinStateSchema.parse(res.json)).toEqual({
          state: 'access_required',
          accessCheckoutUrl: LINK_ONE,
        });
        bodies.push(res.raw);
        expect(res.headers.get('cache-control')).toBe('no-store');
      }
      // The same sentence for every cause, naming no community (D-302): the bodies are identical.
      expect(new Set(bodies).size).toBe(1);
      for (const body of bodies) {
        expect(body).not.toMatch(/rede-demo|Rede Demo|rede-lab|Rede Lab/);
      }
      expect((await joinState(released.token)).json).toEqual({ state: 'joinable' });

      // No registered link: the state still reads access_required, without the key.
      await removePaymentMappings(labTenantId);
      expect((await joinState(none.token)).json).toEqual({ state: 'access_required' });
      await products([LINK_ONE]);

      // Every old state, with the gate ON, is untouched and carries no link.
      const member = await outsider([{ host: 'lab' }]);
      await grantRow(member.email, 'manual', 'active');
      expect((await joinState(member.token)).json).toEqual({ state: 'member' });
      const invited = await outsider([{ host: 'lab', status: 'invited' }]);
      expect((await joinState(invited.token)).json).toEqual({ state: 'invited' });
      const blockedHere = await outsider([{ host: 'lab', status: 'blocked' }]);
      expect((await joinState(blockedHere.token)).json).toEqual({ state: 'blocked' });
      const removed = await outsider([{ host: 'lab' }]);
      await adminSql`
        update public.memberships set deleted_at = now()
         where user_id = ${removed.userId}::uuid and tenant_id = ${labTenantId}::uuid`;
      expect((await joinState(removed.token)).json).toEqual({ state: 'removed' });
      const platform = await outsider([]);
      await adminSql`insert into public.platform_admins (user_id) values (${platform.userId}::uuid)`;
      expect((await joinState(platform.token)).json).toEqual({ state: 'platform_admin' });
    });
  }, 60_000);

  it('POST /v1/join stays the 403 of plan 03 for a person with no active access, and the demo host is unaffected', async () => {
    await products([LINK_ONE]);
    const none = await outsider([]);
    const attempt = (token: string, host: string) =>
      api.request('/v1/join', {
        method: 'POST',
        headers: {
          [TENANT_HOST_HEADER]: host,
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Maria Teste',
          consents: {
            tenantRulesVersion: labRulesVersion,
            platformTermsVersion: PLATFORM_TERMS_VERSION,
          },
        }),
      });
    await gated(async () => {
      const refused = await attempt(none.token, HOSTS.lab);
      expect(refused.status).toBe(403);
      expect(codeOf((await refused.json()) as Json)).toBe('EMAIL_NOT_ALLOWED');
    });
    // The ungated demo tenant still answers joinable for the same person.
    expect((await joinState(none.token, HOSTS.demo)).json).toEqual({ state: 'joinable' });
  }, 60_000);
});
