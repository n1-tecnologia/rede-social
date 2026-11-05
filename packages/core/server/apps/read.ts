import { type HostApp, slugSchema } from '@rede-social/contracts';
import {
  type AppVersionAnswer,
  deriveAppIds,
  NATIVE_PLATFORMS,
  type NativePlatform,
} from '@rede-social/contracts/native';
import { eq } from 'drizzle-orm';
import { tenantApps } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { tenants } from '../../db/schema';
import { ApiError } from '../http/api-error';
import {
  type AppRow,
  type AppStore,
  PURCHASE_SWITCH_TTL_MS,
  type PurchaseSwitches,
  pgAppStore,
  purchaseSwitchCache,
} from './tenant-app';

/**
 * The control-plane facts of a tenant's native app, read from the REQUEST path (13-10, D-603, D-611, D-615,
 * D-617; NATIVE-07, NATIVE-24). Three reads share one data source (`platform.tenant_apps`) and one cache:
 *
 * - `readHostAppBlock`: the non-secret `app` block of the by-host answer, built field by field (T-13-24).
 * - `readPurchaseSwitches`: the per-store purchase switches, behind a bounded 15-second in-process cache.
 * - `readAppVersion`: the unauthenticated minimum-version floor and store link of each store.
 *
 * Every function takes its store as an optional dependency, so the rules run in unit tests over in-memory
 * stores and in the integration test over the real tables.
 */

// --- The platform header (T-13-25) ----------------------------------------------------------------------------

/**
 * Reads the value of the `x-rede-app-platform` header. An ABSENT header is a browser. A PRESENT header selects a
 * platform only when it is exactly `ios` or `android`; anything else (empty, other case, padded, a list, another
 * platform) is a native request with NO platform, which the purchase rule answers with `false`. The header is a
 * hint for what to hide, never an authorization.
 */
export function nativeRequestOf(header: string | undefined): {
  native: boolean;
  platform: NativePlatform | null;
} {
  if (header === undefined) return { native: false, platform: null };
  const platform = NATIVE_PLATFORMS.find((candidate) => candidate === header) ?? null;
  return { native: true, platform };
}

// --- The by-host `app` block ----------------------------------------------------------------------------------

/** Longest id the strict `hostAppSchema` accepts. */
const APP_ID_MAX_LENGTH = 160;

/**
 * The by-host `app` block from a stored row, as a PURE function. `null` for a tenant with no row. Each platform
 * is complete or `null`: iOS needs the Team ID and a bundle id (the saved one, else the one derived from the
 * primary host), Android needs an application id (saved, else derived) and at least one fingerprint, so a
 * platform with partial data has no `.well-known` file (D-611). Only non-secret columns are read.
 */
export function hostAppBlockOf(row: AppRow | null, primaryHost: string | null): HostApp | null {
  if (!row) return null;
  const derived = deriveAppIds(primaryHost);
  const bundleId = row.bundleId ?? derived?.ios ?? null;
  const applicationId = row.applicationId ?? derived?.android ?? null;
  const appId = row.teamId !== null && bundleId !== null ? `${row.teamId}.${bundleId}` : null;
  const sha256 = row.androidSha256.slice(0, 10);
  return {
    ios: appId !== null && appId.length <= APP_ID_MAX_LENGTH ? { appId } : null,
    android:
      applicationId !== null && sha256.length > 0 ? { applicationId, sha256: [...sha256] } : null,
    purchase: { ios: row.purchaseIos === true, android: row.purchaseAndroid === true },
  };
}

/** The `app` block of one tenant: `null` when the tenant has no `tenant_apps` row. */
export async function readHostAppBlock(
  tenantId: string,
  deps: { app?: AppStore | undefined; primaryHost?: string | null | undefined } = {},
): Promise<HostApp | null> {
  const row = await (deps.app ?? pgAppStore).read(tenantId);
  return hostAppBlockOf(row, deps.primaryHost ?? null);
}

// --- The purchase switches ------------------------------------------------------------------------------------

