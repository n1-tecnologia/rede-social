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

// ── Task 2: move, reorder, archive, reactivate, replace and delete on the tree (D-646, D-652, PFORM-53) ───────

const patch = (p: Person, id: string, body: Record<string, unknown>) =>
  call(p, 'PATCH', `/v1/profile_form/questions/${id}`, body);

const found = async (res: Response) => {
  const body = (await res.json()) as Envelope;
  return { code: body.error.code, ...(body.error.details ?? {}) } as Record<string, unknown> & {
    code: string;
  };
};

/** A row of the questions table as the tree sees it. */
const rowOf = async (id: string) => {
  const [row] = await adminSql<
    { branch_id: string | null; step_id: string; revision: number; archived_at: Date | null }[]
  >`select branch_id::text as branch_id, step_id::text as step_id, revision, archived_at
      from public.profile_form_questions where id = ${id}::uuid`;
  if (!row) throw new Error('row is gone');
  return row;
};

/** Titles of the questions in the order the admin reads them. */
const titlesOf = async (p: Person): Promise<string[]> =>
  (await listOf(p)).questions.map((question) => question.title.replace(TITLE, ''));

/** A member of the lab tenant, to hold an answer. */
const memberUserId = async (): Promise<string> => (await person('member')).userId;

describe('12.2-09 D-646: moving a question between branches and steps', () => {
  it('moves an unanswered question into another branch: it keeps its step, goes to the end of that run and its revision moves once', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      const loose = await plain('Solta', 5);
      expect(await titlesOf(admin)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Solta']);
      const before = await rowOf(loose);

      const res = await patch(admin, loose, { revision: 1, branchId: tree.b2 });
      expect(res.status, await res.clone().text()).toBe(200);
      const body = (await res.json()) as ListedQuestion;
      expect(body.branchId).toBe(tree.b2);
      expect(body.stepId).toBe(before.step_id);
      expect(body.revision).toBe(2);
      // End of B2's run: right after Q3, before the unconditional Q4.
      expect(await titlesOf(admin)).toEqual(['Q1', 'Q2', 'Q3', 'Solta', 'Q4']);
      expect(await positions()).toEqual([1, 2, 3, 4, 5]);

      // Another branch: B1's run holds Q2 and the nested block below it.
      const again = await patch(admin, loose, { revision: 2, branchId: tree.b1 });
      expect(again.status, await again.clone().text()).toBe(200);
      expect(await titlesOf(admin)).toEqual(['Q1', 'Q2', 'Q3', 'Solta', 'Q4']);
      expect((await rowOf(loose)).branch_id).toBe(tree.b1);
    });
  });

  it('branchId null leaves the branch: the question is unconditional and the form keeps its tree order', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      const res = await patch(admin, tree.q3, { revision: 1, branchId: null });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(((await res.json()) as ListedQuestion).branchId ?? null).toBeNull();
      expect((await rowOf(tree.q3)).branch_id).toBeNull();
      expect(await titlesOf(admin)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
      expect(await positions()).toEqual([1, 2, 3, 4]);
    });
  });

  it('a question WITH answers cannot enter, leave or change branch: condition_locked, rows unchanged', async () => {
    const admin = await person();
    const reader = await memberUserId();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      const loose = await plain('Respondida', 5);
      await seedProfileFormAnswer({ tenantId: labTenantId, questionId: loose, userId: reader });
      await seedProfileFormAnswer({ tenantId: labTenantId, questionId: tree.q3, userId: reader });
      const before = await snapshot();

      const entering = await patch(admin, loose, { revision: 1, branchId: tree.b1 });
      expect(entering.status).toBe(409);
      expect(await found(entering)).toMatchObject({
        code: 'CONFLICT',
        profileForm: 'condition_locked',
      });
      const leaving = await patch(admin, tree.q3, { revision: 1, branchId: null });
      expect(leaving.status).toBe(409);
      expect(await found(leaving)).toMatchObject({ profileForm: 'condition_locked' });
      const changing = await patch(admin, tree.q3, { revision: 1, branchId: tree.b1 });
      expect(changing.status).toBe(409);
      expect(await found(changing)).toMatchObject({ profileForm: 'condition_locked' });
      expect(await snapshot()).toBe(before);

      // A rename of the answered question is still free, and sending the branch it already has is no change.
      const same = await patch(admin, tree.q3, {
        revision: 1,
        branchId: tree.b2,
        title: `${TITLE}Q3 renomeada`,
      });
      expect(same.status, await same.clone().text()).toBe(200);
    });
  });

  it('D-651: a branch whose opener sits in a later STEP is condition_order naming the pair; in the same step the normaliser places the question after the opener', async () => {
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
      const mover = await plain('Antes', 1, { stepId: early });
      const q1 = await choice('Abridor', 2, { stepId: late });
      const b1 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
      });
      const before = await snapshot();

      const res = await patch(admin, mover, { revision: 1, branchId: b1 });
      expect(res.status, await res.clone().text()).toBe(409);
      expect(await found(res)).toMatchObject({
        profileForm: 'condition_order',
        questionId: mover,
        openerId: q1.id,
      });
      expect(await snapshot()).toBe(before);

      // Same step: the question sits BEFORE the opener now, the move puts it right after (tree order).
      const ok = await patch(admin, mover, { revision: 1, stepId: late, branchId: b1 });
      expect(ok.status, await ok.clone().text()).toBe(200);
      expect(await titlesOf(admin)).toEqual(['Abridor', 'Antes']);
      expect(await positions()).toEqual([1, 2]);
    });
  });

  it('a depth overflow counting the question own sub-branches is branch_depth, rows unchanged', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      // Three levels: Q1 / B1 { Q2 / B2 { Q3 / B3 { Q4 } } }.
      const q1 = await choice('N1', 1);
      const b1 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
      });
      const q2 = await choice('N2', 2, { branchId: b1 });
      const b2 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q2.id,
        values: [q2.optionIds[0]],
      });
      const q3 = await choice('N3', 3, { branchId: b2 });
      const b3 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q3.id,
        values: [q3.optionIds[0]],
      });
      await plain('N4', 4, { branchId: b3 });
      // X opens a branch of its own (height 1): inside B3 (level 3) it would make a fourth level.
      const x = await choice('X', 5);
      await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: x.id,
        values: [x.optionIds[0]],
      });
      const before = await snapshot();

      const res = await patch(admin, x.id, { revision: 1, branchId: b3 });
      expect(res.status, await res.clone().text()).toBe(409);
      expect(await found(res)).toMatchObject({ profileForm: 'branch_depth' });
      expect(await snapshot()).toBe(before);
      // Into the second level it fits (2 + 1 = 3).
      const fits = await patch(admin, x.id, { revision: 1, branchId: b1 });
      expect(fits.status, await fits.clone().text()).toBe(200);
    });
  });

  it('T-12.2-01: an unknown or foreign branch id is 400 unknown_branch, an archived one 409 branch_archived', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      const loose = await plain('Solta', 5);
      const [demo] = await adminSql<
        { id: string }[]
      >`select id::text as id from public.tenants where slug = 'rede-demo'`;
      const demoOptionId = crypto.randomUUID();
      const demoOpener = await seedProfileFormQuestion({
        tenantId: demo?.id ?? '',
        adminUserId: labAdminUserId,
        title: `${TITLE}demo`,
        type: 'single_choice',
        options: [{ id: demoOptionId, label: 'Sim' }, { label: 'Não' }],
      });
      const foreign = await seedProfileFormBranch({
        tenantId: demo?.id ?? '',
        openerQuestionId: demoOpener,
        values: [demoOptionId],
      });
      const before = await snapshot();

      for (const branchId of [crypto.randomUUID(), foreign]) {
        const res = await patch(admin, loose, { revision: 1, branchId });
        expect(res.status).toBe(400);
        expect(await found(res)).toMatchObject({ profileForm: 'unknown_branch' });
      }
      expect(await snapshot()).toBe(before);

      await adminSql`update public.profile_form_branches set archived_at = now() where id = ${tree.b2}::uuid`;
      await adminSql`update public.profile_form_questions set archived_at = now() where id = ${tree.q3}::uuid`;
      const archived = await patch(admin, loose, { revision: 1, branchId: tree.b2 });
      expect(archived.status).toBe(409);
      expect(await found(archived)).toMatchObject({
        profileForm: 'branch_archived',
        branchId: tree.b2,
      });
      expect((await rowOf(loose)).branch_id).toBeNull();
    });
  });

  it('D-640: a non-null condition on an edit is 400 condition_invalid and writes nothing; condition null is no change', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      const loose = await plain('Solta', 5);
      const before = await snapshot();
      const res = await patch(admin, loose, {
        revision: 1,
        condition: { questionId: tree.q1.id, values: [tree.q1.optionIds[0]] },
      });
      expect(res.status, await res.clone().text()).toBe(400);
      expect(await found(res)).toMatchObject({ profileForm: 'condition_invalid' });
      expect(await snapshot()).toBe(before);

      const noop = await patch(admin, loose, { revision: 1, condition: null });
      expect(noop.status, await noop.clone().text()).toBe(200);
      expect(((await noop.json()) as ListedQuestion).revision).toBe(1);
    });
  });
});

