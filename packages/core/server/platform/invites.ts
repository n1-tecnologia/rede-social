import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { memberships, tenantDomains, tenantInvites, tenants, users } from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';
import { publicWebOrigin } from '../env';
import { ApiError } from '../http/api-error';
import { type Logger, moduleLogger } from '../logging';
import { supabaseAdmin } from '../supabase-admin';

/** Who is acting (the `super_admin` behind `requireSuperAdmin()`, or the job that verified a host). */
export type PlatformActor = {
  userId: string;
  logger?: Logger;
};

/**
 * The request's child logger when a route passes `c.get('logger')` (so `platform.*` lines carry
 * `requestId`), else a module child for jobs, scripts and tests.
 */
export const logFor = (actor: PlatformActor | undefined, name: string): Logger =>
  actor?.logger ? actor.logger.child({ name }) : moduleLogger(name);

/** Where the invite link lands: the accept page on the tenant's own verified primary host (D-29). */
const INVITE_NEXT_PATH = '/auth/confirm?next=/aceitar-convite';

/**
 * Inserts the first-admin invite (`pending`) inside the caller's transaction, so a tenant is never
 * committed without it (D-30, prohibition "one transaction or nothing"). The column is citext — the
 * unique index already treats `Admin@X` and `admin@x` as one — but the value is stored lower-cased
 * so the panel and the e-mail show one canonical spelling.
 */
export async function createPendingInvite(
  tx: Tx,
  input: { tenantId: string; email: string; createdBy: string },
): Promise<string> {
  const [row] = await tx
    .insert(tenantInvites)
    .values({
      tenantId: input.tenantId,
      email: input.email.trim().toLowerCase(),
      role: 'admin_tenant',
      status: 'pending',
      createdBy: input.createdBy,
    })
    .returning({ id: tenantInvites.id });
  if (!row) throw new Error('tenant_invites insert returned no row');
  return row.id;
}

export type SendPendingInvitesResult = { sent: number; reason?: 'no_verified_primary' };

/** The `public.users` mirror is written by the `on_auth_user_created` trigger; assert it before the FK. */
async function waitForMirroredUser(tx: Tx, userId: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (rows[0]) return;
    await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
  }
  throw new Error(`public.users row missing for ${userId} after inviteUserByEmail`);
}

/**
 * Sends every `pending` invite of the tenant — the ONLY sender (Pitfall 8). It requires a verified
 * primary host, because the link in the e-mail must open the tenant's own branded origin: without
 * one the call is a documented no-op and the invites stay `pending` until `domain-verify` (02-09)
 * calls this again on the first verified host. `createTenant` calls it right after commit, so a
 * tenant provisioned on an existing host is invited immediately.
 *
 * Per invite, in order:
 *   (a) CLAIM — `update … set status='sent' where id=… and status='pending' returning`; zero rows
 *       means another sender won (two panels, the job and a route) and this one skips (T-02-20);
 *   (b) GoTrue `inviteUserByEmail` with `redirectTo` composed ONLY from the verified primary host
 *       through `publicWebOrigin` — never from request input (T-02-16);
 *   (c) on GoTrue failure the claim is reverted (back to `pending`, so a resend is possible) and the
 *       caller gets 500 INTERNAL;
 *   (d) on success: `memberships` row (`admin_tenant`, `invited` — `requireAuth` lets it through so
 *       `/aceitar-convite` can run in the tenant lane) and `tenant_invites.user_id`.
 */
export async function sendPendingInvites(
  tenantId: string,
  actor?: PlatformActor,
): Promise<SendPendingInvitesResult> {
  const log = logFor(actor, 'platform.invites');

  const target = await withAdminTx(async (tx) => {
    const hosts = await tx
      .select({ host: tenantDomains.host, slug: tenants.slug })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(
        and(
          eq(tenantDomains.tenantId, tenantId),
          eq(tenantDomains.isPrimary, true),
          isNotNull(tenantDomains.verifiedAt),
        ),
      )
      .limit(1);
    const primary = hosts[0];
    if (!primary) return null;
    const pending = await tx
      .select({ id: tenantInvites.id, email: tenantInvites.email })
      .from(tenantInvites)
      .where(and(eq(tenantInvites.tenantId, tenantId), eq(tenantInvites.status, 'pending')))
      .orderBy(asc(tenantInvites.createdAt));
    return { host: primary.host, slug: primary.slug, pending };
  });

  if (!target) {
    log.info(
      { event: 'invite.deferred', userId: actor?.userId ?? null, tenantId },
      'no verified primary host yet; invites stay pending',
    );
    return { sent: 0, reason: 'no_verified_primary' };
  }

  const redirectTo = `${publicWebOrigin(target.host)}${INVITE_NEXT_PATH}`;
  let sent = 0;

  for (const invite of target.pending) {
    // (a) claim
    const claimed = await withAdminTx(async (tx) =>
      tx
        .update(tenantInvites)
        .set({ status: 'sent', sentAt: new Date() })
        .where(and(eq(tenantInvites.id, invite.id), eq(tenantInvites.status, 'pending')))
        .returning({ id: tenantInvites.id }),
    );
    if (claimed.length === 0) continue;

    // (b) GoTrue creates the identity (auth.users.invited_at) and sends the branded e-mail (02-06 hook).
    const invited = await supabaseAdmin.auth.admin.inviteUserByEmail(invite.email, {
      redirectTo,
      data: { tenant_slug: target.slug },
    });

    if (invited.error || !invited.data.user?.id) {
      // (c) revert the claim so "Reenviar convite" can try again.
      await withAdminTx(async (tx) =>
        tx
          .update(tenantInvites)
          .set({ status: 'pending', sentAt: null })
          .where(eq(tenantInvites.id, invite.id)),
      );
      log.error(
        {
          event: 'invite.send_failed',
          userId: actor?.userId ?? null,
          tenantId,
          inviteId: invite.id,
          err: invited.error?.message ?? 'no user returned',
        },
        'inviteUserByEmail failed',
      );
      throw new ApiError(500, 'INTERNAL');
    }

    const invitedUserId = invited.data.user.id;

    // (d) membership + back-reference. `onConflictDoNothing`: a re-sent invite keeps its row.
    await withAdminTx(async (tx) => {
      await waitForMirroredUser(tx, invitedUserId);
      await tx
        .insert(memberships)
        .values({ tenantId, userId: invitedUserId, role: 'admin_tenant', status: 'invited' })
        .onConflictDoNothing();
      await tx
        .update(tenantInvites)
        .set({ userId: invitedUserId })
        .where(eq(tenantInvites.id, invite.id));
    });

    sent += 1;
    log.info(
      {
        event: 'invite.sent',
        userId: actor?.userId ?? null,
        tenantId,
        inviteId: invite.id,
        invitedUserId,
        host: target.host,
      },
      'first-admin invite sent',
    );
  }

  return { sent };
}
