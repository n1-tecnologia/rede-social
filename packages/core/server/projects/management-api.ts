import { z } from 'zod';
import { createLimiter, defaultProcessLimiter, type Limiter } from './limiter';
import {
  type ApiKey,
  type ApiKeyKind,
  type BucketEntry,
  type ConfigBody,
  type EnsuredKeys,
  type MigrationEntry,
  type PoolerConfig,
  type ProjectDescription,
  type ProjectHealth,
  type ProjectProvider,
  ProjectProviderError,
  type ProjectProviderErrorKind,
  type ProjectStatus,
  type ServiceStatus,
  type SigningKey,
  type SigningKeyStatus,
} from './types';
import { REQUIRED_SERVICES, waitUntilHealthy } from './wait';

/**
 * The real project provider: the Supabase Management API (`https://api.supabase.com/v1`) behind the
 * `ProjectProvider` seam (09.2-12, D-541, DBT-20). It reaches ONLY the operations marked INTEGRATE in
 * COVERAGE.md (a test reads that table and fails on any other path) and has no method that creates, deletes,
 * pauses, restores, resizes or bills a project (prohibition PR-9).
 *
 * Shape of the guarantees, all proven against a local stub server and an injected clock:
 *  - a ref that is not 20 lower-case letters never produces a request; the base URL is fixed (a cleartext one
 *    is refused unless it is loopback) and a redirect is an error, so the bearer token only ever goes where
 *    it was configured to go (T-09.2-55);
 *  - every answer is parsed with a loose zod schema; every failure is a `ProjectProviderError` whose message
 *    is the kind and the HTTP status only (T-09.2-57);
 *  - one limiter holds the process to 100 requests per rolling minute; a 429 is retried after the reset the
 *    server announced and pauses every other call for the same window (T-09.2-58);
 *  - the organisation is pinned: a project of any other organisation is refused as `forbidden`, for the
 *    reads of secrets and for every write, not only for `describe` (T-09.2-56).
 */

const DEFAULT_BASE_URL = 'https://api.supabase.com';
const REF_PATTERN = /^[a-z]{20}$/;
const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const HOST_PATTERN = /^[A-Za-z0-9.-]{1,253}$/;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 5;
const MIN_RESET_WAIT_MS = 1_000;
const MAX_JITTER_MS = 250;
const PIN_CACHE_MAX = 256;
const MIN_PASSWORD_LENGTH = 12;

/** Supavisor ports (Supabase docs): transaction mode and session mode. Constant by contract, not read. */
const POOLER_TX_PORT = 6543;
const POOLER_SESSION_PORT = 5432;

const KNOWN_STATUSES: ReadonlySet<string> = new Set<ProjectStatus>([
  'INACTIVE',
  'ACTIVE_HEALTHY',
  'ACTIVE_UNHEALTHY',
  'COMING_UP',
  'UNKNOWN',
  'GOING_DOWN',
  'INIT_FAILED',
  'REMOVED',
  'RESTORING',
  'UPGRADING',
  'PAUSING',
  'RESTORE_FAILED',
  'RESTARTING',
  'PAUSE_FAILED',
  'RESIZING',
]);

const SIGNING_ALGORITHMS: ReadonlySet<string> = new Set(['EdDSA', 'ES256', 'RS256', 'HS256']);

const projectSchema = z
  .object({
    ref: z.string().nullish(),
    id: z.string().nullish(),
    name: z.string(),
    status: z.string(),
    organization_slug: z.string(),
  })
  .loose();

const healthSchema = z.array(z.object({ name: z.string(), status: z.string() }).loose());

const apiKeyItemSchema = z
  .object({
    id: z.string().nullish(),
    name: z.string(),
    type: z.string().nullish(),
    api_key: z.string().nullish(),
    inserted_at: z.string().nullish(),
    disabled: z.boolean().nullish(),
  })
  .loose();
type ApiKeyItem = z.infer<typeof apiKeyItemSchema>;
const apiKeyListSchema = z.array(apiKeyItemSchema);

const poolerSchema = z.array(
  z
    .object({
      db_host: z.string(),
      db_name: z.string(),
      database_type: z.string().nullish(),
    })
    .loose(),
);