describe('12.2-09 D-646: an opener with an active branch refuses archive, retype and option removal, listing the branches', () => {
  it('has_dependents carries the BRANCHES with the titles of their active questions; the same change passes once the branch is archived or undone', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const q1 = await choice('Abridor', 1);
      const b1 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
        name: 'Ramo A',
      });
      const d1 = await plain('D1', 2, { branchId: b1 });
      const d2 = await plain('D2', 3, { branchId: b1 });
      const b2 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[1]],
      });
      await plain('D3', 4, { branchId: b2 });
      const before = await snapshot();

      const expected = (which: string[]) => ({
        profileForm: 'has_dependents',
        dependents: [],
        branches: expect.arrayContaining(
          which.map((branchId) => expect.objectContaining({ id: branchId })),
        ),
      });

      const archive = await call(admin, 'POST', `/v1/profile_form/questions/${q1.id}/archive`);
      expect(archive.status).toBe(409);
      const archiveBody = (await archive.json()) as Envelope;
      expect(archiveBody.error.details).toMatchObject(expected([b1, b2]));
      const listed = (archiveBody.error.details?.branches ?? []) as {
        id: string;
        name: string | null;
        questions: { id: string; title: string }[];
      }[];
      expect(listed.map((b) => b.id)).toEqual([b1, b2]);
      expect(listed[0]?.name).toBe('Ramo A');
      expect(listed[0]?.questions.map((q) => q.id)).toEqual([d1, d2]);
      expect(listed[1]?.questions.map((q) => q.title)).toEqual([`${TITLE}D3`]);

      const retype = await patch(admin, q1.id, { revision: 1, type: 'multiple_choice' });
      expect(retype.status).toBe(409);
      expect(((await retype.json()) as Envelope).error.details).toMatchObject(expected([b1, b2]));

      // An option no branch names goes freely; an option b1 names lists ONLY b1.
      const spare = await patch(admin, q1.id, {
        revision: 1,
        options: [
          { id: q1.optionIds[0], label: 'Opção 1' },
          { id: q1.optionIds[1], label: 'Opção 2' },
        ],
      });
      expect(spare.status, await spare.clone().text()).toBe(200);
      const remove = await patch(admin, q1.id, {
        revision: 2,
        options: [{ id: q1.optionIds[1], label: 'Opção 2' }, { label: 'Nova' }],
      });
      expect(remove.status).toBe(409);
      const removeBody = (await remove.json()) as Envelope;
      const removeBranches = (removeBody.error.details?.branches ?? []) as { id: string }[];
      expect(removeBranches.map((b) => b.id)).toEqual([b1]);
      expect(await rowOf(q1.id)).toMatchObject({ revision: 2, archived_at: null });
      expect((await snapshot()).length).toBe(before.length);

      // Undo b1 and archive b2: the opener has no ACTIVE branch left and the archive goes through.
      expect((await call(admin, 'POST', `/v1/profile_form/branches/${b1}/undo`)).status).toBe(200);
      expect((await call(admin, 'POST', `/v1/profile_form/branches/${b2}/archive`)).status).toBe(
        200,
      );
      const ok = await call(admin, 'POST', `/v1/profile_form/questions/${q1.id}/archive`);
      expect(ok.status, await ok.clone().text()).toBe(200);
    });
  });

  it('delete and replace of an opener of an ACTIVE branch are has_dependents too', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const q1 = await choice('Abridor', 1);
      const b1 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
      });
      await plain('D1', 2, { branchId: b1 });
      const before = await snapshot();
      const del = await call(admin, 'DELETE', `/v1/profile_form/questions/${q1.id}`);
      expect(del.status).toBe(409);
      expect(((await del.json()) as Envelope).error.details).toMatchObject({
        profileForm: 'has_dependents',
        dependents: [],
      });
      const rep = await call(admin, 'POST', '/v1/profile_form/questions/replace', {
        replaces: q1.id,
        type: 'short_text',
        title: `${TITLE}novo`,
      });
      expect(rep.status).toBe(409);
      expect(((await rep.json()) as Envelope).error.details).toMatchObject({
        profileForm: 'has_dependents',
      });
      expect(await snapshot()).toBe(before);
    });
  });

  it('opensCount counts the ACTIVE questions in the ACTIVE branches that hang directly on the question', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      // An archived branch with an archived question, and an archived question in the active one: not counted.
      const q5 = await choice('Q5', 5);
      const bArchived = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q5.id,
        values: [q5.optionIds[0]],
        archived: true,
      });
      await plain('Arquivada', 6, { branchId: bArchived });
      await adminSql`update public.profile_form_questions set archived_at = now() where branch_id = ${bArchived}::uuid`;
      await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId: labAdminUserId,
        title: `${TITLE}Arquivada no B1`,
        branchId: tree.b1,
        archived: true,
      });
      const list = (await listOf(admin)) as unknown as {
        questions: (ListedQuestion & { opensCount: number })[];
      };
      const opens = Object.fromEntries(
        list.questions.map((q) => [q.title.replace(TITLE, ''), q.opensCount]),
      );
      expect(opens).toEqual({ Q1: 1, Q2: 1, Q3: 0, Q4: 0, Q5: 0 });
    });
  });
});

