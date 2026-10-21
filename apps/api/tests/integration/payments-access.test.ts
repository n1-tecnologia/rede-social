import { PLATFORM_TERMS_VERSION, TENANT_HOST_HEADER } from '@rede-social/contracts';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapCode,
  deliver,
  deliverAndApply,
  freshEmail,
  type Person,
  personWithEmail,
  runApply,
} from './payments-apply-fixtures';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removePaymentIntegrations,
  removePaymentMappings,
  type SeededPaymentIntegration,
  seedPaymentIntegration,
  seedPaymentMapping,
  signInAs,
  withPaymentsGate,
} from './setup';

/**
 * 09.1-10 (D-489, D-504; PAY-22, PAY-29) against the live local stack: the Acessos list and its four
 * actions, read and written through the REAL routes with a REAL gated request as the proof of effect.
 *
 *  - `09.1 tracer`: a signed delivery made a person's access active; the admin sees ONE row for that
 *    e-mail, blocks it (the member's next request is `MEMBERSHIP_BLOCKED`), unblocks it (back to what
 *    the gateway says), releases an address that has no account yet (the sign-up then succeeds) and
 *    removes that release (the sign-up is refused again). A gateway row can be blocked, never removed.
 *  - `09.1 edges`: P51 adjacency, P52 empty, P53 keyset ordering, P54 idempotency, P55 concurrency,
 *    and the authorisation of the five routes.
 *
 * Every identity carries the prefix below (its access rows go with it). The integration, its events and
 * its mappings are removed in `afterAll`. Test ORDER is load-bearing (`fileParallelism: false`).
 */

const PREFIX = 'payacc';
const RUN = crypto.randomUUID().slice(0, 8);
let labTenantId = '';
let labRulesVersion = 1;
let admin: Person;
let supportUser: Person;
let plainMember: Person;
let integration: SeededPaymentIntegration;

type Json = Record<string, unknown>;
type Item = {
  id: string;
  email: string;
  source: string;
  state: string;
  validUntil: string | null;
  hasAccount: boolean;
  updatedAt: string;
};

