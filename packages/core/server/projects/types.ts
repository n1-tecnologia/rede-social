/**
 * The Supabase project provider seam (09.2-12, D-541, D-540). The bootstrap (plan 13), the panel API (plan
 * 14), the health job and the move tool (plan 22) are written against `ProjectProvider` and never against
 * HTTP: the real adapter (`management-api.ts`) reaches the Supabase Management API, the fake (`fake.ts`)
 * answers from memory. This file knows no database, no env and no network; it holds the shapes only.
 */

/** Project status enum of the Management API document (read 2026-10-22). */
export type ProjectStatus =
  | 'INACTIVE'
  | 'ACTIVE_HEALTHY'
  | 'ACTIVE_UNHEALTHY'
  | 'COMING_UP'
  | 'UNKNOWN'
  | 'GOING_DOWN'
  | 'INIT_FAILED'
  | 'REMOVED'
  | 'RESTORING'
  | 'UPGRADING'
  | 'PAUSING'
  | 'RESTORE_FAILED'
  | 'RESTARTING'
  | 'PAUSE_FAILED'
  | 'RESIZING';

/** A per-service state of the health endpoint. */
export type ServiceStatus = 'ACTIVE_HEALTHY' | 'COMING_UP' | 'UNHEALTHY';

export type ProjectProviderErrorKind =
  | 'not_found'
  | 'forbidden'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid'
  | 'timeout'
  | 'conflict'
  | 'not_ready';

/**
 * The ONLY error shape a provider raises. The message carries the kind and the HTTP status (0 when no
 * answer was received) and nothing else: never a response body, a header, a key, a host or SQL (T-09.2-57).
 * `code` is a machine-readable refinement that is NOT part of the message. `org_mismatch`: the project belongs
 * to another organisation than the one the provider is pinned to. `token_invalid` and `token_forbidden`
 * (09.4-05, D-573): the refinement of a 401 and a 403, raised ONLY by a customer-token provider, which marks
 * every error it raises with `customerToken` so a caller can tell whose token failed. The kind stays
 * `forbidden` for 401 and 403 either way, so every consumer that tests `kind` is unchanged, and a platform
 * provider's errors carry no token code and `customerToken === false`.
 */
export class ProjectProviderError extends Error {
  readonly kind: ProjectProviderErrorKind;
  readonly status: number;
  readonly code: 'org_mismatch' | 'token_invalid' | 'token_forbidden' | undefined;
  readonly customerToken: boolean;

  constructor(
    kind: ProjectProviderErrorKind,
    status = 0,
    code?: 'org_mismatch' | 'token_invalid' | 'token_forbidden',
    customerToken = false,
  ) {
    super(`${kind} ${status}`);
    this.name = 'ProjectProviderError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.customerToken = customerToken;
  }
}

export type ProjectDescription = {
  ref: string;
  name: string;
  status: ProjectStatus;
  orgSlug: string;
};

export type ProjectHealth = {
  /** Keyed by service name (`auth`, `db`, `db_postgres_user`, `pooler`, `realtime`, `rest`, `storage`). */
  services: Record<string, ServiceStatus>;
};

export type ApiKeyKind = 'publishable' | 'secret' | 'legacy_anon' | 'legacy_service_role';

export type ApiKey = {
  id: string;
  kind: ApiKeyKind;
  name: string;
  /** The revealed value. Absent when the token cannot reveal secrets. NEVER logged, never in an error. */
  value?: string;
  /** ISO timestamp of creation; drives the picking rule (newest first). */
  insertedAt: string;
  disabled: boolean;
  /** Set by the fake provider only, so a fake key can never be mistaken for a real one. */
  fake?: true;
};

export type PoolerConfig = {
  host: string;
  /** Supavisor transaction mode (6543). */
  txPort: number;
  /** Supavisor session mode (5432): the DDL and runner connection. */
  sessionPort: number;
  dbName: string;
  /** The connection user of a role: `<role>.<ref>` on the Supabase pooler. */
  userFor(role: string): string;
};

export type SigningKeyStatus = 'in_use' | 'previously_used' | 'revoked' | 'standby';

export type SigningKey = {
  id: string;
  algorithm: string;
  status: SigningKeyStatus;
};

export type MigrationEntry = { version: string; name?: string };

export type BucketEntry = { id: string; name: string; public: boolean };

/** A configuration object of the Management API: sent and read as is, never interpreted here. */
export type ConfigBody = Record<string, unknown>;

export type EnsuredKeys = { publishable: ApiKey; service: ApiKey };

export type WaitOptions = { maxMs?: number };

/**
 * Everything the platform does to a tenant's Supabase project through the Management API (the INTEGRATE
 * rows of COVERAGE.md) and nothing else: there is deliberately no method that creates, deletes, pauses,
 * restores or resizes a project, or touches billing (prohibition PR-9).
 */
export interface ProjectProvider {
  readonly name: 'fake' | 'supabase';
  describe(ref: string): Promise<ProjectDescription>;
  health(ref: string): Promise<ProjectHealth>;
  /** Resolves only when the project is `ACTIVE_HEALTHY` with every service healthy; see `wait.ts`. */
  waitUntilHealthy(ref: string, options?: WaitOptions): Promise<void>;
  listApiKeys(ref: string): Promise<ApiKey[]>;
  /** Returns the newest usable publishable and service keys, creating a missing one (P40, P41). */
  ensureKeys(ref: string): Promise<EnsuredKeys>;
  poolerConfig(ref: string): Promise<PoolerConfig>;
  setDatabasePassword(ref: string, password: string): Promise<void>;
  listMigrations(ref: string): Promise<MigrationEntry[]>;
  listBuckets(ref: string): Promise<BucketEntry[]>;
  /** Best effort (Beta endpoint): `null` on any failure or unexpected answer. Never an authority. */
  readOnlyQuery(ref: string, query: string): Promise<unknown[] | null>;
  getAuthConfig(ref: string): Promise<ConfigBody>;
  patchAuthConfig(ref: string, body: ConfigBody): Promise<void>;
  signingKeys(ref: string): Promise<SigningKey[]>;
  createSigningKey(ref: string, algorithm?: string): Promise<SigningKey>;
  patchSigningKey(ref: string, id: string, status: 'in_use' | 'standby'): Promise<void>;
  getPostgrestConfig(ref: string): Promise<ConfigBody>;
  patchPostgrest(ref: string, body: ConfigBody): Promise<void>;
  getStorageConfig(ref: string): Promise<ConfigBody>;
  patchStorage(ref: string, body: ConfigBody): Promise<void>;
  getRealtimeConfig(ref: string): Promise<ConfigBody>;
  patchRealtime(ref: string, body: ConfigBody): Promise<void>;
}
