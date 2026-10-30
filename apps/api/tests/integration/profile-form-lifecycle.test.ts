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
      expect(Object.keys((await res.json()) as object)).toEqual(['questions']);
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
