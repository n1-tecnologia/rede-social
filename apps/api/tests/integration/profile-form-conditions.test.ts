import {
  answerTokens,
  isQuestionVisible,
  PROFILE_FORM_VISIBILITY_CASES,
} from '@rede-social/contracts/profile-form';
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
  signInAs,
  withProfileForm,
} from './setup';

/**
 * 12.1-10 (PFORM-29, PFORM-31, PFORM-38; D-620..D-623, D-625, D-632, D-634; T-12.1-01, T-12.1-06, T-12.1-07)
 * against the live local stack: the admin's CONDITIONS API. A condition is written only through the pure rules
 * (type, chain, order, tokens), locked once the question has answers, removable at any time; an opener that
 * still opens others refuses archive, delete, retype, option removal and replace with the list of its
 * dependents; the summary and the impact count only the members who SEE a question.
 *
 * EVERY identity is a THROWAWAY (`createSharedIdentity`, prefix `pfq`); steps and questions carry the title
 * prefix `pfq ` so the sweep removes only this file's rows (answers first, the default step the database
 * trigger writes once empty). The module row is restored by `withProfileForm`. No tenant is created: the
 * members and questions live in the seed tenants rede-lab and rede-demo, and are all removed again.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
type Condition = { questionId: string; values: string[] };
type Q = {
  id: string;
  stepId: string;
  type: string;
  title: string;
  required: boolean;
  position: number;
  revision: number;
  answerCount: number;
  options: { id: string; label: string; answerCount: number }[];
  condition: Condition | null;
  opensCount: number;
};
type QuestionList = { questions: Q[]; activeCount: number; steps: { id: string }[] };

const PREFIX = 'pfq';
const TITLE = 'pfq ';
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

const errorOf = async (res: Response) => ((await res.json()) as Envelope).error;
/** The error envelope minus the per-request id, so two refusals can be compared for sameness. */
const withoutRequestId = (body: unknown) => {
  const { error } = body as Envelope;
  const { requestId: _requestId, ...rest } = error as Envelope['error'] & { requestId?: string };
  return { error: rest };
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const listOf = async (p: Person, host: string = HOSTS.lab): Promise<QuestionList> => {
  const res = await call(p, 'GET', '/v1/profile_form/questions', undefined, host);
  expect(res.status).toBe(200);
  return (await res.json()) as QuestionList;
};

const post = (p: Person, body: unknown, host: string = HOSTS.lab) =>
  call(p, 'POST', '/v1/profile_form/questions', body, host);

async function made(p: Person, body: unknown, host: string = HOSTS.lab): Promise<Q> {
  const res = await post(p, body, host);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()) as Q;
}

/** A single-choice question with the given option labels. */
const choice = (
  p: Person,
  label: string,
  labels: string[] = ['A', 'B', 'C'],
  extra: Record<string, unknown> = {},
  host: string = HOSTS.lab,
) =>
  made(
    p,
    {
      type: 'single_choice',
      title: `${TITLE}${label}`,
      options: labels.map((l) => ({ label: l })),
      ...extra,
    },
    host,
  );

const yesNo = (p: Person, label: string, extra: Record<string, unknown> = {}) =>
  made(p, { type: 'yes_no', title: `${TITLE}${label}`, ...extra });

const text = (
  p: Person,
  label: string,
  condition: Condition | null = null,
  extra: Record<string, unknown> = {},
) =>
  made(p, {
    type: 'short_text',
    title: `${TITLE}${label}`,
    ...(condition ? { condition } : {}),
    ...extra,
  });

const edit = (p: Person, q: { id: string }, body: Record<string, unknown>, host = HOSTS.lab) =>
  call(p, 'PATCH', `/v1/profile_form/questions/${q.id}`, body, host);

const archive = (p: Person, q: { id: string }) =>
  call(p, 'POST', `/v1/profile_form/questions/${q.id}/archive`);

const reactivate = (p: Person, q: { id: string }) =>
  call(p, 'POST', `/v1/profile_form/questions/${q.id}/reactivate`);

const remove = (p: Person, q: { id: string }) =>
  call(p, 'DELETE', `/v1/profile_form/questions/${q.id}`);

const createStep = async (p: Person, title: string): Promise<{ id: string }> => {
  const res = await call(p, 'POST', '/v1/profile_form/steps', { title: `${TITLE}${title}` });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
};

/** The coded 409: its status, `details.profileForm` and whatever else the case pins. */
async function expectRefused(
  res: Response,
  profileForm: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const body = await res.clone().text();
  expect(res.status, body).toBe(409);
  const error = await errorOf(res);
  expect(error.code).toBe('CONFLICT');
  expect(error.details).toMatchObject({ profileForm, ...extra });
}

type StoredRow = {
  condition_question_id: string | null;
  condition_values: string[] | null;
  archived_at: Date | null;
  revision: number;
};
const storedOf = async (id: string): Promise<StoredRow | undefined> => {
  const [row] = await adminSql<StoredRow[]>`
    select condition_question_id::text as condition_question_id, condition_values, archived_at, revision
      from public.profile_form_questions where id = ${id}::uuid`;
  return row;
};

