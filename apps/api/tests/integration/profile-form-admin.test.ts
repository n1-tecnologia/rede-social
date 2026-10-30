import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  removeProfileFormByPrefix,
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

const create = (p: Person, body: Record<string, unknown>) =>
  call(p, 'POST', '/v1/profile_form/questions', body);

const created = async (p: Person, body: Record<string, unknown>): Promise<AdminQuestion> => {
  const res = await create(p, body);
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
      expect(await listOf(admin)).toEqual({ questions: [], activeCount: 0, limit: 30 });
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
