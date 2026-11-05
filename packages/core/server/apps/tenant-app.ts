import { createBoundedTtlCache } from '@rede-social/contracts';
import {
  APP_CHECKLIST_MANUAL_KEYS,
  type AppChecklistManualKey,
  type AppStateInput,
  type AppTab,
  appIdsBodySchema,
  appLinksBodySchema,
  appState,
  checklistAutoRows,
  checklistBodySchema,
  checklistCounts,
  deriveAppIds,
  deriveIconLabel,
  deriveStoreName,
  linkVerdict,
  type NativePlatform,
  normalizeFingerprint,
  privacyBodySchema,
  purchaseBodySchema,
} from '@rede-social/contracts/native';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { tenantApps } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { tenantDomains, tenantModules, tenants } from '../../db/schema';
import { ApiError } from '../http/api-error';
import { type CredentialStore, pgCredentialStore, summarizeHeld } from './credentials';
import { AGE_RATING_LABEL, buildStoreDescription } from './listing';

/**
 * The control-plane facts of a tenant's native app and the App tab read over them (13-09, D-605, D-607, D-615,
 * D-617). Everything here is read and written through the PLATFORM lane (`platform.tenant_apps` and the
 * central tenant mirror), never a tenant lane.
 *
 * A tenant with NO `tenant_apps` row is a tenant with no app: it reads the empty form (`emptyAppRow`, state
 * `none`, both purchase switches OFF), never an error. The row is created lazily by the first write.
 *
 * The two stores (`AppStore`, `CredentialStore`) are the module's only doors to the database, so the rules in
 * this file run in the unit tests against in-memory stores and in the integration test against the real ones.
 */

export type AppRow = {
  tenantId: string;
  bundleId: string | null;
  applicationId: string | null;
  idsLockedAt: Date | null;
  teamId: string | null;
  androidSha256: string[];
  purchaseIos: boolean;
  purchaseAndroid: boolean;
  privacyUrl: string | null;
  lastIosVersion: string | null;
  lastIosBuild: number | null;
  lastIosAt: Date | null;
  lastAndroidVersion: string | null;
  lastAndroidBuild: number | null;
  lastAndroidAt: Date | null;
  manualAppleAccount: boolean;
  manualPlayAccount: boolean;
  manualScreenshots: boolean;
  manualSubmitted: boolean;
  manualPublished: boolean;
  reviewerEmail: string | null;
};
/** What a write may change. The tenant id and the timestamps are never part of a patch. */
export type AppPatch = Partial<Omit<AppRow, 'tenantId'>>;
/**
 * The central mirror's facts about the tenant that the tab needs. `modules` are the enabled module keys; they
 * only shape the store description (13-31), and an absent list reads as no module.
 */
export type TenantFacts = {
  displayName: string;
  primaryHost: string | null;
  modules?: readonly string[] | undefined;
};

export type AppStore = {
  /** `null` when the control plane does not know the tenant. */
  facts(tenantId: string): Promise<TenantFacts | null>;
  read(tenantId: string): Promise<AppRow | null>;
  /**
   * ONE transaction: the tenant must exist (404 `NOT_FOUND`), the row is created with every default when it is
   * missing, then locked; `change` computes the patch from the locked row (it may throw to refuse) and the patch
   * is written with `updated_at = now()`. `change` must be synchronous and free of I/O.
   */
  write(tenantId: string, change: (current: AppRow) => AppPatch): Promise<void>;
};

/** The empty form: what a tenant with no row reads. Both purchase switches are OFF (D-617). */
export const emptyAppRow = (tenantId: string): AppRow => ({
  tenantId,
  bundleId: null,
  applicationId: null,
  idsLockedAt: null,
  teamId: null,
  androidSha256: [],
  purchaseIos: false,
  purchaseAndroid: false,
  privacyUrl: null,
  lastIosVersion: null,
  lastIosBuild: null,
  lastIosAt: null,
  lastAndroidVersion: null,
  lastAndroidBuild: null,
  lastAndroidAt: null,
  manualAppleAccount: false,
  manualPlayAccount: false,
  manualScreenshots: false,
  manualSubmitted: false,
  manualPublished: false,
  reviewerEmail: null,
});

