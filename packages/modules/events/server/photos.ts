import { withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { deleteAsset } from '@rede-social/core/server/media/service';
import { encodeCursor } from '@rede-social/core/server/paging';
import { sql } from 'drizzle-orm';
import type {
  EventPhoto,
  EventPhotoInput,
  EventPhotoPage,
  EventPhotoQuery,
} from '../contracts/index';
import { assertEventInLane, decodeInstantCursor, ISO_MICROSECONDS } from './service';

const log = moduleLogger('module-events');

/**
 * The event's "Fotos" (2026-10-03, the REINE prototype's photo grid): `event_photos`, one row per
 * photo, each a link from an event to an image of the kernel's media pipeline. A TENANT-LANE area
 * like the rest of this module: every statement is `withTenantTx`, carries the explicit `tenant_id`
 * predicate, and `event_photos_tenant_isolation` supplies the same answer underneath, so another
 * tenant's event or photo falls out of the same code path as an unknown one (D-23).
 *
 * THREE THINGS A REVIEWER MUST NOT "FIX":
 *
 * 1. **This file is separate from `./service.ts` on purpose.** Removing a photo retires its asset
 *    through the kernel's media service (`deleteAsset`), which pulls the Storage and image stack
 *    with it. Keeping that import here keeps it out of every other service read, and out of the
 *    unit suites that load `./service.ts` with a mocked lane.
 *
 * 2. **A photo is the ADMIN'S OWN upload, `post` image, `ready`.** Purpose `post` derives the gallery
 *    ladder (320 to 1600), and requiring the uploader to be the caller is what makes the removal
 *    safe: `deleteAsset` soft-deletes the asset, so a photo built on someone else's upload (a
 *    member's feed picture, whose id every member can read) would take that picture down with it.
 *    `ready` because a still-`processing` asset has no ladder to draw yet: the web waits for the
 *    derivation before it adds the photo.
 *
 * 3. **Removal is row first, asset second.** The row goes in the tenant lane; after its transaction
 *    committed, the asset is soft-deleted through the media service (admin lane, its own
 *    owner-or-admin rule) and the orphan sweeper collects the objects. A retire that fails (the asset
 *    was already retired elsewhere, or the remover is a manager who did not upload it) is logged and
 *    does not fail the removal: the photo is gone from the event either way, which is what was asked.
 *
 * Log lines carry ids, counts and flags, never a title (Pitfall 12).
 */

/** One hydrated photo row, snake_case straight off `tx.execute`. */
type PhotoRow = {
  id: string;
  media_asset_id: string;
  variant_widths: number[] | null;
  created_at: string;
};

/**
 * THE photo projection, shared by the gallery and the add's read-back. The `join media_assets` runs
 * in the tenant lane with no tenant condition of its own: `media_assets_tenant_select` decides what
 * is visible, so a photo whose asset was retired (by any path) simply leaves the gallery. Ends
 * without a `where`: each statement appends its own predicate.
 */
const photoProjection = sql`
    select p.id,
           p.media_asset_id,
           a.variant_widths,
           to_char(p.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at
      from event_photos p
      join media_assets a on a.id = p.media_asset_id`;

/** Row → published contract. The uploader is stored for auditing and never projected. */
const toPhoto = (row: PhotoRow): EventPhoto => ({
  id: row.id,
  mediaAssetId: row.media_asset_id,
  variantWidths: row.variant_widths ?? [],
});

/**
 * `GET /v1/events/{eventId}/photos?cursor=&limit=`: every member of the tenant reads an event's
 * photos (no permission beyond the module), newest first.
 *
 * The event is confirmed in-lane FIRST, so an unknown, another tenant's or a removed event is ONE
 * bare 404 (D-23), never an empty page. Then ONE literal statement over
 * `event_photos_tenant_event_idx` (`tenant_id, event_id, created_at desc, id desc`): the ordering is
 * total, `(created_at, id)` descending, so a page boundary never repeats or skips a photo, and the
 * cursor's `n` is the row's own `created_at` read back with microseconds (`ISO_MICROSECONDS`).
 * `limit + 1` over-fetch; a tampered cursor degrades to page 1. Only a `ready` asset is listed.
 */
export async function listEventPhotos(
  ctx: RequestContext,
  eventId: string,
  query: EventPhotoQuery,
): Promise<EventPhotoPage> {
  const limit = query.limit;
  const after = decodeInstantCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, async (tx) => {
    await assertEventInLane(tx, ctx, eventId);
    return tx.execute<PhotoRow>(sql`
      ${photoProjection}
       where p.tenant_id = ${ctx.tenantId}::uuid
         and p.event_id = ${eventId}::uuid
         and a.status = 'ready'
         and (
           ${afterAt}::timestamptz is null
           or (p.created_at, p.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by p.created_at desc, p.id desc
       limit ${limit + 1}`);
  });

  // Over-fetch by one: `nextCursor` is non-null EXACTLY when another photo exists.
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.created_at, id: last.id }) : null;

  log.info(
    {
      event: 'events.photos.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      eventId,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'event photos listed',
  );

  return { items: page.map(toPhoto), nextCursor };
}

/** What the asset lookup inside the writing transaction needs to decide. */
type PhotoAssetRow = { kind: string; purpose: string; status: string; owner_user_id: string };

