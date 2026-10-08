import { LOCKED_COMMUNITY_IDS } from '@rede-social/core/db/community-gate';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { decodeCursor, encodeCursor } from '@rede-social/core/server/paging';
import { sql } from 'drizzle-orm';
import type {
  BuyersPage,
  BuyersQuery,
  CommunityAccess,
  CommunityAccessList,
  EntitlementSource,
  GrantBody,
  GrantOutcome,
  GrantResult,
  LockPreview,
  LockPreviewBody,
  ProductCard,
  ProductCommunity,
  ProductDetail,
  ProductInput,
  ProductListQuery,
  ProductPage,
  ProductPatch,
  ProductStatus,
  PurchaseBody,
  PurchaseResult,
  RevokeResult,
} from '../contracts/index';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-store');

/**
 * The store's service. 08.2-01: `createProduct` (admin, behind `store.product.manage`) and
 * `purchaseProduct` (every role). 08.2-05: the catalogue reads (`listProducts`, `getProduct`), the
 * community access reads (`listCommunityAccess`, `getCommunityAccess`) and the admin writes
 * (`updateProduct`, `setProductStatus`, `lockPreview`). 08.2-06: the holders read (`listBuyers`) and
 * the admin's escape hatches (`grantAccess`, `revokeAccess`). Log lines carry ids,
 * counts and outcomes only, never a product name, a description or a price an admin typed (the
 * T-05-06 rule).
 *
 * The store reads `public.communities` by SQL inside its own statements (id, name, cover, status,
 * position): it imports nothing from the communities package (MOD-02), the feed and stories
 * precedent. A caller's "may manage" answer (`canManage`) is computed by the ROUTE from the same
 * resolver `requirePermission` uses, before the tenant transaction opens (one connection per
 * request), and the service trusts it.
 */

type CoverAssetRow = { kind: string; purpose: string; status: string };

type ProductRow = {
  id: string;
  name: string;
  description: string;
  price_cents: number;
  currency: string;
  image_asset_id: string | null;
  status: string;
};

type CommunityRow = { id: string; name: string; cover_asset_id: string | null };

/** Every outcome `app.store_purchase` can return (its migration header is the vocabulary). */
type PurchaseOutcome = 'purchased' | 'owned' | 'unavailable' | 'price_changed' | 'not_found';
type PurchaseRow = { outcome: PurchaseOutcome; order_id: string | null };

/** The two state refusals, answered `409 CONFLICT { store: … }`. */
const PURCHASE_REFUSALS: Partial<Record<PurchaseOutcome, 'unavailable' | 'price_changed'>> = {
  unavailable: 'unavailable',
  price_changed: 'price_changed',
};

/** A Postgres `uuid[]` literal from ids the contract already proved are uuids. */
const uuidArray = (ids: readonly string[]) => `{${ids.join(',')}}`;

/**
 * The two input validators below are SHARED by every product write (`createProduct` and, since
 * 08.2-05, `updateProduct`), so a create and an edit accept and refuse exactly the same image and
 * the same communities (T-08.2-25, T-08.2-26).
 *
 * The product image, resolved INSIDE the writing transaction (the communities/events cover rule):
 * no row of THIS tenant (unknown, another tenant's, removed) is ONE bare 404; a row of this tenant
 * that is not a ready `cover` image is `400 { store: 'image_invalid' }`. A null id performs no
 * lookup: "no image" is a first-class value (D-69).
 */
async function resolveImageAsset(
  tx: Tx,
  ctx: RequestContext,
  imageAssetId: string | null,
): Promise<void> {
  if (imageAssetId === null) return;
  const rows = await tx.execute<CoverAssetRow>(sql`
    select kind, purpose, status
      from media_assets
     where id = ${imageAssetId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       and deleted_at is null
     limit 1`);
  const asset = rows[0];
  if (!asset) throw new ApiError(404, 'NOT_FOUND');
  if (!(asset.purpose === 'cover' && asset.kind === 'image' && asset.status === 'ready')) {
    throw new ApiError(400, 'VALIDATION_FAILED', { store: 'image_invalid' });
  }
}

/**
 * Every linked community must be an ACTIVE, live community of THIS tenant (T-08.2-16), read under
 * RLS in the caller's lane. Any miss (unknown, archived, removed, another tenant's) is ONE
 * `400 { store: 'community_invalid' }`, so the answer never tells a foreign id from an unknown one.
 */
