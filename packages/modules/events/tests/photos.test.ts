import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { decodeCursor, encodeCursor } from '@rede-social/core/server/paging';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10-03 — the event's "Fotos" service (`server/photos.ts`), asserted without a database: the
 * statement ORDER and shape, the refusals and the asset retirement, with the tenant lane and the
 * kernel media service as the two seams (the `events-payload.test.ts` posture). The integration
 * suite (`apps/api/tests/integration/events-photos.test.ts`) proves the same rules against the stack.
 *
 *  1. the gallery confirms the event in-lane FIRST (a miss is ONE bare 404 and no photo is read),
 *     then reads ONE literal statement newest first, `limit + 1`, and a tampered cursor is page 1;
 *  2. an add with no asset row is a bare 404; an asset that is not the caller's own ready `post`
 *     image is `photo_invalid` and NOTHING is inserted; a fresh add is `created`, a repeat of the
 *     same event's photo is not, and another event's photo is `photo_invalid`;
 *  3. a removal deletes the row in the lane and only THEN retires the asset through the media
 *     service; a miss retires nothing, and a retire that fails does not fail the removal.
 */

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const ASSET_ID = '44444444-4444-4444-8444-444444444444';
const PHOTO_ID = '55555555-5555-4555-8555-555555555555';
const CREATED_AT = '2026-10-03T12:00:00.123456Z';

/** One entry per statement: an array is a result, anything else is thrown. */
let script: unknown[] = [];
const statements: string[] = [];

const tx = {
  execute: async (query: unknown) => {
    statements.push(JSON.stringify(query));
    const next = script.shift();
    if (Array.isArray(next)) return next;
    throw next ?? new Error('unscripted statement');
  },
};

vi.mock('@rede-social/core/db/tenant-tx', () => ({
  withTenantTx: <T>(_ctx: unknown, fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
}));

const deleteAsset = vi.hoisted(() => vi.fn());
vi.mock('@rede-social/core/server/media/service', () => ({ deleteAsset }));

const { addEventPhoto, listEventPhotos, removeEventPhoto } = await import('../server/photos');

function context(): RequestContext {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    role: 'admin_tenant',
    requestId: 'test',
    events: [],
  };
}

const photoRow = (id: string, createdAt = CREATED_AT) => ({
  id,
  media_asset_id: ASSET_ID,
  variant_widths: [320, 640, 1080, 1600],
  created_at: createdAt,
});

const usableAsset = {
  kind: 'image',
  purpose: 'post',
  status: 'ready',
  owner_user_id: USER_ID,
};

beforeEach(() => {
  script = [];
  statements.length = 0;
  deleteAsset.mockReset().mockResolvedValue(undefined);
});

describe('listEventPhotos — the gallery', () => {
  it('1. the event first, then ONE literal statement newest first; over-fetch sets nextCursor', async () => {
    const rows = [
      photoRow('aaaaaaaa-0000-4000-8000-000000000003', '2026-10-03T12:00:03.000000Z'),
      photoRow('aaaaaaaa-0000-4000-8000-000000000002', '2026-10-03T12:00:02.000000Z'),
      photoRow('aaaaaaaa-0000-4000-8000-000000000001', '2026-10-03T12:00:01.000000Z'),
    ];
    script = [[{ id: EVENT_ID }], rows];
    const page = await listEventPhotos(context(), EVENT_ID, { limit: 2 });

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('from events');
    expect(statements[1]).toContain('from event_photos p');
    expect(statements[1]).toContain('join media_assets a');
    expect(statements[1]).toContain('order by p.created_at desc, p.id desc');
    expect(statements[1]).toContain("a.status = 'ready'");

    expect(page.items).toEqual([
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000003',
        mediaAssetId: ASSET_ID,
        variantWidths: [320, 640, 1080, 1600],
      },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000002',
        mediaAssetId: ASSET_ID,
        variantWidths: [320, 640, 1080, 1600],
      },
    ]);
    // The cursor is the LAST row of the page, its own microsecond instant and id.
    expect(decodeCursor(page.nextCursor ?? undefined)).toEqual({
      n: '2026-10-03T12:00:02.000000Z',
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
    });

    // The last page answers no cursor; a photo with no ladder maps to [].
    script = [[{ id: EVENT_ID }], [{ ...photoRow(PHOTO_ID), variant_widths: null }]];
    const last = await listEventPhotos(context(), EVENT_ID, { limit: 2 });
    expect(last).toEqual({
      items: [{ id: PHOTO_ID, mediaAssetId: ASSET_ID, variantWidths: [] }],
      nextCursor: null,
    });
  });

  it('2. a miss is ONE bare 404 and no photo is read; a tampered cursor degrades to page 1', async () => {
    script = [[]];
    const miss = listEventPhotos(context(), EVENT_ID, { limit: 30 });
    await expect(miss).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(miss).rejects.not.toHaveProperty('details.event');
    expect(statements).toHaveLength(1);

    for (const cursor of [
      'not-a-cursor',
      encodeCursor({ n: 'not-a-date', id: PHOTO_ID }),
      encodeCursor({ n: '2026-02-30T00:00:00.000000Z', id: PHOTO_ID }),
    ]) {
      statements.length = 0;
      script = [[{ id: EVENT_ID }], []];
      await listEventPhotos(context(), EVENT_ID, { limit: 30, cursor });
      // Page 1: both bound cursor values are null, never the tampered string.
      expect(statements[1]).not.toContain('not-a-date');
      expect(statements[1]).not.toContain('2026-02-30');
    }
  });
});

