import { sqlClient } from '@tria/core/db';
import { FEED_MAX_ATTACHMENTS, FEED_MAX_IMAGES, type FeedPost } from '@tria/module-feed/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs, uploadAvatar } from './setup';

/**
 * FEED-01 / D-53 — the media half of a post, against the live local stack.
 *
 * What only this file can prove:
 *  - **D-53 is refused at the API with a STABLE machine code**, for every illegal combination:
 *    photos + a video, more than `FEED_MAX_IMAGES`, more than `FEED_MAX_ATTACHMENTS`.
 *  - **T-04-22: an asset that is not the caller's own, or carries the wrong purpose, or is not in a
 *    usable status, takes ONE code (`asset_not_usable`) with NO id and NO tenant echoed back.** A
 *    per-cause code over an enumerable uuid space would be an existence oracle.
 *  - **A video may be published WHILE its transcode runs** (D-53) and the feed reports that status,
 *    so the card can draw the Phase 3 `processando` placeholder rather than an empty frame.
 *  - **The assumption-delta companion invariant:** a one-image post and a ten-image post round-trip
 *    through the SAME `feed_post_media` path with the SAME projection shape, and no response field
 *    names a singular image asset. A future phase that reintroduces `imageAssetId` goes red here.
 *
 * Image and attachment fixtures are built through the REAL Phase 3 broker (`POST /v1/media/uploads`
 * -> PUT straight to Storage -> `complete`), so statuses, mimes and ladders are the genuine ones. The
 * video row is written directly, the `media-playback.test.ts` posture: video INGEST is 03-06's
 * subject and is proved end to end there, and what this file is about does not depend on how the row
 * arrived.
 */

type Envelope = {
  error: { code: string; message?: string; details?: { media?: string }; requestId?: string };
};

const DEMO_ADMIN = 'admin@tria-demo.local';
const DEMO_MEMBER = 'member@tria-demo.local';
const LAB_ADMIN = 'admin@tria-lab.local';

const tokens = { demoAdmin: '', demoMember: '', labAdmin: '' };
const tenantIds = { demo: '', lab: '' };

/** Everything this file wrote, swept in `afterAll` so the shared seed survives a re-run. */
const createdPostIds: string[] = [];
const createdAssetIds: string[] = [];

/** `%PDF-`-prefixed for real: the magic-byte check at `complete` judges the BYTES, not the name. */
const PDF_BYTES = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj',
    'trailer<</Root 1 0 R/Size 4>>',
    '%%EOF',
    '',
  ].join('\n'),
  'latin1',
);

