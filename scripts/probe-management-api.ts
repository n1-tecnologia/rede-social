/**
 * Read-only probe of the Supabase Management API for ONE project (Phase 09.2-12, D-541, hosted proof H1/S2).
 *
 *   pnpm platform:probe --ref <ref>                    # the real provider (SUPABASE_PAT, SUPABASE_ORG_SLUG)
 *   pnpm platform:probe --ref <ref> --exercise-keys    # also tries the revealed service keys, read requests only
 *   pnpm platform:probe --fake                         # a fake provider with a built-in target, no network
 *
 * Igor runs it once against the EMPTY Pro project (plan 25). Its output decides two open questions before
 * the first real bootstrap: whether the token can reveal secrets (`recommendation`: `automatic` or
 * `manualAccess`, D-541) and which key kind the registry should store as the service key (`--exercise-keys`,
 * Open Question 3). It only reads: describe, health, keys, pooler, migrations, buckets, signing keys and the
 * Beta read-only query; with `--exercise-keys`, three GET requests per key kind. It changes nothing.
 *
 * Output is ONE JSON object of shapes and booleans (statuses, key kinds present, counts, the pooler host
 * SHAPE, algorithms). It never prints a key, a password, a PAT, a host with credentials or a connection
 * string (T-09.2-60); `probe-management-api.test.ts` scans the output for secret-shaped strings.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFakeProjectProvider } from '@rede-social/core/server/projects/fake';
import { createSupabaseProjectProvider } from '@rede-social/core/server/projects/management-api';
import {
  type ApiKey,
  type ProjectProvider,
  ProjectProviderError,
} from '@rede-social/core/server/projects/types';

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

async function settle<T>(work: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    // Kind and status only: a ProjectProviderError message carries nothing else.
    return { ok: false, error: error instanceof ProjectProviderError ? error.message : 'error' };
  }
}

export type ProbeArgs = { ref: string | null; fake: boolean; exerciseKeys: boolean };

export function parseArgs(argv: string[]): ProbeArgs {
  const args: ProbeArgs = { ref: null, fake: false, exerciseKeys: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fake') args.fake = true;
    else if (arg === '--exercise-keys') args.exerciseKeys = true;
    else if (arg === '--ref') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--ref needs a value');
      args.ref = value;
      i += 1;
    } else throw new Error(`unknown argument ${JSON.stringify(arg)}`);
  }
  if (args.fake === (args.ref !== null)) {
    throw new Error('give exactly one of --ref <ref> or --fake');
  }
  return args;
}

/** The shape of a pooler host, never the host itself. */
export function hostShape(host: string): string {
  if (/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) {
    return 'aws-<n>-<region>.pooler.supabase.com';
  }
  if (host === '127.0.0.1' || host === 'localhost') return 'local';
  return 'other';
}

type KeyCheck = { auth: 'pass' | 'fail'; storage: 'pass' | 'fail'; realtime: 'pass' | 'fail' };

export type ProbeReport = {
  mode: 'real' | 'fake';
  project: { status: string; organisationMatches: boolean | 'unknown'; error?: string };
  health: { services: Record<string, string> } | { error: string };
  keys:
    | {
        kinds: string[];
        count: number;
        secretReveal: 'revealed' | 'masked' | 'forbidden' | 'error';
        error?: string;
      }
    | { error: string; secretReveal: 'forbidden' | 'error' };
  pooler:
    | { hostShape: string; txPort: number; sessionPort: number; dbNameIsPostgres: boolean }
    | { error: string };
  migrations: { count: number } | { error: string };
  buckets: { count: number } | { error: string };
  signingKeys: { algorithms: string[]; inUse: boolean } | { error: string };
  readOnlyQuery: { answered: boolean };
  exerciseKeys?: {
    secret: KeyCheck | 'absent';
    legacy_service_role: KeyCheck | 'absent';
    serviceKeyKind: 'secret' | 'legacy_service_role' | 'undecided';
  };
  recommendation: 'automatic' | 'manualAccess';
};

export type ProbeDeps = {
  /** Replaces the provider the arguments would build (tests). */
  provider?: ProjectProvider;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  /** The Supabase API origin of the project, for `--exercise-keys`. */
  apiUrlFor?: (ref: string) => string;
};

const FAKE_REF = 'fake-probe';
const EXERCISE_TIMEOUT_MS = 10_000;

