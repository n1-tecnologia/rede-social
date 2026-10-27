import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createFakeProjectProvider,
  type FakeProjectProvider,
  type FakeTarget,
  type FakeTokenScope,
} from '@rede-social/core/server/projects/fake';
import {
  defaultBossFor,
  type MoveDeps,
  type StoragePort,
} from '@rede-social/core/server/projects/move/index';
import { defaultSecrets } from '@rede-social/core/server/projects/steps';
import { registerCustomerProject } from '@rede-social/core/server/projects/token';
import postgres from 'postgres';
import { adminSql, authAdmin, SEED_PASSWORD, signInAs } from './setup';

/**
 * Shared harness of the move tool's integration suites (09.2-23): a throwaway tenant on project 0 with every
 * shape the copy has to carry (a member with a password, a community, a post with a comment, an event with its
 * secret, so the self reference and the deferrable cycle are exercised), the fake provider mapped to
 * `rede_tenant_b`, in-memory Storage ports (the local stack has ONE Storage for both "projects") and the
 * connection seams of the move.
 *
 * Fixtures are a few bytes and a few rows: the local disk is nearly full and the Storage volume is never
 * cleared by `db reset`, so nothing here uploads a real file and everything removes itself.
 */

export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const SRC_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
export const TGT_URL = 'postgres://postgres:postgres@127.0.0.1:54322/rede_tenant_b';
export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

export function resetB(mode: 'migrated' | 'bare' = 'migrated'): void {
  execFileSync(
    'bash',
    ['scripts/db-two-databases.sh', '--reset', ...(mode === 'bare' ? ['--bare'] : [])],
    { cwd: ROOT, timeout: 120_000, stdio: 'pipe' },
  );
}

const open = (url: string) =>
  postgres(url, { max: 4, prepare: false, onnotice: () => undefined, idle_timeout: 2 });

