import postgres from 'postgres';

/**
 * Fixtures for the Loja e2e specs (08.2-07), the `feed-admin.ts` / `events-admin.ts` shape: rows
 * written through a direct superuser connection, so a spec can stand up a catalogue (a product, its
 * community links, a member's entitlement) in one statement each, without driving the admin form or
 * the purchase dialog that later plans build.
 *
 * The store's ledgers are written only through SECURITY DEFINER functions in the app, which is a
 * property of the API lanes; this superuser connection is the test harness, not a lane. A grant is
 * written exactly as `app.store_grant` writes it (source `grant`, no order, granted by the tenant's
 * admin), so every read the screens make sees the same shape a real grant has.
 *
 * Every row a spec writes carries its run prefix in the product name, and `deleteProductsByPrefix`
 * removes entitlements, orders and products (links cascade) in that order, since the ledgers
 * reference users and products without a cascade.
 */

let client: ReturnType<typeof postgres> | null = null;
function sql() {
  client ??= postgres(
    process.env.PLAYWRIGHT_DB_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
    { prepare: false, max: 4 },
  );
  return client;
}

/** Release the fixture connection (call from `test.afterAll` so Playwright can exit). */
export async function closeStoreAdmin(): Promise<void> {
  await client?.end();
  client = null;
}

/** The id of the tenant's first live `admin_tenant` (the seeded admin on the seed tenants). */
async function tenantAdminUserId(
  tenantSlug: string,
): Promise<{ tenantId: string; userId: string }> {
  const rows = await sql()<{ tenant_id: string; user_id: string }[]>`
    select m.tenant_id::text as tenant_id, m.user_id::text as user_id
      from public.memberships m
      join public.tenants t on t.id = m.tenant_id
     where t.slug = ${tenantSlug} and m.role = 'admin_tenant' and m.deleted_at is null
     order by m.joined_at asc
     limit 1`;
  const row = rows[0];
  if (!row) throw new Error(`no admin_tenant in ${tenantSlug}`);
  return { tenantId: row.tenant_id, userId: row.user_id };
}

export type ProductFixture = {
  tenantSlug: string;
  name: string;
  priceCents: number;
  description?: string;
  status?: 'active' | 'archived';
  communityIds?: readonly string[];
  imageAssetId?: string | null;
  /** Back-dates `created_at`, so the newest-first order of a spec's products is deterministic. */
  minutesAgo?: number;
};

