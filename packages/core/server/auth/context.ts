import type { DomainEventRecord, TenantRole } from '@tria/contracts';
import type { Logger } from 'pino';

// `DomainEventRecord` now lives in `@tria/contracts` (01-07) next to the `EventMap` modules augment.
export type { DomainEventRecord };

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
