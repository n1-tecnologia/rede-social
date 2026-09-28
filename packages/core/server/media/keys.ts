import { VARIANT_WIDTHS } from '@rede-social/contracts/media';

/**
 * Object-key helpers for the PRIVATE `media` bucket (MEDIA-01/TENANT-04, RESEARCH Pattern 1).
 * Pure: no database, no env, no Storage client — `./storage.ts` is the only file of this area that
 * talks to Storage, and `./service.ts` runs `assertTenantKey` before EVERY call into it (T-03-01/T-03-02).
 *
 * Layout — a pure function of `(tenantId, assetId, variant)`, with NO extension on the original:
 *   original:  `<tenant_id>/media/<assetId>/original`
 *   variants:  `<tenant_id>/media/<assetId>/w<width>.webp`
 *
 * The missing extension is the whole point. RESEARCH Pattern 1 writes `original.<ext>`, but the ext
 * is a ROW fact and would force the serving route into a database read; the mime lives in
 * `media_assets.mime` and in the Storage object's own `contentType` instead. With this layout
 * `GET /v1/media/{assetId}/{variant}` reads nothing: the key is built from the CALLER's tenant id,
 * so a tenant-B session asking for a tenant-A assetId looks under `<B>/media/<A's assetId>/…`, which
 * cannot exist. Cross-tenant refusal is structural rather than check-dependent.
 *
 * Variant keys are immutable by construction: `w320.webp` for a given assetId always carries the
 * same content, so a one-year `Cache-Control` is correct and a re-derivation upserts the same bytes.
 */

const MEDIA_PREFIX = '/media/';

export type ParsedVariant = { kind: 'original' } | { kind: 'variant'; width: number };

/** `<tenant_id>/media/<assetId>/` — the prefix the sweeper (03-08) deletes wholesale. */
export function mediaAssetPrefix(tenantId: string, assetId: string): string {
  return `${tenantId}${MEDIA_PREFIX}${assetId}/`;
}

/** `<tenant_id>/media/<assetId>/original` — no extension, on purpose (see the module docblock). */
export function mediaOriginalKey(tenantId: string, assetId: string): string {
  return `${mediaAssetPrefix(tenantId, assetId)}original`;
}

/** `<tenant_id>/media/<assetId>/w<width>.webp` */
export function mediaVariantKey(tenantId: string, assetId: string, width: number): string {
  return `${mediaAssetPrefix(tenantId, assetId)}w${width}.webp`;
}

/** `null` for anything outside `original` / `w<one of VARIANT_WIDTHS>` — path separators included. */
export function parseVariant(variant: string): ParsedVariant | null {
  if (variant === 'original') return { kind: 'original' };
  const match = /^w(\d{1,4})$/.exec(variant);
  if (!match) return null;
  const width = Number(match[1]);
  if (!(VARIANT_WIDTHS as readonly number[]).includes(width)) return null;
  return { kind: 'variant', width };
}

/** The key behind `(tenantId, assetId, variant)`, or `null` when the variant is not one of ours. */
export function mediaKeyFor(tenantId: string, assetId: string, variant: string): string | null {
  const parsed = parseVariant(variant);
  if (!parsed) return null;
  return parsed.kind === 'original'
    ? mediaOriginalKey(tenantId, assetId)
    : mediaVariantKey(tenantId, assetId, parsed.width);
}

/**
 * Throws unless `key` sits under the tenant's own `<tenant_id>/media/` prefix with no `..`, `//` or
 * `\` segment and a non-empty suffix. The body is `branding/upload.ts:assertTenantKey` verbatim with
 * the media prefix substituted: it already refuses the three traversal classes a fresh
 * implementation forgets. Called before EVERY Storage call — on start, complete, serve, derive and
 * delete — so an object of another tenant can never be read, written or removed through this lane
 * (T-03-01/T-03-02).
 */
export function assertTenantKey(key: string, tenantId: string): void {
  const prefix = `${tenantId}${MEDIA_PREFIX}`;
  if (
    !tenantId ||
    !key.startsWith(prefix) ||
    key.length === prefix.length ||
    key.includes('..') ||
    key.includes('//') ||
    key.includes('\\')
  ) {
    throw new Error(`media key outside the tenant prefix: ${key}`);
  }
}
