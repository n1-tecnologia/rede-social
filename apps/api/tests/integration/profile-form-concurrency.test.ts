import { answerTokens } from '@rede-social/contracts/profile-form';
import {
  branchTreeOf,
  isQuestionVisibleInTree,
} from '@rede-social/contracts/profile-form-branches';
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
  seedProfileFormBranch,
  seedProfileFormQuestion,
  seedProfileFormStep,
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
// 12.2-12: the second member-side connection, for two purges of one member at the same time.
const purgeSql = postgres(DB_URL, { prepare: false, max: 1 });

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
  await purgeSql.end({ timeout: 2 });
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
      await untilBlocked('the waiting side of the race');
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
      await untilBlocked('the waiting side of the race');
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
      await untilBlocked('the waiting side of the race');
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
      await untilBlocked('the waiting side of the race');
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
      await untilBlocked('the waiting side of the race');
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
      await untilBlocked('the waiting side of the race');
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
      expect(await res.json()).toEqual({ missingRequired: 0, missingQuestionIds: [] });
      const archived = await adminCall('GET', '/v1/profile_form/archived');
      // 12.2-08: the archived read also carries the archived branches (none yet).
      expect(await archived.json()).toEqual({ questions: [], branches: [] });
      const list = await adminCall('GET', '/v1/profile_form/questions');
      // 12.1-08: the list also carries the steps (none for a form never built) and their limit.
      expect(await list.json()).toEqual({
        questions: [],
        activeCount: 0,
        limit: 30,
        steps: [],
        stepLimit: 10,
        // 12.2-08 (D-640): every list carries the tenant's branches, none yet.
        branches: [],
      });
    });
  }, 30_000);
});

// ── 12.2-12: branch edits and step moves against a member's save (D-632, D-633, D-646, T-12.1-13, T-12.2-04) ──────
//
// The member's save locks the active questions `FOR SHARE` through `app.profile_form_lock_active_v3()` and then the
// branches through `app.profile_form_lock_branches()`, in the canonical order steps, questions, branches. An admin's
// edit takes the per-tenant advisory lock (`adminLock`), then the same rows `FOR UPDATE` in the same order. Each
// case below pins BOTH commit orders with a held transaction on one side and the REAL route on the other (the
// held side is waited for by polling the lock catalogue, never by a long timer), and then asserts the one
// invariant of the phase: STORED EQUALS VISIBLE through the whole chain.
//
// The 12.1 cases that wrote the retired per-question condition (PF010 refuses it now) are migrated onto branches
// one for one; the races of Phase 12.2 follow in their own describe.

const choose = (optionId: string) => ({ optionId, otherText: null });

/**
 * The question ids of a member's answers that no chain keeps open (must always be empty): the contracts' rule over
 * the stored rows, ARCHIVED questions and branches included, exactly like the SQL purge that has no archived predicate.
 */
async function staleAnswers(userId: string): Promise<string[]> {
  const questions = await adminSql<{ id: string; branch_id: string | null }[]>`
    select id::text as id, branch_id::text as branch_id from public.profile_form_questions
     where tenant_id = ${labTenantId}::uuid`;
  const branches = await adminSql<{ id: string; opener: string; values: string[] }[]>`
    select id::text as id, opener_question_id::text as opener, open_values as values
      from public.profile_form_branches where tenant_id = ${labTenantId}::uuid`;
  const answers = await adminSql<{ question_id: string; value: unknown }[]>`
    select a.question_id::text as question_id, a.value
      from public.profile_form_answers a
      join public.memberships m on m.id = a.membership_id
     where m.user_id = ${userId}::uuid and a.tenant_id = ${labTenantId}::uuid`;
  const tree = branchTreeOf(
    questions.map((q) => ({ id: q.id, branchId: q.branch_id })),
    branches.map((b) => ({ id: b.id, openerQuestionId: b.opener, values: b.values })),
  );
  const branchOf = new Map(questions.map((q) => [q.id, q.branch_id]));
  const valueByQuestion = new Map(answers.map((a) => [a.question_id, a.value]));
  const tokensOf = (id: string) => answerTokens(valueByQuestion.get(id));
  return answers
    .filter(
      (a) =>
        !isQuestionVisibleInTree({ branchId: branchOf.get(a.question_id) ?? null }, tree, tokensOf),
    )
    .map((a) => a.question_id);
}

const storedFor = async (userId: string): Promise<string[]> =>
  (
    await adminSql<{ question_id: string }[]>`
      select a.question_id::text as question_id
        from public.profile_form_answers a
        join public.memberships m on m.id = a.membership_id
       where m.user_id = ${userId}::uuid order by a.question_id`
  ).map((row) => row.question_id);

const saveStep = (
  p: Person,
  form: Form,
  stepId: string,
  answers: Record<string, unknown>,
): Promise<Response> =>
  call(p, 'PUT', '/v1/me/profile-form/answers', { formEtag: form.formEtag, stepId, answers });

/** A response reduced to what a race classifies on: the status and the coded reason of a 409. */
async function outcome(res: Response): Promise<{ status: number; code?: string }> {
  const code = await profileFormCode(res.clone()).catch(() => undefined);
  return code === undefined ? { status: res.status } : { status: res.status, code };
}

