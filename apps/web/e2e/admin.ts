import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

/**
 * Fixtures for specs that need a THROWAWAY member: the seeded users are shared by the whole suite and
 * must never be blocked or have their password rotated.
 *
 * Identity is created through the GoTrue admin API (service key) and the membership through a direct
 * superuser connection — the same split `scripts/seed.ts` uses, and the reason both credentials are
 * required here. Application code never does either.
 */

/**
 * `scripts/local-env.sh --write` generates `apps/api/.env.local`; CI passes the same names through the
 * process environment. Values are read, never printed.
 */
function fromEnvFile(): Record<string, string> {
  const file = fileURLToPath(new URL('../../api/.env.local', import.meta.url));
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return out;
}

let fileValues: Record<string, string> | null = null;

function required(name: string): string {
  fileValues ??= fromEnvFile();
  const value = process.env[name] || fileValues[name];
  if (!value) {
    throw new Error(`${name} is required by the e2e admin fixtures (see scripts/local-env.sh)`);
  }
  return value;
}

/** Superuser connection for fixtures only. Never used by application code. */
let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 1 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

function authHeaders(): Record<string, string> {
  const key = required('SUPABASE_SERVICE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

/** Creates a confirmed identity plus an active membership in `tenantSlug`. Returns the user id. */
export async function createMember(
  email: string,
  password: string,
  tenantSlug: string,
  role: 'member' | 'admin_tenant' | 'support_tenant' = 'member',
): Promise<string> {
  const res = await fetch(`${required('SUPABASE_URL')}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`createUser failed for ${email}: ${res.status} ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };

  // `public.users` is mirrored from `auth.users` by the on_auth_user_created trigger.
  const inserted = await sql()`
    insert into public.memberships (tenant_id, user_id, role, status)
    select t.id, ${id}::uuid, ${role}, 'active' from public.tenants t where t.slug = ${tenantSlug}
    on conflict (tenant_id, user_id) do update set status = 'active'
    returning id`;
  if (inserted.length === 0) throw new Error(`tenant ${tenantSlug} not found for ${email}`);

  return id;
}

/** Flips a membership between `active` and `blocked` (AUTH-06, D-09). */
export async function setMembershipStatus(
  email: string,
  status: 'active' | 'blocked' | 'invited',
): Promise<void> {
  const updated = await sql()`
    update public.memberships m
       set status = ${status},
           blocked_at = case when ${status} = 'blocked' then now() else null end
      from public.users u
     where u.id = m.user_id and u.email = ${email}
    returning m.id`;
  if (updated.length === 0) throw new Error(`no membership for ${email}`);
}

/**
 * Deletes the membership row while leaving the identity (and its live session) alone — the "orphan
 * identity" the API answers with 403 `NO_MEMBERSHIP`.
 */
export async function removeMembership(email: string): Promise<void> {
  await sql()`
    delete from public.memberships m
     using public.users u
     where u.id = m.user_id and u.email = ${email}`;
}

/** Removes the throwaway identity; `public.users` and `memberships` cascade. */
export async function deleteUserByEmail(email: string): Promise<void> {
  const rows = await sql()<{ id: string }[]>`select id from auth.users where email = ${email}`;
  const id = rows[0]?.id;
  if (!id) return;
  await fetch(`${required('SUPABASE_URL')}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

/**
 * Removes a tenant the platform-panel spec created through the UI (02-12). `tenant_modules`,
 * `tenant_domains`, `tenant_invites` and `memberships` cascade from `tenants`.
 */
export async function deleteTenantBySlug(slug: string): Promise<void> {
  await sql()`delete from public.tenants where slug = ${slug}`;
}

/** `tenant_modules.enabled` for one key of one tenant, or `null` when there is no row (D-17/D-19). */
export async function getTenantModuleFlag(slug: string, key: string): Promise<boolean | null> {
  const rows = await sql()<{ enabled: boolean }[]>`
    select tm.enabled
      from public.tenant_modules tm
      join public.tenants t on t.id = tm.tenant_id
     where t.slug = ${slug} and tm.module_key = ${key}`;
  return rows[0]?.enabled ?? null;
}

/** A `.env.local` / process value a spec needs on the Node side (02-10 invite spec). Read, never printed. */
export function envValue(name: string): string {
  return required(name);
}

/** The live membership of an e-mail (`role` + `status`), or `null` when there is none (02-10). */
export async function membershipForEmail(
  email: string,
): Promise<{ role: string; status: string } | null> {
  const rows = await sql()<{ role: string; status: string }[]>`
    select m.role, m.status
      from public.memberships m
      join public.users u on u.id = m.user_id
     where u.email = ${email} and m.deleted_at is null
     limit 1`;
  return rows[0] ?? null;
}

/** How many `consent_records` rows an e-mail owns (D-03 evidence: two after an accept). */
export async function consentCountForEmail(email: string): Promise<number> {
  const rows = await sql()<{ count: number }[]>`
    select count(*)::int as count
      from public.consent_records c
      join public.users u on u.id = c.user_id
     where u.email = ${email}`;
  return rows[0]?.count ?? 0;
}

/**
 * Restores a seeded member's profile to known values (03-04): the profile specs edit the SHARED
 * seeded member, so every case puts the row back the way `pnpm db:seed` wrote it. `avatarAssetId` is
 * cleared when `null` is passed, which is what a photo case needs in its teardown — the asset row and
 * its Storage objects are left to 03-08's sweeper, exactly as a real removal leaves them.
 */
export async function resetMemberProfile(
  email: string,
  values: { displayName: string; bio: string | null; avatarAssetId?: string | null },
): Promise<void> {
  const updated = await sql()`
    update public.member_profiles p
       set display_name = ${values.displayName},
           bio = ${values.bio},
           updated_at = now()
      from public.users u
     where u.id = p.user_id and u.email = ${email}
    returning p.id`;
  if (updated.length === 0) throw new Error(`no member profile for ${email}`);

  if (values.avatarAssetId !== undefined) {
    await sql()`
      update public.member_profiles p
         set avatar_asset_id = ${values.avatarAssetId},
             updated_at = now()
        from public.users u
       where u.id = p.user_id and u.email = ${email}`;
  }
}

/**
 * Records a `ready` avatar asset for a member WITHOUT writing any Storage object, and points the
 * profile at it (03-04 E9): the row exists, so the foreign key holds and the screens render the
 * `/v1/media/...` path — but every fetch of it fails, which is exactly what an expired, deleted or
 * cross-tenant photo looks like to the browser. Returns the asset id.
 */
export async function stubUnfetchableAvatar(email: string): Promise<string> {
  const rows = await sql()<{ id: string }[]>`
    with member as (
      select m.tenant_id, m.user_id
        from public.memberships m
        join public.users u on u.id = m.user_id
       where u.email = ${email}
       limit 1
    ), asset as (
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths, ready_at)
      select tenant_id, user_id, 'image', 'avatar', 'ready', 'supabase', 'image/webp', 1024,
             array[128, 320], now()
        from member
      returning id, tenant_id, owner_user_id
    )
    update public.member_profiles p
       set avatar_asset_id = asset.id, updated_at = now()
      from asset
     where p.tenant_id = asset.tenant_id and p.user_id = asset.owner_user_id
    returning asset.id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`no member profile for ${email}`);
  return id;
}

/** A seeded member's profile row as the screens read it (03-04 assertions on persistence). */
export async function memberProfileForEmail(
  email: string,
): Promise<{ displayName: string; bio: string | null; avatarAssetId: string | null } | null> {
  const rows = await sql()<
    { display_name: string; bio: string | null; avatar_asset_id: string | null }[]
  >`
    select p.display_name, p.bio, p.avatar_asset_id
      from public.member_profiles p
      join public.users u on u.id = p.user_id
     where u.email = ${email}
     limit 1`;
  const row = rows[0];
  return row
    ? { displayName: row.display_name, bio: row.bio, avatarAssetId: row.avatar_asset_id }
    : null;
}

/**
 * Hard-deletes every video asset of a tenant (03-07): the admin media spec asserts the EMPTY state
 * and the rows it creates itself, so it must not inherit assets another run left behind. A soft
 * delete would not do — the screen would still be empty, but `media_assets` would accumulate across
 * runs and the "newest first" assertions would drift.
 */
export async function deleteTenantVideoAssets(tenantSlug: string): Promise<void> {
  // 04-04: `feed_post_media.media_asset_id` references `media_assets`, so the attachments have to be
  // detached before the rows can go. This stays a HARD, TOTAL reset of the tenant's video library
  // because that is exactly what the media spec's empty-state, newest-first and pagination
  // assertions measure — anything left behind is an off-by-one in those counts.
  //
  // The consequence is deliberate: the seeded video POST in THIS tenant loses its media row, which
  // is why `feed-media.spec.ts` reads the video case from rede-lab, a tenant no spec resets.
  await sql()`
    delete from public.feed_post_media m
     using public.media_assets a, public.tenants t
     where m.media_asset_id = a.id and a.tenant_id = t.id
       and t.slug = ${tenantSlug} and a.kind = 'video'`;
  // 05-05: `stories.media_asset_id` is a second reference to this table, and unlike
  // `feed_post_media` it is NOT NULL — there is no "detach" available, so a story that names one of
  // these assets has to GO with it. That is the honest reading of "HARD, TOTAL reset": the admin
  // media library lists every `kind = 'video'` asset regardless of purpose, so leaving a story's
  // video behind would make the empty-library assertion below fail instead.
  //
  // The consequence is the same one the video POST already pays: the demo tenant's seeded story
  // VIDEO does not survive this reset. `stories.spec.ts` therefore reads its expected count from
  // the DATABASE (see `activeReadyStoryCount`) rather than mirroring a seed constant, so its
  // assertions measure the strip rather than the order the suite happened to run in.
  await sql()`
    delete from public.stories s
     using public.media_assets a, public.tenants t
     where s.media_asset_id = a.id and a.tenant_id = t.id
       and t.slug = ${tenantSlug} and a.kind = 'video'`;
  await sql()`
    delete from public.media_assets a
     using public.tenants t
     where t.id = a.tenant_id and t.slug = ${tenantSlug} and a.kind = 'video'`;
}

/**
 * How many stories the tenant's STRIP will show right now — the `listActiveStories` predicate,
 * verbatim (05-05).
 *
 * `stories.spec.ts` reads this instead of mirroring a seed constant, because another spec can
 * legitimately remove one of the fixtures: `deleteTenantVideoAssets` performs a hard, total reset
 * of a tenant's video library and takes the seeded story VIDEO with it. A mirrored number would
 * then make the strip assertions depend on the order the suite happened to run in — which is the
 * one thing an e2e must never measure.
 */
export async function activeReadyStoryCount(tenantSlug: string): Promise<number> {
  const rows = await sql()<{ count: number }[]>`
    select count(*)::int as count
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id
      join public.tenants t on t.id = s.tenant_id
     where t.slug = ${tenantSlug}
       and s.deleted_at is null
       and s.expires_at > now()
       and a.status = 'ready'`;
  return rows[0]?.count ?? 0;
}

/**
 * Which of `storyIds` a MEMBER can still be shown: the story is not removed and its asset is `ready`
 * (the stories service's `MEMBER_VISIBLE`, verbatim). A row that no longer exists is simply absent.
 *
 * Same reason as `activeReadyStoryCount`: `deleteTenantVideoAssets` (called by `media-video.spec.ts`
 * and `phase3-smoke.spec.ts`, both of which run before `phase52-smoke.spec.ts`) hard-deletes the
 * seeded story VIDEO, so a spec that expects a seeded story must first ask whether it still exists.
 * Conditioning on the STORY (not on a highlight item) keeps the item assertion honest: a story that
 * exists but lost its item is still a failure.
 */
export async function memberVisibleStoryIds(storyIds: readonly string[]): Promise<string[]> {
  const rows = await sql()<{ id: string }[]>`
    select s.id
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id
     where s.id = any(${storyIds as string[]}::uuid[])
       and s.deleted_at is null
       and a.status = 'ready'`;
  return rows.map((row) => row.id);
}

/**
 * The highlight's member-visible story ids in the order the viewer plays them (`published_at, id`),
 * read from the database: the items read's predicate, verbatim.
 */
export async function memberVisibleHighlightStoryIds(highlightId: string): Promise<string[]> {
  const rows = await sql()<{ id: string }[]>`
    select s.id
      from public.story_highlight_items i
      join public.stories s on s.id = i.story_id and s.tenant_id = i.tenant_id
      join public.media_assets a on a.id = s.media_asset_id
     where i.highlight_id = ${highlightId}::uuid
       and s.deleted_at is null
       and a.status = 'ready'
     order by s.published_at, s.id`;
  return rows.map((row) => row.id);
}

/**
 * Hard-deletes the stories a spec wrote, by caption prefix, together with the assets they name
 * (05-05).
 *
 * A soft delete would NOT do, and the reason is specific rather than tidiness: `DELETE /v1/stories`
 * is soft by design (the likes and comments members left on a story survive it), so a spec that
 * cleaned up through the product would leave one `stories` row and one `media_assets` row per run.
 * Those assets are then permanently skipped by the media suites' own sweeps — which now exclude
 * anything a story names — so the accumulation would be silent and unbounded until `pnpm db:reset`.
 *
 * Scoped by CAPTION PREFIX rather than by tenant: every seeded story has to survive untouched, and
 * the prefix is the only thing that distinguishes a spec's rows from the fixture's.
 */
export async function deleteStoriesByCaptionPrefix(prefix: string): Promise<void> {
  const rows = await sql()<{ media_asset_id: string }[]>`
    delete from public.stories
     where caption like ${`${prefix}%`}
    returning media_asset_id`;
  const assetIds = [...new Set(rows.map((row) => row.media_asset_id))];
  if (assetIds.length === 0) return;
  // Only assets no OTHER story still names — a spec that reused a seeded asset must not remove it.
  await sql()`
    delete from public.media_assets
     where id = any(${assetIds}::uuid[])
       and id not in (select media_asset_id from public.stories)
       and id not in (select media_asset_id from public.feed_post_media)`;
}

/**
 * Clones an EXISTING ready story onto `count` extra rows (05-06's overflow backstop).
 *
 * They all reuse the same `media_asset_id` — a story references an asset, it does not own one — so
 * the fixture costs one statement and no upload, and `deleteStoriesByCaptionPrefix` removes the
 * rows while correctly leaving the shared asset alone. The windows are staggered by a minute so the
 * keyset order is total, exactly as it is in production.
 *
 * Returns the number of rows written, so the caller can assert against what it actually created
 * rather than against what it asked for.
 */
export async function cloneActiveStories(
  tenantSlug: string,
  captionPrefix: string,
  count: number,
): Promise<number> {
  const rows = await sql()<{ id: string }[]>`
    insert into public.stories
      (tenant_id, author_user_id, media_asset_id, media_kind, caption, published_at, expires_at)
    select s.tenant_id, s.author_user_id, s.media_asset_id, s.media_kind,
           ${captionPrefix} || ' ' || g,
           now() - (g || ' minutes')::interval,
           now() + interval '24 hours' - (g || ' minutes')::interval
      from generate_series(1, ${count}) g,
           lateral (
             select s.tenant_id, s.author_user_id, s.media_asset_id, s.media_kind
               from public.stories s
               join public.media_assets a on a.id = s.media_asset_id
               join public.tenants t on t.id = s.tenant_id
              where t.slug = ${tenantSlug}
                and s.deleted_at is null
                and s.expires_at > now()
                and a.status = 'ready'
                and s.media_kind = 'image'
              limit 1
           ) s
    returning id`;
  return rows.length;
}

/**
 * Records a video asset in a KNOWN state without a provider round trip (03-07): the failed and
 * rejected rows the library must render, and a `ready` row with a playback id the fake provider can
 * sign. Returns the asset id.
 */
export async function seedVideoAsset(
  tenantSlug: string,
  email: string,
  values: {
    status: 'pending' | 'processing' | 'ready' | 'failed' | 'rejected';
    filename?: string;
    playbackId?: string | null;
    durationSeconds?: number | null;
    failureReason?: string | null;
  },
): Promise<string> {
  const rows = await sql()<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, duration_seconds, aspect_ratio, filename, failure_reason, ready_at)
    select t.id, u.id, 'video', 'post', ${values.status}, 'fake',
           ${`fake-e2e-${Math.random().toString(36).slice(2)}`},
           ${values.playbackId ?? null}, 'video/mp4', 1048576,
           ${values.durationSeconds ?? null}, '16:9',
           ${values.filename ?? 'gravacao.mp4'}, ${values.failureReason ?? null},
           ${values.status === 'ready' ? new Date().toISOString() : null}::timestamptz
      from public.tenants t, public.users u
     where t.slug = ${tenantSlug} and u.email = ${email}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not seed a video asset for ${email} in ${tenantSlug}`);
  return id;
}

/**
 * Seeds `count` `ready` videos in one statement (03-07 pagination): the keyset page is 25, so a
 * "Carregar mais" case needs more rows than a per-row insert loop should pay for.
 */
export async function seedVideoAssets(
  tenantSlug: string,
  email: string,
  count: number,
): Promise<void> {
  await sql()`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, duration_seconds, aspect_ratio, filename, created_at, ready_at)
    select t.id, u.id, 'video', 'post', 'ready', 'fake',
           'fake-e2e-bulk-' || g::text, 'fake-playback-bulk-' || g::text,
           'video/mp4', 1048576, 5, '16:9', 'lote-' || g::text || '.mp4',
           now() - (g || ' seconds')::interval, now()
      from generate_series(1, ${count}) g, public.tenants t, public.users u
     where t.slug = ${tenantSlug} and u.email = ${email}`;
}

/**
 * Flips a video asset to `ready` with a playback id, the way the provider's webhook job would
 * (03-06's `kernel.media-provider-event`). The fake provider already schedules that job on its own;
 * this is the deterministic handle for a spec that must not wait on a worker poll.
 */
export async function markVideoReady(
  assetId: string,
  values: { playbackId?: string; durationSeconds?: number } = {},
): Promise<void> {
  await sql()`
    update public.media_assets
       set status = 'ready',
           playback_id = ${values.playbackId ?? `fake-playback-${assetId}`},
           duration_seconds = ${values.durationSeconds ?? 2},
           aspect_ratio = '16:9',
           ready_at = now()
     where id = ${assetId}::uuid`;
}

/** The newest video asset of a tenant as the screens read it (03-07 upload assertions). */
export async function newestVideoAsset(
  tenantSlug: string,
): Promise<{ id: string; status: string; provider: string; filename: string | null } | null> {
  const rows = await sql()<
    { id: string; status: string; provider: string; filename: string | null }[]
  >`
    select a.id, a.status, a.provider, a.filename
      from public.media_assets a
      join public.tenants t on t.id = a.tenant_id
     where t.slug = ${tenantSlug} and a.kind = 'video'
     order by a.created_at desc
     limit 1`;
  return rows[0] ?? null;
}

/** The newest `tenant_invites.status` for an e-mail, or `null` (02-10 lifecycle assertions). */
export async function inviteStatusForEmail(email: string): Promise<string | null> {
  const rows = await sql()<{ status: string }[]>`
    select status from public.tenant_invites
     where email = ${email}
     order by created_at desc
     limit 1`;
  return rows[0]?.status ?? null;
}

/**
 * The ACTIVE membership id of an e-mail in a tenant — the identity `/membros/[membershipId]` is
 * keyed by (03-02: the profile hangs off the membership, not off `users`). Used by the directory
 * spec to reach a member by direct link and to prove the caller's own id redirects to `/perfil`.
 */
export async function membershipIdFor(email: string, tenantSlug: string): Promise<string> {
  const rows = await sql()<{ id: string }[]>`
    select m.id
      from public.memberships m
      join public.users u on u.id = m.user_id
      join public.tenants t on t.id = m.tenant_id
     where u.email = ${email} and t.slug = ${tenantSlug} and m.deleted_at is null
     limit 1`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`no membership for ${email} in ${tenantSlug}`);
  return id;
}

/**
 * The id of a seeded feed post, by tenant and caption (04-08). `/post/[postId]` is keyed by the
 * post id and the seed does not publish one, so a spec that needs a REAL deep link has to look it
 * up — and it must say WHICH tenant, because the two seed tenants carry the same captions on
 * purpose (TENANT-05 adjacency).
 */
export async function feedPostIdFor(caption: string, tenantSlug: string): Promise<string> {
  const rows = await sql()<{ id: string }[]>`
    select p.id
      from public.feed_posts p
      join public.tenants t on t.id = p.tenant_id
     where t.slug = ${tenantSlug} and p.caption = ${caption} and p.deleted_at is null
     order by p.created_at desc
     limit 1`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`no live post "${caption}" in ${tenantSlug}`);
  return id;
}

/**
 * One member's like on one post, as the database holds it (07-13, FEED-04): whether that member's
 * `feed_likes` row exists and the post's trigger-owned `like_count`. The like cases read it after
 * each write, so "one double tap, one row" is proven in the database and not only on screen.
 */
export async function feedPostLikeState(
  postId: string,
  email: string,
): Promise<{ liked: boolean; likeCount: number }> {
  const rows = await sql()<{ liked: boolean; likeCount: number }[]>`
    select exists (
             select 1
               from public.feed_likes l
               join public.users u on u.id = l.user_id
              where l.post_id = p.id and u.email = ${email}
           ) as liked,
           p.like_count::int as "likeCount"
      from public.feed_posts p
     where p.id = ${postId}::uuid`;
  const row = rows[0];
  if (!row) throw new Error(`no feed post ${postId}`);
  return { liked: row.liked, likeCount: row.likeCount };
}

/**
 * Removes ONE member's like on ONE post and returns how many rows went (0 or 1) (07-13, FEED-04).
 * The like cases share the seeded member and posts across both projects and every repeat, so each
 * case clears its own like before it starts and again in a `finally`: a run that fails mid-case can
 * no longer hand the next run a post that is already liked. The delete is scoped to the post id AND
 * the member's e-mail, and `feed_posts.like_count` stays right because its trigger owns it.
 */
export async function clearFeedPostLike(postId: string, email: string): Promise<number> {
  const deleted = await sql()`
    delete from public.feed_likes l
     using public.users u
     where l.user_id = u.id
       and u.email = ${email}
       and l.post_id = ${postId}::uuid
    returning l.id`;
  return deleted.length;
}

/**
 * Sets or clears a post's soft-delete stamp (04-08, UI-D-16): the spec needs a post that EXISTS in
 * the caller's own tenant and is still unreachable, which is the third of the three branches the
 * one not-found screen has to cover.
 *
 * It is a toggle rather than a delete because the seeded posts are shared by the whole suite —
 * `feed.spec.ts` counts them — so the case that removes one puts it back in its teardown.
 */
export async function setFeedPostRemoved(postId: string, removed: boolean): Promise<void> {
  const updated = await sql()`
    update public.feed_posts
       set deleted_at = ${removed ? sql()`now()` : null}
     where id = ${postId}::uuid
    returning id`;
  if (updated.length === 0) throw new Error(`no feed post ${postId}`);
}

/**
 * A post authored by a REAL user of a seeded tenant (04-09), for the specs that need a card whose
 * "…" menu offers the author variant.
 *
 * Written directly rather than through the composer so the menu, edit and delete cases do not each
 * pay for two uploads — and so they cannot fail for a reason that belongs to the publish case.
 * The caption is the caller's, which is what lets the teardown find every row it made.
 */
export async function createFeedPostAs(
  email: string,
  tenantSlug: string,
  caption: string,
  /** 08-03: a COMMUNITY post (the moderation spec removes a comment on one). */
  options: { communityId?: string } = {},
): Promise<string> {
  const communityId = options.communityId ?? null;
  const rows = await sql()<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, author_user_id, caption, community_id)
    select t.id, u.id, ${caption}, ${communityId}::uuid
      from public.tenants t, public.users u
     where t.slug = ${tenantSlug} and u.email = ${email}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not create a post for ${email} in ${tenantSlug}`);
  return id;
}