describe('addEventPhoto — the admin adds an uploaded image', () => {
  it('3. a fresh add: event, asset, insert on the unique arbiter, read-back; created', async () => {
    script = [
      [{ id: EVENT_ID }],
      [usableAsset],
      [{ id: PHOTO_ID }],
      [{ ...photoRow(PHOTO_ID), same_event: true }],
    ];
    const result = await addEventPhoto(context(), EVENT_ID, { mediaAssetId: ASSET_ID });
    expect(result).toEqual({
      created: true,
      photo: { id: PHOTO_ID, mediaAssetId: ASSET_ID, variantWidths: [320, 640, 1080, 1600] },
    });
    expect(statements[0]).toContain('from events');
    expect(statements[1]).toContain('from media_assets');
    expect(statements[1]).toContain('deleted_at is null');
    expect(statements[2]).toContain('insert into event_photos');
    expect(statements[2]).toContain('on conflict (tenant_id, media_asset_id) do nothing');
    // The uploader is the caller, from ctx, never from a body.
    expect(statements[2]).toContain(USER_ID);
  });

  it('4. a repeat of this event’s photo is the retried add (not created); another event’s is photo_invalid', async () => {
    script = [[{ id: EVENT_ID }], [usableAsset], [], [{ ...photoRow(PHOTO_ID), same_event: true }]];
    const repeat = await addEventPhoto(context(), EVENT_ID, { mediaAssetId: ASSET_ID });
    expect(repeat.created).toBe(false);
    expect(repeat.photo.id).toBe(PHOTO_ID);

    script = [
      [{ id: EVENT_ID }],
      [usableAsset],
      [],
      [{ ...photoRow(PHOTO_ID), same_event: false }],
    ];
    await expect(
      addEventPhoto(context(), EVENT_ID, { mediaAssetId: ASSET_ID }),
    ).rejects.toMatchObject({ status: 400, details: { event: 'photo_invalid' } });
  });

  it('5. no asset row is a bare 404; an unusable asset is photo_invalid and nothing is inserted', async () => {
    script = [[{ id: EVENT_ID }], []];
    const miss = addEventPhoto(context(), EVENT_ID, { mediaAssetId: ASSET_ID });
    await expect(miss).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(miss).rejects.not.toHaveProperty('details.event');

    const unusable = [
      { ...usableAsset, owner_user_id: '66666666-6666-4666-8666-666666666666' },
      { ...usableAsset, purpose: 'cover' },
      { ...usableAsset, purpose: 'story' },
      { ...usableAsset, kind: 'video' },
      { ...usableAsset, status: 'processing' },
    ];
    for (const asset of unusable) {
      statements.length = 0;
      script = [[{ id: EVENT_ID }], [asset]];
      await expect(
        addEventPhoto(context(), EVENT_ID, { mediaAssetId: ASSET_ID }),
        JSON.stringify(asset),
      ).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_FAILED',
        details: { event: 'photo_invalid' },
      });
      expect(statements.some((statement) => statement.includes('insert into'))).toBe(false);
    }

    // An unknown event is the same bare 404, before the asset is even read.
    statements.length = 0;
    script = [[]];
    await expect(
      addEventPhoto(context(), EVENT_ID, { mediaAssetId: ASSET_ID }),
    ).rejects.toMatchObject({ status: 404 });
    expect(statements).toHaveLength(1);
  });
});

describe('removeEventPhoto — the row first, the asset after', () => {
  it('6. deletes the photo of THIS live event in the lane, then retires its asset with the caller ctx', async () => {
    script = [[{ media_asset_id: ASSET_ID }]];
    const ctx = context();
    await removeEventPhoto(ctx, EVENT_ID, PHOTO_ID);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('delete from event_photos');
    expect(statements[0]).toContain('deleted_at is null');
    expect(statements[0]).toContain(PHOTO_ID);
    expect(deleteAsset).toHaveBeenCalledTimes(1);
    expect(deleteAsset).toHaveBeenCalledWith(ctx, ASSET_ID);
  });

  it('7. a miss is ONE bare 404 and retires nothing; a failed retire does not fail the removal', async () => {
    script = [[]];
    const miss = removeEventPhoto(context(), EVENT_ID, PHOTO_ID);
    await expect(miss).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(miss).rejects.not.toHaveProperty('details.event');
    expect(deleteAsset).not.toHaveBeenCalled();

    script = [[{ media_asset_id: ASSET_ID }]];
    deleteAsset.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND'));
    await expect(removeEventPhoto(context(), EVENT_ID, PHOTO_ID)).resolves.toBeUndefined();
    expect(deleteAsset).toHaveBeenCalledTimes(1);
  });
});
