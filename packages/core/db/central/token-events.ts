import { sql } from 'drizzle-orm';
import { check, index, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { platform, projects } from './projects';

/**
 * Phase 09.4-02 (D-568, CTK-28): the append-only AUDIT of the customer's management token. Central set only;
 * RLS on, ZERO policies (see `projects.ts`): only `service_role` through the platform lane reads or writes it.
 *
 * One row per registration, replacement, owner change or re-pin: the KIND, the project, the operator label and
 * an outcome from a closed list. No column can hold a token, a prefix, a hash or a length (D-539). `project_id`
 * is NULLABLE on purpose: a refusal can precede the project (the registration of a token that never became a
 * project). The project cascades its events away when it is deleted, exactly as a move does. An UPDATE raises
 * (the hardening migration's trigger); `actor` is an operator label, never free text.
 */
export const projectTokenEvents = platform
  .table(
    'project_token_events',
    {
      id: uuid().primaryKey().defaultRandom(),
      kind: text().notNull(),
      projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
      projectRef: text('project_ref').notNull(),
      actor: text().notNull(),
      outcome: text().notNull(),
      at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check(
        'project_token_events_kind_chk',
        sql`${t.kind} in ('registered', 'replaced', 'owner_changed', 'repinned')`,
      ),
      check('project_token_events_ref_chk', sql`${t.projectRef} ~ '^[a-z][a-z0-9-]{2,39}$'`),
      check('project_token_events_actor_chk', sql`${t.actor} ~ '^[A-Za-z0-9:_@.-]{1,64}$'`),
      check(
        'project_token_events_outcome_chk',
        sql`${t.outcome} in ('ok', 'token_invalid', 'token_forbidden', 'token_other_project', 'token_account_wide', 'token_expiry_invalid', 'org_mismatch', 'not_found', 'unchecked')`,
      ),
      index('project_token_events_project_idx').on(t.projectId, t.at.desc()),
    ],
  )
  .enableRLS();
