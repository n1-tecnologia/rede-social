import postgres from 'postgres';
import type { BootstrapStep } from './reasons';
import {
  type ApiKey,
  type BucketEntry,
  type ConfigBody,
  type MigrationEntry,
  type PoolerConfig,
  type ProjectDescription,
  type ProjectHealth,
  type ProjectProvider,
  ProjectProviderError,
  type ProjectStatus,
  type ServiceStatus,
  type SigningKey,
} from './types';
import { REQUIRED_SERVICES, waitUntilHealthy } from './wait';

/**
 * `PROJECT_PROVIDER=fake` (09.2-12, D-540, DBT-37): the project provider for local runs, CI and tests. It
 * needs no network, maps a registry ref to a local target (the local stack or the second database), and
 * exposes the seams a bootstrap test needs: the first K polls answer `COMING_UP`, every PATCH body is
 * recorded verbatim, and `failAt` makes a chosen step fail once or always so the bootstrap's resume is
 * testable. Its keys are deterministic and flagged `fake`. `assertProductionEnv` and the singleton in
 * `index.ts` make it impossible to select in production (T-09.2-59).
 *
 * All state (poll counters, configurations, recorded calls, failure switches) lives in the instance, so two
 * providers in one process share nothing and calls for different refs never disturb each other's counters
 * (P74).
 */

export type FakeTarget = {
  /** The Supabase API origin of the target, e.g. `http://127.0.0.1:54321`. */
  apiUrl: string;
  /** A superuser connection string, when the target has a database the read-only query can reach. */
  databaseUrl?: string;
  host: string;
  /** The session-mode port. */
  port: number;
  /** The transaction-mode port; defaults to `port` (the local stack has no separate pooler). */
  txPort?: number;
  dbName: string;
  migrations?: MigrationEntry[];
  buckets?: BucketEntry[];
};

export type FakeFailAt = { step: BootstrapStep; times: 1 | 'always' };

export type FakePatch = {
  target: 'auth' | 'postgrest' | 'storage' | 'realtime' | 'signing_key';
  body: ConfigBody;
};

export type FakeCalls = {
  /** Every body written, per ref and in order, as it was received. */
  patches: Record<string, FakePatch[]>;
  /** Every database password set (the fake keeps it so a test can compare it with the registry). */
  passwords: Array<{ ref: string; password: string }>;
  describes: Record<string, number>;
  ensureKeys: Record<string, number>;
  /** Every failpoint step crossed, in order (armed or not). */
  failpoints: BootstrapStep[];
};

export interface FakeProjectProvider extends ProjectProvider {
  readonly name: 'fake';
  readonly calls: FakeCalls;
  /**
   * Called by the bootstrap at a step that is NOT a provider call (roles, schema, tenant, invite) so the
   * fake can fail it too: throws `ProjectProviderError('unavailable', 500)` when armed for the step.
   */
  failpoint(step: BootstrapStep): void;
  /** Arms (or re-arms) a failure at runtime. */
  arm(failAt: FakeFailAt): void;
  /** The target a ref maps to, for a test that needs its URLs. */
  targetOf(ref: string): FakeTarget | undefined;
  /**
   * 09.2-14 (D-541): makes the key reveal answer `forbidden 403` (a platform token that cannot read the
   * project's secrets), so the manual-access path of the pre-check and of the create call is testable.
   */
  forbidReveal(on: boolean): void;
}

