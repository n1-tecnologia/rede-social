import {
  BOOTSTRAP_REASON_CODES,
  BOOTSTRAP_STEP_KEYS,
  BOOTSTRAP_STEP_STATUSES,
  type BootstrapReasonCode,
  type BootstrapStepRow,
  type DatabaseOverview,
  databaseState,
  type TenantDatabaseSummary,
  type TokenSummary,
} from '@rede-social/contracts/projects';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
  projectBootstrapSteps,
  projectHealth,
  projectSchemaState,
  projects,
  tenantProjects,
} from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { getRequiredTenantSchema } from '../migrations/required';
import { isTenantMoving } from './moving';
import { tokenStateOf } from './token-state';

/**
 * The Banco tab's data (09.2-14, D-537, D-542, D-543, D-545, UI-D-536..539): everything the panel shows about a
 * tenant's database, built from the registry in ONE platform-lane read and the move fact after it (never
 * nested lanes). The answer is the strict `databaseOverviewSchema`: it carries the ref, the plan as
 * information, the steps with their reason CODES, the applied-of-required schema counts, the last check, and
 * whether the registry HOLDS credentials. It has no field that could carry a credential, and nothing here reads
 * a sealed column's value: only whether it is present.
 *
 * 09.4-13 (D-566, D-571..D-574, UI-D-552, CTK-34): the answer also names who owns the project (`owner`), the
 * Supabase organisation a customer project is pinned to (`organization`, the slug and nothing else) and the token
 * summary (`token`: the state from `tokenStateOf`, the expiry the operator typed, when the last check ran). A
 * platform project answers `owner: 'platform'`, `organization: null`, `token: null`. The token is its OWN axis:
 * `summarizeDatabase` and `databaseState` get no token input, so a dead token never changes `state` or
 * `lastErrorCode`. The plan stays information (D-572): a customer project registered by this phase has `plan`
 * null, the platform never reads it from the Management API, and the panel says 'Plano: Não informado'.
 */

const REASONS: ReadonlySet<string> = new Set(BOOTSTRAP_REASON_CODES);
const STEP_KEYS: ReadonlySet<string> = new Set(BOOTSTRAP_STEP_KEYS);
const STEP_STATUSES: ReadonlySet<string> = new Set(BOOTSTRAP_STEP_STATUSES);

/** A stored reason becomes a catalog code; anything outside the catalog is `unknown`, never shown as text. */
export function reasonCodeOf(value: string | null | undefined): BootstrapReasonCode | null {
  if (value === null || value === undefined) return null;
  return REASONS.has(value) ? (value as BootstrapReasonCode) : 'unknown';
}

export type DatabaseFacts = {
  /** `platform.projects.state`. */
  projectState: string;
  /** The bootstrap step rows of the project (only `status` is read). */
  steps: ReadonlyArray<{ status: string }>;
  /** `platform.project_health.status`, `null` when the project was never checked. */
  healthStatus: string | null;
  /** `platform.project_schema_state.applied_count`, `null` when there is no row. */
  appliedCount: number | null;
  moving: boolean;
  /** Test seam: the required count; default is the image's (`null` until plan 15 loads the manifest). */
  required?: number | null;
};

/**
 * The state and the schema counts of one project, from the facts the registry holds. The ONE place the
 * overview and the tenant list turn rows into a state, so the Banco tab, the list pill and the header cannot
 * disagree (`databaseState` is the derivation; this only gathers its inputs).
 */
export function summarizeDatabase(facts: DatabaseFacts): TenantDatabaseSummary {
  const schema = {
    applied: facts.appliedCount ?? null,
    required:
      facts.required === undefined ? (getRequiredTenantSchema()?.count ?? null) : facts.required,
  };
  const state = databaseState({
    projectState: facts.projectState,
    steps: facts.steps,
    health: facts.healthStatus,
    schema,
    moving: facts.moving,
  });
  return { state, schema };
}

const iso = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);

/** The project a tenant is bound to (id, ref, state), or `null`: the panel routes resolve every action through it. */
export async function projectOfTenant(
  tenantId: string,
): Promise<{ id: string; ref: string; state: string; central: boolean } | null> {
  const [row] = await withPlatformTx((tx) =>
    tx
      .select({
        id: projects.id,
        ref: projects.ref,
        state: projects.state,
        isCentral: projects.isCentral,
        source: projects.credentialSource,
      })
      .from(tenantProjects)
      .innerJoin(projects, eq(projects.id, tenantProjects.projectId))
      .where(eq(tenantProjects.tenantId, tenantId))
      .limit(1),
  );
  if (!row) return null;
  return {
    id: row.id,
    ref: row.ref,
    state: row.state,
    central: row.isCentral || row.source === 'env',
  };
}

