import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removeProfileFormByPrefix,
  seedProfileFormAnswer,
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
type Condition = { questionId: string; values: string[] };
type FormQuestion = {
  id: string;
  type: string;
  title: string;
  required: boolean;
  stepId: string;
  condition: Condition | null;
  options: { id: string; label: string }[];
  answer: unknown;
};
type Form = {
  mode: 'none' | 'first' | 'returning' | 'edit';
  missingRequired: number;
  formEtag: string;
  steps: { id: string; title: string }[];
  questions: FormQuestion[];
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
  it('reads EVERY active question with stepId and condition, the shown steps in order, and no empty step', async () => {
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
      const dependent = await seedQ('dependent', {
        stepId: s2,
        position: 2,
        conditionQuestionId: opener,
        conditionValues: [yes?.id as string],
      });
      const plain = await seedQ('plain', { stepId: s2, position: 3 });
      await seedQ('archived', { stepId: onlyArchived, position: 4, archived: true });

      const form = await readForm(member);
      expect(form.steps).toEqual([
        { id: s1, title: `${TITLE}S1` },
        { id: s2, title: `${TITLE}S2` },
      ]);
      expect(form.steps.map((step) => step.id)).not.toContain(empty);
      expect(form.steps.map((step) => step.id)).not.toContain(onlyArchived);
      // The hidden dependent is in the read: the client reveals it live (D-630).
      expect(form.questions.map((q) => [q.id, q.stepId, q.condition])).toEqual([
        [opener, s1, null],
        [dependent, s2, { questionId: opener, values: [yes?.id] }],
        [plain, s2, null],
      ]);
      expect(form.formEtag).toMatch(/^[0-9a-f]{16}$/);
      // Reading again changes nothing: the etag is a pure function of the stored form.
      expect((await readForm(member)).formEtag).toBe(form.formEtag);
    });
  }, 30_000);

  it('the formEtag differs after a question moves to another step even when the global order is unchanged, after a step rename and after a condition edit', async () => {
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

      // A condition edit bumps the question's revision.
      const [q] = await adminSql<{ revision: number }[]>`
        select revision from public.profile_form_questions where id = ${c}::uuid`;
      const conditioned = await call(admin, 'PATCH', `/v1/profile_form/questions/${c}`, {
        revision: q?.revision,
        condition: { questionId: opener, values: ['true'] },
      });
      expect(conditioned.status, await conditioned.clone().text()).toBe(200);
      const afterCondition = await readForm(member);
      expect(afterCondition.questions.find((x) => x.id === c)?.condition).toEqual({
        questionId: opener,
        values: ['true'],
      });
      expect(afterCondition.formEtag).not.toBe(afterRename.formEtag);
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
  const dependent = await seedQ('dependent', {
    stepId: s1,
    position: 2,
    required: over.dependentRequired ?? false,
    conditionQuestionId: opener,
    conditionValues: [yes],
  });
  const archivedDependent = await seedQ('archived dependent', {
    stepId: s1,
    position: 3,
    archived: true,
    conditionQuestionId: opener,
    conditionValues: [yes],
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