function authed(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function post(body: unknown, token = tokens.demoAdmin, host = HOSTS.demo) {
  return api.request('/v1/feed/posts', {
    method: 'POST',
    headers: { ...authed(token), 'x-tenant-host': host },
    body: JSON.stringify(body),
  });
}

/** A 201 create, parsed and registered for cleanup. Fails loudly on anything else. */
async function created(body: unknown, token = tokens.demoAdmin, host = HOSTS.demo) {
  const res = await post(body, token, host);
  expect(res.status, `POST /v1/feed/posts -> ${res.status}`).toBe(201);
  const item = (await res.json()) as FeedPost;
  createdPostIds.push(item.id);
  return item;
}

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

/** A real `ready` post image through the broker. `uploadAvatar` IS that path, purpose-parameterised. */
async function postImage(token = tokens.demoAdmin): Promise<string> {
  const id = await uploadAvatar(token, { purpose: 'post' });
  createdAssetIds.push(id);
  return id;
}

/** A real `ready` PDF attachment: start -> PUT -> complete. A `file` needs no ladder, so it is ready. */
async function attachmentAsset(token = tokens.demoAdmin, host = HOSTS.demo): Promise<string> {
  const started = await api.request('/v1/media/uploads', {
    method: 'POST',
    headers: { ...authed(token), 'x-tenant-host': host },
    body: JSON.stringify({
      kind: 'file',
      purpose: 'attachment',
      mime: 'application/pdf',
      size: PDF_BYTES.length,
      filename: 'calendario.pdf',
    }),
  });
  expect(started.status, 'start attachment upload').toBe(201);
  const target = (await started.json()) as { assetId: string; signedUrl: string };

  const put = await fetch(target.signedUrl, {
    method: 'PUT',
    body: new Uint8Array(PDF_BYTES),
    headers: { 'content-type': 'application/pdf', 'x-upsert': 'false' },
  });
  expect(put.ok, `PUT to Storage -> ${put.status}`).toBe(true);

  const done = await api.request(`/v1/media/uploads/${target.assetId}/complete`, {
    method: 'POST',
    headers: authed(token),
  });
  expect(done.status, 'complete attachment upload').toBe(200);

  createdAssetIds.push(target.assetId);
  return target.assetId;
}

/**
 * A video row in a known state. `fake` is the local provider seam (03-06) — the feed never references
 * a raw video object, only the provider-brokered asset (T-04-27).
 */
async function videoAsset(
  tenantId: string,
  email: string,
  status: 'processing' | 'ready' = 'ready',
): Promise<string> {
  const rows = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, provider_asset_id, playback_id,
       mime, bytes, duration_seconds, aspect_ratio, filename, ready_at)
    select ${tenantId}::uuid, u.id, 'video', 'post', ${status}, 'fake',
           ${`fake-${crypto.randomUUID()}`},
           ${status === 'ready' ? `pb-${crypto.randomUUID()}` : null},
           'video/mp4', 1048576, 42, '16:9', 'recado.mp4',
           ${status === 'ready' ? new Date().toISOString() : null}::timestamptz
      from public.users u where u.email = ${email}
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not seed a video asset for ${email}`);
  createdAssetIds.push(id);
  return id;
}

/** How many posts the tenant carries right now — "and no post row was created" needs a real number. */
async function postCount(tenantId: string): Promise<number> {
  const [row] = await adminSql<{ n: string }[]>`
    select count(*)::text as n from public.feed_posts where tenant_id = ${tenantId}::uuid`;
  return Number(row?.n ?? '0');
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');

  [tokens.demoAdmin, tokens.demoMember, tokens.labAdmin] = await Promise.all([
    signInAs(DEMO_ADMIN, SEED_PASSWORD),
    signInAs(DEMO_MEMBER, SEED_PASSWORD),
    signInAs(LAB_ADMIN, SEED_PASSWORD),
  ]);

  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('tria-demo', 'tria-lab')`;
  for (const row of rows) {
    if (row.slug === 'tria-demo') tenantIds.demo = row.id;
    if (row.slug === 'tria-lab') tenantIds.lab = row.id;
  }
  if (!tenantIds.demo || !tenantIds.lab) throw new Error('the two demo tenants are not seeded');
});

afterAll(async () => {
  if (createdPostIds.length > 0) {
    await adminSql`delete from public.feed_posts where id = any(${createdPostIds}::uuid[])`;
  }
  if (createdAssetIds.length > 0) {
    // The Storage objects are swept by the media sweeper; the rows must go now so a re-run does not
    // page over this file's fixtures.
    await adminSql`delete from public.media_assets where id = any(${createdAssetIds}::uuid[])`;
  }
  await adminSql.end();
  await sqlClient.end();
});