const countRows = async (tenantId: string): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.profile_form_questions where tenant_id = ${tenantId}::uuid`;
  return row?.n ?? 0;
};

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

// Each case builds its own form: nothing a case created may count against the next one.
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

// ── Task 1: write a condition and read it back ──────────────────────────────────────────────────────

describe('12.1-10 tracer: an opener, a conditional question, the list with condition and opensCount (D-620..D-623)', () => {
  it('stores the condition, the list shows condition and opensCount, and a chain is refused', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const opener = await choice(admin, 'opener');
      const [optA, optB] = opener.options.map((o) => o.id);
      expect(opener).toMatchObject({ condition: null, opensCount: 0 });

      const dependent = await text(admin, 'dependent', {
        questionId: opener.id,
        values: [optA as string],
      });
      expect(dependent.condition).toEqual({ questionId: opener.id, values: [optA] });
      expect(dependent.opensCount).toBe(0);

      const list = await listOf(admin);
      const listedOpener = list.questions.find((q) => q.id === opener.id);
      const listedDependent = list.questions.find((q) => q.id === dependent.id);
      expect(listedOpener).toMatchObject({ condition: null, opensCount: 1 });
      expect(listedDependent).toMatchObject({
        condition: { questionId: opener.id, values: [optA] },
        opensCount: 0,
      });
      const stored = await storedOf(dependent.id);
      expect(stored).toMatchObject({ condition_question_id: opener.id, condition_values: [optA] });

      // D-622: a chain. The conditional question cannot open anything, whatever the token.
      const chain = await post(admin, {
        type: 'short_text',
        title: `${TITLE}chain`,
        condition: { questionId: dependent.id, values: [optB] },
      });
      await expectRefused(chain, 'condition_invalid');
      expect((await listOf(admin)).activeCount).toBe(2);
    });
  }, 60_000);

  it('a yes/no opener takes the tokens true and false, a single-choice one its option ids', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const gate = await yesNo(admin, 'gate');
      const both = await text(admin, 'both', { questionId: gate.id, values: ['true', 'false'] });
      expect(both.condition).toEqual({ questionId: gate.id, values: ['true', 'false'] });
      const one = await text(admin, 'one', { questionId: gate.id, values: ['false'] });
      expect(one.condition?.values).toEqual(['false']);
      expect((await listOf(admin)).questions.find((q) => q.id === gate.id)?.opensCount).toBe(2);

      const maybe = await post(admin, {
        type: 'short_text',
        title: `${TITLE}maybe`,
        condition: { questionId: gate.id, values: ['maybe'] },
      });
      await expectRefused(maybe, 'condition_invalid');
    });
  }, 60_000);
});

describe('12.1-10 D-620..D-623: every illegal condition is refused with its code and writes nothing', () => {
  it('an opener of a type that cannot open, an unknown token, "Outro" and an archived opener are condition_invalid', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const plain = await text(admin, 'plain');
      const opener = await choice(admin, 'opener', ['A', 'B'], { allowOther: true });
      const before = (await listOf(admin)).activeCount;

      const body = (condition: Condition) => ({
        type: 'short_text',
        title: `${TITLE}x`,
        condition,
      });
      // D-620: a short-text question cannot open anything.
      await expectRefused(
        await post(admin, body({ questionId: plain.id, values: ['true'] })),
        'condition_invalid',
      );
      // D-621: a token that is not an option id of the opener, and "Outro" (it has no option id).
      await expectRefused(
        await post(admin, body({ questionId: opener.id, values: [crypto.randomUUID()] })),
        'condition_invalid',
      );
      for (const token of ['other', 'outro', 'Outro']) {
        await expectRefused(
          await post(admin, body({ questionId: opener.id, values: [token] })),
          'condition_invalid',
        );
      }
      // A token of ANOTHER question's options is not one of this opener's.
      const second = await choice(admin, 'second', ['X', 'Y']);
      const foreignToken = second.options[0]?.id as string;
      await expectRefused(
        await post(admin, body({ questionId: opener.id, values: [foreignToken] })),
        'condition_invalid',
      );
      // Empty or repeated values never reach the service (contract), and nothing is created either way.
      for (const values of [[], [opener.options[0]?.id, opener.options[0]?.id]]) {
        const res = await post(admin, body({ questionId: opener.id, values: values as string[] }));
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      }
      // An archived opener cannot open (it is not in the form).
      const gone = await choice(admin, 'gone', ['P', 'Q']);
      expect((await archive(admin, gone)).status).toBe(200);
      await expectRefused(
        await post(admin, body({ questionId: gone.id, values: [gone.options[0]?.id as string] })),
        'condition_invalid',
      );

      expect((await listOf(admin)).activeCount).toBe(before + 1); // only `second`
    });
  }, 60_000);

  it('a question that is itself an opener cannot gain a condition, and a question cannot open itself', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const gate = await yesNo(admin, 'gate');
      const middle = await choice(admin, 'middle');
      await text(admin, 'leaf', {
        questionId: middle.id,
        values: [middle.options[0]?.id as string],
      });

      // `middle` opens `leaf`: it cannot also be conditional (a chain from the other side).
      const gain = await edit(admin, middle, {
        revision: middle.revision,
        condition: { questionId: gate.id, values: ['true'] },
      });
      await expectRefused(gain, 'condition_invalid');
      expect((await storedOf(middle.id))?.condition_question_id).toBeNull();

      const self = await edit(admin, gate, {
        revision: gate.revision,
        condition: { questionId: gate.id, values: ['true'] },
      });
      await expectRefused(self, 'condition_invalid');
    });
  }, 60_000);

  it('an opener that sits at or after the question is condition_order naming the opener (create and edit)', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const stepA = await createStep(admin, 'A');
      const stepB = await createStep(admin, 'B');
      const early = await text(admin, 'early', null, { stepId: stepA.id });
      const opener = await choice(admin, 'opener', ['A', 'B'], { stepId: stepB.id });
      const optA = opener.options[0]?.id as string;

      // Created in step A while the opener is in step B (after it).
      const create = await post(admin, {
        type: 'short_text',
        title: `${TITLE}late`,
        stepId: stepA.id,
        condition: { questionId: opener.id, values: [optA] },
      });
      await expectRefused(create, 'condition_order', { openerId: opener.id });

      // An existing question in step A gaining a condition on the opener in step B.
      const gain = await edit(admin, early, {
        revision: early.revision,
        condition: { questionId: opener.id, values: [optA] },
      });
      await expectRefused(gain, 'condition_order', { openerId: opener.id, questionId: early.id });
      expect((await storedOf(early.id))?.condition_question_id).toBeNull();

      // Positive control: the same condition in step B (after the opener) is stored.
      const ok = await text(
        admin,
        'ok',
        { questionId: opener.id, values: [optA] },
        { stepId: stepB.id },
      );
      expect(ok.condition).toEqual({ questionId: opener.id, values: [optA] });
    });
  }, 60_000);

  it('T-12.1-01: an opener of another tenant is indistinguishable from a missing one, beside a same-tenant control', async () => {
    const admin = await person('admin_tenant');
    const theirAdmin = await person('admin_tenant', 'demo');
    await withProfileForm(labTenantId, async () => {
      await withProfileForm(demoTenantId, async () => {
        const theirs = await choice(theirAdmin, 'theirs', ['A', 'B'], {}, HOSTS.demo);
        const mine = await choice(admin, 'mine', ['A', 'B']);
        const labBefore = await countRows(labTenantId);
        const demoBefore = await countRows(demoTenantId);

        const attempt = (questionId: string, values: string[]) =>
          post(admin, {
            type: 'short_text',
            title: `${TITLE}x`,
            condition: { questionId, values },
          });
        const foreign = await attempt(theirs.id, [theirs.options[0]?.id as string]);
        const missing = await attempt(crypto.randomUUID(), [theirs.options[0]?.id as string]);
        await expectRefused(foreign.clone(), 'condition_invalid');
        await expectRefused(missing.clone(), 'condition_invalid');
        expect(withoutRequestId(await foreign.json())).toEqual(
          withoutRequestId(await missing.json()),
        );
        // Their own option token on MY opener does not make it theirs either.
        await expectRefused(
          await attempt(mine.id, [theirs.options[0]?.id as string]),
          'condition_invalid',
        );

        // The same for an edit and for a replace.
        const target = await text(admin, 'target');
        const foreignEdit = await edit(admin, target, {
          revision: target.revision,
          condition: { questionId: theirs.id, values: [theirs.options[0]?.id as string] },
        });
        await expectRefused(foreignEdit, 'condition_invalid');
        const foreignReplace = await call(admin, 'POST', '/v1/profile_form/questions/replace', {
          replaces: target.id,
          type: 'short_text',
          title: `${TITLE}replacement`,
          condition: { questionId: theirs.id, values: [theirs.options[0]?.id as string] },
        });
        await expectRefused(foreignReplace, 'condition_invalid');

        expect(await countRows(labTenantId)).toBe(labBefore + 1); // only `target`
        expect(await countRows(demoTenantId)).toBe(demoBefore);
        expect((await storedOf(target.id))?.condition_question_id).toBeNull();
        expect((await storedOf(target.id))?.revision).toBe(1);

        // Positive control: my own opener is accepted.
        const ok = await attempt(mine.id, [mine.options[0]?.id as string]);
        expect(ok.status).toBe(201);
      });
    });
  }, 90_000);

  it('a replace carries its own condition, but cannot name the question it replaces', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const opener = await choice(admin, 'opener', ['A', 'B']);
      const optA = opener.options[0]?.id as string;
      const old = await text(admin, 'old');

      const own = await call(admin, 'POST', '/v1/profile_form/questions/replace', {
        replaces: old.id,
        type: 'short_text',
        title: `${TITLE}new`,
        condition: { questionId: opener.id, values: [optA] },
      });
      expect(own.status, JSON.stringify(await own.clone().json())).toBe(201);
      expect(((await own.json()) as Q).condition).toEqual({
        questionId: opener.id,
        values: [optA],
      });

      const keep = await text(admin, 'keep');
      const onSelf = await call(admin, 'POST', '/v1/profile_form/questions/replace', {
        replaces: keep.id,
        type: 'short_text',
        title: `${TITLE}new2`,
        condition: { questionId: keep.id, values: ['true'] },
      });
      await expectRefused(onSelf, 'condition_invalid');
      expect((await storedOf(keep.id))?.archived_at).toBeNull();
    });
  }, 60_000);
});

// ── Task 2: change, remove, lock, and the opener's refusals ─────────────────────────────────────────

describe('12.1-10 D-625: a condition on a never-answered question can be created, changed and removed', () => {
  it('create, change the values, change the opener, remove; each edit bumps the revision once', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const gate = await yesNo(admin, 'gate');
      const kind = await choice(admin, 'kind', ['A', 'B']);
      const target = await text(admin, 'target');

      const gained = await edit(admin, target, {
        revision: target.revision,
        condition: { questionId: gate.id, values: ['true'] },
      });
      expect(gained.status).toBe(200);
      const g = (await gained.json()) as Q;
      expect(g.condition).toEqual({ questionId: gate.id, values: ['true'] });
      expect(g.revision).toBe(target.revision + 1);

      const changed = await edit(admin, g, {
        revision: g.revision,
        condition: { questionId: kind.id, values: [kind.options[1]?.id as string] },
      });
      expect(changed.status).toBe(200);
      const c = (await changed.json()) as Q;
      expect(c.condition).toEqual({ questionId: kind.id, values: [kind.options[1]?.id] });
      expect(c.revision).toBe(g.revision + 1);
      const list = await listOf(admin);
      expect(list.questions.find((q) => q.id === gate.id)?.opensCount).toBe(0);
      expect(list.questions.find((q) => q.id === kind.id)?.opensCount).toBe(1);

      const removed = await edit(admin, c, { revision: c.revision, condition: null });
      expect(removed.status).toBe(200);
      const r = (await removed.json()) as Q;
      expect(r.condition).toBeNull();
      expect(r.revision).toBe(c.revision + 1);
      expect((await storedOf(c.id))?.condition_question_id).toBeNull();

      // Removing a condition that is not there changes nothing (no revision bump).
      const again = await edit(admin, r, { revision: r.revision, condition: null });
      expect(again.status).toBe(200);
      expect(((await again.json()) as Q).revision).toBe(r.revision);
    });
  }, 60_000);
});

describe('12.1-10 D-625: condition_locked once the question has answers, removal allowed with answers', () => {
  it('a gain and a change are condition_locked; the removal succeeds and keeps the answer; a rename passes', async () => {
    const admin = await person('admin_tenant');
    const member = await person('member');
    await withProfileForm(labTenantId, async () => {
      const gate = await yesNo(admin, 'gate');
      const kind = await choice(admin, 'kind', ['A', 'B']);
      const [optA, optB] = kind.options.map((o) => o.id) as [string, string];

      // 1. An unconditional question with an answer cannot GAIN a condition.
      const plain = await text(admin, 'plain');
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: plain.id,
        userId: member.userId,
      });
      const gain = await edit(admin, plain, {
        revision: plain.revision,
        condition: { questionId: gate.id, values: ['true'] },
      });
      await expectRefused(gain, 'condition_locked');
      expect((await storedOf(plain.id))?.condition_question_id).toBeNull();
      // Its title is still free.
      expect(
        (await edit(admin, plain, { revision: plain.revision, title: `${TITLE}plain2` })).status,
      ).toBe(200);

      // 2. A conditional question with an answer cannot CHANGE its condition (another opener or other values).
      const dep = await text(admin, 'dep', { questionId: kind.id, values: [optA, optB] });
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: dep.id,
        userId: member.userId,
      });
      const otherValues = await edit(admin, dep, {
        revision: dep.revision,
        condition: { questionId: kind.id, values: [optA] },
      });
      await expectRefused(otherValues, 'condition_locked');
      const otherOpener = await edit(admin, dep, {
        revision: dep.revision,
        condition: { questionId: gate.id, values: ['true'] },
      });
      await expectRefused(otherOpener, 'condition_locked');
      expect((await storedOf(dep.id))?.condition_values).toEqual([optA, optB]);

      // 3. The unchanged condition (same set, any order) in an edit that renames passes at any answer count.
      const renamed = await edit(admin, dep, {
        revision: dep.revision,
        title: `${TITLE}dep renamed`,
        condition: { questionId: kind.id, values: [optB, optA] },
      });
      expect(renamed.status, JSON.stringify(await renamed.clone().json())).toBe(200);
      const r = (await renamed.json()) as Q;
      expect(r.title).toBe(`${TITLE}dep renamed`);
      expect(r.condition?.values).toEqual([optA, optB]); // the stored order is kept

      // 4. REMOVING the condition is allowed with answers, discards nothing and bumps the revision.
      const removed = await edit(admin, r, { revision: r.revision, condition: null });
      expect(removed.status).toBe(200);
      const after = (await removed.json()) as Q;
      expect(after.condition).toBeNull();
      expect(after.answerCount).toBe(1);
      expect(after.revision).toBe(r.revision + 1);
      const [answers] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.profile_form_answers where question_id = ${dep.id}::uuid`;
      expect(answers?.n).toBe(1);
    });
  }, 90_000);
});

