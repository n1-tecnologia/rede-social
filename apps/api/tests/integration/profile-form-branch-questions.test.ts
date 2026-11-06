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
  seedProfileFormStep,
  signInAs,
  withProfileForm,
} from './setup';

/**
 * 12.2-09 (PFORM-44, PFORM-48, PFORM-50, PFORM-53; D-640, D-641, D-643, D-646, D-651, D-652; T-12.2-01,
 * T-12.2-02, T-12.2-04, T-12.2-08) against the live local stack: the admin's QUESTION writes on the branch tree.
 * A question is created INTO a branch and lands at the end of the branch's run in tree order, moves between
 * branches and steps, reorders, archives, reactivates, is replaced and deleted, with the opener refusals over
 * branches and the privacy rule of WR-06, and the retired per-question `condition` is refused in every body.
 *
 * EVERY identity is a THROWAWAY (`createSharedIdentity`, prefix `pfq`); questions carry the title prefix `pfq `
 * so the sweep removes only this file's rows, and the branches that hang on or hold them (the pair of keys is
 * deferred inside `removeProfileFormByPrefix`). The module row is restored by `withProfileForm`.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
type ListedQuestion = {
  id: string;
  stepId: string;
  title: string;
  branchId?: string | null;
  position: number;
  revision: number;
};
type QuestionList = { questions: ListedQuestion[]; activeCount: number };

const PREFIX = 'pfq';
const TITLE = 'pfq ';
let labTenantId = '';
let labAdminUserId = '';

type Person = { userId: string; email: string; password: string; token: string };

async function person(role: 'member' | 'admin_tenant' = 'admin_tenant'): Promise<Person> {
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role, status: 'active' }],
  });
  return { ...identity, token: await signInAs(identity.email, identity.password) };
}

const call = (
  p: Person,
  method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
) =>
  api.request(path, {
    method,
    headers: {
      'x-tenant-host': HOSTS.lab,
      authorization: `Bearer ${p.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const details = async (res: Response) => ((await res.json()) as Envelope).error.details;

const listOf = async (p: Person): Promise<QuestionList> => {
  const res = await call(p, 'GET', '/v1/profile_form/questions');
  expect(res.status).toBe(200);
  return (await res.json()) as QuestionList;
};

/** The ids of the list in the order the admin (and the members) read them. */
const orderOf = async (p: Person): Promise<string[]> =>
  (await listOf(p)).questions.map((question) => question.id);

/** The stored active positions, straight from the database: they must be exactly 1..n. */
const positions = async (): Promise<number[]> => {
  const rows = await adminSql<{ position: number }[]>`
    select position from public.profile_form_questions
     where tenant_id = ${labTenantId}::uuid and archived_at is null and title like ${`${TITLE}%`}
     order by position`;
  return rows.map((row) => row.position);
};

/** A snapshot of every question row of this file, to prove a refusal wrote nothing. */
const snapshot = async (): Promise<string> => {
  const rows = await adminSql`
    select id, step_id, branch_id, position, revision, archived_at, title, show_on_profile
      from public.profile_form_questions
     where tenant_id = ${labTenantId}::uuid and title like ${`${TITLE}%`}
     order by id`;
  return JSON.stringify(rows);
};

const create = (p: Person, body: Record<string, unknown>) =>
  call(p, 'POST', '/v1/profile_form/questions', {
    type: 'short_text',
    title: `${TITLE}nova`,
    ...body,
  });

type Seeded = { id: string; optionIds: [string, string, string] };

