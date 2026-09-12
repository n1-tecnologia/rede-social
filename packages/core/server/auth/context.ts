import type { TenantRole } from '@tria/contracts';
import type { Logger } from 'pino';

/** A domain event collected during a request and dispatched after commit (bus lands in plan 01-07). */
export type DomainEventRecord = {
  name: string;
  payload: unknown;
};

/** Set by `requireAuth`. `tenantId` ALWAYS comes from the membership row, never from a host or cookie (TENANT-01). */
export type RequestContext = {
  userId: string;
  tenantId: string;
  role: TenantRole;
  requestId: string;
  events: DomainEventRecord[];
};

/** Hono environment shared by every route and middleware in the API. */
export type AppEnv = {
  Variables: {
    ctx: RequestContext;
    requestId: string;
    logger: Logger;
  };
};