type Fixture = { opener: Q; a: string; b: string; c: string; d1: Q; d2: Q };
async function openerWithTwo(admin: Person): Promise<Fixture> {
  const opener = await choice(admin, 'opener', ['A', 'B', 'C']);
  const [a, b, c] = opener.options.map((o) => o.id) as [string, string, string];
  const d1 = await text(admin, 'dep1', { questionId: opener.id, values: [a] });
  const d2 = await text(admin, 'dep2', { questionId: opener.id, values: [b] });
  return { opener, a, b, c, d1, d2 };
}
const listing = (...qs: Q[]) => qs.map((q) => ({ id: q.id, title: q.title }));

describe('12.1-10 D-632: has_dependents lists the active dependents an opener would orphan', () => {
  it('archive, delete, retype, remove-option and replace each answer 409 has_dependents listing exactly the two', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const f = await openerWithTwo(admin);
      const both = { profileForm: 'has_dependents', dependents: listing(f.d1, f.d2) };
      const refusedBoth = async (res: Response) => {
        expect(res.status).toBe(409);
        const error = await errorOf(res);
        expect(error.code).toBe('CONFLICT');
        expect(error.details).toEqual(both);
      };
      expect((await listOf(admin)).questions.find((q) => q.id === f.opener.id)?.opensCount).toBe(2);

      await refusedBoth(await archive(admin, f.opener));
      await refusedBoth(await remove(admin, f.opener));
      await refusedBoth(
        await edit(admin, f.opener, { revision: f.opener.revision, type: 'dropdown' }),
      );
      await refusedBoth(
        await call(admin, 'POST', '/v1/profile_form/questions/replace', {
          replaces: f.opener.id,
          type: 'single_choice',
          title: `${TITLE}new opener`,
          options: [{ label: 'X' }, { label: 'Y' }],
        }),
      );
      // Nothing changed: still active, still one revision, still two dependents.
      const stored = await storedOf(f.opener.id);
      expect(stored).toMatchObject({ archived_at: null, revision: f.opener.revision });
      expect((await listOf(admin)).questions.find((q) => q.id === f.opener.id)?.opensCount).toBe(2);
    });
  }, 90_000);

  it('removing an option lists only the dependents that name it, and an unreferenced option goes freely', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const f = await openerWithTwo(admin);
      const keep = (...ids: string[]) =>
        ids.map((id) => ({
          id,
          label: f.opener.options.find((o) => o.id === id)?.label as string,
        }));

      // Option A is named by dep1 only (and has NO answer): refused, listing dep1 alone.
      const dropA = await edit(admin, f.opener, {
        revision: f.opener.revision,
        options: keep(f.b, f.c),
      });
      expect(dropA.status).toBe(409);
      expect((await errorOf(dropA)).details).toEqual({
        profileForm: 'has_dependents',
        dependents: listing(f.d1),
      });
      // Option B: dep2 only.
      const dropB = await edit(admin, f.opener, {
        revision: f.opener.revision,
        options: keep(f.a, f.c),
      });
      expect((await errorOf(dropB)).details).toEqual({
        profileForm: 'has_dependents',
        dependents: listing(f.d2),
      });
      // Option C is named by nobody: it goes, and the opener is edited.
      const dropC = await edit(admin, f.opener, {
        revision: f.opener.revision,
        options: keep(f.a, f.b),
      });
      expect(dropC.status, JSON.stringify(await dropC.clone().json())).toBe(200);
      expect(((await dropC.json()) as Q).options.map((o) => o.id)).toEqual([f.a, f.b]);
    });
  }, 60_000);

  it('archived dependents do not block; unconditioned ones neither; the same edits then succeed', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      // 1. Archived dependents: the opener archives.
      const one = await openerWithTwo(admin);
      expect((await archive(admin, one.d1)).status).toBe(200);
      expect((await archive(admin, one.d2)).status).toBe(200);
      expect((await listOf(admin)).questions.find((q) => q.id === one.opener.id)?.opensCount).toBe(
        0,
      );
      expect((await archive(admin, one.opener)).status).toBe(200);

      // 2. Unconditioned dependents: a retype succeeds (and the type really changed).
      const two = await openerWithTwo(admin);
      for (const d of [two.d1, two.d2]) {
        const res = await edit(admin, d, { revision: d.revision, condition: null });
        expect(res.status).toBe(200);
      }
      const retyped = await edit(admin, two.opener, {
        revision: two.opener.revision,
        type: 'dropdown',
      });
      expect(retyped.status, JSON.stringify(await retyped.clone().json())).toBe(200);
      expect(((await retyped.json()) as Q).type).toBe('dropdown');

      // 3. Delete with only ARCHIVED dependents: it goes, and their (now dangling) condition is cleared.
      const three = await openerWithTwo(admin);
      expect((await archive(admin, three.d1)).status).toBe(200);
      expect((await archive(admin, three.d2)).status).toBe(200);
      const deleted = await remove(admin, three.opener);
      expect(deleted.status, JSON.stringify(await deleted.clone().json())).toBe(200);
      expect(await storedOf(three.opener.id)).toBeUndefined();
      expect(await storedOf(three.d1.id)).toMatchObject({
        condition_question_id: null,
        condition_values: null,
      });

      // 4. A replace succeeds once the dependents are gone from the opener.
      const four = await openerWithTwo(admin);
      for (const d of [four.d1, four.d2]) expect((await archive(admin, d)).status).toBe(200);
      const replaced = await call(admin, 'POST', '/v1/profile_form/questions/replace', {
        replaces: four.opener.id,
        type: 'single_choice',
        title: `${TITLE}four replaced`,
        options: [{ label: 'X' }, { label: 'Y' }],
      });
      expect(replaced.status, JSON.stringify(await replaced.clone().json())).toBe(201);
    });
  }, 120_000);

  it('PF007 race: a dependent committed after the service read maps to the same coded 409 with a fresh list', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const opener = await choice(admin, 'opener', ['A', 'B']);
      const optA = opener.options[0]?.id as string;
      const late = await text(admin, 'late'); // unconditional when the service reads the form

      // A second connection holds the opener's row, then gives `late` a condition on it and commits only after
      // the archive request has read the (stale) form and is waiting for the row.
      let release: () => void = () => {};
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => {};
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const other = adminSql.begin(async (trx) => {
        await trx`select id from public.profile_form_questions where id = ${opener.id}::uuid for update`;
        await trx`
          update public.profile_form_questions
             set condition_question_id = ${opener.id}::uuid, condition_values = array[${optA}]::text[]
           where id = ${late.id}::uuid`;
        locked();
        await hold;
      });
      await isLocked;
      const pending = archive(admin, opener);
      await sleep(600);
      release();
      await other;
      const res = await pending;

      expect(res.status, JSON.stringify(await res.clone().json())).toBe(409);
      const error = await errorOf(res);
      expect(error.code).toBe('CONFLICT');
      expect(error.details).toEqual({ profileForm: 'has_dependents', dependents: listing(late) });
      expect((await storedOf(opener.id))?.archived_at).toBeNull();
    });
  }, 60_000);
});

