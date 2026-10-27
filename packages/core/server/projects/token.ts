import { tokenExpiryIsValid } from '@rede-social/contracts/projects';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { projects, projectTokenEvents, tenantMoves, tenantProjects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { tenants } from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';
import { dropAllowListAdapter } from '../domains/index';
import { ApiError } from '../http/api-error';
import { moduleLogger } from '../logging';
import { logFor, type PlatformActor } from '../platform/invites';
import { reconcileProjectAllowList } from '../platform/reconcile-allow-list';
import { processKeyring, seal } from '../secrets/sealed';
import { invalidateProject } from '../tenancy/project-registry';
import { apiUrlFor } from './access';
import { checkProject } from './health';
import { openMoveOf } from './move/state';
import { projectOfTenant } from './overview';
import { createRequestTokenProvider, dropProjectProvider } from './provider-for';
import { type ProjectProvider, ProjectProviderError } from './types';

/**
 * The token kernel (09.4-07, D-567..D-572, CTK-09, CTK-10, CTK-12): the ONE validation every path that receives
 * a customer's management token runs (the new-tenant wizard, a replacement, an owner change, a move target),
 * before anything is sealed or replaced. It runs in a fixed order and stops at the first refusal:
 *
 *   1. the typed expiry date is a real date, after today, at most a year ahead   `token_expiry_invalid`
 *   2. the token starts with `sbp_fc`, the prefix of a fine-grained token         `token_account_wide` (D-570a)
 *   3. `describe(ref)` through a request-token provider: 401 `token_invalid`, 403 `token_forbidden`, 404
 *      `not_found`, another organisation than the pin `org_mismatch`, anything else `unchecked`
 *   4. `listProjects()`: any listed ref other than the target is `token_account_wide` (D-570b); a 403 passes (a
 *      project-scoped token is refused the listing); a timeout or a 5xx is `unchecked`
 *
 * D-570, both checks required (orchestrator ruling 1): the prefix and the listing are independent. A real
 * scoped token with the locked thirteen permissions (probe P1 run A, 2026-10-27) was answered the listing with
 * 200 and only the target, so check 4 works with the thirteen; an organisation-wide fine-grained token has not
 * been tried yet (ledger P3 step 3). That rests on one run and is stated in `docs/DEPLOY.md` and as a ledger
 * advisory; no fourteenth permission was added.
 *
 * D-571: with no pin the first `describe` LEARNS the organisation and the validation returns it for the caller
 * to store; with a pin (a replacement, plan 10) a different organisation is `org_mismatch` before anything is
 * replaced. The pin is a slug read from the project, never typed.
 *
 * D-572: the plan (Free or Pro) is not read (the locked permissions cannot). `token_other_project` and
 * `not_pro` are never emitted by this module today: Supabase cannot tell "another project" from "no
 * permission" on a 403 (probe P5 may change that), so both stay in the closed contract lists and the form,
 * reserved.
 *
 * A refusal is a `TokenRefusal` whose message IS its closed code. No function here logs, returns, throws or
 * persists a token, its prefix, its length or a hash of it (T-09.4-24).
 */

/** The prefix of a project-scoped (fine-grained) Supabase access token. */
export const SCOPED_TOKEN_PREFIX = 'sbp_fc';

export type TokenReason =
  | 'token_invalid'
  | 'token_forbidden'
  | 'token_other_project'
  | 'token_account_wide'
  | 'token_expiry_invalid'
  | 'org_mismatch'
  | 'not_found'
  | 'unchecked'
  | 'already_registered';

/** A closed refusal: the message is the code and nothing else, so no value can travel inside it. */
export class TokenRefusal extends Error {
  readonly code: TokenReason;

  constructor(code: TokenReason) {
    super(code);
    this.name = 'TokenRefusal';
    this.code = code;
  }
}

const SAO_PAULO_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The calendar day of `now` in America/Sao_Paulo as `YYYY-MM-DD`. The operator is in Brazil and the typed
 * expiry date carries no zone, so "today" is read where the operator is, not in UTC.
 */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return SAO_PAULO_DAY.format(now);
}