export type FakeProjectProviderOptions = {
  targets?: Record<string, FakeTarget>;
  /** The number of `describe` polls of a ref that answer `COMING_UP` before it is healthy. */
  comingUpPolls?: number;
  failAt?: FakeFailAt | FakeFailAt[];
  /** Start with the key reveal answering `forbidden 403` (see `forbidReveal`). */
  revealForbidden?: boolean;
  orgSlug?: string;
  /** Only used to name generated signing keys; default is a fixed-seed sequence, so runs are repeatable. */
  random?: () => number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** The looser local form of a ref (the registry's `^[a-z][a-z0-9-]{2,39}$`). */
const FAKE_REF = /^[a-z][a-z0-9-]{2,39}$/;
const MIN_PASSWORD_LENGTH = 12;

const DEFAULTS: Record<FakePatch['target'], ConfigBody> = {
  auth: { site_url: 'http://localhost:3000', uri_allow_list: '' },
  postgrest: { db_schema: 'public', db_extra_search_path: 'public,extensions', max_rows: 1000 },
  storage: { fileSizeLimit: 52_428_800 },
  realtime: { private_only: false },
  signing_key: {},
};

function seededRandom(): () => number {
  let state = 1;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

export function createFakeProjectProvider(
  options: FakeProjectProviderOptions = {},
): FakeProjectProvider {
  const targets = new Map(Object.entries(options.targets ?? {}));
  const comingUpPolls = options.comingUpPolls ?? 0;
  const orgSlug = options.orgSlug ?? 'fake-org';
  const random = options.random ?? seededRandom();
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? (async () => undefined);

  let revealForbidden = options.revealForbidden ?? false;

  const polls = new Map<string, number>();
  const configs = new Map<string, ConfigBody>();
  const signing = new Map<string, SigningKey[]>();
  const armed = new Map<BootstrapStep, { remaining: number | 'always' }>();
  const calls: FakeCalls = {
    patches: {},
    passwords: [],
    describes: {},
    ensureKeys: {},
    failpoints: [],
  };

  function arm(failAt: FakeFailAt): void {
    armed.set(failAt.step, { remaining: failAt.times });
  }
  for (const entry of Array.isArray(options.failAt)
    ? options.failAt
    : options.failAt
      ? [options.failAt]
      : []) {
    arm(entry);
  }

  function trip(step: BootstrapStep): void {
    const switchFor = armed.get(step);
    if (!switchFor) return;
    if (switchFor.remaining === 'always') throw new ProjectProviderError('unavailable', 500);
    if (switchFor.remaining > 0) {
      switchFor.remaining -= 1;
      throw new ProjectProviderError('unavailable', 500);
    }
  }

  /** Validates the ref, finds its target (`not_found` otherwise) and crosses the step's failure switch. */
  function enter(ref: string, step: BootstrapStep | null): FakeTarget {
    if (typeof ref !== 'string' || !FAKE_REF.test(ref))
      throw new ProjectProviderError('invalid', 0);
    const target = targets.get(ref);
    if (!target) throw new ProjectProviderError('not_found', 404);
    if (step !== null) trip(step);
    return target;
  }

  const patchesOf = (ref: string): FakePatch[] => {
    const list = calls.patches[ref] ?? [];
    calls.patches[ref] = list;
    return list;
  };

  const bump = (counter: Record<string, number>, ref: string): number => {
    counter[ref] = (counter[ref] ?? 0) + 1;
    return counter[ref] as number;
  };

  function statusOf(ref: string, pollsSoFar: number): ProjectStatus {
    if (ref.includes('paused')) return 'INACTIVE';
    return pollsSoFar <= comingUpPolls ? 'COMING_UP' : 'ACTIVE_HEALTHY';
  }

  async function describe(ref: string): Promise<ProjectDescription> {
    enter(ref, 'verify');
    const n = (polls.get(ref) ?? 0) + 1;
    polls.set(ref, n);
    bump(calls.describes, ref);
    return { ref, name: ref, status: statusOf(ref, n), orgSlug };
  }

  async function health(ref: string): Promise<ProjectHealth> {
    enter(ref, null);
    const status = statusOf(ref, Math.max(polls.get(ref) ?? 0, 1));
    const services: Record<string, ServiceStatus> = {};
    for (const name of REQUIRED_SERVICES) {
      services[name] =
        status === 'ACTIVE_HEALTHY'
          ? 'ACTIVE_HEALTHY'
          : status === 'COMING_UP'
            ? name === 'db'
              ? 'ACTIVE_HEALTHY'
              : 'COMING_UP'
            : 'UNHEALTHY';
    }
    return { services };
  }

  const keysOf = (ref: string): { publishable: ApiKey; service: ApiKey } => ({
    publishable: {
      id: `fake-pub-${ref}`,
      kind: 'publishable',
      name: 'fake_publishable',
      value: `fake_publishable_${ref}`,
      insertedAt: '2026-01-01T00:00:00Z',
      disabled: false,
      fake: true,
    },
    service: {
      id: `fake-sec-${ref}`,
      kind: 'secret',
      name: 'fake_secret',
      value: `fake_secret_${ref}`,
      insertedAt: '2026-01-01T00:00:00Z',
      disabled: false,
      fake: true,
    },
  });

  function readConfig(ref: string, target: FakePatch['target'], step: BootstrapStep): ConfigBody {
    enter(ref, step);
    return structuredClone({ ...DEFAULTS[target], ...configs.get(`${ref}:${target}`) });
  }

  function writeConfig(
    ref: string,
    target: FakePatch['target'],
    step: BootstrapStep,
    body: ConfigBody,
  ): void {
    enter(ref, step);
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length === 0
    ) {
      throw new ProjectProviderError('invalid', 0);
    }
    const recorded = structuredClone(body);
    patchesOf(ref).push({ target, body: recorded });
    configs.set(`${ref}:${target}`, {
      ...configs.get(`${ref}:${target}`),
      ...structuredClone(body),
    });
  }

  return {
    name: 'fake',
    calls,
    failpoint(step) {
      calls.failpoints.push(step);
      trip(step);
    },
    arm,
    targetOf: (ref) => targets.get(ref),
    forbidReveal(on) {
      revealForbidden = on;
    },
    describe,
    health,
    waitUntilHealthy: (ref, waitOptions) =>
      waitUntilHealthy({ describe, health, now, sleep }, ref, waitOptions),
    async listApiKeys(ref) {
      enter(ref, 'verify');
      if (revealForbidden) throw new ProjectProviderError('forbidden', 403);
      const { publishable, service } = keysOf(ref);
      return [publishable, service];
    },
    async ensureKeys(ref) {
      enter(ref, 'verify');
      if (revealForbidden) throw new ProjectProviderError('forbidden', 403);
      bump(calls.ensureKeys, ref);
      return keysOf(ref);
    },
    async poolerConfig(ref): Promise<PoolerConfig> {
      const target = enter(ref, 'verify');
      return {
        host: target.host,
        txPort: target.txPort ?? target.port,
        sessionPort: target.port,
        dbName: target.dbName,
        // Locally the roles carry no `.ref` suffix: there is no Supavisor tenant routing.
        userFor: (role) => role,
      };
    },
    async setDatabasePassword(ref, password) {
      enter(ref, 'verify');
      if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        throw new ProjectProviderError('invalid', 0);
      }
      calls.passwords.push({ ref, password });
    },
    async listMigrations(ref) {
      return structuredClone(enter(ref, 'verify').migrations ?? []);
    },
    async listBuckets(ref) {
      return structuredClone(enter(ref, 'buckets').buckets ?? []);
    },
    async readOnlyQuery(ref, query) {
      if (typeof ref !== 'string' || !FAKE_REF.test(ref))
        throw new ProjectProviderError('invalid', 0);
      let target: FakeTarget;
      try {
        target = enter(ref, 'verify');
      } catch {
        return null;
      }
      if (!target.databaseUrl) return null;
      const sql = postgres(target.databaseUrl, {
        max: 1,
        prepare: false,
        connect_timeout: 5,
        idle_timeout: 1,
        onnotice: () => undefined,
      });
      try {
        const rows = await sql.begin('read only', (tx) => tx.unsafe(query));
        return Array.from(rows);
      } catch {
        return null;
      } finally {
        await sql.end({ timeout: 1 });
      }
    },
    async getAuthConfig(ref) {
      return readConfig(ref, 'auth', 'auth');
    },
    async patchAuthConfig(ref, body) {
      writeConfig(ref, 'auth', 'auth', body);
    },
    async signingKeys(ref) {
      enter(ref, 'auth');
      return structuredClone(signing.get(ref) ?? []);
    },
    async createSigningKey(ref, algorithm = 'ES256') {
      enter(ref, 'auth');
      const key: SigningKey = {
        id: `fake-sk-${Math.floor(random() * 0xffffffff).toString(16)}`,
        algorithm,
        status: 'standby',
      };
      signing.set(ref, [...(signing.get(ref) ?? []), key]);
      return { ...key };
    },
    async patchSigningKey(ref, id, status) {
      enter(ref, 'auth');
      const keys = signing.get(ref) ?? [];
      if (!keys.some((key) => key.id === id)) throw new ProjectProviderError('not_found', 404);
      signing.set(
        ref,
        keys.map((key) => {
          if (key.id === id) return { ...key, status };
          return status === 'in_use' && key.status === 'in_use'
            ? { ...key, status: 'previously_used' as const }
            : key;
        }),
      );
      patchesOf(ref).push({ target: 'signing_key', body: { id, status } });
    },
    async getPostgrestConfig(ref) {
      return readConfig(ref, 'postgrest', 'schema');
    },
    async patchPostgrest(ref, body) {
      writeConfig(ref, 'postgrest', 'schema', body);
    },
    async getStorageConfig(ref) {
      return readConfig(ref, 'storage', 'buckets');
    },
    async patchStorage(ref, body) {
      writeConfig(ref, 'storage', 'buckets', body);
    },
    async getRealtimeConfig(ref) {
      return readConfig(ref, 'realtime', 'realtime');
    },
    async patchRealtime(ref, body) {
      writeConfig(ref, 'realtime', 'realtime', body);
    },
  };
}
