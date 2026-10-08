import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { sql } from 'drizzle-orm';
import type {
  ProductCommunity,
  ProductDetail,
  ProductInput,
  ProductStatus,
  PurchaseBody,
  PurchaseResult,
} from '../contracts/index';

// A child of the kernel root (WR-12): severity-formatted, LOG_LEVEL-aware — never a bare pino().
const log = moduleLogger('module-store');

/**
 * The store's service (08.2-01). Two writes so far: `createProduct` (admin, behind
 * `store.product.manage`) and `purchaseProduct` (every role). Log lines carry ids, counts and
 * outcomes only, never a product name, a description or a price an admin typed (the T-05-06 rule).
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
