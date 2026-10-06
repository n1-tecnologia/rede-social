import { resolveBranding, type TenantInvite } from '@rede-social/contracts';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import {
  memberProfiles,
  memberships,
  platformAdmins,
  tenantDomains,
  tenantInvites,
  tenants,
  users,
} from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';
import { env, publicWebOrigin } from '../env';
import { ApiError } from '../http/api-error';
import { type Logger, moduleLogger } from '../logging';
import { buildActionLink } from '../mail/hook-schema';
import { mailTransport, toMailBrand } from '../mail/index';
import { renderInvite } from '../mail/templates/invite';
import { renderInviteExisting } from '../mail/templates/invite-existing';
import { MAIL_SEND_TIMEOUT_MS, MailTransportError, maskEmail } from '../mail/transport';
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
 * Where the EXISTING-identity invite lands (D-314): the tenant's own sign-in page, no token. The
 * person signs in with the password they already have; `requireBootstrap` then routes the `invited`
 * membership to `/aceitar-convite`.
 */
const EXISTING_IDENTITY_PATH = '/entrar';

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

/**
 * Why a send/resend was refused before (or instead of) any GoTrue call: the address is a platform
 * account (D-316). Belonging to another community is not a refusal any more (D-314).
 */
export type InviteRefusal = 'email_in_use';

/**
 * What an invite address already is on the platform (D-314, D-316), read from the `public.users`
 * mirror (written by `on_auth_user_created`), `platform_admins` and `app.identity_has_password`
 * inside the caller's admin transaction — no GoTrue round-trip (`auth.admin` has no get-by-email):
 *
 *   - `new`                       -> no identity: GoTrue `inviteUserByEmail` creates it and mails the
 *                                    set-your-password link;
 *   - `platform_admin`            -> a platform account: refused everywhere (`email_in_use` on send and
 *                                    resend, `adminEmail: 'in_use'` on `createTenant`) — a platform
 *                                    admin is never a tenant member (D-316);
 *   - `existing_with_password`    -> an identity that can already sign in (typically a member of
 *                                    another community): the app mails a TOKENLESS invite to the
 *                                    tenant's `/entrar`; GoTrue is never called, so the mail can never
 *                                    log anyone in (T-08.1-26);
 *   - `existing_without_password` -> an identity that never chose a password (a still-unaccepted
 *                                    GoTrue invite, of this or another tenant — GoTrue stores a RANDOM
 *                                    hash once the link is verified, so the SQL fact also asks whether
 *                                    the identity accepted or joined anywhere): the GoTrue path, whose
 *                                    link lets the person set one (WR-04). GoTrue re-sends to an
 *                                    unconfirmed identity another tenant invited (RESEARCH, v2.197.0).
 *
 * Memberships in other tenants are deliberately NOT read: belonging to another community is no
 * longer a reason to refuse (the single-tenant rule of 02-19 is retired). `email` must already be
 * trimmed and lower-cased by the caller; the mirror column is plain text, so the compare lower-cases
 * it too.
 */
export type IdentityKind =
  | { kind: 'new' }
  | { kind: 'platform_admin'; userId: string }
  | { kind: 'existing_with_password'; userId: string }
  | { kind: 'existing_without_password'; userId: string };

