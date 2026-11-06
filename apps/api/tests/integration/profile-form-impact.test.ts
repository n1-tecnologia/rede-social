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