const toRow = (row: typeof tenantApps.$inferSelect): AppRow => ({
  tenantId: row.tenantId,
  bundleId: row.bundleId,
  applicationId: row.applicationId,
  idsLockedAt: row.idsLockedAt,
  teamId: row.teamId,
  androidSha256: row.androidSha256,
  purchaseIos: row.purchaseIos,
  purchaseAndroid: row.purchaseAndroid,
  privacyUrl: row.privacyUrl,
  lastIosVersion: row.lastIosVersion,
  lastIosBuild: row.lastIosBuild,
  lastIosAt: row.lastIosAt,
  lastAndroidVersion: row.lastAndroidVersion,
  lastAndroidBuild: row.lastAndroidBuild,
  lastAndroidAt: row.lastAndroidAt,
  manualAppleAccount: row.manualAppleAccount,
  manualPlayAccount: row.manualPlayAccount,
  manualScreenshots: row.manualScreenshots,
  manualSubmitted: row.manualSubmitted,
  manualPublished: row.manualPublished,
  reviewerEmail: row.reviewerEmail,
});

export const pgAppStore: AppStore = {
  async facts(tenantId) {
    return withPlatformTx(async (tx) => {
      const [tenant] = await tx
        .select({ displayName: tenants.displayName })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (!tenant) return null;
      const [primary] = await tx
        .select({ host: tenantDomains.host })
        .from(tenantDomains)
        .where(
          and(
            eq(tenantDomains.tenantId, tenantId),
            eq(tenantDomains.isPrimary, true),
            isNotNull(tenantDomains.verifiedAt),
          ),
        )
        .limit(1);
      const enabled = await tx
        .select({ key: tenantModules.moduleKey })
        .from(tenantModules)
        .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.enabled, true)));
      return {
        displayName: tenant.displayName,
        primaryHost: primary?.host ?? null,
        modules: enabled.map((row) => row.key),
      };
    });
  },
  async read(tenantId) {
    const [row] = await withPlatformTx((tx) =>
      tx.select().from(tenantApps).where(eq(tenantApps.tenantId, tenantId)).limit(1),
    );
    return row ? toRow(row) : null;
  },
  async write(tenantId, change) {
    await withPlatformTx(async (tx) => {
      const [tenant] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (!tenant) throw new ApiError(404, 'NOT_FOUND');
      await tx.insert(tenantApps).values({ tenantId }).onConflictDoNothing();
      const [locked] = await tx
        .select()
        .from(tenantApps)
        .where(eq(tenantApps.tenantId, tenantId))
        .for('update');
      if (!locked) throw new ApiError(404, 'NOT_FOUND');
      const patch = change(toRow(locked));
      if (Object.keys(patch).length === 0) return;
      await tx
        .update(tenantApps)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(tenantApps.tenantId, tenantId));
    });
  },
};

export type AppDeps = { app?: AppStore | undefined; credentials?: CredentialStore | undefined };

/** 404 `NOT_FOUND` when the control plane does not know the tenant; the facts otherwise. */
export async function requireTenant(
  tenantId: string,
  deps: { app?: AppStore | undefined } = {},
): Promise<TenantFacts> {
  const facts = await (deps.app ?? pgAppStore).facts(tenantId);
  if (!facts) throw new ApiError(404, 'NOT_FOUND');
  return facts;
}

/** The standard store description for this tenant (13-31), or `null` when the name cannot be printed. */
function descriptionOf(facts: TenantFacts): string | null {
  try {
    return buildStoreDescription({ tenantName: facts.displayName, modules: facts.modules ?? [] })
      .text;
  } catch {
    return null;
  }
}

const buildOf = (version: string | null, build: number | null, at: Date | null) =>
  version !== null && build !== null && at !== null
    ? { version, buildNumber: build, at: at.toISOString() }
    : null;

/**
 * The tab's answer from the three inputs, as a PURE function: the derived ids and names, the link verdicts, the
 * checklist and the state all come from the contracts' functions, so the server and every screen show one
 * answer. `held` is the three kinds the operator enters; `reviewerHeld` says the generated reviewer password
 * exists. No input here is a secret, and no field of the answer can carry one.
 */
