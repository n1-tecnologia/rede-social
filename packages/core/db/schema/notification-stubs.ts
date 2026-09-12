import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls';
import { tenants } from './tenants';
import { users } from './users';

/**
 * V2-safe notification stub (Foundation deliverable; Phase 7 builds the module on top).
 *
 * `kind` is a string, not an enum, so a new notification type is a row value, never a migration.
 * `payload` freezes the rendered bits (actor name, snippet) at creation time so the bell never
 * re-joins into other modules' tables. `event_id` makes worker fan-out idempotent per recipient:
 * a retried job re-inserts and hits the partial unique index instead of duplicating the bell.
 *
 * Phase 1 ships shape only: `tenant_id` + RLS + isolation policy so the pgTAP coverage test
 * (01-08) passes from day one. No triggers, no Realtime wiring, no routes.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** Recipient. Tenant-scoped like every other row (RLS reads `tenant_id`, not this column). */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Producing domain event; null for notifications created outside the event bus. */
    eventId: uuid('event_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Fan-out is idempotent on (event_id, user_id) — see ROADMAP Phase 7 notes.
    uniqueIndex('notifications_event_user_uq')
      .on(t.eventId, t.userId)
      .where(sql`event_id is not null`),
    // Unread count and inbox listing: `... where tenant_id = $1 and user_id = $2 and read_at is null`.
    index('notifications_tenant_user_read_idx').on(t.tenantId, t.userId, t.readAt),
    tenantIsolationPolicy('notifications_tenant_isolation'),
  ],
).enableRLS();
