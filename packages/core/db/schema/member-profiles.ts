import { sql } from 'drizzle-orm';
import { index, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { mediaAssets } from './media-assets';
import { memberships } from './memberships';
import { tenants } from './tenants';
import { users } from './users';

/**
 * A member's profile inside ONE community (PROF-01, PROF-02, PROF-03, TENANT-04).
 *
 * The row hangs off the MEMBERSHIP, not off `users`: `packages/core/docs/SCHEMA-CONVENTIONS.md`
 * §(b)4 states it as a rule — "profile data hangs off the membership (Phase 3), not off `users`: a
 * person may present differently in different tenants" — and `users` is pinned by pgTAP `040` to
 * carry no `tenant_id`, so there is nowhere on it for a per-tenant bio to live. V2's multi-tenant
 * membership therefore needs no migration that rewrites this table.
 *
 * EXACTLY ONE ROW PER MEMBERSHIP, CREATED EAGERLY. The row is written by the
 * `member_profiles_from_membership` trigger (`app.ensure_member_profile`, SECURITY DEFINER, in the
 * custom migration), and the same migration backfills one row per pre-existing membership. Eager,
 * not lazy: a lazy row would force the 03-03 directory into `coalesce(mp.display_name, u.name)`
 * across two tables, which the trigram expression index cannot cover (R-08/R-10). Making it a
 * trigger rather than an edit of every membership insert site means a future call site — Phase 8's
 * member management, a new invite path — cannot forget it.
 *
 * POLICY INTENT — exactly TWO policies, and the asymmetry is the whole design:
 *  - `member_profiles_tenant_select` is TENANT-WIDE (`tenant_id = app.tenant_id()`), NOT self-scoped
 *    like `consent_records`: PROF-02 (another member's profile) and PROF-03 (the directory) are
 *    reads of OTHER members' rows by an ordinary member of the same tenant.
 *  - `member_profiles_self_update` is SELF-scoped on both `using` and `with check`
 *    (`tenant_id = app.tenant_id() and user_id = app.user_id()`), so `PATCH /v1/me/profile` can only
 *    ever rewrite the caller's own row — the row a write may touch is decided by the policy, never
 *    by a body field or a path parameter (T-03-12).
 *  - There is deliberately NO insert and NO delete policy: rows appear only through the trigger and
 *    disappear only with the membership's `on delete cascade`, so no tenant session can forge a
 *    profile for someone who is not a member, or erase one.
 *
 * D-46: a display-name change is free and leaves no history — the value is overwritten in place,
 * `users.name` is untouched, and there is deliberately no "nome anterior" column here.
 *
 * `tenant_id` is the first column of every index (01-08 convention). The SEARCH indexes
 * (`member_profiles_name_trgm_idx`, `member_profiles_tenant_name_idx`) are NOT declared here: they
 * are expression indexes over `app.imm_unaccent(lower(display_name))`, which drizzle-kit cannot
 * model — they live in the hand-written `*_member_profiles_search.sql` migration, together with the
 * `unaccent`/`pg_trgm` extensions and the trigger. Declaring them in both places would make
 * `pnpm db:generate` non-idempotent.
 */
export const memberProfiles = pgTable(
  'member_profiles',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** The membership this profile belongs to — the identity of record (R-08). */
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    /**
     * Denormalised from the membership so a directory page reads one table (R-10 index coverage).
     * `on delete cascade` like every other `user_id` FK in the schema (`memberships`,
     * `consent_records`): deleting the identity must take its per-tenant presentation with it, or
     * the LGPD deletion path — and every fixture teardown — is blocked by a profile row.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Seeded from `users.name` by the trigger; freely overwritten by the member (D-46). */
    displayName: text('display_name').notNull(),
    /** Plain text, 150 UTF-16 code units, newlines the only structure. SQL NULL means "no bio". */
    bio: text(),
    /** `media_assets.id` with `purpose = 'avatar'`; the payload carries `/v1/media/{id}/w128`. */
    avatarAssetId: uuid('avatar_asset_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
    /** D-02/R-13: the first-access nudge is server state, so a reinstall does not re-nag. */
    nudgeDismissedAt: timestamp('nudge_dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One profile per membership — also the conflict target the trigger and the backfill rely on.
    uniqueIndex('member_profiles_membership_uq').on(t.membershipId),
    index('member_profiles_tenant_user_idx').on(t.tenantId, t.userId),
    pgPolicy('member_profiles_tenant_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id()`,
    }),
    pgPolicy('member_profiles_self_update', {
      for: 'update',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
      withCheck: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
    }),
  ],
).enableRLS();