/**
 * Waits until some statement is BLOCKED on a lock, by polling the catalogue every 25 ms: the proof that the
 * interleaving is real (the other side holds, this side waits), with no timer long enough to force an ordering.
 */
async function untilBlocked(label: string): Promise<void> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock'`;
    if ((row?.n ?? 0) > 0) return;
    await sleep(25);
  }
  throw new Error(`nobody waited for a lock: ${label}`);
}

type HeldTx = { release: () => void; committed: Promise<unknown> };

/** Lets a held transaction go whatever the case did, so a failing assertion never leaves a lock behind. */
async function releasing<T>(held: HeldTx, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } finally {
    held.release();
    await held.committed.catch(() => undefined);
  }
}

const claimsOf = (member: Person) =>
  JSON.stringify({
    sub: member.userId,
    role: 'authenticated',
    tenant_id: labTenantId,
    tenant_role: 'member',
  });

/**
 * A member's save, held open before the commit: claims, role, the `_v3` lock, the branch lock, then the writes the
 * real save does (`write` on the transaction) and the purge. The transaction stays open until `release()`. A
 * failing write rejects `committed` at once instead of leaving the caller waiting for a signal that never comes.
 */
async function holdMemberSave(
  member: Person,
  write: (tx: postgres.TransactionSql) => Promise<void>,
): Promise<HeldTx> {
  let release: () => void = () => {};
  let held: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holding = new Promise<void>((resolve) => {
    held = resolve;
  });
  const committed = memberSql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claimsOf(member)}, true)`;
    await tx.unsafe('set local role authenticated');
    await tx`select id::text as id from app.profile_form_lock_active_v3()`;
    await tx`select id::text as id from app.profile_form_lock_branches()`;
    await write(tx);
    await tx`select question_id from app.profile_form_purge_closed()`;
    held();
    await gate;
  });
  await Promise.race([holding, committed]);
  return { release, committed };
}

const upsertAnswer = (
  tx: postgres.TransactionSql,
  member: Person,
  questionId: string,
  value: unknown,
) =>
  tx`
    insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
    select m.tenant_id, ${questionId}::uuid, m.id, m.user_id, ${tx.json(value as never)}
      from public.memberships m
     where m.tenant_id = ${labTenantId}::uuid and m.user_id = ${member.userId}::uuid
    on conflict (tenant_id, membership_id, question_id)
    do update set value = excluded.value, updated_at = now()`;

/**
 * An admin's edit, held open before the commit: the per-tenant advisory lock `adminLock` takes, every active
 * row `FOR UPDATE` in the canonical order (`position, created_at, id`), every branch `FOR UPDATE` after them
 * (`created_at, id`), then `edit` on the transaction. `lockQuestions: false` models the branch edit, which takes
 * the branches alone.
 */
async function holdAdminEdit(
  edit: (tx: postgres.TransactionSql) => Promise<void>,
  options: { lockQuestions?: boolean } = {},
): Promise<HeldTx> {
  let release: () => void = () => {};
  let held: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holding = new Promise<void>((resolve) => {
    held = resolve;
  });
  const committed = editorSql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`profile_form:${labTenantId}`}, 0))`;
    if (options.lockQuestions !== false) {
      await tx`
        select id from public.profile_form_questions
         where tenant_id = ${labTenantId}::uuid and archived_at is null
         order by position, created_at, id for update`;
    }
    await tx`
      select id from public.profile_form_branches
       where tenant_id = ${labTenantId}::uuid order by created_at, id for update`;
    await edit(tx);
    held();
    await gate;
  });
  await Promise.race([holding, committed]);
  return { release, committed };
}

/**
 * Two steps; step 1 holds an opener (Sim / Não), a branch that opens on Sim and its dependent; step 2 holds a
 * plain question. The 12.1 shape of these races, on a branch.
 */
async function twoStepBranch() {
  const s1 = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S1` });
  const s2 = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S2` });
  const yes = crypto.randomUUID();
  const no = crypto.randomUUID();
  const opener = await question({
    title: `${TITLE}abridora`,
    type: 'single_choice',
    stepId: s1,
    position: 1,
    options: [
      { id: yes, label: 'Sim' },
      { id: no, label: 'Não' },
    ],
  });
  const branch = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: opener,
    values: [yes],
  });
  const dependent = await question({
    title: `${TITLE}dependente`,
    stepId: s1,
    position: 2,
    branchId: branch,
  });
  const other = await question({ title: `${TITLE}outra`, stepId: s2, position: 3 });
  return { s1, s2, yes, no, opener, branch, dependent, other };
}

/**
 * A depth-2 tree: Q1 (Sim / Não) opens B1 on Sim; B1 holds Q2 (Sim / Não) which opens B2 on Sim; B2 holds Q3. All
 * optional, all in step 1; step 2 holds a plain question.
 */
