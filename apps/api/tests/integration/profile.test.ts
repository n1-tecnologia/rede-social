import { createClient } from '@supabase/supabase-js';
import { bootstrapSchema } from '@tria/contracts';
import { ownProfileSchema } from '@tria/contracts/profiles';
import { sqlClient } from '@tria/core/db';
import { stopBoss } from '@tria/core/server/jobs/boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, SEED_PASSWORD, signInAs, uploadAvatar } from './setup';

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

const MEMBER_EMAIL = 'member@tria-demo.local';

let memberToken = '';
let memberUserId = '';
let demoTenantId = '';
/** The seeded state this file must put back, so a re-run starts from the same fixture. */
let seededDisplayName = '';

const createdAssetIds: string[] = [];

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

/** Put the seeded member back exactly as `pnpm db:seed` leaves them. */
async function restoreSeededProfile(): Promise<void> {
  await adminSql`
    update public.member_profiles
       set display_name = ${seededDisplayName}, bio = null, avatar_asset_id = null,
           nudge_dismissed_at = null
     where user_id = ${memberUserId}::uuid`;
  for (const assetId of [...new Set(createdAssetIds)]) {
    await removeAssetObjects(demoTenantId, assetId);
    await adminSql`delete from public.media_assets where id = ${assetId}::uuid`;
    await adminSql`
      delete from pgboss.job_common
       where name = 'kernel.media-derive-variants' and singleton_key = ${assetId}`;
  }
  createdAssetIds.length = 0;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  memberToken = await signInAs(MEMBER_EMAIL, SEED_PASSWORD);
  const [row] = await adminSql<{ id: string; name: string; tenant_id: string }[]>`
    select u.id, u.name, m.tenant_id
      from public.users u
      join public.memberships m on m.user_id = u.id
     where u.email = ${MEMBER_EMAIL}`;
  if (!row) throw new Error('the tria-demo member is not seeded');
  memberUserId = row.id;
  demoTenantId = row.tenant_id;
  seededDisplayName = row.name;
  await restoreSeededProfile();
});

afterAll(async () => {
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
    assetId = await uploadAvatar(memberToken);
    createdAssetIds.push(assetId);

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
