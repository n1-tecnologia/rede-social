import { summaryStatement } from '@rede-social/core/server/profile-form/admin';
import { PgDialect } from 'drizzle-orm/pg-core';
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
  signInAs,
  withProfileForm,
} from './setup';

/**
 * 12.2-11 (PFORM-49, PFORM-52; D-644, D-645, D-653; T-12.2-10, T-12.2-01) against the live local stack: the
 * admin's COUNTS through the branch chain. The summary (`GET /v1/profile_form/summary`) and every kind of the
 * impact (`GET /v1/profile_form/impact`) count only the members who SEE a question through its whole chain,
 * composed from the one shared SQL fragment, and each number is proved against the GATE
 * (`app.profile_form_missing`, read through `adminSql`) rather than against a literal.
 *
 * EVERY identity is a THROWAWAY (`createSharedIdentity`, prefix `pfi`); questions carry the title prefix `pfi `
 * so the sweep removes only this file's rows, and the branches that hang on or hold them. The module row is
 * restored by `withProfileForm`. The clinic fixture used here is the depth-3 tree of the contracts
 * (`PROFILE_FORM_CHAIN_FIXTURE`), seeded with generated ids: Q1 (single choice) opens B1 on "Tem"; B1 holds Q2
 * (yes/no, optional) and Q3 (required); B2 hangs on Q2 = true and holds Q4 (required) and Q5 (yes/no); B3 hangs
 * on Q5 = true and holds Q6 (required).
 */

type Envelope = { error: { code: string; details?: Record<string, unknown> } };

const PREFIX = 'pfi';
const TITLE = 'pfi ';
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

type Summary = { total: number; complete: number; hasRequired: boolean };

const summaryOf = async (admin: Person): Promise<Summary> => {
  const res = await call(admin, 'GET', '/v1/profile_form/summary');
  expect(res.status).toBe(200);
  const body = (await res.json()) as Summary;
  expect(Object.keys(body).sort()).toEqual(['complete', 'hasRequired', 'total']);
  return body;
};

