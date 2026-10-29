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
      expect(await saved.json()).toEqual({ missingRequired: 0 });

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
