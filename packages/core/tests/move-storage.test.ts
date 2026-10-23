import { describe, expect, it } from 'vitest';
import {
  copyStorage,
  type StorageClientLike,
  type StorageListing,
  type StoragePort,
  storageTotalsOf,
  supabaseStoragePort,
  type UploadOptions,
} from '../server/projects/move/copy-storage';
import { MoveError } from '../server/projects/move/types';

/**
 * 09.2-22: the Storage copy on an in-memory pair of ports, and the real port on an injected client. The copy
 * against the local stack's Storage is in `move-copy.test.ts`.
 */

const TENANT = 'e3cbdc5f-787a-4707-a0d6-2ceeeaddad9e';
const OTHER = '14357793-c06e-46e0-a8cf-bebe268937a4';

type Stored = { bytes: Uint8Array; contentType: string | null; cacheControl: string | null };

/** An in-memory bucket store that records what was asked of it. */
function memoryPort(initial: Record<string, Stored> = {}) {
  const objects = new Map<string, Stored>(Object.entries(initial)); // key: `${bucket}|${key}`
  const calls = { list: 0, download: [] as string[], upload: [] as string[], info: 0 };
  let inFlight = 0;
  let peak = 0;
  let failUploadOn: string | null = null;
  let leakForeignKeys = false;
  const port: StoragePort = {
    async *list(bucket, prefix) {
      calls.list += 1;
      for (const [composite, stored] of objects) {
        const [b, key] = composite.split('|') as [string, string];
        if (b !== bucket) continue;
        if (key.startsWith(prefix) || leakForeignKeys) {
          yield { key, size: stored.bytes.length } satisfies StorageListing;
        }
      }
    },
    async download(bucket, key) {
      calls.download.push(`${bucket}|${key}`);
      const stored = objects.get(`${bucket}|${key}`);
      if (!stored) throw new Error('missing');
      return { ...stored };
    },
    async upload(bucket, key, body, options: UploadOptions) {
      calls.upload.push(`${bucket}|${key}`);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      if (failUploadOn === key) throw new Error('boom');
      expect(options.upsert).toBe(true);
      objects.set(`${bucket}|${key}`, {
        bytes: body,
        contentType: options.contentType,
        cacheControl: options.cacheControl,
      });
    },
    async info(bucket, key) {
      calls.info += 1;
      const stored = objects.get(`${bucket}|${key}`);
      return stored ? { size: stored.bytes.length } : null;
    },
  };
  return {
    port,
    objects,
    calls,
    get peak() {
      return peak;
    },
    failUpload(key: string | null) {
      failUploadOn = key;
    },
    leakForeign() {
      leakForeignKeys = true;
    },
  };
}

const blob = (
  text: string,
  contentType = 'text/plain',
  cacheControl: string | null = '3600',
): Stored => ({
  bytes: new TextEncoder().encode(text),
  contentType,
  cacheControl,
});

