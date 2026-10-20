import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * DEPRECATED (09.1-03, D-487): replaced by the per-tenant `access_grants`. Nothing reads this table
 * any more except the one-off function `public.migrate_email_allowlist_to_access_grants()`; a later
 * CONTRACT release drops the table with that function (the API revision serving during `db push` still
 * reads it until then). Do not add readers or writers.
 *
 * Quick 261018-owq: the platform-global e-mail allowlist. Only an e-mail present here with status
 * `liberado` can create an account or receive a token (the `custom_access_token` and
 * `before_user_created` auth hooks plus the API pre-checks read it). An ABSENT row means blocked.
 *
 * The table is platform-global, with no `tenant_id`: one list for the whole platform. RLS is enabled
 * with **no policy at all**, deliberately: `authenticated` (the tenant lane) and `anon` can never see
 * a row. The only readers are the two auth-hook functions (SECURITY DEFINER, owner postgres) and the
 * admin lane (`withAdminTx`, `service_role`) used by the API pre-checks. Adding a policy for
 * `authenticated` to this table is always a bug (same rule as `platform_admins`).
 *
 * Igor maintains the list by hand in the Supabase SQL Editor (no UI, no endpoint).
 *
 * The e-mail is plain `text` with `email = lower(btrim(email))` enforced by a CHECK, NOT `citext`:
 * citext's `=` does not resolve inside a `search_path = ''` definer and silently falls back to a
 * case-sensitive comparison. Every reader normalises its input with `lower(btrim())` in SQL.
 */
export const emailAllowlist = pgTable(
  'email_allowlist',
  {
    email: text('email').primaryKey(),
    status: text('status').notNull().default('liberado'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('email_allowlist_status_chk', sql`${t.status} in ('liberado','bloqueado')`),
    check('email_allowlist_email_lower_chk', sql`${t.email} = lower(btrim(${t.email}))`),
  ],
).enableRLS();