export async function identityKind(tx: Tx, email: string): Promise<IdentityKind> {
  const [identity] = await tx
    .select({ userId: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (!identity) return { kind: 'new' };
  const { userId } = identity;

  const [admin] = await tx
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1);
  if (admin) return { kind: 'platform_admin', userId };

  const [fact] = await tx.execute<{ has_password: boolean }>(
    sql`select app.identity_has_password(${userId}::uuid) as has_password`,
  );
  return fact?.has_password === true
    ? { kind: 'existing_with_password', userId }
    : { kind: 'existing_without_password', userId };
}

/**
 * D-311 on the invite path: a membership the invite JUST created starts with an empty profile name.
 * The `member_profiles_from_membership` trigger still copies the global `users.name` until 08.1-08
 * re-points it, so the name is blanked explicitly in the same transaction (scoped by membership AND
 * tenant, exactly one row — the signup/join pattern). Nothing from another community is copied.
 */
async function blankNewMembershipProfile(
  tx: Tx,
  tenantId: string,
  membershipId: string,
): Promise<void> {
  const named = await tx
    .update(memberProfiles)
    .set({ displayName: '' })
    .where(
      and(eq(memberProfiles.membershipId, membershipId), eq(memberProfiles.tenantId, tenantId)),
    )
    .returning({ id: memberProfiles.membershipId });
  if (named.length !== 1) throw new Error(`member_profiles row missing for ${membershipId}`);
}

/** The tenant facts the existing-identity mail is branded from (the inviting tenant, D-315). */
type InvitingTenant = {
  slug: string;
  displayName: string;
  status: string;
  branding: unknown;
};

/** Why `deliverExistingIdentityInvite` sent nothing. Its callers decide what the row becomes. */
type ExistingDelivery =
  | { ok: true }
  | { ok: false; refusal: 'already_accepted' | 'not_invited' }
  | { ok: false; transportError: unknown };

/**
 * The tokenless invite for an `existing_with_password` identity (D-314), shared by the first send
 * and the resend so the two can never drift. In order:
 *
 *   1. ONE admin transaction: this tenant's membership of the identity is read `for update`.
 *      - none -> insert `admin_tenant`/`invited` (`onConflictDoNothing` on `(tenant_id, user_id)`,
 *        `returning`) and blank the new profile's name (D-311);
 *      - `invited` (not blocked, not deleted) -> a replay: the row and its profile are kept;
 *      - `active` -> `already_accepted`, nothing written, nothing sent;
 *      - blocked or soft-deleted -> `not_invited`, nothing written, nothing sent (the `/entrar` link
 *        would only lead to the blocked or removed screen).
 *      Then `tenant_invites.user_id`. The membership commits BEFORE the mail, so the person can sign
 *      in the moment it arrives (planning decision 3).
 *   2. The mail, in the inviting tenant's brand (verified primary host), CTA `<origin>/entrar` with no
 *      token of any kind, through the kernel `mailTransport` with the idempotency key
 *      `invite-existing:<inviteId>:<sentAt ISO>`. GoTrue is never called (T-08.1-26).
 *
 * A transport failure is returned, not thrown: the membership stays `invited`, so a later resend
 * finishes the job without duplicating anything.
 */
async function deliverExistingIdentityInvite(input: {
  tenantId: string;
  invite: { id: string; email: string };
  userId: string;
  host: string;
  tenant: InvitingTenant;
  sentAt: Date;
}): Promise<ExistingDelivery> {
  const { tenantId, invite, userId, host, tenant, sentAt } = input;

  const refusal = await withAdminTx(async (tx) => {
    const [existing] = await tx
      .select({
        status: memberships.status,
        blockedAt: memberships.blockedAt,
        deletedAt: memberships.deletedAt,
      })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
      .for('update')
      .limit(1);
    if (existing) {
      if (existing.deletedAt || existing.blockedAt || existing.status === 'blocked') {
        return 'not_invited' as const;
      }
      if (existing.status === 'active') return 'already_accepted' as const;
    } else {
      const inserted = await tx
        .insert(memberships)
        .values({ tenantId, userId, role: 'admin_tenant', status: 'invited' })
        .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] })
        .returning({ id: memberships.id });
      const created = inserted[0];
      if (created) await blankNewMembershipProfile(tx, tenantId, created.id);
    }
    await tx.update(tenantInvites).set({ userId }).where(eq(tenantInvites.id, invite.id));
    return null;
  });
  if (refusal) return { ok: false, refusal };

  const brand = toMailBrand(
    {
      kind: 'tenant',
      via: 'invite',
      tenantId,
      slug: tenant.slug,
      displayName: tenant.displayName,
      status: tenant.status,
      branding: resolveBranding(tenant.branding),
      primaryHost: host,
    },
    host,
  );
  const rendered = renderInviteExisting({
    brand,
    link: `${publicWebOrigin(host)}${EXISTING_IDENTITY_PATH}`,
  });

  try {
    await mailTransport.send(
      {
        from: { name: brand.displayName, email: `no-reply@${env.MAIL_DOMAIN}` },
        to: invite.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: `invite-existing:${invite.id}:${sentAt.toISOString()}`,
        meta: { actionType: 'invite', tenantId },
      },
      { signal: AbortSignal.timeout(MAIL_SEND_TIMEOUT_MS) },
    );
  } catch (error) {
    return { ok: false, transportError: error };
  }
  return { ok: true };
}

