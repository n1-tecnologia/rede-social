import { PLATFORM_TERMS_VERSION, TENANT_HOST_HEADER } from '@rede-social/contracts';
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

/* ── 08-10: the sweeps' shared shapes ───────────────────────────────────────────────────────── */

/** Any method, any host, an optional JSON body: the one request shape every 08-10 sweep uses. */
const send = (method: string, path: string, token: string, host: string, body?: unknown) =>
  api.request(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      [TENANT_HOST_HEADER]: host,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** `requestId` identifies the CALL, not the row — stripping it makes two refusals comparable (case q). */
function sansRequestId(raw: string): string {
  const { requestId: _requestId, ...error } = (JSON.parse(raw) as Envelope)
    .error as Envelope['error'] & { requestId?: string };
  return JSON.stringify({ error });
}

/** One bare NOT_FOUND (D-23): no `details` key at all. Returns the raw body for further needles. */
async function expectBareNotFound(res: Response, label: string): Promise<string> {
  const text = await res.text();
  expect(res.status, `${label}: ${text}`).toBe(404);
  const body = JSON.parse(text) as Envelope;
  expect(body.error.code, label).toBe('NOT_FOUND');
  expect(Object.hasOwn(body.error, 'details'), label).toBe(false);
  return text;
}

/** A session presented on another tenant's registered host is refused before any read (D-23). */
async function expectHostRefused(res: Response, label: string): Promise<void> {
  expect(res.status, label).toBe(403);
  expect(await code(res), label).toBe('TENANT_HOST_MISMATCH');
}

/** The database clock: every "since" below compares against `created_on`/`created_at` it wrote. */
async function dbNow(): Promise<Date> {
  const [row] = await adminSql<{ now: Date }[]>`select now() as now`;
  return row?.now ?? new Date();
}

/**
 * The jobs a sweep's writes queued for these tenants are CLOSED, not run (the admin-branding
 * precedent): a later suite that plays the worker for rede-demo must not inherit a fan-out about a
 * post, story or event this file already deleted. Matched by `tenantId` in the payload or by the
 * singleton key (the icon derivation keys on the tenant id).
 */
async function closeJobsSince(since: Date, tenants: string[]): Promise<void> {
  await adminSql`
    update pgboss.job set state = 'completed', completed_on = now()
     where state = 'created' and created_on >= ${since}
       and (data->>'tenantId' = any(${tenants}::text[]) or singleton_key = any(${tenants}::text[]))`;
}

/** A READY image of `purpose`, written directly (the `seedCover` shape, any purpose). */
async function seedReadyImage(
  tenantId: string,
  email: string,
  purpose: 'post' | 'cover',
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width, height,
       variant_widths, filename, ready_at)
    select ${tenantId}::uuid, u.id, 'image', ${purpose}, 'ready', 'supabase',
           'image/webp', 262144, 1600, 900, '{320,640,960,1280}'::int[], 'varredura.webp', now()
      from public.users u where u.email = ${email}
    returning id`;
  if (!row) throw new Error(`could not seed a ${purpose} image for ${email}`);
  mediaAssetIds.push(row.id);
  return row.id;
}

/** A live STORY of 24 h, written directly (the `stories.test.ts` fixture), image from `seedStoryImage`. */
async function seedLiveStory(tenantId: string, email: string): Promise<string> {
  const assetId = await seedStoryImage(tenantId, email);
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.stories
      (tenant_id, author_user_id, media_asset_id, media_kind, caption, published_at, expires_at)
    select ${tenantId}::uuid, u.id, ${assetId}::uuid, 'image', ${`Varredura 08-10 ${RUN}`},
           now(), now() + interval '24 hours'
      from public.users u where u.email = ${email}
    returning id::text as id`;
  if (!row) throw new Error(`could not seed a story for ${email}`);
  return row.id;
}

