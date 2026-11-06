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
 * 12-09 (PFORM-03, PFORM-08, PFORM-17, PFORM-23, PFORM-24; D-585, D-588, D-589) against the live local stack:
 * the lifecycle of a question under `/v1/profile_form` (archive, reactivate, delete, replace, the archived
 * list) and the two numbers the builder shows (summary, impact), each driven THROUGH THE GATE of plan 05 and
 * the member read of plan 06: the member is held or freed exactly as D-585 says, and no answer is ever touched.
 *
 * EVERY identity is a THROWAWAY (`createSharedIdentity`, prefix `pfl`); questions carry the title prefix
 * `pfl ` so the sweep removes only this file's rows. The module row is restored by `withProfileForm`.
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };
type AdminQuestion = {
  id: string;
  type: string;
  title: string;
  required: boolean;
  options: { id: string; label: string; answerCount: number }[];
  position: number;
  revision: number;
  answerCount: number;
  listedAt: string;
};
type ArchivedQuestion = AdminQuestion & { archivedAt: string };
type QuestionList = { questions: AdminQuestion[]; activeCount: number; limit: number };

const PREFIX = 'pfl';
const TITLE = 'pfl ';
let labTenantId = '';
let demoTenantId = '';
let adminUserId = '';

type Person = { userId: string; email: string; password: string; token: string };

async function person(
  role: 'member' | 'admin_tenant' | 'support_tenant' = 'member',
  host: keyof typeof HOSTS = 'lab',
  status: 'active' | 'blocked' | 'invited' = 'active',
): Promise<Person> {
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host, role, status }],
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

const codeOf = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as Partial<Envelope>).error?.code;
const detailOf = async (res: Response): Promise<unknown> =>
  ((await res.json()) as Partial<Envelope>).error?.details?.profileForm;

/** A question straight through SQL (the migration role). */
const question = (over: Partial<Parameters<typeof seedProfileFormQuestion>[0]> = {}) =>
  seedProfileFormQuestion({
    tenantId: labTenantId,
    adminUserId,
    title: `${TITLE}${crypto.randomUUID().slice(0, 8)}`,
    required: false,
    ...over,
  });

