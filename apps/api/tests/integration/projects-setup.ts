import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTenant } from '@rede-social/core/server/platform/tenants';
import { type BootstrapDeps, runBootstrap } from '@rede-social/core/server/projects/bootstrap';
import {
  createFakeProjectProvider,
  type FakeProjectProvider,
  type FakeProjectProviderOptions,
  type FakeTarget,
} from '@rede-social/core/server/projects/fake';
import { defaultSecrets } from '@rede-social/core/server/projects/steps';
import { seal } from '@rede-social/core/server/secrets/sealed';
import postgres from 'postgres';
import { vi } from 'vitest';
import { adminSql } from './setup';

/**
 * Shared fixtures of the 09.2-14 panel-API suites (`platform-projects`, `project-credentials`,
 * `project-health`): the second local database `rede_tenant_b` as a stand-in for a fresh hosted project, the
 * fake project provider mapped to it, and the bootstrap dependencies that redirect the one connection the
 * fake cannot apply (the `postgres` password it records is never set).
 */

export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const B_ADMIN_URL = 'postgres://postgres:postgres@127.0.0.1:54322/rede_tenant_b';
export const API_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

/** A freshly created, EMPTY `rede_tenant_b`: the Supabase platform schemas only, like a new hosted project. */
export function resetB(): void {
  execFileSync('bash', ['scripts/db-two-databases.sh', '--reset', '--bare'], {
    cwd: ROOT,
    timeout: 120_000,
    stdio: 'pipe',
  });
}

/** `rede_tenant_b` with the tenant set applied and no fixtures: what the other suites expect. */
export function restoreB(): void {
  execFileSync('bash', ['scripts/db-two-databases.sh', '--reset'], {
    cwd: ROOT,
    timeout: 120_000,
    stdio: 'pipe',
  });
}

/** A short-lived connection to B (the database is dropped between cases, so no long-lived client survives). */
export async function onB<T>(fn: (b: postgres.Sql) => Promise<T>): Promise<T> {
  const b = postgres(B_ADMIN_URL, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    return await fn(b);
  } finally {
    await b.end({ timeout: 5 });
  }
}

/** A fake target for a ref: B, the local API, the two buckets the tenant set creates. */
export const fakeTarget = (extra: Partial<FakeTarget> = {}): FakeTarget => ({
  apiUrl: API_URL,
  databaseUrl: B_ADMIN_URL,
  host: '127.0.0.1',
  port: 54322,
  txPort: 54322,
  dbName: 'rede_tenant_b',
  buckets: [
    { id: 'branding', name: 'branding', public: true },
    { id: 'media', name: 'media', public: false },
  ],
  ...extra,
});

export function fakeProvider(
  targets: Record<string, FakeTarget>,
  extra: Partial<FakeProjectProviderOptions> = {},
): FakeProjectProvider {
  return createFakeProjectProvider({ targets, ...extra });
}

/** The one connection the fake cannot apply: the DDL connection goes to the local superuser, the rest as stored. */
export const connectToB = (kind: 'ddl' | 'api', url: string): postgres.Sql =>
  postgres(kind === 'ddl' ? B_ADMIN_URL : url, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 2,
    onnotice: () => undefined,
  });

/** The bootstrap dependencies against B: the DDL connection goes to the local superuser, the rest as stored. */
export function bootstrapDeps(
  provider: FakeProjectProvider,
  overrides: Partial<Omit<BootstrapDeps, 'sendInvites'>> = {},
): BootstrapDeps & { sendInvites: ReturnType<typeof vi.fn> } {
  const sendInvites = vi.fn(async () => undefined);
  return {
    provider,
    connect: connectToB,
    secrets: {
      ...defaultSecrets,
      ddlPassword: () => `DDL${randomBytes(18).toString('hex')}`,
      // The local cluster shares its roles: a generated password would lock project 0 out of `api_user`.
      apiUserPassword: () => 'postgres',
    },
    config: () => ({
      platformOrigin: 'https://app.example.test',
      apiPublicUrl: 'https://api.example.test',
      mailDomain: 'mail.example.test',
      smtpPass: `SMTP${randomBytes(12).toString('hex')}`,
    }),
    sendInvites,
    ...overrides,
  };
}

/**
 * A tenant bound to a project of `ref` (a ref the provider maps to B) that went through the whole bootstrap:
 * `ready`, with every credential sealed, exactly what the credential and health suites start from.
 * Reset B to the bare state first.
 */
export async function createReadyTenant(
  provider: FakeProjectProvider,
  ref: string,
  slug: string,
  options: { run?: boolean } = {},
): Promise<{ tenantId: string; projectId: string }> {
  const made = await createTenant(
    {
      displayName: 'Comunidade Projeto',
      slug,
      colors: { primary: '#7c3aed', secondary: '#a78bfa' },
      modules: ['feed'],
      adminEmail: `admin-${slug}@rede-social-test.local`,
      projectRef: ref,
    } as never,
    { userId: crypto.randomUUID() },
    { provider, production: false },
  );
  if (options.run !== false) {
    const outcome = await runBootstrap(made.projectId, bootstrapDeps(provider));
    if (outcome.status !== 'ready') throw new Error(`bootstrap of ${ref} ended ${outcome.status}`);
  }
  return { tenantId: made.id, projectId: made.projectId };
}

/** The organisation the customer fixtures are pinned to (the fake provider answers it for every ref). */
export const CUSTOMER_ORG = 'acme-customer';

/**
 * Turns an existing registry row into a CUSTOMER project (09.4-06): owner, organisation pin and a management
 * token sealed under the test keyring with the real AAD `<id>:mgmt_token`. The token is a fake string.
 */
export async function makeCustomerProject(
  projectId: string,
  token: string,
  orgSlug: string = CUSTOMER_ORG,
): Promise<void> {
  await adminSql`
    update platform.projects
       set owner = 'customer',
           org_slug = ${orgSlug},
           mgmt_token_sealed = ${seal(token, `${projectId}:mgmt_token`)},
           mgmt_token_expires_at = null
     where id = ${projectId}::uuid`;
}

/** A fake provider whose world also knows one customer token for every ref it maps. */
export function customerFakeProvider(
  targets: Record<string, FakeTarget>,
  token: string,
): FakeProjectProvider {
  return fakeProvider(targets, { orgSlug: CUSTOMER_ORG, tokens: { [token]: { refs: 'all' } } });
}
