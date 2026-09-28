import {
  BRANDING_MAX_BYTES,
  type BrandColors,
  type BrandIconUrls,
  type BrandingColorsBody,
  type BrandingUpload,
  type BrandingUploadBody,
  type ContrastReport,
  contrastPasses,
  contrastReport,
  deriveBrandColors,
  mimeToExtension,
  type ResolvedBranding,
  resolveBranding,
  type TenantBranding,
} from '@rede-social/contracts';
import { eq, sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenantDomains, tenants } from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';
import {
  assertTenantKey,
  BRANDING_BUCKET,
  BRANDING_DERIVE_ICONS_QUEUE,
  BrandingImageError,
  brandingObjectKey,
  buildUploadId,
  type DeriveIconsPayload,
  deriveIconSet,
  type IconSet,
  iconObjectKeys,
  inspectBrandingImage,
  objectKeyFromPublicUrl,
  parseUploadId,
} from '../branding/index';
import { env } from '../env';
import { ApiError } from '../http/api-error';
import { enqueueInTx } from '../jobs/boss';
import { supabaseAdmin } from '../supabase-admin';
import { invalidateTenantHost } from '../tenancy/tenant-host';
import { logFor, type PlatformActor } from './invites';

/**
 * Tenant branding through the platform lane (D-27/D-28/D-25/D-41) — the admin-lane service behind
 * `/v1/platform/tenants/{id}/branding/*` AND the `kernel.branding-derive-icons` worker job. This is
 * the ONLY file of the branding capability that imports `supabaseAdmin` and `withAdminTx` (Biome
 * enforces it): every Storage call and every `tenants.branding` write lives here; `../branding/*`
 * stays pure.
 *
 * Invariants (pinned by `platform-branding.test.ts`):
 *  - every object key is built server-side from the validated path tenant id and asserted with
 *    `assertTenantKey` before ANY Storage call (T-02-83/T-02-84) — the key, never the upload id's
 *    uuid alone, decides which prefix is touched;
 *  - the request path decodes the image HEADER only and enqueues; derivation (resize, composite,
 *    ICO, five uploads) runs in the worker (T-02-80, prohibition);
 *  - a file whose bytes are not an image of the declared format never becomes a logo: the object
 *    is removed and the request refused (T-02-81/T-02-82);
 *  - the icon write is optimistic on `iconVersion`: the loser of a race reports `superseded` and
 *    writes nothing (T-02-88);
 *  - every mutation invalidates the host cache for EVERY host of the tenant (TENANT-02, T-02-89).
 */

/** Signed upload URLs are valid for two hours (storage-js `createSignedUploadUrl` docblock). */
export const BRANDING_UPLOAD_TTL_S = 7200;
/** Versioned derived keys are immutable — one year is the correct cache lifetime. */
const ICON_CACHE_CONTROL = '31536000';

const bucket = () => supabaseAdmin.storage.from(BRANDING_BUCKET);
const publicUrlFor = (key: string): string => bucket().getPublicUrl(key).data.publicUrl;
const storageOrigin = (): string => env.SUPABASE_URL;

/** Test seam (PATTERNS Analog B): runs between the derivation and the optimistic write. */
export const brandingInternals = {
  async beforeIconWrite(): Promise<void> {},
};

type TenantRow = { id: string; branding: TenantBranding };

async function loadTenant(tx: Tx, tenantId: string): Promise<TenantRow | undefined> {
  const rows = await tx
    .select({ id: tenants.id, branding: tenants.branding })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return rows[0];
}

async function tenantExists(tenantId: string): Promise<boolean> {
  return withAdminTx(async (tx) => (await loadTenant(tx, tenantId)) !== undefined);
}

/** Every host of the tenant leaves the in-process host cache, so the next resolution sees the new row. */
export async function invalidateAllTenantHosts(tenantId: string): Promise<void> {
  const hosts = await withAdminTx(async (tx) =>
    tx
      .select({ host: tenantDomains.host })
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, tenantId)),
  );
  for (const row of hosts) invalidateTenantHost(row.host);
}

/** ONE waiting derivation per tenant: `singletonKey = tenantId` under the `short` policy drops a duplicate while a job is still `created`. */
async function enqueueDerivation(
  tx: Tx,
  tenantId: string,
  payload: Omit<DeriveIconsPayload, 'tenantId'>,
  opts: { startAfter?: number } = {},
): Promise<void> {
  await enqueueInTx(
    tx,
    BRANDING_DERIVE_ICONS_QUEUE,
    { tenantId, ...payload } satisfies DeriveIconsPayload,
    { singletonKey: tenantId, ...opts },
  );
}

