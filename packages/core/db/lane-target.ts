/**
 * Which project an admin-lane transaction opens on (09.2-04, D-538). Explicit data, never ambient context.
 *
 *  - `{ tenantId }` resolves the project REGISTERED for that tenant (the tenant-scoped work of a request,
 *    a saga step that touches one tenant's database);
 *  - `{ projectId }` addresses a project directly, for project-wide work such as a per-project job or the
 *    daily dispatcher, where no single tenant is in scope.
 *
 * The control plane (the central registry, the host mirror) is not addressed by a target: it has its own
 * lane, `withPlatformTx`.
 */
export type LaneTarget = { tenantId: string } | { projectId: string };
