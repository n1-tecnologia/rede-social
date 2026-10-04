import { encodeCursor } from '@rede-social/core/server/paging';
import type {
  EventPhoto,
  EventPhotoPage,
  EventSummary,
} from '@rede-social/module-events/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, api, HOSTS, SEED_PASSWORD, signInAs, uploadAvatar } from './setup';

/**
 * 2026-10-03 — the event's "Fotos" end to end against the live local stack and the real seed:
 * `GET /v1/events/{id}/photos` (every member), `POST` (manage only: the caller's own READY `post`
 * image) and `DELETE /v1/events/{id}/photos/{photoId}` (manage only: the row, then the asset retired
 * through the media service).
 *
 * The happy path uses REAL uploads through the media broker (`uploadAvatar`, purpose `post`: the
 * bytes go to Storage and the worker handler derives the ladder), so the asset a photo points at is
 * exactly what the web's upload produces. The gallery walk uses assets written straight into
 * `media_assets` (ready `post` images of the admin), which is all the read needs.
 *
 * What is proved here:
 *  - the add answers 201 with the photo, a retried add 200 with the SAME photo, and the member reads
 *    it; a member and a support user are 403 on both writes and nothing is written;
 *  - `photo_invalid` for an asset of this tenant that is not the caller's own ready `post` image
 *    (an avatar, a cover, a `processing` one, a member's upload) or that is already another event's
 *    photo; a bare 404 for an unknown or another tenant's asset, and for an unknown or another
 *    tenant's event, on every route;
 *  - the gallery is newest first, walked one photo at a time without a repeat or a gap, and a
 *    tampered cursor degrades to page 1;
 *  - the removal: 204, the row gone, the asset soft-deleted, the member no longer reads it, a second
 *    removal is a bare 404, and another tenant's photo cannot be removed through this lane.
 *
 * Both hooks sweep this file's events by title prefix (photos and secrets cascade) and the assets it
 * created. Test ORDER is load-bearing (`fileParallelism: false`, declaration order).
 */

type Envelope = {
  error: { code: string; message?: string; details?: unknown; requestId?: string };
};

const tokens = { demoAdmin: '', demoMember: '', demoSupport: '', labMember: '' };
const tenantIds = { demo: '', lab: '' };
const userIds = { demoAdmin: '' };

const TEST_TITLE_PREFIX = 'Evento de fotos';

/** 06-01's seeded upcoming event #1 in rede-lab (`scripts/seed.ts` SEED_EVENT_IDS). */
const LAB_EVENT = '0e000000-0000-4000-8000-000000000e01';

/** Every asset this file created, removed after the events (and so the photos) that point at them. */
const createdAssets: string[] = [];