async function deepTree() {
  const s1 = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S1` });
  const s2 = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S2` });
  const [y1, n1, y2, n2] = Array.from({ length: 4 }, () => crypto.randomUUID()) as [
    string,
    string,
    string,
    string,
  ];
  const q1 = await question({
    title: `${TITLE}d1`,
    type: 'single_choice',
    stepId: s1,
    position: 1,
    options: [
      { id: y1, label: 'Sim' },
      { id: n1, label: 'Não' },
    ],
  });
  const b1 = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: q1,
    values: [y1],
  });
  const q2 = await question({
    title: `${TITLE}d2`,
    type: 'single_choice',
    stepId: s1,
    position: 2,
    branchId: b1,
    options: [
      { id: y2, label: 'Sim' },
      { id: n2, label: 'Não' },
    ],
  });
  const b2 = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: q2,
    values: [y2],
  });
  const q3 = await question({ title: `${TITLE}d3`, stepId: s1, position: 3, branchId: b2 });
  const other = await question({ title: `${TITLE}d4`, stepId: s2, position: 4 });
  return { s1, s2, y1, n1, y2, n2, q1, b1, q2, b2, q3, other };
}

/**
 * Starts two calls in a chosen order and returns their results in the fixed order (a, b). The second call starts
 * `gapMs` (at most 100) after the first, so the rounds sweep the interleavings from simultaneous to well apart;
 * no ordering is ASSERTED, only the set of admissible end states.
 */
async function race2<A, B>(
  a: () => Promise<A>,
  b: () => Promise<B>,
  bFirst: boolean,
  gapMs: number,
): Promise<[A, B]> {
  const startB = bFirst ? b() : undefined;
  const startA = bFirst ? undefined : a();
  if (gapMs > 0) await sleep(gapMs);
  const pa = startA ?? a();
  const pb = startB ?? b();
  return [await pa, await pb];
}

/** The gap of a round of the real races: all five gaps meet both start orders. */
const gapFor = (round: number): number => [0, 8, 20, 45, 90][round % 5] ?? 0;

const branchValues = async (branchId: string): Promise<string[]> => {
  const [row] = await adminSql<{ values: string[] }[]>`
    select open_values as values from public.profile_form_branches where id = ${branchId}::uuid`;
  return [...(row?.values ?? [])].sort();
};

