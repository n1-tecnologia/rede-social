import { createClient } from '@supabase/supabase-js';
import { TENANT_HOST_HEADER } from '@tria/contracts';
import { sqlClient } from '@tria/core/db';
import { stopBoss } from '@tria/core/server/jobs/boss';
import { moduleFlags } from '@tria/core/server/modules/flags-cache';
import type { ExampleItem } from '@tria/module-example/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, authAdmin, HOSTS, SEED_PASSWORD, signInAs, uploadAvatar } from './setup';

/**
 * TENANT-05 — the phase's exit gate at the API level, and every later phase's regression gate.
 *
 * The rule this file exists to enforce (ROADMAP cross-cutting): **every new endpoint adds a
 * cross-tenant case here.** The question it answers is always the same one — "can a session of
 * tenant A ever see, name or touch a row of tenant B?" — asked once per shape of answer (list,
 * detail, empty, disabled, blocked, wrong host, platform identity, public host lookup).
 *
 * TENANT-05 adjacency: both seeded tenants get items with the SAME title and their members share
 * the `member@…` local part, so a leak that matched on a value rather than on `tenant_id` cannot
 * pass by looking plausible. Every assertion below compares IDS, never contents.
 *
 * Phase 3 (03-08) grew the file to every surface that phase added — the private `media` bucket's
 * signed URLs, the provider's playback tokens, the member directory and the profile's avatar gate —
 * because SCHEMA-CONVENTIONS §(j) rule 2 makes that mandatory, not optional: every new table,
 * endpoint, bucket and topic re-runs this matrix. Those cases were LIFTED from `media.test.ts`,
 * `media-playback.test.ts`, `members.test.ts` and `profile.test.ts` rather than re-derived, which is
 * the whole point of a shared suite: one place where the whole matrix runs.
 *
 * **Every Phase 3 case asserts the POSITIVE CONTROL beside its negative** — each community really
 * can reach its OWN asset, member and profile. Without that, a globally broken route (a 404 for
 * everyone, a disabled module, a dead migration) would make the isolation assertion pass vacuously
 * and certify a guarantee that had stopped existing (T-03-56).
 *
 * Deeper single-concern cases already live elsewhere and are deliberately NOT duplicated here:
 *   - `auth-middleware.test.ts` — token verification, blocked/suspended semantics, host matching
 *   - `bootstrap.test.ts`       — the bootstrap payload itself
 *   - `example.test.ts`         — the module's guard chain, transactional enqueue and job RLS
 *   - `modules.test.ts`         — requireModule/requireRole ordering and the flags cache
 *   - `supabase/tests/020-tenant-isolation.sql` — the same isolation proved inside Postgres
 */

type Envelope = { error: { code: string; message: string; details?: unknown } };
type BootstrapBody = { tenant: { id: string; slug: string }; modules: { key: string }[] };

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'ferramentas@triacompany.com.br';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

/** Adjacency: the SAME title in both tenants, so only the id can tell the rows apart. */
const SHARED_TITLE = 'Reunião';
const RUN = Date.now();
const EMPTY_SLUG = `tria-empty-${RUN}`.slice(0, 40);
const SUSPENDED_SLUG = `tria-susp-${RUN}`.slice(0, 40);
const EMPTY_HOST = `tria-empty-${RUN}.localhost`;
const SUSPENDED_HOST = `tria-susp-${RUN}.localhost`;
const THROWAWAY_PASSWORD = 'Segredo123';

const tokens = {
  demoMember: '',
  labMember: '',
  demoAdmin: '',
  labAdmin: '',
  emptyMember: '',
  blockedMember: '',
  superAdmin: '',
};
const tenantIds = { demo: '', lab: '', empty: '', suspended: '' };
const itemIds = { demo: [] as string[], lab: [] as string[] };
const throwawayUsers: string[] = [];
let blockedUserId = '';

/** Phase 3 fixtures: a ready image and a ready video on EACH side, so every negative has a control. */
const assets = { demoImage: '', labImage: '', demoVideo: '', labVideo: '' };
const mediaAssetIds: string[] = [];
const displayNames = { demo: '', lab: '' };
const membershipIds = { demo: '', lab: '' };

const request = (path: string, token?: string, headers: Record<string, string> = {}) =>
  api.request(path, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });

const code = async (res: Response) => ((await res.json()) as Envelope).error.code;

