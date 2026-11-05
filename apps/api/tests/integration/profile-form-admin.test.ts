import postgres from 'postgres';
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
 * 12-08 (PFORM-01, PFORM-02, PFORM-17, PFORM-24; D-582, D-587, D-596) against the live local stack: the
 * builder's write API under `/v1/profile_form`. Create a question, list the active ones with their counts,
 * edit one under the D-587 lock rules and an optimistic revision, reorder the list.
 *
 * EVERY identity is a THROWAWAY (`createSharedIdentity`, prefix `pfd`); questions carry the title prefix
 * `pfd ` so the sweep removes only this file's rows. The module row is restored by `withProfileForm`.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
type AdminQuestion = {
  id: string;
  type: string;
  title: string;
  helpText: string | null;
  required: boolean;
  showOnProfile: boolean;
  allowOther: boolean;
  limits: { min?: number | string; max?: number | string };
  options: { id: string; label: string; answerCount: number }[];
  position: number;
  revision: number;
  answerCount: number;
  createdAt: string;
  listedAt: string;
};
type QuestionList = { questions: AdminQuestion[]; activeCount: number; limit: number };

const PREFIX = 'pfd';
const TITLE = 'pfd ';
let labTenantId = '';
let demoTenantId = '';
let adminUserId = '';

const DB_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
// A second connection for the cases that hold a member's transaction open.
const memberSql = postgres(DB_URL, { prepare: false, max: 1 });
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

const code = async (res: Response) => ((await res.json()) as Envelope).error.code;
const details = async (res: Response) => ((await res.json()) as Envelope).error.details;

const listOf = async (p: Person, host: string = HOSTS.lab): Promise<QuestionList> => {
  const res = await call(p, 'GET', '/v1/profile_form/questions', undefined, host);
  expect(res.status).toBe(200);
  return (await res.json()) as QuestionList;
};

const create = (p: Person, body: Record<string, unknown>, host: string = HOSTS.lab) =>
  call(p, 'POST', '/v1/profile_form/questions', body, host);

const created = async (
  p: Person,
  body: Record<string, unknown>,
  host: string = HOSTS.lab,
): Promise<AdminQuestion> => {
  const res = await create(p, body, host);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()) as AdminQuestion;
};

/** A question straight through SQL, for the cases that need a fixture the API would not build. */
const question = (over: Partial<Parameters<typeof seedProfileFormQuestion>[0]> = {}) =>
  seedProfileFormQuestion({
    tenantId: labTenantId,
    adminUserId,
    title: `${TITLE}${crypto.randomUUID().slice(0, 8)}`,
    required: false,
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

// Each case builds its own form: nothing a case created may count against the next one's limit.
afterEach(async () => {
  await removeProfileFormByPrefix(TITLE);
});

afterAll(async () => {
  await memberSql.end({ timeout: 2 });
  await sweep();
  // The seed has no `profile_form` row and `withProfileForm` restores that, so none must remain.
  await adminSql`
    delete from public.tenant_modules
     where module_key = 'profile_form' and tenant_id in (${labTenantId}::uuid, ${demoTenantId}::uuid)`;
});

describe('12-08 tracer: an admin creates a question through the guard chain, lists it with its counts and a member sees it', () => {
  it('creates a required short-text question, lists it with answerCount 0 and the member form shows it', async () => {
    const admin = await person('admin_tenant');
    const member = await person('member');
    await withProfileForm(labTenantId, async () => {
      const res = await create(admin, {
        type: 'short_text',
        title: `${TITLE}Como você chegou aqui?`,
        helpText: '  De onde veio o convite  ',
        required: true,
      });
      expect(res.status).toBe(201);
      const made = (await res.json()) as AdminQuestion;
      expect(made).toMatchObject({
        type: 'short_text',
        title: `${TITLE}Como você chegou aqui?`,
        helpText: 'De onde veio o convite',
        required: true,
        showOnProfile: false,
        allowOther: false,
        options: [],
        limits: {},
        revision: 1,
        answerCount: 0,
      });
      expect(made.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Date(made.createdAt).toString()).not.toBe('Invalid Date');
      expect(new Date(made.listedAt).toString()).not.toBe('Invalid Date');

      const [stored] = await adminSql<{ created_by_user_id: string; tenant_id: string }[]>`
        select created_by_user_id::text as created_by_user_id, tenant_id::text as tenant_id
          from public.profile_form_questions where id = ${made.id}::uuid`;
      expect(stored?.created_by_user_id).toBe(admin.userId);
      expect(stored?.tenant_id).toBe(labTenantId);

      const list = await listOf(admin);
      expect(list.activeCount).toBe(1);
      expect(list.limit).toBe(30);
      expect(list.questions).toHaveLength(1);
      expect(list.questions[0]).toMatchObject({ id: made.id, answerCount: 0, revision: 1 });

      // Aggregates only (D-593): no key of the list is, or can carry, an individual answer.
      const forbidden = ['value', 'answer', 'answers', 'otherText'];
      const keysOf = (node: unknown): string[] =>
        node && typeof node === 'object'
          ? Object.entries(node).flatMap(([key, child]) => [key, ...keysOf(child)])
          : [];
      for (const key of keysOf(list)) expect(forbidden).not.toContain(key);

      // The member of the same tenant now sees it in her own form.
      const form = await call(member, 'GET', '/v1/me/profile-form');
      expect(form.status).toBe(200);
      const payload = (await form.json()) as {
        mode: string;
        missingRequired: number;
        questions: { id: string; title: string; required: boolean }[];
      };
      expect(payload.questions.map((q) => q.id)).toEqual([made.id]);
      expect(payload.questions[0]?.required).toBe(true);
      expect(payload.missingRequired).toBe(1);
      expect(payload.mode).toBe('first');
    });
  }, 30_000);

  it('a new question takes max(position) + 1 among the active ones and a choice question gets server-made option ids', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      await question({ position: 4 });
      await question({ position: 9, archived: true });
      const made = await created(admin, {
        type: 'single_choice',
        title: `${TITLE}Escolha`,
        options: [{ label: '  Alfa ' }, { label: 'Beta' }],
        allowOther: true,
      });
      expect(made.position).toBe(5);
      expect(made.options.map((o) => o.label)).toEqual(['Alfa', 'Beta']);
      expect(new Set(made.options.map((o) => o.id)).size).toBe(2);
      for (const option of made.options) {
        expect(option.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(option.answerCount).toBe(0);
      }
      expect(made.allowOther).toBe(true);

      // The caller cannot choose ids, a position or a revision.
      for (const extra of [{ id: crypto.randomUUID() }, { position: 1 }, { revision: 7 }]) {
        const res = await create(admin, { type: 'short_text', title: `${TITLE}x`, ...extra });
        expect(res.status).toBe(400);
      }
    });
  }, 30_000);

  it('the list is in the admin order and a tenant with no question answers an empty list', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      // 12.1-08: the list also carries the tenant's steps (none yet: a read never creates the default one).
      expect(await listOf(admin)).toEqual({
        questions: [],
        activeCount: 0,
        limit: 30,
        steps: [],
        stepLimit: 10,
      });
      const second = await question({ position: 2, title: `${TITLE}B` });
      const first = await question({ position: 1, title: `${TITLE}A` });
      const archived = await question({ position: 0, title: `${TITLE}Z`, archived: true });
      const list = await listOf(admin);
      expect(list.questions.map((q) => q.id)).toEqual([first, second]);
      expect(list.questions.map((q) => q.id)).not.toContain(archived);
      expect(list.activeCount).toBe(2);
    });
  }, 30_000);
});