describe('12.2-12 D-646 and D-633: a branch edit or step edit and a member save never interleave or deadlock (T-12.1-13, T-12.2-04)', () => {
  it('branch edit, member first: the admin waits for the save, then is refused condition_locked because a question of the branch now has an answer; the store stays consistent', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await twoStepBranch();
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: f.opener,
        userId: member.userId,
        value: choose(f.yes),
      });
      const held = await holdMemberSave(member, async (tx) => {
        await upsertAnswer(tx, member, f.dependent, 'minha resposta');
      });
      await releasing(held, async () => {
        const [row] = await adminSql<{ revision: number }[]>`
          select revision from public.profile_form_branches where id = ${f.branch}::uuid`;
        const patching = Promise.resolve(
          adminCall('PATCH', `/v1/profile_form/branches/${f.branch}`, {
            revision: row?.revision,
            values: [f.no],
          }),
        );
        const patchDone = watch(patching);
        await untilBlocked('the branch edit behind the member’s save');
        expect(patchDone(), 'the branch edit waited for the member’s save').toBe(false);

        held.release();
        await held.committed;
        const refused = await outcome(await patching);
        expect(refused).toEqual({ status: 409, code: 'condition_locked' });
        expect(await branchValues(f.branch)).toEqual([f.yes]);
        expect(await storedFor(member.userId)).toEqual([f.opener, f.dependent].sort());
        expect(await staleAnswers(member.userId)).toEqual([]);
      });
    });
  }, 60_000);

  it('branch edit, admin first: the member’s save waits for the edit, then is refused form_changed and writes nothing; the retry with the fresh etag is consistent', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await twoStepBranch();
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: f.opener,
        userId: member.userId,
        value: choose(f.yes),
      });
      const stale = await readForm(member);
      const held = await holdAdminEdit(
        async (tx) => {
          await tx`
            update public.profile_form_branches
               set open_values = ${tx.array([f.no])}::text[], revision = revision + 1
             where id = ${f.branch}::uuid`;
        },
        { lockQuestions: false },
      );
      await releasing(held, async () => {
        const saving = Promise.resolve(
          saveStep(member, stale, f.s1, { [f.dependent]: 'tarde demais' }),
        );
        const saveDone = watch(saving);
        await untilBlocked('the member’s save behind the branch edit');
        expect(saveDone(), 'the save waited for the admin’s edit').toBe(false);

        held.release();
        await held.committed;
        expect(await outcome(await saving)).toEqual({ status: 409, code: 'form_changed' });
        expect(await storedFor(member.userId)).toEqual([f.opener]);
        expect(await staleAnswers(member.userId)).toEqual([]);

        // The branch now wants Não; the member says Não and the dependent is shown, so the answer is kept.
        const fresh = await readForm(member);
        const ok = await saveStep(member, fresh, f.s1, {
          [f.opener]: choose(f.no),
          [f.dependent]: 'agora vale',
        });
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(await storedFor(member.userId)).toEqual([f.opener, f.dependent].sort());
        expect(await staleAnswers(member.userId)).toEqual([]);
      });
    });
  }, 60_000);

  it('step move, member first: the admin’s reorder waits for the save that closes the dependent, then commits; no stale answer, no deadlock', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await twoStepBranch();
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
        value: 'velha',
      });
      const held = await holdMemberSave(member, async (tx) => {
        await upsertAnswer(tx, member, f.opener, choose(f.no));
      });
      await releasing(held, async () => {
        const reordering = Promise.resolve(
          adminCall('PUT', '/v1/profile_form/order', {
            steps: [
              { id: f.s1, questionIds: [f.opener] },
              { id: f.s2, questionIds: [f.dependent, f.other] },
            ],
          }),
        );
        const reorderDone = watch(reordering);
        await untilBlocked('the reorder behind the member’s save');
        expect(reorderDone(), 'the reorder waited for the member’s save').toBe(false);

        held.release();
        await held.committed;
        const moved = await reordering;
        expect(moved.status, await moved.clone().text()).toBe(200);
        expect(await storedFor(member.userId)).toEqual([f.opener]);
        expect(await staleAnswers(member.userId)).toEqual([]);
        const [placed] = await adminSql<{ step_id: string }[]>`
          select step_id::text as step_id from public.profile_form_questions where id = ${f.dependent}::uuid`;
        expect(placed?.step_id).toBe(f.s2);
      });
    });
  }, 60_000);

  it('step move, admin first: the member’s save waits for the move, then is refused form_changed; the dependent’s answer is still visible and the retry closes it', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await twoStepBranch();
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
        value: 'velha',
      });
      const stale = await readForm(member);
      const held = await holdAdminEdit(async (tx) => {
        await tx`
          update public.profile_form_questions
             set step_id = ${f.s2}::uuid, revision = revision + 1
           where id = ${f.dependent}::uuid`;
      });
      await releasing(held, async () => {
        const saving = Promise.resolve(saveStep(member, stale, f.s1, { [f.opener]: choose(f.no) }));
        const saveDone = watch(saving);
        await untilBlocked('the member’s save behind the step move');
        expect(saveDone(), 'the save waited for the admin’s step move').toBe(false);

        held.release();
        await held.committed;
        expect(await outcome(await saving)).toEqual({ status: 409, code: 'form_changed' });
        expect(await storedFor(member.userId)).toEqual([f.opener, f.dependent].sort());
        expect(await staleAnswers(member.userId)).toEqual([]);

        const fresh = await readForm(member);
        const retry = await saveStep(member, fresh, f.s1, { [f.opener]: choose(f.no) });
        expect(retry.status, await retry.clone().text()).toBe(200);
        expect(await storedFor(member.userId)).toEqual([f.opener]);
        expect(await staleAnswers(member.userId)).toEqual([]);
      });
    });
  }, 60_000);

  it('real routes raced both ways over several rounds (a step move against the member’s opener change): only 200 or 409 form_changed, never a 500 or a deadlock, and stored equals visible after every round', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await twoStepBranch();
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
        value: 'rodada',
      });
      const outcomes: string[] = [];
      for (let round = 0; round < 6; round += 1) {
        const form = await readForm(member);
        const toSecond = round % 2 === 0;
        const reordering = Promise.resolve(
          adminCall('PUT', '/v1/profile_form/order', {
            steps: toSecond
              ? [
                  { id: f.s1, questionIds: [f.opener] },
                  { id: f.s2, questionIds: [f.dependent, f.other] },
                ]
              : [
                  { id: f.s1, questionIds: [f.opener, f.dependent] },
                  { id: f.s2, questionIds: [f.other] },
                ],
          }),
        ).then(
          (res) => `admin-${res.status}`,
          () => 'admin-error',
        );
        if (round % 3 === 1) await sleep(25);
        const saving = saveStep(member, form, f.s1, {
          [f.opener]: choose(round % 2 === 0 ? f.no : f.yes),
        }).then(
          async (res) =>
            res.status === 409 ? `save-409-${await profileFormCode(res)}` : `save-${res.status}`,
          () => 'save-error',
        );
        const [adminResult, saveResult] = await Promise.all([reordering, saving]);
        outcomes.push(adminResult, saveResult);
        expect(adminResult, `round ${round}`).toBe('admin-200');
        expect(['save-200', 'save-409-form_changed'], `round ${round}`).toContain(saveResult);
        expect(await staleAnswers(member.userId), `round ${round}`).toEqual([]);
      }
      expect(outcomes.filter((outcome) => outcome.includes('40P01'))).toEqual([]);
    });
  }, 120_000);

  it('two saves of the same member racing (the opener closes while a dependent is rewritten) end consistent whichever wins', async () => {
    await withProfileForm(labTenantId, async () => {
      const f = await twoStepBranch();
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
          saveStep(member, form, f.s1, { [f.opener]: choose(f.no) }),
          saveStep(member, form, f.s1, { [f.dependent]: 'nova' }),
        ]);
        expect(close.status, `round ${round}: ${await close.clone().text()}`).toBe(200);
        expect(rewrite.status, `round ${round}: ${await rewrite.clone().text()}`).toBe(200);
        expect(await staleAnswers(member.userId), `round ${round}`).toEqual([]);
        expect(await storedFor(member.userId), `round ${round}`).toEqual([f.opener]);
      }
    });
  }, 90_000);
});

