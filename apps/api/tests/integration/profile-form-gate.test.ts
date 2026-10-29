import { createClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removeProfileFormByPrefix,
  SEED_PASSWORD,
  seedProfileFormAnswer,
  seedProfileFormQuestion,
  signInAs,
  withPaymentsGate,
  withProfileForm,
} from './setup';

/**
 * 12-05 (PFORM-09, PFORM-10, PFORM-11, PFORM-12; D-581, D-584, D-585, D-589) against the live local stack:
 * a `member` with an unanswered REQUIRED question is refused everywhere except the bootstrap and the
 * form's own routes, from the same lookup row, last in the chain; the bootstrap says whether the form is
 * pending; and the refusal writes nothing and revokes nothing.
 *
 * EVERY identity is a THROWAWAY (`createSharedIdentity`, prefix `pfg`); questions carry the title prefix
 * `pfg ` so the sweep removes only this file's rows. The module row is restored by `withProfileForm`.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };

const PREFIX = 'pfg';
const TITLE = 'pfg ';
let labTenantId = '';
let demoTenantId = '';
let labName = '';
let adminUserId = '';

type Person = { userId: string; email: string; password: string; token: string };

async function person(
  role: 'member' | 'admin_tenant' | 'support_tenant' = 'member',
  host: keyof typeof HOSTS = 'lab',
  status: 'active' | 'blocked' | 'invited' = 'active',
): Promise<Person> {
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host, role, status }],
  });
  return { ...identity, token: await signInAs(identity.email, identity.password) };
}

const get = (p: Person, path: string, host = HOSTS.lab) =>
  api.request(path, { headers: { 'x-tenant-host': host, authorization: `Bearer ${p.token}` } });

const codeOf = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as Partial<Envelope>).error?.code;

const question = (over: Partial<Parameters<typeof seedProfileFormQuestion>[0]> = {}) =>
  seedProfileFormQuestion({
    tenantId: labTenantId,
    adminUserId,
    title: `${TITLE}${crypto.randomUUID().slice(0, 8)}`,
    required: true,
    ...over,
  });

const answerCount = async (): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.profile_form_answers
     where question_id in (select id from public.profile_form_questions where title like ${`${TITLE}%`})`;
  return row?.n ?? 0;
};

async function sweep(): Promise<void> {
  await removeProfileFormByPrefix(TITLE);
  await removeIdentitiesByPrefix(PREFIX);
}

beforeAll(async () => {
  const tenants = await adminSql<{ id: string; slug: string; display_name: string }[]>`
    select id::text as id, slug, display_name from public.tenants where slug in ('rede-lab', 'rede-demo')`;
  const lab = tenants.find((t) => t.slug === 'rede-lab');
  const demo = tenants.find((t) => t.slug === 'rede-demo');
  if (!lab || !demo) throw new Error('seed tenants are missing, run pnpm db:seed first');
  labTenantId = lab.id;
  demoTenantId = demo.id;
  labName = lab.display_name;
  await sweep();
  adminUserId = (await person('admin_tenant')).userId;
});

// Each case builds its own form: nothing a case seeded may gate the next one's members.
afterEach(async () => {
  await removeProfileFormByPrefix(TITLE);
});

afterAll(async () => {
  await sweep();
  // The seed has no `profile_form` row and `withProfileForm` restores that, so none must remain.
  await adminSql`
    delete from public.tenant_modules
     where module_key = 'profile_form' and tenant_id in (${labTenantId}::uuid, ${demoTenantId}::uuid)`;
});

describe('12-05 tracer: the refusal from the lookup row, and the bootstrap that explains it', () => {
  it('a member with an unanswered required question is refused on /profile and /counters, and the bootstrap tells the web', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      await question();

      for (const path of ['/v1/me/profile', '/v1/me/counters']) {
        const res = await get(member, path);
        expect(res.status, path).toBe(403);
        const payload = (await res.json()) as Envelope;
        expect(payload.error.code, path).toBe('PROFILE_FORM_PENDING');
        // The details hold the tenant name and nothing else: no count, no question title.
        expect(payload.error.details, path).toEqual({ tenantName: labName });
      }

      const bootstrap = await get(member, '/v1/me/bootstrap');
      expect(bootstrap.status).toBe(200);
      const body = (await bootstrap.json()) as {
        profileForm?: { pendingRequired: number; newOptional: number };
      };
      expect(body.profileForm).toEqual({ pendingRequired: 1, newOptional: 0 });
    });
  });

  it('the form routes are never refused by the gate (a route that does not exist yet is a 404, not a 403)', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      await question();
      for (const path of [
        '/v1/me/profile-form',
        '/v1/me/profile-form/',
        '/v1/me/profile-form/answers',
      ]) {
        const res = await get(member, path);
        expect(res.status === 403 ? await codeOf(res) : 'passed', path).not.toBe(
          'PROFILE_FORM_PENDING',
        );
      }
      // The path variants stay refused.
      for (const path of ['/v1/me/profile-form/answers/x', '/v1/me/profile-form-x']) {
        const res = await get(member, path);
        expect(res.status, path).toBe(403);
        expect(await codeOf(res), path).toBe('PROFILE_FORM_PENDING');
      }
    });
  });
});

describe('12-05 release: every way out of the gate keeps the answers', () => {
  it('answering the last missing required question releases the member on the very next request', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const first = await question();
      const second = await question();
      expect(await codeOf(await get(member, '/v1/me/profile'))).toBe('PROFILE_FORM_PENDING');

      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: first,
        userId: member.userId,
      });
      // One still missing: exactly 1 missing is gated.
      expect(await codeOf(await get(member, '/v1/me/profile'))).toBe('PROFILE_FORM_PENDING');
      const mid = (await (await get(member, '/v1/me/bootstrap')).json()) as {
        profileForm?: { pendingRequired: number };
      };
      expect(mid.profileForm?.pendingRequired).toBe(1);

      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: second,
        userId: member.userId,
      });
      // 0 missing is not gated.
      expect((await get(member, '/v1/me/profile')).status).toBe(200);
      const done = (await (await get(member, '/v1/me/bootstrap')).json()) as {
        profileForm?: { pendingRequired: number };
      };
      expect(done.profileForm?.pendingRequired).toBe(0);
    });
  });

  it('turning the module off releases the member and the answers stay (D-589)', async () => {
    const member = await person();
    const other = await person();
    await withProfileForm(labTenantId, async () => {
      const q = await question();
      await seedProfileFormAnswer({ tenantId: labTenantId, questionId: q, userId: other.userId });
      await question();
      expect(await codeOf(await get(member, '/v1/me/profile'))).toBe('PROFILE_FORM_PENDING');
      const answers = await answerCount();

      await withProfileForm(
        labTenantId,
        async () => {
          expect((await get(member, '/v1/me/profile')).status).toBe(200);
          const bootstrap = await get(member, '/v1/me/bootstrap');
          expect(bootstrap.status).toBe(200);
          expect(Object.keys((await bootstrap.json()) as object)).not.toContain('profileForm');
          expect(await answerCount()).toBe(answers);
        },
        { enabled: false },
      );

      // And back on: gated again, nothing was lost.
      expect(await codeOf(await get(member, '/v1/me/profile'))).toBe('PROFILE_FORM_PENDING');
    });
  });

  it('zero questions, only optional questions, and a missing module row gate nobody', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      expect((await get(member, '/v1/me/profile')).status).toBe(200);
      const empty = (await (await get(member, '/v1/me/bootstrap')).json()) as {
        profileForm?: unknown;
      };
      expect(empty.profileForm).toEqual({ pendingRequired: 0, newOptional: 0 });

      await question({ required: false });
      expect((await get(member, '/v1/me/profile')).status).toBe(200);
      const optional = (await (await get(member, '/v1/me/bootstrap')).json()) as {
        profileForm?: unknown;
      };
      expect(optional.profileForm).toEqual({ pendingRequired: 0, newOptional: 1 });
    });
    // No row at all (the seed's state): off.
    await question();
    expect((await get(member, '/v1/me/profile')).status).toBe(200);
  });

  it('archiving the last required question releases the member and the answers stay', async () => {
    const member = await person();
    const other = await person();
    await withProfileForm(labTenantId, async () => {
      const q = await question();
      await seedProfileFormAnswer({ tenantId: labTenantId, questionId: q, userId: other.userId });
      const answers = await answerCount();
      expect(await codeOf(await get(member, '/v1/me/profile'))).toBe('PROFILE_FORM_PENDING');

      // Concurrency: the admin archives between two requests of the gated member. The first was refused,
      // the next is not, and each saw one consistent state (one statement, one snapshot).
      await adminSql`update public.profile_form_questions set archived_at = now() where id = ${q}::uuid`;
      expect((await get(member, '/v1/me/profile')).status).toBe(200);
      expect(await answerCount()).toBe(answers);
    });
  });

  it('a "new optional" notice is counted from the dismissal instant', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      await question({ required: false, listedAt: new Date(Date.now() - 60_000) });
      const count = async () =>
        (
          (await (await get(member, '/v1/me/bootstrap')).json()) as {
            profileForm?: { newOptional: number };
          }
        ).profileForm?.newOptional;
      expect(await count()).toBe(1);
      await adminSql`
        update public.member_profiles set profile_form_notice_dismissed_at = now()
         where user_id = ${member.userId}::uuid and tenant_id = ${labTenantId}::uuid`;
      expect(await count()).toBe(0);
      await question({ required: false });
      expect(await count()).toBe(1);
    });
  });
});

describe('12-05 who is gated: the member role only, and only in its own tenant', () => {
  it('admin_tenant and support_tenant are never refused, and their bootstrap has no profileForm key', async () => {
    const admin = await person('admin_tenant');
    const support = await person('support_tenant');
    await withProfileForm(labTenantId, async () => {
      await question();
      for (const staff of [admin, support]) {
        for (const path of ['/v1/me/profile', '/v1/me/counters']) {
          expect((await get(staff, path)).status, path).toBe(200);
        }
        const bootstrap = await get(staff, '/v1/me/bootstrap');
        expect(bootstrap.status).toBe(200);
        expect(Object.keys((await bootstrap.json()) as object)).not.toContain('profileForm');
      }
    });
  });

  it("a second tenant's required question never gates this tenant's member", async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      await withProfileForm(demoTenantId, async () => {
        await seedProfileFormQuestion({
          tenantId: demoTenantId,
          adminUserId,
          title: `${TITLE}demo-only`,
          required: true,
        });
        expect((await get(member, '/v1/me/profile')).status).toBe(200);
        const body = (await (await get(member, '/v1/me/bootstrap')).json()) as {
          profileForm?: unknown;
        };
        expect(body.profileForm).toEqual({ pendingRequired: 0, newOptional: 0 });
      });
    });
  });
});

describe('12-05 precedence: the form is the last refusal', () => {
  it('a cut member is told to pay first (SUBSCRIPTION_PENDING), and reaches the form only after paying', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      await question();
      await withPaymentsGate(labTenantId, async () => {
        const cut = await get(member, '/v1/me/profile');
        expect(cut.status).toBe(403);
        expect(await codeOf(cut)).toBe('SUBSCRIPTION_PENDING');
        // The form route is not on the cut's allow-list, so even it answers the payment first.
        expect(await codeOf(await get(member, '/v1/me/profile-form'))).toBe('SUBSCRIPTION_PENDING');
        await adminSql`
          insert into public.access_grants (tenant_id, email, source, status)
          values (${labTenantId}::uuid, ${member.email}, 'manual', 'active')`;
        expect(await codeOf(await get(member, '/v1/me/profile'))).toBe('PROFILE_FORM_PENDING');
      });
    });
  });

  it('a blocked membership answers MEMBERSHIP_BLOCKED, not the form', async () => {
    const blocked = await person('member', 'lab', 'blocked');
    await withProfileForm(labTenantId, async () => {
      await question();
      expect(await codeOf(await get(blocked, '/v1/me/profile'))).toBe('MEMBERSHIP_BLOCKED');
    });
  });

  it('a user with no membership in the host tenant still gets TENANT_HOST_MISMATCH', async () => {
    const demoMember = await person('member', 'demo');
    await withProfileForm(labTenantId, async () => {
      await question();
      expect(await codeOf(await get(demoMember, '/v1/me/profile', HOSTS.lab))).toBe(
        'TENANT_HOST_MISMATCH',
      );
    });
  });
});

describe('12-05 the gate only refuses (D-581, D-498)', () => {
  it('ten refused requests leave the membership, the profile and the session untouched', async () => {
    const identity = await createSharedIdentity({
      prefix: PREFIX,
      memberships: [{ host: 'lab', role: 'member' }],
    });
    const client = createClient(
      process.env.SUPABASE_URL ?? '',
      process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: signedIn, error } = await client.auth.signInWithPassword({
      email: identity.email,
      password: identity.password || SEED_PASSWORD,
    });
    if (error || !signedIn.session) throw new Error(`sign-in failed: ${error?.message}`);
    const member: Person = { ...identity, token: signedIn.session.access_token };

    const snapshot = async () =>
      adminSql`
        select m.status, m.blocked_at, m.deleted_at, m.role,
               p.display_name, p.bio, p.avatar_asset_id, p.updated_at as profile_updated_at
          from public.memberships m
          join public.member_profiles p on p.membership_id = m.id
         where m.user_id = ${member.userId}::uuid and m.tenant_id = ${labTenantId}::uuid`;

    await withProfileForm(labTenantId, async () => {
      await question();
      const before = await snapshot();
      for (let i = 0; i < 10; i += 1) {
        expect(await codeOf(await get(member, '/v1/me/profile'))).toBe('PROFILE_FORM_PENDING');
      }
      expect(await snapshot()).toEqual(before);

      // The session is alive: a refresh still works, and the new token reaches the bootstrap.
      const refreshed = await client.auth.refreshSession();
      expect(refreshed.error).toBeNull();
      const token = refreshed.data.session?.access_token;
      expect(token).toBeTruthy();
      const again = await get({ ...member, token: token ?? '' }, '/v1/me/bootstrap');
      expect(again.status).toBe(200);
    });
  });
});
