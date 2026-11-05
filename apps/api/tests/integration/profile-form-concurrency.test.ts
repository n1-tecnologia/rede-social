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
 * 12-09 adds the ADMIN half (PFORM-24, PFORM-03), numbered 1 to 6 in its own block below: admin against admin on
 * `revision`, a type change against a member's save, a reorder against a create at 29, an archive against a
 * save, a save against an admin that edits the second question and then the first, and a retry after
 * `form_changed`.
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

const call = async (
  p: Person,
  method: 'GET' | 'PUT' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
) =>
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

// ── 12-09: the admin half of the two-connection suite (PFORM-24, PFORM-03) ───────────────────────────────────
type AdminQuestion = { id: string; revision: number; position: number; type: string };
type ActiveList = { questions: AdminQuestion[]; activeCount: number };

const adminCall = (method: 'GET' | 'PUT' | 'POST' | 'PATCH', path: string, body?: unknown) => {
  if (!adminPerson) throw new Error('the admin identity is missing');
  return call(adminPerson, method, path, body);
};
const activeQuestions = async (): Promise<ActiveList> => {
  const res = await adminCall('GET', '/v1/profile_form/questions');
  expect(res.status).toBe(200);
  return (await res.json()) as ActiveList;
};
const profileFormCode = async (res: Response): Promise<string | undefined> => {
  const payload = (await res.json()) as { error?: { details?: { profileForm?: string } } };
  return payload.error?.details?.profileForm;
};

/**
 * A member's save, held open: claims, the authenticated role and the lock function, exactly what `saveAnswers`
 * does first, plus an optional answer. The transaction stays open until `release()`.
 */
async function holdMemberLock(member: Person, answerFor?: string) {
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
  const committed = memberSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx.unsafe('set local role authenticated');
    await tx`select id::text as id from app.profile_form_lock_active()`;
    if (answerFor) {
      await tx`
        insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
        select m.tenant_id, ${answerFor}::uuid, m.id, m.user_id, ${tx.json('resposta')}
          from public.memberships m
         where m.tenant_id = ${labTenantId}::uuid and m.user_id = ${member.userId}::uuid`;
    }
    held();
    await gate;
  });
  await holding;
  return { release, committed };
}