describe('12.1-10 D-632: reactivating a shown question whose opener no longer holds is condition_invalid naming the opener', () => {
  it('an archived opener, an opener that is no longer eligible and a removed option are each refused', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      // 1. The opener is archived.
      const one = await openerWithTwo(admin);
      for (const d of [one.d1, one.d2]) expect((await archive(admin, d)).status).toBe(200);
      expect((await archive(admin, one.opener)).status).toBe(200);
      await expectRefused(await reactivate(admin, one.d1), 'condition_invalid', {
        openerId: one.opener.id,
      });
      expect((await storedOf(one.d1.id))?.archived_at).not.toBeNull();

      // 2. The opener is active but no longer eligible (retyped to a text question).
      const two = await openerWithTwo(admin);
      for (const d of [two.d1, two.d2]) expect((await archive(admin, d)).status).toBe(200);
      const retyped = await edit(admin, two.opener, {
        revision: two.opener.revision,
        type: 'short_text',
      });
      expect(retyped.status, JSON.stringify(await retyped.clone().json())).toBe(200);
      await expectRefused(await reactivate(admin, two.d1), 'condition_invalid', {
        openerId: two.opener.id,
      });

      // 3. The opener lost the option the archived dependent names (allowed: nobody active names it).
      const three = await openerWithTwo(admin);
      for (const d of [three.d1, three.d2]) expect((await archive(admin, d)).status).toBe(200);
      const dropA = await edit(admin, three.opener, {
        revision: three.opener.revision,
        options: [
          { id: three.b, label: 'B' },
          { id: three.c, label: 'C' },
        ],
      });
      expect(dropA.status, JSON.stringify(await dropA.clone().json())).toBe(200);
      await expectRefused(await reactivate(admin, three.d1), 'condition_invalid', {
        openerId: three.opener.id,
      });
      // Positive control: dep2 names B, which is still there, so it comes back.
      const ok = await reactivate(admin, three.d2);
      expect(ok.status, JSON.stringify(await ok.clone().json())).toBe(200);
      expect(((await ok.json()) as Q).condition).toEqual({
        questionId: three.opener.id,
        values: [three.b],
      });
    });
  }, 90_000);
});