describe('copyStorage (D-534 step 5)', () => {
  it('copies every object under the tenant prefix with its content type and cache control, upsert true', async () => {
    const from = memoryPort({
      [`branding|${TENANT}/branding/logo.png`]: blob('aaaa', 'image/png', '31536000'),
      [`media|${TENANT}/media/a/b/clip.mp4`]: blob('bbbbbbbb', 'video/mp4', null),
    });
    const to = memoryPort();
    const report = await copyStorage({ source: from.port, target: to.port, tenantId: TENANT });
    expect(report).toEqual({ copied: 2, skipped: 0, bytes: 12 });
    expect(to.objects.get(`branding|${TENANT}/branding/logo.png`)).toMatchObject({
      contentType: 'image/png',
      cacheControl: '31536000',
    });
    expect(to.objects.get(`media|${TENANT}/media/a/b/clip.mp4`)?.cacheControl).toBeNull();
    expect(await storageTotalsOf(to.port, TENANT)).toEqual({ objects: 2, bytes: 12 });
  });

  it('skips an object whose size already matches and downloads only the rest', async () => {
    const same = `${TENANT}/branding/same.png`;
    const fresh = `${TENANT}/branding/fresh.png`;
    const from = memoryPort({
      [`branding|${same}`]: blob('1234'),
      [`branding|${fresh}`]: blob('56789'),
    });
    const to = memoryPort({ [`branding|${same}`]: blob('abcd') });
    const report = await copyStorage({ source: from.port, target: to.port, tenantId: TENANT });
    expect(report).toEqual({ copied: 1, skipped: 1, bytes: 9 });
    expect(from.calls.download).toEqual([`branding|${fresh}`]);
    expect(to.calls.upload).toEqual([`branding|${fresh}`]);
  });

  it('resumes after a failed upload: the second run copies only what is missing', async () => {
    const keys = ['a', 'b', 'c'].map((name) => `${TENANT}/media/${name}.bin`);
    const from = memoryPort(
      Object.fromEntries(keys.map((key, i) => [`media|${key}`, blob('x'.repeat(i + 1))])),
    );
    const to = memoryPort();
    to.failUpload(keys[1] ?? null);
    await expect(
      copyStorage({ source: from.port, target: to.port, tenantId: TENANT, concurrency: 1 }),
    ).rejects.toThrow('boom');
    expect(to.objects.size).toBe(1); // 'a' made it, 'b' failed, 'c' was never started

    to.failUpload(null);
    const second = await copyStorage({
      source: from.port,
      target: to.port,
      tenantId: TENANT,
      concurrency: 1,
    });
    expect(second).toEqual({ copied: 2, skipped: 1, bytes: 6 });
    expect(to.objects.size).toBe(3);
  });

  it('fails with verify_failed when the final count or bytes differ', async () => {
    const key = `${TENANT}/media/a.bin`;
    const from = memoryPort({ [`media|${key}`]: blob('abc') });
    const to = memoryPort();
    // A target that "uploads" but stores a truncated body.
    const lossy: StoragePort = {
      ...to.port,
      upload: async (bucket, k, body, options) =>
        to.port.upload(bucket, k, body.slice(0, 1), options),
    };
    let caught: unknown;
    try {
      await copyStorage({ source: from.port, target: lossy, tenantId: TENANT });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MoveError);
    expect((caught as MoveError).code).toBe('verify_failed');
    expect((caught as MoveError).tables).toEqual(['storage']);
  });

  it('never touches a key outside the tenant prefix, even when the listing returns one', async () => {
    const mine = `${TENANT}/branding/mine.png`;
    const foreign = `${OTHER}/branding/theirs.png`;
    const from = memoryPort({
      [`branding|${mine}`]: blob('mine'),
      [`branding|${foreign}`]: blob('theirs'),
    });
    from.leakForeign();
    const to = memoryPort();
    const report = await copyStorage({ source: from.port, target: to.port, tenantId: TENANT });
    expect(report.copied).toBe(1);
    expect(from.calls.download).toEqual([`branding|${mine}`]);
    expect([...to.objects.keys()]).toEqual([`branding|${mine}`]);
  });

  it('keeps at most four transfers in flight by default and honours a lower bound', async () => {
    const entries = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`media|${TENANT}/media/${i}.bin`, blob(`o${i}`)]),
    );
    const wide = memoryPort(entries);
    const target = memoryPort();
    await copyStorage({ source: wide.port, target: target.port, tenantId: TENANT });
    expect(target.peak).toBeGreaterThan(1);
    expect(target.peak).toBeLessThanOrEqual(4);

    const narrow = memoryPort();
    await copyStorage({ source: wide.port, target: narrow.port, tenantId: TENANT, concurrency: 2 });
    expect(narrow.peak).toBeLessThanOrEqual(2);
  });

  it('refuses a tenant id that is not a uuid before listing anything', async () => {
    const from = memoryPort();
    await expect(
      copyStorage({ source: from.port, target: memoryPort().port, tenantId: '../etc' }),
    ).rejects.toThrow('invalid tenant id');
    expect(from.calls.list).toBe(0);
  });
});