async function resolveCommunities(
  tx: Tx,
  ctx: RequestContext,
  communityIds: readonly string[],
): Promise<void> {
  if (communityIds.length === 0) return;
  const rows = await tx.execute<{ found: number }>(sql`
    select count(*)::int as found
      from communities c
     where c.tenant_id = ${ctx.tenantId}::uuid
       and c.id = any (${uuidArray(communityIds)}::uuid[])
       and c.status = 'active'
       and c.deleted_at is null`);
  if ((rows[0]?.found ?? 0) !== communityIds.length) {
    throw new ApiError(400, 'VALIDATION_FAILED', { store: 'community_invalid' });
  }
}

/** A product's ACTIVE, live linked communities, in the Comunidades list order. */
async function linkedCommunities(
  tx: Tx,
  ctx: RequestContext,
  productId: string,
): Promise<ProductCommunity[]> {
  const rows = await tx.execute<CommunityRow>(sql`
    select c.id, c.name, c.cover_asset_id
      from store_product_communities l
      join communities c on c.id = l.community_id and c.tenant_id = l.tenant_id
     where l.tenant_id = ${ctx.tenantId}::uuid
       and l.product_id = ${productId}::uuid
       and c.status = 'active'
       and c.deleted_at is null
     order by c.position asc, c.last_activity_at desc, c.id desc`);
  return rows.map((row) => ({ id: row.id, name: row.name, coverAssetId: row.cover_asset_id }));
}

/**
 * `POST /v1/store/products` (STORE-11, STORE-13): the product and its community links in ONE
 * transaction. Linking a community locks it at once for every member without access (the gate reads
 * the links live); plan 10 adds the "who loses access" preview before that write.
 */
export async function createProduct(
  ctx: RequestContext,
  input: ProductInput,
): Promise<ProductDetail> {
  const detail = await withTenantTx(ctx, async (tx) => {
    await resolveImageAsset(tx, ctx, input.imageAssetId);
    await resolveCommunities(tx, ctx, input.communityIds);

    const inserted = await tx.execute<ProductRow>(sql`
      insert into store_products
             (tenant_id, created_by_user_id, name, description, image_asset_id, price_cents)
      values (${ctx.tenantId}::uuid, ${ctx.userId}::uuid, ${input.name}, ${input.description},
              ${input.imageAssetId}::uuid, ${input.priceCents}::int)
      returning id, name, description, price_cents, currency, image_asset_id, status`);
    const product = inserted[0];
    if (!product) throw new ApiError(500, 'INTERNAL');

    if (input.communityIds.length > 0) {
      await tx.execute(sql`
        insert into store_product_communities (tenant_id, product_id, community_id)
        select ${ctx.tenantId}::uuid, ${product.id}::uuid, ids.id
          from unnest(${uuidArray(input.communityIds)}::uuid[]) as ids(id)
        on conflict (tenant_id, product_id, community_id) do nothing`);
    }

    const communities = await linkedCommunities(tx, ctx, product.id);
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      priceCents: product.price_cents,
      currency: 'BRL' as const,
      imageAssetId: product.image_asset_id,
      status: product.status as ProductStatus,
      // A product the caller just created: nobody holds it yet.
      owned: false,
      communities,
    };
  });

  log.info(
    {
      event: 'store.product_created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      productId: detail.id,
      communityCount: detail.communities.length,
    },
    'store product created',
  );
  return detail;
}

/**
 * `POST /v1/store/products/{productId}/purchase` (STORE-08, D-361). One definer call,
 * `app.store_purchase`, decides everything inside Postgres: the amount is the product row's, the two
 * partial unique arbiters settle a race, and a replay answers `owned` (P32, P33). The outcome is
 * RETURNED from the transaction, never thrown inside it, so the transaction commits whatever it is
 * (the `checkInEvent` shape), and only then mapped:
 *  - `purchased` / `owned` -> 200 `{ owned: true, communities }` (the product's active communities);
 *  - `unavailable` / `price_changed` -> `409 CONFLICT { store: … }`, nothing written;
 *  - `not_found` (unknown, another tenant's) -> ONE bare 404 (D-23).
 */
