import { eq, sql } from 'drizzle-orm';
import type { Sql } from 'postgres';
import { projects, tenantMoveEvents, tenantMoves, tenantProjects } from '../../../db/central';
import { withPlatformTx } from '../../../db/platform-tx';
import { env } from '../../env';
import { resolveProjectById } from '../../tenancy/project-registry';
import { type BootstrapDeps, listSteps, runBootstrap } from '../bootstrap';
import { precheckProject } from '../precheck';
import { getProjectProvider } from '../provider-access';
import { readAppliedSchema } from '../schema-state';
import type { ProjectProvider } from '../types';
import { type MoveRow, openMoveOf, recordEvent, toMoveRow } from './state';
import { MoveError } from './types';

/**
 * The move target (09.2-23, D-534, D-536, T-09.2-106): a project like any other, made "exactly like a new
 * tenant's" by the SAME bootstrap engine, with no second path.
 *
 *  - `registerMoveTarget` registers the project when the registry does not know the ref (the pre-check of
 *    plan 14 runs first and production refuses a project bound to another tenant), and creates the open move
 *    row, in ONE platform transaction under the same advisory lock the create call takes. A second concurrent
 *    start for the tenant hits the partial unique index and gets `move_in_progress` having written nothing.
 *  - `bootstrapTarget` runs the eight steps inline (the tool is a process of its own) until the project is
 *    `ready`; a step that fails stops with `target_not_ready` and the step's reason code in the event.
 *  - `assertTargetReady` is the last gate before any byte is copied: `ready`, eight steps `done`, and the
 *    applied schema head equal to the source's.
 */

export type TargetDeps = {
  provider?: ProjectProvider | undefined;
  /** Test seam: simulates `NODE_ENV=production`. */
  production?: boolean | undefined;
  bootstrap?: BootstrapDeps | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
};

/** The API origin of a project the platform registers: `https://<ref>.supabase.co`, or the fake's target. */
function apiUrlFor(provider: ProjectProvider, ref: string): string {
  if (provider.name === 'supabase') return `https://${ref}.supabase.co`;
  const target = (
    provider as { targetOf?: (r: string) => { apiUrl: string } | undefined }
  ).targetOf?.(ref);
  return target?.apiUrl ?? env.SUPABASE_URL;
}

type ProjectFacts = {
  id: string;
  state: string;
  isCentral: boolean;
  credentialSource: string;
  boundToOthers: number;
  movingToOthers: number;
};

async function projectFacts(
  tx: Parameters<Parameters<typeof withPlatformTx>[0]>[0],
  ref: string,
  tenantId: string,
): Promise<ProjectFacts | null> {
  const [row] = await tx
    .select({
      id: projects.id,
      state: projects.state,
      isCentral: projects.isCentral,
      credentialSource: projects.credentialSource,
      boundToOthers: sql<number>`(select count(*)::int from ${tenantProjects}
         where ${tenantProjects.projectId} = ${projects.id} and ${tenantProjects.tenantId} <> ${tenantId}::uuid)`,
      movingToOthers: sql<number>`(select count(*)::int from ${tenantMoves}
         where ${tenantMoves.toProjectId} = ${projects.id} and ${tenantMoves.tenantId} <> ${tenantId}::uuid
           and ${tenantMoves.state} not in ('done', 'rolled_back'))`,
    })
    .from(projects)
    .where(eq(projects.ref, ref))
    .limit(1);
  return row ?? null;
}

export type RegisterInput = {
  tenantId: string;
  ref: string;
  actor: string;
  statusBefore: 'active' | 'suspended';
  fromProjectId: string;
};

/**
 * Registers the target (when new) and opens the move, atomically. Throws `move_in_progress` when the tenant
 * already has an open move (nothing is written), `target_not_ready` for a target that may not be used.
 */