/** A choice question of the lab tenant with option ids the test can name. */
async function choice(
  title: string,
  position: number,
  extra: {
    branchId?: string;
    stepId?: string;
    type?: string;
    showOnProfile?: boolean;
    archived?: boolean;
    archivedAt?: Date;
  } = {},
): Promise<Seeded> {
  const optionIds: [string, string, string] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  const id = await seedProfileFormQuestion({
    tenantId: labTenantId,
    adminUserId: labAdminUserId,
    title: `${TITLE}${title}`,
    type: extra.type ?? 'single_choice',
    options: optionIds.map((optionId, index) => ({ id: optionId, label: `Opção ${index + 1}` })),
    position,
    ...(extra.branchId === undefined ? {} : { branchId: extra.branchId }),
    ...(extra.stepId === undefined ? {} : { stepId: extra.stepId }),
    ...(extra.showOnProfile === undefined ? {} : { showOnProfile: extra.showOnProfile }),
    ...(extra.archived ? { archived: true } : {}),
    ...(extra.archivedAt === undefined ? {} : { archivedAt: extra.archivedAt }),
  });
  return { id, optionIds };
}

const plain = (
  title: string,
  position: number,
  extra: { stepId?: string; showOnProfile?: boolean; branchId?: string } = {},
) =>
  seedProfileFormQuestion({
    tenantId: labTenantId,
    adminUserId: labAdminUserId,
    title: `${TITLE}${title}`,
    position,
    ...(extra.stepId === undefined ? {} : { stepId: extra.stepId }),
    ...(extra.showOnProfile === undefined ? {} : { showOnProfile: extra.showOnProfile }),
    ...(extra.branchId === undefined ? {} : { branchId: extra.branchId }),
  });

/**
 * The clinic tree, depth 2, in ONE step, in tree order: Q1 (opener) / B1 on Q1 holds Q2 (opener) / B2 on Q2
 * holds Q3 / Q4 is unconditional and last.
 */
async function clinic() {
  const q1 = await choice('Q1', 1);
  const b1 = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: q1.id,
    values: [q1.optionIds[0]],
  });
  const q2 = await choice('Q2', 2, { branchId: b1 });
  const b2 = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: q2.id,
    values: [q2.optionIds[0]],
  });
  const q3 = await plain('Q3', 3, { branchId: b2 });
  const q4 = await plain('Q4', 4);
  return { q1, b1, q2, b2, q3, q4 };
}

async function sweep(): Promise<void> {
  await removeProfileFormByPrefix(TITLE);
  await removeIdentitiesByPrefix(PREFIX);
}

beforeAll(async () => {
  const [lab] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-lab'`;
  if (!lab) throw new Error('seed tenants are missing, run pnpm db:seed first');
  labTenantId = lab.id;
  await sweep();
  labAdminUserId = (await person()).userId;
});

afterEach(async () => {
  await removeProfileFormByPrefix(TITLE);
});

afterAll(async () => {
  await sweep();
  await adminSql`
    delete from public.tenant_modules
     where module_key = 'profile_form' and tenant_id = ${labTenantId}::uuid`;
});