export async function purchaseProduct(
  ctx: RequestContext,
  productId: string,
  body: PurchaseBody,
): Promise<PurchaseResult> {
  const result = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<PurchaseRow>(sql`
      select r.outcome, r.order_id
        from app.store_purchase(${productId}::uuid, ${body.expectedAmountCents}::int) r`);
    const row = rows[0];
    const outcome: PurchaseOutcome = row?.outcome ?? 'not_found';
    if (outcome !== 'purchased' && outcome !== 'owned') return { outcome, communities: [] };
    return { outcome, communities: await linkedCommunities(tx, ctx, productId) };
  });

  log.info(
    {
      event: 'store.purchase',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      productId,
      // The outcome only: never the price or the product's name.
      outcome: result.outcome,
    },
    'store purchase',
  );

  if (result.outcome === 'not_found') throw new ApiError(404, 'NOT_FOUND');
  const refusal = PURCHASE_REFUSALS[result.outcome];
  if (refusal) throw new ApiError(409, 'CONFLICT', { store: refusal });
  return { owned: true, communities: result.communities };
}

// ── 08.2-05: catalogue and access reads ─────────────────────────────────────────────────────────

/** Instants cross a cursor as UTC text with microseconds, formatted by Postgres (no JS `Date`). */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);
const CURSOR_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}Z$/;

/** True when `value` is an instant this service could have issued (a real calendar instant). */
function isCursorInstant(value: string): boolean {
  const match = CURSOR_INSTANT.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < 1000) return false;
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === day &&
    at.getUTCHours() === hour &&
    at.getUTCMinutes() === minute &&
    at.getUTCSeconds() === second
  );
}

/**
 * The list cursor. Absent is page 1. Present but not an envelope this service issued (not
 * base64url JSON, a wrong version, an `id` that is not a uuid, an `n` that is not a real instant)
 * is `400 VALIDATION_FAILED` (P17): nothing from the string reaches SQL unvalidated (T-08.2-27).
 */
function decodeListCursor(raw: string | undefined): { n: string; id: string } | null {
  if (raw === undefined || raw === '') return null;
  const decoded = decodeCursor(raw);
  if (!decoded || !isCursorInstant(decoded.n)) {
    throw new ApiError(400, 'VALIDATION_FAILED', {
      issues: [{ path: 'cursor', message: 'cursor_invalid' }],
    });
  }
  return decoded;
}

type CardRow = {
  id: string;
  name: string;
  price_cents: number;
  image_asset_id: string | null;
  status: string;
  owned: boolean;
  cursor_at: string;
  cursor_id: string;
};

const toCard = (row: CardRow): ProductCard => ({
  id: row.id,
  name: row.name,
  priceCents: row.price_cents,
  currency: 'BRL',
  imageAssetId: row.image_asset_id,
  status: row.status as ProductStatus,
  owned: row.owned,
});

/**
 * `GET /v1/store/products?filter=&cursor=&limit=` (D-352, STORE-05). Three COMPLETE literal
 * statements; `query.filter` picks one in TypeScript and is never a bound parameter:
 *  - `all`: ACTIVE products, `(created_at desc, id desc)` (`store_products_tenant_created_idx`);
 *  - `archived`: archived products, same order (the ROUTE refuses it without the permission);
 *  - `owned`: the caller's ACTIVE entitlements joined to their products, archived ones included,
 *    `(e.created_at desc, e.id desc)`: newest entitlement first, and the cursor's id is the
 *    entitlement's.
 * `owned` per row is the caller's own active entitlement (an `exists`, never anyone else's row).
 * Over-fetch by one: `nextCursor` is non-null EXACTLY when another row exists (P17), and the
 * `id` tiebreaker keeps two products created in the same instant in a stable order (P10).
 */
