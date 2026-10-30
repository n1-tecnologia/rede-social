import postgres from 'postgres';
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
 * 12-06 (PFORM-24 member half, T-12-16; D-587): a member's save and an admin's edit never interleave, proven
 * with REAL separate connections against the live local stack. The member's save locks the active questions
 * `FOR SHARE` (through `app.profile_form_lock_active()`, because a member cannot lock rows under RLS) before it
 * validates; an admin's `UPDATE` takes `FOR NO KEY UPDATE`, which conflicts with it.
 *
 *   1. member holds, admin waits: the update queues behind the save, then the guard trigger raises PF001
 *      because an answer now exists;
 *   2. admin holds, member waits: the save queues behind the update, and the stale etag answers 409;
 *   3. two saves of one member racing end with one row per question, all from one save, and no 500;
 *   4. locks are taken in ONE canonical order, so a save racing the real admin reorder
 *      (`PUT /v1/profile_form/order`, 12-08, which writes every active row) never deadlocks.
 *
 * EVERY identity is a throwaway (prefix `pfc`); questions carry the title prefix `pfc `.
 */

const PREFIX = 'pfc';
const TITLE = 'pfc ';
const DB_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

type Person = { userId: string; email: string; password: string; token: string };
type Form = { formEtag: string; questions: { id: string }[] };

let labTenantId = '';
let adminUserId = '';
let adminPerson: Person | null = null;

// Two extra connections (the shared `adminSql` has one): the "member" side that holds a transaction open and
// the "admin" side that edits.
const memberSql = postgres(DB_URL, { prepare: false, max: 1 });
const editorSql = postgres(DB_URL, { prepare: false, max: 1 });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A promise's settled flag, to prove a statement is WAITING rather than finished. */
function watch<T>(promise: Promise<T>): () => boolean {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  return () => done;
}

async function person(role: 'member' | 'admin_tenant' = 'member'): Promise<Person> {
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role, status: 'active' }],
  });
  return { ...identity, token: await signInAs(identity.email, identity.password) };
}

