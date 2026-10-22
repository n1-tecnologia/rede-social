import { sql } from 'drizzle-orm';
import { check, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { platform, projects } from './projects';

/**
 * Phase 09.2-02 (D-544): how far a project's tenant migration ledger is behind the image's manifest. Written
 * by the fan-out (plans 12 and 15), read by the panel. Central set only; RLS on, zero policies (see
 * `projects.ts`). `error_code` is a content-free code; `failed_version` names the file that stopped the run.
 */
export const projectSchemaState = platform
  .table(
    'project_schema_state',
    {
      projectId: uuid('project_id')
        .primaryKey()
        .references(() => projects.id, { onDelete: 'cascade' }),
      appliedCount: integer('applied_count'),
      appliedHead: text('applied_head'),
      requiredCount: integer('required_count'),
      requiredHead: text('required_head'),
      status: text().notNull().default('unknown'),
      failedVersion: text('failed_version'),
      errorCode: text('error_code'),
      checkedAt: timestamp('checked_at', { withTimezone: true }),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check(
        'project_schema_state_status_chk',
        sql`${t.status} in ('current', 'behind', 'failed', 'unknown')`,
      ),
    ],
  )
  .enableRLS();
