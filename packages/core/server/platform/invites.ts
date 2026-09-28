import { resolveBranding, type TenantInvite } from '@rede-social/contracts';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { memberships, tenantDomains, tenantInvites, tenants, users } from '../../db/schema';
import type { Tx } from '../../db/tenant-tx';
import { env, publicWebOrigin } from '../env';
import { ApiError } from '../http/api-error';
import { type Logger, moduleLogger } from '../logging';
import { buildActionLink } from '../mail/hook-schema';
import { mailTransport, toMailBrand } from '../mail/index';
import { renderInvite } from '../mail/templates/invite';
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

/** Why a send/resend was refused before (or instead of) any GoTrue call (02-19, WR-02/WR-03). */
export type InviteRefusal = 'email_in_use' | 'user_in_other_tenant';

/**
 * The ONE identity rule of the invite flow (02-19 D-B): an e-mail that already has an identity on
 * the platform can never receive a first-admin invite for a tenant it does not already belong to.
 * Read from the `public.users` mirror (written by `on_auth_user_created`) joined to the non-deleted
 * `memberships` — no GoTrue round-trip (`auth.admin` has no get-by-email) and no mail or token
 * replaced for a foreign identity:
 *
 *   - no identity                                   -> null (a fresh e-mail; GoTrue will create it);
 *   - identity with a membership in THIS tenant     -> null (our own invited admin; a replay);
 *   - identity with a membership in ANOTHER tenant  -> 'user_in_other_tenant' (ROLE-02, V1);
 *   - identity with no membership at all            -> 'email_in_use' (super_admin, orphan,
 *                                                      soft-deleted elsewhere).
 *
 * V1 rule: the first admin's e-mail must be new to the platform. Relaxing it for V2 multi-tenant
 * membership is a change in THIS helper and nowhere else. `email` must already be trimmed and
 * lower-cased by the caller; the mirror column is plain text, so the compare lower-cases it too.
 */
export async function identityConflict(
  tx: Tx,
  email: string,
  tenantId: string,
): Promise<InviteRefusal | null> {
  const rows = await tx
    .select({ userId: users.id, membershipTenantId: memberships.tenantId })
    .from(users)
    .leftJoin(memberships, and(eq(memberships.userId, users.id), isNull(memberships.deletedAt)))
    .where(sql`lower(${users.email}) = ${email}`);
  if (rows.length === 0) return null;
  if (rows.some((row) => row.membershipTenantId === tenantId)) return null;
  if (rows.some((row) => row.membershipTenantId !== null)) return 'user_in_other_tenant';
  return 'email_in_use';
}

/**
 * Postgres `23505` raised by `memberships_one_tenant_per_user_v1` (unique on `user_id`), possibly
 * wrapped by drizzle's `DrizzleQueryError` — the cause chain is walked like `tenants.ts`'s slug
 * mapping. Unlike that helper an EMPTY constraint name is NOT accepted: with the targeted
 * `onConflictDoNothing({ target: [tenantId, userId] })` on the membership insert, that index is the
 * only 23505 the insert can raise, so a misattributed refusal would hide a real bug.
 */
