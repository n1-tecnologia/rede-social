import { memberFormSchema } from '@rede-social/contracts/profile-form';
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
 * 12-06 (PFORM-06, PFORM-07, PFORM-09, PFORM-13, PFORM-14, PFORM-16, PFORM-24; D-580, D-582, D-585, D-586)
 * against the live local stack: the member's side of the profile form. Read the whole form pre-filled, save
 * the whole screen at once, dismiss the "new optional questions" notice.
 *
 * EVERY identity is a THROWAWAY (`createSharedIdentity`, prefix `pfm`); questions carry the title prefix
 * `pfm ` so the sweep removes only this file's rows. The module row is restored by `withProfileForm`.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
type FormQuestion = {
  id: string;
  type: string;
  title: string;
  required: boolean;
  options: { id: string; label: string }[];
  answer: unknown;
};
type Form = {
  mode: 'none' | 'first' | 'returning' | 'edit';
  missingRequired: number;
  formEtag: string;
  questions: FormQuestion[];
};

const PREFIX = 'pfm';
const TITLE = 'pfm ';
let labTenantId = '';
let demoTenantId = '';
let adminUserId = '';

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
  method: 'GET' | 'PUT' | 'POST',
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

const readForm = async (p: Person): Promise<Form> => {
  const res = await call(p, 'GET', '/v1/me/profile-form');
  expect(res.status).toBe(200);
  return (await res.json()) as Form;
};

const save = (p: Person, form: Pick<Form, 'formEtag'>, answers: Record<string, unknown>) =>
  call(p, 'PUT', '/v1/me/profile-form/answers', { formEtag: form.formEtag, answers });

const question = (over: Partial<Parameters<typeof seedProfileFormQuestion>[0]> = {}) =>
  seedProfileFormQuestion({
    tenantId: labTenantId,
    adminUserId,
    title: `${TITLE}${crypto.randomUUID().slice(0, 8)}`,
    required: true,
    ...over,
  });

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