export async function listProducts(
  ctx: RequestContext,
  query: ProductListQuery,
): Promise<ProductPage> {
  const limit = query.limit;
  const after = decodeListCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;
  const ownedExists = sql`exists (
           select 1 from store_entitlements e
            where e.tenant_id = p.tenant_id and e.product_id = p.id
              and e.user_id = ${ctx.userId}::uuid and e.status = 'active')`;

  const rows = await withTenantTx(ctx, (tx) => {
    if (query.filter === 'owned') {
      return tx.execute<CardRow>(sql`
        select p.id, p.name, p.price_cents, p.image_asset_id, p.status, true as owned,
               to_char(e.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as cursor_at,
               e.id as cursor_id
          from store_entitlements e
          join store_products p on p.id = e.product_id and p.tenant_id = e.tenant_id
         where e.tenant_id = ${ctx.tenantId}::uuid
           and e.user_id = ${ctx.userId}::uuid
           and e.status = 'active'
           and (
             ${afterAt}::timestamptz is null
             or (e.created_at, e.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
           )
         order by e.created_at desc, e.id desc
         limit ${limit + 1}`);
    }
    if (query.filter === 'archived') {
      return tx.execute<CardRow>(sql`
        select p.id, p.name, p.price_cents, p.image_asset_id, p.status, ${ownedExists} as owned,
               to_char(p.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as cursor_at,
               p.id as cursor_id
          from store_products p
         where p.tenant_id = ${ctx.tenantId}::uuid
           and p.status = 'archived'
           and (
             ${afterAt}::timestamptz is null
             or (p.created_at, p.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
           )
         order by p.created_at desc, p.id desc
         limit ${limit + 1}`);
    }
    return tx.execute<CardRow>(sql`
        select p.id, p.name, p.price_cents, p.image_asset_id, p.status, ${ownedExists} as owned,
               to_char(p.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as cursor_at,
               p.id as cursor_id
          from store_products p
         where p.tenant_id = ${ctx.tenantId}::uuid
           and p.status = 'active'
           and (
             ${afterAt}::timestamptz is null
             or (p.created_at, p.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
           )
         order by p.created_at desc, p.id desc
         limit ${limit + 1}`);
  });

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.cursor_at, id: last.cursor_id }) : null;

  log.info(
    {
      event: 'store.products_listed',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      filter: query.filter,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'store products listed',
  );
  return { items: page.map(toCard), nextCursor };
}

type DetailRow = ProductRow & { owned: boolean };

/**
 * One product as the product page reads it, inside the caller's transaction, or null when the
 * caller may not see it: no row of this tenant, or an ARCHIVED product the caller neither holds nor
 * manages (STORE-06, T-08.2-28). `holderCount` only for a manager: an exact `count(*)` of active
 * entitlements (the admin lane's select policy reads every row of the tenant).
 */