/** The add's read-back: the photo, and whether it belongs to THIS event. */
type AddedPhotoRow = PhotoRow & { same_event: boolean };

/**
 * `POST /v1/events/{eventId}/photos { mediaAssetId }` (manage only, `requirePermission` at the
 * route). ONE `withTenantTx`, in this order:
 *  1. the event, live, in this lane: a miss is a bare 404 (D-23);
 *  2. the asset, in this lane (`deleted_at is null`, the explicit tenant predicate and RLS): NO ROW
 *     (unknown, another tenant's, retired) is the same bare 404, never a code that would tell a lab
 *     id from a missing one; a row of THIS tenant that is not the caller's own `ready` `post` image
 *     is `400 { event: 'photo_invalid' }`, information the caller already had;
 *  3. the link, `on conflict (tenant_id, media_asset_id) do nothing` over
 *     `event_photos_tenant_asset_uq`: one asset is one photo, so two racing adds of the same upload
 *     write ONE row;
 *  4. the read-back through the projection. An asset that was already a photo of THIS event is the
 *     retried add it looks like (`created: false`, the route answers 200 with that photo); one that
 *     is ANOTHER event's photo is `photo_invalid` (a photo is never moved by an add).
 */
export async function addEventPhoto(
  ctx: RequestContext,
  eventId: string,
  input: EventPhotoInput,
): Promise<{ photo: EventPhoto; created: boolean }> {
  const result = await withTenantTx(ctx, async (tx) => {
    await assertEventInLane(tx, ctx, eventId);

    const assets = await tx.execute<PhotoAssetRow>(sql`
      select kind, purpose, status, owner_user_id
        from media_assets
       where id = ${input.mediaAssetId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid
         and deleted_at is null
       limit 1`);
    const asset = assets[0];
    if (!asset) throw new ApiError(404, 'NOT_FOUND');
    const usable =
      asset.kind === 'image' &&
      asset.purpose === 'post' &&
      asset.status === 'ready' &&
      asset.owner_user_id === ctx.userId;
    if (!usable) throw new ApiError(400, 'VALIDATION_FAILED', { event: 'photo_invalid' });

    const inserted = await tx.execute<{ id: string }>(sql`
      insert into event_photos (tenant_id, event_id, media_asset_id, created_by_user_id)
      values (${ctx.tenantId}::uuid, ${eventId}::uuid, ${input.mediaAssetId}::uuid,
              ${ctx.userId}::uuid)
      on conflict (tenant_id, media_asset_id) do nothing
      returning id`);

    const rows = await tx.execute<AddedPhotoRow>(sql`
      select p.id,
             p.media_asset_id,
             a.variant_widths,
             to_char(p.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at,
             (p.event_id = ${eventId}::uuid) as same_event
        from event_photos p
        join media_assets a on a.id = p.media_asset_id
       where p.tenant_id = ${ctx.tenantId}::uuid
         and p.media_asset_id = ${input.mediaAssetId}::uuid
       limit 1`);
    const row = rows[0];
    if (!row) throw new ApiError(500, 'INTERNAL');
    if (!row.same_event) {
      throw new ApiError(400, 'VALIDATION_FAILED', { event: 'photo_invalid' });
    }
    return { photo: toPhoto(row), created: inserted.length > 0 };
  });

  log.info(
    {
      event: 'events.photos.added',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      eventId,
      photoId: result.photo.id,
      created: result.created,
    },
    'event photo added',
  );

  return result;
}

/**
 * `DELETE /v1/events/{eventId}/photos/{photoId}` (manage only). ONE guarded DELETE in the tenant
 * lane, on a photo of THIS live event (the `exists` keeps a removed event's photos out of reach, as
 * every other route does); zero rows (unknown, another tenant's, another event's, already removed) is
 * ONE bare 404. Then, after the commit, the asset is retired through the media service (fact 3 of
 * the file docblock): soft-deleted, swept later, and its signed URLs invalidated.
 */
export async function removeEventPhoto(
  ctx: RequestContext,
  eventId: string,
  photoId: string,
): Promise<void> {
  const assetId = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{ media_asset_id: string }>(sql`
      delete from event_photos p
       where p.tenant_id = ${ctx.tenantId}::uuid
         and p.event_id = ${eventId}::uuid
         and p.id = ${photoId}::uuid
         and exists (
           select 1
             from events e
            where e.tenant_id = p.tenant_id
              and e.id = p.event_id
              and e.deleted_at is null
         )
      returning p.media_asset_id`);
    return rows[0]?.media_asset_id ?? null;
  });
  if (assetId === null) throw new ApiError(404, 'NOT_FOUND');

  let retired = true;
  try {
    await deleteAsset(ctx, assetId);
  } catch (error) {
    retired = false;
    log.warn(
      {
        event: 'events.photos.retire_failed',
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        requestId: ctx.requestId,
        eventId,
        photoId,
        assetId,
        code: error instanceof ApiError ? error.code : 'UNEXPECTED',
      },
      'the removed photo kept its asset',
    );
  }

  log.info(
    {
      event: 'events.photos.removed',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      eventId,
      photoId,
      retired,
    },
    'event photo removed',
  );
}
