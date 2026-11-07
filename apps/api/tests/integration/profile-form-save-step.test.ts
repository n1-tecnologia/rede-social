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
 * 12.1-11 (PFORM-30, PFORM-32, PFORM-33; D-624, D-628..D-631, D-636; T-12.1-02, T-12.1-03, T-12.1-10,
 * T-12.1-16) against the live local stack: the member's side of the kernel. The form read carries steps and
 * conditions and its `formEtag` follows them; the save is scoped to a step, validated by the visibility the SQL
 * uses, writes only what the member sees, deletes what stopped applying in the same transaction and reports
 * what is still owed.
 *
 * EVERY identity is a THROWAWAY (`createSharedIdentity`, prefix `pfs`); steps and questions carry the title
 * prefix `pfs ` so the sweep removes only this file's rows (answers first, the default step the database
 * trigger writes once empty). The module row is restored by `withProfileForm`. No tenant is created: the
 * members, steps and questions live in the seed tenants rede-lab and rede-demo, and are all removed again.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
type FormQuestion = {
  id: string;
  type: string;
  title: string;
  required: boolean;
  stepId: string;
  branchId: string | null;
  options: { id: string; label: string }[];
  answer: unknown;
};
type FormBranch = { id: string; openerQuestionId: string; values: string[] };
type Form = {
  mode: 'none' | 'first' | 'returning' | 'edit';
  missingRequired: number;
  formEtag: string;
  steps: { id: string; title: string }[];
  questions: FormQuestion[];
  branches: FormBranch[];
};
type SaveResult = { missingRequired: number; missingQuestionIds: string[] };

const PREFIX = 'pfs';
const TITLE = 'pfs ';
let labTenantId = '';
let demoTenantId = '';
let adminUserId = '';

type Person = { userId: string; email: string; password: string; token: string };

