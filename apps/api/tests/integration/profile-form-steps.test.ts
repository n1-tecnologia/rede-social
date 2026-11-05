import { PROFILE_FORM_DEFAULT_STEP_TITLE } from '@rede-social/contracts/profile-form';
import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import { ensureDefaultStep } from '@rede-social/core/server/profile-form/steps';
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

// ── Task 2: rename, delete, the limits and the positions ────────────────────────────────────────

const renameStep = (
  p: Person,
  id: string,
  body: Record<string, unknown>,
  host: string = HOSTS.lab,
) => call(p, 'PATCH', `/v1/profile_form/steps/${id}`, body, host);

const deleteStep = (p: Person, id: string, host: string = HOSTS.lab) =>
  call(p, 'DELETE', `/v1/profile_form/steps/${id}`, undefined, host);

type StepRow = { id: string; title: string; position: number; revision: number };

/** The tenant's steps straight from the database, in the canonical order. */
const stepsIn = (tenantId: string) =>
  adminSql<StepRow[]>`
    select id::text as id, title, position, revision from public.profile_form_steps
     where tenant_id = ${tenantId}::uuid
     order by position, created_at, id`;

const positionsOf = (steps: { position: number }[]) => steps.map((step) => step.position);
const oneTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('12.1-08 PFORM-27: an admin renames a step under the optimistic revision', () => {
  it('stores the trimmed title, bumps the revision, and a stale revision is 409 stale_revision with nothing written', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const step = await stepCreated(admin, `${TITLE}Antes`);

      const ok = await renameStep(admin, step.id, { revision: 1, title: `  ${TITLE}Depois  ` });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ ...step, title: `${TITLE}Depois`, revision: 2 });

      const stale = await renameStep(admin, step.id, { revision: 1, title: `${TITLE}Velha` });
      expect(stale.status).toBe(409);
      expect(await code(stale.clone())).toBe('CONFLICT');
      expect(await details(stale)).toEqual({ profileForm: 'stale_revision' });
      const [stored] = await stepsIn(labTenantId);
      expect(stored).toMatchObject({ title: `${TITLE}Depois`, revision: 2 });

      // The fresh revision wins and the list shows the new title.
      const again = await renameStep(admin, step.id, { revision: 2, title: `${TITLE}Terceira` });
      expect(again.status).toBe(200);
      expect(((await again.json()) as Step).revision).toBe(3);
      expect((await listOf(admin)).steps.map((s) => s.title)).toEqual([`${TITLE}Terceira`]);
    });
  }, 30_000);

  it('an unknown step id is the bare 404 and a bad body is a 400 with a code', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const step = await stepCreated(admin, `${TITLE}Uma`);
      const unknown = await renameStep(admin, crypto.randomUUID(), {
        revision: 1,
        title: `${TITLE}x`,
      });
      expect(unknown.status).toBe(404);
      const envelope = (await unknown.json()) as Envelope;
      expect(envelope.error.code).toBe('NOT_FOUND');
      expect(envelope.error.details).toBeUndefined();

      for (const [body, issue] of [
        [{ revision: 1, title: '   ' }, 'required'],
        [{ revision: 1, title: `${TITLE}${'a'.repeat(57)}` }, 'too_long'],
        [{ revision: 0, title: `${TITLE}x` }, 'invalid'],
      ] as const) {
        const res = await renameStep(admin, step.id, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(await details(res)).toEqual({ profileForm: issue });
      }
      const extra = await renameStep(admin, step.id, {
        revision: 1,
        title: `${TITLE}x`,
        position: 3,
      });
      expect(extra.status).toBe(400);
      const [stored] = await stepsIn(labTenantId);
      expect(stored).toMatchObject({ title: `${TITLE}Uma`, revision: 1 });
    });
  }, 30_000);
});