/** What a failed `describe` means for the token, as one closed code. */
function describeRefusal(error: unknown): TokenReason {
  if (error instanceof ProjectProviderError) {
    if (error.customerToken) {
      if (error.code === 'token_invalid') return 'token_invalid';
      if (error.code === 'token_forbidden') return 'token_forbidden';
      if (error.code === 'org_mismatch') return 'org_mismatch';
    }
    if (error.kind === 'not_found') return 'not_found';
  }
  return 'unchecked';
}

export type ValidatedToken = {
  /** The organisation of the project, learned from it (or the pin, when one was given). */
  orgSlug: string;
  expiresAt: string | null;
  /** The provider the checks ran on: the caller may reuse it for the registration's next read. */
  provider: ProjectProvider;
};

/** Runs the whole registration validation. Returns the learned organisation or throws a `TokenRefusal`. */
export async function validateCustomerToken(input: {
  ref: string;
  token: string;
  expiresAt: string | null;
  /** The organisation the project must belong to (a replacement); absent on a first registration. */
  orgSlug?: string;
  /** Test seam: the day the typed date is judged against; defaults to today in America/Sao_Paulo. */
  today?: string;
  /** Test seam: a ready provider; defaults to one built from the token alone (learn mode when no pin). */
  provider?: ProjectProvider;
}): Promise<ValidatedToken> {
  const { ref, token, expiresAt } = input;

  // (1) The typed date, before any other work: a typo costs nothing.
  if (expiresAt !== null && !tokenExpiryIsValid(expiresAt, input.today ?? todayInSaoPaulo())) {
    throw new TokenRefusal('token_expiry_invalid');
  }

  // (2) The prefix of a project-scoped token (D-570a). No request is made for a token that fails it.
  if (!token.startsWith(SCOPED_TOKEN_PREFIX)) throw new TokenRefusal('token_account_wide');

  // (3) The token reaches the project, and the project belongs to the pinned organisation (or teaches it).
  let provider: ProjectProvider;
  let orgSlug: string;
  try {
    provider =
      input.provider ??
      (await createRequestTokenProvider({
        token,
        ...(input.orgSlug === undefined ? {} : { orgSlug: input.orgSlug }),
      }));
    const described = await provider.describe(ref);
    orgSlug = described.orgSlug;
  } catch (error) {
    throw new TokenRefusal(describeRefusal(error));
  }
  // The real adapter already refuses another organisation; this covers a provider that does not.
  if (input.orgSlug !== undefined && orgSlug !== input.orgSlug) {
    throw new TokenRefusal('org_mismatch');
  }

  // (4) The behavioural check (D-570b): a project-scoped token lists nothing but its own project, or is refused.
  try {
    const listed = await provider.listProjects();
    if (listed.some((entry) => entry.ref !== ref)) throw new TokenRefusal('token_account_wide');
  } catch (error) {
    if (error instanceof TokenRefusal) throw error;
    if (error instanceof ProjectProviderError && error.kind === 'forbidden') {
      return { orgSlug, expiresAt, provider };
    }
    throw new TokenRefusal('unchecked');
  }
  return { orgSlug, expiresAt, provider };
}

// ---------------------------------------------------------------------------------------------------------
// Sealing, the audit append and the registration (D-567, D-568, D-539, CTK-12, CTK-28)
// ---------------------------------------------------------------------------------------------------------

const log = moduleLogger('project-token');

/** The management token sealed for one project: AAD `<project id>:mgmt_token`, like every other sealed column. */
export function sealManagementToken(token: string, projectId: string): string {
  return seal(token, `${projectId}:mgmt_token`);
}

export type TokenEventKind = 'registered' | 'replaced' | 'owner_changed' | 'repinned';
/** The closed outcome list of the audit table: `ok` or a refusal code (`already_registered` writes nothing). */
export type TokenEventOutcome = 'ok' | Exclude<TokenReason, 'already_registered'>;