describe('12-06 tracer: a member reads the form, answers it and the gate lets her through', () => {
  it('reads (first), saves one required short-text answer, passes the gate, re-reads it pre-filled (edit)', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const id = await question({ title: `${TITLE}Como você chegou aqui?` });

      // The gate holds her until she answers.
      expect((await call(member, 'GET', '/v1/me/profile')).status).toBe(403);

      const form = await readForm(member);
      expect(form.mode).toBe('first');
      expect(form.missingRequired).toBe(1);
      expect(form.formEtag).toMatch(/^[0-9a-f]{16}$/);
      expect(form.questions).toHaveLength(1);
      expect(form.questions[0]).toMatchObject({
        id,
        type: 'short_text',
        required: true,
        answer: null,
      });

      const saved = await save(member, form, { [id]: '  Um amigo me indicou  ' });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toEqual({ missingRequired: 0, missingQuestionIds: [] });

      // Stored trimmed, as the validator returns it.
      const [row] = await adminSql<{ value: unknown }[]>`
        select value from public.profile_form_answers where question_id = ${id}::uuid`;
      expect(row?.value).toBe('Um amigo me indicou');

      // The gate (plan 05) lets her through and the bootstrap block reads 0.
      expect((await call(member, 'GET', '/v1/me/profile')).status).toBe(200);
      const bootstrap = (await (await call(member, 'GET', '/v1/me/bootstrap')).json()) as {
        profileForm?: { pendingRequired: number; newOptional: number };
      };
      expect(bootstrap.profileForm).toEqual({ pendingRequired: 0, newOptional: 0 });

      // The later edit is the same read: pre-filled, mode edit.
      const again = await readForm(member);
      expect(again.mode).toBe('edit');
      expect(again.missingRequired).toBe(0);
      expect(again.questions[0]?.answer).toBe('Um amigo me indicou');
      expect(again.formEtag).toBe(form.formEtag);
    });
  });

  it('a save that leaves a required question unanswered is refused, keyed by question id, and keeps what was there', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const first = await question({ position: 0 });
      const second = await question({ position: 1 });
      const form = await readForm(member);
      expect(form.mode).toBe('first');

      const res = await save(member, form, { [first]: 'resposta' });
      expect(res.status).toBe(400);
      const payload = (await res.json()) as Envelope;
      expect(payload.error.code).toBe('VALIDATION_FAILED');
      expect(payload.error.details).toEqual({
        profileForm: 'answers_invalid',
        errors: { [second]: 'required' },
      });
      // No partial write: the valid answer of the refused request is not stored either.
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.profile_form_answers
         where question_id in (${first}::uuid, ${second}::uuid)`;
      expect(row?.n).toBe(0);

      const ok = await save(member, form, { [first]: 'a', [second]: 'b' });
      expect(ok.status).toBe(200);
      const after = await readForm(member);
      expect(after.mode).toBe('edit');
      expect(after.questions.map((q) => q.answer)).toEqual(['a', 'b']);
    });
  });

  it('an existing member who answered some questions is `returning` while a required one is missing', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const kept = await question({ position: 0 });
      const form = await readForm(member);
      await save(member, form, { [kept]: 'guardada' });

      // The admin adds a required question later: only that one is asked, the kept answer comes back filled.
      const added = await question({ position: 1 });
      const returning = await readForm(member);
      expect(returning.mode).toBe('returning');
      expect(returning.missingRequired).toBe(1);
      expect(returning.questions.map((q) => [q.id, q.answer])).toEqual([
        [kept, 'guardada'],
        [added, null],
      ]);
      // The pre-change etag is now stale.
      expect(returning.formEtag).not.toBe(form.formEtag);
    });
  });
});

// ── 12-06 Task 2: all thirteen types over the wire, every refusal keyed by question id ──────────────

const UNKNOWN_OPTION = '00000000-0000-4000-8000-00000000dead';
const OPT_A = crypto.randomUUID();
const OPT_B = crypto.randomUUID();
const OPTIONS = [
  { id: OPT_A, label: 'Alfa' },
  { id: OPT_B, label: 'Beta' },
];

type TypeCase = {
  type: string;
  seed: Partial<Parameters<typeof seedProfileFormQuestion>[0]>;
  /** What the member sends, and what the database must hold afterwards. */
  valid: { send: unknown; stored: unknown };
  /** One refusal per issue code reachable for this type. */
  bad: [issue: string, send: unknown][];
};

const CASES: TypeCase[] = [
  {
    type: 'short_text',
    seed: {},
    valid: { send: '  Maria  ', stored: 'Maria' },
    bad: [
      ['too_long', 'x'.repeat(121)],
      ['invalid', 42],
    ],
  },
  {
    type: 'long_text',
    seed: {},
    valid: { send: 'linha 1\nlinha 2', stored: 'linha 1\nlinha 2' },
    bad: [
      ['too_long', 'y'.repeat(1001)],
      ['invalid', true],
    ],
  },
  {
    type: 'dropdown',
    seed: { options: OPTIONS },
    valid: { send: OPT_A, stored: { optionId: OPT_A, otherText: null } },
    bad: [
      ['unknown_option', UNKNOWN_OPTION],
      ['invalid', 5],
      ['other_not_allowed', { optionId: null, otherText: 'qualquer' }],
    ],
  },
  {
    type: 'multiple_choice',
    seed: { options: OPTIONS },
    valid: { send: [OPT_B, OPT_A], stored: { optionIds: [OPT_A, OPT_B], otherText: null } },
    bad: [
      ['unknown_option', [OPT_A, UNKNOWN_OPTION]],
      ['other_not_allowed', { optionIds: [OPT_A], otherText: 'Outro tema' }],
    ],
  },
  {
    type: 'single_choice',
    seed: { options: OPTIONS },
    valid: { send: OPT_B, stored: { optionId: OPT_B, otherText: null } },
    bad: [
      ['invalid', [OPT_A, OPT_B]],
      ['unknown_option', UNKNOWN_OPTION],
    ],
  },
  {
    type: 'number',
    seed: { limits: { min: 1, max: 10 } },
    valid: { send: 5, stored: 5 },
    bad: [
      ['out_of_range', 11],
      ['invalid', '5'],
    ],
  },
  {
    type: 'date',
    seed: { limits: { min: '2020-01-01', max: '2030-12-31' } },
    valid: { send: '2025-06-15', stored: '2025-06-15' },
    bad: [
      ['out_of_range', '2031-01-01'],
      ['invalid', '15/06/2025'],
    ],
  },
  {
    type: 'phone',
    seed: {},
    valid: { send: '11987654321', stored: '11987654321' },
    bad: [['invalid', '123']],
  },
  {
    type: 'email',
    seed: {},
    valid: { send: ' Ana@Exemplo.com.br ', stored: 'ana@exemplo.com.br' },
    bad: [
      ['invalid', 'sem-arroba'],
      ['too_long', `${'a'.repeat(250)}@x.com`],
    ],
  },
  {
    type: 'link',
    seed: {},
    valid: {
      send: 'https://exemplo.com.br/perfil?x=1',
      stored: 'https://exemplo.com.br/perfil?x=1',
    },
    bad: [['invalid', 'javascript:alert(1)']],
  },
  {
    type: 'yes_no',
    seed: {},
    valid: { send: false, stored: false },
    bad: [['invalid', 'sim']],
  },
  {
    type: 'acceptance',
    seed: {},
    valid: { send: true, stored: true },
    bad: [['invalid', 'sim']],
  },
  {
    type: 'rating',
    seed: {},
    valid: { send: 4, stored: 4 },
    bad: [
      ['out_of_range', 6],
      ['invalid', 3.5],
    ],
  },
];

const storedAnswer = async (questionId: string): Promise<unknown> => {
  const [row] = await adminSql<{ value: unknown }[]>`
    select value from public.profile_form_answers where question_id = ${questionId}::uuid`;
  return row?.value;
};

const answerRows = async (): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.profile_form_answers
     where question_id in (select id from public.profile_form_questions where title like ${`${TITLE}%`})`;
  return row?.n ?? 0;
};