// ── quick 261106-ei5: a conditional question lands right after its opener ───────────────────────────

/** The ids of the active questions in the order the admin list (and the member form) renders them. */
const orderOf = async (p: Person): Promise<string[]> =>
  (await listOf(p)).questions.map((q) => q.id);

/** The stored `[position, revision, updated_at]` of the given questions, in the order asked. */
const placeOf = async (ids: string[]): Promise<string[]> => {
  const rows = await adminSql<
    { id: string; position: number; revision: number; updated_at: Date }[]
  >`
    select id::text as id, position, revision, updated_at
      from public.profile_form_questions where id = any(${ids}::uuid[])`;
  return ids.map((id) => {
    const row = rows.find((r) => r.id === id);
    return `${row?.position}|${row?.revision}|${row?.updated_at.toISOString()}`;
  });
};

const firstOption = (q: Q): string => q.options[0]?.id as string;

describe('quick 261106-ei5 create: a new conditional question lands right after its opener (D-623 kept)', () => {
  it('Test A: a dependent created after an unconditional question is stored right after its opener, positions 1..3', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const o = await choice(admin, 'ei5 A opener');
      const x = await text(admin, 'ei5 A plain');
      const d1 = await text(admin, 'ei5 A d1', { questionId: o.id, values: [firstOption(o)] });
      expect(await orderOf(admin)).toEqual([o.id, d1.id, x.id]);
      expect((await listOf(admin)).questions.map((q) => q.position)).toEqual([1, 2, 3]);
    });
  }, 60_000);

  it('Test B: a second dependent goes after the first, a plain question stays after the group, a second opener keeps its own group', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const o = await choice(admin, 'ei5 B opener');
      const x = await text(admin, 'ei5 B plain');
      const d1 = await text(admin, 'ei5 B d1', { questionId: o.id, values: [firstOption(o)] });
      const d2 = await text(admin, 'ei5 B d2', { questionId: o.id, values: [firstOption(o)] });
      expect(await orderOf(admin)).toEqual([o.id, d1.id, d2.id, x.id]);
      const z = await text(admin, 'ei5 B last');
      expect(await orderOf(admin)).toEqual([o.id, d1.id, d2.id, x.id, z.id]);
      const o2 = await choice(admin, 'ei5 B opener two');
      const w = await text(admin, 'ei5 B after o2');
      const d3 = await text(admin, 'ei5 B d3', { questionId: o2.id, values: [firstOption(o2)] });
      expect(await orderOf(admin)).toEqual([o.id, d1.id, d2.id, x.id, z.id, o2.id, d3.id, w.id]);
      expect((await listOf(admin)).questions.map((q) => q.position)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ]);
    });
  }, 90_000);

  it('Test C: with the opener in another step the dependent keeps the end of its own step; in the same step it follows the opener', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const o = await choice(admin, 'ei5 C opener');
      const a2 = await text(admin, 'ei5 C a2');
      const step2 = await createStep(admin, 'ei5 C step two');
      const x = await text(admin, 'ei5 C x', null, { stepId: step2.id });
      const y = await text(admin, 'ei5 C y', null, { stepId: step2.id });
      const far = await text(
        admin,
        'ei5 C far',
        { questionId: o.id, values: [firstOption(o)] },
        { stepId: step2.id },
      );
      expect(await orderOf(admin)).toEqual([o.id, a2.id, x.id, y.id, far.id]);
      const near = await text(
        admin,
        'ei5 C near',
        { questionId: o.id, values: [firstOption(o)] },
        { stepId: o.stepId },
      );
      expect(await orderOf(admin)).toEqual([o.id, near.id, a2.id, x.id, y.id, far.id]);
      expect(near.stepId).toBe(o.stepId);
      expect(far.stepId).toBe(step2.id);
    });
  }, 90_000);

  it('Test D: a dependent of the very last question ends the form and touches no other row', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const x = await text(admin, 'ei5 D plain');
      const o = await choice(admin, 'ei5 D opener');
      const before = await placeOf([x.id, o.id]);
      const d = await text(admin, 'ei5 D dependent', {
        questionId: o.id,
        values: [firstOption(o)],
      });
      expect(await orderOf(admin)).toEqual([x.id, o.id, d.id]);
      expect(await placeOf([x.id, o.id])).toEqual(before);
    });
  }, 60_000);
});