/** Best-effort removal of a rejected or replaced object; never throws (the caller already has its answer). */
async function removeQuietly(
  key: string,
  tenantId: string,
  actor: PlatformActor | undefined,
  event: string,
): Promise<void> {
  try {
    assertTenantKey(key, tenantId);
    const { error } = await bucket().remove([key]);
    if (error) throw error;
  } catch (error) {
    logFor(actor, 'platform.branding').warn(
      { event, tenantId, key, err: error instanceof Error ? error.message : String(error) },
      'could not remove a branding object',
    );
  }
}

/**
 * `POST /v1/platform/tenants/{id}/branding/uploads` (D-27): mints a signed Storage URL for
 * `<tenant_id>/branding/<uuid>.<ext>`. Nothing is written to the database — the upload id
 * (`<kind>-<uuid>.<ext>`) is everything `complete` needs, and the object's existence under the
 * tenant prefix is the proof of a legitimate upload. Order: 404 (tenant) → 413 (size).
 */
export async function startBrandingUpload(
  tenantId: string,
  body: BrandingUploadBody,
  actor: PlatformActor,
): Promise<BrandingUpload> {
  const log = logFor(actor, 'platform.branding');
  if (!(await tenantExists(tenantId))) throw new ApiError(404, 'NOT_FOUND');
  if (body.size > BRANDING_MAX_BYTES) {
    throw new ApiError(413, 'VALIDATION_FAILED', {
      size: 'too_large',
      maxBytes: BRANDING_MAX_BYTES,
    });
  }

  const ext = mimeToExtension[body.mime];
  const uploadId = buildUploadId(body.kind, ext);
  const parsed = parseUploadId(uploadId);
  if (!parsed) throw new Error('buildUploadId produced an unparsable id');
  const key = brandingObjectKey(tenantId, parsed.uuid, ext);
  assertTenantKey(key, tenantId);

  const { data, error } = await bucket().createSignedUploadUrl(key);
  if (error || !data) {
    log.error(
      {
        event: 'platform.branding.upload_start_failed',
        userId: actor.userId,
        tenantId,
        key,
        err: error?.message,
      },
      'could not mint a signed upload url',
    );
    throw new ApiError(500, 'INTERNAL');
  }

  log.info(
    {
      event: 'platform.branding.upload_start',
      userId: actor.userId,
      tenantId,
      kind: body.kind,
      mime: body.mime,
      size: body.size,
      key,
    },
    'branding upload started',
  );
  return {
    uploadId,
    signedUrl: data.signedUrl,
    path: key,
    maxBytes: BRANDING_MAX_BYTES,
    expiresInSeconds: BRANDING_UPLOAD_TTL_S,
  };
}

/**
 * `POST …/branding/uploads/{uploadId}/complete` (D-27/D-28): the object must exist under THIS
 * tenant's prefix (404 `{ upload: 'object_missing' }` otherwise — tenant B completing A's id looks
 * under B's prefix and finds nothing), its Storage metadata is re-read (size cap, declared content
 * type), only the image HEADER is decoded (format must match the extension, SVG must pass the
 * safety scan) and a refused file is removed from the bucket. Then ONE transaction records the
 * `logoUrl` / `iconUrl`, bumps `iconVersion` and enqueues the derivation job.
 */
