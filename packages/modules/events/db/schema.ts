import { tenantIsolationPolicy } from '@tria/core/db/rls';
import { mediaAssets, tenants, users } from '@tria/core/db/schema';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * The events module's tables (EVENT-01, EVENT-02; D-213, D-217): `events`, which every member of the
 * tenant reads, and `event_secrets`, which only the tenant's `admin_tenant` lane can read or write.
 *
 * FOUR THINGS A REVIEWER MUST NOT "FIX":
 *
 * 1. **The meeting URL and the check-in code are NOT columns of `events`, and must never become
 *    ones** (D-207, D-208, D-217). Every member lane reads `events` under
 *    `events_tenant_isolation`, so any column on it is selectable by any member through RLS alone. A
 *    column privilege cannot tell them apart either: an admin and a member are the SAME database role
 *    (`authenticated`), distinguished only by the `tenant_role` claim. So the two secrets live in a
 *    separate table whose policy reads that claim.
 *
 * 2. **`event_secrets_staff_all` spells the role as an INLINE literal** (`STAFF_ONLY` below, the
 *    `tenant_role` claim compared to the admin role) rather than calling a helper such as
 *    `app.events_staff()`. drizzle-kit emits `CREATE POLICY` inside the generated migration, so a
 *    policy that called a function would need that function created BEFORE a statement this tool
 *    owns. The literal keeps the policy next to its table, reviewable here, and free of any
 *    migration-ordering hazard. Widening it later (say to `support_tenant`, so staff at the door can
 *    read the code) is a one-line edit here that drizzle-kit emits as `ALTER POLICY`, plus one line
 *    in the manifest's `defaultRolePermissions`.
 *
 * 3. **The two foreign keys that tie the tables together are HAND-WRITTEN in the migration**, not
 *    declared here, because drizzle-kit cannot express `DEFERRABLE INITIALLY DEFERRED`:
 *    - `event_secrets_event_fk (tenant_id, event_id, event_format) -> events (tenant_id, id, format)`
 *      carries the D-213 XOR across both tables through a redundant discriminator (the D-53
 *      pattern): an online event's secrets row says `online`, and `event_secrets_url_chk` then
 *      requires its URL;
 *    - `events_secrets_fk (id) -> event_secrets (event_id)` makes "every event has exactly one
 *      secrets row" a commit-time fact.
 *    Both are deferred so a format switch (D-214) can update both halves in one transaction in any
 *    statement order. `events_tenant_id_format_uq` below is the composite FK's target, which is why a
 *    unique index that looks redundant with the primary key exists.
 *
 * 4. **`checkin_code` is NOT NULL for BOTH formats.** An online event carries an unused code, so a
 *    later switch to in person needs no backfill.
 *
 * `events` keeps the standard `for all` isolation policy: the RSVP guard trigger (06-03) reads the
 * event row `FOR SHARE` from a member lane, which needs the UPDATE policy to see it. Who may WRITE an
 * event is `requirePermission('events.event.manage')`, the Phase 4/5 posture.
 *
 * `event_attendances` (06-03) is the third table: one row per member per event, policed for EVERY
 * writer by the hand-written guard trigger `app.event_attendance_guard()` (see its docblock below).
 * `event_checkin_attempts` (06-05) is the fourth: the venue-code guess counter, written ONLY by the
 * SECURITY DEFINER function `app.events_check_in` (see its docblock at the end of this file).
 *
 * Owned by `packages/modules/events` and picked up by `apps/api/drizzle.config.ts`'s module glob.
 */
