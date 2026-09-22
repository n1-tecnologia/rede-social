import { MEDIA_BUCKET } from '@tria/contracts/media';
import type { Logger } from 'pino';
import { supabaseAdmin } from '../supabase-admin';

/**
 * The ONLY file of the media area that imports `supabaseAdmin` (grep-pinned by this plan's
 * acceptance criteria; Biome widens the admin lane to `packages/core/server/media/**`, this keeps it
 * confined WITHIN the area). Nothing here knows about tenants, rows or HTTP.
 *
 * CONTRACT: every exported function takes an ALREADY-ASSERTED key. The caller — always
 * `./service.ts` or `./derive-job.ts` — runs `assertTenantKey(key, ctx.tenantId)` first, so this
 * file never has to decide which prefix it is allowed to touch (T-03-01/T-03-02).
 *
 * The bucket is PRIVATE and carries ZERO `storage.objects` policies (R-15, pinned by
 * `supabase/tests/070-media-bucket.sql`): the browser never holds a Supabase JWT for Storage, so a
 * policy would grant nothing that is used while creating a latent widening.
 */

/** Signed READ URLs live an hour; the in-process memo below expires well before that. */
export const MEDIA_SIGNED_READ_TTL_S = 3600;
/** Memo TTL — comfortably under the signed TTL, so a handed-out URL is never close to expiry. */
const MEDIA_SIGNED_READ_MEMO_MS = 3000 * 1000;
/** Variant keys are immutable by construction, so a year is the correct lifetime. */
export const MEDIA_VARIANT_CACHE_CONTROL = '31536000';

const bucket = () => supabaseAdmin.storage.from(MEDIA_BUCKET);

/**
 * The Phase 1/2 host-cache shape: a module `Map` whose TTL IS the invalidation. A feed of 20 images
 * costs at most 20 Storage sign calls per instance per 50 minutes instead of one per render.
 */
const signedReads = new Map<string, { url: string; expiresAt: number }>();

export type ObjectInfo = { size: number | null; contentType: string | null };

export type SignedUpload = { signedUrl: string; token: string; path: string };

/** A signed PUT/TUS target for `key`. `token` is what `tus-js-client` needs in `x-signature`. */
export async function signUpload(key: string): Promise<SignedUpload> {
  const { data, error } = await bucket().createSignedUploadUrl(key);
  if (error || !data) {
    throw new Error(`could not mint a signed upload url: ${error?.message ?? 'no data'}`);
  }
  return { signedUrl: data.signedUrl, token: data.token, path: data.path };
}

/** A signed READ url for `key`, memoised. Throws when Storage has no such object. */
export async function signRead(key: string): Promise<string> {
  const hit = signedReads.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.url;
  const { data, error } = await bucket().createSignedUrl(key, MEDIA_SIGNED_READ_TTL_S);
  if (error || !data) {
    throw new Error(`could not sign a read url: ${error?.message ?? 'no data'}`);
  }
  signedReads.set(key, { url: data.signedUrl, expiresAt: now + MEDIA_SIGNED_READ_MEMO_MS });
  return data.signedUrl;
}

/** Drops memoised URLs for `key` (or, with a trailing `/`, for a whole asset prefix). */
export function invalidateSignedUrl(key: string): void {
  if (key.endsWith('/')) {
    for (const candidate of [...signedReads.keys()]) {
      if (candidate.startsWith(key)) signedReads.delete(candidate);
    }
    return;
  }
  signedReads.delete(key);
}

/** Storage's own record of the object — the size and content type `complete` re-reads. */
export async function objectInfo(key: string): Promise<ObjectInfo | null> {
  const { data, error } = await bucket().info(key);
  if (error || !data) return null;
  return {
    size: typeof data.size === 'number' ? data.size : null,
    contentType: typeof data.contentType === 'string' ? data.contentType : null,
  };
}

/**
 * The object's bytes, or `null` when it is not there. `Blob.bytes()` rather than the ArrayBuffer
 * round-trip, so the whole broker can be grep-asserted to contain no body-parsing call at all —
 * the one property that keeps member uploads from ever transiting Cloud Run (CLAUDE.md §4).
 */
export async function downloadObject(key: string): Promise<Buffer | null> {
  const { data, error } = await bucket().download(key);
  if (error || !data) return null;
  return Buffer.from(await data.bytes());
}

export type PutOptions = { contentType: string; cacheControl?: string };

/** Upsert: a re-derivation writes the same immutable key with the same content. */
export async function putObject(key: string, body: Buffer, opts: PutOptions): Promise<void> {
  const { error } = await bucket().upload(key, new Uint8Array(body), {
    contentType: opts.contentType,
    cacheControl: opts.cacheControl ?? MEDIA_VARIANT_CACHE_CONTROL,
    upsert: true,
  });
  if (error) throw new Error(`could not upload ${key}: ${error.message}`);
}

/**
 * Every object key directly under `prefix` (03-08, the sweeper's "delete ALL of its bytes" half).
 *
 * `@supabase/storage-js` has no "delete a prefix" call: you list the folder and hand the names to
 * `remove`. `list` returns a name RELATIVE to the prefix, so the keys are rebuilt here — the caller
 * never has to know that. Folder entries (`id === null`) are skipped: an asset prefix is flat
 * (`original` plus `w<width>.webp`), so a folder there would not be ours to delete anyway.
 *
 * Bounded by `limit`: an asset has at most one original and the purpose's width ladder, so the
 * default is already an order of magnitude of headroom, and an unbounded list is never useful here.
 */
export async function listObjects(prefix: string, limit = 100): Promise<string[]> {
  // Supabase lists a FOLDER: `a/b` and `a/b/` are the same folder, but the trailing slash would be
  // echoed into the search prefix, so it is stripped before the call and re-added when rebuilding.
  const folder = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const { data, error } = await bucket().list(folder, { limit });
  if (error) throw new Error(`could not list ${folder}: ${error.message}`);
  return (data ?? [])
    .filter((entry) => entry.id !== null)
    .map((entry) => `${folder}/${entry.name}`);
}

export async function removeObjects(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const { error } = await bucket().remove([...keys]);
  if (error) throw new Error(`could not remove media objects: ${error.message}`);
}

/** Best-effort removal of a rejected object; never throws — the caller already has its answer. */
export async function removeQuietly(
  keys: readonly string[],
  log: Logger,
  event: string,
): Promise<void> {
  try {
    await removeObjects(keys);
  } catch (error) {
    log.warn(
      { event, keys, err: error instanceof Error ? error.message : String(error) },
      'could not remove a media object',
    );
  }
}