/** Ids, the transport name and the cause only — never the address, never the mail body. */
function transportFailure(error: unknown): { transport: string; err: string } {
  return {
    transport: error instanceof MailTransportError ? error.transport : mailTransport.name,
    err: error instanceof Error ? error.message : String(error),
  };
}

/**
 * The refused state (02-19 D-A): `expired` with `sent_at = null` — terminal until the super_admin
 * resends, distinguishable from a genuinely lapsed link (which always carries `sent_at`), and
 * never `pending` (a domain re-check would re-attempt the send on every run). `user_id` is left
 * untouched. Logs `invite.refused` (ids and reason only, never the address) and RETURNS the 409 for
 * the caller to throw, so the update always precedes the throw.
 */
async function refuseInvite(
  inviteId: string,
  reason: InviteRefusal,
  log: Logger,
  meta: { tenantId: string; userId: string | null },
): Promise<ApiError> {
  await withAdminTx(async (tx) =>
    tx
      .update(tenantInvites)
      .set({ status: 'expired', sentAt: null })
      .where(eq(tenantInvites.id, inviteId)),
  );
  log.warn(
    { event: 'invite.refused', reason, tenantId: meta.tenantId, inviteId, userId: meta.userId },
    'invite refused: the e-mail is a platform account',
  );
  return new ApiError(409, 'INVITE_STATE_INVALID', { reason });
}

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
 * one the call is a documented no-op and the invites stay `pending` until the tenant's first host is
 * verified. After that verified transition (the `kernel.domain-verify` poller, "Verificar agora", a
 * primary switch) the caller is the `kernel.invite-send` job (`invite-send.ts`, quick 260929-g0s),
 * never the verify path inline: the job waits out the Supabase Auth allow-list propagation window
 * and retries, and passes `opts.inviteId` so one job sends exactly its own row. `createTenant` and
 * `resendInvite` still call this inline (the manual send stays immediate).
 *
 * Per invite, in order:
 *   (a) CLAIM — `update … set status='sent', sent_at=<now> where id=… and status='pending'
 *       returning`; zero rows means another sender won (two panels, the job and a route) and this
 *       one skips (T-02-20);
 *   (a') IDENTITY KIND — `identityKind` on the mirror BEFORE any GoTrue call (D-314, D-316):
 *       - `platform_admin` -> the refused state (`expired`, `sent_at null` — D-A, not back to
 *         `pending`) and 409 INVITE_STATE_INVALID { reason: 'email_in_use' }; no mail, no membership;
 *       - `existing_with_password` -> `deliverExistingIdentityInvite`: the `invited` membership (its
 *         profile name blank, D-311) and `tenant_invites.user_id` commit, then the tokenless mail to
 *         `<origin>/entrar`. GoTrue is never called. An identity already `active` here -> the claim
 *         is undone (back to `pending`, nothing sent) and 409 { reason: 'already_accepted' }; a
 *         blocked or removed one -> the same with { reason: 'not_invited' }. A transport failure
 *         reverts the claim (`pending`, `sent_at` null) and answers 500 INTERNAL; the `invited`
 *         membership stays, so "Reenviar convite" finishes the job without duplicating anything;
 *       - `new` / `existing_without_password` -> (b)-(d) below;
 *   (b) GoTrue `inviteUserByEmail` with `redirectTo` composed ONLY from the verified primary host
 *       through `publicWebOrigin` — never from request input (T-02-16);
 *   (c) on GoTrue failure the claim is reverted (back to `pending`, so a resend is possible) and the
 *       caller gets 500 INTERNAL — EXCEPT GoTrue's `email_exists` (a confirmed identity appeared
 *       between the pre-check and this call): the `email_in_use` refusal, a race guard;
 *   (d) on success: `memberships` row (`admin_tenant`, `invited` — `requireAuth` lets it through so
 *       `/aceitar-convite` can run in the tenant lane), its profile name blanked when the row is new
 *       (D-311), and `tenant_invites.user_id`. The insert tolerates the same-tenant/same-user replay
 *       (`onConflictDoNothing` targeted at `memberships_tenant_user_uq`).
 */
