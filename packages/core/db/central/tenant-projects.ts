import { index, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '../schema/tenants';
import { platform, projects } from './projects';

/**
 * Phase 09.2-02 (D-538, D-540): the BINDING of a tenant to the project that holds its data. Central set
 * only; RLS on, zero policies (see `projects.ts`).
 *
 * `tenant_id` is the primary key (a tenant lives in exactly one project at a time) and `project_id` is NOT
 * unique: several tenants may share one project (D-540). `previous_project_id` is what a move (plan 23)
 * leaves behind for the rollback. The binding is explicit: a tenant with none is refused by the deferred
 * `tenants_bind_default` trigger of the hardening migration (fail closed, DBT-46) rather than silently
 * served from the central project.
 */
export const tenantProjects = platform
  .table(
    'tenant_projects',
    {
      tenantId: uuid('tenant_id')
        .primaryKey()
        .references(() => tenants.id, { onDelete: 'cascade' }),
      projectId: uuid('project_id')
        .notNull()
        .references(() => projects.id),
      previousProjectId: uuid('previous_project_id').references(() => projects.id),
      boundAt: timestamp('bound_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('tenant_projects_project_idx').on(t.projectId)],
  )
  .enableRLS();