describe('D-53 — gallery XOR video, refused with a stable machine code', () => {
  it('refuses photos AND a video on one post, and creates no post row', async () => {
    const [image, video] = await Promise.all([postImage(), videoAsset(tenantIds.demo, DEMO_ADMIN)]);
    const before = await postCount(tenantIds.demo);

    const res = await post({
      caption: 'fotos e video',
      imageAssetIds: [image],
      videoAssetId: video,
    });
    expect(res.status).toBe(400);
    const error = await envelope(res);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.media).toBe('gallery_and_video');

    expect(await postCount(tenantIds.demo)).toBe(before);
  });

  it('refuses more than FEED_MAX_IMAGES images', async () => {
    const image = await postImage();
    const res = await post({
      caption: 'fotos demais',
      // The same id repeated: the CAP is what this asserts, and it is checked before any asset read.
      imageAssetIds: Array.from({ length: FEED_MAX_IMAGES + 1 }, () => image),
    });
    expect(res.status).toBe(400);
    expect((await envelope(res)).details?.media).toBe('too_many_images');
  });

  it('refuses more than FEED_MAX_ATTACHMENTS attachments', async () => {
    const file = await attachmentAsset();
    const res = await post({
      caption: 'anexos demais',
      attachmentAssetIds: Array.from({ length: FEED_MAX_ATTACHMENTS + 1 }, () => file),
    });
    expect(res.status).toBe(400);
    expect((await envelope(res)).details?.media).toBe('too_many_attachments');
  });

  it('refuses a SECOND video row at the database when one is already attached', async () => {
    const video = await videoAsset(tenantIds.demo, DEMO_ADMIN);
    const item = await created({ caption: 'um video', videoAssetId: video });
    const second = await videoAsset(tenantIds.demo, DEMO_ADMIN);

    // The API never offers two videos, so the arbiter is exercised where a crafted caller would
    // reach it: `feed_post_media_video_uq` on the row itself.
    await expect(
      adminSql`
        insert into public.feed_post_media
          (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
        values (${tenantIds.demo}::uuid, ${item.id}::uuid, 'video', ${second}::uuid, 'video', 1)`,
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('T-04-22 / T-04-23 — every referenced asset is the caller’s own, with the right purpose', () => {
  it('refuses an image whose purpose is `avatar` with asset_not_usable', async () => {
    const avatar = await uploadAvatar(tokens.demoAdmin, { purpose: 'avatar' });
    createdAssetIds.push(avatar);

    const res = await post({ caption: 'foto de perfil', imageAssetIds: [avatar] });
    expect(res.status).toBe(400);
    expect((await envelope(res)).details?.media).toBe('asset_not_usable');
  });

  it('refuses ANOTHER tenant’s asset id, naming neither the tenant nor the asset', async () => {
    const foreign = await postImage(tokens.labAdmin);
    const res = await post({ caption: 'foto de outra comunidade', imageAssetIds: [foreign] });

    expect(res.status).toBe(400);
    const error = await envelope(res);
    expect(error.details?.media).toBe('asset_not_usable');

    // The refusal must be an existence NON-oracle: nothing in the body names the other community,
    // its slug, or the id that was probed.
    const body = JSON.stringify(error);
    expect(body).not.toContain(foreign);
    expect(body).not.toContain(tenantIds.lab);
    expect(body.toLowerCase()).not.toContain('tria-lab');
  });

  it('refuses a PDF offered as a gallery image, and a photo offered as an attachment', async () => {
    const [file, image] = await Promise.all([attachmentAsset(), postImage()]);

    const asImage = await post({ caption: 'pdf como foto', imageAssetIds: [file] });
    expect(asImage.status).toBe(400);
    expect((await envelope(asImage)).details?.media).toBe('asset_not_usable');

    const asFile = await post({ caption: 'foto como anexo', attachmentAssetIds: [image] });
    expect(asFile.status).toBe(400);
    expect((await envelope(asFile)).details?.media).toBe('asset_not_usable');
  });

  it('refuses an id that names no asset at all with the SAME code', async () => {
    const res = await post({
      caption: 'id inexistente',
      imageAssetIds: ['8f14e45f-ce1a-4e2f-8b4a-1f0a0b0c0d0e'],
    });
    expect(res.status).toBe(400);
    expect((await envelope(res)).details?.media).toBe('asset_not_usable');
  });
});

describe('what a legal post carries back', () => {
  it('publishes a video that is still PROCESSING and reports that status (D-53)', async () => {
    const video = await videoAsset(tenantIds.demo, DEMO_ADMIN, 'processing');
    const item = await created({ caption: 'recado em video', videoAssetId: video });

    expect(item.mediaKind).toBe('video');
    expect(item.media).toHaveLength(1);
    expect(item.media[0]).toMatchObject({ assetId: video, kind: 'video', position: 0 });
    // The card draws the Phase 3 `processando` placeholder off THIS field.
    expect(item.media[0]?.status).toBe('processing');
  });

  it('carries a PDF alongside a gallery — an attachment constrains the parent’s kind not at all', async () => {
    const [a, b, file] = await Promise.all([postImage(), postImage(), attachmentAsset()]);
    const item = await created({
      caption: 'fotos e o calendario',
      imageAssetIds: [a, b],
      attachmentAssetIds: [file],
    });

    expect(item.mediaKind).toBe('gallery');
    expect(item.media.map((m) => m.kind)).toEqual(['image', 'image', 'file']);
    // The ARRAY ORDER is the gallery order, and the attachments come after it in their own order.
    expect(item.media.slice(0, 2).map((m) => m.assetId)).toEqual([a, b]);
    expect(item.media[2]?.filename).toBe('calendario.pdf');
    expect(item.media[2]?.bytes).toBe(PDF_BYTES.length);
    // A PDF derives no ladder, and the row says so rather than guessing one.
    expect(item.media[2]?.variantWidths).toEqual([]);
  });

  it('gives a PDF-only post `media_kind: none` — no media frame, one attachment row', async () => {
    const file = await attachmentAsset();
    const item = await created({ caption: 'so o calendario', attachmentAssetIds: [file] });

    expect(item.mediaKind).toBe('none');
    expect(item.media.map((m) => m.kind)).toEqual(['file']);
  });

  it('never leaks a signed Storage URL into the payload (T-04-23)', async () => {
    const image = await postImage();
    const item = await created({ caption: 'uma foto', imageAssetIds: [image] });

    const body = JSON.stringify(item);
    expect(body).not.toContain('storage/v1/object/sign');
    expect(body).not.toContain('token=');
    expect(body).not.toContain('http');
  });
});

describe('the assumption-delta companion invariant — media is a COLLECTION, never a column', () => {
  it('round-trips a one-image and a ten-image post through the SAME shape', async () => {
    const image = await postImage();

    const one = await created({ caption: 'uma foto', imageAssetIds: [image] });
    const many = await created({
      caption: 'dez fotos',
      imageAssetIds: Array.from({ length: FEED_MAX_IMAGES }, () => image),
    });

    expect(one.mediaKind).toBe('gallery');
    expect(many.mediaKind).toBe('gallery');
    expect(one.media).toHaveLength(1);
    expect(many.media).toHaveLength(FEED_MAX_IMAGES);

    // The SAME projection shape: identical key sets on the media rows, and identical post keys.
    const keysOf = (value: object) => Object.keys(value).sort();
    expect(keysOf(many)).toEqual(keysOf(one));
    for (const row of many.media) expect(keysOf(row)).toEqual(keysOf(one.media[0] as object));

    // …and `position` really is the array index, so the ten-image case is the one-row case repeated.
    expect(many.media.map((m) => m.position)).toEqual([
      ...Array.from({ length: FEED_MAX_IMAGES }, (_, i) => i),
    ]);

    // No response field names a SINGULAR image asset. A future phase that reintroduces
    // `imageAssetId` / `videoAssetId` / `coverAssetId` on the wire goes red right here.
    const keys = new Set([...keysOf(one), ...keysOf(one.media[0] as object)]);
    for (const banned of ['imageAssetId', 'videoAssetId', 'coverAssetId', 'imageUrl']) {
      expect(keys.has(banned)).toBe(false);
    }
  });

  it('shows the same media collection through GET /v1/feed as through the create response', async () => {
    const [image, file] = await Promise.all([postImage(), attachmentAsset()]);
    const item = await created({
      caption: 'foto e anexo',
      imageAssetIds: [image],
      attachmentAssetIds: [file],
    });

    const res = await api.request(`/v1/feed/posts/${item.id}`, {
      headers: { ...authed(tokens.demoMember), 'x-tenant-host': HOSTS.demo },
    });
    expect(res.status).toBe(200);
    const read = (await res.json()) as FeedPost;

    expect(read.mediaKind).toBe(item.mediaKind);
    expect(read.media).toEqual(item.media);
  });
});