// ── 12.2-12: the races of Phase 12.2 on a depth-2 tree (T-12.2-04, T-12.2-06, PFORM-47, PFORM-51) ──────────────
//
// Every race below enumerates the end states it admits by NAME and asserts membership with `toContain`, never a
// timing. Lock order, both sides: the member takes questions (FOR SHARE) then branches (FOR SHARE) then her own
// advisory lock; an admin takes the tenant advisory lock, then questions (FOR UPDATE), then branches (FOR UPDATE).
// A deadlock would surface as a 500 (SQLSTATE 40P01), which no state admits.

const ROUNDS = 20;

describe('12.2-12 T-12.2-04: a branch edit against a member’s answer ends in exactly one of two states', () => {
  it('branch edit, held both ways: the answer committed first makes the edit condition_locked; the edit committed first makes the save form_changed', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree();
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: f.q1,
        userId: member.userId,
        value: choose(f.y1),
      });
      // (a) The answer to a question of B1 is in flight: the edit of B1’s opening set waits, then is refused.
      const held = await holdMemberSave(member, async (tx) => {
        await upsertAnswer(tx, member, f.q2, choose(f.y2));
      });
      await releasing(held, async () => {
        const patching = Promise.resolve(
          adminCall('PATCH', `/v1/profile_form/branches/${f.b1}`, {
            revision: 1,
            values: [f.y1, f.n1],
          }),
        );
        const patchDone = watch(patching);
        await untilBlocked('the branch edit behind the answer in flight');
        expect(patchDone()).toBe(false);
        held.release();
        await held.committed;
        const refused = await outcome(await patching);
        const state =
          refused.status === 409 && refused.code === 'condition_locked' ? 'answer-first' : 'other';
        expect(['answer-first'], `edit ${refused.status}/${refused.code}`).toContain(state);
        expect(await branchValues(f.b1)).toEqual([f.y1]);
      });
      expect(await storedFor(member.userId)).toEqual([f.q1, f.q2].sort());

      // (b) The edit of B1 holds first: the save, which read the form before, waits and is refused.
      await adminSql`delete from public.profile_form_answers where question_id = ${f.q2}::uuid`;
      const stale = await readForm(member);
      const editing = await holdAdminEdit(
        async (tx) => {
          await tx`
            update public.profile_form_branches
               set open_values = ${tx.array([f.y1, f.n1])}::text[], revision = revision + 1
             where id = ${f.b1}::uuid`;
        },
        { lockQuestions: false },
      );
      await releasing(editing, async () => {
        const saving = Promise.resolve(saveStep(member, stale, f.s1, { [f.q2]: choose(f.y2) }));
        const saveDone = watch(saving);
        await untilBlocked('the member’s save behind the branch edit');
        expect(saveDone()).toBe(false);
        editing.release();
        await editing.committed;
        const refused = await outcome(await saving);
        const state =
          refused.status === 409 && refused.code === 'form_changed' ? 'edit-first' : 'other';
        expect(['edit-first'], `save ${refused.status}/${refused.code}`).toContain(state);
        expect(await branchValues(f.b1)).toEqual([f.n1, f.y1].sort());
        expect(await storedFor(member.userId)).toEqual([f.q1]);
      });
      expect(await staleAnswers(member.userId)).toEqual([]);
    });
  }, 90_000);

  it(`branch edit, ${ROUNDS} real races of PATCH /branches/{id} against the member’s answer to a question of that branch: answer-first or edit-first, never both, never a 500`, async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree();
      const seen = new Map<string, number>();
      for (let round = 0; round < ROUNDS; round += 1) {
        await adminSql`delete from public.profile_form_answers where user_id = ${member.userId}::uuid`;
        await adminSql`
          update public.profile_form_branches
             set open_values = ${adminSql.array([f.y1])}::text[], revision = 1
           where id = ${f.b1}::uuid`;
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: f.q1,
          userId: member.userId,
          value: choose(f.y1),
        });
        const form = await readForm(member);
        const edit = () =>
          adminCall('PATCH', `/v1/profile_form/branches/${f.b1}`, {
            revision: 1,
            values: [f.y1, f.n1],
          }).then(outcome);
        const answer = () => saveStep(member, form, f.s1, { [f.q2]: choose(f.y2) }).then(outcome);
        const [editResult, saveResult] = await race2(edit, answer, round % 2 === 1, gapFor(round));
        const state =
          saveResult.status === 200 &&
          editResult.status === 409 &&
          editResult.code === 'condition_locked'
            ? 'answer-first'
            : editResult.status === 200 &&
                saveResult.status === 409 &&
                saveResult.code === 'form_changed'
              ? 'edit-first'
              : `other edit=${editResult.status}/${editResult.code} save=${saveResult.status}/${saveResult.code}`;
        expect(['answer-first', 'edit-first'], `round ${round}`).toContain(state);
        seen.set(state, (seen.get(state) ?? 0) + 1);

        const answered = (await storedFor(member.userId)).includes(f.q2);
        const values = await branchValues(f.b1);
        if (state === 'answer-first') {
          expect(answered, `round ${round}: the answer`).toBe(true);
          expect(values, `round ${round}: the opening set`).toEqual([f.y1]);
        } else {
          expect(answered, `round ${round}: no answer under the edited branch`).toBe(false);
          expect(values, `round ${round}: the opening set`).toEqual([f.n1, f.y1].sort());
        }
        expect(await staleAnswers(member.userId), `round ${round}`).toEqual([]);
      }
      console.info(`[12.2-12 branch edit] ${JSON.stringify([...seen])}`);
      expect(seen.size).toBeGreaterThan(0);
    });
  }, 120_000);
});