export function buildAppTab(input: {
  facts: TenantFacts;
  row: AppRow;
  held: ReturnType<typeof summarizeHeld>;
  reviewerHeld: boolean;
}): AppTab {
  const { facts, row, held, reviewerHeld } = input;
  const derived = deriveAppIds(facts.primaryHost);
  const bundleId = row.bundleId ?? derived?.ios ?? null;
  const applicationId = row.applicationId ?? derived?.android ?? null;
  const fingerprint = row.androidSha256[0] ?? null;
  const hasVerifiedPrimaryHost = facts.primaryHost !== null;
  const verdict = {
    ios: linkVerdict('ios', { hasVerifiedPrimaryHost, teamId: row.teamId, fingerprint }),
    android: linkVerdict('android', { hasVerifiedPrimaryHost, teamId: row.teamId, fingerprint }),
  };
  const isHeld = (kind: string) => held.some((entry) => entry.kind === kind && entry.held);
  const state: AppStateInput = {
    held: {
      asc: isHeld('asc_key'),
      play: isHeld('play_service_account'),
      apns: isHeld('apns_key'),
    },
    links: verdict,
    privacyUrl: row.privacyUrl !== null,
    reviewer: reviewerHeld && row.reviewerEmail !== null,
    manual: {
      appleAccount: row.manualAppleAccount,
      playAccount: row.manualPlayAccount,
      screenshots: row.manualScreenshots,
      submitted: row.manualSubmitted,
      published: row.manualPublished,
    },
  };
  const storeName = deriveStoreName(facts.displayName);
  const iconLabel = deriveIconLabel(null, facts.displayName);

  return {
    appState: appState(state),
    identity: {
      displayName: facts.displayName,
      shortName: { name: iconLabel.name, cut: iconLabel.cut },
      host: facts.primaryHost,
      bundleId,
      applicationId,
      idsLocked: row.idsLockedAt !== null,
      idsDefault:
        (row.bundleId === null && bundleId !== null) ||
        (row.applicationId === null && applicationId !== null),
      lastBuild: {
        ios: buildOf(row.lastIosVersion, row.lastIosBuild, row.lastIosAt),
        android: buildOf(row.lastAndroidVersion, row.lastAndroidBuild, row.lastAndroidAt),
      },
    },
    credentials: held,
    links: { teamId: row.teamId, fingerprint, verdict },
    purchase: { ios: row.purchaseIos, android: row.purchaseAndroid },
    listing: {
      name: { name: storeName.name, cut: storeName.cut },
      description: descriptionOf(facts),
      ageRating: AGE_RATING_LABEL,
      privacyUrl: row.privacyUrl,
      reviewerEmail: row.reviewerEmail,
      reviewerHeld,
    },
    checklist: {
      done: checklistCounts(state).done,
      total: 10,
      auto: checklistAutoRows(state),
      manual: state.manual,
    },
  };
}

/**
 * The App tab of one tenant (UI-SPEC "Platform App tab reads"). 404 `NOT_FOUND` for a tenant the control plane
 * does not know; the empty form for one with no row. Reads the credentials' presence only, never a value.
 */
export async function readAppTab(tenantId: string, deps: AppDeps = {}): Promise<AppTab> {
  const app = deps.app ?? pgAppStore;
  const facts = await requireTenant(tenantId, { app });
  const row = (await app.read(tenantId)) ?? emptyAppRow(tenantId);
  const heldRows = await (deps.credentials ?? pgCredentialStore).held(tenantId);
  return buildAppTab({
    facts,
    row,
    held: summarizeHeld(heldRows),
    reviewerHeld: heldRows.some((entry) => entry.kind === 'reviewer_password'),
  });
}

// --- The writes (13-09 Task 2) --------------------------------------------------------------------------------

const refuse = (): never => {
  throw new ApiError(400, 'VALIDATION_FAILED');
};

/** The two purchase switches of one tenant, as the request path reads them (13-10, D-615, D-617). */
export type PurchaseSwitches = { ios: boolean; android: boolean };

/** Bound and life of the in-process switch cache (13-10, PU-5): 15 s is the staleness other instances may show. */
export const PURCHASE_SWITCH_CACHE_MAX = 500;
export const PURCHASE_SWITCH_TTL_MS = 15_000;

/**
 * The in-process cache of the purchase switches that `readPurchaseSwitches` (read.ts) fills: a bounded 15-second
 * cache. It lives here, beside the writer that must clear it, so the switch route and the reader share one
 * door. Nothing in this file fills it.
 */
export const purchaseSwitchCache =
  createBoundedTtlCache<PurchaseSwitches>(PURCHASE_SWITCH_CACHE_MAX);

/**
 * Drops the cached switches of one tenant, so the instance that wrote sees the change at once and the others
 * within the cache's TTL (PU-5). Called after every switch write.
 */
export function invalidatePurchaseSwitch(tenantId: string): void {
  purchaseSwitchCache.delete(tenantId);
}

/**
 * Saves the two store ids (D-615). Refused with 409 `IDS_LOCKED` once the app is published (`ids_locked_at`),
 * read INSIDE the write's transaction so a concurrent publication cannot slip past. When the app was already
 * marked published before both ids existed, the lock engages as soon as the ids do.
 */
