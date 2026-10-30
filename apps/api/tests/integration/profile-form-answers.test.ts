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
type Answers = { kind: 'member' | 'staff'; answers: Record<string, unknown>[] };

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