export type TokenEvent = {
  kind: TokenEventKind;
  /** Null when the event precedes the project (a refused registration). */
  projectId: string | null;
  projectRef: string;
  /** An operator label (`platform:<user id>`), never free text. */
  actor: string;
  outcome: TokenEventOutcome;
};

/**
 * Appends ONE row to the audit table of the customer's token (kind and closed outcome only, never a token, a
 * prefix, a length or a hash; the table has no column that could hold one). Given a platform transaction it
 * writes inside it and catches nothing, so the event commits and rolls back with the change it records. Run
 * alone (a refusal, which has no change to ride on) it opens its own transaction and is BEST EFFORT: a failure
 * is logged by id and outcome and swallowed, so the audit can never mask the refusal it records.
 */
export async function recordTokenEvent(tx: Tx | undefined, event: TokenEvent): Promise<void> {
  const row = {
    kind: event.kind,
    projectId: event.projectId,
    projectRef: event.projectRef,
    actor: event.actor,
    outcome: event.outcome,
  };
  if (tx) {
    await tx.insert(projectTokenEvents).values(row);
    return;
  }
  try {
    await withPlatformTx(async (own) => {
      await own.insert(projectTokenEvents).values(row);
    });
  } catch {
    log.warn(
      {
        event: 'project.token.event_failed',
        projectId: event.projectId,
        kind: event.kind,
        outcome: event.outcome,
      },
      'token audit event not written',
    );
  }
}

/**
 * Registers a customer-owned project (D-567, D-568): validates the token (all outbound work, OUTSIDE any
 * transaction), then in ONE platform transaction under `pg_advisory_xact_lock(hashtext('project:' || ref))`
 * (the lock create, credential replacement and the bootstrap take) inserts the project row (owner `customer`,
 * the pin, the token sealed with AAD `<project id>:mgmt_token`, the typed expiry, state `preparing`) and the
 * audit event. A ref already in the registry is refused as `already_registered` and nothing is written. A
 * refused token writes no project, only its own best-effort event. The token lives in this function's argument
 * and in the sealed column; nothing else holds it, and the log line carries ids only.
 */