function requireVar(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required for --ref`);
  return value;
}

/** Tries ONE service key with three read-style requests. The key value stays inside this function. */
async function exerciseKey(
  apiUrl: string,
  key: ApiKey,
  fetchImpl: typeof fetch,
): Promise<KeyCheck> {
  const headers: Record<string, string> = { apikey: key.value ?? '' };
  // The legacy service_role key is a JWT and is also accepted as a bearer; a secret key is `apikey` only.
  if (key.kind === 'legacy_service_role') headers.Authorization = `Bearer ${key.value ?? ''}`;
  const get = async (
    path: string,
    accept: (status: number) => boolean,
  ): Promise<'pass' | 'fail'> => {
    try {
      const response = await fetchImpl(`${apiUrl}${path}`, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(EXERCISE_TIMEOUT_MS),
      });
      await response.body?.cancel();
      return accept(response.status) ? 'pass' : 'fail';
    } catch {
      return 'fail';
    }
  };
  return {
    auth: await get('/auth/v1/admin/users?per_page=1', (s) => s >= 200 && s < 300),
    storage: await get('/storage/v1/bucket', (s) => s >= 200 && s < 300),
    // Realtime exposes no read-only REST route to list anything; "pass" means the gateway accepted the key
    // (any answer that is not an authentication failure or a server error).
    realtime: await get('/realtime/v1/api/ping', (s) => s !== 401 && s !== 403 && s < 500),
  };
}

export async function runProbe(argv: string[], deps: ProbeDeps = {}): Promise<ProbeReport> {
  const args = parseArgs(argv);
  const env = deps.env ?? process.env;
  const ref = args.ref ?? FAKE_REF;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const fakeApiUrl = 'http://127.0.0.1:54321';
  const provider: ProjectProvider =
    deps.provider ??
    (args.fake
      ? createFakeProjectProvider({
          targets: {
            [FAKE_REF]: {
              apiUrl: fakeApiUrl,
              host: '127.0.0.1',
              port: 54322,
              dbName: 'postgres',
              migrations: [],
              buckets: [],
            },
          },
        })
      : createSupabaseProjectProvider({
          pat: requireVar(env, 'SUPABASE_PAT'),
          orgSlug: requireVar(env, 'SUPABASE_ORG_SLUG'),
        }));
  const apiUrlFor =
    deps.apiUrlFor ?? (args.fake ? () => fakeApiUrl : (r: string) => `https://${r}.supabase.co`);

  let project: ProbeReport['project'];
  try {
    const described = await provider.describe(ref);
    project = { status: described.status, organisationMatches: true };
  } catch (error) {
    // The adapter pins the organisation inside `describe`; the typed error says which refusal it was.
    const typed = error instanceof ProjectProviderError ? error : null;
    project = {
      status: 'error',
      organisationMatches: typed?.code === 'org_mismatch' ? false : 'unknown',
      error: typed?.message ?? 'error',
    };
  }

  const healthResult = await settle(() => provider.health(ref));
  const health: ProbeReport['health'] = healthResult.ok
    ? { services: healthResult.value.services }
    : { error: healthResult.error };

  const listed = await settle(() => provider.listApiKeys(ref));
  let keys: ProbeReport['keys'];
  let keyList: ApiKey[] = [];
  if (listed.ok) {
    keyList = listed.value;
    const secretLike = keyList.filter(
      (k) => k.kind === 'secret' || k.kind === 'legacy_service_role',
    );
    keys = {
      kinds: [...new Set(keyList.map((k) => k.kind))].sort(),
      count: keyList.length,
      secretReveal: secretLike.some((k) => typeof k.value === 'string' && k.value !== '')
        ? 'revealed'
        : 'masked',
    };
  } else {
    keys = {
      error: listed.error,
      secretReveal: listed.error.startsWith('forbidden') ? 'forbidden' : 'error',
    };
  }

  const poolerResult = await settle(() => provider.poolerConfig(ref));
  const pooler: ProbeReport['pooler'] = poolerResult.ok
    ? {
        hostShape: hostShape(poolerResult.value.host),
        txPort: poolerResult.value.txPort,
        sessionPort: poolerResult.value.sessionPort,
        dbNameIsPostgres: poolerResult.value.dbName === 'postgres',
      }
    : { error: poolerResult.error };

  const migrationsResult = await settle(() => provider.listMigrations(ref));
  const bucketsResult = await settle(() => provider.listBuckets(ref));
  const signingResult = await settle(() => provider.signingKeys(ref));
  const queryResult = await settle(() => provider.readOnlyQuery(ref, 'select 1 as one'));

  const report: ProbeReport = {
    mode: args.fake ? 'fake' : 'real',
    project,
    health,
    keys,
    pooler,
    migrations: migrationsResult.ok
      ? { count: migrationsResult.value.length }
      : { error: migrationsResult.error },
    buckets: bucketsResult.ok
      ? { count: bucketsResult.value.length }
      : { error: bucketsResult.error },
    signingKeys: signingResult.ok
      ? {
          algorithms: [...new Set(signingResult.value.map((k) => k.algorithm))].sort(),
          inUse: signingResult.value.some((k) => k.status === 'in_use'),
        }
      : { error: signingResult.error },
    readOnlyQuery: { answered: queryResult.ok && queryResult.value !== null },
    recommendation:
      keys.secretReveal === 'forbidden' || keys.secretReveal === 'masked'
        ? 'manualAccess'
        : 'automatic',
  };

  if (args.exerciseKeys && listed.ok) {
    const apiUrl = apiUrlFor(ref);
    const secret = keyList.find((k) => k.kind === 'secret' && k.value);
    const legacy = keyList.find((k) => k.kind === 'legacy_service_role' && k.value);
    const secretCheck = secret ? await exerciseKey(apiUrl, secret, fetchImpl) : 'absent';
    const legacyCheck = legacy ? await exerciseKey(apiUrl, legacy, fetchImpl) : 'absent';
    const passes = (check: KeyCheck | 'absent') =>
      check !== 'absent' && Object.values(check).every((v) => v === 'pass');
    report.exerciseKeys = {
      secret: secretCheck,
      legacy_service_role: legacyCheck,
      serviceKeyKind: passes(secretCheck)
        ? 'secret'
        : passes(legacyCheck)
          ? 'legacy_service_role'
          : 'undecided',
    };
  }
  return report;
}

async function main(): Promise<void> {
  try {
    const report = await runProbe(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`platform:probe: ${error instanceof Error ? error.message : 'failed'}\n`);
    process.stderr.write('usage: platform:probe (--ref <ref> | --fake) [--exercise-keys]\n');
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main();
}