async function readDetail(
  tx: Tx,
  ctx: RequestContext,
  productId: string,
  canManage: boolean,
): Promise<ProductDetail | null> {
  const rows = await tx.execute<DetailRow>(sql`
    select p.id, p.name, p.description, p.price_cents, p.currency, p.image_asset_id, p.status,
           exists (
             select 1 from store_entitlements e
              where e.tenant_id = p.tenant_id and e.product_id = p.id
                and e.user_id = ${ctx.userId}::uuid and e.status = 'active') as owned
      from store_products p
     where p.id = ${productId}::uuid
       and p.tenant_id = ${ctx.tenantId}::uuid`);
  const product = rows[0];
  if (!product) return null;
  if (product.status === 'archived' && !product.owned && !canManage) return null;

  const detail: ProductDetail = {
    id: product.id,
    name: product.name,
    description: product.description,
    priceCents: product.price_cents,
    currency: 'BRL',
    imageAssetId: product.image_asset_id,
    status: product.status as ProductStatus,
    owned: product.owned,
    communities: await linkedCommunities(tx, ctx, product.id),
  };
  if (canManage) {
    const counted = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n
        from store_entitlements e
       where e.tenant_id = ${ctx.tenantId}::uuid
         and e.product_id = ${productId}::uuid
         and e.status = 'active'`);
    detail.holderCount = counted[0]?.n ?? 0;
  }
  return detail;
}

/**
 * `GET /v1/store/products/{productId}` (STORE-06, D-353). An unknown id, another tenant's id and an
 * archived product the caller neither holds nor manages are ONE bare 404 (D-23).
 */
export async function getProduct(
  ctx: RequestContext,
  productId: string,
  canManage: boolean,
): Promise<ProductDetail> {
  const detail = await withTenantTx(ctx, (tx) => readDetail(tx, ctx, productId, canManage));
  if (!detail) throw new ApiError(404, 'NOT_FOUND');
  return detail;
}

type AccessRow = { community_id: string; locked: boolean; archived_tag: boolean };

/**
 * `GET /v1/store/community-access` (STORE-12, Assumption A3): one row per GATED live community of
 * the tenant (at least one link, whatever its products' status), in the Comunidades list order. An
 * open community has no row. `locked` comes from the kernel gate seam (one InitPlan per statement),
 * so this answer and the feed's agree by construction (COMM-02). Nothing is cached: a link saved a
 * moment ago shows on the next call (P78).
 */
export async function listCommunityAccess(ctx: RequestContext): Promise<CommunityAccessList> {
  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<AccessRow>(sql`
      select c.id as community_id,
             c.id = any (${LOCKED_COMMUNITY_IDS}) as locked,
             not exists (
               select 1
                 from store_product_communities l2
                 join store_products p on p.id = l2.product_id and p.tenant_id = l2.tenant_id
                where l2.tenant_id = c.tenant_id and l2.community_id = c.id
                  and p.status = 'active') as archived_tag
        from communities c
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.deleted_at is null
         and exists (
           select 1 from store_product_communities l
            where l.tenant_id = c.tenant_id and l.community_id = c.id)
       order by c.position asc, c.last_activity_at desc, c.id desc`),
  );
  return {
    items: rows.map((row) => ({
      communityId: row.community_id,
      locked: row.locked,
      gated: true,
      archivedTag: row.archived_tag,
    })),
  };
}

type LinkedProductRow = {
  id: string;
  name: string;
  price_cents: number;
  image_asset_id: string | null;
  status: string;
};

/**
 * `GET /v1/store/communities/{communityId}/access` (STORE-14, decision 9; D-363 read side). A
 * community that is not a live row of this tenant (unknown, another tenant's, removed) is ONE bare
 * 404. `buyableProducts` are its ACTIVE linked products newest first (P55); `products` (all linked,
 * archived included) only for a manager, for the community form's read-only "Liberada pelos
 * produtos" block.
 */
export async function getCommunityAccess(
  ctx: RequestContext,
  communityId: string,
  canManage: boolean,
): Promise<CommunityAccess> {
  const result = await withTenantTx(ctx, async (tx) => {
    const community = await tx.execute<{ locked: boolean }>(sql`
      select c.id = any (${LOCKED_COMMUNITY_IDS}) as locked
        from communities c
       where c.id = ${communityId}::uuid
         and c.tenant_id = ${ctx.tenantId}::uuid
         and c.deleted_at is null`);
    const row = community[0];
    if (!row) return null;
    const products = await tx.execute<LinkedProductRow>(sql`
      select p.id, p.name, p.price_cents, p.image_asset_id, p.status
        from store_product_communities l
        join store_products p on p.id = l.product_id and p.tenant_id = l.tenant_id
       where l.tenant_id = ${ctx.tenantId}::uuid
         and l.community_id = ${communityId}::uuid
       order by p.created_at desc, p.id desc`);
    return { locked: row.locked, products };
  });
  if (!result) throw new ApiError(404, 'NOT_FOUND');

  const gated = result.products.length > 0;
  const active = result.products.filter((product) => product.status === 'active');
  const access: CommunityAccess = {
    communityId,
    locked: result.locked,
    gated,
    archivedTag: gated && active.length === 0,
    buyableProducts: active.map((product) => ({
      id: product.id,
      name: product.name,
      priceCents: product.price_cents,
      imageAssetId: product.image_asset_id,
    })),
  };
  if (canManage) {
    access.products = result.products.map((product) => ({
      id: product.id,
      name: product.name,
      status: product.status as ProductStatus,
    }));
  }
  return access;
}

// ── 08.2-05: admin writes ───────────────────────────────────────────────────────────────────────

/**
 * Replaces a product's WHOLE link set (D-363, the one write path): delete every link of the
 * product, insert the given set. The caller holds the product row lock (`for update`), so two
 * concurrent replaces serialise and the final set is exactly one of them, never their union (P13).
 * Only links are touched: no entitlement or order is read or written (the prohibition).
 */
async function replaceLinks(
  tx: Tx,
  ctx: RequestContext,
  productId: string,
  communityIds: readonly string[],
): Promise<void> {
  await tx.execute(sql`
    delete from store_product_communities
     where tenant_id = ${ctx.tenantId}::uuid
       and product_id = ${productId}::uuid`);
  if (communityIds.length === 0) return;
  await tx.execute(sql`
    insert into store_product_communities (tenant_id, product_id, community_id)
    select ${ctx.tenantId}::uuid, ${productId}::uuid, ids.id
      from unnest(${uuidArray(communityIds)}::uuid[]) as ids(id)
    on conflict (tenant_id, product_id, community_id) do nothing`);
}

/** Locks the product row of THIS tenant for the rest of the transaction; false when there is none. */
async function lockProduct(tx: Tx, ctx: RequestContext, productId: string): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    select id from store_products
     where id = ${productId}::uuid
       and tenant_id = ${ctx.tenantId}::uuid
       for update`);
  return rows.length > 0;
}

