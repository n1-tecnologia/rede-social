import { tenants, users } from '@rede-social/core/db/schema';
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * The notifications module's one table (NOTIF-01, NOTIF-02): a member's in-app bell rows. Moved
 * verbatim from the Phase 1 core stub (`notification-stubs.ts`, DDL-free) and reshaped in 07-01.
 *
 * Facts a reviewer must not "fix":
 *
 * 1. **Owner-only policies, no insert and no delete policy.** `notifications_owner_select` and
 *    `notifications_owner_update` are `tenant_id = app.tenant_id() and user_id = app.user_id()`: a
 *    member reads and marks ONLY their own rows, never a colleague's in the same tenant (T-07-03).
 *    The `tenant_id = app.tenant_id()` conjunct is load-bearing even beside `user_id`: a raw Supabase
 *    JWT (the Realtime token, 07-03) carries `sub` but no `tenant_id`, so without it a user's own rows
 *    would be readable over PostgREST (RESEARCH Pattern 5).
 * 2. **Writes go through the definer, never a tenant-lane INSERT.** `app.notifications_fanout`
 *    (`*_notifications_functions.sql`, SECURITY DEFINER, scoped to `app.tenant_id()`) is the only
 *    writer. A worker lane INSERT … RETURNING would fail the owner-scoped SELECT policy for every
 *    row that is not the (synthetic) worker user's own, and the fan-out needs `returning user_id` to
 *    signal and push only the NEWLY inserted recipients.
 * 3. **`payload` keeps its stub name and holds FACTS** (CONTEXT: "rendered from `kind` + payload"):
 *    an excerpt of at most 80 graphemes, a community name, a preview asset id. Renaming it would make
 *    drizzle-kit ask an interactive rename question (planning decision 8) for no gain.
 * 4. **There are no text columns for a sentence.** The web registry renders the pt-BR sentence from
 *    `kind` + facts at list time, and the actor's display name is read LIVE through `actor_user_id`,
 *    so a departed actor renders "Membro removido" rather than a frozen name.
 * 5. **`seen_at` and `read_at` are separate states that never merge (D-230).** Opening the list sets
 *    `seen_at` (the bell's count); tapping a row sets `read_at` (and `seen_at` when null). A read row
 *    is always seen; a seen row may be unread.
 * 6. **Idempotency is a natural key** (RESEARCH Pattern 6): `unique (tenant_id, user_id, dedupe_key)`
 *    plus `on conflict do nothing`, so a retried fan-out job inserts nothing twice and signals only
 *    what it newly inserted. Bus records carry no event id, which is why the stub's `event_id` goes.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** Recipient. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `<module>.<kind>` (`feed.post`), a string so a new kind is a row value, never a migration. */
    kind: text().notNull(),
    /** Facts the sentence is rendered from (see fact 3). Never a rendered sentence. */
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Natural idempotency key, e.g. `feed.post:<postId>` (fact 6). */
    dedupeKey: text('dedupe_key').notNull(),
    /** Routing and retraction target, e.g. `post` / `<postId>`. */
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /** A narrower target inside the subject (the comment inside the post), or null. */
    objectType: text('object_type'),
    objectId: uuid('object_id'),
    /** Who caused it; read LIVE at list time. A deleted user leaves the row with a null actor. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Set when the member opened the list (the bell's count is `seen_at is null`). */
    seenAt: timestamp('seen_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Fact 6: one row per recipient per logical notification.
    uniqueIndex('notifications_tenant_user_dedupe_uq').on(t.tenantId, t.userId, t.dedupeKey),
    // D-231: Novas (`read_at is null`) and Anteriores (`read_at is not null`) are two keysets, each
    // `created_at desc, id desc`, each served by its own partial index (pgTAP 151 fact 8, by name).
    index('notifications_unread_list_idx')
      .on(t.tenantId, t.userId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`read_at is null`),
    index('notifications_read_list_idx')
      .on(t.tenantId, t.userId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`read_at is not null`),
    // The bell's count: `count(*) … where seen_at is null` (pgTAP 151 fact 9).
    index('notifications_unseen_idx').on(t.tenantId, t.userId).where(sql`seen_at is null`),
    // Retraction (07-04): `app.notifications_retract` blanks the payload `where subject_type/subject_id`
    // or `object_type/object_id` (keep-and-mark, never a delete).
    index('notifications_subject_idx').on(t.tenantId, t.subjectType, t.subjectId),
    index('notifications_object_idx')
      .on(t.tenantId, t.objectType, t.objectId)
      .where(sql`object_id is not null`),
    // D-231 pruning (07-04): `app.notifications_prune` deletes rows older than 90 days, oldest first,
    // ACROSS tenants on purpose (the hourly sweeper runs it through the admin lane). This is the
    // documented exception to SCHEMA-CONVENTIONS' tenant-first rule: a deliberately cross-tenant prune
    // has no tenant to lead with. The table still has tenant-first indexes above (pgTAP 040).
    index('notifications_created_idx').on(t.createdAt),
    // Fact 1: owner-only, and still ANDed with the tenant claim.
    pgPolicy('notifications_owner_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
    }),
    pgPolicy('notifications_owner_update', {
      for: 'update',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
      withCheck: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
    }),
  ],
).enableRLS();

