import { answerTokens, staffAnswersSchema } from '@rede-social/contracts/profile-form';
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
 * 12-07 (PFORM-08 route half, PFORM-18, PFORM-19; D-593, T-12-17, T-12-18) against the live local stack: the
 * READING side of the privacy promise, `GET /v1/members/{membershipId}/profile-answers`.
 *
 * A member viewer receives only the answers to questions the admin flagged public that are not archived; the
 * staff receive every answer; every miss is ONE identical bare 404.
 *
 * EVERY identity is a THROWAWAY (`createSharedIdentity`, prefix `pfa`); questions carry the title prefix
 * `pfa ` so the sweep removes only this file's rows. All the questions are OPTIONAL, so no viewer is held by
 * the gate. The module row is restored by `withProfileForm`.
 */

type Envelope = { error: { code: string; details?: unknown } };
type Answers = {
  kind: 'member' | 'staff';
  answers: Record<string, unknown>[];
  branches?: { id: string; openerQuestionId: string; values: string[] }[];
};

/** The body with the one per-request field removed: everything else must be byte-identical. */
const stable = (text: string) => text.replace(/"requestId":"[^"]*"/, '"requestId":"-"');

const PREFIX = 'pfa';
const TITLE = 'pfa ';
let labTenantId = '';
let demoTenantId = '';
let adminUserId = '';

type Person = { userId: string; email: string; password: string; token: string; host: string };

async function person(
  role: 'member' | 'admin_tenant' | 'support_tenant' = 'member',
  host: keyof typeof HOSTS = 'lab',
): Promise<Person> {
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host, role, status: 'active' }],
  });
  return {
    ...identity,
    token: await signInAs(identity.email, identity.password),
    host: HOSTS[host],
  };
}

/** A membership that is never signed in: a blocked or invited target. */
async function parked(status: 'blocked' | 'invited'): Promise<string> {
  const identity = await createSharedIdentity({
    prefix: PREFIX,
    memberships: [{ host: 'lab', role: 'member', status }],
  });
  return membershipOf(identity.userId, labTenantId);
}