export function isOneTenantPerUserViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === '23505') {
      return (
        typeof e.constraint_name === 'string' && e.constraint_name.includes('one_tenant_per_user')
      );
    }
    current = e.cause;
  }
  return false;
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
    'invite refused: e-mail already on the platform',
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
 * one the call is a documented no-op and the invites stay `pending` until `domain-verify` (02-09)
 * calls this again on the first verified host. `createTenant` calls it right after commit, so a
 * tenant provisioned on an existing host is invited immediately.
 *
 * Per invite, in order:
 *   (a) CLAIM — `update … set status='sent' where id=… and status='pending' returning`; zero rows
 *       means another sender won (two panels, the job and a route) and this one skips (T-02-20);
 *   (a') IDENTITY PRE-CHECK — `identityConflict` on the mirror BEFORE any GoTrue call (02-19,
 *       WR-02/WR-03, T-02-151): a refusal replaces the claim with the refused state (`expired`,
 *       `sent_at null` — D-A, not back to `pending`) and answers 409 INVITE_STATE_INVALID
 *       { reason: 'email_in_use' | 'user_in_other_tenant' }; no mail, no membership;
 *   (b) GoTrue `inviteUserByEmail` with `redirectTo` composed ONLY from the verified primary host
 *       through `publicWebOrigin` — never from request input (T-02-16);
 *   (c) on GoTrue failure the claim is reverted (back to `pending`, so a resend is possible) and the
 *       caller gets 500 INTERNAL — EXCEPT GoTrue's `email_exists` (an identity created between the
 *       pre-check and this call): the same `email_in_use` refusal, a race guard;
 *   (d) on success: `memberships` row (`admin_tenant`, `invited` — `requireAuth` lets it through so
 *       `/aceitar-convite` can run in the tenant lane) and `tenant_invites.user_id`. The insert
 *       tolerates ONLY the same-tenant/same-user replay (`onConflictDoNothing` targeted at
 *       `memberships_tenant_user_uq`); a 23505 on `memberships_one_tenant_per_user_v1` means the
 *       identity GoTrue just (re)invited belongs to another tenant -> `user_in_other_tenant`
 *       refusal (race guard; the row is never left `sent` without a membership — WR-02).
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

    // (a') the identity pre-check — before GoTrue can mail or re-token a foreign identity.
    const conflict = await withAdminTx((tx) =>
      identityConflict(tx, invite.email.trim().toLowerCase(), tenantId),
    );
    if (conflict) {
      throw await refuseInvite(invite.id, conflict, log, {
        tenantId,
        userId: actor?.userId ?? null,
      });
    }

    // (b) GoTrue creates the identity (auth.users.invited_at) and sends the branded e-mail (02-06 hook).
    const invited = await supabaseAdmin.auth.admin.inviteUserByEmail(invite.email, {
      redirectTo,
      data: { tenant_slug: target.slug },
    });

    if (invited.error || !invited.data.user?.id) {
      if (invited.error && isConfirmedEmail(invited.error)) {
        // Race guard: the identity appeared between the pre-check and this call.
        throw await refuseInvite(invite.id, 'email_in_use', log, {
          tenantId,
          userId: actor?.userId ?? null,
        });
      }
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

    // (d) membership + back-reference. The conflict clause tolerates ONLY the same-tenant/same-user
    // replay (a re-sent invite keeps its row); the one-tenant-per-user index is left to raise.
    try {
      await withAdminTx(async (tx) => {
        await waitForMirroredUser(tx, invitedUserId);
        await tx
          .insert(memberships)
          .values({ tenantId, userId: invitedUserId, role: 'admin_tenant', status: 'invited' })
          .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] });
        await tx
          .update(tenantInvites)
          .set({ userId: invitedUserId })
          .where(eq(tenantInvites.id, invite.id));
      });
    } catch (error) {
      if (isOneTenantPerUserViolation(error)) {
        // Race guard: the identity GoTrue just (re)invited belongs to another tenant (WR-02).
        throw await refuseInvite(invite.id, 'user_in_other_tenant', log, {
          tenantId,
          userId: actor?.userId ?? null,
        });
      }
      throw error;
    }

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
 *     implementation (claim-before-send, identity pre-check, GoTrue `inviteUserByEmail`, the 02-06
 *     hook, branded mail);
 *   - `sent` / `expired` -> the `identityConflict` pre-check (02-19 D-B: a refused row keeps
 *     answering 409 { reason: 'email_in_use' | 'user_in_other_tenant' } with no side effects), then
 *     a fresh token through the GoTrue admin `generateLink({ type: 'invite' })` — which never sends
 *     mail and returns `properties.hashed_token` — rendered with the 02-06 invite template in the
 *     tenant's brand and sent through the kernel `mailTransport`.
 *
 * WR-04 (02-19 D-C) — when `generateLink({ type: 'invite' })` answers `email_exists`, GoTrue only
 * says the identity is CONFIRMED (`/auth/confirm` runs `verifyOtp` before the password is set, so an
 * admin who abandoned `/aceitar-convite` is confirmed but never accepted). Acceptance is OUR state:
 *   - `invite.status === 'accepted'` (checked first) or this tenant's membership `active`
 *     -> 409 { reason: 'already_accepted' };
 *   - membership `invited` -> a recovery-type `generateLink` for the SAME `redirectTo`,
 *     sent with the same branded invite template (`type=recovery` in the link): `/auth/confirm`
 *     accepts `recovery`, honours `next=/aceitar-convite`, and the accept action sets the password
 *     through `updateUser`, which a recovery session allows — the admin lands on the accept screen;
 *   - no membership / no `user_id` -> `email_in_use` refusal; any other status -> `not_invited`.
 *
 * Why not `inviteUserByEmail` again (RESEARCH A3): whether GoTrue re-sends for an already-invited
 * user is unverified, every GoTrue-originated send consumes the `[auth.rate_limit] email_sent`
 * budget, and `generateLink` REPLACES the user's confirmation token, so the previous link stops
 * working deterministically (T-02-120) — the behaviour the panel and the e2e rely on.
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

  // `sent` / `expired`: the identity pre-check first (02-19 D-B) — a refused row (or one whose
  // identity meanwhile joined another tenant) is answered the same 409 on every resend, with no
  // GoTrue call, no mail and no token replaced (T-02-151).
  const conflict = await withAdminTx((tx) =>
    identityConflict(tx, invite.email.trim().toLowerCase(), tenantId),
  );
  if (conflict) {
    throw await refuseInvite(inviteId, conflict, log, { tenantId, userId: actor.userId });
  }

  // Mint a fresh token (no mail from GoTrue) and send it ourselves.
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
        transport: error instanceof MailTransportError ? error.transport : mailTransport.name,
        err: error instanceof Error ? error.message : String(error),
      },
      'invite mail could not be sent',
    );
    throw new ApiError(500, 'INTERNAL');
  }

  let fresh: TenantInvite;
  try {
    fresh = await withAdminTx(async (tx) => {
      // `generateLink` recreates the auth user when it had been deleted; wait for the mirror row.
      await waitForMirroredUser(tx, invitedUserId);
      // Same-tenant/same-user replay only; the one-tenant-per-user index is left to raise (WR-02).
      await tx
        .insert(memberships)
        .values({ tenantId, userId: invitedUserId, role: 'admin_tenant', status: 'invited' })
        .onConflictDoNothing({ target: [memberships.tenantId, memberships.userId] });
      await tx
        .update(tenantInvites)
        .set({ status: 'sent', sentAt, userId: invitedUserId })
        .where(eq(tenantInvites.id, inviteId));
      return readInvite(tx, tenantId, inviteId);
    });
  } catch (error) {
    if (isOneTenantPerUserViolation(error)) {
      // Race guard: the identity joined another tenant between the pre-check and the insert.
      throw await refuseInvite(inviteId, 'user_in_other_tenant', log, {
        tenantId,
        userId: actor.userId,
      });
    }
    throw error;
  }

  log.info(
    {
      event: 'invite.resent',
      userId: actor.userId,
      tenantId,
      inviteId,
      invitedUserId,
      linkType,
      to: maskEmail(invite.email),
      transport: mailTransport.name,
    },
    'first-admin invite resent',
  );

  return fresh;
}