describe('12.1-08 PFORM-27: an admin deletes a step without losing a question or an answer', () => {
  it('refuses step_not_empty while an ACTIVE question is inside and last_step for the only step; nothing changes', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const first = await stepCreated(admin, `${TITLE}Primeira`);
      const second = await stepCreated(admin, `${TITLE}Segunda`);
      const question = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}Ativa`,
        position: 1,
        stepId: first.id,
      });

      const busy = await deleteStep(admin, first.id);
      expect(busy.status).toBe(409);
      expect(await details(busy)).toEqual({ profileForm: 'step_not_empty' });
      expect((await stepsIn(labTenantId)).map((s) => s.id)).toEqual([first.id, second.id]);
      const [kept] = await adminSql<{ step_id: string; archived_at: Date | null }[]>`
        select step_id::text as step_id, archived_at from public.profile_form_questions
         where id = ${question}::uuid`;
      expect(kept).toMatchObject({ step_id: first.id, archived_at: null });

      // The empty second step goes; the first is now the only one and stays (it also holds the question,
      // so it is `step_not_empty` first: archive the question to reach `last_step`).
      const gone = await deleteStep(admin, second.id);
      expect(gone.status).toBe(200);
      expect(await gone.json()).toEqual({ deleted: true });
      await adminSql`update public.profile_form_questions set archived_at = now() where id = ${question}::uuid`;
      const last = await deleteStep(admin, first.id);
      expect(last.status).toBe(409);
      expect(await details(last)).toEqual({ profileForm: 'last_step' });
      expect((await stepsIn(labTenantId)).map((s) => s.id)).toEqual([first.id]);
    });
  }, 30_000);

  it('re-points the ARCHIVED questions to the first remaining step, keeps their answers, and renumbers the steps 1..n', async () => {
    const admin = await person('admin_tenant');
    const member = await person('member');
    await withProfileForm(labTenantId, async () => {
      const a = await stepCreated(admin, `${TITLE}A`);
      const b = await stepCreated(admin, `${TITLE}B`);
      const c = await stepCreated(admin, `${TITLE}C`);
      const archived = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}Arquivada`,
        archived: true,
        stepId: b.id,
      });
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: archived,
        userId: member.userId,
      });
      const active = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}Ativa`,
        position: 1,
        stepId: c.id,
      });

      // The count is of ACTIVE questions: B holds an archived one and counts 0.
      const before = await listOf(admin);
      expect(before.steps.map((s) => [s.id, s.questionCount])).toEqual([
        [a.id, 0],
        [b.id, 0],
        [c.id, 1],
      ]);

      const res = await deleteStep(admin, b.id);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: true });

      const remaining = await stepsIn(labTenantId);
      expect(remaining.map((s) => s.id)).toEqual([a.id, c.id]);
      expect(positionsOf(remaining)).toEqual([1, 2]);
      // The archived question and its answer are still there, now under the first remaining step.
      const [moved] = await adminSql<{ step_id: string; archived_at: Date | null }[]>`
        select step_id::text as step_id, archived_at from public.profile_form_questions
         where id = ${archived}::uuid`;
      expect(moved?.step_id).toBe(a.id);
      expect(moved?.archived_at).not.toBeNull();
      const [answers] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.profile_form_answers where question_id = ${archived}::uuid`;
      expect(answers?.n).toBe(1);
      // The active question did not move.
      const [still] = await adminSql<{ step_id: string }[]>`
        select step_id::text as step_id from public.profile_form_questions where id = ${active}::uuid`;
      expect(still?.step_id).toBe(c.id);

      // The archived list names the new step, and the builder list the renumbered steps.
      const archivedList = await call(admin, 'GET', '/v1/profile_form/archived');
      expect(archivedList.status).toBe(200);
      const archivedBody = (await archivedList.json()) as { questions: ListedQuestion[] };
      expect(archivedBody.questions.map((q) => [q.id, q.stepId])).toEqual([[archived, a.id]]);
      const after = await listOf(admin);
      expect(after.steps.map((s) => [s.id, s.position])).toEqual([
        [a.id, 1],
        [c.id, 2],
      ]);

      // A second delete is the bare 404.
      const twice = await deleteStep(admin, b.id);
      expect(twice.status).toBe(404);
      expect(((await twice.json()) as Envelope).error.details).toBeUndefined();
    });
  }, 30_000);
});

