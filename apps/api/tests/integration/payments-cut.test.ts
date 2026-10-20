import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  setPaymentsRow,
  signInAs,
  withPaymentsGate,
} from './setup';

/**
 * 09.1-02 (PAY-05, PAY-06, PAY-08, PAY-11, PAY-13, PAY-14, PAY-19; D-485..D-497) against the live local
 * stack: a gated tenant refuses a member with no access with `SUBSCRIPTION_PENDING` and admits her the
 * moment an access row exists, staff are never refused, and a tenant with the gate off behaves exactly
 * as before.
 *
 * EVERY identity here is a THROWAWAY built with `createSharedIdentity` (never a seed user): plan 03
 * makes the seed write access rows for the seed identities, and these cases need members with NO row.
 * Fixtures are removed by prefix in `beforeAll` (a crashed run) and `afterAll`; the access rows go with
 * the same prefix. `payments` rows are restored by `withPaymentsGate`.
 */

type Envelope = { error: { code: string; details?: { tenantName?: string } } };

const PREFIX = 'pay0912';
let labTenantId = '';
let labName = '';

type Person = { userId: string; email: string; token: string };

async function person(
  host: keyof typeof HOSTS,
  role: 'member' | 'admin_tenant' | 'support_tenant' = 'member',
): Promise<Person> {
  const identity = await createSharedIdentity({ prefix: PREFIX, memberships: [{ host, role }] });
  return {
    userId: identity.userId,
    email: identity.email,
    token: await signInAs(identity.email, identity.password),
  };
}

const bootstrap = (p: Person, host = HOSTS.lab) =>
  api.request('/v1/me/bootstrap', {
    headers: { 'x-tenant-host': host, authorization: `Bearer ${p.token}` },
  });

const codeOf = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as Partial<Envelope>).error?.code;

async function grantManual(email: string, status: 'active' | 'blocked'): Promise<void> {
  await adminSql`
    insert into public.access_grants (tenant_id, email, source, status)
    values (${labTenantId}::uuid, ${email}, 'manual', ${status})`;
}

async function grantGateway(
  email: string,
  status: 'active' | 'inactive',
  ref: string,
): Promise<void> {
  await adminSql`
    insert into public.access_grants (tenant_id, email, source, status, provider, external_ref)
    values (${labTenantId}::uuid, ${email}, 'gateway', ${status}, 'fake_gw', ${ref})`;
}

const clearGrants = (email: string) =>
  adminSql`delete from public.access_grants where tenant_id = ${labTenantId}::uuid and email = ${email}`;

async function sweep(): Promise<void> {
  await adminSql`
    delete from public.access_grants where email like ${`${PREFIX}-%`}`;
  await removeIdentitiesByPrefix(PREFIX);
}

beforeAll(async () => {
  const [tenant] = await adminSql<{ id: string; display_name: string }[]>`
    select id::text as id, display_name from public.tenants where slug = 'rede-lab'`;
  if (!tenant) throw new Error('tenant rede-lab is not seeded — run pnpm db:seed first');
  labTenantId = tenant.id;
  labName = tenant.display_name;
  await sweep();
});