export async function getDatabaseOverview(tenantId: string): Promise<DatabaseOverview | null> {
  const facts = await withPlatformTx(async (tx) => {
    const [project] = await tx
      .select({
        id: projects.id,
        ref: projects.ref,
        plan: projects.plan,
        state: projects.state,
        credentialSource: projects.credentialSource,
        updatedAt: projects.updatedAt,
        owner: projects.owner,
        orgSlug: projects.orgSlug,
        // A `date` column read as the typed `YYYY-MM-DD` string, never a Date (no timezone enters).
        expiresAt: projects.mgmtTokenExpiresAt,
        hasSealed: sql<boolean>`(
          ${projects.databaseUrlTxSealed} is not null
          or ${projects.databaseUrlSessionSealed} is not null
          or ${projects.ddlUrlSealed} is not null
          or ${projects.serviceKeySealed} is not null)`,
        healthStatus: projectHealth.status,
        healthDetail: projectHealth.detailCode,
        healthCheckedAt: projectHealth.checkedAt,
        tokenCheck: projectHealth.tokenCheck,
        tokenCheckedAt: projectHealth.tokenCheckedAt,
        appliedCount: projectSchemaState.appliedCount,
      })
      .from(tenantProjects)
      .innerJoin(projects, eq(projects.id, tenantProjects.projectId))
      .leftJoin(projectHealth, eq(projectHealth.projectId, projects.id))
      .leftJoin(projectSchemaState, eq(projectSchemaState.projectId, projects.id))
      .where(eq(tenantProjects.tenantId, tenantId))
      .limit(1);
    if (!project) return null;

    const steps = await tx
      .select()
      .from(projectBootstrapSteps)
      .where(eq(projectBootstrapSteps.projectId, project.id))
      .orderBy(asc(projectBootstrapSteps.step));

    const [others] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tenantProjects)
      .where(and(eq(tenantProjects.projectId, project.id), ne(tenantProjects.tenantId, tenantId)));

    return { project, steps, others: others?.n ?? 0 };
  });
  if (!facts) return null;

  const moving = await isTenantMoving(tenantId);
  const { project } = facts;

  const rows: BootstrapStepRow[] = facts.steps
    .filter((row) => STEP_KEYS.has(row.step) && STEP_STATUSES.has(row.status))
    .map((row) => ({
      step: row.step as BootstrapStepRow['step'],
      status: row.status as BootstrapStepRow['status'],
      attempt: row.attempt,
      reasonCode: reasonCodeOf(row.reasonCode),
      startedAt: iso(row.startedAt),
      finishedAt: iso(row.finishedAt),
    }))
    .sort((a, b) => BOOTSTRAP_STEP_KEYS.indexOf(a.step) - BOOTSTRAP_STEP_KEYS.indexOf(b.step));

  const { state, schema } = summarizeDatabase({
    projectState: project.state,
    steps: rows,
    healthStatus: project.healthStatus,
    appliedCount: project.appliedCount,
    moving,
  });

  const failed = rows.find((row) => row.status === 'failed');
  const lastErrorCode: BootstrapReasonCode | null =
    failed?.reasonCode ??
    (project.healthStatus === 'unreachable'
      ? (reasonCodeOf(project.healthDetail) ?? 'unreachable')
      : null);

  const invite = rows.find((row) => row.step === 'invite');

  // The token axis (D-573, D-574): derived apart from the database state above, from the stored check and the
  // typed expiry; `null` for a platform project.
  const derived = tokenStateOf({
    owner: project.owner,
    tokenCheck: project.tokenCheck,
    expiresAt: project.expiresAt,
  });
  const token: TokenSummary | null = derived
    ? { state: derived, expiresAt: project.expiresAt, checkedAt: iso(project.tokenCheckedAt) }
    : null;
  const customer = project.owner === 'customer';

  return {
    ref: project.ref,
    plan: project.plan,
    state,
    steps: rows,
    schema,
    lastCheckedAt: iso(project.healthCheckedAt),
    preparationFinishedAt: invite?.status === 'done' ? invite.finishedAt : null,
    credentials: {
      // Project 0's credentials live in the environment, not in the registry: they are held all the same.
      held: project.credentialSource === 'env' || project.hasSealed === true,
      updatedAt: iso(project.updatedAt),
    },
    otherTenants: facts.others,
    moving,
    lastErrorCode,
    owner: customer ? 'customer' : 'platform',
    organization: customer ? project.orgSlug : null,
    token,
  };
}