describe('12.2-12 T-12.2-06: "Arquivar ramo" against a member’s save keeps the archived block’s answers', () => {
  it('archive, held both ways: the save in flight makes the archive wait and its answer is kept; the archive holding first makes the save form_changed with no answer', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree();
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: f.q1,
        userId: member.userId,
        value: choose(f.y1),
      });
      // (a) The member's answer to Q2 is in flight: the archive waits for it, then archives; the answer stays.
      const held = await holdMemberSave(member, async (tx) => {
        await upsertAnswer(tx, member, f.q2, choose(f.y2));
      });
      await releasing(held, async () => {
        const archiving = Promise.resolve(
          adminCall('POST', `/v1/profile_form/branches/${f.b1}/archive`),
        );
        const archiveDone = watch(archiving);
        await untilBlocked('the archive behind the answer in flight');
        expect(archiveDone()).toBe(false);
        held.release();
        await held.committed;
        const archived = await outcome(await archiving);
        const state = archived.status === 200 ? 'save-first' : 'other';
        expect(['save-first'], `archive ${archived.status}/${archived.code}`).toContain(state);
      });
      expect(await answerCountOf(f.q2)).toBe(1);
      const [block] = await adminSql<{ branch: boolean; q2: boolean }[]>`
        select (select archived_at is not null from public.profile_form_branches where id = ${f.b1}::uuid) as branch,
               (select archived_at is not null from public.profile_form_questions where id = ${f.q2}::uuid) as q2`;
      expect(block).toEqual({ branch: true, q2: true });
      expect(await staleAnswers(member.userId)).toEqual([]);

      // (b) An archive holds the block first: a save that read the form before waits, then is refused and writes nothing.
      const other = await person();
      const other2 = await deepTree();
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: other2.q1,
        userId: other.userId,
        value: choose(other2.y1),
      });
      const stale = await readForm(other);
      const editing = await holdAdminEdit(async (tx) => {
        await tx`
          update public.profile_form_branches set archived_at = now(), revision = revision + 1
           where id in (${other2.b1}::uuid, ${other2.b2}::uuid)`;
        await tx`
          update public.profile_form_questions set archived_at = now(), revision = revision + 1
           where branch_id in (${other2.b1}::uuid, ${other2.b2}::uuid)`;
      });
      await releasing(editing, async () => {
        const saving = Promise.resolve(
          saveStep(other, stale, other2.s1, { [other2.q2]: choose(other2.y2) }),
        );
        const saveDone = watch(saving);
        await untilBlocked('the member’s save behind the archive');
        expect(saveDone()).toBe(false);
        editing.release();
        await editing.committed;
        const refused = await outcome(await saving);
        const state =
          refused.status === 409 && refused.code === 'form_changed' ? 'archive-first' : 'other';
        expect(['archive-first'], `save ${refused.status}/${refused.code}`).toContain(state);
      });
      expect(await answerCountOf(other2.q2)).toBe(0);
      expect(await staleAnswers(other.userId)).toEqual([]);
    });
  }, 120_000);

  it(`archive, ${ROUNDS} real races of POST /branches/{id}/archive against the member’s answer: save-first keeps the answer in the archived block, archive-first refuses the save, never a lost answer`, async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const seen = new Map<string, number>();
      for (let round = 0; round < ROUNDS; round += 1) {
        const f = await deepTree();
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: f.q1,
          userId: member.userId,
          value: choose(f.y1),
        });
        const form = await readForm(member);
        const archive = () =>
          adminCall('POST', `/v1/profile_form/branches/${f.b1}/archive`).then(outcome);
        const answer = () => saveStep(member, form, f.s1, { [f.q2]: choose(f.y2) }).then(outcome);
        const [archiveResult, saveResult] = await race2(
          archive,
          answer,
          round % 2 === 1,
          gapFor(round),
        );
        const state =
          archiveResult.status === 200 && saveResult.status === 200
            ? 'save-first'
            : archiveResult.status === 200 &&
                saveResult.status === 409 &&
                saveResult.code === 'form_changed'
              ? 'archive-first'
              : `other archive=${archiveResult.status}/${archiveResult.code} save=${saveResult.status}/${saveResult.code}`;
        expect(['save-first', 'archive-first'], `round ${round}`).toContain(state);
        seen.set(state, (seen.get(state) ?? 0) + 1);

        const [block] = await adminSql<{ branch: boolean }[]>`
          select archived_at is not null as branch from public.profile_form_branches where id = ${f.b1}::uuid`;
        expect(block?.branch, `round ${round}: the block is archived`).toBe(true);
        // The archived block keeps every answer it had, and nothing sits below a really closed chain.
        expect(await answerCountOf(f.q2), `round ${round}`).toBe(state === 'save-first' ? 1 : 0);
        expect((await storedFor(member.userId)).includes(f.q1), `round ${round}: the opener`).toBe(
          true,
        );
        expect(await staleAnswers(member.userId), `round ${round}`).toEqual([]);

        await adminSql`delete from public.profile_form_answers where user_id = ${member.userId}::uuid`;
        await removeProfileFormByPrefix(TITLE);
      }
      console.info(`[12.2-12 archive] ${JSON.stringify([...seen])}`);
      expect(seen.size).toBeGreaterThan(0);
    });
  }, 180_000);
});