export async function sendPendingInvites(
  tenantId: string,
  actor?: PlatformActor,
  opts?: { inviteId?: string },
): Promise<SendPendingInvitesResult> {
  const log = logFor(actor, 'platform.invites');

  const target = await withAdminTx(async (tx) => {
    const hosts = await tx
      .select({
        host: tenantDomains.host,
        slug: tenants.slug,
        displayName: tenants.displayName,
        status: tenants.status,
        branding: tenants.branding,
      })
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
      .where(
        and(
          eq(tenantInvites.tenantId, tenantId),
          eq(tenantInvites.status, 'pending'),
          opts?.inviteId ? eq(tenantInvites.id, opts.inviteId) : undefined,
        ),
      )
      .orderBy(asc(tenantInvites.createdAt));
    const { host, ...tenant } = primary;
    return { host, tenant, pending };
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

  /** Undoes the claim (`pending`, `sent_at` null): nothing was mailed, so a later send may retry. */
  const revertClaim = (inviteId: string) =>
    withAdminTx(async (tx) =>
      tx
        .update(tenantInvites)
        .set({ status: 'pending', sentAt: null })
        .where(eq(tenantInvites.id, inviteId)),
    );

  for (const invite of target.pending) {
    // (a) claim
    const sentAt = new Date();
    const claimed = await withAdminTx(async (tx) =>
      tx
        .update(tenantInvites)
        .set({ status: 'sent', sentAt })
        .where(and(eq(tenantInvites.id, invite.id), eq(tenantInvites.status, 'pending')))
        .returning({ id: tenantInvites.id }),
    );
    if (claimed.length === 0) continue;

    // (a') what the address already is — before GoTrue can mail or re-token anyone.
    const identity = await withAdminTx((tx) => identityKind(tx, invite.email.trim().toLowerCase()));
    if (identity.kind === 'platform_admin') {
      throw await refuseInvite(invite.id, 'email_in_use', log, {
        tenantId,
        userId: actor?.userId ?? null,
      });
    }

    if (identity.kind === 'existing_with_password') {
      const delivery = await deliverExistingIdentityInvite({
        tenantId,
        invite,
        userId: identity.userId,
        host: target.host,
        tenant: target.tenant,
        sentAt,
      });
      if (!delivery.ok) {
        await revertClaim(invite.id);
        if ('refusal' in delivery) {
          log.warn(
            {
              event: 'invite.refused',
              reason: delivery.refusal,
              tenantId,
              inviteId: invite.id,
              userId: actor?.userId ?? null,
            },
            'existing-identity invite not sent: membership state',
          );
          throw new ApiError(409, 'INVITE_STATE_INVALID', { reason: delivery.refusal });
        }
        log.error(
          {
            event: 'invite.send_failed',
            userId: actor?.userId ?? null,
            tenantId,
            inviteId: invite.id,
            invitedUserId: identity.userId,
            delivery: 'existing_identity',
            ...transportFailure(delivery.transportError),
          },
          'existing-identity invite mail could not be sent',
        );
        throw new ApiError(500, 'INTERNAL');
      }
      sent += 1;
      log.info(
        {
          event: 'invite.sent',
          userId: actor?.userId ?? null,
          tenantId,
          inviteId: invite.id,
          invitedUserId: identity.userId,
          host: target.host,
          delivery: 'existing_identity',
        },
        'first-admin invite sent',
      );
      continue;
    }

    // (b) GoTrue creates (or re-invites an unconfirmed) identity and sends the branded e-mail
    // through the 02-06 hook.
    const invited = await supabaseAdmin.auth.admin.inviteUserByEmail(invite.email, {
      redirectTo,
      data: { tenant_slug: target.tenant.slug },
    });

    if (invited.error || !invited.data.user?.id) {
      if (invited.error && isConfirmedEmail(invited.error)) {
        // Race guard: a confirmed identity appeared between the pre-check and this call.
        throw await refuseInvite(invite.id, 'email_in_use', log, {
          tenantId,
          userId: actor?.userId ?? null,
        });
      }
      // (c) revert the claim so "Reenviar convite" can try again.
      await revertClaim(invite.id);
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

    // (d) membership (blank profile name when new, D-311) + back-reference. The conflict clause
    // tolerates the same-tenant/same-user replay (a re-sent invite keeps its row and its profile).
    await withAdminTx(async (tx) => {
      await waitForMirroredUser(tx, invitedUserId);
      const inserted = await tx
        .insert(memberships)
        .values({ tenantId, userId: invitedUserId, role: 'admin_tenant', status: 'invited' })
        .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] })
        .returning({ id: memberships.id });
      const created = inserted[0];
      if (created) await blankNewMembershipProfile(tx, tenantId, created.id);
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
        delivery: 'gotrue',
      },
      'first-admin invite sent',
    );
  }

  return { sent };
}