async function userIdOf(email: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id::text as id from public.users where email = ${email}`;
  if (!row) throw new Error(`${email} is not seeded`);
  return row.id;
}

/** A ROOT comment written directly, on a post or on a story (exactly one target). */
async function seedComment(
  tenantId: string,
  target: { postId: string } | { storyId: string },
  authorUserId: string,
): Promise<string> {
  const postId = 'postId' in target ? target.postId : null;
  const storyId = 'storyId' in target ? target.storyId : null;
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.feed_comments (tenant_id, post_id, story_id, author_user_id, body)
    values (${tenantId}::uuid, ${postId}::uuid, ${storyId}::uuid, ${authorUserId}::uuid,
            'Comentário de varredura.')
    returning id::text as id`;
  if (!row) throw new Error(`could not seed a comment in ${tenantId}`);
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

  it("b11. push subscriptions: a demo member cannot forget a lab member's device, and a demo session on the lab host is refused (07-06)", async () => {
    // `push_subscriptions` is OWNER-scoped and tenant-ANDed (T-07-36). The fixture is adjacent on
    // purpose: the demo and lab devices carry the SAME endpoint string (uniqueness is per tenant), so
    // only the tenant and the owner can tell them apart. rede-lab has notifications OFF in the seed,
    // so it is turned on for this case (the lab member saves through the real route) and restored in
    // `finally`.
    const { createECDH, randomBytes } = await import('node:crypto');
    const keys = () => {
      const ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
      return {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      };
    };
    const push = (method: 'POST' | 'DELETE', token: string, host: string, body: object) =>
      api.request('/v1/notifications/push-subscriptions', {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          [TENANT_HOST_HEADER]: host,
        },
        body: JSON.stringify(body),
      });
    const endpoint = `https://push.fake.test/sub/isolation-b11-${RUN}`;
    const rowsFor = () =>
      adminSql<{ tenant_id: string }[]>`
        select tenant_id::text as tenant_id from public.push_subscriptions
         where endpoint = ${endpoint} order by tenant_id`;
    const [labFlag] = await adminSql<{ enabled: boolean }[]>`
      select enabled from public.tenant_modules
       where tenant_id = ${tenantIds.lab}::uuid and module_key = 'notifications'`;
    try {
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${tenantIds.lab}::uuid, 'notifications', true)
        on conflict (tenant_id, module_key) do update set enabled = true`;
      moduleFlags.invalidate(tenantIds.lab);

      expect(
        (await push('POST', tokens.labMember, HOSTS.lab, { endpoint, keys: keys() })).status,
      ).toBe(204);
      expect(
        (await push('POST', tokens.demoMember, HOSTS.demo, { endpoint, keys: keys() })).status,
      ).toBe(204);
      // Adjacency: the same endpoint is a separate row per tenant; the demo save moved nothing.
      expect((await rowsFor()).map((row) => row.tenant_id).sort()).toEqual(
        [tenantIds.demo, tenantIds.lab].sort(),
      );

      // The demo member forgets "the lab's" endpoint: 204 (no oracle), and the lab row still exists.
      await adminSql`
        delete from public.push_subscriptions
         where tenant_id = ${tenantIds.demo}::uuid and endpoint = ${endpoint}`;
      expect((await push('DELETE', tokens.demoMember, HOSTS.demo, { endpoint })).status).toBe(204);
      expect((await rowsFor()).map((row) => row.tenant_id)).toEqual([tenantIds.lab]);

      // Positive control: the demo member deleting its OWN device removes exactly that row.
      expect(
        (await push('POST', tokens.demoMember, HOSTS.demo, { endpoint, keys: keys() })).status,
      ).toBe(204);
      expect((await push('DELETE', tokens.demoMember, HOSTS.demo, { endpoint })).status).toBe(204);
      expect((await rowsFor()).map((row) => row.tenant_id)).toEqual([tenantIds.lab]);

      // A demo session presented on the lab's registered host is refused before any write (D-23).
      const mismatch = await push('POST', tokens.demoMember, HOSTS.lab, { endpoint, keys: keys() });
      expect(mismatch.status).toBe(403);
      expect(await code(mismatch)).toBe('TENANT_HOST_MISMATCH');
      const mismatchDelete = await push('DELETE', tokens.demoMember, HOSTS.lab, { endpoint });
      expect(mismatchDelete.status).toBe(403);
      expect((await rowsFor()).map((row) => row.tenant_id)).toEqual([tenantIds.lab]);
    } finally {
      await adminSql`delete from public.push_subscriptions where endpoint = ${endpoint}`;
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

  it("b12. chat: a lab member's thread is a bare 404 to demo members and demo staff, a second demo member cannot read the first's, and a demo session on the lab host is refused (07-08)", async () => {
    // Support threads are the first data private between members of the SAME tenant (T-07-50), on
    // top of the tenant boundary (T-07-51). The seeded demo thread (`SEED_SUPPORT_CONVERSATION_ID`,
    // `member@rede-demo.local`) is the positive control; the lab thread is written here with the
    // SAME first body (adjacency). rede-lab has `chat` OFF in the seed, so it is turned on for this
    // case (the lab thread is then live and readable by its own member, the strongest negative) and
    // restored in `finally`.
    const seeded = '1d000000-0000-4000-8000-000000000001';
    const labConversation = '0b120000-0000-4000-8000-000000000001';
    const [labUser] = await adminSql<{ id: string }[]>`
      select id::text as id from auth.users where email = 'member@rede-lab.local'`;
    const demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
    const demoSecond = await signInAs('joao.goncalves@rede-demo.local', SEED_PASSWORD);
    const [labFlag] = await adminSql<{ enabled: boolean }[]>`
      select enabled from public.tenant_modules
       where tenant_id = ${tenantIds.lab}::uuid and module_key = 'chat'`;
    const messages = (token: string, host: string, id: string) =>
      request(`/v1/chat/conversations/${id}/messages`, token, { [TENANT_HOST_HEADER]: host });
    /** One bare NOT_FOUND: no details, nothing that tells "another tenant's" from "unknown". */
    const expectBare404 = async (res: Response) => {
      expect(res.status).toBe(404);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error).not.toHaveProperty('details');
    };
    try {
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${tenantIds.lab}::uuid, 'chat', true)
        on conflict (tenant_id, module_key) do update set enabled = true`;
      moduleFlags.invalidate(tenantIds.lab);
      await adminSql`
        insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
        values (${labConversation}::uuid, ${tenantIds.lab}::uuid, 'support', ${labUser?.id ?? ''}::uuid)`;
      await adminSql`
        insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
        values (${labConversation}::uuid, ${tenantIds.lab}::uuid, ${labUser?.id ?? ''}::uuid, 'member')`;
      await adminSql`
        insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
        values (${tenantIds.lab}::uuid, ${labConversation}::uuid, ${labUser?.id ?? ''}::uuid, 'member',
                'Oi, preciso de ajuda com meu cadastro.')`;

      // Positive controls: the demo member and the demo support user read the seeded demo thread,
      // and the lab member reads its own.
      const own = await messages(tokens.demoMember, HOSTS.demo, seeded);
      expect(own.status).toBe(200);
      expect(((await own.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
      expect((await messages(demoSupport, HOSTS.demo, seeded)).status).toBe(200);
      expect((await messages(tokens.labMember, HOSTS.lab, labConversation)).status).toBe(200);

      // T-07-51: the lab thread through a demo lane is the bare 404, for a member and for staff.
      await expectBare404(await messages(tokens.demoMember, HOSTS.demo, labConversation));
      await expectBare404(await messages(demoSupport, HOSTS.demo, labConversation));

      // T-07-50: a SECOND demo member reading the first member's thread is the same bare 404.
      await expectBare404(await messages(demoSecond, HOSTS.demo, seeded));

      // A demo session presented on the lab's registered host is refused before any read (D-23).
      const mismatch = await messages(tokens.demoMember, HOSTS.lab, labConversation);
      expect(mismatch.status).toBe(403);
      expect(await code(mismatch)).toBe('TENANT_HOST_MISMATCH');
    } finally {
      await adminSql`delete from public.chat_conversations where id = ${labConversation}::uuid`;
      if (labFlag) {
        await adminSql`
          update public.tenant_modules set enabled = ${labFlag.enabled}
           where tenant_id = ${tenantIds.lab}::uuid and module_key = 'chat'`;
      } else {
        await adminSql`
          delete from public.tenant_modules
           where tenant_id = ${tenantIds.lab}::uuid and module_key = 'chat'`;
      }
      moduleFlags.invalidate(tenantIds.lab);
    }
  });

  it('phase 7 sweep: every Phase 7 route answers a demo session about its own tenant only, each block beside its positive control (07-11, TENANT-05)', async () => {
    // The route inventory this case closes (07-11). "b10/b11/b12" = already covered by that case;
    // "sweep" = asserted below. Every negative sits beside a demo positive control in this test, and
    // every route family is also refused on the lab's registered host (403 TENANT_HOST_MISMATCH).
    //
    // | Route                                              | Covered by   | Negative asserted here                         |
    // |----------------------------------------------------|--------------|------------------------------------------------|
    // | GET    /v1/notifications (unread + read sections)  | b10          | —                                              |
    // | POST   /v1/notifications/seen                       | sweep        | the lab row keeps seen_at null                 |
    // | POST   /v1/notifications/read-all                   | sweep        | the lab row keeps read_at null                 |
    // | POST   /v1/notifications/{id}/read                  | sweep        | the lab id is a bare 404, the lab row unread   |
    // | POST   /v1/notifications/push-subscriptions         | b11          | —                                              |
    // | DELETE /v1/notifications/push-subscriptions         | b11          | —                                              |
    // | GET    /v1/me/counters                              | sweep        | lab rows never move the demo member's counters |
    // | GET    /v1/chat/support                             | sweep        | the demo member's own thread, never the lab's  |
    // | POST   /v1/chat/support/messages                    | sweep        | creates a DEMO thread; the lab thread untouched|
    // | GET    /v1/chat/conversations/{id}                  | sweep        | bare 404 for a demo member and demo staff      |
    // | GET    /v1/chat/conversations/{id}/messages         | b12 + sweep  | bare 404 (b12); staff lane re-asserted here     |
    // | POST   /v1/chat/conversations/{id}/messages         | sweep        | bare 404 for demo staff, 403 for a member      |
    // | POST   /v1/chat/conversations/{id}/read             | sweep        | bare 404 for a demo member and demo staff      |
    // | GET    /v1/chat/inbox                               | sweep        | a full demo staff walk never lists the lab one |
    // | GET    /v1/feed/comments/{id}/thread                | sweep        | the lab comment id is a bare 404               |
    //
    // Realtime topics (`tenant:<t>:user:<u>`, `tenant:<t>:conv:<c>`, `tenant:<t>:support-inbox`) keep
    // their cross-tenant negatives in `realtime.test.ts` (07-03, 07-08); the tables in
    // `supabase/tests/020-tenant-isolation.sql`.
    //
    // A THROWAWAY demo member carries the demo side, so marking everything read or seen, and opening
    // a support thread, never disturbs the seeded rows later files count. rede-lab has
    // `notifications` and `chat` OFF in the seed: both are turned on here (the lab rows are then
    // live and readable by their own users, the strongest negative) and restored in `finally`.
    const labConversation = '0b130000-0000-4000-8000-000000000001';
    const sweepEmail = `sweep-${RUN}@rede-demo.local`;
    const sweepMember = await throwawayMember(tenantIds.demo, sweepEmail);
    const sweepUser = throwawayUsers[throwawayUsers.length - 1] ?? '';
    const [labUser] = await adminSql<{ id: string }[]>`
      select id::text as id from auth.users where email = 'member@rede-lab.local'`;
    const labUserId = labUser?.id ?? '';
    const demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
    const labSupport = await signInAs('support@rede-lab.local', SEED_PASSWORD);
    const subject = '0b130000-0000-4000-8000-0000000000aa';
    const dedupe = `isolation.sweep:${RUN}`;

    const call = (
      method: 'GET' | 'POST',
      path: string,
      token: string,
      host: string,
      body?: object,
    ) =>
      api.request(path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          [TENANT_HOST_HEADER]: host,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    /** One bare NOT_FOUND: no details, nothing that tells "another tenant's" from "unknown". */
    const expectBare404 = async (res: Response) => {
      expect(res.status).toBe(404);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error).not.toHaveProperty('details');
    };
    const expectHostMismatch = async (res: Response) => {
      expect(res.status).toBe(403);
      expect(await code(res)).toBe('TENANT_HOST_MISMATCH');
    };
    const counters = async (token: string, host: string) => {
      const res = await call('GET', '/v1/me/counters', token, host);
      expect(res.status).toBe(200);
      return (await res.json()) as {
        unreadNotifications: number;
        unreadConversations: number;
        conversationsBadge: string;
      };
    };
    const labRow = async (id: string) => {
      const [row] = await adminSql<{ read_at: string | null; seen_at: string | null }[]>`
        select read_at::text, seen_at::text from public.notifications where id = ${id}::uuid`;
      return row;
    };

    const flagsBefore = await adminSql<{ module_key: string; enabled: boolean }[]>`
      select module_key, enabled from public.tenant_modules
       where tenant_id = ${tenantIds.lab}::uuid and module_key in ('notifications', 'chat')`;
    const insertedNotifications: string[] = [];
    const commentIds: string[] = [];
    let sweepConversation = '';
    try {
      await adminSql`
        insert into public.tenant_modules (tenant_id, module_key, enabled)
        values (${tenantIds.lab}::uuid, 'notifications', true), (${tenantIds.lab}::uuid, 'chat', true)
        on conflict (tenant_id, module_key) do update set enabled = true`;
      moduleFlags.invalidate(tenantIds.lab);

      // ── /v1/me/counters: the demo member's own numbers, which a lab row never moves ──────────
      const demoCountersBefore = await counters(sweepMember, HOSTS.demo);
      const labCountersBefore = await counters(tokens.labMember, HOSTS.lab);

      // Adjacent notification rows: the SAME kind, dedupe key and subject on both sides.
      const [labNotification] = await adminSql<{ id: string }[]>`
        insert into public.notifications
          (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id)
        values (${tenantIds.lab}::uuid, ${labUserId}::uuid, 'feed.post', ${dedupe}, 'post', ${subject}::uuid)
        returning id::text as id`;
      const labNotificationId = labNotification?.id ?? '';
      insertedNotifications.push(labNotificationId);
      // A lab support thread with a message from the lab member: live in the lab inbox.
      await adminSql`
        insert into public.chat_conversations (id, tenant_id, kind, created_by_user_id)
        values (${labConversation}::uuid, ${tenantIds.lab}::uuid, 'support', ${labUserId}::uuid)`;
      await adminSql`
        insert into public.chat_participants (conversation_id, tenant_id, user_id, role)
        values (${labConversation}::uuid, ${tenantIds.lab}::uuid, ${labUserId}::uuid, 'member')`;
      await adminSql`
        insert into public.chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
        values (${tenantIds.lab}::uuid, ${labConversation}::uuid, ${labUserId}::uuid, 'member',
                'Oi, preciso de ajuda com meu cadastro.')`;

      // The lab rows never reach the demo member's counters…
      expect(await counters(sweepMember, HOSTS.demo)).toEqual(demoCountersBefore);
      // …while the lab member's own counter moved (positive control: the counter is not dead).
      const labCountersAfter = await counters(tokens.labMember, HOSTS.lab);
      expect(labCountersAfter.unreadNotifications).toBe(labCountersBefore.unreadNotifications + 1);
      // …and a DEMO row for the demo member does move its own counter.
      const [demoNotification] = await adminSql<{ id: string }[]>`
        insert into public.notifications
          (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id)
        values (${tenantIds.demo}::uuid, ${sweepUser}::uuid, 'feed.post', ${dedupe}, 'post', ${subject}::uuid)
        returning id::text as id`;
      const demoNotificationId = demoNotification?.id ?? '';
      insertedNotifications.push(demoNotificationId);
      expect((await counters(sweepMember, HOSTS.demo)).unreadNotifications).toBe(
        demoCountersBefore.unreadNotifications + 1,
      );
      await expectHostMismatch(await call('GET', '/v1/me/counters', sweepMember, HOSTS.lab));

      // ── /v1/notifications/{id}/read, /seen, /read-all ────────────────────────────────────────
      await expectBare404(
        await call('POST', `/v1/notifications/${labNotificationId}/read`, sweepMember, HOSTS.demo),
      );
      expect((await labRow(labNotificationId))?.read_at).toBeNull();
      // Positive control: the demo member's own row reads.
      const ownRead = await call(
        'POST',
        `/v1/notifications/${demoNotificationId}/read`,
        sweepMember,
        HOSTS.demo,
      );
      expect(ownRead.status).toBe(204);
      expect((await labRow(demoNotificationId))?.read_at).not.toBeNull();
      // A second unread demo row, so /seen and /read-all have something of their own to change.
      const [demoSecond] = await adminSql<{ id: string }[]>`
        insert into public.notifications
          (tenant_id, user_id, kind, dedupe_key, subject_type, subject_id)
        values (${tenantIds.demo}::uuid, ${sweepUser}::uuid, 'feed.post', ${`${dedupe}:2`}, 'post', ${subject}::uuid)
        returning id::text as id`;
      const demoSecondId = demoSecond?.id ?? '';
      insertedNotifications.push(demoSecondId);
      expect((await call('POST', '/v1/notifications/seen', sweepMember, HOSTS.demo)).status).toBe(
        204,
      );
      expect((await labRow(demoSecondId))?.seen_at).not.toBeNull();
      expect((await labRow(labNotificationId))?.seen_at).toBeNull();
      expect(
        (await call('POST', '/v1/notifications/read-all', sweepMember, HOSTS.demo)).status,
      ).toBe(204);
      expect((await labRow(demoSecondId))?.read_at).not.toBeNull();
      expect((await labRow(labNotificationId))?.read_at).toBeNull();
      await expectHostMismatch(
        await call('POST', '/v1/notifications/read-all', sweepMember, HOSTS.lab),
      );
      await expectHostMismatch(
        await call('POST', `/v1/notifications/${labNotificationId}/read`, sweepMember, HOSTS.lab),
      );
      expect((await labRow(labNotificationId))?.read_at).toBeNull();

      // ── /v1/chat/support and /v1/chat/support/messages ──────────────────────────────────────
      // Before its first message the demo member has no thread (D-220), and never the lab's.
      const before = await call('GET', '/v1/chat/support', sweepMember, HOSTS.demo);
      expect(before.status).toBe(200);
      expect(((await before.json()) as { conversation: unknown }).conversation).toBeNull();
      const sent = await call('POST', '/v1/chat/support/messages', sweepMember, HOSTS.demo, {
        body: 'Oi, preciso de ajuda com meu cadastro.',
      });
      expect(sent.status).toBe(201);
      sweepConversation = ((await sent.json()) as { conversationId: string }).conversationId;
      expect(sweepConversation).not.toBe(labConversation);
      const [created] = await adminSql<{ tenant_id: string }[]>`
        select tenant_id::text as tenant_id from public.chat_conversations
         where id = ${sweepConversation}::uuid`;
      expect(created?.tenant_id).toBe(tenantIds.demo);
      const after = await call('GET', '/v1/chat/support', sweepMember, HOSTS.demo);
      expect(((await after.json()) as { conversation: { id: string } }).conversation.id).toBe(
        sweepConversation,
      );
      await expectHostMismatch(await call('GET', '/v1/chat/support', sweepMember, HOSTS.lab));
      await expectHostMismatch(
        await call('POST', '/v1/chat/support/messages', sweepMember, HOSTS.lab, { body: 'Oi.' }),
      );

      // ── /v1/chat/conversations/{id} (detail) ─────────────────────────────────────────────────
      const conversation = (id: string) => `/v1/chat/conversations/${id}`;
      expect(
        (await call('GET', conversation(sweepConversation), sweepMember, HOSTS.demo)).status,
      ).toBe(200);
      expect(
        (await call('GET', conversation(sweepConversation), demoSupport, HOSTS.demo)).status,
      ).toBe(200);
      expect(
        (await call('GET', conversation(labConversation), tokens.labMember, HOSTS.lab)).status,
      ).toBe(200);
      await expectBare404(
        await call('GET', conversation(labConversation), sweepMember, HOSTS.demo),
      );
      await expectBare404(
        await call('GET', conversation(labConversation), demoSupport, HOSTS.demo),
      );
      await expectHostMismatch(
        await call('GET', conversation(labConversation), demoSupport, HOSTS.lab),
      );

      // ── /v1/chat/conversations/{id}/messages (GET + POST) ────────────────────────────────────
      const messagesPath = (id: string) => `${conversation(id)}/messages`;
      expect(
        (await call('GET', messagesPath(sweepConversation), demoSupport, HOSTS.demo)).status,
      ).toBe(200);
      await expectBare404(
        await call('GET', messagesPath(labConversation), demoSupport, HOSTS.demo),
      );
      // Positive control: demo staff reply to the demo thread.
      const reply = await call('POST', messagesPath(sweepConversation), demoSupport, HOSTS.demo, {
        body: 'Olá! Já vamos te ajudar.',
      });
      expect(reply.status).toBe(201);
      // Demo staff replying into the lab thread: the bare 404, and nothing is written there.
      await expectBare404(
        await call('POST', messagesPath(labConversation), demoSupport, HOSTS.demo, {
          body: 'Olá! Já vamos te ajudar.',
        }),
      );
      // A member never replies through the staff lane: FORBIDDEN before any lookup, whatever the id.
      const memberReply = await call(
        'POST',
        messagesPath(labConversation),
        sweepMember,
        HOSTS.demo,
        {
          body: 'Olá.',
        },
      );
      expect(memberReply.status).toBe(403);
      const [labMessages] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.chat_messages where conversation_id = ${labConversation}::uuid`;
      expect(labMessages?.n).toBe(1);
      await expectHostMismatch(
        await call('POST', messagesPath(labConversation), demoSupport, HOSTS.lab, { body: 'Olá.' }),
      );

      // ── /v1/chat/conversations/{id}/read ─────────────────────────────────────────────────────
      const readPath = (id: string) => `${conversation(id)}/read`;
      const labReadPositions = () =>
        adminSql<{ staff: string; member: string }[]>`
          select c.staff_last_read_seq::text as staff, p.last_read_seq::text as member
            from public.chat_conversations c
            join public.chat_participants p on p.conversation_id = c.id
           where c.id = ${labConversation}::uuid`;
      const labPositionsBefore = await labReadPositions();
      expect(labPositionsBefore).toHaveLength(1);
      expect(
        (await call('POST', readPath(sweepConversation), sweepMember, HOSTS.demo, { seq: 1 }))
          .status,
      ).toBe(204);
      expect(
        (await call('POST', readPath(sweepConversation), demoSupport, HOSTS.demo, { seq: 1 }))
          .status,
      ).toBe(204);
      await expectBare404(
        await call('POST', readPath(labConversation), sweepMember, HOSTS.demo, { seq: 1 }),
      );
      await expectBare404(
        await call('POST', readPath(labConversation), demoSupport, HOSTS.demo, { seq: 1 }),
      );
      expect(await labReadPositions()).toEqual(labPositionsBefore);
      await expectHostMismatch(
        await call('POST', readPath(labConversation), demoSupport, HOSTS.lab, { seq: 1 }),
      );

      // ── /v1/chat/inbox: a full demo staff walk never lists the lab thread ──────────────────────
      const walkInbox = async (token: string, host: string) => {
        const seen: string[] = [];
        let cursor: string | null = null;
        for (let guard = 0; guard < 200; guard++) {
          const query: string = cursor
            ? `?limit=5&cursor=${encodeURIComponent(cursor)}`
            : '?limit=5';
          const res = await call('GET', `/v1/chat/inbox${query}`, token, host);
          expect(res.status).toBe(200);
          const body = (await res.json()) as {
            items: { conversationId: string }[];
            nextCursor: string | null;
          };
          seen.push(...body.items.map((item) => item.conversationId));
          cursor = body.nextCursor;
          if (cursor === null) break;
        }
        return seen;
      };
      const demoInbox = await walkInbox(demoSupport, HOSTS.demo);
      expect(demoInbox).toContain(sweepConversation);
      expect(demoInbox).not.toContain(labConversation);
      const labInbox = await walkInbox(labSupport, HOSTS.lab);
      expect(labInbox).toContain(labConversation);
      expect(labInbox).not.toContain(sweepConversation);
      await expectHostMismatch(await call('GET', '/v1/chat/inbox', demoSupport, HOSTS.lab));

      // ── /v1/feed/comments/{id}/thread ────────────────────────────────────────────────────────
      const commentOn = async (tenantId: string, postId: string) => {
        const [row] = await adminSql<{ id: string }[]>`
          insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth)
          select ${tenantId}::uuid, ${postId}::uuid, m.user_id, 'Comentário de teste.', 0, null, null
            from public.memberships m
           where m.tenant_id = ${tenantId}::uuid and m.role = 'admin_tenant'
           limit 1
          returning id::text as id`;
        if (!row) throw new Error(`could not seed a comment in ${tenantId}`);
        commentIds.push(row.id);
        return row.id;
      };
      const demoComment = await commentOn(tenantIds.demo, postIds.demo);
      const labComment = await commentOn(tenantIds.lab, postIds.lab);
      const thread = (id: string) => `/v1/feed/comments/${id}/thread`;
      const ownThread = await call('GET', thread(demoComment), tokens.demoMember, HOSTS.demo);
      expect(ownThread.status).toBe(200);
      expect(((await ownThread.json()) as { targetId: string }).targetId).toBe(demoComment);
      expect((await call('GET', thread(labComment), tokens.labMember, HOSTS.lab)).status).toBe(200);
      await expectBare404(await call('GET', thread(labComment), tokens.demoMember, HOSTS.demo));
      await expectHostMismatch(await call('GET', thread(labComment), tokens.demoMember, HOSTS.lab));
    } finally {
      if (commentIds.length > 0) {
        await adminSql`delete from public.feed_comments where id = any(${commentIds}::uuid[])`;
      }
      await adminSql`delete from public.chat_conversations where id = ${labConversation}::uuid`;
      if (sweepConversation) {
        await adminSql`delete from public.chat_conversations where id = ${sweepConversation}::uuid`;
      }
      if (insertedNotifications.length > 0) {
        await adminSql`
          delete from public.notifications where id = any(${insertedNotifications}::uuid[])`;
      }
      await adminSql`delete from public.notifications where user_id = ${sweepUser}::uuid`;
      // The lab's rows go back EXACTLY as found (the seed keeps both modules off for rede-lab).
      for (const key of ['notifications', 'chat'] as const) {
        const found = flagsBefore.find((row) => row.module_key === key);
        if (found) {
          await adminSql`
            update public.tenant_modules set enabled = ${found.enabled}
             where tenant_id = ${tenantIds.lab}::uuid and module_key = ${key}`;
        } else {
          await adminSql`
            delete from public.tenant_modules
             where tenant_id = ${tenantIds.lab}::uuid and module_key = ${key}`;
        }
      }
      moduleFlags.invalidate(tenantIds.lab);
    }
  });

  it('phase 8 sweep: every Phase 8 route answers a demo admin about its own tenant only, each block beside its positive control (08-10, TENANT-05)', async () => {
    // The Phase 8 route inventory (08-10, `tests/isolation-inventory.ts`). Every row is asserted
    // below: the rede-lab id (or the rede-lab row) through the demo admin's lane, beside the demo
    // positive control in the same test, and every route again on the lab's registered host
    // (403 TENANT_HOST_MISMATCH, the "hosts" block).
    //
    // | Route                                                | Negative asserted here                                   |
    // |------------------------------------------------------|----------------------------------------------------------|
    // | GET    /v1/admin/moderation-log                      | a full walk never lists a lab row; the sweep's rows do    |
    // | GET    /v1/admin/members                             | a full walk never lists a lab membership                  |
    // | GET    /v1/admin/members/{id}                        | a lab membership id is the bare 404 (= unknown id)        |
    // | POST   /v1/admin/members/{id}/block                  | bare 404, the lab row byte-identical                      |
    // | POST   /v1/admin/members/{id}/unblock                | bare 404, the lab row byte-identical                      |
    // | PUT    /v1/admin/members/{id}/role                   | bare 404, the lab row byte-identical                      |
    // | DELETE /v1/feed/comments/{id}                        | a lab comment is the bare 404 and stays live              |
    // | DELETE /v1/stories/{id}/comments/{id}                | a lab story comment is the bare 404 and stays live        |
    // | GET    /v1/admin/branding                            | names the demo brand only                                 |
    // | PUT    /v1/admin/branding/colors                     | rede-lab's tenant row unchanged (snapshot)                |
    // | POST   /v1/admin/branding/uploads                    | minted under the demo prefix; lab row unchanged           |
    // | POST   /v1/admin/branding/uploads/{uploadId}/complete| a lab uploadId is the same 404 an unknown one gets        |
    // | DELETE /v1/admin/branding/icon                       | rede-lab's tenant row unchanged (snapshot)                |
    // | PATCH  /v1/admin/tenant                              | rede-lab's display name unchanged (snapshot)              |
    // | GET    /v1/admin/rules                               | answers the demo text and version only                    |
    // | PUT    /v1/admin/rules                               | rede-lab's rules text and version unchanged (snapshot)    |
    //
    // Then the 08-01 assumption-delta invariant: no `moderation_log` row anywhere names an actor or a
    // target membership of ANOTHER tenant, and every row this sweep wrote is anchored in its own.
    //
    // A THROWAWAY demo member is the subject of every demo-side write (block, unblock, role, the
    // removed comments), so the seeded rows later files count are never touched. rede-demo's tenant
    // row (brand, name, rules) is snapshotted and written back in `finally`, its added Storage
    // objects removed and the icon derivations it queued closed.
    const sweepStart = await dbNow();
    const asDemoAdmin = (method: string, path: string, body?: unknown) =>
      send(method, path, tokens.demoAdmin, HOSTS.demo, body);

    const subjectEmail = `varredura8-${RUN}@rede-demo.local`;
    await throwawayMember(tenantIds.demo, subjectEmail);
    const subjectUser = throwawayUsers[throwawayUsers.length - 1] ?? '';
    const demoSubject = await membershipIdOf(tenantIds.demo, subjectEmail);
    const labAdminMembership = await membershipIdOf(tenantIds.lab, 'admin@rede-lab.local');
    const labMemberMembership = membershipIds.lab;
    const labAdminUser = await userIdOf('admin@rede-lab.local');
    const labMemberUser = await userIdOf('member@rede-lab.local');

    type Settings = {
      display_name: string;
      branding: Record<string, unknown>;
      rules_text: string;
      rules_version: number;
    };
    const settingsOf = async (tenantId: string): Promise<Settings> => {
      const [row] = await adminSql<Settings[]>`
        select display_name, branding, rules_text, rules_version
          from public.tenants where id = ${tenantId}::uuid`;
      if (!row) throw new Error(`tenant ${tenantId} not found`);
      return row;
    };
    const membershipRow = async (id: string) => {
      const [row] = await adminSql<{ row: unknown }[]>`
        select to_jsonb(m) as row from public.memberships m where m.id = ${id}::uuid`;
      return row?.row;
    };
    const commentRow = async (id: string) => {
      const [row] = await adminSql<{ deleted_at: string | null; tenant_id: string }[]>`
        select deleted_at::text, tenant_id::text from public.feed_comments where id = ${id}::uuid`;
      return row;
    };
    const brandingObjects = async (tenantId: string) =>
      (
        await adminSql<{ name: string }[]>`
          select name from storage.objects
           where bucket_id = 'branding' and name like ${`${tenantId}/%`}`
      ).map((row) => row.name);

    const labSettingsBefore = await settingsOf(tenantIds.lab);
    const demoSettingsBefore = await settingsOf(tenantIds.demo);
    const labMembershipBefore = await membershipRow(labMemberMembership);
    const objectsBefore = {
      demo: new Set(await brandingObjects(tenantIds.demo)),
      lab: new Set(await brandingObjects(tenantIds.lab)),
    };

    // ONE rede-lab log row, through the admin SQL lane (the log is append-only for every lane, but
    // INSERT is not refused to the owner) — the row the demo admin must never be shown.
    const [labLog] = await adminSql<{ id: string }[]>`
      insert into public.moderation_log
        (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id,
         reason)
      values (${tenantIds.lab}::uuid, 'member_blocked', ${labAdminUser}::uuid,
              ${labAdminMembership}::uuid, ${labMemberUser}::uuid, ${labMemberMembership}::uuid,
              ${`Varredura 08-10 ${RUN}`})
      returning id::text as id`;
    const labLogId = labLog?.id ?? '';
    expect(labLogId).not.toBe('');

    const commentIds: string[] = [];
    const storyIds: string[] = [];
    try {
      // ── /v1/admin/members/{id} (read, block, unblock, role): lab id = unknown id, bare 404 ──────
      const memberCalls = (id: string) =>
        [
          ['read', 'GET', `/v1/admin/members/${id}`, undefined],
          ['block', 'POST', `/v1/admin/members/${id}/block`, { reason: 'Isolamento 08-10' }],
          ['unblock', 'POST', `/v1/admin/members/${id}/unblock`, {}],
          ['role', 'PUT', `/v1/admin/members/${id}/role`, { role: 'support_tenant' }],
        ] as const;
      const unknownMembership = crypto.randomUUID();
      const foreignCalls = memberCalls(labMemberMembership);
      for (const [index, [label, method, path, body]] of memberCalls(unknownMembership).entries()) {
        const unknownText = await expectBareNotFound(
          await asDemoAdmin(method, path, body),
          `members ${label} (unknown id)`,
        );
        const foreign = foreignCalls[index];
        if (!foreign) throw new Error('member call table out of step');
        const foreignText = await expectBareNotFound(
          await asDemoAdmin(foreign[1], foreign[2], foreign[3]),
          `members ${label} (lab id)`,
        );
        expect(sansRequestId(foreignText), label).toEqual(sansRequestId(unknownText));
        for (const needle of [tenantIds.lab, 'rede-lab', 'member@rede-lab.local']) {
          expect(foreignText, label).not.toContain(needle);
        }
      }
      expect(await membershipRow(labMemberMembership)).toEqual(labMembershipBefore);

      // Positive control: the same four calls on the demo subject succeed.
      const ownRead = await asDemoAdmin('GET', `/v1/admin/members/${demoSubject}`);
      expect(ownRead.status).toBe(200);
      expect(((await ownRead.json()) as { membershipId: string }).membershipId).toBe(demoSubject);
      const blocked = await asDemoAdmin('POST', `/v1/admin/members/${demoSubject}/block`, {
        reason: 'Isolamento 08-10',
      });
      expect(blocked.status).toBe(200);
      expect(((await blocked.json()) as { status: string }).status).toBe('blocked');
      const unblocked = await asDemoAdmin('POST', `/v1/admin/members/${demoSubject}/unblock`, {});
      expect(unblocked.status).toBe(200);
      expect(((await unblocked.json()) as { status: string }).status).toBe('active');
      for (const role of ['support_tenant', 'member'] as const) {
        const changed = await asDemoAdmin('PUT', `/v1/admin/members/${demoSubject}/role`, { role });
        expect(changed.status, role).toBe(200);
        expect(((await changed.json()) as { role: string }).role).toBe(role);
      }
      expect(await membershipRow(labMemberMembership)).toEqual(labMembershipBefore);

      // ── GET /v1/admin/members: a full walk lists the demo subject and never a lab membership ───
      const listedMembers: string[] = [];
      let memberCursor: string | null = null;
      for (let guard = 0; guard < 100; guard++) {
        const query: string = memberCursor
          ? `?limit=50&cursor=${encodeURIComponent(memberCursor)}`
          : '?limit=50';
        const res = await asDemoAdmin('GET', `/v1/admin/members${query}`);
        expect(res.status).toBe(200);
        const page = (await res.json()) as {
          items: { membershipId: string }[];
          nextCursor: string | null;
        };
        listedMembers.push(...page.items.map((item) => item.membershipId));
        memberCursor = page.nextCursor;
        if (memberCursor === null) break;
      }
      expect(listedMembers).toContain(demoSubject);
      expect(listedMembers).toContain(membershipIds.demo);
      const labMemberships = await adminSql<{ id: string }[]>`
        select id::text as id from public.memberships where tenant_id = ${tenantIds.lab}::uuid`;
      expect(labMemberships.length).toBeGreaterThan(0);
      for (const row of labMemberships) expect(listedMembers).not.toContain(row.id);

      // ── DELETE /v1/feed/comments/{id}: the lab comment is the bare 404 and stays live ──────────
      const labFeedComment = await seedComment(
        tenantIds.lab,
        { postId: postIds.lab },
        labMemberUser,
      );
      const demoFeedComment = await seedComment(
        tenantIds.demo,
        { postId: postIds.demo },
        subjectUser,
      );
      commentIds.push(labFeedComment, demoFeedComment);
      const unknownFeed = await expectBareNotFound(
        await asDemoAdmin('DELETE', `/v1/feed/comments/${crypto.randomUUID()}`),
        'feed comment (unknown id)',
      );
      const foreignFeed = await expectBareNotFound(
        await asDemoAdmin('DELETE', `/v1/feed/comments/${labFeedComment}`),
        'feed comment (lab id)',
      );
      expect(sansRequestId(foreignFeed)).toEqual(sansRequestId(unknownFeed));
      expect((await commentRow(labFeedComment))?.deleted_at).toBeNull();
      // Positive control: the demo admin removes the demo subject's comment.
      const ownFeed = await asDemoAdmin('DELETE', `/v1/feed/comments/${demoFeedComment}`);
      expect(ownFeed.status).toBe(200);
      expect((await commentRow(demoFeedComment))?.deleted_at).not.toBeNull();

      // ── DELETE /v1/stories/{id}/comments/{id}: same, on two fresh live stories ────────────────
      const demoStory = await seedLiveStory(tenantIds.demo, 'admin@rede-demo.local');
      const labStory = await seedLiveStory(tenantIds.lab, 'admin@rede-lab.local');
      storyIds.push(demoStory, labStory);
      const labStoryComment = await seedComment(
        tenantIds.lab,
        { storyId: labStory },
        labMemberUser,
      );
      const demoStoryComment = await seedComment(
        tenantIds.demo,
        { storyId: demoStory },
        subjectUser,
      );
      commentIds.push(labStoryComment, demoStoryComment);
      const unknownStoryComment = await expectBareNotFound(
        await asDemoAdmin('DELETE', `/v1/stories/${demoStory}/comments/${crypto.randomUUID()}`),
        'story comment (unknown id)',
      );
      for (const [label, path] of [
        ['lab story, lab comment', `/v1/stories/${labStory}/comments/${labStoryComment}`],
        ['demo story, lab comment', `/v1/stories/${demoStory}/comments/${labStoryComment}`],
      ] as const) {
        const text = await expectBareNotFound(await asDemoAdmin('DELETE', path), label);
        expect(sansRequestId(text), label).toEqual(sansRequestId(unknownStoryComment));
      }
      expect((await commentRow(labStoryComment))?.deleted_at).toBeNull();
      const ownStoryComment = await asDemoAdmin(
        'DELETE',
        `/v1/stories/${demoStory}/comments/${demoStoryComment}`,
      );
      expect(ownStoryComment.status).toBe(204);
      expect((await commentRow(demoStoryComment))?.deleted_at).not.toBeNull();

      // ── GET /v1/admin/moderation-log: the sweep's demo rows appear, a lab row never does ───────
      const loggedIds: string[] = [];
      let logCursor: string | null = null;
      for (let guard = 0; guard < 200; guard++) {
        const query: string = logCursor
          ? `?limit=50&cursor=${encodeURIComponent(logCursor)}`
          : '?limit=50';
        const res = await asDemoAdmin('GET', `/v1/admin/moderation-log${query}`);
        expect(res.status).toBe(200);
        const page = (await res.json()) as { items: { id: string }[]; nextCursor: string | null };
        loggedIds.push(...page.items.map((item) => item.id));
        logCursor = page.nextCursor;
        if (logCursor === null) break;
      }
      // Positive control: block, unblock, two role changes and two comment removals — six rows.
      const sweepRows = await adminSql<{ id: string }[]>`
        select id::text as id from public.moderation_log
         where tenant_id = ${tenantIds.demo}::uuid and created_at >= ${sweepStart}`;
      expect(sweepRows).toHaveLength(6);
      for (const row of sweepRows) expect(loggedIds).toContain(row.id);
      const labLogRows = await adminSql<{ id: string }[]>`
        select id::text as id from public.moderation_log where tenant_id = ${tenantIds.lab}::uuid`;
      expect(labLogRows.map((row) => row.id)).toContain(labLogId);
      for (const row of labLogRows) expect(loggedIds).not.toContain(row.id);

      // ── Tenant settings: brand, name and rules move rede-demo only ─────────────────────────────
      const brand = await asDemoAdmin('GET', '/v1/admin/branding');
      expect(brand.status).toBe(200);
      const brandText = await brand.text();
      expect(
        (JSON.parse(brandText) as { tenant: { displayName: string } }).tenant.displayName,
      ).toBe(demoSettingsBefore.display_name);
      for (const needle of [tenantIds.lab, labSettingsBefore.display_name]) {
        expect(brandText).not.toContain(needle);
      }

      const colours = await asDemoAdmin('PUT', '/v1/admin/branding/colors', {
        primary: '#9d174d',
        secondary: '#f9a8d4',
        confirmLowContrast: true,
      });
      expect(colours.status).toBe(200);
      expect(
        ((await settingsOf(tenantIds.demo)).branding.colors as { primary?: string }).primary,
      ).toBe('#9d174d');

      // A real PNG, rendered through the kernel (the api package has no `sharp` of its own).
      const { deriveIconSet } = await import('@rede-social/core/server/branding/icons');
      const png = (
        await deriveIconSet(
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120"><rect width="300" height="120" rx="12" fill="#9d174d"/></svg>',
          ),
          { primaryHex: '#9d174d', mime: 'image/svg+xml' },
        )
      ).i512;
      const putBytes = async (signedUrl: string) => {
        const put = await fetch(signedUrl, {
          method: 'PUT',
          body: new Uint8Array(png),
          headers: { 'content-type': 'image/png', 'x-upsert': 'false' },
        });
        expect(put.ok).toBe(true);
      };
      const uploadBody = { kind: 'logo', mime: 'image/png', size: png.length };

      // The LAB upload is started through the PLATFORM route as the super admin, and its bytes
      // really land under rede-lab's prefix: the strongest negative the complete route can face.
      const labStart = await api.request(`/v1/platform/tenants/${tenantIds.lab}/branding/uploads`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tokens.superAdmin}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(uploadBody),
      });
      expect(labStart.status).toBe(201);
      const labUpload = (await labStart.json()) as {
        uploadId: string;
        signedUrl: string;
        path: string;
      };
      expect(labUpload.path.startsWith(`${tenantIds.lab}/`)).toBe(true);
      await putBytes(labUpload.signedUrl);

      const demoStart = await asDemoAdmin('POST', '/v1/admin/branding/uploads', uploadBody);
      expect(demoStart.status).toBe(201);
      const demoUpload = (await demoStart.json()) as {
        uploadId: string;
        signedUrl: string;
        path: string;
      };
      expect(demoUpload.path.startsWith(`${tenantIds.demo}/`)).toBe(true);
      await putBytes(demoUpload.signedUrl);

      const foreignComplete = await asDemoAdmin(
        'POST',
        `/v1/admin/branding/uploads/${labUpload.uploadId}/complete`,
      );
      const unknownComplete = await asDemoAdmin(
        'POST',
        `/v1/admin/branding/uploads/logo-${crypto.randomUUID()}.png/complete`,
      );
      expect(foreignComplete.status).toBe(404);
      expect(unknownComplete.status).toBe(404);
      const foreignCompleteText = await foreignComplete.text();
      expect(sansRequestId(foreignCompleteText)).toEqual(
        sansRequestId(await unknownComplete.text()),
      );
      expect(foreignCompleteText).not.toContain(tenantIds.lab);
      // The lab object is untouched: never recorded on either side, never removed.
      expect(await brandingObjects(tenantIds.lab)).toContain(labUpload.path);
      // Positive control: the demo's own upload completes and becomes the demo logo.
      const ownComplete = await asDemoAdmin(
        'POST',
        `/v1/admin/branding/uploads/${demoUpload.uploadId}/complete`,
      );
      expect(ownComplete.status).toBe(200);
      const completed = (await ownComplete.json()) as {
        tenant: { branding: { logoUrl: string | null } };
      };
      expect(completed.tenant.branding.logoUrl?.endsWith(demoUpload.path)).toBe(true);

      expect((await asDemoAdmin('DELETE', '/v1/admin/branding/icon')).status).toBe(200);

      const renamed = await asDemoAdmin('PATCH', '/v1/admin/tenant', {
        displayName: 'Rede Demo Varredura',
      });
      expect(renamed.status).toBe(200);
      expect((await settingsOf(tenantIds.demo)).display_name).toBe('Rede Demo Varredura');

      const rules = await asDemoAdmin('GET', '/v1/admin/rules');
      expect(rules.status).toBe(200);
      expect(await rules.json()).toEqual({
        rulesText: demoSettingsBefore.rules_text,
        rulesVersion: demoSettingsBefore.rules_version,
      });
      const saved = await asDemoAdmin('PUT', '/v1/admin/rules', {
        rulesText: `${demoSettingsBefore.rules_text}\n\nVarredura 08-10.`,
      });
      expect(saved.status).toBe(200);
      expect(((await saved.json()) as { rulesVersion: number }).rulesVersion).toBe(
        demoSettingsBefore.rules_version + 1,
      );

      // Every write above moved rede-demo, and rede-lab's tenant row is exactly as it was.
      expect(await settingsOf(tenantIds.lab)).toEqual(labSettingsBefore);

      // ── Hosts: every Phase 8 route, demo admin on the lab's registered host ────────────────────
      for (const [method, path, body] of [
        ['GET', '/v1/admin/moderation-log', undefined],
        ['GET', '/v1/admin/members', undefined],
        ['GET', `/v1/admin/members/${demoSubject}`, undefined],
        ['POST', `/v1/admin/members/${labMemberMembership}/block`, {}],
        ['POST', `/v1/admin/members/${labMemberMembership}/unblock`, {}],
        ['PUT', `/v1/admin/members/${labMemberMembership}/role`, { role: 'support_tenant' }],
        ['GET', '/v1/admin/branding', undefined],
        ['PUT', '/v1/admin/branding/colors', { primary: '#b91c1c', secondary: '#fca5a5' }],
        ['POST', '/v1/admin/branding/uploads', uploadBody],
        ['POST', `/v1/admin/branding/uploads/${labUpload.uploadId}/complete`, undefined],
        ['DELETE', '/v1/admin/branding/icon', undefined],
        ['PATCH', '/v1/admin/tenant', { displayName: 'Invadido' }],
        ['GET', '/v1/admin/rules', undefined],
        ['PUT', '/v1/admin/rules', { rulesText: 'Invadido.' }],
        ['DELETE', `/v1/feed/comments/${labFeedComment}`, undefined],
        ['DELETE', `/v1/stories/${labStory}/comments/${labStoryComment}`, undefined],
      ] as const) {
        await expectHostRefused(
          await send(method, path, tokens.demoAdmin, HOSTS.lab, body),
          `${method} ${path}`,
        );
      }
      expect(await settingsOf(tenantIds.lab)).toEqual(labSettingsBefore);
      expect(await membershipRow(labMemberMembership)).toEqual(labMembershipBefore);
      expect((await commentRow(labFeedComment))?.deleted_at).toBeNull();
      expect((await commentRow(labStoryComment))?.deleted_at).toBeNull();

      // ── The 08-01 assumption-delta invariant, over the WHOLE table ────────────────────────────
      // No row anywhere names an actor or a target membership that belongs to ANOTHER tenant. A
      // membership that no longer exists (an auth user deleted by a fixture's cleanup, which
      // cascades) cannot belong to another tenant either, so it does not count against the row.
      const crossed = await adminSql<{ id: string }[]>`
        select l.id::text as id from public.moderation_log l
         where exists (select 1 from public.memberships m
                        where m.id = l.actor_membership_id and m.tenant_id <> l.tenant_id)
            or exists (select 1 from public.memberships m
                        where m.id = l.target_membership_id and m.tenant_id <> l.tenant_id)`;
      expect(crossed).toEqual([]);
      // …and every row this sweep wrote (both tenants) is anchored in memberships of its own tenant.
      const unanchored = await adminSql<{ id: string }[]>`
        select l.id::text as id from public.moderation_log l
         where (l.created_at >= ${sweepStart} or l.id = ${labLogId}::uuid)
           and not (exists (select 1 from public.memberships m
                             where m.id = l.actor_membership_id and m.tenant_id = l.tenant_id)
                and exists (select 1 from public.memberships m
                             where m.id = l.target_membership_id and m.tenant_id = l.tenant_id))`;
      expect(unanchored).toEqual([]);
    } finally {
      if (commentIds.length > 0) {
        await adminSql`delete from public.feed_comments where id = any(${commentIds}::uuid[])`;
      }
      if (storyIds.length > 0) {
        await adminSql`delete from public.stories where id = any(${storyIds}::uuid[])`;
      }
      // rede-demo's tenant row goes back exactly as found (brand, name, rules and version).
      await adminSql`
        update public.tenants
           set display_name = ${demoSettingsBefore.display_name},
               branding = ${adminSql.json(demoSettingsBefore.branding as never)},
               rules_text = ${demoSettingsBefore.rules_text},
               rules_version = ${demoSettingsBefore.rules_version}
         where id = ${tenantIds.demo}::uuid`;
      for (const key of ['demo', 'lab'] as const) {
        const added = (await brandingObjects(tenantIds[key])).filter(
          (name) => !objectsBefore[key].has(name),
        );
        if (added.length > 0) await storageAdmin().from('branding').remove(added);
      }
      await closeJobsSince(sweepStart, [tenantIds.demo, tenantIds.lab]);
    }
  });

  /*
   * 08-10 — the INVENTORY SWEEPS. Building `tests/isolation-inventory.ts` from `app.routes` found
   * pre-Phase-8 routes whose cross-tenant proof lived only in their own feature suite (or nowhere):
   * mostly the writes and the manage-only reads that f2's GET-only loop never reached. Each sweep
   * below closes one family, in the same shape as the phase sweeps: the rede-lab id through the demo
   * lane is the bare 404 an unknown id gets, the lab's rows are byte-identical afterwards, the demo
   * positive control succeeds IN THE SAME TEST, and every route is refused on the lab's host.
   */

  it("inventory sweep: me and media — the caller's own profile, nudge, invite answer and asset reads, never another tenant's (08-10)", async () => {
    // | Route                               | Negative asserted here                                     |
    // |-------------------------------------|------------------------------------------------------------|
    // | GET  /v1/me/profile                 | each member reads its OWN membership's profile; lab host 403 |
    // | POST /v1/me/profile/dismiss-nudge   | the lab member's profile row is byte-identical; lab host 403 |
    // | POST /v1/me/accept-invite           | answers rede-demo only (already_active); lab host 403       |
    // | GET  /v1/media                      | a full admin walk never lists a lab asset; lab host 403     |
    // | GET  /v1/media/{assetId}            | a lab asset id is the bare 404 (= unknown id); lab host 403 |
    for (const [token, host, membershipId] of [
      [tokens.demoMember, HOSTS.demo, membershipIds.demo],
      [tokens.labMember, HOSTS.lab, membershipIds.lab],
    ] as const) {
      const res = await send('GET', '/v1/me/profile', token, host);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { membershipId: string }).membershipId).toBe(membershipId);
    }
    await expectHostRefused(
      await send('GET', '/v1/me/profile', tokens.demoMember, HOSTS.lab),
      'GET /v1/me/profile',
    );

    // The nudge: a throwaway demo member dismisses its own; the lab member's row never moves.
    const labProfile = async () => {
      const [row] = await adminSql<{ row: unknown }[]>`
        select to_jsonb(p) as row from public.member_profiles p
         where p.membership_id = ${membershipIds.lab}::uuid`;
      return row?.row;
    };
    const labProfileBefore = await labProfile();
    expect(labProfileBefore).toBeTruthy();
    const nudgeEmail = `nudge-${RUN}@rede-demo.local`;
    const nudgeToken = await throwawayMember(tenantIds.demo, nudgeEmail);
    const nudgeMembership = await membershipIdOf(tenantIds.demo, nudgeEmail);
    await expectHostRefused(
      await send('POST', '/v1/me/profile/dismiss-nudge', nudgeToken, HOSTS.lab),
      'POST /v1/me/profile/dismiss-nudge',
    );
    const dismissed = await send('POST', '/v1/me/profile/dismiss-nudge', nudgeToken, HOSTS.demo);
    expect(dismissed.status).toBe(200);
    const nudged = (await dismissed.json()) as { membershipId: string; needsNudge: boolean };
    expect(nudged.membershipId).toBe(nudgeMembership);
    expect(nudged.needsNudge).toBe(false);
    expect(await labProfile()).toEqual(labProfileBefore);

    // The invite answer: the tenant is the membership's, never the request's. An already-active
    // demo member replaying it learns about rede-demo only and writes nothing.
    const [demoRules] = await adminSql<{ rules_version: number }[]>`
      select rules_version from public.tenants where id = ${tenantIds.demo}::uuid`;
    const consents = {
      rulesVersion: demoRules?.rules_version ?? 1,
      termsVersion: PLATFORM_TERMS_VERSION,
    };
    const consentRows = async () => {
      const [row] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.consent_records
         where tenant_id in (${tenantIds.demo}::uuid, ${tenantIds.lab}::uuid)`;
      return row?.n ?? 0;
    };
    const consentsBefore = await consentRows();
    await expectHostRefused(
      await send('POST', '/v1/me/accept-invite', tokens.demoMember, HOSTS.lab, consents),
      'POST /v1/me/accept-invite',
    );
    const replay = await send(
      'POST',
      '/v1/me/accept-invite',
      tokens.demoMember,
      HOSTS.demo,
      consents,
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ tenantSlug: 'rede-demo', landing: '/inicio' });
    expect(await consentRows()).toBe(consentsBefore);

    // The asset list: a full walk by the demo admin lists the demo's assets and none of the lab's.
    const listedAssets: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 200; guard++) {
      const query: string = cursor ? `?limit=50&cursor=${encodeURIComponent(cursor)}` : '?limit=50';
      const res = await send('GET', `/v1/media${query}`, tokens.demoAdmin, HOSTS.demo);
      expect(res.status).toBe(200);
      const page = (await res.json()) as { items: { id: string }[]; nextCursor: string | null };
      listedAssets.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    for (const id of [assets.demoVideo, assets.demoCover]) expect(listedAssets).toContain(id);
    const labAssets = await adminSql<{ id: string }[]>`
      select id::text as id from public.media_assets where tenant_id = ${tenantIds.lab}::uuid`;
    expect(labAssets.length).toBeGreaterThan(0);
    for (const row of labAssets) expect(listedAssets).not.toContain(row.id);
    await expectHostRefused(
      await send('GET', '/v1/media', tokens.demoAdmin, HOSTS.lab),
      'GET /v1/media',
    );

    // One asset: the lab's cover is the same bare 404 an unknown id gets; the demo's is 200.
    const unknownAsset = await expectBareNotFound(
      await send('GET', `/v1/media/${crypto.randomUUID()}`, tokens.demoAdmin, HOSTS.demo),
      'asset (unknown id)',
    );
    const foreignAsset = await expectBareNotFound(
      await send('GET', `/v1/media/${assets.labCover}`, tokens.demoAdmin, HOSTS.demo),
      'asset (lab id)',
    );
    expect(sansRequestId(foreignAsset)).toEqual(sansRequestId(unknownAsset));
    expect(foreignAsset).not.toContain(tenantIds.lab);
    const ownAsset = await send(
      'GET',
      `/v1/media/${assets.demoCover}`,
      tokens.demoAdmin,
      HOSTS.demo,
    );
    expect(ownAsset.status).toBe(200);
    expect(((await ownAsset.json()) as { id: string }).id).toBe(assets.demoCover);
    await expectHostRefused(
      await send('GET', `/v1/media/${assets.demoCover}`, tokens.demoAdmin, HOSTS.lab),
      'GET /v1/media/{assetId}',
    );
  });

  it('inventory sweep: feed — every post, like and comment route refuses the lab ids as the bare 404 beside its demo positive control (08-10)', async () => {
    // | Route                                      | Negative asserted here                               |
    // |--------------------------------------------|------------------------------------------------------|
    // | POST   /v1/feed/posts                      | a lab community is the bare 404, a lab image is the  |
    // |                                            | one `asset_not_usable` code with no id echoed back   |
    // | PATCH  /v1/feed/posts/{id}                 | lab post: bare 404, the lab row byte-identical       |
    // | DELETE /v1/feed/posts/{id}                 | lab post: bare 404, still live                       |
    // | POST   /v1/feed/posts/{id}/like            | lab post: bare 404, no like written                  |
    // | DELETE /v1/feed/posts/{id}/like            | lab post: bare 404                                   |
    // | GET    /v1/feed/posts/{id}/comments        | lab post: bare 404                                   |
    // | POST   /v1/feed/posts/{id}/comments        | lab post, or a lab parentId on a demo post: bare 404 |
    // | POST   /v1/feed/comments/{id}/like         | lab comment: bare 404                                |
    // | DELETE /v1/feed/comments/{id}/like         | lab comment: bare 404                                |
    // | GET    /v1/feed/comments/{id}/replies      | 200-only by contract: a lab comment WITH a live lab  |
    // |                                            | reply answers the byte-identical empty page an       |
    // |                                            | unknown id gets; the demo's own reply is listed      |
    // Every one of them is also refused on the lab's registered host.
    const since = await dbNow();
    const labMemberUser = await userIdOf('member@rede-lab.local');
    const [labCommunityRow] = await adminSql<{ id: string }[]>`
      select id::text as id from public.communities
       where tenant_id = ${tenantIds.lab}::uuid and deleted_at is null limit 1`;
    const labCommunity = labCommunityRow?.id ?? '';
    expect(labCommunity).not.toBe('');
    const labImage = await seedReadyImage(tenantIds.lab, 'admin@rede-lab.local', 'post');
    const demoImage = await seedReadyImage(tenantIds.demo, 'admin@rede-demo.local', 'post');
    const labComment = await seedComment(tenantIds.lab, { postId: postIds.lab }, labMemberUser);
    // A live REPLY under the lab comment, so the replies read has a real lab row to (not) return.
    const [labReplyRow] = await adminSql<{ id: string }[]>`
      insert into public.feed_comments
        (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
      values (${tenantIds.lab}::uuid, ${postIds.lab}::uuid, ${labMemberUser}::uuid,
              'Resposta de varredura.', 1, ${labComment}::uuid, 0, 'post')
      returning id::text as id`;
    const labReply = labReplyRow?.id ?? '';
    expect(labReply).not.toBe('');
    const createdPosts: string[] = [];
    const caption = `Varredura do feed ${RUN}`;

    const labTrace = async () => {
      const [row] = await adminSql<
        { post: unknown; comment: unknown; likes: number; comments: number }[]
      >`
        select (select to_jsonb(p) from public.feed_posts p where p.id = ${postIds.lab}::uuid) as post,
               (select to_jsonb(c) from public.feed_comments c where c.id = ${labComment}::uuid) as comment,
               (select count(*)::int from public.feed_likes l
                 where l.post_id = ${postIds.lab}::uuid or l.comment_id = ${labComment}::uuid) as likes,
               (select count(*)::int from public.feed_comments c
                 where c.post_id = ${postIds.lab}::uuid) as comments`;
      return row;
    };
    const asAdmin = (method: string, path: string, body?: unknown) =>
      send(method, path, tokens.demoAdmin, HOSTS.demo, body);
    const asMember = (method: string, path: string, body?: unknown) =>
      send(method, path, tokens.demoMember, HOSTS.demo, body);

    try {
      const before = await labTrace();

      // ── POST /v1/feed/posts ──────────────────────────────────────────────────────────────────
      const unknownCommunity = await expectBareNotFound(
        await asAdmin('POST', '/v1/feed/posts', { caption, communityId: crypto.randomUUID() }),
        'create into an unknown community',
      );
      const foreignCommunity = await expectBareNotFound(
        await asAdmin('POST', '/v1/feed/posts', { caption, communityId: labCommunity }),
        'create into the lab community',
      );
      expect(sansRequestId(foreignCommunity)).toEqual(sansRequestId(unknownCommunity));
      const foreignImage = await asAdmin('POST', '/v1/feed/posts', {
        caption,
        imageAssetIds: [labImage],
      });
      expect(foreignImage.status).toBe(400);
      const foreignImageText = await foreignImage.text();
      expect((JSON.parse(foreignImageText) as Envelope).error.details).toEqual({
        media: 'asset_not_usable',
      });
      expect(foreignImageText).not.toContain(labImage);
      const [refused] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.feed_posts where caption = ${caption}`;
      expect(refused?.n).toBe(0);
      // Positive control: the demo's own image publishes, in the demo tenant.
      const created = await asAdmin('POST', '/v1/feed/posts', {
        caption,
        imageAssetIds: [demoImage],
      });
      expect(created.status).toBe(201);
      const ownPost = ((await created.json()) as { id: string }).id;
      createdPosts.push(ownPost);
      const [ownRow] = await adminSql<{ tenant_id: string }[]>`
        select tenant_id::text from public.feed_posts where id = ${ownPost}::uuid`;
      expect(ownRow?.tenant_id).toBe(tenantIds.demo);

      // ── The lab ids through every other feed route: one bare 404 each ────────────────────────
      const unknownPost = crypto.randomUUID();
      const unknownComment = crypto.randomUUID();
      const crossings = (post: string, comment: string) =>
        [
          ['edit post', 'admin', 'PATCH', `/v1/feed/posts/${post}`, { caption: 'Invadido.' }],
          ['delete post', 'admin', 'DELETE', `/v1/feed/posts/${post}`, undefined],
          ['like post', 'member', 'POST', `/v1/feed/posts/${post}/like`, undefined],
          ['unlike post', 'member', 'DELETE', `/v1/feed/posts/${post}/like`, undefined],
          ['list comments', 'member', 'GET', `/v1/feed/posts/${post}/comments`, undefined],
          ['comment', 'member', 'POST', `/v1/feed/posts/${post}/comments`, { body: 'Oi.' }],
          ['like comment', 'member', 'POST', `/v1/feed/comments/${comment}/like`, undefined],
          ['unlike comment', 'member', 'DELETE', `/v1/feed/comments/${comment}/like`, undefined],
          [
            'reply to a lab comment',
            'member',
            'POST',
            `/v1/feed/posts/${ownPost}/comments`,
            { body: 'Oi.', parentId: comment },
          ],
        ] as const;
      const unknownCalls = crossings(unknownPost, unknownComment);
      for (const [index, [label, who, method, path, body]] of crossings(
        postIds.lab,
        labComment,
      ).entries()) {
        const as = who === 'admin' ? asAdmin : asMember;
        const text = await expectBareNotFound(await as(method, path, body), label);
        const unknown = unknownCalls[index];
        if (!unknown) throw new Error('crossing table out of step');
        const unknownText = await expectBareNotFound(
          await as(unknown[2], unknown[3], unknown[4]),
          `${label} (unknown)`,
        );
        expect(sansRequestId(text), label).toEqual(sansRequestId(unknownText));
        for (const needle of [tenantIds.lab, postIds.lab, labComment]) {
          expect(text, label).not.toContain(needle);
        }
      }

      // ── Positive controls: the same routes on the demo's own post and comment ────────────────
      const edited = await asAdmin('PATCH', `/v1/feed/posts/${ownPost}`, {
        caption: `${caption} (editado)`,
      });
      expect(edited.status).toBe(200);
      const liked = await asMember('POST', `/v1/feed/posts/${ownPost}/like`);
      expect(liked.status).toBe(200);
      expect(((await liked.json()) as { liked: boolean }).liked).toBe(true);
      const unliked = await asMember('DELETE', `/v1/feed/posts/${ownPost}/like`);
      expect(((await unliked.json()) as { liked: boolean }).liked).toBe(false);
      const commented = await asMember('POST', `/v1/feed/posts/${ownPost}/comments`, {
        body: 'Comentário de controle.',
      });
      expect(commented.status).toBe(201);
      const ownComment = ((await commented.json()) as { id: string }).id;
      const listed = await asMember('GET', `/v1/feed/posts/${ownPost}/comments`);
      expect(listed.status).toBe(200);
      const listedIds = ((await listed.json()) as { items: { id: string }[] }).items.map(
        (item) => item.id,
      );
      expect(listedIds).toContain(ownComment);
      expect(listedIds).not.toContain(labComment);
      const commentLike = await asMember('POST', `/v1/feed/comments/${ownComment}/like`);
      expect(((await commentLike.json()) as { liked: boolean }).liked).toBe(true);
      const commentUnlike = await asMember('DELETE', `/v1/feed/comments/${ownComment}/like`);
      expect(((await commentUnlike.json()) as { liked: boolean }).liked).toBe(false);

      // ── Replies: 200-only by contract (no 404 branch), so the proof is the oracle-free page ──
      // The lab comment HAS a live reply, yet the demo lane gets the byte-identical empty page an
      // unknown id gets; the demo's own reply is listed under its own comment.
      const repliesOf = async (id: string) => {
        const res = await asMember('GET', `/v1/feed/comments/${id}/replies`);
        expect(res.status).toBe(200);
        return res.text();
      };
      const foreignReplies = await repliesOf(labComment);
      expect(foreignReplies).toBe(await repliesOf(crypto.randomUUID()));
      expect(JSON.parse(foreignReplies)).toEqual({ items: [], nextCursor: null });
      expect(foreignReplies).not.toContain(labReply);
      const replied = await asMember('POST', `/v1/feed/posts/${ownPost}/comments`, {
        body: 'Resposta de controle.',
        parentId: ownComment,
      });
      expect(replied.status).toBe(201);
      const ownReply = ((await replied.json()) as { id: string }).id;
      expect(
        (JSON.parse(await repliesOf(ownComment)) as { items: { id: string }[] }).items.map(
          (item) => item.id,
        ),
      ).toEqual([ownReply]);

      // ── Hosts: every route of the family on the lab's registered host ────────────────────────
      for (const [method, path, body] of [
        ['POST', '/v1/feed/posts', { caption }],
        ['PATCH', `/v1/feed/posts/${ownPost}`, { caption: 'Invadido.' }],
        ['DELETE', `/v1/feed/posts/${ownPost}`, undefined],
        ['POST', `/v1/feed/posts/${ownPost}/like`, undefined],
        ['DELETE', `/v1/feed/posts/${ownPost}/like`, undefined],
        ['GET', `/v1/feed/posts/${ownPost}/comments`, undefined],
        ['POST', `/v1/feed/posts/${ownPost}/comments`, { body: 'Oi.' }],
        ['POST', `/v1/feed/comments/${ownComment}/like`, undefined],
        ['DELETE', `/v1/feed/comments/${ownComment}/like`, undefined],
        ['GET', `/v1/feed/comments/${ownComment}/replies`, undefined],
      ] as const) {
        await expectHostRefused(
          await send(method, path, tokens.demoAdmin, HOSTS.lab, body),
          `${method} ${path}`,
        );
      }

      // The delete last: the demo's own post goes, the lab's never moved.
      expect((await asAdmin('DELETE', `/v1/feed/posts/${ownPost}`)).status).toBe(200);
      expect(await labTrace()).toEqual(before);
    } finally {
      if (createdPosts.length > 0) {
        await adminSql`
          delete from public.notifications where subject_id = any(${createdPosts}::uuid[])`;
        await adminSql`delete from public.feed_posts where id = any(${createdPosts}::uuid[])`;
      }
      // The reply goes with its root (composite parent key, on delete cascade).
      await adminSql`delete from public.feed_comments where id = ${labComment}::uuid`;
      await closeJobsSince(since, [tenantIds.demo, tenantIds.lab]);
    }
  });

  it('inventory sweep: stories and communities — every curation, story and community write refuses the lab ids beside its demo positive control (08-10)', async () => {
    // | Route                                                   | Negative asserted here                    |
    // |---------------------------------------------------------|-------------------------------------------|
    // | GET    /v1/stories/mine                                 | a full walk never lists a lab story       |
    // | GET    /v1/stories/highlights/catalog                   | never lists a lab highlight               |
    // | PUT    /v1/stories/highlights/order                     | a lab community is the bare 404; a lab id |
    // |                                                         | in the set is `order_stale`, nothing moves|
    // | PATCH  /v1/stories/highlights/{id}                      | lab highlight: bare 404, title unchanged  |
    // | DELETE /v1/stories/highlights/{id}                      | lab highlight: bare 404, still there      |
    // | DELETE /v1/stories/highlights/{id}/stories/{storyId}    | a lab highlight or a lab story: bare 404  |
    // | DELETE /v1/stories/{id}                                 | lab story: bare 404, still live           |
    // | POST   /v1/stories/{id}/likes, DELETE …/likes           | lab story: bare 404, no like written      |
    // | GET    /v1/stories/{id}/comments, POST …/comments       | lab story: bare 404, nothing written      |
    // | GET    /v1/stories/{id}/highlights                      | lab story: bare 404                       |
    // | PATCH  /v1/communities/{id}                             | lab community: bare 404, row unchanged    |
    // Every one of them is also refused on the lab's registered host.
    const since = await dbNow();
    const labMemberUser = await userIdOf('member@rede-lab.local');
    const [labHighlightRow] = await adminSql<{ id: string }[]>`
      select id::text as id from public.story_highlights
       where tenant_id = ${tenantIds.lab}::uuid and community_id is null and title = 'Bastidores'`;
    const [demoHighlightRow] = await adminSql<{ id: string }[]>`
      select id::text as id from public.story_highlights
       where tenant_id = ${tenantIds.demo}::uuid and community_id is null and title = 'Bastidores'`;
    const [labCommunityRow] = await adminSql<{ id: string }[]>`
      select id::text as id from public.communities
       where tenant_id = ${tenantIds.lab}::uuid and deleted_at is null limit 1`;
    const labHighlight = labHighlightRow?.id ?? '';
    const demoHighlight = demoHighlightRow?.id ?? '';
    const labCommunity = labCommunityRow?.id ?? '';
    for (const [name, id] of Object.entries({ labHighlight, demoHighlight, labCommunity })) {
      expect(id, `seeded ${name}`).not.toBe('');
    }
    const storyIds: string[] = [];
    const communityIds: string[] = [];
    let ownHighlight = '';

    const asAdmin = (method: string, path: string, body?: unknown) =>
      send(method, path, tokens.demoAdmin, HOSTS.demo, body);
    const asMember = (method: string, path: string, body?: unknown) =>
      send(method, path, tokens.demoMember, HOSTS.demo, body);

    try {
      const demoStory = await seedLiveStory(tenantIds.demo, 'admin@rede-demo.local');
      const labStory = await seedLiveStory(tenantIds.lab, 'admin@rede-lab.local');
      storyIds.push(demoStory, labStory);
      const labStoryComment = await seedComment(
        tenantIds.lab,
        { storyId: labStory },
        labMemberUser,
      );
      const [demoAdminUser] = await adminSql<{ id: string }[]>`
        select m.user_id::text as id from public.memberships m
         where m.tenant_id = ${tenantIds.demo}::uuid and m.role = 'admin_tenant' limit 1`;
      const [ownCommunityRow] = await adminSql<{ id: string }[]>`
        insert into public.communities (tenant_id, created_by_user_id, name, slug)
        values (${tenantIds.demo}::uuid, ${demoAdminUser?.id ?? ''}::uuid,
                ${`Varredura ${String(RUN).slice(-4)}`},
                ${`varredura-${crypto.randomUUID().slice(0, 8)}`})
        returning id::text as id`;
      const ownCommunity = ownCommunityRow?.id ?? '';
      communityIds.push(ownCommunity);

      const labTrace = async () => {
        const [row] = await adminSql<
          {
            story: unknown;
            highlights: unknown;
            items: number;
            social: number;
            community: unknown;
          }[]
        >`
          select (select to_jsonb(s) from public.stories s where s.id = ${labStory}::uuid) as story,
                 (select jsonb_agg(jsonb_build_object('id', h.id, 'title', h.title, 'position', h.position)
                                   order by h.id)
                    from public.story_highlights h where h.tenant_id = ${tenantIds.lab}::uuid) as highlights,
                 (select count(*)::int from public.story_highlight_items i
                   where i.tenant_id = ${tenantIds.lab}::uuid) as items,
                 (select count(*)::int from public.feed_comments c where c.story_id = ${labStory}::uuid)
                 + (select count(*)::int from public.feed_likes l where l.story_id = ${labStory}::uuid)
                   as social,
                 (select to_jsonb(c) from public.communities c where c.id = ${labCommunity}::uuid) as community`;
        return row;
      };
      const before = await labTrace();

      // ── GET /v1/stories/mine: a full walk lists the demo story and no lab story ───────────────
      const mine: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 100; guard++) {
        const query: string = cursor
          ? `?limit=50&cursor=${encodeURIComponent(cursor)}`
          : '?limit=50';
        const res = await asAdmin('GET', `/v1/stories/mine${query}`);
        expect(res.status).toBe(200);
        const page = (await res.json()) as { items: { id: string }[]; nextCursor: string | null };
        mine.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
        if (cursor === null) break;
      }
      expect(mine).toContain(demoStory);
      const labStoryIds = await adminSql<{ id: string }[]>`
        select id::text as id from public.stories where tenant_id = ${tenantIds.lab}::uuid`;
      for (const row of labStoryIds) expect(mine).not.toContain(row.id);

      // ── Highlights: catalog, a throwaway demo highlight, the order ────────────────────────────
      const catalog = async () => {
        const res = await asAdmin('GET', '/v1/stories/highlights/catalog');
        expect(res.status).toBe(200);
        return ((await res.json()) as { items: { id: string; communityId: string | null }[] })
          .items;
      };
      const labHighlightIds = (
        await adminSql<{ id: string }[]>`
          select id::text as id from public.story_highlights where tenant_id = ${tenantIds.lab}::uuid`
      ).map((row) => row.id);
      const firstCatalog = await catalog();
      expect(firstCatalog.map((item) => item.id)).toContain(demoHighlight);
      for (const id of labHighlightIds)
        expect(firstCatalog.map((item) => item.id)).not.toContain(id);

      const createdHighlight = await asAdmin('POST', '/v1/stories/highlights', {
        title: `Varredura ${String(RUN).slice(-4)}`,
      });
      expect(createdHighlight.status).toBe(201);
      ownHighlight = ((await createdHighlight.json()) as { id: string }).id;

      const inicio = (await catalog())
        .filter((item) => item.communityId === null)
        .map((item) => item.id);
      expect(inicio).toContain(ownHighlight);
      const unknownPlace = await expectBareNotFound(
        await asAdmin('PUT', '/v1/stories/highlights/order', {
          communityId: crypto.randomUUID(),
          highlightIds: inicio,
        }),
        'order (unknown community)',
      );
      const foreignPlace = await expectBareNotFound(
        await asAdmin('PUT', '/v1/stories/highlights/order', {
          communityId: labCommunity,
          highlightIds: inicio,
        }),
        'order (lab community)',
      );
      expect(sansRequestId(foreignPlace)).toEqual(sansRequestId(unknownPlace));
      const staleSet = await asAdmin('PUT', '/v1/stories/highlights/order', {
        highlightIds: [...inicio.slice(0, -1), labHighlight],
      });
      expect(staleSet.status).toBe(400);
      const staleText = await staleSet.text();
      expect((JSON.parse(staleText) as Envelope).error.details).toEqual({
        highlight: 'order_stale',
      });
      expect(staleText).not.toContain(labHighlight);
      // Positive control: the demo's own full set, in its current order, is accepted.
      expect(
        (await asAdmin('PUT', '/v1/stories/highlights/order', { highlightIds: inicio })).status,
      ).toBe(200);

      // ── The lab ids through every other story / community route: one bare 404 each ───────────
      const unknownId = crypto.randomUUID();
      const crossings = (highlight: string, story: string, community: string) =>
        [
          [
            'rename highlight',
            'admin',
            'PATCH',
            `/v1/stories/highlights/${highlight}`,
            { title: 'Invadido' },
          ],
          ['remove highlight', 'admin', 'DELETE', `/v1/stories/highlights/${highlight}`, undefined],
          [
            'remove a story from a highlight',
            'admin',
            'DELETE',
            `/v1/stories/highlights/${highlight}/stories/${story}`,
            undefined,
          ],
          [
            'remove a lab story from the demo highlight',
            'admin',
            'DELETE',
            `/v1/stories/highlights/${ownHighlight}/stories/${story}`,
            undefined,
          ],
          ['delete story', 'admin', 'DELETE', `/v1/stories/${story}`, undefined],
          ['like story', 'member', 'POST', `/v1/stories/${story}/likes`, undefined],
          ['unlike story', 'member', 'DELETE', `/v1/stories/${story}/likes`, undefined],
          ['list story comments', 'member', 'GET', `/v1/stories/${story}/comments`, undefined],
          ['comment on story', 'member', 'POST', `/v1/stories/${story}/comments`, { body: 'Oi.' }],
          ['story highlights', 'admin', 'GET', `/v1/stories/${story}/highlights`, undefined],
          [
            'edit community',
            'admin',
            'PATCH',
            `/v1/communities/${community}`,
            { description: 'Invadida.' },
          ],
        ] as const;
      const unknownCalls = crossings(unknownId, unknownId, unknownId);
      for (const [index, [label, who, method, path, body]] of crossings(
        labHighlight,
        labStory,
        labCommunity,
      ).entries()) {
        const as = who === 'admin' ? asAdmin : asMember;
        const text = await expectBareNotFound(await as(method, path, body), label);
        const unknown = unknownCalls[index];
        if (!unknown) throw new Error('crossing table out of step');
        const unknownText = await expectBareNotFound(
          await as(unknown[2], unknown[3], unknown[4]),
          `${label} (unknown)`,
        );
        expect(sansRequestId(text), label).toEqual(sansRequestId(unknownText));
        for (const needle of [tenantIds.lab, labHighlight, labStory, labCommunity]) {
          expect(text, label).not.toContain(needle);
        }
      }

      // ── Positive controls: the same routes on the demo's own rows ────────────────────────────
      expect(
        (await asAdmin('PATCH', `/v1/stories/highlights/${ownHighlight}`, { title: 'Varrido' }))
          .status,
      ).toBe(200);
      expect(
        (await asAdmin('PUT', `/v1/stories/highlights/${ownHighlight}/stories/${demoStory}`))
          .status,
      ).toBe(200);
      const storyHighlights = await asAdmin('GET', `/v1/stories/${demoStory}/highlights`);
      expect(storyHighlights.status).toBe(200);
      expect(((await storyHighlights.json()) as { highlightIds: string[] }).highlightIds).toContain(
        ownHighlight,
      );
      expect(
        (await asAdmin('DELETE', `/v1/stories/highlights/${ownHighlight}/stories/${demoStory}`))
          .status,
      ).toBe(200);
      const storyLike = await asMember('POST', `/v1/stories/${demoStory}/likes`);
      expect(((await storyLike.json()) as { liked: boolean }).liked).toBe(true);
      const storyUnlike = await asMember('DELETE', `/v1/stories/${demoStory}/likes`);
      expect(((await storyUnlike.json()) as { liked: boolean }).liked).toBe(false);
      const storyCommented = await asMember('POST', `/v1/stories/${demoStory}/comments`, {
        body: 'Comentário de controle.',
      });
      expect(storyCommented.status).toBe(201);
      const ownStoryComment = ((await storyCommented.json()) as { id: string }).id;
      const storyComments = await asMember('GET', `/v1/stories/${demoStory}/comments`);
      expect(storyComments.status).toBe(200);
      const storyCommentIds = (
        (await storyComments.json()) as { items: { id: string }[] }
      ).items.map((item) => item.id);
      expect(storyCommentIds).toContain(ownStoryComment);
      expect(storyCommentIds).not.toContain(labStoryComment);
      expect(
        (await asAdmin('PATCH', `/v1/communities/${ownCommunity}`, { description: 'Varrida.' }))
          .status,
      ).toBe(200);

      // ── Hosts: every route of the family on the lab's registered host ────────────────────────
      for (const [method, path, body] of [
        ['GET', '/v1/stories/mine', undefined],
        ['GET', '/v1/stories/highlights/catalog', undefined],
        ['PUT', '/v1/stories/highlights/order', { highlightIds: inicio }],
        ['PATCH', `/v1/stories/highlights/${ownHighlight}`, { title: 'Invadido' }],
        ['DELETE', `/v1/stories/highlights/${ownHighlight}`, undefined],
        ['DELETE', `/v1/stories/highlights/${ownHighlight}/stories/${demoStory}`, undefined],
        ['DELETE', `/v1/stories/${demoStory}`, undefined],
        ['POST', `/v1/stories/${demoStory}/likes`, undefined],
        ['DELETE', `/v1/stories/${demoStory}/likes`, undefined],
        ['GET', `/v1/stories/${demoStory}/comments`, undefined],
        ['POST', `/v1/stories/${demoStory}/comments`, { body: 'Oi.' }],
        ['GET', `/v1/stories/${demoStory}/highlights`, undefined],
        ['PATCH', `/v1/communities/${ownCommunity}`, { description: 'Invadida.' }],
      ] as const) {
        await expectHostRefused(
          await send(method, path, tokens.demoAdmin, HOSTS.lab, body),
          `${method} ${path}`,
        );
      }

      // The two deletes last: the demo's own highlight and story go, the lab's never moved.
      expect((await asAdmin('DELETE', `/v1/stories/highlights/${ownHighlight}`)).status).toBe(204);
      ownHighlight = '';
      expect((await asAdmin('DELETE', `/v1/stories/${demoStory}`)).status).toBe(204);
      expect(await labTrace()).toEqual(before);
    } finally {
      if (ownHighlight) {
        await adminSql`delete from public.story_highlights where id = ${ownHighlight}::uuid`;
      }
      if (storyIds.length > 0) {
        await adminSql`
          delete from public.notifications where subject_id = any(${storyIds}::uuid[])`;
        await adminSql`delete from public.feed_comments where story_id = any(${storyIds}::uuid[])`;
        await adminSql`delete from public.stories where id = any(${storyIds}::uuid[])`;
      }
      if (communityIds.length > 0) {
        await adminSql`delete from public.communities where id = any(${communityIds}::uuid[])`;
      }
      await closeJobsSince(since, [tenantIds.demo, tenantIds.lab]);
    }
  });

  it('inventory sweep: events — create, edit, status, attendance and the door code refuse the lab event beside the demo positive control (08-10)', async () => {
    // | Route                                        | Negative asserted here                              |
    // |----------------------------------------------|-----------------------------------------------------|
    // | GET   /v1/events/next                        | names a demo event, never a lab one                 |
    // | POST  /v1/events                             | a lab cover is the bare 404 (= unknown id), nothing |
    // |                                              | written                                             |
    // | GET   /v1/events/{id}/edit                   | lab event: bare 404, no URL or code in the body     |
    // | PUT   /v1/events/{id}                        | lab event: bare 404, the lab row byte-identical     |
    // | PATCH /v1/events/{id}                        | lab event: bare 404, still active                   |
    // | GET   /v1/events/{id}/attendance             | lab event: bare 404                                 |
    // | GET   /v1/events/{id}/attendance/summary     | lab event: bare 404, the lab code never printed     |
    // | POST  /v1/events/{id}/checkin-code           | lab event: bare 404, the lab code unchanged         |
    // Every one of them is also refused on the lab's registered host.
    const since = await dbNow();
    const labEvent = '0e000000-0000-4000-8000-000000000e01';
    const title = `Varredura de eventos ${RUN}`;
    const tenantDate = (offsetDays: number) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(Date.now() + offsetDays * 86_400_000));
    const date = tenantDate(5);
    const body = {
      title,
      description: 'Encontro de varredura.',
      format: 'in_person',
      venueName: 'Auditório da sede',
      address: 'Rua das Flores, 100',
      start: { date, time: '19:00' },
      end: { date, time: '21:00' },
    };
    const asAdmin = (method: string, path: string, payload?: unknown) =>
      send(method, path, tokens.demoAdmin, HOSTS.demo, payload);
    const labTrace = async () => {
      const [row] = await adminSql<{ event: unknown; secret: unknown; answers: number }[]>`
        select (select to_jsonb(e) from public.events e where e.id = ${labEvent}::uuid) as event,
               (select to_jsonb(s) from public.event_secrets s where s.event_id = ${labEvent}::uuid) as secret,
               (select count(*)::int from public.event_attendances a
                 where a.event_id = ${labEvent}::uuid) as answers`;
      return row;
    };
    const created: string[] = [];

    try {
      const before = await labTrace();
      expect(before?.event).toBeTruthy();
      const labCode = (before?.secret as { checkin_code?: string } | null)?.checkin_code ?? '';
      expect(labCode).not.toBe('');

      // ── GET /v1/events/next names a demo event ───────────────────────────────────────────────
      const next = await send('GET', '/v1/events/next', tokens.demoMember, HOSTS.demo);
      expect(next.status).toBe(200);
      const nextId = ((await next.json()) as { event: { id: string } | null }).event?.id ?? '';
      const [nextRow] = await adminSql<{ tenant_id: string }[]>`
        select tenant_id::text from public.events where id = ${nextId}::uuid`;
      expect(nextRow?.tenant_id).toBe(tenantIds.demo);

      // ── POST /v1/events: a lab cover is the bare 404 an unknown one gets, nothing written ─────
      const unknownCover = await expectBareNotFound(
        await asAdmin('POST', '/v1/events', { ...body, coverAssetId: crypto.randomUUID() }),
        'create with an unknown cover',
      );
      const foreignCover = await expectBareNotFound(
        await asAdmin('POST', '/v1/events', { ...body, coverAssetId: assets.labCover }),
        'create with the lab cover',
      );
      expect(sansRequestId(foreignCover)).toEqual(sansRequestId(unknownCover));
      expect(foreignCover).not.toContain(assets.labCover);
      const [refused] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.events where title = ${title}`;
      expect(refused?.n).toBe(0);
      // Positive control: the same body with no cover publishes, in the demo tenant.
      const published = await asAdmin('POST', '/v1/events', body);
      expect(published.status).toBe(201);
      const ownEvent = ((await published.json()) as { id: string }).id;
      created.push(ownEvent);
      const [ownRow] = await adminSql<{ tenant_id: string }[]>`
        select tenant_id::text from public.events where id = ${ownEvent}::uuid`;
      expect(ownRow?.tenant_id).toBe(tenantIds.demo);

      // ── The lab event through every manage route: one bare 404 each ───────────────────────────
      const unknownEvent = crypto.randomUUID();
      const crossings = (id: string) =>
        [
          ['edit read', 'GET', `/v1/events/${id}/edit`, undefined],
          ['edit', 'PUT', `/v1/events/${id}`, body],
          ['cancel', 'PATCH', `/v1/events/${id}`, { status: 'cancelled' }],
          ['attendance', 'GET', `/v1/events/${id}/attendance`, undefined],
          ['summary', 'GET', `/v1/events/${id}/attendance/summary`, undefined],
          ['new door code', 'POST', `/v1/events/${id}/checkin-code`, undefined],
        ] as const;
      const unknownCalls = crossings(unknownEvent);
      for (const [index, [label, method, path, payload]] of crossings(labEvent).entries()) {
        const text = await expectBareNotFound(await asAdmin(method, path, payload), label);
        const unknown = unknownCalls[index];
        if (!unknown) throw new Error('crossing table out of step');
        const unknownText = await expectBareNotFound(
          await asAdmin(unknown[1], unknown[2], unknown[3]),
          `${label} (unknown)`,
        );
        expect(sansRequestId(text), label).toEqual(sansRequestId(unknownText));
        for (const needle of [tenantIds.lab, labEvent, labCode]) {
          expect(text, label).not.toContain(needle);
        }
      }

      // ── Positive controls: the same routes on the demo's own event ───────────────────────────
      expect((await asAdmin('GET', `/v1/events/${ownEvent}/edit`)).status).toBe(200);
      expect(
        (await asAdmin('PUT', `/v1/events/${ownEvent}`, { ...body, title: `${title} (editado)` }))
          .status,
      ).toBe(200);
      expect((await asAdmin('GET', `/v1/events/${ownEvent}/attendance`)).status).toBe(200);
      const summary = await asAdmin('GET', `/v1/events/${ownEvent}/attendance/summary`);
      expect(summary.status).toBe(200);
      const ownCode = ((await summary.json()) as { checkinCode: string | null }).checkinCode;
      expect(ownCode).toBeTruthy();
      const regenerated = await asAdmin('POST', `/v1/events/${ownEvent}/checkin-code`);
      expect(regenerated.status).toBe(200);
      expect(((await regenerated.json()) as { checkinCode: string }).checkinCode).not.toBe(ownCode);
      expect(
        (await asAdmin('PATCH', `/v1/events/${ownEvent}`, { status: 'cancelled' })).status,
      ).toBe(200);

      // ── Hosts: every route of the family on the lab's registered host ────────────────────────
      for (const [method, path, payload] of [
        ['GET', '/v1/events/next', undefined],
        ['POST', '/v1/events', body],
        ['GET', `/v1/events/${ownEvent}/edit`, undefined],
        ['PUT', `/v1/events/${ownEvent}`, body],
        ['PATCH', `/v1/events/${ownEvent}`, { status: 'active' }],
        ['GET', `/v1/events/${ownEvent}/attendance`, undefined],
        ['GET', `/v1/events/${ownEvent}/attendance/summary`, undefined],
        ['POST', `/v1/events/${ownEvent}/checkin-code`, undefined],
      ] as const) {
        await expectHostRefused(
          await send(method, path, tokens.demoAdmin, HOSTS.lab, payload),
          `${method} ${path}`,
        );
      }
      expect(await labTrace()).toEqual(before);
    } finally {
      if (created.length > 0) {
        await adminSql`delete from public.notifications where subject_id = any(${created}::uuid[])`;
        await adminSql`delete from public.events where id = any(${created}::uuid[])`;
      }
      await closeJobsSince(since, [tenantIds.demo, tenantIds.lab]);
    }
  });

  it("inventory sweep: event photos and community order — the gallery, its add and remove, and the reorder refuse the lab's ids beside the demo positive control (FRONT-PENDENCIAS)", async () => {
    // | Route                                        | Negative asserted here                              |
    // |----------------------------------------------|-----------------------------------------------------|
    // | GET    /v1/events/{id}/photos                | lab event: bare 404 (= unknown id), no lab photo    |
    // | POST   /v1/events/{id}/photos                | lab event, or a lab asset on the demo event: bare   |
    // |                                              | 404 (= unknown id), nothing written                 |
    // | DELETE /v1/events/{id}/photos/{photoId}      | lab photo, via the lab event or the demo one: bare  |
    // |                                              | 404, the lab photo and its asset untouched          |
    // | PUT    /v1/communities/order                 | a lab community in the list is the same 409 an      |
    // |                                              | unknown id gets; the lab positions untouched        |
    // Every one of them is also refused on the lab's registered host.
    const since = await dbNow();
    const labEvent = '0e000000-0000-4000-8000-000000000e01';
    const seedPostImage = async (tenantId: string, email: string) => {
      const [row] = await adminSql<{ id: string }[]>`
        insert into public.media_assets
          (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width, height,
           variant_widths, filename, ready_at)
        select ${tenantId}::uuid, u.id, 'image', 'post', 'ready', 'supabase',
               'image/webp', 262144, 1600, 1200, '{320,640,960,1280,1600}'::int[], 'foto.webp', now()
          from public.users u where u.email = ${email}
        returning id`;
      if (!row) throw new Error(`could not seed a post image for ${email}`);
      mediaAssetIds.push(row.id);
      return row.id;
    };
    const demoPhotoAsset = await seedPostImage(tenantIds.demo, 'admin@rede-demo.local');
    const labPhotoAsset = await seedPostImage(tenantIds.lab, 'admin@rede-lab.local');
    const [labPhotoRow] = await adminSql<{ id: string }[]>`
      insert into public.event_photos (tenant_id, event_id, media_asset_id, created_by_user_id)
      select ${tenantIds.lab}::uuid, ${labEvent}::uuid, ${labPhotoAsset}::uuid, u.id
        from public.users u where u.email = 'admin@rede-lab.local'
      returning id`;
    const labPhoto = labPhotoRow?.id ?? '';
    expect(labPhoto).not.toBe('');

    const tenantDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now() + 5 * 86_400_000));
    const eventBody = {
      title: `Varredura de fotos ${RUN}`,
      description: 'Encontro de varredura.',
      format: 'in_person',
      venueName: 'Auditório da sede',
      address: 'Rua das Flores, 100',
      start: { date: tenantDate, time: '19:00' },
      end: { date: tenantDate, time: '21:00' },
    };
    const asAdmin = (method: string, path: string, payload?: unknown) =>
      send(method, path, tokens.demoAdmin, HOSTS.demo, payload);
    const labTrace = async () => {
      const [row] = await adminSql<{ photos: unknown; asset: unknown; positions: unknown }[]>`
        select (select jsonb_agg(to_jsonb(p) order by p.id) from public.event_photos p
                 where p.tenant_id = ${tenantIds.lab}::uuid) as photos,
               (select to_jsonb(a) from public.media_assets a where a.id = ${labPhotoAsset}::uuid) as asset,
               (select jsonb_agg(jsonb_build_array(c.id, c.position, c.updated_at) order by c.id)
                  from public.communities c where c.tenant_id = ${tenantIds.lab}::uuid) as positions`;
      return row;
    };
    const demoPositions = await adminSql<{ id: string; position: number }[]>`
      select id::text, position from public.communities where tenant_id = ${tenantIds.demo}::uuid`;
    const created: string[] = [];

    try {
      const before = await labTrace();

      // ── The demo's own event, and the lab ids through every photo route: one bare 404 each ────
      const published = await asAdmin('POST', '/v1/events', eventBody);
      expect(published.status).toBe(201);
      const ownEvent = ((await published.json()) as { id: string }).id;
      created.push(ownEvent);

      const unknownEvent = crypto.randomUUID();
      const crossings = [
        [
          'gallery of the lab event',
          ['GET', `/v1/events/${labEvent}/photos`, undefined],
          ['GET', `/v1/events/${unknownEvent}/photos`, undefined],
        ],
        [
          'add to the lab event',
          ['POST', `/v1/events/${labEvent}/photos`, { mediaAssetId: demoPhotoAsset }],
          ['POST', `/v1/events/${unknownEvent}/photos`, { mediaAssetId: demoPhotoAsset }],
        ],
        [
          'add a lab asset to the demo event',
          ['POST', `/v1/events/${ownEvent}/photos`, { mediaAssetId: labPhotoAsset }],
          ['POST', `/v1/events/${ownEvent}/photos`, { mediaAssetId: crypto.randomUUID() }],
        ],
        [
          'remove the lab photo through the lab event',
          ['DELETE', `/v1/events/${labEvent}/photos/${labPhoto}`, undefined],
          ['DELETE', `/v1/events/${unknownEvent}/photos/${crypto.randomUUID()}`, undefined],
        ],
        [
          'remove the lab photo through the demo event',
          ['DELETE', `/v1/events/${ownEvent}/photos/${labPhoto}`, undefined],
          ['DELETE', `/v1/events/${ownEvent}/photos/${crypto.randomUUID()}`, undefined],
        ],
      ] as const;
      for (const [label, [method, path, payload], [uMethod, uPath, uPayload]] of crossings) {
        const text = await expectBareNotFound(await asAdmin(method, path, payload), label);
        const unknownText = await expectBareNotFound(
          await asAdmin(uMethod, uPath, uPayload),
          `${label} (unknown)`,
        );
        expect(sansRequestId(text), label).toEqual(sansRequestId(unknownText));
        for (const needle of [tenantIds.lab, labPhoto, labPhotoAsset]) {
          expect(text, label).not.toContain(needle);
        }
      }
      // A member reads the gallery too: the lab event is the same bare 404 for them.
      await expectBareNotFound(
        await send('GET', `/v1/events/${labEvent}/photos`, tokens.demoMember, HOSTS.demo),
        'member gallery of the lab event',
      );
      const [written] = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.event_photos
         where media_asset_id = ${demoPhotoAsset}::uuid
            or (media_asset_id = ${labPhotoAsset}::uuid and event_id <> ${labEvent}::uuid)`;
      expect(written?.n).toBe(0);

      // ── Positive controls: the demo's own photo is added, listed and removed ─────────────────
      const added = await asAdmin('POST', `/v1/events/${ownEvent}/photos`, {
        mediaAssetId: demoPhotoAsset,
      });
      expect(added.status).toBe(201);
      const ownPhoto = ((await added.json()) as { id: string }).id;
      const gallery = await send(
        'GET',
        `/v1/events/${ownEvent}/photos`,
        tokens.demoMember,
        HOSTS.demo,
      );
      expect(gallery.status).toBe(200);
      const galleryText = await gallery.text();
      expect(galleryText).toContain(ownPhoto);
      for (const needle of [labPhoto, labPhotoAsset]) expect(galleryText).not.toContain(needle);
      expect((await asAdmin('DELETE', `/v1/events/${ownEvent}/photos/${ownPhoto}`)).status).toBe(
        204,
      );

      // ── PUT /v1/communities/order: a lab id is the same 409 an unknown one gets ──────────────
      const [labCommunity] = await adminSql<{ id: string }[]>`
        select id::text from public.communities
         where tenant_id = ${tenantIds.lab}::uuid and deleted_at is null and status = 'active'
         limit 1`;
      expect(labCommunity).toBeTruthy();
      const demoActive = (
        await adminSql<{ id: string }[]>`
          select id::text from public.communities
           where tenant_id = ${tenantIds.demo}::uuid and deleted_at is null and status = 'active'
           order by position asc, last_activity_at desc, id desc`
      ).map((row) => row.id);
      expect(demoActive.length).toBeGreaterThan(1);
      const withLab = await asAdmin('PUT', '/v1/communities/order', {
        ids: [...demoActive.slice(1), labCommunity?.id],
      });
      const withUnknown = await asAdmin('PUT', '/v1/communities/order', {
        ids: [...demoActive.slice(1), crypto.randomUUID()],
      });
      expect(withLab.status).toBe(409);
      expect(withUnknown.status).toBe(409);
      const withLabText = await withLab.text();
      expect(sansRequestId(withLabText)).toEqual(sansRequestId(await withUnknown.text()));
      expect(withLabText).not.toContain(labCommunity?.id ?? '');
      const labOnly = await asAdmin('PUT', '/v1/communities/order', { ids: [labCommunity?.id] });
      expect(labOnly.status).toBe(409);
      // Positive control: the demo's own list, reversed, is accepted and answered in that order.
      const reversed = [...demoActive].reverse();
      const reordered = await asAdmin('PUT', '/v1/communities/order', { ids: reversed });
      expect(reordered.status).toBe(200);
      const page = (await reordered.json()) as { items: { id: string }[] };
      expect(page.items.map((item) => item.id)).toEqual(reversed.slice(0, page.items.length));

      // ── Hosts: every route of the family on the lab's registered host ────────────────────────
      for (const [method, path, payload] of [
        ['GET', `/v1/events/${ownEvent}/photos`, undefined],
        ['POST', `/v1/events/${ownEvent}/photos`, { mediaAssetId: demoPhotoAsset }],
        ['DELETE', `/v1/events/${ownEvent}/photos/${crypto.randomUUID()}`, undefined],
        ['PUT', '/v1/communities/order', { ids: demoActive }],
      ] as const) {
        await expectHostRefused(
          await send(method, path, tokens.demoAdmin, HOSTS.lab, payload),
          `${method} ${path}`,
        );
      }
      expect(await labTrace()).toEqual(before);
    } finally {
      for (const row of demoPositions) {
        await adminSql`update public.communities set position = ${row.position}
                        where id = ${row.id}::uuid`;
      }
      await adminSql`delete from public.event_photos where id = ${labPhoto}::uuid`;
      if (created.length > 0) {
        await adminSql`delete from public.notifications where subject_id = any(${created}::uuid[])`;
        await adminSql`delete from public.events where id = any(${created}::uuid[])`;
      }
      await closeJobsSince(since, [tenantIds.demo, tenantIds.lab]);
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

  it("storage sweep: every route that mints or serves a Storage URL refuses the other tenant's object, beside the owner's own positive control (08-10, T-03-56)", async () => {
    // The storage half of the 08-10 inventory. Two buckets (pgTAP 060 `branding`, 070 `media` pin
    // their policies inside Postgres); these are the API routes that MINT or SERVE a URL into them.
    // Each negative is the other tenant's id from a rede-demo session, answered exactly like an id
    // that names nothing; each positive control is the OWNER's same call, in the same test.
    //
    // | Route                                                        | Negative asserted here                         |
    // |--------------------------------------------------------------|------------------------------------------------|
    // | POST   /v1/media/uploads                                     | minted under the CALLER's prefix only; lab host 403 |
    // | POST   /v1/media/uploads/{assetId}/complete                  | lab upload: the unknown-id 404, lab row pending |
    // | GET    /v1/media/{assetId}/{variant}                         | lab image: the unknown-id 404, no Location      |
    // | GET    /v1/media/{assetId}/playback                          | lab video: bare 404, no token, no playback id   |
    // | DELETE /v1/media/{assetId}                                   | lab asset: bare 404, still live                 |
    // | POST   /v1/admin/branding/uploads                            | minted under the session tenant's prefix only   |
    // | POST   /v1/admin/branding/uploads/{uploadId}/complete        | lab upload: the unknown-id 404, nothing changes |
    // | POST   /v1/platform/tenants/{id}/branding/uploads            | minted under the PATH tenant's prefix only      |
    // | POST   /v1/platform/tenants/{id}/branding/uploads/{u}/complete | a lab upload under the demo id: unknown-id 404 |
    //
    // rede-lab's tenant row is the subject of two owner-side completes (its own logo), so it is
    // snapshotted and written back in `finally`, with every Storage object and job this case added.
    const since = await dbNow();
    type BrandRow = { display_name: string; branding: Record<string, unknown> };
    const brandRow = async (tenantId: string): Promise<BrandRow> => {
      const [row] = await adminSql<BrandRow[]>`
        select display_name, branding from public.tenants where id = ${tenantId}::uuid`;
      if (!row) throw new Error(`tenant ${tenantId} not found`);
      return row;
    };
    const objectsOf = async (bucket: string, tenantId: string) =>
      (
        await adminSql<{ name: string }[]>`
          select name from storage.objects
           where bucket_id = ${bucket} and name like ${`${tenantId}/%`}`
      ).map((row) => row.name);
    const brandBefore = {
      demo: await brandRow(tenantIds.demo),
      lab: await brandRow(tenantIds.lab),
    };
    const objectsBefore = {
      branding: {
        demo: new Set(await objectsOf('branding', tenantIds.demo)),
        lab: new Set(await objectsOf('branding', tenantIds.lab)),
      },
      media: {
        demo: new Set(await objectsOf('media', tenantIds.demo)),
        lab: new Set(await objectsOf('media', tenantIds.lab)),
      },
    };
    const startedAssets: string[] = [];

    const { encodeJpeg } = await import('@rede-social/core/server/media/variants');
    const { deriveIconSet } = await import('@rede-social/core/server/branding/icons');
    const jpeg = await encodeJpeg(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" fill="#1d4ed8"/></svg>',
      ),
    );
    const png = (
      await deriveIconSet(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120"><rect width="300" height="120" rx="12" fill="#1d4ed8"/></svg>',
        ),
        { primaryHex: '#1d4ed8', mime: 'image/svg+xml' },
      )
    ).i512;
    const putTo = async (signedUrl: string, bytes: Buffer, mime: string) => {
      const put = await fetch(signedUrl, {
        method: 'PUT',
        body: new Uint8Array(bytes),
        headers: { 'content-type': mime, 'x-upsert': 'false' },
      });
      expect(put.ok).toBe(true);
    };
    const superAdmin = (method: string, path: string, body?: unknown) =>
      api.request(path, {
        method,
        headers: {
          authorization: `Bearer ${tokens.superAdmin}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    try {
      // ── POST /v1/media/uploads: the key is the CALLER's prefix, whoever asks ──────────────────
      const mediaStart = {
        kind: 'image',
        purpose: 'avatar',
        mime: 'image/jpeg',
        size: jpeg.length,
      };
      const starts = {} as Record<
        'demo' | 'lab',
        { assetId: string; signedUrl: string; path: string }
      >;
      for (const [key, token, host] of [
        ['demo', tokens.demoMember, HOSTS.demo],
        ['lab', tokens.labMember, HOSTS.lab],
      ] as const) {
        const res = await send('POST', '/v1/media/uploads', token, host, mediaStart);
        expect(res.status, key).toBe(201);
        const started = (await res.json()) as { assetId: string; signedUrl: string; path: string };
        startedAssets.push(started.assetId);
        expect(started.path).toBe(`${tenantIds[key]}/media/${started.assetId}/original`);
        starts[key] = started;
      }
      await expectHostRefused(
        await send('POST', '/v1/media/uploads', tokens.demoMember, HOSTS.lab, mediaStart),
        'POST /v1/media/uploads',
      );

      // ── POST /v1/media/uploads/{assetId}/complete: the lab's REAL upload from demo ─────────────
      await putTo(starts.lab.signedUrl, jpeg, 'image/jpeg');
      const foreignComplete = await send(
        'POST',
        `/v1/media/uploads/${starts.lab.assetId}/complete`,
        tokens.demoMember,
        HOSTS.demo,
      );
      const unknownComplete = await send(
        'POST',
        `/v1/media/uploads/${crypto.randomUUID()}/complete`,
        tokens.demoMember,
        HOSTS.demo,
      );
      expect(foreignComplete.status).toBe(404);
      expect(unknownComplete.status).toBe(404);
      const foreignCompleteText = await foreignComplete.text();
      expect(sansRequestId(foreignCompleteText)).toEqual(
        sansRequestId(await unknownComplete.text()),
      );
      expect(foreignCompleteText).not.toContain(tenantIds.lab);
      const [labPending] = await adminSql<{ status: string; tenant_id: string }[]>`
        select status, tenant_id::text from public.media_assets
         where id = ${starts.lab.assetId}::uuid`;
      expect(labPending).toEqual({ status: 'pending', tenant_id: tenantIds.lab });
      // Positive control: the OWNER completes the very same upload.
      const ownComplete = await send(
        'POST',
        `/v1/media/uploads/${starts.lab.assetId}/complete`,
        tokens.labMember,
        HOSTS.lab,
      );
      expect(ownComplete.status).toBe(200);
      await expectHostRefused(
        await send(
          'POST',
          `/v1/media/uploads/${starts.demo.assetId}/complete`,
          tokens.demoMember,
          HOSTS.lab,
        ),
        'POST /v1/media/uploads/{assetId}/complete',
      );

      // ── GET /v1/media/{assetId}/{variant}: the lab's ready image from demo ────────────────────
      const variant = (assetId: string, token: string, host: string) =>
        api.request(`/v1/media/${assetId}/w320`, {
          headers: { authorization: `Bearer ${token}`, [TENANT_HOST_HEADER]: host },
          redirect: 'manual',
        });
      const foreignVariant = await variant(assets.labImage, tokens.demoMember, HOSTS.demo);
      const unknownVariant = await variant(crypto.randomUUID(), tokens.demoMember, HOSTS.demo);
      expect(foreignVariant.status).toBe(404);
      expect(foreignVariant.headers.get('location')).toBeNull();
      expect(unknownVariant.status).toBe(404);
      expect(sansRequestId(await foreignVariant.text())).toEqual(
        sansRequestId(await unknownVariant.text()),
      );
      const ownVariant = await variant(assets.labImage, tokens.labMember, HOSTS.lab);
      expect(ownVariant.status).toBe(302);
      expect(ownVariant.headers.get('location')).toContain(
        `${tenantIds.lab}/media/${assets.labImage}/w320.webp`,
      );
      await expectHostRefused(
        await variant(assets.demoImage, tokens.demoMember, HOSTS.lab),
        'GET /v1/media/{assetId}/{variant}',
      );

      // ── GET /v1/media/{assetId}/playback: the lab's ready video from the demo admin ───────────
      const unknownPlayback = await expectBareNotFound(
        await send(
          'GET',
          `/v1/media/${crypto.randomUUID()}/playback`,
          tokens.demoAdmin,
          HOSTS.demo,
        ),
        'playback (unknown id)',
      );
      const foreignPlayback = await expectBareNotFound(
        await send('GET', `/v1/media/${assets.labVideo}/playback`, tokens.demoAdmin, HOSTS.demo),
        'playback (lab id)',
      );
      expect(sansRequestId(foreignPlayback)).toEqual(sansRequestId(unknownPlayback));
      for (const needle of ['tokens', 'playbackId', 'privado-do-lab']) {
        expect(foreignPlayback).not.toContain(needle);
      }
      const ownPlayback = await send(
        'GET',
        `/v1/media/${assets.labVideo}/playback`,
        tokens.labAdmin,
        HOSTS.lab,
      );
      expect(ownPlayback.status).toBe(200);
      await expectHostRefused(
        await send('GET', `/v1/media/${assets.demoVideo}/playback`, tokens.demoAdmin, HOSTS.lab),
        'GET /v1/media/{assetId}/playback',
      );

      // ── DELETE /v1/media/{assetId}: a fresh lab asset from demo, then the owner's delete ──────
      const labDoomed = await seedReadyImage(tenantIds.lab, 'admin@rede-lab.local', 'post');
      const unknownDelete = await expectBareNotFound(
        await send('DELETE', `/v1/media/${crypto.randomUUID()}`, tokens.demoAdmin, HOSTS.demo),
        'delete (unknown id)',
      );
      const foreignDelete = await expectBareNotFound(
        await send('DELETE', `/v1/media/${labDoomed}`, tokens.demoAdmin, HOSTS.demo),
        'delete (lab id)',
      );
      expect(sansRequestId(foreignDelete)).toEqual(sansRequestId(unknownDelete));
      const deletedAt = async () => {
        const [row] = await adminSql<{ deleted_at: string | null }[]>`
          select deleted_at::text from public.media_assets where id = ${labDoomed}::uuid`;
        return row?.deleted_at;
      };
      expect(await deletedAt()).toBeNull();
      await expectHostRefused(
        await send('DELETE', `/v1/media/${labDoomed}`, tokens.demoAdmin, HOSTS.lab),
        'DELETE /v1/media/{assetId}',
      );
      expect(
        (await send('DELETE', `/v1/media/${labDoomed}`, tokens.labAdmin, HOSTS.lab)).status,
      ).toBe(200);
      expect(await deletedAt()).not.toBeNull();

      // ── /v1/admin/branding/uploads: the lab ADMIN's upload, completed from demo ───────────────
      const brandUpload = { kind: 'logo', mime: 'image/png', size: png.length };
      const adminStart = async (token: string, host: string, tenantId: string) => {
        const res = await send('POST', '/v1/admin/branding/uploads', token, host, brandUpload);
        expect(res.status).toBe(201);
        const started = (await res.json()) as { uploadId: string; signedUrl: string; path: string };
        expect(started.path.startsWith(`${tenantId}/`)).toBe(true);
        return started;
      };
      const labAdminUpload = await adminStart(tokens.labAdmin, HOSTS.lab, tenantIds.lab);
      await adminStart(tokens.demoAdmin, HOSTS.demo, tenantIds.demo);
      await putTo(labAdminUpload.signedUrl, png, 'image/png');
      const foreignBrand = await send(
        'POST',
        `/v1/admin/branding/uploads/${labAdminUpload.uploadId}/complete`,
        tokens.demoAdmin,
        HOSTS.demo,
      );
      const unknownBrand = await send(
        'POST',
        `/v1/admin/branding/uploads/logo-${crypto.randomUUID()}.png/complete`,
        tokens.demoAdmin,
        HOSTS.demo,
      );
      expect(foreignBrand.status).toBe(404);
      expect(unknownBrand.status).toBe(404);
      const foreignBrandText = await foreignBrand.text();
      expect(sansRequestId(foreignBrandText)).toEqual(sansRequestId(await unknownBrand.text()));
      expect(foreignBrandText).not.toContain(tenantIds.lab);
      expect(await brandRow(tenantIds.demo)).toEqual(brandBefore.demo);
      expect(await brandRow(tenantIds.lab)).toEqual(brandBefore.lab);
      // Positive control: the lab admin completes its own upload on its own lane.
      const ownBrand = await send(
        'POST',
        `/v1/admin/branding/uploads/${labAdminUpload.uploadId}/complete`,
        tokens.labAdmin,
        HOSTS.lab,
      );
      expect(ownBrand.status).toBe(200);
      expect(
        (
          (await ownBrand.json()) as { tenant: { branding: { logoUrl: string | null } } }
        ).tenant.branding.logoUrl?.endsWith(labAdminUpload.path),
      ).toBe(true);
      expect(await brandRow(tenantIds.demo)).toEqual(brandBefore.demo);
      for (const [method, path, body] of [
        ['POST', '/v1/admin/branding/uploads', brandUpload],
        ['POST', `/v1/admin/branding/uploads/${labAdminUpload.uploadId}/complete`, undefined],
      ] as const) {
        await expectHostRefused(
          await send(method, path, tokens.demoAdmin, HOSTS.lab, body),
          `${method} ${path}`,
        );
      }

      // ── /v1/platform/tenants/{id}/branding/uploads: the PATH tenant is the prefix ─────────────
      const platformStart = async (tenantId: string) => {
        const res = await superAdmin(
          'POST',
          `/v1/platform/tenants/${tenantId}/branding/uploads`,
          brandUpload,
        );
        expect(res.status).toBe(201);
        const started = (await res.json()) as { uploadId: string; signedUrl: string; path: string };
        expect(started.path.startsWith(`${tenantId}/`)).toBe(true);
        return started;
      };
      const labPlatformUpload = await platformStart(tenantIds.lab);
      await platformStart(tenantIds.demo);
      await putTo(labPlatformUpload.signedUrl, png, 'image/png');
      const demoBrandMid = await brandRow(tenantIds.demo);
      const crossPath = await superAdmin(
        'POST',
        `/v1/platform/tenants/${tenantIds.demo}/branding/uploads/${labPlatformUpload.uploadId}/complete`,
      );
      const unknownPath = await superAdmin(
        'POST',
        `/v1/platform/tenants/${tenantIds.demo}/branding/uploads/logo-${crypto.randomUUID()}.png/complete`,
      );
      expect(crossPath.status).toBe(404);
      expect(unknownPath.status).toBe(404);
      expect(sansRequestId(await crossPath.text())).toEqual(
        sansRequestId(await unknownPath.text()),
      );
      expect(await brandRow(tenantIds.demo)).toEqual(demoBrandMid);
      // Positive control: the same upload completed under ITS OWN tenant id.
      const samePath = await superAdmin(
        'POST',
        `/v1/platform/tenants/${tenantIds.lab}/branding/uploads/${labPlatformUpload.uploadId}/complete`,
      );
      expect(samePath.status).toBe(200);
      expect(await brandRow(tenantIds.demo)).toEqual(brandBefore.demo);
    } finally {
      // rede-lab's brand goes back exactly as found; every object and job this case added goes.
      await adminSql`
        update public.tenants
           set display_name = ${brandBefore.lab.display_name},
               branding = ${adminSql.json(brandBefore.lab.branding as never)}
         where id = ${tenantIds.lab}::uuid`;
      for (const bucket of ['branding', 'media'] as const) {
        for (const key of ['demo', 'lab'] as const) {
          const added = (await objectsOf(bucket, tenantIds[key])).filter(
            (name) => !objectsBefore[bucket][key].has(name),
          );
          if (added.length > 0) await storageAdmin().from(bucket).remove(added);
        }
      }
      if (startedAssets.length > 0) {
        await adminSql`delete from public.media_assets where id = any(${startedAssets}::uuid[])`;
      }
      await closeJobsSince(since, [tenantIds.demo, tenantIds.lab]);
    }
  });
});
