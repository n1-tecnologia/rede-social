import { normalizeHost, TENANT_CHOICE_HEADER, TENANT_HOST_HEADER } from '@rede-social/contracts';
import { createMiddleware } from 'hono/factory';
import { type JWTPayload, jwtVerify } from 'jose';
import { ApiError } from '../http/api-error';
import {
  type Membership,
  membershipInTenant,
  membershipsOfUser,
  pickGenericMembership,
} from '../tenancy/membership';
import { resolveTenantHost, type TenantHostResolution } from '../tenancy/tenant-host';
import type { AppEnv } from './context';
import { JWKS, JWT_ISSUER } from './jwks';

/**
 * Bearer parse + ES256 verification against the Supabase JWKS. Shared by `requireAuth` (tenant lane),
 * `requireIdentity` (identity lane) and `requireSuperAdmin` (platform lane) so all three reject an
 * absent, forged, expired or wrongly-signed token identically — one implementation, one set of
 * failure codes.
 */
export async function verifyBearer(c: {
  req: { header(name: string): string | undefined };
}): Promise<JWTPayload & { sub: string }> {
  const token = c.req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED');

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, JWKS, { issuer: JWT_ISSUER, audience: 'authenticated' }));
  } catch {
    throw new ApiError(401, 'INVALID_TOKEN');
  }
  if (!payload.sub) throw new ApiError(401, 'INVALID_TOKEN');
  return payload as JWTPayload & { sub: string };
}

/**
 * The browser-facing host the web BFF forwarded (`x-tenant-host`, already normalised there) and the
 * VERIFIED tenant it resolves to, or `unknown` (no header, localhost, Preview, the platform host, an
 * unverified domain). `Host`/`X-Forwarded-Host` are never read. Shared with `requireIdentity`.
 */
export async function resolveRequestHost(c: {
  req: { header(name: string): string | undefined };
}): Promise<{ host: string | null; hostTenant: TenantHostResolution }> {
  const host = normalizeHost(c.req.header(TENANT_HOST_HEADER));
  const hostTenant: TenantHostResolution = host
    ? await resolveTenantHost(host)
    : { kind: 'unknown' };
  return { host, hostTenant };
}

/**
 * The only tenant-lane paths an `invited` membership may reach (D-29, T-02-122): the bootstrap that
 * tells the web app to show the accept screen, the accept screen's one question (`/v1/me/invite`,
 * D-314: does this identity still need to set a password?) and the accept itself. Mounted API paths
 * (`app.ts` mounts `/v1/me`); compared against `c.req.path` with a trailing slash stripped.
 */
const INVITED_ALLOWED_PATHS = new Set([
  '/v1/me/bootstrap',
  '/v1/me/invite',
  '/v1/me/accept-invite',
]);

/**
 * Host FIRST, then the membership (08.1, D-307). Order is fixed:
 *   verify -> resolve host -> select the membership -> tenant suspended -> blocked -> invited scope.
 *
 * Selection:
 * - On a registered tenant host the request's membership is `app.membership_in_tenant(user, host
 *   tenant)` and nothing else. No row is 403 TENANT_HOST_MISMATCH with NO details: the host selects
 *   among the user's OWN memberships and grants nothing (D-23); the web offers `/participar` (D-305).
 *   A platform admin has no membership there by design and lands on the same answer; the platform
 *   fact is asked by `GET /v1/join/state`, off this hot path (D-316).
 * - On any other host (localhost, Vercel Preview, the platform host, a missing header) every
 *   non-deleted membership is read and `pickGenericMembership` decides (D-308): an `x-tenant-choice`
 *   naming one of the caller's own memberships selects it — a hint, never authority (D-06), and
 *   ignored on a tenant host; otherwise one membership selects it; none is NO_MEMBERSHIP; several
 *   with exactly one not blocked select that one; several all blocked are MEMBERSHIP_BLOCKED and
 *   several open ones are TENANT_CHOICE_REQUIRED, both without details (never name or count them).
 *
 * Then, on the SELECTED membership only (D-304 — a block or suspension in another tenant never
 * reaches this request): a suspended tenant answers TENANT_SUSPENDED for every member, blocked or not
 * (D-32); a blocked membership answers MEMBERSHIP_BLOCKED; an `invited` membership may reach only the
 * two onboarding routes (D-29), every other route answers MEMBERSHIP_INVITED. Those three details
 * carry the selected (host) tenant's display name only. Per request, never cached (AUTH-06, D-09).
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const payload = await verifyBearer(c);
  const userId = payload.sub;
  const { hostTenant } = await resolveRequestHost(c);

  let membership: Membership;
  if (hostTenant.kind === 'tenant') {
    const found = await membershipInTenant(userId, hostTenant.tenantId);
    // No details on purpose: the body must not name the host's tenant nor any of the caller's own.
    if (!found) throw new ApiError(403, 'TENANT_HOST_MISMATCH');
    membership = found;
  } else {
    const pick = pickGenericMembership(
      await membershipsOfUser(userId),
      c.req.header(TENANT_CHOICE_HEADER) ?? null,
    );
    if (pick.kind === 'none') throw new ApiError(403, 'NO_MEMBERSHIP');
    if (pick.kind === 'choice_required') throw new ApiError(403, 'TENANT_CHOICE_REQUIRED');
    if (pick.kind === 'all_blocked') throw new ApiError(403, 'MEMBERSHIP_BLOCKED');
    membership = pick.membership;
  }

  if (membership.tenantStatus !== 'active') {
    throw new ApiError(403, 'TENANT_SUSPENDED', { tenantName: membership.tenantDisplayName });
  }
  if (membership.status === 'blocked') {
    throw new ApiError(403, 'MEMBERSHIP_BLOCKED', { tenantName: membership.tenantDisplayName });
  }
  if (
    membership.status === 'invited' &&
    !INVITED_ALLOWED_PATHS.has(c.req.path.replace(/\/+$/, ''))
  ) {
    throw new ApiError(403, 'MEMBERSHIP_INVITED', { tenantName: membership.tenantDisplayName });
  }

  c.set('ctx', {
    userId,
    tenantId: membership.tenantId,
    role: membership.role,
    requestId: c.get('requestId'),
    events: [],
  });
  // Every later log line of this request carries who and which tenant (observability, D-discretion).
  const log = c.get('logger');
  if (log) c.set('logger', log.child({ tenantId: membership.tenantId, userId }));
  await next();
});