// ── Task 3: the summary and the impact count only who sees a question ───────────────────────────────

const get = (p: Person, path: string, params: Record<string, string> = {}) =>
  call(p, 'GET', `${path}?${new URLSearchParams(params).toString()}`);

const impactOf = async (p: Person, params: Record<string, string>): Promise<number> => {
  const res = await get(p, '/v1/profile_form/impact', params);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
  const body = (await res.json()) as { members: number };
  expect(Object.keys(body)).toEqual(['members']); // T-12.1-06: one integer, nothing else
  expect(Number.isInteger(body.members)).toBe(true);
  return body.members;
};

type Summary = { total: number; complete: number; hasRequired: boolean };
const summaryOf = async (p: Person): Promise<Summary> => {
  const res = await get(p, '/v1/profile_form/summary');
  expect(res.status).toBe(200);
  const body = (await res.json()) as Summary;
  expect(Object.keys(body).sort()).toEqual(['complete', 'hasRequired', 'total']);
  return body;
};

/** The members the gate function releases (missing = 0), through the admin SQL connection that may call it. */
const gateReleased = async (tenantId: string): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n
      from public.memberships m
     where m.tenant_id = ${tenantId}::uuid and m.role = 'member' and m.status = 'active'
       and m.blocked_at is null and m.deleted_at is null
       and app.profile_form_missing(m.tenant_id, m.id) = 0`;
  return row?.n ?? 0;
};

describe('12.1-10 D-634 and PFORM-38: the impact counts only the members who SEE the question', () => {
  it('PFORM-38 impact counts of 0, 1, 2 and 3 for a three-member fixture; an unconditional question counts all', async () => {
    const admin = await person('admin_tenant');
    const m1 = await person('member');
    const m2 = await person('member');
    const m3 = await person('member');
    await withProfileForm(labTenantId, async () => {
      const opener = await choice(admin, 'opener', ['A', 'B', 'C']);
      const [a, b, c] = opener.options.map((o) => o.id) as [string, string, string];
      const total = (await summaryOf(admin)).total; // the seed members + the three of this case
      const ask = (values: string[]) => ({
        change: 'create_required',
        conditionQuestionId: opener.id,
        conditionValues: values.join(','),
      });

      // Edge 0: nobody has answered the opener, so nobody would see the question.
      expect(await impactOf(admin, ask([a]))).toBe(0);
      // The Phase 12 count (no condition parameters) is every member, unchanged.
      expect(await impactOf(admin, { change: 'create_required' })).toBe(total);
      expect(await impactOf(admin, { change: 'replace' })).toBe(total);

      const answer = (m: Person, optionId: string) =>
        seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: opener.id,
          userId: m.userId,
          value: { optionId },
        });
      await answer(m1, a);
      await answer(m2, b);
      // m3 has not answered at all. Edge 1: exactly one member sees a question opened by A.
      expect(await impactOf(admin, ask([a]))).toBe(1);
      expect(await impactOf(admin, ask([a, b]))).toBe(2);
      expect(await impactOf(admin, { ...ask([b]), change: 'replace' })).toBe(1);
      await answer(m3, c);
      expect(await impactOf(admin, ask([a, b, c]))).toBe(3);
      expect(await impactOf(admin, ask([c]))).toBe(1);

      // The conditional question itself: make_required counts who sees it and lacks an answer.
      const dep = await text(admin, 'dep', { questionId: opener.id, values: [a] });
      expect(await impactOf(admin, { change: 'make_required', questionId: dep.id })).toBe(1);
      // remove_condition on an OPTIONAL question asks nobody.
      expect(await impactOf(admin, { change: 'remove_condition', questionId: dep.id })).toBe(0);
      const req = await edit(admin, dep, { revision: dep.revision, required: true });
      expect(req.status).toBe(200);
      const reqDep = (await req.json()) as Q;
      // Required now: the members who do NOT see it and lack the answer newly owe it on removal.
      expect(await impactOf(admin, { change: 'remove_condition', questionId: reqDep.id })).toBe(
        total - 1,
      );
      // m1 answers it: they no longer lack it, and the count drops by nothing (m1 saw it already).
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: reqDep.id,
        userId: m1.userId,
      });
      expect(await impactOf(admin, { change: 'remove_condition', questionId: reqDep.id })).toBe(
        total - 1,
      );
      // m2 answers it too without seeing it: m2 no longer newly owes it.
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: reqDep.id,
        userId: m2.userId,
      });
      expect(await impactOf(admin, { change: 'remove_condition', questionId: reqDep.id })).toBe(
        total - 2,
      );

      // An unconditional question: every member lacking the answer, as before; an archived or unconditional
      // required question has no condition to remove.
      const plain = await text(admin, 'plain');
      expect(await impactOf(admin, { change: 'make_required', questionId: plain.id })).toBe(total);
      expect(await impactOf(admin, { change: 'remove_condition', questionId: plain.id })).toBe(0);
    });
  }, 120_000);

  it('reactivate of a conditional required question counts only who sees it and lacks the answer', async () => {
    const admin = await person('admin_tenant');
    const m1 = await person('member');
    const m2 = await person('member');
    await withProfileForm(labTenantId, async () => {
      const opener = await yesNo(admin, 'opener');
      const dep = await text(
        admin,
        'dep',
        { questionId: opener.id, values: ['true'] },
        { required: true },
      );
      const answer = (m: Person, value: boolean) =>
        seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: opener.id,
          userId: m.userId,
          value,
        });
      await answer(m1, true);
      await answer(m2, false);
      expect((await archive(admin, dep)).status).toBe(200);

      expect(await impactOf(admin, { change: 'reactivate', questionId: dep.id })).toBe(1);
      // remove_condition of an ARCHIVED question asks nobody.
      expect(await impactOf(admin, { change: 'remove_condition', questionId: dep.id })).toBe(0);
    });
  }, 90_000);

  it('one of conditionQuestionId and conditionValues alone is a 400, and a foreign or missing opener is the same bare 404', async () => {
    const admin = await person('admin_tenant');
    const theirAdmin = await person('admin_tenant', 'demo');
    await withProfileForm(labTenantId, async () => {
      await withProfileForm(demoTenantId, async () => {
        const mine = await yesNo(admin, 'mine');
        const theirs = await made(
          theirAdmin,
          { type: 'yes_no', title: `${TITLE}theirs` },
          HOSTS.demo,
        );

        const alone = await get(admin, '/v1/profile_form/impact', {
          change: 'create_required',
          conditionQuestionId: mine.id,
        });
        expect(alone.status).toBe(400);
        const valuesAlone = await get(admin, '/v1/profile_form/impact', {
          change: 'create_required',
          conditionValues: 'true',
        });
        expect(valuesAlone.status).toBe(400);

        const foreign = await get(admin, '/v1/profile_form/impact', {
          change: 'create_required',
          conditionQuestionId: theirs.id,
          conditionValues: 'true',
        });
        const missing = await get(admin, '/v1/profile_form/impact', {
          change: 'create_required',
          conditionQuestionId: crypto.randomUUID(),
          conditionValues: 'true',
        });
        expect(foreign.status).toBe(404);
        expect(missing.status).toBe(404);
        const foreignBody = (await foreign.json()) as Envelope;
        expect(foreignBody.error.code).toBe('NOT_FOUND');
        expect(foreignBody.error.details).toBeUndefined();
        expect(withoutRequestId(foreignBody)).toEqual(withoutRequestId(await missing.json()));

        // Positive control: my own opener is counted.
        expect(
          await impactOf(admin, {
            change: 'create_required',
            conditionQuestionId: mine.id,
            conditionValues: 'true',
          }),
        ).toBe(0);
        // remove_condition and make_required still need a question id.
        const noId = await get(admin, '/v1/profile_form/impact', { change: 'remove_condition' });
        expect(noId.status).toBe(400);
      });
    });
  }, 90_000);
});

describe('12.1-10 D-634 and PFORM-38: the summary counts members who owe no VISIBLE required question', () => {
  it('PFORM-38 complete equals the gate-function count at every step, moves by exactly one, and never exceeds total', async () => {
    const admin = await person('admin_tenant');
    const m1 = await person('member');
    const m2 = await person('member');
    await withProfileForm(labTenantId, async () => {
      const parity = async (): Promise<Summary> => {
        const summary = await summaryOf(admin);
        expect(summary.complete).toBe(await gateReleased(labTenantId));
        expect(summary.complete).toBeLessThanOrEqual(summary.total);
        expect(Number.isInteger(summary.complete)).toBe(true);
        return summary;
      };

      const empty = await parity();
      expect(empty.hasRequired).toBe(false);
      expect(empty.complete).toBe(empty.total); // no required question: everyone is complete

      const opener = await choice(admin, 'opener', ['A', 'B']);
      const [a, b] = opener.options.map((o) => o.id) as [string, string];
      const dep = await text(
        admin,
        'dep',
        { questionId: opener.id, values: [a] },
        { required: true },
      );

      // Nobody has answered the opener: nobody sees the conditional required question.
      const hidden = await parity();
      expect(hidden.hasRequired).toBe(true);
      expect(hidden.complete).toBe(hidden.total);

      const answerOpener = (m: Person, optionId: string) =>
        seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: opener.id,
          userId: m.userId,
          value: { optionId },
        });
      // m2's answer opens nothing.
      await answerOpener(m2, b);
      expect((await parity()).complete).toBe(hidden.total);

      // m1's answer reveals the question: m1 now owes it, and only m1.
      await answerOpener(m1, a);
      const revealed = await parity();
      expect(revealed.complete).toBe(hidden.total - 1);

      // m1 answers the revealed question: complete moves by exactly one.
      await seedProfileFormAnswer({ tenantId: labTenantId, questionId: dep.id, userId: m1.userId });
      const done = await parity();
      expect(done.complete).toBe(revealed.complete + 1);
      expect(done.complete).toBe(done.total);

      // An unconditional required question joins: everybody who has not answered it owes it.
      const plain = await text(admin, 'plain', null, { required: true });
      const withPlain = await parity();
      expect(withPlain.complete).toBe(0);
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: plain.id,
        userId: m2.userId,
      });
      const afterM2 = await parity();
      expect(afterM2.complete).toBe(1); // m2 answered it and sees nothing else
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: plain.id,
        userId: m1.userId,
      });
      expect((await parity()).complete).toBe(2);
    });
  }, 120_000);

  it('a required conditional question archived, or whose condition is removed, moves the summary as the gate does', async () => {
    const admin = await person('admin_tenant');
    const m1 = await person('member');
    await withProfileForm(labTenantId, async () => {
      const opener = await choice(admin, 'opener', ['A', 'B']);
      const a = opener.options[0]?.id as string;
      const dep = await text(
        admin,
        'dep',
        { questionId: opener.id, values: [a] },
        { required: true },
      );
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: opener.id,
        userId: m1.userId,
        value: { optionId: a },
      });
      const before = await summaryOf(admin);
      expect(before.complete).toBe(await gateReleased(labTenantId));
      expect(before.complete).toBe(before.total - 1);

      // Removing the condition widens who owes it to everyone (the impact said so first).
      const impact = await impactOf(admin, { change: 'remove_condition', questionId: dep.id });
      const removed = await edit(admin, dep, { revision: dep.revision, condition: null });
      expect(removed.status).toBe(200);
      const widened = await summaryOf(admin);
      expect(widened.complete).toBe(await gateReleased(labTenantId));
      expect(widened.complete).toBe(0);
      expect(impact).toBe(before.total - 1); // everyone but m1 newly owes it

      // Archiving it releases everyone.
      expect((await archive(admin, dep)).status).toBe(200);
      const released = await summaryOf(admin);
      expect(released.complete).toBe(released.total);
      expect(released.complete).toBe(await gateReleased(labTenantId));
      expect(released.hasRequired).toBe(false);
    });
  }, 90_000);
});

// The helper keeps the seeded-question shortcut in step with the API-built ones the cases above use.
describe('12.1-10 seed parity: a question seeded with a condition lists like one created by the API', () => {
  it('the list shows the seeded condition and the opener count', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const opener = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        type: 'single_choice',
        title: `${TITLE}seed opener`,
        position: 1,
      });
      const [stored] = await adminSql<{ options: { id: string }[] }[]>`
        select options from public.profile_form_questions where id = ${opener}::uuid`;
      const optionId = stored?.options[0]?.id as string;
      const dependent = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}seed dependent`,
        position: 2,
        conditionQuestionId: opener,
        conditionValues: [optionId],
      });
      const list = await listOf(admin);
      expect(list.questions.find((q) => q.id === opener)?.opensCount).toBe(1);
      expect(list.questions.find((q) => q.id === dependent)?.condition).toEqual({
        questionId: opener,
        values: [optionId],
      });
    });
  }, 60_000);
});

