import { PROFILE_FORM_LIMITS } from '@rede-social/contracts/profile-form';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removeProfileFormByPrefix,
  seedProfileFormAnswer,
  seedProfileFormBranch,
  seedProfileFormQuestion,
  signInAs,
  withProfileForm,
} from './setup';

/**
 * 12.2-08 (PFORM-43, PFORM-44, PFORM-45, PFORM-48, PFORM-49; D-640, D-641, D-642, D-644, D-646, D-651, D-653;
 * T-12.2-01, T-12.2-03, T-12.2-04) against the live local stack: the admin's branches API under
 * `/v1/profile_form/branches`. Create a branch from its opener and read it back, edit it under the optimistic
 * revision and the lock, undo it, archive it and reactivate it as a block, and the limits, the depth, the
 * races and the reads around them.
 *
 * EVERY identity is a THROWAWAY (`createSharedIdentity`, prefix `pfb`); questions carry the title prefix
 * `pfb ` so the sweep removes only this file's rows, and the branches that hang on or hold them (the pair of
 * keys is deferred inside `removeProfileFormByPrefix`). The module row is restored by `withProfileForm`.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
type Branch = {
  id: string;
  openerQuestionId: string;
  values: string[];
  name: string | null;
  revision: number;
  archivedAt: string | null;
  questionCount: number;
  answerCount: number;
};
type ListedQuestion = { id: string; stepId: string; title: string; branchId?: string | null };
type QuestionList = { questions: ListedQuestion[]; activeCount: number; branches?: Branch[] };
type ArchivedList = { questions: (ListedQuestion & { archivedAt: string })[]; branches?: Branch[] };

const PREFIX = 'pfb';
const TITLE = 'pfb ';
let labTenantId = '';
let demoTenantId = '';
let labAdminUserId = '';
let demoAdminUserId = '';

type Person = { userId: string; email: string; password: string; token: string };

async function person(
  role: 'member' | 'admin_tenant' | 'support_tenant' = 'member',
  host: keyof typeof HOSTS = 'lab',
): Promise<Person> {
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host, role, status: 'active' }],
  });
  return { ...identity, token: await signInAs(identity.email, identity.password) };
}

const call = (
  p: Person,
  method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  host: string = HOSTS.lab,
) =>
  api.request(path, {
    method,
    headers: {
      'x-tenant-host': host,
      authorization: `Bearer ${p.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const code = async (res: Response) => ((await res.json()) as Envelope).error.code;
const details = async (res: Response) => ((await res.json()) as Envelope).error.details;

const listOf = async (p: Person, host: string = HOSTS.lab): Promise<QuestionList> => {
  const res = await call(p, 'GET', '/v1/profile_form/questions', undefined, host);
  expect(res.status).toBe(200);
  return (await res.json()) as QuestionList;
};

const archivedOf = async (p: Person): Promise<ArchivedList> => {
  const res = await call(p, 'GET', '/v1/profile_form/archived');
  expect(res.status).toBe(200);
  return (await res.json()) as ArchivedList;
};

const createBranch = (p: Person, body: unknown, host: string = HOSTS.lab) =>
  call(p, 'POST', '/v1/profile_form/branches', body, host);

const branchCreated = async (p: Person, body: unknown): Promise<Branch> => {
  const res = await createBranch(p, body);
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as Branch;
};

/** The number of branches the lab tenant stores, read straight from the database. */
const branchCount = async (): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.profile_form_branches where tenant_id = ${labTenantId}::uuid`;
  return row?.n ?? 0;
};

/** A choice opener (single choice by default) of the lab tenant with ids the test can name. */
async function opener(
  title: string,
  position: number,
  extra: { branchId?: string; type?: string; options?: number; archived?: boolean } = {},
): Promise<{ id: string; optionIds: [string, string, string, ...string[]] }> {
  // At least three options (the default): the first three indexes are always there.
  const optionIds = Array.from({ length: Math.max(extra.options ?? 3, 3) }, () =>
    crypto.randomUUID(),
  ) as [string, string, string, ...string[]];
  const id = await seedProfileFormQuestion({
    tenantId: labTenantId,
    adminUserId: labAdminUserId,
    title: `${TITLE}${title}`,
    type: extra.type ?? 'single_choice',
    options: optionIds.map((optionId, index) => ({ id: optionId, label: `Opção ${index + 1}` })),
    position,
    ...(extra.branchId === undefined ? {} : { branchId: extra.branchId }),
    ...(extra.archived ? { archived: true } : {}),
  });
  return { id, optionIds };
}

async function sweep(): Promise<void> {
  await removeProfileFormByPrefix(TITLE);
  await removeIdentitiesByPrefix(PREFIX);
}

let baseline = 0;

beforeAll(async () => {
  const tenants = await adminSql<{ id: string; slug: string }[]>`
    select id::text as id, slug from public.tenants where slug in ('rede-lab', 'rede-demo')`;
  const lab = tenants.find((t) => t.slug === 'rede-lab');
  const demo = tenants.find((t) => t.slug === 'rede-demo');
  if (!lab || !demo) throw new Error('seed tenants are missing, run pnpm db:seed first');
  labTenantId = lab.id;
  demoTenantId = demo.id;
  await sweep();
  labAdminUserId = (await person('admin_tenant')).userId;
  demoAdminUserId = (await person('admin_tenant', 'demo')).userId;
  baseline = await branchCount();
});

// Each case builds its own form: nothing a case created may count against the next one's limit.
afterEach(async () => {
  await removeProfileFormByPrefix(TITLE);
  expect(await branchCount()).toBe(baseline);
});

afterAll(async () => {
  await sweep();
  // The seed has no `profile_form` row and `withProfileForm` restores that, so none must remain.
  await adminSql`
    delete from public.tenant_modules
     where module_key = 'profile_form' and tenant_id in (${labTenantId}::uuid, ${demoTenantId}::uuid)`;
});

describe('12.2-08 tracer: an admin creates a branch from its opener and reads it back (D-640, D-651, D-644)', () => {
  it('creates an empty branch, the lists carry it with counts 0 and the sweep leaves no row behind', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const before = await branchCount();

      const res = await createBranch(admin, {
        openerQuestionId: q1.id,
        values: [q1.optionIds[0], q1.optionIds[1]],
        name: '  Quem já tem filhos  ',
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const created = (await res.json()) as Branch;
      expect(created).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        openerQuestionId: q1.id,
        values: [q1.optionIds[0], q1.optionIds[1]],
        name: 'Quem já tem filhos',
        revision: 1,
        archivedAt: null,
        questionCount: 0,
        answerCount: 0,
      });
      expect(await branchCount()).toBe(before + 1);

      // The builder list carries the branch, and the opener question carries no branch of its own.
      const list = await listOf(admin);
      expect(list.branches).toEqual([created]);
      expect(list.questions.find((question) => question.id === q1.id)?.branchId).toBeNull();
      // The archived list carries every branch of the tenant too, so the builder can name any of them.
      expect((await archivedOf(admin)).branches).toEqual([created]);

      // The name stays on the admin side: the stored value is the trimmed one.
      const [stored] = await adminSql<{ name: string; revision: number }[]>`
        select name, revision from public.profile_form_branches where id = ${created.id}::uuid`;
      expect(stored).toEqual({ name: 'Quem já tem filhos', revision: 1 });
    });
  });

  it('a member and a support user get 403, a module-off tenant 404 MODULE_DISABLED, and nothing is written', async () => {
    const member = await person('member');
    const support = await person('support_tenant');
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const before = await branchCount();
      const body = { openerQuestionId: q1.id, values: [q1.optionIds[0]] };
      for (const who of [member, support]) {
        const res = await createBranch(who, body);
        expect(res.status).toBe(403);
        expect(await branchCount()).toBe(before);
      }
      await withProfileForm(
        labTenantId,
        async () => {
          const res = await createBranch(admin, body);
          expect(res.status).toBe(404);
          expect(await code(res)).toBe('MODULE_DISABLED');
          expect(await branchCount()).toBe(before);
        },
        { enabled: false },
      );
    });
  });

  it('refuses a text opener, a foreign opener, a value that is not a token and an empty list, each writing nothing', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const text = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId: labAdminUserId,
        title: `${TITLE}Q2 texto`,
        type: 'short_text',
        position: 2,
      });
      const foreign = await seedProfileFormQuestion({
        tenantId: demoTenantId,
        adminUserId: demoAdminUserId,
        title: `${TITLE}Q3 de outro tenant`,
        type: 'single_choice',
        position: 1,
      });
      const [foreignRow] = await adminSql<{ options: { id: string }[] }[]>`
        select options from public.profile_form_questions where id = ${foreign}::uuid`;
      const before = await branchCount();

      const refusals: [string, unknown, number, string][] = [
        ['a text opener', { openerQuestionId: text, values: ['x'] }, 409, 'condition_invalid'],
        [
          'another tenant’s opener',
          { openerQuestionId: foreign, values: [foreignRow?.options[0]?.id ?? 'x'] },
          409,
          'condition_invalid',
        ],
        [
          'a missing opener',
          { openerQuestionId: crypto.randomUUID(), values: [q1.optionIds[0]] },
          409,
          'condition_invalid',
        ],
        [
          'a value that is not a token of the opener',
          { openerQuestionId: q1.id, values: [crypto.randomUUID()] },
          409,
          'condition_invalid',
        ],
        ['an empty values list', { openerQuestionId: q1.id, values: [] }, 400, 'condition_invalid'],
        [
          'a repeated value',
          { openerQuestionId: q1.id, values: [q1.optionIds[0], q1.optionIds[0]] },
          400,
          'condition_invalid',
        ],
      ];
      for (const [label, body, status, issue] of refusals) {
        const res = await createBranch(admin, body);
        expect(res.status, label).toBe(status);
        expect((await details(res))?.profileForm, label).toBe(issue);
        expect(await branchCount(), label).toBe(before);
      }
    });
  });
});

describe('12.2-08 create: names, adjacency and the limits (PFORM-43, PFORM-49)', () => {
  it('stores the name trimmed in code points, accepts 60 and refuses 61, a control character and keeps accents and emoji', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const body = (name: unknown) => ({
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
        name,
      });

      expect((await branchCreated(admin, body('a'.repeat(60)))).name).toBe('a'.repeat(60));
      const long = await createBranch(admin, body('a'.repeat(61)));
      expect(long.status).toBe(400);
      expect((await details(long))?.profileForm).toBe('too_long');

      // 60 EMOJI are 60 code points (and 120 UTF-16 units): accepted; 61 are refused.
      const emoji60 = '😀'.repeat(60);
      expect((await branchCreated(admin, body(emoji60))).name).toBe(emoji60);
      const emoji61 = await createBranch(admin, body('😀'.repeat(61)));
      expect(emoji61.status).toBe(400);

      // The contracts' `hasUnsafeChars` is the one definition for every text of the form: a NUL (which no
      // Postgres text can hold) and an unpaired surrogate are `invalid`.
      for (const unsafe of ['com\u0000nulo', 'solto\uD83D']) {
        const refused = await createBranch(admin, body(unsafe));
        expect(refused.status).toBe(400);
        expect((await details(refused))?.profileForm).toBe('invalid');
      }

      const accents = await branchCreated(admin, body('  Ação: ñandú 🎉 café  '));
      expect(accents.name).toBe('Ação: ñandú 🎉 café');
      // A blank name is no name.
      expect((await branchCreated(admin, body('   '))).name).toBeNull();
      expect((await listOf(admin)).branches?.find((b) => b.id === accents.id)?.name).toBe(
        'Ação: ñandú 🎉 café',
      );
    });
  });

  it('two branches on one opener with overlapping values come back as two rows in creation order', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const lone = await opener('Q2 sozinho', 2);
      const first = await branchCreated(admin, {
        openerQuestionId: q1.id,
        values: [q1.optionIds[0], q1.optionIds[1]],
      });
      const second = await branchCreated(admin, {
        openerQuestionId: q1.id,
        values: [q1.optionIds[1], q1.optionIds[2]],
      });
      const single = await branchCreated(admin, {
        openerQuestionId: lone.id,
        values: [lone.optionIds[0]],
      });
      expect((await listOf(admin)).branches?.map((branch) => branch.id)).toEqual([
        first.id,
        second.id,
        single.id,
      ]);
    });
  });

  it('accepts 20 opening values and refuses 21; the 15th active branch is accepted and the 16th is branch_limit', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const wide = await opener('Q1 vinte opções', 1, { options: PROFILE_FORM_LIMITS.options });
      const twenty = await branchCreated(admin, {
        openerQuestionId: wide.id,
        values: wide.optionIds,
      });
      expect(twenty.values).toHaveLength(20);
      const tooMany = await createBranch(admin, {
        openerQuestionId: wide.id,
        values: [...wide.optionIds, crypto.randomUUID()],
      });
      expect(tooMany.status).toBe(400);
      expect((await details(tooMany))?.profileForm).toBe('condition_invalid');

      // 14 more, straight through SQL, make 15 active; the API then refuses the 16th.
      for (let n = 1; n < PROFILE_FORM_LIMITS.branches - 1; n += 1) {
        await seedProfileFormBranch({
          tenantId: labTenantId,
          openerQuestionId: wide.id,
          values: [wide.optionIds[n % 20] ?? ''],
        });
      }
      const fifteenth = await branchCreated(admin, {
        openerQuestionId: wide.id,
        values: [wide.optionIds[0]],
      });
      expect(fifteenth.revision).toBe(1);
      expect((await listOf(admin)).branches?.filter((b) => b.archivedAt === null)).toHaveLength(15);
      const sixteenth = await createBranch(admin, {
        openerQuestionId: wide.id,
        values: [wide.optionIds[1]],
      });
      expect(sixteenth.status).toBe(409);
      expect((await details(sixteenth))?.profileForm).toBe('branch_limit');
    });
  });

  it('accepts the third level and refuses the fourth with branch_depth', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 raiz', 1);
      const b1 = await branchCreated(admin, { openerQuestionId: q1.id, values: [q1.optionIds[0]] });
      const q2 = await opener('Q2 nível 1', 2, { branchId: b1.id });
      const b2 = await branchCreated(admin, { openerQuestionId: q2.id, values: [q2.optionIds[0]] });
      const q3 = await opener('Q3 nível 2', 3, { branchId: b2.id });
      const b3 = await branchCreated(admin, { openerQuestionId: q3.id, values: [q3.optionIds[0]] });
      expect(b3.questionCount).toBe(0);
      const q4 = await opener('Q4 nível 3', 4, { branchId: b3.id });
      const before = await branchCount();
      const fourth = await createBranch(admin, {
        openerQuestionId: q4.id,
        values: [q4.optionIds[0]],
      });
      expect(fourth.status).toBe(409);
      expect((await details(fourth))?.profileForm).toBe('branch_depth');
      expect(await branchCount()).toBe(before);
    });
  });
});

// ── Task 2: edit, undo, archive and reactivate (D-646, D-653, D-644) ──────────────────────────────────────────

const patchBranch = (p: Person, id: string, body: unknown, host: string = HOSTS.lab) =>
  call(p, 'PATCH', `/v1/profile_form/branches/${id}`, body, host);
const postBranchAction = (
  p: Person,
  id: string,
  action: 'undo' | 'archive' | 'reactivate',
  host: string = HOSTS.lab,
) => call(p, 'POST', `/v1/profile_form/branches/${id}/${action}`, undefined, host);

/** Every branch and every question of this file, as one comparable string (a refused write must not change it). */
const snapshot = async (): Promise<string> => {
  const questions = await adminSql`
    select id::text as id, title, "position", revision, step_id::text as step_id, branch_id::text as branch_id,
           archived_at, listed_at, updated_at
      from public.profile_form_questions
     where tenant_id = ${labTenantId}::uuid and title like ${`${TITLE}%`}
     order by title, id`;
  const branches = await adminSql`
    select id::text as id, opener_question_id::text as opener_question_id, open_values, name, revision,
           archived_at, updated_at
      from public.profile_form_branches
     where tenant_id = ${labTenantId}::uuid
       and opener_question_id in (select id from public.profile_form_questions
                                   where tenant_id = ${labTenantId}::uuid and title like ${`${TITLE}%`})
     order by id`;
  return JSON.stringify({ questions, branches });
};

const questionRow = async (id: string) => {
  const [row] = await adminSql<
    {
      branch_id: string | null;
      revision: number;
      archived_at: Date | null;
      listed_at: Date;
      position: number;
    }[]
  >`
    select branch_id::text as branch_id, revision, archived_at, listed_at, "position" as position
      from public.profile_form_questions where id = ${id}::uuid`;
  if (!row) throw new Error('question row is missing');
  return row;
};

const branchRow = async (id: string) => {
  const [row] = await adminSql<
    { revision: number; archived_at: Date | null; open_values: string[]; name: string | null }[]
  >`
    select revision, archived_at, open_values, name
      from public.profile_form_branches where id = ${id}::uuid`;
  return row ?? null;
};

const answerCount = async (questionIds: string[]): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.profile_form_answers
     where question_id in ${adminSql(questionIds)}`;
  return row?.n ?? 0;
};

