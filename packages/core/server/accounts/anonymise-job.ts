import { deriveBrandColors, NEUTRAL_BRAND, resolveBranding } from '@rede-social/contracts';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withAdminTx } from '../../db/admin-tx';
import { tenants } from '../../db/schema';
import { enqueueInTx, registerJobQueues } from '../jobs/boss';
import { moduleLogger } from '../logging';
import { type AccountDeletedMailInput, sendAccountDeletedMail } from '../mail/index';
import { formatDeletionDate } from '../mail/templates/account-deleted';
import type { MailBrand } from '../mail/templates/layout';
import type { JobDefinition } from '../modules/manifest';
import { supabaseAdminFor } from '../supabase-admin';
import { type ProjectRecord, resolveProjectById } from '../tenancy/project-registry';

/**
 * `accounts.anonymise-due` (13-13, D-609, D-610, NATIVE-21): the job that finishes "Excluir minha conta" after the
 * 14-day window. Per project, hourly, self-pacing (the `armDailyTenantDispatch` precedent: a deferred re-arm
 * under a CONSTANT singleton key, opened at boot under a DIFFERENT one so a pending hourly job never swallows the
 * boot run).
 *
 * Each run reads `app.account_deletion_due(100)` (deadline then id, oldest first, ordered by SQL) and, for each
 * member in that order, performs FOUR steps, each safe to repeat so a crash at any point resumes on the next run:
 *
 *   1. read the address through the Auth admin API (a missing or already soft-deleted account has none);
 *   2. SEND the completion e-mail (Apple 5.1.1(v)). It goes BEFORE the Auth soft delete, because afterwards the
 *      address is gone. At-least-once by design (A-13-04): a crash between the send and the anonymisation can send
 *      it twice, the idempotency key narrows that, and a missing address skips it;
 *   3. soft-delete the Auth user (`deleteUser(id, true)`): GoTrue keeps the row, so every foreign key still holds,
 *      and frees the address for a new sign-up. Skipped while the person still holds ANOTHER non-anonymised
 *      membership (a shared project: one identity, several communities), so leaving one community never signs the
 *      person out of the others;
 *   4. `app.account_anonymise(membership)`: personal data scrubbed in place, content kept as "Membro removido".
 *
 * **The identity mirror (decision for review, residual item 1 of 13-07).** `public.users` (global e-mail and name)
 * is scrubbed to `removed-<id>@removed.invalid` / "Membro removido" for every user whose memberships are ALL
 * anonymised, in one set-based pass after the members, so a crash between the Auth delete and the scrub heals on
 * the next run. It runs only after the last membership was anonymised, which only happens after the Auth account
 * was soft-deleted, so a person who still belongs somewhere keeps their mirror.
 *
 * A per-member failure is recorded (shape-only log: event, tenant id, step; never an address, a name or a message)
 * and the batch goes on; after the batch the run RE-ARMS and then raises, so pg-boss retries and the member stays
 * due. The re-arm is its own transaction, not the work's: the work calls Auth and the mail provider, and no
 * transaction is held open across those calls.
 */

export const ANONYMISE_DUE_QUEUE = 'accounts.anonymise-due';
/** The hourly re-arm's constant singleton key. */
export const ANONYMISE_DUE_SINGLETON = 'accounts-anonymise-due';
/** The boot arm's singleton key: never the hourly one. */
export const ANONYMISE_DUE_BOOT_SINGLETON = 'accounts-anonymise-due:boot';
/** Seconds between two runs. */
export const ANONYMISE_DUE_INTERVAL_S = 3600;
/** Members one run takes (the SQL clamps to 1..500); the next run takes the rest. */
export const ANONYMISE_BATCH = 100;

registerJobQueues([ANONYMISE_DUE_QUEUE]);

const log = moduleLogger('account-anonymise');

export type DueMember = { membershipId: string; userId: string; tenantId: string };

export type AnonymiseDeps = {
  /** Due members, deadline then id, oldest first. */
  listDue(limit: number): Promise<DueMember[]>;
  /** The tenant's mail brand (no logo) and time zone. */
  tenantFacts(tenantId: string): Promise<{ brand: MailBrand; timeZone: string }>;
  /** The Auth account's address, or `null` when the account is gone or already soft-deleted. */
  getAuthUser(userId: string): Promise<{ email: string } | null>;
  sendMail(to: string, input: AccountDeletedMailInput): Promise<void>;
  /** Whether the user holds another non-anonymised membership. */
  hasOtherMemberships(member: DueMember): Promise<boolean>;
  /** Soft-deletes the Auth account; a missing account is a success. */
  softDeleteAuthUser(userId: string): Promise<void>;
  anonymise(membershipId: string): Promise<boolean>;
  /** Scrubs the identity mirror of every fully anonymised user; returns how many rows changed. */
  scrubMirrors(): Promise<number>;
  rearm(): Promise<void>;
  now(): Date;
  /** Shape-only failure line. */
  warn(fields: Record<string, unknown>): void;
};