describe('12-06 every type round-trips (PFORM-07)', () => {
  it.each(CASES)(
    '$type: a valid answer is stored in its canonical shape and read back pre-filled',
    async (c) => {
      const member = await person();
      await withProfileForm(labTenantId, async () => {
        const id = await question({ type: c.type, required: false, ...c.seed });
        const form = await readForm(member);
        const res = await save(member, form, { [id]: c.valid.send });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ missingRequired: 0, missingQuestionIds: [] });
        expect(await storedAnswer(id)).toEqual(c.valid.stored);
        const again = await readForm(member);
        expect(again.questions.find((q) => q.id === id)?.answer).toEqual(c.valid.stored);
      });
    },
  );

  it('multiple choice with "Outro": the text is stored inside the answer value', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const id = await question({
        type: 'multiple_choice',
        required: false,
        options: OPTIONS,
        allowOther: true,
      });
      const form = await readForm(member);
      const res = await save(member, form, {
        [id]: { optionIds: [OPT_A], otherText: '  Outro tema ' },
      });
      expect(res.status).toBe(200);
      expect(await storedAnswer(id)).toEqual({ optionIds: [OPT_A], otherText: 'Outro tema' });
      // "Outro" alone, with no option ticked, is also an answer.
      const alone = await save(member, form, { [id]: { optionIds: [], otherText: 'Só isto' } });
      expect(alone.status).toBe(200);
      expect(await storedAnswer(id)).toEqual({ optionIds: [], otherText: 'Só isto' });
    });
  });

  it('single choice with "Outro": the free text replaces the option', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const id = await question({
        type: 'single_choice',
        required: false,
        options: OPTIONS,
        allowOther: true,
      });
      const form = await readForm(member);
      const res = await save(member, form, {
        [id]: { optionId: null, otherText: 'Minha resposta' },
      });
      expect(res.status).toBe(200);
      expect(await storedAnswer(id)).toEqual({ optionId: null, otherText: 'Minha resposta' });
    });
  });
});