const activeTitles = async (): Promise<{ title: string; position: number }[]> =>
  adminSql<{ title: string; position: number }[]>`
    select replace(title, ${TITLE}, '') as title, "position" as position
      from public.profile_form_questions
     where tenant_id = ${labTenantId}::uuid and title like ${`${TITLE}%`} and archived_at is null
     order by "position", created_at, id`;

describe('12.2-08 edit under the revision and the lock (D-646, PFORM-48)', () => {
  it('renames, clears the name, bumps the revision, and a stale revision writes nothing', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const branch = await branchCreated(admin, {
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
        name: 'Primeiro nome',
      });

      const renamed = await patchBranch(admin, branch.id, { revision: 1, name: '  Novo nome  ' });
      expect(renamed.status, await renamed.clone().text()).toBe(200);
      expect(await renamed.json()).toMatchObject({ id: branch.id, name: 'Novo nome', revision: 2 });
      const [updatedAt] = await adminSql<{ later: boolean }[]>`
        select updated_at > created_at as later from public.profile_form_branches where id = ${branch.id}::uuid`;
      expect(updatedAt?.later).toBe(true);

      const before = await snapshot();
      const stale = await patchBranch(admin, branch.id, { revision: 1, name: 'Velho' });
      expect(stale.status).toBe(409);
      expect((await details(stale))?.profileForm).toBe('stale_revision');
      expect(await snapshot()).toBe(before);

      const cleared = await patchBranch(admin, branch.id, { revision: 2, name: null });
      expect(cleared.status).toBe(200);
      expect(await cleared.json()).toMatchObject({ name: null, revision: 3 });
    });
  });

  it('changes the opening values of an unanswered branch, and the same members in another order are no change', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const q2 = await opener('Q2 outro abridor', 2);
      const branch = await branchCreated(admin, {
        openerQuestionId: q1.id,
        values: [q1.optionIds[0], q1.optionIds[1]],
      });

      const reordered = await patchBranch(admin, branch.id, {
        revision: 1,
        values: [q1.optionIds[1], q1.optionIds[0]],
      });
      expect(reordered.status).toBe(200);
      expect(await reordered.json()).toMatchObject({
        revision: 1,
        values: [q1.optionIds[0], q1.optionIds[1]],
      });

      const widened = await patchBranch(admin, branch.id, {
        revision: 1,
        values: [q1.optionIds[2]],
      });
      expect(widened.status).toBe(200);
      expect(await widened.json()).toMatchObject({ revision: 2, values: [q1.optionIds[2]] });

      const moved = await patchBranch(admin, branch.id, {
        revision: 2,
        openerQuestionId: q2.id,
        values: [q2.optionIds[0]],
      });
      expect(moved.status).toBe(200);
      expect(await moved.json()).toMatchObject({ revision: 3, openerQuestionId: q2.id });
    });
  });

  it('locks the opener and the opening set once a question of the branch has an answer, active or archived, and a rename always passes', async () => {
    const admin = await person('admin_tenant');
    const member = await person('member');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const q9 = await opener('Q9 outro abridor', 9);
      for (const archived of [false, true]) {
        const branch = await seedProfileFormBranch({
          tenantId: labTenantId,
          openerQuestionId: q1.id,
          values: [q1.optionIds[0]],
        });
        const inside = await opener(`Q2 respondida ${archived ? 'arquivada' : 'ativa'}`, 2, {
          branchId: branch,
          archived,
        });
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: inside.id,
          userId: member.userId,
          value: { optionId: inside.optionIds[0] },
        });
        const before = await snapshot();

        for (const body of [
          { revision: 1, openerQuestionId: q9.id, values: [q9.optionIds[0]] },
          { revision: 1, values: [q1.optionIds[1]] },
          { revision: 1, values: [q1.optionIds[0], q1.optionIds[1]] },
        ]) {
          const res = await patchBranch(admin, branch, body);
          expect(res.status, `archived=${archived}`).toBe(409);
          expect((await details(res))?.profileForm).toBe('condition_locked');
        }
        expect(await snapshot()).toBe(before);

        // The same set in another order, and a rename, pass at any answer count.
        const same = await patchBranch(admin, branch, { revision: 1, values: [q1.optionIds[0]] });
        expect(same.status).toBe(200);
        const renamed = await patchBranch(admin, branch, { revision: 1, name: 'Só o nome' });
        expect(renamed.status).toBe(200);
        expect(await renamed.json()).toMatchObject({ name: 'Só o nome', revision: 2 });
        await removeProfileFormByPrefix(`${TITLE}Q2 respondida`);
      }
    });
  });

  it('refuses a new opener that cannot open, sits inside the branch, comes after a member or would be a fourth level', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const text = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId: labAdminUserId,
        title: `${TITLE}Q2 texto`,
        type: 'short_text',
        position: 2,
      });
      const branch = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
      });
      const member = await opener('Q3 membro', 3, { branchId: branch });
      const late = await opener('Q4 depois do membro', 4);

      const refusals: [string, unknown, string][] = [
        [
          'a text opener',
          { revision: 1, openerQuestionId: text, values: ['x'] },
          'condition_invalid',
        ],
        [
          'a member of the branch itself',
          { revision: 1, openerQuestionId: member.id, values: [member.optionIds[0]] },
          'condition_invalid',
        ],
        [
          'an opener after a member',
          { revision: 1, openerQuestionId: late.id, values: [late.optionIds[0]] },
          'condition_order',
        ],
        [
          'a value that is not a token of the new opener',
          { revision: 1, openerQuestionId: late.id, values: [q1.optionIds[0]] },
          'condition_invalid',
        ],
      ];
      for (const [label, body, issue] of refusals) {
        const before = await snapshot();
        const res = await patchBranch(admin, branch, body);
        expect(res.status, label).toBe(409);
        const found = await details(res);
        expect(found?.profileForm, label).toBe(issue);
        if (issue === 'condition_order') {
          expect(found).toMatchObject({ openerId: late.id, questionId: member.id });
        }
        expect(await snapshot(), label).toBe(before);
      }
    });
  });

  it('refuses an edit that would make a chain deeper than three levels with branch_depth', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 raiz', 1);
      const b1 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
      });
      const q2 = await opener('Q2 nível 1', 2, { branchId: b1 });
      const b2 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q2.id,
        values: [q2.optionIds[0]],
      });
      const q3 = await opener('Q3 nível 2', 3, { branchId: b2 });
      // A separate tree of height two: X on Qa holds Qx, and Y hangs on Qx.
      const qa = await opener('Q4 outra raiz', 4);
      const x = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: qa.id,
        values: [qa.optionIds[0]],
      });
      const qx = await opener('Q5 dentro de X', 5, { branchId: x });
      const y = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: qx.id,
        values: [qx.optionIds[0]],
      });
      await opener('Q6 dentro de Y', 6, { branchId: y });
      const before = await snapshot();

      const res = await patchBranch(admin, x, {
        revision: 1,
        openerQuestionId: q3.id,
        values: [q3.optionIds[0]],
      });
      expect(res.status).toBe(409);
      expect((await details(res))?.profileForm).toBe('branch_depth');
      expect(await snapshot()).toBe(before);
    });
  });

  it('refuses an archived branch, a missing field and answers a foreign or unknown id with the bare 404', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const archivedBranch = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
        archived: true,
      });
      const foreignQuestion = await seedProfileFormQuestion({
        tenantId: demoTenantId,
        adminUserId: demoAdminUserId,
        title: `${TITLE}Q9 de outro tenant`,
        type: 'single_choice',
        position: 1,
      });
      const foreignBranch = await seedProfileFormBranch({
        tenantId: demoTenantId,
        openerQuestionId: foreignQuestion,
        values: ['x'],
      });
      const before = await snapshot();

      const archived = await patchBranch(admin, archivedBranch, { revision: 1, name: 'x' });
      expect(archived.status).toBe(409);
      expect((await details(archived))?.profileForm).toBe('already_archived');

      const noRevision = await patchBranch(admin, archivedBranch, { name: 'x' });
      expect(noRevision.status).toBe(400);

      for (const id of [crypto.randomUUID(), foreignBranch]) {
        const res = await patchBranch(admin, id, { revision: 1, name: 'x' });
        expect(res.status).toBe(404);
        const body = (await res.json()) as Envelope;
        expect(body.error.code).toBe('NOT_FOUND');
        expect(body.error.details).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain(foreignBranch);
      }
      expect(await snapshot()).toBe(before);
      expect((await branchRow(foreignBranch))?.revision).toBe(1);
    });
  });

  it('lets exactly one of two edits holding the same revision win', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const branch = await branchCreated(admin, {
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
      });
      const results = await Promise.all([
        patchBranch(admin, branch.id, { revision: 1, name: 'Um' }),
        patchBranch(admin, branch.id, { revision: 1, name: 'Dois' }),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      const loser = results.find((res) => res.status === 409);
      expect((await details(loser as Response))?.profileForm).toBe('stale_revision');
      expect((await branchRow(branch.id))?.revision).toBe(2);
    });
  });

  it('lets exactly one of two creates at 14 active branches succeed and answers the other branch_limit', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const wide = await opener('Q1 vinte opções', 1, { options: PROFILE_FORM_LIMITS.options });
      for (let n = 0; n < PROFILE_FORM_LIMITS.branches - 1; n += 1) {
        await seedProfileFormBranch({
          tenantId: labTenantId,
          openerQuestionId: wide.id,
          values: [wide.optionIds[n] ?? ''],
        });
      }
      const body = { openerQuestionId: wide.id, values: [wide.optionIds[19]] };
      const results = await Promise.all([createBranch(admin, body), createBranch(admin, body)]);
      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      const loser = results.find((res) => res.status === 409);
      expect((await details(loser as Response))?.profileForm).toBe('branch_limit');
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.profile_form_branches
         where opener_question_id = ${wide.id}::uuid and archived_at is null`;
      expect(row?.n).toBe(PROFILE_FORM_LIMITS.branches);
    });
  });
});

describe('12.2-08 undo: the questions stay and become visible to everyone (D-653)', () => {
  it('re-points every question of the branch, active and archived, to none in the same transaction that deletes the branch, keeping the answers and the nested branch', async () => {
    const admin = await person('admin_tenant');
    const member = await person('member');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const branch = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
        name: 'Para desfazer',
      });
      const q2 = await opener('Q2 ativa', 2, { branchId: branch });
      const q3 = await opener('Q3 ativa', 3, { branchId: branch });
      const q4 = await opener('Q4 arquivada', 4, { branchId: branch, archived: true });
      // A nested branch on q2 holds q5: it keeps working and now hangs on an unconditional opener.
      const nested = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q2.id,
        values: [q2.optionIds[0]],
      });
      const q5 = await opener('Q5 aninhada', 5, { branchId: nested });
      for (const question of [q2, q4, q5]) {
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: question.id,
          userId: member.userId,
          value: { optionId: question.optionIds[0] },
        });
      }
      const ids = [q2.id, q3.id, q4.id, q5.id];
      const answersBefore = await answerCount(ids);
      const revisionsBefore = await Promise.all(
        [q2, q3, q4].map(async (question) => (await questionRow(question.id)).revision),
      );

      const res = await postBranchAction(admin, branch, 'undo');
      expect(res.status, await res.clone().text()).toBe(200);
      expect(await res.json()).toEqual({ undone: true });

      expect(await branchRow(branch)).toBeNull();
      for (const question of [q2, q3, q4]) {
        expect((await questionRow(question.id)).branch_id).toBeNull();
      }
      // The active questions' revision moves (the member etag covers it); the archived one is not shown.
      const revisionsAfter = await Promise.all(
        [q2, q3, q4].map(async (question) => (await questionRow(question.id)).revision),
      );
      expect(revisionsAfter[0]).toBe((revisionsBefore[0] ?? 0) + 1);
      expect(revisionsAfter[1]).toBe((revisionsBefore[1] ?? 0) + 1);
      // The nested branch and its question are untouched, and no answer is lost.
      expect((await questionRow(q5.id)).branch_id).toBe(nested);
      expect(await branchRow(nested)).not.toBeNull();
      expect(await answerCount(ids)).toBe(answersBefore);

      // A second undo finds nothing.
      const again = await postBranchAction(admin, branch, 'undo');
      expect(again.status).toBe(404);
      const list = await listOf(admin);
      expect(list.branches?.map((b) => b.id)).toEqual([nested]);
    });
  });

  it('undoing an empty branch just removes it, and a foreign or unknown id is the bare 404', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const empty = await branchCreated(admin, {
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
      });
      const foreignQuestion = await seedProfileFormQuestion({
        tenantId: demoTenantId,
        adminUserId: demoAdminUserId,
        title: `${TITLE}Q9 de outro tenant`,
        type: 'single_choice',
        position: 1,
      });
      const foreignBranch = await seedProfileFormBranch({
        tenantId: demoTenantId,
        openerQuestionId: foreignQuestion,
        values: ['x'],
      });

      for (const id of [crypto.randomUUID(), foreignBranch]) {
        for (const action of ['undo', 'archive', 'reactivate'] as const) {
          const res = await postBranchAction(admin, id, action);
          expect(res.status, action).toBe(404);
          const body = (await res.json()) as Envelope;
          expect(body.error.code, action).toBe('NOT_FOUND');
          expect(body.error.details, action).toBeUndefined();
        }
      }
      expect(await branchRow(foreignBranch)).not.toBeNull();

      const res = await postBranchAction(admin, empty.id, 'undo');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ undone: true });
      expect(await branchRow(empty.id)).toBeNull();
    });
  });
});

/** The clinic-like fixture of the archive and reactivate cases: Q1 | B1 {Q2 | B2 {Q4}, Q3} | Q5. */
async function block(extra: { answerOn?: 'q3' | 'q4'; userId?: string } = {}) {
  const q1 = await opener('Q1 raiz', 1);
  const b1 = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: q1.id,
    values: [q1.optionIds[0]],
  });
  const q2 = await opener('Q2 no ramo', 2, { branchId: b1 });
  const q3 = await opener('Q3 no ramo', 3, { branchId: b1 });
  const b2 = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: q2.id,
    values: [q2.optionIds[0]],
  });
  const q4 = await opener('Q4 aninhada', 4, { branchId: b2 });
  const q5 = await opener('Q5 final', 5);
  if (extra.answerOn !== undefined && extra.userId !== undefined) {
    const target = extra.answerOn === 'q3' ? q3 : q4;
    await seedProfileFormAnswer({
      tenantId: labTenantId,
      questionId: target.id,
      userId: extra.userId,
      value: { optionId: target.optionIds[0] },
    });
  }
  return { q1, q2, q3, q4, q5, b1, b2 };
}

describe('12.2-08 archive and reactivate as a block (D-653, PFORM-48)', () => {
  it('archives the branch, the branch below and every question with ONE timestamp, renumbers the rest 1..n and keeps the answers', async () => {
    const admin = await person('admin_tenant');
    const member = await person('member');
    await withProfileForm(labTenantId, async () => {
      const f = await block({ answerOn: 'q3', userId: member.userId });
      // A question archived alone earlier, inside the branch: it keeps its own stamp.
      const solo = await opener('Q6 arquivada antes', 6, { branchId: f.b1, archived: true });
      const soloBefore = (await questionRow(solo.id)).archived_at;
      const answersBefore = await answerCount([f.q3.id]);

      const res = await postBranchAction(admin, f.b1, 'archive');
      expect(res.status, await res.clone().text()).toBe(200);
      const archived = (await res.json()) as Branch;
      expect(archived.id).toBe(f.b1);
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.revision).toBeGreaterThan(1);

      // ONE timestamp over the whole block: branches and questions alike.
      const [stamps] = await adminSql<{ n: number }[]>`
        select count(distinct archived_at)::int as n from (
          select archived_at from public.profile_form_branches
           where id in (${f.b1}::uuid, ${f.b2}::uuid) and archived_at is not null
          union all
          select archived_at from public.profile_form_questions
           where id in (${f.q2.id}::uuid, ${f.q3.id}::uuid, ${f.q4.id}::uuid) and archived_at is not null
        ) t`;
      expect(stamps?.n).toBe(1);
      const [total] = await adminSql<{ n: number }[]>`
        select (select count(*)::int from public.profile_form_branches
                 where id in (${f.b1}::uuid, ${f.b2}::uuid) and archived_at is not null)
             + (select count(*)::int from public.profile_form_questions
                 where id in (${f.q2.id}::uuid, ${f.q3.id}::uuid, ${f.q4.id}::uuid)
                   and archived_at is not null) as n`;
      expect(total?.n).toBe(5);
      expect((await questionRow(solo.id)).archived_at).toEqual(soloBefore);

      // The remaining active questions are exactly 1..n, no gap and no repeat.
      const remaining = await activeTitles();
      expect(remaining).toEqual([
        { title: 'Q1 raiz', position: 1 },
        { title: 'Q5 final', position: 2 },
      ]);
      expect(await answerCount([f.q3.id])).toBe(answersBefore);

      // The archived read carries the archived branch with ALL its questions counted: Q2, Q3 and the one archived alone.
      const read = await archivedOf(admin);
      const readBranch = read.branches?.find((branch) => branch.id === f.b1);
      expect(readBranch).toMatchObject({ archivedAt: archived.archivedAt, questionCount: 3 });

      // A second archive is idempotent: same answer, the stamp does not move.
      const again = await postBranchAction(admin, f.b1, 'archive');
      expect(again.status).toBe(200);
      expect(((await again.json()) as Branch).archivedAt).toBe(archived.archivedAt);
    });
  });

  it('refuses with has_dependents naming the openers when a nested branch holds an answered question, and changes nothing', async () => {
    const admin = await person('admin_tenant');
    const member = await person('member');
    await withProfileForm(labTenantId, async () => {
      const f = await block({ answerOn: 'q4', userId: member.userId });
      const before = await snapshot();

      const res = await postBranchAction(admin, f.b1, 'archive');
      expect(res.status).toBe(409);
      const found = await details(res);
      expect(found?.profileForm).toBe('has_dependents');
      expect(found?.dependents).toEqual([{ id: f.q2.id, title: `${TITLE}Q2 no ramo` }]);
      expect(await snapshot()).toBe(before);
    });
  });

  it('archives an empty branch alone and reactivating it needs no question slot', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const q1 = await opener('Q1 abridor', 1);
      const empty = await branchCreated(admin, {
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
      });
      const archived = await postBranchAction(admin, empty.id, 'archive');
      expect(archived.status).toBe(200);
      expect(((await archived.json()) as Branch).archivedAt).not.toBeNull();
      expect((await listOf(admin)).activeCount).toBe(1);

      // Fill the form to 30 active questions: the empty branch still comes back.
      for (let n = 2; n <= PROFILE_FORM_LIMITS.activeQuestions; n += 1) {
        await opener(`Q${n} cheia`, n);
      }
      const back = await postBranchAction(admin, empty.id, 'reactivate');
      expect(back.status, await back.clone().text()).toBe(200);
      expect(((await back.json()) as Branch).archivedAt).toBeNull();
    });
  });

  it('reactivates the block, leaves a question archived alone archived and puts the restored questions back in tree order', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const f = await block();
      const solo = await opener('Q6 arquivada antes', 6, { branchId: f.b1, archived: true });
      const listedBefore = (await questionRow(f.q2.id)).listed_at;
      const archived = await postBranchAction(admin, f.b1, 'archive');
      expect(archived.status).toBe(200);

      const res = await postBranchAction(admin, f.b1, 'reactivate');
      expect(res.status, await res.clone().text()).toBe(200);
      expect(((await res.json()) as Branch).archivedAt).toBeNull();

      for (const id of [f.q2.id, f.q3.id, f.q4.id]) {
        const row = await questionRow(id);
        expect(row.archived_at).toBeNull();
        expect(row.listed_at.getTime()).toBeGreaterThan(listedBefore.getTime());
      }
      expect((await branchRow(f.b1))?.archived_at).toBeNull();
      expect((await branchRow(f.b2))?.archived_at).toBeNull();
      // The question archived alone earlier stays archived.
      expect((await questionRow(solo.id)).archived_at).not.toBeNull();

      // Tree order, positions 1..n: the opener, its branch with the nested block right after Q2, the rest.
      expect(await activeTitles()).toEqual([
        { title: 'Q1 raiz', position: 1 },
        { title: 'Q2 no ramo', position: 2 },
        { title: 'Q4 aninhada', position: 3 },
        { title: 'Q3 no ramo', position: 4 },
        { title: 'Q5 final', position: 5 },
      ]);

      // A second reactivate is idempotent.
      const again = await postBranchAction(admin, f.b1, 'reactivate');
      expect(again.status).toBe(200);
    });
  });

  it('refuses to reactivate while the opener is archived (condition_invalid + openerId), past 30 active questions and past 15 active branches', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const f = await block();
      expect((await postBranchAction(admin, f.b1, 'archive')).status).toBe(200);

      // The opener is archived: the ONE thing to reactivate first is named.
      const archiveOpener = await call(
        admin,
        'POST',
        `/v1/profile_form/questions/${f.q1.id}/archive`,
      );
      expect(archiveOpener.status, await archiveOpener.clone().text()).toBe(200);
      let before = await snapshot();
      const blocked = await postBranchAction(admin, f.b1, 'reactivate');
      expect(blocked.status).toBe(409);
      expect(await details(blocked)).toMatchObject({
        profileForm: 'condition_invalid',
        openerId: f.q1.id,
      });
      expect(await snapshot()).toBe(before);
      expect(
        (await call(admin, 'POST', `/v1/profile_form/questions/${f.q1.id}/reactivate`)).status,
      ).toBe(200);

      // 27 more active questions make 29 (Q1, Q5 and them); the block would add three.
      for (let n = 10; n < 37; n += 1) await opener(`Q${n} cheia`, n);
      before = await snapshot();
      const full = await postBranchAction(admin, f.b1, 'reactivate');
      expect(full.status).toBe(409);
      expect((await details(full))?.profileForm).toBe('limit_reached');
      expect(await snapshot()).toBe(before);
    });
  });

  it('refuses to reactivate past 15 active branches with branch_limit', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const wide = await opener('Q1 vinte opções', 1, { options: PROFILE_FORM_LIMITS.options });
      const sleeping = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: wide.id,
        values: [wide.optionIds[19] ?? ''],
        archived: true,
      });
      for (let n = 0; n < PROFILE_FORM_LIMITS.branches; n += 1) {
        await seedProfileFormBranch({
          tenantId: labTenantId,
          openerQuestionId: wide.id,
          values: [wide.optionIds[n] ?? ''],
        });
      }
      const before = await snapshot();
      const res = await postBranchAction(admin, sleeping, 'reactivate');
      expect(res.status).toBe(409);
      expect((await details(res))?.profileForm).toBe('branch_limit');
      expect(await snapshot()).toBe(before);
    });
  });
});