const migrationsSchema = z.array(
  z.object({ version: z.string(), name: z.string().nullish() }).loose(),
);

const bucketsSchema = z.array(
  z.object({ id: z.string(), name: z.string(), public: z.boolean() }).loose(),
);

const signingKeyItemSchema = z
  .object({ id: z.string(), algorithm: z.string(), status: z.string() })
  .loose();
const signingKeyListSchema = z.union([
  z.array(signingKeyItemSchema),
  z.object({ keys: z.array(signingKeyItemSchema) }).loose(),
]);

const configSchema = z.object({}).loose();

type HttpMethod = 'GET' | 'POST' | 'PATCH';

type CallOptions<T> = {
  params: { ref: string; id?: string };
  query?: Record<string, string>;
  body?: unknown;
  /** Parse the answer with this schema. Omitted: the body is ignored (a PATCH answers 200 or 204). */
  schema?: z.ZodType<T>;
  /** A 2xx with no body is a valid answer (the Beta read-only query). */
  allowEmpty?: boolean;
};

export type SupabaseProjectProviderOptions = {
  /** The platform personal access token. Never logged, never part of a message. */
  pat: string;
  /** The organisation the platform is pinned to (`SUPABASE_ORG_SLUG`). */
  orgSlug: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Share one limiter across providers; default: the process-wide limiter (or one built on `now`/`sleep`). */
  limiter?: Limiter;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds added after the 429 reset, in [0, 250]. Injected so a test is deterministic. */
  jitter?: () => number;
};

/**
 * `X-RateLimit-Reset` is seconds to the reset. Rounded UP to whole seconds then converted to milliseconds
 * (P42), so a retry is never early; a missing, non-numeric, zero or negative header is the one-second minimum.
 */
export function resetDelayMs(header: string | null): number {
  if (header === null || header.trim() === '') return MIN_RESET_WAIT_MS;
  const seconds = Number(header);
  if (!Number.isFinite(seconds)) return MIN_RESET_WAIT_MS;
  return Math.max(MIN_RESET_WAIT_MS, Math.ceil(seconds) * 1000);
}

function kindOfStatus(status: number): ProjectProviderErrorKind {
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'unavailable';
  return 'invalid';
}

function assertBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError('project provider: baseUrl is not a URL');
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('project provider: baseUrl must be https (http only on loopback)');
  }
  return baseUrl.replace(/\/+$/, '');
}

function assertRef(ref: string): void {
  if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) {
    throw new ProjectProviderError('invalid', 0);
  }
}

function assertBody(body: ConfigBody): void {
  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).length === 0
  ) {
    throw new ProjectProviderError('invalid', 0);
  }
}

function toStatus(raw: string): ProjectStatus {
  return KNOWN_STATUSES.has(raw) ? (raw as ProjectStatus) : 'UNKNOWN';
}

function toServiceStatus(raw: string): ServiceStatus {
  return raw === 'ACTIVE_HEALTHY' || raw === 'COMING_UP' ? raw : 'UNHEALTHY';
}

function toApiKey(item: ApiKeyItem): ApiKey | null {
  let kind: ApiKeyKind | null = null;
  if (item.type === 'publishable') kind = 'publishable';
  else if (item.type === 'secret') kind = 'secret';
  else if (item.name === 'anon') kind = 'legacy_anon';
  else if (item.name === 'service_role') kind = 'legacy_service_role';
  if (kind === null) return null;
  const key: ApiKey = {
    id: item.id ?? item.name,
    kind,
    name: item.name,
    insertedAt: item.inserted_at ?? '',
    disabled: item.disabled === true,
  };
  if (item.api_key) key.value = item.api_key;
  return key;
}