/** A product (and its community links) in `tenantSlug`, created by the tenant's admin. Returns its id. */
export async function createProduct(fields: ProductFixture): Promise<string> {
  const { tenantId, userId } = await tenantAdminUserId(fields.tenantSlug);
  const stamp = new Date(Date.now() - (fields.minutesAgo ?? 0) * 60_000).toISOString();
  return sql().begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      insert into public.store_products
        (tenant_id, created_by_user_id, name, description, image_asset_id, price_cents, status,
         created_at, updated_at)
      values
        (${tenantId}::uuid, ${userId}::uuid, ${fields.name}, ${fields.description ?? ''},
         ${fields.imageAssetId ?? null}::uuid, ${fields.priceCents}, ${fields.status ?? 'active'},
         ${stamp}::timestamptz, ${stamp}::timestamptz)
      returning id::text as id`;
    const id = rows[0]?.id;
    if (!id) throw new Error(`could not create product "${fields.name}"`);
    for (const communityId of fields.communityIds ?? []) {
      await tx`
        insert into public.store_product_communities (tenant_id, product_id, community_id)
        values (${tenantId}::uuid, ${id}::uuid, ${communityId}::uuid)`;
    }
    return id;
  });
}

/** Archives or reactivates a product directly (what the manager's control does through the API). */
export async function setProductStatus(
  productId: string,
  status: 'active' | 'archived',
): Promise<void> {
  await sql()`
    update public.store_products set status = ${status}, updated_at = now()
     where id = ${productId}::uuid`;
}

/** The product's current status, for asserting a write the UI made. */
export async function productStatus(productId: string): Promise<string | null> {
  const rows = await sql()<{ status: string }[]>`
    select status from public.store_products where id = ${productId}::uuid`;
  return rows[0]?.status ?? null;
}

/** Changes a product's price directly (an admin's edit landing while a member has the page open). */
export async function setProductPrice(productId: string, priceCents: number): Promise<void> {
  await sql()`
    update public.store_products set price_cents = ${priceCents}, updated_at = now()
     where id = ${productId}::uuid`;
}

/**
 * The orders of `productId` for the user `email`, oldest first: what a purchase through the dialog
 * wrote (status, the amount copied from the product row, the provider). 08.2-08.
 */
export async function ordersFor(
  productId: string,
  email: string,
): Promise<{ status: string; amountCents: number; provider: string }[]> {
  return sql()<{ status: string; amountCents: number; provider: string }[]>`
    select o.status, o.amount_cents as "amountCents", o.provider
      from public.store_orders o
      join public.users u on u.id = o.user_id
     where o.product_id = ${productId}::uuid and u.email = ${email}
     order by o.created_at asc`;
}

/**
 * An ACTIVE `grant` entitlement of `productId` to the user `email`, granted by the product tenant's
 * admin: the row `app.store_grant` writes. Returns the entitlement id.
 */
export async function grantEntitlement(email: string, productId: string): Promise<string> {
  const rows = await sql()<{ id: string }[]>`
    insert into public.store_entitlements
      (tenant_id, user_id, product_id, source, granted_by_user_id, status)
    select p.tenant_id, u.id, p.id, 'grant',
           (select m.user_id from public.memberships m
             where m.tenant_id = p.tenant_id and m.role = 'admin_tenant' and m.deleted_at is null
             order by m.joined_at asc limit 1),
           'active'
      from public.store_products p, public.users u
     where p.id = ${productId}::uuid and u.email = ${email}
    returning id::text as id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not grant ${productId} to ${email}`);
  return id;
}

/** Removes every product whose name starts with `prefix`, its ledgers first (links cascade). */
export async function deleteProductsByPrefix(prefix: string): Promise<void> {
  const like = `${prefix}%`;
  await sql().begin(async (tx) => {
    await tx`
      delete from public.store_entitlements
       where product_id in (select id from public.store_products where name like ${like})`;
    await tx`
      delete from public.store_orders
       where product_id in (select id from public.store_products where name like ${like})`;
    await tx`delete from public.store_products where name like ${like}`;
  });
}

/** Removes every community whose name starts with `prefix` (call after the products that link it). */
export async function deleteCommunitiesByPrefix(prefix: string): Promise<void> {
  await sql()`delete from public.communities where name like ${`${prefix}%`}`;
}

/** Revokes an entitlement directly (what `app.store_revoke` does for a grant). 08.2-09. */
export async function revokeEntitlement(entitlementId: string): Promise<void> {
  await sql()`
    update public.store_entitlements set status = 'revoked'
     where id = ${entitlementId}::uuid`;
}

/**
 * 08.2-09: a post inside `communityId`, written by `email`, back-dated `minutesAgo` so the newest
 * post (the locked page's sample) is deterministic. `kind` picks the media: `text` (none), `image`
 * (one ready gallery image) or `pdf` (one ready file attachment). The hidden posts of the locked
 * community spec carry media so the spec can prove their asset ids never reach the page. Returns
 * the post id and the asset id (null for `text`). Removed by `deleteReelsFixtures(prefix)` (the
 * caption carries the run prefix; assets go with their posts).
 */
export async function createCommunityPostAs(
  email: string,
  tenantSlug: string,
  caption: string,
  options: { communityId: string; kind?: 'text' | 'image' | 'pdf'; minutesAgo?: number },
): Promise<{ postId: string; assetId: string | null }> {
  const kind = options.kind ?? 'text';
  const createdAt = new Date(Date.now() - (options.minutesAgo ?? 0) * 60_000).toISOString();
  return sql().begin(async (tx) => {
    const who = await tx<{ tenant_id: string; user_id: string }[]>`
      select t.id::text as tenant_id, u.id::text as user_id
        from public.tenants t, public.users u
       where t.slug = ${tenantSlug} and u.email = ${email}`;
    const row = who[0];
    if (!row) throw new Error(`no ${email} in ${tenantSlug}`);

    const mediaKind = kind === 'image' ? 'gallery' : 'none';
    const posts = await tx<{ id: string }[]>`
      insert into public.feed_posts
        (tenant_id, author_user_id, community_id, caption, media_kind, created_at)
      values (${row.tenant_id}::uuid, ${row.user_id}::uuid, ${options.communityId}::uuid,
              ${caption}, ${mediaKind}, ${createdAt}::timestamptz)
      returning id::text as id`;
    const postId = posts[0]?.id;
    if (!postId) throw new Error(`could not create a post for ${email} in ${tenantSlug}`);
    if (kind === 'text') return { postId, assetId: null };

    const assets =
      kind === 'image'
        ? await tx<{ id: string }[]>`
            insert into public.media_assets
              (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width,
               height, variant_widths, filename, created_at, ready_at)
            values (${row.tenant_id}::uuid, ${row.user_id}::uuid, 'image', 'post', 'ready',
                    'supabase', 'image/webp', 2048, 1200, 800, array[320, 640],
                    'locked-image.webp', ${createdAt}::timestamptz, ${createdAt}::timestamptz)
            returning id::text as id`
        : await tx<{ id: string }[]>`
            insert into public.media_assets
              (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, filename,
               created_at, ready_at)
            values (${row.tenant_id}::uuid, ${row.user_id}::uuid, 'file', 'attachment', 'ready',
                    'supabase', 'application/pdf', 4096, 'locked-material.pdf',
                    ${createdAt}::timestamptz, ${createdAt}::timestamptz)
            returning id::text as id`;
    const assetId = assets[0]?.id;
    if (!assetId) throw new Error(`could not create a ${kind} asset for ${caption}`);
    await tx`
      insert into public.feed_post_media
        (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
      values (${row.tenant_id}::uuid, ${postId}::uuid, ${mediaKind}, ${assetId}::uuid,
              ${kind === 'image' ? 'image' : 'file'}, 0)`;
    return { postId, assetId };
  });
}