export const events = pgTable(
  'events',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Generic authorship (SCHEMA-CONVENTIONS §(c).1). Stored for auditing, never projected. */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    title: text().notNull(),
    /** `''` rather than NULL: "no description" is ONE value. */
    description: text().notNull().default(''),
    /** NULLABLE (D-69). Null takes the `--brand-gradient` fallback. */
    coverAssetId: uuid('cover_asset_id').references(() => mediaAssets.id),
    /** `'in_person' | 'online'`, the XOR discriminator (D-213). */
    format: text().notNull(),
    venueName: text('venue_name'),
    address: text(),
    /** UTC instants, converted from the admin's wall clock in the tenant's timezone by the insert. */
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** `'active' | 'cancelled'`: a status column with a CHECK, never a boolean (§(d).1). */
    status: text().notNull().default('active'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Phase 8 moderation. The product itself never deletes an event (D-214). */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // The target of `event_attendances`' composite FK (06-03): `(tenant_id, id)`.
    uniqueIndex('events_tenant_id_uq').on(t.tenantId, t.id),
    // The target of the hand-written `event_secrets_event_fk` (fact 3 above).
    uniqueIndex('events_tenant_id_format_uq').on(t.tenantId, t.id, t.format),
    // Próximos (and 06-08's Início card): `ends_at > now()` ordered `starts_at asc, id asc`. An
    // ascending order needs no `.nullsFirst()`: drizzle's default `ASC NULLS LAST` is SQL's default.
    index('events_tenant_starts_idx')
      .on(t.tenantId, t.startsAt, t.id)
      .where(sql`deleted_at is null`),
    // Passados: `ends_at <= now()` ordered `ends_at desc, id desc`. `.nullsFirst()` is NOT
    // decoration (04-03's lesson): drizzle's `.desc()` alone emits `DESC NULLS LAST`, which does not
    // match SQL's `order by x desc`, and the planner would sort instead of riding the index.
    index('events_tenant_ends_idx')
      .on(t.tenantId, t.endsAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`deleted_at is null`),
    check('events_format_chk', sql`${t.format} in ('in_person','online')`),
    check('events_status_chk', sql`${t.status} in ('active','cancelled')`),
    // D-213. The service maps a violation of THIS name to `end_before_start` (a DST fold can pass
    // the wall-clock comparison in Zod and still land here).
    check('events_window_chk', sql`${t.endsAt} > ${t.startsAt}`),
    // D-213's XOR, declaratively (the D-53 pattern): in person carries a non-blank venue AND
    // address; online carries neither (its URL lives in `event_secrets`).
    check(
      'events_location_chk',
      sql`(${t.format} = 'in_person' and ${t.venueName} is not null and ${t.address} is not null and length(btrim(${t.venueName})) > 0 and length(btrim(${t.address})) > 0) or (${t.format} = 'online' and ${t.venueName} is null and ${t.address} is null)`,
    ),
    check(
      'events_cancelled_at_chk',
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`,
    ),
    tenantIsolationPolicy('events_tenant_isolation'),
  ],
).enableRLS();

/**
 * The ONE predicate of `event_secrets_staff_all`, used for both `using` and `with check` so the read
 * and the write rule can never drift apart: this tenant, and the `admin_tenant` role claim.
 */
const STAFF_ONLY = sql`tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant'`;

/**
 * The admin-only half of an event (D-217): its meeting URL and its venue code. See facts 1-4 above.
 *
 * One row per event (`event_id` is the primary key). `tenant_id` is carried on the row, as on every
 * tenant-owned table, so the policy and the tenant-first index can start with it.
 */
export const eventSecrets = pgTable(
  'event_secrets',
  {
    eventId: uuid('event_id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** The redundant discriminator the composite FK checks against `events.format` (fact 3). */
    eventFormat: text('event_format').notNull(),
    /** Always present (fact 4), 4 symbols from `EVENT_CHECKIN_CODE_ALPHABET`. */
    checkinCode: text('checkin_code').notNull(),
    /** `https:` only, and present exactly when the event is online. */
    meetingUrl: text('meeting_url'),
    codeRotatedAt: timestamp('code_rotated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Tenant-first (the 040 gate): every lookup the policy filters starts with `tenant_id`.
    uniqueIndex('event_secrets_tenant_event_uq').on(t.tenantId, t.eventId),
    check(
      'event_secrets_url_chk',
      sql`(${t.eventFormat} = 'online') = (${t.meetingUrl} is not null)`,
    ),
    check(
      'event_secrets_https_chk',
      sql`${t.meetingUrl} is null or lower(${t.meetingUrl}) like 'https://%'`,
    ),
    check(
      'event_secrets_code_chk',
      sql`${t.checkinCode} ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$'`,
    ),
    // Fact 2: the repo's first role-gated policy. A member lane of the same tenant sees ZERO rows.
    pgPolicy('event_secrets_staff_all', {
      for: 'all',
      to: authenticatedRole,
      using: STAFF_ONLY,
      withCheck: STAFF_ONLY,
    }),
  ],
).enableRLS();

/**
 * The RSVP write policies' ONE predicate, for `with check` and (update) `using` alike: this tenant,
 * the caller's OWN row, and only an RSVP status. `checked_in` / `walk_in` are unreachable from a
 * member lane (T-06-11): 06-05/06-06 write them through SECURITY DEFINER functions.
 */
const SELF_RSVP = sql`tenant_id = app.tenant_id() and user_id = app.user_id() and status in ('going','not_going')`;

/**
 * One member's attendance at one event (EVENT-03, D-216): their RSVP answer and, later, their
 * check-in. THREE THINGS A REVIEWER MUST NOT "FIX":
 *
 * 1. **`status` is one column with four values** (`going`, `not_going`, `checked_in`, `walk_in`),
 *    never boolean pairs (SCHEMA-CONVENTIONS §(d).1). Walk-in is its OWN value (D-216), set when a
 *    check-in lands on no row or on a `not_going` row; `going -> checked_in` keeps `responded_at`, so
 *    "Confirmou em" survives the check-in. Every attendance chip is then one status predicate, and
 *    the member-facing count is `going + checked_in` (D-219), computed at READ time: a counter row
 *    updated inside the guard's `FOR SHARE` would upgrade the lock and deadlock two concurrent
 *    RSVPs (Pitfall 3).
 *
 * 2. **The select policy is tenant-wide, the write policies are self-only.** The in-lane counts
 *    (`count(*) filter …`) need every row of the event visible to the member's lane. Who-is-going
 *    privacy (D-206) is an API property: no member payload ever projects another member's row. There
 *    is NO delete policy: answers and check-ins always survive (D-214, T-06-15).
 *
 * 3. **When an answer is still allowed is NOT expressed here.** A CHECK cannot read `events`, so the
 *    rule "no RSVP from `starts_at` on, nothing on a cancelled event, a checked-in row is locked, a
 *    check-in only inside its window" lives in the hand-written BEFORE INSERT OR UPDATE trigger
 *    `event_attendances_guard` (`supabase/migrations/*_event_attendance_guard.sql`), which applies to
 *    every writer, admin lane included (D-204).
 */
export const eventAttendances = pgTable(
  'event_attendances',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    /** Does not cascade, like every other authored row (`users` rows are not deleted). */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** `'going' | 'not_going' | 'checked_in' | 'walk_in'` (fact 1). */
    status: text().notNull(),
    /** The LAST RSVP answer's instant, kept after check-in. Null only on a walk-in. */
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    /** `'code' | 'online'`, present exactly when checked in. */
    checkinVia: text('checkin_via'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Composite, so an attendance can only point at an event of ITS OWN tenant.
    foreignKey({
      name: 'event_attendances_event_fk',
      columns: [t.tenantId, t.eventId],
      foreignColumns: [events.tenantId, events.id],
    }).onDelete('cascade'),
    // The RSVP upsert's arbiter, and the viewer join's lookup.
    uniqueIndex('event_attendances_tenant_event_user_uq').on(t.tenantId, t.eventId, t.userId),
    // The count aggregate and 06-07's status chips. `.nullsFirst()` on the DESC columns matches
    // SQL's `order by x desc` (the 04-03 lesson).
    index('event_attendances_tenant_event_status_idx').on(
      t.tenantId,
      t.eventId,
      t.status,
      t.respondedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // 06-07's Presentes chip.
    index('event_attendances_tenant_event_checkin_idx')
      .on(t.tenantId, t.eventId, t.checkedInAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`checked_in_at is not null`),
    check(
      'event_attendances_status_chk',
      sql`${t.status} in ('going','not_going','checked_in','walk_in')`,
    ),
    check(
      'event_attendances_checkin_chk',
      sql`(${t.status} in ('checked_in','walk_in')) = (${t.checkedInAt} is not null) and (${t.status} in ('checked_in','walk_in')) = (${t.checkinVia} is not null)`,
    ),
    check(
      'event_attendances_via_chk',
      sql`${t.checkinVia} is null or ${t.checkinVia} in ('code','online')`,
    ),
    check(
      'event_attendances_answered_chk',
      sql`${t.status} = 'walk_in' or ${t.respondedAt} is not null`,
    ),
    pgPolicy('event_attendances_tenant_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id()`,
    }),
    pgPolicy('event_attendances_self_rsvp_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: SELF_RSVP,
    }),
    pgPolicy('event_attendances_self_rsvp_update', {
      for: 'update',
      to: authenticatedRole,
      using: SELF_RSVP,
      withCheck: SELF_RSVP,
    }),
  ],
).enableRLS();

/**
 * The venue-code guess counter (D-217, T-06-27, T-06-30): at most `EVENT_CHECKIN_MAX_FAILED` wrong
 * codes per member per event per `EVENT_CHECKIN_FAILED_WINDOW_MINUTES` window. THREE THINGS A
 * REVIEWER MUST NOT "FIX":
 *
 * 1. **There is NO insert, update or delete policy, on purpose.** The only writer is the SECURITY
 *    DEFINER function `app.events_check_in` (`supabase/migrations/*_event_check_in_function.sql`),
 *    which runs as its owner and bypasses RLS. A member lane that could write this table could reset
 *    its own bound (T-06-30), so the member lane reads its OWN row (`…_self_select`, for tests and a
 *    future "tentativas restantes" hint) and writes nothing. `supabase/tests/142-event-checkin.sql`
 *    fact 11 asserts the refusal.
 *
 * 2. **A refused guess must COMMIT** (Pitfall 1). The function RETURNS `wrong_code` instead of
 *    raising, and the service throws its 409 only after `withTenantTx` resolved, so the counter
 *    increment survives the refusal. A trigger or a `raise` here would roll it back and the bound
 *    would never trip.
 *
 * 3. **The primary key is `(tenant_id, event_id, user_id)`**: tenant-first (the 040 gate), and the
 *    function's upsert arbiter. The window is ONE row per member per event: `failed_count` counts
 *    inside the window that started at `window_started_at`, and the first wrong code after the
 *    window expired resets both.
 */
export const eventCheckinAttempts = pgTable(
  'event_checkin_attempts',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    /** Does not cascade, like every other authored row (`users` rows are not deleted). */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    failedCount: integer('failed_count').notNull().default(0),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'event_checkin_attempts_pkey',
      columns: [t.tenantId, t.eventId, t.userId],
    }),
    // Composite, so a counter can only point at an event of ITS OWN tenant, and dies with it.
    foreignKey({
      name: 'event_checkin_attempts_event_fk',
      columns: [t.tenantId, t.eventId],
      foreignColumns: [events.tenantId, events.id],
    }).onDelete('cascade'),
    pgPolicy('event_checkin_attempts_self_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
    }),
  ],
).enableRLS();