async function membershipOf(userId: string, tenantId: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id::text as id from public.memberships
     where user_id = ${userId}::uuid and tenant_id = ${tenantId}::uuid`;
  if (!row) throw new Error('membershipOf: no membership');
  return row.id;
}

const read = (viewer: Person, membershipId: string, host: string = viewer.host) =>
  api.request(`/v1/members/${membershipId}/profile-answers`, {
    method: 'GET',
    headers: { 'x-tenant-host': host, authorization: `Bearer ${viewer.token}` },
  });

const question = (over: Partial<Parameters<typeof seedProfileFormQuestion>[0]> = {}) =>
  seedProfileFormQuestion({
    tenantId: labTenantId,
    adminUserId,
    title: `${TITLE}${crypto.randomUUID().slice(0, 8)}`,
    required: false,
    ...over,
  });

const answer = (userId: string, questionId: string, value: unknown) =>
  seedProfileFormAnswer({ tenantId: labTenantId, questionId, userId, value });

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

afterEach(async () => {
  await removeProfileFormByPrefix(TITLE);
});

afterAll(async () => {
  await sweep();
  await adminSql`
    delete from public.tenant_modules
     where module_key = 'profile_form' and tenant_id in (${labTenantId}::uuid, ${demoTenantId}::uuid)`;
});

const MEMBER_KEYS = ['options', 'questionId', 'title', 'type', 'value'];

describe('12-07 tracer: a member sees another member public answers and nothing else', () => {
  it('returns the public, answered, active rows in the admin order, in a strict payload', async () => {
    const owner = await person();
    const viewer = await person();
    await withProfileForm(labTenantId, async () => {
      const second = await question({
        title: `${TITLE}Segunda`,
        position: 2,
        type: 'single_choice',
        showOnProfile: true,
        options: [
          { id: 'a1b2c3d4-0000-4000-8000-000000000001', label: 'Sim' },
          { id: 'a1b2c3d4-0000-4000-8000-000000000002', label: 'Não' },
        ],
      });
      const first = await question({ title: `${TITLE}Primeira`, position: 1, showOnProfile: true });
      const secret = await question({ title: `${TITLE}Privada`, position: 3 });
      const archived = await question({
        title: `${TITLE}Arquivada`,
        position: 4,
        showOnProfile: true,
        archived: true,
      });
      const unanswered = await question({
        title: `${TITLE}Sem resposta`,
        position: 5,
        showOnProfile: true,
      });
      await answer(owner.userId, first, 'texto publico');
      await answer(owner.userId, second, {
        optionId: 'a1b2c3d4-0000-4000-8000-000000000001',
        otherText: null,
      });
      await answer(owner.userId, secret, 'SEGREDO-PRIVADO');
      await answer(owner.userId, archived, 'SEGREDO-ARQUIVADO');

      const res = await read(viewer, await membershipOf(owner.userId, labTenantId));
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const raw = await res.text();
      const body = JSON.parse(raw) as Answers;

      expect(Object.keys(body).sort()).toEqual(['answers', 'kind']);
      expect(body.kind).toBe('member');
      expect(body.answers.map((row) => row.questionId)).toEqual([first, second]);
      for (const row of body.answers) expect(Object.keys(row).sort()).toEqual(MEMBER_KEYS);
      expect(body.answers[0]).toMatchObject({
        title: `${TITLE}Primeira`,
        type: 'short_text',
        options: [],
        value: 'texto publico',
      });
      expect(body.answers[1]).toMatchObject({
        type: 'single_choice',
        value: { optionId: 'a1b2c3d4-0000-4000-8000-000000000001', otherText: null },
      });
      // Nothing private, archived, unanswered or staff-only crosses (T-12-17, UI-D-598).
      expect(raw).not.toContain('SEGREDO');
      expect(raw).not.toContain(secret);
      expect(raw).not.toContain(archived);
      expect(raw).not.toContain(unanswered);
      expect(raw).not.toContain('showOnProfile');
      expect(raw).not.toContain('archivedAt');
      expect(raw).not.toContain(owner.email);
    });
  });

  it('returns an empty public list to a member viewer when the target answered nothing public', async () => {
    const owner = await person();
    const viewer = await person();
    await withProfileForm(labTenantId, async () => {
      const secret = await question({ title: `${TITLE}Privada` });
      await answer(owner.userId, secret, 'SEGREDO');
      const res = await read(viewer, await membershipOf(owner.userId, labTenantId));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ kind: 'member', answers: [] });
    });
  });

  it('answers ONE byte-identical bare 404 for every miss', async () => {
    const owner = await person();
    const viewer = await person();
    const staffTarget = await person('admin_tenant');
    const gone = await person();
    await adminSql`
      update public.memberships set deleted_at = now()
       where user_id = ${gone.userId}::uuid and tenant_id = ${labTenantId}::uuid`;
    const blocked = await parked('blocked');
    const invited = await parked('invited');
    const unknown = crypto.randomUUID();
    const bodies: { name: string; status: number; text: string }[] = [];

    await withProfileForm(labTenantId, async () => {
      const pub = await question({ showOnProfile: true });
      await answer(owner.userId, pub, 'publico');
      const ids: [string, string][] = [
        ['unknown id', unknown],
        ['blocked', blocked],
        ['invited', invited],
        ['soft-deleted', await membershipOf(gone.userId, labTenantId)],
        ['staff', await membershipOf(staffTarget.userId, labTenantId)],
        ['own membership', await membershipOf(viewer.userId, labTenantId)],
      ];
      for (const [name, id] of ids) {
        const res = await read(viewer, id);
        bodies.push({ name, status: res.status, text: stable(await res.text()) });
      }
      // The control: the same viewer reads the owner fine.
      expect((await read(viewer, await membershipOf(owner.userId, labTenantId))).status).toBe(200);
    });
    // The module off: the same 404 for a real, active member target.
    await withProfileForm(
      labTenantId,
      async () => {
        const res = await read(viewer, await membershipOf(owner.userId, labTenantId));
        bodies.push({ name: 'module off', status: res.status, text: stable(await res.text()) });
      },
      { enabled: false },
    );

    expect(bodies).toHaveLength(7);
    for (const body of bodies) expect(body.status, body.name).toBe(404);
    const first = bodies[0];
    for (const body of bodies) expect(body.text, body.name).toBe(first?.text);
    const envelope = JSON.parse(first?.text ?? '{}') as Envelope;
    expect(envelope.error.code).toBe('NOT_FOUND');
    expect(envelope.error.details).toBeUndefined();
  });

  it('keeps tenant B out: the wrong host is TENANT_HOST_MISMATCH, the right host cannot find the id', async () => {
    const owner = await person();
    const foreign = await person('member', 'demo');
    await withProfileForm(demoTenantId, async () => {
      await withProfileForm(labTenantId, async () => {
        const ownerId = await membershipOf(owner.userId, labTenantId);
        const wrongHost = await read(foreign, ownerId, HOSTS.lab);
        expect(wrongHost.status).toBe(403);
        expect(((await wrongHost.json()) as Envelope).error.code).toBe('TENANT_HOST_MISMATCH');

        const ownHost = await read(foreign, ownerId);
        expect(ownHost.status).toBe(404);
        expect(((await ownHost.json()) as Envelope).error.code).toBe('NOT_FOUND');

        // The positive control: she reads a fellow demo member on her own host.
        const peer = await person('member', 'demo');
        const peerRes = await read(foreign, await membershipOf(peer.userId, demoTenantId));
        expect(peerRes.status).toBe(200);
        expect(await peerRes.json()).toEqual({ kind: 'member', answers: [] });
      });
    });
  });

  it('never reaches a private answer with a guessed membership id and question id', async () => {
    const owner = await person();
    const viewer = await person();
    await withProfileForm(labTenantId, async () => {
      const secret = await question({ title: `${TITLE}Privada` });
      await answer(owner.userId, secret, 'SEGREDO-PRIVADO');
      const ownerId = await membershipOf(owner.userId, labTenantId);
      // The guessed ids are only ever path parameters; neither a query string nor a header selects a row.
      const res = await api.request(`/v1/members/${ownerId}/profile-answers?questionId=${secret}`, {
        headers: { 'x-tenant-host': HOSTS.lab, authorization: `Bearer ${viewer.token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).not.toContain('SEGREDO');
      // The private row exists (the miss is the route's, not an empty table).
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.profile_form_answers
         where question_id = ${secret}::uuid`;
      expect(row?.n).toBe(1);
    });
  });
});

describe('12-07 staff: PFORM-19', () => {
  it('lets admin and support read every answer, archived and private included, with the flags', async () => {
    const owner = await person();
    const admin = await person('admin_tenant');
    const support = await person('support_tenant');
    await withProfileForm(labTenantId, async () => {
      const pub = await question({
        title: `${TITLE}Publica`,
        position: 1,
        showOnProfile: true,
        required: true,
      });
      const priv = await question({ title: `${TITLE}Privada`, position: 2 });
      const archived = await question({
        title: `${TITLE}Arquivada`,
        position: 3,
        showOnProfile: true,
        archived: true,
      });
      await answer(owner.userId, pub, 'um');
      await answer(owner.userId, priv, 'dois');
      await answer(owner.userId, archived, 'tres');
      const ownerId = await membershipOf(owner.userId, labTenantId);

      for (const viewer of [admin, support]) {
        const res = await read(viewer, ownerId);
        expect(res.status).toBe(200);
        const body = (await res.json()) as Answers;
        expect(body.kind).toBe('staff');
        expect(body.answers.map((row) => row.questionId)).toEqual([pub, priv, archived]);
        expect(body.answers.map((row) => row.value)).toEqual(['um', 'dois', 'tres']);
        expect(body.answers.map((row) => row.showOnProfile)).toEqual([true, false, true]);
        expect(body.answers.map((row) => row.required)).toEqual([true, false, false]);
        expect(body.answers.map((row) => row.answered)).toEqual([true, true, true]);
        expect(body.answers.map((row) => row.position)).toEqual([1, 2, 3]);
        expect(body.answers[0]?.archivedAt).toBeNull();
        expect(typeof body.answers[2]?.archivedAt).toBe('string');
        for (const row of body.answers) {
          expect(Object.keys(row).sort()).toEqual([
            'answered',
            'archivedAt',
            'branchId',
            'condition',
            'options',
            'position',
            'questionId',
            'required',
            'showOnProfile',
            'title',
            'type',
            'value',
          ]);
        }
      }
    });
  });

  it('lists every active question as unanswered for a member with no answers, and no archived row', async () => {
    const owner = await person();
    const admin = await person('admin_tenant');
    const viewer = await person();
    await withProfileForm(labTenantId, async () => {
      const a = await question({ title: `${TITLE}A`, position: 1, showOnProfile: true });
      const b = await question({ title: `${TITLE}B`, position: 2 });
      await question({ title: `${TITLE}Arquivada`, position: 3, archived: true });
      const ownerId = await membershipOf(owner.userId, labTenantId);

      const res = await read(admin, ownerId);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Answers;
      expect(body.kind).toBe('staff');
      expect(body.answers.map((row) => row.questionId)).toEqual([a, b]);
      expect(body.answers.map((row) => row.answered)).toEqual([false, false]);
      expect(body.answers.map((row) => row.value)).toEqual([null, null]);

      // The same target for a member viewer is an empty public list.
      const asMember = await read(viewer, ownerId);
      expect(await asMember.json()).toEqual({ kind: 'member', answers: [] });
    });
  });

  it('orders active questions first in the admin order, then archived newest first, the same on every call', async () => {
    const owner = await person();
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const archivedOld = await question({
        title: `${TITLE}Antiga`,
        position: 1,
        archivedAt: new Date('2026-01-01T00:00:00Z'),
      });
      const activeTwo = await question({ title: `${TITLE}Dois`, position: 2 });
      const archivedNew = await question({
        title: `${TITLE}Nova`,
        position: 0,
        archivedAt: new Date('2026-06-01T00:00:00Z'),
      });
      const activeOne = await question({ title: `${TITLE}Um`, position: 1 });
      for (const id of [archivedOld, activeTwo, archivedNew, activeOne]) {
        await answer(owner.userId, id, `r-${id.slice(0, 4)}`);
      }
      const ownerId = await membershipOf(owner.userId, labTenantId);
      const sequences: string[][] = [];
      for (let i = 0; i < 2; i++) {
        const res = await read(admin, ownerId);
        const body = (await res.json()) as Answers;
        sequences.push(body.answers.map((row) => row.questionId as string));
      }
      expect(sequences[0]).toEqual([activeOne, activeTwo, archivedNew, archivedOld]);
      expect(sequences[1]).toEqual(sequences[0]);
    });
  });

  it('answers the same 404 for a staff target, for both staff and member viewers', async () => {
    const admin = await person('admin_tenant');
    const support = await person('support_tenant');
    const viewer = await person();
    await withProfileForm(labTenantId, async () => {
      await question({ title: `${TITLE}Qualquer`, showOnProfile: true });
      const adminId = await membershipOf(admin.userId, labTenantId);
      const supportId = await membershipOf(support.userId, labTenantId);
      const seen: string[] = [];
      for (const [who, target] of [
        [admin, supportId],
        [support, adminId],
        [admin, adminId],
        [viewer, adminId],
        [viewer, supportId],
      ] as const) {
        const res = await read(who, target);
        expect(res.status).toBe(404);
        seen.push(stable(await res.text()));
      }
      expect(new Set(seen).size).toBe(1);
    });
  });

  it('never gives a member viewer the staff shape or a private row', async () => {
    const owner = await person();
    const viewer = await person();
    await withProfileForm(labTenantId, async () => {
      const priv = await question({ title: `${TITLE}Privada` });
      const pub = await question({ title: `${TITLE}Publica`, showOnProfile: true });
      await answer(owner.userId, priv, 'SEGREDO');
      await answer(owner.userId, pub, 'aberto');
      const res = await read(viewer, await membershipOf(owner.userId, labTenantId));
      const raw = await res.text();
      const body = JSON.parse(raw) as Answers;
      expect(body.kind).toBe('member');
      expect(body.answers.map((row) => row.questionId)).toEqual([pub]);
      expect(raw).not.toContain('SEGREDO');
      expect(raw).not.toContain('"answered"');
      expect(raw).not.toContain('"showOnProfile"');
    });
  });

  it('keeps tenant A staff out of a tenant B member, and the module off hides the rows without deleting them', async () => {
    const owner = await person();
    const demoMember = await person('member', 'demo');
    const admin = await person('admin_tenant');
    const demoAdmin = await person('admin_tenant', 'demo');
    let pub = '';
    await withProfileForm(demoTenantId, async () => {
      await withProfileForm(labTenantId, async () => {
        pub = await question({ title: `${TITLE}Publica`, showOnProfile: true });
        await answer(owner.userId, pub, 'aberto');
        const ownerId = await membershipOf(owner.userId, labTenantId);
        const demoMemberId = await membershipOf(demoMember.userId, demoTenantId);

        // Tenant B's admin on tenant B's host asking for tenant A's member id: the bare 404.
        const crossed = await read(demoAdmin, ownerId);
        expect(crossed.status).toBe(404);
        expect(((await crossed.json()) as Envelope).error.code).toBe('NOT_FOUND');
        // Tenant A's admin on tenant A's host asking for tenant B's member id: the same 404.
        const reverse = await read(admin, demoMemberId);
        expect(reverse.status).toBe(404);
        // The wrong host is the host refusal.
        const wrong = await read(demoAdmin, ownerId, HOSTS.lab);
        expect(wrong.status).toBe(403);
        // The positive control.
        expect((await read(admin, ownerId)).status).toBe(200);
      });
    });
    await withProfileForm(
      labTenantId,
      async () => {
        const res = await read(admin, await membershipOf(owner.userId, labTenantId));
        expect(res.status).toBe(404);
        expect(((await res.json()) as Envelope).error.code).toBe('NOT_FOUND');
      },
      { enabled: false },
    );
    // The answers are kept, not shown.
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.profile_form_answers where question_id = ${pub}::uuid`;
    expect(row?.n).toBe(1);
  });
});