/** The members the gate releases (missing = 0), through the admin SQL connection that may call the function. */
const gateReleased = async (tenantId: string): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select count(*)::int as n
      from public.memberships m
     where m.tenant_id = ${tenantId}::uuid and m.role = 'member' and m.status = 'active'
       and m.blocked_at is null and m.deleted_at is null
       and app.profile_form_missing(m.tenant_id, m.id) = 0`;
  return row?.n ?? 0;
};

/** What the gate says one member still owes. */
const gateMissing = async (member: Person): Promise<number> => {
  const [row] = await adminSql<{ n: number }[]>`
    select app.profile_form_missing(m.tenant_id, m.id)::int as n
      from public.memberships m
     where m.tenant_id = ${labTenantId}::uuid and m.user_id = ${member.userId}::uuid
       and m.deleted_at is null`;
  return row?.n ?? -1;
};

const optionIds = () => [crypto.randomUUID(), crypto.randomUUID()] as const;

type Clinic = {
  q1: string;
  q2: string;
  q3: string;
  q4: string;
  q5: string;
  q6: string;
  b1: string;
  b2: string;
  b3: string;
  tem: string;
  nao: string;
};

/** The depth-3 clinic tree on the lab tenant, positions in tree order (Q1, Q2, Q4, Q5, Q6, Q3). */
async function seedClinic(): Promise<Clinic> {
  const [tem, nao] = optionIds();
  const base = { tenantId: labTenantId, adminUserId };
  const q1 = await seedProfileFormQuestion({
    ...base,
    type: 'single_choice',
    title: `${TITLE}Q1 opener`,
    position: 1,
    options: [
      { id: tem, label: 'Tem' },
      { id: nao, label: 'Não' },
    ],
  });
  const b1 = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: q1,
    values: [tem],
    name: 'pfi-secret-branch-one',
  });
  const q2 = await seedProfileFormQuestion({
    ...base,
    type: 'yes_no',
    title: `${TITLE}Q2 in B1`,
    position: 2,
    branchId: b1,
  });
  const b2 = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: q2,
    values: ['true'],
    name: 'pfi-secret-branch-two',
  });
  const q4 = await seedProfileFormQuestion({
    ...base,
    type: 'short_text',
    title: `${TITLE}Q4 in B2`,
    required: true,
    position: 3,
    branchId: b2,
  });
  const q5 = await seedProfileFormQuestion({
    ...base,
    type: 'yes_no',
    title: `${TITLE}Q5 in B2`,
    position: 4,
    branchId: b2,
  });
  const b3 = await seedProfileFormBranch({
    tenantId: labTenantId,
    openerQuestionId: q5,
    values: ['true'],
    name: 'pfi-secret-branch-three',
  });
  const q6 = await seedProfileFormQuestion({
    ...base,
    type: 'short_text',
    title: `${TITLE}Q6 in B3`,
    required: true,
    position: 5,
    branchId: b3,
  });
  const q3 = await seedProfileFormQuestion({
    ...base,
    type: 'short_text',
    title: `${TITLE}Q3 in B1`,
    required: true,
    position: 6,
    branchId: b1,
  });
  return { q1, q2, q3, q4, q5, q6, b1, b2, b3, tem, nao };
}

const answer = (member: Person, questionId: string, value?: unknown) =>
  seedProfileFormAnswer({ tenantId: labTenantId, questionId, userId: member.userId, value });

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

// Each case builds its own form: nothing a case seeded may count against the next one.
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

// ── Task 1 (tracer): the summary through a depth-3 chain equals the gate ──────────────────────────

describe('12.2-11 tracer: the summary through a depth-3 chain equals the gate (D-644, PFORM-52)', () => {
  it('complete equals the members the gate releases, with members answered at depth 0, 1, 2, 3 and one with a stale deeper answer', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const others = (await summaryOf(admin)).total;
      const m0 = await person(); // nothing answered
      const m1 = await person(); // Q1 = Tem
      const m2 = await person(); // Q1 = Tem, Q2 = true
      const m3 = await person(); // Q1 = Tem, Q2 = true, Q5 = true
      const stale = await person(); // Q1 changed to Não, the deeper answers kept
      const c = await seedClinic();

      await answer(m1, c.q1, { optionId: c.tem });
      await answer(m2, c.q1, { optionId: c.tem });
      await answer(m2, c.q2, true);
      await answer(m3, c.q1, { optionId: c.tem });
      await answer(m3, c.q2, true);
      await answer(m3, c.q5, true);
      await answer(stale, c.q1, { optionId: c.nao });
      await answer(stale, c.q2, true);
      await answer(stale, c.q5, true);

      const parity = async (): Promise<Summary> => {
        const summary = await summaryOf(admin);
        expect(summary.total).toBe(others + 5);
        expect(summary.complete).toBe(await gateReleased(labTenantId));
        expect(summary.complete).toBeLessThanOrEqual(summary.total);
        expect(summary.hasRequired).toBe(true);
        return summary;
      };

      // m0 and the stale member see no required question (the chain above it is closed): the gate releases
      // them; m1, m2 and m3 owe the visible ones of their depth.
      const start = await parity();
      expect(await gateMissing(m0)).toBe(0);
      expect(await gateMissing(stale)).toBe(0);
      expect(await gateMissing(m1)).toBe(1); // Q3
      expect(await gateMissing(m2)).toBe(2); // Q3, Q4
      expect(await gateMissing(m3)).toBe(3); // Q3, Q4, Q6
      expect(start.complete).toBe(others + 2);

      // Each member answers what the chain shows, and complete moves by exactly one at a time.
      await answer(m1, c.q3);
      expect((await parity()).complete).toBe(others + 3);
      await answer(m2, c.q3);
      await answer(m2, c.q4);
      expect((await parity()).complete).toBe(others + 4);
      await answer(m3, c.q3);
      await answer(m3, c.q4);
      expect((await parity()).complete).toBe(others + 4);
      await answer(m3, c.q6);
      const done = await parity();
      expect(done.complete).toBe(others + 5);
      expect(done.complete).toBe(done.total);
      expect(await gateMissing(m3)).toBe(0);
    });
  }, 180_000);
});

describe('12.2-11 the summary: the cases of 12.1 over the chain, and the raw text holds no value (PFORM-38, T-12.2-10)', () => {
  it('no required question means everyone is complete; a required question nobody sees owes nothing; hasRequired follows the active required set', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const empty = await summaryOf(admin);
      expect(empty.hasRequired).toBe(false);
      expect(empty.complete).toBe(empty.total);
      expect(empty.complete).toBe(await gateReleased(labTenantId));

      const m1 = await person();
      const c = await seedClinic();
      // Nobody answered Q1: every required question is behind a closed branch.
      const hidden = await summaryOf(admin);
      expect(hidden.hasRequired).toBe(true);
      expect(hidden.complete).toBe(hidden.total);
      expect(hidden.complete).toBe(await gateReleased(labTenantId));

      await answer(m1, c.q1, { optionId: c.tem });
      const revealed = await summaryOf(admin);
      expect(revealed.complete).toBe(hidden.total - 1);
      expect(revealed.complete).toBe(await gateReleased(labTenantId));
      expect(Number.isInteger(revealed.complete)).toBe(true);
    });
  }, 120_000);

  it('a required question of a branch archived, or its branch undone, moves the summary exactly as the gate does', async () => {
    const admin = await person('admin_tenant');
    const m1 = await person();
    await withProfileForm(labTenantId, async () => {
      const c = await seedClinic();
      await answer(m1, c.q1, { optionId: c.tem });
      const before = await summaryOf(admin);
      expect(before.complete).toBe(before.total - 1); // m1 owes Q3
      expect(before.complete).toBe(await gateReleased(labTenantId));

      // Undoing B1 makes Q3 unconditional: everybody who has not answered it owes it.
      const undone = await call(admin, 'POST', `/v1/profile_form/branches/${c.b1}/undo`);
      expect(undone.status).toBe(200);
      const widened = await summaryOf(admin);
      expect(widened.complete).toBe(await gateReleased(labTenantId));
      expect(widened.complete).toBe(0);

      // Archiving the (now unconditional) Q3, Q4 and Q6 releases everyone again.
      for (const id of [c.q3, c.q4, c.q6]) {
        const res = await call(admin, 'POST', `/v1/profile_form/questions/${id}/archive`);
        expect(res.status).toBe(200);
      }
      const released = await summaryOf(admin);
      expect(released.hasRequired).toBe(false);
      expect(released.complete).toBe(released.total);
      expect(released.complete).toBe(await gateReleased(labTenantId));
    });
  }, 120_000);

  it('the executed text carries the chain as raw SQL but never the tenant: the tenant is a bound parameter', () => {
    const query = new PgDialect().sqlToQuery(summaryStatement(labTenantId));
    expect(query.sql).not.toContain(labTenantId);
    expect(query.sql).toMatch(/\$1/);
    expect(query.params).toContain(labTenantId);
    expect(query.sql).toContain('app.profile_form_answer_tokens');
    // One statement, no answer value selected: the select list holds counts and a boolean only.
    expect(query.sql).not.toMatch(/\ba\.value\b/);
  });
});

// ── Task 2: the impact of creating, replacing, requiring, reactivating and leaving a branch ─────────

const impactRes = (admin: Person, params: Record<string, string>) =>
  call(admin, 'GET', `/v1/profile_form/impact?${new URLSearchParams(params).toString()}`);

const impactOf = async (admin: Person, params: Record<string, string>): Promise<number> => {
  const res = await impactRes(admin, params);
  const text = await res.clone().text();
  expect(res.status, `${JSON.stringify(params)} ${text}`).toBe(200);
  const body = (await res.json()) as { members: number };
  expect(Object.keys(body)).toEqual(['members']); // T-12.2-10: one integer, nothing else
  expect(Number.isInteger(body.members)).toBe(true);
  return body.members;
};

/** The error envelope minus the per-request id, so two refusals can be compared for sameness. */
const withoutRequestId = (body: unknown) => {
  const { error } = body as Envelope;
  const { requestId: _requestId, ...rest } = error as Envelope['error'] & { requestId?: string };
  return { error: rest };
};

/** Every row the impact could touch, as one string: an impact call must leave it unchanged. */
const snapshot = async (): Promise<string> => {
  const questions = await adminSql`
    select id::text as id, revision, archived_at, position, branch_id::text as branch_id,
           step_id::text as step_id, updated_at
      from public.profile_form_questions where tenant_id = ${labTenantId}::uuid order by id`;
  const branches = await adminSql`
    select id::text as id, revision, archived_at, open_values, updated_at
      from public.profile_form_branches where tenant_id = ${labTenantId}::uuid order by id`;
  const answers = await adminSql`
    select coalesce(string_agg(id::text, ',' order by id), '') as ids, count(*)::int as n
      from public.profile_form_answers where tenant_id = ${labTenantId}::uuid`;
  return JSON.stringify({ questions, branches, answers });
};

describe('12.2-11 D-644, D-653: the impact counts only the members who SEE the question through its whole chain (PFORM-52)', () => {
  it('create_required and replace: every member without a branch, the members for whom the chain is open with one (depth 1..3)', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const m0 = await person();
      const m1 = await person();
      const m2 = await person();
      const m3 = await person();
      const stale = await person();
      void m0;
      const c = await seedClinic();
      await answer(m1, c.q1, { optionId: c.tem });
      await answer(m2, c.q1, { optionId: c.tem });
      await answer(m2, c.q2, true);
      await answer(m3, c.q1, { optionId: c.tem });
      await answer(m3, c.q2, true);
      await answer(m3, c.q5, true);
      await answer(stale, c.q1, { optionId: c.nao });
      await answer(stale, c.q2, true);
      await answer(stale, c.q5, true);
      const total = (await summaryOf(admin)).total;
      const before = await snapshot();

      // No branch: every member, unchanged from Phase 12.
      expect(await impactOf(admin, { change: 'create_required' })).toBe(total);
      expect(await impactOf(admin, { change: 'replace' })).toBe(total);
      // One level, two levels, three levels: the whole chain must be open, so the stale member is in none.
      expect(await impactOf(admin, { change: 'create_required', branchId: c.b1 })).toBe(3);
      expect(await impactOf(admin, { change: 'create_required', branchId: c.b2 })).toBe(2);
      expect(await impactOf(admin, { change: 'create_required', branchId: c.b3 })).toBe(1);
      expect(await impactOf(admin, { change: 'replace', branchId: c.b3 })).toBe(1);
      expect(await impactOf(admin, { change: 'replace', branchId: c.b1 })).toBe(3);
      expect(await snapshot()).toBe(before);
    });
  }, 180_000);

  it('PFORM-38 counts 0, 1, 2 and 3 for a three-member fixture, over single-level branches', async () => {
    const admin = await person('admin_tenant');
    const m1 = await person();
    const m2 = await person();
    const m3 = await person();
    await withProfileForm(labTenantId, async () => {
      const [a, b, cc] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] as const;
      const opener = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        type: 'single_choice',
        title: `${TITLE}opener`,
        position: 1,
        options: [
          { id: a, label: 'A' },
          { id: b, label: 'B' },
          { id: cc, label: 'C' },
        ],
      });
      const branch = (values: string[]) =>
        seedProfileFormBranch({ tenantId: labTenantId, openerQuestionId: opener, values });
      const ba = await branch([a]);
      const bab = await branch([a, b]);
      const bb = await branch([b]);
      const babc = await branch([a, b, cc]);
      const bc = await branch([cc]);
      const total = (await summaryOf(admin)).total;
      const ask = (branchId: string) => impactOf(admin, { change: 'create_required', branchId });

      // Edge 0: nobody has answered the opener, so nobody would see the question.
      expect(await ask(ba)).toBe(0);
      expect(await impactOf(admin, { change: 'create_required' })).toBe(total);
      await answer(m1, opener, { optionId: a });
      await answer(m2, opener, { optionId: b });
      // m3 has not answered. Edge 1: exactly one member sees a question opened by A.
      expect(await ask(ba)).toBe(1);
      expect(await ask(bab)).toBe(2);
      expect(await impactOf(admin, { change: 'replace', branchId: bb })).toBe(1);
      await answer(m3, opener, { optionId: cc });
      expect(await ask(babc)).toBe(3);
      expect(await ask(bc)).toBe(1);
    });
  }, 120_000);

  it('a branch that opens for everyone counts every member exactly (the all-members edge)', async () => {
    const admin = await person('admin_tenant');
    await person();
    await person();
    await withProfileForm(labTenantId, async () => {
      const opener = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        type: 'yes_no',
        title: `${TITLE}everyone opener`,
        position: 1,
      });
      const branch = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: opener,
        values: ['true', 'false'],
      });
      expect(await impactOf(admin, { change: 'create_required', branchId: branch })).toBe(0);
      await adminSql`
        insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
        select m.tenant_id, ${opener}::uuid, m.id, m.user_id, 'true'::jsonb
          from public.memberships m
         where m.tenant_id = ${labTenantId}::uuid and m.role = 'member' and m.status = 'active'
           and m.blocked_at is null and m.deleted_at is null`;
      const total = (await summaryOf(admin)).total;
      expect(await impactOf(admin, { change: 'create_required', branchId: branch })).toBe(total);
      expect(await impactOf(admin, { change: 'create_required' })).toBe(total);
    });
  }, 120_000);

  it('make_required and reactivate count the members lacking an answer who see the question through its chain', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const m1 = await person();
      const m2 = await person();
      const m3 = await person();
      const stale = await person();
      const c = await seedClinic();
      await answer(m1, c.q1, { optionId: c.tem });
      await answer(m2, c.q1, { optionId: c.tem });
      await answer(m2, c.q2, true);
      await answer(m3, c.q1, { optionId: c.tem });
      await answer(m3, c.q2, true);
      await answer(m3, c.q5, true);
      await answer(stale, c.q1, { optionId: c.nao });
      await answer(stale, c.q2, true);
      await answer(stale, c.q5, true);
      const before = await snapshot();

      // Q2 (optional, in B1): the members of B1 who lack it are m1 only (m2, m3 answered it; stale is out).
      expect(await impactOf(admin, { change: 'make_required', questionId: c.q2 })).toBe(1);
      // Q5 (optional, in B2): the members of B2 are m2 and m3; m3 holds the answer, so m2 only. The stale
      // member holds the answer to nothing new and sees nothing: not counted.
      expect(await impactOf(admin, { change: 'make_required', questionId: c.q5 })).toBe(1);
      // Q1 (optional, no branch): every member lacking it: the total minus the five that answered.
      const total = (await summaryOf(admin)).total;
      expect(await impactOf(admin, { change: 'make_required', questionId: c.q1 })).toBe(total - 4);
      // Q3 is already required: nobody new is asked.
      expect(await impactOf(admin, { change: 'make_required', questionId: c.q3 })).toBe(0);
      expect(await snapshot()).toBe(before);

      // reactivate: Q4 (required, in B2) archived: m2 and m3 see B2 and lack it.
      await adminSql`update public.profile_form_questions set archived_at = now() where id = ${c.q4}::uuid`;
      const archivedOptional = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}archived optional`,
        archived: true,
        branchId: c.b2,
      });
      const archivedBefore = await snapshot();
      expect(await impactOf(admin, { change: 'reactivate', questionId: c.q4 })).toBe(2);
      await answer(m2, c.q4);
      expect(await impactOf(admin, { change: 'reactivate', questionId: c.q4 })).toBe(1);
      expect(await impactOf(admin, { change: 'reactivate', questionId: archivedOptional })).toBe(0);
      // An ACTIVE question has nothing to reactivate.
      expect(await impactOf(admin, { change: 'reactivate', questionId: c.q3 })).toBe(0);
      expect(await snapshot()).not.toBe(archivedBefore); // the answer above is the only difference
      const after = await snapshot();
      await impactOf(admin, { change: 'reactivate', questionId: c.q4 });
      expect(await snapshot()).toBe(after);
    });
  }, 180_000);

  it('remove_condition counts the members who do not see the question today and lack an answer; 0 where nobody is asked', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const m1 = await person();
      const m2 = await person();
      const m3 = await person();
      const stale = await person();
      const c = await seedClinic();
      await answer(m1, c.q1, { optionId: c.tem });
      await answer(m2, c.q1, { optionId: c.tem });
      await answer(m2, c.q2, true);
      await answer(m3, c.q1, { optionId: c.tem });
      await answer(m3, c.q2, true);
      await answer(m3, c.q5, true);
      await answer(stale, c.q1, { optionId: c.nao });
      await answer(stale, c.q2, true);
      await answer(stale, c.q5, true);
      const total = (await summaryOf(admin)).total;
      const before = await snapshot();
      const leaving = (questionId: string) =>
        impactOf(admin, { change: 'remove_condition', questionId });

      // Q3 (required, B1) is seen by m1, m2, m3; everyone else lacks it and does not see it.
      expect(await leaving(c.q3)).toBe(total - 3);
      // Q4 (required, B2): seen by m2 and m3. Q6 (required, B3): seen by m3.
      expect(await leaving(c.q4)).toBe(total - 2);
      expect(await leaving(c.q6)).toBe(total - 1);
      // Optional, unbranched: asks nobody.
      expect(await leaving(c.q2)).toBe(0);
      expect(await leaving(c.q1)).toBe(0);
      expect(await snapshot()).toBe(before);

      // The member who does not see Q3 and answers it anyway (stale data) no longer newly owes it.
      await answer(stale, c.q3);
      expect(await leaving(c.q3)).toBe(total - 4);
      // A member who SEES it and answers changes nothing (they were never counted).
      await answer(m1, c.q3);
      expect(await leaving(c.q3)).toBe(total - 4);
      // An archived question asks nobody.
      await adminSql`update public.profile_form_questions set archived_at = now() where id = ${c.q6}::uuid`;
      expect(await leaving(c.q6)).toBe(0);
    });
  }, 180_000);

  it('a legacy condition parameter is 400 invalid, a foreign branch is the same bare 404 as an unknown one, an archived one too', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const c = await seedClinic();
      const foreignOpener = await seedProfileFormQuestion({
        tenantId: demoTenantId,
        adminUserId,
        type: 'yes_no',
        title: `${TITLE}demo opener`,
      });
      const foreignBranch = await seedProfileFormBranch({
        tenantId: demoTenantId,
        openerQuestionId: foreignOpener,
        values: ['true'],
      });
      const archivedBranch = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: c.q2,
        values: ['false'],
        archived: true,
      });

      // The retired per-question condition is refused, alone or together.
      const legacies: Record<string, string>[] = [
        { conditionQuestionId: c.q1 },
        { conditionValues: c.tem },
        { conditionQuestionId: c.q1, conditionValues: c.tem },
      ];
      for (const legacy of legacies) {
        for (const change of ['create_required', 'replace']) {
          const res = await impactRes(admin, { change, ...legacy });
          expect(res.status, JSON.stringify(legacy)).toBe(400);
        }
      }

      const unknown = await impactRes(admin, {
        change: 'create_required',
        branchId: crypto.randomUUID(),
      });
      const foreign = await impactRes(admin, {
        change: 'create_required',
        branchId: foreignBranch,
      });
      const archived = await impactRes(admin, {
        change: 'create_required',
        branchId: archivedBranch,
      });
      expect(unknown.status).toBe(404);
      expect(foreign.status).toBe(404);
      expect(archived.status).toBe(404);
      const unknownBody = (await unknown.json()) as Envelope;
      expect(unknownBody.error.code).toBe('NOT_FOUND');
      expect(unknownBody.error.details).toBeUndefined();
      expect(withoutRequestId(await foreign.json())).toEqual(withoutRequestId(unknownBody));
      expect(withoutRequestId(await archived.json())).toEqual(withoutRequestId(unknownBody));

      // Positive control: my own active branch is counted.
      expect(await impactOf(admin, { change: 'create_required', branchId: c.b1 })).toBe(0);
      // The kinds that need a question still need one.
      for (const change of ['make_required', 'reactivate', 'remove_condition']) {
        expect((await impactRes(admin, { change })).status).toBe(400);
      }
      const unknownQuestion = await impactRes(admin, {
        change: 'make_required',
        questionId: crypto.randomUUID(),
      });
      expect(unknownQuestion.status).toBe(404);
    });
  }, 120_000);
});