/**
 * 12.1-12 PFORM-41 (parity of the three implementations, integration half): every row of the contracts'
 * `PROFILE_FORM_VISIBILITY_CASES` is run through (1) the TypeScript `isQuestionVisible` over `answerTokens`,
 * (2) the SQL gate `app.profile_form_missing` (the conditional REQUIRED question is counted exactly when it is
 * visible) and (3) the purge `app.profile_form_purge_closed()` (a stored answer to the conditional question is
 * deleted exactly when it is hidden), and all three must equal the row's `expected`. One throwaway member is
 * reused; every row seeds its own opener and dependent, and `afterEach` removes them (answers first).
 */
describe('12.1-12 PFORM-41 parity: TypeScript rule, SQL gate and purge agree on every PROFILE_FORM_VISIBILITY_CASES row', () => {
  let parityMember: Person | null = null;

  beforeAll(async () => {
    parityMember = await person();
  });

  const openerTypeOf = (stored: unknown): string => {
    if (typeof stored === 'boolean' || typeof stored === 'string') return 'yes_no';
    if (
      typeof stored === 'object' &&
      stored !== null &&
      Array.isArray((stored as { optionIds?: unknown }).optionIds)
    ) {
      return 'multiple_choice';
    }
    return 'single_choice';
  };

  it('the table has the 18 rows plan 01 wrote, and names are unique', () => {
    expect(PROFILE_FORM_VISIBILITY_CASES.length).toBeGreaterThanOrEqual(18);
    expect(new Set(PROFILE_FORM_VISIBILITY_CASES.map((row) => row.name)).size).toBe(
      PROFILE_FORM_VISIBILITY_CASES.length,
    );
  });

  for (const row of PROFILE_FORM_VISIBILITY_CASES) {
    it(`${row.name} -> ${row.expected ? 'visible' : 'hidden'}`, async () => {
      const who = parityMember;
      if (!who) throw new Error('the parity member is missing');
      await withProfileForm(labTenantId, async () => {
        const opener = await seedProfileFormQuestion({
          tenantId: labTenantId,
          adminUserId,
          type: openerTypeOf(row.stored),
          title: `${TITLE}parity opener`,
          position: 1,
        });
        const dependent = await seedProfileFormQuestion({
          tenantId: labTenantId,
          adminUserId,
          title: `${TITLE}parity dependent`,
          position: 2,
          required: true,
          conditionQuestionId: opener,
          conditionValues: row.values,
        });
        if (row.stored !== null) {
          await seedProfileFormAnswer({
            tenantId: labTenantId,
            questionId: opener,
            userId: who.userId,
            value: row.stored,
          });
        }
        const [membership] = await adminSql<{ id: string }[]>`
          select id::text as id from public.memberships
           where user_id = ${who.userId}::uuid and tenant_id = ${labTenantId}::uuid`;
        const membershipId = membership?.id as string;

        // 1. TypeScript.
        const viaTypeScript = isQuestionVisible(
          { condition: { questionId: opener, values: row.values } },
          (id) => (id === opener && row.stored !== null ? answerTokens(row.stored) : undefined),
        );
        // 2. The SQL gate: the opener is optional, so the only owed question is the dependent, exactly
        //    when it is visible.
        const [gate] = await adminSql<{ n: number }[]>`
          select app.profile_form_missing(${labTenantId}::uuid, ${membershipId}::uuid) as n`;
        const viaGate = gate?.n === 1;
        expect([0, 1]).toContain(gate?.n);
        // 3. The purge: a stored answer to the dependent survives exactly when it is visible.
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: dependent,
          userId: who.userId,
          value: 'guardada',
        });
        const claims = JSON.stringify({
          sub: who.userId,
          role: 'authenticated',
          tenant_id: labTenantId,
          tenant_role: 'member',
        });
        const purged = await adminSql.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${claims}, true)`;
          await tx.unsafe('set local role authenticated');
          return tx<{ question_id: string }[]>`
            select question_id::text as question_id from app.profile_form_purge_closed()`;
        });
        const [left] = await adminSql<{ n: number }[]>`
          select count(*)::int as n from public.profile_form_answers
           where question_id = ${dependent}::uuid and membership_id = ${membershipId}::uuid`;
        const viaPurge = left?.n === 1;

        expect(viaTypeScript, 'TypeScript isQuestionVisible').toBe(row.expected);
        expect(viaGate, 'SQL gate app.profile_form_missing').toBe(row.expected);
        expect(viaPurge, 'purge app.profile_form_purge_closed').toBe(row.expected);
        // The purge reports the dependent exactly when it deleted it, and never touches the opener's answer.
        expect(purged.map((r) => r.question_id)).toEqual(row.expected ? [] : [dependent]);
        if (row.stored !== null) {
          const [openerLeft] = await adminSql<{ n: number }[]>`
            select count(*)::int as n from public.profile_form_answers
             where question_id = ${opener}::uuid and membership_id = ${membershipId}::uuid`;
          expect(openerLeft?.n).toBe(1);
        }
      });
    }, 30_000);
  }
});