async function tenantIdBySlug(slug: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id from public.tenants where slug = ${slug}`;
  if (!row) throw new Error(`tenant ${slug} is not seeded — run pnpm db:seed first`);
  return row.id;
}

/** Inserts straight through the admin connection: rows the other tenant's lane must never return. */
async function seedItem(tenantId: string, title: string): Promise<string> {
  const [user] = await adminSql<{ id: string }[]>`
    select u.id from public.users u
      join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${tenantId}::uuid limit 1`;
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.example_items (tenant_id, title, created_by_user_id)
    values (${tenantId}::uuid, ${title}, ${user?.id ?? null}::uuid)
    returning id`;
  if (!row) throw new Error('failed to seed an example item');
  return row.id;
}

async function throwawayMember(tenantId: string, email: string): Promise<string> {
  const { data, error } = await authAdmin().createUser({
    email,
    password: THROWAWAY_PASSWORD,
    email_confirm: true,
    user_metadata: { name: 'Isolamento' },
  });
  if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message}`);
  throwawayUsers.push(data.user.id);
  await adminSql`
    insert into public.memberships (tenant_id, user_id, role, status)
    values (${tenantId}::uuid, ${data.user.id}::uuid, 'member', 'active')`;
  return signInAs(email, THROWAWAY_PASSWORD);
}

/**
 * A READY video in a known state, written directly (the `media-playback.test.ts` fixture). The
 * ingest path is 03-06's subject and is proved end to end there; what matters here is what the
 * playback endpoint does to a row, which does not depend on how the row got there.
 */
async function seedVideo(tenantId: string, email: string, filename: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, duration_seconds, aspect_ratio, filename, ready_at)
    select ${tenantId}::uuid, u.id, 'video', 'post', 'ready', 'fake',
           ${`fake-iso-${crypto.randomUUID()}`}, ${`fake-playback-iso-${filename}`},
           'video/mp4', 1048576, 12, '16:9', ${filename}, now()
      from public.users u where u.email = ${email}
    returning id`;
  if (!row) throw new Error(`could not seed a video for ${email}`);
  mediaAssetIds.push(row.id);
  return row.id;
}

/**
 * Service-key Storage client for fixture cleanup only (direct deletes from `storage.objects` are
 * refused — the 02-13 finding). Built here like `authAdmin()` rather than importing
 * `@tria/core/server/supabase-admin`, which Biome confines to the kernel's admin lane.
 */
function storageAdmin() {
  return createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_SERVICE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  }).storage;
}

async function removeMediaObjects(tenantId: string, assetId: string): Promise<void> {
  const rows = await adminSql<{ name: string }[]>`
    select name from storage.objects
     where bucket_id = 'media' and name like ${`${tenantId}/media/${assetId}/%`}`;
  if (rows.length === 0) return;
  await storageAdmin()
    .from('media')
    .remove(rows.map((row) => row.name));
}

async function displayNameOf(tenantId: string, email: string): Promise<string> {
  const [row] = await adminSql<{ display_name: string }[]>`
    select p.display_name from public.member_profiles p
      join public.users u on u.id = p.user_id
     where p.tenant_id = ${tenantId}::uuid and u.email = ${email}`;
  if (!row) throw new Error(`${email} has no profile in ${tenantId}`);
  return row.display_name;
}