/**
 * `PATCH /v1/store/products/{productId}` (D-363, D-361, STORE-02, STORE-03). ONE transaction: the
 * product row is locked first, then the given columns change (and `updated_at`), and when
 * `communityIds` is present the whole link set is replaced (last writer wins with a whole set, P13).
 * A new price changes only this row; existing orders keep their snapshotted `amount_cents`
 * (D-361). The same body twice leaves the same row and links (P12). Answers the manager's detail.
 * An unknown or foreign id is ONE bare 404.
 */
export async function updateProduct(
  ctx: RequestContext,
  productId: string,
  patch: ProductPatch,
): Promise<ProductDetail> {
  const detail = await withTenantTx(ctx, async (tx) => {
    if (!(await lockProduct(tx, ctx, productId))) return null;
    if (patch.imageAssetId !== undefined) await resolveImageAsset(tx, ctx, patch.imageAssetId);
    if (patch.communityIds !== undefined) await resolveCommunities(tx, ctx, patch.communityIds);

    const sets = [sql`updated_at = now()`];
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
    if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`);
    if (patch.priceCents !== undefined) sets.push(sql`price_cents = ${patch.priceCents}::int`);
    if (patch.imageAssetId !== undefined) {
      sets.push(sql`image_asset_id = ${patch.imageAssetId}::uuid`);
    }
    await tx.execute(sql`
      update store_products
         set ${sql.join(sets, sql`, `)}
       where id = ${productId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid`);
    if (patch.communityIds !== undefined) {
      await replaceLinks(tx, ctx, productId, patch.communityIds);
    }
    return readDetail(tx, ctx, productId, true);
  });
  if (!detail) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'store.product_updated',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      productId,
      // Which fields changed, never their values (T-05-06).
      fields: Object.keys(patch).filter((key) => patch[key as keyof ProductPatch] !== undefined),
      communityCount: detail.communities.length,
    },
    'store product updated',
  );
  return detail;
}

/**
 * `PUT /v1/store/products/{productId}/status` (decision 3, STORE-09). Idempotent (P12): the status
 * the product already has answers the unchanged detail and leaves `updated_at` alone. Archiving
 * removes the product from `filter=all` and makes NEW purchases answer 409 `unavailable`
 * (`app.store_purchase`); it touches no link and no entitlement, so a holder keeps every community
 * the product opens, and the product stays under their `filter=owned` (the prohibition: a member
 * never loses access through catalogue housekeeping).
 */
export async function setProductStatus(
  ctx: RequestContext,
  productId: string,
  status: ProductStatus,
): Promise<ProductDetail> {
  const result = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{ changed: boolean }>(sql`
      update store_products
         set status = ${status},
             updated_at = case when status = ${status} then updated_at else now() end
       where id = ${productId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid
      returning true as changed`);
    if (rows.length === 0) return null;
    return readDetail(tx, ctx, productId, true);
  });
  if (!result) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'store.product_status',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      productId,
      status,
    },
    'store product status set',
  );
  return result;
}

type PreviewRow = { community_id: string; members_losing_access: number };

/**
 * `POST /v1/store/products/lock-preview` (D-364, STORE-04, P15, P16). Reads only; writes nothing.
 *
 * Keeps the sent ids that are live, ACTIVE communities of this tenant AND have NO row in
 * `store_product_communities` today: a community another product already gates is not newly
 * locking (no dialog), and neither is one linked only to the product being edited. Any other id
 * (unknown, another tenant's, archived, removed) is simply dropped. For each kept id,
 * `membersLosingAccess` is an exact `count(*)` (never estimated or capped) of the tenant's
 * `member`-role memberships with `status = 'active'`, `blocked_at` and `deleted_at` null, holding no
 * active entitlement to `productId` (every live member when `productId` is absent). Staff are never
 * counted: they always read every community. Rows come back in the order the ids were sent.
 *
 * A `productId` that is not a product of this tenant is ONE bare 404 (the isolation answer).
 * Runs in the admin's lane: `memberships_tenant_select` and the admin branch of the entitlements'
 * select policy scope every row to the tenant.
 */
export async function lockPreview(
  ctx: RequestContext,
  body: LockPreviewBody,
): Promise<LockPreview> {
  const productId = body.productId ?? null;
  const rows = await withTenantTx(ctx, async (tx) => {
    if (productId !== null) {
      const found = await tx.execute<{ id: string }>(sql`
        select id from store_products
         where id = ${productId}::uuid and tenant_id = ${ctx.tenantId}::uuid`);
      if (found.length === 0) return null;
    }
    return tx.execute<PreviewRow>(sql`
      select c.id as community_id,
             (select count(*)::int
                from memberships m
               where m.tenant_id = c.tenant_id
                 and m.role = 'member'
                 and m.status = 'active'
                 and m.blocked_at is null
                 and m.deleted_at is null
                 and (
                   ${productId}::uuid is null
                   or not exists (
                     select 1 from store_entitlements e
                      where e.tenant_id = m.tenant_id
                        and e.user_id = m.user_id
                        and e.product_id = ${productId}::uuid
                        and e.status = 'active')
                 )) as members_losing_access
        from communities c
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.id = any (${uuidArray(body.communityIds)}::uuid[])
         and c.status = 'active'
         and c.deleted_at is null
         and not exists (
           select 1 from store_product_communities l
            where l.tenant_id = c.tenant_id and l.community_id = c.id)
       order by array_position(${uuidArray(body.communityIds)}::uuid[], c.id)`);
  });
  if (rows === null) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'store.lock_preview',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      productId,
      sent: body.communityIds.length,
      newlyLocking: rows.length,
    },
    'store lock preview',
  );
  return {
    items: rows.map((row) => ({
      communityId: row.community_id,
      membersLosingAccess: row.members_losing_access,
    })),
  };
}

// ── 08.2-06: buyers, grant and revoke (D-359, D-360) ───────────────────────────────────────────

type BuyerRow = {
  entitlement_id: string;
  membership_id: string | null;
  display_name: string | null;
  avatar_asset_id: string | null;
  source: EntitlementSource;
  since: string;
};

/**
 * `GET /v1/store/products/{productId}/buyers?cursor=&limit=` (D-360, STORE-10). Guarded at the route
 * by the literal `store.product.manage` (admin_tenant only by default); runs in the admin's lane,
 * where the entitlements' select policy reads every row of the tenant.
 *
 * Statement 1 confirms the product is THIS tenant's and counts its ACTIVE entitlements exactly
 * (`total`); no row is ONE bare 404 (unknown or another tenant's, D-23, T-08.2-07), never an empty
 * page that would tell a foreign id from a missing one. An archived product still lists its holders.
 *
 * Statement 2 is one keyset page of the ACTIVE entitlements, `(e.created_at desc, e.id desc)` (P37,
 * `store_entitlements_tenant_product_created_idx`), over-fetching one row. The name and photo are
 * the holder's `member_profiles` row in THIS tenant, reached through their live membership (D-310,
 * T-08.2-30), never the identity table: a LEFT join, so a holder whose membership was removed keeps
 * the row with `membershipId`, `displayName` and `avatarAssetId` all null. A purchase and a grant are
 * told apart only by `source` (P35); a revoked row is history and never listed.
 */
export async function listBuyers(
  ctx: RequestContext,
  productId: string,
  query: BuyersQuery,
): Promise<BuyersPage> {
  const limit = query.limit;
  const after = decodeListCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const result = await withTenantTx(ctx, async (tx) => {
    const counted = await tx.execute<{ total: number }>(sql`
      select (select count(*)::int
                from store_entitlements e
               where e.tenant_id = p.tenant_id
                 and e.product_id = p.id
                 and e.status = 'active') as total
        from store_products p
       where p.id = ${productId}::uuid
         and p.tenant_id = ${ctx.tenantId}::uuid`);
    const product = counted[0];
    if (!product) return null;
    const rows = await tx.execute<BuyerRow>(sql`
      select e.id as entitlement_id,
             ms.id as membership_id,
             mp.display_name,
             mp.avatar_asset_id,
             e.source,
             to_char(e.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as since
        from store_entitlements e
        left join memberships ms
               on ms.tenant_id = e.tenant_id
              and ms.user_id = e.user_id
              and ms.deleted_at is null
        left join member_profiles mp on mp.membership_id = ms.id and mp.tenant_id = e.tenant_id
       where e.tenant_id = ${ctx.tenantId}::uuid
         and e.product_id = ${productId}::uuid
         and e.status = 'active'
         and (
           ${afterAt}::timestamptz is null
           or (e.created_at, e.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by e.created_at desc, e.id desc
       limit ${limit + 1}`);
    return { total: product.total, rows };
  });
  if (!result) throw new ApiError(404, 'NOT_FOUND');

  const page = result.rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    result.rows.length > limit && last
      ? encodeCursor({ n: last.since, id: last.entitlement_id })
      : null;

  log.info(
    {
      event: 'store.buyers_listed',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      productId,
      limit,
      returned: page.length,
      total: result.total,
      hasNext: nextCursor !== null,
    },
    'store buyers listed',
  );

  return {
    items: page.map((row) => {
      const removed = row.membership_id === null;
      return {
        entitlementId: row.entitlement_id,
        membershipId: row.membership_id,
        displayName: removed ? null : row.display_name,
        avatarAssetId: removed ? null : row.avatar_asset_id,
        source: row.source,
        since: row.since,
      };
    }),
    nextCursor,
    total: result.total,
  };
}

/** Every outcome `app.store_grant` can return (its migration header is the vocabulary). */
type GrantRow = {
  outcome: GrantOutcome | 'not_found' | 'forbidden';
  entitlement_id: string | null;
};

/**
 * `POST /v1/store/products/{productId}/grants` (D-360). ONE definer call, `app.store_grant`, decides
 * everything inside Postgres: the membership is resolved in THIS tenant only (live, not blocked,
 * not deleted), so another tenant's membership id, including the same person's membership in a
 * second community (D-309), is `not_found` (T-08.2-06). The definer re-checks the `admin_tenant`
 * claim itself (T-08.2-12). The outcome is RETURNED from the transaction, never thrown inside it,
 * then mapped: `granted` / `already_active` -> 200; `not_found` -> ONE bare 404; `forbidden` -> 403.
 */
export async function grantAccess(
  ctx: RequestContext,
  productId: string,
  body: GrantBody,
): Promise<GrantResult> {
  const row = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<GrantRow>(sql`
      select r.outcome, r.entitlement_id
        from app.store_grant(${productId}::uuid, ${body.membershipId}::uuid) r`);
    return rows[0] ?? { outcome: 'not_found' as const, entitlement_id: null };
  });

  log.info(
    {
      event: 'store.grant',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      productId,
      membershipId: body.membershipId,
      outcome: row.outcome,
      entitlementId: row.entitlement_id,
    },
    'store grant',
  );

  if (row.outcome === 'forbidden') throw new ApiError(403, 'FORBIDDEN');
  if (row.outcome === 'not_found' || row.entitlement_id === null) {
    throw new ApiError(404, 'NOT_FOUND');
  }
  return { outcome: row.outcome, entitlementId: row.entitlement_id };
}

/**
 * `DELETE /v1/store/products/{productId}/entitlements/{entitlementId}` (D-359). ONE definer call,
 * `app.store_revoke`: the ACTIVE entitlement of THIS product in THIS tenant becomes `revoked` and,
 * for a purchase, so does its order; nothing is deleted (STORE-09). An entitlement of another
 * product (the path's `productId` must match the row: no IDOR, T-08.2-07), of another tenant, or
 * already revoked is ONE bare 404. The gate reads the ledger live, so the member's NEXT statement
 * sees the community locked again (P42), and a new purchase writes a new order and entitlement.
 */
export async function revokeAccess(
  ctx: RequestContext,
  productId: string,
  entitlementId: string,
): Promise<RevokeResult> {
  const outcome = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{ outcome: 'revoked' | 'not_found' | 'forbidden' }>(sql`
      select r.outcome from app.store_revoke(${productId}::uuid, ${entitlementId}::uuid) r`);
    return rows[0]?.outcome ?? 'not_found';
  });

  log.info(
    {
      event: 'store.revoke',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      productId,
      entitlementId,
      outcome,
    },
    'store revoke',
  );

  if (outcome === 'forbidden') throw new ApiError(403, 'FORBIDDEN');
  if (outcome === 'not_found') throw new ApiError(404, 'NOT_FOUND');
  return { outcome };
}