describe('12.1-08 PFORM-28: the limits of steps, one step either side', () => {
  it('PFORM-28 boundary: 10 steps are accepted, the 11th is 409 limit_reached and a delete reopens the room', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const made: Step[] = [];
      for (let n = 1; n <= 9; n += 1) made.push(await stepCreated(admin, `${TITLE}Etapa ${n}`));
      // The 10th is the last the tenant may have.
      const tenth = await stepCreated(admin, `${TITLE}Etapa 10`);
      expect(tenth.position).toBe(10);
      made.push(tenth);
      expect((await listOf(admin)).steps).toHaveLength(10);

      const eleventh = await createStep(admin, `${TITLE}Etapa 11`);
      expect(eleventh.status).toBe(409);
      expect(await code(eleventh.clone())).toBe('CONFLICT');
      expect(await details(eleventh)).toEqual({ profileForm: 'limit_reached' });
      expect(await stepsIn(labTenantId)).toHaveLength(10);

      // One step fewer (9) and the create works again, landing last at position 10.
      const gone = await deleteStep(admin, made[4]?.id ?? '');
      expect(gone.status).toBe(200);
      expect(positionsOf(await stepsIn(labTenantId))).toEqual(oneTo(9));
      const again = await stepCreated(admin, `${TITLE}Etapa 12`);
      expect(again.position).toBe(10);
    });
  }, 60_000);

  it('PFORM-28 boundary: a step title of exactly 60 characters is accepted and 61 is a 400 too_long', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const sixty = `${TITLE}${'a'.repeat(56)}`;
      expect([...sixty]).toHaveLength(60);
      const ok = await createStep(admin, sixty);
      expect(ok.status).toBe(201);
      expect(((await ok.json()) as Step).title).toBe(sixty);

      const sixtyOne = `${sixty}a`;
      const refused = await createStep(admin, sixtyOne);
      expect(refused.status).toBe(400);
      expect(await code(refused.clone())).toBe('VALIDATION_FAILED');
      expect(await details(refused)).toEqual({ profileForm: 'too_long' });

      // One character is accepted, an empty or blank one is `required`, and the database holds 1 row.
      for (const blank of ['', '   ']) {
        const res = await createStep(admin, blank);
        expect(res.status).toBe(400);
        expect(await details(res)).toEqual({ profileForm: 'required' });
      }
      expect(await stepsIn(labTenantId)).toHaveLength(1);
    });
  }, 30_000);

  it('PFORM-28 precision: after any run of creates, deletes and renames the positions are 1..n with no gap and no repeat, revisions only grow, and two reads agree', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const revisions = new Map<string, number>();
      let n = 0;
      const check = async () => {
        const rows = await stepsIn(labTenantId);
        expect(positionsOf(rows)).toEqual(oneTo(rows.length));
        for (const row of rows) {
          expect(row.revision).toBeGreaterThanOrEqual(revisions.get(row.id) ?? 1);
          revisions.set(row.id, row.revision);
        }
        const first = await listOf(admin);
        const second = await listOf(admin);
        expect(first.steps.map((s) => s.id)).toEqual(rows.map((row) => row.id));
        expect(second.steps).toEqual(first.steps);
        expect(positionsOf(first.steps)).toEqual(oneTo(rows.length));
        return rows;
      };
      const add = async () => {
        n += 1;
        await stepCreated(admin, `${TITLE}S${n}`);
        return check();
      };
      const drop = async (index: number) => {
        const rows = await stepsIn(labTenantId);
        const target = rows[index];
        const res = await deleteStep(admin, target?.id ?? '');
        expect(res.status).toBe(200);
        return check();
      };
      const rename = async (index: number) => {
        const rows = await stepsIn(labTenantId);
        const target = rows[index];
        const res = await renameStep(admin, target?.id ?? '', {
          revision: target?.revision ?? 1,
          title: `${TITLE}R${n}-${index}`,
        });
        expect(res.status).toBe(200);
        return check();
      };

      for (let i = 0; i < 6; i += 1) await add();
      await drop(2);
      await rename(0);
      await add();
      await add();
      await drop(0);
      await rename(3);
      await drop(4);
      await add();
      await rename(0);
      await drop(1);
      await drop(0);
      const rows = await add();
      expect(rows.length).toBeGreaterThan(1);
    });
  }, 90_000);
});