/** A client double for `supabaseStoragePort`: a folder tree, pagination and metadata. */
function clientDouble(tree: Record<string, { name: string; id: string | null; size?: number }[]>) {
  const calls = { list: [] as string[], uploads: [] as { path: string; options: unknown }[] };
  const client: StorageClientLike = {
    storage: {
      from: () => ({
        async list(path, { limit, offset }) {
          calls.list.push(`${path}@${offset}`);
          const all = tree[path] ?? [];
          const page = all.slice(offset, offset + limit);
          return {
            data: page.map((entry) => ({
              name: entry.name,
              id: entry.id,
              metadata: entry.size === undefined ? null : { size: entry.size },
            })),
            error: null,
          };
        },
        async download(path) {
          return {
            data: { bytes: async () => new TextEncoder().encode(path), type: 'text/plain' },
            error: null,
          };
        },
        async info() {
          return {
            data: { size: 4, contentType: 'image/png', cacheControl: 'max-age=3600' },
            error: null,
          };
        },
        async upload(path, _body, options) {
          calls.uploads.push({ path, options });
          return { data: {}, error: null };
        },
      }),
    },
  };
  return { client, calls };
}

describe('supabaseStoragePort', () => {
  it('walks folders depth first, paginates by 100 and reports sizes', async () => {
    const files = Array.from({ length: 130 }, (_, i) => ({
      name: `f${i}.png`,
      id: `id${i}`,
      size: 2,
    }));
    const { client, calls } = clientDouble({
      [TENANT]: [
        { name: 'branding', id: null },
        { name: 'media', id: null },
      ],
      [`${TENANT}/branding`]: files,
      [`${TENANT}/media`]: [{ name: 'deep', id: null }],
      [`${TENANT}/media/deep`]: [{ name: 'clip.bin', id: 'x', size: 7 }],
    });
    const port = supabaseStoragePort(client);
    const listed: StorageListing[] = [];
    for await (const entry of port.list('media', `${TENANT}/`)) listed.push(entry);
    expect(listed).toHaveLength(131);
    expect(listed.filter((entry) => entry.key.includes('/media/deep/'))).toEqual([
      { key: `${TENANT}/media/deep/clip.bin`, size: 7 },
    ]);
    // The 130-file folder took two pages.
    expect(calls.list).toContain(`${TENANT}/branding@0`);
    expect(calls.list).toContain(`${TENANT}/branding@100`);
  });

  it('converts max-age to the seconds the upload API takes, and sends upsert', async () => {
    const { client, calls } = clientDouble({});
    const port = supabaseStoragePort(client);
    const object = await port.download('branding', `${TENANT}/branding/a.png`);
    expect(object.contentType).toBe('image/png');
    expect(object.cacheControl).toBe('3600');
    await port.upload('branding', `${TENANT}/branding/a.png`, object.bytes, {
      contentType: object.contentType,
      cacheControl: object.cacheControl,
      upsert: true,
    });
    expect(calls.uploads[0]?.options).toEqual({
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: true,
    });
  });

  it('raises a fixed phrase on a failure, never the Storage message (it may quote a key)', async () => {
    const client: StorageClientLike = {
      storage: {
        from: () => ({
          list: async () => ({ data: null, error: { message: `boom ${TENANT}/secret.png` } }),
          download: async () => ({ data: null, error: { message: 'boom' } }),
          info: async () => ({ data: null, error: { message: 'boom' } }),
          upload: async () => ({ data: null, error: { message: `boom ${TENANT}/secret.png` } }),
        }),
      },
    };
    const port = supabaseStoragePort(client);
    await expect(async () => {
      for await (const _ of port.list('media', `${TENANT}/`)) void _;
    }).rejects.toThrow(/^storage list failed$/);
    await expect(
      port.upload('media', 'k', new Uint8Array(), {
        contentType: null,
        cacheControl: null,
        upsert: true,
      }),
    ).rejects.toThrow(/^storage upload failed$/);
    await expect(port.download('media', 'k')).rejects.toThrow(/^storage download failed$/);
    expect(await port.info('media', 'k')).toBeNull();
  });
});
