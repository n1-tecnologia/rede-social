import { MOVE_BUCKETS } from './plan';
import { assertUuid, MoveError, type StorageTotals } from './types';

/**
 * The Storage copy (09.2-22, D-534 step 5, T-09.2-96).
 *
 * Objects of a tenant live under the key prefix `<tenantId>/` in the `branding` (public) and `media`
 * (private) buckets. The copy lists the source under that prefix, downloads each object from the source
 * project's Storage and uploads it to the target's with its `contentType` and `cacheControl` and `upsert:
 * true`, at concurrency 4. An object whose size already matches the target's is skipped, so a run that died
 * half way resumes with the rest. Afterwards count and total bytes of both sides must be equal or the copy
 * fails with `verify_failed`.
 *
 * The ports are an interface so the tests use an in-memory pair and the engine never imports a driver;
 * `supabaseStoragePort` wraps a project's service-key client. A key outside the `<tenantId>/` prefix is never
 * touched, whatever a listing returns: it is dropped before any download.
 *
 * Mux videos are not in Storage (the rows hold the playback id); bytes of `VIDEO_PROVIDER=fake` move with
 * the bucket. Each object is held in memory while it moves (Supabase caps a file at 50 MB on the pilot plan).
 */

export type StorageListing = { key: string; size: number };
export type StorageObject = {
  bytes: Uint8Array;
  contentType: string | null;
  /** Seconds, as the upload API takes it (`"3600"`), or `null` when the object has none. */
  cacheControl: string | null;
};
export type UploadOptions = {
  contentType: string | null;
  cacheControl: string | null;
  upsert: true;
};

export interface StoragePort {
  list(bucket: string, prefix: string): AsyncIterable<StorageListing>;
  download(bucket: string, key: string): Promise<StorageObject>;
  upload(bucket: string, key: string, body: Uint8Array, options: UploadOptions): Promise<void>;
  info(bucket: string, key: string): Promise<{ size: number } | null>;
}

export const DEFAULT_STORAGE_CONCURRENCY = 4;

export type CopyStorageOptions = {
  source: StoragePort;
  target: StoragePort;
  tenantId: string;
  concurrency?: number;
  /** Defaults to `branding` and `media`. */
  buckets?: readonly string[];
};

export type CopyStorageReport = { copied: number; skipped: number; bytes: number };

/** Lists the objects of one bucket under the tenant's prefix, dropping anything outside it. */
async function listTenant(
  port: StoragePort,
  bucket: string,
  tenantId: string,
): Promise<StorageListing[]> {
  const prefix = `${tenantId}/`;
  const found: StorageListing[] = [];
  for await (const entry of port.list(bucket, prefix)) {
    if (entry.key.startsWith(prefix)) found.push(entry);
  }
  return found;
}

/** Count and total bytes of the tenant's objects in `buckets` through `port`. */
export async function storageTotalsOf(
  port: StoragePort,
  tenantId: string,
  buckets: readonly string[] = MOVE_BUCKETS,
): Promise<StorageTotals> {
  let objects = 0;
  let bytes = 0;
  for (const bucket of buckets) {
    for (const entry of await listTenant(port, bucket, assertUuid(tenantId))) {
      objects += 1;
      bytes += entry.size;
    }
  }
  return { objects, bytes };
}

/** Runs `task` over `items` with at most `limit` in flight; the first failure stops starting new work. */
async function pool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: unknown;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed) {
      const index = next;
      next += 1;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      try {
        await task(item);
      } catch (error) {
        failed = true;
        failure = error;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed) throw failure;
}

