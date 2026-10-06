import { bootstrapSchema } from '@rede-social/contracts';
import { memberProfileSchema, ownProfileSchema } from '@rede-social/contracts/profiles';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  adminSql,
  api,
  createSharedIdentity,
  HOSTS,
  removeIdentitiesByPrefix,
  SEED_PASSWORD,
  signInAs,
  uploadAvatar,
} from './setup';

/**
 * PROF-01 / TENANT-04 — the member profile against the live local stack.
 *
 * The tracer is one path through every layer: the seeded member reads the profile the
 * `member_profiles_from_membership` trigger created for them, renames themselves, writes a bio,
 * uploads a real photo through the 03-01 broker and points the profile at it, and sees all three in
 * `GET /v1/me/bootstrap` — whose CONTRACT SHAPE is unchanged (Pitfall 9).
 *
 * Two invariants are asserted here rather than assumed:
 *  - D-46: a rename overwrites the tenant profile and leaves `users.name` — the identity anchor
 *    staff search on — untouched.
 *  - TENANT-04: the photo's URL in every payload is the STABLE `/v1/media/{assetId}/w128` path, and
 *    fetching it really answers a 302 to a freshly signed Storage URL. A payload never carries a
 *    signed URL, so the tenant check runs on every image fetch.
 */

const MEMBER_EMAIL = 'member@rede-demo.local';
/** A SECOND member of the SAME tenant — the owner check needs a neighbour, not just a stranger. */
const NEIGHBOUR_EMAIL = 'admin@rede-demo.local';
/** The second seeded tenant — the isolation half. */
const LAB_MEMBER_EMAIL = 'member@rede-lab.local';
/** 08.1-04: throwaway shared identities of the per-community name tracer, never seed users. */
const PER_COMMUNITY_PREFIX = 'pn';

let memberToken = '';
let memberUserId = '';
let demoTenantId = '';
let neighbourToken = '';
let labToken = '';
let labTenantId = '';
let labUserId = '';
/** The seeded state this file must put back, so a re-run starts from the same fixture. */
let seededDisplayName = '';

/** Every asset this file creates, with the tenant whose prefix its objects live under. */
const createdAssets: { assetId: string; tenantId: string }[] = [];
const createdAssetIds: string[] = [];

/** `uploadAvatar` + bookkeeping, so `afterAll` can remove both the objects and the rows. */
async function makeAsset(
  token: string,
  tenantId: string,
  purpose: 'avatar' | 'post' = 'avatar',
): Promise<string> {
  const assetId = await uploadAvatar(token, { purpose });
  createdAssets.push({ assetId, tenantId });
  createdAssetIds.push(assetId);
  return assetId;
}

async function assetStatus(assetId: string): Promise<{ status: string; deleted: boolean }> {
  const [row] = await adminSql<{ status: string; deleted_at: string | null }[]>`
    select status, deleted_at from public.media_assets where id = ${assetId}::uuid`;
  return { status: row?.status ?? 'missing', deleted: row?.deleted_at !== null };
}

async function storedProfile(userId: string) {
  const [row] = await adminSql<
    {
      membership_id: string;
      display_name: string;
      bio: string | null;
      avatar_asset_id: string | null;
      tenant_id: string;
    }[]
  >`select membership_id, display_name, bio, avatar_asset_id, tenant_id
      from public.member_profiles where user_id = ${userId}::uuid`;
  return row;
}

type Envelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

