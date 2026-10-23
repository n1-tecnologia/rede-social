import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';
import { withAdminTx } from '../../db/admin-tx';
import { projects, tenantProjects } from '../../db/central';
import { withPlatformTx } from '../../db/platform-tx';
import { tenantInvites } from '../../db/schema';
import { env, publicWebOrigin } from '../env';
import { applyDirectory, projectIsEmpty } from '../migrations/runner';
import {
  defaultMigrationDir,
  type MigrationFile,
  readMigrationDir,
  readRolesSql,
} from '../migrations/sets';
import { createPendingInvite, sendPendingInvites } from '../platform/invites';
import { open, processKeyring, seal } from '../secrets/sealed';
import {
  invalidateProject,
  type ProjectRecord,
  resolveProjectById,
} from '../tenancy/project-registry';
import { buildAuthConfigBody, STORAGE_FILE_SIZE_LIMIT_BYTES } from './auth-config';
import type { BootstrapReason, BootstrapStep } from './reasons';
import type { ProjectProvider } from './types';

/**
 * The eight bootstrap steps (09.2-13, D-542). Each one is a function of (the registry row, the tenants bound
 * to the project, the provider, two connections) and writes only its own results:
 *
 *   verify    the project exists in the pinned organisation, is healthy, has keys, a `postgres` password and
 *             a stored DDL connection, and (first run only) holds no data
 *   roles     `api_user` exists with a generated password; the transaction- and session-pooler URLs are sealed
 *   schema    the tenant set through the runner, THEN the Data API closure, THEN `platform` proven absent
 *   auth      one Auth PATCH, the ES256 signing key, the project's hook coordinates
 *   buckets   `branding` and `media` exist; the project-wide file size limit
 *   realtime  private channels only; the topic policy is present
 *   tenant    the central `tenants` row and its `tenant_modules` copied into the project
 *   invite    the first admin's invite, created in the project with a null creator
 *
 * Every step can run again without damage: the secrets it creates are written to the registry BEFORE anything
 * depends on them and reused when present, the SQL is `if not exists` / `on conflict do nothing` shaped, and
 * a step that finds its own results already in place changes nothing.
 *
 * Credentials never leave this file except as SEALED registry columns (AAD `<projectId>:<column>`): no step
 * logs, and no thrown message names a value (the engine stores a reason CODE only, `reasons.ts`). That is
 * why this file contains no log call at all.
 */

/** A failure with a chosen reason code (provider failures are mapped by `reasonOf`, everything else by the step). */
export class BootstrapStepError extends Error {
  readonly reason: BootstrapReason;

  constructor(reason: BootstrapReason) {
    super(`bootstrap step failed: ${reason}`);
    this.name = 'BootstrapStepError';
    this.reason = reason;
  }
}

export type BoundTenant = {
  tenantId: string;
  pendingInvite: { email: string; createdBy?: string | null } | null;
};

/** What a step may open: the stored DDL connection (`postgres`, session mode) or `api_user` (login proof). */
export type ConnectKind = 'ddl' | 'api';
export type Connect = (kind: ConnectKind, url: string) => Sql;

export type StepSecrets = {
  /** The `postgres` password set once through the Management API. */
  ddlPassword: () => string;
  /** The `api_user` password set by `alter role`. */
  apiUserPassword: () => string;
  /** 16 random bytes, base64url: 22 characters. */
  hookRef: () => string;
  /** `v1,whsec_<base64 of 32 random bytes>`. */
  hookSecret: () => string;
};

export type BootstrapConfig = {
  platformOrigin: string;
  apiPublicUrl: string;
  mailDomain: string;
  smtpPass: string | undefined;
};

export type StepDeps = {
  connect: Connect;
  secrets: StepSecrets;
  config: () => BootstrapConfig;
  loadTenantSet: () => Promise<MigrationFile[]>;
  readRolesSql: () => Promise<string>;
  /** The first-admin send, injectable so a test needs no Auth server. */
  sendInvites: (tenantId: string) => Promise<unknown>;
};

export type StepContext = {
  /** Fresh read of the registry row at the moment the step was claimed. */
  project: ProjectRecord;
  tenants: BoundTenant[];
  provider: ProjectProvider;
  deps: StepDeps;
  /** `attempt` of every step row at the start of the run (the `verify` emptiness rule reads `schema`'s). */
  attempts: Record<BootstrapStep, number>;
};