const clients: postgres.Sql[] = [];
export function connect(url: string): postgres.Sql {
  const client = open(url);
  clients.push(client);
  return client;
}
export async function closeHelperClients(): Promise<void> {
  for (const client of clients.splice(0)) await client.end({ timeout: 5 }).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------------------
// In-memory Storage
// ---------------------------------------------------------------------------------------------------------

export type MemoryStorage = StoragePort & {
  objects: Map<string, { bytes: Uint8Array; contentType: string | null }>;
  put(bucket: string, key: string, text: string): void;
  remove(bucket: string, keys: readonly string[]): Promise<void>;
  keys(): string[];
};

export function memoryStorage(): MemoryStorage {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string | null }>();
  const id = (bucket: string, key: string) => `${bucket}\u0000${key}`;
  return {
    objects,
    put(bucket, key, text) {
      objects.set(id(bucket, key), {
        bytes: new TextEncoder().encode(text),
        contentType: 'text/plain',
      });
    },
    async *list(bucket, prefix) {
      for (const [entry, value] of objects) {
        const [b, key] = entry.split('\u0000');
        if (b === bucket && key?.startsWith(prefix)) yield { key, size: value.bytes.length };
      }
    },
    async download(bucket, key) {
      const hit = objects.get(id(bucket, key));
      if (!hit) throw new Error('missing');
      return { bytes: hit.bytes, contentType: hit.contentType, cacheControl: '3600' };
    },
    async upload(bucket, key, body, options) {
      objects.set(id(bucket, key), { bytes: body, contentType: options.contentType });
    },
    async info(bucket, key) {
      const hit = objects.get(id(bucket, key));
      return hit ? { size: hit.bytes.length } : null;
    },
    async remove(bucket, keys) {
      for (const key of keys) objects.delete(id(bucket, key));
    },
    keys() {
      return [...objects.keys()].map((entry) => entry.replace('\u0000', '/'));
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// The harness: provider, target ref, seams
// ---------------------------------------------------------------------------------------------------------

export type Harness = {
  ref: string;
  deps: MoveDeps;
  storageOf: (projectId: string) => MemoryStorage;
};

/**
 * `targetApiUrl` is the Supabase origin the target project reports. The default is the local stack's own, the
 * one the API verifies a bearer against; a case that does not authenticate against the target can pass another
 * origin to exercise the branding URL rewrite and its inverse.
 */
export function harness(options: { targetApiUrl?: string } = {}): Harness {
  const ref = `mv-${randomBytes(6).toString('hex')}`;
  const provider = createFakeProjectProvider({
    targets: { [ref]: moveTarget(options.targetApiUrl) },
  });
  const { deps, storageOf } = moveDeps(provider, provider);
  return { ref, deps, storageOf };
}

/** The fake target of a ref: `rede_tenant_b` on the local cluster, with the two buckets the tenant set creates. */
function moveTarget(apiUrl?: string): FakeTarget {
  return {
    apiUrl: apiUrl ?? SUPABASE_URL,
    host: '127.0.0.1',
    port: 54322,
    txPort: 54322,
    dbName: 'rede_tenant_b',
    buckets: [
      { id: 'branding', name: 'branding', public: true },
      { id: 'media', name: 'media', public: false },
    ],
  };
}

/**
 * The seams of the move over the local cluster. `provider` is the one `registerMoveTarget` uses; `bootstrap`
 * is the provider the bootstrap engine is handed, or `undefined` to leave it unset so the engine resolves ONE
 * PER PROJECT (09.4-06: a customer project runs on its own token).
 */
function moveDeps(
  provider: FakeProjectProvider,
  bootstrapProvider: FakeProjectProvider | undefined,
  extra: { sourceRefs?: readonly string[]; deleteAccounts?: boolean } = {},
): { deps: MoveDeps; storageOf: (projectId: string) => MemoryStorage } {
  const stores = new Map<string, MemoryStorage>();
  const storageOf = (projectId: string): MemoryStorage => {
    const hit = stores.get(projectId);
    if (hit) return hit;
    const made = memoryStorage();
    stores.set(projectId, made);
    return made;
  };
  const sourceRefs = extra.sourceRefs ?? [];
  const deps: MoveDeps = {
    target: {
      provider,
      production: false,
      sleep: async () => undefined,
      bootstrap: {
        ...(bootstrapProvider ? { provider: bootstrapProvider } : {}),
        connect: (kind, url) =>
          postgres(kind === 'ddl' ? TGT_URL : url, {
            max: 1,
            prepare: false,
            connect_timeout: 10,
            idle_timeout: 2,
            onnotice: () => undefined,
          }),
        // The local cluster shares its roles: a generated password would lock project 0 out of api_user.
        secrets: { ...defaultSecrets, apiUserPassword: () => 'postgres' },
        config: () => ({
          platformOrigin: 'https://app.example.test',
          apiPublicUrl: 'https://api.example.test',
          mailDomain: 'mail.example.test',
          smtpPass: `SMTP${randomBytes(12).toString('hex')}`,
        }),
        sendInvites: async () => undefined,
      },
    },
    openSql: (project, { readOnly }) => {
      const url =
        project.isCentral || project.credentialSource === 'env' || sourceRefs.includes(project.ref)
          ? SRC_URL
          : TGT_URL;
      const client = postgres(url, {
        max: 1,
        prepare: false,
        onnotice: () => undefined,
        idle_timeout: 2,
      });
      if (readOnly) {
        client.unsafe('set default_transaction_read_only = on').then(
          () => undefined,
          () => undefined,
        );
      }
      return client;
    },
    storage: (project) => storageOf(project.id),
    purgeStorage: (project, bucket, keys) => storageOf(project.id).remove(bucket, keys),
    sleep: async () => undefined,
  };
  if (sourceRefs.length > 0) {
    // A "customer project" whose data physically lives in project 0's database has no transaction URL of its
    // own: its queue is project 0's, and no account of it is ever removed.
    deps.bossFor = (project) =>
      defaultBossFor(sourceRefs.includes(project.ref) ? { ...project, isCentral: true } : project);
  }
  if (extra.deleteAccounts === false) deps.deleteAccount = async () => undefined;
  return { deps, storageOf };
}

export type CustomerHarness = Harness & {
  /** The token-aware fake world: its `calls.tokenUses` says which kind of token touched which ref. */
  provider: FakeProjectProvider;
};

/**
 * 09.4-12: a move over a token-aware fake. `refs` all map to `rede_tenant_b`; `sourceRefs` are refs whose data
 * physically lives in project 0's database (they play the SOURCE of a way-back move). `bootstrap: 'per-project'`
 * hands the engine no provider, so each project resolves its own (the test must pin the fake with
 * `setProjectProviderForTests`); `'platform'` hands it the base fake, whose uses are recorded as `platform`.
 */
export function customerHarness(options: {
  refs: readonly string[];
  tokens: Record<string, FakeTokenScope>;
  orgSlug?: string;
  sourceRefs?: readonly string[];
  bootstrap: 'per-project' | 'platform';
}): CustomerHarness {
  const provider = createFakeProjectProvider({
    targets: Object.fromEntries(options.refs.map((ref) => [ref, moveTarget()])),
    orgSlug: options.orgSlug ?? 'acme-customer',
    tokens: options.tokens,
  });
  const { deps, storageOf } = moveDeps(
    provider,
    options.bootstrap === 'platform' ? provider : undefined,
    { sourceRefs: options.sourceRefs ?? [], deleteAccounts: false },
  );
  return { ref: options.refs[0] ?? '', deps, storageOf, provider };
}

// ---------------------------------------------------------------------------------------------------------
// The throwaway tenant of project 0
// ---------------------------------------------------------------------------------------------------------

export type MoveTenant = {
  tenantId: string;
  slug: string;
  host: string;
  userId: string;
  email: string;
  communityId: string;
  postId: string;
  eventId: string;
  token: () => Promise<string>;
  cleanup: () => Promise<void>;
};

export async function createMoveTenant(
  slug: string,
  options: { extraMember?: boolean } = {},
): Promise<MoveTenant> {
  const tenantId = crypto.randomUUID();
  const host = `${slug}.localhost`;
  const email = `${slug}-${crypto.randomUUID().slice(0, 8)}@rede-demo.local`;
  const logo = `${SUPABASE_URL}/storage/v1/object/public/branding/${tenantId}/logo.png`;
  const branding = {
    logoUrl: logo,
    faviconUrl: null,
    iconUrl: null,
    iconUrls: null,
    iconVersion: 0,
  };

  const created = await authAdmin().createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw new Error('createUser failed');
  const userId = created.data.user.id;

  await adminSql.begin(async (tx) => {
    await tx`
      insert into public.tenants (id, slug, display_name, branding, rules_text, rules_version)
      values (${tenantId}::uuid, ${slug}, 'Movel', ${tx.json(branding)}, 'Regras.', 1)`;
    await tx`
      insert into public.tenant_modules (tenant_id, module_key, enabled)
      values (${tenantId}::uuid, 'feed', true), (${tenantId}::uuid, 'communities', true),
             (${tenantId}::uuid, 'events', true)`;
    await tx`
      insert into public.tenant_domains (tenant_id, host, is_primary, verified_at)
      values (${tenantId}::uuid, ${host}, true, now())`;
    await tx`
      insert into public.memberships (tenant_id, user_id, role, status)
      values (${tenantId}::uuid, ${userId}::uuid, 'admin_tenant', 'active')`;
  });

  const [community] = await adminSql<{ id: string }[]>`
    insert into public.communities (tenant_id, created_by_user_id, name, slug)
    values (${tenantId}::uuid, ${userId}::uuid, 'Comunidade', 'comunidade') returning id`;
  const [post] = await adminSql<{ id: string }[]>`
    insert into public.feed_posts (tenant_id, author_user_id, community_id, caption)
    values (${tenantId}::uuid, ${userId}::uuid, ${community?.id ?? ''}::uuid, 'Primeira') returning id`;
  await adminSql`
    insert into public.feed_comments (tenant_id, post_id, author_user_id, body)
    values (${tenantId}::uuid, ${post?.id ?? ''}::uuid, ${userId}::uuid, 'Comentario')`;
  const eventId = crypto.randomUUID();
  await adminSql.begin(async (tx) => {
    await tx`
      insert into public.events (id, tenant_id, created_by_user_id, title, format, starts_at, ends_at)
      values (${eventId}::uuid, ${tenantId}::uuid, ${userId}::uuid, 'Encontro', 'online',
              now() + interval '1 day', now() + interval '2 days')`;
    await tx`
      insert into public.event_secrets (event_id, tenant_id, event_format, checkin_code, meeting_url)
      values (${eventId}::uuid, ${tenantId}::uuid, 'online', 'ABCD', 'https://example.test/sala')`;
  });

  let extraUserId: string | null = null;
  if (options.extraMember) {
    const extra = await authAdmin().createUser({
      email: `x-${email}`,
      password: SEED_PASSWORD,
      email_confirm: true,
    });
    extraUserId = extra.data.user?.id ?? null;
    if (extraUserId) {
      await adminSql`
        insert into public.memberships (tenant_id, user_id, role, status)
        values (${tenantId}::uuid, ${extraUserId}::uuid, 'member', 'active')`;
    }
  }

  let cleaned = false;
  return {
    tenantId,
    slug,
    host,
    userId,
    email,
    communityId: community?.id ?? '',
    postId: post?.id ?? '',
    eventId,
    token: () => signInAs(email, SEED_PASSWORD),
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await adminSql`delete from pgboss.job where data ->> 'tenantId' = ${tenantId}`;
      await adminSql`delete from public.memberships where tenant_id = ${tenantId}::uuid`;
      await adminSql`delete from public.tenants where id = ${tenantId}::uuid`;
      for (const id of [userId, extraUserId]) {
        if (!id) continue;
        await authAdmin().deleteUser(id);
      }
      await adminSql`delete from public.access_grants where email in (${email}, ${`x-${email}`})`;
    },
  };
}

/**
 * Registers a project of the customer's account the way `platform:set-owner --register` does (plan 11): the
 * token is validated through the token-aware fake, sealed under `<id>:mgmt_token` and the organisation pin is
 * learned. Returns the registry id. The token is a fake string.
 */
export async function registerCustomerTarget(
  h: CustomerHarness,
  ref: string,
  token: string,
): Promise<string> {
  const { projectId } = await registerCustomerProject({
    ref,
    token,
    expiresAt: null,
    actor: 'tester',
    provider: h.provider.forToken(token),
  });
  return projectId;
}

/** Makes a registered project the SOURCE of a tenant: `ready`, and the tenant's binding points at it. */
export async function adoptAsSource(tenantId: string, projectId: string): Promise<void> {
  await adminSql`update platform.projects set state = 'ready' where id = ${projectId}::uuid`;
  await adminSql`
    update platform.tenant_projects set project_id = ${projectId}::uuid
     where tenant_id = ${tenantId}::uuid`;
}

/** Removes the registry rows a move target left behind (the project and its steps cascade). */
export async function removeTargetProject(ref: string): Promise<void> {
  await adminSql`delete from platform.projects where ref = ${ref}`;
}

/**
 * Tenant row counts per table of one database, the proof that a source did not change. `tenant_domains` is
 * central-owned (the move never copies it), so it is not part of the comparison between source and target.
 */
export async function footprint(
  db: postgres.Sql,
  tenantId: string,
): Promise<Record<string, number>> {
  const tables = await db<{ name: string }[]>`
    select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id'
                      and not a.attisdropped and a.atttypid = 'uuid'::regtype)
     order by 1`;
  const out: Record<string, number> = {};
  for (const { name } of tables) {
    const [row] = await db.unsafe(
      `select count(*)::int as n from public."${name}" where tenant_id = $1::uuid`,
      [tenantId],
    );
    if (name === 'tenant_domains') continue;
    out[name] = Number(row?.n ?? 0);
  }
  return out;
}
