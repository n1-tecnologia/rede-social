import postgres from 'postgres';

/**
 * Fixtures for the Rede social specs (09-08): the writes `social.spec.ts` needs that the other admin
 * helpers do not offer. Its own superuser connection, the `feed-admin.ts` posture; fixtures only,
 * never used by application code. The posts themselves are created with `createFeedPostAs` and
 * `createVideoPostAs` (`./admin`), then stamped here as MEMBER posts, because those helpers insert
 * the organization's default audience (`tenant`).
 */

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 2 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeSocialAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

/**
 * Stamps a post as a MEMBER post (`visibility = 'followers'`, D-473). The shape check
 * (`feed_posts_visibility_shape_chk`) refuses a community post, so a fixture that needs this must be
 * tenant-wide; the superuser connection skips the restrictive insert policy the API enforces.
 */
export async function markAsMemberPost(postId: string): Promise<void> {
  const rows = await sql()`
    update public.feed_posts set visibility = 'followers' where id = ${postId}::uuid returning id`;
  if (rows.length === 0) throw new Error(`no post ${postId} to stamp as a member post`);
}

/** `follower` follows `followee` in `tenantSlug` (the `social_follows` row; idempotent). */
export async function followMember(
  followerEmail: string,
  followeeEmail: string,
  tenantSlug: string,
): Promise<void> {
  await sql()`
    insert into public.social_follows (tenant_id, follower_user_id, followee_user_id)
    select t.id, a.id, b.id
      from public.tenants t, public.users a, public.users b
     where t.slug = ${tenantSlug} and a.email = ${followerEmail} and b.email = ${followeeEmail}
    on conflict (tenant_id, follower_user_id, followee_user_id) do nothing`;
}

/** Removes every follow edge that starts or ends at an e-mail beginning with `prefix`. */
export async function deleteFollowsOfPrefix(prefix: string): Promise<void> {
  const like = `${prefix}%`;
  await sql()`
    delete from public.social_follows f
     using public.users u
     where u.id in (f.follower_user_id, f.followee_user_id) and u.email like ${like}`;
}

/**
 * A MEMBER photo post written directly (a gallery with one `ready` image asset and its
 * `feed_post_media` row, `visibility = 'followers'`), in ONE transaction so a spec never observes a
 * gallery post without its media. The asset names derived variants that were never uploaded: the
 * card renders its image frame and the browser's request for the file fails, which is the shipped
 * "degrades to the neutral box" path (this fixture proves the card's SHAPE, not the Storage object).
 * Returns the post id; `deleteReelsFixtures` removes it by caption prefix.
 */
export async function createMemberPhotoPostAs(
  email: string,
  tenantSlug: string,
  caption: string,
): Promise<string> {
  return sql().begin(async (tx) => {
    const assets = await tx<{ id: string; tenant_id: string; owner_user_id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width, height,
         variant_widths, filename, ready_at)
      select t.id, u.id, 'image', 'post', 'ready', 'supabase', 'image/jpeg', 204800, 1200, 800,
             array[320, 640], 'foto.jpg', now()
        from public.tenants t, public.users u
       where t.slug = ${tenantSlug} and u.email = ${email}
      returning id, tenant_id, owner_user_id`;
    const asset = assets[0];
    if (!asset) throw new Error(`could not create an image asset for ${email} in ${tenantSlug}`);

    const posts = await tx<{ id: string }[]>`
      insert into public.feed_posts
        (tenant_id, author_user_id, caption, media_kind, visibility)
      values (${asset.tenant_id}::uuid, ${asset.owner_user_id}::uuid, ${caption}, 'gallery',
              'followers')
      returning id`;
    const post = posts[0];
    if (!post) throw new Error(`could not create a photo post for ${email} in ${tenantSlug}`);

    await tx`
      insert into public.feed_post_media
        (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
      values (${asset.tenant_id}::uuid, ${post.id}::uuid, 'gallery', ${asset.id}::uuid, 'image', 0)`;
    return post.id;
  });
}

/**
 * The stored audience of the post with this exact caption (`'tenant'`, `'followers'`, ...), or
 * `null` when there is none: how a spec proves the API stamped a member's post as `followers`
 * (D-473) rather than trusting what the screen shows. Several matches would be a fixture leak, so
 * the newest one answers.
 */
export async function visibilityOfPostWithCaption(caption: string): Promise<string | null> {
  const rows = await sql()<{ visibility: string }[]>`
    select visibility from public.feed_posts
     where caption = ${caption} and deleted_at is null
     order by created_at desc limit 1`;
  return rows[0]?.visibility ?? null;
}

/**
 * Writes the `social` module's settings blob for one tenant (the row must exist: call
 * `setTenantModuleFlag(slug, 'social', true)` first). The API caches a tenant's module flags for
 * 30 s per instance, so a spec writes this BEFORE the first request of a throwaway tenant, or waits
 * out the TTL when it deliberately changes the limits under an open tab.
 */
export async function setSocialSettings(
  slug: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const rows = await sql()`
    update public.tenant_modules tm set settings = ${sql().json(settings as never)}
      from public.tenants t
     where t.id = tm.tenant_id and t.slug = ${slug} and tm.module_key = 'social'
     returning tm.tenant_id`;
  if (rows.length === 0) throw new Error(`no social module row for ${slug}`);
}

/**
 * Marks a video asset as refused for its duration, the way the ready job records it (`status =
 * 'rejected'`, `failure_reason = 'duration_too_long'`): what the composer's readiness poll then
 * reads as the member's "O vídeo passou de {seconds} s" state (UI-D-504 g).
 */
export async function markVideoTooLong(assetId: string): Promise<void> {
  await sql()`
    update public.media_assets
       set status = 'rejected', failure_reason = 'duration_too_long'
     where id = ${assetId}::uuid`;
}

/**
 * Removes every media asset of a throwaway tenant (the composer cases upload a real video that never
 * becomes part of a post, e.g. the one refused for its duration). `media_assets.tenant_id` has no
 * cascade, so the tenant cannot be deleted while one remains. Call it AFTER the posts that name the
 * assets are gone (`deleteReelsFixtures`).
 */
export async function deleteMediaAssetsOfTenant(slug: string): Promise<void> {
  await sql()`
    delete from public.media_assets a
     using public.tenants t
     where a.tenant_id = t.id and t.slug = ${slug}`;
}
