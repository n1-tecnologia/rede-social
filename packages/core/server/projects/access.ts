import { createClient } from '@supabase/supabase-js';
import postgres, { type Sql } from 'postgres';
import { open } from '../secrets/sealed';
import type { ProjectRecord } from '../tenancy/project-registry';
import { connectionUrl } from './steps';
import type { ProjectProvider } from './types';

/**
 * Validation of manually supplied project access (09.2-14, D-541, D-539, T-09.2-70): the `postgres` password,
 * the service key and the publishable key are each tried against the project BEFORE anything is sealed or
 * replaced, so a typo can never take a tenant down.
 *
 *   databasePassword  a candidate DDL connection at the project's pooler host that runs `select 1`
 *   serviceKey        a candidate admin client that lists the project's buckets
 *   publishableKey    `GET <api_url>/storage/v1/bucket` carrying the candidate as `apikey` and nothing else: a
 *                     right key is let through and lists the buckets the anon role may see (an empty list is a
 *                     200), a wrong one is refused. `/auth/v1/settings`, the route the plan named, is OPEN on the
 *                     local gateway and `/rest/v1/` answers 200 to any key there, so neither can tell a wrong key
 *                     from a right one; how the hosted gateway answers is proof H5 of plan 25
 *
 * The outbound URLs come ONLY from the registry (`api_url`, the stored or provider-reported pooler host),
 * never from a request body (T-09.2-71). No value, host or driver message is logged or thrown: the answer is
 * a boolean, and the caller turns `false` into `VALIDATION_FAILED { access: 'invalid' }`.
 */

export type AccessValues = {
  databasePassword?: string | undefined;
  serviceKey?: string | undefined;
  publishableKey?: string | undefined;
};

/** Where the DDL connection of a project goes: the stored URL's coordinates, else the provider's pooler. */
export type DdlTarget = { user: string; host: string; port: number; db: string };

export type AccessDeps = {
  /** Opens a one-connection client; injected so a test can redirect it. Must be closed by the caller of it. */
  connect: (url: string) => Sql;
  /** Lists the project's buckets with a candidate service key; resolves to `true` when the project accepted it. */
  serviceKeyWorks: (apiUrl: string, serviceKey: string) => Promise<boolean>;
  /** Offers a candidate publishable key to the project's API gateway; `true` when the gateway lets it through. */
  publishableKeyWorks: (apiUrl: string, publishableKey: string) => Promise<boolean>;
};

const CHECK_TIMEOUT_MS = 10_000;

/** The non-empty, trimmed values of an access block (an empty string is "not supplied"). */
export function presentAccess(access: AccessValues | undefined): AccessValues {
  const out: AccessValues = {};
  const password = access?.databasePassword;
  if (typeof password === 'string' && password.trim().length > 0) out.databasePassword = password;
  const service = access?.serviceKey?.trim();
  if (service) out.serviceKey = service;
  const publishable = access?.publishableKey?.trim();
  if (publishable) out.publishableKey = publishable;
  return out;
}

export const defaultAccessDeps: AccessDeps = {
  connect: (url) =>
    postgres(url, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 2,
      onnotice: () => undefined,
    }),
  serviceKeyWorks: async (apiUrl, serviceKey) => {
    try {
      const client = createClient(apiUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await client.storage.listBuckets();
      return error === null;
    } catch {
      return false;
    }
  },
  publishableKeyWorks: async (apiUrl, publishableKey) => {
    try {
      const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/storage/v1/bucket`, {
        headers: { apikey: publishableKey },
        redirect: 'error',
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      // Only a 2xx is a yes: 4xx is the gateway refusing the key, 5xx the project unable to say.
      return response.ok;
    } catch {
      return false;
    }
  },
};

/** The DDL coordinates of a project: its stored URL when it has one, else the pooler the provider reports. */
export async function ddlTargetOf(
  project: Pick<ProjectRecord, 'id' | 'ref' | 'ddlUrlSealed'>,
  provider: ProjectProvider,
): Promise<DdlTarget> {
  if (project.ddlUrlSealed) {
    const url = new URL(open(project.ddlUrlSealed, `${project.id}:ddl_url`));
    return {
      user: decodeURIComponent(url.username),
      host: url.hostname,
      port: Number(url.port),
      db: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
  }
  const pooler = await provider.poolerConfig(project.ref);
  return {
    user: pooler.userFor('postgres'),
    host: pooler.host,
    port: pooler.sessionPort,
    db: pooler.dbName,
  };
}

/** The DDL URL for `password` at `target`. */
export const ddlUrlFor = (target: DdlTarget, password: string): string =>
  connectionUrl(target.user, password, target.host, target.port, target.db);

/**
 * Tries every supplied value against the project. `true` only when ALL of them work; the first refusal
 * returns `false` (nothing else is tried). Never throws and never reveals which value was refused.
 */
export async function validateAccess(
  project: Pick<ProjectRecord, 'apiUrl'>,
  target: DdlTarget | null,
  values: AccessValues,
  deps: AccessDeps = defaultAccessDeps,
): Promise<boolean> {
  try {
    if (values.databasePassword !== undefined) {
      if (target === null) return false;
      const client = deps.connect(ddlUrlFor(target, values.databasePassword));
      try {
        await client`select 1`;
      } finally {
        await client.end({ timeout: 2 }).catch(() => undefined);
      }
    }
    if (values.serviceKey !== undefined) {
      if (!(await deps.serviceKeyWorks(project.apiUrl, values.serviceKey))) return false;
    }
    if (values.publishableKey !== undefined) {
      if (!(await deps.publishableKeyWorks(project.apiUrl, values.publishableKey))) return false;
    }
    return true;
  } catch {
    return false;
  }
}