export async function registerMoveTarget(
  input: RegisterInput,
  deps: TargetDeps = {},
): Promise<{ move: MoveRow; projectId: string; registered: boolean }> {
  if (await openMoveOf(input.tenantId)) throw new MoveError('move_in_progress');

  const production = deps.production ?? env.NODE_ENV === 'production';
  const provider = deps.provider ?? (await getProjectProvider());

  // Outbound work first, OUTSIDE any transaction: a project the registry does not know yet is checked.
  const known = await withPlatformTx((tx) => projectFacts(tx, input.ref, input.tenantId));
  if (!known) {
    const check = await precheckProject(input.ref, {
      tenantId: input.tenantId,
      production,
      provider,
    });
    if (!check.ok) throw new MoveError('target_not_ready', [check.reason]);
    // A token that cannot reveal the project's secrets means the panel's three manual fields: not here.
    if (check.manualAccess) throw new MoveError('target_not_ready', ['manual_access']);
  }
  const newProjectId = crypto.randomUUID();

  try {
    return await withPlatformTx(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`project:${input.ref}`}))`);
      const row = await projectFacts(tx, input.ref, input.tenantId);
      let projectId: string;
      let registered = false;
      if (row) {
        if (row.isCentral || row.credentialSource === 'env') {
          throw new MoveError('target_not_ready', ['central']);
        }
        if (row.id === input.fromProjectId) throw new MoveError('already_on_target');
        // Production never shares a project (D-540): bound to another tenant, or promised to another move.
        if (production && (row.boundToOthers > 0 || row.movingToOthers > 0)) {
          throw new MoveError('target_not_ready', ['in_use']);
        }
        projectId = row.id;
      } else {
        projectId = newProjectId;
        await tx.insert(projects).values({
          id: projectId,
          ref: input.ref,
          provider: provider.name,
          credentialSource: 'sealed',
          apiUrl: apiUrlFor(provider, input.ref),
          state: 'preparing',
        });
        registered = true;
      }

      const [inserted] = await tx
        .insert(tenantMoves)
        .values({
          tenantId: input.tenantId,
          fromProjectId: input.fromProjectId,
          toProjectId: projectId,
          statusBefore: input.statusBefore,
          actor: input.actor,
        })
        .returning();
      if (!inserted) throw new MoveError('unknown');
      const detail = { toRef: input.ref, registered, statusBefore: input.statusBefore };
      await tx.insert(tenantMoveEvents).values({ moveId: inserted.id, kind: 'started', detail });
      return { move: toMoveRow(inserted), projectId, registered };
    });
  } catch (error) {
    if (error instanceof MoveError) throw error;
    if (isOpenMoveViolation(error)) throw new MoveError('move_in_progress');
    throw error;
  }
}

/** Postgres `23505` on the one-open-move index, possibly wrapped by drizzle's query error. */
function isOpenMoveViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === '23505') {
      const name = typeof e.constraint_name === 'string' ? e.constraint_name : '';
      return name === '' || name.includes('tenant_moves_one_open_uq');
    }
    current = e.cause;
  }
  return false;
}

/**
 * Brings the target to `ready` with the plan 13 engine, inline. A project that is already `ready` with all
 * eight steps done is left alone. A failed step stops the move with `target_not_ready`; the reason code (from
 * the closed bootstrap catalog) goes to the event, never provider text.
 */
export async function bootstrapTarget(
  move: MoveRow,
  deps: TargetDeps = {},
): Promise<{ steps: number }> {
  const project = await resolveProjectById(move.toProjectId);
  if (!project) throw new MoveError('target_not_ready', ['unregistered']);
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const outcome = await runBootstrap(move.toProjectId, deps.bootstrap ?? {});
    if (outcome.status === 'ready') return { steps: (await listSteps(move.toProjectId)).length };
    if (outcome.status === 'not_applicable') throw new MoveError('target_not_ready', ['central']);
    if (outcome.status === 'failed') {
      await recordEvent(move.id, 'target_failed', {
        step: outcome.step,
        reason: outcome.reason,
      });
      throw new MoveError('target_not_ready', [outcome.step, outcome.reason]);
    }
    // `skipped`: another runner (the platform job) holds a step. Look again shortly.
    await sleep(1_000);
  }
  throw new MoveError('target_not_ready', ['bootstrap_timeout']);
}

/**
 * The gate before any byte is copied (T-09.2-106): the target project is `ready`, every bootstrap step is
 * `done`, and its applied schema head equals the source's (`schema_mismatch`). The heads are read from the two
 * databases' own ledgers, so a stale registry row cannot vouch for a database that is behind.
 */
export async function assertTargetReady(
  move: MoveRow,
  sides: { source: Sql; target: Sql },
): Promise<void> {
  const project = await resolveProjectById(move.toProjectId);
  if (project?.state !== 'ready') throw new MoveError('target_not_ready', ['state']);
  const steps = await listSteps(move.toProjectId);
  if (steps.length === 0 || steps.some((step) => step.status !== 'done')) {
    throw new MoveError('target_not_ready', ['steps']);
  }
  const [from, to] = await Promise.all([
    readAppliedSchema(sides.source),
    readAppliedSchema(sides.target),
  ]);
  if (from.appliedHead !== to.appliedHead) throw new MoveError('schema_mismatch', ['head']);
}