const call = async (p: Person, method: 'GET' | 'PUT', path: string, body?: unknown) =>
  api.request(path, {
    method,
    headers: {
      'x-tenant-host': HOSTS.lab,
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

const save = (p: Person, form: Form, answers: Record<string, unknown>) =>
  call(p, 'PUT', '/v1/me/profile-form/answers', { formEtag: form.formEtag, answers });

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
  const [lab] = await adminSql<{ id: string }[]>`
    select id::text as id from public.tenants where slug = 'rede-lab'`;
  if (!lab) throw new Error('seed tenants are missing, run pnpm db:seed first');
  labTenantId = lab.id;
  await sweep();
  adminPerson = await person('admin_tenant');
  adminUserId = adminPerson.userId;
});

afterEach(async () => {
  await removeProfileFormByPrefix(TITLE);
});

afterAll(async () => {
  await sweep();
  await adminSql`
    delete from public.tenant_modules where module_key = 'profile_form' and tenant_id = ${labTenantId}::uuid`;
  await memberSql.end({ timeout: 2 });
  await editorSql.end({ timeout: 2 });
});

describe('12-06 the member’s save and an admin’s edit never interleave (T-12-16)', () => {
  it('1. the member holds the lock: the admin’s type change waits, then the guard trigger refuses it with PF001', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const id = await question({ type: 'short_text' });

      let release: () => void = () => {};
      let held: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holding = new Promise<void>((resolve) => {
        held = resolve;
      });

      // The member's side, exactly what `saveAnswers` does first: claims, the authenticated role, the lock,
      // then the answer; the transaction stays open until we let it commit.
      const claims = JSON.stringify({
        sub: member.userId,
        role: 'authenticated',
        tenant_id: labTenantId,
        tenant_role: 'member',
      });
      const memberTx = memberSql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`;
        await tx.unsafe('set local role authenticated');
        const locked = await tx`select id::text as id from app.profile_form_lock_active()`;
        expect(locked.map((row) => row.id)).toEqual([id]);
        await tx`
          insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
          select m.tenant_id, ${id}::uuid, m.id, m.user_id, ${tx.json('resposta')}
            from public.memberships m
           where m.tenant_id = ${labTenantId}::uuid and m.user_id = ${member.userId}::uuid`;
        held();
        await gate;
      });
      await holding;

      // The admin's edit while the member's transaction is open: it must WAIT.
      const edit = editorSql`
        update public.profile_form_questions set type = 'long_text' where id = ${id}::uuid`.then(
        () => 'updated' as const,
        (error: { code?: string }) => error.code ?? 'error',
      );
      const editDone = watch(edit);
      await sleep(500);
      expect(editDone(), 'the update waited for the member’s lock').toBe(false);

      release();
      await memberTx;

      // After the commit the trigger sees the answer, so the type change is refused: PF001.
      expect(await edit).toBe('PF001');
      const [row] = await adminSql<{ type: string }[]>`
        select type from public.profile_form_questions where id = ${id}::uuid`;
      expect(row?.type).toBe('short_text');
      const [answers] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.profile_form_answers where question_id = ${id}::uuid`;
      expect(answers?.n).toBe(1);
    });
  }, 20_000);

  it('2. the admin holds the lock: the member’s save waits, then the old etag answers 409 and writes nothing', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const id = await question();
      const form = await readForm(member);

      let release: () => void = () => {};
      let held: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holding = new Promise<void>((resolve) => {
        held = resolve;
      });
      const adminTx = editorSql.begin(async (tx) => {
        await tx`update public.profile_form_questions set revision = revision + 1 where id = ${id}::uuid`;
        held();
        await gate;
      });
      await holding;

      const saving = save(member, form, { [id]: 'resposta' });
      const savingDone = watch(saving);
      await sleep(500);
      expect(savingDone(), 'the save waited for the admin’s row lock').toBe(false);

      release();
      await adminTx;
      const res = await saving;
      expect(res.status).toBe(409);
      const payload = (await res.json()) as {
        error: { code: string; details?: { profileForm?: string; form?: Form } };
      };
      expect(payload.error.code).toBe('CONFLICT');
      expect(payload.error.details?.profileForm).toBe('form_changed');
      expect(payload.error.details?.form?.formEtag).not.toBe(form.formEtag);
      const [answers] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.profile_form_answers where question_id = ${id}::uuid`;
      expect(answers?.n).toBe(0);
    });
  }, 20_000);

  it('3. two saves of the same member racing end with one row per question, all from one save, and no 500', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const ids = [
        await question({ position: 0 }),
        await question({ position: 1 }),
        await question({ position: 2 }),
      ];
      const form = await readForm(member);
      for (let round = 0; round < 5; round++) {
        const bodyA = Object.fromEntries(ids.map((id, i) => [id, `A${round}-${i}`]));
        // The second body names the questions in the REVERSE order: the server writes in the canonical one.
        const bodyB = Object.fromEntries(
          [...ids].reverse().map((id) => [id, `B${round}-${ids.indexOf(id)}`]),
        );
        const [a, b] = await Promise.all([save(member, form, bodyA), save(member, form, bodyB)]);
        expect([a.status, b.status], `round ${round}`).toEqual([200, 200]);

        const rows = await adminSql<{ question_id: string; value: string }[]>`
          select question_id::text as question_id, value #>> '{}' as value
            from public.profile_form_answers where question_id = any(${ids}::uuid[])`;
        expect(rows).toHaveLength(ids.length);
        const prefixes = new Set(rows.map((row) => row.value.slice(0, 1)));
        // Last committed wins, as a whole: never a mix of the two bodies.
        expect(prefixes.size, `round ${round}`).toBe(1);
        expect(['A', 'B']).toContain([...prefixes][0]);
      }
    });
  }, 30_000);

  it('4. the locks are taken in one canonical order: a save racing the REAL admin reorder (PUT /v1/profile_form/order) never deadlocks', async () => {
    const member = await person();
    const admin = adminPerson;
    if (!admin) throw new Error('the admin identity is missing');
    await withProfileForm(labTenantId, async () => {
      const first = await question({ position: 1 });
      const second = await question({ position: 2 });

      // 12-08 converts the 12-06 simulation: the admin side is now the real route, which takes the
      // per-tenant advisory lock and then every active row FOR UPDATE in `position, created_at, id` order
      // and rewrites both positions in one statement.
      let order = [first, second];
      const outcomes: string[] = [];
      for (let round = 0; round < 6; round++) {
        const form = await readForm(member);
        order = [...order].reverse();
        const reordering = Promise.resolve(
          call(admin, 'PUT', '/v1/profile_form/order', { ids: order }),
        ).then(
          (res) => `admin-${res.status}`,
          () => 'admin-error',
        );
        // Alternate who starts first, so both interleavings are hit.
        if (round % 2 === 0) await sleep(30);
        const saving = save(member, form, { [first]: `r${round}`, [second]: `r${round}` }).then(
          async (res) => `save-${res.status}`,
          () => 'save-error',
        );
        const [adminResult, saveResult] = await Promise.all([reordering, saving]);
        outcomes.push(adminResult, saveResult);
        // The admin always wins its own order; the save is 200 when it ran before the reorder and 409
        // (the form changed under it) after; never a 500, never a deadlock.
        expect(adminResult, `round ${round}`).toBe('admin-200');
        expect(['save-200', 'save-409'], `round ${round}`).toContain(saveResult);
      }
      expect(outcomes.filter((outcome) => outcome.includes('40P01'))).toEqual([]);
      const rows = await adminSql<{ id: string; position: number }[]>`
        select id::text as id, position from public.profile_form_questions
         where id in (${first}::uuid, ${second}::uuid) order by position`;
      expect(rows.map((row) => row.position)).toEqual([1, 2]);
    });
  }, 60_000);
});