/**
 * Removes every post whose caption starts with `prefix`, soft-deleted ones included.
 *
 * The seeded feed is COUNTED by `feed.spec.ts` (`seededFeedPaging.total`), so a spec that publishes
 * has to take its rows back out — including the one it soft-deleted, whose stamp keeps it out of
 * the reads but not out of the table.
 */
export async function deleteFeedPostsLike(prefix: string): Promise<number> {
  const removed = await sql()`
    delete from public.feed_posts where caption like ${`${prefix}%`} returning id`;
  return removed.length;
}

/**
 * 05.3-09: a VIDEO post as Reels reads it — a `fake`-provider asset, the `feed_posts` row with
 * `media_kind = 'video'` and its one `feed_post_media` row — written in ONE transaction, so a spec
 * never observes a video post without its media row (the `READY_VIDEO_POST` predicate would drop it,
 * and the lane row would disagree with the list for a moment).
 *
 * `status: 'processing'` writes the asset with no playback id and no `ready_at`: the row is in the
 * table but no Reels read may return it (REELS-03), which is exactly what the negative cases need.
 * `minutesAgo` back-dates the post (and the asset) so a spec pins the "Todos" and lane order instead
 * of inheriting the order its inserts happened to run in. `communityId` puts the post inside a
 * community; the counters trigger then raises that community's `last_activity_at` to the post's
 * `created_at`, which is the key the lane row orders by (D-119).
 *
 * The caption is the caller's, and it is what `deleteReelsFixtures` removes the row by. Nothing
 * here is added to `scripts/seed.ts`: the seed's pinned counts must not move (T-05.3-22).
 */