afterAll(async () => {
  await sweep();
  // The seed has no `payments` row; P15 deletes it explicitly, so none must remain.
  await adminSql`
    delete from public.tenant_modules
     where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
});

describe('09.1 tracer', () => {
  it('a member with no access row is 403 SUBSCRIPTION_PENDING, then 200 once a grant exists', async () => {
    const member = await person('lab');
    await withPaymentsGate(labTenantId, async () => {
      const cut = await bootstrap(member);
      expect(cut.status).toBe(403);
      expect(await cut.json()).toMatchObject({
        error: { code: 'SUBSCRIPTION_PENDING', details: { tenantName: labName } },
      });

      await grantManual(member.email, 'active');
      expect((await bootstrap(member)).status).toBe(200);

      await clearGrants(member.email);
      expect(await codeOf(await bootstrap(member))).toBe('SUBSCRIPTION_PENDING');
    });
  });

  it('admin_tenant and support_tenant get 200 with no access row (D-492, PR-4)', async () => {
    const admin = await person('lab', 'admin_tenant');
    const support = await person('lab', 'support_tenant');
    await withPaymentsGate(labTenantId, async () => {
      expect((await bootstrap(admin)).status).toBe(200);
      expect((await bootstrap(support)).status).toBe(200);
    });
  });

  it('a manual block answers MEMBERSHIP_BLOCKED, with or without a manual release beside it', async () => {
    const member = await person('lab');
    await withPaymentsGate(labTenantId, async () => {
      await grantManual(member.email, 'blocked');
      expect(await codeOf(await bootstrap(member))).toBe('MEMBERSHIP_BLOCKED');

      await grantManual(member.email, 'active');
      const blocked = await bootstrap(member);
      expect(blocked.status).toBe(403);
      expect(await codeOf(blocked)).toBe('MEMBERSHIP_BLOCKED');

      // "Desbloquear" is the delete of the block row: the release is exactly as it was.
      await adminSql`
        delete from public.access_grants
         where tenant_id = ${labTenantId}::uuid and email = ${member.email} and status = 'blocked'`;
      expect((await bootstrap(member)).status).toBe(200);
    });
  });

  it('a gateway inactive row beside a manual release is SUBSCRIPTION_PENDING (A-P9, literal D-489)', async () => {
    const member = await person('lab');
    await withPaymentsGate(labTenantId, async () => {
      await grantManual(member.email, 'active');
      await grantGateway(member.email, 'inactive', 'ref-1');
      expect(await codeOf(await bootstrap(member))).toBe('SUBSCRIPTION_PENDING');
    });
  });

  it('one active gateway row among several opens the door (D-494)', async () => {
    const member = await person('lab');
    await withPaymentsGate(labTenantId, async () => {
      await grantGateway(member.email, 'inactive', 'ref-a');
      await grantGateway(member.email, 'active', 'ref-b');
      expect((await bootstrap(member)).status).toBe(200);
      await adminSql`
        update public.access_grants set status = 'inactive'
         where tenant_id = ${labTenantId}::uuid and email = ${member.email}`;
      expect(await codeOf(await bootstrap(member))).toBe('SUBSCRIPTION_PENDING');
    });
  });

  it('a cut writes nothing: membership status and profile are unchanged (PR-3, D-498)', async () => {
    const member = await person('lab');
    const snapshot = async () =>
      adminSql`
        select m.status, m.blocked_at, m.deleted_at, m.role, p.display_name, p.avatar_asset_id
          from public.memberships m
          left join public.member_profiles p on p.membership_id = m.id
         where m.user_id = ${member.userId}::uuid and m.tenant_id = ${labTenantId}::uuid`;
    const before = await snapshot();
    await withPaymentsGate(labTenantId, async () => {
      expect(await codeOf(await bootstrap(member))).toBe('SUBSCRIPTION_PENDING');
      expect(await snapshot()).toEqual(before);
      // the session itself is untouched: the same token still verifies once the gate is off
    });
    expect((await bootstrap(member)).status).toBe(200);
  });

  it('a member of rede-demo, which has no payments row, is untouched by the gate on rede-lab', async () => {
    const demoMember = await person('demo');
    await withPaymentsGate(labTenantId, async () => {
      const res = await bootstrap(demoMember, HOSTS.demo);
      expect(res.status).toBe(200);
    });
  });
});

describe('09.1 edges', () => {
  it('P14: only the jsonb boolean true opens the gate; lookalikes read as off', async () => {
    const member = await person('lab');
    for (const gate of ['true', 1, null, false]) {
      await withPaymentsGate(
        labTenantId,
        async () => {
          const res = await bootstrap(member);
          expect(res.status, `gate = ${JSON.stringify(gate)}`).toBe(200);
        },
        { gate },
      );
    }
  });

  it('P15: no payments row, or a row with empty settings, reads as gate off', async () => {
    const member = await person('lab');
    await adminSql`
      delete from public.tenant_modules
       where tenant_id = ${labTenantId}::uuid and module_key = 'payments'`;
    expect((await bootstrap(member)).status).toBe(200);
    await withPaymentsGate(
      labTenantId,
      async () => {
        expect((await bootstrap(member)).status).toBe(200);
      },
      { settings: {} },
    );
  });

  it('P16: a disabled module with gate = true still reads as off', async () => {
    const member = await person('lab');
    await withPaymentsGate(
      labTenantId,
      async () => {
        expect((await bootstrap(member)).status).toBe(200);
      },
      { enabled: false, gate: true },
    );
  });

  it('P17: flipping the gate between two requests of one member shows both answers', async () => {
    const member = await person('lab');
    await withPaymentsGate(labTenantId, async () => {
      expect(await codeOf(await bootstrap(member))).toBe('SUBSCRIPTION_PENDING');
      await setPaymentsRow(labTenantId, { gate: false });
      expect((await bootstrap(member)).status).toBe(200);
      await setPaymentsRow(labTenantId, { gate: true });
      expect(await codeOf(await bootstrap(member))).toBe('SUBSCRIPTION_PENDING');
      await grantManual(member.email, 'active');
      expect((await bootstrap(member)).status).toBe(200);
    });
  });

  it('P26: requests racing a flip each get one valid answer and never a 5xx', async () => {
    const member = await person('lab');
    await withPaymentsGate(labTenantId, async () => {
      const flips = (async () => {
        for (let i = 0; i < 4; i += 1) {
          await grantManual(member.email, 'active');
          await clearGrants(member.email);
        }
      })();
      const statuses = await Promise.all([
        ...Array.from({ length: 8 }, async () => {
          const res = await bootstrap(member);
          return { status: res.status, code: res.status === 200 ? null : await codeOf(res) };
        }),
        flips.then(() => ({ status: 0, code: null })),
      ]);
      for (const s of statuses.slice(0, 8)) {
        expect(s.status === 200 || (s.status === 403 && s.code === 'SUBSCRIPTION_PENDING')).toBe(
          true,
        );
      }
    });
  });
});
