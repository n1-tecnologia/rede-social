import { answerTokens } from '@rede-social/contracts/profile-form';
import {
  branchTreeOf,
  type ChainFixture,
  isQuestionVisibleInTree,
  PROFILE_FORM_CHAIN_CASES,
  PROFILE_FORM_CHAIN_FIXTURE,
  PROFILE_FORM_CHAIN_FIXTURE_BROKEN,
} from '@rede-social/contracts/profile-form-branches';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  deleteProfileFormTenantData,
  HOSTS,
  removeIdentitiesByPrefix,
  removeProfileFormByPrefix,
  SEED_PASSWORD,
  seedProfileFormAnswer,
  seedProfileFormBranch,
  seedProfileFormQuestion,
  seedProfileFormStep,
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

// ── 12.2-10 Task 2: the gate releases a member exactly when the report is empty, three levels deep (D-644) ──

describe('12.2-10 D-644: on a depth-3 tree the SQL gate and the save report agree at every step (PFORM-52)', () => {
  it('holds the member while the report lists a question, level by level, and releases her the moment it is empty', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      // Q1 | B1 {Q2 | B2 {Q3 | B3 {Q4 required}, Q5 required}, Q6 required}: all required below Q1.
      const q1 = await question({ type: 'yes_no', position: 1, required: false });
      const b1 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1,
        values: ['true'],
      });
      const q2 = await question({ type: 'yes_no', position: 2, required: false, branchId: b1 });
      const b2 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q2,
        values: ['true'],
      });
      const q3 = await question({ type: 'yes_no', position: 3, required: false, branchId: b2 });
      const b3 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q3,
        values: ['true'],
      });
      const q4 = await question({ position: 4, branchId: b3 });
      const q5 = await question({ position: 5, branchId: b2 });
      const q6 = await question({ position: 6, branchId: b1 });

      const put = (questionId: string, value: unknown) =>
        seedProfileFormAnswer({ tenantId: labTenantId, questionId, userId: member.userId, value });
      /** The report of an empty save (the same lookup the web's stepper reads) and the gate's verdict. */
      const state = async () => {
        const read = await get(member, '/v1/me/profile-form');
        const form = (await read.json()) as { formEtag: string };
        const report = await api.request('/v1/me/profile-form/answers', {
          method: 'PUT',
          headers: {
            'x-tenant-host': HOSTS.lab,
            authorization: `Bearer ${member.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ formEtag: form.formEtag, answers: {} }),
        });
        expect(report.status).toBe(200);
        const { missingRequired, missingQuestionIds } = (await report.json()) as {
          missingRequired: number;
          missingQuestionIds: string[];
        };
        const gate = (await get(member, '/v1/me/profile')).status;
        return { missingRequired, missingQuestionIds, gate };
      };

      // Nothing answered: Q1 is optional and the rest hang below it, so nobody is held.
      expect(await state()).toEqual({ missingRequired: 0, missingQuestionIds: [], gate: 200 });
      await put(q1, true);
      expect(await state()).toEqual({ missingRequired: 1, missingQuestionIds: [q6], gate: 403 });
      await put(q2, true);
      expect(await state()).toEqual({
        missingRequired: 2,
        missingQuestionIds: [q5, q6],
        gate: 403,
      });
      await put(q3, true);
      expect(await state()).toEqual({
        missingRequired: 3,
        missingQuestionIds: [q4, q5, q6],
        gate: 403,
      });
      await put(q4, 'a');
      await put(q5, 'b');
      expect(await state()).toEqual({ missingRequired: 1, missingQuestionIds: [q6], gate: 403 });
      await put(q6, 'c');
      // Empty report and an open gate at once, and the bootstrap agrees.
      expect(await state()).toEqual({ missingRequired: 0, missingQuestionIds: [], gate: 200 });
      const bootstrap = (await (await get(member, '/v1/me/bootstrap')).json()) as {
        profileForm?: { pendingRequired: number };
      };
      expect(bootstrap.profileForm?.pendingRequired).toBe(0);
    });
  }, 60_000);
});

// ── 12.2-12 Task 1 (tracer): the same rows through the TypeScript rule, the SQL gate and the purge (D-644, D-645, PFORM-54) ──

describe('12.2-12 chain parity (PFORM-54): the rule, the gate and the purge agree on every row of PROFILE_FORM_CHAIN_CASES', () => {
  const DB_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
  const holder = postgres(DB_URL, { prepare: false, max: 1 });
  let chainMember: Person;
  let chainMembershipId = '';

  beforeAll(async () => {
    chainMember = await person();
    const [row] = await adminSql<{ id: string }[]>`
      select id::text as id from public.memberships
       where user_id = ${chainMember.userId}::uuid and tenant_id = ${labTenantId}::uuid`;
    if (!row) throw new Error('the chain member has no membership');
    chainMembershipId = row.id;
  });

  // The module row is restored by `withProfileForm`; the lab tenant's form rows are removed in ONE transaction with
  // the deferrable keys deferred (a branch and its opener reference each other).
  afterEach(async () => {
    await deleteProfileFormTenantData(labTenantId);
  });

  afterAll(async () => {
    await holder.end({ timeout: 2 });
  });

  type Seeded = { ids: Map<string, string>; stepOne: string };

  /** Option ids a choice question of the fixture needs: the values of the branches it opens plus every option a case stores. */
  function optionIdsOf(fixture: ChainFixture, key: string): string[] {
    const found = new Set<string>();
    for (const branch of fixture.branches) {
      if (branch.openerKey === key) for (const v of branch.values) found.add(v);
    }
    for (const row of PROFILE_FORM_CHAIN_CASES) {
      if ((row.fixture ?? PROFILE_FORM_CHAIN_FIXTURE) !== fixture) continue;
      const value = row.stored[key] as { optionId?: unknown; optionIds?: unknown } | undefined;
      if (typeof value?.optionId === 'string') found.add(value.optionId);
      if (Array.isArray(value?.optionIds)) for (const v of value.optionIds) found.add(String(v));
    }
    return [...found];
  }

  /** The fixture as real rows: the unconditional questions in step 1, the rest in step 2, openers before their branches. */
  async function seedFixture(fixture: ChainFixture): Promise<Seeded> {
    const stepOne = await seedProfileFormStep({
      tenantId: labTenantId,
      title: `${TITLE}S1`,
      position: 1,
    });
    const stepTwo = await seedProfileFormStep({
      tenantId: labTenantId,
      title: `${TITLE}S2`,
      position: 2,
    });
    const ids = new Map<string, string>();
    const branchIds = new Map<string, string>();
    const pendingQuestions = [...fixture.questions];
    const pendingBranches = [...fixture.branches];
    let position = 0;
    while (pendingQuestions.length + pendingBranches.length > 0) {
      let progressed = false;
      for (const q of [...pendingQuestions]) {
        const branch =
          q.branchId === null ? undefined : fixture.branches.find((b) => b.id === q.branchId);
        if (q.branchId !== null && !branchIds.has(branch?.key ?? '')) continue;
        const choice = q.type === 'single_choice' || q.type === 'multiple_choice';
        const optionIds = choice ? optionIdsOf(fixture, q.key) : [];
        while (choice && optionIds.length < 2) optionIds.push(crypto.randomUUID());
        position += 1;
        ids.set(
          q.key,
          await seedProfileFormQuestion({
            tenantId: labTenantId,
            adminUserId,
            title: `${TITLE}${q.key}`,
            type: q.type,
            required: q.required,
            position,
            stepId: q.branchId === null ? stepOne : stepTwo,
            branchId: branch ? branchIds.get(branch.key) : undefined,
            allowOther: q.type === 'single_choice',
            options: choice
              ? optionIds.map((id, at) => ({ id, label: `Opção ${at + 1}` }))
              : undefined,
          }),
        );
        pendingQuestions.splice(pendingQuestions.indexOf(q), 1);
        progressed = true;
      }
      for (const b of [...pendingBranches]) {
        const opener = ids.get(b.openerKey);
        if (opener === undefined) continue;
        branchIds.set(
          b.key,
          await seedProfileFormBranch({
            tenantId: labTenantId,
            openerQuestionId: opener,
            values: [...b.values],
          }),
        );
        pendingBranches.splice(pendingBranches.indexOf(b), 1);
        progressed = true;
      }
      if (!progressed) throw new Error('seedFixture: the fixture is not a tree');
    }
    return { ids, stepOne };
  }

  /** Evaluator 1: the TypeScript rule over the contracts' fixture, the stored answers by key. */
  function ruleOf(fixture: ChainFixture, stored: Record<string, unknown>) {
    const keyOf = new Map(fixture.questions.map((q) => [q.id, q.key]));
    const idOf = new Map(fixture.questions.map((q) => [q.key, q.id]));
    const tree = branchTreeOf(
      fixture.questions.map((q) => ({ id: q.id, branchId: q.branchId })),
      fixture.branches.map((b) => ({
        id: b.id,
        openerQuestionId: idOf.get(b.openerKey) as string,
        values: b.values,
      })),
    );
    const tokensOf = (id: string) => answerTokens(stored[keyOf.get(id) ?? '']);
    const visible = fixture.questions.filter((q) => isQuestionVisibleInTree(q, tree, tokensOf));
    const visibleKeys = visible.map((q) => q.key);
    return {
      visible: visibleKeys.sort(),
      owed: visible
        .filter((q) => q.required && !(q.key in stored))
        .map((q) => q.key)
        .sort(),
      purged: Object.keys(stored)
        .filter((key) => !visibleKeys.includes(key))
        .sort(),
    };
  }

  const sorted = (list: readonly string[]) => [...list].sort();

  const keysOf = (ids: Map<string, string>, wanted: string[]) => {
    const byId = new Map([...ids].map(([key, id]) => [id, key]));
    return wanted.map((id) => byId.get(id) ?? `?${id}`).sort();
  };

  const claims = () =>
    JSON.stringify({
      sub: chainMember.userId,
      role: 'authenticated',
      tenant_id: labTenantId,
      tenant_role: 'member',
    });

  const gateCount = async (): Promise<number> => {
    const [row] = await adminSql<{ n: number }[]>`
      select app.profile_form_missing(${labTenantId}::uuid, ${chainMembershipId}::uuid)::int as n`;
    return row?.n ?? -1;
  };

  const storedKeys = async (ids: Map<string, string>): Promise<string[]> => {
    const rows = await adminSql<{ question_id: string }[]>`
      select question_id::text as question_id from public.profile_form_answers
       where membership_id = ${chainMembershipId}::uuid`;
    return keysOf(
      ids,
      rows.map((r) => r.question_id),
    );
  };

  async function loadStored(ids: Map<string, string>, stored: Record<string, unknown>) {
    await adminSql`delete from public.profile_form_answers where membership_id = ${chainMembershipId}::uuid`;
    for (const [key, value] of Object.entries(stored)) {
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: ids.get(key) as string,
        userId: chainMember.userId,
        value,
      });
    }
  }

  for (const row of PROFILE_FORM_CHAIN_CASES) {
    const fixture = row.fixture ?? PROFILE_FORM_CHAIN_FIXTURE;
    const stored = row.stored as Record<string, unknown>;
    it(`chain row (rule, gate, purge): ${row.name}`, async () => {
      // Evaluator 1, the rule, always: it is the only evaluator of a tree the database cannot hold (row 11).
      const rule = ruleOf(fixture, stored);
      expect(rule.visible, 'the rule: visible').toEqual(sorted(row.visible));
      expect(rule.owed, 'the rule: owed').toEqual(sorted(row.owed));
      expect(rule.purged, 'the rule: purged').toEqual(sorted(row.purged));
      // A fourth level is refused by PF008 and can never be stored: the rule is its only evaluator.
      if (fixture === PROFILE_FORM_CHAIN_FIXTURE_BROKEN) return;

      await withProfileForm(labTenantId, async () => {
        const { ids } = await seedFixture(fixture);
        await loadStored(ids, stored);

        // Evaluator 2, the SQL gate: the owed count, and the member's own save report names the same questions.
        expect(await gateCount(), 'the gate: owed count').toBe(row.owed.length);
        const read = await get(chainMember, '/v1/me/profile-form');
        const form = (await read.json()) as { formEtag: string };
        const report = await api.request('/v1/me/profile-form/answers', {
          method: 'PUT',
          headers: {
            'x-tenant-host': HOSTS.lab,
            authorization: `Bearer ${chainMember.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ formEtag: form.formEtag, answers: {} }),
        });
        expect(report.status).toBe(200);
        const body = (await report.json()) as {
          missingRequired: number;
          missingQuestionIds: string[];
        };
        expect(body.missingRequired, 'the report: owed count').toBe(row.owed.length);
        expect(keysOf(ids, body.missingQuestionIds), 'the report: owed keys').toEqual(
          sorted(row.owed),
        );

        // Evaluator 3, the purge (what the member's save runs): exactly the stated keys go, the rest stays.
        const purged = await holder.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${claims()}, true)`;
          await tx.unsafe('set local role authenticated');
          return tx`select question_id::text as question_id from app.profile_form_purge_closed()`;
        });
        expect(
          keysOf(
            ids,
            purged.map((r) => r.question_id),
          ),
          'the purge: deleted keys',
        ).toEqual(sorted(row.purged));
        expect(await storedKeys(ids), 'the purge: what remains').toEqual(
          sorted(Object.keys(stored).filter((key) => !row.purged.includes(key))),
        );
        // A purge never changes what is owed, and a second one finds nothing.
        expect(await gateCount(), 'the gate after the purge').toBe(row.owed.length);
        const again = await holder.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${claims()}, true)`;
          await tx.unsafe('set local role authenticated');
          return tx`select question_id::text as question_id from app.profile_form_purge_closed()`;
        });
        expect(again).toHaveLength(0);
      });
    }, 60_000);
  }

  it('chain row via the real save: a member save that re-sends the opener purges every closed level in the same transaction', async () => {
    await withProfileForm(labTenantId, async () => {
      const { ids, stepOne } = await seedFixture(PROFILE_FORM_CHAIN_FIXTURE);
      for (const row of PROFILE_FORM_CHAIN_CASES) {
        const stored = row.stored as Record<string, unknown>;
        const opener = stored.Q1 as { optionId?: unknown } | undefined;
        if (row.fixture !== undefined || typeof opener?.optionId !== 'string') continue;
        await loadStored(ids, stored);
        const form = (await (await get(chainMember, '/v1/me/profile-form')).json()) as {
          formEtag: string;
        };
        const save = await api.request('/v1/me/profile-form/answers', {
          method: 'PUT',
          headers: {
            'x-tenant-host': HOSTS.lab,
            authorization: `Bearer ${chainMember.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            formEtag: form.formEtag,
            stepId: stepOne,
            answers: { [ids.get('Q1') as string]: stored.Q1 },
          }),
        });
        expect(save.status, row.name).toBe(200);
        const body = (await save.json()) as {
          missingRequired: number;
          missingQuestionIds: string[];
        };
        expect(keysOf(ids, body.missingQuestionIds), `${row.name}: report`).toEqual(
          sorted(row.owed),
        );
        expect(await storedKeys(ids), `${row.name}: remains`).toEqual(
          sorted(Object.keys(stored).filter((key) => !row.purged.includes(key))),
        );
        expect(await gateCount(), `${row.name}: gate`).toBe(row.owed.length);
      }
    });
  }, 90_000);
});