describe('12.2-09 PFORM-53, WR-06 (T-12.2-02): a question that shows on the profile cannot sit under a private opener', () => {
  const titlesIn = (details: Record<string, unknown> | undefined) =>
    (details?.titles ?? []) as string[];

  it('showOnProfile true on a question under a private opener, a create or a move into such a chain are each 409 public_under_private with the titles', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic(); // every question private
      const publicLoose = await plain('Publica solta', 5, { showOnProfile: true });
      const before = await snapshot();

      const flag = await patch(admin, tree.q3, { revision: 1, showOnProfile: true });
      expect(flag.status, await flag.clone().text()).toBe(409);
      const flagBody = (await flag.json()) as Envelope;
      expect(flagBody.error.details?.profileForm).toBe('public_under_private');
      expect(titlesIn(flagBody.error.details)).toEqual([`${TITLE}Q3`]);

      const created = await create(admin, {
        title: `${TITLE}publica`,
        showOnProfile: true,
        branchId: tree.b2,
      });
      expect(created.status).toBe(409);
      const createdBody = (await created.json()) as Envelope;
      expect(createdBody.error.details?.profileForm).toBe('public_under_private');
      expect(titlesIn(createdBody.error.details)).toEqual([`${TITLE}publica`]);

      const moved = await patch(admin, publicLoose, { revision: 1, branchId: tree.b1 });
      expect(moved.status).toBe(409);
      expect(titlesIn(((await moved.json()) as Envelope).error.details)).toEqual([
        `${TITLE}Publica solta`,
      ]);
      // Every refusal left every row as it was.
      expect(await snapshot()).toBe(before);
      expect(await positions()).toEqual([1, 2, 3, 4, 5]);

      // Positive control: the same question is fine when its opener is public.
      await adminSql`update public.profile_form_questions set show_on_profile = true where id = ${tree.q1.id}::uuid`;
      const ok = await patch(admin, publicLoose, { revision: 1, branchId: tree.b1 });
      expect(ok.status, await ok.clone().text()).toBe(200);
    });
  });

  it('making an opener private while a public question hangs below it at any depth lists them all, and changes nothing', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const q1 = await choice('Q1', 1, { showOnProfile: true });
      const b1 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
      });
      const q2 = await choice('Q2', 2, { branchId: b1, showOnProfile: true });
      const b2 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q2.id,
        values: [q2.optionIds[0]],
      });
      await plain('Q3', 3, { branchId: b2, showOnProfile: true });
      const before = await snapshot();

      const res = await patch(admin, q1.id, { revision: 1, showOnProfile: false });
      expect(res.status, await res.clone().text()).toBe(409);
      const body = (await res.json()) as Envelope;
      expect(body.error.details?.profileForm).toBe('public_under_private');
      expect(titlesIn(body.error.details)).toEqual([`${TITLE}Q2`, `${TITLE}Q3`]);
      expect(await snapshot()).toBe(before);

      // A private opener with NO public question below is fine.
      const lone = await choice('Sozinho', 4, { showOnProfile: true });
      const ok = await patch(admin, lone.id, { revision: 1, showOnProfile: false });
      expect(ok.status, await ok.clone().text()).toBe(200);
    });
  });

  it('reactivating a public question into a chain with a private opener is public_under_private', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const q1 = await choice('Q1', 1);
      const b1 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
      });
      const archived = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId: labAdminUserId,
        title: `${TITLE}Arquivada publica`,
        branchId: b1,
        showOnProfile: true,
        archived: true,
      });
      const before = await snapshot();
      const res = await call(admin, 'POST', `/v1/profile_form/questions/${archived}/reactivate`);
      expect(res.status, await res.clone().text()).toBe(409);
      const body = (await res.json()) as Envelope;
      expect(body.error.details?.profileForm).toBe('public_under_private');
      expect(titlesIn(body.error.details)).toEqual([`${TITLE}Arquivada publica`]);
      expect(await snapshot()).toBe(before);
    });
  });
});