export type StepRunner = (ctx: StepContext) => Promise<void>;

// ---------------------------------------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------------------------------------

export const defaultSecrets: StepSecrets = {
  ddlPassword: () => randomBytes(32).toString('base64url'),
  apiUserPassword: () => randomBytes(32).toString('base64url'),
  hookRef: () => randomBytes(16).toString('base64url'),
  hookSecret: () => `v1,whsec_${randomBytes(32).toString('base64')}`,
};

export const defaultConnect: Connect = (_kind, url) =>
  postgres(url, {
    max: 1,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 5,
    onnotice: () => undefined,
  });

export const defaultConfig = (): BootstrapConfig => ({
  platformOrigin: env.PLATFORM_HOST ? publicWebOrigin(env.PLATFORM_HOST) : 'http://localhost:3000',
  apiPublicUrl: env.API_PUBLIC_URL ?? 'http://localhost:8787',
  mailDomain: env.MAIL_DOMAIN,
  smtpPass: env.PROJECT_AUTH_SMTP_PASS,
});

export const defaultStepDeps = (): StepDeps => ({
  connect: defaultConnect,
  secrets: defaultSecrets,
  config: defaultConfig,
  loadTenantSet: () => readMigrationDir(defaultMigrationDir('tenant'), 'tenant'),
  readRolesSql: () => readRolesSql(),
  sendInvites: (tenantId) => sendPendingInvites(tenantId),
});

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------

/** The Management API / fake `failpoint` seam for steps that are not provider calls. The real adapter has none. */
function crossFailpoint(provider: ProjectProvider, step: BootstrapStep): void {
  const seam = (provider as { failpoint?: unknown }).failpoint;
  if (typeof seam === 'function') (seam as (s: BootstrapStep) => void).call(provider, step);
}

const aad = (project: ProjectRecord, column: string) => `${project.id}:${column}`;

type RegistryPatch = Partial<{
  apiUrl: string;
  publishableKey: string;
  serviceKeySealed: string;
  serviceKeyKind: string;
  ddlUrlSealed: string;
  databaseUrlTxSealed: string;
  databaseUrlSessionSealed: string;
  hookRef: string;
  hookSecretSealed: string;
}>;

/**
 * Writes columns of the project's registry row and nothing else, then drops the cached bindings so the next
 * lane sees them. `secret_key_id` is set when it was empty (the reseal command owns it afterwards); a patch
 * that carries a new pooled credential also bumps `credential_version`, so pools key on the new one.
 */