async function membershipIdOf(tenantId: string, email: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select m.id from public.memberships m
      join public.users u on u.id = m.user_id
     where m.tenant_id = ${tenantId}::uuid and u.email = ${email}`;
  if (!row) throw new Error(`${email} is not a member of ${tenantId}`);
  return row.id;
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  if (!SUPER_ADMIN_PASSWORD) {
    throw new Error('SUPER_ADMIN_PASSWORD is required (same value as `pnpm db:seed`)');
  }

  tenantIds.demo = await tenantIdBySlug('tria-demo');
  tenantIds.lab = await tenantIdBySlug('tria-lab');

  // Identical-looking content on both sides (TENANT-05 adjacency).
  itemIds.demo = [
    await seedItem(tenantIds.demo, SHARED_TITLE),
    await seedItem(tenantIds.demo, SHARED_TITLE),
  ];
  itemIds.lab = [
    await seedItem(tenantIds.lab, SHARED_TITLE),
    await seedItem(tenantIds.lab, SHARED_TITLE),
  ];

  // A third tenant with the module ENABLED and zero rows: "empty" must be 200 [], never 404/500.
  const [empty] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version)
    values (${EMPTY_SLUG}, 'Comunidade Vazia', 'Regras de teste.', 1)
    returning id`;
  tenantIds.empty = empty?.id ?? '';
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantIds.empty}::uuid, 'example', true)`;
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
    values (${tenantIds.empty}::uuid, ${EMPTY_HOST}, true, now())`;

  // A SUSPENDED tenant with a verified host: the public host lookup STILL resolves it, carrying
  // status 'suspended' so the "indisponível" screen is branded (D-32); members are refused by requireAuth.
  const [suspended] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version, status)
    values (${SUSPENDED_SLUG}, 'Comunidade Suspensa', 'Regras de teste.', 1, 'suspended')
    returning id`;
  tenantIds.suspended = suspended?.id ?? '';
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
    values (${tenantIds.suspended}::uuid, ${SUSPENDED_HOST}, true, now())`;

  tokens.demoMember = await signInAs('member@tria-demo.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@tria-lab.local', SEED_PASSWORD);
  tokens.demoAdmin = await signInAs('admin@tria-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@tria-lab.local', SEED_PASSWORD);
  tokens.superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  tokens.emptyMember = await throwawayMember(tenantIds.empty, `member@${EMPTY_SLUG}.local`);
  tokens.blockedMember = await throwawayMember(tenantIds.demo, `blocked-${RUN}@tria-demo.local`);
  blockedUserId = throwawayUsers[throwawayUsers.length - 1] ?? '';

  for (const id of [tenantIds.demo, tenantIds.lab, tenantIds.empty]) moduleFlags.invalidate(id);

  // Phase 3 fixtures. A REAL upload on each side (start -> PUT straight to Storage -> complete ->
  // the worker derives the ladder), so the signed-URL case runs against objects that really exist.
  assets.demoImage = await uploadAvatar(tokens.demoMember);
  assets.labImage = await uploadAvatar(tokens.labMember);
  mediaAssetIds.push(assets.demoImage, assets.labImage);
  assets.demoVideo = await seedVideo(
    tenantIds.demo,
    'admin@tria-demo.local',
    'privado-da-demo.mp4',
  );
  assets.labVideo = await seedVideo(tenantIds.lab, 'admin@tria-lab.local', 'privado-do-lab.mp4');

  displayNames.demo = await displayNameOf(tenantIds.demo, 'member@tria-demo.local');
  displayNames.lab = await displayNameOf(tenantIds.lab, 'member@tria-lab.local');
  membershipIds.demo = await membershipIdOf(tenantIds.demo, 'member@tria-demo.local');
  membershipIds.lab = await membershipIdOf(tenantIds.lab, 'member@tria-lab.local');
});