describe('12.2-12 PFORM-51: two saves of one member serialise and equal the same two saves run one after the other', () => {
  it('two saves, started together: the stored answers are the result of A then B or of B then A, never a mix', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree();
      const label = new Map([
        [f.q1, 'Q1'],
        [f.q2, 'Q2'],
        [f.q3, 'Q3'],
      ]);
      const snapshot = async () =>
        (
          await adminSql<{ question_id: string; value: unknown }[]>`
            select a.question_id::text as question_id, a.value
              from public.profile_form_answers a
              join public.memberships m on m.id = a.membership_id
             where m.user_id = ${member.userId}::uuid`
        )
          .map(
            (row) =>
              `${label.get(row.question_id) ?? row.question_id}=${JSON.stringify(row.value)}`,
          )
          .sort()
          .join('|');
      const clear = () =>
        adminSql`delete from public.profile_form_answers where user_id = ${member.userId}::uuid`;
      // Save A opens B1 and answers inside it; save B closes B1 (and so removes what A put there).
      const saveA = (form: Form) =>
        saveStep(member, form, f.s1, { [f.q1]: choose(f.y1), [f.q2]: choose(f.y2) });
      const saveB = (form: Form) => saveStep(member, form, f.s1, { [f.q1]: choose(f.n1) });

      // The reference: the same two saves run one after the other, in each order.
      await clear();
      let form = await readForm(member);
      expect((await saveA(form)).status).toBe(200);
      expect((await saveB(form)).status).toBe(200);
      const aThenB = await snapshot();
      await clear();
      expect((await saveB(form)).status).toBe(200);
      expect((await saveA(form)).status).toBe(200);
      const bThenA = await snapshot();
      expect(aThenB).not.toBe(bThenA);

      const seen = new Map<string, number>();
      for (let round = 0; round < ROUNDS; round += 1) {
        await clear();
        form = await readForm(member);
        const [a, b] = await race2(
          () => saveA(form),
          () => saveB(form),
          round % 2 === 1,
          gapFor(round),
        );
        expect([a.status, b.status], `round ${round}`).toEqual([200, 200]);
        const now = await snapshot();
        const state = now === aThenB ? 'A-then-B' : now === bThenA ? 'B-then-A' : `mixed ${now}`;
        expect(['A-then-B', 'B-then-A'], `round ${round}`).toContain(state);
        seen.set(state, (seen.get(state) ?? 0) + 1);
        expect(await staleAnswers(member.userId), `round ${round}`).toEqual([]);
      }
      console.info(`[12.2-12 two saves] ${JSON.stringify([...seen])}`);
      expect(seen.size).toBeGreaterThan(0);
    });
  }, 120_000);
});

