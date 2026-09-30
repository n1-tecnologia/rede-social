import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { sqlClient } from '@rede-social/core/db';
import { stopBoss } from '@rede-social/core/server/jobs/boss';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { createClient } from '@supabase/supabase-js';
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
 * TENANT-05 adjacency: both seeded tenants get posts with the SAME caption and their members share
 * the `member@…` local part, so a leak that matched on a value rather than on `tenant_id` cannot
 * pass by looking plausible. Every assertion below compares IDS, never contents.
 *
 * Phase 4 (04-10) RETARGETED the list/detail/empty/disabled cases from the deleted reference module
 * onto the feed. Not one shape of answer was dropped in the move — that is the point: D-19's removal
 * had to leave this gate exactly as strong as it found it.
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
 *   - `feed.test.ts`            — the feed module's guard chain, keyset paging and write rules
 *   - `modules.test.ts`         — requireModule/requireRole ordering and the flags cache
 *   - `supabase/tests/020-tenant-isolation.sql` — the same isolation proved inside Postgres
 */

type Envelope = { error: { code: string; message: string; details?: unknown } };
type BootstrapBody = { tenant: { id: string; slug: string }; modules: { key: string }[] };

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@rede-social.test';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? '';

/** Adjacency: the SAME caption in both tenants, so only the id can tell the rows apart. */
const SHARED_TITLE = 'Reunião de sábado, às 10h.';
const RUN = Date.now();
const EMPTY_SLUG = `rede-empty-${RUN}`.slice(0, 40);
const NOFEED_SLUG = `rede-social-nofeed-${RUN}`.slice(0, 40);
const SUSPENDED_SLUG = `rede-social-susp-${RUN}`.slice(0, 40);
const EMPTY_HOST = `rede-empty-${RUN}.localhost`;
const NOFEED_HOST = `rede-social-nofeed-${RUN}.localhost`;
const SUSPENDED_HOST = `rede-social-susp-${RUN}.localhost`;
const THROWAWAY_PASSWORD = 'Segredo123';

const tokens = {
  demoMember: '',
  labMember: '',
  demoAdmin: '',
  labAdmin: '',
  emptyMember: '',
  nofeedMember: '',
  blockedMember: '',
  superAdmin: '',
};
const tenantIds = { demo: '', lab: '', empty: '', nofeed: '', suspended: '' };
/** 04-10: the list/detail fixture, now FEED posts — the reference module that used to carry these
 * cases was deleted with D-19, and the gate keeps every one of them against a real module. */
const itemIds = { demo: [] as string[], lab: [] as string[] };
const throwawayUsers: string[] = [];
let blockedUserId = '';

/** Phase 3 fixtures: a ready image and a ready video on EACH side, so every negative has a control. */
const assets = {
  demoImage: '',
  labImage: '',
  demoVideo: '',
  labVideo: '',
  /** 05-09: a perfectly usable COVER on each side — the cover gate's negative and its control. */
  demoCover: '',
  labCover: '',
};
const mediaAssetIds: string[] = [];
/** Communities the 05-09 cover case creates; removed BEFORE the assets they point at. */
const coverCommunityIds: string[] = [];
const displayNames = { demo: '', lab: '' };
const membershipIds = { demo: '', lab: '' };

/**
 * 04-08 fixtures: one live post on EACH side plus one of the demo's own that is then removed. The
 * captions are deliberately identical across the two tenants (TENANT-05 adjacency), so a leak that
 * matched on content rather than on `tenant_id` could not pass by looking plausible.
 */
const SHARED_CAPTION = 'Aviso da comunidade sobre o encontro.';
const postIds = { demo: '', lab: '', demoRemoved: '' };

/** 05.3-02: the Reels lanes read, named once — case b9 probes it and f2's host-mismatch loop walks it. */
const REELS_LANES_PATH = '/v1/feed/video-communities';

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
 * A READY COVER image, written directly in the `seedVideo` shape (05-09).
 *
 * The cover gate's negative is only meaningful beside an asset that is perfectly usable AS A COVER,
 * so this fixture carries the exact tuple the service accepts — `kind = 'image'`,
 * `purpose = 'cover'`, `status = 'ready'` — plus a non-empty `variant_widths`, which is what the
 * community projection hands `MediaImage` as its `srcSet` ladder. A refusal can then only be about
 * WHOSE asset it is.
 */
async function seedCover(tenantId: string, email: string, filename: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width, height,
       variant_widths, filename, ready_at)
    select ${tenantId}::uuid, u.id, 'image', 'cover', 'ready', 'supabase',
           'image/webp', 262144, 1600, 700, '{320,640,960,1280}'::int[], ${filename}, now()
      from public.users u where u.email = ${email}
    returning id`;
  if (!row) throw new Error(`could not seed a cover for ${email}`);
  mediaAssetIds.push(row.id);
  return row.id;
}

/**
 * A READY STORY image, written directly in the `seedCover` shape (05.1-01): the exact tuple
 * `publishStory` accepts — `kind = 'image'`, `purpose = 'story'`, `status = 'ready'` — so a refused
 * publish can only be about the community it names, never about the asset.
 */
async function seedStoryImage(tenantId: string, email: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width, height,
       variant_widths, filename, ready_at)
    select ${tenantId}::uuid, u.id, 'image', 'story', 'ready', 'supabase',
           'image/webp', 262144, 1080, 1920, '{640,1080}'::int[], 'story.webp', now()
      from public.users u where u.email = ${email}
    returning id`;
  if (!row) throw new Error(`could not seed a story image for ${email}`);
  mediaAssetIds.push(row.id);
  return row.id;
}

/**
 * Service-key Storage client for fixture cleanup only (direct deletes from `storage.objects` are
 * refused — the 02-13 finding). Built here like `authAdmin()` rather than importing
 * `@rede-social/core/server/supabase-admin`, which Biome confines to the kernel's admin lane.
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

/** A post written straight through the admin connection; `removed` sets the soft-delete stamp. */
async function seedPost(tenantId: string, caption: string, removed = false): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, author_user_id, caption, deleted_at)
    select ${tenantId}::uuid, u.id, ${caption},
           ${removed ? new Date().toISOString() : null}::timestamptz
      from public.users u
      join public.memberships m on m.user_id = u.id
     where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant'
     limit 1
    returning id`;
  if (!row) throw new Error(`could not seed a feed post in ${tenantId}`);
  return row.id;
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

  tenantIds.demo = await tenantIdBySlug('rede-demo');
  tenantIds.lab = await tenantIdBySlug('rede-lab');

  // Identical-looking content on both sides (TENANT-05 adjacency).
  itemIds.demo = [
    await seedPost(tenantIds.demo, SHARED_TITLE),
    await seedPost(tenantIds.demo, SHARED_TITLE),
  ];
  itemIds.lab = [
    await seedPost(tenantIds.lab, SHARED_TITLE),
    await seedPost(tenantIds.lab, SHARED_TITLE),
  ];

  // A third tenant with the module ENABLED and zero rows: "empty" must be 200 [], never 404/500.
  const [empty] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version)
    values (${EMPTY_SLUG}, 'Comunidade Vazia', 'Regras de teste.', 1)
    returning id`;
  tenantIds.empty = empty?.id ?? '';
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantIds.empty}::uuid, 'feed', true)`;
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
    values (${tenantIds.empty}::uuid, ${EMPTY_HOST}, true, now())`;

  // A fourth tenant with the module explicitly DISABLED. 04-10 needed this: until then the
  // disabled-module case rode on rede-lab, which does NOT have the reference module but DOES have
  // the feed (D-17). "Not here" must still answer 404 MODULE_DISABLED rather than 403.
  const [nofeed] = await adminSql<{ id: string }[]>`
    insert into public.tenants (slug, display_name, rules_text, rules_version)
    values (${NOFEED_SLUG}, 'Comunidade Sem Feed', 'Regras de teste.', 1)
    returning id`;
  tenantIds.nofeed = nofeed?.id ?? '';
  await adminSql`
    insert into public.tenant_modules (tenant_id, module_key, enabled)
    values (${tenantIds.nofeed}::uuid, 'feed', false)`;
  await adminSql`
    insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
    values (${tenantIds.nofeed}::uuid, ${NOFEED_HOST}, true, now())`;

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

  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.labAdmin = await signInAs('admin@rede-lab.local', SEED_PASSWORD);
  tokens.superAdmin = await signInAs(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  tokens.emptyMember = await throwawayMember(tenantIds.empty, `member@${EMPTY_SLUG}.local`);
  tokens.nofeedMember = await throwawayMember(tenantIds.nofeed, `member@${NOFEED_SLUG}.local`);
  tokens.blockedMember = await throwawayMember(tenantIds.demo, `blocked-${RUN}@rede-demo.local`);
  blockedUserId = throwawayUsers[throwawayUsers.length - 1] ?? '';

  for (const id of [tenantIds.demo, tenantIds.lab, tenantIds.empty, tenantIds.nofeed]) {
    moduleFlags.invalidate(id);
  }

  // Phase 3 fixtures. A REAL upload on each side (start -> PUT straight to Storage -> complete ->
  // the worker derives the ladder), so the signed-URL case runs against objects that really exist.
  assets.demoImage = await uploadAvatar(tokens.demoMember);
  assets.labImage = await uploadAvatar(tokens.labMember);
  mediaAssetIds.push(assets.demoImage, assets.labImage);
  assets.demoVideo = await seedVideo(
    tenantIds.demo,
    'admin@rede-demo.local',
    'privado-da-demo.mp4',
  );
  assets.labVideo = await seedVideo(tenantIds.lab, 'admin@rede-lab.local', 'privado-do-lab.mp4');
  // 05-09: one usable cover on each side. Same filename on both, so a leak that matched on content
  // rather than on `tenant_id` could not pass by looking plausible (the adjacency rule).
  assets.demoCover = await seedCover(tenantIds.demo, 'admin@rede-demo.local', 'capa.webp');
  assets.labCover = await seedCover(tenantIds.lab, 'admin@rede-lab.local', 'capa.webp');

  displayNames.demo = await displayNameOf(tenantIds.demo, 'member@rede-demo.local');
  displayNames.lab = await displayNameOf(tenantIds.lab, 'member@rede-lab.local');
  membershipIds.demo = await membershipIdOf(tenantIds.demo, 'member@rede-demo.local');
  membershipIds.lab = await membershipIdOf(tenantIds.lab, 'member@rede-lab.local');

  // Phase 4 (04-08): the post-detail route FEED-07's share link points at.
  postIds.demo = await seedPost(tenantIds.demo, SHARED_CAPTION);
  postIds.lab = await seedPost(tenantIds.lab, SHARED_CAPTION);
  postIds.demoRemoved = await seedPost(tenantIds.demo, SHARED_CAPTION, true);
});

