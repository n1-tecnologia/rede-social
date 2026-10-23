import { sql } from 'drizzle-orm';
import { check, index, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '../schema/tenants';
import { platform, projects } from './projects';

/**
 * Phase 09.2-23 (D-534, D-535, D-536, DBT-34, DBT-48): the MOVE of a tenant to a project of its own. Central
 * set only; RLS on, ZERO policies (see `projects.ts`): only `service_role` through the platform lane reads or
 * writes them, and only the operator's move tool does.
 *
 * `tenant_moves` is the state machine of ONE move. `state` only advances `planned -> suspended -> copied ->
 * verified -> cutover -> done`, or ends `rolled_back`; every advance is a compare-and-set
 * (`update ... where id = $1 and state = $from`), so two runners cannot both advance the same move. The state
 * is a CLOSED FORMAT (a check), never an enum: the set is code. `status_before` is the tenant's status when the
 * move started (restored at the end: a tenant that was suspended stays suspended). `actor` is an operator
 * label, never free text. `counts` and `fingerprint` hold numbers and a digest, never a row. A runner holds a
 * 15-minute row lease (`lease_owner`, `lease_until`), never a session lock, so a transaction pooler cannot lose
 * it. `source_deleted_at` is set by `--confirm-delete` and makes the move non-rollbackable.
 *
 * One OPEN move per tenant is a partial unique index: a second concurrent start fails with `move_in_progress`.
 * The tenant row cascades its moves away (a tenant that is deleted takes its history with it).
 *
 * `tenant_move_events` is the append-only AUDIT of a move (T-09.2-103): kind, counts, table names and codes
 * only. An update raises (the hardening migration's trigger); the cascade delete from the move stays possible.
 */
export const tenantMoves = platform
  .table(
    'tenant_moves',
    {
      id: uuid().primaryKey().defaultRandom(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => tenants.id, { onDelete: 'cascade' }),
      fromProjectId: uuid('from_project_id')
        .notNull()
        .references(() => projects.id),
      toProjectId: uuid('to_project_id')
        .notNull()
        .references(() => projects.id),
      state: text().notNull().default('planned'),
      statusBefore: text('status_before').notNull(),
      actor: text().notNull(),
      counts: jsonb().$type<Record<string, unknown>>().notNull().default({}),
      fingerprint: text(),
      errorCode: text('error_code'),
      leaseOwner: uuid('lease_owner'),
      leaseUntil: timestamp('lease_until', { withTimezone: true }),
      startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      cutoverAt: timestamp('cutover_at', { withTimezone: true }),
      finishedAt: timestamp('finished_at', { withTimezone: true }),
      sourceDeletedAt: timestamp('source_deleted_at', { withTimezone: true }),
    },
    (t) => [
      check('tenant_moves_projects_chk', sql`${t.fromProjectId} <> ${t.toProjectId}`),
      check(
        'tenant_moves_state_chk',
        sql`${t.state} in ('planned', 'suspended', 'copied', 'verified', 'cutover', 'done', 'rolled_back')`,
      ),
      check('tenant_moves_status_before_chk', sql`${t.statusBefore} in ('active', 'suspended')`),
      check('tenant_moves_actor_chk', sql`${t.actor} ~ '^[A-Za-z0-9:_@.-]{1,64}$'`),
      check(
        'tenant_moves_error_code_chk',
        sql`${t.errorCode} is null or ${t.errorCode} ~ '^[a-z_]{3,40}$'`,
      ),
      uniqueIndex('tenant_moves_one_open_uq')
        .on(t.tenantId)
        .where(sql`${t.state} not in ('done', 'rolled_back')`),
      index('tenant_moves_to_project_idx').on(t.toProjectId),
    ],
  )
  .enableRLS();

export const tenantMoveEvents = platform
  .table(
    'tenant_move_events',
    {
      id: uuid().primaryKey().defaultRandom(),
      moveId: uuid('move_id')
        .notNull()
        .references(() => tenantMoves.id, { onDelete: 'cascade' }),
      at: timestamp({ withTimezone: true }).notNull().defaultNow(),
      kind: text().notNull(),
      detail: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    },
    (t) => [
      check('tenant_move_events_kind_chk', sql`${t.kind} ~ '^[a-z_]{3,40}$'`),
      index('tenant_move_events_move_idx').on(t.moveId, t.at),
    ],
  )
  .enableRLS();