export async function createVideoPostAs(
  email: string,
  tenantSlug: string,
  caption: string,
  options: {
    status?: 'ready' | 'processing';
    communityId?: string | null;
    width?: number;
    height?: number;
    minutesAgo?: number;
  } = {},
): Promise<{ postId: string; assetId: string }> {
  const {
    status = 'ready',
    communityId = null,
    width = 1080,
    height = 1920,
    minutesAgo = 0,
  } = options;
  const createdAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const token = Math.random().toString(36).slice(2);
  const ready = status === 'ready';

  return sql().begin(async (tx) => {
    const assets = await tx<{ id: string; tenant_id: string; owner_user_id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
         mime, bytes, duration_seconds, aspect_ratio, width, height, filename, created_at, ready_at)
      select t.id, u.id, 'video', 'post', ${status}, 'fake',
             ${`fake-e2e-reels-${token}`}, ${ready ? `fake-playback-reels-${token}` : null},
             'video/mp4', 1048576, ${ready ? 12 : null}, ${width >= height ? '16:9' : '9:16'},
             ${width}, ${height}, 'reel.mp4', ${createdAt}::timestamptz,
             ${ready ? createdAt : null}::timestamptz
        from public.tenants t, public.users u
       where t.slug = ${tenantSlug} and u.email = ${email}
      returning id, tenant_id, owner_user_id`;
    const asset = assets[0];
    if (!asset) throw new Error(`could not create a video asset for ${email} in ${tenantSlug}`);

    const posts = await tx<{ id: string }[]>`
      insert into public.feed_posts
        (tenant_id, author_user_id, community_id, caption, media_kind, created_at)
      values (${asset.tenant_id}::uuid, ${asset.owner_user_id}::uuid, ${communityId}::uuid,
              ${caption}, 'video', ${createdAt}::timestamptz)
      returning id`;
    const post = posts[0];
    if (!post) throw new Error(`could not create a video post for ${email} in ${tenantSlug}`);

    await tx`
      insert into public.feed_post_media
        (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
      values (${asset.tenant_id}::uuid, ${post.id}::uuid, 'video', ${asset.id}::uuid, 'video', 0)`;

    return { postId: post.id, assetId: asset.id };
  });
}

/**
 * 05.3-09: an `active` community, for the Reels lane row. `minutesAgo` back-dates BOTH its
 * `created_at` and its `last_activity_at`, so the video a spec then posts into it (newer than that)
 * is what decides where its lane sits — the trigger only ever raises `last_activity_at`. The slug is
 * derived from the name plus a random suffix, so two projects never collide on `(tenant, slug)`.
 * Returns the id.
 */
export async function createCommunityAs(
  email: string,
  tenantSlug: string,
  name: string,
  options: { minutesAgo?: number } = {},
): Promise<string> {
  const stamp = new Date(Date.now() - (options.minutesAgo ?? 0) * 60_000).toISOString();
  const slug = `${name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)}-${Math.random().toString(36).slice(2, 8)}`;
  const rows = await sql()<{ id: string }[]>`
    insert into public.communities
      (tenant_id, created_by_user_id, name, slug, status, last_activity_at, created_at)
    select t.id, u.id, ${name}, ${slug}, 'active', ${stamp}::timestamptz, ${stamp}::timestamptz
      from public.tenants t, public.users u
     where t.slug = ${tenantSlug} and u.email = ${email}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not create community "${name}" in ${tenantSlug}`);
  return id;
}

/**
 * 05.3-09: a ROOT comment on a post, written directly (the Reels comment case needs a thread whose
 * reply affordance it can see). The comment-count trigger moves the post's counter; the row goes
 * with its post, since `feed_comments.post_id` cascades.
 *
 * 08-01: with `parentId`, a REPLY under that root instead — the moderation spec needs another
 * member's root with replies, without driving three member sessions through the composer.
 */
export async function createFeedCommentAs(
  email: string,
  postId: string,
  body: string,
  parentId?: string,
): Promise<string> {
  const rows = parentId
    ? await sql()<{ id: string }[]>`
        insert into public.feed_comments
          (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
        select p.tenant_id, p.id, u.id, ${body}, 1, ${parentId}::uuid, 0, 'post'
          from public.feed_posts p, public.users u
         where p.id = ${postId}::uuid and u.email = ${email}
        returning id`
    : await sql()<{ id: string }[]>`
        insert into public.feed_comments (tenant_id, post_id, author_user_id, body, depth)
        select p.tenant_id, p.id, u.id, ${body}, 0
          from public.feed_posts p, public.users u
         where p.id = ${postId}::uuid and u.email = ${email}
        returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not comment on ${postId} as ${email}`);
  return id;
}

/**
 * 05.3-09: removes everything the Reels spec made, by PREFIX — the posts whose caption starts with
 * it (their media rows, likes and comments cascade), then the assets those posts used (only when no
 * other row still names them), then the communities whose name starts with it. That order is
 * forced: `feed_posts.community_id` has no `ON DELETE`, and `feed_post_media.media_asset_id` none
 * either. Every seeded row survives, because nothing the seed writes carries the prefix.
 */
export async function deleteReelsFixtures(prefix: string): Promise<void> {
  const like = `${prefix}%`;
  const assets = await sql()<{ media_asset_id: string }[]>`
    select m.media_asset_id
      from public.feed_post_media m
      join public.feed_posts p on p.id = m.post_id
     where p.caption like ${like}`;
  await sql()`delete from public.feed_posts where caption like ${like}`;
  const assetIds = [...new Set(assets.map((row) => row.media_asset_id))];
  if (assetIds.length > 0) {
    await sql()`
      delete from public.media_assets
       where id = any(${assetIds}::uuid[])
         and id not in (select media_asset_id from public.feed_post_media)
         and id not in (select media_asset_id from public.stories)`;
  }
  await sql()`delete from public.communities where name like ${like}`;
}

/**
 * Waits until `count` post images uploaded after `since` have reached `ready`.
 *
 * It exists because variant derivation runs in the WORKER (`kernel.media-derive-variants`), and
 * `createPost` requires an image to be `ready` — a video may publish mid-transcode, an image may
 * not (04-04). The wait is the SPEC's, not the product's: it removes a race that belongs to the
 * fixture (a worker that has not polled yet) rather than papering over one in the composer.
 */
export async function waitForReadyPostImages(
  tenantSlug: string,
  since: Date,
  count: number,
  // Generous on purpose: pg-boss is FIFO with a ~2 s poll, so a backlog left behind by an earlier
  // media spec delays THIS spec's two jobs by however long that backlog takes. With a drained
  // queue the wait settles in a few seconds.
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let seen = '(none)';
  while (Date.now() < deadline) {
    const rows = await sql()<{ status: string; n: string }[]>`
      select a.status, count(*)::text as n
        from public.media_assets a
        join public.tenants t on t.id = a.tenant_id
       where t.slug = ${tenantSlug}
         and a.kind = 'image' and a.purpose = 'post'
         and a.created_at >= ${since.toISOString()}::timestamptz
       group by a.status`;
    seen = rows.map((row) => `${row.status}=${row.n}`).join(' ') || '(no rows at all)';
    const ready = Number(rows.find((row) => row.status === 'ready')?.n ?? '0');
    if (ready >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // The observed statuses are the whole diagnosis: "(no rows at all)" means the upload never
  // reached `complete`, while `processing=2` means the worker is not draining its queue.
  throw new Error(
    `only fewer than ${count} post images reached 'ready' within ${timeoutMs}ms — saw ${seen}`,
  );
}

/** Drops the post media assets a spec uploaded, so a re-run does not page over its own fixtures. */
export async function deletePostAssetsSince(tenantSlug: string, since: Date): Promise<void> {
  await sql()`
    delete from public.media_assets a
     using public.tenants t
     where t.id = a.tenant_id and t.slug = ${tenantSlug}
       and a.purpose in ('post', 'attachment')
       and a.created_at >= ${since.toISOString()}::timestamptz`;
}

/**
 * Removes every STORY comment whose body starts with `prefix` (05-07).
 *
 * A hard delete rather than a soft one: the spec's own rows must leave no trace in
 * `stories.comment_count`, and the trigger's DELETE arm is what moves the number back. Using the
 * UI's own delete control instead would be the file's usual posture, but it would also route the
 * cleanup through a confirmation dialog stacked over a sheet over a full-screen viewer — three
 * overlays deep, for a teardown.
 */
export async function deleteStoryCommentsByBodyPrefix(prefix: string): Promise<void> {
  await sql()`
    delete from public.feed_comments
     where story_id is not null and body like ${`${prefix}%`}`;
}

/**
 * 08-03 (UI E10/long-text backstop): ONE moderation log row written straight into the append-only
 * table (INSERT is the one write the owner lane keeps), with the demo admin as the actor and `target`
 * as the target. It can never be removed — the log is append-only by design — so the spec scopes its
 * assertions to the row id this returns.
 */
export async function insertModerationLogRow(
  tenantSlug: string,
  actorEmail: string,
  targetEmail: string,
  row:
    | { action: 'comment_removed'; excerpt: string }
    | { action: 'member_blocked'; reason: string },
): Promise<string> {
  const excerpt = row.action === 'comment_removed' ? row.excerpt : null;
  const reason = row.action === 'member_blocked' ? row.reason : null;
  const subjectType = row.action === 'comment_removed' ? 'post_comment' : null;
  const rows = await sql()<{ id: string }[]>`
    insert into public.moderation_log
      (tenant_id, action, actor_user_id, actor_membership_id, target_user_id, target_membership_id,
       subject_type, subject_id, excerpt, reason)
    select t.id, ${row.action}, au.id, am.id, tu.id, tm.id, ${subjectType},
           case when ${subjectType}::text is null then null else gen_random_uuid() end,
           ${excerpt}, ${reason}
      from public.tenants t
      join public.users au on au.email = ${actorEmail}
      join public.memberships am on am.user_id = au.id and am.tenant_id = t.id
      join public.users tu on tu.email = ${targetEmail}
      join public.memberships tm on tm.user_id = tu.id and tm.tenant_id = t.id
     where t.slug = ${tenantSlug}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not write a moderation log row in ${tenantSlug}`);
  return id;
}

/** 08-03: soft-deletes one comment out of band — the "someone removed it first" race. */
export async function softDeleteCommentOutOfBand(commentId: string): Promise<void> {
  await sql()`
    update public.feed_comments set deleted_at = now()
     where id = ${commentId}::uuid and deleted_at is null`;
}

/**
 * 08-03 (D-336): ONE live story for `tenantSlug`, cloned from an existing ready IMAGE story of the
 * tenant (the `cloneActiveStories` posture: a story references an asset, so no upload is needed),
 * published by the tenant's admin with `caption`. Remove it with `deleteStoriesByCaptionPrefix`.
 */
export async function createStoryLike(tenantSlug: string, caption: string): Promise<string> {
  const rows = await sql()<{ id: string }[]>`
    insert into public.stories
      (tenant_id, author_user_id, media_asset_id, media_kind, caption, published_at, expires_at)
    select s.tenant_id, s.author_user_id, s.media_asset_id, s.media_kind, ${caption},
           now(), now() + interval '24 hours'
      from public.stories s
      join public.media_assets a on a.id = s.media_asset_id
      join public.tenants t on t.id = s.tenant_id
     where t.slug = ${tenantSlug}
       and s.deleted_at is null
       and a.status = 'ready'
       and s.media_kind = 'image'
     limit 1
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`no ready image story to clone in ${tenantSlug}`);
  return id;
}

/**
 * 08-03 (D-336): a flat STORY comment by `email`, written directly (the `createFeedCommentAs`
 * posture). The comment-count trigger moves the story's counter.
 */
export async function createStoryCommentAs(
  email: string,
  storyId: string,
  body: string,
): Promise<string> {
  const rows = await sql()<{ id: string }[]>`
    insert into public.feed_comments (tenant_id, story_id, author_user_id, body, depth)
    select s.tenant_id, s.id, u.id, ${body}, 0
      from public.stories s, public.users u
     where s.id = ${storyId}::uuid and u.email = ${email}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not comment on story ${storyId} as ${email}`);
  return id;
}

/**
 * 05.2-09 (UI-D-80): writes ONE highlight straight into the table, for the place a spec cannot reach
 * through the product — an ARCHIVED community, whose create the API refuses with `archived` by
 * design. Appended after the place's current rows. Returns the new id.
 *
 * Remove it with `deleteHighlightsByTitlePrefix`; the title prefix is the only thing that tells a
 * spec's rows from the seed's.
 */
export async function insertHighlightFixture(
  tenantSlug: string,
  communityId: string | null,
  title: string,
): Promise<string> {
  const rows = await sql()<{ id: string }[]>`
    insert into public.story_highlights
      (tenant_id, community_id, title, position, created_by_user_id)
    select t.id,
           ${communityId}::uuid,
           ${title},
           coalesce((
             select max(h.position) + 1
               from public.story_highlights h
              where h.tenant_id = t.id
                and h.community_id is not distinct from ${communityId}::uuid
           ), 0),
           -- The tenant's admin as the creator, the curator a real highlight would name.
           (select m.user_id
              from public.memberships m
             where m.tenant_id = t.id and m.role = 'admin_tenant' and m.deleted_at is null
             order by m.joined_at
             limit 1)
      from public.tenants t
     where t.slug = ${tenantSlug}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`insertHighlightFixture: tenant ${tenantSlug} not found`);
  return id;
}

/** Hard-deletes a tenant's highlights whose title starts with `prefix` (their items cascade). */
export async function deleteHighlightsByTitlePrefix(
  tenantSlug: string,
  prefix: string,
): Promise<void> {
  await sql()`
    delete from public.story_highlights h
     using public.tenants t
     where t.id = h.tenant_id
       and t.slug = ${tenantSlug}
       and h.title like ${`${prefix}%`}`;
}

/**
 * 05.2-10 (HIGHLIGHT-06, D-105): sets ONE user's seen state in a tenant to EXACTLY `storyIds` —
 * every other `story_views` row of that user in that tenant is removed first.
 *
 * Viewing is now a WRITE: every spec that opens the viewer records what it showed, so a spec that
 * asserts where the tenant circle opens (the resume index) or which ring it wears must pin the
 * state it starts from instead of inheriting whatever the previous test watched. Ids that are not
 * a live story of that tenant (a video another spec removed) are simply skipped.
 */
export async function setStoryViews(
  email: string,
  tenantSlug: string,
  storyIds: readonly string[],
): Promise<void> {
  await sql()`
    delete from public.story_views v
     using public.users u, public.tenants t
     where v.user_id = u.id and v.tenant_id = t.id
       and u.email = ${email} and t.slug = ${tenantSlug}`;
  if (storyIds.length === 0) return;
  await sql()`
    insert into public.story_views (tenant_id, user_id, story_id)
    select t.id, u.id, s.id
      from public.tenants t
      join public.stories s on s.tenant_id = t.id and s.deleted_at is null
      cross join public.users u
     where t.slug = ${tenantSlug} and u.email = ${email}
       and s.id = any(${storyIds as string[]}::uuid[])
    on conflict (tenant_id, user_id, story_id) do nothing`;
}

/** 05.2-10: whether the server recorded that `email` saw `storyId` (the flush landed). */
export async function hasStoryView(email: string, storyId: string): Promise<boolean> {
  const rows = await sql()<{ seen: boolean }[]>`
    select exists (
      select 1 from public.story_views v
        join public.users u on u.id = v.user_id
       where u.email = ${email} and v.story_id = ${storyId}::uuid
    ) as seen`;
  return rows[0]?.seen === true;
}

/**
 * 08-04: sets the PROFILE display name of an e-mail's membership in a tenant (the name the Membros
 * list and the directory show). `createMember` creates identities without a name, so a spec that needs
 * a long or specific name sets it here. Never used on seeded users.
 */
export async function setMemberDisplayName(
  email: string,
  tenantSlug: string,
  displayName: string,
): Promise<void> {
  const updated = await sql()`
    update public.member_profiles mp
       set display_name = ${displayName}
      from public.memberships m
      join public.users u on u.id = m.user_id
      join public.tenants t on t.id = m.tenant_id
     where mp.membership_id = m.id and u.email = ${email} and t.slug = ${tenantSlug}
    returning mp.id`;
  if (updated.length === 0) throw new Error(`no profile for ${email} in ${tenantSlug}`);
}

/** 08-04: how many memberships of a tenant read as blocked (`status` or the legacy `blocked_at`). */
export async function blockedMembershipCount(tenantSlug: string): Promise<number> {
  const rows = await sql()<{ count: number }[]>`
    select count(*)::int as count
      from public.memberships m
      join public.tenants t on t.id = m.tenant_id
     where t.slug = ${tenantSlug} and m.deleted_at is null
       and (m.status = 'blocked' or m.blocked_at is not null)`;
  return rows[0]?.count ?? 0;
}

/**
 * 08-04: blocks or unblocks a membership THROUGH THE REAL API as `adminEmail` (the admin action the
 * Membros sheet calls), so the kernel's `membership.blocked` crosses the bus and the notifications
 * subscriber nudges the member's open app. `host` is the tenant host the API compares the membership
 * with. Throws on anything but 200.
 */
export async function memberAccessAs(
  adminEmail: string,
  password: string,
  membershipId: string,
  kind: 'block' | 'unblock',
  host = 'rede-demo.localhost',
): Promise<void> {
  const session = await fetch(`${required('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: required('SUPABASE_PUBLISHABLE_KEY'),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email: adminEmail, password }),
  });
  if (!session.ok) throw new Error(`${adminEmail} sign-in failed: ${session.status}`);
  const token = ((await session.json()) as { access_token: string }).access_token;
  const apiUrl = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';
  const res = await fetch(`${apiUrl}/v1/admin/members/${membershipId}/${kind}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': host,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (res.status !== 200)
    throw new Error(`${kind} ${membershipId}: ${res.status} ${await res.text()}`);
}

/**
 * 08-05: sets the ROLE of an e-mail's membership in a tenant directly in the database — "an admin
 * demoted in another tab" without going through the API. Never used on seeded users.
 */
export async function setMembershipRole(
  email: string,
  tenantSlug: string,
  role: 'member' | 'admin_tenant' | 'support_tenant',
): Promise<void> {
  const updated = await sql()`
    update public.memberships m
       set "role" = ${role}
      from public.users u, public.tenants t
     where u.id = m.user_id and t.id = m.tenant_id and u.email = ${email} and t.slug = ${tenantSlug}
    returning m.id`;
  if (updated.length === 0) throw new Error(`no membership for ${email} in ${tenantSlug}`);
}

/**
 * 08-08 (D-346): a post whose link preview is a RESOLVED YouTube or Vimeo oEmbed card, written in
 * its terminal state (the seed's rule: an e2e never performs a real unfurl). The API projects
 * `embedUrl` from the stored provider and URL, so this is the fixture the enforced-CSP walk taps
 * play on. `url` should carry a per-run query parameter: `(tenant_id, url_hash)` is unique.
 * Nothing is added to `scripts/seed.ts` (its pinned feed counts must not move); remove it with
 * `deleteLinkPreviewPosts`.
 */
export async function createLinkPreviewPostAs(
  email: string,
  tenantSlug: string,
  caption: string,
  preview: { url: string; provider: 'youtube' | 'vimeo'; title: string },
): Promise<string> {
  const urlHash = createHash('sha256').update(new URL(preview.url).toString()).digest('hex');
  const rows = await sql()<{ id: string }[]>`
    with t as (select id from public.tenants where slug = ${tenantSlug}),
    lp as (
      insert into public.feed_link_previews
        (tenant_id, url_hash, url, status, title, site_name, provider, fetched_at)
      select t.id, ${urlHash}, ${preview.url}, 'resolved', ${preview.title},
             ${preview.provider === 'youtube' ? 'YouTube' : 'Vimeo'}, ${preview.provider}, now()
        from t
      returning id, tenant_id
    )
    insert into public.feed_posts (tenant_id, author_user_id, caption, link_preview_id)
    select lp.tenant_id, u.id, ${caption}, lp.id
      from lp, public.users u
     where u.email = ${email}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not create a link-preview post for ${email} in ${tenantSlug}`);
  return id;
}

/** Removes every post whose caption starts with `prefix` AND the link previews they carried. */
export async function deleteLinkPreviewPosts(prefix: string): Promise<void> {
  const removed = await sql()<{ link_preview_id: string | null }[]>`
    delete from public.feed_posts where caption like ${`${prefix}%`} returning link_preview_id`;
  const previewIds = removed.map((row) => row.link_preview_id).filter((id) => id !== null);
  if (previewIds.length > 0) {
    await sql()`delete from public.feed_link_previews where id = any(${previewIds}::uuid[])`;
  }
}

/**
 * 08-08: one id of each surface the enforced-CSP walk visits in a tenant: a community, the soonest
 * live event, and a member-visible story (not removed, unexpired, asset ready; null when another
 * spec removed them all, see `activeReadyStoryCount`).
 */
export async function cspWalkFixtureIds(
  tenantSlug: string,
): Promise<{ communityId: string; eventId: string; storyId: string | null }> {
  const rows = await sql()<{ community_id: string; event_id: string; story_id: string | null }[]>`
    select
      (select c.id from public.communities c
        where c.tenant_id = t.id and c.deleted_at is null
        order by c.created_at limit 1) as community_id,
      (select e.id from public.events e
        where e.tenant_id = t.id and e.deleted_at is null
        order by e.starts_at limit 1) as event_id,
      (select s.id from public.stories s
         join public.media_assets a on a.id = s.media_asset_id
        where s.tenant_id = t.id and s.deleted_at is null and s.expires_at > now()
          and a.status = 'ready'
        order by s.published_at desc limit 1) as story_id
      from public.tenants t
     where t.slug = ${tenantSlug}`;
  const row = rows[0];
  if (!row?.community_id || !row.event_id) {
    throw new Error(`csp walk fixtures missing in ${tenantSlug}`);
  }
  return { communityId: row.community_id, eventId: row.event_id, storyId: row.story_id };
}