describe('12.1-08 D-627: the default step carries one title whoever creates it', () => {
  it('the service-created default and the trigger-created default are titled the same literal', async () => {
    await withProfileForm(labTenantId, async () => {
      const ctx = { userId: adminUserId, tenantId: labTenantId, role: 'admin_tenant' as const };

      // A form with no step: the service creates the default one at position 1, and asks it twice for the same.
      expect(await stepsIn(labTenantId)).toEqual([]);
      const serviceId = await withTenantTx(ctx, (tx) => ensureDefaultStep(tx, labTenantId));
      const sameId = await withTenantTx(ctx, (tx) => ensureDefaultStep(tx, labTenantId));
      expect(sameId).toBe(serviceId);
      const [fromService] = await stepsIn(labTenantId);
      expect(fromService).toMatchObject({ id: serviceId, position: 1, revision: 1 });
      expect(fromService?.title).toBe(PROFILE_FORM_DEFAULT_STEP_TITLE);
      expect(PROFILE_FORM_DEFAULT_STEP_TITLE).toBe('Informações gerais');
      await adminSql`delete from public.profile_form_steps where id = ${serviceId}::uuid`;

      // A legacy-shaped insert that names no step: the BEFORE INSERT trigger creates the default one.
      await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}Legada`,
      });
      const [fromTrigger] = await stepsIn(labTenantId);
      expect(fromTrigger?.title).toBe(fromService?.title);
      expect(fromTrigger?.position).toBe(1);
    });
  }, 30_000);
});

describe('12.1-08 the guard chain of the steps routes (D-596)', () => {
  it('a member and a support_tenant are 403 on create, rename and delete, and nothing is written', async () => {
    const support = await person('support_tenant');
    const member = await person('member');
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const step = await stepCreated(admin, `${TITLE}Dele`);
      for (const who of [support, member]) {
        const made = await createStep(who, `${TITLE}intruso`);
        expect(made.status).toBe(403);
        const renamed = await renameStep(who, step.id, {
          revision: 1,
          title: `${TITLE}sequestrada`,
        });
        expect(renamed.status).toBe(403);
        const removed = await deleteStep(who, step.id);
        expect(removed.status).toBe(403);
      }
      expect(await stepsIn(labTenantId)).toEqual([
        { id: step.id, title: `${TITLE}Dele`, position: 1, revision: 1 },
      ]);
    });
  }, 30_000);

  it('the module off is 404 MODULE_DISABLED on create, rename and delete, even to the admin, and nothing is written', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(
      labTenantId,
      async () => {
        const id = crypto.randomUUID();
        for (const res of [
          await createStep(admin, `${TITLE}off`),
          await renameStep(admin, id, { revision: 1, title: `${TITLE}off` }),
          await deleteStep(admin, id),
        ]) {
          expect(res.status).toBe(404);
          expect(await code(res)).toBe('MODULE_DISABLED');
        }
        expect(await stepsIn(labTenantId)).toEqual([]);
      },
      { enabled: false },
    );
  }, 30_000);

  it('seedProfileFormStep builds a step the list shows', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const id = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}Semeada` });
      const list = await listOf(admin);
      expect(list.steps).toEqual([
        { id, title: `${TITLE}Semeada`, position: 1, revision: 1, questionCount: 0 },
      ]);
    });
  }, 30_000);
});

// ── Task 3: the race (T-12.1-13) ────────────────────────────────────────────────────────────────

