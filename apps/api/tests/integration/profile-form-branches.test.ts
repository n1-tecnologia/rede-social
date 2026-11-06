import { PROFILE_FORM_LIMITS } from '@rede-social/contracts/profile-form';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removeProfileFormByPrefix,
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
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
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
  extra: { branchId?: string; type?: string; options?: number } = {},
): Promise<{ id: string; optionIds: string[] }> {
  const optionIds = Array.from({ length: extra.options ?? 3 }, () => crypto.randomUUID());
  const id = await seedProfileFormQuestion({
    tenantId: labTenantId,
    adminUserId: labAdminUserId,
    title: `${TITLE}${title}`,
    type: extra.type ?? 'single_choice',
    options: optionIds.map((optionId, index) => ({ id: optionId, label: `Opção ${index + 1}` })),
    position,
    ...(extra.branchId === undefined ? {} : { branchId: extra.branchId }),
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
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
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