async function person(
  role: 'member' | 'admin_tenant' = 'member',
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
  method: 'GET' | 'PUT' | 'POST' | 'PATCH',
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

const readForm = async (p: Person, host: string = HOSTS.lab): Promise<Form> => {
  const res = await call(p, 'GET', '/v1/me/profile-form', undefined, host);
  expect(res.status).toBe(200);
  return (await res.json()) as Form;
};

/** The save as the client sends it: the etag of the form she read, an optional step and the answers. */
const save = (
  p: Person,
  form: Pick<Form, 'formEtag'>,
  answers: Record<string, unknown>,
  stepId?: string,
  host: string = HOSTS.lab,
) =>
  call(
    p,
    'PUT',
    '/v1/me/profile-form/answers',
    { formEtag: form.formEtag, ...(stepId === undefined ? {} : { stepId }), answers },
    host,
  );

const saved = async (res: Response): Promise<SaveResult> => {
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as SaveResult;
};

const errorOf = async (res: Response) => ((await res.json()) as Envelope).error;

const seedQ = (title: string, over: Partial<Parameters<typeof seedProfileFormQuestion>[0]> = {}) =>
  seedProfileFormQuestion({
    tenantId: labTenantId,
    adminUserId,
    title: `${TITLE}${title}`,
    ...over,
  });

const seedStep = (title: string, tenantId: string = labTenantId) =>
  seedProfileFormStep({ tenantId, title: `${TITLE}${title}` });

const storedAnswers = async (userId: string) =>
  adminSql<{ question_id: string; value: unknown; updated_at: Date }[]>`
    select a.question_id::text as question_id, a.value, a.updated_at
      from public.profile_form_answers a
      join public.memberships m on m.id = a.membership_id
     where m.user_id = ${userId}::uuid
     order by a.question_id`;

const hasAnswer = async (userId: string, questionId: string) =>
  (await storedAnswers(userId)).some((row) => row.question_id === questionId);

async function sweep(): Promise<void> {
  await removeProfileFormByPrefix(TITLE);
  await removeIdentitiesByPrefix(PREFIX);
}

beforeAll(async () => {
  const tenants = await adminSql<{ id: string; slug: string }[]>`
    select id::text as id, slug from public.tenants where slug in ('rede-lab', 'rede-demo')`;
  const lab = tenants.find((t) => t.slug === 'rede-lab');
  const demo = tenants.find((t) => t.slug === 'rede-demo');
  if (!lab || !demo) throw new Error('seed tenants are missing, run pnpm db:seed first');
  labTenantId = lab.id;
  demoTenantId = demo.id;
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

// ── Task 1: the read carries steps and conditions and the etag follows them ─────────────────────────

describe('12.1-11 tracer: the member form carries steps and conditions and a step move changes the etag (D-628, D-629, D-630)', () => {
  it('reads EVERY active question with stepId and branchId, the ACTIVE branches, the shown steps in order, and no empty step', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const s1 = await seedStep('S1');
      const s2 = await seedStep('S2');
      const empty = await seedStep('Vazia');
      const onlyArchived = await seedStep('SoArquivada');
      const opener = await seedQ('opener', {
        type: 'single_choice',
        stepId: s1,
        position: 1,
        options: [{ label: 'Sim' }, { label: 'Não' }],
      });
      const [yes] = await adminSql<{ id: string }[]>`
        select o ->> 'id' as id from public.profile_form_questions q,
               jsonb_array_elements(q.options) as o
         where q.id = ${opener}::uuid and o ->> 'label' = 'Sim'`;
      const branchId = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: opener,
        values: [yes?.id as string],
      });
      const dependent = await seedQ('dependent', { stepId: s2, position: 2, branchId });
      const plain = await seedQ('plain', { stepId: s2, position: 3 });
      await seedQ('archived', { stepId: onlyArchived, position: 4, archived: true });

      const form = await readForm(member);
      expect(form.steps).toEqual([
        { id: s1, title: `${TITLE}S1` },
        { id: s2, title: `${TITLE}S2` },
      ]);
      expect(form.steps.map((step) => step.id)).not.toContain(empty);
      expect(form.steps.map((step) => step.id)).not.toContain(onlyArchived);
      // The hidden dependent is in the read: the client reveals it live (D-630). Since 12.2 it names its branch.
      const [branchRow] = await adminSql<{ id: string }[]>`
        select id::text as id from public.profile_form_branches
         where opener_question_id = ${opener}::uuid`;
      expect(form.questions.map((q) => [q.id, q.stepId, q.branchId])).toEqual([
        [opener, s1, null],
        [dependent, s2, branchRow?.id],
        [plain, s2, null],
      ]);
      expect(form.branches).toEqual([
        { id: branchRow?.id, openerQuestionId: opener, values: [yes?.id] },
      ]);
      expect(form.formEtag).toMatch(/^[0-9a-f]{16}$/);
      // Reading again changes nothing: the etag is a pure function of the stored form.
      expect((await readForm(member)).formEtag).toBe(form.formEtag);
    });
  }, 30_000);

  it('the formEtag differs after a question moves to another step even when the global order is unchanged, after a step rename and after a move into a branch', async () => {
    const admin = await person('admin_tenant');
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const s1 = await seedStep('S1');
      const s2 = await seedStep('S2');
      const opener = await seedQ('opener', {
        type: 'yes_no',
        stepId: s1,
        position: 1,
      });
      const b = await seedQ('B', { stepId: s1, position: 2 });
      const c = await seedQ('C', { stepId: s2, position: 3 });
      const before = (await readForm(member)).formEtag;

      // A step move that keeps the global order: [opener, b | c] becomes [opener | b, c].
      const moved = await call(admin, 'PUT', '/v1/profile_form/order', {
        steps: [
          { id: s1, questionIds: [opener] },
          { id: s2, questionIds: [b, c] },
        ],
      });
      expect(moved.status, await moved.clone().text()).toBe(200);
      const afterMove = await readForm(member);
      expect(afterMove.questions.map((q) => q.id)).toEqual([opener, b, c]);
      expect(afterMove.formEtag).not.toBe(before);

      // A step rename bumps the step's revision.
      const [step] = await adminSql<{ revision: number }[]>`
        select revision from public.profile_form_steps where id = ${s2}::uuid`;
      const renamed = await call(admin, 'PATCH', `/v1/profile_form/steps/${s2}`, {
        revision: step?.revision,
        title: `${TITLE}S2 renomeada`,
      });
      expect(renamed.status, await renamed.clone().text()).toBe(200);
      const afterRename = await readForm(member);
      expect(afterRename.steps.map((s) => s.title)).toEqual([`${TITLE}S1`, `${TITLE}S2 renomeada`]);
      expect(afterRename.formEtag).not.toBe(afterMove.formEtag);

      // An empty branch is not part of what a member renders, so creating one leaves the etag alone (WR-02);
      // moving a question into it bumps the question's revision (D-640) and the branch joins the etag.
      const branchId = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: opener,
        values: ['true'],
      });
      const beforeBranch = (await readForm(member)).formEtag;
      expect(beforeBranch).toBe(afterRename.formEtag);
      const [q] = await adminSql<{ revision: number }[]>`
        select revision from public.profile_form_questions where id = ${c}::uuid`;
      const branched = await call(admin, 'PATCH', `/v1/profile_form/questions/${c}`, {
        revision: q?.revision,
        branchId,
      });
      expect(branched.status, await branched.clone().text()).toBe(200);
      const afterBranch = await readForm(member);
      expect(afterBranch.questions.find((x) => x.id === c)?.branchId).toBe(branchId);
      expect(afterBranch.formEtag).not.toBe(beforeBranch);
    });
  }, 30_000);

  it('a member whose form changed under her gets 409 form_changed with the fresh form carrying steps, and nothing is written', async () => {
    const admin = await person('admin_tenant');
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const s1 = await seedStep('S1');
      const s2 = await seedStep('S2');
      const a = await seedQ('A', { stepId: s1, position: 1, required: true });
      const b = await seedQ('B', { stepId: s1, position: 2 });
      const stale = await readForm(member);

      const moved = await call(admin, 'PUT', '/v1/profile_form/order', {
        steps: [
          { id: s1, questionIds: [a] },
          { id: s2, questionIds: [b] },
        ],
      });
      expect(moved.status, await moved.clone().text()).toBe(200);

      const res = await save(member, stale, { [a]: 'oi' });
      expect(res.status).toBe(409);
      const error = await errorOf(res);
      expect(error.code).toBe('CONFLICT');
      expect(error.details).toMatchObject({ profileForm: 'form_changed' });
      const fresh = (error.details as { form: Form }).form;
      expect(fresh.steps.map((s) => s.id)).toEqual([s1, s2]);
      expect(fresh.questions.map((q) => [q.id, q.stepId])).toEqual([
        [a, s1],
        [b, s2],
      ]);
      expect(await storedAnswers(member.userId)).toEqual([]);
      // The fresh etag succeeds.
      const ok = await saved(await save(member, fresh, { [a]: 'oi' }));
      expect(ok.missingRequired).toBe(0);
    });
  }, 30_000);

  it('staff and a module that is off read mode none with no steps', async () => {
    const admin = await person('admin_tenant');
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      await seedQ('A', { required: true });
      const staff = await readForm(admin);
      expect(staff).toMatchObject({ mode: 'none', steps: [], questions: [] });
    });
    await withProfileForm(
      labTenantId,
      async () => {
        const off = await readForm(member);
        expect(off).toMatchObject({ mode: 'none', steps: [], questions: [] });
      },
      { enabled: false },
    );
  }, 30_000);
});

// ── Task 2: the scoped save ─────────────────────────────────────────────────────────────────────────

type TwoSteps = { s1: string; s2: string; a: string; late: string };