describe('12.2-09 D-652: the order is the tree, server side', () => {
  it('a flat PUT /order that splits a branch is rewritten to the tree order and answered 200; a step above the opener step is condition_order', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      const [first] = (await listOf(admin)).questions;
      const stepId = first?.stepId ?? '';
      const requested = [tree.q1.id, tree.q2.id, tree.q4, tree.q3];
      const res = await call(admin, 'PUT', '/v1/profile_form/order', {
        steps: [{ id: stepId, questionIds: requested }],
      });
      expect(res.status, await res.clone().text()).toBe(200);
      // Q3 belongs to Q2's branch: it stays in the block right after Q2.
      expect(await titlesOf(admin)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
      expect(await positions()).toEqual([1, 2, 3, 4]);

      // An already tree-ordered request is a no-op: the same order, the same revisions.
      const revisions = (await listOf(admin)).questions.map((q) => q.revision);
      const same = await call(admin, 'PUT', '/v1/profile_form/order', {
        steps: [{ id: stepId, questionIds: [tree.q1.id, tree.q2.id, tree.q3, tree.q4] }],
      });
      expect(same.status).toBe(200);
      expect((await listOf(admin)).questions.map((q) => q.revision)).toEqual(revisions);
    });
  });

  it('a layout that puts a step above the step of an opener of its questions is condition_order naming the pair', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const s1 = await seedProfileFormStep({
        tenantId: labTenantId,
        title: `${TITLE}S1`,
        position: 1,
      });
      const s2 = await seedProfileFormStep({
        tenantId: labTenantId,
        title: `${TITLE}S2`,
        position: 2,
      });
      const q1 = await choice('Abridor', 1, { stepId: s1 });
      const b1 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
      });
      const dep = await plain('Dependente', 2, { stepId: s2, branchId: b1 });
      const before = await snapshot();
      const res = await call(admin, 'PUT', '/v1/profile_form/order', {
        steps: [
          { id: s2, questionIds: [dep] },
          { id: s1, questionIds: [q1.id] },
        ],
      });
      expect(res.status, await res.clone().text()).toBe(409);
      expect(await found(res)).toMatchObject({
        profileForm: 'condition_order',
        questionId: dep,
        openerId: q1.id,
      });
      expect(await snapshot()).toBe(before);
    });
  });
});