export type Notification = typeof notifications.$inferSelect;

/**
 * A member's Web Push subscriptions (07-06, NOTIF-03): one row per browser profile (endpoint) that
 * turned push on in this tenant. CONTEXT's Claude's Discretion item, decided in 07-06.
 *
 * Facts a reviewer must not "fix":
 *
 * 1. **Owner-only select and delete, no insert and no update policy.** `push_subscriptions_owner_*`
 *    are `tenant_id = app.tenant_id() and user_id = app.user_id()`: a member sees and removes ONLY
 *    their own devices (T-07-36), and the tenant conjunct keeps a raw Supabase JWT (no `tenant_id`)
 *    from reading its own rows over PostgREST (the notifications rule, RESEARCH Pattern 5).
 * 2. **Writes go through definers** (`*_push_subscriptions_functions.sql`): `app.push_subscription_upsert`
 *    for the member, and the worker's `app.push_subscriptions_for` / `…_delete_dead` / `…_report`.
 *    The upsert REPLACES any row of the same endpoint in the tenant, so a device handed from user A to
 *    user B stops receiving A's pushes (T-07-34).
 * 3. **Endpoint uniqueness is per tenant**, `(tenant_id, endpoint)` (07-06 planning decision 3): an
 *    endpoint is bound to one origin, so one tenant, and a tenant-first unique index never lets a
 *    tenant lane touch another tenant's row.
 * 4. **The endpoint is attacker-controlled input** the worker later POSTs to: the API refuses anything
 *    but `https:` on a known push-service host (`isAllowedPushEndpoint`, T-07-33) before it gets here.
 * 5. **Keys are stored as the browser sent them** (base64url `p256dh` 65 bytes, `auth` 16 bytes); they
 *    are encryption material for the payload, not credentials, and never leave the worker.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** The subscribing member. A deleted user takes their devices with them. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The push service URL the browser handed out (fact 4). */
    endpoint: text().notNull(),
    /** The browser's P-256 ECDH public key, base64url (65 raw bytes). */
    p256dh: text().notNull(),
    /** The browser's auth secret, base64url (16 raw bytes). */
    auth: text().notNull(),
    /** Informational only (at most 512 characters, API-bounded): which device this is. */
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Stamped on every 201/202 from the push service. */
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    /** Consecutive failed sends (400/413/429/5xx/network); reset to 0 by a success. */
    failureCount: integer('failure_count').notNull().default(0),
  },
  (t) => [
    // Fact 3: one row per endpoint per tenant; the upsert's conflict target.
    uniqueIndex('push_subscriptions_tenant_endpoint_uq').on(t.tenantId, t.endpoint),
    // The worker's per-recipient lookup (`app.push_subscriptions_for`) and the owner's own list.
    index('push_subscriptions_tenant_user_idx').on(t.tenantId, t.userId),
    // Fact 1: owner-only, ANDed with the tenant claim.
    pgPolicy('push_subscriptions_owner_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
    }),
    pgPolicy('push_subscriptions_owner_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
    }),
  ],
).enableRLS();

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