/** Step 1 holds a required question, step 2 holds another required one: the smallest multi-step form. */
async function twoSteps(): Promise<TwoSteps> {
  const s1 = await seedStep('S1');
  const s2 = await seedStep('S2');
  const a = await seedQ('A', { stepId: s1, position: 1, required: true });
  const late = await seedQ('Late', { stepId: s2, position: 2, required: true });
  return { s1, s2, a, late };
}

type Branch = {
  s1: string;
  opener: string;
  yes: string;
  no: string;
  dependent: string;
  archivedDependent: string;
};

/**
 * A single-choice opener (Sim / Não), an ACTIVE dependent shown by Sim and an ARCHIVED dependent also shown by
 * Sim, all in step 1. The option ids are chosen here so a case can answer without reading the form.
 */
async function branch(over: { dependentRequired?: boolean } = {}): Promise<Branch> {
  const s1 = await seedStep('S1');
  const yes = crypto.randomUUID();
  const no = crypto.randomUUID();
  const opener = await seedQ('opener', {
    type: 'single_choice',
    stepId: s1,
    position: 1,
    required: true,
    options: [
      { id: yes, label: 'Sim' },
      { id: no, label: 'Não' },
    ],
  });
  const branchId = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: opener,
    values: [yes],
  });
  const dependent = await seedQ('dependent', {
    stepId: s1,
    position: 2,
    required: over.dependentRequired ?? false,
    branchId,
  });
  const archivedDependent = await seedQ('archived dependent', {
    stepId: s1,
    position: 3,
    archived: true,
    branchId,
  });
  return { s1, opener, yes, no, dependent, archivedDependent };
}

const choose = (optionId: string) => ({ optionId, otherText: null });

const mark = async (questionId: string, userId: string): Promise<Date | undefined> => {
  const rows = await storedAnswers(userId);
  return rows.find((row) => row.question_id === questionId)?.updated_at;
};

describe('12.1-11 D-629: Avançar saves one step and reports what is owed elsewhere (PFORM-32)', () => {
  it('a step save with the other step’s required question unanswered succeeds and reports its id; the gate holds until the last step closes', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const { s1, s2, a, late } = await twoSteps();
      const form = await readForm(member);
      expect(form.missingRequired).toBe(2);

      const first = await saved(await save(member, form, { [a]: 'Ana' }, s1));
      expect(first).toEqual({ missingRequired: 1, missingQuestionIds: [late] });
      expect((await call(member, 'GET', '/v1/me/profile')).status).toBe(403);

      // The report agrees with the read, and the form (same etag) is still the one she holds.
      expect((await readForm(member)).missingRequired).toBe(1);
      const last = await saved(await save(member, form, { [late]: 'Depois' }, s2));
      expect(last).toEqual({ missingRequired: 0, missingQuestionIds: [] });
      expect((await call(member, 'GET', '/v1/me/profile')).status).toBe(200);
    });
  }, 30_000);

  it('the same body with no stepId is refused 400 answers_invalid keyed by that question id, and the valid value beside it is not written (Phase 12 compatibility)', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const { a, late } = await twoSteps();
      const form = await readForm(member);

      const res = await save(member, form, { [a]: 'Ana' });
      expect(res.status).toBe(400);
      const error = await errorOf(res);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual({
        profileForm: 'answers_invalid',
        errors: { [late]: 'required' },
      });
      expect(await storedAnswers(member.userId)).toEqual([]);
    });
  }, 30_000);

  it('single-step compatibility: for a one-step tenant a stepId naming the only step behaves exactly like none, refused in the admin’s order', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const s1 = await seedStep('Unica');
      const x = await seedQ('X', { stepId: s1, position: 1, required: true });
      const y = await seedQ('Y', { stepId: s1, position: 2, required: true });
      const z = await seedQ('Z', { stepId: s1, position: 3, required: true });
      const form = await readForm(member);

      const without = await save(member, form, { [z]: 'z' });
      const withStep = await save(member, form, { [z]: 'z' }, s1);
      expect(without.status).toBe(400);
      expect(withStep.status).toBe(400);
      const a = await errorOf(without);
      const b = await errorOf(withStep);
      expect(a.details).toEqual({
        profileForm: 'answers_invalid',
        errors: { [x]: 'required', [y]: 'required' },
      });
      expect(Object.keys((a.details as { errors: object }).errors)).toEqual([x, y]);
      expect(b.details).toEqual(a.details);
      expect(await storedAnswers(member.userId)).toEqual([]);
    });
  }, 30_000);

  it('T-12.1-10: a key of another step is unknown_question, an unknown, empty or other tenant’s step is 400 unknown_step, and nothing is written', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const { s1, s2, a, late } = await twoSteps();
      const empty = await seedStep('Vazia');
      const theirs = await seedStep('Deles', demoTenantId);
      const form = await readForm(member);

      const crossed = await save(member, form, { [a]: 'Ana', [late]: 'x' }, s1);
      expect(crossed.status).toBe(400);
      expect((await errorOf(crossed)).details).toEqual({
        profileForm: 'answers_invalid',
        errors: { [late]: 'unknown_question' },
      });

      for (const stepId of [crypto.randomUUID(), empty, theirs]) {
        const res = await save(member, form, { [a]: 'Ana' }, stepId);
        expect(res.status, stepId).toBe(400);
        const error = await errorOf(res);
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(error.details).toEqual({ profileForm: 'unknown_step' });
      }
      expect(await storedAnswers(member.userId)).toEqual([]);

      // Positive control: the own step saves.
      expect(
        (await saved(await save(member, form, { [a]: 'Ana' }, s1))).missingQuestionIds,
      ).toEqual([late]);
      expect(s2).not.toBe(s1);
    });
  }, 30_000);
});