export type AnonymiseResult = {
  due: number;
  anonymised: number;
  mailed: number;
  keptIdentity: number;
  failed: number;
};

/** The whole run over injected dependencies; the production wiring is `productionDeps`. */
export async function runAnonymiseDue(deps: AnonymiseDeps): Promise<AnonymiseResult> {
  const result: AnonymiseResult = { due: 0, anonymised: 0, mailed: 0, keptIdentity: 0, failed: 0 };

  let members: DueMember[] = [];
  try {
    members = await deps.listDue(ANONYMISE_BATCH);
  } catch {
    result.failed += 1;
    deps.warn({ event: 'account.anonymise.failed', step: 'listDue' });
  }
  result.due = members.length;

  for (const member of members) {
    let step = 'getAuthUser';
    try {
      const user = await deps.getAuthUser(member.userId);
      if (user) {
        step = 'tenantFacts';
        const facts = await deps.tenantFacts(member.tenantId);
        step = 'sendMail';
        await deps.sendMail(user.email, {
          tenantId: member.tenantId,
          brand: facts.brand,
          date: formatDeletionDate(deps.now(), facts.timeZone),
          idempotencyKey: `account-deleted:${member.membershipId}`,
        });
        result.mailed += 1;
        step = 'hasOtherMemberships';
        if (await deps.hasOtherMemberships(member)) {
          result.keptIdentity += 1;
        } else {
          step = 'softDelete';
          await deps.softDeleteAuthUser(member.userId);
        }
      }
      step = 'anonymise';
      if (await deps.anonymise(member.membershipId)) result.anonymised += 1;
    } catch {
      result.failed += 1;
      deps.warn({ event: 'account.anonymise.failed', tenantId: member.tenantId, step });
    }
  }

  try {
    await deps.scrubMirrors();
  } catch {
    result.failed += 1;
    deps.warn({ event: 'account.anonymise.failed', step: 'scrubMirrors' });
  }

  // The cadence survives any failure above: the next run is queued before the run raises.
  try {
    await deps.rearm();
  } catch {
    result.failed += 1;
    deps.warn({ event: 'account.anonymise.failed', step: 'rearm' });
  }

  if (result.failed > 0) throw new Error(`${result.failed} member(s) failed`);
  return result;
}

/** GoTrue's "no such user" in either of the two shapes the SDK reports. */
function isUserNotFound(error: { code?: string; status?: number }): boolean {
  return error.code === 'user_not_found' || error.status === 404;
}

const NEUTRAL_COLORS = deriveBrandColors(NEUTRAL_BRAND);

/** The tenant's brand colours with no logo; an unreadable `branding` falls back to the neutral pair. */
function mailBrandOf(displayName: string, branding: unknown): MailBrand {
  try {
    const colors = resolveBranding(branding).colors;
    return { displayName, logoUrl: null, primary: colors.primary, onPrimary: colors.onPrimary };
  } catch {
    return {
      displayName,
      logoUrl: null,
      primary: NEUTRAL_COLORS.primary,
      onPrimary: NEUTRAL_COLORS.onPrimary,
    };
  }
}