describe('12.2-09 tracer: a question created into a branch lands at the end of the branch run in tree order (D-641, D-643, D-651, D-652)', () => {
  it('creates into the inner branch and then into the outer one: tree order, positions 1..n, branchId returned', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      expect(await orderOf(admin)).toEqual([tree.q1.id, tree.q2.id, tree.q3, tree.q4]);

      // Into the INNER branch (B2): right after Q3, before the unconditional Q4.
      const inner = await create(admin, { title: `${TITLE}no ramo interno`, branchId: tree.b2 });
      expect(inner.status, await inner.clone().text()).toBe(201);
      const innerBody = (await inner.json()) as ListedQuestion;
      expect(innerBody.branchId).toBe(tree.b2);
      expect(await orderOf(admin)).toEqual([
        tree.q1.id,
        tree.q2.id,
        tree.q3,
        innerBody.id,
        tree.q4,
      ]);

      // Into the OUTER branch (B1): the end of B1's run, which holds Q2 AND the nested block below it.
      const outer = await create(admin, { title: `${TITLE}no ramo externo`, branchId: tree.b1 });
      expect(outer.status, await outer.clone().text()).toBe(201);
      const outerBody = (await outer.json()) as ListedQuestion;
      expect(outerBody.branchId).toBe(tree.b1);
      expect(await orderOf(admin)).toEqual([
        tree.q1.id,
        tree.q2.id,
        tree.q3,
        innerBody.id,
        outerBody.id,
        tree.q4,
      ]);

      // The stored positions are exactly 1..n, with no gap and no repeat.
      expect(await positions()).toEqual([1, 2, 3, 4, 5, 6]);
      // The admin read says where each question is: the same branch ids the writes named.
      const list = await listOf(admin);
      expect(list.questions.map((question) => question.branchId ?? null)).toEqual([
        null,
        tree.b1,
        tree.b2,
        tree.b2,
        tree.b1,
        null,
      ]);
    });
  });

  it('an unconditional create goes to the end of its step and leaves the tree where it was', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      const res = await create(admin, { title: `${TITLE}solta` });
      expect(res.status, await res.clone().text()).toBe(201);
      const body = (await res.json()) as ListedQuestion;
      expect(body.branchId ?? null).toBeNull();
      expect(await orderOf(admin)).toEqual([tree.q1.id, tree.q2.id, tree.q3, tree.q4, body.id]);
      expect(await positions()).toEqual([1, 2, 3, 4, 5]);
    });
  });

  it('D-651: a branch whose opener sits in a LATER step than the question is condition_order, and nothing is written', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const early = await seedProfileFormStep({
        tenantId: labTenantId,
        title: `${TITLE}etapa 1`,
        position: 1,
      });
      const late = await seedProfileFormStep({
        tenantId: labTenantId,
        title: `${TITLE}etapa 2`,
        position: 2,
      });
      await plain('antes', 1, { stepId: early });
      const q1 = await choice('Q1 depois', 2, { stepId: late });
      const b1 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
      });
      const before = await snapshot();

      const res = await create(admin, { stepId: early, branchId: b1 });
      expect(res.status, await res.clone().text()).toBe(409);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.details).toEqual({ profileForm: 'condition_order', openerId: q1.id });
      expect(await snapshot()).toBe(before);

      // The same branch with the question sent to the opener's own step is accepted: the order rule, not the
      // branch, was the reason.
      const ok = await create(admin, { stepId: late, branchId: b1 });
      expect(ok.status, await ok.clone().text()).toBe(201);
    });
  });

  it('D-640: a non-null condition is 400 condition_invalid and writes nothing; null and absent are accepted', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      const before = await snapshot();

      const retired = await create(admin, {
        condition: { questionId: tree.q1.id, values: [tree.q1.optionIds[0]] },
      });
      expect(retired.status, await retired.clone().text()).toBe(400);
      expect(await details(retired)).toEqual({ profileForm: 'condition_invalid' });
      expect(await snapshot()).toBe(before);

      const withNull = await create(admin, { title: `${TITLE}nulo`, condition: null });
      expect(withNull.status, await withNull.clone().text()).toBe(201);
      const absent = await create(admin, { title: `${TITLE}ausente` });
      expect(absent.status, await absent.clone().text()).toBe(201);
    });
  });

  it('T-12.2-01: an unknown branch id is 400 unknown_branch, an archived one 409 branch_archived, and nothing is written', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      await adminSql`update public.profile_form_branches set archived_at = now() where id = ${tree.b2}::uuid`;
      await adminSql`update public.profile_form_questions set archived_at = now() where id = ${tree.q3}::uuid`;
      const before = await snapshot();

      const unknown = await create(admin, { branchId: crypto.randomUUID() });
      expect(unknown.status, await unknown.clone().text()).toBe(400);
      expect(await details(unknown)).toEqual({ profileForm: 'unknown_branch' });

      const archived = await create(admin, { branchId: tree.b2 });
      expect(archived.status, await archived.clone().text()).toBe(409);
      expect(await details(archived)).toEqual({
        profileForm: 'branch_archived',
        branchId: tree.b2,
      });
      expect(await snapshot()).toBe(before);
    });
  });
});