describe('12.1-11 T-12.1-02: a value for a question that is not visible is ignored and never stored', () => {
  it('ignores a value sent for a hidden dependent (valid or not) beside the same value stored once the opener matches, and a hidden required dependent is not owed', async () => {
    const hidden = await person();
    const shown = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await branch({ dependentRequired: true });
      const form = await readForm(hidden);

      // Opener answered "Não": the dependent is hidden, its value is dropped without an error, and it is not owed.
      const ignored = await saved(
        await save(hidden, form, { [f.opener]: choose(f.no), [f.dependent]: 'plantada' }, f.s1),
      );
      expect(ignored).toEqual({ missingRequired: 0, missingQuestionIds: [] });
      expect((await storedAnswers(hidden.userId)).map((row) => row.question_id)).toEqual([
        f.opener,
      ]);

      // A value of the wrong type for a hidden question is ignored too: no error, no write.
      const invalid = await saved(
        await save(hidden, form, { [f.opener]: choose(f.no), [f.dependent]: 12345 }, f.s1),
      );
      expect(invalid.missingRequired).toBe(0);
      expect(await hasAnswer(hidden.userId, f.dependent)).toBe(false);

      // No opener answer at all hides the dependent as well: the refusal names the opener she left out, never
      // the dependent whose value was dropped.
      const other = await person();
      const none = await save(other, form, { [f.dependent]: 'plantada' }, f.s1);
      expect(none.status).toBe(400);
      expect((await errorOf(none)).details).toEqual({
        profileForm: 'answers_invalid',
        errors: { [f.opener]: 'required' },
      });
      expect(await storedAnswers(other.userId)).toEqual([]);

      // Positive control: "Sim" shows it, so the same value is stored.
      const stored = await saved(
        await save(shown, form, { [f.opener]: choose(f.yes), [f.dependent]: 'plantada' }, f.s1),
      );
      expect(stored).toEqual({ missingRequired: 0, missingQuestionIds: [] });
      expect(
        (await storedAnswers(shown.userId)).map((row) => [row.question_id, row.value]),
      ).toEqual(
        [
          [f.opener, choose(f.yes)],
          [f.dependent, 'plantada'],
        ].sort(([x], [y]) => String(x).localeCompare(String(y))),
      );
    });
  }, 40_000);

  it('a visible required dependent left without a key and without a stored answer is refused required, but only when the save includes it', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await branch({ dependentRequired: true });
      const form = await readForm(member);

      // "Sim" in the same save makes the dependent visible and owed in that step.
      const res = await save(member, form, { [f.opener]: choose(f.yes) }, f.s1);
      expect(res.status).toBe(400);
      expect((await errorOf(res)).details).toEqual({
        profileForm: 'answers_invalid',
        errors: { [f.dependent]: 'required' },
      });
      expect(await storedAnswers(member.userId)).toEqual([]);

      // answers: {} reports instead: nothing is submitted, so nothing can be refused.
      const empty = await saved(await save(member, form, {}, f.s1));
      expect(empty).toEqual({ missingRequired: 1, missingQuestionIds: [f.opener] });
    });
  }, 30_000);
});

describe('12.1-11 D-624 and D-636: what stopped applying is deleted by the save that closed it', () => {
  it('changing an opener from the matching to a non-matching option deletes the member’s answers to the closed ACTIVE and ARCHIVED dependents in that save, leaves another member’s, and a repeated identical save changes nothing (PFORM-33)', async () => {
    const member = await person();
    const bystander = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await branch();
      for (const who of [member, bystander]) {
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: f.opener,
          userId: who.userId,
          value: choose(f.yes),
        });
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: f.dependent,
          userId: who.userId,
          value: 'ativa',
        });
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: f.archivedDependent,
          userId: who.userId,
          value: 'arquivada',
        });
      }
      const form = await readForm(member);

      const first = await saved(await save(member, form, { [f.opener]: choose(f.no) }, f.s1));
      expect(first).toEqual({ missingRequired: 0, missingQuestionIds: [] });
      expect(
        (await storedAnswers(member.userId)).map((row) => [row.question_id, row.value]),
      ).toEqual([[f.opener, choose(f.no)]]);
      // Another member's answers are untouched, archived one included.
      expect((await storedAnswers(bystander.userId)).map((row) => row.question_id).sort()).toEqual(
        [f.opener, f.dependent, f.archivedDependent].sort(),
      );

      // PFORM-33: the same body again changes nothing and answers the same.
      const stamp = await mark(f.opener, member.userId);
      const second = await saved(await save(member, form, { [f.opener]: choose(f.no) }, f.s1));
      expect(second).toEqual(first);
      expect(await mark(f.opener, member.userId)).toEqual(stamp);
      expect((await storedAnswers(member.userId)).map((row) => row.question_id)).toEqual([
        f.opener,
      ]);
    });
  }, 40_000);

  it('a stale hidden answer (planted behind the API’s back) is deleted by the member’s next save of any step, and an optional dependent turned visible by a clear keeps nothing', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await branch();
      const other = await seedQ('other', { stepId: f.s1, position: 4 });
      // Opener "Não" plus a dependent answer that should not exist: stored does not equal visible.
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: f.opener,
        userId: member.userId,
        value: choose(f.no),
      });
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: f.dependent,
        userId: member.userId,
        value: 'sobrou',
      });
      const form = await readForm(member);

      await saved(await save(member, form, { [other]: 'qualquer' }, f.s1));
      expect((await storedAnswers(member.userId)).map((row) => row.question_id).sort()).toEqual(
        [f.opener, other].sort(),
      );
    });
  }, 30_000);
});