const insertedMs = (key: ApiKey): number => {
  const ms = Date.parse(key.insertedAt);
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * P41: of several keys of one kind, the newest non-disabled by `insertedAt`, then by `id`, never by the
 * order the API listed them. Kinds are tried in the order given (the new-style key first).
 */
export function pickKey(keys: readonly ApiKey[], kinds: readonly ApiKeyKind[]): ApiKey | undefined {
  for (const kind of kinds) {
    const candidates = keys
      .filter((key) => key.kind === kind && !key.disabled)
      .sort((a, b) => insertedMs(b) - insertedMs(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    if (candidates[0]) return candidates[0];
  }
  return undefined;
}

export function createSupabaseProjectProvider(
  options: SupabaseProjectProviderOptions,
): ProjectProvider {
  if (!options.pat) throw new TypeError('project provider: pat is required');
  if (!options.orgSlug) throw new TypeError('project provider: orgSlug is required');
  const pat = options.pat;
  const orgSlug = options.orgSlug;
  const baseUrl = assertBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const fetchImpl = options.fetchImpl ?? fetch;
  const limiter =
    options.limiter ??
    (options.now || options.sleep
      ? createLimiter({ now: options.now, sleep: options.sleep })
      : defaultProcessLimiter());
  const jitter = options.jitter ?? (() => Math.floor(Math.random() * (MAX_JITTER_MS + 1)));

  /** Refs already confirmed to belong to the pinned organisation by this instance. */
  const pinned = new Set<string>();

  async function discard(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch {
      // The body is never read on a failure; a cancel that fails changes nothing.
    }
  }

  /**
   * The ONE place a request is built. `template` is a path of COVERAGE.md with `{ref}` / `{id}` placeholders;
   * the ref is validated BEFORE any URL exists and both values are encoded.
   */
  async function call<T = undefined>(
    method: HttpMethod,
    template: string,
    opts: CallOptions<T>,
  ): Promise<T> {
    assertRef(opts.params.ref);
    let path = template.replace('{ref}', encodeURIComponent(opts.params.ref));
    if (template.includes('{id}')) {
      const id = opts.params.id;
      if (id === undefined || !ID_PATTERN.test(id)) throw new ProjectProviderError('invalid', 0);
      path = path.replace('{id}', encodeURIComponent(id));
    }
    const query = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : '';
    const url = `${baseUrl}${path}${query}`;
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await limiter.run(() =>
          fetchImpl(url, {
            method,
            headers:
              payload === undefined
                ? { Authorization: `Bearer ${pat}` }
                : { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
            body: payload,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            redirect: 'error',
          }),
        );
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        throw new ProjectProviderError(
          name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unavailable',
          0,
        );
      }

      if (response.status === 429) {
        const reset = response.headers.get('X-RateLimit-Reset');
        await discard(response);
        if (attempt === MAX_ATTEMPTS) throw new ProjectProviderError('rate_limited', 429);
        // The jitter is added AFTER the rounding so a retry is never early (P42); the pause holds every
        // other caller for the same window instead of each one discovering the limit (P43).
        limiter.pause(limiter.now() + resetDelayMs(reset) + jitter());
        continue;
      }

      if (!response.ok) {
        await discard(response);
        throw new ProjectProviderError(kindOfStatus(response.status), response.status);
      }

      if (opts.schema === undefined) {
        await discard(response);
        return undefined as T;
      }
      let text: string;
      try {
        text = await response.text();
      } catch {
        throw new ProjectProviderError('unavailable', response.status);
      }
      if (text.trim() === '') {
        if (opts.allowEmpty) return undefined as T;
        throw new ProjectProviderError('unavailable', response.status);
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ProjectProviderError('unavailable', response.status);
      }
      const parsed = opts.schema.safeParse(json);
      if (!parsed.success) throw new ProjectProviderError('unavailable', response.status);
      return parsed.data;
    }
    throw new ProjectProviderError('rate_limited', 429);
  }

  async function describe(ref: string): Promise<ProjectDescription> {
    const project = await call('GET', '/v1/projects/{ref}', {
      params: { ref },
      schema: projectSchema,
    });
    if (project.organization_slug !== orgSlug) {
      throw new ProjectProviderError('forbidden', 403, 'org_mismatch');
    }
    if (pinned.size >= PIN_CACHE_MAX) pinned.clear();
    pinned.add(ref);
    return {
      ref: project.ref ?? project.id ?? ref,
      name: project.name,
      status: toStatus(project.status),
      orgSlug: project.organization_slug,
    };
  }

  /** Runs `fn` only for a project of the pinned organisation (one `describe` per ref per instance). */
  async function guarded<T>(ref: string, fn: () => Promise<T>): Promise<T> {
    assertRef(ref);
    if (!pinned.has(ref)) await describe(ref);
    return fn();
  }

  async function health(ref: string): Promise<ProjectHealth> {
    const list = await call('GET', '/v1/projects/{ref}/health', {
      params: { ref },
      query: { services: REQUIRED_SERVICES.join(',') },
      schema: healthSchema,
    });
    const services: Record<string, ServiceStatus> = {};
    for (const item of list) services[item.name] = toServiceStatus(item.status);
    return { services };
  }

  async function listKeys(ref: string): Promise<ApiKey[]> {
    const items = await call('GET', '/v1/projects/{ref}/api-keys', {
      params: { ref },
      query: { reveal: 'true' },
      schema: apiKeyListSchema,
    });
    return items.map(toApiKey).filter((key): key is ApiKey => key !== null);
  }

  async function createKey(ref: string, type: 'publishable' | 'secret'): Promise<ApiKey> {
    const item = await call('POST', '/v1/projects/{ref}/api-keys', {
      params: { ref },
      query: { reveal: 'true' },
      body: { type, name: `platform_${type}` },
      schema: apiKeyItemSchema,
    });
    const created = toApiKey(item);
    if (created === null) throw new ProjectProviderError('unavailable', 201);
    if (created.value !== undefined) return created;
    // The answer did not carry the value: read it back from the list.
    const again = (await listKeys(ref)).find((key) => key.id === created.id);
    return again ?? created;
  }

  async function ensureKeys(ref: string): Promise<EnsuredKeys> {
    return guarded(ref, async () => {
      const keys = await listKeys(ref);
      const publishable =
        pickKey(keys, ['publishable', 'legacy_anon']) ?? (await createKey(ref, 'publishable'));
      const service =
        pickKey(keys, ['secret', 'legacy_service_role']) ?? (await createKey(ref, 'secret'));
      return { publishable, service };
    });
  }

  async function poolerConfig(ref: string): Promise<PoolerConfig> {
    return guarded(ref, async () => {
      const entries = await call('GET', '/v1/projects/{ref}/config/database/pooler', {
        params: { ref },
        schema: poolerSchema,
      });
      // The host is read, never built from the region (Pitfall 3). The primary entry, not a replica.
      const primary =
        entries.find((entry) => entry.database_type === 'PRIMARY') ??
        entries.find((entry) => entry.database_type !== 'READ_REPLICA');
      if (!primary || !HOST_PATTERN.test(primary.db_host)) {
        throw new ProjectProviderError('unavailable', 200);
      }
      return {
        host: primary.db_host,
        txPort: POOLER_TX_PORT,
        sessionPort: POOLER_SESSION_PORT,
        dbName: primary.db_name,
        userFor: (role: string) => `${role}.${ref}`,
      };
    });
  }

  async function setDatabasePassword(ref: string, password: string): Promise<void> {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new ProjectProviderError('invalid', 0);
    }
    await guarded(ref, () =>
      call('PATCH', '/v1/projects/{ref}/database/password', {
        params: { ref },
        body: { password },
      }),
    );
  }

  async function listMigrations(ref: string): Promise<MigrationEntry[]> {
    return guarded(ref, async () => {
      const items = await call('GET', '/v1/projects/{ref}/database/migrations', {
        params: { ref },
        schema: migrationsSchema,
      });
      return items.map((item) =>
        item.name ? { version: item.version, name: item.name } : { version: item.version },
      );
    });
  }

  async function listBuckets(ref: string): Promise<BucketEntry[]> {
    return guarded(ref, async () => {
      const items = await call('GET', '/v1/projects/{ref}/storage/buckets', {
        params: { ref },
        schema: bucketsSchema,
      });
      return items.map((item) => ({ id: item.id, name: item.name, public: item.public }));
    });
  }

  async function readOnlyQuery(ref: string, query: string): Promise<unknown[] | null> {
    assertRef(ref);
    try {
      const rows = await guarded(ref, () =>
        call('POST', '/v1/projects/{ref}/database/query/read-only', {
          params: { ref },
          body: { query },
          schema: z.unknown(),
          allowEmpty: true,
        }),
      );
      return Array.isArray(rows) ? rows : null;
    } catch (error) {
      if (error instanceof ProjectProviderError) return null;
      throw error;
    }
  }

  async function readConfig(
    ref: string,
    template:
      | '/v1/projects/{ref}/config/auth'
      | '/v1/projects/{ref}/postgrest'
      | '/v1/projects/{ref}/config/storage'
      | '/v1/projects/{ref}/config/realtime',
  ): Promise<ConfigBody> {
    return guarded(ref, () => call('GET', template, { params: { ref }, schema: configSchema }));
  }

  async function writeConfig(
    ref: string,
    template:
      | '/v1/projects/{ref}/config/auth'
      | '/v1/projects/{ref}/postgrest'
      | '/v1/projects/{ref}/config/storage'
      | '/v1/projects/{ref}/config/realtime',
    body: ConfigBody,
  ): Promise<void> {
    assertBody(body);
    // One PATCH carries the whole body; an empty 204 (or any 2xx) is success.
    await guarded(ref, () => call('PATCH', template, { params: { ref }, body }));
  }

  const toSigningKey = (item: z.infer<typeof signingKeyItemSchema>): SigningKey => ({
    id: item.id,
    algorithm: item.algorithm,
    status: item.status as SigningKeyStatus,
  });

  return {
    name: 'supabase',
    describe,
    health,
    waitUntilHealthy: (ref, waitOptions) =>
      waitUntilHealthy(
        { describe, health, now: limiter.now, sleep: limiter.sleep },
        ref,
        waitOptions,
      ),
    listApiKeys: (ref) => guarded(ref, () => listKeys(ref)),
    ensureKeys,
    poolerConfig,
    setDatabasePassword,
    listMigrations,
    listBuckets,
    readOnlyQuery,
    getAuthConfig: (ref) => readConfig(ref, '/v1/projects/{ref}/config/auth'),
    patchAuthConfig: (ref, body) => writeConfig(ref, '/v1/projects/{ref}/config/auth', body),
    signingKeys: (ref) =>
      guarded(ref, async () => {
        const answer = await call('GET', '/v1/projects/{ref}/config/auth/signing-keys', {
          params: { ref },
          schema: signingKeyListSchema,
        });
        return (Array.isArray(answer) ? answer : answer.keys).map(toSigningKey);
      }),
    createSigningKey: (ref, algorithm = 'ES256') => {
      if (!SIGNING_ALGORITHMS.has(algorithm)) {
        return Promise.reject(new ProjectProviderError('invalid', 0));
      }
      return guarded(ref, async () =>
        toSigningKey(
          await call('POST', '/v1/projects/{ref}/config/auth/signing-keys', {
            params: { ref },
            body: { algorithm, status: 'standby' },
            schema: signingKeyItemSchema,
          }),
        ),
      );
    },
    patchSigningKey: (ref, id, status) =>
      guarded(ref, async () => {
        await call('PATCH', '/v1/projects/{ref}/config/auth/signing-keys/{id}', {
          params: { ref, id },
          body: { status },
        });
      }),
    getPostgrestConfig: async (ref) => {
      // The answer carries the project's JWT secret: it is dropped here and never leaves the adapter.
      const { jwt_secret: _dropped, ...config } = await readConfig(
        ref,
        '/v1/projects/{ref}/postgrest',
      );
      return config;
    },
    patchPostgrest: (ref, body) => writeConfig(ref, '/v1/projects/{ref}/postgrest', body),
    getStorageConfig: (ref) => readConfig(ref, '/v1/projects/{ref}/config/storage'),
    patchStorage: (ref, body) => writeConfig(ref, '/v1/projects/{ref}/config/storage', body),
    getRealtimeConfig: (ref) => readConfig(ref, '/v1/projects/{ref}/config/realtime'),
    patchRealtime: (ref, body) => writeConfig(ref, '/v1/projects/{ref}/config/realtime', body),
  };
}