async function call(
  who: Person | null,
  method: string,
  path: string,
  body?: unknown,
  host: string = HOSTS.lab,
): Promise<{ status: number; json: Json }> {
  const res = await api.request(`/v1/payments${path}`, {
    method,
    headers: {
      [TENANT_HOST_HEADER]: host,
      ...(who ? { authorization: `Bearer ${who.token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await res.text();
  let json: Json = {};
  try {
    json = raw ? (JSON.parse(raw) as Json) : {};
  } catch {
    // A non-JSON body (an unmounted route answers plain text): the status still tells.
  }
  return { status: res.status, json };
}

const list = async (query = ''): Promise<{ items: Item[]; nextCursor: string | null }> => {
  const res = await call(admin, 'GET', `/accesses${query}`);
  expect(res.status, `GET /accesses${query}`).toBe(200);
  return res.json as { items: Item[]; nextCursor: string | null };
};

const act = (action: 'release' | 'block' | 'unblock' | 'remove-release', email: string) =>
  call(admin, 'POST', `/accesses/${action}`, { email });

const accessOf = (res: { json: Json }) => res.json.access as Item | null;

const codeOf = (res: { json: Json }) =>
  ((res.json as { error?: { code?: string; details?: { payments?: string } } }).error ?? {}) as {
    code?: string;
    details?: { payments?: string };
  };

/** Every access row of one e-mail in the lab tenant, in the order the table holds them. */
const rowsOf = (email: string) =>
  adminSql<{ source: string; status: string; provider: string | null }[]>`
    select source, status, provider from public.access_grants
     where tenant_id = ${labTenantId}::uuid and email = ${email}
     order by source, status`;

const effective = async (email: string): Promise<string> => {
  const [row] = await adminSql<{ state: string }[]>`
    select app.access_effective(${labTenantId}::uuid, ${email}) as state`;
  return row?.state ?? '';
};

const insertGateway = (email: string, status: 'active' | 'inactive', provider = 'fake') =>
  adminSql`
    insert into public.access_grants (tenant_id, email, source, status, provider, external_ref)
    values (${labTenantId}::uuid, ${email}, 'gateway', ${status}, ${provider},
            ${`ref-${crypto.randomUUID()}`})`;

const signupTo = (address: string) =>
  api.request('/v1/public/signup/rede-lab', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Maria Teste',
      email: address,
      password: 'Segredo123',
      consents: {
        tenantRulesVersion: labRulesVersion,
        platformTermsVersion: PLATFORM_TERMS_VERSION,
      },
    }),
  });

/** Runs `fn` with the lab payments module ENABLED and the gate ON, then restores the row. */
async function gated<T>(fn: () => Promise<T>): Promise<T> {
  moduleFlags.invalidate(labTenantId);
  try {
    return await withPaymentsGate(labTenantId, fn);
  } finally {
    moduleFlags.invalidate(labTenantId);
  }
}

async function sweep(): Promise<void> {
  await adminSql`
    delete from public.access_grants
     where email like ${`${PREFIX}-%`}
        or email like ${`%@${PREFIX}-${RUN}.test`}
        or created_by_user_id in (select id from public.users where email like ${`${PREFIX}-%`})`;
  await removePaymentMappings(labTenantId);
  await removePaymentIntegrations(labTenantId);
  await removeIdentitiesByPrefix(PREFIX);
}

/** A plain address no account owns, on a domain the sweep knows (`<local>@payacc-<run>.test`). */
const address = (local: string) => `${local}@${PREFIX}-${RUN}.test`;

const sale = (
  type: string,
  fields: { ref: string; productId: string; email: string } & Record<string, unknown>,
) => {
  const { ref, productId, email, ...rest } = fields;
  return {
    type,
    externalRef: ref,
    productId,
    email,
    amountCents: 4990,
    currency: 'BRL',
    recurring: true,
    validUntil: '2027-01-01T00:00:00.000Z',
    ...rest,
  };
};

beforeAll(async () => {
  const [tenant] = await adminSql<{ id: string; rules_version: number }[]>`
    select id::text as id, rules_version from public.tenants where slug = 'rede-lab'`;
  if (!tenant) throw new Error('tenant rede-lab is not seeded — run pnpm db:seed first');
  labTenantId = tenant.id;
  labRulesVersion = tenant.rules_version;
  await sweep();
  const adminIdentity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role: 'admin_tenant' }],
  });
  admin = {
    userId: adminIdentity.userId,
    membershipId: '',
    email: adminIdentity.email,
    token: await signInAs(adminIdentity.email, adminIdentity.password),
  };
  const supportIdentity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role: 'support_tenant' }],
  });
  supportUser = {
    userId: supportIdentity.userId,
    membershipId: '',
    email: supportIdentity.email,
    token: await signInAs(supportIdentity.email, supportIdentity.password),
  };
  const memberIdentity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role: 'member' }],
  });
  plainMember = {
    userId: memberIdentity.userId,
    membershipId: '',
    email: memberIdentity.email,
    token: await signInAs(memberIdentity.email, memberIdentity.password),
  };
}, 60_000);

afterAll(async () => {
  moduleFlags.invalidate(labTenantId);
  await sweep();
}, 60_000);

describe('09.1 tracer', () => {
  it('the admin sees who has access and can block, unblock, release and remove a release; a gateway row is never removed by hand', async () => {
    await gated(async () => {
      integration = await seedPaymentIntegration(labTenantId);
      const productId = `acc-${crypto.randomUUID()}`;
      await seedPaymentMapping(labTenantId, {
        kind: 'access',
        name: 'Plano',
        externalProductId: productId,
      });
      const memberEmail = freshEmail(PREFIX, 'ana');
      const member = await personWithEmail(memberEmail, 'lab');
      const ref = `sub-${crypto.randomUUID()}`;

      // (a) a signed delivery made the access active: ONE row for that e-mail
      const applied = await deliverAndApply(
        integration,
        sale('purchase_approved', { ref, productId, email: memberEmail }),
      );
      expect(applied.state).toBe('applied');
      expect(await bootstrapCode(member)).toBe('OK');
      const first = await list(`?q=${encodeURIComponent(memberEmail)}`);
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).toBeNull();
      expect(first.items[0]).toMatchObject({
        id: memberEmail,
        email: memberEmail,
        source: 'fake',
        state: 'active',
        hasAccount: true,
        validUntil: '2027-01-01T00:00:00.000Z',
      });
      expect(typeof first.items[0]?.updatedAt).toBe('string');

      // (b) block (typed in capitals: the e-mail is normalised): the member's next request is refused
      const blocked = await act('block', memberEmail.toUpperCase());
      expect(blocked.status).toBe(200);
      expect(accessOf(blocked)).toMatchObject({
        id: memberEmail,
        source: 'manual',
        state: 'blocked',
        hasAccount: true,
      });
      expect(await bootstrapCode(member)).toBe('MEMBERSHIP_BLOCKED');
      expect((await list(`?q=${encodeURIComponent(memberEmail)}`)).items).toHaveLength(1);

      // (c) unblock: the member returns to the state the gateway says
      const unblocked = await act('unblock', memberEmail);
      expect(unblocked.status).toBe(200);
      expect(accessOf(unblocked)).toMatchObject({ source: 'fake', state: 'active' });
      expect(await bootstrapCode(member)).toBe('OK');
      expect(await rowsOf(memberEmail)).toEqual([
        { source: 'gateway', status: 'active', provider: 'fake' },
      ]);

      // (d) a gateway row can be blocked but never removed by hand
      const noRemoval = await act('remove-release', memberEmail);
      expect(noRemoval.status).toBe(404);
      expect(await rowsOf(memberEmail)).toEqual([
        { source: 'gateway', status: 'active', provider: 'fake' },
      ]);

      // (e) release BEFORE the account exists: the sign-up is refused first, then succeeds
      const ghost = freshEmail(PREFIX, 'ghost');
      expect((await signupTo(ghost)).status).toBe(403);
      const released = await act('release', ghost);
      expect(released.status).toBe(200);
      expect(accessOf(released)).toMatchObject({
        id: ghost,
        source: 'manual',
        state: 'active',
        hasAccount: false,
        validUntil: null,
      });
      expect((await signupTo(ghost)).status).toBe(201);

      // (f) remove the release: 200 with no row, and the sign-up is refused again
      const ghostTwo = freshEmail(PREFIX, 'ghost2');
      expect((await act('release', ghostTwo)).status).toBe(200);
      const removed = await act('remove-release', ghostTwo);
      expect(removed.status).toBe(200);
      expect(accessOf(removed)).toBeNull();
      expect(await rowsOf(ghostTwo)).toEqual([]);
      expect((await signupTo(ghostTwo)).status).toBe(403);

      // (g) a release is refused while the e-mail is manually blocked
      expect((await act('block', memberEmail)).status).toBe(200);
      const refused = await act('release', memberEmail);
      expect(refused.status).toBe(409);
      expect(codeOf(refused)).toMatchObject({ code: 'CONFLICT', details: { payments: 'blocked' } });
      expect((await act('unblock', memberEmail)).status).toBe(200);
      expect(await bootstrapCode(member)).toBe('OK');
    });
  }, 60_000);
});

describe('09.1 edges', () => {
  it('authorisation: a member and a support_tenant are 403 on all five routes, no token is 401, a malformed address is email_invalid', async () => {
    await gated(async () => {
      const routes: [string, string, unknown?][] = [
        ['GET', '/accesses'],
        ['POST', '/accesses/release', { email: 'a@example.com' }],
        ['POST', '/accesses/block', { email: 'a@example.com' }],
        ['POST', '/accesses/unblock', { email: 'a@example.com' }],
        ['POST', '/accesses/remove-release', { email: 'a@example.com' }],
      ];
      for (const who of [plainMember, supportUser]) {
        for (const [method, path, body] of routes) {
          expect((await call(who, method, path, body)).status, `${method} ${path}`).toBe(403);
        }
      }
      for (const [method, path, body] of routes) {
        expect((await call(null, method, path, body)).status, `${method} ${path}`).toBe(401);
      }
      for (const email of ['', 'a', 'a@', 'x'.repeat(260)]) {
        const bad = await act('release', email);
        expect(bad.status, JSON.stringify(email)).toBe(400);
        expect(codeOf(bad).details?.payments).toBe('email_invalid');
      }
    });
  });

  it('staff are exempt: blocking or releasing the admin own address changes nothing for the admin', async () => {
    await gated(async () => {
      expect((await act('block', admin.email)).status).toBe(200);
      expect((await list(`?q=${encodeURIComponent(admin.email)}`)).items[0]?.state).toBe('blocked');
      // The admin still reaches the panel that would undo it (D-492).
      expect((await call(admin, 'GET', '/accesses?limit=1')).status).toBe(200);
      expect((await act('unblock', admin.email)).status).toBe(200);
    });
  });

  it('P51 adjacency: case and space variants are one row, a plus-address is another, four rows of one e-mail are one item that follows app.access_effective', async () => {
    await gated(async () => {
      const base = address('ana');
      const plus = address('ana+x');
      const a = await act('release', `  ${base.toUpperCase().replace('ANA', 'Ana')} `);
      const b = await act('release', base);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(accessOf(a)?.id).toBe(base);
      expect(accessOf(b)?.id).toBe(base);
      expect(await rowsOf(base)).toHaveLength(1);
      expect((await act('release', plus)).status).toBe(200);
      const both = await list(`?q=${encodeURIComponent(`@${PREFIX}-${RUN}.test`)}`);
      expect(both.items.map((item) => item.id).sort()).toEqual([base, plus].sort());

      // a manual release, a manual block and two gateway rows of one e-mail: ONE item
      const crowded = address('crowded');
      await act('release', crowded);
      await act('block', crowded);
      await insertGateway(crowded, 'active');
      await insertGateway(crowded, 'inactive', 'other');
      expect(await rowsOf(crowded)).toHaveLength(4);
      const listed = await list(`?q=${encodeURIComponent(crowded)}`);
      expect(listed.items).toHaveLength(1);
      expect(await effective(crowded)).toBe('blocked');
      expect(listed.items[0]).toMatchObject({ state: 'blocked', source: 'manual' });

      // unblock: the gateway and the release decide again, in the SQL function's order
      await act('unblock', crowded);
      const back = await list(`?q=${encodeURIComponent(crowded)}`);
      expect(await effective(crowded)).toBe('active');
      expect(back.items[0]?.state).toBe('active');
      expect(['fake', 'other']).toContain(back.items[0]?.source);

      // only an inactive gateway row beside a release: the SQL order says inactive
      const late = address('late');
      await act('release', late);
      await insertGateway(late, 'inactive');
      expect(await effective(late)).toBe('inactive');
      expect((await list(`?q=${encodeURIComponent(late)}`)).items[0]?.state).toBe(
        'subscription_pending',
      );
    });
  });

  it('P52 empty: a no-match q and an empty status answer an empty page, spaces filter nothing, a limit of 0 or 51 is a 400', async () => {
    await gated(async () => {
      const none = await list(`?q=${encodeURIComponent(`zz-no-such-${RUN}`)}`);
      expect(none).toMatchObject({ items: [], nextCursor: null });
      const noBlocked = await list(`?status=blocked&q=${encodeURIComponent(`zz-no-such-${RUN}`)}`);
      expect(noBlocked).toMatchObject({ items: [], nextCursor: null });
      const spaces = await list(`?q=${encodeURIComponent('     ')}`);
      const all = await list('');
      expect(spaces.items.map((item) => item.id)).toEqual(all.items.map((item) => item.id));
      // a q of LIKE wildcards matches only a literal percent sign, never everything
      expect((await list(`?q=${encodeURIComponent('%')}`)).items).toEqual([]);
      for (const item of (await list(`?q=${encodeURIComponent('_')}`)).items) {
        expect(item.id).toContain('_');
      }
      for (const limit of ['0', '51', '-3']) {
        expect((await call(admin, 'GET', `/accesses?limit=${limit}`)).status, limit).toBe(400);
      }
      expect((await call(admin, 'GET', '/accesses?status=nonsense')).status).toBe(400);
    });
  });

  it('P53 ordering: pages follow (updated_at desc, email desc) across rows with equal updated_at, with no repeat and no skip', async () => {
    await gated(async () => {
      const locals = ['ks-a', 'ks-b', 'ks-c', 'ks-d', 'ks-e', 'ks-f', 'ks-g'];
      const emails = locals.map(address);
      for (const email of emails) expect((await act('release', email)).status).toBe(200);
      // three rows share one instant, two share another, two are alone
      await adminSql`
        update public.access_grants set updated_at = '2026-03-01T10:00:00.000000Z'
         where tenant_id = ${labTenantId}::uuid and email = any(${[emails[0], emails[1], emails[2]] as string[]})`;
      await adminSql`
        update public.access_grants set updated_at = '2026-03-02T10:00:00.000000Z'
         where tenant_id = ${labTenantId}::uuid and email = any(${[emails[3], emails[4]] as string[]})`;
      await adminSql`
        update public.access_grants set updated_at = '2026-03-03T10:00:00.123456Z'
         where tenant_id = ${labTenantId}::uuid and email = ${emails[5] ?? ''}`;
      await adminSql`
        update public.access_grants set updated_at = '2026-03-03T10:00:00.123457Z'
         where tenant_id = ${labTenantId}::uuid and email = ${emails[6] ?? ''}`;

      const expected = await adminSql<{ email: string }[]>`
        select email from public.access_grants
         where tenant_id = ${labTenantId}::uuid and email like ${`ks-%@${PREFIX}-${RUN}.test`}
         order by updated_at desc, email desc`;
      const q = encodeURIComponent(`@${PREFIX}-${RUN}.test`);
      const unpaged = await list(`?q=${q}&limit=50`);
      const ks = unpaged.items.filter((item) => item.id.startsWith('ks-')).map((item) => item.id);
      expect(ks).toEqual(expected.map((row) => row.email));

      for (const limit of [1, 2, 3]) {
        const seen: string[] = [];
        let cursor: string | null = null;
        for (let guard = 0; guard < 40; guard += 1) {
          const page: { items: Item[]; nextCursor: string | null } = await list(
            `?q=${q}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          );
          seen.push(...page.items.map((item) => item.id));
          cursor = page.nextCursor;
          if (!cursor) break;
        }
        expect(seen, `limit ${limit}`).toEqual(unpaged.items.map((item) => item.id));
        expect(new Set(seen).size).toBe(seen.length);
      }

      // a tampered cursor reads as the first page, never an error
      const tampered = await call(admin, 'GET', `/accesses?q=${q}&cursor=not-a-cursor`);
      expect(tampered.status).toBe(200);
    });
  });

  it('P54 idempotency: every action repeated leaves consistent rows and answers the current row (or a bare 404 for nothing to remove)', async () => {
    await gated(async () => {
      const email = address('idem');
      const r1 = await act('release', email);
      const r2 = await act('release', email);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      expect(accessOf(r1)?.id).toBe(email);
      expect(accessOf(r2)?.updatedAt).toBe(accessOf(r1)?.updatedAt);
      expect(await rowsOf(email)).toHaveLength(1);

      const b1 = await act('block', email);
      const b2 = await act('block', email);
      expect([b1.status, b2.status]).toEqual([200, 200]);
      expect(accessOf(b2)?.state).toBe('blocked');
      expect(await rowsOf(email)).toHaveLength(2);

      const u1 = await act('unblock', email);
      const u2 = await act('unblock', email);
      expect([u1.status, u2.status]).toEqual([200, 200]);
      expect(accessOf(u2)).toMatchObject({ state: 'active', source: 'manual' });
      expect(await rowsOf(email)).toHaveLength(1);

      const x1 = await act('remove-release', email);
      const x2 = await act('remove-release', email);
      expect(x1.status).toBe(200);
      expect(accessOf(x1)).toBeNull();
      expect(x2.status).toBe(404);

      // an address whose only row is the block: the first unblock leaves no row, the second is a 404
      const lone = address('lone');
      expect((await act('block', lone)).status).toBe(200);
      const l1 = await act('unblock', lone);
      expect(l1.status).toBe(200);
      expect(accessOf(l1)).toBeNull();
      expect((await act('unblock', lone)).status).toBe(404);
    });
  });

  it('P55 concurrency: release racing block, two releases, and a gateway apply racing a block all settle on one consistent state', async () => {
    await gated(async () => {
      for (let round = 0; round < 6; round += 1) {
        const email = address(`race-${round}`);
        const [release, block] = await Promise.all([act('release', email), act('block', email)]);
        expect(block.status).toBe(200);
        expect([200, 409]).toContain(release.status);
        const rows = await rowsOf(email);
        expect(rows.some((row) => row.status === 'blocked')).toBe(true);
        // each answer agrees with the table: a 409 left no release, a 200 left both rows
        expect(rows.some((row) => row.status === 'active')).toBe(release.status === 200);
        expect(await effective(email)).toBe('blocked');
      }

      const twin = address('twin');
      const pair = await Promise.all([act('release', twin), act('release', twin)]);
      expect(pair.map((res) => res.status)).toEqual([200, 200]);
      expect(await rowsOf(twin)).toHaveLength(1);

      // a gateway apply racing an admin block: the block stays in force (a block outranks, D-489)
      const productId = `acc-${crypto.randomUUID()}`;
      await seedPaymentMapping(labTenantId, {
        kind: 'access',
        name: 'Corrida',
        externalProductId: productId,
      });
      const target = freshEmail(PREFIX, 'raced');
      const eventId = await deliver(
        integration,
        sale('purchase_approved', { ref: `sub-${crypto.randomUUID()}`, productId, email: target }),
      );
      const [, blockedRace] = await Promise.all([runApply(eventId), act('block', target)]);
      expect(blockedRace.status).toBe(200);
      const raced = await rowsOf(target);
      expect(raced).toContainEqual({ source: 'manual', status: 'blocked', provider: null });
      expect(raced.some((row) => row.source === 'gateway')).toBe(true);
      expect(await effective(target)).toBe('blocked');
      expect((await list(`?q=${encodeURIComponent(target)}`)).items[0]).toMatchObject({
        state: 'blocked',
        source: 'manual',
      });
    });
  });
});