describe('12.1-11 PFORM-33: idempotency, and two saves of one member leave a consistent store', () => {
  it('unchanged values are not rewritten (updated_at stays), answers: {} writes nothing and answers the current counts and ids', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const { s1, a, late } = await twoSteps();
      const form = await readForm(member);

      const first = await saved(await save(member, form, { [a]: 'Ana' }, s1));
      const stamp = await mark(a, member.userId);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = await saved(await save(member, form, { [a]: 'Ana' }, s1));
      expect(second).toEqual(first);
      expect(await mark(a, member.userId)).toEqual(stamp);

      // A changed value is written (updated_at moves).
      await saved(await save(member, form, { [a]: 'Ana Maria' }, s1));
      expect((await mark(a, member.userId))?.getTime()).toBeGreaterThan(stamp?.getTime() ?? 0);

      const empty = await saved(await save(member, form, {}));
      expect(empty).toEqual({ missingRequired: 1, missingQuestionIds: [late] });
      expect(await storedAnswers(member.userId)).toHaveLength(1);
    });
  }, 40_000);

  it('the report lists the visible required questions in form order and matches the read: a required dependent is owed only while its opener matches', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await branch({ dependentRequired: true });
      const s2 = await seedStep('S2');
      const tail = await seedQ('tail', { stepId: s2, position: 5, required: true });
      const form = await readForm(member);
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: f.opener,
        userId: member.userId,
        value: choose(f.yes),
      });

      const open = await saved(await save(member, form, {}));
      expect(open).toEqual({ missingRequired: 2, missingQuestionIds: [f.dependent, tail] });
      expect((await readForm(member)).missingRequired).toBe(2);

      const closed = await saved(await save(member, form, { [f.opener]: choose(f.no) }, f.s1));
      expect(closed).toEqual({ missingRequired: 1, missingQuestionIds: [tail] });
      expect((await readForm(member)).missingRequired).toBe(1);
    });
  }, 30_000);

  it('two simultaneous saves of one member end with a consistent store: no answer to a closed question remains whichever wins', async () => {
    await withProfileForm(labTenantId, async () => {
      const f = await branch();
      for (let round = 0; round < 3; round += 1) {
        const member = await person();
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: f.opener,
          userId: member.userId,
          value: choose(f.yes),
        });
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: f.dependent,
          userId: member.userId,
          value: 'antiga',
        });
        const form = await readForm(member);

        const [close, rewrite] = await Promise.all([
          save(member, form, { [f.opener]: choose(f.no) }, f.s1),
          save(member, form, { [f.dependent]: 'nova' }, f.s1),
        ]);
        expect(close.status, `round ${round}: ${await close.clone().text()}`).toBe(200);
        expect(rewrite.status, `round ${round}: ${await rewrite.clone().text()}`).toBe(200);
        const rows = await storedAnswers(member.userId);
        expect(
          rows.map((row) => row.question_id),
          `round ${round}`,
        ).toEqual([f.opener]);
        expect(rows[0]?.value).toEqual(choose(f.no));
      }
    });
  }, 60_000);
});

// ── Task 3: the notice counts only what the member sees ─────────────────────────────────────────────

describe('12.1-11 D-586 (informational): newOptional counts an optional conditional question only for a member who sees it', () => {
  it('counts it for a member whose opener answer matches and not for one whose opener answer differs or is absent', async () => {
    const matching = await person();
    const different = await person();
    const absent = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await branch();
      const plain = await seedQ('plain optional', { stepId: f.s1, position: 4, required: false });
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: f.opener,
        userId: matching.userId,
        value: choose(f.yes),
      });
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: f.opener,
        userId: different.userId,
        value: choose(f.no),
      });

      const newOptional = async (who: Person) => {
        const res = await call(who, 'GET', '/v1/me/bootstrap');
        expect(res.status).toBe(200);
        return ((await res.json()) as { profileForm?: { newOptional: number } }).profileForm
          ?.newOptional;
      };
      // The unconditional optional question counts for everyone; the conditional one only for "Sim".
      expect(await newOptional(matching)).toBe(2);
      expect(await newOptional(different)).toBe(1);
      expect(await newOptional(absent)).toBe(1);
      expect(plain).not.toBe(f.dependent);

      // Answering the conditional question takes it out of her count.
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: f.dependent,
        userId: matching.userId,
        value: 'sim',
      });
      expect(await newOptional(matching)).toBe(1);
    });
  }, 40_000);
});

// ── 12.2-10 tracer: a depth-3 tree is read, a save closes the top branch and nothing is held below it ─────

const BRANCH_NAME = 'pfs NOME-SECRETO-DO-RAMO';

type Deep = {
  s1: string;
  s2: string;
  q1: string;
  tem: string;
  trabalha: string;
  q2: string;
  q2Yes: string;
  q3: string;
  q3Yes: string;
  q4: string;
  q5: string;
  q6: string;
  u: string;
  b1: string;
  b2: string;
  b3: string;
};

/**
 * The clinic tree, three levels, in one step and in tree order:
 *   Q1 (opener: tem | trabalha)
 *   B1 on Q1 = tem        holds Q2 (opener), Q6
 *   B2 on Q2 = Q2Yes      holds Q3 (opener), Q5
 *   B3 on Q3 = Q3Yes      holds Q4
 *   U, unconditional
 * Every branch carries a name that no member or staff body may ever show.
 */