afterAll(async () => {
  for (const [tenantId, assetId] of [
    [tenantIds.demo, assets.demoImage],
    [tenantIds.lab, assets.labImage],
  ] as const) {
    if (assetId) await removeMediaObjects(tenantId, assetId);
  }
  // 05-09: anything pointing AT a fixture asset goes first. The id list rather than the name is the
  // arbiter, so a run that crashed mid-case — leaving behind a community the fix will later refuse
  // to create at all — still cleans up instead of failing the delete below on the foreign key.
  const fixtureAssets = [...new Set(mediaAssetIds)].filter(Boolean);
  if (fixtureAssets.length > 0) {
    await adminSql`
      delete from public.communities where cover_asset_id = any(${fixtureAssets}::uuid[])`;
  }
  if (coverCommunityIds.length > 0) {
    await adminSql`delete from public.communities where id = any(${coverCommunityIds}::uuid[])`;
  }

  // `uploadAvatar` only creates the asset — no profile row points at it here — so the rows can be
  // deleted outright once their objects are gone.
  for (const id of fixtureAssets) {
    await adminSql`delete from public.media_assets where id = ${id}::uuid`;
  }

  const posts = [
    postIds.demo,
    postIds.lab,
    postIds.demoRemoved,
    ...itemIds.demo,
    ...itemIds.lab,
  ].filter(Boolean);
  if (posts.length > 0) {
    await adminSql`delete from public.feed_posts where id = any(${posts}::uuid[])`;
  }
  for (const userId of throwawayUsers) await authAdmin().deleteUser(userId);
  await adminSql`
    delete from public.tenants
     where slug in (${EMPTY_SLUG}, ${NOFEED_SLUG}, ${SUSPENDED_SLUG})`;
  await stopBoss();
  await adminSql.end();
  await sqlClient.end();
});