describe('12.1-08 T-12.1-13: two admins creating a step at the same time never pass the limit', () => {
  it('two simultaneous creates at 9 steps end with exactly 10 and one 409 limit_reached, every round', async () => {
    const first = await person('admin_tenant');
    const second = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      for (let n = 1; n <= 9; n += 1)
        await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}Base ${n}` });
      for (let round = 1; round <= 3; round += 1) {
        const [a, b] = await Promise.all([
          createStep(first, `${TITLE}Corrida ${round} a`),
          createStep(second, `${TITLE}Corrida ${round} b`),
        ]);
        expect([a.status, b.status].sort(), `round ${round}`).toEqual([201, 409]);
        const loser = a.status === 409 ? a : b;
        expect(await details(loser)).toEqual({ profileForm: 'limit_reached' });
        const rows = await stepsIn(labTenantId);
        expect(rows, `round ${round}`).toHaveLength(10);
        expect(positionsOf(rows)).toEqual(oneTo(10));
        // Back to 9 for the next round: the winner of this one goes.
        const winner = rows.find((row) => row.title.startsWith(`${TITLE}Corrida ${round}`));
        const gone = await deleteStep(first, winner?.id ?? '');
        expect(gone.status).toBe(200);
        expect(await stepsIn(labTenantId)).toHaveLength(9);
      }
    });
  }, 60_000);

  it('three creates racing at 8 steps end with exactly 10 and one refusal', async () => {
    const admins = [
      await person('admin_tenant'),
      await person('admin_tenant'),
      await person('admin_tenant'),
    ];
    await withProfileForm(labTenantId, async () => {
      for (let n = 1; n <= 8; n += 1)
        await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}Base ${n}` });
      const results = await Promise.all(
        admins.map((admin, index) => createStep(admin, `${TITLE}Tripla ${index}`)),
      );
      expect(results.map((res) => res.status).sort()).toEqual([201, 201, 409]);
      const rows = await stepsIn(labTenantId);
      expect(rows).toHaveLength(10);
      expect(positionsOf(rows)).toEqual(oneTo(10));
    });
  }, 60_000);

  it('a create racing a delete leaves positions 1..n with no gap and no repeat', async () => {
    const creator = await person('admin_tenant');
    const remover = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const ids: string[] = [];
      for (let n = 1; n <= 5; n += 1) {
        ids.push(await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}Base ${n}` }));
      }
      const [made, removed] = await Promise.all([
        createStep(creator, `${TITLE}Nova`),
        deleteStep(remover, ids[1] ?? ''),
      ]);
      expect([made.status, removed.status]).toEqual([201, 200]);
      const rows = await stepsIn(labTenantId);
      expect(rows).toHaveLength(5);
      expect(positionsOf(rows)).toEqual(oneTo(5));
    });
  }, 30_000);
});

// ── 12.1-09: the global layout (D-623, D-627; PFORM-27, PFORM-28, PFORM-29) ─────────────────────

const putOrder = (p: Person, body: unknown, host: string = HOSTS.lab) =>
  call(p, 'PUT', '/v1/profile_form/order', body, host);

type StoredQuestionRow = {
  id: string;
  step_id: string;
  position: number;
  revision: number;
};

/** The tenant's ACTIVE questions straight from the database, in the canonical order. */
const activeIn = (tenantId: string) =>
  adminSql<StoredQuestionRow[]>`
    select id::text as id, step_id::text as step_id, position, revision
      from public.profile_form_questions
     where tenant_id = ${tenantId}::uuid and archived_at is null
     order by position, created_at, id`;

const idsOf = (rows: { id: string }[]) => rows.map((row) => row.id);

const seedQ = (title: string, over: Partial<Parameters<typeof seedProfileFormQuestion>[0]> = {}) =>
  seedProfileFormQuestion({
    tenantId: labTenantId,
    adminUserId,
    title: `${TITLE}${title}`,
    ...over,
  });

describe('12.1-09 tracer: an admin moves a question across steps and an order that hides an opener is refused (D-623, D-627)', () => {
  it('a layout body moves a question from step 1 to step 2 in one statement; the list reads the new stepIds, contiguous positions, and only the mover has a new revision', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const s1 = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S1` });
      const s2 = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S2` });
      const a = await seedQ('A', { stepId: s1, position: 1 });
      const b = await seedQ('B', { stepId: s1, position: 2 });
      const c = await seedQ('C', { stepId: s2, position: 3 });

      const res = await putOrder(admin, {
        steps: [
          { id: s1, questionIds: [a] },
          { id: s2, questionIds: [c, b] },
        ],
      });
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
      const list = (await res.json()) as QuestionList;
      expect(list.questions.map((q) => [q.id, q.stepId])).toEqual([
        [a, s1],
        [c, s2],
        [b, s2],
      ]);
      expect(list.steps.map((s) => [s.id, s.questionCount])).toEqual([
        [s1, 1],
        [s2, 2],
      ]);

      const rows = await activeIn(labTenantId);
      expect(idsOf(rows)).toEqual([a, c, b]);
      expect(positionsOf(rows)).toEqual([1, 2, 3]);
      // Only the question that changed step has a new revision; a pure reorder keeps revisions.
      expect(Object.fromEntries(rows.map((row) => [row.id, row.revision]))).toEqual({
        [a]: 1,
        [c]: 1,
        [b]: 2,
      });
      // A step that did not change place keeps its revision.
      expect((await stepsIn(labTenantId)).map((s) => s.revision)).toEqual([1, 1]);
    });
  }, 30_000);

  it('condition_order: a layout that puts an opener after the question it opens is 409 naming BOTH ids, and the stored order is unchanged', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const s1 = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S1` });
      const s2 = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S2` });
      const optionId = crypto.randomUUID();
      const opener = await seedQ('Opener', {
        type: 'single_choice',
        options: [{ id: optionId, label: 'Sim' }, { label: 'Não' }],
        stepId: s1,
        position: 1,
      });
      const dependent = await seedQ('Dependent', {
        stepId: s1,
        position: 2,
        conditionQuestionId: opener,
        conditionValues: [optionId],
      });
      const other = await seedQ('Other', { stepId: s2, position: 3 });
      const before = await activeIn(labTenantId);

      // The opener after its dependent in the same step.
      const swapped = await putOrder(admin, {
        steps: [
          { id: s1, questionIds: [dependent, opener] },
          { id: s2, questionIds: [other] },
        ],
      });
      expect(swapped.status).toBe(409);
      expect(await details(swapped)).toEqual({
        profileForm: 'condition_order',
        questionId: dependent,
        openerId: opener,
      });
      expect(await activeIn(labTenantId)).toEqual(before);

      // The dependent moved into a step ABOVE the opener's step.
      const above = await putOrder(admin, {
        steps: [
          { id: s1, questionIds: [dependent] },
          { id: s2, questionIds: [opener, other] },
        ],
      });
      expect(above.status).toBe(409);
      expect(await details(above)).toEqual({
        profileForm: 'condition_order',
        questionId: dependent,
        openerId: opener,
      });
      expect(await activeIn(labTenantId)).toEqual(before);

      // A step above the step that holds the opener of one of its questions: the steps swap places.
      const setup = await putOrder(admin, {
        steps: [
          { id: s1, questionIds: [opener] },
          { id: s2, questionIds: [dependent, other] },
        ],
      });
      expect(setup.status).toBe(200);
      const stepsSwapped = await putOrder(admin, {
        steps: [
          { id: s2, questionIds: [dependent, other] },
          { id: s1, questionIds: [opener] },
        ],
      });
      expect(stepsSwapped.status).toBe(409);
      expect(await details(stepsSwapped)).toEqual({
        profileForm: 'condition_order',
        questionId: dependent,
        openerId: opener,
      });
      expect(idsOf(await activeIn(labTenantId))).toEqual([opener, dependent, other]);

      // Positive controls: the opener earlier in the same step, or in an earlier step, passes.
      const sameStep = await putOrder(admin, {
        steps: [
          { id: s1, questionIds: [opener, dependent] },
          { id: s2, questionIds: [other] },
        ],
      });
      expect(sameStep.status).toBe(200);
      const earlierStep = await putOrder(admin, {
        steps: [
          { id: s1, questionIds: [opener] },
          { id: s2, questionIds: [other, dependent] },
        ],
      });
      expect(earlierStep.status).toBe(200);
      expect(idsOf(await activeIn(labTenantId))).toEqual([opener, other, dependent]);
    });
  }, 30_000);
});