async function deepTree(
  over: { requiredBelow?: boolean; belowStep?: boolean } = {},
): Promise<Deep> {
  const s1 = await seedStep('S1');
  // `belowStep` puts the questions under the branches in a LATER step, so a save of step 1 reports what is
  // owed there instead of refusing it (D-629).
  const s2 = over.belowStep ? await seedStep('S2') : s1;
  const [tem, trabalha, q2Yes, q2No, q3Yes, q3No] = Array.from({ length: 6 }, () =>
    crypto.randomUUID(),
  ) as [string, string, string, string, string, string];
  const required = over.requiredBelow ?? false;
  const q1 = await seedQ('Q1', {
    type: 'single_choice',
    stepId: s1,
    position: 1,
    options: [
      { id: tem, label: 'Tem' },
      { id: trabalha, label: 'Trabalha' },
    ],
  });
  const b1 = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: q1,
    values: [tem],
    name: BRANCH_NAME,
  });
  const q2 = await seedQ('Q2', {
    type: 'single_choice',
    stepId: s1,
    position: 2,
    branchId: b1,
    options: [
      { id: q2Yes, label: 'Sim' },
      { id: q2No, label: 'Não' },
    ],
  });
  const b2 = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: q2,
    values: [q2Yes],
    name: BRANCH_NAME,
  });
  const q3 = await seedQ('Q3', {
    type: 'single_choice',
    stepId: s1,
    position: 3,
    branchId: b2,
    options: [
      { id: q3Yes, label: 'Sim' },
      { id: q3No, label: 'Não' },
    ],
  });
  const b3 = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: q3,
    values: [q3Yes],
    name: BRANCH_NAME,
  });
  const q4 = await seedQ('Q4', { stepId: s2, position: 4, branchId: b3, required });
  const q5 = await seedQ('Q5', { stepId: s2, position: 5, branchId: b2, required });
  const q6 = await seedQ('Q6', { stepId: s2, position: 6, branchId: b1, required });
  const u = await seedQ('U', { stepId: s1, position: 7 });
  return {
    s1,
    s2,
    q1,
    tem,
    trabalha,
    q2,
    q2Yes,
    q3,
    q3Yes,
    q4,
    q5,
    q6,
    u,
    b1,
    b2,
    b3,
  };
}

/** Plants one member's answers to the whole open tree: every level open, every question answered. */
async function answerWholeTree(f: Deep, userId: string): Promise<void> {
  const put = (questionId: string, value: unknown) =>
    seedProfileFormAnswer({ tenantId: labTenantId, questionId, userId, value });
  await put(f.q1, choose(f.tem));
  await put(f.q2, choose(f.q2Yes));
  await put(f.q3, choose(f.q3Yes));
  await put(f.q4, 'quatro');
  await put(f.q5, 'cinco');
  await put(f.q6, 'seis');
  await put(f.u, 'incondicional');
}