describe('12.2-12 PFORM-47: two purges of one member delete once, and a purge against her own save equals one of the two orders', () => {
  const purgeOnce = (via: postgres.Sql, member: Person) =>
    via.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claimsOf(member)}, true)`;
      await tx.unsafe('set local role authenticated');
      return tx`select question_id::text as question_id from app.profile_form_purge_closed()`;
    });

  /** Q1 answered Não (B1 closed) while Q2 and Q3 still hold answers below it: what a purge is for. */
  async function staleMember(member: Person, f: Awaited<ReturnType<typeof deepTree>>) {
    await adminSql`delete from public.profile_form_answers where user_id = ${member.userId}::uuid`;
    await seedProfileFormAnswer({
      tenantId: labTenantId,
      questionId: f.q1,
      userId: member.userId,
      value: choose(f.n1),
    });
    await seedProfileFormAnswer({
      tenantId: labTenantId,
      questionId: f.q2,
      userId: member.userId,
      value: choose(f.y2),
    });
    await seedProfileFormAnswer({
      tenantId: labTenantId,
      questionId: f.q3,
      userId: member.userId,
      value: 'abaixo',
    });
  }

  it('two purges, the first held open: the second waits and finds nothing, and together they deleted exactly the stale answers once', async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree();
      await staleMember(member, f);
      let release: () => void = () => {};
      let held: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holding = new Promise<void>((resolve) => {
        held = resolve;
      });
      let first: { question_id: string }[] = [];
      const firstTx = memberSql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claimsOf(member)}, true)`;
        await tx.unsafe('set local role authenticated');
        first =
          await tx`select question_id::text as question_id from app.profile_form_purge_closed()`;
        held();
        await gate;
      });
      await Promise.race([holding, firstTx]);
      try {
        const second = purgeOnce(purgeSql, member);
        const secondDone = watch(second);
        await untilBlocked('the second purge behind the first');
        expect(secondDone(), 'the second purge waited for the rows the first deleted').toBe(false);
        release();
        await firstTx;
        const secondRows = await second;
        const deleted = [...first, ...secondRows].map((row) => row.question_id).sort();
        const state =
          first.length === 2 && secondRows.length === 0
            ? 'first-took-all'
            : first.length === 0 && secondRows.length === 2
              ? 'second-took-all'
              : 'split-or-other';
        expect(['first-took-all'], `first ${first.length} second ${secondRows.length}`).toContain(
          state,
        );
        expect(deleted).toEqual([f.q2, f.q3].sort());
        expect(new Set(deleted).size).toBe(deleted.length);
      } finally {
        release();
        await firstTx.catch(() => undefined);
      }
      expect(await storedFor(member.userId)).toEqual([f.q1]);
    });
  }, 60_000);

  it(`two purges, ${ROUNDS} times started together: the union of what they deleted is the stale set, no answer is deleted twice and none is missed`, async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree();
      const seen = new Map<string, number>();
      for (let round = 0; round < ROUNDS; round += 1) {
        await staleMember(member, f);
        const [a, b] = await Promise.all([
          purgeOnce(memberSql, member),
          purgeOnce(purgeSql, member),
        ]);
        const state =
          a.length === 2 && b.length === 0
            ? 'first-took-all'
            : a.length === 0 && b.length === 2
              ? 'second-took-all'
              : a.length + b.length === 2
                ? 'split'
                : `other ${a.length}+${b.length}`;
        expect(['first-took-all', 'second-took-all', 'split'], `round ${round}`).toContain(state);
        seen.set(state, (seen.get(state) ?? 0) + 1);
        const deleted = [...a, ...b].map((row) => row.question_id).sort();
        expect(deleted, `round ${round}`).toEqual([f.q2, f.q3].sort());
        expect(await storedFor(member.userId), `round ${round}`).toEqual([f.q1]);
      }
      console.info(`[12.2-12 two purges] ${JSON.stringify([...seen])}`);
      expect(seen.size).toBeGreaterThan(0);
    });
  }, 120_000);

  it(`purge against the member’s own next save, ${ROUNDS} times: the final state is "purge then save" or "save then purge", never a mix`, async () => {
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await deepTree();
      const label = new Map([
        [f.q1, 'Q1'],
        [f.q2, 'Q2'],
        [f.q3, 'Q3'],
      ]);
      const snapshot = async () =>
        (
          await adminSql<{ question_id: string; value: unknown }[]>`
            select a.question_id::text as question_id, a.value
              from public.profile_form_answers a
              join public.memberships m on m.id = a.membership_id
             where m.user_id = ${member.userId}::uuid`
        )
          .map(
            (row) =>
              `${label.get(row.question_id) ?? row.question_id}=${JSON.stringify(row.value)}`,
          )
          .sort()
          .join('|');
      // The save re-opens B1 (Q1 back to Sim); the stale Q2 and Q3 answers survive it only if the purge ran later.
      const save = (form: Form) => saveStep(member, form, f.s1, { [f.q1]: choose(f.y1) });

      await staleMember(member, f);
      let form = await readForm(member);
      await purgeOnce(memberSql, member);
      expect((await save(form)).status).toBe(200);
      const purgeThenSave = await snapshot();
      await staleMember(member, f);
      expect((await save(form)).status).toBe(200);
      await purgeOnce(memberSql, member);
      const saveThenPurge = await snapshot();
      expect(purgeThenSave).not.toBe(saveThenPurge);

      const seen = new Map<string, number>();
      for (let round = 0; round < ROUNDS; round += 1) {
        await staleMember(member, f);
        form = await readForm(member);
        const [, saved] = await race2(
          () => purgeOnce(memberSql, member),
          () => save(form),
          round % 2 === 1,
          gapFor(round),
        );
        expect(saved.status, `round ${round}`).toBe(200);
        const now = await snapshot();
        const state =
          now === purgeThenSave
            ? 'purge-then-save'
            : now === saveThenPurge
              ? 'save-then-purge'
              : `mixed ${now}`;
        expect(['purge-then-save', 'save-then-purge'], `round ${round}`).toContain(state);
        seen.set(state, (seen.get(state) ?? 0) + 1);
        expect(await staleAnswers(member.userId), `round ${round}`).toEqual([]);
      }
      console.info(`[12.2-12 purge against save] ${JSON.stringify([...seen])}`);
      expect(seen.size).toBeGreaterThan(0);
    });
  }, 120_000);
});
