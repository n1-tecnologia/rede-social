import { normalizeHost, TENANT_CHOICE_HEADER, TENANT_HOST_HEADER } from '@rede-social/contracts';
import { createMiddleware } from 'hono/factory';
import { type JWTPayload, jwtVerify } from 'jose';
import { env } from '../env';
import { ApiError } from '../http/api-error';
import {
  type Membership,
  membershipInTenant,
  membershipsOfUser,
  pickGenericMembership,
} from '../tenancy/membership';
import { resolveTenantHost, type TenantHostResolution } from '../tenancy/tenant-host';
import type { AppEnv } from './context';
import { issuerFor, jwksFor } from './jwks';

/** The project whose keys and issuer a bearer is verified against (09.2-08, D-538). */
export type VerificationProject = { apiUrl: string };

/** The bearer token of the request, or 401 `UNAUTHENTICATED` when the header carries none. */
function bearerOf(c: { req: { header(name: string): string | undefined } }): string {
  const token = c.req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED');
  return token;
}

/** 401 `UNAUTHENTICATED` unless a bearer is present; verifies nothing. */
export function assertBearerPresent(c: {
  req: { header(name: string): string | undefined };
}): void {
  bearerOf(c);
}

/**
 * Bearer parse + ES256 verification against the keys and issuer of `project` (09.2-08, D-538, DBT-10).
 * The project is chosen by the caller from the request HOST before the token is parsed; the token's own
 * `iss` never selects a keyset. Shared by `requireAuth` (tenant lane), `requireIdentity` (identity lane,
 * central) and `requireSuperAdmin` (platform lane, central) so all three reject an absent, forged,
 * expired or wrongly-signed token identically — one implementation, one set of failure codes.
 *
 * `project` is `{ apiUrl }` from the registry; a missing or empty `apiUrl` is a project that cannot verify
 * anything, so it is the same 401 as a bad token (never a 500).
 */
export async function verifyBearer(
  c: { req: { header(name: string): string | undefined } },
  project: VerificationProject = { apiUrl: env.SUPABASE_URL },
): Promise<JWTPayload & { sub: string }> {
  const token = bearerOf(c);

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwksFor(project.apiUrl), {
      issuer: issuerFor(project.apiUrl),
      audience: 'authenticated',
      algorithms: ['ES256'],
    }));
  } catch {
    throw new ApiError(401, 'INVALID_TOKEN');
  }
  if (!payload.sub) throw new ApiError(401, 'INVALID_TOKEN');
  return payload as JWTPayload & { sub: string };
}

/**
 * The verification project of a request: a registered tenant host selects that tenant's project; the
 * platform host, an unregistered host, a Vercel Preview host and a missing `x-tenant-host` select the
 * central project (09.2-08, D-538).
 */
export function verificationProjectOf(hostTenant: TenantHostResolution): VerificationProject {
  return hostTenant.kind === 'tenant'
    ? { apiUrl: hostTenant.apiUrl }
    : { apiUrl: env.SUPABASE_URL };
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
 * The only tenant-lane path a member whose payment access is CUT may reach (09.1-02, D-496, D-497):
 * the "Assinatura pendente" screen's own question, whose route lands in plan 10. Compared like
 * `INVITED_ALLOWED_PATHS`, against `c.req.path` with a trailing slash stripped.
 */
export const CUT_ALLOWED_PATHS = new Set(['/v1/me/subscription']);

/**
 * Host FIRST, then the membership (08.1, D-307). Order is fixed:
 *   bearer present -> resolve host -> host status gate (09.2-08) -> verify against the host's project ->
 *   select the membership -> tenant suspended -> blocked -> invited scope -> the payment access state (09.1-02).
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
 *
 * Last comes the payment access state (D-496, D-497), read from the SAME row the lookup returned (the
 * `_gated` SQL twins evaluate `app.access_state` in the lookup's own statement: no second query, no
 * cache, no claim): `blocked` (a manual block while the gate is on, A-P10) answers MEMBERSHIP_BLOCKED;
 * `cut` answers SUBSCRIPTION_PENDING on every path except `CUT_ALLOWED_PATHS`. A cut never writes
 * `memberships.status`, the profile or any content, and never revokes the Supabase session (D-498).
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  // 09.2-08 (D-538, D-542, D-545): bearer present -> the host selects the project and says whether the tenant
  // can serve at all -> the token is verified against THAT project's keys only -> the tenant lane.
  assertBearerPresent(c);
  const { hostTenant } = await resolveRequestHost(c);
  if (hostTenant.kind === 'tenant') {
    // Before ANY tenant connection and before any key lookup: a project still coming up has no keys to
    // verify against, and a tenant being held out opens nothing. No details on the three project codes.
    switch (hostTenant.status) {
      case 'suspended':
        throw new ApiError(403, 'TENANT_SUSPENDED', { tenantName: hostTenant.displayName });
      case 'preparing':
        throw new ApiError(503, 'TENANT_PREPARING');
      case 'unavailable':
        throw new ApiError(503, 'TENANT_UNAVAILABLE');
      case 'updating':
        throw new ApiError(503, 'TENANT_UPDATING');
      default:
        break;
    }
  }
  const payload = await verifyBearer(c, verificationProjectOf(hostTenant));
  const userId = payload.sub;

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
  if (membership.accessState === 'blocked') {
    throw new ApiError(403, 'MEMBERSHIP_BLOCKED', { tenantName: membership.tenantDisplayName });
  }
  if (membership.accessState === 'cut' && !CUT_ALLOWED_PATHS.has(c.req.path.replace(/\/+$/, ''))) {
    throw new ApiError(403, 'SUBSCRIPTION_PENDING', { tenantName: membership.tenantDisplayName });
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