/** One `tenant_invites` row in the `tenantInviteSchema` shape (dates as ISO strings). */
type InviteRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  sentAt: Date | null;
  acceptedAt: Date | null;
  createdAt: Date;
};

const toInvite = (row: InviteRow): TenantInvite => ({
  id: row.id,
  email: row.email,
  role: 'admin_tenant',
  status: row.status as TenantInvite['status'],
  sentAt: row.sentAt ? row.sentAt.toISOString() : null,
  acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
  createdAt: row.createdAt.toISOString(),
});

const inviteColumns = {
  id: tenantInvites.id,
  email: tenantInvites.email,
  role: tenantInvites.role,
  status: tenantInvites.status,
  sentAt: tenantInvites.sentAt,
  acceptedAt: tenantInvites.acceptedAt,
  createdAt: tenantInvites.createdAt,
};

async function readInvite(tx: Tx, tenantId: string, inviteId: string): Promise<TenantInvite> {
  const rows = await tx
    .select(inviteColumns)
    .from(tenantInvites)
    .where(and(eq(tenantInvites.id, inviteId), eq(tenantInvites.tenantId, tenantId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return toInvite(row);
}

/**
 * `GET /v1/platform/tenants/{id}/invites` (D-30, D-37): every invite row of the tenant, oldest
 * first. An unknown tenant is a 404 (never an empty list, so the panel can tell the two apart).
 */
export async function listTenantInvites(tenantId: string): Promise<TenantInvite[]> {
  return withAdminTx(async (tx) => {
    const exists = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!exists[0]) throw new ApiError(404, 'NOT_FOUND');
    const rows = await tx
      .select(inviteColumns)
      .from(tenantInvites)
      .where(eq(tenantInvites.tenantId, tenantId))
      .orderBy(asc(tenantInvites.createdAt));
    return rows.map(toInvite);
  });
}

/**
 * GoTrue's "this e-mail already has a confirmed identity" shape (same defensive match as
 * `signup.ts`): the wording is not part of GoTrue's contract, so code, status and message are all
 * consulted.
 */
function isConfirmedEmail(error: { message?: string; code?: string; status?: number }): boolean {
  const message = (error.message ?? '').toLowerCase();
  return (
    error.code === 'email_exists' ||
    error.code === 'user_already_exists' ||
    message.includes('already been registered') ||
    message.includes('already registered') ||
    (error.status === 422 && message.includes('user') && message.includes('exist'))
  );
}

/**
 * "Reenviar convite" (D-30): the super_admin resends the first-admin invite from the Admins tab.
 * Branches on the invite row (read scoped by `id AND tenant_id`, so an id that belongs to another
 * tenant is a plain 404 — never a hint that it exists elsewhere):
 *
 *   - `accepted`  -> 409 INVITE_STATE_INVALID { reason: 'already_accepted' };
 *   - no verified primary host -> 409 { reason: 'no_verified_primary' } (the link needs the tenant's
 *     own branded origin, D-36);
 *   - `pending`   -> delegates to `sendPendingInvites` so the FIRST send has exactly one
 *     implementation (claim-before-send, `identityKind`, GoTrue or the tokenless mail);
 *   - `sent` / `expired` -> `identityKind` BEFORE any GoTrue call (D-314, Pitfall 6):
 *       - `platform_admin` -> the refused state and 409 { reason: 'email_in_use' } on every resend,
 *         with no GoTrue call, no mail and no token replaced (D-316, T-02-151);
 *       - `existing_with_password` -> `deliverExistingIdentityInvite` again: the tokenless mail to
 *         `<origin>/entrar` (idempotency key `invite-existing:<inviteId>:<sentAt>`), then the row is
 *         `sent` with the new `sent_at`. GoTrue is never reached, so the `generateLink` →
 *         `email_exists` → recovery-link branch below can never mail a login-capable link to an
 *         identity that already has a password (T-08.1-26). `active` here -> 409
 *         { reason: 'already_accepted' }; blocked or removed -> 409 { reason: 'not_invited' };
 *       - `new` / `existing_without_password` -> a fresh token through the GoTrue admin
 *         `generateLink({ type: 'invite' })` — which never sends mail and returns
 *         `properties.hashed_token` — rendered with the 02-06 invite template in the tenant's brand
 *         and sent through the kernel `mailTransport`.
 *
 * WR-04 (02-19 D-C) — when `generateLink({ type: 'invite' })` answers `email_exists`, GoTrue only
 * says the identity is CONFIRMED (`/auth/confirm` runs `verifyOtp` before the password is set, so an
 * admin who abandoned `/aceitar-convite` is confirmed but never accepted — an identity WITHOUT a
 * password, since one with a password took the branch above). Acceptance is OUR state:
 *   - `invite.status === 'accepted'` (checked first) or this tenant's membership `active`
 *     -> 409 { reason: 'already_accepted' };
 *   - membership `invited` -> a recovery-type `generateLink` for the SAME `redirectTo`,
 *     sent with the same branded invite template (`type=recovery` in the link): `/auth/confirm`
 *     accepts `recovery`, honours `next=/aceitar-convite`, and the accept action sets the password
 *     through `updateUser`, which a recovery session allows — the admin lands on the accept screen;
 *   - no membership / no `user_id` -> `email_in_use` refusal; any other status -> `not_invited`.
 *
 * Why not `inviteUserByEmail` again (RESEARCH A3): every GoTrue-originated send consumes the
 * `[auth.rate_limit] email_sent` budget, and `generateLink` REPLACES the user's confirmation token,
 * so the previous link stops working deterministically (T-02-120) — the behaviour the panel and the
 * e2e rely on.
 *
 * `redirectTo` is composed ONLY from the tenant's verified primary `tenant_domains.host` through
 * `publicWebOrigin` (T-02-123). The hashed token and the built link are handed to `buildActionLink`
 * / `renderInvite` and to nothing else — never a log line, never the return value (T-02-124). A
 * transport failure leaves the row untouched so the panel can simply retry.
 */
export async function resendInvite(
  tenantId: string,
  inviteId: string,
  actor: PlatformActor,
): Promise<TenantInvite> {
  const log = logFor(actor, 'platform.invites');

  const state = await withAdminTx(async (tx) => {
    const invite = await readInvite(tx, tenantId, inviteId);
    // The back-reference is internal (not in `tenantInviteSchema`): it names OUR membership row
    // when GoTrue answers that the identity is already confirmed (WR-04).
    const [ref] = await tx
      .select({ userId: tenantInvites.userId })
      .from(tenantInvites)
      .where(eq(tenantInvites.id, inviteId))
      .limit(1);
    const [tenant] = await tx
      .select({
        slug: tenants.slug,
        displayName: tenants.displayName,
        status: tenants.status,
        branding: tenants.branding,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) throw new ApiError(404, 'NOT_FOUND');
    const hosts = await tx
      .select({ host: tenantDomains.host })
      .from(tenantDomains)
      .where(
        and(
          eq(tenantDomains.tenantId, tenantId),
          eq(tenantDomains.isPrimary, true),
          isNotNull(tenantDomains.verifiedAt),
        ),
      )
      .limit(1);
    return { invite, invitedUserRef: ref?.userId ?? null, tenant, host: hosts[0]?.host ?? null };
  });

  const { invite, invitedUserRef, tenant, host } = state;
  if (invite.status === 'accepted') {
    throw new ApiError(409, 'INVITE_STATE_INVALID', { reason: 'already_accepted' });
  }
  if (!host) {
    throw new ApiError(409, 'INVITE_STATE_INVALID', { reason: 'no_verified_primary' });
  }

  if (invite.status === 'pending') {
    await sendPendingInvites(tenantId, actor);
    return withAdminTx((tx) => readInvite(tx, tenantId, inviteId));
  }

  // `sent` / `expired`: what the address is decides BEFORE any GoTrue call (Pitfall 6).
  const identity = await withAdminTx((tx) => identityKind(tx, invite.email.trim().toLowerCase()));
  if (identity.kind === 'platform_admin') {
    throw await refuseInvite(inviteId, 'email_in_use', log, { tenantId, userId: actor.userId });
  }

  if (identity.kind === 'existing_with_password') {
    const sentAt = new Date();
    const delivery = await deliverExistingIdentityInvite({
      tenantId,
      invite: { id: inviteId, email: invite.email },
      userId: identity.userId,
      host,
      tenant,
      sentAt,
    });
    if (!delivery.ok) {
      if ('refusal' in delivery) {
        throw new ApiError(409, 'INVITE_STATE_INVALID', { reason: delivery.refusal });
      }
      log.error(
        {
          event: 'invite.resend_failed',
          userId: actor.userId,
          tenantId,
          inviteId,
          delivery: 'existing_identity',
          ...transportFailure(delivery.transportError),
        },
        'existing-identity invite mail could not be sent',
      );
      throw new ApiError(500, 'INTERNAL');
    }
    const fresh = await withAdminTx(async (tx) => {
      await tx
        .update(tenantInvites)
        .set({ status: 'sent', sentAt, userId: identity.userId })
        .where(eq(tenantInvites.id, inviteId));
      return readInvite(tx, tenantId, inviteId);
    });
    log.info(
      {
        event: 'invite.resent',
        userId: actor.userId,
        tenantId,
        inviteId,
        invitedUserId: identity.userId,
        delivery: 'existing_identity',
        to: maskEmail(invite.email),
        transport: mailTransport.name,
      },
      'first-admin invite resent',
    );
    return fresh;
  }

  // `new` / `existing_without_password`: mint a fresh token (no mail from GoTrue) and send it ourselves.
  const redirectTo = `${publicWebOrigin(host)}${INVITE_NEXT_PATH}`;
  let linkType: 'invite' | 'recovery' = 'invite';
  let generated = await supabaseAdmin.auth.admin.generateLink({
    type: 'invite',
    email: invite.email,
    options: { redirectTo, data: { tenant_slug: tenant.slug } },
  });
  if (generated.error && isConfirmedEmail(generated.error)) {
    // GoTrue only says the identity is confirmed (the admin exchanged the link on /auth/confirm);
    // whether the invite was ACCEPTED is OUR state (WR-04): the invite row was checked above, the
    // membership of this tenant decides here.
    const membership = invitedUserRef
      ? await withAdminTx(async (tx) => {
          const rows = await tx
            .select({ status: memberships.status })
            .from(memberships)
            .where(
              and(
                eq(memberships.tenantId, tenantId),
                eq(memberships.userId, invitedUserRef),
                isNull(memberships.deletedAt),
              ),
            )
            .limit(1);
          return rows[0]?.status ?? null;
        })
      : null;
    if (membership === 'active') {
      throw new ApiError(409, 'INVITE_STATE_INVALID', { reason: 'already_accepted' });
    }
    if (membership === null) {
      // A confirmed identity that is not our invited admin (the pre-check's race guard).
      throw await refuseInvite(inviteId, 'email_in_use', log, { tenantId, userId: actor.userId });
    }
    if (membership !== 'invited') {
      throw new ApiError(409, 'INVITE_STATE_INVALID', { reason: 'not_invited' });
    }
    // `invited`: a recovery link for the same redirectTo (D-C) — `/auth/confirm` accepts the type
    // and honours `next=/aceitar-convite`, where `updateUser` sets the password on that session.
    linkType = 'recovery';
    generated = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: invite.email,
      options: { redirectTo },
    });
  }
  if (generated.error) {
    log.error(
      {
        event: 'invite.resend_failed',
        userId: actor.userId,
        tenantId,
        inviteId,
        linkType,
        err: generated.error.message,
      },
      'generateLink failed',
    );
    throw new ApiError(500, 'INTERNAL');
  }
  const hashedToken = generated.data.properties?.hashed_token;
  const invitedUserId = generated.data.user?.id;
  if (!hashedToken || !invitedUserId) {
    log.error(
      { event: 'invite.resend_failed', userId: actor.userId, tenantId, inviteId, err: 'no token' },
      'generateLink returned no hashed token',
    );
    throw new ApiError(500, 'INTERNAL');
  }

  const link = buildActionLink(redirectTo, hashedToken, linkType);
  const brand = toMailBrand(
    {
      kind: 'tenant',
      via: 'membership',
      tenantId,
      slug: tenant.slug,
      displayName: tenant.displayName,
      status: tenant.status,
      branding: resolveBranding(tenant.branding),
      primaryHost: host,
    },
    host,
  );
  const rendered = renderInvite({ brand, link });
  const sentAt = new Date();

  try {
    await mailTransport.send(
      {
        from: { name: brand.displayName, email: `no-reply@${env.MAIL_DOMAIN}` },
        to: invite.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: `invite-resend:${inviteId}:${sentAt.toISOString()}`,
        meta: { actionType: 'invite', tenantId },
      },
      { signal: AbortSignal.timeout(MAIL_SEND_TIMEOUT_MS) },
    );
  } catch (error) {
    log.error(
      {
        event: 'invite.resend_failed',
        userId: actor.userId,
        tenantId,
        inviteId,
        ...transportFailure(error),
      },
      'invite mail could not be sent',
    );
    throw new ApiError(500, 'INTERNAL');
  }

  const fresh = await withAdminTx(async (tx) => {
    // `generateLink` recreates the auth user when it had been deleted; wait for the mirror row.
    await waitForMirroredUser(tx, invitedUserId);
    // The same-tenant/same-user replay keeps its row and profile; a new row starts blank (D-311).
    const inserted = await tx
      .insert(memberships)
      .values({ tenantId, userId: invitedUserId, role: 'admin_tenant', status: 'invited' })
      .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] })
      .returning({ id: memberships.id });
    const created = inserted[0];
    if (created) await blankNewMembershipProfile(tx, tenantId, created.id);
    await tx
      .update(tenantInvites)
      .set({ status: 'sent', sentAt, userId: invitedUserId })
      .where(eq(tenantInvites.id, inviteId));
    return readInvite(tx, tenantId, inviteId);
  });

  log.info(
    {
      event: 'invite.resent',
      userId: actor.userId,
      tenantId,
      inviteId,
      invitedUserId,
      linkType,
      delivery: 'gotrue',
      to: maskEmail(invite.email),
      transport: mailTransport.name,
    },
    'first-admin invite resent',
  );

  return fresh;
}
