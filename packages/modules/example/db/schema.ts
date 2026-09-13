import { tenantIsolationPolicy } from '@tria/core/db/rls';
import { tenants, users } from '@tria/core/db/schema';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The module's ONE table (D-19), and the worked example of the SCHEMA-CONVENTIONS checklist:
 *
 * - `tenant_id` on the row itself, `.enableRLS()` and the standard `tenantIsolationPolicy` — never
 *   a hand-rolled predicate (conventions a.1–a.3);
 * - generic authorship (`created_by_user_id -> users.id`), never `admin_id` or `from_admin`: who may
 *   create is `requireRole('admin_tenant')` in the route, so V2 member posting is a guard change
 *   (conventions c.1–c.2);
 * - the list index matches the list query exactly, including the tie-breaker (conventions a.4);
 * - `public` schema with a module prefix, snake_case, `_idx`/`_tenant_isolation` suffixes (g).
 *
 * Owned by `packages/modules/example` and picked up by `apps/api/drizzle.config.ts`'s
 * `packages/modules/*​/db/schema.ts` glob. Phase 4 deletes the package AND drops this table.
 */
export const exampleItems = pgTable(
  'example_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set by the `example.process` pg-boss job, through the tenant lane (never by the request). */
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    // TENANT-03 ordering: `created_at desc, id desc` is the list's ORDER BY, tie-breaker included,
    // so two items written in the same millisecond still come back in a stable order.
    index('example_items_tenant_created_idx').on(t.tenantId, t.createdAt.desc(), t.id.desc()),
    tenantIsolationPolicy('example_items_tenant_isolation'),
  ],
).enableRLS();
