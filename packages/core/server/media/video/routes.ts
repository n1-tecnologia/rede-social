import { eq } from 'drizzle-orm';
import { videoAssetRoutes } from '../../../db/central/routes';
import { withPlatformTx } from '../../../db/platform-tx';
import type { VideoProviderEvent } from './types';

/**
 * The video side of the central route indexes (09.2-10, DBT-13): `platform.video_asset_routes`. A provider
 * delivery names an asset, never a host, so the tenant (and with it the project) is found here when the
 * passthrough does not already carry it. Platform lane only; the table holds ids and nothing else.
 *
 * Resolution order for one event (`resolveVideoTenant`):
 *  1. the tenant in the `<tenantId>:<assetId>` passthrough (no central read);
 *  2. a bare-uuid passthrough (an asset created before this phase): `video_asset_routes` by asset id;
 *  3. no usable passthrough at all: `video_asset_routes` by `provider_asset_id`.
 * An event that resolves to nothing is the caller's to accept and drop.
 */

/** Records that `assetId` belongs to `tenantId`. Written BEFORE the provider call, so the first webhook finds it. */
export async function recordVideoRoute(assetId: string, tenantId: string): Promise<void> {
  await withPlatformTx((tx) =>
    tx.insert(videoAssetRoutes).values({ assetId, tenantId }).onConflictDoNothing(),
  );
}

/** Learns the provider's own id for an asset. Scoped to the tenant; a no-op when nothing changes. */
export async function setVideoRouteProviderId(
  assetId: string,
  tenantId: string,
  providerAssetId: string,
): Promise<void> {
  await withPlatformTx(async (tx) => {
    const [row] = await tx
      .select({
        tenantId: videoAssetRoutes.tenantId,
        providerAssetId: videoAssetRoutes.providerAssetId,
      })
      .from(videoAssetRoutes)
      .where(eq(videoAssetRoutes.assetId, assetId))
      .limit(1);
    if (!row || row.tenantId !== tenantId || row.providerAssetId === providerAssetId) return;
    await tx
      .update(videoAssetRoutes)
      .set({ providerAssetId })
      .where(eq(videoAssetRoutes.assetId, assetId));
  });
}

/** Removes the route of an asset whose upload never started (compensation). */
export async function dropVideoRoute(assetId: string, tenantId: string): Promise<void> {
  await withPlatformTx(async (tx) => {
    const [row] = await tx
      .select({ tenantId: videoAssetRoutes.tenantId })
      .from(videoAssetRoutes)
      .where(eq(videoAssetRoutes.assetId, assetId))
      .limit(1);
    if (row?.tenantId === tenantId) {
      await tx.delete(videoAssetRoutes).where(eq(videoAssetRoutes.assetId, assetId));
    }
  });
}

/** The tenant of one provider event, or `null` when no rule finds one. */
export async function resolveVideoTenant(
  event: Pick<VideoProviderEvent, 'tenantId' | 'assetId' | 'providerAssetId'>,
): Promise<string | null> {
  if (event.tenantId) return event.tenantId;
  if (!event.assetId && !event.providerAssetId) return null;
  return withPlatformTx(async (tx) => {
    if (event.assetId) {
      const [byAsset] = await tx
        .select({ tenantId: videoAssetRoutes.tenantId })
        .from(videoAssetRoutes)
        .where(eq(videoAssetRoutes.assetId, event.assetId))
        .limit(1);
      if (byAsset) return byAsset.tenantId;
    }
    if (event.providerAssetId) {
      const [byProvider] = await tx
        .select({ tenantId: videoAssetRoutes.tenantId })
        .from(videoAssetRoutes)
        .where(eq(videoAssetRoutes.providerAssetId, event.providerAssetId))
        .limit(1);
      if (byProvider) return byProvider.tenantId;
    }
    return null;
  });
}