export async function registerCustomerProject(input: {
  ref: string;
  token: string;
  expiresAt: string | null;
  actor: string;
  today?: string;
  provider?: ProjectProvider;
}): Promise<{ projectId: string; orgSlug: string }> {
  const { ref, actor } = input;
  let validated: ValidatedToken;
  try {
    validated = await validateCustomerToken({
      ref,
      token: input.token,
      expiresAt: input.expiresAt,
      ...(input.today === undefined ? {} : { today: input.today }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
    });
  } catch (error) {
    if (error instanceof TokenRefusal && error.code !== 'already_registered') {
      await recordTokenEvent(undefined, {
        kind: 'registered',
        projectId: null,
        projectRef: ref,
        actor,
        outcome: error.code,
      });
    }
    throw error;
  }

  // The id is chosen up front so the AAD of the sealed column is known before the row exists.
  const projectId = crypto.randomUUID();
  const sealedToken = sealManagementToken(input.token, projectId);

  await withPlatformTx(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`project:${ref}`}))`);
    const existing = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.ref, ref))
      .limit(1);
    if (existing.length > 0) throw new TokenRefusal('already_registered');

    await tx.insert(projects).values({
      id: projectId,
      ref,
      provider: validated.provider.name,
      owner: 'customer',
      orgSlug: validated.orgSlug,
      mgmtTokenSealed: sealedToken,
      mgmtTokenExpiresAt: validated.expiresAt,
      credentialSource: 'sealed',
      apiUrl: apiUrlFor(validated.provider, ref),
      state: 'preparing',
      secretKeyId: processKeyring().currentId,
    });
    await recordTokenEvent(tx, {
      kind: 'registered',
      projectId,
      projectRef: ref,
      actor,
      outcome: 'ok',
    });
  });

  log.info({ event: 'project.token.registered', projectId, actor }, 'customer project registered');
  return { projectId, orgSlug: validated.orgSlug };
}

// ---------------------------------------------------------------------------------------------------------
// Replacing the token (D-575, UI-D-555, D-576, CTK-19, CTK-20, CTK-27)
// ---------------------------------------------------------------------------------------------------------

export type ReplaceTokenDeps = {
  /** Test seam: a ready provider the validation runs on; defaults to one built from the candidate token. */
  provider?: ProjectProvider;
  /** The follow-up after the commit; tests inject one that hands its promise back so they can await it. */
  afterReplace?: (projectId: string) => unknown;
  /** Test seam: the day the typed date is judged against. */
  today?: string;
  /** Test seam: how long the answer waits for the follow-up (default `FOLLOW_UP_WAIT_MS`). */
  followUpWaitMs?: number;
};

type LockedTokenProject = {
  id: string;
  ref: string;
  owner: string;
  org_slug: string | null;
  is_central: boolean;
  credential_source: string;
};

/**
 * "Substituir token" (D-575, UI-D-555): replaces the sealed management token of a CUSTOMER project, and NEVER
 * before the new one has been validated against the project and the REGISTERED organisation pin. Inside ONE
 * platform transaction, under `pg_advisory_xact_lock(hashtext('project:' || ref))` (the lock `replaceCredentials`
 * and the bootstrap take), the row is read `for update`, the candidate is validated by `validateCustomerToken`
 * with the stored `org_slug`, and only then are the sealed token, the typed expiry, the version and the audit
 * event written together. Two replacements for one project queue on the lock and the later one wins ENTIRELY.
 * The validation is outbound I/O inside the transaction on purpose (the lock must cover the validate-then-write
 * pair); it is an operator action of seconds, bounded by the provider's own timeouts.
 *
 * After the commit the registry cache and the cached provider and allow-list adapter of the project are dropped
 * (the next call rebuilds them from the new token) and the follow-up starts. The `credential_version` bump also
 * recycles the project's tenant pools, admin clients and job senders: harmless churn, documented in
 * `docs/DEPLOY.md`, and the reason not to replace tokens in a loop.
 *
 * Nothing here logs, returns or throws the token: the log line carries ids only (D-576).
 */
export async function replaceProjectToken(
  tenantId: string,
  input: { token: string; tokenExpiresAt?: string | null },
  actor: PlatformActor,
  deps: ReplaceTokenDeps = {},
): Promise<{ ok: true; credentialVersion: number }> {
  const target = await projectOfTenant(tenantId);
  if (!target) throw new ApiError(404, 'NOT_FOUND');
  // Project 0's token lives nowhere: there is nothing to replace.
  if (target.central) throw new ApiError(409, 'CONFLICT');

  const actorLabel = `platform:${actor.userId}`;
  let outcome: { projectId: string; credentialVersion: number };
  try {
    outcome = await replaceLocked(target, input, actorLabel, deps);
  } catch (error) {
    // A refusal rolled the transaction back untouched; its trail is written AFTER the rollback, best effort,
    // and the operator gets one closed code under the field it belongs to (UI-D-555).
    if (error instanceof TokenRefusal) {
      if (error.code !== 'already_registered') {
        await recordTokenEvent(undefined, {
          kind: 'replaced',
          projectId: target.id,
          projectRef: target.ref,
          actor: actorLabel,
          outcome: error.code,
        });
      }
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        error.code === 'token_expiry_invalid'
          ? { tokenExpiresAt: 'token_expiry_invalid' }
          : { token: error.code },
      );
    }
    throw error;
  }

  // The pools and the binding cached under the old version are dropped; the next call rebuilds from the new token.
  invalidateProject();
  dropProjectProvider(outcome.projectId);
  dropAllowListAdapter(outcome.projectId);
  logFor(actor, 'platform.projects').info(
    {
      event: 'project.token.replaced',
      userId: actor.userId,
      tenantId,
      projectId: outcome.projectId,
      credentialVersion: outcome.credentialVersion,
    },
    'project token replaced',
  );
  await runFollowUpBounded(
    deps.afterReplace ?? runTokenFollowUp,
    outcome.projectId,
    deps.followUpWaitMs ?? FOLLOW_UP_WAIT_MS,
  );
  return { ok: true, credentialVersion: outcome.credentialVersion };
}

/** The locked validate-then-write pair of `replaceProjectToken`. A `TokenRefusal` thrown here rolls everything back. */
async function replaceLocked(
  target: { id: string; ref: string },
  input: { token: string; tokenExpiresAt?: string | null },
  actorLabel: string,
  deps: ReplaceTokenDeps,
): Promise<{ projectId: string; credentialVersion: number }> {
  return withPlatformTx(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`project:${target.ref}`}))`);

    const found = (await tx.execute(sql`
      select id::text as id, ref, owner, org_slug, is_central, credential_source
        from platform.projects
       where id = ${target.id}::uuid
         for update`)) as unknown as LockedTokenProject[];
    const row = found[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    // Only a customer project has a token of its own to replace.
    if (row.owner !== 'customer' || row.is_central || row.credential_source === 'env') {
      throw new ApiError(409, 'CONFLICT');
    }

    const expiresAt = input.tokenExpiresAt ?? null;
    const validated = await validateCustomerToken({
      ref: row.ref,
      token: input.token,
      expiresAt,
      ...(row.org_slug ? { orgSlug: row.org_slug } : {}),
      ...(deps.today === undefined ? {} : { today: deps.today }),
      ...(deps.provider === undefined ? {} : { provider: deps.provider }),
    });

    const updated = await tx
      .update(projects)
      .set({
        mgmtTokenSealed: sealManagementToken(input.token, row.id),
        mgmtTokenExpiresAt: validated.expiresAt,
        // A project registered without a pin is pinned now; one that has a pin keeps it (it was just enforced).
        orgSlug: row.org_slug ?? validated.orgSlug,
        // Bookkeeping only (the reseal command owns it once set): each string carries its own key id.
        secretKeyId: sql`coalesce(${projects.secretKeyId}, ${processKeyring().currentId}::smallint)`,
        credentialVersion: sql`${projects.credentialVersion} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, row.id))
      .returning({ credentialVersion: projects.credentialVersion });
    await recordTokenEvent(tx, {
      kind: 'replaced',
      projectId: row.id,
      projectRef: row.ref,
      actor: actorLabel,
      outcome: 'ok',
    });
    return { projectId: row.id, credentialVersion: updated[0]?.credentialVersion ?? 0 };
  });
}

/**
 * How long the answer to a replacement waits for its follow-up (09.4 review WR-04). The API runs on request-based
 * CPU, so work left running after the response may be throttled and the allow-list reconcile of D-575(c) could
 * stall; the operator is already waiting seconds on the validation, so the answer waits for the follow-up too,
 * up to this bound. A follow-up that outlasts the bound keeps running detached: the token verdict then heals on
 * the next health sweep and the allow-list on the worker's next start reconcile or the domain's "Verificar agora".
 */
export const FOLLOW_UP_WAIT_MS = 8_000;

/**
 * Runs the follow-up and waits for it, at most `waitMs`. A failing follow-up (or one that throws at once) is
 * logged by project id only and never reaches the operator's answer: the replacement itself is already committed.
 */
async function runFollowUpBounded(
  run: (projectId: string) => unknown,
  projectId: string,
  waitMs: number,
): Promise<void> {
  const failed = () =>
    log.warn({ event: 'project.token.follow_up_failed', projectId }, 'token follow-up failed');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = Promise.resolve(run(projectId)).then(() => undefined, failed);
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
    });
    await Promise.race([work, bound]);
  } catch {
    failed();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The follow-up of a replacement (D-575(b)(c), CTK-27): the health check refreshes the token and database
 * states together (D-573), then the allow-list of the project is reconciled so the domains that failed while
 * the token was dead are re-added and their `allow_list` errors cleared. Exported so a test can await the real
 * follow-up.
 */
export async function runTokenFollowUp(projectId: string): Promise<void> {
  try {
    await checkProject(projectId);
  } catch {
    // A check that could not run must not keep the allow-list from being reconciled: the two are independent.
    log.warn({ event: 'project.token.check_failed', projectId }, 'token follow-up check failed');
  }
  await reconcileProjectAllowList(projectId);
}

// ---------------------------------------------------------------------------------------------------------
// Changing the owner (D-566 journey 3, D-568, CTK-03, CTK-04)
// ---------------------------------------------------------------------------------------------------------

export type OwnerChangeCode = 'tenant_not_found' | 'project_central' | 'tenant_moving';

/** A closed refusal of the owner-change command: the message is the code and nothing else. */
export class OwnerChangeError extends Error {
  readonly code: OwnerChangeCode;

  constructor(code: OwnerChangeCode) {
    super(code);
    this.name = 'OwnerChangeError';
    this.code = code;
  }
}

export type OwnerTarget = {
  tenantId: string;
  projectId: string;
  ref: string;
  owner: string;
  isCentral: boolean;
};

/**
 * Whether the registry already knows a project by its ref. The register command asks it BEFORE the operator is
 * prompted, so a ref that is already registered costs no typed token (D-567); the registration itself repeats
 * the check under the project lock.
 */
export async function projectIsRegistered(ref: string): Promise<boolean> {
  const rows = await withPlatformTx((tx) =>
    tx.select({ id: projects.id }).from(projects).where(eq(projects.ref, ref)).limit(1),
  );
  return rows.length > 0;
}

/**
 * The facts the owner change starts from, read BEFORE the operator is asked for anything (D-567): the tenant's
 * project and who owns it. Refuses, with a closed code, a tenant that does not exist (`tenant_not_found`), one
 * on the central project or on a project whose credentials live in the environment (`project_central`) and one
 * with an open move (`tenant_moving`), so none of them costs the operator a typed token.
 */
export async function findOwnerTarget(tenantSlug: string): Promise<OwnerTarget> {
  const [row] = await withPlatformTx((tx) =>
    tx
      .select({
        tenantId: tenants.id,
        projectId: projects.id,
        ref: projects.ref,
        owner: projects.owner,
        isCentral: projects.isCentral,
        source: projects.credentialSource,
      })
      .from(tenants)
      .innerJoin(tenantProjects, eq(tenantProjects.tenantId, tenants.id))
      .innerJoin(projects, eq(projects.id, tenantProjects.projectId))
      .where(eq(tenants.slug, tenantSlug))
      .limit(1),
  );
  if (!row) throw new OwnerChangeError('tenant_not_found');
  const isCentral = row.isCentral || row.source === 'env';
  if (isCentral) throw new OwnerChangeError('project_central');
  if (await openMoveOf(row.tenantId)) throw new OwnerChangeError('tenant_moving');
  return {
    tenantId: row.tenantId,
    projectId: row.projectId,
    ref: row.ref,
    owner: row.owner,
    isCentral,
  };
}

export type SetOwnerInput = {
  tenantSlug: string;
  token: string;
  expiresAt: string | null;
  /** An operator label (`^[A-Za-z0-9:_@.-]{1,64}$`), never free text. */
  actor: string;
  /** Validate exactly as a real run and write nothing: no row, no event, no version bump. */
  dryRun?: boolean;
  /** Test seam: the day the typed date is judged against. */
  today?: string;
  /** Test seam: a ready provider the validation runs on; defaults to one built from the token alone. */
  provider?: ProjectProvider;
  /** The follow-up after the commit; defaults to a best-effort health check. Tests inject a recorder. */
  afterChange?: (projectId: string) => unknown;
};

export type SetOwnerResult = { projectId: string; repinned: boolean; dryRun: boolean };

/**
 * "The project now lives in the customer's account" (D-566 journey 3, D-568, CTK-03/04): validates the customer's
 * project-scoped token with the whole registration validation and WITHOUT a pin (the first read teaches the
 * project's CURRENT organisation, which is what makes this the one path that accepts an organisation change),
 * then in ONE locked platform transaction rewrites owner, pin, sealed token and typed expiry, bumps
 * `credential_version` and appends `owner_changed` (a platform project) or `repinned` (a project that is
 * already the customer's). It COPIES NOTHING: no tenant row moves and no move function is called.
 *
 * The direction is one way on purpose: customer to platform is not offered here. A project still living in the
 * customer's account is unreachable with the platform token (the organisation pin would refuse it), so flipping
 * the owner back would leave a project nobody can manage; the way back is a move to a platform target (plan 12).
 *
 * A refused token changes nothing and leaves one code-only event (best effort, after nothing was written). A
 * dry run validates and returns; it writes no event either. Nothing here logs, returns or throws the token, a
 * prefix of it, the organisation slug or the ref.
 */
export async function setProjectOwner(input: SetOwnerInput): Promise<SetOwnerResult> {
  const target = await findOwnerTarget(input.tenantSlug);
  const repinned = target.owner === 'customer';
  const kind: TokenEventKind = repinned ? 'repinned' : 'owner_changed';
  const dryRun = input.dryRun === true;

  let validated: ValidatedToken;
  try {
    validated = await validateCustomerToken({
      ref: target.ref,
      token: input.token,
      expiresAt: input.expiresAt,
      ...(input.today === undefined ? {} : { today: input.today }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
    });
  } catch (error) {
    if (error instanceof TokenRefusal && error.code !== 'already_registered' && !dryRun) {
      await recordTokenEvent(undefined, {
        kind,
        projectId: target.projectId,
        projectRef: target.ref,
        actor: input.actor,
        outcome: error.code,
      });
    }
    throw error;
  }
  if (dryRun) return { projectId: target.projectId, repinned, dryRun: true };

  await withPlatformTx(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`project:${target.ref}`}))`);
    const found = (await tx.execute(sql`
      select id::text as id, owner, is_central, credential_source
        from platform.projects
       where id = ${target.projectId}::uuid
         for update`)) as unknown as Array<{
      id: string;
      owner: string;
      is_central: boolean;
      credential_source: string;
    }>;
    const row = found[0];
    if (!row) throw new OwnerChangeError('tenant_not_found');
    if (row.is_central || row.credential_source === 'env') {
      throw new OwnerChangeError('project_central');
    }
    // A move may have opened while the operator was typing: re-checked under the lock, inside the transaction.
    const moving = await tx
      .select({ id: tenantMoves.id })
      .from(tenantMoves)
      .where(
        and(
          eq(tenantMoves.tenantId, target.tenantId),
          notInArray(tenantMoves.state, ['done', 'rolled_back']),
        ),
      )
      .limit(1);
    if (moving.length > 0) throw new OwnerChangeError('tenant_moving');

    await tx
      .update(projects)
      .set({
        owner: 'customer',
        orgSlug: validated.orgSlug,
        mgmtTokenSealed: sealManagementToken(input.token, row.id),
        mgmtTokenExpiresAt: validated.expiresAt,
        // Bookkeeping only (the reseal command owns it once set): each string carries its own key id.
        secretKeyId: sql`coalesce(${projects.secretKeyId}, ${processKeyring().currentId}::smallint)`,
        credentialVersion: sql`${projects.credentialVersion} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(projects.id, row.id));
    await recordTokenEvent(tx, {
      kind: row.owner === 'customer' ? 'repinned' : 'owner_changed',
      projectId: row.id,
      projectRef: target.ref,
      actor: input.actor,
      outcome: 'ok',
    });
  });

  // The pools and the binding cached under the old version are dropped; the next call rebuilds from the new token.
  invalidateProject();
  dropProjectProvider(target.projectId);
  dropAllowListAdapter(target.projectId);
  log.info(
    { event: 'project.owner.changed', projectId: target.projectId, to: 'customer', repinned },
    'project owner changed',
  );
  await runOwnerFollowUp(input.afterChange ?? checkProject, target.projectId);
  return { projectId: target.projectId, repinned, dryRun: false };
}

/** Best effort: the change is committed, a check that cannot run must not turn it into a failure. */
async function runOwnerFollowUp(
  run: (projectId: string) => unknown,
  projectId: string,
): Promise<void> {
  try {
    await run(projectId);
  } catch {
    log.warn({ event: 'project.owner.check_failed', projectId }, 'owner change check failed');
  }
}