describe('12-06 every refusal is keyed by question id and writes nothing (PFORM-07, T-12-14)', () => {
  it.each(CASES)(
    '$type: each refusal names the question and the reason, and a valid sibling answer is not written',
    async (c) => {
      const member = await person();
      await withProfileForm(labTenantId, async () => {
        const id = await question({ type: c.type, required: false, position: 1, ...c.seed });
        const sibling = await question({ type: 'short_text', required: false, position: 0 });
        const form = await readForm(member);
        for (const [issue, send] of c.bad) {
          const res = await save(member, form, { [sibling]: 'valido', [id]: send });
          expect(res.status, `${c.type} ${issue}`).toBe(400);
          const payload = (await res.json()) as Envelope;
          expect(payload.error.code).toBe('VALIDATION_FAILED');
          expect(payload.error.details, `${c.type} ${issue}`).toEqual({
            profileForm: 'answers_invalid',
            errors: { [id]: issue },
          });
          // Atomic: neither the invalid nor the valid answer of the refused request was written.
          expect(await answerRows(), `${c.type} ${issue}`).toBe(0);
        }
      });
    },
  );

  it('an unknown id, an archived question and another tenant’s question are all unknown_question, and nothing is written in either tenant', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const live = await question({ required: false, position: 0 });
      const archived = await question({ required: false, archived: true });
      const foreign = await seedProfileFormQuestion({
        tenantId: demoTenantId,
        adminUserId,
        title: `${TITLE}foreign`,
        required: false,
      });
      const never = crypto.randomUUID();
      const form = await readForm(member);

      const res = await save(member, form, {
        [live]: 'valido',
        [never]: 'x',
        [archived]: 'x',
        [foreign]: 'x',
      });
      expect(res.status).toBe(400);
      const payload = (await res.json()) as Envelope;
      const errors = payload.error.details?.errors as Record<string, string>;
      expect(errors).toEqual({
        [never]: 'unknown_question',
        [archived]: 'unknown_question',
        [foreign]: 'unknown_question',
      });
      // Unknown ids come out in a fixed order, so the same bad body always yields the same sequence.
      expect(Object.keys(errors)).toEqual([never, archived, foreign].sort());
      expect(await answerRows()).toBe(0);
    });
  });

  it('a null on an optional question deletes its row; a null on a required one is `required`, an unticked acceptance is `not_ticked`', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const optional = await question({ required: false, position: 0 });
      const mustText = await question({ required: true, position: 1 });
      const mustTick = await question({ type: 'acceptance', required: true, position: 2 });
      const form = await readForm(member);
      const first = await save(member, form, {
        [optional]: 'algo',
        [mustText]: 'ok',
        [mustTick]: true,
      });
      expect(first.status).toBe(200);
      expect(await storedAnswer(optional)).toBe('algo');

      // Clearing the optional answer deletes its row, the other answers stay.
      const cleared = await save(member, form, { [optional]: null });
      expect(cleared.status).toBe(200);
      expect(await storedAnswer(optional)).toBeUndefined();
      expect(await storedAnswer(mustText)).toBe('ok');

      // A blank string is "no answer" as well.
      const blank = await save(member, form, { [mustText]: '   ', [mustTick]: false });
      expect(blank.status).toBe(400);
      const payload = (await blank.json()) as Envelope;
      expect(payload.error.details?.errors).toEqual({
        [mustText]: 'required',
        [mustTick]: 'not_ticked',
      });
      // Nothing was written: the stored answers are exactly what they were.
      expect(await storedAnswer(mustText)).toBe('ok');
      expect(await storedAnswer(mustTick)).toBe(true);
    });
  });

  it('`answers: {}` is a valid no-op that answers the current missingRequired', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const owed = await question({ required: true });
      const form = await readForm(member);
      const res = await save(member, form, {});
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ missingRequired: 1, missingQuestionIds: [owed] });
      expect(await answerRows()).toBe(0);
    });
  });

  it('the keyed errors come out in the admin’s order, whatever order the body names them', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const late = await question({ required: false, position: 5 });
      const early = await question({ required: false, position: 1 });
      const middle = await question({ required: false, position: 3 });
      const form = await readForm(member);
      expect(form.questions.map((q) => q.id)).toEqual([early, middle, late]);
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await save(member, form, { [late]: 1, [middle]: 2, [early]: 3 });
        const payload = (await res.json()) as Envelope;
        expect(Object.keys(payload.error.details?.errors as object)).toEqual([early, middle, late]);
      }
    });
  });

  it('two questions with the same title are told apart by id (adjacency), and saving the stored value again is accepted', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const title = `${TITLE}Mesmo título`;
      const one = await question({ title, required: false, position: 0 });
      const two = await question({ title, required: false, position: 1 });
      const form = await readForm(member);
      const res = await save(member, form, { [one]: 'primeira', [two]: 'segunda' });
      expect(res.status).toBe(200);
      expect(await storedAnswer(one)).toBe('primeira');
      expect(await storedAnswer(two)).toBe('segunda');
      // Only the second changes; the first is sent again with its stored value.
      const again = await save(member, form, { [one]: 'primeira', [two]: 'terceira' });
      expect(again.status).toBe(200);
      expect(await storedAnswer(one)).toBe('primeira');
      expect(await storedAnswer(two)).toBe('terceira');
    });
  });

  it('the same valid body sent twice leaves identical rows and the same answer', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const id = await question({ required: true });
      const form = await readForm(member);
      const first = await save(member, form, { [id]: 'igual' });
      const rowsAfterFirst = await adminSql<{ id: string; value: unknown }[]>`
        select id::text as id, value from public.profile_form_answers where question_id = ${id}::uuid`;
      const second = await save(member, form, { [id]: 'igual' });
      const rowsAfterSecond = await adminSql<{ id: string; value: unknown }[]>`
        select id::text as id, value from public.profile_form_answers where question_id = ${id}::uuid`;
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual(await first.clone().json());
      // An upsert on the unique key: one row, the same id, the same value.
      expect(rowsAfterSecond).toEqual(rowsAfterFirst);
      expect(rowsAfterSecond).toHaveLength(1);
    });
  });
});

