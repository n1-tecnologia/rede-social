import { sql } from 'drizzle-orm';
import { check, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { platform, projects } from './projects';

/**
 * Phase 09.2-02 (D-545): the last health probe of a project (Management API plus a database ping), written
 * by the health sweep (plan 14). Central set only; RLS on, zero policies (see `projects.ts`). `detail_code`
 * is a content-free code.
 */
export const projectHealth = platform
  .table(
    'project_health',
    {
      projectId: uuid('project_id')
        .primaryKey()
        .references(() => projects.id, { onDelete: 'cascade' }),
      status: text().notNull().default('unknown'),
      detailCode: text('detail_code'),
      checkedAt: timestamp('checked_at', { withTimezone: true }),
    },
    (t) => [
      check(
        'project_health_status_chk',
        sql`${t.status} in ('healthy', 'paused', 'unreachable', 'unknown')`,
      ),
    ],
  )
  .enableRLS();