describe('12.2-10 tracer: a depth-3 form is read with its tree and a save that closes the top branch leaves nothing below it (D-641, D-644, D-645)', () => {
  it('reads every question with its branchId, the three ACTIVE branches in the strict member shape, and no branch name anywhere in the body', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree();
      const res = await call(member, 'GET', '/v1/me/profile-form');
      expect(res.status).toBe(200);
      const text = await res.text();
      // T-12.2-03: the stored name is nowhere in the serialized body.
      expect(text).not.toContain('NOME-SECRETO');
      const form = JSON.parse(text) as Form;
      expect(form.questions.map((q) => [q.id, q.branchId])).toEqual([
        [f.q1, null],
        [f.q2, f.b1],
        [f.q3, f.b2],
        [f.q4, f.b3],
        [f.q5, f.b2],
        [f.q6, f.b1],
        [f.u, null],
      ]);
      expect(form.branches).toHaveLength(3);
      // The exact keys of the strict shape, nothing else.
      for (const branch of form.branches) {
        expect(Object.keys(branch).sort()).toEqual(['id', 'openerQuestionId', 'values']);
      }
      expect(form.branches.find((b) => b.id === f.b2)).toEqual({
        id: f.b2,
        openerQuestionId: f.q2,
        values: [f.q2Yes],
      });
      // Nothing is required, so the form reads `edit` and owes nothing.
      expect(form.mode).toBe('edit');
      expect(form.missingRequired).toBe(0);
    });
  }, 30_000);

  it('a save of step 1 that changes Q1 from tem to trabalha deletes the answers of Q2 to Q6 in the same transaction and keeps Q1, the unconditional one and another member', async () => {
    const member = await person();
    const bystander = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree();
      for (const who of [member, bystander]) await answerWholeTree(f, who.userId);
      const form = await readForm(member);

      const result = await saved(await save(member, form, { [f.q1]: choose(f.trabalha) }, f.s1));
      expect(result).toEqual({ missingRequired: 0, missingQuestionIds: [] });
      expect(
        (await storedAnswers(member.userId)).map((row) => [row.question_id, row.value]),
      ).toEqual(
        [
          [f.q1, choose(f.trabalha)],
          [f.u, 'incondicional'],
        ].sort(([x], [y]) => String(x).localeCompare(String(y))),
      );
      // Another member's answers are untouched, every level included.
      expect((await storedAnswers(bystander.userId)).map((row) => row.question_id).sort()).toEqual(
        [f.q1, f.q2, f.q3, f.q4, f.q5, f.q6, f.u].sort(),
      );

      // PFORM-33: the same body again writes nothing and the second purge deletes nothing.
      const stamp = await mark(f.u, member.userId);
      const again = await saved(await save(member, form, { [f.q1]: choose(f.trabalha) }, f.s1));
      expect(again).toEqual(result);
      expect(await mark(f.u, member.userId)).toEqual(stamp);
      expect(await storedAnswers(member.userId)).toHaveLength(2);
    });
  }, 40_000);

  it('a value sent for a hidden question is ignored with no error, and the same value is stored once the chain opens in the same save', async () => {
    const closed = await person();
    const opened = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree();
      const form = await readForm(closed);

      // Q1 = trabalha closes B1: Q2 and Q3 (valid values) are dropped without an error.
      const ignored = await saved(
        await save(
          closed,
          form,
          { [f.q1]: choose(f.trabalha), [f.q2]: choose(f.q2Yes), [f.q3]: choose(f.q3Yes) },
          f.s1,
        ),
      );
      expect(ignored).toEqual({ missingRequired: 0, missingQuestionIds: [] });
      expect((await storedAnswers(closed.userId)).map((row) => row.question_id)).toEqual([f.q1]);

      // Positive control: tem + Q2 yes + Q3 yes opens all three levels IN THE SAME REQUEST, so Q4 is stored.
      const stored = await saved(
        await save(
          opened,
          form,
          {
            [f.q1]: choose(f.tem),
            [f.q2]: choose(f.q2Yes),
            [f.q3]: choose(f.q3Yes),
            [f.q4]: 'fundo',
          },
          f.s1,
        ),
      );
      expect(stored).toEqual({ missingRequired: 0, missingQuestionIds: [] });
      expect((await storedAnswers(opened.userId)).map((row) => row.question_id).sort()).toEqual(
        [f.q1, f.q2, f.q3, f.q4].sort(),
      );
    });
  }, 40_000);

  it('the formEtag changes when a branch is edited, so a member who opened the form first gets 409 form_changed with the fresh form and no name', async () => {
    const admin = await person('admin_tenant');
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree();
      const stale = await readForm(member);

      const [branch] = await adminSql<{ revision: number }[]>`
        select revision from public.profile_form_branches where id = ${f.b1}::uuid`;
      const edited = await call(admin, 'PATCH', `/v1/profile_form/branches/${f.b1}`, {
        revision: branch?.revision,
        values: [f.tem, f.trabalha],
      });
      expect(edited.status, await edited.clone().text()).toBe(200);

      const fresh = await readForm(member);
      expect(fresh.formEtag).not.toBe(stale.formEtag);

      const res = await save(member, stale, { [f.q1]: choose(f.tem) }, f.s1);
      expect(res.status).toBe(409);
      const text = await res.text();
      expect(text).not.toContain('NOME-SECRETO');
      const error = (JSON.parse(text) as Envelope).error;
      expect(error.code).toBe('CONFLICT');
      expect(error.details).toMatchObject({ profileForm: 'form_changed' });
      const body = (error.details as { form: Form }).form;
      expect(body.formEtag).toBe(fresh.formEtag);
      expect(body.branches.find((b) => b.id === f.b1)?.values).toEqual([f.tem, f.trabalha]);
      expect(await storedAnswers(member.userId)).toEqual([]);
    });
  }, 40_000);

  it('WR-02 renaming a branch (a label members never see) leaves the formEtag unchanged, so an in-flight save is not refused', async () => {
    const admin = await person('admin_tenant');
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree();
      const before = await readForm(member);

      const [branch] = await adminSql<{ revision: number }[]>`
        select revision from public.profile_form_branches where id = ${f.b1}::uuid`;
      const renamed = await call(admin, 'PATCH', `/v1/profile_form/branches/${f.b1}`, {
        revision: branch?.revision,
        name: 'Outro nome interno',
      });
      expect(renamed.status, await renamed.clone().text()).toBe(200);

      expect((await readForm(member)).formEtag).toBe(before.formEtag);
      const res = await save(member, before, { [f.q1]: choose(f.tem) }, f.s1);
      expect(res.status, await res.clone().text()).not.toBe(409);
    });
  }, 40_000);

  it('a form without branches has the formEtag that 12.1 computed for the same questions and steps', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const s1 = await seedStep('S1');
      const a = await seedQ('A', { stepId: s1, position: 1 });
      const b = await seedQ('B', { stepId: s1, position: 2 });
      const form = await readForm(member);
      expect(form.branches).toEqual([]);
      const rows = await adminSql<{ id: string; revision: number }[]>`
        select id::text as id, revision from public.profile_form_questions
         where id in (${a}::uuid, ${b}::uuid) order by position`;
      const [step] = await adminSql<{ revision: number }[]>`
        select revision from public.profile_form_steps where id = ${s1}::uuid`;
      // The 12.1 text, written out: `id:revision:step` per question, then `;steps=id:revision`.
      const text = `${rows.map((r) => `${r.id}:${r.revision}:${s1}`).join('|')};steps=${s1}:${step?.revision}`;
      const { createHash } = await import('node:crypto');
      expect(form.formEtag).toBe(createHash('sha256').update(text).digest('hex').slice(0, 16));
    });
  }, 30_000);
});

// ── 12.2-10 Task 2: the report is the SQL count, in form order, through every level (D-644, PFORM-52) ─────