describe('12-06 the form changed, the module moved, the role and the host (PFORM-24, D-584)', () => {
  it('a stale formEtag is a 409 form_changed carrying the fresh form, writes nothing, and the fresh etag succeeds', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const id = await question({ required: false });
      const stale = await readForm(member);
      await adminSql`
        update public.profile_form_questions set revision = revision + 1 where id = ${id}::uuid`;

      const res = await save(member, stale, { [id]: 'resposta' });
      expect(res.status).toBe(409);
      const payload = (await res.json()) as Envelope;
      expect(payload.error.code).toBe('CONFLICT');
      expect(payload.error.details?.profileForm).toBe('form_changed');
      const fresh = payload.error.details?.form as Form;
      expect(fresh.formEtag).not.toBe(stale.formEtag);
      expect(fresh.questions.map((q) => q.id)).toEqual([id]);
      expect(await answerRows()).toBe(0);

      const retry = await save(member, fresh, { [id]: 'resposta' });
      expect(retry.status).toBe(200);
      expect(await storedAnswer(id)).toBe('resposta');
    });
  });

  it('after a make-optional or an archive the next read shows missingRequired reduced and the gate releases (PFORM-09)', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const keep = await question({ required: true, position: 0 });
      const drop = await question({ required: true, position: 1 });
      const form = await readForm(member);
      expect(form.missingRequired).toBe(2);
      expect((await call(member, 'GET', '/v1/me/profile')).status).toBe(403);

      await adminSql`update public.profile_form_questions set required = false where id = ${keep}::uuid`;
      const half = await readForm(member);
      expect(half.missingRequired).toBe(1);
      expect(half.mode).toBe('first');

      await adminSql`update public.profile_form_questions set archived_at = now() where id = ${drop}::uuid`;
      const none = await readForm(member);
      expect(none.missingRequired).toBe(0);
      expect(none.questions.map((q) => q.id)).toEqual([keep]);
      expect((await call(member, 'GET', '/v1/me/profile')).status).toBe(200);
    });
  });

  it('a member who filled photo, bio and links before the form existed is treated like any other', async () => {
    const member = await person();
    await adminSql`
      update public.member_profiles set bio = 'Já tenho bio'
       where user_id = ${member.userId}::uuid`;
    await withProfileForm(labTenantId, async () => {
      const id = await question({ required: true });
      const form = await readForm(member);
      expect(form.mode).toBe('first');
      expect(form.missingRequired).toBe(1);
      expect(form.questions[0]?.id).toBe(id);
    });
  });

  it('the module turned off between the read and the save is a 200 no-op that writes nothing; the read is mode none', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const id = await question({ required: false });
      const form = await readForm(member);
      await withProfileForm(
        labTenantId,
        async () => {
          const res = await save(member, form, { [id]: 'resposta' });
          expect(res.status).toBe(200);
          expect(await res.json()).toEqual({ missingRequired: 0, missingQuestionIds: [] });
          expect(await answerRows()).toBe(0);

          const off = await readForm(member);
          expect(off.mode).toBe('none');
          expect(off.questions).toEqual([]);
          expect(off.missingRequired).toBe(0);
        },
        { enabled: false },
      );
    });
  });

  it('staff get mode none on the read and 403 FORBIDDEN on the save and the dismissal', async () => {
    const admin = await person('admin_tenant');
    const support = await person('support_tenant');
    await withProfileForm(labTenantId, async () => {
      await question({ required: true });
      for (const staff of [admin, support]) {
        const form = await readForm(staff);
        expect(form.mode).toBe('none');
        expect(form.questions).toEqual([]);
        for (const [method, path, body] of [
          ['PUT', '/v1/me/profile-form/answers', { formEtag: form.formEtag, answers: {} }],
          ['POST', '/v1/me/profile-form/dismiss-notice', undefined],
        ] as const) {
          const res = await call(staff, method, path, body);
          expect(res.status, `${staff.email} ${path}`).toBe(403);
          expect(((await res.json()) as Envelope).error.code).toBe('FORBIDDEN');
        }
      }
    });
  });

  it('a member of one tenant cannot read this tenant’s questions through the other tenant’s host', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      await question({ required: false });
      const res = await call(member, 'GET', '/v1/me/profile-form', undefined, HOSTS.demo);
      expect(res.status).toBe(403);
      expect(((await res.json()) as Envelope).error.code).toBe('TENANT_HOST_MISMATCH');
    });
  });

  it('a request body that is not the contract is a 400 and a missing token is a 401', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      await question({ required: false });
      for (const body of [{}, { formEtag: 'x' }, { formEtag: 'x', answers: { 'not-a-uuid': 1 } }]) {
        const res = await call(member, 'PUT', '/v1/me/profile-form/answers', body);
        expect(res.status).toBe(400);
        expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
      }
      const anonymous = await api.request('/v1/me/profile-form', {
        headers: { 'x-tenant-host': HOSTS.lab },
      });
      expect(anonymous.status).toBe(401);
    });
  });
});