/**
 * 12.1-12 (D-624, D-634, D-636; PFORM-33, T-12.1-03; tracer): STORED EQUALS VISIBLE, proved across every reader.
 * No reader of stored answers carries a visibility filter, so the only thing that keeps a closed answer out of
 * the public block and the staff view is that the member's own save already deleted it. The fixture is one
 * opener (single choice, public) with an ACTIVE and an ARCHIVED public dependent under the same condition, all
 * answered through the admin SQL, then closed by the member through the REAL save route.
 */
describe('12.1-12 tracer: a closed answer leaves every reader and the staff row carries its branch (D-624, D-634, D-636)', () => {
  type FormRead = { formEtag: string };

  const asMember = (who: Person, method: 'GET' | 'PUT', path: string, body?: unknown) =>
    api.request(path, {
      method,
      headers: {
        'x-tenant-host': who.host,
        authorization: `Bearer ${who.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const choose = (optionId: string) => ({ optionId, otherText: null });

  const storedIds = async (userId: string): Promise<string[]> =>
    (
      await adminSql<{ question_id: string }[]>`
        select a.question_id::text as question_id
          from public.profile_form_answers a
          join public.memberships m on m.id = a.membership_id
         where m.user_id = ${userId}::uuid
         order by a.question_id`
    ).map((row) => row.question_id);

  async function fixture() {
    const step = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S1` });
    const yes = crypto.randomUUID();
    const no = crypto.randomUUID();
    const opener = await question({
      title: `${TITLE}Abridora`,
      type: 'single_choice',
      stepId: step,
      position: 1,
      showOnProfile: true,
      options: [
        { id: yes, label: 'Sim' },
        { id: no, label: 'Não' },
      ],
    });
    const dependent = await question({
      title: `${TITLE}Ativa`,
      stepId: step,
      position: 2,
      showOnProfile: true,
      conditionQuestionId: opener,
      conditionValues: [yes],
    });
    const archivedDependent = await question({
      title: `${TITLE}Arquivada dependente`,
      stepId: step,
      position: 3,
      showOnProfile: true,
      archived: true,
      conditionQuestionId: opener,
      conditionValues: [yes],
    });
    const [branch] = await adminSql<{ id: string }[]>`
      select id::text as id from public.profile_form_branches
       where opener_question_id = ${opener}::uuid`;
    return { step, yes, no, opener, dependent, archivedDependent, branch: branch?.id as string };
  }

  it('D-636 archived: the member changes the opener, the ACTIVE and the ARCHIVED dependent answers are gone from the store, the public block and the staff view, a bystander keeps hers, and the staff row names its branch', async () => {
    const owner = await person();
    const bystander = await person();
    const viewer = await person();
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const f = await fixture();
      for (const who of [owner, bystander]) {
        await answer(who.userId, f.opener, choose(f.yes));
        await answer(who.userId, f.dependent, 'ativa-publica');
        await answer(who.userId, f.archivedDependent, 'arquivada-publica');
      }
      const ownerId = await membershipOf(owner.userId, labTenantId);

      // Positive control: before the change the public block carries the open dependent (and not the archived
      // one, which the public query never lists) and the staff view carries both answers.
      const publicBefore = (await (await read(viewer, ownerId)).json()) as Answers;
      expect(publicBefore.answers.map((row) => row.questionId)).toEqual([f.opener, f.dependent]);
      expect(publicBefore.answers.find((row) => row.questionId === f.dependent)?.value).toBe(
        'ativa-publica',
      );
      const staffBefore = (await (await read(admin, ownerId)).json()) as Answers;
      expect(
        staffBefore.answers.filter((row) => row.answered).map((row) => row.questionId),
      ).toEqual([f.opener, f.dependent, f.archivedDependent]);
      expect(
        staffBefore.answers.find((row) => row.questionId === f.archivedDependent),
      ).toMatchObject({
        value: 'arquivada-publica',
        branchId: f.branch,
        condition: null,
      });
      // The payload carries the branch (opener and values, no name) so the row can be read through it.
      expect(staffBefore.branches).toEqual([
        { id: f.branch, openerQuestionId: f.opener, values: [f.yes] },
      ]);

      // The member closes the dependents through the real save route.
      const formRes = await asMember(owner, 'GET', '/v1/me/profile-form');
      expect(formRes.status).toBe(200);
      const form = (await formRes.json()) as FormRead;
      const saved = await asMember(owner, 'PUT', '/v1/me/profile-form/answers', {
        formEtag: form.formEtag,
        stepId: f.step,
        answers: { [f.opener]: choose(f.no) },
      });
      expect(saved.status, await saved.clone().text()).toBe(200);

      // Stored: only the opener remains for the owner (admin SQL, no policy in the way).
      expect(await storedIds(owner.userId)).toEqual([f.opener]);
      // The bystander's three answers are untouched.
      expect(await storedIds(bystander.userId)).toEqual(
        [f.opener, f.dependent, f.archivedDependent].sort(),
      );

      // Public block: the new opener answer and neither dependent, not even by id.
      const publicRes = await read(viewer, ownerId);
      const publicRaw = await publicRes.text();
      const publicAfter = JSON.parse(publicRaw) as Answers;
      expect(publicAfter.answers.map((row) => row.questionId)).toEqual([f.opener]);
      expect(publicAfter.answers[0]?.value).toEqual(choose(f.no));
      expect(publicRaw).not.toContain('ativa-publica');
      expect(publicRaw).not.toContain('arquivada-publica');
      expect(publicRaw).not.toContain(f.dependent);
      expect(publicRaw).not.toContain(f.archivedDependent);

      // Staff view: the active dependent is listed UNANSWERED with its condition, the archived one (nothing
      // left to show) is absent, and no payload gained an answer value for the sake of "Não se aplica".
      const staffRes = await read(admin, ownerId);
      const staffRaw = await staffRes.text();
      const staffAfter = JSON.parse(staffRaw) as Answers;
      expect(staffAfter.answers.map((row) => row.questionId)).toEqual([f.opener, f.dependent]);
      expect(staffAfter.answers[1]).toMatchObject({
        questionId: f.dependent,
        answered: false,
        value: null,
        branchId: f.branch,
        condition: null,
      });
      expect(staffAfter.answers[0]).toMatchObject({
        answered: true,
        branchId: null,
        condition: null,
      });
      expect(Object.keys(staffAfter.answers[1] ?? {}).sort()).toEqual([
        'answered',
        'archivedAt',
        'branchId',
        'condition',
        'options',
        'position',
        'questionId',
        'required',
        'showOnProfile',
        'title',
        'type',
        'value',
      ]);
      expect(staffRaw).not.toContain('ativa-publica');
      expect(staffRaw).not.toContain('arquivada-publica');

      // The bystander's public block still shows her dependent (the purge touched only the member's own).
      const bystanderPublic = (await (
        await read(viewer, await membershipOf(bystander.userId, labTenantId))
      ).json()) as Answers;
      expect(bystanderPublic.answers.map((row) => row.questionId)).toEqual([f.opener, f.dependent]);
    });
  }, 60_000);

  it('the public payload is unchanged by the staff contract change: no condition key on a member row', async () => {
    const owner = await person();
    const viewer = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await fixture();
      await answer(owner.userId, f.opener, choose(f.yes));
      await answer(owner.userId, f.dependent, 'ativa-publica');
      const res = await read(viewer, await membershipOf(owner.userId, labTenantId));
      const body = (await res.json()) as Answers;
      expect(body.kind).toBe('member');
      for (const row of body.answers) expect(Object.keys(row).sort()).toEqual(MEMBER_KEYS);
    });
  }, 30_000);
});