export async function completeBrandingUpload(
  tenantId: string,
  uploadId: string,
  actor: PlatformActor,
): Promise<{ iconVersion: number }> {
  const log = logFor(actor, 'platform.branding');
  const parsed = parseUploadId(uploadId);
  if (!parsed) throw new ApiError(404, 'NOT_FOUND');
  if (!(await tenantExists(tenantId))) throw new ApiError(404, 'NOT_FOUND');

  const key = brandingObjectKey(tenantId, parsed.uuid, parsed.ext);
  assertTenantKey(key, tenantId);

  const reject = async (reason: string): Promise<never> => {
    await removeQuietly(key, tenantId, actor, 'platform.branding.upload_remove_failed');
    log.warn(
      { event: 'platform.branding.upload_rejected', userId: actor.userId, tenantId, key, reason },
      'branding upload rejected',
    );
    throw new ApiError(400, 'VALIDATION_FAILED', { upload: reason });
  };

  const info = await bucket().info(key);
  if (info.error || !info.data) throw new ApiError(404, 'NOT_FOUND', { upload: 'object_missing' });
  if (typeof info.data.size === 'number' && info.data.size > BRANDING_MAX_BYTES) {
    await reject('too_large');
  }
  if (info.data.contentType && info.data.contentType !== parsed.mime) {
    await reject('format_mismatch');
  }

  const download = await bucket().download(key);
  if (download.error || !download.data) {
    throw new ApiError(404, 'NOT_FOUND', { upload: 'object_missing' });
  }
  const buf = Buffer.from(await download.data.arrayBuffer());
  if (buf.length > BRANDING_MAX_BYTES) await reject('too_large');
  try {
    await inspectBrandingImage(buf, parsed.mime);
  } catch (error) {
    if (error instanceof BrandingImageError) await reject(error.reason);
    throw error;
  }

  const url = publicUrlFor(key);
  const iconVersion = await withAdminTx(async (tx) => {
    const row = await loadTenant(tx, tenantId);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    const current = resolveBranding(row.branding);
    const next: ResolvedBranding = {
      ...current,
      iconVersion: current.iconVersion + 1,
      ...(parsed.kind === 'logo' ? { logoUrl: url } : { iconUrl: url }),
    };
    await tx
      .update(tenants)
      .set({ branding: next, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
    await enqueueDerivation(tx, tenantId, { iconVersion: next.iconVersion, attempt: 0 });
    return next.iconVersion;
  });

  await invalidateAllTenantHosts(tenantId);
  log.info(
    {
      event: 'platform.branding.complete',
      userId: actor.userId,
      tenantId,
      kind: parsed.kind,
      key,
      iconVersion,
    },
    'branding upload completed',
  );
  return { iconVersion };
}

export type DeriveOutcome = 'derived' | 'superseded' | 'no_source' | 'tenant_gone';
export type DeriveResult = { outcome: DeriveOutcome; iconVersion: number };
type IconSource = 'override' | 'logo' | 'previous_i512';

const extensionMime: Record<string, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  jpg: 'image/jpeg',
};

function mimeFromKey(key: string): string {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return extensionMime[ext] ?? 'image/png';
}

/** Override icon → logo → the previous transparent 512 render (what a colour change on a seed tenant derives from). */
function resolveIconSource(
  branding: ResolvedBranding,
  tenantId: string,
): { key: string; source: IconSource } | null {
  const origin = storageOrigin();
  const override = objectKeyFromPublicUrl(branding.iconUrl, tenantId, origin);
  if (override) return { key: override, source: 'override' };
  const logo = objectKeyFromPublicUrl(branding.logoUrl, tenantId, origin);
  if (logo) return { key: logo, source: 'logo' };
  const previous = objectKeyFromPublicUrl(branding.iconUrls?.i512, tenantId, origin);
  if (previous) return { key: previous, source: 'previous_i512' };
  return null;
}

/**
 * Optimistic icon write: only when `iconVersion` is still the version the derivation read. Zero
 * rows → a newer upload/colour change superseded this run (its own job derives).
 */
async function writeIconsIfCurrent(
  tenantId: string,
  version: number,
  icons: { faviconUrl: string | null; iconUrls: BrandIconUrls | null },
): Promise<boolean> {
  const patch = JSON.stringify({ faviconUrl: icons.faviconUrl, iconUrls: icons.iconUrls });
  const rows = await withAdminTx(
    async (tx) =>
      (await tx.execute(sql`
        update public.tenants
           set branding = branding || ${patch}::jsonb,
               updated_at = now()
         where id = ${tenantId}::uuid
           and coalesce((branding->>'iconVersion')::int, 0) = ${version}
     returning id`)) as unknown as { id: string }[],
  );
  return rows.length > 0;
}

/**
 * Uploads a derived set under `<tenant_id>/branding/icons/<iconVersion>/` (upsert, immutable
 * cache) and answers the public URLs. Any Storage error throws — the job re-arms. Exported for the
 * seed, which derives the two seed tenants' sets at version 1.
 */
export async function uploadIconSet(
  tenantId: string,
  iconVersion: number,
  set: IconSet,
): Promise<{ faviconUrl: string; iconUrls: BrandIconUrls }> {
  const keys = iconObjectKeys(tenantId, iconVersion);
  const files: [string, Buffer, string][] = [
    [keys.favicon, set.favicon, 'image/x-icon'],
    [keys.i192, set.i192, 'image/png'],
    [keys.i512, set.i512, 'image/png'],
    [keys.maskable512, set.maskable512, 'image/png'],
    [keys.apple180, set.apple180, 'image/png'],
  ];
  for (const [key] of files) assertTenantKey(key, tenantId);
  await Promise.all(
    files.map(async ([key, buffer, contentType]) => {
      const { error } = await bucket().upload(key, buffer, {
        contentType,
        upsert: true,
        cacheControl: ICON_CACHE_CONTROL,
      });
      if (error) throw new Error(`branding icon upload failed for ${key}: ${error.message}`);
    }),
  );
  return {
    faviconUrl: publicUrlFor(keys.favicon),
    iconUrls: {
      i192: publicUrlFor(keys.i192),
      i512: publicUrlFor(keys.i512),
      maskable512: publicUrlFor(keys.maskable512),
      apple180: publicUrlFor(keys.apple180),
    },
  };
}

/**
 * The worker's derivation (D-28): reads the CURRENT row, picks the source (override → logo →
 * previous 512 render), derives with `deriveIconSet`, uploads under the versioned prefix and
 * writes `faviconUrl` + `iconUrls` only if `iconVersion` is unchanged. `no_source` clears the set
 * the same optimistic way. Throws on Storage/decoder failures so the job wrapper can re-arm.
 */
export async function deriveTenantIcons(
  tenantId: string,
  opts: { actor: PlatformActor },
): Promise<DeriveResult> {
  const log = logFor(opts.actor, 'platform.branding');
  const row = await withAdminTx((tx) => loadTenant(tx, tenantId));
  if (!row) return { outcome: 'tenant_gone', iconVersion: -1 };

  const branding = resolveBranding(row.branding);
  const version = branding.iconVersion;
  const source = resolveIconSource(branding, tenantId);

  let icons: { faviconUrl: string | null; iconUrls: BrandIconUrls | null };
  if (!source) {
    icons = { faviconUrl: null, iconUrls: null };
  } else {
    assertTenantKey(source.key, tenantId);
    const download = await bucket().download(source.key);
    if (download.error || !download.data) {
      throw new Error(`branding source missing: ${source.key} (${download.error?.message})`);
    }
    const buf = Buffer.from(await download.data.arrayBuffer());
    const set = await deriveIconSet(buf, {
      primaryHex: branding.colors.primary,
      mime: mimeFromKey(source.key),
    });
    await brandingInternals.beforeIconWrite();
    icons = await uploadIconSet(tenantId, version, set);
  }

  const written = await writeIconsIfCurrent(tenantId, version, icons);
  const outcome: DeriveOutcome = !written ? 'superseded' : source ? 'derived' : 'no_source';
  if (written) await invalidateAllTenantHosts(tenantId);

  log.info(
    {
      event: 'platform.branding.icons_derived',
      userId: opts.actor.userId,
      tenantId,
      iconVersion: version,
      outcome,
      source: source?.source ?? null,
    },
    'branding icons derived',
  );
  return { outcome, iconVersion: version };
}

/** Crash re-arm from the job wrapper: one deferred job per tenant (`iconVersion: -1` = re-read the row). */
export async function requeueIconDerivation(tenantId: string, attempt: number): Promise<void> {
  await withAdminTx((tx) =>
    enqueueDerivation(tx, tenantId, { iconVersion: -1, attempt }, { startAfter: 60 * attempt }),
  );
}

export type ApplyBrandColorsResult = {
  branding: ResolvedBranding;
  report: ContrastReport;
  /** True when the primary changed: the maskable icon background follows it, so the set is re-derived. */
  rederive: boolean;
};

/**
 * The ONE persistence path for the two D-25 source colours (D-25/D-41): recomputes the persisted
 * derivations with `deriveBrandColors`, evaluates the report, and bumps `iconVersion` + enqueues a
 * derivation ONLY when the primary changed (the maskable background is the only icon input that
 * depends on colours; a secondary-only change re-derives nothing). Runs INSIDE the caller's
 * transaction — `setBrandingColors` (the panel's `PUT …/branding/colors`) and 02-05's
 * `updateTenant` (`PATCH …/tenants/{id}`) both call it; the caller invalidates hosts after commit.
 */
export async function applyBrandColors(
  tx: Tx,
  tenant: { id: string; branding: unknown },
  colors: { primary: string; secondary: string },
  _actor: PlatformActor,
): Promise<ApplyBrandColorsResult> {
  const derived: BrandColors = deriveBrandColors(colors);
  const report = contrastReport(derived);
  const current = resolveBranding(tenant.branding);
  const rederive = derived.primary !== current.colors.primary;
  const next: ResolvedBranding = {
    ...current,
    colors: derived,
    iconVersion: rederive ? current.iconVersion + 1 : current.iconVersion,
  };
  await tx
    .update(tenants)
    .set({ branding: next, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id));
  if (rederive) {
    await enqueueDerivation(tx, tenant.id, { iconVersion: next.iconVersion, attempt: 0 });
  }
  return { branding: next, report, rederive };
}

/**
 * `PUT /v1/platform/tenants/{id}/branding/colors` (D-41): the report is evaluated in BOTH modes
 * BEFORE any write; when a check fails and `confirmLowContrast` is not `true`, nothing is persisted
 * and the answer is 400 `{ confirmLowContrast: 'required', contrastReport }` so the panel can warn
 * and ask. No colour pair is ever refused outright — the ONLY refusal is the missing confirmation,
 * and a confirmed low-contrast save is logged with `lowContrastConfirmed: true` (T-02-87).
 */
export async function setBrandingColors(
  tenantId: string,
  body: BrandingColorsBody,
  actor: PlatformActor,
): Promise<ApplyBrandColorsResult> {
  const report = contrastReport(deriveBrandColors(body));
  const lowContrast = !contrastPasses(report);
  if (lowContrast && body.confirmLowContrast !== true) {
    throw new ApiError(400, 'VALIDATION_FAILED', {
      confirmLowContrast: 'required',
      contrastReport: report,
    });
  }

  const applied = await withAdminTx(async (tx) => {
    const row = await loadTenant(tx, tenantId);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    return applyBrandColors(tx, row, body, actor);
  });

  await invalidateAllTenantHosts(tenantId);
  logFor(actor, 'platform.branding').info(
    {
      event: 'platform.branding.colors',
      userId: actor.userId,
      tenantId,
      primary: applied.branding.colors.primary,
      secondary: applied.branding.colors.secondary,
      lowContrast,
      lowContrastConfirmed: lowContrast && body.confirmLowContrast === true,
      rederive: applied.rederive,
      iconVersion: applied.branding.iconVersion,
    },
    'branding colours saved',
  );
  return applied;
}

/**
 * `DELETE /v1/platform/tenants/{id}/branding/icon` (D-28): clears the square override, bumps
 * `iconVersion` and enqueues a derivation from the logo; the previous object is removed best-effort
 * after commit. Idempotent: with no override nothing is written (the unchanged detail is answered).
 */
export async function removeIconOverride(
  tenantId: string,
  actor: PlatformActor,
): Promise<{ removed: boolean; iconVersion: number }> {
  const log = logFor(actor, 'platform.branding');
  const result = await withAdminTx(async (tx) => {
    const row = await loadTenant(tx, tenantId);
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    const current = resolveBranding(row.branding);
    if (current.iconUrl === null) {
      return { removed: false, iconVersion: current.iconVersion, previousKey: null };
    }
    const previousKey = objectKeyFromPublicUrl(current.iconUrl, tenantId, storageOrigin());
    const next: ResolvedBranding = {
      ...current,
      iconUrl: null,
      iconVersion: current.iconVersion + 1,
    };
    await tx
      .update(tenants)
      .set({ branding: next, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
    await enqueueDerivation(tx, tenantId, { iconVersion: next.iconVersion, attempt: 0 });
    return { removed: true, iconVersion: next.iconVersion, previousKey };
  });

  if (!result.removed) return { removed: false, iconVersion: result.iconVersion };

  await invalidateAllTenantHosts(tenantId);
  if (result.previousKey) {
    await removeQuietly(
      result.previousKey,
      tenantId,
      actor,
      'platform.branding.icon_remove_failed',
    );
  }
  log.info(
    {
      event: 'platform.branding.icon_removed',
      userId: actor.userId,
      tenantId,
      iconVersion: result.iconVersion,
    },
    'branding icon override removed',
  );
  return { removed: true, iconVersion: result.iconVersion };
}
