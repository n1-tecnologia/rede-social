import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { tenants } from './tenants';
import { users } from './users';

/**
 * Every member upload, whatever the provider (MEDIA-01, MEDIA-02, TENANT-04).
 *
 * The row is NOT the address of the object. The Storage key is a pure function of
 * `(tenantId, assetId, variant)` — `<tenant_id>/media/<assetId>/original` and
 * `<tenant_id>/media/<assetId>/w<width>.webp` (RESEARCH Pattern 1) — so `GET /v1/media/{id}/{variant}`
 * performs ZERO reads of this table and a tenant-B session asking for a tenant-A id resolves under
 * B's own prefix, where nothing exists. Isolation is structural, not check-dependent (T-03-01).
 *
 * POLICY INTENT — exactly ONE policy, for `select`, tenant-wide, never a soft-deleted row:
 * every member of the tenant may read the tenant's assets (Phase 4's feed depends on that), and
 * `deleted_at is null` makes a soft delete invisible to its OWN tenant's lane too. There is
 * deliberately NO insert/update/delete policy: every write goes through the admin lane in
 * `server/media/service.ts` with an explicit `tenant_id = ctx.tenantId` predicate — the
 * `consent_records` posture, so no tenant session can forge or edit an asset record.
 *
 * `provider`/`provider_asset_id`/`playback_id`/`duration_seconds`/`aspect_ratio` exist from day one
 * and are null for a Supabase-stored image: 03-06 fills them behind the same serving contract
 * without a migration that rewrites this table.
 *
 * `tenant_id` is the first column of every index (01-08 convention).
 */
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** Who uploaded it. Tenant-scoped like every row — RLS reads `tenant_id`, not this column. */
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    /** 'image' | 'video' | 'file' — see the CHECK below. */
    kind: text().notNull(),
    /** 'avatar' | 'post' | 'cover' | 'story' | 'attachment' — decides the derived width ladder. */
    purpose: text().notNull(),
    status: text().notNull().default('pending'),
    provider: text().notNull().default('supabase'),
    providerAssetId: text('provider_asset_id'),
    playbackId: text('playback_id'),
    mime: text().notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    width: integer(),
    height: integer(),
    durationSeconds: integer('duration_seconds'),
    aspectRatio: text('aspect_ratio'),
    /** The widths actually produced — the payload's `variants` array is built from this. */
    variantWidths: integer('variant_widths').array().notNull().default(sql`'{}'::int[]`),
    filename: text(),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // The sweeper (03-08) and any admin listing: `where tenant_id = $1 and status = $2 order by created_at`.
    index('media_assets_tenant_status_created_idx').on(t.tenantId, t.status, t.createdAt),
    index('media_assets_tenant_owner_idx').on(t.tenantId, t.ownerUserId),
    // A provider's own id maps to at most one asset — the 03-06 webhook's idempotency arbiter.
    uniqueIndex('media_assets_provider_asset_uq')
      .on(t.provider, t.providerAssetId)
      .where(sql`provider_asset_id is not null`),
    check('media_assets_kind_chk', sql`${t.kind} in ('image','video','file')`),
    check(
      'media_assets_purpose_chk',
      sql`${t.purpose} in ('avatar','post','cover','story','attachment')`,
    ),
    check(
      'media_assets_status_chk',
      sql`${t.status} in ('pending','processing','ready','failed','rejected','deleted')`,
    ),
    // `fake` is the local video provider (03-06): the bytes are in the same private bucket, but the
    // asset was brokered through the `VideoProvider` seam, so the row says so rather than lying.
    check('media_assets_provider_chk', sql`${t.provider} in ('supabase','mux','fake')`),
    pgPolicy('media_assets_tenant_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and deleted_at is null`,
    }),
  ],
).enableRLS();