/**
 * 12.2-10 (D-641, T-12.2-03, PFORM-52): the staff row learns the branches. The payload carries each question's
 * `branchId` and the tenant's branches (opener and values, never a name), and the opener rows carry their own
 * `value`, so the staff view reads a question hidden by ANY branch above it as "Não se aplica" from the payload
 * alone, with no visibility filter anywhere in the readers.
 */
describe('12.2-10 staff payload: branchId per row and a top-level branches list without a name (D-641, T-12.2-03)', () => {
  const choose = (optionId: string) => ({ optionId, otherText: null });

  /** Q1 | B1 {Q2 | B2 {Q3}} | an ARCHIVED Q4 in B2: depth 2, every branch named, every question public. */
  async function tree() {
    const step = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S1` });
    const [y1, n1, y2, n2] = Array.from({ length: 4 }, () => crypto.randomUUID()) as [
      string,
      string,
      string,
      string,
    ];
    const q1 = await question({
      title: `${TITLE}Q1`,
      type: 'single_choice',
      stepId: step,
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
      name: 'pfa SEGREDO-UM',
    });
    const q2 = await question({
      title: `${TITLE}Q2`,
      type: 'single_choice',
      stepId: step,
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
      name: 'pfa SEGREDO-DOIS',
    });
    const q3 = await question({ title: `${TITLE}Q3`, stepId: step, position: 3, branchId: b2 });
    const q4 = await question({
      title: `${TITLE}Q4 arquivada`,
      stepId: step,
      position: 4,
      branchId: b2,
      archived: true,
    });
    return { y1, n1, y2, n2, q1, b1, q2, b2, q3, q4 };
  }

  it('lists every branch of the tenant with exactly id, openerQuestionId and values, and each row with its branchId', async () => {
    const owner = await person();
    const admin = await person('admin_tenant');
    const support = await person('support_tenant');
    await withProfileForm(labTenantId, async () => {
      const f = await tree();
      await answer(owner.userId, f.q1, choose(f.y1));
      await answer(owner.userId, f.q2, choose(f.y2));
      await answer(owner.userId, f.q3, 'fundo');
      await answer(owner.userId, f.q4, 'arquivada');
      const ownerId = await membershipOf(owner.userId, labTenantId);

      for (const viewer of [admin, support]) {
        const res = await read(viewer, ownerId);
        expect(res.status).toBe(200);
        const raw = await res.text();
        // T-12.2-03: the stored names are nowhere in the body.
        expect(raw).not.toContain('SEGREDO');
        const body = JSON.parse(raw) as {
          kind: string;
          answers: { questionId: string; branchId: string | null; condition: unknown }[];
          branches: { id: string; openerQuestionId: string; values: string[] }[];
        };
        expect(Object.keys(body).sort()).toEqual(['answers', 'branches', 'kind']);
        expect(body.branches.map((b) => b.id).sort()).toEqual([f.b1, f.b2].sort());
        for (const branch of body.branches) {
          expect(Object.keys(branch).sort()).toEqual(['id', 'openerQuestionId', 'values']);
        }
        expect(body.branches.find((b) => b.id === f.b2)).toEqual({
          id: f.b2,
          openerQuestionId: f.q2,
          values: [f.y2],
        });
        expect(body.answers.map((row) => [row.questionId, row.branchId, row.condition])).toEqual([
          [f.q1, null, null],
          [f.q2, f.b1, null],
          [f.q3, f.b2, null],
          [f.q4, f.b2, null],
        ]);
        // The contract parses it, and a payload that carried a name would not.
        expect(staffAnswersSchema.safeParse(JSON.parse(raw)).success).toBe(true);
        const named = JSON.parse(raw) as { branches: Record<string, unknown>[] };
        named.branches = named.branches.map((b) => ({ ...b, name: 'x' }));
        expect(staffAnswersSchema.safeParse(named).success).toBe(false);
      }
    });
  }, 60_000);

  it('a question hidden by ANY branch above it is derivable as "Não se aplica" from the payload alone, and no value leaks beside it', async () => {
    const owner = await person();
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const f = await tree();
      // Opener Q1 = não closes B1: Q2 is hidden by B1 and Q3 by B1 above B2, though Q2 would open B2.
      await answer(owner.userId, f.q1, choose(f.n1));
      const ownerId = await membershipOf(owner.userId, labTenantId);
      const body = (await (await read(admin, ownerId)).json()) as {
        answers: {
          questionId: string;
          branchId: string | null;
          value: unknown;
          answered: boolean;
        }[];
        branches: { id: string; openerQuestionId: string; values: string[] }[];
      };
      const tree3 = branchTreeOf(
        body.answers.map((row) => ({ id: row.questionId, branchId: row.branchId })),
        body.branches,
      );
      const valueByQuestion = new Map(body.answers.map((row) => [row.questionId, row.value]));
      const tokensOf = (id: string) => answerTokens(valueByQuestion.get(id) ?? undefined);
      const notApplicable = body.answers
        .filter((row) => !isQuestionVisibleInTree({ branchId: row.branchId }, tree3, tokensOf))
        .map((row) => row.questionId);
      expect(notApplicable).toEqual([f.q2, f.q3]);
      expect(body.answers.find((row) => row.questionId === f.q3)).toMatchObject({
        answered: false,
        value: null,
      });
    });
  }, 40_000);

  it('a form without branches returns branches: [] and a member viewer still gets only public answered rows with no branch key', async () => {
    const owner = await person();
    const viewer = await person();
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const pub = await question({ position: 1, showOnProfile: true });
      const priv = await question({ position: 2, showOnProfile: false });
      await answer(owner.userId, pub, 'p');
      await answer(owner.userId, priv, 's');
      const ownerId = await membershipOf(owner.userId, labTenantId);

      const staff = (await (await read(admin, ownerId)).json()) as { branches: unknown[] };
      expect(staff.branches).toEqual([]);

      const res = await read(viewer, ownerId);
      const raw = await res.text();
      const body = JSON.parse(raw) as Answers;
      expect(Object.keys(body).sort()).toEqual(['answers', 'kind']);
      expect(body.answers.map((row) => row.questionId)).toEqual([pub]);
      for (const row of body.answers) expect(Object.keys(row).sort()).toEqual(MEMBER_KEYS);
      expect(raw).not.toContain('branch');
    });
  }, 40_000);
});

/**
 * 12.1-12 PFORM-39 (idempotency, concurrency; D-634, T-12.1-03): the readers are pure functions of the stored
 * rows, and a reader running while a save is open sees the whole state before the save or the whole state
 * after it, never the new opener answer together with the old closed answer, because the opener's write and the
 * purge commit together.
 */
describe('12.1-12 PFORM-39 idempotency and concurrency: the readers are repeatable and see one snapshot of a save', () => {
  const DB_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
  const holder = postgres(DB_URL, { prepare: false, max: 1 });
  afterAll(async () => {
    await holder.end({ timeout: 2 });
  });

  const choose = (optionId: string) => ({ optionId, otherText: null });

  async function openerAndDependent(over: { dependentArchived?: boolean } = {}) {
    const step = await seedProfileFormStep({ tenantId: labTenantId, title: `${TITLE}S1` });
    const yes = crypto.randomUUID();
    const no = crypto.randomUUID();
    const opener = await question({
      title: `${TITLE}Abridora`,
      type: 'single_choice',
      stepId: step,
      position: 1,
      showOnProfile: true,
      options: [
        { id: yes, label: 'Sim' },
        { id: no, label: 'Não' },
      ],
    });
    const dependent = await question({
      title: `${TITLE}Ativa`,
      stepId: step,
      position: 2,
      showOnProfile: true,
      archived: over.dependentArchived ?? false,
      conditionQuestionId: opener,
      conditionValues: [yes],
    });
    return { step, yes, no, opener, dependent };
  }

  const answerOf = (body: Answers, questionId: string) =>
    body.answers.find((row) => row.questionId === questionId);

  it('PFORM-39 idempotency: the public block, the staff view and the profile summary return identical payloads twice', async () => {
    const owner = await person();
    const viewer = await person();
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const f = await openerAndDependent();
      await answer(owner.userId, f.opener, choose(f.yes));
      await answer(owner.userId, f.dependent, 'estavel');
      const ownerId = await membershipOf(owner.userId, labTenantId);

      for (const who of [viewer, admin]) {
        const first = stable(await (await read(who, ownerId)).text());
        const second = stable(await (await read(who, ownerId)).text());
        expect(second).toBe(first);
        expect(first).toContain('estavel');
      }
      // The admin's profile summary (totals of members complete and owed) is the same twice as well.
      const summaryOnce = await api.request('/v1/profile_form/summary', {
        method: 'GET',
        headers: { 'x-tenant-host': admin.host, authorization: `Bearer ${admin.token}` },
      });
      expect(summaryOnce.status).toBe(200);
      const summaryTwice = await api.request('/v1/profile_form/summary', {
        method: 'GET',
        headers: { 'x-tenant-host': admin.host, authorization: `Bearer ${admin.token}` },
      });
      expect(stable(await summaryTwice.text())).toBe(stable(await summaryOnce.text()));
      // The member's own form read is the same twice as well.
      const mineOnce = await api.request('/v1/me/profile-form', {
        method: 'GET',
        headers: { 'x-tenant-host': owner.host, authorization: `Bearer ${owner.token}` },
      });
      const mineTwice = await api.request('/v1/me/profile-form', {
        method: 'GET',
        headers: { 'x-tenant-host': owner.host, authorization: `Bearer ${owner.token}` },
      });
      expect(stable(await mineTwice.text())).toBe(stable(await mineOnce.text()));
    });
  }, 40_000);

  it('PFORM-39 idempotency: a purge that finds nothing to delete changes nothing', async () => {
    const owner = await person();
    await withProfileForm(labTenantId, async () => {
      const f = await openerAndDependent();
      await answer(owner.userId, f.opener, choose(f.yes));
      await answer(owner.userId, f.dependent, 'fica');
      const claims = JSON.stringify({
        sub: owner.userId,
        role: 'authenticated',
        tenant_id: labTenantId,
        tenant_role: 'member',
      });
      const stamp = async () =>
        adminSql<{ question_id: string; updated_at: Date }[]>`
          select question_id::text as question_id, updated_at from public.profile_form_answers
           where user_id = ${owner.userId}::uuid order by question_id`;
      const before = await stamp();
      for (let i = 0; i < 2; i += 1) {
        const deleted = await holder.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${claims}, true)`;
          await tx.unsafe('set local role authenticated');
          return tx`select question_id::text as question_id from app.profile_form_purge_closed()`;
        });
        expect(deleted).toHaveLength(0);
      }
      expect(await stamp()).toEqual(before);
    });
  }, 40_000);

  it('PFORM-39 concurrency: a reader while the save is open sees the whole state before it, and after the commit the whole state after it, never the new opener with the old closed answer', async () => {
    const owner = await person();
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const f = await openerAndDependent();
      await answer(owner.userId, f.opener, choose(f.yes));
      await answer(owner.userId, f.dependent, 'antiga');
      const ownerId = await membershipOf(owner.userId, labTenantId);
      const staff = async () => (await (await read(admin, ownerId)).json()) as Answers;

      // Connection A: exactly what the member's save does, held open before the commit.
      const claims = JSON.stringify({
        sub: owner.userId,
        role: 'authenticated',
        tenant_id: labTenantId,
        tenant_role: 'member',
      });
      let release: () => void = () => {};
      let held: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holding = new Promise<void>((resolve) => {
        held = resolve;
      });
      const saving = holder.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`;
        await tx.unsafe('set local role authenticated');
        await tx`select id::text as id from app.profile_form_lock_active_v2()`;
        await tx`
          insert into public.profile_form_answers (tenant_id, question_id, membership_id, user_id, value)
          select m.tenant_id, ${f.opener}::uuid, m.id, m.user_id, ${tx.json(choose(f.no))}
            from public.memberships m
           where m.tenant_id = ${labTenantId}::uuid and m.user_id = ${owner.userId}::uuid
          on conflict (tenant_id, membership_id, question_id)
          do update set value = excluded.value, updated_at = now()`;
        await tx`select question_id from app.profile_form_purge_closed()`;
        held();
        await gate;
      });
      await holding;

      // Connection B reads while A is open: the WHOLE old state (old opener answer with the old closed one).
      const during = await staff();
      expect(answerOf(during, f.opener)?.value).toEqual(choose(f.yes));
      expect(answerOf(during, f.dependent)).toMatchObject({ answered: true, value: 'antiga' });

      release();
      await saving;

      // After the commit: the WHOLE new state.
      const after = await staff();
      expect(answerOf(after, f.opener)?.value).toEqual(choose(f.no));
      expect(answerOf(after, f.dependent)).toMatchObject({ answered: false, value: null });
      // A repeat read of the settled state is the same (idempotency).
      expect(await staff()).toEqual(after);
    });
  }, 60_000);

  it('PFORM-39 concurrency: readers hammering the staff view during the REAL save route never see a torn state (new opener with the old closed answer)', async () => {
    const owner = await person();
    const admin = await person('admin_tenant');
    await withProfileForm(labTenantId, async () => {
      const f = await openerAndDependent();
      await answer(owner.userId, f.opener, choose(f.yes));
      await answer(owner.userId, f.dependent, 'antiga');
      const ownerId = await membershipOf(owner.userId, labTenantId);
      const formRes = await api.request('/v1/me/profile-form', {
        method: 'GET',
        headers: { 'x-tenant-host': owner.host, authorization: `Bearer ${owner.token}` },
      });
      const form = (await formRes.json()) as { formEtag: string };

      let saveDone = false;
      const snapshots: Answers[] = [];
      const reader = (async () => {
        while (!saveDone) {
          snapshots.push((await (await read(admin, ownerId)).json()) as Answers);
        }
        snapshots.push((await (await read(admin, ownerId)).json()) as Answers);
      })();
      const save = await api.request('/v1/me/profile-form/answers', {
        method: 'PUT',
        headers: {
          'x-tenant-host': owner.host,
          authorization: `Bearer ${owner.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          formEtag: form.formEtag,
          stepId: f.step,
          answers: { [f.opener]: choose(f.no) },
        }),
      });
      saveDone = true;
      await reader;
      expect(save.status, await save.clone().text()).toBe(200);

      expect(snapshots.length).toBeGreaterThan(0);
      for (const snapshot of snapshots) {
        const newOpener =
          (answerOf(snapshot, f.opener)?.value as { optionId?: string } | null)?.optionId === f.no;
        const oldClosed = answerOf(snapshot, f.dependent)?.answered === true;
        expect(
          newOpener && oldClosed,
          'a snapshot held the new opener with the old closed answer',
        ).toBe(false);
      }
      const last = snapshots[snapshots.length - 1] as Answers;
      expect(answerOf(last, f.opener)?.value).toEqual(choose(f.no));
      expect(answerOf(last, f.dependent)).toMatchObject({ answered: false });
    });
  }, 60_000);
});