afterAll(async () => {
  for (const [tenantId, assetId] of [
    [tenantIds.demo, assets.demoImage],
    [tenantIds.lab, assets.labImage],
  ] as const) {
    if (assetId) await removeMediaObjects(tenantId, assetId);
  }
  // `uploadAvatar` only creates the asset — no profile row points at it here — so the rows can be
  // deleted outright once their objects are gone.
  for (const id of [...new Set(mediaAssetIds)].filter(Boolean)) {
    await adminSql`delete from public.media_assets where id = ${id}::uuid`;
  }

  const items = [...itemIds.demo, ...itemIds.lab];
  if (items.length > 0) {
    await adminSql`delete from public.example_items where id = any(${items}::uuid[])`;
  }
  for (const userId of throwawayUsers) await authAdmin().deleteUser(userId);
  await adminSql`delete from public.tenants where slug in (${EMPTY_SLUG}, ${SUSPENDED_SLUG})`;
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('TENANT-05 — the two-tenant isolation gate', () => {
  it('a. list: a tria-demo member gets tria-demo ids only, never a tria-lab id', async () => {
    const res = await request('/v1/example/items', tokens.demoMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(res.status).toBe(200);

    const { items } = (await res.json()) as { items: ExampleItem[] };
    const ids = new Set(items.map((i) => i.id));
    for (const id of itemIds.demo) expect(ids.has(id)).toBe(true);
    for (const id of itemIds.lab) expect(ids.has(id)).toBe(false);
    // Adjacency: both tenants have rows with this exact title, so the title proves nothing — the
    // tenant_id of every returned row is what must hold.
    expect(items.filter((i) => i.title === SHARED_TITLE)).toHaveLength(itemIds.demo.length);
    expect(items.every((i) => i.tenantId === tenantIds.demo)).toBe(true);
  });

  it("b. detail: the other tenant's id is 404 NOT_FOUND, never 403", async () => {
    for (const labId of itemIds.lab) {
      const res = await request(`/v1/example/items/${labId}`, tokens.demoMember, {
        [TENANT_HOST_HEADER]: HOSTS.demo,
      });
      // 404, not 403: a 403 would confirm the row exists somewhere.
      expect(res.status).toBe(404);
      expect(await code(res)).toBe('NOT_FOUND');
    }
  });

  it('c. disabled: tria-lab has no example module — read and write are both 404 MODULE_DISABLED', async () => {
    const list = await request('/v1/example/items', tokens.labMember, {
      [TENANT_HOST_HEADER]: HOSTS.lab,
    });
    expect(list.status).toBe(404);
    expect(await code(list)).toBe('MODULE_DISABLED');

    const write = await api.request('/v1/example/items', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.labMember}`,
        'content-type': 'application/json',
        [TENANT_HOST_HEADER]: HOSTS.lab,
      },
      body: JSON.stringify({ title: SHARED_TITLE }),
    });
    // MODULE_DISABLED wins over the role check: "not here" never degrades into "not allowed".
    expect(write.status).toBe(404);
    expect(await code(write)).toBe('MODULE_DISABLED');
  });

  it('d. empty: a tenant with the module enabled and zero rows gets 200 { items: [] }', async () => {
    const res = await request('/v1/example/items', tokens.emptyMember, {
      [TENANT_HOST_HEADER]: EMPTY_HOST,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
    // …while the other tenants demonstrably do have rows, so the empty answer is not a global outage.
    const demo = await request('/v1/example/items', tokens.demoMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(((await demo.json()) as { items: ExampleItem[] }).items.length).toBeGreaterThan(0);
  });

  it('e. blocked: a member blocked between two requests is refused on the very next one', async () => {
    const before = await request('/v1/example/items', tokens.blockedMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(before.status).toBe(200);

    await adminSql`
      update public.memberships set status = 'blocked', blocked_at = now()
       where user_id = ${blockedUserId}::uuid`;

    // Same still-valid token: the membership is re-read per request, so there is no window (AUTH-06).
    const after = await request('/v1/example/items', tokens.blockedMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(after.status).toBe(403);
    expect(await code(after)).toBe('MEMBERSHIP_BLOCKED');
  });

  it('f. the tenant comes from the membership: a cookie and an unknown host cannot change it (D-23)', async () => {
    const res = await request('/v1/me/bootstrap', tokens.demoMember, {
      cookie: 'tenant_slug=tria-lab',
      [TENANT_HOST_HEADER]: 'tria-lab.example',
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as BootstrapBody;
    // The request says tria-lab three ways; the membership says tria-demo. The membership wins.
    expect(body.tenant.slug).toBe('tria-demo');
    expect(body.tenant.id).toBe(tenantIds.demo);
  });

  it("f2. a session of tenant A presented on tenant B's REGISTERED host is 403, on every route (D-23)", async () => {
    for (const path of ['/v1/me/bootstrap', '/v1/example/items']) {
      const res = await request(path, tokens.demoMember, { [TENANT_HOST_HEADER]: HOSTS.lab });
      expect(res.status).toBe(403);

      const text = await res.text();
      const envelope = JSON.parse(text) as Envelope;
      expect(envelope.error.code).toBe('TENANT_HOST_MISMATCH');
      // The refusal must not say which community lives at that address, nor leak a row.
      expect(envelope.error.details).toBeUndefined();
      for (const needle of ['tria-lab', 'TRIA Lab', 'tria-demo', SHARED_TITLE]) {
        expect(text).not.toContain(needle);
      }
      for (const id of itemIds.lab) expect(text).not.toContain(id);
    }

    // Symmetric: the lab member on the demo host is refused the same way.
    const reverse = await request('/v1/me/bootstrap', tokens.labMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(reverse.status).toBe(403);
    expect(await code(reverse)).toBe('TENANT_HOST_MISMATCH');
  });

  it('g. the platform identity is not a member of anything: 403 NO_MEMBERSHIP off a tenant host', async () => {
    const res = await request('/v1/example/items', tokens.superAdmin);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('NO_MEMBERSHIP');
  });

  it('g2. …and on a tenant host it is a host mismatch, not a membership answer (D-23)', async () => {
    const res = await request('/v1/example/items', tokens.superAdmin, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('TENANT_HOST_MISMATCH');
  });

  it('h. bootstrap is scoped to the tenant: tria-lab sees exactly [events, feed]', async () => {
    const res = await request('/v1/me/bootstrap', tokens.labMember, {
      [TENANT_HOST_HEADER]: HOSTS.lab,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BootstrapBody;
    // D-17 pins tria-lab to exactly ['events','feed'] — case (c)'s MODULE_DISABLED depends on it.
    expect(body.modules.map((m) => m.key)).toEqual(['events', 'feed']);
    expect(body.tenant.id).toBe(tenantIds.lab);
  });

  it('i. the public host lookup answers about one tenant only; a suspended host answers with its status (D-20, D-32)', async () => {
    const lab = await api.request(
      `/v1/public/tenants/by-host?host=${encodeURIComponent(HOSTS.lab)}`,
    );
    expect(lab.status).toBe(200);
    const labText = await lab.text();
    // Brand and host facts (02-01); the exact key set is pinned in hosts.test.ts.
    expect(JSON.parse(labText)).toMatchObject({ slug: 'tria-lab', displayName: 'TRIA Lab' });
    // Unauthenticated and pre-login: it may name the tenant on THIS host and nothing else.
    expect(labText).not.toContain('tria-demo');
    expect(labText).not.toContain('#7c3aed');

    // D-32: the public shell still resolves a suspended tenant's host — branded screen, no login.
    const suspended = await api.request(
      `/v1/public/tenants/by-host?host=${encodeURIComponent(SUSPENDED_HOST)}`,
    );
    expect(suspended.status).toBe(200);
    expect(await suspended.json()).toMatchObject({
      slug: SUSPENDED_SLUG,
      status: 'suspended',
    });
  });
});

/**
 * Phase 3's surface (03-08): the private `media` bucket, the video provider's playback tokens, the
 * member directory and the profile's avatar gate. Same question, same two communities, same
 * case-letter convention — and every negative carries its positive control in the SAME test, so a
 * globally broken route cannot make an isolation assertion pass vacuously (T-03-56).
 */
describe('TENANT-04 — the Phase 3 surface: media, playback, members, profile', () => {
  it("j. Storage signed URL: tenant B cannot obtain one for tenant A's object (criterion 4)", async () => {
    const foreign = await api.request(`/v1/media/${assets.demoImage}/w320`, {
      headers: { authorization: `Bearer ${tokens.labMember}` },
      redirect: 'manual',
    });
    // 404 with NO redirect: the key is built from the CALLER's own tenant id, so B's request
    // resolves under B's prefix, where nothing exists. Isolation is structural, not check-dependent.
    expect(foreign.status).toBe(404);
    expect(foreign.headers.get('location')).toBeNull();

    const body = JSON.stringify(await foreign.json());
    for (const needle of ['tria-demo', 'TRIA Demo', tenantIds.demo, displayNames.demo]) {
      expect(body).not.toContain(needle);
    }

    // Positive control — each community really can reach its OWN asset, so the 404 above is about
    // the caller and not about a dead route.
    for (const [token, assetId, tenantId] of [
      [tokens.demoMember, assets.demoImage, tenantIds.demo],
      [tokens.labMember, assets.labImage, tenantIds.lab],
    ] as const) {
      const own = await api.request(`/v1/media/${assetId}/w320`, {
        headers: { authorization: `Bearer ${token}` },
        redirect: 'manual',
      });
      expect(own.status).toBe(302);
      expect(own.headers.get('location')).toContain(`${tenantId}/media/${assetId}/w320.webp`);
    }
  });

  it("k. playback token: tenant B's admin cannot mint one for tenant A's ready video", async () => {
    const foreign = await request(`/v1/media/${assets.demoVideo}/playback`, tokens.labAdmin);
    expect(foreign.status).toBe(404);

    const raw = await foreign.text();
    // Not just "no valid token" — the word `tokens` and the playback id must not appear at all.
    expect(raw).not.toContain('tokens');
    expect(raw).not.toContain('playbackId');
    expect(raw).not.toContain('fake-playback-iso-privado-da-demo.mp4');
    expect(raw).not.toContain('privado-da-demo');

    // Positive control — each community mints tokens for its own video.
    for (const [token, assetId] of [
      [tokens.demoAdmin, assets.demoVideo],
      [tokens.labAdmin, assets.labVideo],
    ] as const) {
      const own = await request(`/v1/media/${assetId}/playback`, token);
      expect(own.status).toBe(200);
      const payload = (await own.json()) as { tokens: { playback: string } };
      expect(payload.tokens.playback.length).toBeGreaterThan(0);
    }
  });

  it("l. completing tenant A's assetId from B takes the same 404 a nonexistent id gets", async () => {
    const res = await api.request(`/v1/media/uploads/${assets.demoImage}/complete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.labMember}` },
    });
    expect(res.status).toBe(404);
    const { error } = (await res.json()) as Envelope;
    expect((error.details as { media?: string } | undefined)?.media).toBe('object_missing');
  });

  it("m. deleting tenant A's asset from B answers 404 and leaves A's row untouched", async () => {
    const res = await api.request(`/v1/media/${assets.demoImage}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tokens.labMember}` },
    });
    expect(res.status).toBe(404);

    const [row] = await adminSql<{ status: string; tenant_id: string }[]>`
      select status, tenant_id from public.media_assets where id = ${assets.demoImage}::uuid`;
    expect(row?.status).toBe('ready');
    expect(row?.tenant_id).toBe(tenantIds.demo);
  });

  it("n. the directory: B cannot open A's membershipId and never lists A's names", async () => {
    const detail = await request(`/v1/members/${membershipIds.demo}`, tokens.labMember);
    expect(detail.status).toBe(404);
    const refusal = JSON.stringify(await detail.json());
    expect(refusal).not.toContain('tria-demo');
    expect(refusal).not.toContain(displayNames.demo);

    const list = await request('/v1/members?limit=50', tokens.labMember);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as {
      items: { membershipId: string; displayName: string }[];
    };
    expect(listed.items.map((i) => i.membershipId)).not.toContain(membershipIds.demo);
    expect(listed.items.map((i) => i.displayName)).not.toContain(displayNames.demo);

    // Positive control — each community sees its own member in its own directory.
    expect(listed.items.map((i) => i.membershipId)).toContain(membershipIds.lab);
    const ownDetail = await request(`/v1/members/${membershipIds.demo}`, tokens.demoMember);
    expect(ownDetail.status).toBe(200);
  });

  it("o. the avatar gate: B cannot point its profile at A's asset (400 invalid, no oracle)", async () => {
    const res = await api.request('/v1/me/profile', {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${tokens.labMember}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ avatarAssetId: assets.demoImage }),
    });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as Envelope;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect((error.details as { avatarAssetId?: string } | undefined)?.avatarAssetId).toBe(
      'invalid',
    );
    // The refusal names nothing about the other community, and A's asset is untouched by it.
    expect(JSON.stringify(error)).not.toContain('tria-demo');
    const [row] = await adminSql<{ deleted_at: string | null }[]>`
      select deleted_at from public.media_assets where id = ${assets.demoImage}::uuid`;
    expect(row?.deleted_at).toBeNull();

    // Positive control — B CAN point its profile at its own asset, then puts it back.
    const own = await api.request('/v1/me/profile', {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${tokens.labMember}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ avatarAssetId: assets.labImage }),
    });
    expect(own.status).toBe(200);
    await api.request('/v1/me/profile', {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${tokens.labMember}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ avatarAssetId: null }),
    });
  });

  it('p. the platform identity has no membership: every Phase 3 route refuses it, never a 500 (Pitfall 8)', async () => {
    const uploads = await api.request('/v1/media/uploads', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.superAdmin}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'image', purpose: 'avatar', mime: 'image/jpeg', size: 1024 }),
    });
    expect(uploads.status).toBe(403);
    expect(await code(uploads)).toBe('NO_MEMBERSHIP');

    for (const path of ['/v1/members', '/v1/me/profile']) {
      const res = await request(path, tokens.superAdmin);
      expect(res.status, path).toBe(403);
      expect(await code(res), path).toBe('NO_MEMBERSHIP');
    }
  });
});