/**
 * The two purchase switches of a tenant as strict booleans (D-615, D-617). A tenant with no row reads both
 * `false`; the in-process cache keeps the answer for 15 seconds. `invalidatePurchaseSwitch` (the switch route)
 * drops the key, so the instance that wrote sees the change at once and the others within the TTL (PU-5).
 * A failed read throws and is never cached: the caller decides how to fail (the bootstrap fails closed).
 */
export async function readPurchaseSwitches(
  tenantId: string,
  deps: { app?: AppStore | undefined } = {},
): Promise<PurchaseSwitches> {
  const cached = purchaseSwitchCache.get(tenantId);
  if (cached) return { ios: cached.ios, android: cached.android };
  const row = await (deps.app ?? pgAppStore).read(tenantId);
  const switches: PurchaseSwitches = {
    ios: row?.purchaseIos === true,
    android: row?.purchaseAndroid === true,
  };
  purchaseSwitchCache.set(tenantId, switches, PURCHASE_SWITCH_TTL_MS);
  return { ...switches };
}

// --- The minimum version --------------------------------------------------------------------------------------

/** The four public columns of a tenant's app row that the version read needs. */
export type AppVersionRow = {
  minVersionIos: string | null;
  minVersionAndroid: string | null;
  storeUrlIos: string | null;
  storeUrlAndroid: string | null;
};

/** `null` when the control plane has no tenant of that slug; a row of nulls when it has no `tenant_apps` row. */
export type AppVersionStore = { bySlug(slug: string): Promise<AppVersionRow | null> };

/** A tenant in any status answers (a suspended tenant still resolves, like its by-host answer). */
export const pgAppVersionStore: AppVersionStore = {
  async bySlug(slug) {
    const [row] = await withPlatformTx((tx) =>
      tx
        .select({
          minVersionIos: tenantApps.minVersionIos,
          minVersionAndroid: tenantApps.minVersionAndroid,
          storeUrlIos: tenantApps.storeUrlIos,
          storeUrlAndroid: tenantApps.storeUrlAndroid,
        })
        .from(tenants)
        .leftJoin(tenantApps, eq(tenantApps.tenantId, tenants.id))
        .where(eq(tenants.slug, slug))
        .limit(1),
    );
    return row ?? null;
  },
};

const NO_FLOOR = '0.0.0';
const SEMVER = /^\d+\.\d+\.\d+$/;
const floorOf = (value: string | null): string =>
  value !== null && SEMVER.test(value) ? value : NO_FLOOR;
const linkOf = (value: string | null): string | null =>
  value !== null && /^https:\/\/./.test(value) && value.length <= 2048 ? value : null;

/** The version answer from the stored columns, as a PURE function: no floor reads `0.0.0`, a bad link reads `null`. */
export function appVersionAnswerOf(
  row: Partial<AppVersionRow> | null | undefined,
): AppVersionAnswer {
  return {
    ios: {
      minVersion: floorOf(row?.minVersionIos ?? null),
      storeUrl: linkOf(row?.storeUrlIos ?? null),
    },
    android: {
      minVersion: floorOf(row?.minVersionAndroid ?? null),
      storeUrl: linkOf(row?.storeUrlAndroid ?? null),
    },
  };
}

/**
 * The unauthenticated minimum-version read (NATIVE-07). The slug is matched EXACTLY and a malformed one gets
 * the same 404 `TENANT_NOT_FOUND` as an unknown one (adjacency, T-04-07), before any store is read.
 */
export async function readAppVersion(
  slug: string,
  deps: { versions?: AppVersionStore | undefined } = {},
): Promise<AppVersionAnswer> {
  if (!slugSchema.safeParse(slug).success) throw new ApiError(404, 'TENANT_NOT_FOUND');
  const row = await (deps.versions ?? pgAppVersionStore).bySlug(slug);
  if (!row) throw new ApiError(404, 'TENANT_NOT_FOUND');
  return appVersionAnswerOf(row);
}