describe('12-08 the guard chain refuses everyone but the tenant admin (D-596, T-12-19)', () => {
  it('the module off answers 404 MODULE_DISABLED on every route, even to the admin', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(
      labTenantId,
      async () => {
        const list = await call(admin, 'GET', '/v1/profile_form/questions');
        expect(list.status).toBe(404);
        expect(await code(list)).toBe('MODULE_DISABLED');
        const made = await create(admin, { type: 'short_text', title: `${TITLE}off` });
        expect(made.status).toBe(404);
        expect(await code(made)).toBe('MODULE_DISABLED');
        const [row] = await adminSql<{ n: number }[]>`
          select count(*)::int as n from public.profile_form_questions where title like ${`${TITLE}%`}`;
        expect(row?.n).toBe(0);
      },
      { enabled: false },
    );
  }, 30_000);

  it('a support_tenant and a member are refused 403 on the list and on the create, and nothing is written', async () => {
    const support = await person('support_tenant');
    const member = await person('member');
    await withProfileForm(labTenantId, async () => {
      for (const who of [support, member]) {
        const list = await call(who, 'GET', '/v1/profile_form/questions');
        expect(list.status).toBe(403);
        const made = await create(who, { type: 'short_text', title: `${TITLE}x` });
        expect(made.status).toBe(403);
      }
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.profile_form_questions where title like ${`${TITLE}%`}`;
      expect(row?.n).toBe(0);
    });
  }, 30_000);

  it('another tenant’s admin gets his own tenant’s list, and this tenant’s host is TENANT_HOST_MISMATCH for him', async () => {
    const labAdmin = await person('admin_tenant');
    const demoAdmin = await person('admin_tenant', 'demo');
    await withProfileForm(labTenantId, async () => {
      await withProfileForm(demoTenantId, async () => {
        const mine = await created(labAdmin, { type: 'short_text', title: `${TITLE}lab` });
        // His own tenant: an empty list, no trace of the lab question.
        const theirs = await listOf(demoAdmin, HOSTS.demo);
        expect(theirs.questions).toEqual([]);
        expect(JSON.stringify(theirs)).not.toContain(mine.id);
        // This tenant's host with his session: refused before the route runs.
        const list = await call(demoAdmin, 'GET', '/v1/profile_form/questions');
        expect(list.status).toBe(403);
        expect(await code(list)).toBe('TENANT_HOST_MISMATCH');
        const made = await create(demoAdmin, { type: 'short_text', title: `${TITLE}intruso` });
        expect(made.status).toBe(403);
        expect(await code(made)).toBe('TENANT_HOST_MISMATCH');
        const [row] = await adminSql<{ n: number }[]>`
          select count(*)::int as n from public.profile_form_questions
           where title like ${`${TITLE}%`} and tenant_id <> ${labTenantId}::uuid`;
        expect(row?.n).toBe(0);
      });
    });
  }, 30_000);

  it('unauthenticated is 401', async () => {
    const res = await api.request('/v1/profile_form/questions', {
      headers: { 'x-tenant-host': HOSTS.lab },
    });
    expect(res.status).toBe(401);
  });
});

describe('12-08 the limits and the encoding of a new question (PFORM-02)', () => {
  it('the 31st active question is 409 limit_reached; an archived one does not count', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      for (let i = 0; i < 29; i++) await question({ position: i + 1 });
      await question({ position: 99, archived: true });
      const thirtieth = await create(admin, { type: 'short_text', title: `${TITLE}trinta` });
      expect(thirtieth.status).toBe(201);
      const res = await create(admin, { type: 'short_text', title: `${TITLE}trinta e um` });
      expect(res.status).toBe(409);
      expect(await code(res.clone())).toBe('CONFLICT');
      expect(await details(res)).toEqual({ profileForm: 'limit_reached' });
      const list = await listOf(admin);
      expect(list.activeCount).toBe(30);
    });
  }, 60_000);

  it('two simultaneous creates at 29 active questions end with exactly 30', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      for (let i = 0; i < 29; i++) await question({ position: i + 1 });
      const results = await Promise.all(
        [1, 2, 3].map((n) => create(admin, { type: 'short_text', title: `${TITLE}corrida ${n}` })),
      );
      const statuses = results.map((res) => res.status).sort();
      expect(statuses).toEqual([201, 409, 409]);
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.profile_form_questions
         where tenant_id = ${labTenantId}::uuid and archived_at is null and title like ${`${TITLE}%`}`;
      expect(row?.n).toBe(30);
    });
  }, 60_000);

  it('a title that is empty or whitespace only is 400 with details.profileForm = required', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      for (const title of ['', '   ', '\t\n ']) {
        const res = await create(admin, { type: 'short_text', title });
        expect(res.status, JSON.stringify(title)).toBe(400);
        expect(await code(res.clone())).toBe('VALIDATION_FAILED');
        expect(await details(res)).toEqual({ profileForm: 'required' });
      }
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.profile_form_questions where tenant_id = ${labTenantId}::uuid`;
      expect(row?.n).toBe(0);
    });
  }, 30_000);

  it('a title is measured in code points: 120 are accepted with emoji counting one, 121 are refused too_long, help text 300 and 301', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const ok = await create(admin, { type: 'short_text', title: `${TITLE}${'😀'.repeat(116)}` });
      expect(ok.status).toBe(201);
      expect(((await ok.json()) as AdminQuestion).title).toBe(`${TITLE}${'😀'.repeat(116)}`);
      const long = await create(admin, {
        type: 'short_text',
        title: `${TITLE}${'😀'.repeat(117)}`,
      });
      expect(long.status).toBe(400);
      expect(await details(long)).toEqual({ profileForm: 'too_long' });
      const help = await create(admin, {
        type: 'short_text',
        title: `${TITLE}ajuda`,
        helpText: '😀'.repeat(300),
      });
      expect(help.status).toBe(201);
      const tooMuch = await create(admin, {
        type: 'short_text',
        title: `${TITLE}ajuda 2`,
        helpText: '😀'.repeat(301),
      });
      expect(tooMuch.status).toBe(400);
      expect(await details(tooMuch)).toEqual({ profileForm: 'too_long' });
      // Plain 121 ASCII characters: the title test of the plan, too.
      const ascii = await create(admin, { type: 'short_text', title: 'a'.repeat(121) });
      expect(ascii.status).toBe(400);
      expect(await details(ascii)).toEqual({ profileForm: 'too_long' });
    });
  }, 30_000);

  it('a markup title is stored as sent after the trim (only ever rendered as text)', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made = await created(admin, {
        type: 'short_text',
        title: `  ${TITLE}<b>negrito</b> & "aspas"  `,
      });
      expect(made.title).toBe(`${TITLE}<b>negrito</b> & "aspas"`);
    });
  }, 30_000);

  it('a choice question needs two distinct options and a short-text question carries none', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const cases: [string, Record<string, unknown>][] = [
        ['one option', { type: 'dropdown', title: `${TITLE}d`, options: [{ label: 'A' }] }],
        [
          'duplicate options',
          { type: 'dropdown', title: `${TITLE}d`, options: [{ label: 'Sim' }, { label: ' sim ' }] },
        ],
        [
          'options on a text',
          { type: 'short_text', title: `${TITLE}t`, options: [{ label: 'A' }] },
        ],
        ['other on a text', { type: 'short_text', title: `${TITLE}t`, allowOther: true }],
      ];
      for (const [name, body] of cases) {
        const res = await create(admin, body);
        expect(res.status, name).toBe(400);
        expect(await code(res), name).toBe('VALIDATION_FAILED');
      }
    });
  }, 30_000);
});

// ── Task 2: the edit, the lock rules and the optimistic revision ────────────────────────────────────────

const patch = (p: Person, id: string, body: Record<string, unknown>, host: string = HOSTS.lab) =>
  call(p, 'PATCH', `/v1/profile_form/questions/${id}`, body, host);

const edited = async (p: Person, id: string, body: Record<string, unknown>) => {
  const res = await patch(p, id, body);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
  return (await res.json()) as AdminQuestion;
};

/** The stored row, straight from SQL, to prove a refused edit changed nothing. */
const stored = async (id: string) => {
  const [row] = await adminSql<
    { type: string; title: string; revision: number; options: unknown; limits: unknown }[]
  >`select type, title, revision, options, limits from public.profile_form_questions where id = ${id}::uuid`;
  if (!row) throw new Error('question is gone');
  return row;
};

/** One member answers one question through SQL. Returns the member. */
const answered = async (questionId: string, value: unknown): Promise<Person> => {
  const member = await person('member');
  await seedProfileFormAnswer({ tenantId: labTenantId, questionId, userId: member.userId, value });
  return member;
};

const conflict = async (res: Response) => {
  expect(res.status).toBe(409);
  const body = (await res.json()) as Envelope;
  expect(body.error.code).toBe('CONFLICT');
  return body.error.details?.profileForm;
};

describe('12-08 the list counts answers per question and per option (aggregates only)', () => {
  it('counts a single-valued option, a multiple-choice option and an Outro answer', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const single = await created(admin, {
        type: 'single_choice',
        title: `${TITLE}única`,
        options: [{ label: 'Alfa' }, { label: 'Beta' }],
        allowOther: true,
      });
      const multi = await created(admin, {
        type: 'multiple_choice',
        title: `${TITLE}várias`,
        options: [{ label: 'Um' }, { label: 'Dois' }, { label: 'Três' }],
      });
      const [sa, sb] = single.options;
      const [m1, m2] = multi.options;
      await answered(single.id, { optionId: sa?.id, otherText: null });
      await answered(single.id, { optionId: sa?.id, otherText: null });
      await answered(single.id, { optionId: sb?.id, otherText: null });
      await answered(single.id, { optionId: null, otherText: 'Outra coisa' });
      await answered(multi.id, { optionIds: [m1?.id, m2?.id], otherText: null });
      await answered(multi.id, { optionIds: [m1?.id], otherText: null });
      const list = await listOf(admin);
      const s = list.questions.find((q) => q.id === single.id);
      const m = list.questions.find((q) => q.id === multi.id);
      expect(s?.answerCount).toBe(4);
      expect(s?.options.map((o) => o.answerCount)).toEqual([2, 1]);
      expect(m?.answerCount).toBe(2);
      expect(m?.options.map((o) => o.answerCount)).toEqual([2, 1, 0]);
      // No answer text travels in the list (D-593).
      expect(JSON.stringify(list)).not.toContain('Outra coisa');
    });
  }, 60_000);
});

describe('12-08 what is free on an answered question (D-587)', () => {
  it('title, help text and required change freely and each edit bumps the revision once', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made = await created(admin, { type: 'short_text', title: `${TITLE}livre` });
      await answered(made.id, 'resposta');
      const after = await edited(admin, made.id, {
        revision: made.revision,
        title: `${TITLE}livre 2`,
        helpText: '  nova ajuda ',
        required: true,
      });
      expect(after).toMatchObject({
        title: `${TITLE}livre 2`,
        helpText: 'nova ajuda',
        required: true,
        revision: 2,
        answerCount: 1,
      });
      const cleared = await edited(admin, made.id, { revision: 2, helpText: '' });
      expect(cleared.helpText).toBeNull();
      expect(cleared.revision).toBe(3);
    });
  }, 30_000);

  it('with zero answers every field is free, the type included; with exactly one answer the type is locked', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made = await created(admin, { type: 'short_text', title: `${TITLE}tipo` });
      const toNumber = await edited(admin, made.id, {
        revision: 1,
        type: 'number',
        limits: { min: 1 },
      });
      expect(toNumber).toMatchObject({ type: 'number', limits: { min: 1 }, revision: 2 });
      // A type change drops what the new type cannot carry.
      const toChoice = await edited(admin, made.id, {
        revision: 2,
        type: 'dropdown',
        options: [{ label: 'A' }, { label: 'B' }],
      });
      expect(toChoice).toMatchObject({ type: 'dropdown', limits: {} });
      expect(toChoice.options).toHaveLength(2);
      const toText = await edited(admin, made.id, { revision: 3, type: 'short_text' });
      expect(toText).toMatchObject({
        type: 'short_text',
        options: [],
        allowOther: false,
        limits: {},
      });

      await answered(made.id, 'uma resposta');
      const res = await patch(admin, made.id, { revision: 4, type: 'long_text' });
      expect(await conflict(res)).toBe('type_locked');
      expect((await stored(made.id)).type).toBe('short_text');
    });
  }, 60_000);
});

describe('12-08 each D-587 lock, through HTTP, with its allowed counterpart', () => {
  it('option_locked: an answered option cannot be renamed (even by case or inner whitespace) or removed; an unanswered one can; adding and reordering work', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made = await created(admin, {
        type: 'single_choice',
        title: `${TITLE}opções`,
        options: [{ label: 'Alfa' }, { label: 'Beta' }],
      });
      const [a, b] = made.options;
      if (!a || !b) throw new Error('options missing');
      await answered(made.id, { optionId: a.id, otherText: null });

      for (const label of ['Alfa 2', 'alfa', 'Alfa ', 'Al fa']) {
        // `Alfa ` is trimmed by the schema to `Alfa`: that one is no rename at all.
        const res = await patch(admin, made.id, {
          revision: 1,
          options: [
            { id: a.id, label },
            { id: b.id, label: b.label },
          ],
        });
        if (label === 'Alfa ') {
          expect(res.status).toBe(200);
        } else {
          expect(await conflict(res), label).toBe('option_locked');
        }
      }
      const unchanged = await stored(made.id);
      expect(unchanged.revision).toBe(1);

      // Removing the answered option.
      const removed = await patch(admin, made.id, {
        revision: 1,
        options: [{ id: b.id, label: b.label }, { label: 'Nova' }],
      });
      expect(await conflict(removed)).toBe('option_locked');

      // The unanswered one renames, a new one is added beside them, and the order changes.
      const renamed = await edited(admin, made.id, {
        revision: 1,
        options: [{ id: a.id, label: a.label }, { id: b.id, label: 'Beta 2' }, { label: 'Gama' }],
      });
      expect(renamed.options.map((o) => o.label)).toEqual(['Alfa', 'Beta 2', 'Gama']);
      expect(renamed.revision).toBe(2);
      const [, , gama] = renamed.options;
      if (!gama) throw new Error('new option missing');
      expect(gama.id).toMatch(/^[0-9a-f-]{36}$/);

      // Reordering never changes what a stored answer means: answers name ids, never positions.
      const reordered = await edited(admin, made.id, {
        revision: 2,
        options: [
          { id: gama.id, label: 'Gama' },
          { id: b.id, label: 'Beta 2' },
          { id: a.id, label: 'Alfa' },
        ],
      });
      expect(reordered.options.map((o) => o.label)).toEqual(['Gama', 'Beta 2', 'Alfa']);
      expect(reordered.options.find((o) => o.id === a.id)?.answerCount).toBe(1);
      expect(reordered.answerCount).toBe(1);
    });
  }, 60_000);

  it('an option list can never be emptied below two, answered or not; a foreign or repeated option id is refused', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made = await created(admin, {
        type: 'dropdown',
        title: `${TITLE}mínimo`,
        options: [{ label: 'Alfa' }, { label: 'Beta' }],
      });
      for (const options of [[], [{ label: 'Só uma' }]]) {
        const res = await patch(admin, made.id, { revision: 1, options });
        expect(res.status).toBe(400);
        expect(await details(res)).toEqual({ profileForm: 'invalid' });
      }
      const [a] = made.options;
      if (!a) throw new Error('options missing');
      for (const options of [
        [{ id: crypto.randomUUID(), label: 'Alfa' }, { label: 'Beta' }],
        [
          { id: a.id, label: 'Alfa' },
          { id: a.id, label: 'Beta' },
        ],
      ]) {
        const res = await patch(admin, made.id, { revision: 1, options });
        expect(res.status).toBe(400);
        expect(await details(res)).toEqual({ profileForm: 'unknown_option' });
      }
      await answered(made.id, { optionId: a.id, otherText: null });
      const res = await patch(admin, made.id, { revision: 1, options: [] });
      expect(res.status).toBe(400);
      expect((await stored(made.id)).revision).toBe(1);
    });
  }, 60_000);

  it('other_locked: Outro cannot be switched off while an Outro answer exists, and can without one', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const withOther = await created(admin, {
        type: 'single_choice',
        title: `${TITLE}outro`,
        options: [{ label: 'Alfa' }, { label: 'Beta' }],
        allowOther: true,
      });
      const [a] = withOther.options;
      await answered(withOther.id, { optionId: a?.id, otherText: null });
      // An option answer is not an Outro answer: switching off is still allowed...
      const off = await edited(admin, withOther.id, { revision: 1, allowOther: false });
      expect(off.allowOther).toBe(false);
      // ...but with an Outro answer present it is not.
      const locked = await created(admin, {
        type: 'single_choice',
        title: `${TITLE}outro 2`,
        options: [{ label: 'Alfa' }, { label: 'Beta' }],
        allowOther: true,
      });
      await answered(locked.id, { optionId: null, otherText: 'Minha resposta' });
      const res = await patch(admin, locked.id, { revision: 1, allowOther: false });
      expect(await conflict(res)).toBe('other_locked');
      expect((await edited(admin, locked.id, { revision: 1, allowOther: true })).revision).toBe(1);
    });
  }, 60_000);

  it('visibility_locked: private to public is refused once answered; public to private stays allowed', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const privateOne = await created(admin, { type: 'short_text', title: `${TITLE}privada` });
      await answered(privateOne.id, 'segredo');
      const res = await patch(admin, privateOne.id, { revision: 1, showOnProfile: true });
      expect(await conflict(res)).toBe('visibility_locked');

      const publicOne = await created(admin, {
        type: 'short_text',
        title: `${TITLE}pública`,
        showOnProfile: true,
      });
      await answered(publicOne.id, 'aberto');
      const down = await edited(admin, publicOne.id, { revision: 1, showOnProfile: false });
      expect(down.showOnProfile).toBe(false);
      // And once private again it cannot go back to public.
      const back = await patch(admin, publicOne.id, { revision: 2, showOnProfile: true });
      expect(await conflict(back)).toBe('visibility_locked');
    });
  }, 60_000);

  it('limits_locked: a number limit cannot narrow, equal is accepted, widening is accepted; decimals compare exactly', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made = await created(admin, {
        type: 'number',
        title: `${TITLE}número`,
        limits: { min: 1, max: 10 },
      });
      await answered(made.id, 5);
      for (const limits of [
        { min: 2, max: 10 },
        { min: 1, max: 9 },
      ]) {
        const res = await patch(admin, made.id, { revision: 1, limits });
        expect(await conflict(res)).toBe('limits_locked');
      }
      // The same limits: no change, 200, the revision stays.
      const same = await edited(admin, made.id, { revision: 1, limits: { min: 1, max: 10 } });
      expect(same.revision).toBe(1);
      // Widened, and one bound removed.
      const wide = await edited(admin, made.id, { revision: 1, limits: { min: 0, max: 11 } });
      expect(wide).toMatchObject({ limits: { min: 0, max: 11 }, revision: 2 });
      const open = await edited(admin, made.id, { revision: 2, limits: { min: 0 } });
      expect(open.limits).toEqual({ min: 0 });
      // A bound that did not exist is a narrowing.
      const bound = await patch(admin, made.id, { revision: 3, limits: { min: 0, max: 100 } });
      expect(await conflict(bound)).toBe('limits_locked');

      const decimal = await created(admin, {
        type: 'number',
        title: `${TITLE}decimal`,
        limits: { min: 0.1 },
      });
      await answered(decimal.id, 0.5);
      const narrow = await patch(admin, decimal.id, { revision: 1, limits: { min: 0.2 } });
      expect(await conflict(narrow)).toBe('limits_locked');
    });
  }, 60_000);

  it('limits_locked: a date limit cannot narrow, compared as calendar days', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made = await created(admin, {
        type: 'date',
        title: `${TITLE}data`,
        limits: { min: '2026-01-01', max: '2026-12-31' },
      });
      await answered(made.id, '2026-05-01');
      for (const limits of [
        { min: '2026-01-02', max: '2026-12-31' },
        { min: '2026-01-01', max: '2026-12-30' },
      ]) {
        const res = await patch(admin, made.id, { revision: 1, limits });
        expect(await conflict(res)).toBe('limits_locked');
      }
      const same = await edited(admin, made.id, {
        revision: 1,
        limits: { min: '2026-01-01', max: '2026-12-31' },
      });
      expect(same.revision).toBe(1);
      const wide = await edited(admin, made.id, {
        revision: 1,
        limits: { min: '2025-12-31', max: '2027-01-01' },
      });
      expect(wide.revision).toBe(2);
    });
  }, 60_000);

  it('limits: {} is accepted, and setting only a min is accepted, when nothing is answered', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made = await created(admin, { type: 'number', title: `${TITLE}vazio`, limits: {} });
      const onlyMin = await edited(admin, made.id, { revision: 1, limits: { min: 3 } });
      expect(onlyMin.limits).toEqual({ min: 3 });
      const none = await edited(admin, made.id, { revision: 2, limits: {} });
      expect(none.limits).toEqual({});
      // min greater than max is a validation error, not a lock.
      const bad = await patch(admin, made.id, { revision: 3, limits: { min: 9, max: 2 } });
      expect(bad.status).toBe(400);
      expect(await details(bad)).toEqual({ profileForm: 'out_of_range' });
    });
  }, 60_000);
});

describe('12-08 the optimistic revision and the idempotency of an edit (PFORM-24, T-12-21)', () => {
  it('a stale revision is 409 and changes nothing; the same patch twice is 200 then 409; an unchanged body keeps the revision', async () => {
    const admin = await person('admin_tenant');
    const other = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made = await created(admin, { type: 'short_text', title: `${TITLE}revisão` });
      const body = { revision: 1, title: `${TITLE}revisão B` };
      expect((await edited(admin, made.id, body)).revision).toBe(2);
      // The second admin still holds revision 1.
      const stale = await patch(other, made.id, { revision: 1, title: `${TITLE}revisão C` });
      expect(await conflict(stale)).toBe('stale_revision');
      expect((await stored(made.id)).title).toBe(`${TITLE}revisão B`);
      // Replaying the same body with the same revision.
      const replay = await patch(admin, made.id, body);
      expect(await conflict(replay)).toBe('stale_revision');
      // An unchanged body with the fresh revision.
      const noop = await edited(admin, made.id, { revision: 2, title: `${TITLE}revisão B` });
      expect(noop.revision).toBe(2);
      const bare = await edited(admin, made.id, { revision: 2 });
      expect(bare.revision).toBe(2);
      expect((await stored(made.id)).revision).toBe(2);
    });
  }, 60_000);

  it('two admins patching at once with the same revision: one wins, one is stale_revision', async () => {
    const one = await person('admin_tenant');
    const two = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made = await created(one, { type: 'short_text', title: `${TITLE}corrida` });
      const results = await Promise.all([
        patch(one, made.id, { revision: 1, title: `${TITLE}um` }),
        patch(two, made.id, { revision: 1, title: `${TITLE}dois` }),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      const loser = results.find((res) => res.status === 409);
      expect(await conflict(loser as Response)).toBe('stale_revision');
      const row = await stored(made.id);
      expect(row.revision).toBe(2);
    });
  }, 60_000);

  it('an archived question is read-only: 409 already_archived', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made = await created(admin, { type: 'short_text', title: `${TITLE}arquivada` });
      await adminSql`update public.profile_form_questions set archived_at = now() where id = ${made.id}::uuid`;
      const res = await patch(admin, made.id, { revision: 1, title: `${TITLE}nova` });
      expect(await conflict(res)).toBe('already_archived');
      expect((await stored(made.id)).title).toBe(`${TITLE}arquivada`);
    });
  }, 60_000);
});

describe('12-08 the guard chain on the edit, and the bare 404 (T-12-19)', () => {
  it('another tenant’s id and an unknown id are the same bare 404; support and member are 403; the module off is MODULE_DISABLED', async () => {
    const labAdmin = await person('admin_tenant');
    const demoAdmin = await person('admin_tenant', 'demo');
    const support = await person('support_tenant');
    const member = await person('member');
    await withProfileForm(labTenantId, async () => {
      await withProfileForm(demoTenantId, async () => {
        const made = await created(labAdmin, { type: 'short_text', title: `${TITLE}minha` });
        const foreign = await patch(
          demoAdmin,
          made.id,
          { revision: 1, title: `${TITLE}x` },
          HOSTS.demo,
        );
        const unknown = await patch(
          demoAdmin,
          crypto.randomUUID(),
          { revision: 1, title: `${TITLE}x` },
          HOSTS.demo,
        );
        expect(foreign.status).toBe(404);
        expect(unknown.status).toBe(404);
        const strip = async (res: Response) => {
          const { requestId: _requestId, ...rest } = (await res.json()) as Envelope & {
            requestId?: unknown;
          } as Record<string, unknown>;
          const error = rest.error as Record<string, unknown> | undefined;
          if (error) delete error.requestId;
          return rest;
        };
        expect(await strip(foreign)).toEqual(await strip(unknown));
        expect((await stored(made.id)).title).toBe(`${TITLE}minha`);

        // This tenant's host with the other tenant's session is refused before the route.
        const wrongHost = await patch(demoAdmin, made.id, { revision: 1, title: `${TITLE}x` });
        expect(wrongHost.status).toBe(403);
        expect(await code(wrongHost)).toBe('TENANT_HOST_MISMATCH');

        for (const who of [support, member]) {
          const res = await patch(who, made.id, { revision: 1, title: `${TITLE}x` });
          expect(res.status).toBe(403);
        }
      });
    });
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made = await created(admin, { type: 'short_text', title: `${TITLE}desligado` });
      await withProfileForm(
        labTenantId,
        async () => {
          const res = await patch(admin, made.id, { revision: 1, title: `${TITLE}x` });
          expect(res.status).toBe(404);
          expect(await code(res)).toBe('MODULE_DISABLED');
        },
        { enabled: false },
      );
    });
  }, 60_000);

  it('the body cannot reach the columns the edit does not own', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made = await created(admin, { type: 'short_text', title: `${TITLE}fixa` });
      for (const extra of [
        { archivedAt: new Date().toISOString() },
        { position: 9 },
        { listedAt: new Date().toISOString() },
        { tenantId: demoTenantId },
        { id: crypto.randomUUID() },
      ]) {
        const res = await patch(admin, made.id, { revision: 1, ...extra });
        expect(res.status).toBe(400);
      }
      const [row] = await adminSql<{ archived_at: unknown; position: number; tenant_id: string }[]>`
        select archived_at, position, tenant_id::text as tenant_id from public.profile_form_questions where id = ${made.id}::uuid`;
      expect(row?.archived_at).toBeNull();
      expect(row?.tenant_id).toBe(labTenantId);
    });
  }, 60_000);
});

describe('12-08 an answer racing the edit is stopped by the row lock taken first (PFORM-17, T-12-20)', () => {
  it('the member’s transaction holds the question and an answer; the admin’s type change waits, then is refused type_locked and never a 500', async () => {
    const admin = await person('admin_tenant');
    const member = await person('member');
    await withProfileForm(labTenantId, async () => {
      const made = await created(admin, {
        type: 'short_text',
        title: `${TITLE}corrida de resposta`,
      });

      let release: () => void = () => {};
      let held: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holding = new Promise<void>((resolve) => {
        held = resolve;
      });
      const claims = JSON.stringify({
        sub: member.userId,
        role: 'authenticated',
        tenant_id: labTenantId,
        tenant_role: 'member',
      });
      // What a member's save does first: claims, the authenticated role, the FOR SHARE lock through the
      // definer function, then the answer; the transaction stays open until we let it commit.
      const memberTx = memberSql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`;
        await tx.unsafe('set local role authenticated');
        const locked = await tx`select id::text as id from app.profile_form_lock_active()`;
        expect(locked.map((row) => row.id)).toEqual([made.id]);
        await tx`
          insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
          select m.tenant_id, ${made.id}::uuid, m.id, m.user_id, ${tx.json('resposta')}
            from public.memberships m
           where m.tenant_id = ${labTenantId}::uuid and m.user_id = ${member.userId}::uuid`;
        held();
        await gate;
      });
      await holding;

      let done = false;
      const edit = Promise.resolve(patch(admin, made.id, { revision: 1, type: 'long_text' })).then(
        (res) => {
          done = true;
          return res;
        },
      );
      await sleep(600);
      expect(done, 'the edit waited for the member’s lock').toBe(false);

      release();
      await memberTx;
      const res = await edit;
      expect(await conflict(res)).toBe('type_locked');
      const row = await stored(made.id);
      expect(row.type).toBe('short_text');
      expect(row.revision).toBe(1);
    });
  }, 60_000);
});