export async function copyStorage(options: CopyStorageOptions): Promise<CopyStorageReport> {
  const tenantId = assertUuid(options.tenantId);
  const buckets = options.buckets ?? MOVE_BUCKETS;
  const limit = options.concurrency ?? DEFAULT_STORAGE_CONCURRENCY;
  const report: CopyStorageReport = { copied: 0, skipped: 0, bytes: 0 };

  for (const bucket of buckets) {
    const objects = await listTenant(options.source, bucket, tenantId);
    await pool(objects, limit, async (entry) => {
      const there = await options.target.info(bucket, entry.key);
      if (there && there.size === entry.size) {
        report.skipped += 1;
        report.bytes += entry.size;
        return;
      }
      const object = await options.source.download(bucket, entry.key);
      await options.target.upload(bucket, entry.key, object.bytes, {
        contentType: object.contentType,
        cacheControl: object.cacheControl,
        upsert: true,
      });
      report.copied += 1;
      report.bytes += entry.size;
    });
  }

  const [from, to] = await Promise.all([
    storageTotalsOf(options.source, tenantId, buckets),
    storageTotalsOf(options.target, tenantId, buckets),
  ]);
  if (from.objects !== to.objects || from.bytes !== to.bytes) {
    throw new MoveError('verify_failed', ['storage'], { source: from, target: to });
  }
  return report;
}

// ---------------------------------------------------------------------------------------------------------
// The real port
// ---------------------------------------------------------------------------------------------------------

/** The slice of a `@supabase/supabase-js` client the port uses; a test injects a recorder. */
export type StorageClientLike = {
  storage: {
    from(bucket: string): {
      list(
        path: string,
        options: { limit: number; offset: number },
      ): Promise<{
        data: { name: string; id: string | null; metadata?: { size?: number } | null }[] | null;
        error: { message: string } | null;
      }>;
      download(path: string): Promise<{
        data: { bytes(): Promise<Uint8Array>; type?: string } | null;
        error: { message: string } | null;
      }>;
      info(path: string): Promise<{
        data: { size?: number; contentType?: string; cacheControl?: string } | null;
        error: { message: string } | null;
      }>;
      upload(
        path: string,
        body: Uint8Array,
        options: { contentType?: string; cacheControl?: string; upsert: boolean },
      ): Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

const PAGE = 100;

/** Storage reports `max-age=3600`; the upload API takes `3600`. */
function cacheSeconds(value: string | undefined | null): string | null {
  if (!value) return null;
  const match = /max-age=(\d+)/.exec(value);
  if (match?.[1]) return match[1];
  return /^\d+$/.test(value) ? value : null;
}

/**
 * Wraps a project's service-key client. The message of every failure is a fixed phrase: Storage errors can
 * quote a key, and a key carries a tenant id (not a secret, but nothing needs it in a log).
 */
export function supabaseStoragePort(client: StorageClientLike): StoragePort {
  return {
    async *list(bucket, prefix) {
      // `list` is one folder at a time: walk folders (entries without an id) depth first.
      const folders = [prefix.replace(/\/+$/, '')];
      while (folders.length > 0) {
        const folder = folders.pop() ?? '';
        for (let offset = 0; ; offset += PAGE) {
          const { data, error } = await client.storage
            .from(bucket)
            .list(folder, { limit: PAGE, offset });
          if (error) throw new Error('storage list failed');
          const entries = data ?? [];
          for (const entry of entries) {
            const key = `${folder}/${entry.name}`;
            if (entry.id === null) folders.push(key);
            else yield { key, size: Number(entry.metadata?.size ?? 0) };
          }
          if (entries.length < PAGE) break;
        }
      }
    },
    async download(bucket, key) {
      const bucketClient = client.storage.from(bucket);
      const [file, meta] = await Promise.all([bucketClient.download(key), bucketClient.info(key)]);
      if (file.error || !file.data) throw new Error('storage download failed');
      return {
        bytes: await file.data.bytes(),
        contentType: meta.data?.contentType ?? file.data.type ?? null,
        cacheControl: cacheSeconds(meta.data?.cacheControl),
      };
    },
    async upload(bucket, key, body, options) {
      const { error } = await client.storage.from(bucket).upload(key, body, {
        ...(options.contentType ? { contentType: options.contentType } : {}),
        ...(options.cacheControl ? { cacheControl: options.cacheControl } : {}),
        upsert: options.upsert,
      });
      if (error) throw new Error('storage upload failed');
    },
    async info(bucket, key) {
      const { data, error } = await client.storage.from(bucket).info(key);
      if (error || !data || typeof data.size !== 'number') return null;
      return { size: data.size };
    },
  };
}