const request = (path: string, token?: string, init: RequestInit = {}, host = HOSTS.demo) =>
  api.request(path, {
    ...init,
    headers: {
      'x-tenant-host': host,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

const envelope = async (res: Response) => ((await res.json()) as Envelope).error;

function tenantDate(offsetDays: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

async function createEvent(suffix: string): Promise<EventSummary> {
  const date = tenantDate(-2);
  const res = await request('/v1/events', tokens.demoAdmin, {
    method: 'POST',
    body: JSON.stringify({
      title: `${TEST_TITLE_PREFIX} ${suffix}`,
      format: 'in_person',
      venueName: 'Auditorio da sede',
      address: 'Rua das Flores, 100',
      start: { date, time: '19:00' },
      end: { date, time: '21:00' },
    }),
  });
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return (await res.json()) as EventSummary;
}

const addPhoto = (
  eventId: string,
  mediaAssetId: string,
  token = tokens.demoAdmin,
  host = HOSTS.demo,
) =>
  request(
    `/v1/events/${eventId}/photos`,
    token,
    { method: 'POST', body: JSON.stringify({ mediaAssetId }) },
    host,
  );

const removePhoto = (
  eventId: string,
  photoId: string,
  token = tokens.demoAdmin,
  host = HOSTS.demo,
) => request(`/v1/events/${eventId}/photos/${photoId}`, token, { method: 'DELETE' }, host);

async function gallery(
  eventId: string,
  query = '',
  token = tokens.demoMember,
): Promise<EventPhotoPage> {
  const res = await request(`/v1/events/${eventId}/photos${query}`, token);
  expect(res.status, `GET photos${query}`).toBe(200);
  return (await res.json()) as EventPhotoPage;
}

/** A row of `media_assets` written straight in: enough for every read and every refusal. */
async function seedAsset(
  overrides: {
    purpose?: string;
    kind?: string;
    status?: string;
    owner?: string;
    tenant?: string;
  } = {},
): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    insert into public.media_assets
      (tenant_id, owner_user_id, kind, purpose, status, provider, mime, bytes, width, height,
       variant_widths, filename, ready_at)
    values (${overrides.tenant ?? tenantIds.demo}::uuid, ${overrides.owner ?? userIds.demoAdmin}::uuid,
            ${overrides.kind ?? 'image'}, ${overrides.purpose ?? 'post'},
            ${overrides.status ?? 'ready'}, 'supabase', 'image/webp', 262144, 1600, 1200,
            '{320,640,1080,1600}'::int[], 'evento-fotos.webp', now())
    returning id`;
  if (!row) throw new Error('could not seed an asset');
  createdAssets.push(row.id);
  return row.id;
}

async function sweep(): Promise<void> {
  await adminSql`delete from public.events where title like ${`${TEST_TITLE_PREFIX}%`}`;
  await adminSql`delete from public.event_photos where media_asset_id = any(${createdAssets}::uuid[])`;
  if (createdAssets.length > 0) {
    await adminSql`delete from public.media_assets where id = any(${createdAssets}::uuid[])`;
  }
}

beforeAll(async () => {
  if (!SEED_PASSWORD) throw new Error('SEED_PASSWORD is required (same value as `pnpm db:seed`)');
  tokens.demoAdmin = await signInAs('admin@rede-demo.local', SEED_PASSWORD);
  tokens.demoMember = await signInAs('member@rede-demo.local', SEED_PASSWORD);
  tokens.demoSupport = await signInAs('support@rede-demo.local', SEED_PASSWORD);
  tokens.labMember = await signInAs('member@rede-lab.local', SEED_PASSWORD);
  const rows = await adminSql<{ id: string; slug: string }[]>`
    select id, slug from public.tenants where slug in ('rede-demo', 'rede-lab')`;
  for (const row of rows) {
    if (row.slug === 'rede-demo') tenantIds.demo = row.id;
    if (row.slug === 'rede-lab') tenantIds.lab = row.id;
  }
  const [admin] = await adminSql<{ id: string }[]>`
    select id from public.users where email = 'admin@rede-demo.local'`;
  userIds.demoAdmin = admin?.id ?? '';
  await sweep();
});

afterAll(async () => {
  await sweep();
});

describe('events photos', () => {
  let event: EventSummary;
  let photo: EventPhoto;
  let uploaded = '';

  it('1. a member reads an empty gallery; the admin adds a REAL uploaded post image (201), a retry answers the same photo (200)', async () => {
    event = await createEvent('galeria');
    expect(await gallery(event.id)).toEqual({ items: [], nextCursor: null });

    uploaded = await uploadAvatar(tokens.demoAdmin, { purpose: 'post' });
    createdAssets.push(uploaded);
    const res = await addPhoto(event.id, uploaded);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    photo = (await res.json()) as EventPhoto;
    expect(photo.mediaAssetId).toBe(uploaded);
    expect(photo.variantWidths.length).toBeGreaterThan(0);
    expect(Object.keys(photo).sort()).toEqual(['id', 'mediaAssetId', 'variantWidths']);

    const retry = await addPhoto(event.id, uploaded);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(photo);
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.event_photos where event_id = ${event.id}::uuid`;
    expect(count?.n).toBe(1);

    expect(await gallery(event.id)).toEqual({ items: [photo], nextCursor: null });
    // The uploader is stored for auditing, never projected.
    const [row] = await adminSql<{ created_by_user_id: string }[]>`
      select created_by_user_id from public.event_photos where id = ${photo.id}::uuid`;
    expect(row?.created_by_user_id).toBe(userIds.demoAdmin);
  });

  it('2. a member and a support user are 403 on both writes, and nothing is written or removed', async () => {
    const asset = await seedAsset();
    for (const token of [tokens.demoMember, tokens.demoSupport]) {
      const add = await addPhoto(event.id, asset, token);
      expect(add.status).toBe(403);
      expect((await envelope(add)).code).toBe('FORBIDDEN');
      const remove = await removePhoto(event.id, photo.id, token);
      expect(remove.status).toBe(403);
    }
    expect((await gallery(event.id)).items.map((item) => item.id)).toEqual([photo.id]);
  });

  it('3. photo_invalid: not a post image, not ready, not the caller’s, or already another event’s photo', async () => {
    const [memberRow] = await adminSql<{ id: string }[]>`
      select id from public.users where email = 'member@rede-demo.local'`;
    const cases = [
      await seedAsset({ purpose: 'avatar' }),
      await seedAsset({ purpose: 'cover' }),
      await seedAsset({ purpose: 'story' }),
      await seedAsset({ status: 'processing' }),
      await seedAsset({ kind: 'video' }),
      await seedAsset({ owner: memberRow?.id ?? '' }),
    ];
    for (const asset of cases) {
      const res = await addPhoto(event.id, asset);
      expect(res.status, asset).toBe(400);
      const error = await envelope(res);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual({ event: 'photo_invalid' });
    }

    // One asset is one photo: the first event's photo cannot be added to another event.
    const other = await createEvent('outra galeria');
    const moved = await addPhoto(other.id, uploaded);
    expect(moved.status).toBe(400);
    expect((await envelope(moved)).details).toEqual({ event: 'photo_invalid' });
    expect(await gallery(other.id)).toEqual({ items: [], nextCursor: null });
    const [count] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.event_photos
       where event_id = any(${[event.id, other.id]}::uuid[])`;
    expect(count?.n).toBe(1);
  });

  it('4. a bare 404 for an unknown or another tenant’s asset, event or photo, on every route', async () => {
    const unknown = '0d000000-0000-4000-8000-00000000fff0';
    const labAsset = await seedAsset({ tenant: tenantIds.lab, owner: userIds.demoAdmin });
    for (const asset of [unknown, labAsset]) {
      const res = await addPhoto(event.id, asset);
      expect(res.status, asset).toBe(404);
      const error = await envelope(res);
      expect(error.code).toBe('NOT_FOUND');
      expect(Object.hasOwn(error, 'details')).toBe(false);
    }
    const asset = await seedAsset();
    for (const eventId of [unknown, LAB_EVENT]) {
      for (const res of [
        await request(`/v1/events/${eventId}/photos`, tokens.demoMember),
        await addPhoto(eventId, asset),
        await removePhoto(eventId, photo.id),
      ]) {
        expect(res.status, eventId).toBe(404);
        expect(Object.hasOwn(await envelope(res), 'details')).toBe(false);
      }
    }
    // A malformed id is a 400 before any read.
    expect((await request('/v1/events/not-a-uuid/photos', tokens.demoMember)).status).toBe(400);
    expect((await removePhoto(event.id, 'not-a-uuid')).status).toBe(400);
    // The photo of THIS event, asked for through another event, is not found either.
    const other = await createEvent('sem a foto');
    expect((await removePhoto(other.id, photo.id)).status).toBe(404);
    expect((await gallery(event.id)).items.map((item) => item.id)).toEqual([photo.id]);
  });

  it('5. the gallery is newest first, walked one photo at a time with no repeat; a tampered cursor is page 1', async () => {
    const walkEvent = await createEvent('caminhada');
    const added: string[] = [];
    for (let n = 0; n < 5; n++) {
      const res = await addPhoto(walkEvent.id, await seedAsset());
      expect(res.status).toBe(201);
      added.push(((await res.json()) as EventPhoto).id);
    }
    const order = await adminSql<{ id: string }[]>`
      select id from public.event_photos where event_id = ${walkEvent.id}::uuid
       order by created_at desc, id desc`;

    const walked: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const query: string = cursor ? `?limit=1&cursor=${encodeURIComponent(cursor)}` : '?limit=1';
      const page = await gallery(walkEvent.id, query);
      walked.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(cursor).toBeNull();
    expect(walked).toEqual(order.map((row) => row.id));
    expect(new Set(walked)).toEqual(new Set(added));

    const first = await gallery(walkEvent.id, '?limit=2');
    for (const hostile of [
      'not-a-cursor',
      encodeCursor({ n: 'not-a-date', id: '0e000000-0000-4000-8000-000000000e01' }),
      encodeCursor({
        n: '2026-02-30T00:00:00.000000Z',
        id: '0e000000-0000-4000-8000-000000000e01',
      }),
    ]) {
      const again = await gallery(walkEvent.id, `?limit=2&cursor=${encodeURIComponent(hostile)}`);
      expect(again.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
    }
    // An unknown query key fails loudly; the limit clamps.
    expect(
      (await request(`/v1/events/${walkEvent.id}/photos?period=past`, tokens.demoMember)).status,
    ).toBe(400);
    expect((await gallery(walkEvent.id, '?limit=0')).items).toHaveLength(1);
  });

  it('6. the removal: 204, the row gone, the asset retired, the member no longer reads it; a second removal is 404', async () => {
    const res = await removePhoto(event.id, photo.id);
    expect(res.status).toBe(204);
    const [row] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.event_photos where id = ${photo.id}::uuid`;
    expect(row?.n).toBe(0);
    const [asset] = await adminSql<{ status: string; deleted_at: string | null }[]>`
      select status, deleted_at::text from public.media_assets where id = ${uploaded}::uuid`;
    expect(asset?.status).toBe('deleted');
    expect(asset?.deleted_at).not.toBeNull();
    expect(await gallery(event.id)).toEqual({ items: [], nextCursor: null });

    const again = await removePhoto(event.id, photo.id);
    expect(again.status).toBe(404);
    expect(Object.hasOwn(await envelope(again), 'details')).toBe(false);
  });

  it('7. cross-tenant: another tenant’s photo cannot be read or removed through this lane', async () => {
    const labAsset = await seedAsset({ tenant: tenantIds.lab, owner: userIds.demoAdmin });
    const [labPhoto] = await adminSql<{ id: string }[]>`
      insert into public.event_photos (tenant_id, event_id, media_asset_id, created_by_user_id)
      values (${tenantIds.lab}::uuid, ${LAB_EVENT}::uuid, ${labAsset}::uuid, ${userIds.demoAdmin}::uuid)
      returning id`;
    // The lab member reads it in the lab lane (the positive control).
    const lab = await request(`/v1/events/${LAB_EVENT}/photos`, tokens.labMember, {}, HOSTS.lab);
    expect(lab.status).toBe(200);
    expect(((await lab.json()) as EventPhotoPage).items.map((item) => item.id)).toContain(
      labPhoto?.id,
    );
    // The demo admin cannot remove it, through the lab event or one of its own.
    expect((await removePhoto(LAB_EVENT, labPhoto?.id ?? '')).status).toBe(404);
    expect((await removePhoto(event.id, labPhoto?.id ?? '')).status).toBe(404);
    // A demo session presented on the lab host is refused before any read.
    const mismatch = await request(
      `/v1/events/${LAB_EVENT}/photos`,
      tokens.demoMember,
      {},
      HOSTS.lab,
    );
    expect(mismatch.status).toBe(403);
    expect((await envelope(mismatch)).code).toBe('TENANT_HOST_MISMATCH');
    const [still] = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.event_photos where id = ${labPhoto?.id ?? ''}::uuid`;
    expect(still?.n).toBe(1);
    await adminSql`delete from public.event_photos where id = ${labPhoto?.id ?? ''}::uuid`;
  });
});
