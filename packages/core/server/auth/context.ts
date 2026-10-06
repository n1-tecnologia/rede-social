import type { DomainEventRecord, TenantRole } from '@rede-social/contracts';
import type { Logger } from 'pino';
import type { TenantHostResolution } from '../tenancy/tenant-host';

// `DomainEventRecord` now lives in `@rede-social/contracts` (01-07) next to the `EventMap` modules augment.
export type { DomainEventRecord };

/**
 * Set by `requireAuth`. `tenantId` is the membership the request's host selected AMONG THE USER'S OWN
 * memberships (D-307; on a non-tenant host, the D-308 choice rule) — never a host, header or cookie
 * alone (TENANT-01, D-23).
 */
export type RequestContext = {
  userId: string;
  tenantId: string;
  role: TenantRole;
  requestId: string;
  events: DomainEventRecord[];
};

/**
 * Set by `requireIdentity` (the identity lane, `/v1/join/*` only): a verified Bearer and the resolved
 * host, with NO membership and no tenant lane. `hostTenant` is the verified host's tenant or
 * `unknown`; it names which community the request is about, never one the caller belongs to.
 */
export type IdentityContext = {
  userId: string;
  email: string | null;
  host: string | null;
  hostTenant: TenantHostResolution;
};

/** Hono environment shared by every route and middleware in the API. */
export type AppEnv = {
  Variables: {
    ctx: RequestContext;
    identity: IdentityContext;
    requestId: string;
    logger: Logger;
  };
};
