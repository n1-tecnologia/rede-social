import { sql } from 'drizzle-orm';
import { check, integer, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { platform, projects } from './projects';

/**
 * Phase 09.2-02 (D-542): one row per bootstrap step of a project, so the durable bootstrap job (plan 13)
 * resumes from the first step that is not `done`. Central set only; RLS on, zero policies (see `projects.ts`).
 * The eight keys are the steps in order; `reason_code` is a content-free code, never an error message.
 */
export const projectBootstrapSteps = platform
  .table(
    'project_bootstrap_steps',
    {
      projectId: uuid('project_id')
        .notNull()
        .references(() => projects.id, { onDelete: 'cascade' }),
      step: text().notNull(),
      status: text().notNull().default('pending'),
      attempt: integer().notNull().default(0),
      reasonCode: text('reason_code'),
      startedAt: timestamp('started_at', { withTimezone: true }),
      finishedAt: timestamp('finished_at', { withTimezone: true }),
    },
    (t) => [
      primaryKey({ name: 'project_bootstrap_steps_pk', columns: [t.projectId, t.step] }),
      check(
        'project_bootstrap_steps_step_chk',
        sql`${t.step} in ('verify', 'roles', 'schema', 'auth', 'buckets', 'realtime', 'tenant', 'invite')`,
      ),
      check(
        'project_bootstrap_steps_status_chk',
        sql`${t.status} in ('pending', 'running', 'done', 'failed')`,
      ),
    ],
  )
  .enableRLS();