export async function setAppIds(
  tenantId: string,
  input: { bundleId: string; applicationId: string },
  deps: AppDeps = {},
): Promise<void> {
  const parsed = appIdsBodySchema.safeParse(input);
  if (!parsed.success) return refuse();
  const { bundleId, applicationId } = parsed.data;
  await (deps.app ?? pgAppStore).write(tenantId, (current) => {
    if (current.idsLockedAt !== null) throw new ApiError(409, 'IDS_LOCKED');
    return {
      bundleId,
      applicationId,
      ...(current.manualPublished ? { idsLockedAt: new Date() } : {}),
    };
  });
}

/**
 * Saves the Apple Team ID (stored upper-case, the table's check) and the Android signing fingerprint (stored as
 * 32 upper-case colon-separated pairs). `null` clears the value. Both are always written, so the caller sends
 * the whole pair as the screen holds it.
 */
export async function setAppLinks(
  tenantId: string,
  input: { teamId: string | null; sha256: string | null },
  deps: AppDeps = {},
): Promise<void> {
  const parsed = appLinksBodySchema.safeParse(input);
  if (!parsed.success) return refuse();
  const teamId = parsed.data.teamId === null ? null : parsed.data.teamId.toUpperCase();
  let androidSha256: string[] = [];
  if (parsed.data.sha256 !== null) {
    const fingerprint = normalizeFingerprint(parsed.data.sha256);
    if (fingerprint === null) return refuse();
    androidSha256 = [fingerprint];
  }
  await (deps.app ?? pgAppStore).write(tenantId, () => ({ teamId, androidSha256 }));
  // The by-host answer carries the links; nothing is cached here, so there is nothing else to drop.
}

/**
 * Flips ONE store's purchase switch (D-617). The row is created by the first write with the OTHER switch off,
 * and nothing in this module ever sets a switch on by itself.
 */
export async function setPurchaseSwitch(
  tenantId: string,
  platform: NativePlatform,
  visible: boolean,
  deps: AppDeps = {},
): Promise<void> {
  const parsed = purchaseBodySchema.safeParse({ platform, visible });
  if (!parsed.success) return refuse();
  await (deps.app ?? pgAppStore).write(tenantId, () =>
    parsed.data.platform === 'ios'
      ? { purchaseIos: parsed.data.visible }
      : { purchaseAndroid: parsed.data.visible },
  );
  invalidatePurchaseSwitch(tenantId);
}

/** Saves the tenant's privacy-policy URL: https only, at most 2048 characters. */
export async function setPrivacyUrl(
  tenantId: string,
  url: string,
  deps: AppDeps = {},
): Promise<void> {
  const parsed = privacyBodySchema.safeParse({ url });
  if (!parsed.success) return refuse();
  await (deps.app ?? pgAppStore).write(tenantId, () => ({ privacyUrl: parsed.data.url }));
}

const MANUAL_COLUMN = {
  appleAccount: 'manualAppleAccount',
  playAccount: 'manualPlayAccount',
  screenshots: 'manualScreenshots',
  submitted: 'manualSubmitted',
  published: 'manualPublished',
} as const satisfies Record<AppChecklistManualKey, keyof AppPatch>;

/**
 * Ticks or un-ticks one of the five manual checklist rows (UI-D-627). `published` also drives the id lock
 * (planner assumption A-13-02): ticking it sets `ids_locked_at`, but only when both ids are stored (otherwise the
 * flag is set and the lock engages with `setAppIds`); un-ticking it clears the lock, so an operator who ticked
 * it by mistake can undo it. A real publication is the operator's responsibility.
 */
export async function setChecklistFlag(
  tenantId: string,
  key: string,
  done: boolean,
  deps: AppDeps = {},
): Promise<void> {
  const body = checklistBodySchema.safeParse({ done });
  const manualKey = APP_CHECKLIST_MANUAL_KEYS.find((candidate) => candidate === key);
  if (!body.success || manualKey === undefined) return refuse();
  await (deps.app ?? pgAppStore).write(tenantId, (current) => {
    const patch: AppPatch = { [MANUAL_COLUMN[manualKey]]: done };
    if (manualKey === 'published') {
      patch.idsLockedAt = done
        ? (current.idsLockedAt ??
          (current.bundleId !== null && current.applicationId !== null ? new Date() : null))
        : null;
    }
    return patch;
  });
}