// ── 12-06 Task 3: the notice dismissal (PFORM-16, D-586) ─────────────────────────────────────────

type BootstrapBlock = { pendingRequired: number; newOptional: number } | undefined;
const bootstrapBlock = async (p: Person): Promise<BootstrapBlock> => {
  const res = await call(p, 'GET', '/v1/me/bootstrap');
  expect(res.status).toBe(200);
  return ((await res.json()) as { profileForm?: BootstrapBlock }).profileForm;
};

const dismissedAt = async (userId: string): Promise<string | null> => {
  const [row] = await adminSql<{ at: string | null }[]>`
    select profile_form_notice_dismissed_at::text as at from public.member_profiles
     where user_id = ${userId}::uuid and tenant_id = ${labTenantId}::uuid`;
  return row?.at ?? null;
};

describe('12-06 "Agora não": the notice is dismissed on the server (D-586)', () => {
  it('a new optional question never gates; dismissing it survives a fresh login; a later question brings the notice back', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      await question({ required: false, position: 0 });
      // An optional question never gates: the member passes and the bootstrap only counts it.
      expect((await call(member, 'GET', '/v1/me/profile')).status).toBe(200);
      expect(await bootstrapBlock(member)).toEqual({ pendingRequired: 0, newOptional: 1 });
      expect((await readForm(member)).mode).toBe('edit');

      const dismissed = await call(member, 'POST', '/v1/me/profile-form/dismiss-notice');
      expect(dismissed.status).toBe(200);
      expect(await dismissed.json()).toEqual({ newOptional: 0 });
      expect(await bootstrapBlock(member)).toEqual({ pendingRequired: 0, newOptional: 0 });
      expect(await dismissedAt(member.userId)).not.toBeNull();

      // Server state: a brand-new login (a reinstall, another device) still reads 0.
      const fresh: Person = { ...member, token: await signInAs(member.email, member.password) };
      expect(await bootstrapBlock(fresh)).toEqual({ pendingRequired: 0, newOptional: 0 });

      // A question listed after the dismissal brings the notice back, counted from that instant.
      await question({ required: false, position: 1 });
      expect(await bootstrapBlock(member)).toEqual({ pendingRequired: 0, newOptional: 1 });
    });
  });

  it('dismissing twice is idempotent in effect, and the later dismissal moves the instant forward', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      await question({ required: false });
      await call(member, 'POST', '/v1/me/profile-form/dismiss-notice');
      const first = await dismissedAt(member.userId);
      // A question listed in between, then a second dismissal.
      await question({ required: false, position: 1 });
      expect(await bootstrapBlock(member)).toEqual({ pendingRequired: 0, newOptional: 1 });
      const second = await call(member, 'POST', '/v1/me/profile-form/dismiss-notice');
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual({ newOptional: 0 });
      const moved = await dismissedAt(member.userId);
      expect(moved).not.toBeNull();
      expect(new Date(moved ?? 0).getTime()).toBeGreaterThan(new Date(first ?? 0).getTime());
      // A repeat with nothing new changes nothing visible.
      const third = await call(member, 'POST', '/v1/me/profile-form/dismiss-notice');
      expect(await third.json()).toEqual({ newOptional: 0 });
      expect(await bootstrapBlock(member)).toEqual({ pendingRequired: 0, newOptional: 0 });
    });
  });

  it('a required question never counts in newOptional, and an answered optional question never counts either', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const required = await question({ required: true, position: 0 });
      const optional = await question({ required: false, position: 1 });
      expect(await bootstrapBlock(member)).toEqual({ pendingRequired: 1, newOptional: 1 });

      const form = await readForm(member);
      const res = await save(member, form, { [required]: 'resposta', [optional]: 'outra' });
      expect(res.status).toBe(200);
      expect(await bootstrapBlock(member)).toEqual({ pendingRequired: 0, newOptional: 0 });
    });
  });

  it('with the module off the dismissal is a no-op that stores nothing', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      await question({ required: false });
      await withProfileForm(
        labTenantId,
        async () => {
          const res = await call(member, 'POST', '/v1/me/profile-form/dismiss-notice');
          expect(res.status).toBe(200);
          expect(await res.json()).toEqual({ newOptional: 0 });
          expect(await dismissedAt(member.userId)).toBeNull();
        },
        { enabled: false },
      );
    });
  });
});