describe('TENANT-05 — the two-tenant isolation gate', () => {
  it('a. list: a rede-demo member gets rede-demo ids only, never a rede-lab id', async () => {
    const res = await request('/v1/feed', tokens.demoMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(res.status).toBe(200);

    const { items } = (await res.json()) as { items: { id: string; caption: string }[] };
    const ids = new Set(items.map((i) => i.id));
    // Newest first, so the fixture rows lead the first page.
    for (const id of itemIds.demo) expect(ids.has(id)).toBe(true);
    for (const id of itemIds.lab) expect(ids.has(id)).toBe(false);
    // Adjacency: both tenants have rows with this exact caption, so the caption proves nothing —
    // which ids come back is what must hold.
    expect(items.filter((i) => i.caption === SHARED_TITLE)).toHaveLength(itemIds.demo.length);
  });

  it("b. detail: the other tenant's id is 404 NOT_FOUND, never 403", async () => {
    for (const labId of itemIds.lab) {
      const res = await request(`/v1/feed/posts/${labId}`, tokens.demoMember, {
        [TENANT_HOST_HEADER]: HOSTS.demo,
      });
      // 404, not 403: a 403 would confirm the row exists somewhere.
      expect(res.status).toBe(404);
      expect(await code(res)).toBe('NOT_FOUND');
    }
    // Positive control (T-03-56): the SAME shape of request against the tenant's own rows is 200,
    // so the 404s above are isolation and not a globally broken route.
    for (const demoId of itemIds.demo) {
      const own = await request(`/v1/feed/posts/${demoId}`, tokens.demoMember, {
        [TENANT_HOST_HEADER]: HOSTS.demo,
      });
      expect(own.status).toBe(200);
    }
  });

  it("b2. communities: the other tenant's community id is 404 NOT_FOUND with no details (05-01)", async () => {
    // The lab community ids come from the DATABASE rather than from the lab's own API: `communities`
    // is disabled for rede-lab in the seed (D-17 gives it feed + events), and the point of this case
    // is the DEMO session's answer, not the lab's.
    const labCommunities = await adminSql<{ id: string }[]>`
      select id from public.communities where tenant_id = ${tenantIds.lab}::uuid`;
    expect(labCommunities.length).toBeGreaterThan(0);

    for (const row of labCommunities) {
      const res = await request(`/v1/communities/${row.id}`, tokens.demoMember, {
        [TENANT_HOST_HEADER]: HOSTS.demo,
      });
      // 404, not 403: a 403 would confirm the row exists somewhere (D-23, T-05-02).
      expect(res.status).toBe(404);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      // No `details` key at all — the absence IS the existence-oracle control, so a status-only
      // assertion would not cover it.
      expect(Object.hasOwn(body.error, 'details')).toBe(false);
    }

    // Positive control (T-03-56) IN THE SAME TEST: the demo session really can read its OWN
    // communities, by list and by id — so the 404s above are isolation, not a broken route.
    const list = await request('/v1/communities', tokens.demoMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(list.status).toBe(200);
    const { items } = (await list.json()) as { items: { id: string }[] };
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(labCommunities.map((row) => row.id)).not.toContain(item.id);
      const own = await request(`/v1/communities/${item.id}`, tokens.demoMember, {
        [TENANT_HOST_HEADER]: HOSTS.demo,
      });
      expect(own.status).toBe(200);
    }
  });

  it("b3. stories: the other tenant's story id is 404 NOT_FOUND with no details (05-05)", async () => {
    // The lab story ids come from the DATABASE rather than from the lab's own API: `stories` is
    // disabled for rede-lab in the seed (D-17 gives it feed + events), and the point of this case
    // is the DEMO session's answer, not the lab's.
    //
    // A story is the shortest-lived row in the product, and that is exactly why it is here: "it
    // expires in a day anyway" is not isolation, and an EXPIRED story of another tenant must answer
    // the same 404 an active one does — the seed gives the lab both, so this loop covers both.
    const labStories = await adminSql<{ id: string }[]>`
      select id from public.stories where tenant_id = ${tenantIds.lab}::uuid`;
    expect(labStories.length).toBeGreaterThan(0);

    for (const row of labStories) {
      const res = await request(`/v1/stories/${row.id}`, tokens.demoMember, {
        [TENANT_HOST_HEADER]: HOSTS.demo,
      });
      // 404, not 403: a 403 would confirm the row exists somewhere (D-23, T-05-30).
      expect(res.status).toBe(404);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      // No `details` key at all — the absence IS the existence-oracle control, so a status-only
      // assertion would not cover it.
      expect(Object.hasOwn(body.error, 'details')).toBe(false);
    }

    // Positive control (T-03-56) IN THE SAME TEST: the demo session really can read its OWN
    // stories, by strip and by id — so the 404s above are isolation, not a broken route.
    const list = await request('/v1/stories', tokens.demoMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(list.status).toBe(200);
    const { items } = (await list.json()) as { items: { id: string }[] };
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(labStories.map((row) => row.id)).not.toContain(item.id);
      const own = await request(`/v1/stories/${item.id}`, tokens.demoMember, {
        [TENANT_HOST_HEADER]: HOSTS.demo,
      });
      expect(own.status).toBe(200);
    }
  });

  // b4 was 05-08's community pins, retired with the pin model in 05.2-11 (HIGHLIGHT-05, D-116); its
  // crossings are b7's highlight crossings now. 06-01 reuses the free letter for events.
  it("b4. events: the other tenant's events never reach a demo list, and a demo session on the lab host is refused (06-01)", async () => {
    // Both sides from the DATABASE: `events` is enabled for rede-lab too (D-17), so the lab has its
    // own seeded events with titles IDENTICAL to the demo's (§(j) adjacency) — which is why every
    // assertion below compares ids, never titles. The detail route is 06-03's, so its cross-tenant
    // 404 is asserted there and again below (06-03); this case owns the LIST and the detail.
    const labEvents = await adminSql<{ id: string }[]>`
      select id from public.events where tenant_id = ${tenantIds.lab}::uuid`;
    const demoEvents = await adminSql<{ id: string }[]>`
      select id from public.events where tenant_id = ${tenantIds.demo}::uuid`;
    expect(labEvents.length).toBeGreaterThan(0);
    expect(demoEvents.length).toBeGreaterThan(0);
    const labIds = labEvents.map((row) => row.id);

    const seen: string[] = [];
    for (const period of ['upcoming', 'past']) {
      let cursor: string | null = null;
      for (let guard = 0; guard < 40; guard++) {
        const query: string = cursor
          ? `?period=${period}&limit=25&cursor=${encodeURIComponent(cursor)}`
          : `?period=${period}&limit=25`;
        const res = await request(`/v1/events${query}`, tokens.demoMember, {
          [TENANT_HOST_HEADER]: HOSTS.demo,
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { items: { id: string }[]; nextCursor: string | null };
        seen.push(...body.items.map((item) => item.id));
        cursor = body.nextCursor;
        if (cursor === null) break;
      }
    }
    for (const id of labIds) expect(seen).not.toContain(id);

    // Positive control IN THE SAME TEST: the demo member's two lists DO contain the demo tenant's own
    // seeded events, so the absences above are isolation, not an empty or broken route.
    for (const row of demoEvents) expect(seen).toContain(row.id);

    // …and the same session presented on the lab's registered host is refused before any read.
    const mismatch = await request('/v1/events', tokens.demoMember, {
      [TENANT_HOST_HEADER]: HOSTS.lab,
    });
    expect(mismatch.status).toBe(403);
    expect(await code(mismatch)).toBe('TENANT_HOST_MISMATCH');

    // 06-03: the DETAIL route. A lab event id read by the demo member is ONE bare 404 with no
    // details (D-23), exactly like an unknown id, and answering it is the same bare 404 with nothing
    // written; the demo member's own event is 200 (the positive control, in the same test).
    for (const id of labIds.slice(0, 2)) {
      const foreign = await request(`/v1/events/${id}`, tokens.demoMember, {
        [TENANT_HOST_HEADER]: HOSTS.demo,
      });
      expect(foreign.status).toBe(404);
      const text = await foreign.text();
      const body = JSON.parse(text) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.details).toBeUndefined();
      expect(text).not.toContain(id);

      const answer = await api.request(`/v1/events/${id}/rsvp`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${tokens.demoMember}`,
          [TENANT_HOST_HEADER]: HOSTS.demo,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ answer: 'going' }),
      });
      expect(answer.status).toBe(404);
      expect(((await answer.json()) as Envelope).error.details).toBeUndefined();

      // 06-05: the in-person CHECK-IN, with the lab event's REAL code (read through adminSql): the
      // SECURITY DEFINER function filters by the caller's tenant, so the answer is the same bare 404
      // as an unknown id, and neither an attendance nor a guess counter is written on the lab's side.
      const [secret] = await adminSql<{ checkin_code: string }[]>`
        select checkin_code from public.event_secrets where event_id = ${id}::uuid`;
      const labRows = async () => {
        const [row] = await adminSql<{ n: number }[]>`
          select (select count(*)::int from public.event_attendances where event_id = ${id}::uuid)
               + (select count(*)::int from public.event_checkin_attempts where event_id = ${id}::uuid) as n`;
        return row?.n ?? 0;
      };
      const labBefore = await labRows();
      const checkIn = await api.request(`/v1/events/${id}/check-in`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.demoMember}`,
          [TENANT_HOST_HEADER]: HOSTS.demo,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ code: secret?.checkin_code ?? 'K7QM' }),
      });
      expect(checkIn.status).toBe(404);
      expect(((await checkIn.json()) as Envelope).error.details).toBeUndefined();
      expect(await labRows()).toBe(labBefore);

      // 06-06: the online ENTER. Whatever the lab event's format, the demo lane gets the same bare
      // 404 as an unknown id: no meeting URL in the body and nothing written on the lab's side.
      const entered = await api.request(`/v1/events/${id}/enter`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.demoMember}`,
          [TENANT_HOST_HEADER]: HOSTS.demo,
        },
      });
      expect(entered.status).toBe(404);
      const enteredText = await entered.text();
      expect((JSON.parse(enteredText) as Envelope).error.details).toBeUndefined();
      expect(enteredText).not.toContain('meet.example.test');
      expect(await labRows()).toBe(labBefore);
    }

    // 06-05: the check-in POST presented on the lab's registered host is refused before any read
    // (f2's host-mismatch loop is GET-only).
    const hostMismatch = await api.request(`/v1/events/${demoEvents[0]?.id ?? ''}/check-in`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.demoMember}`,
        [TENANT_HOST_HEADER]: HOSTS.lab,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ code: 'K7QM' }),
    });
    expect(hostMismatch.status).toBe(403);
    expect(await code(hostMismatch)).toBe('TENANT_HOST_MISMATCH');
    // 06-06: …and so is the enter POST.
    const enterMismatch = await api.request(`/v1/events/${demoEvents[0]?.id ?? ''}/enter`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.demoMember}`,
        [TENANT_HOST_HEADER]: HOSTS.lab,
      },
    });
    expect(enterMismatch.status).toBe(403);
    expect(await code(enterMismatch)).toBe('TENANT_HOST_MISMATCH');
    const [written] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.event_attendances a
        join public.users u on u.id = a.user_id
       where a.tenant_id = ${tenantIds.lab}::uuid and u.email = 'member@rede-demo.local'`;
    expect(written?.n).toBe(0);
    const own = await request(`/v1/events/${demoEvents[0]?.id ?? ''}`, tokens.demoMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(own.status).toBe(200);
  });

  it("b5. covers: a demo admin cannot point a community at the lab's asset, and learns nothing by trying (05-09)", async () => {
    // GAP 1 of 05-VERIFICATION.md. `cover_asset_id` is the one Phase 5 write that took a
    // client-supplied id straight into SQL: the single-column foreign key cannot save it, because
    // referential integrity runs as the TABLE OWNER and therefore bypasses RLS. So a foreign id
    // PERSISTED, and the 23503-vs-201 split (random uuid -> unhandled 500; real foreign id -> 201)
    // was a working cross-tenant existence oracle over an enumerable uuid space.
    //
    // Both halves are asserted here: the id must not be written, AND the two refusals must be one
    // answer. The second is the part a status-only assertion would miss.
    const write = (path: string, method: string, body: unknown) =>
      api.request(path, {
        method,
        headers: {
          authorization: `Bearer ${tokens.demoAdmin}`,
          'content-type': 'application/json',
          [TENANT_HOST_HEADER]: HOSTS.demo,
        },
        body: JSON.stringify(body),
      });

    // The PATCH target, created through the API carrying the DEMO cover — so the "it did not move"
    // assertion below compares a real id against a real id rather than null against null.
    const mine = await write('/v1/communities', 'POST', {
      name: 'Comunidade de isolamento 05-09',
      coverAssetId: assets.demoCover,
    });
    expect(mine.status).toBe(201);
    const own = (await mine.json()) as { id: string; coverAssetId: string | null };
    coverCommunityIds.push(own.id);
    expect(own.coverAssetId).toBe(assets.demoCover);

    // 1. A CREATE naming the lab's cover.
    const foreign = await write('/v1/communities', 'POST', {
      name: 'Comunidade com capa do lab',
      coverAssetId: assets.labCover,
    });
    expect(foreign.status).toBe(404);
    const foreignText = await foreign.text();
    const foreignBody = JSON.parse(foreignText) as Envelope;
    expect(foreignBody.error.code).toBe('NOT_FOUND');
    // No `details` key at all — the absence IS the existence-oracle control.
    expect(Object.hasOwn(foreignBody.error, 'details')).toBe(false);

    // 2. The same create with a uuid that names NOTHING. The assertion is an EQUALITY between the
    // two bodies rather than two checks against a literal: a future extra key, a different message
    // or even a different key ORDER is exactly the change that turns a 404 back into an oracle.
    const unknown = await write('/v1/communities', 'POST', {
      name: 'Comunidade com capa inexistente',
      coverAssetId: crypto.randomUUID(),
    });
    expect(unknown.status).toBe(404);
    const unknownText = await unknown.text();
    // `requestId` is the ONE field that legitimately differs between two requests — it identifies
    // the call, not the row — and stripping it is what makes the rest meaningful (the case q rule).
    const withoutRequestId = (raw: string) => {
      const parsed = JSON.parse(raw) as Envelope;
      const { requestId: _requestId, ...error } = parsed.error as Envelope['error'] & {
        requestId?: string;
      };
      return JSON.stringify({ error });
    };
    expect(withoutRequestId(unknownText)).toEqual(withoutRequestId(foreignText));

    // 3. The refusal names nothing about the other organisation — not its slug, not its id, not the
    // asset id it was asked about.
    for (const needle of ['rede-demo', 'rede-lab', tenantIds.lab, assets.labCover]) {
      expect(foreignText).not.toContain(needle);
    }

    // 4. An UPDATE pointing an existing community at the lab's cover takes the same answer, and the
    // stored value does not move.
    const patched = await write(`/v1/communities/${own.id}`, 'PATCH', {
      coverAssetId: assets.labCover,
    });
    expect(patched.status).toBe(404);
    expect(((await patched.json()) as Envelope).error.code).toBe('NOT_FOUND');
    const [stored] = await adminSql<{ cover_asset_id: string | null }[]>`
      select cover_asset_id from public.communities where id = ${own.id}::uuid`;
    expect(stored?.cover_asset_id).toBe(assets.demoCover);

    // 5. Nothing was written on the create side either: no demo community points at the lab's asset.
    const leaked = await adminSql<{ id: string }[]>`
      select id from public.communities where cover_asset_id = ${assets.labCover}::uuid`;
    expect(leaked).toHaveLength(0);

    // 6. The lab's own row is untouched by any of it.
    const [labAsset] = await adminSql<{ deleted_at: string | null; tenant_id: string }[]>`
      select deleted_at, tenant_id from public.media_assets where id = ${assets.labCover}::uuid`;
    expect(labAsset?.deleted_at).toBeNull();
    expect(labAsset?.tenant_id).toBe(tenantIds.lab);

    // Positive control (T-03-56) IN THE SAME TEST: the demo admin really can use ITS OWN cover, so
    // the 404s above are isolation rather than a route that refuses every cover.
    const control = await write('/v1/communities', 'POST', {
      name: 'Comunidade com capa propria',
      coverAssetId: assets.demoCover,
    });
    expect(control.status).toBe(201);
    const controlBody = (await control.json()) as { id: string; coverAssetId: string | null };
    coverCommunityIds.push(controlBody.id);
    expect(controlBody.coverAssetId).toBe(assets.demoCover);
  });

  it("b6. born in a highlight: a demo admin cannot publish a story into the lab's highlight (05.2-11, D-113; was 05.1-01's born-attached pin)", async () => {
    // `POST /v1/stories` takes a client-supplied `highlightId` and writes the story AND its item row
    // in the SAME transaction. A foreign id must neither persist nor be distinguishable from an id
    // that names nothing: the demo lane resolves the highlight with the tenant predicate under RLS,
    // so a lab highlight produces no row to refuse — the same bare 404 an unknown uuid gets (D-23).
    //
    // 05.2-11 retired the pin model, and with it 05.1's `communityId` destination this case used to
    // probe; the one publish-time destination that remains is the highlight, so the case probes it.
    const [labRow] = await adminSql<{ id: string }[]>`
      select id from public.story_highlights
       where tenant_id = ${tenantIds.lab}::uuid and community_id is null and title = 'Bastidores'`;
    const [demoRow] = await adminSql<{ id: string }[]>`
      select id from public.story_highlights
       where tenant_id = ${tenantIds.demo}::uuid and community_id is null and title = 'Bastidores'`;
    const labHighlight = labRow?.id ?? '';
    const demoHighlight = demoRow?.id ?? '';
    // The SEEDED highlights are the fixture — a missing one means the seed is stale.
    expect([labHighlight, demoHighlight].every(Boolean)).toBe(true);

    const assetId = await seedStoryImage(tenantIds.demo, 'admin@rede-demo.local');
    const caption = `Isolamento 05.2 ${RUN}`;
    const controlCaption = `Isolamento 05.2 controle ${RUN}`;
    const publish = (highlightId: string, text: string) =>
      api.request('/v1/stories', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.demoAdmin}`,
          'content-type': 'application/json',
          [TENANT_HOST_HEADER]: HOSTS.demo,
        },
        body: JSON.stringify({
          mediaAssetId: assetId,
          mediaKind: 'image',
          caption: text,
          highlightId,
        }),
      });
    const labItems = async () => {
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.story_highlight_items
         where highlight_id = ${labHighlight}::uuid`;
      return row?.n ?? 0;
    };

    try {
      const itemsBefore = await labItems();

      const res = await publish(labHighlight, caption);
      expect(res.status).toBe(404);
      const text = await res.text();
      const body = JSON.parse(text) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      // No `details` key at all — the absence IS the existence-oracle control.
      expect(Object.hasOwn(body.error, 'details')).toBe(false);
      for (const needle of ['rede-lab', tenantIds.lab, labHighlight]) {
        expect(text).not.toContain(needle);
      }

      // Nothing was written on either side: no demo story with that caption, no new lab item.
      const [written] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.stories where caption = ${caption}`;
      expect(written?.n).toBe(0);
      expect(await labItems()).toBe(itemsBefore);

      // Positive control (T-03-56) IN THE SAME TEST: the identical publish naming a highlight this
      // lane CAN see succeeds, so the 404 above is isolation rather than a broken route.
      const control = await publish(demoHighlight, controlCaption);
      expect(control.status).toBe(201);
      const story = (await control.json()) as { id: string; highlightCount: number };
      expect(story.highlightCount).toBe(1);
    } finally {
      // The stories go before the asset they point at; their item rows cascade with them.
      await adminSql`
        delete from public.stories where caption in (${caption}, ${controlCaption})`;
    }
  });

  it("b7. highlights: the lab's highlight, story and community ids are each the bare 404 through every highlight route (05.2-01)", async () => {
    // A highlight item is the row that lets a story OUTLIVE its 24 h, on Início and on a community
    // page — so a leak here would be permanent, not a day long (T-05.2-02). Every id the four routes
    // take is probed from the DEMO admin, the session most likely to succeed by accident: the
    // service resolves each id in-lane with an explicit tenant predicate under RLS and inserts by
    // insert-select, so a foreign id produces no row to act on rather than a refused one.
    //
    // Named b7 because b6 was taken (05.1-01's born-attached publish, now the highlight publish).
    const [labHighlight] = await adminSql<{ id: string }[]>`
      select id from public.story_highlights
       where tenant_id = ${tenantIds.lab}::uuid and community_id is null and title = 'Bastidores'`;
    const [demoHighlight] = await adminSql<{ id: string }[]>`
      select id from public.story_highlights
       where tenant_id = ${tenantIds.demo}::uuid and community_id is null and title = 'Bastidores'`;
    const [labStory] = await adminSql<{ id: string }[]>`
      select id from public.stories
       where tenant_id = ${tenantIds.lab}::uuid and deleted_at is null limit 1`;
    const [demoStory] = await adminSql<{ id: string }[]>`
      select id from public.stories
       where tenant_id = ${tenantIds.demo}::uuid and deleted_at is null limit 1`;
    const [labCommunity] = await adminSql<{ id: string }[]>`
      select id from public.communities
       where tenant_id = ${tenantIds.lab}::uuid and deleted_at is null and status = 'active' limit 1`;
    const ids = {
      labHighlight: labHighlight?.id ?? '',
      demoHighlight: demoHighlight?.id ?? '',
      labStory: labStory?.id ?? '',
      demoStory: demoStory?.id ?? '',
      labCommunity: labCommunity?.id ?? '',
    };
    // The SEEDED highlights are the fixture (scripts/seed.ts `SEED_HIGHLIGHT_IDS`) — a missing one
    // means the seed is stale, not that isolation holds.
    for (const [name, id] of Object.entries(ids)) expect(id, `seeded ${name}`).not.toBe('');

    const call = (path: string, method = 'GET', body?: unknown) =>
      api.request(`/v1/stories/highlights${path}`, {
        method,
        headers: {
          authorization: `Bearer ${tokens.demoAdmin}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
          [TENANT_HOST_HEADER]: HOSTS.demo,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    // `requestId` identifies the CALL, not the row — stripping it is what makes two refusals
    // comparable (the case q rule).
    const withoutRequestId = (raw: string) => {
      const { requestId: _requestId, ...error } = (JSON.parse(raw) as Envelope)
        .error as Envelope['error'] & {
        requestId?: string;
      };
      return JSON.stringify({ error });
    };
    const title = `Isolamento ${String(RUN).slice(-4)}`;
    const labItems = async () => {
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.story_highlight_items
         where highlight_id = ${ids.labHighlight}::uuid`;
      return row?.n ?? 0;
    };
    const demoItemsOfLabStory = async () => {
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.story_highlight_items
         where story_id = ${ids.labStory}::uuid and tenant_id = ${tenantIds.demo}::uuid`;
      return row?.n ?? 0;
    };

    const labItemsBefore = await labItems();
    // The one answer every crossing must produce, measured against an id that names NOTHING.
    const unknown = await call(`/${crypto.randomUUID()}`);
    expect(unknown.status).toBe(404);
    const unknownText = await unknown.text();

    const crossings: [string, string, string, unknown?][] = [
      ['GET the lab highlight', `/${ids.labHighlight}`, 'GET'],
      [
        'PUT a demo story into the lab highlight',
        `/${ids.labHighlight}/stories/${ids.demoStory}`,
        'PUT',
      ],
      [
        'PUT a lab story into the demo highlight',
        `/${ids.demoHighlight}/stories/${ids.labStory}`,
        'PUT',
      ],
      ['GET the lab community row', `?communityId=${ids.labCommunity}`, 'GET'],
      [
        'POST a highlight into the lab community',
        '',
        'POST',
        { communityId: ids.labCommunity, title },
      ],
    ];
    for (const [label, path, method, body] of crossings) {
      const res = await call(path, method, body);
      expect(res.status, label).toBe(404);
      const text = await res.text();
      const parsed = JSON.parse(text) as Envelope;
      expect(parsed.error.code, label).toBe('NOT_FOUND');
      // No `details` key at all — the absence IS the existence-oracle control.
      expect(Object.hasOwn(parsed.error, 'details'), label).toBe(false);
      expect(withoutRequestId(text), label).toEqual(withoutRequestId(unknownText));
      for (const needle of ['rede-lab', tenantIds.lab, ids.labHighlight, ids.labCommunity]) {
        expect(text, label).not.toContain(needle);
      }
    }

    // Nothing was written in EITHER tenant: no item under the lab highlight, no demo item naming the
    // lab story, and no highlight carrying this case's title anywhere.
    expect(await labItems()).toBe(labItemsBefore);
    expect(await demoItemsOfLabStory()).toBe(0);
    const [written] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.story_highlights where title = ${title}`;
    expect(written?.n).toBe(0);

    // Positive control (T-03-56) IN THE SAME TEST: the demo lane really does read its OWN seeded
    // highlight — so the 404s above are isolation, not a route that 404s for everybody.
    const own = await call(`/${ids.demoHighlight}`);
    expect(own.status).toBe(200);
    const detail = (await own.json()) as { highlight: { id: string }; items: { id: string }[] };
    expect(detail.highlight.id).toBe(ids.demoHighlight);
    expect(detail.items.length).toBeGreaterThan(0);
    for (const item of detail.items) expect(item.id).not.toBe(ids.labStory);
  });

  it("b8. seen state: a demo session posting the lab's story id to /v1/stories/views writes nothing in either tenant, and the lab member's own flag is untouched (05.2-10)", async () => {
    // `story_views` is behavioural data about members (HIGHLIGHT-06): a crossing here would either
    // write a row in another organisation's lane or let one member's viewing mark another's ring.
    // The write inserts by SELECTING the story in the caller's lane, so a foreign id produces no row
    // — and the answer is the same 204 a valid id gets, so nothing is learned either (T-05.2-46/47).
    //
    // Named b8: 05.1-01's born-attached case and 05.2-01's highlight case hold the two letters before it. f2's host-mismatch loop is GET-only, so
    // the POST route is covered here plus `requireAuth`'s host check.
    const userId = async (email: string) => {
      const [row] = await adminSql<{ id: string }[]>`
        select id::text from public.users where email = ${email} limit 1`;
      return row?.id ?? '';
    };
    const demoMemberId = await userId('member@rede-demo.local');
    const labMemberId = await userId('member@rede-lab.local');
    // A live, ready story of each tenant that its own member has NOT seen yet (the seed marks one).
    const unseenStory = async (tenantId: string, memberId: string) => {
      const [row] = await adminSql<{ id: string }[]>`
        select s.id::text from public.stories s
          join public.media_assets a on a.id = s.media_asset_id
         where s.tenant_id = ${tenantId}::uuid and s.deleted_at is null
           and s.expires_at > now() and a.status = 'ready'
           and not exists (select 1 from public.story_views v
                            where v.story_id = s.id and v.user_id = ${memberId}::uuid)
         order by s.published_at desc limit 1`;
      return row?.id ?? '';
    };
    const labStory = await unseenStory(tenantIds.lab, labMemberId);
    const demoStory = await unseenStory(tenantIds.demo, demoMemberId);
    for (const [name, value] of Object.entries({
      demoMemberId,
      labMemberId,
      labStory,
      demoStory,
    })) {
      expect(value, `seeded ${name}`).not.toBe('');
    }

    const views = async (tenantId: string) => {
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.story_views where tenant_id = ${tenantId}::uuid`;
      return row?.n ?? 0;
    };
    const markSeen = (storyIds: string[]) =>
      api.request('/v1/stories/views', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.demoMember}`,
          'content-type': 'application/json',
          [TENANT_HOST_HEADER]: HOSTS.demo,
        },
        body: JSON.stringify({ storyIds }),
      });

    const demoBefore = await views(tenantIds.demo);
    const labBefore = await views(tenantIds.lab);
    try {
      const crossing = await markSeen([labStory]);
      expect(crossing.status).toBe(204);
      expect(await crossing.text()).toBe('');
      expect(await views(tenantIds.demo)).toBe(demoBefore);
      expect(await views(tenantIds.lab)).toBe(labBefore);

      // Positive control IN THE SAME TEST: the demo member's own story IS recorded — so the silence
      // above is isolation, not a route that writes nothing for everybody.
      const own = await markSeen([demoStory]);
      expect(own.status).toBe(204);
      expect(await views(tenantIds.demo)).toBe(demoBefore + 1);
      expect(await views(tenantIds.lab)).toBe(labBefore);
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.story_views
         where tenant_id = ${tenantIds.demo}::uuid and user_id = ${demoMemberId}::uuid
           and story_id = ${demoStory}::uuid`;
      expect(row?.n).toBe(1);

      // The lab member's OWN read still reports the story unseen: the crossing marked nothing for
      // anyone. The lab ships with stories OFF, so it is switched on for this read only.
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${tenantIds.lab}::uuid, 'stories', true)
        on conflict (tenant_id, module_key) do update set enabled = true`;
      moduleFlags.invalidate(tenantIds.lab);
      const strip = await request('/v1/stories?limit=25', tokens.labMember, {
        [TENANT_HOST_HEADER]: HOSTS.lab,
      });
      expect(strip.status).toBe(200);
      const page = (await strip.json()) as { items: { id: string; viewerSeen: boolean }[] };
      expect(page.items.find((story) => story.id === labStory)?.viewerSeen).toBe(false);
    } finally {
      await adminSql`
        update public.tenant_modules set enabled = false
         where tenant_id = ${tenantIds.lab}::uuid and module_key = 'stories'`;
      moduleFlags.invalidate(tenantIds.lab);
      // Leave the seed's seen state exactly as it was (the e2e ring reads it).
      await adminSql`
        delete from public.story_views
         where user_id = ${demoMemberId}::uuid and story_id = ${demoStory}::uuid`;
    }
  });

  it("b9. reels: the lab's community is the bare 404 through the video filter and never a demo lane (05.3-02)", async () => {
    // REELS-04's lanes read NAMES communities, so a crossing here would print another
    // organisation's community name in a member's Reels row (T-05.3-06). The fixture is the
    // strongest one available: a lab community that IS a lane for the lab (it holds a READY video
    // and the lab has communities on), so its absence from the demo's answer can only be isolation.
    //
    // Fresh communities on both sides, never seeded ones: deleting a post recomputes its
    // container's `last_activity_at`, and the seeded order is pinned by communities.test.
    const adminOf = async (tenantId: string) => {
      const [row] = await adminSql<{ id: string }[]>`
        select m.user_id::text as id from public.memberships m
         where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant' limit 1`;
      return row?.id ?? '';
    };
    const freshCommunity = async (tenantId: string, name: string) => {
      const [row] = await adminSql<{ id: string }[]>`
        insert into public.communities (tenant_id, created_by_user_id, name, slug)
        values (${tenantId}::uuid, ${await adminOf(tenantId)}::uuid, ${name},
                ${`reels-isolamento-${crypto.randomUUID().slice(0, 8)}`})
        returning id::text`;
      if (!row) throw new Error(`could not create a community in ${tenantId}`);
      return row.id;
    };
    /** A post whose video is READY, inside `communityId` (the ready-video fragment's exact shape). */
    const readyVideoPost = async (tenantId: string, communityId: string, assetId: string) => {
      const [row] = await adminSql<{ id: string }[]>`
        insert into public.feed_posts (tenant_id, author_user_id, caption, media_kind, community_id)
        values (${tenantId}::uuid, ${await adminOf(tenantId)}::uuid, ${SHARED_CAPTION}, 'video',
                ${communityId}::uuid)
        returning id::text`;
      if (!row) throw new Error(`could not seed a video post in ${tenantId}`);
      await adminSql`
        insert into public.feed_post_media
          (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
        values (${tenantId}::uuid, ${row.id}::uuid, 'video', ${assetId}::uuid, 'video', 0)`;
      return row.id;
    };
    const [labFlag] = await adminSql<{ enabled: boolean }[]>`
      select enabled from public.tenant_modules
       where tenant_id = ${tenantIds.lab}::uuid and module_key = 'communities'`;

    const name = `Reels isolamento ${String(RUN).slice(-4)}`;
    const communities: string[] = [];
    const posts: string[] = [];
    try {
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${tenantIds.lab}::uuid, 'communities', true)
        on conflict (tenant_id, module_key) do update set enabled = true`;
      moduleFlags.invalidate(tenantIds.lab);

      // The SAME community name on both sides (the adjacency rule): only the id can tell them apart.
      const labCommunity = await freshCommunity(tenantIds.lab, name);
      const demoCommunity = await freshCommunity(tenantIds.demo, name);
      communities.push(labCommunity, demoCommunity);
      const labAsset = await seedVideo(tenantIds.lab, 'admin@rede-lab.local', 'reel-do-lab.mp4');
      const demoAsset = await seedVideo(
        tenantIds.demo,
        'admin@rede-demo.local',
        'reel-da-demo.mp4',
      );
      const labPost = await readyVideoPost(tenantIds.lab, labCommunity, labAsset);
      posts.push(labPost, await readyVideoPost(tenantIds.demo, demoCommunity, demoAsset));

      const lanes = async (token: string, host: string) => {
        const res = await request(REELS_LANES_PATH, token, {
          [TENANT_HOST_HEADER]: host,
        });
        expect(res.status).toBe(200);
        return {
          text: await res.clone().text(),
          ids: ((await res.json()) as { items: { id: string }[] }).items.map((i) => i.id),
        };
      };

      // The fixture is real: for the LAB member, the lab community IS a lane.
      expect((await lanes(tokens.labMember, HOSTS.lab)).ids).toContain(labCommunity);

      // 1. The video filter on the lab's community: the SAME bare 404 an id naming nothing gets.
      const withoutRequestId = (raw: string) => {
        const { requestId: _requestId, ...error } = (JSON.parse(raw) as Envelope)
          .error as Envelope['error'] & { requestId?: string };
        return JSON.stringify({ error });
      };
      const unknown = await request(
        `/v1/feed?media=video&communityId=${crypto.randomUUID()}`,
        tokens.demoMember,
        { [TENANT_HOST_HEADER]: HOSTS.demo },
      );
      expect(unknown.status).toBe(404);
      const unknownText = await unknown.text();
      const foreign = await request(
        `/v1/feed?media=video&communityId=${labCommunity}`,
        tokens.demoMember,
        { [TENANT_HOST_HEADER]: HOSTS.demo },
      );
      expect(foreign.status).toBe(404);
      const foreignText = await foreign.text();
      const envelope = JSON.parse(foreignText) as Envelope;
      expect(envelope.error.code).toBe('NOT_FOUND');
      expect(Object.hasOwn(envelope.error, 'details')).toBe(false);
      expect(withoutRequestId(foreignText)).toEqual(withoutRequestId(unknownText));
      for (const needle of [labCommunity, labPost, tenantIds.lab, 'rede-lab']) {
        expect(foreignText).not.toContain(needle);
      }

      // 2. The demo lanes never name a lab community — this one or any other.
      const labCommunityIds = (
        await adminSql<{ id: string }[]>`
          select id::text from public.communities where tenant_id = ${tenantIds.lab}::uuid`
      ).map((row) => row.id);
      const demoLanes = await lanes(tokens.demoMember, HOSTS.demo);
      for (const id of labCommunityIds) expect(demoLanes.ids).not.toContain(id);
      expect(demoLanes.text).not.toContain(labPost);

      // Positive control IN THE SAME TEST: the demo's own community answers 200 through BOTH reads —
      // so the answers above are isolation, not routes that are empty or 404 for everybody.
      expect(demoLanes.ids).toContain(demoCommunity);
      const own = await request(
        `/v1/feed?media=video&communityId=${demoCommunity}`,
        tokens.demoMember,
        { [TENANT_HOST_HEADER]: HOSTS.demo },
      );
      expect(own.status).toBe(200);
      const ownIds = ((await own.json()) as { items: { id: string }[] }).items.map((i) => i.id);
      expect(ownIds).toEqual([posts[1]]);
    } finally {
      if (posts.length > 0) {
        await adminSql`delete from public.feed_posts where id = any(${posts}::uuid[])`;
      }
      if (communities.length > 0) {
        await adminSql`delete from public.communities where id = any(${communities}::uuid[])`;
      }
      // The lab's row goes back EXACTLY as found: absent stays absent (communities.test deletes it).
      if (labFlag) {
        await adminSql`
          update public.tenant_modules set enabled = ${labFlag.enabled}
           where tenant_id = ${tenantIds.lab}::uuid and module_key = 'communities'`;
      } else {
        await adminSql`
          delete from public.tenant_modules
           where tenant_id = ${tenantIds.lab}::uuid and module_key = 'communities'`;
      }
      moduleFlags.invalidate(tenantIds.lab);
    }
  });

  it("b10. notifications: a lab member's row never reaches a demo member's walk, and a demo session on the lab host is refused (07-01)", async () => {
    // The table is OWNER-scoped (T-07-03): a row reaches only its recipient, in its tenant. The
    // fixture is adjacent on purpose: the demo row and the lab row carry the SAME kind, dedupe key
    // and subject, so only the ids can tell them apart. rede-lab has notifications OFF in the seed,
    // so it is turned on for this case (the lab row is then a live, readable row for its own member,
    // the strongest negative) and restored in `finally`.
    const userIdOf = async (email: string) => {
      const [row] = await adminSql<
        { id: string }[]
      >`select id::text as id from auth.users where email = ${email}`;
      return row?.id ?? '';
    };
    const demoUser = await userIdOf('member@rede-demo.local');
    const labUser = await userIdOf('member@rede-lab.local');
    const subject = '0b100000-0000-4000-8000-000000000001';
    const dedupe = `isolation.b10:${RUN}`;
    const [labFlag] = await adminSql<{ enabled: boolean }[]>`
      select enabled from public.tenant_modules
       where tenant_id = ${tenantIds.lab}::uuid and module_key = 'notifications'`;
    const inserted: string[] = [];
    try {
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${tenantIds.lab}::uuid, 'notifications', true)
        on conflict (tenant_id, module_key) do update set enabled = true`;
      moduleFlags.invalidate(tenantIds.lab);
      const rows = await adminSql<{ id: string; tenant_id: string }[]>`
        insert into public.notifications
          (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id, read_at)
        values
          (${tenantIds.demo}::uuid, ${demoUser}::uuid, 'feed.post', ${dedupe}, 'post', ${subject}::uuid, null),
          (${tenantIds.lab}::uuid, ${labUser}::uuid, 'feed.post', ${dedupe}, 'post', ${subject}::uuid, null),
          (${tenantIds.lab}::uuid, ${labUser}::uuid, 'feed.post', ${`${dedupe}:read`}, 'post', ${subject}::uuid, now())
        returning id::text as id, tenant_id::text as tenant_id`;
      inserted.push(...rows.map((row) => row.id));
      const demoRow = rows.find((row) => row.tenant_id === tenantIds.demo)?.id;
      const labRows = rows.filter((row) => row.tenant_id === tenantIds.lab).map((row) => row.id);

      /** Every id of one section, walked with the returned cursors at limit 1. */
      const walk = async (token: string, host: string, section: 'unread' | 'read') => {
        const seen: string[] = [];
        let cursor: string | null = null;
        for (let guard = 0; guard < 200; guard++) {
          const query: string = cursor
            ? `?section=${section}&limit=1&cursor=${encodeURIComponent(cursor)}`
            : `?section=${section}&limit=1`;
          const res = await request(`/v1/notifications${query}`, token, {
            [TENANT_HOST_HEADER]: host,
          });
          expect(res.status).toBe(200);
          const body = (await res.json()) as { items: { id: string }[]; nextCursor: string | null };
          seen.push(...body.items.map((item) => item.id));
          cursor = body.nextCursor;
          if (cursor === null) break;
        }
        return seen;
      };

      const demoSeen = [
        ...(await walk(tokens.demoMember, HOSTS.demo, 'unread')),
        ...(await walk(tokens.demoMember, HOSTS.demo, 'read')),
      ];
      // Positive control: the demo member reaches its OWN row, so the negative below is not vacuous.
      expect(demoSeen).toContain(demoRow);
      for (const id of labRows) expect(demoSeen).not.toContain(id);

      // …and the lab member, symmetrically, reaches its own rows and never the demo one.
      const labSeen = [
        ...(await walk(tokens.labMember, HOSTS.lab, 'unread')),
        ...(await walk(tokens.labMember, HOSTS.lab, 'read')),
      ];
      for (const id of labRows) expect(labSeen).toContain(id);
      expect(labSeen).not.toContain(demoRow);

      // A demo session presented on the lab's registered host is refused before any read (D-23).
      const mismatch = await request('/v1/notifications', tokens.demoMember, {
        [TENANT_HOST_HEADER]: HOSTS.lab,
      });
      expect(mismatch.status).toBe(403);
      expect(await code(mismatch)).toBe('TENANT_HOST_MISMATCH');
    } finally {
      if (inserted.length > 0) {
        await adminSql`delete from public.notifications where id = any(${inserted}::uuid[])`;
      }
      // The lab's row goes back EXACTLY as found (the seed keeps notifications off for rede-lab).
      if (labFlag) {
        await adminSql`
          update public.tenant_modules set enabled = ${labFlag.enabled}
           where tenant_id = ${tenantIds.lab}::uuid and module_key = 'notifications'`;
      } else {
        await adminSql`
          delete from public.tenant_modules
           where tenant_id = ${tenantIds.lab}::uuid and module_key = 'notifications'`;
      }
      moduleFlags.invalidate(tenantIds.lab);
    }
  });

  it('c. disabled: a tenant with the feed module off — read and write are both 404 MODULE_DISABLED', async () => {
    const list = await request('/v1/feed', tokens.nofeedMember, {
      [TENANT_HOST_HEADER]: NOFEED_HOST,
    });
    expect(list.status).toBe(404);
    expect(await code(list)).toBe('MODULE_DISABLED');

    const write = await api.request('/v1/feed/posts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens.nofeedMember}`,
        'content-type': 'application/json',
        [TENANT_HOST_HEADER]: NOFEED_HOST,
      },
      body: JSON.stringify({ caption: SHARED_TITLE }),
    });
    // MODULE_DISABLED wins over the permission check: "not here" never degrades into "not allowed",
    // which is what keeps a disabled module indistinguishable from one that was never bought.
    expect(write.status).toBe(404);
    expect(await code(write)).toBe('MODULE_DISABLED');
  });

  it('d. empty: a tenant with the module enabled and zero rows gets 200 { items: [] }', async () => {
    const res = await request('/v1/feed', tokens.emptyMember, {
      [TENANT_HOST_HEADER]: EMPTY_HOST,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
    // …while the other tenants demonstrably do have rows, so the empty answer is not a global outage.
    const demo = await request('/v1/feed', tokens.demoMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(((await demo.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
  });

  it('e. blocked: a member blocked between two requests is refused on the very next one', async () => {
    const before = await request('/v1/feed', tokens.blockedMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(before.status).toBe(200);

    await adminSql`
      update public.memberships set status = 'blocked', blocked_at = now()
       where user_id = ${blockedUserId}::uuid`;

    // Same still-valid token: the membership is re-read per request, so there is no window (AUTH-06).
    const after = await request('/v1/feed', tokens.blockedMember, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(after.status).toBe(403);
    expect(await code(after)).toBe('MEMBERSHIP_BLOCKED');
  });

  it('f. the tenant comes from the membership: a cookie and an unknown host cannot change it (D-23)', async () => {
    const res = await request('/v1/me/bootstrap', tokens.demoMember, {
      cookie: 'tenant_slug=rede-lab',
      [TENANT_HOST_HEADER]: 'rede-lab.example',
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as BootstrapBody;
    // The request says rede-lab three ways; the membership says rede-demo. The membership wins.
    expect(body.tenant.slug).toBe('rede-demo');
    expect(body.tenant.id).toBe(tenantIds.demo);
  });

  it("f2. a session of tenant A presented on tenant B's REGISTERED host is 403, on every route (D-23)", async () => {
    // `/v1/communities` and `/v1/stories` join the loop for the reason SCHEMA-CONVENTIONS §(j)
    // rule 2 gives: every new endpoint adds a cross-tenant case here. The host check fires in
    // `requireAuth`, BEFORE `requireModule`, so the answer is the same 403 on a module the
    // session's tenant does have.
    for (const path of [
      '/v1/me/bootstrap',
      '/v1/feed',
      '/v1/communities',
      '/v1/stories',
      // 05-08: the Destaques read joins the loop for the SCHEMA-CONVENTIONS §(j) rule 2 reason —
      // every new endpoint adds a cross-tenant case here. It takes a query parameter, which is
      // exactly why it is worth including: the host check must fire before the parameter is read.
      // 05.2-01: the highlight row read joins the loop — SCHEMA-CONVENTIONS §(j) rule 2, every new
      // endpoint adds a cross-tenant case here. It resolves a place before it reads anything, and
      // the host check must refuse the session before that resolution ever runs.
      '/v1/stories/highlights',
      // 05.3-02: the Reels lanes read joins the loop — SCHEMA-CONVENTIONS §(j) rule 2, every new
      // endpoint adds a cross-tenant case here. It NAMES communities, so the host check must refuse
      // the session before a single name is read.
      REELS_LANES_PATH,
      // 06-01: the events list joins the loop — SCHEMA-CONVENTIONS §(j) rule 2.
      '/v1/events',
      // 06-03: the event detail joins it too (the demo's own seeded upcoming event).
      '/v1/events/0d000000-0000-4000-8000-000000000e01',
      // 06-04: the manage-only edit read joins it (the loop is GET-only; the PUT/PATCH cross-tenant
      // cases live in events-admin.test.ts case 9). The host check refuses before the permission.
      '/v1/events/0d000000-0000-4000-8000-000000000e01/edit',
      // 06-07: the admin-only attendance reads join it (the regeneration POST's cross-tenant cases,
      // and the lab-id bare 404s, live in events-attendance.test.ts). The host check refuses first.
      '/v1/events/0d000000-0000-4000-8000-000000000e01/attendance',
      '/v1/events/0d000000-0000-4000-8000-000000000e01/attendance/summary',
      // 06-08: the Início card's next-event read joins it — SCHEMA-CONVENTIONS §(j) rule 2. It
      // names the tenant's next event, so the host check must refuse the session before any read.
      '/v1/events/next',
    ]) {
      const res = await request(path, tokens.demoMember, { [TENANT_HOST_HEADER]: HOSTS.lab });
      expect(res.status).toBe(403);

      const text = await res.text();
      const envelope = JSON.parse(text) as Envelope;
      expect(envelope.error.code).toBe('TENANT_HOST_MISMATCH');
      // The refusal must not say which community lives at that address, nor leak a row.
      expect(envelope.error.details).toBeUndefined();
      for (const needle of ['rede-lab', 'Rede Lab', 'rede-demo', SHARED_TITLE]) {
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
    const res = await request('/v1/feed', tokens.superAdmin);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('NO_MEMBERSHIP');
  });

  it('g2. …and on a tenant host it is a host mismatch, not a membership answer (D-23)', async () => {
    const res = await request('/v1/feed', tokens.superAdmin, {
      [TENANT_HOST_HEADER]: HOSTS.demo,
    });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe('TENANT_HOST_MISMATCH');
  });

  it('h. bootstrap is scoped to the tenant: rede-lab sees exactly [reels, events, feed]', async () => {
    const res = await request('/v1/me/bootstrap', tokens.labMember, {
      [TENANT_HOST_HEADER]: HOSTS.lab,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BootstrapBody;
    // D-17 pins rede-lab to feed + events, and 05.3-01 adds `reels`, on by default (D-122), sorted
    // first by its nav order 30. Lab keeps `communities`, `chat` and `notifications` OFF: that is
    // its disabled-module role (modules.test cases 4-8, 13). Case (c) uses its own no-feed tenant.
    expect(body.modules.map((m) => m.key)).toEqual(['reels', 'events', 'feed']);
    expect(body.tenant.id).toBe(tenantIds.lab);
  });

  it('i. the public host lookup answers about one tenant only; a suspended host answers with its status (D-20, D-32)', async () => {
    const lab = await api.request(
      `/v1/public/tenants/by-host?host=${encodeURIComponent(HOSTS.lab)}`,
    );
    expect(lab.status).toBe(200);
    const labText = await lab.text();
    // Brand and host facts (02-01); the exact key set is pinned in hosts.test.ts.
    expect(JSON.parse(labText)).toMatchObject({ slug: 'rede-lab', displayName: 'Rede Lab' });
    // Unauthenticated and pre-login: it may name the tenant on THIS host and nothing else.
    expect(labText).not.toContain('rede-demo');
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
    for (const needle of ['rede-demo', 'Rede Demo', tenantIds.demo, displayNames.demo]) {
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
    expect(refusal).not.toContain('rede-demo');
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
    expect(JSON.stringify(error)).not.toContain('rede-demo');
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

  /**
   * 04-08 / T-04-49. `/post/{id}` is the one URL this product hands a member to send OUTSIDE the
   * app, which makes its id space the most enumerable surface we have: anyone holding one link
   * holds a well-formed probe for every other post in every other community.
   *
   * The guarantee is therefore stronger than "B cannot read A's post". It is that B cannot LEARN
   * anything by asking — so the three ways of missing must be one answer, byte for byte:
   *
   *   1. a post of ANOTHER tenant (RLS never returns the row to this lane);
   *   2. a uuid that matches nothing at all;
   *   3. a post of the caller's OWN tenant carrying a soft-delete stamp.
   *
   * The assertion is an EQUALITY between the three response bodies rather than three separate
   * checks against a literal: a future `details` key, a different message, even a different key
   * ORDER would fail it, which is exactly the class of change that turns a 404 into an oracle.
   *
   * The positive control sits in the same test (the 03-08 rule): each community really can open its
   * own post, so a globally broken route could not certify this guarantee vacuously.
   */
  it('q. the post detail: cross-tenant, unknown and removed are ONE byte-identical 404 (T-04-49)', async () => {
    const foreign = await request(`/v1/feed/posts/${postIds.demo}`, tokens.labMember);
    const unknown = await request(`/v1/feed/posts/${crypto.randomUUID()}`, tokens.labMember);
    const removed = await request(`/v1/feed/posts/${postIds.demoRemoved}`, tokens.demoMember);

    for (const res of [foreign, unknown, removed]) expect(res.status).toBe(404);

    const bodies = await Promise.all([foreign.text(), unknown.text(), removed.text()]);
    // Byte-identical once the per-request correlation id is removed. `requestId` is the ONE field
    // that legitimately differs between two requests — it identifies the call, not the row — and
    // stripping it is what makes the rest of the comparison meaningful rather than always-false.
    // Everything else, including key order, must match: a future `details` key or a different
    // message on any one branch is exactly the change that turns a 404 into an oracle.
    const withoutRequestId = (raw: string) => {
      const parsed = JSON.parse(raw) as Envelope;
      const { requestId: _requestId, ...error } = parsed.error as Envelope['error'] & {
        requestId?: string;
      };
      return JSON.stringify({ error });
    };
    expect(withoutRequestId(bodies[1] as string)).toEqual(withoutRequestId(bodies[0] as string));
    expect(withoutRequestId(bodies[2] as string)).toEqual(withoutRequestId(bodies[0] as string));

    const envelope = JSON.parse(bodies[0] as string) as Envelope;
    expect(envelope.error.code).toBe('NOT_FOUND');
    expect('details' in envelope.error).toBe(false);
    // And it names nothing about the other community — not the tenant, not the caption, not the id.
    for (const needle of ['rede-demo', 'Rede Demo', tenantIds.demo, SHARED_CAPTION, postIds.demo]) {
      expect(bodies[0]).not.toContain(needle);
    }

    // Positive control — each community opens its OWN post, so the 404s above are about the caller.
    for (const [token, postId] of [
      [tokens.demoMember, postIds.demo],
      [tokens.labMember, postIds.lab],
    ] as const) {
      const own = await request(`/v1/feed/posts/${postId}`, token);
      expect(own.status).toBe(200);
      expect(((await own.json()) as { id: string }).id).toBe(postId);
    }
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
