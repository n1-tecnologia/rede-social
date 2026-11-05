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
 * 12.1-08 (PFORM-27, PFORM-28; D-627, D-633; T-12.1-10, T-12.1-13) against the live local stack: the
 * admin's steps API under `/v1/profile_form/steps`. Create a step and read it back in the builder list,
 * rename it under an optimistic revision, delete it, and the limits, races and positions around them.
 *
 * EVERY identity is a THROWAWAY (`createSharedIdentity`, prefix `pfs`); steps and questions carry the title
 * prefix `pfs ` so the sweep removes only this file's rows (and the default step the database trigger
 * creates for a question that names none, which `removeProfileFormByPrefix` also removes once empty). The
 * module row is restored by `withProfileForm`.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
type Step = {
  id: string;
  title: string;
  position: number;
  revision: number;
  questionCount: number;
};
type ListedQuestion = { id: string; stepId: string; title: string };
type QuestionList = {
  questions: ListedQuestion[];
  activeCount: number;
  limit: number;
  steps: Step[];
  stepLimit: number;
};

const PREFIX = 'pfs';
const TITLE = 'pfs ';
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

const createStep = (p: Person, title: string, host: string = HOSTS.lab) =>
  call(p, 'POST', '/v1/profile_form/steps', { title }, host);

const stepCreated = async (p: Person, title: string, host: string = HOSTS.lab): Promise<Step> => {
  const res = await createStep(p, title, host);
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()) as Step;
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

describe('12.1-08 tracer: an admin creates a step and reads it back in the builder list (D-627)', () => {
  it('creates a step last, the list carries it with its count and every question names its step', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      // The empty form: no step, and a read never creates the default one.
      const before = await listOf(admin);
      expect(before.steps).toEqual([]);
      expect(before.stepLimit).toBe(10);

      const res = await createStep(admin, `  ${TITLE}Dados pessoais  `);
      expect(res.status).toBe(201);
      const step = (await res.json()) as Step;
      expect(step).toMatchObject({
        title: `${TITLE}Dados pessoais`,
        position: 1,
        revision: 1,
        questionCount: 0,
      });
      expect(step.id).toMatch(/^[0-9a-f-]{36}$/);

      const [stored] = await adminSql<{ tenant_id: string }[]>`
        select tenant_id::text as tenant_id from public.profile_form_steps where id = ${step.id}::uuid`;
      expect(stored?.tenant_id).toBe(labTenantId);

      // A question that names no step lands in the tenant's first step (the database trigger).
      const made = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}Primeira`,
        position: 1,
      });
      const after = await listOf(admin);
      expect(after.steps).toEqual([{ ...step, questionCount: 1 }]);
      expect(after.questions).toHaveLength(1);
      expect(after.questions[0]).toMatchObject({ id: made, stepId: step.id });
      expect(after.stepLimit).toBe(10);
      // The payload still carries the Phase 12 keys.
      expect(after.activeCount).toBe(1);
      expect(after.limit).toBe(30);
    });
  }, 30_000);
});