const answerCountOf = async (questionId: string): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.profile_form_answers where question_id = ${questionId}::uuid`;
  return row?.n ?? 0;
};

describe('12-09 the admin side of the two-connection suite (PFORM-24, PFORM-03)', () => {
  it('1. admin against admin: two PATCH requests carrying the same revision end with one 200 and one 409 stale_revision', async () => {
    await withProfileForm(labTenantId, async () => {
      const id = await question({ title: `${TITLE}race` });
      const [a, b] = await Promise.all([
        adminCall('PATCH', `/v1/profile_form/questions/${id}`, { revision: 1, title: `${TITLE}A` }),
        adminCall('PATCH', `/v1/profile_form/questions/${id}`, { revision: 1, title: `${TITLE}B` }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      expect(await profileFormCode(loser)).toBe('stale_revision');
      const [row] = await adminSql<{ revision: number; title: string }[]>`
        select revision, title from public.profile_form_questions where id = ${id}::uuid`;
      expect(row?.revision).toBe(2);
      expect([`${TITLE}A`, `${TITLE}B`]).toContain(row?.title);
    });
  }, 30_000);

  it('2. admin type change against a member’s save: with the answer in flight the change waits and is refused type_locked; with none it commits and the next save validates against the new type', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const id = await question({ type: 'short_text', title: `${TITLE}tipo` });
      const held = await holdMemberLock(member, id);

      const patching = Promise.resolve(
        adminCall('PATCH', `/v1/profile_form/questions/${id}`, { revision: 1, type: 'number' }),
      );
      const patchDone = watch(patching);
      await sleep(600);
      expect(patchDone(), 'the type change waited for the member’s lock').toBe(false);

      held.release();
      await held.committed;
      const refused = await patching;
      expect(refused.status).toBe(409);
      expect(await profileFormCode(refused)).toBe('type_locked');
      expect(await answerCountOf(id)).toBe(1);

      // With no answer in flight the same change commits, and the member’s later save follows the new type.
      const free = await question({ type: 'short_text', title: `${TITLE}livre`, required: false });
      const changed = await adminCall('PATCH', `/v1/profile_form/questions/${free}`, {
        revision: 1,
        type: 'number',
      });
      expect(changed.status).toBe(200);
      const other = await person();
      const form = await readForm(other);
      const bad = await save(other, form, { [free]: 'não é número' });
      expect(bad.status).toBe(400);
      expect(await answerCountOf(free)).toBe(0);
      const ok = await save(other, form, { [free]: 42 });
      expect(ok.status).toBe(200);
      expect(await answerCountOf(free)).toBe(1);
    });
  }, 60_000);

  it('3. reorder against a create at 29 active questions: the advisory lock serialises them, the list ends with exactly 30 and a 1..n numbering', async () => {
    await withProfileForm(labTenantId, async () => {
      for (let i = 1; i <= 29; i++) await question({ position: i, title: `${TITLE}q${i}` });
      for (let round = 0; round < 3; round++) {
        const before = await activeQuestions();
        if (before.activeCount === 30) {
          // Keep the next round at 29: archive the last one through SQL.
          const last = before.questions.at(-1);
          if (last) {
            await adminSql`update public.profile_form_questions set archived_at = now() where id = ${last.id}::uuid`;
          }
        }
        const current = await activeQuestions();
        expect(current.activeCount).toBe(29);
        const reversed = [...current.questions].reverse().map((q) => q.id);
        const [reorder, create] = await Promise.all([
          adminCall('PUT', '/v1/profile_form/order', { ids: reversed }),
          adminCall('POST', '/v1/profile_form/questions', {
            type: 'short_text',
            title: `${TITLE}nova ${round}`,
          }),
        ]);
        // Either the reorder ran first (200, then the create lands last), or the create ran first and the reorder
        // saw a set that is no longer the active one (409 order_mismatch). Never a 500, never a second 201.
        expect(create.status, `round ${round}`).toBe(201);
        expect([200, 409], `round ${round}`).toContain(reorder.status);
        if (reorder.status === 409) expect(await profileFormCode(reorder)).toBe('order_mismatch');
        const after = await activeQuestions();
        expect(after.activeCount, `round ${round}`).toBe(30);
        const positions = after.questions.map((q) => q.position).sort((a, b) => a - b);
        expect(positions, `round ${round}`).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
      }
    });
  }, 90_000);

  it('4. archive against a member’s save: the archive waits and the answer is kept; an archive that came first leaves no answer row and the save is refused', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      // (a) The save holds the lock with an answer: the archive waits, then archives; the answer stays.
      const first = await question({ title: `${TITLE}arq a`, required: false });
      const held = await holdMemberLock(member, first);
      const archiving = Promise.resolve(
        adminCall('POST', `/v1/profile_form/questions/${first}/archive`),
      );
      const archiveDone = watch(archiving);
      await sleep(600);
      expect(archiveDone(), 'the archive waited for the save’s lock').toBe(false);
      held.release();
      await held.committed;
      expect((await archiving).status).toBe(200);
      expect(await answerCountOf(first)).toBe(1);

      // (b) The archive holds the row first: the member’s save (old etag) is refused and writes no answer row.
      const second = await question({ title: `${TITLE}arq b`, required: false });
      const other = await person();
      const form = await readForm(other);
      let release: () => void = () => {};
      let archivedHeld: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holding = new Promise<void>((resolve) => {
        archivedHeld = resolve;
      });
      const adminTx = editorSql.begin(async (tx) => {
        await tx`update public.profile_form_questions set archived_at = now() where id = ${second}::uuid`;
        archivedHeld();
        await gate;
      });
      await holding;
      const saving = save(other, form, { [second]: 'tarde demais' });
      const savingDone = watch(saving);
      await sleep(600);
      expect(savingDone(), 'the save waited for the archive’s row lock').toBe(false);
      release();
      await adminTx;
      const res = await saving;
      expect(res.status).toBe(409);
      expect(await profileFormCode(res)).toBe('form_changed');
      expect(await answerCountOf(second)).toBe(0);
    });
  }, 60_000);

  it('5. a member’s save over two questions racing an admin that edits the second and then the first, and a reorder, never deadlocks', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const first = await question({ position: 1, title: `${TITLE}ord 1` });
      const second = await question({ position: 2, title: `${TITLE}ord 2` });
      const outcomes: string[] = [];
      let revisions = new Map<string, number>([
        [first, 1],
        [second, 1],
      ]);
      for (let round = 0; round < 6; round++) {
        const form = await readForm(member);
        const edit = async (id: string) => {
          const res = await adminCall('PATCH', `/v1/profile_form/questions/${id}`, {
            revision: revisions.get(id) ?? 1,
            title: `${TITLE}ord ${round} ${id.slice(0, 4)}`,
          });
          if (res.status === 200)
            revisions = new Map(revisions).set(id, ((await res.json()) as AdminQuestion).revision);
          return res.status;
        };
        const editing = (async () => [await edit(second), await edit(first)])();
        if (round % 2 === 0) await sleep(20);
        const saving = save(member, form, { [first]: `r${round}`, [second]: `r${round}` }).then(
          (res) => res.status,
          () => 0,
        );
        const reordering = adminCall('PUT', '/v1/profile_form/order', {
          ids: round % 2 === 0 ? [second, first] : [first, second],
        }).then(
          (res) => res.status,
          () => 0,
        );
        const [edits, saved, reordered] = await Promise.all([editing, saving, reordering]);
        outcomes.push(`${edits.join('+')}/${saved}/${reordered}`);
        expect(edits, `round ${round}`).toEqual([200, 200]);
        expect([200, 409], `round ${round}`).toContain(saved);
        expect(reordered, `round ${round}`).toBe(200);
      }
      expect(outcomes.filter((outcome) => outcome.includes('500'))).toEqual([]);
    });
  }, 90_000);

  it('6. a retry after form_changed with the fresh etag succeeds once, and a repeated identical save writes equal rows', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const id = await question({ title: `${TITLE}retry`, required: false });
      const form = await readForm(member);
      // The form changes under the member: a new question changes the etag.
      const extra = await adminCall('POST', '/v1/profile_form/questions', {
        type: 'short_text',
        title: `${TITLE}extra`,
      });
      expect(extra.status).toBe(201);

      const stale = await save(member, form, { [id]: 'primeira' });
      expect(stale.status).toBe(409);
      const payload = (await stale.json()) as {
        error: { details: { profileForm: string; form: Form } };
      };
      expect(payload.error.details.profileForm).toBe('form_changed');
      expect(await answerCountOf(id)).toBe(0);

      const fresh = payload.error.details.form;
      const retry = await save(member, fresh, { [id]: 'primeira' });
      expect(retry.status).toBe(200);
      const rowsOf = () =>
        adminSql<{ question_id: string; value: string }[]>`
          select question_id::text as question_id, value #>> '{}' as value
            from public.profile_form_answers where question_id = ${id}::uuid`;
      const once = await rowsOf();
      const again = await save(member, fresh, { [id]: 'primeira' });
      expect(again.status).toBe(200);
      expect(await rowsOf()).toEqual(once);
      expect(once).toHaveLength(1);
    });
  }, 60_000);

  it('adjacency: while a save holds the lock, creating, reactivating and reading never wait, and only an edit of an ACTIVE question does', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const active = await question({ title: `${TITLE}ativa` });
      const gone = await question({ title: `${TITLE}arquivada`, archived: true });
      const held = await holdMemberLock(member);

      const quick = Promise.all([
        adminCall('POST', '/v1/profile_form/questions', {
          type: 'short_text',
          title: `${TITLE}nova`,
        }),
        adminCall('GET', '/v1/profile_form/archived'),
        adminCall('GET', '/v1/profile_form/summary'),
        adminCall('POST', `/v1/profile_form/questions/${gone}/reactivate`),
      ]);
      const quickDone = watch(quick);
      await sleep(1500);
      expect(quickDone(), 'a create, a reactivate and the reads did not wait for the save').toBe(
        true,
      );
      for (const res of await quick) expect([200, 201]).toContain(res.status);

      const patching = Promise.resolve(
        adminCall('PATCH', `/v1/profile_form/questions/${active}`, {
          revision: 1,
          title: `${TITLE}editada`,
        }),
      );
      const patchDone = watch(patching);
      await sleep(600);
      expect(patchDone(), 'an edit of the same row waits for the save').toBe(false);
      held.release();
      await held.committed;
      expect((await patching).status).toBe(200);
    });
  }, 60_000);

  it('empty: with no active question a save of answers {} is 200 missingRequired 0 and the lifecycle reads are empty lists', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const form = await readForm(member);
      expect(form.questions).toEqual([]);
      const res = await save(member, form, {});
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ missingRequired: 0 });
      const archived = await adminCall('GET', '/v1/profile_form/archived');
      expect(await archived.json()).toEqual({ questions: [] });
      const list = await adminCall('GET', '/v1/profile_form/questions');
      // 12.1-08: the list also carries the steps (none for a form never built) and their limit.
      expect(await list.json()).toEqual({
        questions: [],
        activeCount: 0,
        limit: 30,
        steps: [],
        stepLimit: 10,
      });
    });
  }, 30_000);
});
