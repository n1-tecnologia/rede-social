import postgres from 'postgres';
import { envValue } from './admin';
import { hosts, SEED_PASSWORD, seededFeedMedia } from './fixtures';

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

// ── 08.2-10: the product form's fixtures ──────────────────────────────────────────────────────

/** The newest product named exactly `name` (what the form just created), or null. */
export async function productByName(
  name: string,
): Promise<{ id: string; priceCents: number; imageAssetId: string | null; status: string } | null> {
  const rows = await sql()<
    { id: string; price_cents: number; image_asset_id: string | null; status: string }[]
  >`
    select id::text as id, price_cents, image_asset_id::text as image_asset_id, status
      from public.store_products
     where name = ${name}
     order by created_at desc
     limit 1`;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        priceCents: row.price_cents,
        imageAssetId: row.image_asset_id,
        status: row.status,
      }
    : null;
}

/** The community ids a product links, sorted (a SET; the order is not the contract). */
export async function productLinkIds(productId: string): Promise<string[]> {
  const rows = await sql()<{ community_id: string }[]>`
    select community_id::text as community_id from public.store_product_communities
     where product_id = ${productId}::uuid
     order by community_id`;
  return rows.map((row) => row.community_id);
}

/**
 * Waits until a `cover` image uploaded in `tenantSlug` since `since` is `ready` (the worker derived
 * it): the API refuses a product image that is not a ready cover (`image_invalid`), the 05-09 tuple
 * rule the community and event forms share. Returns its id.
 */
