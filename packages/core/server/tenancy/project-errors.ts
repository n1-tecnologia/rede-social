/**
 * The two refusals of the routing seam (09.2-03, D-538, D-537). Dependency-free on purpose: the HTTP error
 * mapper (`http/api-error.ts`) and the lower layers (`db/project-pools.ts`, `tenancy/project-registry.ts`)
 * all need to recognise them, and none of those may import another's database code just to do so.
 *
 * Both messages are constant and name nothing: no project ref, no tenant id, no URL.
 */

/** The tenant has no `platform.tenant_projects` row. Fails closed: no code path falls back to a default (PR-3). */
export class ProjectUnboundError extends Error {
  constructor() {
    super('tenant project unbound');
    this.name = 'ProjectUnboundError';
  }
}

/**
 * The project cannot be reached right now: its breaker is open, its connection failed, its credentials did
 * not open, or the registry could not be read and no last-good binding is young enough to serve.
 */
export class ProjectUnavailableError extends Error {
  constructor() {
    super('tenant project unavailable');
    this.name = 'ProjectUnavailableError';
  }
}