const profile = (init: { method?: string; body?: unknown; token?: string } = {}) =>
  api.request(init.method === 'POST' ? '/v1/me/profile/dismiss-nudge' : '/v1/me/profile', {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${init.token ?? memberToken}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

const getProfile = (token?: string) => profile({ token });
const patchProfile = (body: unknown, token?: string) => profile({ method: 'PATCH', body, token });
const postDismissNudge = (token?: string) => profile({ method: 'POST', token });

const bootstrap = (token?: string) =>
  api.request('/v1/me/bootstrap', {
    headers: { authorization: `Bearer ${token ?? memberToken}` },
  });

/** Service-key Storage client for fixture cleanup only (direct deletes from storage.objects fail). */
function storageAdmin() {
  return createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage;
}

async function removeAssetObjects(tenantId: string, assetId: string): Promise<void> {
  const rows = await adminSql<{ name: string }[]>`
    select name from storage.objects
     where bucket_id = 'media' and name like ${`${tenantId}/media/${assetId}/%`}`;
  if (rows.length === 0) return;
  await storageAdmin()
    .from('media')
    .remove(rows.map((row) => row.name));
}

/** Put every touched profile back exactly as `pnpm db:seed` leaves it, and remove every fixture. */
async function restoreSeededProfile(): Promise<void> {
  for (const userId of [memberUserId, labUserId].filter(Boolean)) {
    await adminSql`
      update public.member_profiles
         set bio = null, avatar_asset_id = null, nudge_dismissed_at = null
       where user_id = ${userId}::uuid`;
  }
  if (memberUserId) {
    await adminSql`
      update public.member_profiles set display_name = ${seededDisplayName}
       where user_id = ${memberUserId}::uuid`;
  }
  for (const { assetId, tenantId } of createdAssets) {
    await removeAssetObjects(tenantId, assetId);
    await adminSql`delete from public.media_assets where id = ${assetId}::uuid`;
    await adminSql`
      delete from pgboss.job_common
       where name = 'kernel.media-derive-variants' and singleton_key = ${assetId}`;
  }
  createdAssets.length = 0;
  createdAssetIds.length = 0;
}

/** A seed user's id, tenant and the name its membership's profile carries (D-310: the profile is
 * the name of record; the seed writes it explicitly). */
async function identity(email: string): Promise<{ id: string; name: string; tenantId: string }> {
  const [row] = await adminSql<{ id: string; name: string; tenant_id: string }[]>`
    select u.id, mp.display_name as name, m.tenant_id
      from public.users u
      join public.memberships m on m.user_id = u.id
      join public.member_profiles mp on mp.membership_id = m.id
     where u.email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return { id: row.id, name: row.name, tenantId: row.tenant_id };
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  await removeIdentitiesByPrefix(PER_COMMUNITY_PREFIX);
  memberToken = await signInAs(MEMBER_EMAIL, SEED_PASSWORD);
  neighbourToken = await signInAs(NEIGHBOUR_EMAIL, SEED_PASSWORD);
  labToken = await signInAs(LAB_MEMBER_EMAIL, SEED_PASSWORD);

  const member = await identity(MEMBER_EMAIL);
  memberUserId = member.id;
  demoTenantId = member.tenantId;
  seededDisplayName = member.name;

  const lab = await identity(LAB_MEMBER_EMAIL);
  labUserId = lab.id;
  labTenantId = lab.tenantId;

  await restoreSeededProfile();
});

afterAll(async () => {
  await removeIdentitiesByPrefix(PER_COMMUNITY_PREFIX);
  await restoreSeededProfile();
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('tracer — a member reads, renames, writes a bio, sets a real photo, and the bootstrap serves it (PROF-01/TENANT-04)', () => {
  let assetId = '';

  it('1. GET /v1/me/profile answers the row the membership trigger created, with the nudge pending', async () => {
    const res = await getProfile();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = ownProfileSchema.parse(await res.json());

    // R-08: the row exists EAGERLY — nobody had to visit a screen to create it — and its display
    // name was seeded from `users.name` by `app.ensure_member_profile`.
    expect(body.displayName).toBe(seededDisplayName);
    expect(body.bio).toBeNull();
    expect(body.avatarAssetId).toBeNull();
    expect(body.avatarUrl).toBeNull();
    expect(body.email).toBe(MEMBER_EMAIL);
    expect(body.nudgeDismissedAt).toBeNull();
    // D-02/R-13: neither photo nor bio, never dismissed -> the first-access card is due.
    expect(body.needsNudge).toBe(true);

    const [profileRow] = await adminSql<{ membership_id: string }[]>`
      select membership_id from public.member_profiles where user_id = ${memberUserId}::uuid`;
    expect(body.membershipId).toBe(profileRow?.membership_id);
  });

  it('2. PATCH name + bio lands in the bootstrap, and users.name — the identity anchor — is untouched (D-46)', async () => {
    const res = await patchProfile({
      displayName: 'Joana Ribeiro',
      bio: 'Curadora de conteúdo.',
    });
    expect(res.status).toBe(200);
    const patched = ownProfileSchema.parse(await res.json());
    expect(patched.displayName).toBe('Joana Ribeiro');
    expect(patched.bio).toBe('Curadora de conteúdo.');

    const boot = await bootstrap();
    expect(boot.status).toBe(200);
    // Pitfall 9: the FROZEN contract still parses — the profile got real, the shape did not grow.
    const body = bootstrapSchema.parse(await boot.json());
    expect(body.membership.profile.displayName).toBe('Joana Ribeiro');
    expect(body.membership.profile.bio).toBe('Curadora de conteúdo.');
    expect(body.membership.profile.avatarUrl).toBeNull();

    // D-46: the tenant profile is overwritten; the identity anchor staff search on is not.
    const [user] = await adminSql<{ name: string }[]>`
      select name from public.users where id = ${memberUserId}::uuid`;
    expect(user?.name).toBe(seededDisplayName);
  });

  it('3. a real upload through the 03-01 broker becomes the photo, served through the stable /w128 URL', async () => {
    assetId = await makeAsset(memberToken, demoTenantId);

    const res = await patchProfile({ avatarAssetId: assetId });
    expect(res.status).toBe(200);
    const patched = ownProfileSchema.parse(await res.json());
    expect(patched.avatarAssetId).toBe(assetId);
    // TENANT-04: a STABLE serving path, never an inline signed Storage URL.
    expect(patched.avatarUrl).toBe(`/v1/media/${assetId}/w128`);
    expect(patched.needsNudge).toBe(false);

    const boot = await bootstrap();
    const body = bootstrapSchema.parse(await boot.json());
    expect(body.membership.profile.avatarUrl).toBe(`/v1/media/${assetId}/w128`);

    // The URL is real: the broker 302s it to a freshly signed Storage URL, tenant-checked per fetch.
    const served = await api.request(`/v1/media/${assetId}/w128`, {
      headers: { authorization: `Bearer ${memberToken}` },
      redirect: 'manual',
    });
    expect(served.status).toBe(302);
    expect(served.headers.get('location')).toContain('/object/sign/media/');
  });

  it('4. POST /v1/me/profile/dismiss-nudge is server state and idempotent (D-02/R-13)', async () => {
    // Put the member back in the "incomplete profile" state so the nudge is genuinely due.
    await patchProfile({ avatarAssetId: null, bio: null });
    const due = ownProfileSchema.parse(await (await getProfile()).json());
    expect(due.needsNudge).toBe(true);

    const first = await postDismissNudge();
    expect(first.status).toBe(200);
    const dismissed = ownProfileSchema.parse(await first.json());
    expect(dismissed.needsNudge).toBe(false);
    expect(dismissed.nudgeDismissedAt).not.toBeNull();

    const second = ownProfileSchema.parse(await (await postDismissNudge()).json());
    expect(second.needsNudge).toBe(false);
    // `coalesce(nudge_dismissed_at, now())`: the recorded moment is the FIRST refusal, always.
    expect(second.nudgeDismissedAt).toBe(dismissed.nudgeDismissedAt);

    // A brand-new session on another device reads the same server state — the card stays gone.
    const freshToken = await signInAs(MEMBER_EMAIL, SEED_PASSWORD);
    const elsewhere = ownProfileSchema.parse(await (await getProfile(freshToken)).json());
    expect(elsewhere.needsNudge).toBe(false);
  });

  it('5. a PATCH with no recognised key is refused before it reaches the database', async () => {
    const res = await patchProfile({});
    expect(res.status).toBe(400);
    expect(((await res.json()) as Envelope).error.code).toBe('VALIDATION_FAILED');
  });
});

describe('caps and empties — every refusal carries a code the form can switch on (PROF-01)', () => {
  const issuePaths = (envelope: Envelope): string[] =>
    ((envelope.error.details?.issues as { path: string }[] | undefined) ?? []).map((i) => i.path);

  it('6. a whitespace-only display name answers 400 with details.displayName = "required"', async () => {
    const res = await patchProfile({ displayName: '   ' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details?.displayName).toBe('required');
    expect(issuePaths(body)).toContain('displayName');
  });

  it('7. a 61-character display name is too long; 60 is accepted', async () => {
    const res = await patchProfile({ displayName: 'x'.repeat(61) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Envelope;
    expect(issuePaths(body)).toContain('displayName');
    expect(body.error.details?.displayName).toBe('too_long');

    const ok = await patchProfile({ displayName: 'y'.repeat(60) });
    expect(ok.status).toBe(200);
  });

  it('8. a 151-character bio is too long; 150 is accepted', async () => {
    const res = await patchProfile({ bio: 'x'.repeat(151) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Envelope;
    expect(issuePaths(body)).toContain('bio');
    expect(body.error.details?.bio).toBe('too_long');

    const ok = await patchProfile({ bio: 'z'.repeat(150) });
    expect(ok.status).toBe(200);
    expect(ownProfileSchema.parse(await ok.json()).bio).toBe('z'.repeat(150));
  });

  it('9. a whitespace-only bio is stored as SQL NULL, never as an empty string', async () => {
    const res = await patchProfile({ bio: '   ' });
    expect(res.status).toBe(200);
    expect(ownProfileSchema.parse(await res.json()).bio).toBeNull();
    // The distinction matters: `''` would make "sem bio" render an empty paragraph instead of the
    // placeholder, and would break the `bio is null` half of `needsNudge`.
    const stored = await storedProfile(memberUserId);
    expect(stored?.bio).toBeNull();
  });

  it('10. a bio is normalised BEFORE it is measured, and newlines are the only structure kept', async () => {
    const res = await patchProfile({ bio: `  linha um\r\n\n\n\n\nlinha dois  ` });
    expect(res.status).toBe(200);
    expect(ownProfileSchema.parse(await res.json()).bio).toBe('linha um\n\nlinha dois');
  });
});

describe('avatar lifecycle — replace-on-write retires the outgoing asset (R-07, T-03-13)', () => {
  it('11. replacing a photo soft-deletes the previous asset and leaves the new one alone', async () => {
    const a = await makeAsset(memberToken, demoTenantId);
    expect((await patchProfile({ avatarAssetId: a })).status).toBe(200);

    const b = await makeAsset(memberToken, demoTenantId);
    const replaced = await patchProfile({ avatarAssetId: b });
    expect(replaced.status).toBe(200);
    expect(ownProfileSchema.parse(await replaced.json()).avatarAssetId).toBe(b);

    expect(await assetStatus(a)).toEqual({ status: 'deleted', deleted: true });
    expect(await assetStatus(b)).toEqual({ status: 'ready', deleted: false });
  });

  it('12. `{ avatarAssetId: null }` removes the photo and retires the asset it pointed at', async () => {
    const stored = await storedProfile(memberUserId);
    const current = stored?.avatar_asset_id;
    expect(current).not.toBeNull();

    const removed = await patchProfile({ avatarAssetId: null });
    expect(removed.status).toBe(200);
    const body = ownProfileSchema.parse(await removed.json());
    expect(body.avatarAssetId).toBeNull();
    expect(body.avatarUrl).toBeNull();
    if (current) expect(await assetStatus(current)).toEqual({ status: 'deleted', deleted: true });
  });

  it('13. every rejected avatar answers the SAME `invalid` — no existence oracle (T-03-13)', async () => {
    const neighbour = await identity(NEIGHBOUR_EMAIL);
    const cases: [string, string][] = [
      // A well-formed id that names nothing at all.
      ['a random uuid', '00000000-0000-4000-8000-0000000000ff'],
      // A real, ready asset of the caller's — but `purpose = 'post'`, not an avatar.
      ["the caller's own purpose:'post' image", await makeAsset(memberToken, demoTenantId, 'post')],
      // A real avatar in the SAME tenant, owned by someone else: the owner check, not just tenant.
      ["a neighbour's avatar in the same tenant", await makeAsset(neighbourToken, demoTenantId)],
      // A tenant-B asset: invisible to this lane, so it takes the same branch a nonexistent id does.
      ["a tenant-B member's avatar", await makeAsset(labToken, labTenantId)],
    ];

    for (const [label, candidate] of cases) {
      const res = await patchProfile({ avatarAssetId: candidate });
      expect(res.status, label).toBe(400);
      const body = (await res.json()) as Envelope;
      expect(body.error.code, label).toBe('VALIDATION_FAILED');
      expect(body.error.details?.avatarAssetId, label).toBe('invalid');
      // The refusal must not disclose the other party: no tenant, no owner, no status.
      expect(JSON.stringify(body), label).not.toContain('rede-lab');
      expect(JSON.stringify(body), label).not.toContain(neighbour.id);
    }

    // And the refused ids are untouched — a failed PATCH never retires someone else's asset.
    for (const [, candidate] of cases.slice(1)) {
      expect((await assetStatus(candidate)).deleted).toBe(false);
    }
  });
});

describe('the first-access nudge is server state (D-02/R-13)', () => {
  /**
   * There is deliberately no "un-dismiss" route — dismissal is final by design — so putting the
   * member back in the pre-nudge state is a FIXTURE operation, not something the API offers.
   */
  const resetNudge = () =>
    adminSql`update public.member_profiles set nudge_dismissed_at = null
              where user_id = ${memberUserId}::uuid`;

  it('14. the card shows while EITHER the photo or the bio is missing, and stops when both exist', async () => {
    await resetNudge();
    await patchProfile({ avatarAssetId: null, bio: null });
    expect(ownProfileSchema.parse(await (await getProfile()).json()).needsNudge).toBe(true);

    // Only a bio: still incomplete (UI-SPEC E5 partial).
    await patchProfile({ bio: 'Só a bio, por enquanto.' });
    expect(ownProfileSchema.parse(await (await getProfile()).json()).needsNudge).toBe(true);

    const photo = await makeAsset(memberToken, demoTenantId);
    await patchProfile({ avatarAssetId: photo });
    expect(ownProfileSchema.parse(await (await getProfile()).json()).needsNudge).toBe(false);
  });

  it('15. "Agora não" survives a still-incomplete profile — the dismissal is the rule, not the data', async () => {
    await resetNudge();
    await patchProfile({ avatarAssetId: null, bio: null });
    expect(ownProfileSchema.parse(await (await getProfile()).json()).needsNudge).toBe(true);

    const dismissed = ownProfileSchema.parse(await (await postDismissNudge()).json());
    expect(dismissed.needsNudge).toBe(false);
    const stored = ownProfileSchema.parse(await (await getProfile()).json());
    expect(stored.needsNudge).toBe(false);
    expect(stored.nudgeDismissedAt).toBe(dismissed.nudgeDismissedAt);
  });
});

describe('isolation and the promote invariant (TENANT-04, the 03-01 assumption-delta decision)', () => {
  it('16. a tenant-B member reads B’s own row and can never reach A’s', async () => {
    await patchProfile({ displayName: 'Joana de A' });
    const labRes = await getProfile(labToken);
    expect(labRes.status).toBe(200);
    const lab = ownProfileSchema.parse(await labRes.json());
    expect(lab.email).toBe(LAB_MEMBER_EMAIL);
    expect(lab.displayName).not.toBe('Joana de A');

    const a = await storedProfile(memberUserId);
    const b = await storedProfile(labUserId);
    expect(a?.tenant_id).toBe(demoTenantId);
    expect(b?.tenant_id).toBe(labTenantId);
    expect(a?.membership_id).not.toBe(b?.membership_id);
    expect(lab.membershipId).toBe(b?.membership_id);
  });

  it('17. PROMOTE INVARIANT: "my profile" and "a member’s profile" are ONE row', async () => {
    // 03-01's assumption-delta decision promoted the general representation: there is deliberately
    // no second storage path for "my own profile". Asserted here by requiring that what
    // `GET /v1/me/profile` returns for M is byte-for-byte the `member_profiles` row keyed by M's
    // membership — the SAME row 03-03's `GET /v1/members/{membershipId}` will read. When that route
    // lands it closes the loop by returning these same values for the same person.
    const photo = await makeAsset(memberToken, demoTenantId);
    await patchProfile({ displayName: 'Íris Muñoz', bio: 'Bio de teste.', avatarAssetId: photo });

    const mine = ownProfileSchema.parse(await (await getProfile()).json());
    const row = await storedProfile(memberUserId);

    expect(mine.membershipId).toBe(row?.membership_id);
    expect(mine.displayName).toBe(row?.display_name);
    expect(mine.bio).toBe(row?.bio);
    expect(mine.avatarAssetId).toBe(row?.avatar_asset_id);
    expect(mine.avatarUrl).toBe(`/v1/media/${row?.avatar_asset_id}/w128`);
  });
});

describe('per-community name tracer (08.1-04, D-310, SC 1)', () => {
  it('a rename on the rede-demo host changes rede-demo only: rede-lab keeps its own name everywhere', async () => {
    const shared = await createSharedIdentity({
      prefix: PER_COMMUNITY_PREFIX,
      memberships: [
        { host: 'demo', displayName: 'S em Demo' },
        { host: 'lab', displayName: 'S no Lab' },
      ],
    });
    const sharedToken = await signInAs(shared.email, shared.password);
    const [labMembership] = await adminSql<{ id: string }[]>`
      select m.id::text as id
        from public.memberships m
        join public.tenants t on t.id = m.tenant_id
       where t.slug = 'rede-lab' and m.user_id = ${shared.userId}::uuid`;
    if (!labMembership) throw new Error('the rede-lab membership of the fixture is missing');

    const on = (host: string) => ({
      authorization: `Bearer ${sharedToken}`,
      'x-tenant-host': host,
    });
    const bootstrapOn = async (host: string) => {
      const res = await api.request('/v1/me/bootstrap', { headers: on(host) });
      expect(res.status).toBe(200);
      return bootstrapSchema.parse(await res.json());
    };

    // Before: each host answers its own membership's name.
    expect((await bootstrapOn(HOSTS.demo)).user.name).toBe('S em Demo');
    expect((await bootstrapOn(HOSTS.lab)).user.name).toBe('S no Lab');

    // The rename runs on the rede-demo host; `membershipOfRecord(ctx)` picks that row only (T-08.1-24).
    const renamed = await api.request('/v1/me/profile', {
      method: 'PATCH',
      headers: { ...on(HOSTS.demo), 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Novo em Demo' }),
    });
    expect(renamed.status).toBe(200);
    expect(ownProfileSchema.parse(await renamed.json()).displayName).toBe('Novo em Demo');

    const demo = await bootstrapOn(HOSTS.demo);
    expect(demo.user.name).toBe('Novo em Demo');
    expect(demo.membership.profile.displayName).toBe('Novo em Demo');

    const lab = await bootstrapOn(HOSTS.lab);
    expect(lab.user.name).toBe('S no Lab');
    expect(lab.membership.profile.displayName).toBe('S no Lab');

    // A rede-lab member opening S's rede-lab profile sees the rede-lab name, never the new one.
    const seen = await api.request(`/v1/members/${labMembership.id}`, {
      headers: { authorization: `Bearer ${labToken}`, 'x-tenant-host': HOSTS.lab },
    });
    expect(seen.status).toBe(200);
    expect(memberProfileSchema.parse(await seen.json()).displayName).toBe('S no Lab');
  });
});