describe('12.2-09 D-646: archive, reactivate, delete and replace on the tree', () => {
  it('a reactivated question returns to its own step and branch at the end of the run; a question whose branch was undone returns unconditional', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      const made = await create(admin, { title: `${TITLE}Extra`, branchId: tree.b2 });
      expect(made.status, await made.clone().text()).toBe(201);
      const extra = ((await made.json()) as ListedQuestion).id;
      expect(await titlesOf(admin)).toEqual(['Q1', 'Q2', 'Q3', 'Extra', 'Q4']);

      const archive = await call(admin, 'POST', `/v1/profile_form/questions/${tree.q3}/archive`);
      expect(archive.status, await archive.clone().text()).toBe(200);
      expect(await titlesOf(admin)).toEqual(['Q1', 'Q2', 'Extra', 'Q4']);
      expect(await positions()).toEqual([1, 2, 3, 4]);

      const back = await call(admin, 'POST', `/v1/profile_form/questions/${tree.q3}/reactivate`);
      expect(back.status, await back.clone().text()).toBe(200);
      expect(((await back.json()) as ListedQuestion).branchId).toBe(tree.b2);
      // End of B2's run (after Extra), before the unconditional Q4.
      expect(await titlesOf(admin)).toEqual(['Q1', 'Q2', 'Extra', 'Q3', 'Q4']);
      expect(await positions()).toEqual([1, 2, 3, 4, 5]);

      // Archive Extra, undo B2 (its questions leave the branch, archived ones too), reactivate: unconditional.
      expect(
        (await call(admin, 'POST', `/v1/profile_form/questions/${extra}/archive`)).status,
      ).toBe(200);
      expect((await call(admin, 'POST', `/v1/profile_form/branches/${tree.b2}/undo`)).status).toBe(
        200,
      );
      const free = await call(admin, 'POST', `/v1/profile_form/questions/${extra}/reactivate`);
      expect(free.status, await free.clone().text()).toBe(200);
      expect(((await free.json()) as ListedQuestion).branchId ?? null).toBeNull();
    });
  });

  it('a question of an ARCHIVED branch cannot come back alone: branch_archived naming the branch; and 30 active questions is limit_reached', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      expect(
        (await call(admin, 'POST', `/v1/profile_form/branches/${tree.b2}/archive`)).status,
      ).toBe(200);
      const before = await snapshot();
      const res = await call(admin, 'POST', `/v1/profile_form/questions/${tree.q3}/reactivate`);
      expect(res.status, await res.clone().text()).toBe(409);
      expect(await found(res)).toMatchObject({ profileForm: 'branch_archived', branchId: tree.b2 });
      expect(await snapshot()).toBe(before);

      // Fill the form up to 30 and try again with a loose archived question.
      const spare = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId: labAdminUserId,
        title: `${TITLE}arquivada solta`,
        archived: true,
      });
      // Fill the form up to exactly 30 active questions (the archived block does not count).
      const active = (await listOf(admin)).activeCount;
      for (let i = active; i < 30; i += 1) await plain(`Cheia ${i}`, 10 + i);
      expect((await listOf(admin)).activeCount).toBe(30);
      const full = await call(admin, 'POST', `/v1/profile_form/questions/${spare}/reactivate`);
      expect(full.status).toBe(409);
      expect(await found(full)).toMatchObject({ profileForm: 'limit_reached' });
    });
  });

  it('deleting a never-answered opener of ONLY archived branches dissolves those branches; their questions become unconditional', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const q1 = await choice('Abridor', 1);
      const b1 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1.id,
        values: [q1.optionIds[0]],
      });
      const member = await plain('Membro', 2, { branchId: b1 });
      expect((await call(admin, 'POST', `/v1/profile_form/branches/${b1}/archive`)).status).toBe(
        200,
      );

      const res = await call(admin, 'DELETE', `/v1/profile_form/questions/${q1.id}`);
      expect(res.status, await res.clone().text()).toBe(200);
      const [branches] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.profile_form_branches where opener_question_id = ${q1.id}::uuid`;
      expect(branches?.n).toBe(0);
      const row = await rowOf(member);
      expect(row.branch_id).toBeNull();
      expect(row.archived_at).not.toBeNull();
    });
  });

  it('replacing a question copies its stepId and branchId into the new one', async () => {
    const admin = await person();
    await withProfileForm(labTenantId, async () => {
      const tree = await clinic();
      const res = await call(admin, 'POST', '/v1/profile_form/questions/replace', {
        replaces: tree.q3,
        type: 'short_text',
        title: `${TITLE}Q3 nova`,
      });
      expect(res.status, await res.clone().text()).toBe(201);
      const created = (await res.json()) as ListedQuestion;
      expect(created.branchId).toBe(tree.b2);
      expect((await rowOf(tree.q3)).archived_at).not.toBeNull();
      expect(await titlesOf(admin)).toEqual(['Q1', 'Q2', 'Q3 nova', 'Q4']);
      expect(await positions()).toEqual([1, 2, 3, 4]);

      // A replacement that shows on the profile under a private chain is refused, the old one stays active.
      const publicTry = await call(admin, 'POST', '/v1/profile_form/questions/replace', {
        replaces: created.id,
        type: 'short_text',
        title: `${TITLE}Q3 publica`,
        showOnProfile: true,
      });
      expect(publicTry.status).toBe(409);
      expect(((await publicTry.json()) as Envelope).error.details?.profileForm).toBe(
        'public_under_private',
      );
      expect((await rowOf(created.id)).archived_at).toBeNull();
      // And a retired condition is 400.
      const retired = await call(admin, 'POST', '/v1/profile_form/questions/replace', {
        replaces: created.id,
        type: 'short_text',
        title: `${TITLE}Q3 cond`,
        condition: { questionId: tree.q1.id, values: [tree.q1.optionIds[0]] },
      });
      expect(retired.status).toBe(400);
    });
  });
});