const answerRows = async (): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n from public.profile_form_answers
     where question_id in (select id from public.profile_form_questions where title like ${`${TITLE}%`})`;
  return row?.n ?? 0;
};

/** What the gate says about the member: the bootstrap block. */
const pendingOf = async (member: Person): Promise<number> => {
  const res = await call(member, 'GET', '/v1/me/bootstrap');
  expect(res.status).toBe(200);
  const body = (await res.json()) as { profileForm?: { pendingRequired: number } };
  return body.profileForm?.pendingRequired ?? 0;
};

/** What the member's own read says: `missingRequired` of `GET /v1/me/profile-form`. */
const missingOf = async (member: Person): Promise<number> => {
  const res = await call(member, 'GET', '/v1/me/profile-form');
  expect(res.status).toBe(200);
  return ((await res.json()) as { missingRequired: number }).missingRequired;
};

const archive = (admin: Person, id: string, host: string = HOSTS.lab) =>
  call(admin, 'POST', `/v1/profile_form/questions/${id}/archive`, undefined, host);
const reactivate = (admin: Person, id: string, host: string = HOSTS.lab) =>
  call(admin, 'POST', `/v1/profile_form/questions/${id}/reactivate`, undefined, host);
const archivedList = async (admin: Person): Promise<ArchivedQuestion[]> => {
  const res = await call(admin, 'GET', '/v1/profile_form/archived');
  expect(res.status).toBe(200);
  return ((await res.json()) as { questions: ArchivedQuestion[] }).questions;
};
const activeList = async (admin: Person): Promise<QuestionList> => {
  const res = await call(admin, 'GET', '/v1/profile_form/questions');
  expect(res.status).toBe(200);
  return (await res.json()) as QuestionList;
};
const storedOf = async (id: string) => {
  const [row] = await adminSql<
    { archived_at: Date | null; position: number; revision: number; listed_at: Date }[]
  >`select archived_at, position, revision, listed_at from public.profile_form_questions
     where id = ${id}::uuid`;
  return row;
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

describe('12-09 tracer: archive and reactivate a required question and the gate follows, answers kept (D-585, D-588, D-589)', () => {
  it('archiving releases the held member and keeps the answers; reactivating holds her again, asked only for what is missing', async () => {
    const admin = await person('admin_tenant');
    const held = await person();
    const answered = await person();
    await withProfileForm(labTenantId, async () => {
      const id = await question({ required: true, position: 1 });
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: id,
        userId: answered.userId,
      });

      expect(await pendingOf(held)).toBe(1);
      expect(await pendingOf(answered)).toBe(0);
      const before = await answerRows();
      expect(before).toBe(1);

      const archived = await archive(admin, id);
      expect(archived.status).toBe(200);
      const archivedBody = (await archived.json()) as ArchivedQuestion;
      expect(archivedBody).toMatchObject({ id, required: true, answerCount: 1 });
      expect(new Date(archivedBody.archivedAt).toString()).not.toBe('Invalid Date');
      // The gate lets the held member through the very next request, and her own read agrees.
      expect(await pendingOf(held)).toBe(0);
      expect(await missingOf(held)).toBe(0);
      expect((await call(held, 'GET', '/v1/me/profile')).status).toBe(200);
      // D-588: not one answer row changed.
      expect(await answerRows()).toBe(before);

      const back = await reactivate(admin, id);
      expect(back.status).toBe(200);
      expect(await pendingOf(held)).toBe(1);
      expect(await missingOf(held)).toBe(1);
      expect((await call(held, 'GET', '/v1/me/profile')).status).toBe(403);
      // The member who had answered it before the archive is still complete: her answer was kept.
      expect(await pendingOf(answered)).toBe(0);
      expect(await missingOf(answered)).toBe(0);
      expect(await answerRows()).toBe(before);
    });
  }, 60_000);

  it('D-589: archiving the LAST required question releases every held member and every answer row is still there', async () => {
    const admin = await person('admin_tenant');
    const held = await person();
    const other = await person();
    const done = await person();
    await withProfileForm(labTenantId, async () => {
      const first = await question({ required: true, position: 1 });
      const last = await question({ required: true, position: 2 });
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: first,
        userId: done.userId,
      });
      await seedProfileFormAnswer({ tenantId: labTenantId, questionId: last, userId: done.userId });
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: first,
        userId: other.userId,
      });
      const before = await answerRows();
      expect(before).toBe(3);

      expect(await pendingOf(held)).toBe(2);
      expect(await pendingOf(other)).toBe(1);

      expect((await archive(admin, first)).status).toBe(200);
      expect(await pendingOf(held)).toBe(1);
      expect(await pendingOf(other)).toBe(1);
      expect((await archive(admin, last)).status).toBe(200);

      for (const member of [held, other, done]) {
        expect(await pendingOf(member)).toBe(0);
        expect((await call(member, 'GET', '/v1/me/profile')).status).toBe(200);
      }
      expect(await answerRows()).toBe(before);
      expect((await activeList(admin)).activeCount).toBe(0);
      const kept = await archivedList(admin);
      expect(kept.map((q) => [q.id, q.answerCount]).sort()).toEqual(
        [
          [first, 2],
          [last, 1],
        ].sort(),
      );
    });
  }, 60_000);

  it('turning an optional question required holds exactly the members without an answer; making it optional frees them', async () => {
    const admin = await person('admin_tenant');
    const without = await person();
    const withAnswer = await person();
    await withProfileForm(labTenantId, async () => {
      const id = await question({ required: false, position: 1 });
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: id,
        userId: withAnswer.userId,
      });
      const before = await answerRows();
      expect(await pendingOf(without)).toBe(0);

      let revision = (await storedOf(id))?.revision ?? 1;
      const makeRequired = await call(admin, 'PATCH', `/v1/profile_form/questions/${id}`, {
        revision,
        required: true,
      });
      expect(makeRequired.status).toBe(200);
      expect(await pendingOf(without)).toBe(1);
      expect(await pendingOf(withAnswer)).toBe(0);

      revision = (await storedOf(id))?.revision ?? revision;
      const makeOptional = await call(admin, 'PATCH', `/v1/profile_form/questions/${id}`, {
        revision,
        required: false,
      });
      expect(makeOptional.status).toBe(200);
      expect(await pendingOf(without)).toBe(0);
      expect(await pendingOf(withAnswer)).toBe(0);
      expect(await answerRows()).toBe(before);
    });
  }, 60_000);

  it('creating a required question holds every member without it', async () => {
    const admin = await person('admin_tenant');
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      expect(await pendingOf(member)).toBe(0);
      const res = await call(admin, 'POST', '/v1/profile_form/questions', {
        type: 'short_text',
        title: `${TITLE}nova`,
        required: true,
      });
      expect(res.status).toBe(201);
      expect(await pendingOf(member)).toBe(1);
    });
  }, 30_000);
});

describe('12-09 archive and reactivate: idempotency, ordering, boundary and adjacency (PFORM-03)', () => {
  it('archive twice and reactivate twice are 200 no-ops: archived_at, position and revision do not move', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const id = await question({ position: 3 });

      const first = (await (await archive(admin, id)).json()) as ArchivedQuestion;
      const storedFirst = await storedOf(id);
      const second = await archive(admin, id);
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as ArchivedQuestion;
      expect(secondBody.archivedAt).toBe(first.archivedAt);
      expect(secondBody.revision).toBe(first.revision);
      expect((await storedOf(id))?.archived_at?.toISOString()).toBe(
        storedFirst?.archived_at?.toISOString(),
      );

      const back = (await (await reactivate(admin, id)).json()) as AdminQuestion;
      const storedBack = await storedOf(id);
      const again = await reactivate(admin, id);
      expect(again.status).toBe(200);
      const againBody = (await again.json()) as AdminQuestion;
      expect(againBody.position).toBe(back.position);
      expect(againBody.revision).toBe(back.revision);
      expect((await storedOf(id))?.listed_at.toISOString()).toBe(
        storedBack?.listed_at.toISOString(),
      );
    });
  }, 30_000);

  it('a reactivated question lands at max(position) + 1 of the active list and gets a fresh listedAt', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const gone = await question({ position: 2, archived: true, title: `${TITLE}gone` });
      await question({ position: 5, title: `${TITLE}five` });
      await question({ position: 9, title: `${TITLE}nine` });
      const res = await reactivate(admin, gone);
      expect(res.status).toBe(200);
      const body = (await res.json()) as AdminQuestion;
      expect(body.position).toBe(10);
      const list = await activeList(admin);
      expect(list.questions.at(-1)?.id).toBe(gone);
      expect(new Date(body.listedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    });
  }, 30_000);

  it('the archived list is ordered by archived_at descending then id, and a tenant with none is { questions: [] }', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      expect(await archivedList(admin)).toEqual([]);
      const base = Date.now() - 3_600_000;
      const oldest = await question({ archivedAt: new Date(base), title: `${TITLE}oldest` });
      const newest = await question({
        archivedAt: new Date(base + 120_000),
        title: `${TITLE}newest`,
      });
      const tieA = await question({ archivedAt: new Date(base + 60_000), title: `${TITLE}tie a` });
      const tieB = await question({ archivedAt: new Date(base + 60_000), title: `${TITLE}tie b` });
      await question({ title: `${TITLE}active` });
      const tie = [tieA, tieB].sort();
      expect((await archivedList(admin)).map((q) => q.id)).toEqual([newest, ...tie, oldest]);
      const res = await call(admin, 'GET', '/v1/profile_form/archived');
      // 12.2-08 (D-640): the archived list carries every branch too, so a row can name its branch.
      expect(Object.keys((await res.json()) as object)).toEqual(['questions', 'branches']);
    });
  }, 30_000);

  it('answerCount is an exact count: after N saves it equals N, and a never-answered archived question shows 0', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const id = await question({ required: true });
      const never = await question({ title: `${TITLE}never` });
      const members = [await person(), await person(), await person()];
      for (const member of members) {
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: id,
          userId: member.userId,
        });
      }
      expect((await archive(admin, id)).status).toBe(200);
      expect((await archive(admin, never)).status).toBe(200);
      const byId = new Map((await archivedList(admin)).map((q) => [q.id, q]));
      expect(byId.get(id)?.answerCount).toBe(3);
      expect(byId.get(id)?.required).toBe(true);
      expect(byId.get(never)?.answerCount).toBe(0);
    });
  }, 60_000);

  it('an archived and an active question with the same title coexist, and answers stay on the question id', async () => {
    const admin = await person('admin_tenant');
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const title = `${TITLE}mesmo título`;
      const old = await question({ title, required: true });
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: old,
        userId: member.userId,
      });
      expect((await archive(admin, old)).status).toBe(200);
      const fresh = await question({ title, required: true, position: 4 });

      const archivedNow = await archivedList(admin);
      expect(archivedNow.map((q) => q.id)).toEqual([old]);
      expect(archivedNow[0]?.answerCount).toBe(1);
      const active = await activeList(admin);
      expect(active.questions.map((q) => [q.id, q.answerCount])).toEqual([[fresh, 0]]);
      // The member answered the OLD question, so the new one of the same title still holds her.
      expect(await pendingOf(member)).toBe(1);
    });
  }, 60_000);

  it('the 30-question boundary: reactivating at 30 active is 409 limit_reached, archiving one frees the slot', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const gone = await question({ archived: true, title: `${TITLE}gone` });
      const active: string[] = [];
      for (let i = 0; i < 30; i++) active.push(await question({ position: i + 1 }));

      const refused = await reactivate(admin, gone);
      expect(refused.status).toBe(409);
      expect(await detailOf(refused)).toBe('limit_reached');
      expect((await storedOf(gone))?.archived_at).not.toBeNull();

      const last = active.at(-1);
      if (!last) throw new Error('no active question');
      expect((await archive(admin, last)).status).toBe(200);
      expect((await reactivate(admin, gone)).status).toBe(200);
      expect((await activeList(admin)).activeCount).toBe(30);
      // Reactivating the one that is already active at 30 is still a no-op 200, never the limit.
      expect((await reactivate(admin, gone)).status).toBe(200);
    });
  }, 90_000);

  it('another tenant’s question id is the bare 404 on archive and reactivate, and nothing changes there', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const foreign = await seedProfileFormQuestion({
        tenantId: demoTenantId,
        adminUserId,
        title: `${TITLE}demo`,
      });
      const foreignArchived = await seedProfileFormQuestion({
        tenantId: demoTenantId,
        adminUserId,
        title: `${TITLE}demo archived`,
        archived: true,
      });
      for (const res of [
        await archive(admin, foreign),
        await reactivate(admin, foreignArchived),
        await archive(admin, crypto.randomUUID()),
      ]) {
        expect(res.status).toBe(404);
        expect(await codeOf(res)).toBe('NOT_FOUND');
      }
      expect((await storedOf(foreign))?.archived_at).toBeNull();
      expect((await storedOf(foreignArchived))?.archived_at).not.toBeNull();
    });
  }, 30_000);
});

const keysOf = (node: unknown): string[] =>
  node && typeof node === 'object'
    ? Object.entries(node).flatMap(([key, child]) => [key, ...keysOf(child)])
    : [];
// Aggregates only (D-593): no key of any number the builder reads is, or can carry, an individual answer.
const ANSWER_KEYS = ['value', 'answer', 'answers', 'otherText', 'optionId', 'optionIds'];

describe('12-09 delete a question nobody answered (PFORM-03, D-588, T-12-22)', () => {
  it('a never-answered question is deleted (200 { deleted: true }) and a second delete is the bare 404', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const id = await question({ title: `${TITLE}typo` });
      const first = await call(admin, 'DELETE', `/v1/profile_form/questions/${id}`);
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ deleted: true });
      expect(await storedOf(id)).toBeUndefined();
      const second = await call(admin, 'DELETE', `/v1/profile_form/questions/${id}`);
      expect(second.status).toBe(404);
      expect(await codeOf(second)).toBe('NOT_FOUND');
    });
  }, 30_000);

  it('one answer makes the delete 409 has_answers (active or archived), zero lets it through, and SQL is refused by the foreign key', async () => {
    const admin = await person('admin_tenant');
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      const answered = await question({ title: `${TITLE}answered` });
      const answeredArchived = await question({
        title: `${TITLE}answered archived`,
        archived: true,
      });
      const empty = await question({ title: `${TITLE}empty` });
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: answered,
        userId: member.userId,
      });
      const other = await person();
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: answeredArchived,
        userId: other.userId,
      });
      const before = await answerRows();

      for (const id of [answered, answeredArchived]) {
        const res = await call(admin, 'DELETE', `/v1/profile_form/questions/${id}`);
        expect(res.status).toBe(409);
        expect(await detailOf(res)).toBe('has_answers');
        expect(await storedOf(id)).toBeDefined();
      }
      expect(await answerRows()).toBe(before);

      // The floor under the service: the RESTRICT foreign key refuses the same delete in SQL.
      await expect(
        adminSql`delete from public.profile_form_questions where id = ${answered}::uuid`,
      ).rejects.toMatchObject({ code: '23503' });

      expect((await call(admin, 'DELETE', `/v1/profile_form/questions/${empty}`)).status).toBe(200);
      expect(await answerRows()).toBe(before);
    });
  }, 60_000);

  it('another tenant’s question and an unknown id are the bare 404, and the other tenant keeps its question', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const foreign = await seedProfileFormQuestion({
        tenantId: demoTenantId,
        adminUserId,
        title: `${TITLE}demo`,
      });
      for (const id of [foreign, crypto.randomUUID()]) {
        const res = await call(admin, 'DELETE', `/v1/profile_form/questions/${id}`);
        expect(res.status).toBe(404);
        expect(await codeOf(res)).toBe('NOT_FOUND');
      }
      expect(await storedOf(foreign)).toBeDefined();
    });
  }, 30_000);
});

describe('12-09 replace: the new question and the archive of the old one in ONE transaction (PFORM-17)', () => {
  const choiceBody = (replaces: string, title: string) => ({
    replaces,
    type: 'single_choice',
    title,
    required: true,
    options: [{ label: 'Alfa' }, { label: 'Beta' }],
  });

  it('creates the new question at the old position, archives the old one and keeps its answers', async () => {
    const admin = await person('admin_tenant');
    const member = await person();
    await withProfileForm(labTenantId, async () => {
      await question({ position: 1, title: `${TITLE}first` });
      const old = await question({ position: 2, required: true, title: `${TITLE}old` });
      await question({ position: 3, title: `${TITLE}third` });
      await seedProfileFormAnswer({
        tenantId: labTenantId,
        questionId: old,
        userId: member.userId,
      });
      const before = await answerRows();
      expect(await pendingOf(member)).toBe(0);

      const res = await call(admin, 'POST', '/v1/profile_form/questions/replace', {
        replaces: old,
        type: 'short_text',
        title: `${TITLE}new`,
        required: true,
      });
      expect(res.status).toBe(201);
      const made = (await res.json()) as AdminQuestion;
      expect(made).toMatchObject({
        title: `${TITLE}new`,
        position: 2,
        revision: 1,
        answerCount: 0,
      });
      expect(made.id).not.toBe(old);

      const list = await activeList(admin);
      expect(list.questions.map((q) => q.position)).toEqual([1, 2, 3]);
      expect(list.questions[1]?.id).toBe(made.id);
      expect(list.questions.map((q) => q.id)).not.toContain(old);
      const kept = await archivedList(admin);
      expect(kept.map((q) => [q.id, q.answerCount])).toEqual([[old, 1]]);
      expect(await answerRows()).toBe(before);
      // The new required question holds the member who had answered the old one.
      expect(await pendingOf(member)).toBe(1);
    });
  }, 60_000);

  it('a failing second half rolls the first back: the old question stays active and nothing is created', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const old = await question({ position: 1, title: `${TITLE}fail old` });
      // Fault injection: archiving a question whose title starts with "pfl fail" raises inside the transaction,
      // AFTER the new question was inserted.
      await adminSql.unsafe(`
        create or replace function public.pfl_fail_archive() returns trigger language plpgsql as $$
        begin
          if new.archived_at is not null and old.archived_at is null and new.title like 'pfl fail%' then
            raise exception 'pfl injected failure';
          end if;
          return new;
        end $$`);
      await adminSql.unsafe(`
        create trigger pfl_fail_archive before update on public.profile_form_questions
        for each row execute function public.pfl_fail_archive()`);
      try {
        const res = await call(
          admin,
          'POST',
          '/v1/profile_form/questions/replace',
          choiceBody(old, `${TITLE}fail new`),
        );
        expect(res.status).toBe(500);
      } finally {
        await adminSql.unsafe(
          'drop trigger if exists pfl_fail_archive on public.profile_form_questions',
        );
        await adminSql.unsafe('drop function if exists public.pfl_fail_archive()');
      }
      expect((await storedOf(old))?.archived_at).toBeNull();
      expect((await storedOf(old))?.revision).toBe(1);
      const [made] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.profile_form_questions where title = ${`${TITLE}fail new`}`;
      expect(made?.n).toBe(0);
      expect((await activeList(admin)).questions.map((q) => q.id)).toEqual([old]);
    });
  }, 30_000);

  it('replace at 30 active questions succeeds because the count does not grow', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const ids: string[] = [];
      for (let i = 0; i < 30; i++) ids.push(await question({ position: i + 1 }));
      const target = ids[9];
      if (!target) throw new Error('no question to replace');
      const res = await call(
        admin,
        'POST',
        '/v1/profile_form/questions/replace',
        choiceBody(target, `${TITLE}swap`),
      );
      expect(res.status).toBe(201);
      const list = await activeList(admin);
      expect(list.activeCount).toBe(30);
      expect(list.questions.find((q) => q.title === `${TITLE}swap`)?.position).toBe(10);
      // A plain create still hits the limit.
      const create = await call(admin, 'POST', '/v1/profile_form/questions', {
        type: 'short_text',
        title: `${TITLE}extra`,
      });
      expect(create.status).toBe(409);
    });
  }, 90_000);

  it('an archived, unknown or foreign question cannot be replaced and nothing is created', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const archivedId = await question({ archived: true, title: `${TITLE}archived` });
      const foreign = await seedProfileFormQuestion({
        tenantId: demoTenantId,
        adminUserId,
        title: `${TITLE}demo`,
      });
      const refused = await call(
        admin,
        'POST',
        '/v1/profile_form/questions/replace',
        choiceBody(archivedId, `${TITLE}never 1`),
      );
      expect(refused.status).toBe(409);
      expect(await detailOf(refused)).toBe('already_archived');
      for (const id of [foreign, crypto.randomUUID()]) {
        const res = await call(
          admin,
          'POST',
          '/v1/profile_form/questions/replace',
          choiceBody(id, `${TITLE}never 2`),
        );
        expect(res.status).toBe(404);
      }
      const [made] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.profile_form_questions where title like ${`${TITLE}never%`}`;
      expect(made?.n).toBe(0);
      expect((await storedOf(foreign))?.archived_at).toBeNull();
    });
  }, 30_000);
});

type Summary = { total: number; complete: number; hasRequired: boolean };

const summaryOf = async (admin: Person): Promise<Summary> => {
  const res = await call(admin, 'GET', '/v1/profile_form/summary');
  expect(res.status).toBe(200);
  const body = (await res.json()) as Summary;
  for (const key of keysOf(body)) expect(ANSWER_KEYS).not.toContain(key);
  return body;
};
const impactOf = async (admin: Person, query: string): Promise<number> => {
  const res = await call(admin, 'GET', `/v1/profile_form/impact?${query}`);
  expect(res.status, query).toBe(200);
  const body = (await res.json()) as { members: number };
  expect(Object.keys(body)).toEqual(['members']);
  return body.members;
};

describe('12-09 the summary and the impact: counts only, staff excluded (PFORM-23, D-584, D-585)', () => {
  it('the summary counts only active member memberships: staff, a blocked and an invited member are not in any number', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const base = await summaryOf(admin);
      // No required question: every member is complete, hasRequired is false.
      expect(base).toEqual({ total: base.total, complete: base.total, hasRequired: false });

      await person('support_tenant');
      await person('member', 'lab', 'blocked');
      await person('member', 'lab', 'invited');
      expect(await summaryOf(admin)).toEqual(base);

      const member = await person();
      const after = await summaryOf(admin);
      expect(after.total).toBe(base.total + 1);
      expect(after.complete).toBe(after.total);

      const id = await question({ required: true });
      expect(await summaryOf(admin)).toEqual({
        total: after.total,
        complete: 0,
        hasRequired: true,
      });
      await seedProfileFormAnswer({ tenantId: labTenantId, questionId: id, userId: member.userId });
      expect(await summaryOf(admin)).toEqual({
        total: after.total,
        complete: 1,
        hasRequired: true,
      });

      // An optional question moves nothing; a second required one makes the member incomplete again.
      await question({ required: false });
      expect((await summaryOf(admin)).complete).toBe(1);
      await question({ required: true });
      expect((await summaryOf(admin)).complete).toBe(0);
    });
  }, 90_000);

  it('the summary and the impact are not readable by a member or a support user, and another tenant’s counts never mix in', async () => {
    const admin = await person('admin_tenant');
    const member = await person();
    const support = await person('support_tenant');
    await withProfileForm(labTenantId, async () => {
      for (const who of [member, support]) {
        expect((await call(who, 'GET', '/v1/profile_form/summary')).status).toBe(403);
        expect(
          (await call(who, 'GET', '/v1/profile_form/impact?change=create_required')).status,
        ).toBe(403);
        expect((await call(who, 'GET', '/v1/profile_form/archived')).status).toBe(403);
      }
      // A required question of ANOTHER tenant changes no number of this one.
      const before = await summaryOf(admin);
      await seedProfileFormQuestion({
        tenantId: demoTenantId,
        adminUserId,
        title: `${TITLE}demo required`,
        required: true,
      });
      expect(await summaryOf(admin)).toEqual(before);
    });
  }, 60_000);

  it('the impact of each change matches a hand count, 0 where nobody would be asked, and carries no answer', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const total = (await summaryOf(admin)).total;
      const answering = [await person(), await person()];
      await person();
      await person('member', 'lab', 'blocked');
      const members = total + 3;

      expect(await impactOf(admin, 'change=create_required')).toBe(members);
      expect(await impactOf(admin, 'change=replace')).toBe(members);

      // make_required: an optional question two members answered.
      const optional = await question({ required: false });
      for (const m of answering) {
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: optional,
          userId: m.userId,
        });
      }
      expect(await impactOf(admin, `change=make_required&questionId=${optional}`)).toBe(
        members - 2,
      );

      // An optional question everyone answered gives 0.
      const everyone = await question({ required: false });
      await adminSql`
        insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
        select m.tenant_id, ${everyone}::uuid, m.id, m.user_id, '"x"'::jsonb
          from public.memberships m
         where m.tenant_id = ${labTenantId}::uuid and m.role = 'member' and m.deleted_at is null`;
      expect(await impactOf(admin, `change=make_required&questionId=${everyone}`)).toBe(0);

      // reactivate: a required archived question answered by two members, an optional one, an active one.
      const archivedRequired = await question({ required: true, archived: true });
      for (const m of answering) {
        await seedProfileFormAnswer({
          tenantId: labTenantId,
          questionId: archivedRequired,
          userId: m.userId,
        });
      }
      const archivedOptional = await question({ required: false, archived: true });
      const active = await question({ required: true });
      expect(await impactOf(admin, `change=reactivate&questionId=${archivedRequired}`)).toBe(
        members - 2,
      );
      expect(await impactOf(admin, `change=reactivate&questionId=${archivedOptional}`)).toBe(0);
      expect(await impactOf(admin, `change=reactivate&questionId=${active}`)).toBe(0);
      // make_required of a question that is already required asks nobody new.
      expect(await impactOf(admin, `change=make_required&questionId=${active}`)).toBe(0);
    });
  }, 90_000);

  it('the impact refuses a missing or unknown question and a change it does not know', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const foreign = await seedProfileFormQuestion({
        tenantId: demoTenantId,
        adminUserId,
        title: `${TITLE}demo`,
        required: false,
      });
      for (const query of ['change=make_required', 'change=reactivate']) {
        const res = await call(admin, 'GET', `/v1/profile_form/impact?${query}`);
        expect(res.status, query).toBe(400);
      }
      for (const query of [
        `change=make_required&questionId=${crypto.randomUUID()}`,
        `change=reactivate&questionId=${foreign}`,
      ]) {
        const res = await call(admin, 'GET', `/v1/profile_form/impact?${query}`);
        expect(res.status, query).toBe(404);
        expect(await codeOf(res)).toBe('NOT_FOUND');
      }
      const unknown = await call(admin, 'GET', '/v1/profile_form/impact?change=delete_all');
      expect(unknown.status).toBe(400);
    });
  }, 30_000);

  it('with the module off every lifecycle route is 404 MODULE_DISABLED', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(
      labTenantId,
      async () => {
        const id = crypto.randomUUID();
        const routes: [string, string, unknown?][] = [
          ['GET', '/v1/profile_form/archived'],
          ['POST', `/v1/profile_form/questions/${id}/archive`],
          ['POST', `/v1/profile_form/questions/${id}/reactivate`],
          ['DELETE', `/v1/profile_form/questions/${id}`],
          [
            'POST',
            '/v1/profile_form/questions/replace',
            { replaces: id, type: 'short_text', title: `${TITLE}x` },
          ],
          ['GET', '/v1/profile_form/summary'],
          ['GET', '/v1/profile_form/impact?change=create_required'],
        ];
        for (const [method, path, body] of routes) {
          const res = await call(admin, method as 'GET', path, body);
          expect(res.status, `${method} ${path}`).toBe(404);
          expect(await codeOf(res), `${method} ${path}`).toBe('MODULE_DISABLED');
        }
      },
      { enabled: false },
    );
  }, 30_000);
});

// ── 12.1-09 Task 3: the lifecycle on the global layout (D-627) ───────────────────────────────────

type LayoutRow = { id: string; step_id: string; position: number; revision: number };

/** The tenant's ACTIVE questions straight from the database, in the canonical order. */
const activeRows = () =>
  adminSql<LayoutRow[]>`
    select id::text as id, step_id::text as step_id, position, revision
      from public.profile_form_questions
     where tenant_id = ${labTenantId}::uuid and archived_at is null
     order by position, created_at, id`;

describe('12.1-09 D-627: reactivate, archive and delete keep the layout contiguous', () => {
  it('on a two-step tenant a reactivated question lands at the end of its own step and positions are contiguous 1..n', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const s1 = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S1` });
      const s2 = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S2` });
      const a = await question({ stepId: s1, position: 1, title: `${TITLE}A` });
      const back = await question({
        stepId: s1,
        position: 0,
        archived: true,
        title: `${TITLE}Back`,
      });
      const c = await question({ stepId: s2, position: 2, title: `${TITLE}C` });
      const other = await question({
        stepId: s2,
        position: 0,
        archived: true,
        title: `${TITLE}Other`,
      });

      const res = await reactivate(admin, back);
      expect(res.status).toBe(200);
      const made = (await res.json()) as AdminQuestion & { stepId: string };
      // Its own step is the FIRST one, so it sits after A in step 1 and before C in step 2.
      expect(made.stepId).toBe(s1);
      const rows = await activeRows();
      expect(rows.map((row) => row.id)).toEqual([a, back, c]);
      expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
      expect(rows.map((row) => row.step_id)).toEqual([s1, s1, s2]);
      // Reactivation bumped the revision once (1 -> 2); the shifted question kept its own.
      expect(rows.find((row) => row.id === back)?.revision).toBe(2);
      expect(rows.find((row) => row.id === c)?.revision).toBe(1);

      // The second one belongs to the second step and lands at ITS end.
      expect((await reactivate(admin, other)).status).toBe(200);
      const after = await activeRows();
      expect(after.map((row) => row.id)).toEqual([a, back, c, other]);
      expect(after.map((row) => row.position)).toEqual([1, 2, 3, 4]);
      expect(after.map((row) => row.step_id)).toEqual([s1, s1, s2, s2]);
    });
  }, 30_000);

  it('archive and delete keep the remaining positions contiguous 1..n across steps', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const s1 = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S1` });
      const s2 = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S2` });
      const a = await question({ stepId: s1, position: 1, title: `${TITLE}A` });
      const b = await question({ stepId: s1, position: 2, title: `${TITLE}B` });
      const c = await question({ stepId: s2, position: 3, title: `${TITLE}C` });
      const d = await question({ stepId: s2, position: 4, title: `${TITLE}D` });

      expect((await archive(admin, b)).status).toBe(200);
      const afterArchive = await activeRows();
      expect(afterArchive.map((row) => row.id)).toEqual([a, c, d]);
      expect(afterArchive.map((row) => row.position)).toEqual([1, 2, 3]);

      const gone = await call(admin, 'DELETE', `/v1/profile_form/questions/${c}`);
      expect(gone.status).toBe(200);
      const afterDelete = await activeRows();
      expect(afterDelete.map((row) => row.id)).toEqual([a, d]);
      expect(afterDelete.map((row) => row.position)).toEqual([1, 2]);
      expect(afterDelete.map((row) => row.step_id)).toEqual([s1, s2]);

      // Deleting an ARCHIVED question changes no active position.
      expect((await call(admin, 'DELETE', `/v1/profile_form/questions/${b}`)).status).toBe(200);
      expect((await activeRows()).map((row) => row.position)).toEqual([1, 2]);
    });
  }, 30_000);
});