// ── Task 3: the impact of undoing a branch and of reactivating a block (D-653, PFORM-49) ─────────────

/** What the gate says for every active member of the lab tenant: membership id to missing count. */
const gateMap = async (): Promise<Map<string, number>> => {
  const rows = await adminSql<{ id: string; n: number }[]>`
    select m.id::text as id, app.profile_form_missing(m.tenant_id, m.id)::int as n
      from public.memberships m
     where m.tenant_id = ${labTenantId}::uuid and m.role = 'member' and m.status = 'active'
       and m.blocked_at is null and m.deleted_at is null`;
  return new Map(rows.map((row) => [row.id, row.n]));
};

/** How many members the gate holds MORE of in `after` than in `before` (a member who owes two counts once). */
const newlyHeld = (before: Map<string, number>, after: Map<string, number>): number =>
  [...after].filter(([id, n]) => n > (before.get(id) ?? 0)).length;

describe('12.2-11 D-653, PFORM-49: the impact of undoing a branch equals what the gate then holds', () => {
  it('counts the members, once each, who lack a required answer of the branch and do not see it; 0 for optional-only, empty and archived branches', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const see1 = await person();
      const see2 = await person();
      await person(); // does not see, lacks
      await person(); // does not see, lacks
      const answered = await person(); // does not see, but already holds the required answer
      const opener = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        type: 'yes_no',
        title: `${TITLE}undo opener`,
        position: 1,
      });
      const branch = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: opener,
        values: ['true'],
      });
      const required = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}undo required`,
        required: true,
        position: 2,
        branchId: branch,
      });
      await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}undo optional`,
        position: 3,
        branchId: branch,
      });
      // A required question archived on its own sits in the branch but asks nobody.
      await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}undo archived required`,
        required: true,
        archived: true,
        branchId: branch,
      });
      await answer(see1, opener, true);
      await answer(see2, opener, true);
      await answer(answered, required);

      const total = (await summaryOf(admin)).total;
      const before = await snapshot();
      const gateBefore = await gateMap();
      const impact = await impactOf(admin, { change: 'undo_branch', branchId: branch });
      // Everyone but the two who see the branch and the one who already answered.
      expect(impact).toBe(total - 3);
      expect(await snapshot()).toBe(before);

      // Applying the undo makes the gate hold exactly that many members more.
      const undone = await call(admin, 'POST', `/v1/profile_form/branches/${branch}/undo`);
      expect(undone.status).toBe(200);
      expect(newlyHeld(gateBefore, await gateMap())).toBe(impact);
    });
  }, 180_000);

  it('is 0 for a branch of only optional questions, an empty branch and an archived branch', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      await person();
      const opener = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        type: 'yes_no',
        title: `${TITLE}zero opener`,
        position: 1,
      });
      const optionalOnly = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: opener,
        values: ['true'],
      });
      await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}zero optional`,
        position: 2,
        branchId: optionalOnly,
      });
      const empty = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: opener,
        values: ['false'],
      });
      const archivedBranch = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: opener,
        values: ['true', 'false'],
        archived: true,
      });
      await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}zero archived-branch required`,
        required: true,
        archived: true,
        branchId: archivedBranch,
      });
      const before = await snapshot();
      for (const branchId of [optionalOnly, empty, archivedBranch]) {
        expect(await impactOf(admin, { change: 'undo_branch', branchId })).toBe(0);
      }
      expect(await snapshot()).toBe(before);
    });
  }, 120_000);

  it('on the depth-3 tree the impact of undoing B1 equals the members the gate newly holds', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const m1 = await person();
      const m2 = await person();
      const m3 = await person();
      const stale = await person();
      const c = await seedClinic();
      await answer(m1, c.q1, { optionId: c.tem });
      await answer(m2, c.q1, { optionId: c.tem });
      await answer(m2, c.q2, true);
      await answer(m3, c.q1, { optionId: c.tem });
      await answer(m3, c.q2, true);
      await answer(m3, c.q5, true);
      await answer(stale, c.q1, { optionId: c.nao });
      await answer(stale, c.q2, true);
      await answer(stale, c.q5, true);
      const total = (await summaryOf(admin)).total;

      const gateBefore = await gateMap();
      const impact = await impactOf(admin, { change: 'undo_branch', branchId: c.b1 });
      expect(impact).toBe(total - 3); // m1, m2 and m3 see B1; every other member lacks Q3
      const undone = await call(admin, 'POST', `/v1/profile_form/branches/${c.b1}/undo`);
      expect(undone.status).toBe(200);
      expect(newlyHeld(gateBefore, await gateMap())).toBe(impact);
    });
  }, 180_000);

  it('a foreign or unknown branch is the same bare 404, and a missing branchId is 400', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const foreignOpener = await seedProfileFormQuestion({
        tenantId: demoTenantId,
        adminUserId,
        type: 'yes_no',
        title: `${TITLE}demo undo opener`,
      });
      const foreignBranch = await seedProfileFormBranch({
        tenantId: demoTenantId,
        openerQuestionId: foreignOpener,
        values: ['true'],
      });
      for (const change of ['undo_branch', 'reactivate_branch']) {
        const unknown = await impactRes(admin, { change, branchId: crypto.randomUUID() });
        const foreign = await impactRes(admin, { change, branchId: foreignBranch });
        expect(unknown.status, change).toBe(404);
        expect(foreign.status, change).toBe(404);
        const unknownBody = (await unknown.json()) as Envelope;
        expect(unknownBody.error.code).toBe('NOT_FOUND');
        expect(unknownBody.error.details).toBeUndefined();
        expect(withoutRequestId(await foreign.json())).toEqual(withoutRequestId(unknownBody));
        expect((await impactRes(admin, { change })).status, change).toBe(400);
      }
    });
  }, 60_000);
});

describe('12.2-11 D-653, PFORM-49: the impact of reactivating a block equals what the gate then holds', () => {
  it('counts the members, once each, who would see and lack a required question of the block (nested branches, stored answers)', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const both = await person(); // O = true, Q = true: sees R1 and R2
      const onlyFirst = await person(); // O = true: sees R1 only
      const holder = await person(); // sees both and already holds both answers
      await person(); // sees nothing
      const opener = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        type: 'yes_no',
        title: `${TITLE}block opener`,
        position: 1,
      });
      const b1 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: opener,
        values: ['true'],
      });
      const r1 = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}block r1`,
        required: true,
        position: 2,
        branchId: b1,
      });
      const inner = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        type: 'yes_no',
        title: `${TITLE}block inner opener`,
        position: 3,
        branchId: b1,
      });
      const b2 = await seedProfileFormBranch({
        tenantId: labTenantId,
        openerQuestionId: inner,
        values: ['true'],
      });
      const r2 = await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}block r2`,
        required: true,
        position: 4,
        branchId: b2,
      });
      // A required question archived EARLIER, on its own: not part of the block, never counted.
      await seedProfileFormQuestion({
        tenantId: labTenantId,
        adminUserId,
        title: `${TITLE}block earlier`,
        required: true,
        archivedAt: new Date(Date.now() - 86_400_000),
        branchId: b1,
      });
      for (const member of [both, onlyFirst, holder]) await answer(member, opener, true);
      await answer(both, inner, true);
      await answer(holder, inner, true);
      await answer(holder, r1);
      await answer(holder, r2);

      // An ACTIVE branch has nothing to reactivate.
      expect(await impactOf(admin, { change: 'reactivate_branch', branchId: b1 })).toBe(0);
      const archived = await call(admin, 'POST', `/v1/profile_form/branches/${b1}/archive`);
      expect(archived.status).toBe(200);

      const before = await snapshot();
      const gateBefore = await gateMap();
      const impact = await impactOf(admin, { change: 'reactivate_branch', branchId: b1 });
      expect(impact).toBe(2); // `both` (R1 and R2) and `onlyFirst` (R1); the holder owes nothing
      expect(await impactOf(admin, { change: 'reactivate_branch', branchId: b2 })).toBe(2);
      expect(await snapshot()).toBe(before);

      // An undo of an ARCHIVED branch asks nobody.
      expect(await impactOf(admin, { change: 'undo_branch', branchId: b1 })).toBe(0);

      // The opener archived OUTSIDE the block: the count still reads the stored answers (the web refuses the
      // reactivation separately).
      await adminSql`update public.profile_form_questions set archived_at = now() where id = ${opener}::uuid`;
      expect(await impactOf(admin, { change: 'reactivate_branch', branchId: b1 })).toBe(2);
      await adminSql`update public.profile_form_questions set archived_at = null where id = ${opener}::uuid`;

      const restored = await call(admin, 'POST', `/v1/profile_form/branches/${b1}/reactivate`);
      expect(restored.status).toBe(200);
      expect(newlyHeld(gateBefore, await gateMap())).toBe(impact);
    });
  }, 180_000);
});

describe('12.2-11 T-12.2-10, PFORM-49: counts only, never a member, an answer or a branch name; admin lane only', () => {
  it('no response of the summary or of any impact kind carries an id, an e-mail, a name, a branch name or an answer value', async () => {
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const m1 = await person();
      const m2 = await person();
      const c = await seedClinic();
      await answer(m1, c.q1, { optionId: c.tem });
      await answer(m1, c.q3, 'pfi-secret-answer-value');
      await answer(m2, c.q1, { optionId: c.tem });
      await adminSql`update public.profile_form_questions set archived_at = now() where id = ${c.q6}::uuid`;

      const bodies: string[] = [];
      const read = async (path: string) => {
        const res = await call(admin, 'GET', path);
        expect(res.status, path).toBe(200);
        bodies.push(await res.text());
      };
      await read('/v1/profile_form/summary');
      const asks: Record<string, string>[] = [
        { change: 'create_required' },
        { change: 'create_required', branchId: c.b1 },
        { change: 'replace', branchId: c.b2 },
        { change: 'make_required', questionId: c.q2 },
        { change: 'reactivate', questionId: c.q6 },
        { change: 'remove_condition', questionId: c.q3 },
        { change: 'undo_branch', branchId: c.b1 },
        { change: 'reactivate_branch', branchId: c.b3 },
      ];
      for (const params of asks) {
        await read(`/v1/profile_form/impact?${new URLSearchParams(params).toString()}`);
      }
      const forbidden = [
        m1.email,
        m2.email,
        m1.userId,
        m2.userId,
        c.q3,
        c.b1,
        'pfi-secret-branch',
        'pfi-secret-answer-value',
        TITLE,
      ];
      for (const body of bodies) {
        for (const needle of forbidden) expect(body).not.toContain(needle);
        const parsed = JSON.parse(body) as Record<string, unknown>;
        for (const value of Object.values(parsed)) expect(typeof value).not.toBe('object');
      }
    });
  }, 180_000);

  it('a member and a support user are refused (403) on the summary and on every impact kind, and nothing leaks in the refusal', async () => {
    const member = await person();
    const support = await person('support_tenant');
    await withProfileForm(labTenantId, async () => {
      const c = await seedClinic();
      for (const who of [member, support]) {
        for (const path of [
          '/v1/profile_form/summary',
          `/v1/profile_form/impact?change=undo_branch&branchId=${c.b1}`,
          `/v1/profile_form/impact?change=reactivate_branch&branchId=${c.b1}`,
          `/v1/profile_form/impact?change=create_required&branchId=${c.b1}`,
        ]) {
          const res = await call(who, 'GET', path);
          expect(res.status, path).toBe(403);
          const text = await res.text();
          expect(text).not.toContain('pfi-secret-branch');
          expect(text).not.toContain(c.b1);
        }
      }
    });
  }, 120_000);
});