// ── 12.2-10 Task 2: the "Há perguntas novas" notice counts what the member SEES through every level (D-586, D-644) ──

describe('12.2-10 D-644: newOptional counts an optional question only when every branch above it is open', () => {
  /** Q1 | B1 {Q2 | B2 {Q3 | B3 {Q4}}}: four optional questions, three levels, every opener a yes/no. */
  async function chain() {
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
    const q4 = await question({ position: 4, required: false, branchId: b3 });
    return { q1, q2, q3, q4 };
  }

  const newOptional = async (who: Person): Promise<number | undefined> => {
    const res = await call(who, 'GET', '/v1/me/bootstrap');
    expect(res.status).toBe(200);
    return ((await res.json()) as { profileForm?: { newOptional: number } }).profileForm
      ?.newOptional;
  };

  const answer = (who: Person, questionId: string, value: unknown) =>
    seedProfileFormAnswer({ tenantId: labTenantId, questionId, userId: who.userId, value });

  it('counts the question one level at a time as the member opens the chain, and not a deep one under a closed branch', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await chain();
      // Nothing answered: only the unconditional Q1 is visible and new.
      expect(await newOptional(member)).toBe(1);
      await answer(member, f.q1, true);
      expect(await newOptional(member)).toBe(1); // Q2 (depth 1) is now the one new question
      await answer(member, f.q2, true);
      expect(await newOptional(member)).toBe(1); // Q3 (depth 2)
      await answer(member, f.q3, true);
      expect(await newOptional(member)).toBe(1); // Q4 (depth 3) opens through all three
      await answer(member, f.q4, 'dito');
      expect(await newOptional(member)).toBe(0);
    });
  }, 40_000);

  it('a deep question under a closed branch does not count even when a stale answer below it says yes', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await chain();
      // Q1 = não closes B1; the planted answers to Q2 and Q3 (stored does not equal visible) must not open Q4.
      await answer(member, f.q1, false);
      await answer(member, f.q2, true);
      await answer(member, f.q3, true);
      expect(await newOptional(member)).toBe(0);
      // The member who does open the chain sees it counted once.
      const open = await person();
      await answer(open, f.q1, true);
      await answer(open, f.q2, true);
      await answer(open, f.q3, true);
      expect(await newOptional(open)).toBe(1);
    });
  }, 40_000);

  it('the member form read never carries a branch name, and the strict member shape refuses one', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const q1 = await question({ type: 'yes_no', position: 1, required: false });
      await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: q1,
        values: ['true'],
        name: 'pfm NOME-QUE-NAO-SAI',
      });
      const res = await call(member, 'GET', '/v1/me/profile-form');
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain('NOME-QUE-NAO-SAI');
      const parsed = memberFormSchema.safeParse(JSON.parse(text));
      expect(parsed.success, text).toBe(true);
      // T-12.2-03: a payload that DID carry a name would fail the contract.
      const withName = JSON.parse(text) as { branches: Record<string, unknown>[] };
      withName.branches = withName.branches.map((branch) => ({ ...branch, name: 'x' }));
      expect(memberFormSchema.safeParse(withName).success).toBe(false);
    });
  }, 30_000);
});