export async function waitForReadyCoverIn(
  tenantSlug: string,
  since: Date,
  timeoutMs = 120_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen = '(no rows at all)';
  while (Date.now() < deadline) {
    const rows = await sql()<{ id: string; status: string }[]>`
      select a.id::text as id, a.status from public.media_assets a
        join public.tenants t on t.id = a.tenant_id
       where t.slug = ${tenantSlug}
         and a.kind = 'image' and a.purpose = 'cover'
         and a.created_at >= ${since.toISOString()}::timestamptz
       order by a.created_at desc`;
    seen = rows.map((row) => row.status).join(', ') || '(no rows at all)';
    const ready = rows.find((row) => row.status === 'ready');
    if (ready) return ready.id;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no ready cover in ${tenantSlug} within ${timeoutMs} ms; statuses: ${seen}`);
}

/** The API the Playwright config starts (or reuses) as a webServer. */
const API_URL = process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:8787';

/** A password sign-in through Supabase Auth: the access token the API verifies. */
async function accessTokenFor(email: string, password = SEED_PASSWORD): Promise<string> {
  const session = await fetch(`${envValue('SUPABASE_URL')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: envValue('SUPABASE_PUBLISHABLE_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!session.ok) throw new Error(`${email} sign-in failed: ${session.status}`);
  return ((await session.json()) as { access_token: string }).access_token;
}

/**
 * `POST /v1/store/products/lock-preview` through the REAL API as `email` on the demo host: the
 * numbers the product form's danger dialog must show (D-364). Read-only.
 */
export async function lockPreviewAs(
  email: string,
  body: { productId?: string; communityIds: string[] },
): Promise<{ communityId: string; membersLosingAccess: number }[]> {
  const token = await accessTokenFor(email);
  const res = await fetch(`${API_URL}/v1/store/products/lock-preview`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': new URL(hosts.demo).hostname,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`lock-preview as ${email}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { items: { communityId: string; membersLosingAccess: number }[] })
    .items;
}

// ── 08.2-11: the Compradores fixtures ─────────────────────────────────────────────────────────

/**
 * A REAL purchase as `email` on the demo host, through `POST /v1/store/products/{id}/purchase` (the
 * definer writes the paid order and the `purchase` entitlement, exactly as the dialog does), so the
 * buyers list shows a genuine purchase row. `expectedAmountCents` is the price the buyer saw.
 */
export async function purchaseAs(
  email: string,
  password: string,
  productId: string,
  expectedAmountCents: number,
): Promise<void> {
  const token = await accessTokenFor(email, password);
  const res = await fetch(`${API_URL}/v1/store/products/${productId}/purchase`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-host': new URL(hosts.demo).hostname,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expectedAmountCents }),
  });
  if (!res.ok) throw new Error(`purchase as ${email}: ${res.status} ${await res.text()}`);
}

// ── 08.2-12: the backstop fixtures ────────────────────────────────────────────────────────────

/** Media-bucket object keys written by `copySeededMedia` this run, removed by `deleteCopiedMedia`. */
const copiedKeys: string[] = [];

function serviceHeaders(): Record<string, string> {
  const key = envValue('SUPABASE_SERVICE_KEY');
  return { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
}

/**
 * Copies the Storage objects of a SEEDED media asset (its `original` and every `w<width>.webp`
 * rung its row claims) to the keys of a NEW asset id, through the Storage REST copy. The new asset
 * then serves real bytes under its own id, so a backstop proves the sample's OWN media opens, not a
 * seeded post's (which every member may read anyway).
 */
async function copySeededMedia(
  tenantId: string,
  sourceId: string,
  targetId: string,
  widths: readonly number[],
): Promise<void> {
  const names = ['original', ...widths.map((width) => `w${width}.webp`)];
  for (const name of names) {
    const destinationKey = `${tenantId}/media/${targetId}/${name}`;
    const res = await fetch(`${envValue('SUPABASE_URL')}/storage/v1/object/copy`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({
        bucketId: 'media',
        sourceKey: `${tenantId}/media/${sourceId}/${name}`,
        destinationKey,
      }),
    });
    if (!res.ok) throw new Error(`storage copy of ${name} failed: ${res.status}`);
    copiedKeys.push(destinationKey);
  }
}

/** Removes the Storage objects `copySeededMedia` wrote (the rows go with `deleteReelsFixtures`). */
export async function deleteCopiedMedia(): Promise<void> {
  if (copiedKeys.length === 0) return;
  const prefixes = copiedKeys.splice(0);
  await fetch(`${envValue('SUPABASE_URL')}/storage/v1/object/media`, {
    method: 'DELETE',
    headers: serviceHeaders(),
    body: JSON.stringify({ prefixes }),
  });
}

export type LockedMediaCommunity = {
  communityId: string;
  productId: string;
  /** The newest post's caption: the locked page's read-only sample. */
  sampleCaption: string;
  /** The older post's caption: hidden from a non-holder. */
  hiddenCaption: string;
  /** The PDF attached to the sample, as the row names it. */
  attachmentFilename: string;
  /** The sample's video asset (`sample: 'video'`) or gallery images (`sample: 'gallery'`). */
  videoAssetId: string | null;
  imageAssetIds: string[];
};

/**
 * 08.2-12 (E08 media): a community gated by one active product whose NEWEST post (the locked
 * page's sample) carries real media and a real PDF, plus one older text post a non-holder never
 * sees. A post holds a video OR a gallery (`feed_post_media_kind_chk`), never both, so `sample`
 * picks the band: `video` (a ready `fake`-provider video, the shape every local run plays) or
 * `gallery` (two images copied from the seeded gallery, so the strip is a real carousel); the PDF
 * (copied from the seeded attachment) rides either. Every name and caption starts with `name`, so
 * `deleteProductsByPrefix` + `deleteReelsFixtures` + `deleteCopiedMedia` remove it all.
 */
export async function createLockedCommunityWithMedia(options: {
  tenantSlug: string;
  authorEmail: string;
  name: string;
  sample: 'video' | 'gallery';
  priceCents: number;
}): Promise<LockedMediaCommunity> {
  const { tenantSlug, authorEmail, name, sample } = options;
  const who = await sql()<{ tenant_id: string; user_id: string }[]>`
    select t.id::text as tenant_id, u.id::text as user_id
      from public.tenants t, public.users u
     where t.slug = ${tenantSlug} and u.email = ${authorEmail}`;
  const row = who[0];
  if (!row) throw new Error(`no ${authorEmail} in ${tenantSlug}`);
  const { tenant_id: tenantId, user_id: userId } = row;

  // The seeded gallery images and PDF of this tenant (scripts/seed.ts writes real objects).
  const seeded = await sql()<
    {
      id: string;
      kind: string;
      width: number | null;
      height: number | null;
      variant_widths: number[];
      mime: string;
      bytes: number | null;
      filename: string | null;
    }[]
  >`
    select a.id::text as id, a.kind, a.width, a.height, a.variant_widths, a.mime, a.bytes,
           a.filename
      from public.feed_post_media m
      join public.feed_posts p on p.id = m.post_id
      join public.media_assets a on a.id = m.media_asset_id
     where p.tenant_id = ${tenantId}::uuid
       and p.caption in (${seededFeedMedia.galleryCaption}, ${seededFeedMedia.attachmentCaption})
     order by a.kind, m.position`;
  const seededImages = seeded.filter((asset) => asset.kind === 'image').slice(0, 2);
  const seededPdf = seeded.find((asset) => asset.kind === 'file');
  if (seededImages.length < 2 || !seededPdf) throw new Error('the seeded feed media is missing');

  const created = new Date(Date.now() - 30 * 60_000).toISOString();
  const older = new Date(Date.now() - 9 * 60_000).toISOString();
  const newest = new Date(Date.now() - 5 * 60_000).toISOString();
  const slug = `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)}-${Math.random().toString(36).slice(2, 8)}`;
  const sampleCaption = `${name} amostra`;
  const hiddenCaption = `${name} oculto`;

  const result = await sql().begin(async (tx) => {
    const communities = await tx<{ id: string }[]>`
      insert into public.communities
        (tenant_id, created_by_user_id, name, slug, status, last_activity_at, created_at)
      values (${tenantId}::uuid, ${userId}::uuid, ${name}, ${slug}, 'active',
              ${created}::timestamptz, ${created}::timestamptz)
      returning id::text as id`;
    const communityId = communities[0]?.id;
    if (!communityId) throw new Error(`could not create community ${name}`);

    await tx`
      insert into public.feed_posts
        (tenant_id, author_user_id, community_id, caption, media_kind, created_at)
      values (${tenantId}::uuid, ${userId}::uuid, ${communityId}::uuid, ${hiddenCaption}, 'none',
              ${older}::timestamptz)`;

    const mediaKind = sample === 'video' ? 'video' : 'gallery';
    const posts = await tx<{ id: string }[]>`
      insert into public.feed_posts
        (tenant_id, author_user_id, community_id, caption, media_kind, created_at)
      values (${tenantId}::uuid, ${userId}::uuid, ${communityId}::uuid, ${sampleCaption},
              ${mediaKind}, ${newest}::timestamptz)
      returning id::text as id`;
    const postId = posts[0]?.id;
    if (!postId) throw new Error(`could not create the sample of ${name}`);

    let videoAssetId: string | null = null;
    const imageAssetIds: string[] = [];
    if (sample === 'video') {
      const token = Math.random().toString(36).slice(2);
      const videos = await tx<{ id: string }[]>`
        insert into public.media_assets
          (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id,
           playback_id, mime, bytes, duration_seconds, aspect_ratio, width, height, filename,
           created_at, ready_at)
        values (${tenantId}::uuid, ${userId}::uuid, 'video', 'post', 'ready', 'fake',
                ${`fake-e2e-backstop-${token}`}, ${`fake-playback-backstop-${token}`},
                'video/mp4', 1048576, 12, '16:9', 1920, 1080, 'amostra.mp4',
                ${newest}::timestamptz, ${newest}::timestamptz)
        returning id::text as id`;
      videoAssetId = videos[0]?.id ?? null;
      if (!videoAssetId) throw new Error(`could not create the sample video of ${name}`);
      await tx`
        insert into public.feed_post_media
          (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
        values (${tenantId}::uuid, ${postId}::uuid, 'video', ${videoAssetId}::uuid, 'video', 0)`;
    } else {
      for (const [position, image] of seededImages.entries()) {
        const images = await tx<{ id: string }[]>`
          insert into public.media_assets
            (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width,
             height, variant_widths, filename, created_at, ready_at)
          values (${tenantId}::uuid, ${userId}::uuid, 'image', 'post', 'ready', 'supabase',
                  ${image.mime}, ${image.bytes}, ${image.width}, ${image.height},
                  ${image.variant_widths}, 'amostra.webp', ${newest}::timestamptz,
                  ${newest}::timestamptz)
          returning id::text as id`;
        const id = images[0]?.id;
        if (!id) throw new Error(`could not create a sample image of ${name}`);
        imageAssetIds.push(id);
        await tx`
          insert into public.feed_post_media
            (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
          values (${tenantId}::uuid, ${postId}::uuid, 'gallery', ${id}::uuid, 'image',
                  ${position})`;
      }
    }

    const files = await tx<{ id: string }[]>`
      insert into public.media_assets
        (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, variant_widths,
         filename, created_at, ready_at)
      values (${tenantId}::uuid, ${userId}::uuid, 'file', 'attachment', 'ready', 'supabase',
              'application/pdf', ${seededPdf.bytes}, '{}', 'material-exclusivo.pdf',
              ${newest}::timestamptz, ${newest}::timestamptz)
      returning id::text as id`;
    const pdfId = files[0]?.id;
    if (!pdfId) throw new Error(`could not create the sample PDF of ${name}`);
    await tx`
      insert into public.feed_post_media
        (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
      values (${tenantId}::uuid, ${postId}::uuid, ${mediaKind}, ${pdfId}::uuid, 'file', 0)`;

    return { communityId, videoAssetId, imageAssetIds, pdfId };
  });

  // The bytes, outside the transaction: Storage is not Postgres.
  for (const [index, image] of seededImages.entries()) {
    const target = result.imageAssetIds[index];
    if (target) await copySeededMedia(tenantId, image.id, target, image.variant_widths);
  }
  await copySeededMedia(tenantId, seededPdf.id, result.pdfId, []);

  const productId = await createProduct({
    tenantSlug,
    name: `${name} Produto`,
    priceCents: options.priceCents,
    communityIds: [result.communityId],
  });

  return {
    communityId: result.communityId,
    productId,
    sampleCaption,
    hiddenCaption,
    attachmentFilename: 'material-exclusivo.pdf',
    videoAssetId: result.videoAssetId,
    imageAssetIds: result.imageAssetIds,
  };
}

/** The entitlements of `productId` held by `email`, oldest first: source and status. */
export async function entitlementsFor(
  productId: string,
  email: string,
): Promise<{ source: string; status: string }[]> {
  return sql()<{ source: string; status: string }[]>`
    select e.source, e.status
      from public.store_entitlements e
      join public.users u on u.id = e.user_id
     where e.product_id = ${productId}::uuid and u.email = ${email}
     order by e.created_at asc`;
}