async function writeRegistry(
  project: ProjectRecord,
  patch: RegistryPatch,
  options: { bumpCredentialVersion?: boolean } = {},
): Promise<void> {
  const sealsSomething = Object.keys(patch).some((key) => key.endsWith('Sealed'));
  await withPlatformTx((tx) =>
    tx
      .update(projects)
      .set({
        ...patch,
        ...(sealsSomething && project.secretKeyId === null
          ? { secretKeyId: processKeyring().currentId }
          : {}),
        ...(options.bumpCredentialVersion
          ? { credentialVersion: sql`${projects.credentialVersion} + 1` }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id)),
  );
  invalidateProject();
}

/** `https://<ref>.supabase.co` for a hosted project; the fake maps its local target. */
function apiUrlOf(provider: ProjectProvider, ref: string): string {
  const target = (
    provider as { targetOf?: (r: string) => { apiUrl: string } | undefined }
  ).targetOf?.(ref);
  return target?.apiUrl ?? `https://${ref}.supabase.co`;
}

function connectionUrl(user: string, password: string, host: string, port: number, db: string) {
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(db)}`;
}

function openDdl(ctx: StepContext): Sql {
  if (!ctx.project.ddlUrlSealed) throw new BootstrapStepError('unreachable');
  return ctx.deps.connect('ddl', open(ctx.project.ddlUrlSealed, aad(ctx.project, 'ddl_url')));
}

async function closeQuietly(sqlClient: Sql): Promise<void> {
  await sqlClient.end({ timeout: 5 }).catch(() => undefined);
}

async function withDdl<T>(ctx: StepContext, fn: (ddl: Sql) => Promise<T>): Promise<T> {
  const ddl = openDdl(ctx);
  try {
    return await fn(ddl);
  } finally {
    await closeQuietly(ddl);
  }
}

// ---------------------------------------------------------------------------------------------------------
// 1. verify
// ---------------------------------------------------------------------------------------------------------

const verify: StepRunner = async (ctx) => {
  const { provider, project, deps } = ctx;
  const ref = project.ref;

  await provider.describe(ref);
  await provider.waitUntilHealthy(ref);

  const patch: RegistryPatch = {};

  // Keys: kept when present (the manual-access path and every resume), obtained once otherwise.
  if (!project.serviceKeySealed || !project.publishableKey) {
    const keys = await provider.ensureKeys(ref);
    const service = keys.service.value;
    const publishable = keys.publishable.value;
    // A token that cannot reveal secrets is an access problem, not an empty project.
    if (!service || !publishable) throw new BootstrapStepError('access_denied');
    patch.publishableKey = publishable;
    patch.serviceKeySealed = seal(service, aad(project, 'service_key'));
    patch.serviceKeyKind = keys.service.kind;
  }
  if (!project.apiUrl) patch.apiUrl = apiUrlOf(provider, ref);

  const pooler = await provider.poolerConfig(ref);

  // The `postgres` password: generated and set ONCE; the DDL URL is stored before anything uses it.
  let ddlUrl: string;
  if (project.ddlUrlSealed) {
    ddlUrl = open(project.ddlUrlSealed, aad(project, 'ddl_url'));
  } else {
    const password = deps.secrets.ddlPassword();
    await provider.setDatabasePassword(ref, password);
    ddlUrl = connectionUrl(
      pooler.userFor('postgres'),
      password,
      pooler.host,
      pooler.sessionPort,
      pooler.dbName,
    );
    patch.ddlUrlSealed = seal(ddlUrl, aad(project, 'ddl_url'));
  }
  if (Object.keys(patch).length > 0) await writeRegistry(project, patch);

  const ddl = deps.connect('ddl', ddlUrl);
  try {
    await ddl`select 1`;
    // Emptiness is a property of the FIRST run: once the schema step has started, a ledger that holds a
    // prefix of the manifest is ours (the runner resumes it), not somebody else's data.
    if (ctx.attempts.schema === 0 && !(await projectIsEmpty(ddl))) {
      throw new BootstrapStepError('not_empty');
    }
  } finally {
    await closeQuietly(ddl);
  }
};

// ---------------------------------------------------------------------------------------------------------
// 2. roles
// ---------------------------------------------------------------------------------------------------------

const roles: StepRunner = async (ctx) => {
  const { provider, project, deps } = ctx;
  crossFailpoint(provider, 'roles');

  const pooler = await provider.poolerConfig(project.ref);
  const rolesSql = await deps.readRolesSql();

  await withDdl(ctx, async (ddl) => {
    await ddl.unsafe(rolesSql);

    // Credentials already stored and still good (a resumed run, a manual-access project): keep them.
    if (project.databaseUrlTxSealed && project.databaseUrlSessionSealed) {
      const probe = deps.connect(
        'api',
        open(project.databaseUrlSessionSealed, aad(project, 'database_url_session')),
      );
      try {
        const [row] = await probe<{ u: string }[]>`select current_user as u`;
        if (row?.u === 'api_user') return;
      } catch {
        // fall through: set a fresh password below
      } finally {
        await closeQuietly(probe);
      }
    }

    const password = deps.secrets.apiUserPassword();
    // The password travels as a bound parameter into `format('%L')`, never as SQL text.
    await ddl.begin(async (tx) => {
      await tx`select set_config('rede.api_user_pw', ${password}, true)`;
      await tx.unsafe(
        `do $$ begin execute format('alter role api_user with login password %L', current_setting('rede.api_user_pw')); end $$`,
      );
    });

    const txUrl = connectionUrl(
      pooler.userFor('api_user'),
      password,
      pooler.host,
      pooler.txPort,
      pooler.dbName,
    );
    const sessionUrl = connectionUrl(
      pooler.userFor('api_user'),
      password,
      pooler.host,
      pooler.sessionPort,
      pooler.dbName,
    );
    for (const url of [txUrl, sessionUrl]) {
      const probe = deps.connect('api', url);
      try {
        const [row] = await probe<{ u: string }[]>`select current_user as u`;
        if (row?.u !== 'api_user') throw new BootstrapStepError('unreachable');
      } finally {
        await closeQuietly(probe);
      }
    }

    await writeRegistry(
      project,
      {
        databaseUrlTxSealed: seal(txUrl, aad(project, 'database_url_tx')),
        databaseUrlSessionSealed: seal(sessionUrl, aad(project, 'database_url_session')),
      },
      { bumpCredentialVersion: true },
    );
  });
};

// ---------------------------------------------------------------------------------------------------------
// 3. schema
// ---------------------------------------------------------------------------------------------------------

const schema: StepRunner = async (ctx) => {
  const { provider, project, deps } = ctx;
  crossFailpoint(provider, 'schema');

  const files = await deps.loadTenantSet();
  await withDdl(ctx, async (ddl) => {
    const result = await applyDirectory(ddl, files, { set: 'tenant' });
    if (result.error) throw result.error;
    if (result.pending.length > 0) throw new BootstrapStepError('migration_failed');

    // Strictly AFTER the last migration: the schema the closure names is created by the tenant set.
    await provider.patchPostgrest(project.ref, {
      db_schema: 'data_api_closed',
      db_extra_search_path: 'extensions',
    });

    // D-547: the control-plane schema never lands in a tenant project.
    const [row] = await ddl<
      { gone: boolean }[]
    >`select to_regnamespace('platform') is null as gone`;
    if (row?.gone !== true) throw new BootstrapStepError('migration_failed');
  });
};

// ---------------------------------------------------------------------------------------------------------
// 4. auth
// ---------------------------------------------------------------------------------------------------------

const auth: StepRunner = async (ctx) => {
  const { provider, project, deps } = ctx;
  const ref = project.ref;

  // Generated ONCE and stored before the PATCH, so a retry sends the same coordinates.
  const hookRef = project.hookRef ?? deps.secrets.hookRef();
  const hookSecret = project.hookSecretSealed
    ? open(project.hookSecretSealed, aad(project, 'hook_secret'))
    : deps.secrets.hookSecret();
  if (!project.hookRef || !project.hookSecretSealed) {
    await writeRegistry(project, {
      hookRef,
      hookSecretSealed: seal(hookSecret, aad(project, 'hook_secret')),
    });
  }

  const config = deps.config();
  if (!config.smtpPass) throw new BootstrapStepError('auth_config_failed');

  const current = await provider.getAuthConfig(ref);
  const existing = typeof current.uri_allow_list === 'string' ? current.uri_allow_list : '';
  const body = buildAuthConfigBody({
    siteUrl: config.platformOrigin,
    apiPublicUrl: config.apiPublicUrl,
    hookRef,
    hookSecret,
    smtpPass: config.smtpPass,
    mailDomain: config.mailDomain,
    existingAllowList: existing,
  });
  await provider.patchAuthConfig(ref, body);

  // An ES256 key in use: asymmetric signing is what the API verifies against (JWKS).
  const keys = await provider.signingKeys(ref);
  if (!keys.some((key) => key.status === 'in_use' && key.algorithm === 'ES256')) {
    const standby = keys.find((key) => key.status === 'standby' && key.algorithm === 'ES256');
    const candidate = standby ?? (await provider.createSigningKey(ref, 'ES256'));
    await provider.patchSigningKey(ref, candidate.id, 'in_use');
  }
};

// ---------------------------------------------------------------------------------------------------------
// 5. buckets
// ---------------------------------------------------------------------------------------------------------

const REQUIRED_BUCKETS = ['branding', 'media'] as const;

const buckets: StepRunner = async (ctx) => {
  const { provider, project } = ctx;
  const present = new Set((await provider.listBuckets(project.ref)).map((bucket) => bucket.id));
  if (REQUIRED_BUCKETS.some((id) => !present.has(id)))
    throw new BootstrapStepError('storage_failed');
  await provider.patchStorage(project.ref, { fileSizeLimit: STORAGE_FILE_SIZE_LIMIT_BYTES });
};

// ---------------------------------------------------------------------------------------------------------
// 6. realtime
// ---------------------------------------------------------------------------------------------------------

const realtime: StepRunner = async (ctx) => {
  const { provider, project } = ctx;
  await provider.patchRealtime(project.ref, { private_only: true });
  await withDdl(ctx, async (ddl) => {
    const [row] = await ddl<{ n: number }[]>`
      select count(*)::int as n
        from pg_policies
       where schemaname = 'realtime'
         and tablename = 'messages'
         and policyname = 'realtime_tenant_topics_select'`;
    if ((row?.n ?? 0) !== 1) throw new BootstrapStepError('realtime_failed');
  });
};

// ---------------------------------------------------------------------------------------------------------
// 7. tenant
// ---------------------------------------------------------------------------------------------------------

const tenant: StepRunner = async (ctx) => {
  crossFailpoint(ctx.provider, 'tenant');

  // The central rows are the source: read them as JSON through the platform lane, copy them as JSON.
  const copies = await withPlatformTx(async (tx) => {
    const out: { tenant: string; modules: string }[] = [];
    for (const bound of ctx.tenants) {
      const rows = (await tx.execute(sql`
        select (select to_jsonb(t) from public.tenants t where t.id = ${bound.tenantId}::uuid) as tenant,
               (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)
                  from public.tenant_modules m where m.tenant_id = ${bound.tenantId}::uuid) as modules`)) as unknown as {
        tenant: unknown;
        modules: unknown;
      }[];
      const row = rows[0];
      if (!row?.tenant) throw new BootstrapStepError('tenant_failed');
      // The drizzle driver hands jsonb back as its raw text; anything else is serialised.
      const text = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));
      out.push({ tenant: text(row.tenant), modules: text(row.modules) });
    }
    return out;
  });

  await withDdl(ctx, async (ddl) => {
    await ddl.begin(async (tx) => {
      for (const copy of copies) {
        await tx.unsafe(
          `insert into public.tenants
             select * from jsonb_populate_record(null::public.tenants, $1::text::jsonb)
           on conflict (id) do nothing`,
          [copy.tenant],
        );
        await tx.unsafe(
          `insert into public.tenant_modules
             select * from jsonb_populate_recordset(null::public.tenant_modules, $1::text::jsonb)
           on conflict do nothing`,
          [copy.modules],
        );
      }
    });
  });
};

// ---------------------------------------------------------------------------------------------------------
// 8. invite
// ---------------------------------------------------------------------------------------------------------

const invite: StepRunner = async (ctx) => {
  const { project, deps } = ctx;
  crossFailpoint(ctx.provider, 'invite');

  // The lane opens on the project's own sealed URLs, so the step also proves them end to end.
  invalidateProject();
  for (const bound of ctx.tenants) {
    const pending = bound.pendingInvite;
    if (!pending) continue;
    const email = pending.email.trim().toLowerCase();

    await withAdminTx({ projectId: project.id }, async (tx) => {
      const [existing] = await tx
        .select({ id: tenantInvites.id })
        .from(tenantInvites)
        .where(and(eq(tenantInvites.tenantId, bound.tenantId), eq(tenantInvites.email, email)))
        .limit(1);
      // The creator is a CENTRAL super_admin with no row here (DBT-36): the invite records none.
      if (!existing)
        await createPendingInvite(tx, { tenantId: bound.tenantId, email, createdBy: null });
    });

    // The send waits for a verified primary host and is retried by `kernel.invite-send`; a failure here
    // leaves a pending invite the panel can resend, so it never fails the bootstrap.
    try {
      await deps.sendInvites(bound.tenantId);
    } catch {
      // nothing to record that is safe to log: the invite row is the record
    }

    await withPlatformTx((tx) =>
      tx
        .update(tenantProjects)
        .set({ pendingInvite: null })
        .where(eq(tenantProjects.tenantId, bound.tenantId)),
    );
  }
};

export const STEP_RUNNERS: Record<BootstrapStep, StepRunner> = {
  verify,
  roles,
  schema,
  auth,
  buckets,
  realtime,
  tenant,
  invite,
};

/** Re-read of the registry row for the next step. */
export const freshProject = (projectId: string): Promise<ProjectRecord | null> =>
  resolveProjectById(projectId);