// ── Task 3: the reorder ──────────────────────────────────────────────────────────────────────────────────

const reorder = (p: Person, ids: unknown, host: string = HOSTS.lab) =>
  call(p, 'PUT', '/v1/profile_form/order', { ids }, host);

const positionsOf = async (): Promise<{ id: string; position: number }[]> =>
  adminSql<{ id: string; position: number }[]>`
    select id::text as id, position from public.profile_form_questions
     where tenant_id = ${labTenantId}::uuid and archived_at is null and title like ${`${TITLE}%`}
     order by position, created_at, id`;

describe('12-08 reordering the form (PFORM-02, D-582)', () => {
  it('renumbers the whole active list 1..n and the member’s form follows the new order, with no revision bump', async () => {
    const admin = await person('admin_tenant');
    const member = await person('member');
    await withProfileForm(labTenantId, async () => {
      const a = await created(admin, { type: 'short_text', title: `${TITLE}A` });
      const b = await created(admin, { type: 'short_text', title: `${TITLE}B` });
      const c = await created(admin, { type: 'short_text', title: `${TITLE}C` });
      await answered(a.id, 'resposta de A');

      const res = await reorder(admin, [c.id, a.id, b.id]);
      expect(res.status).toBe(200);
      const list = (await res.json()) as QuestionList;
      expect(list.questions.map((q) => q.id)).toEqual([c.id, a.id, b.id]);
      expect(list.questions.map((q) => q.position)).toEqual([1, 2, 3]);
      expect(list.questions.map((q) => q.revision)).toEqual([1, 1, 1]);
      expect(list.activeCount).toBe(3);
      expect(list.questions.find((q) => q.id === a.id)?.answerCount).toBe(1);

      const form = await call(member, 'GET', '/v1/me/profile-form');
      const payload = (await form.json()) as { questions: { id: string }[] };
      expect(payload.questions.map((q) => q.id)).toEqual([c.id, a.id, b.id]);
      expect((await listOf(admin)).questions.map((q) => q.id)).toEqual([c.id, a.id, b.id]);
    });
  }, 60_000);

  it('a list of one is accepted for a tenant with one active question; an archived question keeps its place out of the list', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const only = await created(admin, { type: 'short_text', title: `${TITLE}única` });
      const archived = await question({ position: 7, archived: true });
      const res = await reorder(admin, [only.id]);
      expect(res.status).toBe(200);
      expect(((await res.json()) as QuestionList).questions.map((q) => q.position)).toEqual([1]);
      const [row] = await adminSql<{ position: number }[]>`
        select position from public.profile_form_questions where id = ${archived}::uuid`;
      expect(row?.position).toBe(7);
    });
  }, 60_000);

  it('a list that is not exactly the active set is 409 order_mismatch and changes nothing', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const a = await created(admin, { type: 'short_text', title: `${TITLE}A` });
      const b = await created(admin, { type: 'short_text', title: `${TITLE}B` });
      const archived = await question({ position: 9, archived: true });
      const before = await positionsOf();
      const cases: [string, unknown][] = [
        ['one id missing', [a.id]],
        ['an unknown extra id', [b.id, a.id, crypto.randomUUID()]],
        ['a duplicate', [a.id, a.id]],
        ['a duplicate that hides a missing id', [a.id, a.id, b.id]],
        ['an archived id in place of an active one', [a.id, archived]],
        ['an archived id besides the active ones', [b.id, a.id, archived]],
        ['an empty list', []],
        ['an id that is not a uuid', [a.id, 'nope']],
        ['the same ids in upper case still need to be a set', [a.id.toUpperCase(), a.id]],
      ];
      for (const [name, ids] of cases) {
        const res = await reorder(admin, ids);
        expect(res.status, name).toBe(409);
        expect(await details(res), name).toEqual({ profileForm: 'order_mismatch' });
      }
      expect(await positionsOf()).toEqual(before);
      // The same ids in upper case are the same set: they are accepted.
      const upper = await reorder(admin, [b.id.toUpperCase(), a.id.toUpperCase()]);
      expect(upper.status).toBe(200);
      expect(((await upper.json()) as QuestionList).questions.map((q) => q.id)).toEqual([
        b.id,
        a.id,
      ]);
    });
  }, 60_000);

  it('another tenant’s ids are order_mismatch, never a leak, and are never renumbered', async () => {
    const labAdmin = await person('admin_tenant');
    const demoAdmin = await person('admin_tenant', 'demo');
    await withProfileForm(labTenantId, async () => {
      await withProfileForm(demoTenantId, async () => {
        const mine = await created(labAdmin, { type: 'short_text', title: `${TITLE}minha` });
        const mine2 = await created(labAdmin, { type: 'short_text', title: `${TITLE}minha 2` });
        const theirs = await created(
          demoAdmin,
          { type: 'short_text', title: `${TITLE}deles` },
          HOSTS.demo,
        );
        const before = await positionsOf();

        // The demo admin names the lab ids on his own host, and the lab admin names the demo id.
        const fromDemo = await reorder(demoAdmin, [mine2.id, mine.id], HOSTS.demo);
        expect(fromDemo.status).toBe(409);
        expect(await details(fromDemo)).toEqual({ profileForm: 'order_mismatch' });
        const fromLab = await reorder(labAdmin, [mine2.id, mine.id, theirs.id]);
        expect(fromLab.status).toBe(409);
        expect(await positionsOf()).toEqual(before);
        const [demoRow] = await adminSql<{ position: number }[]>`
          select position from public.profile_form_questions where id = ${theirs.id}::uuid`;
        expect(demoRow?.position).toBe(1);

        // Positive controls: each reorders its own.
        expect((await reorder(labAdmin, [mine2.id, mine.id])).status).toBe(200);
        expect((await reorder(demoAdmin, [theirs.id], HOSTS.demo)).status).toBe(200);
      });
    });
  }, 60_000);

  it('support, member and the module off are refused like every other route', async () => {
    const admin = await person('admin_tenant');
    const support = await person('support_tenant');
    const member = await person('member');
    await withProfileForm(labTenantId, async () => {
      const a = await created(admin, { type: 'short_text', title: `${TITLE}A` });
      for (const who of [support, member]) {
        expect((await reorder(who, [a.id])).status).toBe(403);
      }
      await withProfileForm(
        labTenantId,
        async () => {
          const res = await reorder(admin, [a.id]);
          expect(res.status).toBe(404);
          expect(await code(res)).toBe('MODULE_DISABLED');
        },
        { enabled: false },
      );
    });
  }, 60_000);

  it('a reorder racing a create ends with a consistent 1..n numbering and one holder of the last slot', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const a = await created(admin, { type: 'short_text', title: `${TITLE}A` });
      const b = await created(admin, { type: 'short_text', title: `${TITLE}B` });
      let order = [a.id, b.id];
      for (let round = 0; round < 6; round++) {
        const swapped = [...order].reverse();
        const [moved, made] = await Promise.all([
          reorder(admin, swapped),
          create(admin, { type: 'short_text', title: `${TITLE}nova ${round}` }),
        ]);
        expect(made.status, `round ${round}`).toBe(201);
        // The reorder either ran first (200) or saw the new question and found the set changed (409).
        expect([200, 409], `round ${round}`).toContain(moved.status);
        const rows = await positionsOf();
        expect(
          rows.map((row) => row.position),
          `round ${round}`,
        ).toEqual(rows.map((_row, i) => i + 1));
        order = rows.map((row) => row.id);
      }
      expect(order).toHaveLength(8);
    });
  }, 90_000);

  it('a reorder racing a reorder leaves one complete order, never a mix', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const ids = [
        (await created(admin, { type: 'short_text', title: `${TITLE}A` })).id,
        (await created(admin, { type: 'short_text', title: `${TITLE}B` })).id,
        (await created(admin, { type: 'short_text', title: `${TITLE}C` })).id,
      ];
      const forward = [...ids];
      const backward = [...ids].reverse();
      for (let round = 0; round < 5; round++) {
        const [one, two] = await Promise.all([reorder(admin, forward), reorder(admin, backward)]);
        expect([one.status, two.status]).toEqual([200, 200]);
        const rows = await positionsOf();
        expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
        const order = rows.map((row) => row.id);
        expect([forward, backward]).toContainEqual(order);
      }
    });
  }, 90_000);
});