/** `app.profile_form_missing(tenant, membership)`: the SQL gate's own count for one member. */
const sqlMissing = async (userId: string): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select app.profile_form_missing(m.tenant_id, m.id)::int as n
      from public.memberships m
     where m.tenant_id = ${labTenantId}::uuid and m.user_id = ${userId}::uuid and m.deleted_at is null`;
  return row?.n ?? -1;
};

describe('12.2-10 D-644: missingQuestionIds is the visible required questions in form order and equals the SQL gate (PFORM-51 ordering, precision)', () => {
  it('opening and closing branches level by level moves the report, its length equals missingRequired and the SQL count after every save', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree({ requiredBelow: true, belowStep: true });
      const form = await readForm(member);
      const q2 = choose(f.q2Yes);
      const q3 = choose(f.q3Yes);

      // Nothing below is owed while the top branch is shut.
      const none = await saved(await save(member, form, {}));
      expect(none).toEqual({ missingRequired: 0, missingQuestionIds: [] });

      // Q1 tem, Q2 sim, Q3 sim: three levels open, Q4 Q5 Q6 owed, in the order of their positions.
      const open = await saved(
        await save(member, form, { [f.q1]: choose(f.tem), [f.q2]: q2, [f.q3]: q3 }, f.s1),
      );
      expect(open).toEqual({ missingRequired: 3, missingQuestionIds: [f.q4, f.q5, f.q6] });
      expect(await sqlMissing(member.userId)).toBe(3);
      expect(open.missingQuestionIds.length).toBe(open.missingRequired);

      // Closing the innermost branch (Q3 = não) takes Q4 out; the report and the SQL drop together.
      const no = form.questions.find((q) => q.id === f.q3)?.options.find((o) => o.label === 'Não')
        ?.id as string;
      const inner = await saved(await save(member, form, { [f.q3]: choose(no) }, f.s1));
      expect(inner).toEqual({ missingRequired: 2, missingQuestionIds: [f.q5, f.q6] });
      expect(await sqlMissing(member.userId)).toBe(2);

      // Closing the top branch takes everything out.
      const top = await saved(await save(member, form, { [f.q1]: choose(f.trabalha) }, f.s1));
      expect(top).toEqual({ missingRequired: 0, missingQuestionIds: [] });
      expect(await sqlMissing(member.userId)).toBe(0);
      expect((await readForm(member)).missingRequired).toBe(0);
    });
  }, 60_000);

  it('two required questions with the same position are reported by created_at then id, the same every time', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree({ requiredBelow: true, belowStep: true });
      // Two more required questions in B1 at the very position of Q6.
      const extra1 = await seedQ('E1', {
        stepId: f.s2,
        position: 6,
        branchId: f.b1,
        required: true,
      });
      const extra2 = await seedQ('E2', {
        stepId: f.s2,
        position: 6,
        branchId: f.b1,
        required: true,
      });
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: f.q1,
        userId: member.userId,
        value: choose(f.tem),
      });
      const form = await readForm(member);

      const expected = (
        await adminSql<{ id: string }[]>`
          select id::text as id from public.profile_form_questions
           where id in (${f.q6}::uuid, ${extra1}::uuid, ${extra2}::uuid)
           order by position, created_at, id`
      ).map((row) => row.id);
      const first = await saved(await save(member, form, {}));
      const second = await saved(await save(member, form, {}));
      expect(first.missingQuestionIds).toEqual(expected);
      expect(second).toEqual(first);
      expect(first.missingRequired).toBe(3);
      expect(await sqlMissing(member.userId)).toBe(3);
    });
  }, 40_000);

  it('one save that closes branch A and opens branch B applies both openers in form order: B takes its value, A is ignored and purged (PFORM-51 adjacency)', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const s1 = await seedStep('S1');
      const [a1, a2, b1o, b2o] = Array.from({ length: 4 }, () => crypto.randomUUID()) as [
        string,
        string,
        string,
        string,
      ];
      const openerA = await seedQ('openerA', {
        type: 'single_choice',
        stepId: s1,
        position: 1,
        options: [
          { id: a1, label: 'Sim' },
          { id: a2, label: 'Não' },
        ],
      });
      const openerB = await seedQ('openerB', {
        type: 'single_choice',
        stepId: s1,
        position: 2,
        options: [
          { id: b1o, label: 'Sim' },
          { id: b2o, label: 'Não' },
        ],
      });
      const branchA = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: openerA,
        values: [a1],
      });
      const branchB = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: openerB,
        values: [b1o],
      });
      const underA = await seedQ('underA', { stepId: s1, position: 3, branchId: branchA });
      const underB = await seedQ('underB', { stepId: s1, position: 4, branchId: branchB });
      for (const [questionId, value] of [
        [openerA, choose(a1)],
        [openerB, choose(b2o)],
        [underA, 'antiga'],
      ] as const) {
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId,
          userId: member.userId,
          value,
        });
      }
      const form = await readForm(member);

      const result = await saved(
        await save(
          member,
          form,
          { [openerA]: choose(a2), [openerB]: choose(b1o), [underA]: 'nova', [underB]: 'abriu' },
          s1,
        ),
      );
      expect(result).toEqual({ missingRequired: 0, missingQuestionIds: [] });
      expect(
        (await storedAnswers(member.userId)).map((row) => [row.question_id, row.value]),
      ).toEqual(
        [
          [openerA, choose(a2)],
          [openerB, choose(b1o)],
          [underB, 'abriu'],
        ].sort(([x], [y]) => String(x).localeCompare(String(y))),
      );
    });
  }, 40_000);

  it('a form of 30 questions with 15 branches reads and saves; 30 answers pass and a 31st key is refused (PFORM-51 boundary)', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const s1 = await seedStep('S1');
      const openers: { id: string; yes: string }[] = [];
      const under: string[] = [];
      for (let index = 0; index < 15; index += 1) {
        const yes = crypto.randomUUID();
        const id = await seedQ(`o${index}`, {
          type: 'single_choice',
          stepId: s1,
          position: index * 2 + 1,
          options: [
            { id: yes, label: 'Sim' },
            { id: crypto.randomUUID(), label: 'Não' },
          ],
        });
        const branch = await seedProfileFormBranch({
          tenantId: labTenantId,
          openerQuestionId: id,
          values: [yes],
        });
        openers.push({ id, yes });
        under.push(
          await seedQ(`u${index}`, { stepId: s1, position: index * 2 + 2, branchId: branch }),
        );
      }
      const form = await readForm(member);
      expect(form.questions).toHaveLength(30);
      expect(form.branches).toHaveLength(15);
      expect(form.formEtag).toMatch(/^[0-9a-f]{16}$/);

      const everything: Record<string, unknown> = {};
      for (const [index, opener] of openers.entries()) {
        everything[opener.id] = choose(opener.yes);
        everything[under[index] as string] = `texto ${index}`;
      }
      expect(Object.keys(everything)).toHaveLength(30);
      const ok = await saved(await save(member, form, everything));
      expect(ok).toEqual({ missingRequired: 0, missingQuestionIds: [] });
      expect(await storedAnswers(member.userId)).toHaveLength(30);

      const tooMany = { ...everything, [crypto.randomUUID()]: 'a mais' };
      expect(Object.keys(tooMany)).toHaveLength(31);
      const refused = await save(member, form, tooMany);
      expect(refused.status).toBe(400);
      expect(await storedAnswers(member.userId)).toHaveLength(30);
    });
  }, 90_000);
});
