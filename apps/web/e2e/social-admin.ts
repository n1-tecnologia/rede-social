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