/** The dependencies of one run against ONE project's database and Auth. */
export function productionDeps(projectId: string): AnonymiseDeps {
  let project: ProjectRecord | undefined;
  const projectOf = async (): Promise<ProjectRecord> => {
    project ??= (await resolveProjectById(projectId)) ?? undefined;
    if (!project) throw new Error('project not found');
    return project;
  };
  const facts = new Map<string, { brand: MailBrand; timeZone: string }>();

  return {
    listDue: (limit) =>
      withAdminTx({ projectId }, async (tx) => {
        const rows = await tx.execute<{
          membership_id: string;
          user_id: string;
          tenant_id: string;
        }>(
          sql`select membership_id, user_id, tenant_id from app.account_deletion_due(${limit}::int)`,
        );
        return Array.from(rows, (row) => ({
          membershipId: row.membership_id,
          userId: row.user_id,
          tenantId: row.tenant_id,
        }));
      }),

    tenantFacts: async (tenantId) => {
      const hit = facts.get(tenantId);
      if (hit) return hit;
      const [row] = await withAdminTx({ projectId }, (tx) =>
        tx
          .select({
            displayName: tenants.displayName,
            branding: tenants.branding,
            timezone: tenants.timezone,
          })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1),
      );
      if (!row) throw new Error('tenant not found');
      const value = {
        brand: mailBrandOf(row.displayName, row.branding),
        timeZone: row.timezone,
      };
      facts.set(tenantId, value);
      return value;
    },

    getAuthUser: async (userId) => {
      const { data, error } = await supabaseAdminFor(await projectOf()).auth.admin.getUserById(
        userId,
      );
      if (error) {
        if (isUserNotFound(error)) return null;
        throw new Error('auth lookup failed');
      }
      const user = data.user;
      // A soft-deleted account may still be returned by id, with its address already obfuscated: it has none.
      if (!user || user.deleted_at || !user.email) return null;
      return { email: user.email };
    },

    sendMail: (to, input) => sendAccountDeletedMail(to, input, log),

    hasOtherMemberships: (member) =>
      withAdminTx({ projectId }, async (tx) => {
        const rows = await tx.execute<{ other: boolean }>(sql`
          select exists (
            select 1 from public.memberships m
             where m.user_id = ${member.userId}::uuid
               and m.id <> ${member.membershipId}::uuid
               and m.anonymised_at is null
          ) as other`);
        return rows[0]?.other === true;
      }),

    softDeleteAuthUser: async (userId) => {
      const { error } = await supabaseAdminFor(await projectOf()).auth.admin.deleteUser(
        userId,
        true,
      );
      if (error && !isUserNotFound(error)) throw new Error('auth soft delete failed');
    },

    anonymise: (membershipId) =>
      withAdminTx({ projectId }, async (tx) => {
        const rows = await tx.execute<{ done: boolean | null }>(
          sql`select app.account_anonymise(${membershipId}::uuid) as done`,
        );
        return rows[0]?.done === true;
      }),

    scrubMirrors: () =>
      withAdminTx({ projectId }, async (tx) => {
        const rows = await tx.execute<{ id: string }>(sql`
          update public.users u
             set email = 'removed-' || u.id::text || '@removed.invalid',
                 name = 'Membro removido'
           where u.email <> 'removed-' || u.id::text || '@removed.invalid'
             and exists (select 1 from public.memberships m
                          where m.user_id = u.id and m.anonymised_at is not null)
             and not exists (select 1 from public.memberships m
                              where m.user_id = u.id and m.anonymised_at is null)
          returning u.id`);
        return rows.length;
      }),

    rearm: async () => {
      await rearmAnonymiseDue({ projectId });
    },

    now: () => new Date(),

    warn: (fields) => {
      log.warn(fields, 'account anonymisation step failed');
    },
  };
}

/** One run for `projectId`; `overrides` swap single dependencies (the integration suite records the mails). */
export function anonymiseDueOnce(
  projectId: string,
  overrides: Partial<AnonymiseDeps> = {},
): Promise<AnonymiseResult> {
  return runAnonymiseDue({ ...productionDeps(projectId), ...overrides });
}

/** Queues the next hourly run under the constant singleton key; a duplicate of a waiting job is a success. */
export async function rearmAnonymiseDue(target: { projectId: string }): Promise<boolean> {
  const id = await withAdminTx({ projectId: target.projectId }, (tx) =>
    enqueueInTx(
      tx,
      ANONYMISE_DUE_QUEUE,
      { projectId: target.projectId },
      { singletonKey: ANONYMISE_DUE_SINGLETON, startAfter: ANONYMISE_DUE_INTERVAL_S },
    ),
  );
  return id !== null;
}

/**
 * Queues ONE immediate run under the boot singleton, called best-effort by the supervisor each time it starts a
 * project. Armed twice it leaves one queued job. Returns whether THIS call queued it.
 */
export async function armAnonymiseDue(target: { projectId: string }): Promise<boolean> {
  const id = await withAdminTx({ projectId: target.projectId }, (tx) =>
    enqueueInTx(
      tx,
      ANONYMISE_DUE_QUEUE,
      { projectId: target.projectId },
      { singletonKey: ANONYMISE_DUE_BOOT_SINGLETON },
    ),
  );
  return id !== null;
}

const payloadSchema = z.object({ projectId: z.string().min(1) }).strict();
export type AnonymisePayload = z.infer<typeof payloadSchema>;

/**
 * `accounts.anonymise-due`, a tenant-scope job: every ready project's queue carries its own copy and the worker
 * hands the handler `{ projectId }`. A malformed payload, or one that names another project than the queue's, is
 * DROPPED with a shape-only warning (pg-boss would retry a raise forever against a shape that cannot become
 * valid); a failed run raises AFTER re-arming, so pg-boss retries it.
 */
export const anonymiseDueJob: JobDefinition<unknown> = {
  name: ANONYMISE_DUE_QUEUE,
  handler: async (raw, ctx) => {
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success || (ctx?.projectId && ctx.projectId !== parsed.data.projectId)) {
      log.warn({ event: 'account.anonymise.bad_payload' }, 'anonymise payload rejected');
      return;
    }
    const result = await anonymiseDueOnce(parsed.data.projectId);
    log.info(
      { event: 'account.anonymise.ran', projectId: parsed.data.projectId, ...result },
      'account anonymisation ran',
    );
  },
};
